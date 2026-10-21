import { dbConnect } from '@/utils/database';
import {
	LeadWorkflowError,
	requireDbTransaction,
	toNullableId,
	type DbConnection,
} from '@/server/leads/shared';
import { toIsoDateTime } from '@/server/leads/activity-rows';
import {
	describeCorrectionChanges,
	normalizeOccurredAt,
	parseCorrectionVersion,
	planLeadActivityCorrection,
	type LeadActivityCorrectionValues,
	type LeadCorrectionChange,
} from '@/lib/lead-corrections';
import {
	isLeadOutreachType,
	type LeadTimelineEntry,
} from '@/lib/lead-activities';

/**
 * The correction of a logged Lead activity (ticket #372).
 *
 * A correction says that a logged activity was recorded wrongly. The
 * activity row keeps its own history: the correction updates the values of
 * the row, appends the previous values, the reason, the actor of the
 * session, and the moment of the correction to `lead_activity_corrections`,
 * and moves the version of the row on. Nothing is erased, and the
 * corrected activity is still one activity in every total.
 *
 * Rules:
 * - The correction needs a reason, and a refused correction writes
 *   nothing at all.
 * - The version the editor saw is the concurrency token: a correction of
 *   an activity that moved on is refused with a conflict instead of
 *   overwriting the accepted correction.
 * - A correction is not new sales work: it never changes the stage of the
 *   Lead, never replays an automatic stage transition, and never asks for
 *   a dated next action.
 * - A correction never invents provenance: the author of the row and the
 *   outcome the original record did not have stay unknown.
 */

export interface CorrectLeadActivityInput {
	version: unknown;
	reason: unknown;
	activity_type?: unknown;
	call_outcome?: unknown;
	reply_confirmed?: unknown;
	occurred_at?: unknown;
	notes?: unknown;
}

/** One correction of one activity, as the interface reads it. */
export interface LeadActivityCorrection {
	id: number;
	activity_id: number;
	reason: string;
	previous_values: LeadActivityCorrectionValues;
	corrected_values: LeadActivityCorrectionValues;
	corrected_by: number | null;
	actor_name: string | null;
	corrected_at: string | null;
}

/** The current values of one activity, with its correction history. */
export interface LeadActivityCorrectionState {
	activity: {
		id: number;
		activity_type: string | null;
		status: string | null;
		call_outcome: string | null;
		reply_confirmed: boolean | null;
		occurred_at: string | null;
		notes: string | null;
		version: number;
	};
	corrections: LeadActivityCorrection[];
}

interface ActivityRow {
	id: number;
	activity_type: string | null;
	status: string | null;
	call_outcome: string | null;
	reply_confirmed: number | null;
	occurred_at: string | null;
	notes: string | null;
	version: number | null;
}

const EMPTY_VALUES: LeadActivityCorrectionValues = {
	activity_type: null,
	call_outcome: null,
	reply_confirmed: null,
	occurred_at: null,
	notes: null,
};

/** The stored values, read as the correction rules see them. */
function rowValues(row: {
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: number | null;
	occurred_at: string | null;
	notes: string | null;
}): LeadActivityCorrectionValues {
	return {
		activity_type: row.activity_type,
		call_outcome: row.call_outcome,
		reply_confirmed:
			row.reply_confirmed === null ? null : row.reply_confirmed === 1,
		occurred_at: normalizeOccurredAt(row.occurred_at),
		notes: row.notes,
	};
}

function parseValues(raw: unknown): LeadActivityCorrectionValues {
	if (typeof raw !== 'string' || raw.trim() === '') return { ...EMPTY_VALUES };
	try {
		const parsed = JSON.parse(raw) as Partial<LeadActivityCorrectionValues>;
		return {
			activity_type: parsed.activity_type ?? null,
			call_outcome: parsed.call_outcome ?? null,
			reply_confirmed:
				parsed.reply_confirmed === null || parsed.reply_confirmed === undefined
					? null
					: Boolean(parsed.reply_confirmed),
			occurred_at: parsed.occurred_at ?? null,
			notes: parsed.notes ?? null,
		};
	} catch {
		return { ...EMPTY_VALUES };
	}
}

