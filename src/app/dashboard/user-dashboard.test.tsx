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

/** App-access times remain in the API payload; Log Out does not display them. */
const ACCESS_DAY = {
	loginTime: '09:06',
	logoutTime: '18:11',
	accessStatus: 'ok' as const,
	accessDate: '2026-10-26',
	idleTime: 9,
	currentMonth: 'October 2026',
	daysInMonth: 31,
	daysPresent: 5,
	weeklyOff: 5,
	holidays: 0,
	overtimeHours: 0,
	leaves: { total: 21, used: 1, balance: 20 },
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
 * A successful day whose access source failed: null clocks with an error
 * status mean the source could not be read, not that the day is empty.
 */
const ACCESS_ERROR_DAY = {
	...ACCESS_DAY,
	loginTime: null,
	logoutTime: null,
	accessStatus: 'error' as const,
	accessDate: null,
};

/**
 * A genuinely empty day: null clocks with an ok status confirm the source
 * was read and recorded nothing yet.
 */
const ACCESS_EMPTY_DAY = {
	...ACCESS_DAY,
	idleTime: 0,
	loginTime: null,
	logoutTime: null,
	accessStatus: 'ok' as const,
};

/**
 * A later poll of the same day: first entry stays fixed while the latest
 * recorded access advances, with no explicit sign-out anywhere.
 */
const ACCESS_DAY_LATER = {
	...ACCESS_DAY,
	idleTime: 0,
	logoutTime: '19:02',
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

	it('keeps Log Out blank even when latest app access has a time', async () => {
		apiGet.mockResolvedValue({ success: true, data: ACCESS_DAY });
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');

		// Recorded app access must not look like an explicit sign-out.
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		expect(within(card).getByTestId('logout-figure')).toHaveTextContent('—');
		expect(within(card).getByText('Log In')).toBeInTheDocument();
		expect(within(card).getByText('Log Out')).toBeInTheDocument();

		// Old device/session tiles and their captions are gone.
		expect(within(card).queryByText('Punch In')).not.toBeInTheDocument();
		expect(within(card).queryByText('Punch Out')).not.toBeInTheDocument();
		expect(within(card).queryByText('CRM Time')).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('punch-in-figure')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('punch-out-figure')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('crm-time-figure')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/device recorded no punch/i)
		).not.toBeInTheDocument();
		expect(within(card).queryByText(/CRM start/i)).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/Observed CRM activity/i)
		).not.toBeInTheDocument();

		// No attendance grading on the app clocks.
		expect(within(card).queryByText('Late')).not.toBeInTheDocument();
		expect(within(card).queryByText('OT')).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('total-time-remaining')
		).not.toBeInTheDocument();
		expect(within(card).queryByText(/m remaining/)).not.toBeInTheDocument();
	});

	it('keeps first entry fixed while a later poll refreshes attendance', async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		apiGet
			.mockResolvedValueOnce({ success: true, data: ACCESS_DAY })
			.mockResolvedValue({ success: true, data: ACCESS_DAY_LATER });
		render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'Test User' }} />
			</QueryClientProvider>
		);

		const card = await screen.findByTestId('attendance-card');
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);

		// A poll updates visible attendance while Log In remains fixed.
		await act(async () => {
			await client.refetchQueries({ queryKey: ['users', 7, 'attendance'] });
		});
		await waitFor(() => {
			expect(within(card).getByTestId('idle-figure')).toHaveTextContent('0s');
		});
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		expect(within(card).queryByText('Late')).not.toBeInTheDocument();
		expect(within(card).queryByText('OT')).not.toBeInTheDocument();
		client.clear();
	});

	it('clears the attendance error line when a later poll recovers', async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		apiGet
			.mockRejectedValueOnce(new Error('network down'))
			.mockResolvedValue({ success: true, data: ACCESS_DAY });
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
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		client.clear();
	});

	it('ignores a stale attendance response after the user changes', async () => {
		const { promise: firstRead, resolve: releaseFirst } =
			Promise.withResolvers<unknown>();
		apiGet.mockImplementation(async (url: string) => {
			if (url === '/api/users/7/attendance') return firstRead;
			if (url === '/api/users/9/attendance') {
				return { success: true, data: ACCESS_DAY };
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
		expect(await within(card).findByText('9:06 AM')).toBeInTheDocument();
		const staleDay = {
			...ACCESS_DAY,
			loginTime: '08:15',
			logoutTime: '08:20',
		};
		await act(async () => {
			releaseFirst({ success: true, data: staleDay });
			await firstRead;
		});
		// The stale read resolved into user 7's cache entry while the tiles
		// read user 9's, so nothing on screen moves.
		expect(within(card).queryByText('8:15 AM')).not.toBeInTheDocument();
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		unmount();
		client.clear();
	});

	it('drops the previous access clocks when a loaded viewer switches users', async () => {
		const USER_A_DAY = { ...ACCESS_DAY };
		const USER_B_DAY = {
			...ACCESS_DAY,
			loginTime: '08:15',
			logoutTime: '08:20',
		};
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

		// User 7 loads fully; switching to user 9 hides the tiles behind
		// the shell loader until user 9 settles, so no stale clocks are
		// visible while user 9's own read is still pending.
		const card = await screen.findByTestId('attendance-card');
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		rerender(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 9, full_name: 'Second User' }} />
			</QueryClientProvider>
		);
		expect(screen.queryByTestId('attendance-card')).not.toBeInTheDocument();
		expect(screen.queryByText('9:06 AM')).not.toBeInTheDocument();
		expect(
			screen.queryByTestId('attendance-fetch-error')
		).not.toBeInTheDocument();
		await act(async () => {
			releaseUserB({ success: true, data: USER_B_DAY });
			await userBRead;
		});
		// User 9 lands on its own clocks, never user 7's.
		const cardB = await screen.findByTestId('attendance-card');
		await waitFor(() => {
			expect(within(cardB).getByTestId('login-figure')).toHaveTextContent(
				'8:15 AM'
			);
		});
		unmount();
		client.clear();
	});

	it('refetches the viewed user on an app-entry acknowledgement and ignores other users', async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		apiGet
			.mockResolvedValueOnce({ success: true, data: ACCESS_DAY })
			.mockResolvedValue({ success: true, data: ACCESS_DAY_LATER });
		render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'Test User' }} />
			</QueryClientProvider>
		);

		const card = await screen.findByTestId('attendance-card');
		const readsBefore = apiGet.mock.calls.filter(
			(call: unknown[]) => call[0] === '/api/users/7/attendance'
		).length;

		// An acknowledgement for another user is not this viewer's entry:
		// it must neither refetch nor repaint these tiles.
		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('app-access-recorded', { detail: { userId: 9 } })
			);
		});
		expect(
			apiGet.mock.calls.filter(
				(call: unknown[]) => call[0] === '/api/users/7/attendance'
			).length
		).toBe(readsBefore);

		// A matching acknowledgement refreshes the day's attendance.
		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('app-access-recorded', { detail: { userId: 7 } })
			);
		});
		await waitFor(() => {
			expect(within(card).getByTestId('idle-figure')).toHaveTextContent('0s');
		});
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		expect(
			apiGet.mock.calls.filter(
				(call: unknown[]) => call[0] === '/api/users/7/attendance'
			).length
		).toBeGreaterThan(readsBefore);
		client.clear();
	});

	it('forces a fresh read when the acknowledgement races a pending initial query', async () => {
		const { promise: firstRead, resolve: releaseFirst } =
			Promise.withResolvers<unknown>();
		let reads = 0;
		apiGet.mockImplementation(async (url: string) => {
			if (url !== '/api/users/7/attendance') {
				throw new Error(`Unexpected request: ${url}`);
			}
			reads += 1;
			if (reads === 1) return firstRead;
			return { success: true, data: ACCESS_DAY_LATER };
		});
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false, gcTime: 0 } },
		});
		render(
			<QueryClientProvider client={client}>
				<UserDashboard verifiedUser={{ id: 7, full_name: 'Test User' }} />
			</QueryClientProvider>
		);

		// The acknowledgement lands while the initial read is still
		// pending: the dashboard cancels that older read and refetches, so
		// the tiles must never paint its stale empty answer.
		await act(async () => {
			window.dispatchEvent(
				new CustomEvent('app-access-recorded', { detail: { userId: 7 } })
			);
			releaseFirst({ success: true, data: ACCESS_EMPTY_DAY });
			await firstRead;
		});
		const card = await screen.findByTestId('attendance-card');
		await waitFor(() => {
			expect(within(card).getByTestId('idle-figure')).toHaveTextContent('0s');
		});
		expect(within(card).getByTestId('login-figure')).toHaveTextContent(
			'9:06 AM'
		);
		expect(
			within(card).queryByTestId('attendance-empty-state')
		).not.toBeInTheDocument();
		expect(reads).toBeGreaterThan(1);
		client.clear();
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
			apiGet.mockResolvedValue({ success: true, data: ACCESS_DAY });
			renderDashboard();

			const card = await screen.findByTestId('attendance-card');
			expect(
				await screen.findByTestId('assignments-fetch-error')
			).toBeInTheDocument();
			expect(within(card).getByTestId('login-figure')).toHaveTextContent(
				'9:06 AM'
			);
		} finally {
			vi.stubGlobal('sessionStorage', originalStorage);
		}
	});

	it('does not claim an empty access day when the whole attendance read fails', async () => {
		apiGet.mockRejectedValue(new Error('network down'));
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');
		expect(
			await within(card).findByTestId('attendance-fetch-error')
		).toBeInTheDocument();

		// A failed source is unknown, never empty: no global empty claim
		// and no recorded-nothing access line, just an unavailable source.
		expect(
			within(card).queryByTestId('attendance-empty-state')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/no app access recorded yet today/i)
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/no app entry recorded yet today/i)
		).not.toBeInTheDocument();
		expect(
			within(card).getAllByText(/unavailable/i).length
		).toBeGreaterThanOrEqual(1);
		expect(within(card).getByTestId('login-figure')).toHaveTextContent('—');
		expect(within(card).getByTestId('logout-figure')).toHaveTextContent('—');
	});

	it('names the access source unavailable when the access status reports an error', async () => {
		apiGet.mockResolvedValue({ success: true, data: ACCESS_ERROR_DAY });
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');

		// Null clocks with an error status mean the source could not be
		// read, not that the day recorded nothing.
		expect(
			within(card).queryByTestId('attendance-empty-state')
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/no app access recorded yet today/i)
		).not.toBeInTheDocument();
		expect(
			within(card).queryByText(/no app entry recorded yet today/i)
		).not.toBeInTheDocument();
		expect(
			within(card).getAllByText(/unavailable/i).length
		).toBeGreaterThanOrEqual(1);
		expect(within(card).getByTestId('login-figure')).toHaveTextContent('—');
		expect(within(card).getByTestId('logout-figure')).toHaveTextContent('—');
		// A failed source is never an attendance verdict: no Late/OT chip.
		expect(within(card).queryByText('Late')).not.toBeInTheDocument();
		expect(within(card).queryByText('OT')).not.toBeInTheDocument();
	});

	it('keeps the neutral empty day when the access source confirms nothing was recorded', async () => {
		apiGet.mockResolvedValue({ success: true, data: ACCESS_EMPTY_DAY });
		renderDashboard();

		const card = await screen.findByTestId('attendance-card');
		expect(
			await within(card).findByTestId('attendance-empty-state')
		).toBeInTheDocument();
		expect(
			within(card).getByText(/no app entry recorded yet today/i)
		).toBeInTheDocument();
		expect(within(card).getByTestId('login-figure')).toHaveTextContent('—');
		expect(within(card).getByTestId('logout-figure')).toHaveTextContent('—');
		expect(within(card).queryByText(/unavailable/i)).not.toBeInTheDocument();
		expect(
			within(card).queryByTestId('attendance-fetch-error')
		).not.toBeInTheDocument();
	});
});

