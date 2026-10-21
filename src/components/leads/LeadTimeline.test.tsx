import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LeadTimeline from '@/components/leads/LeadTimeline';
import type { LeadTimelineEntry } from '@/components/leads/types';

/**
 * The Lead timeline: the chronological evidence of one Lead. The stored
 * timeline is proven over real HTTP by the integration harness; this suite
 * covers what the panel shows, including the states that are not "no
 * activity" — a request that failed and a request that is still running.
 */

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
	apiGet,
	apiPost: vi.fn(),
	apiPut: vi.fn(),
	apiDelete: vi.fn(),
}));

function entry(overrides: Partial<LeadTimelineEntry> = {}): LeadTimelineEntry {
	return {
		key: 'activity:1',
		kind: 'activity',
		occurred_at: '2026-10-20T09:00:00.000Z',
		recorded_at: '2026-10-20T09:00:00.000Z',
		title: 'Call — No Answer',
		detail: 'Nobody answered.',
		actor_name: 'Alex Caller',
		status: 'Completed',
		activity_type: 'Call',
		call_outcome: 'No Answer',
		legacy: false,
		...overrides,
	};
}

function renderTimeline() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<LeadTimeline leadId="7" enabled />
		</QueryClientProvider>
	);
}

describe('LeadTimeline', () => {
	beforeEach(() => {
		apiGet.mockReset();
	});

	it('shows the completed work and the scheduled work apart', async () => {
		apiGet.mockResolvedValue({
			success: true,
			data: {
				entries: [
					entry(),
					entry({
						key: 'activity:2',
						title: 'Call scheduled for 05 Nov 2026',
						status: 'Scheduled',
						occurred_at: null,
						recorded_at: '2026-10-20T09:05:00.000Z',
						call_outcome: null,
					}),
				],
			},
		});
		renderTimeline();

		expect(await screen.findByText('Call — No Answer')).toBeInTheDocument();
		expect(
			screen.getByText('Call scheduled for 05 Nov 2026')
		).toBeInTheDocument();
		expect(screen.getByText('Completed')).toBeInTheDocument();
		expect(screen.getByText('Scheduled')).toBeInTheDocument();
		expect(screen.getAllByText(/by Alex Caller/).length).toBe(2);
	});

	it('labels an unknown author and an unknown outcome', async () => {
		apiGet.mockResolvedValue({
			success: true,
			data: {
				entries: [
					entry({
						title: 'Call — outcome unknown',
						actor_name: null,
						call_outcome: null,
						legacy: true,
					}),
				],
			},
		});
		renderTimeline();

		expect(await screen.findByText('Legacy evidence')).toBeInTheDocument();
		expect(screen.getByText(/author unknown/)).toBeInTheDocument();
		expect(screen.getAllByText(/outcome unknown/).length).toBeGreaterThan(0);
	});

	it('says that there is no activity when the timeline is empty', async () => {
		apiGet.mockResolvedValue({
			success: true,
			data: { entries: [] },
		});
		renderTimeline();

		expect(
			await screen.findByText('No activity recorded yet')
		).toBeInTheDocument();
	});

	it('tells a failed request apart from an empty timeline', async () => {
		apiGet.mockRejectedValue(new Error('Network down'));
		renderTimeline();

		await waitFor(() => {
			expect(screen.getByRole('alert')).toHaveTextContent(
				'The timeline could not be loaded.'
			);
		});
		expect(
			screen.queryByText('No activity recorded yet')
		).not.toBeInTheDocument();
		expect(screen.getByText('Network down')).toBeInTheDocument();
	});

	it('shows that the timeline is loading', () => {
		const pending = Promise.withResolvers<unknown>();
		apiGet.mockReturnValue(pending.promise);
		renderTimeline();

		expect(screen.getByRole('status')).toHaveTextContent('Loading timeline…');
	});
});
