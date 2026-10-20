import { dbConnect } from '@/utils/database';
import {
	isLeadActivityType,
	isLeadCallOutcome,
	isLeadWorkStatus,
	type LeadActivityType,
	type LeadCallOutcome,
	type LeadTimelineEntry,
	type LeadWorkSummary,
	type LeadWorkStatus,
} from '@/lib/lead-activities';
import { resolveAutomaticStage } from '@/lib/lead-stage-transitions';
import { isActiveLeadStage, type LeadStage } from '@/lib/lead-stages';
import {
	LeadWorkflowError,
	normalizeDate,
	recordStageChange,
	requireDbTransaction,
	resolveCanonicalStage,
	toNullableId,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';
import {
	earliestNextAction,
	insertActivityRow,
	syncFollowUpDateMirror,
	toIsoDateTime,
	toMysqlDateTime,
} from '@/server/leads/activity-rows';
import { getLeadCorrectionEntries } from '@/server/leads/corrections';

/**
 * The Lead activity log (ticket #371).
 *
 * One cohesive module for the manual work a Lead accumulates: the calls,
 * emails, meetings, and notes a person records, the dated next actions, and
 * the chronological timeline. The stage of a Lead is never decided here: the
 * module asks the pure rule in `@/lib/lead-stage-transitions` and writes the
 * stage history row itself.
 *
 * Every write is one transaction. The activity row, the next-action row, the
 * automatic stage change, and the stage history commit together or not at
 * all: a refused write leaves no trace, and a successful write never leaves
 * a Lead with an activity it cannot explain.
 *
 * Rules:
 * - The actor comes from the authenticated session, never from the body.
 * - Outreach (call, email, meeting) needs an owner.
 * - A converted Lead takes no new sales work.
 * - `Attempting Contact`, `Connected`, `Qualified`, and `Nurture` need a
 *   dated next action; the check runs against the stage the Lead would have
 *   after the write.
 */

export interface LogLeadActivityInput {
	activity_type: unknown;
	call_outcome?: unknown;
	reply_confirmed?: unknown;
	occurred_at?: unknown;
	notes?: unknown;
	next_action?: unknown;
}

export interface ScheduleLeadTaskInput {
	activity_type?: unknown;
	scheduled_for: unknown;
	next_action?: unknown;
	notes?: unknown;
}

export interface UpdateLeadTaskInput {
	status: unknown;
	call_outcome?: unknown;
	reply_confirmed?: unknown;
	occurred_at?: unknown;
	notes?: unknown;
	next_action?: unknown;
}

interface LeadState {
	id: number;
	ownerUserId: number | null;
	stage: LeadStage | null;
}

interface NextActionInput {
	activityType: LeadActivityType;
	scheduledFor: string;
	nextAction: string | null;
	notes: string | null;
}

const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

/**
 * A calendar date without a time zone: the stored `YYYY-MM-DD` is rendered
 * as it was written, never shifted into the previous day.
 */
function formatCalendarDate(value: string | null): string | null {
	if (!value) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (!match) return value;
	const month = MONTH_LABELS[Number(match[2]) - 1] ?? match[2];
	return `${Number(match[3])} ${month} ${match[1]}`;
}

function parseActivityType(value: unknown): LeadActivityType {
	if (!isLeadActivityType(value)) {
		throw new LeadWorkflowError(
			'activity_type_invalid',
			'Activity type must be Call, Email, Meeting, or Note',
			422
		);
	}
	return value;
}

/**
 * The call outcome of an activity. A call needs one of the canonical
 * outcomes; a row of unknown kind (a migrated legacy row) may carry one but
 * is never asked for it; any other kind never carries one.
 */
function parseCallOutcome(
	activityType: LeadActivityType | null,
	value: unknown
): LeadCallOutcome | null {
	if (activityType === 'Call') {
		if (!isLeadCallOutcome(value)) {
			throw new LeadWorkflowError(
				'activity_outcome_invalid',
				'A call needs one of the canonical call outcomes',
				422
			);
		}
		return value;
	}
	if (value === undefined || value === null || value === '') return null;
	if (!isLeadCallOutcome(value)) {
		throw new LeadWorkflowError(
			'activity_outcome_invalid',
			'A call outcome must be one of the canonical call outcomes',
			422
		);
	}
	if (activityType !== null) {
		throw new LeadWorkflowError(
			'activity_outcome_invalid',
			'A call outcome applies to call activities only',
			422
		);
	}
	return value;
}

/**
 * Whether the client answered the email. Only an email carries it; a row of
 * unknown kind may carry it, every other kind never does.
 */
function parseReplyConfirmed(
	activityType: LeadActivityType | null,
	value: unknown
): boolean | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'boolean') {
		throw new LeadWorkflowError(
			'activity_invalid',
			'reply_confirmed must be true or false',
			422
		);
	}
	if (activityType !== null && activityType !== 'Email') {
		throw new LeadWorkflowError(
			'activity_invalid',
			'reply_confirmed applies to email activities only',
			422
		);
	}
	return value;
}

