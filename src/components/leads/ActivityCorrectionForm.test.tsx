import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActivityCorrectionForm from '@/components/leads/ActivityCorrectionForm';

/**
 * The correction form of a logged Lead activity. The write itself is
 * proven over real HTTP by the integration harness; this suite covers the
 * labelled controls, the retained previous values, the reason the person
 * must give, and the conflict the person sees when the activity changed
 * underneath them.
 */

const fetchMock = vi.hoisted(() => vi.fn());

function jsonResponse(status: number, payload: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
	};
}

const state = {
	activity: {
		id: 12,
		activity_type: 'Call',
		status: 'Completed',
		call_outcome: 'No Answer',
		reply_confirmed: null,
		occurred_at: '2026-10-20T09:00:00',
		notes: 'Nobody answered.',
		version: 2,
	},
	corrections: [
		{
			id: 1,
			activity_id: 12,
			reason: 'The outcome was wrong.',
			previous_values: {
				activity_type: 'Call',
				call_outcome: 'No Answer',
				reply_confirmed: null,
				occurred_at: '2026-10-20T09:00:00',
				notes: 'Nobody answered.',
			},
			corrected_values: {
				activity_type: 'Call',
				call_outcome: 'Connected',
				reply_confirmed: null,
				occurred_at: '2026-10-20T09:00:00',
				notes: 'Nobody answered.',
			},
			corrected_by: 3,
			actor_name: 'Alex Caller',
			corrected_at: '2026-10-20T10:00:00',
		},
	],
};

function renderForm() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<ActivityCorrectionForm
				leadId="7"
				activityId={12}
				onApplied={() => undefined}
				onCancel={() => undefined}
			/>
		</QueryClientProvider>
	);
}

describe('ActivityCorrectionForm', () => {
	beforeEach(() => {
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(
			jsonResponse(200, { success: true, data: state })
		);
		vi.stubGlobal('fetch', fetchMock);
	});

	it('labels every control of the correction', async () => {
		renderForm();

		expect(await screen.findByLabelText('Activity type')).toBeInTheDocument();
		expect(screen.getByLabelText('Call outcome')).toBeInTheDocument();
		expect(screen.getByLabelText('Occurred at')).toBeInTheDocument();
		expect(screen.getByLabelText('Notes')).toBeInTheDocument();
		expect(screen.getByLabelText('Correction reason')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Save correction' })
		).toBeInTheDocument();
	});

	it('shows the retained previous values, the reason, the actor, and the time', async () => {
		renderForm();

		expect(
			await screen.findByText('The outcome was wrong.')
		).toBeInTheDocument();
		expect(screen.getByText(/by Alex Caller/)).toBeInTheDocument();
		expect(
			screen.getByText('Call outcome: No Answer → Connected')
		).toBeInTheDocument();
	});

	it('refuses a correction without a reason', async () => {
		renderForm();
		await screen.findByLabelText('Correction reason');

		fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

		expect(screen.getByRole('alert')).toHaveTextContent(
			'A correction needs a reason.'
		);
		expect(
			fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
		).toHaveLength(0);
	});

	it('sends only the values that changed', async () => {
		renderForm();
		await screen.findByLabelText('Correction reason');

		fireEvent.change(screen.getByLabelText('Call outcome'), {
			target: { value: 'Connected' },
		});
		fireEvent.change(screen.getByLabelText('Correction reason'), {
			target: { value: 'The call did connect.' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

		await waitFor(() => {
			expect(
				fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')
			).toHaveLength(1);
		});
		const body = JSON.parse(
			(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]
				.body as string) ?? '{}'
		);
		expect(body).toEqual({
			version: 2,
			reason: 'The call did connect.',
			call_outcome: 'Connected',
		});
	});

	it('offers a conflict message when the activity changed underneath', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse(200, { success: true, data: state })
		);
		fetchMock.mockResolvedValueOnce(
			jsonResponse(409, {
				success: false,
				error:
					'This activity was corrected by someone else. Reload it and apply your correction to the current values.',
				code: 'correction_conflict',
			})
		);
		renderForm();
		await screen.findByLabelText('Correction reason');

		fireEvent.change(screen.getByLabelText('Call outcome'), {
			target: { value: 'Connected' },
		});
		fireEvent.change(screen.getByLabelText('Correction reason'), {
			target: { value: 'The call did connect.' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('This activity changed underneath you.');
		expect(alert).toHaveTextContent('corrected by someone else');
		expect(
			screen.getByRole('button', { name: 'Reload the activity' })
		).toBeInTheDocument();
	});
});
