/**
 * Canonical Lead Stage vocabulary (ticket #369).
 *
 * Client-safe: this module has no server imports, so App Router client
 * components and the server workflow share one vocabulary without a second
 * convention. Persistence authority is `leads.enquiry_status` (canonical
 * string or NULL for unresolved); this file is only the shared vocabulary.
 */
export const LEAD_STAGES = [
	'New',
	'Attempting Contact',
	'Connected',
	'Qualified',
	'Nurture',
	'Disqualified',
	'Converted',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

/**
 * Stages that keep a Lead in the active work queue. They require a resolved
 * owner and a dated next action (`follow_up_date`).
 */
export const ACTIVE_LEAD_STAGES = [
	'Attempting Contact',
	'Connected',
	'Qualified',
	'Nurture',
] as const;

export type ActiveLeadStage = (typeof ACTIVE_LEAD_STAGES)[number];

export function isLeadStage(value: unknown): value is LeadStage {
	return (
		typeof value === 'string' &&
		(LEAD_STAGES as readonly string[]).includes(value)
	);
}

export function isActiveLeadStage(value: unknown): value is ActiveLeadStage {
	return (
		typeof value === 'string' &&
		(ACTIVE_LEAD_STAGES as readonly string[]).includes(value)
	);
}
