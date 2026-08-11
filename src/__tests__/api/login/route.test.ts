import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + auth before dynamic import (Vitest hoists mocks).
const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockEnd = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: mockRelease,
	end: mockEnd,
});

vi.mock('@/utils/database', () => ({
	dbConnect: (...args) => mockDbConnect(...args),
}));

vi.mock('@/utils/password', () => ({
	verifyPassword: vi.fn().mockResolvedValue(true),
	needsRehash: vi.fn(() => false),
	hashPassword: vi.fn().mockResolvedValue('new-hash'),
}));

vi.mock('@/utils/rbac', () => ({
	getDefaultPermissionsForLevel: vi.fn(() => []),
	mergePermissions: vi.fn((role, user) => [...(role || []), ...(user || [])]),
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn(() => ({ catch: vi.fn() })),
}));

const { POST } = await import('@/app/api/login/route');
const { SESSION_TTL_SECONDS } = await import('@/utils/session');

const loginRow = {
	id: 1,
	username: 'alice',
	email: 'alice@example.com',
	full_name: 'Alice',
	role_id: 1,
	is_super_admin: 0,
	is_active: 1,
	password_hash: '$2b$10$hashed',
	user_permissions: JSON.stringify(['leads:read']),
	user_field_permissions: JSON.stringify({}),
	role_permissions: JSON.stringify([]),
	role_hierarchy: 3,
};

const makeLoginRequest = () =>
	new Request('http://localhost/api/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: 'alice', password: 'secret' }),
	});

beforeEach(() => {
	mockExecute.mockReset();
	mockRelease.mockReset();
	mockEnd.mockReset();
	mockDbConnect.mockClear();
});

describe('POST /api/login — session cookie issuance', () => {
	it('issues a single opaque session cookie and no forgeable cookies', async () => {
		mockExecute
			.mockResolvedValueOnce([[loginRow], {}]) // login SELECT
			.mockResolvedValueOnce([[], {}]) // last_login UPDATE
			.mockResolvedValueOnce([[], {}]) // sessions INSERT
			.mockResolvedValueOnce([[], {}]); // expired-row cleanup DELETE

		const res = await POST(makeLoginRequest());

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.user.id).toBe(1);

		const sessionCookie = res.cookies.get('session');
		expect(sessionCookie).toBeDefined();
		expect(sessionCookie.value).toMatch(/^[0-9a-f]{64}$/);
		expect(sessionCookie.httpOnly).toBe(true);
		expect(sessionCookie.sameSite).toBe('lax');
		expect(sessionCookie.path).toBe('/');
		expect(sessionCookie.maxAge).toBe(SESSION_TTL_SECONDS);

		// Legacy forgeable cookies are never issued with values — at most
		// cleared defensively for pre-deploy cookie hygiene.
		for (const legacy of [
			'auth',
			'user_id',
			'is_super_admin',
			'session_permissions',
		]) {
			const c = res.cookies.get(legacy);
			if (c) {
				expect(c.value).toBe('');
				expect(c.maxAge).toBe(0);
			}
		}
	});

	it('stores only the SHA-256 hash of the token in the sessions table', async () => {
		mockExecute
			.mockResolvedValueOnce([[loginRow], {}])
			.mockResolvedValueOnce([[], {}])
			.mockResolvedValueOnce([[], {}])
			.mockResolvedValueOnce([[], {}]);

		const res = await POST(makeLoginRequest());
		const token = res.cookies.get('session').value;

		const insertCall = mockExecute.mock.calls.find(([sql]) =>
			sql.includes('INSERT INTO sessions')
		);
		expect(insertCall).toBeDefined();
		const [, params] = insertCall;
		expect(params[0]).toMatch(/^[0-9a-f]{64}$/);
		expect(params[1]).toBe(1);
		expect(params[2]).toBe(SESSION_TTL_SECONDS);
		// The raw token must never reach the DB.
		expect(JSON.stringify(params)).not.toContain(token);
	});

	it('does not set any cookies when credentials are invalid', async () => {
		mockExecute.mockResolvedValueOnce([[], {}]); // login SELECT → no rows

		const res = await POST(makeLoginRequest());

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(res.cookies.get('session')).toBeUndefined();
	});
});
