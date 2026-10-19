/**
 * Legacy Lead review vocabulary (ticket #370).
 *
 * Client-safe: no server imports, so the App Router review panel and the
 * server workflow share one vocabulary, one derivation of "what still needs
 * a human decision", and one set of types — without a second convention.
 *
 * Three review dimensions exist, one per legacy fact the cutover could not
 * resolve from evidence:
 * - `stage` — the stored stage label was not a canonical stage.
 * - `owner` — the stored owner display name did not resolve to one user.
 * - `proposal_link` — more than one Proposal links to the enquiry.
 *
 * A review item is OPEN while the legacy fact is still undecided. Resolving
 * it records the decision in `lead_legacy_reviews` and sets the matching
 * `legacy_*_reviewed` flag on the Lead, so the open set shrinks without any
 * history being rewritten.
 */
export const LEGACY_REVIEW_TYPES = ['stage', 'owner', 'proposal_link'] as const;

export type LegacyReviewType = (typeof LEGACY_REVIEW_TYPES)[number];

/** How a resolution was reached. `automatic` never had a human reviewer. */
export const LEGACY_RESOLUTION_SOURCES = ['reviewer', 'automatic'] as const;

export type LegacyResolutionSource = (typeof LEGACY_RESOLUTION_SOURCES)[number];

/** Short, human labels for the three review dimensions. */
export const LEGACY_REVIEW_LABELS: Record<LegacyReviewType, string> = {
	stage: 'Lead Stage',
	owner: 'Lead Owner',
	proposal_link: 'Canonical Proposal',
};

/**
 * The Lead resource right each decision needs. The canonical Proposal
 * decision also needs the Proposal read right: the reviewer has to be able
 * to see the Proposals the choice is made between.
 */
export const LEGACY_REVIEW_PERMISSIONS: Record<
	LegacyReviewType,
	'update' | 'assign'
> = {
	stage: 'update',
	owner: 'assign',
	proposal_link: 'update',
};

export function isLegacyReviewType(value: unknown): value is LegacyReviewType {
	return (
		typeof value === 'string' &&
		(LEGACY_REVIEW_TYPES as readonly string[]).includes(value)
	);
}

/**
 * The Lead fields the review state is derived from. Every field is a stored
 * fact; nothing here is inferred from a timestamp.
 */
export interface LegacyReviewLeadState {
	enquiry_status: string | null;
	owner_user_id: number | null;
	legacy_stage: string | null;
	legacy_owner_name: string | null;
	legacy_stage_reviewed: boolean;
	legacy_owner_reviewed: boolean;
	legacy_proposal_reviewed: boolean;
	legacy_proposal_conflict: boolean;
	canonical_proposal_id: number | null;
}

export interface OpenLegacyReviewItem {
	type: LegacyReviewType;
	label: string;
	/** The original stored value, verbatim. Never trimmed or rewritten. */
	original_value: string | null;
}

/**
 * Facts the legacy records never stored. They stay explicitly unknown: the
 * creation and update timestamps of a Lead are not stage-entry times and are
 * not a substitute for a missing author or call outcome.
 */
export const LEGACY_UNKNOWN_FACTS = {
	stage_entry_date: 'unknown',
	original_author: 'unknown',
	original_outcome: 'unknown',
} as const;

export type LegacyUnknownFacts = typeof LEGACY_UNKNOWN_FACTS;

/** One recorded decision. Automatic cutover decisions have no reviewer. */
export interface LegacyReviewResolution {
	id: number;
	review_type: LegacyReviewType;
	original_value: string | null;
	resolved_value: string | null;
	resolved_reference: number | null;
	reason: string;
	resolution_source: LegacyResolutionSource;
	reviewer_user_id: number | null;
	reviewer_name: string | null;
	resolved_at: string | null;
}

/** A Proposal that references the enquiry. */
export interface LinkedProposalSummary {
	id: number;
	proposal_title: string | null;
	proposal_id: string | null;
	quotation_number: string | null;
	status: string | null;
	created_at: string | null;
	is_deleted: boolean;
	is_canonical: boolean;
}

export interface LeadReviewState {
	open_items: OpenLegacyReviewItem[];
	resolutions: LegacyReviewResolution[];
	linked_proposals: LinkedProposalSummary[];
	canonical_proposal_id: number | null;
	proposal_link_conflict: boolean;
	unknown_facts: LegacyUnknownFacts;
}

/**
 * The open review items for one Lead.
 *
 * - `stage` is open while a legacy stage label exists, the Lead still has no
 *   canonical stage, and no reviewer decided the stage.
 * - `owner` is open while a legacy owner name exists, the Lead still has no
 *   resolved owner, and no reviewer decided the owner. A reviewer may decide
 *   "no owner" — the decision closes the item without inventing a user.
 * - `proposal_link` is open while several Proposals link to the enquiry and
 *   no canonical Proposal was selected.
 */
export function openLegacyReviewItems(
	state: LegacyReviewLeadState
): OpenLegacyReviewItem[] {
	const items: OpenLegacyReviewItem[] = [];
	if (
		state.legacy_stage !== null &&
		state.enquiry_status === null &&
		!state.legacy_stage_reviewed
	) {
		items.push({
			type: 'stage',
			label: LEGACY_REVIEW_LABELS.stage,
			original_value: state.legacy_stage,
		});
	}
	if (
		state.legacy_owner_name !== null &&
		state.owner_user_id === null &&
		!state.legacy_owner_reviewed
	) {
		items.push({
			type: 'owner',
			label: LEGACY_REVIEW_LABELS.owner,
			original_value: state.legacy_owner_name,
		});
	}
	if (
		state.legacy_proposal_conflict &&
		state.canonical_proposal_id === null &&
		!state.legacy_proposal_reviewed
	) {
		items.push({
			type: 'proposal_link',
			label: LEGACY_REVIEW_LABELS.proposal_link,
			original_value: null,
		});
	}
	return items;
}

/**
 * One flag for the whole Lead: true while any dimension is still undecided.
 * The list filter and the counter read this value, so a resolved Lead leaves
 * the review queue but never leaves the operational results. The migration
 * computes the same flag in SQL for the cutover; this function is the
 * runtime definition.
 */
export function legacyReviewRequired(state: LegacyReviewLeadState): boolean {
	return openLegacyReviewItems(state).length > 0;
}
