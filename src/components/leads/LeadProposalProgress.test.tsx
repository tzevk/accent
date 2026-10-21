import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeadProposalProgressPanel from '@/components/leads/LeadProposalProgress';
import { LEAD_PROGRESS_MESSAGES } from '@/lib/lead-progress';
import type { LeadProposalProgress } from '@/lib/lead-progress';

/**
 * The downstream panel of a Lead: the canonical Proposal, its current
 * progress, and the Project behind it. The read itself is proven over real
 * HTTP by the integration harness; this suite covers the four states the
 * person sees and the navigation they may follow.
 */

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: pushMock }),
}));

const available: LeadProposalProgress = {
	state: 'available',
	proposal: {
		id: 42,
		title: 'Chakan plant extension',
		status: 'SENT',
		progress: 45,
		value: '250000.00',
		currency: 'INR',
		next_action: {
			date: '2026-11-02',
			type: 'Call',
			description: 'Call about the tender',
		},
		project_state: 'none',
		project: null,
	},
};

function renderPanel(progress: LeadProposalProgress | null): void {
	render(<LeadProposalProgressPanel progress={progress} />);
}

describe('LeadProposalProgressPanel', () => {
	beforeEach(() => {
		pushMock.mockReset();
	});

	it('says that the enquiry has no Proposal yet', () => {
		renderPanel({ state: 'none', proposal: null });

		expect(screen.getByText(LEAD_PROGRESS_MESSAGES.none)).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /Open Proposal/ })
		).not.toBeInTheDocument();
	});

	it('says that the canonical Proposal is unresolved', () => {
		renderPanel({ state: 'unresolved', proposal: null });

		expect(
			screen.getByText(LEAD_PROGRESS_MESSAGES.unresolved)
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /Open Proposal/ })
		).not.toBeInTheDocument();
	});

	it('marks the Proposal details of an unauthorized reader as restricted', () => {
		renderPanel({ state: 'restricted', proposal: null });

		expect(
			screen.getByText(LEAD_PROGRESS_MESSAGES.restricted)
		).toBeInTheDocument();
		expect(
			screen.queryByText('Chakan plant extension')
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /Open Proposal/ })
		).not.toBeInTheDocument();
	});

	it('states the current status and progress of the Proposal', () => {
		renderPanel(available);

		expect(screen.getByText('Chakan plant extension')).toBeInTheDocument();
		expect(screen.getByText('SENT')).toBeInTheDocument();
		expect(screen.getByText('45%')).toBeInTheDocument();
		expect(screen.getByText('Next action on the Proposal')).toBeInTheDocument();
		expect(screen.getByText(/Call about the tender/)).toBeInTheDocument();
	});

	it('opens the Proposal of the enquiry', () => {
		renderPanel(available);

		fireEvent.click(screen.getByRole('button', { name: 'Open Proposal #42' }));
		expect(pushMock).toHaveBeenCalledWith('/proposals/42');
	});

	it('shows the Project the Proposal later links to', () => {
		renderPanel({
			state: 'available',
			proposal: {
				...available.proposal!,
				project_state: 'available',
				project: {
					id: 7,
					title: 'Chakan plant project',
					status: 'ACTIVE',
					progress: 20,
				},
			},
		});

		expect(
			screen.getByRole('button', { name: 'Open Project #7' })
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Open Project #7' }));
		expect(pushMock).toHaveBeenCalledWith('/projects/7');
	});

	it('marks the Project of an unauthorized reader as restricted', () => {
		renderPanel({
			state: 'available',
			proposal: { ...available.proposal!, project_state: 'restricted' },
		});

		expect(
			screen.getByText(LEAD_PROGRESS_MESSAGES.project_restricted)
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: /Open Project/ })
		).not.toBeInTheDocument();
	});

	it('says that the Proposal has no Project yet', () => {
		renderPanel(available);

		expect(
			screen.getByText(LEAD_PROGRESS_MESSAGES.no_project)
		).toBeInTheDocument();
	});
});
