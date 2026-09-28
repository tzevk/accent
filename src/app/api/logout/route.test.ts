import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDb = {
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
};
const mockDbConnect = vi.fn().mockResolvedValue(mockDb);

const mockRevokeSession = vi.fn();
const mockInvalidateUserCache = vi.fn();

// Cookie jar controlled per-test; logout reads it via next/headers cookies().
let cookieValue: string | undefined = 'raw-token';
vi.mock('next/headers', () => ({
	cookies: vi.fn(async () => ({
		get: (name: string) =>
			name === 'session' && cookieValue !== undefined
				? { name, value: cookieValue }
				: undefined,
	})),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/session', () => ({
	revokeSession: mockRevokeSession,
}));
vi.mock('@/utils/api-permissions', () => ({
	invalidateUserCache: mockInvalidateUserCache,
}));
vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn().mockResolvedValue(undefined),
	endUserSession: vi.fn().mockResolvedValue(undefined),
}));

const { POST: routePOST } = await import('@/app/api/logout/route');

type MockRequest = {
	headers: Headers;
	nextUrl: { protocol: string };
};

function createRequest(): MockRequest {
	return {
		headers: new Headers(),
		nextUrl: { protocol: 'http:' },
	};
}

describe('POST /api/logout — cache invalidation on revocation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cookieValue = 'raw-token';
	});

	it('invalidates the cached user for the revoked session', async () => {
		mockRevokeSession.mockResolvedValue(7);
		const res = await routePOST(createRequest());

		expect(mockRevokeSession).toHaveBeenCalledWith(mockDb, 'raw-token');
		expect(mockInvalidateUserCache).toHaveBeenCalledTimes(1);
		expect(mockInvalidateUserCache).toHaveBeenCalledWith(7);
		const json = await res.json();
		expect(json.success).toBe(true);
	});

	it('clears the session cookie with maxAge 0', async () => {
		mockRevokeSession.mockResolvedValue(7);
		const res = await routePOST(createRequest());

		const cookie = res.cookies.get('session');
		expect(cookie).toBeDefined();
		expect(cookie?.value).toBe('');
		const setCookie = res.headers.get('set-cookie') ?? '';
		expect(setCookie).toContain('Max-Age=0');
	});

	it('does not invalidate when revocation fails (userId unknown)', async () => {
		mockRevokeSession.mockRejectedValue(new Error('db down'));
		const res = await routePOST(createRequest());

		// Logout must not fail hard even if the DB write failed.
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(mockInvalidateUserCache).not.toHaveBeenCalled();
	});

	it('no cookie → no DB touch and no invalidation', async () => {
		cookieValue = undefined;
		await routePOST(createRequest());

		expect(mockDbConnect).not.toHaveBeenCalled();
		expect(mockRevokeSession).not.toHaveBeenCalled();
		expect(mockInvalidateUserCache).not.toHaveBeenCalled();
	});

	it('unknown token (revokeSession resolves null) → no invalidation', async () => {
		mockRevokeSession.mockResolvedValue(null);
		await routePOST(createRequest());

		expect(mockRevokeSession).toHaveBeenCalledWith(mockDb, 'raw-token');
		expect(mockInvalidateUserCache).not.toHaveBeenCalled();
	});
});
