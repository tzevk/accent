import type { LeadStage } from '@/lib/lead-stages';

/**
 * The explicit Lead lifecycle decisions (ticket #373).
 *
 * Client-safe: this module has no server imports, so the interface, the
 * server workflow, and the tests share one vocabulary without a second
 * convention. Persistence authority stays with the server: this file only
 * says which decisions exist, which stage each one moves the Lead to, and
 * which stages a decision may be taken from.
 *
 * The four decisions are accountable, human decisions. They are never
 * inferred from an activity, and an automatic activity update never
 * overwrites one of them.
 */

/** The four explicit decisions a person makes on a Lead. */
export const LEAD_LIFECYCLE_ACTIONS = [
	'Qualify',
	'Nurture',
	'Disqualify',
	'Reopen',
] as const;

export type LeadLifecycleAction = (typeof LEAD_LIFECYCLE_ACTIONS)[number];

export function isLeadLifecycleAction(
	value: unknown
): value is LeadLifecycleAction {
	return (
		typeof value === 'string' &&
		(LEAD_LIFECYCLE_ACTIONS as readonly string[]).includes(value)
	);
}

/**
 * The stage each decision moves the Lead to.
 *
 * A reopened Lead returns to the active outreach queue, because reopening
 * puts the Lead back into work with an owner and a dated next action. The
 * earlier disqualification stays in the stage history.
 */
export const LEAD_LIFECYCLE_TARGET_STAGE: Readonly<
	Record<LeadLifecycleAction, LeadStage>
> = {
	Qualify: 'Qualified',
	Nurture: 'Nurture',
	Disqualify: 'Disqualified',
	Reopen: 'Attempting Contact',
};

/**
 * The stages a decision may be taken from.
 *
 * A disqualified Lead is reopened, never qualified or nurtured directly: the
 * decision that closed it has to be answered first. A converted Lead takes
 * no lifecycle decision at all; its routine sales work belongs to the
 * linked Proposal.
 */
export const LEAD_LIFECYCLE_SOURCE_STAGES: Readonly<
	Record<LeadLifecycleAction, readonly LeadStage[]>
> = {
	Qualify: ['New', 'Attempting Contact', 'Connected', 'Nurture'],
	Nurture: ['New', 'Attempting Contact', 'Connected', 'Qualified'],
	Disqualify: [
		'New',
		'Attempting Contact',
		'Connected',
		'Qualified',
		'Nurture',
	],
	Reopen: ['Disqualified'],
};

/**
 * Whether the decision may be taken from the stage the Lead is in now. An
 * unresolved stage is no stage: the operator resolves the legacy value
 * before deciding anything.
 */
export function canApplyLeadLifecycleAction(
	action: LeadLifecycleAction,
	currentStage: LeadStage | null
): boolean {
	if (currentStage === null) return false;
	return LEAD_LIFECYCLE_SOURCE_STAGES[action].includes(currentStage);
}

/** The decisions that close or reopen the Lead: they need a reason. */
export const LEAD_LIFECYCLE_REASON_ACTIONS: readonly LeadLifecycleAction[] = [
	'Disqualify',
	'Reopen',
];

/**
 * The decisions that put the Lead back into active work: they need a
 * resolved owner and a dated next action.
 */
export const LEAD_LIFECYCLE_ACTIVE_ACTIONS: readonly LeadLifecycleAction[] = [
	'Qualify',
	'Nurture',
	'Reopen',
];

/** The decisions that read the qualification facts of the Lead. */
export const LEAD_LIFECYCLE_QUALIFICATION_ACTIONS: readonly LeadLifecycleAction[] =
	['Qualify'];

/**
 * The decisions that may set the owner. A disqualification does not change
 * who is responsible for the Lead.
 */
export const LEAD_LIFECYCLE_OWNER_ACTIONS: readonly LeadLifecycleAction[] = [
	'Qualify',
	'Nurture',
	'Reopen',
];

/** The field of the decision form a refusal belongs to. */
export type LeadLifecycleField =
	| 'action'
	| 'reason'
	| 'owner'
	| 'next_action'
	| 'contact_name'
	| 'contact_details'
	| 'project_need';

/**
 * The refusal messages of the lifecycle. One message per refusal, shared by
 * the server module and the interface, so the interface can attach the
 * refusal to the field it belongs to without guessing.
 */
export const LEAD_LIFECYCLE_MESSAGES = {
	action_invalid: 'Choose Qualify, Nurture, Disqualify, or Reopen.',
	action_not_allowed:
		'This decision is not available for the current stage of the lead.',
	action_stage_unresolved:
		'Resolve the lead stage before making this decision.',
	action_owner_not_allowed: 'A disqualification does not change the owner.',
	reason_required: 'This decision needs a reason.',
	reason_too_long: 'The reason of this decision is too long.',
	owner_required: 'This decision needs a lead owner.',
	owner_unknown: 'That owner is not an active user.',
	next_action_required: 'This decision needs a dated next action.',
	next_action_invalid: 'The next action needs a valid date.',
	next_action_type_invalid:
		'The next action type must be Call, Email, Meeting, or Note.',
	contact_name_required: 'A qualified lead needs a named contact.',
	contact_details_required:
		'A qualified lead needs a usable phone number or email address.',
	project_need_required: 'A qualified lead needs a clear project need.',
	lead_converted:
		'This lead is converted; new sales work belongs to the linked proposal',
} as const;

/**
 * The field every refusal message belongs to. The interface attaches a
 * refusal to its field through this map, so no refusal is shown as a
 * message without a home.
 */
export const LEAD_LIFECYCLE_FIELD_BY_MESSAGE: Readonly<
	Record<string, LeadLifecycleField>
> = {
	[LEAD_LIFECYCLE_MESSAGES.action_invalid]: 'action',
	[LEAD_LIFECYCLE_MESSAGES.action_not_allowed]: 'action',
	[LEAD_LIFECYCLE_MESSAGES.action_stage_unresolved]: 'action',
	[LEAD_LIFECYCLE_MESSAGES.action_owner_not_allowed]: 'action',
	[LEAD_LIFECYCLE_MESSAGES.reason_required]: 'reason',
	[LEAD_LIFECYCLE_MESSAGES.reason_too_long]: 'reason',
	[LEAD_LIFECYCLE_MESSAGES.owner_required]: 'owner',
	[LEAD_LIFECYCLE_MESSAGES.owner_unknown]: 'owner',
	[LEAD_LIFECYCLE_MESSAGES.next_action_required]: 'next_action',
	[LEAD_LIFECYCLE_MESSAGES.next_action_invalid]: 'next_action',
	[LEAD_LIFECYCLE_MESSAGES.next_action_type_invalid]: 'next_action',
	[LEAD_LIFECYCLE_MESSAGES.contact_name_required]: 'contact_name',
	[LEAD_LIFECYCLE_MESSAGES.contact_details_required]: 'contact_details',
	[LEAD_LIFECYCLE_MESSAGES.project_need_required]: 'project_need',
	[LEAD_LIFECYCLE_MESSAGES.lead_converted]: 'action',
};
