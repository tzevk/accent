import type { LeadStage } from '@/lib/lead-stages';

/**
 * The downstream vocabulary of a converted Lead (ticket #376).
 *
 * Client-safe: this module has no server imports, so the interface, the
 * server read, and the tests share one vocabulary without a second
 * convention.
 *
 * The rules of the slice:
 * - The canonical Proposal of an enquiry is resolved through the stored
 *   link, never through a name match, a newest-date guess, or a second
 *   link. A Lead that has no canonical Proposal and no linked Proposal has
 *   no downstream details at all.
 * - A Lead that has linked Proposals but no canonical choice is
 *   unresolved: a reviewer decides, the server never guesses.
 * - A reader who may not read the Proposals gets the Lead, its history,
 *   and a restricted marker — never a Proposal title, status, value, or
 *   Project information.
 * - A converted Lead takes no new Lead-side sales work: its next action
 *   belongs to the Proposal that replaced it.
 * - Converted is a handoff, never a sale won. The Proposal keeps its own
 *   status vocabulary, and this module never renames it.
 */

/** Why the Proposal details of an enquiry are missing, or that they are there. */
export const LEAD_PROPOSAL_LINK_STATES = [
	'none',
	'unresolved',
	'restricted',
	'available',
] as const;

export type LeadProposalLinkState = (typeof LEAD_PROPOSAL_LINK_STATES)[number];

/** Why the Project details of a Proposal are missing, or that they are there. */
export const LEAD_PROJECT_LINK_STATES = [
	'none',
	'restricted',
	'available',
] as const;

export type LeadProjectLinkState = (typeof LEAD_PROJECT_LINK_STATES)[number];

/** The next action of the Proposal that replaced the Lead work. */
export interface LeadProposalNextAction {
	date: string | null;
	type: string | null;
	description: string | null;
}

/** The Project a Proposal later links to. */
export interface LeadProjectSummary {
	id: number;
	title: string | null;
	status: string | null;
	progress: number | null;
}

/** The canonical Proposal of an enquiry, as the Lead detail read exposes it. */
export interface LeadProposalSummary {
	id: number;
	title: string | null;
	status: string | null;
	progress: number | null;
	/** The commercial value, as the exact decimal the Proposal stores. */
	value: string | null;
	currency: string | null;
	next_action: LeadProposalNextAction | null;
	project_state: LeadProjectLinkState;
	project: LeadProjectSummary | null;
}

/** The downstream block of the Lead detail read. */
export interface LeadProposalProgress {
	state: LeadProposalLinkState;
	proposal: LeadProposalSummary | null;
}

/** The facts the Proposal link decision needs. */
export interface LeadProposalLinkFacts {
	/** The canonical Proposal of the enquiry, when the stored link resolves. */
	canonical_proposal_id: number | null;
	/** The live Proposals linked to the enquiry. */
	linked_proposal_count: number;
	/** Whether the reader may read the Proposals. */
	can_read_proposals: boolean;
}

/**
 * The state of the Proposal link of an enquiry.
 *
 * - No canonical Proposal and no linked Proposal: the enquiry has no
 *   downstream details yet.
 * - No canonical Proposal but linked Proposals: the link is unresolved and
 *   a reviewer has to choose.
 * - A canonical Proposal the reader may not read: the details are
 *   restricted, and nothing of the Proposal is exposed.
 * - A canonical Proposal the reader may read: the details are available.
 */
export function leadProposalLinkState(
	facts: LeadProposalLinkFacts
): LeadProposalLinkState {
	if (facts.canonical_proposal_id === null) {
		return facts.linked_proposal_count > 0 ? 'unresolved' : 'none';
	}
	return facts.can_read_proposals ? 'available' : 'restricted';
}

/** The facts the Project link decision needs. */
export interface LeadProjectLinkFacts {
	/** The Project the Proposal links to, when it has one. */
	project_id: number | null;
	/** Whether the reader may read the Projects. */
	can_read_projects: boolean;
}

/**
 * The state of the Project link of a Proposal: none while the Proposal has
 * no Project, restricted while the reader may not read the Projects, and
 * available otherwise.
 */
export function leadProjectLinkState(
	facts: LeadProjectLinkFacts
): LeadProjectLinkState {
	if (facts.project_id === null) return 'none';
	return facts.can_read_projects ? 'available' : 'restricted';
}

/** Where the next action of a Lead belongs. */
export type LeadNextActionOwner = 'lead' | 'proposal';

/**
 * Where the next action of a Lead belongs. A converted Lead takes no new
 * Lead-side sales work, so its next action is the next action of the
 * Proposal that replaced it.
 */
export function leadNextActionOwner(
	stage: LeadStage | string | null | undefined
): LeadNextActionOwner {
	return stage === 'Converted' ? 'proposal' : 'lead';
}

/**
 * The messages of the downstream panel. One message per state, shared by
 * the server read and the interface, so a missing, an unresolved, and a
 * restricted detail never look alike.
 */
export const LEAD_PROGRESS_MESSAGES = {
	none: 'This enquiry has no Proposal yet.',
	unresolved:
		'The canonical Proposal of this enquiry is unresolved. A reviewer chooses it in the legacy review panel.',
	restricted:
		'The Proposal details of this enquiry need the proposal read permission.',
	project_restricted:
		'The Project details of this Proposal need the project read permission.',
	no_project: 'This Proposal has no Project yet.',
	no_next_action: 'The Proposal has no open next action.',
} as const;
