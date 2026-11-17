/**
 * #446 expected-version conflict and whole-transaction rollback proof.
 */
import { expect } from '@playwright/test';
import type { SalaryCommandOutcome } from '@/lib/salary-profile-commands';
import {
	expectCommandFailure,
	expectCommandOk,
	generateSlipOn,
	readAgreement,
	readAgreements,
	readSalaryAudits,
	readSlipCount,
	readSlipForMonth,
	readTimelineVersion,
	readUseRows,
	runCommittedCommand,
	runSalaryCommandOn,
} from '../commands.ts';
import {
	beginContentionTransaction,
	lockPayrollRunRow,
	observeLockWait,
	withContentionConnections,
} from '../database.ts';
import {
	addMonths,
	allocateDraftRun,
	commandDate,
	dayBeforeMonth,
	dropFailureTrigger,
	installFailureTrigger,
} from '../fixture.ts';
import {
	abandonTransactions,
	commandContext,
	createInitialAgreement,
	withContentionScenario,
	type ContentionScenarioInput,
} from './context.ts';

/** One expected version accepts exactly one different-month mutation. */
export async function runSameVersionDifferentMonths(
	input: ContentionScenarioInput
): Promise<void> {
	await withContentionScenario(
		input,
		'same-version-different-months',
		async ({ db, runtime, fixture, setup }) => {
			const month = await allocateDraftRun(setup, fixture);
			const nextMonth = addMonths(month, 1);
			const now = commandDate(month);

			const initial = await createInitialAgreement(db, fixture, {
				effectiveFrom: month,
				now,
			});
			const revision = expectCommandOk(
				await runCommittedCommand(
					db,
					{
						operation: 'revise',
						employee_id: fixture.employeeId,
						agreement_id: initial.agreement_id,
						expected_timeline_version: 1,
						effective_from: nextMonth,
						employer_cost: 32_000,
						std_hours_per_day: 8,
					},
					commandContext(fixture, now)
				)
			);
			expect(revision.timeline_version).toBe(2);

			await withContentionConnections(runtime, async (open) => {
				const correction = await open();
				const cancellation = await open();
				const observer = await open();
				let cancellationPromise: Promise<SalaryCommandOutcome> | null = null;
				let settled = false;
				try {
					// Both commands carry expected version 2 for different months. The
					// correction wins the mutex; cancellation waits, then must conflict.
					await beginContentionTransaction(correction);
					expectCommandOk(
						await runSalaryCommandOn(
							correction,
							{
								operation: 'correct',
								employee_id: fixture.employeeId,
								agreement_id: initial.agreement_id,
								expected_timeline_version: 2,
								employer_cost: 35_000,
								std_hours_per_day: 8,
							},
							commandContext(fixture, now)
						)
					);

					const cancellationThread =
						await beginContentionTransaction(cancellation);
					cancellationPromise = runSalaryCommandOn(
						cancellation,
						{
							operation: 'cancel',
							employee_id: fixture.employeeId,
							agreement_id: revision.agreement_id,
							expected_timeline_version: 2,
							cancellation_reason: 'same-version contention loser',
						},
						commandContext(fixture, now)
					);
					const pendingCancellation = cancellationPromise;
					await observeLockWait(
						observer,
						cancellationThread,
						'cancellation waiting for the same Employee mutex'
					);

					await correction.commit();
					const stale = await pendingCancellation;
					expectCommandFailure(stale, 'stale_version');
					await cancellation.commit();
					settled = true;
				} finally {
					if (!settled) {
						await abandonTransactions(
							cancellationPromise,
							cancellation,
							correction,
							observer
						);
					}
				}
			});

			const agreements = await readAgreements(db, fixture.employeeId);
			expect(agreements).toHaveLength(2);
			const predecessor = agreements[0];
			const successor = agreements[1];
			expect(Number(predecessor.employer_cost)).toBe(35_000);
			expect(predecessor.effective_to).toBe(dayBeforeMonth(nextMonth));
			expect(Number(successor.employer_cost)).toBe(32_000);
			expect(Number(successor.is_active)).toBe(1);
			expect(successor.cancelled_at).toBeNull();
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create', 'revise', 'correct']);
			expect(await readUseRows(db, fixture.employeeId)).toHaveLength(0);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(3);

			// The loser's row is untouched, so cancellation can still be applied by a
			// caller that re-reads the version.
			const cancelled = expectCommandOk(
				await runCommittedCommand(
					db,
					{
						operation: 'cancel',
						employee_id: fixture.employeeId,
						agreement_id: revision.agreement_id,
						expected_timeline_version: 3,
						cancellation_reason: 'scheduled revision withdrawn',
					},
					commandContext(fixture, now)
				)
			);
			expect(cancelled.classification).toBe('cancelled');

			const afterCancel = await readAgreements(db, fixture.employeeId);
			expect(afterCancel[0]?.effective_to).toBeNull();
			expect(Number(afterCancel[1]?.is_active)).toBe(0);
			expect(afterCancel[1]?.cancelled_at).not.toBeNull();
			expect(afterCancel[1]?.cancelled_reason).toBe(
				'scheduled revision withdrawn'
			);
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create', 'revise', 'correct', 'cancel']);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(4);
		}
	);
}

