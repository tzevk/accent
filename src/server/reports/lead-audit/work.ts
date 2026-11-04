/**
 * The Work and accountability section (#400).
 *
 * One population answers every question here: a completed activity row with
 * a known occurrence time inside the selected period, on a non-deleted Lead,
 * read at its current corrected values. Outreach, successful contact, the
 * author breakdown, and the exclusions are rules over that population —
 * never separate populations that could disagree with the total.
 *
 * Stored rules reused from the Lead workspace:
 * - completed work is `status = 'Completed'` with `source_activity_id IS NULL`
 *   (a transferred copy is the same work, not another activity);
 * - outreach is a Call, Email, or Meeting;
 * - successful contact is a Connected call or a confirmed email reply;
 * - the recorded author is `created_by`, not the current owner.
 *
 * Scheduled and cancelled rows are never completed work, and occurrence time
 * is never replaced by recording or completion time.
 */
import { LEAD_CALL_OUTCOMES, isLeadOutreachType } from '@/lib/lead-activities';
import type { DbConnection } from '@/server/leads/shared';
import { readLeadAuditClock } from './clock';
import { withLeadAuditConnection } from './connection';
import {
	LEAD_AUDIT_ALL_EVIDENCE_FILTERS,
	LEAD_AUDIT_EVENT_TYPES,
	LEAD_AUDIT_OUTCOME_FILTERS,
	leadAuditEvidenceFilterValue,
	parseLeadAuditEvidenceFilters,
	resolveLeadAuditEvidenceEffectiveFilters,
	type EvidenceQuerySource,
	type LeadAuditEvidenceEffectiveFilters,
	type LeadAuditEvidenceFilters,
} from './evidence-filters';
import { parseLeadAuditFilters, parseLeadAuditPagination } from './filters';
import { nextDay } from './period';
import {
	buildLeadAuditMeta,
	buildLeadAuditScope,
	resolveLeadAuditEffectiveFilters,
} from './scope';
import {
	buildLeadAuditFilterCondition,
	buildLeadAuditSearchCondition,
	joinConditions,
	type SqlCondition,
} from './sql';
import {
	LeadAuditValidationError,
	type LeadAuditClock,
	type LeadAuditEffectiveFilters,
	type LeadAuditFilters,
} from './types';
import {
	LEAD_AUDIT_ACTIVITY_FILTER_TYPES,
	LEAD_AUDIT_WORK_DATE_BASIS,
	LEAD_AUDIT_WORK_EVIDENCE_METRICS,
	leadAuditActivityTypeLabel,
	type LeadAuditWorkAppliedFilter,
	type LeadAuditWorkAuthorRow,
	type LeadAuditWorkCoverage,
	type LeadAuditWorkEvidenceMetric,
	type LeadAuditWorkEvidenceRow,
	type LeadAuditWorkEvidenceSection,
	type LeadAuditWorkFilterOptions,
	type LeadAuditWorkFilterScope,
	type LeadAuditWorkMetric,
	type LeadAuditWorkSection,
	type LeadAuditWorkSummary,
	type LeadAuditWorkTypeCounts,
} from './work-types';

const ACTIVE_ACTIVITY = '(a.isDelete = 0 OR a.isDelete IS NULL)';
const COMPLETED_ACTIVITY =
	"(a.status = 'Completed' AND a.source_activity_id IS NULL)";
const COMPLETED_OPERATIONAL = `${ACTIVE_ACTIVITY} AND ${COMPLETED_ACTIVITY}`;
const OUTREACH_SQL = "a.activity_type IN ('Call', 'Email', 'Meeting')";
const SUCCESSFUL_CONTACT_SQL =
	"((a.activity_type = 'Call' AND a.call_outcome = 'Connected') OR (a.activity_type = 'Email' AND a.reply_confirmed = 1))";
const UNKNOWN_TYPE_SQL =
	"(a.activity_type IS NULL OR a.activity_type NOT IN ('Call', 'Email', 'Meeting', 'Note'))";
const CANONICAL_CALL_OUTCOMES_SQL = `(${LEAD_CALL_OUTCOMES.map(
	(outcome) => `'${outcome}'`
).join(', ')})`;
const FAILED_CALL_SQL = `(a.activity_type = 'Call' AND a.call_outcome IN ${CANONICAL_CALL_OUTCOMES_SQL} AND a.call_outcome <> 'Connected')`;
const UNKNOWN_CALL_OUTCOME_SQL = `(a.activity_type = 'Call' AND (a.call_outcome IS NULL OR a.call_outcome NOT IN ${CANONICAL_CALL_OUTCOMES_SQL}))`;

const ACTIVITY_FROM = `
  FROM lead_activities a
  JOIN leads l ON l.id = a.lead_id
  LEFT JOIN users u ON u.id = a.created_by
`;

