import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivityTracker } from '@/hooks/useActivityTracker';

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock('@/context/SessionContext', () => ({ useSession: useSessionMock }));
const fetchMock = vi.fn<typeof fetch>();

interface TrackDetails {
	status?: string;
}

interface TrackBody {
	batch?: boolean;
	actionType?: string;
	resourceType?: string;
	details?: TrackDetails;
}

interface AccessRecordedDetail {
	userId: number;
}

function successResponse(): Response {
	return {
		ok: true,
		json: async () => ({ success: true }),
	} as Response;
}

function readBody(init?: RequestInit): TrackBody {
	return JSON.parse(String(init?.body ?? '{}')) as TrackBody;
}

describe('useActivityTracker — authenticated app entry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSessionMock.mockReturnValue({ user: { id: 42 } });
		fetchMock.mockResolvedValue(successResponse());
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends the authenticated app entry immediately and acknowledges it', async () => {
		const seen: AccessRecordedDetail[] = [];
		const onAccess = (event: Event): void => {
			seen.push((event as CustomEvent<AccessRecordedDetail>).detail);
		};
		window.addEventListener('app-access-recorded', onAccess);
		try {
			const { unmount } = renderHook(() => useActivityTracker());
			try {
				// The entry must leave long before the 35s batch delay.
				await waitFor(
					() => {
						expect(fetchMock).toHaveBeenCalled();
					},
					{ timeout: 2000 }
				);

				const entryCall = fetchMock.mock.calls.find(([url]) =>
					String(url).includes('/api/activity-logs/track-activity')
				);
				expect(entryCall).toBeDefined();
				const body = readBody(entryCall?.[1]);
				expect(body.batch).not.toBe(true);
				expect(body.actionType).toBe('status_change');
				expect(body.resourceType).toBe('session');
				expect(body.details?.status).toBe('active');

				await waitFor(
					() => {
						expect(seen).toEqual([{ userId: 42 }]);
					},
					{ timeout: 2000 }
				);
			} finally {
				unmount();
			}
		} finally {
			window.removeEventListener('app-access-recorded', onAccess);
		}
	});

	it('stays silent when the entry is never acknowledged', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'));
		const seen: AccessRecordedDetail[] = [];
		const onAccess = (event: Event): void => {
			seen.push((event as CustomEvent<AccessRecordedDetail>).detail);
		};
		window.addEventListener('app-access-recorded', onAccess);
		try {
			const { unmount } = renderHook(() => useActivityTracker());
			try {
				await waitFor(
					() => {
						expect(fetchMock).toHaveBeenCalled();
					},
					{ timeout: 2000 }
				);
				// Flush the rejected entry promise: it must resolve silent.
				await act(async () => {
					const { promise, resolve } = Promise.withResolvers<void>();
					setTimeout(resolve, 0);
					await promise;
				});
				expect(seen).toEqual([]);
			} finally {
				unmount();
			}
		} finally {
			window.removeEventListener('app-access-recorded', onAccess);
		}
	});
});
