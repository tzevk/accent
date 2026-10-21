import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import LegacyReviewPanel from '@/components/leads/LegacyReviewPanel';
import type { LeadDetail, LeadReviewState } from '@/components/leads/types';

/**
 * The legacy review panel: the preserved evidence, the facts the old records
 * never stored, and the resolution controls. The successful resolution is
 * proven over real HTTP by the integration harness; this suite covers what
 * the panel shows and what it allows.
 */

const UNKNOWN_FACTS = {
	stage_entry_date: 'unknown',
	original_author: 'unknown',
	original_outcome: 'unknown',
};

function reviewState(
	overrides: Partial<LeadReviewState> = {}
): LeadReviewState {
	return {
		open_items: [
			{
				type: 'stage',
				label: 'Lead Stage',
				original_value: 'Converted to Proposal',
			},
		],
		resolutions: [],
		linked_proposals: [],
		canonical_proposal_id: null,
		proposal_link_conflict: false,
		unknown_facts: UNKNOWN_FACTS,
		...overrides,
	};
}

function renderPanel(
	review: LeadReviewState,
	permissions: {
		canReviewStage?: boolean;
		canReviewOwner?: boolean;
		canReviewProposal?: boolean;
	} = {}
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const lead = { id: 7, review } as Pick<LeadDetail, 'id' | 'review'>;
	return render(
		<QueryClientProvider client={client}>
			<LegacyReviewPanel
				lead={lead}
				owners={[{ id: 3, full_name: 'Alex Reviewer' }]}
				canReviewStage={permissions.canReviewStage ?? true}
				canReviewOwner={permissions.canReviewOwner ?? true}
				canReviewProposal={permissions.canReviewProposal ?? true}
			/>
		</QueryClientProvider>
	);
}

describe('LegacyReviewPanel', () => {
	it('shows the preserved original value of an open item', () => {
		renderPanel(reviewState());

		expect(screen.getByText('Converted to Proposal')).toBeInTheDocument();
		expect(screen.getByText(/needs? a decision/)).toBeInTheDocument();
	});

	it('states the facts the legacy records never stored as unknown', () => {
		renderPanel(reviewState());

		expect(screen.getByText('Stage entered:')).toBeInTheDocument();
		expect(screen.getByText('Original author:')).toBeInTheDocument();
		expect(screen.getByText('Call outcome:')).toBeInTheDocument();
		expect(screen.getAllByText('unknown')).toHaveLength(3);
	});

	it('offers the resolution controls to a permitted reviewer', () => {
		renderPanel(reviewState());

		expect(screen.getByLabelText('Resolve the stage as')).toBeInTheDocument();
		expect(
			screen.getByLabelText('Reason for the resolution')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Resolve lead stage' })
		).toBeInTheDocument();
	});

	it('hides the resolution controls from a reviewer without the right', () => {
		renderPanel(reviewState(), { canReviewStage: false });

		expect(
			screen.queryByLabelText('Resolve the stage as')
		).not.toBeInTheDocument();
		expect(
			screen.getByText('You do not have the permission to resolve this item.')
		).toBeInTheDocument();
	});

	it('refuses a resolution without a reason', () => {
		renderPanel(reviewState());

		fireEvent.click(screen.getByRole('button', { name: 'Resolve lead stage' }));

		expect(screen.getByRole('alert')).toHaveTextContent(
			'A resolution needs a reason.'
		);
	});

	it('lists the linked Proposals of a canonical link decision', () => {
		renderPanel(
			reviewState({
				open_items: [
					{
						type: 'proposal_link',
						label: 'Canonical Proposal',
						original_value: '11, 12',
					},
				],
				proposal_link_conflict: true,
				linked_proposals: [
					{
						id: 11,
						proposal_title: 'First proposal',
						proposal_id: null,
						quotation_number: null,
						status: 'DRAFT',
						created_at: null,
						is_deleted: false,
						is_canonical: false,
					},
					{
						id: 12,
						proposal_title: 'Second proposal',
						proposal_id: null,
						quotation_number: null,
						status: 'DRAFT',
						created_at: null,
						is_deleted: false,
						is_canonical: false,
					},
				],
			})
		);

		// The title appears in the evidence list and in the selection control.
		expect(
			screen.getAllByText('Proposal #11 — First proposal').length
		).toBeGreaterThan(0);
		expect(
			screen.getAllByText('Proposal #12 — Second proposal').length
		).toBeGreaterThan(0);
	});

	it('shows the recorded decisions with the reviewer and the reason', () => {
		renderPanel(
			reviewState({
				open_items: [],
				resolutions: [
					{
						id: 3,
						review_type: 'owner',
						original_value: 'Nobody Here',
						resolved_value: 'Alex Reviewer',
						resolved_reference: 3,
						reason: 'Matched the sales rep in the 2024 roster.',
						resolution_source: 'reviewer',
						reviewer_user_id: 5,
						reviewer_name: 'Casey Manager',
						resolved_at: '2026-10-19T10:00:00.000Z',
					},
				],
			})
		);

		expect(screen.getByText(/Nobody Here → Alex Reviewer/)).toBeInTheDocument();
		expect(screen.getByText(/Reviewed by Casey Manager/)).toBeInTheDocument();
		expect(
			screen.getByText('Reason: Matched the sales rep in the 2024 roster.')
		).toBeInTheDocument();
	});
});