const METRIC_TYPE: Record<'call' | 'email' | 'meeting' | 'note', string> = {
	call: 'Call',
	email: 'Email',
	meeting: 'Meeting',
	note: 'Note',
};

const METRICS: Record<LeadAuditWorkMetric, LeadAuditWorkEvidenceMetric> = {
	completed: {
		key: 'completed',
		label: 'Completed work',
		definition:
			'Completed Lead activities with a known occurrence time inside the selected period. Scheduled and cancelled work is excluded, and a correction changes the current row instead of adding another activity.',
	},
	outreach: {
		key: 'outreach',
		label: 'Lead Outreach',
		definition:
			'Completed Calls, Emails, and Meetings with a known occurrence time inside the period. Notes and scheduled next actions are not outreach.',
	},
	successful_contact: {
		key: 'successful_contact',
		label: 'Successful contact',
		definition:
			'Completed Connected calls and confirmed email replies. A failed call, an unconfirmed sent email, and a meeting are not successful contact.',
	},
	call: {
		key: 'call',
		label: 'Completed calls',
		definition:
			'Completed Call activities with a known occurrence time inside the period, whether or not the call connected.',
	},
	email: {
		key: 'email',
		label: 'Completed emails',
		definition:
			'Completed Email activities with a known occurrence time inside the period, including emails without a confirmed reply.',
	},
	meeting: {
		key: 'meeting',
		label: 'Completed meetings',
		definition:
			'Completed Meeting activities with a known occurrence time inside the period. A meeting is outreach but does not by itself establish successful contact.',
	},
	note: {
		key: 'note',
		label: 'Completed notes',
		definition:
			'Completed Note activities with a known occurrence time inside the period. A note documents work; it is not outreach and not successful contact.',
	},
	unknown_type: {
		key: 'unknown_type',
		label: 'Unknown activity type',
		definition:
			'Completed activities whose stored type is missing or outside the canonical vocabulary. They stay explicitly unknown and are never guessed into a type.',
	},
	undated: {
		key: 'undated',
		label: 'Completed work without an occurrence date',
		definition:
			'Completed activities with no stored occurrence time. They are excluded from every dated work figure, and no recording or completion time stands in for the missing occurrence.',
	},
	cancelled: {
		key: 'cancelled',
		label: 'Cancelled work',
		definition:
			'Cancelled activities with a known occurrence time inside the period. Cancelled work is evidence of a change of plan, never completed work.',
	},
};

/** The one set of work metric definitions, shared with the workbook export. */
export const LEAD_AUDIT_WORK_METRICS = METRICS;

const TYPE_OPTIONS = LEAD_AUDIT_ACTIVITY_FILTER_TYPES.map((value) => ({
	value,
	label: value === 'unknown' ? 'Unknown activity type' : value,
}));

const OUTCOME_OPTIONS = LEAD_AUDIT_OUTCOME_FILTERS.map((value) => ({
	value,
	label:
		value === 'email_replied'
			? 'Email reply confirmed'
			: value === 'email_sent'
				? 'Email sent without a confirmed reply'
				: value === 'unknown'
					? 'Unknown outcome'
					: value,
}));

const EVENT_TYPE_OPTIONS = [
	...LEAD_AUDIT_EVENT_TYPES.map((value) => ({
		value,
		label: value
			.replace(/_/g, ' ')
			.replace(/^./, (letter) => letter.toUpperCase()),
	})),
	{ value: 'unknown', label: 'Unknown event type' },
];

