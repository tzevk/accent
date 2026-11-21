/**
 * Finalization roster save versus an unrelated fixture teardown.
 *
 * CI's roster INSERT failed with ER_LOCK_DEADLOCK just after a parallel
 * payroll-run fixture cleaned up. That teardown (REPEATABLE READ) first deletes
 * its empty roster row, taking the `payroll_run_rosters` unique-index gap, then
 * deletes its own Employee Salary Profile. A finalizer already holds that
 * profile record lock and its roster INSERT needs the gap, so InnoDB rolls one
 * side back. A READ COMMITTED teardown (the salary-write protocol) takes no gap
 * and both commit. Until `cleanupPayrollRows` starts through
 * `beginSalaryWriteTransaction`, this scenario fails with the exact CI error.
 */
import { expect } from '@playwright/test';
import type { Connection } from 'mysql2/promise';
import {
	loadPayrollRunRoster,
	savePayrollRunRoster,
} from '@/lib/payroll-run-roster';
import { beginSalaryWriteTransaction } from '@/lib/salary-write-isolation';
import {
	readPayrollRunState,
	seedPayrollRunFixture,
	type PayrollOperationsFixture,
} from '../../../fixtures/payroll-operations.ts';
import { withContentionConnections } from '../database.ts';
import type { ContentionScenarioInput } from './context.ts';

/**
 * Wrap the fixture's own connection verbatim and resolve when its cleanup
 * issues the Employee-profile DELETE. The earlier empty roster DELETE has
 * returned by then, so its REPEATABLE READ gap is already held.
 */
function gateTeardown(connection: Connection) {
	const originalExecute = connection.execute.bind(connection);
	const issued = Promise.withResolvers<void>();
	let armed = false;
	const gated = new Proxy(connection, {
		get(target, property) {
			if (property === 'execute') {
				return ((sql: string, values?: unknown) => {
					if (armed && sql.startsWith('DELETE FROM employee_salary_profile ')) {
						armed = false;
						issued.resolve();
					}
					return originalExecute(sql, values as never);
				}) as Connection['execute'];
			}
			const value = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as Connection;
	return {
		connection: gated,
		profileDeleteIssued: issued.promise,
		arm: () => {
			armed = true;
		},
	};
}

/**
 * Prove the finalization roster write and an unrelated fixture teardown cannot
 * deadlock. Both consumers are awaited even when the current teardown protocol
 * makes one of them fail.
 */
export async function runFinalizeAgainstFixtureTeardown({
	db,
	runtime,
	namespace,
}: ContentionScenarioInput): Promise<void> {
	await withContentionConnections(runtime, async (open) => {
		const finalizer = await open();
		const gate = gateTeardown(await open());
		let draft: PayrollOperationsFixture | null = null;
		let teardown: PayrollOperationsFixture | null = null;
		let disposal: Promise<unknown> | null = null;
		let committed = false;

		try {
			draft = await seedPayrollRunFixture(
				await open(),
				`${namespace}-finalize`,
				{ status: 'draft' }
			);
			// Seed through the gated connection: the fixture's real dispose()
			// closure captured it.
			teardown = await seedPayrollRunFixture(
				gate.connection,
				`${namespace}-teardown`,
				{ status: 'finalized' }
			);
			const draftFixture = draft;
			const teardownFixture = teardown;
			const operator = draftFixture.operator;

			await beginSalaryWriteTransaction(finalizer);
			try {
				await finalizer.execute(
					'SELECT id FROM payroll_runs WHERE id = ? FOR UPDATE',
					[draftFixture.run.id]
				);
				// The production read locks every non-deleted Employee/profile,
				// including the unrelated fixture's Employee.
				const roster = await loadPayrollRunRoster(
					finalizer,
					draftFixture.run.month,
					{ forUpdate: true }
				);
				expect(roster.members.map((member) => member.employee_id)).toEqual([
					draftFixture.employee.employeeId,
				]);
				await finalizer.execute(
					`UPDATE payroll_runs
              SET status = 'finalized', finalized_by = ?, finalized_at = NOW()
            WHERE id = ? AND status = 'draft'`,
					[operator.userId, draftFixture.run.id]
				);

				// The teardown target is a real finalized fixture with no saved
				// roster. Arm only now, after the finalizer owns the locks.
				gate.arm();
				disposal = teardownFixture.dispose().then(
					() => null,
					(error: unknown) => error
				);
				await Promise.race([
					gate.profileDeleteIssued,
					disposal.then((error) => {
						throw (
							error ??
							new Error(
								'[payroll-finalize-contention] teardown finished before issuing its Employee-profile DELETE'
							)
						);
					}),
				]);

				let finalizeError: unknown = null;
				try {
					await savePayrollRunRoster(
						finalizer,
						draftFixture.run.id,
						roster,
						operator.userId
					);
					await finalizer.commit();
					committed = true;
				} catch (error) {
					finalizeError = error;
				}
				const teardownError = disposal === null ? null : await disposal;
				if (finalizeError !== null || teardownError !== null) {
					throw finalizeError ?? teardownError;
				}

				// Both committed: prove the snapshot and the teardown landed through
				// the independent worker reader, not the contended connections.
				const finalized = await readPayrollRunState(db, draftFixture);
				expect(finalized.run).toMatchObject({
					id: draftFixture.run.id,
					status: 'finalized',
					finalizedBy: operator.userId,
				});
				expect(finalized.rosters).toHaveLength(1);
				expect(finalized.rosters[0]).toMatchObject({
					runId: draftFixture.run.id,
					month: draftFixture.run.month,
					version: 1,
					frozenBy: operator.userId,
				});
				expect(
					finalized.rosters[0]?.members.map((member) => member.employee_id)
				).toEqual([draftFixture.employee.employeeId]);

				const removed = await readPayrollRunState(db, teardownFixture);
				expect(removed).toMatchObject({
					run: null,
					slips: [],
					rosters: [],
				});
			} finally {
				if (!committed) {
					await finalizer.rollback().catch(() => undefined);
				}
			}
		} finally {
			// Settle both consumers before retrying fixture cleanup: an InnoDB
			// victim has rolled its transaction back, so the retry removes its rows.
			if (disposal !== null) await disposal.catch(() => undefined);
			if (teardown !== null) await teardown.dispose().catch(() => undefined);
			if (draft !== null) await draft.dispose().catch(() => undefined);
		}
	});
}
