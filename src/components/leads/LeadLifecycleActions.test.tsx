import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeadLifecycleActions from '@/components/leads/LeadLifecycleActions';
import { LEAD_LIFECYCLE_MESSAGES } from '@/lib/lead-lifecycle';
import type { LeadStage } from '@/lib/lead-stages';

/**
 * The lifecycle panel: which decisions the stage allows, what each decision
 * asks for, and where a refusal lands. The decision itself is proven over
 * real HTTP by the integration harness; this suite covers the labelled
 * controls and the messages the person sees.
 */

const fetchMock = vi.fn();

const lead = {
	id: 7,
	enquiry_status: 'New' as LeadStage | null,
	owner_user_id: 3,
	owner_name: 'Ada Owner',
	next_action_date: null,
	contact_name: 'Cleo Client',
	contact_email: 'cleo@example.com',
	inquiry_email: null,
	cc_emails: null,
	phone: null,
	project_description: 'A plant extension for the workshop',
};

const owners = [
	{ id: 3, full_name: 'Ada Owner' },
	{ id: 4, full_name: 'Ben Owner' },
];

function renderPanel(
	overrides: Partial<typeof lead> = {},
	canDecide = true
): void {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<LeadLifecycleActions
				lead={{ ...lead, ...overrides }}
				owners={owners}
				canDecide={canDecide}
			/>
		</QueryClientProvider>
	);
}

function refusal(message: string): void {
	fetchMock.mockResolvedValue({
		ok: false,
		status: 422,
		json: async () => ({ success: false, error: message, code: 'refused' }),
	});
}

describe('LeadLifecycleActions', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	it('offers the decisions the stage of the lead allows', () => {
		renderPanel();

		expect(screen.getByRole('button', { name: 'Qualify' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Nurture' })).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Disqualify' })
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Reopen' })
		).not.toBeInTheDocument();
	});

	it('offers the reopening of a disqualified lead only', () => {
		renderPanel({ enquiry_status: 'Disqualified' });

		expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Qualify' })
		).not.toBeInTheDocument();
	});

	it('takes no decision for a converted lead', () => {
		renderPanel({ enquiry_status: 'Converted' });

		expect(
			screen.queryByRole('button', { name: 'Qualify' })
		).not.toBeInTheDocument();
		expect(
			screen.getByText(/routine sales work belongs to the linked proposal/i)
		).toBeInTheDocument();
	});

	it('asks for a reason before a disqualification', () => {
		renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'Disqualify' }));

		expect(screen.getByLabelText('Reason')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Apply Disqualify' }));

		expect(screen.getByRole('alert')).toHaveTextContent(
			LEAD_LIFECYCLE_MESSAGES.reason_required
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('asks for the next action when the lead has none', () => {
		renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'Qualify' }));

		expect(screen.getByLabelText('Next action date')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Apply Qualify' }));

		expect(screen.getByRole('alert')).toHaveTextContent(
			LEAD_LIFECYCLE_MESSAGES.next_action_invalid
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps the dated next action of the lead', () => {
		renderPanel({ next_action_date: '2026-11-04' });

		fireEvent.click(screen.getByRole('button', { name: 'Nurture' }));

		expect(screen.queryByLabelText('Next action date')).not.toBeInTheDocument();
		expect(screen.getByText(/Next action:/)).toBeInTheDocument();
	});

	it('attaches a refusal to the field it belongs to', async () => {
		refusal(LEAD_LIFECYCLE_MESSAGES.contact_name_required);
		renderPanel({ contact_name: null });

		fireEvent.click(screen.getByRole('button', { name: 'Qualify' }));
		fireEvent.change(screen.getByLabelText('Next action date'), {
			target: { value: '2026-11-04' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Apply Qualify' }));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				LEAD_LIFECYCLE_MESSAGES.contact_name_required
			);
		});
	});

	it('sends the decision with its next action', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				success: true,
				data: {
					stage: 'Qualified',
					next_action_date: '2026-11-04',
					owner_user_id: 3,
				},
			}),
		});
		renderPanel();

		fireEvent.click(screen.getByRole('button', { name: 'Qualify' }));
		fireEvent.change(screen.getByLabelText('Next action date'), {
			target: { value: '2026-11-04' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Apply Qualify' }));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/leads/7/stage');
		expect(JSON.parse(String(init.body))).toEqual({
			action: 'Qualify',
			owner_user_id: 3,
			next_action: { scheduled_for: '2026-11-04' },
		});
		await waitFor(() => {
			expect(screen.getByText(/Qualify recorded/i)).toBeInTheDocument();
		});
	});

	it('hides the panel from a user without the lead update right', () => {
		renderPanel({}, false);

		expect(
			screen.queryByRole('button', { name: 'Qualify' })
		).not.toBeInTheDocument();
		expect(
			screen.getByText(
				'You do not have permission to decide the stage of this lead.'
			)
		).toBeInTheDocument();
	});
});
