import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeadConversionAction from '@/components/leads/LeadConversionAction';
import { LEAD_CONVERSION_MESSAGES } from '@/lib/lead-conversion';

/**
 * The conversion action of the Lead screens: the labelled controls, the
 * refusals attached to their field, and the navigation to the Proposal of
 * the enquiry. The handoff itself is proven over real HTTP by the
 * integration harness; this suite covers what the person sees.
 */

const fetchMock = vi.fn();
const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: pushMock }),
}));

const lead = {
	id: 7,
	company_name: 'Cleo Infra',
	enquiry_status: 'Qualified',
	canonical_proposal_id: null,
	contact_name: 'Cleo Client',
	contact_email: 'cleo@example.com',
	inquiry_email: null,
	cc_emails: null,
	phone: null,
	project_description: 'A plant extension for the workshop',
	owner_user_id: 3,
	owner_name: 'Ada Owner',
};

function renderAction(
	overrides: Partial<typeof lead> = {},
	canConvert = true
): void {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<LeadConversionAction
				lead={{ ...lead, ...overrides }}
				canConvert={canConvert}
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

describe('LeadConversionAction', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		pushMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
	});

	it('offers the handoff of a qualified lead', () => {
		renderAction();

		expect(
			screen.getByRole('button', { name: 'Convert to Proposal' })
		).toBeInTheDocument();
	});

	it('asks for the proposal title and shows the conversion facts', () => {
		renderAction();

		fireEvent.click(
			screen.getByRole('button', { name: 'Convert to Proposal' })
		);

		expect(screen.getByLabelText('Proposal title')).toBeInTheDocument();
		expect(screen.getByText('Cleo Client')).toBeInTheDocument();
		expect(
			screen.getByText('A plant extension for the workshop')
		).toBeInTheDocument();
		expect(screen.getByText('Ada Owner')).toBeInTheDocument();
	});

	it('sends one request to the handoff route', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				success: true,
				data: {
					proposal_id: 42,
					proposal: {},
					already_converted: false,
				},
			}),
		});
		renderAction();

		fireEvent.click(
			screen.getByRole('button', { name: 'Convert to Proposal' })
		);
		fireEvent.change(screen.getByLabelText('Proposal title'), {
			target: { value: 'Chakan proposal' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Convert lead' }));

		await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/proposals/42'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/leads/7/convert');
		expect(JSON.parse(String(init.body))).toEqual({
			proposal_title: 'Chakan proposal',
		});
	});

	it('attaches a refusal to the field it belongs to', async () => {
		refusal(LEAD_CONVERSION_MESSAGES.contact_name_required);
		renderAction();

		fireEvent.click(
			screen.getByRole('button', { name: 'Convert to Proposal' })
		);
		fireEvent.click(screen.getByRole('button', { name: 'Convert lead' }));

		await waitFor(() =>
			expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
		);
		expect(
			screen.getByText(LEAD_CONVERSION_MESSAGES.contact_name_required)
		).toBeInTheDocument();
		expect(pushMock).not.toHaveBeenCalled();
	});

	it('shows the canonical Proposal conflict of the enquiry', async () => {
		refusal(LEAD_CONVERSION_MESSAGES.conversion_conflict);
		renderAction();

		fireEvent.click(
			screen.getByRole('button', { name: 'Convert to Proposal' })
		);
		fireEvent.click(screen.getByRole('button', { name: 'Convert lead' }));

		await waitFor(() =>
			expect(
				screen.getByText(LEAD_CONVERSION_MESSAGES.conversion_conflict)
			).toBeInTheDocument()
		);
	});

	it('refuses a lead that is not qualified and names the required stage', () => {
		renderAction({ enquiry_status: 'Connected' });

		expect(
			screen.getByRole('button', { name: 'Convert to Proposal' })
		).toBeDisabled();
		expect(
			screen.getByText(LEAD_CONVERSION_MESSAGES.stage_required)
		).toBeInTheDocument();
	});

	it('opens the Proposal of an enquiry that is already converted', () => {
		renderAction({
			enquiry_status: 'Converted',
			canonical_proposal_id: 42,
		});

		expect(
			screen.queryByRole('button', { name: 'Convert to Proposal' })
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Open Proposal #42' }));
		expect(pushMock).toHaveBeenCalledWith('/proposals/42');
	});

	it('says nothing about the handoff without the permission', () => {
		renderAction({}, false);

		expect(
			screen.queryByRole('button', { name: 'Convert to Proposal' })
		).not.toBeInTheDocument();
		expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
	});
});
