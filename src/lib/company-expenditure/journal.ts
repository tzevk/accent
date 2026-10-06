/**
 * The append-only financial command journal, shared by every cost source.
 *
 * One row per accepted command, keyed `(cost_uid, version)`; the row carries
 * the actor, reason, evidence reference, and the financial snapshot the
 * command produced. `financial_cost_events.command` is an ENUM of the
 * past-tense journal vocabulary under STRICT_TRANS_TABLES — writing a raw
 * imperative command name would truncate and roll the transaction back, so
 * `JOURNAL_COMMAND` is the one translation between the two vocabularies.
 */

import type { SqlConnection } from './records';
import type { CostCommandName, CostJournalCommand } from './types';

/** Command API vocabulary → journal vocabulary (past tense). */
export const JOURNAL_COMMAND: Record<CostCommandName, CostJournalCommand> = {
	update: 'updated',
	submit: 'submitted',
	recognize: 'recognized',
	reject: 'rejected',
	cancel: 'cancelled',
};

export interface CostEventInput {
	costUid: string;
	/** Native store the row lives in, e.g. `expenses` or `petty_cash_expenses`. */
	sourceTable: string;
	/** Numeric row key in that store. */
	sourceId: number;
	version: number;
	command: CostJournalCommand;
	actorId: number | null;
	reason: string | null;
	evidenceReference: string | null;
	snapshot: Record<string, unknown>;
}

/** Append one journal row. The caller owns the transaction. */
export async function writeCostEvent(
	db: SqlConnection,
	entry: CostEventInput
): Promise<void> {
	await db.execute(
		`INSERT INTO financial_cost_events
       (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
        evidence_reference, snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			entry.costUid,
			entry.sourceTable,
			entry.sourceId,
			entry.version,
			entry.command,
			entry.actorId,
			entry.reason,
			entry.evidenceReference,
			JSON.stringify(entry.snapshot),
		]
	);
}