function parseOccurredAt(value: unknown): Date | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string') {
		throw new LeadWorkflowError(
			'activity_invalid',
			'occurred_at must be an ISO date-time',
			422
		);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new LeadWorkflowError(
			'activity_invalid',
			'occurred_at must be an ISO date-time',
			422
		);
	}
	return parsed;
}

function parseScheduledDate(value: unknown, field: string): string {
	const text = trimOrNull(value);
	if (!text) {
		throw new LeadWorkflowError(
			'activity_invalid',
			`${field} is required`,
			422
		);
	}
	const normalized = normalizeDate(text);
	if (!normalized) {
		throw new LeadWorkflowError(
			'activity_invalid',
			`${field} must be a date`,
			422
		);
	}
	return normalized;
}

function parseNextAction(value: unknown): NextActionInput | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new LeadWorkflowError(
			'activity_invalid',
			'next_action must be an object with a scheduled_for date',
			422
		);
	}
	const raw = value as Record<string, unknown>;
	const activityType =
		raw.activity_type === undefined || raw.activity_type === null
			? 'Note'
			: parseActivityType(raw.activity_type);
	return {
		activityType,
		scheduledFor: parseScheduledDate(
			raw.scheduled_for,
			'next_action.scheduled_for'
		),
		nextAction: trimOrNull(raw.next_action),
		notes: trimOrNull(raw.notes),
	};
}

async function loadLead(db: DbConnection, leadId: number): Promise<LeadState> {
	const [rows] = (await db.execute(
		`SELECT id, owner_user_id, enquiry_status
      FROM leads
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)
      FOR UPDATE`,
		[leadId]
	)) as unknown as [
		{
			id: number;
			owner_user_id: number | null;
			enquiry_status: string | null;
		}[],
		unknown,
	];
	const row = rows[0];
	if (!row) {
		throw new LeadWorkflowError('not_found', 'Lead not found', 404);
	}
	return {
		id: row.id,
		ownerUserId: toNullableId(row.owner_user_id),
		stage: resolveCanonicalStage(row.enquiry_status),
	};
}

/** A converted Lead continues through its Proposal, not through new sales work. */
function assertLeadAcceptsSalesWork(lead: LeadState): void {
	if (lead.stage === 'Converted') {
		throw new LeadWorkflowError(
			'lead_converted',
			'This lead is converted; new sales work belongs to the linked proposal',
			409
		);
	}
}

/** Outreach needs an owner: unowned intake does not accumulate sales work. */
function assertOwnerForOutreach(lead: LeadState, kind: string | null): void {
	if (kind === null) return;
	if (kind !== 'Call' && kind !== 'Email' && kind !== 'Meeting') return;
	if (lead.ownerUserId === null) {
		throw new LeadWorkflowError(
			'owner_required',
			'Outreach needs a lead owner',
			409
		);
	}
}

/**
 * An active Lead needs a dated next action. The check runs against the
 * stage the Lead has after the write, so the first outreach on a new Lead
 * needs the next action too.
 */
async function assertNextActionPresent(
	db: DbConnection,
	leadId: number,
	stage: LeadStage | null
): Promise<void> {
	if (!isActiveLeadStage(stage)) return;
	const next = await earliestNextAction(db, leadId);
	if (!next) {
		throw new LeadWorkflowError(
			'next_action_required',
			`${stage} leads require a dated next action`,
			409
		);
	}
}

/**
 * Record one manual activity: a call, an email, a meeting, or a note, with
 * the dated next action it schedules in the same interaction.
 */
