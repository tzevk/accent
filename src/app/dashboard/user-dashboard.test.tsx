import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGet, idleState } = vi.hoisted(() => ({
	apiGet: vi.fn(),
	idleState: {
		idleSeconds: 0,
		cumulativeIdleSeconds: 0,
		isIdle: false,
		dismiss: vi.fn(),
		dismissed: false,
		handleActivity: vi.fn(),
	},
}));
const fetchMock = vi.fn();

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next/link', () => ({
	default: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={typeof href === 'string' ? href : '#'}>{children}</a>
	),
}));
vi.mock('@/components/Navbar', () => ({ default: () => <nav>Navbar</nav> }));
vi.mock('@/components/LeaveLoginToast', () => ({ default: () => null }));
vi.mock('@/components/TodoList', () => ({ default: () => null }));
vi.mock('@/components/ProjectActivityAssignments', () => ({
	default: () => null,
}));
vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => ({
		loading: false,
		user: { id: 7, full_name: 'Test User' },
		can: () => false,
		RESOURCES: {},
		PERMISSIONS: {},
	}),
}));
vi.mock('@/hooks/useIdleMonitor', () => ({ useIdleMonitor: () => idleState }));
vi.mock('@/lib/api-client', () => ({ apiGet }));

import UserDashboard from '@/app/dashboard/user-dashboard.jsx';

/**
 * The 2026-10-26 production shape: one ended Work Session whose end sits
 * before its start (the 04:07 beacon end against a 09:06 start), no device
 * punches, idle recorded. The API surfaces the corrupt row instead of
 * repairing it, so every session snapshot field reads invalid/empty.
 */
const INVALID_SESSION_DAY = {
	inTime: null,
	outTime: null,
	idleTime: 12,
	sessionStartTime: '09:06',
	sessionEndTime: null,
	sessionEndSource: null,
	sessionElapsedMinutes: null,
	sessionAsOf: Date.parse('2026-10-26T12:00:00.000Z'),
	sessionActive: false,
	sessionTimeInvalid: true,
	punchInTime: null,
	punchOutTime: null,
	punchCount: 0,
	punchComputable: false,
	punchEmployeeId: 7,
	currentMonth: 'October 2026',
	daysInMonth: 31,
	daysPresent: 5,
	weeklyOff: 5,
	holidays: 0,
	overtimeHours: 0,
	leaves: { total: 21, used: 1, balance: 20 },
};

const ENDED_SESSION_DAY = {
	...INVALID_SESSION_DAY,
	idleTime: 9,
	sessionStartTime: '09:06',
	sessionEndTime: '18:11',
	sessionEndSource: 'logout',
	sessionElapsedMinutes: 545,
	sessionAsOf: Date.parse('2026-10-26T12:40:00.000Z'),
	sessionActive: false,
	sessionTimeInvalid: false,
	punchInTime: '09:12',
	punchOutTime: '18:05',
	punchCount: 2,
	punchComputable: true,
};

const RESUMED_SESSION_DAY = {
	...ENDED_SESSION_DAY,
	idleTime: 0,
	sessionEndTime: null,
	sessionEndSource: null,
	sessionElapsedMinutes: 545,
	sessionAsOf: Date.parse('2026-10-26T12:42:00.000Z'),
	sessionActive: true,
	punchInTime: '09:12',
	punchOutTime: null,
	punchCount: 1,
	punchComputable: false,
};
/**
 * One assignment with no entry for today, so assignment processing takes
 * the pending path into sessionStorage.
 */
const PENDING_ASSIGNMENT = {
	activity_name: 'Site survey',
	project_name: 'Harbor Works',
	project_code: 'HB-1',
	status: 'In Progress',
	daily_entries: [],
};

/**
 * A successful day whose session source is unknown rather than empty:
 * every session field reads null with no snapshot receipt. Missing data
 * is not an unavailable source, so the tiles must not claim an empty day.
 */
const UNAVAILABLE_SESSION_DAY = {
	...INVALID_SESSION_DAY,
	idleTime: 0,
	sessionStartTime: null,
	sessionEndTime: null,
	sessionEndSource: null,
	sessionElapsedMinutes: null,
	sessionAsOf: null,
	sessionActive: false,
	sessionTimeInvalid: false,
	punchInTime: null,
	punchOutTime: null,
	punchCount: 0,
	punchComputable: false,
};

/**
 * A genuinely empty day: the same null session fields, but the finite
 * snapshot receipt confirms the source was read and recorded nothing.
 */
const VALID_EMPTY_DAY = {
	...UNAVAILABLE_SESSION_DAY,
	sessionAsOf: Date.parse('2026-10-26T12:00:00.000Z'),
};

