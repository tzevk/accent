import { ACTIVE_LEAD_STAGES, isLeadStage } from '@/lib/lead-stages';
import {
	isLeadDueFilter,
	isLeadQueueView,
	type LeadDueFilter,
	type LeadQueueView,
} from '@/lib/lead-queues';
import { LeadWorkflowError, toNullableId } from '@/server/leads/shared';

/**
 * The Lead list filters and the actionable Lead queues (ticket #374).
 *
 * One parser, one set of conditions, one counter query: `GET /api/leads`
 * and `GET /api/leads/list` read the query through `parseLeadListQuery`, and
 * the list, the counters, and the tabs all use the conditions below. A
 * second parser would be a second convention.
 *
 * The module is pure: it builds SQL fragments and never touches the
 * database, so the rules are testable on their own and the workspace and
 * the server share one vocabulary (`src/lib/lead-queues.ts`).
 *
 * The date policy is the application's one: the database calendar day
 * (`CURDATE()`), as the dashboard and the report queries use it.
 */

/** The Lead kinds that count as outreach. A note is not outreach. */
const OUTREACH_ACTIVITY_TYPES = ['Call', 'Email', 'Meeting'] as const;

export interface LeadListQuery {
	page: number;
	limit: number;
	search: string;
	stage: string;
	city: string;
	sortBy: string;
	sortOrder: string;
	owner: string;
	review: string;
	view: LeadQueueView;
	due: LeadDueFilter;
}

export interface SqlCondition {
	clause: string;
	params: unknown[];
}

/**
 * The outstanding scheduled work of a Lead: a scheduled row that was neither
 * completed, cancelled, nor transferred away, and that carries a date.
 * Completed, cancelled, and transferred work is never outstanding.
 */
function outstandingWorkSql(datePredicate = ''): string {
	return `EXISTS (
      SELECT 1 FROM lead_activities a
      WHERE a.lead_id = l.id
        AND a.status = 'Scheduled'
        AND a.transferred_followup_id IS NULL
        AND a.scheduled_for IS NOT NULL
        AND (a.isDelete = 0 OR a.isDelete IS NULL)
        ${datePredicate}
    )`;
}

/** The completed outreach of a Lead: a finished call, email, or meeting. */
function completedOutreachSql(): string {
	const placeholders = OUTREACH_ACTIVITY_TYPES.map(() => '?').join(', ');
	return `EXISTS (
      SELECT 1 FROM lead_activities a
      WHERE a.lead_id = l.id
        AND a.status = 'Completed'
        AND a.activity_type IN (${placeholders})
        AND (a.isDelete = 0 OR a.isDelete IS NULL)
    )`;
}

/** The stages that keep a Lead in the active work queue. */
function activeStageSql(): { clause: string; params: unknown[] } {
	const placeholders = ACTIVE_LEAD_STAGES.map(() => '?').join(', ');
	return {
		clause: `l.enquiry_status IN (${placeholders})`,
		params: [...ACTIVE_LEAD_STAGES],
	};
}

function readParameter(
	params: URLSearchParams | Record<string, string | null | undefined>,
	key: string
): string {
	const raw =
		params instanceof URLSearchParams ? params.get(key) : (params[key] ?? null);
	return typeof raw === 'string' ? raw.trim() : '';
}

function boundedInteger(raw: string, fallback: number, max: number): number {
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
	return Math.min(parsed, max);
}

/**
 * The one parser of the Lead list query. The queue selection has a closed
 * vocabulary: an unknown view is refused instead of quietly showing the
 * wrong queue. The other filters keep the repository's convention — an
 * unknown owner or stage matches nothing rather than leaking rows.
 */
export function parseLeadListQuery(
	params: URLSearchParams | Record<string, string | null | undefined>
): LeadListQuery {
	const rawView = readParameter(params, 'view');
	let view: LeadQueueView = 'all';
	if (rawView !== '') {
		if (!isLeadQueueView(rawView)) {
			throw new LeadWorkflowError(
				'view_invalid',
				`Unknown Lead view: ${rawView}`,
				422
			);
		}
		view = rawView;
	}
	const rawDue = readParameter(params, 'due');
	let due: LeadDueFilter = 'any';
	if (rawDue !== '') {
		if (!isLeadDueFilter(rawDue)) {
			throw new LeadWorkflowError(
				'view_invalid',
				`Unknown Lead due-date filter: ${rawDue}`,
				422
			);
		}
		due = rawDue;
	}
	const rawOwner = readParameter(params, 'owner');
	return {
		page: boundedInteger(readParameter(params, 'page'), 1, 1000000),
		limit: boundedInteger(readParameter(params, 'limit'), 20, 200),
		search: readParameter(params, 'search'),
		stage: readParameter(params, 'stage'),
		city: readParameter(params, 'city'),
		sortBy: readParameter(params, 'sortBy') || 'created_at',
		sortOrder: readParameter(params, 'sortOrder') || 'desc',
		owner: rawOwner === 'all' ? '' : rawOwner,
		review: readParameter(params, 'review'),
		view,
		due,
	};
}

/**
 * The filters every read of the Lead table shares: the search, the stage,
 * the city, the owner, the due-date window, and the review flag. The queue
 * selection is not part of it — the counters need the filtered dataset
 * without the selected queue.
 */