export async function logLeadActivity(
	leadId: number,
	input: LogLeadActivityInput,
	actorUserId: number
): Promise<{
	activity_id: number;
	stage: LeadStage | null;
	next_action_date: string | null;
}> {
	const activityType = parseActivityType(input.activity_type);
	const callOutcome = parseCallOutcome(activityType, input.call_outcome);
	const replyConfirmed = parseReplyConfirmed(
		activityType,
		input.reply_confirmed
	);
	const occurredAt = parseOccurredAt(input.occurred_at);
	const notes = trimOrNull(input.notes);
	const nextAction = parseNextAction(input.next_action);

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const lead = await loadLead(db, leadId);
			assertLeadAcceptsSalesWork(lead);
			assertOwnerForOutreach(lead, activityType);

			const activityId = await insertActivityRow(db, {
				leadId,
				activityType,
				status: 'Completed',
				callOutcome,
				replyConfirmed,
				occurredAt: occurredAt
					? toMysqlDateTime(occurredAt)
					: toMysqlDateTime(new Date()),
				completedAt: toMysqlDateTime(new Date()),
				notes,
				createdBy: actorUserId,
			});

			if (nextAction) {
				await insertActivityRow(db, {
					leadId,
					activityType: nextAction.activityType,
					status: 'Scheduled',
					scheduledFor: nextAction.scheduledFor,
					nextAction: nextAction.nextAction,
					notes: nextAction.notes,
					createdBy: actorUserId,
				});
			}

			const nextStage = resolveAutomaticStage({
				currentStage: lead.stage,
				activityType,
				callOutcome,
				replyConfirmed,
			});
			const stageAfterWrite = nextStage ?? lead.stage;
			await assertNextActionPresent(db, leadId, stageAfterWrite);

			if (nextStage && nextStage !== lead.stage) {
				await db.execute(
					'UPDATE leads SET enquiry_status = ?, updated_at = NOW() WHERE id = ?',
					[nextStage, leadId]
				);
				await recordStageChange(db, {
					leadId,
					fromStage: lead.stage,
					toStage: nextStage,
					changeSource: 'automatic',
					reason: automaticStageReason(
						activityType,
						callOutcome,
						replyConfirmed
					),
					actorUserId,
				});
			}

			const nextActionDate = await syncFollowUpDateMirror(db, leadId);
			await tx.commit();
			return {
				activity_id: activityId,
				stage: stageAfterWrite,
				next_action_date: nextActionDate,
			};
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	} finally {
		db.release?.();
	}
}

/** Schedule one dated next action for a Lead. */
export async function scheduleLeadTask(
	leadId: number,
	input: ScheduleLeadTaskInput,
	actorUserId: number
): Promise<{ task_id: number; next_action_date: string | null }> {
	const activityType =
		input.activity_type === undefined || input.activity_type === null
			? 'Note'
			: parseActivityType(input.activity_type);
	const scheduledFor = parseScheduledDate(input.scheduled_for, 'scheduled_for');
	const nextActionText = trimOrNull(input.next_action);
	const notes = trimOrNull(input.notes);

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const lead = await loadLead(db, leadId);
			assertLeadAcceptsSalesWork(lead);
			assertOwnerForOutreach(lead, activityType);

			const taskId = await insertActivityRow(db, {
				leadId,
				activityType,
				status: 'Scheduled',
				scheduledFor,
				nextAction: nextActionText,
				notes,
				createdBy: actorUserId,
			});

			await assertNextActionPresent(db, leadId, lead.stage);
			const nextActionDate = await syncFollowUpDateMirror(db, leadId);
			await tx.commit();
			return { task_id: taskId, next_action_date: nextActionDate };
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	} finally {
		db.release?.();
	}
}

/**
 * Close one scheduled task: it happened (Completed) or it will not happen
 * (Cancelled). Completing the last outstanding task of an active Lead needs
 * its replacement in the same request.
 */
