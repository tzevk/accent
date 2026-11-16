/**
 * Shared lifecycle for the #446 salary-contention scenarios.
 *
 * Each scenario owns exactly one namespaced Employee fixture and a dedicated
 * autocommit connection for that fixture's rows and triggers. The Playwright
 * worker's `db` fixture stays the independent committed-state reader, so a
 * failed contention attempt can never close the connection cleanup needs.
 */
import type { Connection } from 'mysql2/promise';
import type { E2ERuntime } from '../../../../scripts/e2e/contracts.ts';
import { expectCommandOk, runCommittedCommand } from '../commands.ts';
import type {
	SalaryCommandInput,
	SalaryCommandSuccess,
} from '@/lib/salary-profile-commands';
import { connectContentionConnection } from '../database.ts';
import {
	cleanupSalaryContentionFixture,
	contentionKey,
	seedSalaryContentionFixture,
	type SalaryContentionFixture,
} from '../fixture.ts';

export interface ContentionScenarioInput {
	/** Independent worker reader for committed state. */
	readonly db: Connection;
	readonly runtime: E2ERuntime;
	readonly namespace: string;
}

export interface ContentionScenario extends ContentionScenarioInput {
	readonly fixture: SalaryContentionFixture;
	/** Owned autocommit connection for fixture rows, triggers and cleanup. */
	readonly setup: Connection;
}

export function commandContext(
	fixture: SalaryContentionFixture,
	now: string
): { actorId: number; now: string } {
	return { actorId: fixture.actorId, now };
}

/**
 * Run one scenario inside its owned fixture. Cleanup always runs; when the
 * scenario and cleanup both fail, both messages are reported (cleanup never
 * masks the test's own assertion failure).
 */
export async function withContentionScenario(
	input: ContentionScenarioInput,
	title: string,
	run: (scenario: ContentionScenario) => Promise<void>
): Promise<void> {
	const setup = await connectContentionConnection(input.runtime);
	let fixture: SalaryContentionFixture | null = null;
	let failure: unknown = null;
	try {
		try {
			fixture = await seedSalaryContentionFixture(
				setup,
				contentionKey(input.namespace, title)
			);
			await run({ ...input, fixture, setup });
		} catch (error) {
			failure = error;
		}
		if (fixture !== null) {
			try {
				await cleanupSalaryContentionFixture(setup, fixture);
			} catch (error) {
				if (failure === null) throw error;
				throw new Error(
					`${
						failure instanceof Error ? failure.message : String(failure)
					}\n[salary-contention] cleanup also failed: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		}
		if (failure !== null) throw failure;
	} finally {
		try {
			await setup.end();
		} catch {
			setup.destroy();
		}
	}
}

/**
 * Release the contended locks and settle a command that was started but never
 * awaited. Call from a scenario's `finally` before the connection pool closes
 * them, so a failed barrier cannot leave an in-flight statement behind.
 */
export async function abandonTransactions(
	pending: Promise<unknown> | null,
	...connections: Connection[]
): Promise<void> {
	// Issue every rollback before awaiting any: a connection that is still
	// blocked waits for a lock held by another connection in this list, so
	// awaiting in order could wait on the lock it was about to release.
	const rollbacks = connections.map((connection) =>
		connection.rollback().catch(() => undefined)
	);
	await Promise.all(rollbacks);
	if (pending !== null) await pending.catch(() => undefined);
}

/** Run the committed create-initial used by most scenarios. */
export async function createInitialAgreement(
	db: Connection,
	fixture: SalaryContentionFixture,
	input: {
		effectiveFrom: string;
		now: string;
		employerCost?: number;
		includePayrollSettings?: boolean;
	}
): Promise<SalaryCommandSuccess> {
	const command: SalaryCommandInput = {
		operation: 'create-initial',
		employee_id: fixture.employeeId,
		expected_timeline_version: 0,
		effective_from: input.effectiveFrom,
		employer_cost: input.employerCost ?? 30_000,
		std_hours_per_day: 8,
		...(input.includePayrollSettings === false
			? {}
			: { salary_type: 'monthly', pl_total: 20 }),
	};
	return expectCommandOk(
		await runCommittedCommand(db, command, commandContext(fixture, input.now))
	);
}