/** The correction history of one activity, oldest first. */
async function readCorrections(
	db: DbConnection,
	activityId: number
): Promise<LeadActivityCorrection[]> {
	const [rows] = (await db.execute(
		`SELECT c.id, c.activity_id, c.previous_values, c.corrected_values,
              c.reason, c.corrected_by, c.corrected_at, u.full_name AS actor_name
        FROM lead_activity_corrections c
        LEFT JOIN users u ON u.id = c.corrected_by
        WHERE c.activity_id = ?
        ORDER BY c.id ASC`,
		[activityId]
	)) as unknown as [Record<string, unknown>[], unknown];
	return rows.map((row) => ({
		id: Number(row.id),
		activity_id: Number(row.activity_id),
		reason: String(row.reason),
		previous_values: parseValues(row.previous_values),
		corrected_values: parseValues(row.corrected_values),
		corrected_by: toNullableId(row.corrected_by),
		actor_name:
			row.actor_name === null || row.actor_name === undefined
				? null
				: String(row.actor_name),
		corrected_at: toIsoDateTime(row.corrected_at),
	}));
}

/** What the correction changed, in the words of the person who corrected it. */
function correctionDetail(
	reason: string,
	changes: LeadCorrectionChange[]
): string {
	const lines = [`Reason: ${reason}`];
	for (const change of changes) {
		lines.push(`${change.label}: ${change.from} → ${change.to}`);
	}
	return lines.join('\n');
}

/** The label of a correction: the kind of the activity it corrected. */
function correctionTitle(kind: string | null): string {
	return kind ? `${kind} corrected` : 'Activity corrected';
}

/**
 * Correct one logged Lead activity.
 *
 * The correction, the new values of the activity, and the new version of
 * the activity commit together or not at all.
 */