export async function updateLeadTask(
	leadId: number,
	taskId: number,
	input: UpdateLeadTaskInput,
	actorUserId: number
): Promise<{
	task_id: number;
	status: string;
	next_action_date: string | null;
}> {
	const status = parseWorkStatus(input.status);
	const notes = trimOrNull(input.notes);
	const nextAction = parseNextAction(input.next_action);

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const lead = await loadLead(db, leadId);
			assertLeadAcceptsSalesWork(lead);

			const [rows] = (await db.execute(
				`SELECT id, activity_type, status, call_outcome, reply_confirmed,
            scheduled_for, occurred_at, notes
          FROM lead_activities
          WHERE id = ? AND lead_id = ? AND (isDelete = 0 OR isDelete IS NULL)
          FOR UPDATE`,
				[taskId, leadId]
			)) as unknown as [
				{
					id: number;
					activity_type: string | null;
					status: string | null;
					call_outcome: string | null;
					reply_confirmed: number | null;
					scheduled_for: string | null;
					occurred_at: string | null;
					notes: string | null;
				}[],
				unknown,
			];
			const task = rows[0];
			if (!task) {
				throw new LeadWorkflowError(
					'task_not_found',
					'Lead task not found',
					404
				);
			}
			if (task.status !== 'Scheduled') {
				throw new LeadWorkflowError(
					'activity_invalid',
					'This lead task is already closed',
					409
				);
			}

			const activityType = isLeadActivityType(task.activity_type)
				? task.activity_type
				: null;
			assertOwnerForOutreach(lead, activityType);

			const callOutcome =
				status === 'Completed'
					? parseCallOutcome(
							activityType,
							input.call_outcome === undefined
								? task.call_outcome
								: input.call_outcome
						)
					: null;
			// A stored NULL means "no reply evidence", not "the client did not
			// reply". Passing `false` for a missing value would refuse every
			// non-email task with a reply-confirmed error.
			const replyConfirmed =
				status === 'Completed'
					? parseReplyConfirmed(
							activityType,
							input.reply_confirmed === undefined
								? task.reply_confirmed === null
									? null
									: task.reply_confirmed === 1
								: input.reply_confirmed
						)
					: null;
			const occurredAt =
				status === 'Completed'
					? (parseOccurredAt(input.occurred_at) ?? new Date())
					: null;

			const existingNotes = trimOrNull(task.notes);
			const combinedNotes =
				existingNotes && notes
					? `${existingNotes}\n${notes}`
					: (notes ?? existingNotes);

			await db.execute(
				`UPDATE lead_activities
          SET status = ?, call_outcome = ?, reply_confirmed = ?,
              occurred_at = ?, completed_at = ?, notes = ?, updated_at = NOW()
          WHERE id = ?`,
				[
					status,
					callOutcome,
					replyConfirmed === null ? null : replyConfirmed ? 1 : 0,
					occurredAt ? toMysqlDateTime(occurredAt) : null,
					toMysqlDateTime(new Date()),
					combinedNotes,
					taskId,
				]
			);

			if (nextAction) {
				await insertActivityRow(db, {
					leadId,
					activityType: nextAction.activityType,
					status: 'Scheduled',
					scheduledFor: nextAction.scheduledFor,
					nextAction: nextAction.nextAction,
					notes: nextAction.notes,
					createdBy: actorUserId,
				});
			}

			const nextStage =
				status === 'Completed'
					? resolveAutomaticStage({
							currentStage: lead.stage,
							activityType,
							callOutcome,
							replyConfirmed,
						})
					: null;
			const stageAfterWrite = nextStage ?? lead.stage;
			await assertNextActionPresent(db, leadId, stageAfterWrite);

			if (nextStage && nextStage !== lead.stage) {
				await db.execute(
					'UPDATE leads SET enquiry_status = ?, updated_at = NOW() WHERE id = ?',
					[nextStage, leadId]
				);
				await recordStageChange(db, {
					leadId,
					fromStage: lead.stage,
					toStage: nextStage,
					changeSource: 'automatic',
					reason: automaticStageReason(
						activityType,
						callOutcome,
						replyConfirmed
					),
					actorUserId,
				});
			}

			const nextActionDate = await syncFollowUpDateMirror(db, leadId);
			await tx.commit();
			return {
				task_id: taskId,
				status,
				next_action_date: nextActionDate,
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
 * The chronological timeline of one Lead: the activities, the stage changes,
 * and the ownership changes, oldest first. Evidence that does not know its
 * author or its outcome says so instead of guessing.
 */
export async function getLeadTimeline(
	leadId: number
): Promise<LeadTimelineEntry[]> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const [leadRows] = (await db.execute(
			'SELECT id FROM leads WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL) LIMIT 1',
			[leadId]
		)) as unknown as [{ id: number }[], unknown];
		if (leadRows.length === 0) {
			throw new LeadWorkflowError('not_found', 'Lead not found', 404);
		}
		const [activityRows] = (await db.execute(
			`SELECT a.id, a.activity_type, a.status, a.call_outcome,
              a.reply_confirmed, a.scheduled_for, a.occurred_at, a.completed_at,
              a.next_action, a.notes, a.created_by, a.recorded_at, a.created_at,
              a.legacy_type, u.full_name AS actor_name
        FROM lead_activities a
        LEFT JOIN users u ON u.id = a.created_by
        WHERE a.lead_id = ? AND (a.isDelete = 0 OR a.isDelete IS NULL)
        ORDER BY a.id ASC`,
			[leadId]
		)) as unknown as [Record<string, unknown>[], unknown];
		const [stageRows] = (await db.execute(
			`SELECT h.id, h.from_stage, h.to_stage, h.change_source, h.reason,
              h.actor_user_id, h.recorded_at, h.created_at, u.full_name AS actor_name
        FROM lead_stage_history h
        LEFT JOIN users u ON u.id = h.actor_user_id
        WHERE h.lead_id = ?
        ORDER BY h.id ASC`,
			[leadId]
		)) as unknown as [Record<string, unknown>[], unknown];
		const [ownerRows] = (await db.execute(
			`SELECT o.id, o.prior_owner_user_id, o.owner_user_id, o.actor_user_id,
              o.created_at, uo.full_name AS owner_name, ua.full_name AS actor_name
        FROM lead_ownership_history o
        LEFT JOIN users uo ON uo.id = o.owner_user_id
        LEFT JOIN users ua ON ua.id = o.actor_user_id
        WHERE o.lead_id = ?
        ORDER BY o.id ASC`,
			[leadId]
		)) as unknown as [Record<string, unknown>[], unknown];

		const entries: Array<{ entry: LeadTimelineEntry; sortTime: string }> = [];

		for (const row of activityRows) {
			const status = trimOrNull(row.status) ?? 'Scheduled';
			const activityType = trimOrNull(row.activity_type);
			const callOutcome = trimOrNull(row.call_outcome);
			const actorName = trimOrNull(row.actor_name);
			const scheduledFor = trimOrNull(row.scheduled_for);
			const occurredAt = toIsoDateTime(row.occurred_at);
			const recordedAt = toIsoDateTime(row.recorded_at ?? row.created_at);
			const legacy =
				actorName === null ||
				activityType === null ||
				trimOrNull(row.legacy_type) !== null ||
				(status === 'Completed' &&
					activityType === 'Call' &&
					callOutcome === null);
			entries.push({
				entry: {
					key: `activity:${String(row.id)}`,
					kind: 'activity',
					occurred_at: occurredAt,
					recorded_at: recordedAt,
					title: activityTitle({
						status,
						activityType,
						callOutcome,
						replyConfirmed: row.reply_confirmed === 1,
						scheduledFor,
					}),
					detail: trimOrNull(row.notes) ?? trimOrNull(row.next_action),
					actor_name: actorName,
					status,
					activity_type: activityType,
					call_outcome: callOutcome,
					legacy,
				},
				sortTime:
					status === 'Scheduled' && scheduledFor
						? `${scheduledFor}T00:00:00`
						: (occurredAt ?? recordedAt ?? '9999-12-31T23:59:59'),
			});
		}

		// The corrections of the Lead are their own entries: a corrected
		// activity stays one activity, and the values it had before every
		// correction stay visible next to it.
		for (const entry of await getLeadCorrectionEntries(db, leadId)) {
			entries.push({
				entry,
				sortTime: entry.recorded_at ?? '9999-12-31T23:59:59',
			});
		}

		for (const row of stageRows) {
			const recordedAt = toIsoDateTime(row.recorded_at ?? row.created_at);
			const fromStage = trimOrNull(row.from_stage);
			const toStage = trimOrNull(row.to_stage);
			const actorName = trimOrNull(row.actor_name);
			entries.push({
				entry: {
					key: `stage:${String(row.id)}`,
					kind: 'stage_change',
					occurred_at: recordedAt,
					recorded_at: recordedAt,
					title: `Stage: ${fromStage ?? 'Unresolved'} → ${toStage ?? 'Unknown'}`,
					detail: trimOrNull(row.reason),
					actor_name: actorName,
					status: null,
					activity_type: null,
					call_outcome: null,
					legacy: actorName === null,
				},
				sortTime: recordedAt ?? '9999-12-31T23:59:59',
			});
		}

		for (const row of ownerRows) {
			const recordedAt = toIsoDateTime(row.created_at);
			const ownerName = trimOrNull(row.owner_name);
			const priorOwnerUserId = toNullableId(row.prior_owner_user_id);
			entries.push({
				entry: {
					key: `owner:${String(row.id)}`,
					kind: 'owner_change',
					occurred_at: recordedAt,
					recorded_at: recordedAt,
					title: ownerName ? `Owner changed to ${ownerName}` : 'Owner removed',
					detail:
						priorOwnerUserId === null
							? null
							: 'The Lead had an owner before this change.',
					actor_name: trimOrNull(row.actor_name),
					status: null,
					activity_type: null,
					call_outcome: null,
					legacy: trimOrNull(row.actor_name) === null,
				},
				sortTime: recordedAt ?? '9999-12-31T23:59:59',
			});
		}

		entries.sort((left, right) => {
			if (left.sortTime === right.sortTime) {
				return left.entry.key.localeCompare(right.entry.key);
			}
			return left.sortTime < right.sortTime ? -1 : 1;
		});
		return entries.map((item) => item.entry);
	} finally {
		db.release?.();
	}
}

