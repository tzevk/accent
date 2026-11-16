/**
 * #446 lock-ordering proof: one Employee mutex, two real MariaDB sessions.
 *
 * Every salary-write transaction is started through the production
 * `beginSalaryWriteTransaction` protocol (READ COMMITTED), so the observed
 * waits are record-lock waits on the `employees` row — never shared
 * REPEATABLE READ gaps between independent Employees.
 */
import { expect } from '@playwright/test';
import type { SalaryCommandOutcome } from '@/lib/salary-profile-commands';
import {
	expectCommandFailure,
	expectCommandOk,
	generateSlipOn,
	readAgreement,
	readSalaryAudits,
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
import { addMonths, allocateDraftRun, commandDate } from '../fixture.ts';
import {
	abandonTransactions,
	commandContext,
	createInitialAgreement,
	withContentionScenario,
	type ContentionScenarioInput,
} from './context.ts';

/** A committed correction owns the mutex; the blocked generation prices it. */
export async function runCorrectionBeforeGeneration(
	input: ContentionScenarioInput
): Promise<void> {
	await withContentionScenario(
		input,
		'correction-before-generation',
		async ({ db, runtime, fixture, setup }) => {
			const month = await allocateDraftRun(setup, fixture);
			const runId = fixture.runIds[0];
			const agreementStart = addMonths(month, -2);
			const now = commandDate(agreementStart);

			const initial = await createInitialAgreement(db, fixture, {
				effectiveFrom: agreementStart,
				now,
			});
			expect(initial.timeline_version).toBe(1);

			await withContentionConnections(runtime, async (open) => {
				const correction = await open();
				const generation = await open();
				const observer = await open();
				let generationPromise: Promise<
					{ ok: true; value: unknown } | { ok: false; error: unknown }
				> | null = null;
				let settled = false;
				try {
					// The correction writes the new terms but keeps its Employee mutex.
					await beginContentionTransaction(correction);
					expectCommandOk(
						await runSalaryCommandOn(
							correction,
							{
								operation: 'correct',
								employee_id: fixture.employeeId,
								agreement_id: initial.agreement_id,
								expected_timeline_version: 1,
								employer_cost: 45_000,
								std_hours_per_day: 8,
							},
							commandContext(fixture, now)
						)
					);
					expect(
						Number(
							(await readAgreement(correction, initial.agreement_id))
								?.employer_cost
						)
					).toBe(45_000);

					// Generation takes the Payroll Run lock, then waits on that same
					// Employee row. The wait is observed in InnoDB, not assumed.
					const generationThread = await beginContentionTransaction(generation);
					await lockPayrollRunRow(generation, runId);
					generationPromise = generateSlipOn(
						generation,
						fixture.employeeId,
						month,
						{ payrollRunId: runId, actorId: fixture.actorId }
					).then(
						(value) => ({ ok: true as const, value }),
						(error: unknown) => ({ ok: false as const, error })
					);
					const pendingGeneration = generationPromise;
					await observeLockWait(
						observer,
						generationThread,
						'generation waiting for the correction mutex'
					);

					await correction.commit();
					const generated = await pendingGeneration;
					if (!generated.ok) throw generated.error;
					await generation.commit();
					settled = true;
				} finally {
					if (!settled) {
						await abandonTransactions(
							generationPromise,
							generation,
							correction,
							observer
						);
					}
				}
			});

			// Read committed state through the harness's independent connection.
			const slip = await readSlipForMonth(db, fixture.employeeId, month);
			expect(slip).not.toBeNull();
			expect(Number(slip?.ctc_used)).toBe(45_000);
			expect(Number(slip?.salary_profile_id)).toBe(initial.agreement_id);
			expect(slip?.salary_profile_source).toBe('employee_salary_profile');
			expect(slip?.salary_type).toBe('monthly');

			const agreement = await readAgreement(db, initial.agreement_id);
			expect(Number(agreement?.employer_cost)).toBe(45_000);

			const uses = await readUseRows(db, fixture.employeeId);
			expect(uses).toHaveLength(1);
			expect(uses[0]).toMatchObject({
				month,
				agreement_source: 'employee_salary_profile',
				evidence: 'payroll_generation',
			});
			expect(Number(uses[0]?.agreement_id)).toBe(initial.agreement_id);
			expect(Number(uses[0]?.first_used_by)).toBe(fixture.actorId);
			const context = uses[0]?.evidence_context;
			expect(
				typeof context === 'string' ? JSON.parse(context) : context
			).toMatchObject({
				payroll_run_id: runId,
			});

			const audits = await readSalaryAudits(db, fixture.employeeId);
			expect(audits.map((row) => row.action)).toEqual(['create', 'correct']);
			expect(
				audits.every((row) => Number(row.performed_by) === fixture.actorId)
			).toBe(true);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(3);
		}
	);
}

/** A committed generation use makes the blocked correction conflict. */
export async function runGenerationBeforeCorrection(
	input: ContentionScenarioInput
): Promise<void> {
	await withContentionScenario(
		input,
		'generation-before-correction',
		async ({ db, runtime, fixture, setup }) => {
			const month = await allocateDraftRun(setup, fixture);
			const runId = fixture.runIds[0];
			const agreementStart = addMonths(month, -2);
			const now = commandDate(agreementStart);

			const initial = await createInitialAgreement(db, fixture, {
				effectiveFrom: agreementStart,
				now,
			});

			await withContentionConnections(runtime, async (open) => {
				const generation = await open();
				const correction = await open();
				const observer = await open();
				let correctionPromise: Promise<SalaryCommandOutcome> | null = null;
				let settled = false;
				try {
					// Generation commits nothing yet: its slip and durable use exist only
					// inside this transaction while it holds the Employee mutex.
					await beginContentionTransaction(generation);
					await lockPayrollRunRow(generation, runId);
					await generateSlipOn(generation, fixture.employeeId, month, {
						payrollRunId: runId,
						actorId: fixture.actorId,
					});

					const correctionThread = await beginContentionTransaction(correction);
					correctionPromise = runSalaryCommandOn(
						correction,
						{
							operation: 'correct',
							employee_id: fixture.employeeId,
							agreement_id: initial.agreement_id,
							expected_timeline_version: 1,
							employer_cost: 45_000,
							std_hours_per_day: 8,
						},
						commandContext(fixture, now)
					);
					const pendingCorrection = correctionPromise;
					await observeLockWait(
						observer,
						correctionThread,
						'correction waiting for committed generation use'
					);

					await generation.commit();
					const stale = await pendingCorrection;
					expectCommandFailure(stale, 'stale_version');
					await correction.commit();
					settled = true;
				} finally {
					if (!settled) {
						await abandonTransactions(
							correctionPromise,
							correction,
							generation,
							observer
						);
					}
				}
			});

			// A fresh caller that has read the advanced version still cannot correct
			// the agreement payroll now names.
			const used = await runCommittedCommand(
				db,
				{
					operation: 'correct',
					employee_id: fixture.employeeId,
					agreement_id: initial.agreement_id,
					expected_timeline_version: 2,
					employer_cost: 45_000,
					std_hours_per_day: 8,
				},
				commandContext(fixture, now)
			);
			expectCommandFailure(used, 'used');

			const slip = await readSlipForMonth(db, fixture.employeeId, month);
			expect(slip).not.toBeNull();
			expect(Number(slip?.ctc_used)).toBe(30_000);
			expect(Number(slip?.salary_profile_id)).toBe(initial.agreement_id);
			expect(
				Number((await readAgreement(db, initial.agreement_id))?.employer_cost)
			).toBe(30_000);

			const uses = await readUseRows(db, fixture.employeeId);
			expect(uses).toHaveLength(1);
			expect(uses[0]?.evidence).toBe('payroll_generation');
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create']);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(2);
		}
	);
}