export async function correctLeadActivity(
	leadId: number,
	activityId: number,
	input: CorrectLeadActivityInput,
	actorUserId: number
): Promise<{ activity_id: number; version: number; corrected_at: string }> {
	const expectedVersion = parseCorrectionVersion(input.version);
	if (expectedVersion === null) {
		throw new LeadWorkflowError(
			'activity_invalid',
			'The version of the activity is required',
			422
		);
	}

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const [rows] = (await db.execute(
				`SELECT id, activity_type, status, call_outcome, reply_confirmed,
            occurred_at, notes, version
          FROM lead_activities
          WHERE id = ? AND lead_id = ? AND (isDelete = 0 OR isDelete IS NULL)
          FOR UPDATE`,
				[activityId, leadId]
			)) as unknown as [ActivityRow[], unknown];
			const activity = rows[0];
			if (!activity) {
				throw new LeadWorkflowError(
					'activity_not_found',
					'Lead activity not found',
					404
				);
			}

			const currentVersion = Number(activity.version ?? 1);
			if (currentVersion !== expectedVersion) {
				throw new LeadWorkflowError(
					'correction_conflict',
					'This activity was corrected by someone else. Reload it and apply your correction to the current values.',
					409
				);
			}

			const [leadRows] = (await db.execute(
				'SELECT id, owner_user_id FROM leads WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL) FOR UPDATE',
				[leadId]
			)) as unknown as [
				{ id: number; owner_user_id: number | null }[],
				unknown,
			];
			const lead = leadRows[0];
			if (!lead) {
				throw new LeadWorkflowError('not_found', 'Lead not found', 404);
			}

			const plan = planLeadActivityCorrection(rowValues(activity), input);
			if (!plan.ok) {
				throw new LeadWorkflowError(plan.code, plan.message, 422);
			}

			// A correction is not new sales work, but it may not turn a
			// record into outreach on a Lead nobody owns.
			const wasOutreach = isLeadOutreachType(plan.previous.activity_type);
			const isOutreach = isLeadOutreachType(plan.corrected.activity_type);
			if (
				isOutreach &&
				!wasOutreach &&
				toNullableId(lead.owner_user_id) === null
			) {
				throw new LeadWorkflowError(
					'owner_required',
					'Outreach needs a lead owner',
					409
				);
			}

			const [updateResult] = (await db.execute(
				`UPDATE lead_activities
          SET activity_type = ?, call_outcome = ?, reply_confirmed = ?,
              occurred_at = ?, notes = ?, version = version + 1, updated_at = NOW()
          WHERE id = ? AND lead_id = ? AND version = ?`,
				[
					plan.corrected.activity_type,
					plan.corrected.call_outcome,
					plan.corrected.reply_confirmed === null
						? null
						: plan.corrected.reply_confirmed
							? 1
							: 0,
					plan.corrected.occurred_at === null
						? null
						: plan.corrected.occurred_at.replace('T', ' '),
					plan.corrected.notes,
					activityId,
					leadId,
					expectedVersion,
				]
			)) as unknown as [{ affectedRows: number }, unknown];
			if (Number(updateResult?.affectedRows ?? 0) !== 1) {
				throw new LeadWorkflowError(
					'correction_conflict',
					'This activity was corrected by someone else. Reload it and apply your correction to the current values.',
					409
				);
			}

			const [insertResult] = (await db.execute(
				`INSERT INTO lead_activity_corrections (
          activity_id, lead_id, previous_values, corrected_values, reason,
          corrected_by, corrected_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
				[
					activityId,
					leadId,
					JSON.stringify(plan.previous),
					JSON.stringify(plan.corrected),
					plan.reason,
					actorUserId,
				]
			)) as unknown as [{ insertId: number }, unknown];
			const correctionId = Number(insertResult?.insertId ?? 0);

			const [timeRows] = (await db.execute(
				'SELECT corrected_at FROM lead_activity_corrections WHERE id = ? LIMIT 1',
				[correctionId]
			)) as unknown as [{ corrected_at: string | null }[], unknown];
			const correctedAt = toIsoDateTime(timeRows[0]?.corrected_at);

			await tx.commit();
			return {
				activity_id: activityId,
				version: expectedVersion + 1,
				corrected_at: correctedAt ?? '',
			};
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	} finally {
		db.release?.();
	}
}

/**
 * The current values of one activity and the corrections it has: the
 * interface shows the operator what the activity says now and what it said
 * before every correction.
 */
export async function getLeadActivityCorrectionState(
	leadId: number,
	activityId: number
): Promise<LeadActivityCorrectionState> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const [rows] = (await db.execute(
			`SELECT id, activity_type, status, call_outcome, reply_confirmed,
              occurred_at, notes, version
          FROM lead_activities
          WHERE id = ? AND lead_id = ? AND (isDelete = 0 OR isDelete IS NULL)
          LIMIT 1`,
			[activityId, leadId]
		)) as unknown as [ActivityRow[], unknown];
		const activity = rows[0];
		if (!activity) {
			throw new LeadWorkflowError(
				'activity_not_found',
				'Lead activity not found',
				404
			);
		}
		const corrections = await readCorrections(db, activityId);
		return {
			activity: {
				id: activity.id,
				activity_type: activity.activity_type,
				status: activity.status,
				call_outcome: activity.call_outcome,
				reply_confirmed:
					activity.reply_confirmed === null
						? null
						: activity.reply_confirmed === 1,
				occurred_at: normalizeOccurredAt(activity.occurred_at),
				notes: activity.notes,
				version: Number(activity.version ?? 1),
			},
			corrections,
		};
	} finally {
		db.release?.();
	}
}

/**
 * The corrections of one Lead as timeline entries: the reason, the values
 * before the correction, the values after it, the actor, and the moment.
 * A corrected activity stays one activity: the correction is its own
 * entry, never a second completed activity.
 */
export async function getLeadCorrectionEntries(
	db: DbConnection,
	leadId: number
): Promise<LeadTimelineEntry[]> {
	const [rows] = (await db.execute(
		`SELECT c.id, c.previous_values, c.corrected_values, c.reason,
              c.corrected_at, u.full_name AS actor_name
        FROM lead_activity_corrections c
        LEFT JOIN users u ON u.id = c.corrected_by
        WHERE c.lead_id = ?
        ORDER BY c.id ASC`,
		[leadId]
	)) as unknown as [Record<string, unknown>[], unknown];
	return rows.map((row) => {
		const previous = parseValues(row.previous_values);
		const corrected = parseValues(row.corrected_values);
		const changes = describeCorrectionChanges(previous, corrected);
		const correctedAt = toIsoDateTime(row.corrected_at);
		const actorName =
			row.actor_name === null || row.actor_name === undefined
				? null
				: String(row.actor_name);
		return {
			key: `correction:${String(row.id)}`,
			kind: 'correction',
			occurred_at: correctedAt,
			recorded_at: correctedAt,
			title: correctionTitle(corrected.activity_type),
			detail: correctionDetail(String(row.reason), changes),
			actor_name: actorName,
			status: null,
			activity_type: null,
			call_outcome: null,
			legacy: actorName === null,
		};
	});
}