function toCount(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** Occurrence time inside the selected calendar days, never recording time. */
function occurrenceInPeriod(filters: LeadAuditFilters): SqlCondition {
	return {
		sql: 'a.occurred_at >= ? AND a.occurred_at < ?',
		params: [
			`${filters.fromDate} 00:00:00`,
			`${nextDay(filters.toDate)} 00:00:00`,
		],
	};
}

/**
 * The evidence filters a work row can honour. `event_type` is deliberately
 * absent: it names audit evidence events, not activity rows, and the scope
 * says so instead of pretending to narrow the figures.
 */
function evidenceCondition(evidence: LeadAuditEvidenceFilters): SqlCondition {
	const clauses: string[] = [];
	const params: unknown[] = [];

	if (evidence.actor.kind === 'unknown') {
		clauses.push('a.created_by IS NULL');
	} else if (evidence.actor.kind === 'user') {
		clauses.push('a.created_by = ?');
		params.push(evidence.actor.userId);
	}

	if (evidence.activityType === 'unknown') {
		clauses.push(UNKNOWN_TYPE_SQL);
	} else if (evidence.activityType !== null) {
		clauses.push('a.activity_type = ?');
		params.push(evidence.activityType);
	}

	if (evidence.outcome === 'unknown') {
		clauses.push(UNKNOWN_CALL_OUTCOME_SQL);
	} else if (evidence.outcome === 'email_replied') {
		clauses.push("(a.activity_type = 'Email' AND a.reply_confirmed = 1)");
	} else if (evidence.outcome === 'email_sent') {
		clauses.push(
			"(a.activity_type = 'Email' AND (a.reply_confirmed IS NULL OR a.reply_confirmed = 0))"
		);
	} else if (evidence.outcome !== null) {
		clauses.push("(a.activity_type = 'Call' AND a.call_outcome = ?)");
		params.push(evidence.outcome);
	}

	return { sql: clauses.length === 0 ? '' : clauses.join(' AND '), params };
}

function workCondition(
	filters: LeadAuditFilters,
	evidence: LeadAuditEvidenceFilters,
	...extra: SqlCondition[]
): SqlCondition {
	const current = evidenceCondition(evidence);
	return joinConditions(
		buildLeadAuditFilterCondition(filters),
		...(current.sql === '' ? [] : [current]),
		...extra
	);
}

async function countWork(
	db: DbConnection,
	condition: SqlCondition
): Promise<number> {
	const [rows] = (await db.execute(
		`SELECT COUNT(*) AS value ${ACTIVITY_FROM} WHERE ${condition.sql}`,
		condition.params
	)) as unknown as [Array<{ value: number | string | null }>, unknown];
	return toCount(rows[0]?.value);
}

function toTypeCounts(row: Record<string, unknown>): LeadAuditWorkTypeCounts {
	return {
		call: toCount(row.calls),
		email: toCount(row.emails),
		meeting: toCount(row.meetings),
		note: toCount(row.notes),
		unknown: toCount(row.unknown_types),
	};
}

function outreachFrom(byType: LeadAuditWorkTypeCounts): number {
	return byType.call + byType.email + byType.meeting;
}

function authorOf(
	row: Record<string, unknown>
): LeadAuditWorkAuthorRow['author'] {
	const rawId = row.created_by;
	const id = rawId === null || rawId === undefined ? null : Number(rawId);
	if (id === null || !Number.isInteger(id) || id <= 0) {
		return { id: null, name: null, is_unknown: true, is_inactive: false };
	}
	const name =
		row.author_name === null || row.author_name === undefined
			? null
			: String(row.author_name);
	const active = row.author_is_active;
	const status = row.author_status;
	const deleted = row.author_is_deleted;
	// The same inactive test the current-owner section uses: a disabled
	// account, a stored inactive status, or a soft-deleted user row.
	const inactive =
		(active !== null && active !== undefined && Number(active) === 0) ||
		String(status ?? '').toLowerCase() === 'inactive' ||
		(deleted !== null && deleted !== undefined && Number(deleted) === 1);
	return {
		id,
		name,
		is_unknown: false,
		is_inactive: inactive,
	};
}

/** One parser for the work evidence population; a typo is a named refusal. */
export function parseLeadAuditWorkMetric(
	source: EvidenceQuerySource
): LeadAuditWorkMetric {
	const raw =
		source instanceof URLSearchParams
			? (source.get('metric') ?? '').trim()
			: String(source.metric ?? '').trim();
	if (raw === '') return 'completed';
	if ((LEAD_AUDIT_WORK_EVIDENCE_METRICS as readonly string[]).includes(raw)) {
		return raw as LeadAuditWorkMetric;
	}
	throw new LeadAuditValidationError(
		'invalid_work_metric',
		`Unknown work evidence metric: ${raw}`
	);
}

function metricCondition(
	filters: LeadAuditFilters,
	evidence: LeadAuditEvidenceFilters,
	metric: LeadAuditWorkMetric
): SqlCondition {
	const completed: SqlCondition = { sql: COMPLETED_ACTIVITY, params: [] };
	const occurrence = occurrenceInPeriod(filters);
	const counted = [
		{ sql: ACTIVE_ACTIVITY, params: [] as unknown[] },
		completed,
		occurrence,
	];
	switch (metric) {
		case 'completed':
			return workCondition(filters, evidence, ...counted);
		case 'outreach':
			return workCondition(filters, evidence, ...counted, {
				sql: OUTREACH_SQL,
				params: [],
			});
		case 'successful_contact':
			return workCondition(filters, evidence, ...counted, {
				sql: SUCCESSFUL_CONTACT_SQL,
				params: [],
			});
		case 'call':
		case 'email':
		case 'meeting':
		case 'note':
			return workCondition(filters, evidence, ...counted, {
				sql: 'a.activity_type = ?',
				params: [METRIC_TYPE[metric]],
			});
		case 'unknown_type':
			return workCondition(filters, evidence, ...counted, {
				sql: UNKNOWN_TYPE_SQL,
				params: [],
			});
		case 'undated':
			return workCondition(
				filters,
				evidence,
				{ sql: ACTIVE_ACTIVITY, params: [] },
				completed,
				{ sql: 'a.occurred_at IS NULL', params: [] }
			);
		case 'cancelled':
			return workCondition(
				filters,
				evidence,
				{ sql: ACTIVE_ACTIVITY, params: [] },
				{ sql: "a.status = 'Cancelled'", params: [] },
				occurrence
			);
		default: {
			const unreachable: never = metric;
			throw new Error(`Unknown work evidence metric: ${unreachable}`);
		}
	}
}

function buildFilterScope(
	filters: LeadAuditFilters,
	evidence: LeadAuditEvidenceFilters,
	effective: LeadAuditEffectiveFilters,
	evidenceEffective: LeadAuditEvidenceEffectiveFilters
): LeadAuditWorkFilterScope {
	const applied: LeadAuditWorkAppliedFilter[] = [
		{
			key: 'actor',
			label: 'Recorded author',
			value: leadAuditEvidenceFilterValue(evidence, 'actor'),
			display: evidenceEffective.actor.label,
			state: evidence.actor.kind === 'all' ? 'all' : 'effective',
			reason:
				'Narrows completed work by the recorded author (`created_by`). It never changes the Lead owner, the intake figures, or another section.',
		},
		{
			key: 'activity_type',
			label: 'Activity type',
			value: leadAuditEvidenceFilterValue(evidence, 'activity_type'),
			display: evidenceEffective.activity_type.label,
			state: evidence.activityType === null ? 'all' : 'effective',
			reason:
				'Narrows completed work to one canonical activity type, or to the explicitly unknown types.',
		},
		{
			key: 'outcome',
			label: 'Outcome',
			value: leadAuditEvidenceFilterValue(evidence, 'outcome'),
			display: evidenceEffective.outcome.label,
			state: evidence.outcome === null ? 'all' : 'effective',
			reason:
				'Applies to completed Call and Email rows only. A Meeting, a Note, and an unknown type carry no outcome, so an outcome-filtered population never includes them.',
		},
		{
			key: 'event_type',
			label: 'Evidence event type',
			value: leadAuditEvidenceFilterValue(evidence, 'event_type'),
			display: evidenceEffective.event_type.label,
			state: 'ignored',
			reason:
				'Event type describes audit evidence events, not activity rows. The Work section accepts it and ignores it, so these figures stay comparable with an unfiltered work read.',
		},
		{
			key: 'undated',
			label: 'Include undated evidence',
			value: leadAuditEvidenceFilterValue(evidence, 'undated'),
			display: evidence.undated
				? 'Include undated evidence (audit only)'
				: 'Not applied',
			state: evidence.undated ? 'ignored' : 'all',
			reason:
				'The undated toggle selects the audit evidence population. Work always keeps undated rows out of every dated figure and lists them as its own evidence metric.',
		},
	];

	return {
		effective: evidenceEffective,
		applied,
		lead_filters: buildLeadAuditScope(filters, effective).effective_filters,
	};
}

function buildDisclosures(
	summary: LeadAuditWorkSummary,
	coverage: LeadAuditWorkCoverage
): Array<{ code: string; text: string }> {
	return [
		{ code: 'work_date_basis', text: LEAD_AUDIT_WORK_DATE_BASIS },
		{
			code: 'completed_work',
			text: `Completed work counts ${summary.completed_total} completed activities with a known occurrence time in the period. Scheduled, cancelled, transferred, and soft-deleted rows are not completed work.`,
		},
		{
			code: 'outreach',
			text: `Lead Outreach counts ${summary.outreach_total} completed Calls, Emails, and Meetings on ${summary.distinct_leads_with_outreach} distinct Lead(s). Notes are documentation, not outreach, and repeated attempts never increase the distinct-Lead figure.`,
		},
		{
			code: 'successful_contact',
			text: `Successful contact counts ${summary.successful_contact} completed Connected call(s) and confirmed email repl${summary.emails_confirmed_reply === 1 ? 'y' : 'ies'} on ${summary.distinct_leads_with_successful_contact} distinct Lead(s). A failed call, an unconfirmed sent email, and a meeting are not successful contact.`,
		},
		{
			code: 'authorship',
			text: "Authors are the recorded activity authors, grouped as stored. A recorded author is not proof that the person performed the work on someone else's behalf, and a Lead's current owner never receives credit for its activities. No ranking or productivity score is derived.",
		},
		{
			code: 'unknown_evidence',
			text: `${coverage.unknown_activity_type} completed activit${coverage.unknown_activity_type === 1 ? 'y has' : 'ies have'} an unknown stored type, ${coverage.unknown_author} ha${coverage.unknown_author === 1 ? 's' : 've'} no recorded author, and ${coverage.missing_call_outcome + coverage.unrecognized_call_outcome} completed call(s) have missing or unrecognized outcome evidence. Unknown facts stay unknown and are not assigned to the current owner.`,
		},
		{
			code: 'undated_work',
			text: `${coverage.unknown_occurrence_date} completed activit${coverage.unknown_occurrence_date === 1 ? 'y has' : 'ies have'} no occurrence time and are excluded from every dated work figure. Their recording and completion times are not used in place of the missing occurrence.`,
		},
		{
			code: 'inactive_authors',
			text: `${coverage.inactive_author} completed activit${coverage.inactive_author === 1 ? 'y was' : 'ies were'} recorded by an account that is now inactive. The recorded author reference is preserved rather than reassigned to the current owner.`,
		},
		{
			code: 'deleted_evidence',
			text: `${coverage.deleted_activity_rows} soft-deleted activity row(s) fall in the period and are excluded from every work figure and from the evidence table. Activities on soft-deleted Leads are excluded too; retained deleted-record evidence belongs to the audit evidence section.`,
		},
		{
			code: 'corrections',
			text: `The report counts current corrected values. ${summary.corrected_activities} completed activit${summary.corrected_activities === 1 ? 'y was' : 'ies were'} corrected; a correction changes that activity's current facts without adding another completed activity or replaying a stage decision.`,
		},
		{
			code: 'live_data',
			text: 'Work figures use live corrected facts and can change between two observations. An earlier period can change when an activity is corrected later.',
		},
	];
}

function buildEvidenceDisclosures(
	metric: LeadAuditWorkEvidenceMetric
): Array<{ code: string; text: string }> {
	return [
		{ code: 'work_date_basis', text: LEAD_AUDIT_WORK_DATE_BASIS },
		{ code: 'work_definition', text: metric.definition },
		{
			code: 'authorship',
			text: 'The author column is the recorded author (`created_by`). The current owner is present-state context only: it does not attribute the activity, and an inactive or missing author reference stays as recorded.',
		},
		{
			code: 'reconciliation',
			text: 'Every page comes from the same population and the same applied filters as the work figures. The workbook export reads the complete result, not only the visible page.',
		},
		{
			code: 'live_data',
			text: 'Evidence rows are live and can change between two observations. Corrections update the row they correct; they do not add evidence rows.',
		},
	];
}

interface EvidenceActivityRow {
	id: number | string;
	activity_type: string | null;
	status: string | null;
	call_outcome: string | null;
	reply_confirmed: number | string | null;
	occurred_at: string | null;
	recorded_at: string | null;
	version: number | string | null;
	created_by: number | string | null;
	author_name: string | null;
	author_is_active: number | string | null;
	author_status: string | null;
	author_is_deleted: number | string | null;
	lead_numeric_id: number | string;
	lead_reference: string | null;
	company_name: string;
	current_owner_id: number | string | null;
	current_owner_name: string | null;
}

function toEvidenceRow(row: EvidenceActivityRow): LeadAuditWorkEvidenceRow {
	const activityType = leadAuditActivityTypeLabel(
		row.activity_type === null ? null : String(row.activity_type)
	);
	const replyConfirmed =
		row.reply_confirmed === null || row.reply_confirmed === undefined
			? null
			: Number(row.reply_confirmed) === 1;
	const callOutcome =
		row.call_outcome === null || row.call_outcome === undefined
			? null
			: String(row.call_outcome);
	const ownerId = Number(row.current_owner_id);
	const hasOwner = Number.isInteger(ownerId) && ownerId > 0;
	return {
		id: Number(row.id),
		lead: {
			id: Number(row.lead_numeric_id),
			lead_id:
				row.lead_reference === null || row.lead_reference === undefined
					? null
					: String(row.lead_reference),
			company_name: String(row.company_name),
			current_owner: hasOwner
				? {
						id: ownerId,
						name:
							row.current_owner_name === null ||
							row.current_owner_name === undefined
								? null
								: String(row.current_owner_name),
					}
				: null,
		},
		activity_type: activityType,
		status: row.status === null ? '' : String(row.status),
		call_outcome: callOutcome,
		reply_confirmed: replyConfirmed,
		occurred_at:
			row.occurred_at === null || row.occurred_at === undefined
				? null
				: String(row.occurred_at),
		recorded_at:
			row.recorded_at === null || row.recorded_at === undefined
				? null
				: String(row.recorded_at),
		author: authorOf({
			created_by: row.created_by,
			author_name: row.author_name,
			author_is_active: row.author_is_active,
			author_status: row.author_status,
			author_is_deleted: row.author_is_deleted,
		}),
		is_outreach: isLeadOutreachType(activityType.value),
		is_successful_contact:
			(activityType.value === 'Call' && callOutcome === 'Connected') ||
			(activityType.value === 'Email' && replyConfirmed === true),
		corrected: Number(row.version) > 1,
	};
}

function evidenceSelect(condition: SqlCondition, tail: string): string {
	return `SELECT a.id, a.activity_type, a.status, a.call_outcome,
           a.reply_confirmed, a.occurred_at, a.recorded_at, a.version,
           a.created_by,
           COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS author_name,
           u.is_active AS author_is_active,
           u.status AS author_status,
           u.isDelete AS author_is_deleted,
           l.id AS lead_numeric_id, l.lead_id AS lead_reference,
           l.company_name,
           l.owner_user_id AS current_owner_id,
           COALESCE(NULLIF(TRIM(ou.full_name), ''), ou.username) AS current_owner_name
    FROM lead_activities a
    JOIN leads l ON l.id = a.lead_id
    LEFT JOIN users u ON u.id = a.created_by
    LEFT JOIN users ou ON ou.id = l.owner_user_id
    WHERE ${condition.sql}
    ${tail}`;
}

/**
 * Every activity row behind one work metric, with no pagination. The
 * workbook export reads this on the same connection as the summary, so an
 * export covers the whole applied result instead of the visible page.
 */
export async function readLeadAuditWorkEvidenceRows(
	db: DbConnection,
	filters: LeadAuditFilters,
	evidence: LeadAuditEvidenceFilters,
	metric: LeadAuditWorkMetric
): Promise<LeadAuditWorkEvidenceRow[]> {
	const condition = metricCondition(filters, evidence, metric);
	const order =
		metric === 'undated'
			? 'a.recorded_at DESC, a.id DESC'
			: 'a.occurred_at DESC, a.id DESC';
	const [rows] = (await db.execute(
		evidenceSelect(condition, `ORDER BY ${order}`),
		condition.params
	)) as unknown as [EvidenceActivityRow[], unknown];
	return rows.map(toEvidenceRow);
}

/** One page of the evidence behind a selected work figure. */
export async function readLeadAuditWorkEvidenceSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	evidence: LeadAuditEvidenceFilters,
	metric: LeadAuditWorkMetric,
	pagination: { page: number; limit: number }
): Promise<LeadAuditWorkEvidenceSection> {
	const condition = metricCondition(filters, evidence, metric);
	const order =
		metric === 'undated'
			? 'a.recorded_at DESC, a.id DESC'
			: 'a.occurred_at DESC, a.id DESC';
	const offset = (pagination.page - 1) * pagination.limit;
	const [totalResult, rowResult, effective, evidenceEffective] =
		await Promise.all([
			db.execute(
				`SELECT COUNT(*) AS value ${ACTIVITY_FROM} WHERE ${condition.sql}`,
				condition.params
			),
			db.execute(
				evidenceSelect(condition, `ORDER BY ${order} LIMIT ? OFFSET ?`),
				[...condition.params, pagination.limit, offset]
			),
			resolveLeadAuditEffectiveFilters(db, filters),
			resolveLeadAuditEvidenceEffectiveFilters(db, evidence),
		]);
	const [totalRows] = totalResult as unknown as [
		Array<{ value: number | string | null }>,
		unknown,
	];
	const total = toCount(totalRows[0]?.value);
	const [rows] = rowResult as unknown as [EvidenceActivityRow[], unknown];
	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		work_date_basis: LEAD_AUDIT_WORK_DATE_BASIS,
		metric: METRICS[metric],
		activities: rows.map(toEvidenceRow),
		pagination: {
			page: pagination.page,
			limit: pagination.limit,
			total,
			total_pages: total === 0 ? 0 : Math.ceil(total / pagination.limit),
		},
		work_filters: buildFilterScope(
			filters,
			evidence,
			effective,
			evidenceEffective
		),
		disclosures: buildEvidenceDisclosures(METRICS[metric]),
	};
}