/** Required audit and durable-use failures roll back their whole transaction. */
export async function runFailureRollback(
	input: ContentionScenarioInput
): Promise<void> {
	await withContentionScenario(
		input,
		'failure-rollback',
		async ({ db, runtime, fixture, setup }) => {
			const month = await allocateDraftRun(setup, fixture);
			const runId = fixture.runIds[0];
			const agreementStart = addMonths(month, -2);
			const now = commandDate(agreementStart);

			const initial = await createInitialAgreement(db, fixture, {
				effectiveFrom: agreementStart,
				now,
			});

			const correctionInput = {
				operation: 'correct' as const,
				employee_id: fixture.employeeId,
				agreement_id: initial.agreement_id,
				expected_timeline_version: 1,
				employer_cost: 45_000,
				std_hours_per_day: 8,
			};
			const auditTrigger = await installFailureTrigger(
				setup,
				fixture,
				'payroll_audit_logs',
				'audit'
			);
			await withContentionConnections(runtime, async (open) => {
				const correction = await open();
				try {
					await beginContentionTransaction(correction);
					await expect(
						runSalaryCommandOn(
							correction,
							correctionInput,
							commandContext(fixture, now)
						)
					).rejects.toThrow(/audit failure/);
					await correction.rollback();
				} finally {
					await abandonTransactions(null, correction);
				}
			});

			// The profile write and version advance were rolled back with the audit.
			expect(
				Number((await readAgreement(db, initial.agreement_id))?.employer_cost)
			).toBe(30_000);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(1);
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create']);

			await dropFailureTrigger(setup, fixture, auditTrigger);
			expectCommandOk(
				await runCommittedCommand(
					db,
					correctionInput,
					commandContext(fixture, now)
				)
			);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(2);

			const useTrigger = await installFailureTrigger(
				setup,
				fixture,
				'employee_salary_payroll_use',
				'use'
			);
			await withContentionConnections(runtime, async (open) => {
				const generation = await open();
				try {
					await beginContentionTransaction(generation);
					await lockPayrollRunRow(generation, runId);
					await expect(
						generateSlipOn(generation, fixture.employeeId, month, {
							payrollRunId: runId,
							actorId: fixture.actorId,
						})
					).rejects.toThrow(/use failure/);
					await generation.rollback();
				} finally {
					await abandonTransactions(null, generation);
				}
			});

			// The slip insert rolled back with the rejected use evidence.
			expect(await readSlipCount(db, fixture.employeeId)).toBe(0);
			expect(await readUseRows(db, fixture.employeeId)).toHaveLength(0);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(2);

			await dropFailureTrigger(setup, fixture, useTrigger);
			await withContentionConnections(runtime, async (open) => {
				const generation = await open();
				await beginContentionTransaction(generation);
				await lockPayrollRunRow(generation, runId);
				await generateSlipOn(generation, fixture.employeeId, month, {
					payrollRunId: runId,
					actorId: fixture.actorId,
				});
				await generation.commit();
			});

			const slip = await readSlipForMonth(db, fixture.employeeId, month);
			expect(slip).not.toBeNull();
			expect(Number(slip?.ctc_used)).toBe(45_000);
			expect(await readUseRows(db, fixture.employeeId)).toHaveLength(1);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(3);
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create', 'correct']);
		}
	);
}
