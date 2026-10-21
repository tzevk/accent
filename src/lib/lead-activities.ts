/**
 * Canonical Lead activity vocabulary (ticket #371).
 *
 * Client-safe: this module has no server imports, so the interface, the
 * server workflow and the tests share one vocabulary without a second
 * convention. Persistence authority is `lead_activities`; this file is only
 * the shared vocabulary and the shapes the HTTP interface exchanges.
 *
 * Three different questions, three different columns:
 * - `LEAD_ACTIVITY_TYPES` — what kind of work happened.
 * - `LEAD_CALL_OUTCOMES` — what happened during a call.
 * - `LEAD_WORK_STATUSES` — whether the work is scheduled, completed, or
 *   cancelled.
 * A future task needs no call outcome, and a completed call may well have
 * "No Answer".
 */

export const LEAD_ACTIVITY_TYPES = [
	'Call',
	'Email',
	'Meeting',
	'Note',
] as const;

export type LeadActivityType = (typeof LEAD_ACTIVITY_TYPES)[number];

export const LEAD_CALL_OUTCOMES = [
	'Connected',
	'No Answer',
	'Busy',
	'Voicemail',
	'Wrong Number',
] as const;

export type LeadCallOutcome = (typeof LEAD_CALL_OUTCOMES)[number];

export const LEAD_WORK_STATUSES = [
	'Scheduled',
	'Completed',
	'Cancelled',
] as const;

export type LeadWorkStatus = (typeof LEAD_WORK_STATUSES)[number];

/**
 * Outreach kinds: the work that reaches the client. A note is not outreach
 * and never counts as a contact attempt.
 */
export const LEAD_OUTREACH_TYPES = ['Call', 'Email', 'Meeting'] as const;

export function isLeadActivityType(value: unknown): value is LeadActivityType {
	return (
		typeof value === 'string' &&
		(LEAD_ACTIVITY_TYPES as readonly string[]).includes(value)
	);
}

export function isLeadCallOutcome(value: unknown): value is LeadCallOutcome {
	return (
		typeof value === 'string' &&
		(LEAD_CALL_OUTCOMES as readonly string[]).includes(value)
	);
}

export function isLeadWorkStatus(value: unknown): value is LeadWorkStatus {
	return (
		typeof value === 'string' &&
		(LEAD_WORK_STATUSES as readonly string[]).includes(value)
	);
}

/** True for the kinds that reach the client: call, email, and meeting. */
export function isLeadOutreachType(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		(LEAD_OUTREACH_TYPES as readonly string[]).includes(value)
	);
}

/**
 * One chronological entry of the Lead timeline. `occurred_at` is null when
 * the moment is unknown (legacy rows, scheduled work that did not happen
 * yet); `recorded_at` is when the evidence was written.
 */
export interface LeadTimelineEntry {
	key: string;
	kind:
		| 'activity'
		| 'stage_change'
		| 'owner_change'
		| 'correction'
		| 'conversion';
	occurred_at: string | null;
	recorded_at: string | null;
	title: string;
	detail: string | null;
	actor_name: string | null;
	status: string | null;
	activity_type: string | null;
	call_outcome: string | null;
	legacy: boolean;
}

/** The current Lead work summary the detail and list reads expose. */
export interface LeadWorkSummary {
	last_contact_at: string | null;
	latest_activity_at: string | null;
	latest_activity_outcome: string | null;
	next_action_date: string | null;
	next_action_type: string | null;
	activity_count: number;
}