function mockTierFetches(): void {
	fetchMock.mockImplementation((url: string) => {
		if (url.includes('/activity-assignments')) {
			return Promise.resolve({
				json: async () => ({
					success: true,
					data: {
						assignments: [],
						accessibleProjects: [],
						emptyProjects: [],
						documentCounts: {},
						stats: {},
					},
				}),
			});
		}
		if (url.includes('/api/messages/unread-count')) {
			return Promise.resolve({
				json: async () => ({ success: true, data: { unread_count: 0 } }),
			});
		}
		if (url.includes('/api/todos')) {
			return Promise.resolve({
				json: async () => ({ success: true, data: [] }),
			});
		}
		if (url.includes('/api/work-logs')) {
			return Promise.resolve({
				json: async () => ({ success: true, data: [] }),
			});
		}
		return Promise.reject(new Error(`Unexpected request: ${url}`));
	});
}

function renderDashboard(
	verifiedUser: { id: number; full_name: string } = {
		id: 7,
		full_name: 'Test User',
	}
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	return render(
		<QueryClientProvider client={client}>
			<UserDashboard verifiedUser={verifiedUser} />
		</QueryClientProvider>
	);
}

describe('user dashboard attendance sources', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.setSystemTime(new Date('2026-10-26T12:00:00'));
		vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
		mockTierFetches();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('keeps an invalid CRM interval off the punch tiles and names it instead of timing it', async () => {
		apiGet.mockResolvedValue({ success: true, data: INVALID_SESSION_DAY });
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');

		// Punch tiles read the device only: no punches means dashes, never a
		// session clock, and the pre-shift end must not tag an OT chip.
		expect(within(card).getByTestId('punch-in-figure')).toHaveTextContent('—');
		expect(within(card).getByTestId('punch-out-figure')).toHaveTextContent('—');
		expect(within(card).queryByText('OT')).not.toBeInTheDocument();
		expect(within(card).queryByText('Late')).not.toBeInTheDocument();
		expect(within(card).queryByText(/logged out/i)).not.toBeInTheDocument();

		// The day recorded CRM evidence, so it is not an empty day.
		expect(
			within(card).queryByTestId('attendance-empty-state')
		).not.toBeInTheDocument();

		// The corrupt interval is labelled and dashed with a support next
		// step — never a 0h 0m duration, OT, or hours-remaining figure.
		expect(within(card).getByText(/CRM start/i)).toBeInTheDocument();
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent('—');
		expect(
			within(card).getByText(/session times are inconsistent/i)
		).toBeInTheDocument();
		expect(within(card).getByText(/contact support/i)).toBeInTheDocument();
		expect(within(card).queryByText(/0h 0m/)).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('total-time-remaining')
		).not.toBeInTheDocument();
		expect(within(card).queryByText(/m remaining/)).not.toBeInTheDocument();
	});

	it('replaces ended CRM state with a resumed session, including null and zero clears', async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		apiGet
			.mockResolvedValueOnce({ success: true, data: ENDED_SESSION_DAY })
			.mockResolvedValue({ success: true, data: RESUMED_SESSION_DAY });
		render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'Test User' }} />
			</QueryClientProvider>
		);

		const card = await screen.findByTestId('attendance-card');
		expect(within(card).getByText(/CRM end \(logout\)/i)).toBeInTheDocument();
		expect(within(card).getByTestId('idle-figure')).toHaveTextContent('9m');
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
			'9h 5m'
		);
		// The valid device pair stays on the punch tiles while the CRM end
		// carries its own logout label.
		expect(within(card).getByTestId('punch-in-figure')).toHaveTextContent(
			'9:12 AM'
		);
		expect(within(card).getByTestId('punch-out-figure')).toHaveTextContent(
			'6:05 PM'
		);

		// A poll refetch replaces the whole day, and the observer
		// notifies on a macrotask after the refetch promise settles, so
		// the assertions wait for the repaint, not the fetch: the
		// end/source nulls and the idle zero land together with the
		// resumed session and its lone device punch, and nothing
		// ended sticks around.
		await act(async () => {
			await client.refetchQueries({ queryKey: ['users', 7, 'attendance'] });
		});
		await waitFor(() => {
			expect(within(card).getByTestId('punch-out-figure')).toHaveTextContent(
				'—'
			);
		});
		expect(within(card).getByTestId('punch-in-figure')).toHaveTextContent(
			'9:12 AM'
		);
		expect(within(card).getByText(/no punch out/i)).toBeInTheDocument();
		expect(
			within(card).queryByText(/CRM end \(logout\)/i)
		).not.toBeInTheDocument();
		expect(within(card).getByTestId('idle-figure')).toHaveTextContent('0s');
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
			'9h 5m'
		);
		client.clear();
	});

	it('clears the attendance error line when a later poll recovers', async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		apiGet
			.mockRejectedValueOnce(new Error('network down'))
			.mockResolvedValue({ success: true, data: RESUMED_SESSION_DAY });
		render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'Test User' }} />
			</QueryClientProvider>
		);

		const card = await screen.findByTestId('attendance-card');
		expect(
			await within(card).findByTestId('attendance-fetch-error')
		).toBeInTheDocument();

		// A later poll refetch recovers the day: the error line clears and
		// the tiles read the payload, never both states at once. The
		// observer notifies after the refetch promise settles, so the
		// assertions wait for the repaint, not the fetch.
		await act(async () => {
			await client.refetchQueries({ queryKey: ['users', 7, 'attendance'] });
		});
		await waitFor(() => {
			expect(
				within(card).queryByTestId('attendance-fetch-error')
			).not.toBeInTheDocument();
		});
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
			'9h 5m'
		);
		client.clear();
	});

	it('ignores a stale attendance response after the user changes', async () => {
		const { promise: firstRead, resolve: releaseFirst } =
			Promise.withResolvers<unknown>();
		apiGet.mockImplementation(async (url: string) => {
			if (url === '/api/users/7/attendance') return firstRead;
			if (url === '/api/users/9/attendance') {
				return { success: true, data: RESUMED_SESSION_DAY };
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		const { rerender, unmount } = render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'First User' }} />
			</QueryClientProvider>
		);

		// The shell is still waiting on user 7's read when the viewer
		// switches: user 9 paints, then the stale first response lands and
		// must not repaint the tiles.
		rerender(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 9, full_name: 'Second User' }} />
			</QueryClientProvider>
		);
		const card = await screen.findByTestId('attendance-card');
		expect(await within(card).findByText('9:12 AM')).toBeInTheDocument();
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
			'9h 5m'
		);
		await act(async () => {
			releaseFirst({ success: true, data: INVALID_SESSION_DAY });
			await firstRead;
		});
		// The stale read resolved into user 7's cache entry while the tiles
		// read user 9's, so nothing on screen moves.
		expect(
			within(card).queryByText(/session times are inconsistent/i)
		).not.toBeInTheDocument();
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
			'9h 5m'
		);
		unmount();
		client.clear();
	});

	it('drops the previous live total when a loaded viewer switches users', async () => {
		const USER_A_DAY = { ...RESUMED_SESSION_DAY, sessionElapsedMinutes: 545 };
		const USER_B_DAY = { ...RESUMED_SESSION_DAY, sessionElapsedMinutes: 31 };
		const { promise: userBRead, resolve: releaseUserB } =
			Promise.withResolvers<unknown>();
		apiGet.mockImplementation(async (url: string) => {
			if (url === '/api/users/7/attendance') {
				return { success: true, data: USER_A_DAY };
			}
			if (url === '/api/users/9/attendance') return userBRead;
			throw new Error(`Unexpected request: ${url}`);
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		const { rerender, unmount } = render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'First User' }} />
			</QueryClientProvider>
		);

		// User 7 loads fully, so the live total is keyed to user 7's
		// receipt; switching to user 9 hides the tiles behind the shell
		// loader until user 9 settles, so no stale 9h 5m is visible
		// while user 9's own read is still pending.
		const card = await screen.findByTestId('attendance-card');
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
			'9h 5m'
		);
		rerender(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 9, full_name: 'Second User' }} />
			</QueryClientProvider>
		);
		expect(screen.queryByTestId('attendance-card')).not.toBeInTheDocument();
		expect(screen.queryByText('9h 5m')).not.toBeInTheDocument();
		expect(
			screen.queryByTestId('attendance-fetch-error')
		).not.toBeInTheDocument();
		await act(async () => {
			releaseUserB({ success: true, data: USER_B_DAY });
			await userBRead;
		});
		// User 9 lands on its own 31m total, never user 7's 9h 5m.
		const cardB = await screen.findByTestId('attendance-card');
		await waitFor(() => {
			expect(within(cardB).getByTestId('crm-time-figure')).toHaveTextContent(
				'0h 31m'
			);
		});
		unmount();
		client.clear();
	});

	it('advances the active CRM total on monotonic time, ignoring wall-clock skew and idle', async () => {
		vi.useFakeTimers();
		try {
			// 31 minutes observed with a 90-minute recorded idle cushion; the
			// skew fixture below must not pull the tile off the monotonic
			// anchor, and the idle cushion must not subtract from it.
			const ACTIVE_DAY = {
				...RESUMED_SESSION_DAY,
				idleTime: 90,
				sessionElapsedMinutes: 31,
			};
			apiGet.mockResolvedValue({ success: true, data: ACTIVE_DAY });
			const client = new QueryClient({
				defaultOptions: { queries: { retry: false, gcTime: 0 } },
			});
			const { unmount } = render(
				<QueryClientProvider client={client}>
					<UserDashboard verifiedUser={{ id: 7, full_name: 'Test User' }} />
				</QueryClientProvider>
			);

			// Fake timers capture the async machinery, so the first paint
			// needs a sync microtask flush plus one timer pump for the
			// observer's scheduled notification.
			await act(async () => {});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			const card = screen.getByTestId('attendance-card');
			expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
				'0h 31m'
			);
			// The 90m recorded idle never subtracts from the observed
			// 31m figure, which is the monotonic anchor below.
			expect(within(card).getByTestId('idle-figure')).toHaveTextContent('0s');

			// 100 seconds on the monotonic anchor crosses one 50s display
			// tick (before the 120s poll) and lands the total on 32m; then
			// a 5h wall-clock jump must not move it further.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(100_000);
			});
			expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
				'0h 32m'
			);
			await act(async () => {
				vi.setSystemTime(new Date('2026-10-26T17:00:00'));
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
				'0h 32m'
			);
			unmount();
			client.clear();
		} finally {
			vi.useRealTimers();
			vi.setSystemTime(new Date('2026-10-26T12:00:00'));
		}
	});
	it('releases the shell with an assignments error when assignment processing throws', async () => {
		// The pending assignment drives loadData into sessionStorage,
		// which throws mid-processing; the shell must still clear and
		// name the assignments failure beside the painted tiles.
		const baseFetch = fetchMock.getMockImplementation() as (
			url: string
		) => Promise<unknown>;
		fetchMock.mockImplementation((url: string) => {
			if (url.includes('/activity-assignments')) {
				return Promise.resolve({
					json: async () => ({
						success: true,
						data: {
							assignments: [PENDING_ASSIGNMENT],
							accessibleProjects: [],
							emptyProjects: [],
							documentCounts: {},
							stats: {},
						},
					}),
				});
			}
			return baseFetch(url);
		});
		const originalStorage = globalThis.sessionStorage;
		const failingStorage: Storage = {
			length: 0,
			clear: vi.fn(),
			key: () => null,
			removeItem: vi.fn(),
			setItem: vi.fn(),
			getItem: () => {
				throw new Error('storage down');
			},
		};
		vi.stubGlobal('sessionStorage', failingStorage);
		try {
			apiGet.mockResolvedValue({ success: true, data: ENDED_SESSION_DAY });
			renderDashboard();

			const card = await screen.findByTestId('attendance-card');
			expect(
				await screen.findByTestId('assignments-fetch-error')
			).toBeInTheDocument();
			expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent(
				'9h 5m'
			);
		} finally {
			vi.stubGlobal('sessionStorage', originalStorage);
		}
	});

	it('does not claim an empty CRM day when the whole attendance read fails', async () => {
		apiGet.mockRejectedValue(new Error('network down'));
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');
		expect(
			await within(card).findByTestId('attendance-fetch-error')
		).toBeInTheDocument();

		// A failed source is unknown, never empty: no global empty claim
		// and no recorded-nothing CRM line, just an unavailable source.
		expect(
			within(card).queryByTestId('attendance-empty-state')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/no CRM session recorded yet today/i)
		).not.toBeInTheDocument();
		expect(
			within(card).getAllByText(/unavailable/i).length
		).toBeGreaterThanOrEqual(1);
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent('—');
	});

	it('names the CRM source unavailable when the session snapshot is missing', async () => {
		apiGet.mockResolvedValue({ success: true, data: UNAVAILABLE_SESSION_DAY });
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');

		// Null session fields with no snapshot receipt mean the source
		// could not be read, not that the day recorded nothing.
		expect(
			within(card).queryByTestId('attendance-empty-state')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/no CRM session recorded yet today/i)
		).not.toBeInTheDocument();
		expect(
			within(card).getAllByText(/unavailable/i).length
		).toBeGreaterThanOrEqual(1);
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent('—');
		// Unknown is not corrupt: the invalid-row support line stays off.
		expect(
			within(card).queryByText(/session times are inconsistent/i)
		).not.toBeInTheDocument();
	});

	it('keeps the neutral empty day when the session snapshot confirms nothing was recorded', async () => {
		apiGet.mockResolvedValue({ success: true, data: VALID_EMPTY_DAY });
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');
		expect(
			await within(card).findByTestId('attendance-empty-state')
		).toBeInTheDocument();
		expect(
			within(card).getByText(/no CRM session recorded yet today/i)
		).toBeInTheDocument();
		expect(within(card).getByTestId('crm-time-figure')).toHaveTextContent('—');
		expect(within(card).queryByText(/unavailable/i)).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('attendance-fetch-error')
		).not.toBeInTheDocument();
	});
});
