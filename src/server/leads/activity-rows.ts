import type { DbConnection } from '@/server/leads/shared';

/**
 * The row-level primitives of the Lead activity log (ticket #371).
 *
 * One place writes `lead_activities` and one place keeps the
 * `leads.follow_up_date` mirror honest, so the workflow module and the
 * activity module can never disagree about what the Lead's outstanding work
 * is. Every function here runs inside the caller's transaction: the activity
 * row, the next-action row, the stage change, and the stage history commit
 * together or not at all.
 */

/** A scheduled next action that is still outstanding. */
export interface LeadNextAction {
	scheduled_for: string;
	activity_type: string | null;
}

export interface ActivityRowInput {
	leadId: number;
	activityType: string | null;
	status: 'Scheduled' | 'Completed' | 'Cancelled';
	callOutcome?: string | null;
	replyConfirmed?: boolean | null;
	scheduledFor?: string | null;
	occurredAt?: string | null;
	completedAt?: string | null;
	nextAction?: string | null;
	notes?: string | null;
	createdBy: number | null;
}

/**
 * A MySQL DATETIME literal in the local time of the server, so the value
 * that is written and the value that is read back are the same moment.
 */
export function toMysqlDateTime(date: Date): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	return (
		`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
		`${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
	);
}

/** The ISO shape of a stored date-time; null when the moment is unknown. */
export function toIsoDateTime(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.toISOString();
	const text = String(value).trim();
	if (text === '') return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T00:00:00`;
	return text.replace(' ', 'T');
}

/** One row of the Lead activity log. */
export async function insertActivityRow(
	db: DbConnection,
	input: ActivityRowInput
): Promise<number> {
	const [result] = (await db.execute(
		`INSERT INTO lead_activities (
        lead_id, activity_type, status, call_outcome, reply_confirmed,
        scheduled_for, occurred_at, completed_at, next_action, notes,
        created_by, recorded_at, created_at, updated_at, isDelete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), 0)`,
		[
			input.leadId,
			input.activityType,
			input.status,
			input.callOutcome ?? null,
			input.replyConfirmed === null || input.replyConfirmed === undefined
				? null
				: input.replyConfirmed
					? 1
					: 0,
			input.scheduledFor ?? null,
			input.occurredAt ?? null,
			input.completedAt ?? null,
			input.nextAction ?? null,
			input.notes ?? null,
			input.createdBy,
		]
	)) as unknown as [{ insertId: number }, unknown];
	return result.insertId;
}

/**
 * The Lead's outstanding dated next action: the earliest scheduled row that
 * was neither completed, cancelled, nor transferred away.
 */
export async function earliestNextAction(
	db: DbConnection,
	leadId: number
): Promise<LeadNextAction | null> {
	const [rows] = (await db.execute(
		`SELECT scheduled_for, activity_type
      FROM lead_activities
      WHERE lead_id = ?
        AND status = 'Scheduled'
        AND transferred_followup_id IS NULL
        AND scheduled_for IS NOT NULL
        AND (isDelete = 0 OR isDelete IS NULL)
      ORDER BY scheduled_for ASC, id ASC
      LIMIT 1`,
		[leadId]
	)) as unknown as [
		{ scheduled_for: string; activity_type: string | null }[],
		unknown,
	];
	const row = rows[0];
	if (!row) return null;
	return {
		scheduled_for: String(row.scheduled_for).slice(0, 10),
		activity_type: row.activity_type ?? null,
	};
}

/**
 * `leads.follow_up_date` is the mirror of the Lead's outstanding work: the
 * earliest scheduled date, or NULL when the Lead has none. The mirror is
 * recomputed after every write that changes the outstanding work.
 */
export async function syncFollowUpDateMirror(
	db: DbConnection,
	leadId: number
): Promise<string | null> {
	const next = await earliestNextAction(db, leadId);
	await db.execute(
		'UPDATE leads SET follow_up_date = ?, updated_at = NOW() WHERE id = ?',
		[next ? next.scheduled_for : null, leadId]
	);
	return next ? next.scheduled_for : null;
}

/**
 * The Lead's dated next action as the Lead edit form writes it: the earliest
 * outstanding scheduled row moves to the requested date, a Lead without
 * outstanding work gets one scheduled row, and clearing the date cancels the
 * outstanding work that is no longer planned.
 */
export async function writeLeadNextAction(
	db: DbConnection,
	leadId: number,
	scheduledFor: string | null,
	actorUserId: number | null,
	notes: string | null = null
): Promise<void> {
	if (scheduledFor === null) {
		await db.execute(
			`UPDATE lead_activities
        SET status = 'Cancelled', completed_at = NOW(), updated_at = NOW()
        WHERE lead_id = ?
          AND status = 'Scheduled'
          AND transferred_followup_id IS NULL
          AND (isDelete = 0 OR isDelete IS NULL)`,
			[leadId]
		);
		return;
	}
	const current = await earliestNextAction(db, leadId);
	if (current) {
		await db.execute(
			`UPDATE lead_activities
        SET scheduled_for = ?, updated_at = NOW()
        WHERE lead_id = ?
          AND status = 'Scheduled'
          AND transferred_followup_id IS NULL
          AND scheduled_for IS NOT NULL
          AND (isDelete = 0 OR isDelete IS NULL)
        ORDER BY scheduled_for ASC, id ASC
        LIMIT 1`,
			[scheduledFor, leadId]
		);
		return;
	}
	await insertActivityRow(db, {
		leadId,
		activityType: 'Note',
		status: 'Scheduled',
		scheduledFor,
		nextAction: 'Next follow-up',
		notes,
		createdBy: actorUserId,
	});
}
