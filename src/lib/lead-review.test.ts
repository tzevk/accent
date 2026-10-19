import { describe, it, expect } from 'vitest';
import {
	legacyReviewRequired,
	openLegacyReviewItems,
	type LegacyReviewLeadState,
} from '@/lib/lead-review';

/**
 * Which legacy facts still need a human decision. Pure inputs, no clock and
 * no database: the derivation is the single definition the server workflow,
 * the read model and the review panel share.
 */

function state(
	overrides: Partial<LegacyReviewLeadState> = {}
): LegacyReviewLeadState {
	return {
		enquiry_status: null,
		owner_user_id: null,
		legacy_stage: null,
		legacy_owner_name: null,
		legacy_stage_reviewed: false,
		legacy_owner_reviewed: false,
		legacy_proposal_reviewed: false,
		legacy_proposal_conflict: false,
		canonical_proposal_id: null,
		...overrides,
	};
}

describe('openLegacyReviewItems', () => {
	it('reports a legacy stage that never became a canonical stage', () => {
		const items = openLegacyReviewItems(
			state({ legacy_stage: 'Converted to Proposal' })
		);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			type: 'stage',
			original_value: 'Converted to Proposal',
		});
	});

	it('reports a legacy owner name that resolved to no user', () => {
		const items = openLegacyReviewItems(
			state({ legacy_owner_name: 'Nobody Here' })
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.type).toBe('owner');
		expect(items[0]?.original_value).toBe('Nobody Here');
	});

	it('reports several linked Proposals as one canonical-link decision', () => {
		const items = openLegacyReviewItems(
			state({ legacy_proposal_conflict: true })
		);

		expect(items).toHaveLength(1);
		expect(items[0]?.type).toBe('proposal_link');
	});

	it('keeps an evidence-backed mapping out of the review queue', () => {
		// The stage mapped and the owner resolved: nothing to decide.
		const items = openLegacyReviewItems(
			state({
				enquiry_status: 'Qualified',
				owner_user_id: 7,
				legacy_stage: 'Qualified',
				legacy_owner_name: 'Sales Person',
			})
		);

		expect(items).toEqual([]);
	});

	it('closes the owner item when a reviewer decided there is no owner', () => {
		// owner_user_id stays null on purpose: "no owner" is a decision.
		const items = openLegacyReviewItems(
			state({
				legacy_owner_name: 'Left The Company',
				legacy_owner_reviewed: true,
			})
		);

		expect(items).toEqual([]);
	});

	it('closes the proposal item once a canonical Proposal is selected', () => {
		const items = openLegacyReviewItems(
			state({
				legacy_proposal_conflict: true,
				canonical_proposal_id: 42,
			})
		);

		expect(items).toEqual([]);
	});

	it('keeps the original value verbatim', () => {
		const items = openLegacyReviewItems(
			state({ legacy_stage: '  Attempting contact  ' })
		);

		expect(items[0]?.original_value).toBe('  Attempting contact  ');
	});
});

describe('legacyReviewRequired', () => {
	it('is false for a lead with no legacy evidence', () => {
		expect(legacyReviewRequired(state())).toBe(false);
	});

	it('is true while any dimension is undecided', () => {
		expect(
			legacyReviewRequired(
				state({ legacy_stage: 'Awaiting', legacy_owner_name: 'X' })
			)
		).toBe(true);
	});
});