/**
 * Period work, authorship, coverage, and the applied filter scope for one
 * observation. `db` is the caller's shared connection and `clock` the
 * caller's observation time, so the report response and the workbook export
 * can read every section consistently.
 */
export async function readLeadAuditWorkSection(
	db: DbConnection,
	filters: LeadAuditFilters,
	clock: LeadAuditClock,
	evidence: LeadAuditEvidenceFilters = LEAD_AUDIT_ALL_EVIDENCE_FILTERS
): Promise<LeadAuditWorkSection> {
	const counted = workCondition(
		filters,
		evidence,
		{ sql: COMPLETED_OPERATIONAL, params: [] },
		occurrenceInPeriod(filters)
	);
	const searchOnly = buildLeadAuditSearchCondition(filters);

	const [
		summaryResult,
		authorResult,
		actorOptionResult,
		unknownOccurrence,
		unknownType,
		unknownAuthor,
		inactiveAuthor,
		missingCallOutcome,
		unrecognizedCallOutcome,
		missingEmailReply,
		cancelled,
		deletedRows,
		effective,
		evidenceEffective,
	] = await Promise.all([
		db.execute(
			`SELECT
         COUNT(*) AS completed_total,
         SUM(CASE WHEN a.activity_type = 'Call' THEN 1 ELSE 0 END) AS calls,
         SUM(CASE WHEN a.activity_type = 'Email' THEN 1 ELSE 0 END) AS emails,
         SUM(CASE WHEN a.activity_type = 'Meeting' THEN 1 ELSE 0 END) AS meetings,
         SUM(CASE WHEN a.activity_type = 'Note' THEN 1 ELSE 0 END) AS notes,
         SUM(CASE WHEN ${UNKNOWN_TYPE_SQL} THEN 1 ELSE 0 END) AS unknown_types,
         COUNT(DISTINCT a.lead_id) AS distinct_leads_worked,
         COUNT(DISTINCT CASE WHEN ${OUTREACH_SQL} THEN a.lead_id END) AS distinct_leads_with_outreach,
         COUNT(DISTINCT CASE WHEN ${SUCCESSFUL_CONTACT_SQL} THEN a.lead_id END) AS distinct_leads_with_successful_contact,
         SUM(CASE WHEN a.activity_type = 'Call' AND a.call_outcome = 'Connected' THEN 1 ELSE 0 END) AS calls_connected,
         SUM(CASE WHEN ${FAILED_CALL_SQL} THEN 1 ELSE 0 END) AS calls_failed,
         SUM(CASE WHEN ${UNKNOWN_CALL_OUTCOME_SQL} THEN 1 ELSE 0 END) AS calls_outcome_unknown,
         SUM(CASE WHEN a.activity_type = 'Email' AND a.reply_confirmed = 1 THEN 1 ELSE 0 END) AS emails_confirmed_reply,
         SUM(CASE WHEN a.activity_type = 'Email' AND (a.reply_confirmed IS NULL OR a.reply_confirmed = 0) THEN 1 ELSE 0 END) AS emails_unconfirmed,
         SUM(CASE WHEN a.version > 1 THEN 1 ELSE 0 END) AS corrected_activities
       ${ACTIVITY_FROM}
       WHERE ${counted.sql}`,
			counted.params
		),
		db.execute(
			`SELECT a.created_by,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS author_name,
              u.is_active AS author_is_active,
              u.status AS author_status,
              u.isDelete AS author_is_deleted,
              COUNT(*) AS completed_total,
              SUM(CASE WHEN a.activity_type = 'Call' THEN 1 ELSE 0 END) AS calls,
              SUM(CASE WHEN a.activity_type = 'Email' THEN 1 ELSE 0 END) AS emails,
              SUM(CASE WHEN a.activity_type = 'Meeting' THEN 1 ELSE 0 END) AS meetings,
              SUM(CASE WHEN a.activity_type = 'Note' THEN 1 ELSE 0 END) AS notes,
              SUM(CASE WHEN ${UNKNOWN_TYPE_SQL} THEN 1 ELSE 0 END) AS unknown_types,
              SUM(CASE WHEN ${OUTREACH_SQL} THEN 1 ELSE 0 END) AS outreach_total,
              SUM(CASE WHEN ${SUCCESSFUL_CONTACT_SQL} THEN 1 ELSE 0 END) AS successful_contact,
              COUNT(DISTINCT a.lead_id) AS distinct_leads
       ${ACTIVITY_FROM}
       WHERE ${counted.sql}
       GROUP BY a.created_by, u.full_name, u.username, u.is_active, u.status, u.isDelete`,
			counted.params
		),
		db.execute(
			`SELECT DISTINCT u.id,
              COALESCE(NULLIF(TRIM(u.full_name), ''), u.username) AS name,
              u.is_active,
              u.status,
              u.isDelete
       FROM lead_activities a
       JOIN leads l ON l.id = a.lead_id
       JOIN users u ON u.id = a.created_by
       WHERE ${searchOnly.sql}
         AND (a.isDelete = 0 OR a.isDelete IS NULL)
       ORDER BY name ASC, u.id ASC`,
			searchOnly.params
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				{ sql: 'a.occurred_at IS NULL', params: [] }
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				occurrenceInPeriod(filters),
				{ sql: UNKNOWN_TYPE_SQL, params: [] }
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				occurrenceInPeriod(filters),
				{ sql: 'a.created_by IS NULL', params: [] }
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				occurrenceInPeriod(filters),
				{
					sql: "(u.is_active = 0 OR u.status = 'inactive' OR u.isDelete = 1)",
					params: [],
				}
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				occurrenceInPeriod(filters),
				{
					sql: "a.activity_type = 'Call' AND a.call_outcome IS NULL",
					params: [],
				}
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				occurrenceInPeriod(filters),
				{
					sql: `a.activity_type = 'Call' AND a.call_outcome IS NOT NULL AND a.call_outcome NOT IN ${CANONICAL_CALL_OUTCOMES_SQL}`,
					params: [],
				}
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: COMPLETED_OPERATIONAL, params: [] },
				occurrenceInPeriod(filters),
				{
					sql: "a.activity_type = 'Email' AND a.reply_confirmed IS NULL",
					params: [],
				}
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: ACTIVE_ACTIVITY, params: [] },
				{ sql: "a.status = 'Cancelled'", params: [] },
				occurrenceInPeriod(filters)
			)
		),
		countWork(
			db,
			workCondition(
				filters,
				evidence,
				{ sql: 'a.isDelete = 1', params: [] },
				occurrenceInPeriod(filters)
			)
		),
		resolveLeadAuditEffectiveFilters(db, filters),
		resolveLeadAuditEvidenceEffectiveFilters(db, evidence),
	]);

	const [summaryRows] = summaryResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];
	const summaryRow = summaryRows[0] ?? {};
	const byType = toTypeCounts(summaryRow);
	const summary: LeadAuditWorkSummary = {
		completed_total: toCount(summaryRow.completed_total),
		by_type: byType,
		outreach_total: outreachFrom(byType),
		distinct_leads_worked: toCount(summaryRow.distinct_leads_worked),
		distinct_leads_with_outreach: toCount(
			summaryRow.distinct_leads_with_outreach
		),
		successful_contact:
			toCount(summaryRow.calls_connected) +
			toCount(summaryRow.emails_confirmed_reply),
		distinct_leads_with_successful_contact: toCount(
			summaryRow.distinct_leads_with_successful_contact
		),
		calls_connected: toCount(summaryRow.calls_connected),
		calls_failed: toCount(summaryRow.calls_failed),
		calls_outcome_unknown: toCount(summaryRow.calls_outcome_unknown),
		emails_confirmed_reply: toCount(summaryRow.emails_confirmed_reply),
		emails_unconfirmed: toCount(summaryRow.emails_unconfirmed),
		corrected_activities: toCount(summaryRow.corrected_activities),
	};

	const [authorRows] = authorResult as unknown as [
		Array<Record<string, unknown>>,
		unknown,
	];
	const authors: LeadAuditWorkAuthorRow[] = authorRows
		.map((row) => ({
			author: authorOf(row),
			completed_total: toCount(row.completed_total),
			by_type: toTypeCounts(row),
			outreach_total: toCount(row.outreach_total),
			successful_contact: toCount(row.successful_contact),
			distinct_leads: toCount(row.distinct_leads),
		}))
		.sort((left, right) => {
			if (left.author.is_unknown !== right.author.is_unknown) {
				return left.author.is_unknown ? 1 : -1;
			}
			return (left.author.name ?? '').localeCompare(right.author.name ?? '');
		});

	const [actorRows] = actorOptionResult as unknown as [
		Array<{
			id: number | string;
			name: string | null;
			is_active: unknown;
			status: unknown;
			isDelete: unknown;
		}>,
		unknown,
	];
	const filterOptions: LeadAuditWorkFilterOptions = {
		actors: actorRows.map((row) => ({
			id: Number(row.id),
			name:
				row.name === null || row.name === undefined ? null : String(row.name),
			is_active: !(
				(row.is_active !== null &&
					row.is_active !== undefined &&
					Number(row.is_active) === 0) ||
				String(row.status ?? '').toLowerCase() === 'inactive' ||
				(row.isDelete !== null &&
					row.isDelete !== undefined &&
					Number(row.isDelete) === 1)
			),
		})),
		activity_types: TYPE_OPTIONS,
		outcomes: OUTCOME_OPTIONS,
		event_types: EVENT_TYPE_OPTIONS,
	};

	const coverage: LeadAuditWorkCoverage = {
		unknown_occurrence_date: unknownOccurrence,
		unknown_activity_type: unknownType,
		unknown_author: unknownAuthor,
		inactive_author: inactiveAuthor,
		missing_call_outcome: missingCallOutcome,
		unrecognized_call_outcome: unrecognizedCallOutcome,
		missing_email_reply_evidence: missingEmailReply,
		cancelled_in_period: cancelled,
		deleted_activity_rows: deletedRows,
	};

	return {
		scope: buildLeadAuditScope(filters, effective),
		meta: buildLeadAuditMeta(clock),
		work_date_basis: LEAD_AUDIT_WORK_DATE_BASIS,
		summary,
		coverage,
		authors,
		work_filters: buildFilterScope(
			filters,
			evidence,
			effective,
			evidenceEffective
		),
		filter_options: filterOptions,
		disclosures: buildDisclosures(summary, coverage),
	};
}

/** The authenticated HTTP read behind `/api/reports/lead-audit/work/evidence`. */
export async function readLeadAuditWorkEvidence(
	source: EvidenceQuerySource
): Promise<LeadAuditWorkEvidenceSection> {
	return withLeadAuditConnection(async (db) => {
		const clock = await readLeadAuditClock(db);
		const filters = parseLeadAuditFilters(source, clock.today);
		const evidence = parseLeadAuditEvidenceFilters(source);
		const metric = parseLeadAuditWorkMetric(source);
		const pagination = parseLeadAuditPagination(source);
		return readLeadAuditWorkEvidenceSection(
			db,
			filters,
			clock,
			evidence,
			metric,
			pagination
		);
	});
}