/**
 * The current work summary of one Lead: the last successful contact, the
 * latest activity and its outcome, the dated next action, and how much work
 * was completed. A failed attempt never advances the last contact.
 */
export async function getLeadWorkSummary(
	leadId: number
): Promise<LeadWorkSummary> {
	const db = (await dbConnect()) as unknown as DbConnection;
	try {
		const [rows] = (await db.execute(
			`SELECT
        MAX(CASE WHEN status = 'Completed'
              AND ((activity_type = 'Call' AND call_outcome = 'Connected')
                OR (activity_type = 'Email' AND reply_confirmed = 1))
              THEN occurred_at END) AS last_contact_at,
        MAX(CASE WHEN status = 'Completed' THEN occurred_at END) AS latest_activity_at,
        SUM(CASE WHEN status = 'Completed' AND source_activity_id IS NULL
              THEN 1 ELSE 0 END) AS activity_count
      FROM lead_activities
      WHERE lead_id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
			[leadId]
		)) as unknown as [
			{
				last_contact_at: string | null;
				latest_activity_at: string | null;
				activity_count: number | null;
			}[],
			unknown,
		];
		const summary = rows[0];
		const [outcomeRows] = (await db.execute(
			`SELECT activity_type, call_outcome, reply_confirmed
        FROM lead_activities
        WHERE lead_id = ?
          AND status = 'Completed'
          AND (call_outcome IS NOT NULL
            OR (activity_type = 'Email' AND reply_confirmed = 1))
          AND (isDelete = 0 OR isDelete IS NULL)
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1`,
			[leadId]
		)) as unknown as [
			{
				activity_type: string | null;
				call_outcome: string | null;
				reply_confirmed: number | null;
			}[],
			unknown,
		];
		const outcome = outcomeRows[0];
		const next = await earliestNextAction(db, leadId);
		return {
			last_contact_at: toIsoDateTime(summary?.last_contact_at),
			latest_activity_at: toIsoDateTime(summary?.latest_activity_at),
			latest_activity_outcome:
				trimOrNull(outcome?.call_outcome) ??
				(outcome?.reply_confirmed === 1 ? 'Reply confirmed' : null),
			next_action_date: next ? next.scheduled_for : null,
			next_action_type: next ? next.activity_type : null,
			activity_count: Number(summary?.activity_count ?? 0),
		};
	} finally {
		db.release?.();
	}
}

function parseWorkStatus(value: unknown): LeadWorkStatus {
	if (!isLeadWorkStatus(value) || value === 'Scheduled') {
		throw new LeadWorkflowError(
			'activity_invalid',
			'A lead task is completed or cancelled',
			422
		);
	}
	return value;
}

/** The human label of one activity row. */
function activityTitle(row: {
	status: string;
	activityType: string | null;
	callOutcome: string | null;
	replyConfirmed: boolean;
	scheduledFor: string | null;
}): string {
	const kind = row.activityType ?? 'Unknown activity';
	if (row.status === 'Scheduled') {
		const date = formatCalendarDate(row.scheduledFor);
		return date
			? `${kind} scheduled for ${date}`
			: `${kind} scheduled without a date`;
	}
	if (row.status === 'Cancelled') return `${kind} cancelled`;
	if (kind === 'Call') {
		return row.callOutcome
			? `Call — ${row.callOutcome}`
			: 'Call — outcome unknown';
	}
	if (kind === 'Email') {
		return row.replyConfirmed ? 'Email — reply confirmed' : 'Email';
	}
	return kind;
}

/** Why the stage moved, in the words of the evidence that moved it. */
function automaticStageReason(
	activityType: string | null,
	callOutcome: string | null,
	replyConfirmed: boolean | null
): string {
	if (activityType === 'Call' && callOutcome === 'Connected') {
		return 'A connected call was recorded.';
	}
	if (activityType === 'Email' && replyConfirmed) {
		return 'A confirmed email reply was recorded.';
	}
	return 'Outreach was recorded.';
}
