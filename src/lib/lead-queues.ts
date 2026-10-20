/**
 * The Lead queue vocabulary (ticket #374).
 *
 * Client-safe: this module has no server imports, so the Lead workspace and
 * the server filters share one vocabulary instead of two lists of strings.
 *
 * The queues are the actionable views of the Lead table:
 * - `all` — every Lead the filters allow.
 * - `my_leads` — the Leads the authenticated user owns. The owner is the
 *   session user, never a client-supplied id.
 * - `unassigned` — the Leads without a resolved owner, including the legacy
 *   records whose owner name could not be resolved. Nothing is guessed.
 * - `due_today` — the Leads with outstanding scheduled work dated today.
 * - `overdue` — the Leads with outstanding scheduled work dated before today.
 * - `untouched` — the Leads without completed outreach evidence. A note is
 *   not outreach.
 * - `no_next_action` — the Leads in an active stage without a dated next
 *   action, including the preserved legacy exceptions.
 */
export const LEAD_QUEUE_VIEWS = [
	'all',
	'my_leads',
	'unassigned',
	'due_today',
	'overdue',
	'untouched',
	'no_next_action',
] as const;

export type LeadQueueView = (typeof LEAD_QUEUE_VIEWS)[number];

/**
 * The due-date filter of the Lead workspace. `any` does not restrict the
 * list; the other values select the Leads whose outstanding work falls in
 * the window, under the application date policy (the database calendar day).
 */
export const LEAD_DUE_FILTERS = [
	'any',
	'today',
	'overdue',
	'next_seven_days',
] as const;

export type LeadDueFilter = (typeof LEAD_DUE_FILTERS)[number];

/** The owner filter values: every owner, the unassigned intake, or one id. */
export const LEAD_OWNER_FILTER_ALL = 'all';
export const LEAD_OWNER_FILTER_UNASSIGNED = 'unassigned';

/** The stage filter value of a Lead whose stored stage is unresolved. */
export const LEAD_STAGE_FILTER_UNRESOLVED = 'Unresolved';

export const LEAD_QUEUE_VIEW_LABELS: Record<LeadQueueView, string> = {
	all: 'All Leads',
	my_leads: 'My Leads',
	unassigned: 'Unassigned',
	due_today: 'Due Today',
	overdue: 'Overdue',
	untouched: 'Untouched',
	no_next_action: 'No Next Action',
};

export const LEAD_DUE_FILTER_LABELS: Record<LeadDueFilter, string> = {
	any: 'Any due date',
	today: 'Due today',
	overdue: 'Overdue',
	next_seven_days: 'Next seven days',
};

export function isLeadQueueView(value: unknown): value is LeadQueueView {
	return (
		typeof value === 'string' &&
		(LEAD_QUEUE_VIEWS as readonly string[]).includes(value)
	);
}

export function isLeadDueFilter(value: unknown): value is LeadDueFilter {
	return (
		typeof value === 'string' &&
		(LEAD_DUE_FILTERS as readonly string[]).includes(value)
	);
}
