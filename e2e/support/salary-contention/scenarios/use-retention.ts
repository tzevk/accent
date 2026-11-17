/**
 * #446 durable-use retention and legacy-onboarding proof.
 */
import { expect } from '@playwright/test';
import { beginSalaryWriteTransaction } from '@/lib/salary-write-isolation';
import {
	deleteDraftSlip,
	expectCommandFailure,
	expectCommandOk,
	finalizeThenReopenRun,
	generateSlipOn,
	readAgreement,
	readAgreements,
	readRun,
	readSalaryAudits,
	readSlipCount,
	readSlipForMonth,
	readTimelineVersion,
	readUseRows,
	recordFinalizationUseOn,
	runCommittedCommand,
} from '../commands.ts';
import {
	beginContentionTransaction,
	lockPayrollRunRow,
	withContentionConnections,
} from '../database.ts';
import {
	addMonths,
	allocateDraftRun,
	commandDate,
	insertLegacyAgreement,
	readLegacyAgreement,
} from '../fixture.ts';
import {
	commandContext,
	createInitialAgreement,
	withContentionScenario,
	type ContentionScenarioInput,
} from './context.ts';

/** Slip deletion and run reopen cannot unlock a used future month. */
export async function runSlipDeletionReopen(
	input: ContentionScenarioInput
): Promise<void> {
	await withContentionScenario(
		input,
		'deletion-reopen-future-use',
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
				await beginContentionTransaction(generation);
				await lockPayrollRunRow(generation, runId);
				await generateSlipOn(generation, fixture.employeeId, month, {
					payrollRunId: runId,
					actorId: fixture.actorId,
				});
				await generation.commit();
			});

			// Finalization records the same durable identity; the already-recorded
			// generation use is idempotent, not duplicated.
			await beginSalaryWriteTransaction(db);
			try {
				const finalization = await recordFinalizationUseOn(
					db,
					initial.agreement_id,
					'employee_salary_profile',
					fixture.employeeId,
					month,
					runId,
					fixture.actorId
				);
				expect(finalization.recorded).toBe(false);
				expect(finalization.timeline_version).toBe(2);
				await db.commit();
			} catch (error) {
				await db.rollback();
				throw error;
			}

			const slip = await readSlipForMonth(db, fixture.employeeId, month);
			expect(slip).not.toBeNull();
			await deleteDraftSlip(db, Number(slip?.id));
			await finalizeThenReopenRun(db, runId, month, fixture.actorId);

			const reopened = await readRun(db, runId);
			expect(reopened?.status).toBe('draft');
			expect(reopened?.finalized_by).toBeNull();
			expect(reopened?.finalized_at).toBeNull();
			expect(await readSlipCount(db, fixture.employeeId)).toBe(0);

			const use = await readUseRows(db, fixture.employeeId);
			expect(use).toHaveLength(1);
			expect(use[0]?.evidence).toBe('payroll_generation');

			// The used month stays protected after both the draft slip and the
			// finalization state are gone.
			const correction = await runCommittedCommand(
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
			expectCommandFailure(correction, 'used');

			// A revision that would capture the future generated month from before it
			// is likewise refused; the recorded range and rows do not move.
			const revision = await runCommittedCommand(
				db,
				{
					operation: 'revise',
					employee_id: fixture.employeeId,
					agreement_id: initial.agreement_id,
					expected_timeline_version: 2,
					effective_from: addMonths(month, -1),
					employer_cost: 33_000,
					std_hours_per_day: 8,
				},
				commandContext(fixture, now)
			);
			expectCommandFailure(revision, 'protected');

			const agreements = await readAgreements(db, fixture.employeeId);
			expect(agreements).toHaveLength(1);
			expect(Number(agreements[0]?.employer_cost)).toBe(30_000);
			expect(agreements[0]?.effective_to).toBeNull();
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create']);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(2);
			expect(await readSlipCount(db, fixture.employeeId)).toBe(0);
		}
	);
}

/** Legacy-only onboarding cannot backdate a historical initial agreement. */
export async function runLegacyOnboarding(
	input: ContentionScenarioInput
): Promise<void> {
	await withContentionScenario(
		input,
		'legacy-onboarding',
		async ({ db, fixture, setup }) => {
			const month = await allocateDraftRun(setup, fixture);
			const legacyStart = addMonths(month, -6);
			const now = commandDate(month);
			const legacyId = await insertLegacyAgreement(
				setup,
				fixture,
				legacyStart,
				25_000
			);

			const backdated = await runCommittedCommand(
				db,
				{
					operation: 'create-initial',
					employee_id: fixture.employeeId,
					expected_timeline_version: 0,
					effective_from: addMonths(month, -1),
					employer_cost: 28_000,
					std_hours_per_day: 8,
					salary_type: 'monthly',
				},
				commandContext(fixture, now)
			);
			expectCommandFailure(backdated, 'earlier_month');
			expect(await readAgreements(db, fixture.employeeId)).toHaveLength(0);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(0);
			expect(await readSalaryAudits(db, fixture.employeeId)).toHaveLength(0);

			const created = expectCommandOk(
				await runCommittedCommand(
					db,
					{
						operation: 'create-initial',
						employee_id: fixture.employeeId,
						expected_timeline_version: 0,
						effective_from: month,
						employer_cost: 28_000,
						std_hours_per_day: 8,
						salary_type: 'monthly',
					},
					commandContext(fixture, now)
				)
			);
			expect(created.classification).toBe('current');

			const agreement = await readAgreement(db, created.agreement_id);
			expect(agreement?.effective_from).toBe(month);
			expect(Number(agreement?.employer_cost)).toBe(28_000);
			const legacy = await readLegacyAgreement(db, fixture.employeeId);
			expect(Number(legacy?.id)).toBe(legacyId);
			expect(Number(legacy?.is_active)).toBe(1);
			expect(Number(legacy?.ctc)).toBe(25_000);
			expect(
				(await readSalaryAudits(db, fixture.employeeId)).map(
					(row) => row.action
				)
			).toEqual(['create']);
			expect(await readTimelineVersion(db, fixture.employeeId)).toBe(1);
		}
	);
}
