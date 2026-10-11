import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	mockGetCurrentUser: vi.fn(),
	mockEndUserSession: vi.fn(),
}));

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mocks.mockGetCurrentUser,
}));
// The shared close path is the boundary this route's job lives on: ending the
// caller's own session, marked as a beacon end.
vi.mock('@/utils/work-session-close', () => ({
	endUserSession: mocks.mockEndUserSession,
}));

// Loaded after the mocks are registered: a static import would bind the real
// close path and the real permission module before the factory runs.
const { POST } = await import('@/app/api/work-sessions/close/route');

const SESSION_USER = { id: 42, email: 'member@example.com' };

function post(body?: string) {
	return POST(
		new Request('http://localhost/api/work-sessions/close', {
			method: 'POST',
			body,
		})
	);
}

/** The options the handler handed the shared close path. */
function closeOptions(): { endSource: string; endedAt: Date | null } {
	return mocks.mockEndUserSession.mock.calls[0][1];
}

describe('POST /api/work-sessions/close — the page-close beacon', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.mockGetCurrentUser.mockResolvedValue(SESSION_USER);
		mocks.mockEndUserSession.mockResolvedValue(undefined);
	});

	it('ends an unauthenticated beacon with 401 and closes nothing', async () => {
		mocks.mockGetCurrentUser.mockResolvedValue(null);

		const res = await post(
			JSON.stringify({ closedAt: '2026-10-10T21:30:00Z' })
		);

		expect(res.status).toBe(401);
		expect(mocks.mockEndUserSession).not.toHaveBeenCalled();
	});

	it("ends the caller's own session, stamped as a beacon end", async () => {
		const res = await post();

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true });
		expect(mocks.mockEndUserSession).toHaveBeenCalledTimes(1);
		// The id is the session user's, never one the caller supplied.
		expect(mocks.mockEndUserSession.mock.calls[0][0]).toBe(SESSION_USER.id);
		expect(closeOptions()).toEqual({ endSource: 'beacon', endedAt: null });
	});

	it('forwards the close time the browser reported', async () => {
		await post(JSON.stringify({ closedAt: '2026-10-10T21:30:00.000Z' }));

		const { endedAt } = closeOptions();
		expect(endedAt).toBeInstanceOf(Date);
		expect(endedAt && endedAt.toISOString()).toBe('2026-10-10T21:30:00.000Z');
	});

	it('still ends the session when the body is absent or unreadable', async () => {
		await post();
		expect(mocks.mockEndUserSession).toHaveBeenCalledTimes(1);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await post('{"closedAt": ');
		warn.mockRestore();

		// The close still happens; the database stamps the end instead.
		expect(mocks.mockEndUserSession).toHaveBeenCalledTimes(2);
		expect(closeOptions().endedAt).toBeNull();
	});

	it('never reads a user id from the body', async () => {
		await post(
			JSON.stringify({
				userId: 999,
				closedAt: '2026-10-10T21:30:00.000Z',
			})
		);

		expect(mocks.mockEndUserSession).toHaveBeenCalledTimes(1);
		expect(mocks.mockEndUserSession.mock.calls[0][0]).toBe(SESSION_USER.id);
		expect(mocks.mockEndUserSession.mock.calls[0][0]).not.toBe(999);
	});
});