describe('activity log reminder project gating', () => {
	const REMINDER_NOW = new Date(2026, 9, 26, 12, 0, 0).getTime();
	const REMINDER_TWO_HOURS_MS = 7_200_000;

	let dateNowSpy: { mockRestore: () => void } | null = null;
	let originalShowModal:
		| typeof HTMLDialogElement.prototype.showModal
		| undefined;
	let originalClose: typeof HTMLDialogElement.prototype.close | undefined;

	function createIsolatedStorage(): Storage {
		const store = new Map<string, string>();
		return {
			get length(): number {
				return store.size;
			},
			clear(): void {
				store.clear();
			},
			getItem(key: string): string | null {
				const k = String(key);
				return store.has(k) ? (store.get(k) as string) : null;
			},
			setItem(key: string, value: string): void {
				store.set(String(key), String(value));
			},
			removeItem(key: string): void {
				store.delete(String(key));
			},
			key(index: number): string | null {
				const keys = Array.from(store.keys());
				return keys[index] ?? null;
			},
		};
	}

	/** Simulates a first dashboard visit already two hours past: an expired per-user/day baseline. */
	function seedExpiredBaseline(userId: number, now: number): void {
		const d = new Date(now);
		const key = `activity-log-reminder:${userId}:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		localStorage.setItem(
			key,
			JSON.stringify({
				baseline: now - REMINDER_TWO_HOURS_MS - 60_000,
				lastSavedAt: null,
				snoozedUntil: 0,
			})
		);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
		mockTierFetches();
		const storage = createIsolatedStorage();
		vi.stubGlobal('localStorage', storage);
		try {
			Object.defineProperty(window, 'localStorage', {
				configurable: true,
				enumerable: true,
				writable: true,
				value: storage,
			});
		} catch {
			// window.localStorage not configurable; global stub is sufficient.
		}
		// Pin the hook's clock without touching timer behavior, so async
		// queries and findBy polling keep working on real timers.
		dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(REMINDER_NOW);
		originalShowModal = HTMLDialogElement.prototype.showModal;
		originalClose = HTMLDialogElement.prototype.close;
		HTMLDialogElement.prototype.showModal = function (
			this: HTMLDialogElement
		): void {
			this.open = true;
		};
		HTMLDialogElement.prototype.close = function (
			this: HTMLDialogElement
		): void {
			this.open = false;
		};
	});

	afterEach(() => {
		dateNowSpy?.mockRestore();
		dateNowSpy = null;
		if (originalShowModal !== undefined) {
			HTMLDialogElement.prototype.showModal = originalShowModal;
		}
		if (originalClose !== undefined) {
			HTMLDialogElement.prototype.close = originalClose;
		}
		vi.unstubAllGlobals();
	});

	it('stays silent after two hours when the user has no accessible project', async () => {
		apiGet.mockResolvedValue({ success: true, data: ACCESS_DAY });
		// Default tier fetch leaves assignments, accessibleProjects, and
		// emptyProjects all empty: nothing the user could log to.
		seedExpiredBaseline(7, REMINDER_NOW);
		renderDashboard();

		await screen.findByTestId('attendance-card');
		await act(async () => {
			window.dispatchEvent(new Event('focus'));
		});
		expect(screen.queryByText('Activity Log Reminder')).not.toBeInTheDocument();
		expect(
			screen.queryByText(/haven't logged any activity/)
		).not.toBeInTheDocument();
	});

	it('prompts after two hours when an accessible empty project can receive the log', async () => {
		apiGet.mockResolvedValue({ success: true, data: ACCESS_DAY });
		const baseFetch = fetchMock.getMockImplementation() as (
			url: string
		) => Promise<unknown>;
		fetchMock.mockImplementation((url: string) => {
			if (url.includes('/activity-assignments')) {
				return Promise.resolve({
					json: async () => ({
						success: true,
						data: {
							assignments: [],
							accessibleProjects: [],
							emptyProjects: [
								{
									project_id: 11,
									project_code: 'EMPTY-1',
									project_name: 'Empty Project',
								},
							],
							documentCounts: {},
							stats: {},
						},
					}),
				});
			}
			return baseFetch(url);
		});
		seedExpiredBaseline(7, REMINDER_NOW);
		renderDashboard();

		// The real hook sees the expired baseline and an empty-but-loggable
		// project, so the consumer-visible warning appears.
		expect(
			await screen.findByText('Activity Log Reminder')
		).toBeInTheDocument();
		expect(screen.getByText(/haven't logged any activity/)).toBeInTheDocument();
	});
});