export function buildBaseFilterClause(query: LeadListQuery): SqlCondition {
	const parts: string[] = [];
	const params: unknown[] = [];
	if (query.search) {
		const term = `%${query.search.toLowerCase()}%`;
		parts.push(
			'(LOWER(l.lead_id) LIKE ? OR LOWER(l.company_name) LIKE ? OR LOWER(l.contact_name) LIKE ? OR LOWER(l.contact_email) LIKE ? OR LOWER(l.project_description) LIKE ?)'
		);
		params.push(term, term, term, term, term);
	}
	if (query.stage) {
		if (isLeadStage(query.stage)) {
			parts.push('l.enquiry_status = ?');
			params.push(query.stage);
		} else if (query.stage === 'Unresolved') {
			parts.push('l.enquiry_status IS NULL');
		} else {
			// An unknown stage matches nothing rather than leaking rows.
			parts.push('1 = 0');
		}
	}
	if (query.city) {
		parts.push('l.city LIKE ?');
		params.push(`%${query.city}%`);
	}
	if (query.owner === 'unassigned') {
		parts.push('l.owner_user_id IS NULL');
	} else if (query.owner) {
		const ownerId = toNullableId(query.owner);
		if (ownerId === null) {
			parts.push('1 = 0');
		} else {
			parts.push('l.owner_user_id = ?');
			params.push(ownerId);
		}
	}
	if (query.due !== 'any') {
		const due = buildDueCondition(query.due);
		parts.push(due.clause);
		params.push(...due.params);
	}
	if (query.review === '1') {
		parts.push('l.legacy_review_required = 1');
	}
	return { clause: parts.length > 0 ? parts.join(' AND ') : '1 = 1', params };
}

/**
 * The due-date window of the Lead list. The window applies to the
 * outstanding scheduled work of the Lead, so a Lead whose work was closed
 * never appears in a due queue.
 */
export function buildDueCondition(due: LeadDueFilter): SqlCondition {
	switch (due) {
		case 'today':
			return {
				clause: outstandingWorkSql('AND a.scheduled_for = CURDATE()'),
				params: [],
			};
		case 'overdue':
			return {
				clause: outstandingWorkSql('AND a.scheduled_for < CURDATE()'),
				params: [],
			};
		case 'next_seven_days':
			return {
				clause: outstandingWorkSql(
					'AND a.scheduled_for BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)'
				),
				params: [],
			};
		case 'any':
		default:
			return { clause: '1 = 1', params: [] };
	}
}

/**
 * The condition of one Lead queue.
 *
 * `my_leads` resolves to the authenticated user on the server: a
 * client-supplied user id never selects another person's queue.
 */
export function buildQueueCondition(
	view: LeadQueueView,
	viewerUserId: number | null
): SqlCondition {
	switch (view) {
		case 'my_leads':
			return viewerUserId === null
				? { clause: '1 = 0', params: [] }
				: { clause: 'l.owner_user_id = ?', params: [viewerUserId] };
		case 'unassigned':
			return { clause: 'l.owner_user_id IS NULL', params: [] };
		case 'due_today':
			return {
				clause: outstandingWorkSql('AND a.scheduled_for = CURDATE()'),
				params: [],
			};
		case 'overdue':
			return {
				clause: outstandingWorkSql('AND a.scheduled_for < CURDATE()'),
				params: [],
			};
		case 'untouched':
			return {
				clause: `NOT ${completedOutreachSql()}`,
				params: [...OUTREACH_ACTIVITY_TYPES],
			};
		case 'no_next_action': {
			const active = activeStageSql();
			return {
				clause: `${active.clause} AND NOT ${outstandingWorkSql()}`,
				params: active.params,
			};
		}
		case 'all':
		default:
			return { clause: '1 = 1', params: [] };
	}
}

interface CounterColumn {
	alias: string;
	sql: string;
	params: unknown[];
}

/**
 * The counters of every Lead queue, counted over the whole filtered
 * dataset and never over the current page. The selected queue is not part
 * of the count, so the tab of a queue and the table of that queue always
 * agree.
 */
export function buildQueueCounterSelect(viewerUserId: number | null): {
	select: string;
	params: unknown[];
} {
	const columns: CounterColumn[] = [
		{ alias: 'queue_all', sql: 'COUNT(*)', params: [] },
		{
			alias: 'queue_my_leads',
			sql:
				viewerUserId === null
					? 'SUM(CASE WHEN 1 = 0 THEN 1 ELSE 0 END)'
					: 'SUM(CASE WHEN l.owner_user_id = ? THEN 1 ELSE 0 END)',
			params: viewerUserId === null ? [] : [viewerUserId],
		},
		{
			alias: 'queue_unassigned',
			sql: 'SUM(CASE WHEN l.owner_user_id IS NULL THEN 1 ELSE 0 END)',
			params: [],
		},
		{
			alias: 'queue_due_today',
			sql: `SUM(CASE WHEN ${outstandingWorkSql('AND a.scheduled_for = CURDATE()')} THEN 1 ELSE 0 END)`,
			params: [],
		},
		{
			alias: 'queue_overdue',
			sql: `SUM(CASE WHEN ${outstandingWorkSql('AND a.scheduled_for < CURDATE()')} THEN 1 ELSE 0 END)`,
			params: [],
		},
		{
			alias: 'queue_untouched',
			sql: `SUM(CASE WHEN NOT ${completedOutreachSql()} THEN 1 ELSE 0 END)`,
			params: [...OUTREACH_ACTIVITY_TYPES],
		},
		{
			alias: 'queue_no_next_action',
			sql: `SUM(CASE WHEN ${activeStageSql().clause} AND NOT ${outstandingWorkSql()} THEN 1 ELSE 0 END)`,
			params: [...ACTIVE_LEAD_STAGES],
		},
	];
	return {
		select: columns
			.map((column) => `${column.sql} AS ${column.alias}`)
			.join(',\n            '),
		params: columns.flatMap((column) => column.params),
	};
}
