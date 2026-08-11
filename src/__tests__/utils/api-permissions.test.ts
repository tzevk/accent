import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashSessionToken } from '@/utils/session';

// Mock the DB pool — everything else (rbac, permissions, session) is real.
const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: mockRelease,
});

vi.mock('@/utils/database', () => ({
	dbConnect: (...args) => mockDbConnect(...args),
}));

const { getCurrentUser, ensurePermission, RESOURCES, PERMISSIONS } =
	await import('@/utils/api-permissions');

// Minimal request shape — getCurrentUser only touches cookies.
const makeRequest = (cookies = {}) => ({
	cookies: {
		get: (name) => (cookies[name] ? { value: cookies[name] } : undefined),
	},
});

const baseUserRow = {
	id: 3,
	username: 'alice',
	full_name: 'Alice',
	email: 'alice@example.com',
	department: 'Engineering',
	linked_employee_id: null,
	role_id: 2,
	user_permissions: JSON.stringify(['leads:read']),
	user_field_permissions: JSON.stringify({}),
	is_super_admin: 0,
	is_active: 1,
	status: 'active',
	last_login: null,
	last_password_change: null,
	role_permissions: JSON.stringify(['projects:read']),
	role_hierarchy: 3,
	role_name: 'Editor',
	role_code: 'editor',
	employee_record_id: null,
};

beforeEach(() => {
	mockExecute.mockReset();
	mockRelease.mockReset();
	mockDbConnect.mockClear();
});

describe('getCurrentUser — session token validation', () => {
	it('returns null without a session cookie and never touches the DB', async () => {
		const user = await getCurrentUser(makeRequest({ user_id: '3' }));

		expect(user).toBeNull();
		expect(mockDbConnect).not.toHaveBeenCalled();
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('resolves a valid session row via the sessions JOIN', async () => {
		const token = 'a'.repeat(64);
		mockExecute.mockResolvedValue([[baseUserRow], {}]);

		const user = await getCurrentUser(makeRequest({ session: token }));

		expect(user).not.toBeNull();
		expect(user.id).toBe(3);
		expect(user.is_super_admin).toBe(false);
		expect(user.is_active).toBe(true);
		expect(user.role).toMatchObject({ id: 2, code: 'editor' });
		expect(user.merged_permissions).toEqual(
			expect.arrayContaining(['leads:read', 'projects:read'])
		);

		// One round trip, validated against the sessions table.
		const [sql, params] = mockExecute.mock.calls[0];
		expect(sql).toContain('FROM sessions s');
		expect(sql).toContain('JOIN users u ON u.id = s.user_id');
		expect(sql).toContain('WHERE s.token_hash = ?');
		expect(sql).toContain('s.expires_at > NOW()');
		expect(sql).toContain('u.isDelete = 0');
		expect(params).toEqual([hashSessionToken(token)]);
	});

	it('returns null when the cookie holds an unknown/revoked/expired token', async () => {
		mockExecute.mockResolvedValue([[], {}]);

		const user = await getCurrentUser(makeRequest({ session: 'b'.repeat(64) }));

		expect(user).toBeNull();
		expect(mockExecute).toHaveBeenCalledTimes(1);
	});

	it('returns null instead of throwing when the DB connection fails', async () => {
		const token = 'c'.repeat(64);
		mockDbConnect.mockRejectedValueOnce(
			Object.assign(new Error('Access denied'), {
				code: 'ER_ACCESS_DENIED_ERROR',
			})
		);

		await expect(
			getCurrentUser(makeRequest({ session: token }))
		).resolves.toBeNull();
	});
});

describe('SEC-03 regression — session_permissions fast path is gone', () => {
	const forgedPermissionsCookie = Buffer.from(
		JSON.stringify({ p: [], sa: true, ts: Date.now() })
	).toString('base64');

	it('getCurrentUser ignores the forged cookie without a session token', async () => {
		const user = await getCurrentUser(
			makeRequest({ session_permissions: forgedPermissionsCookie })
		);

		expect(user).toBeNull();
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('ensurePermission returns 401 for forged cookie + no session token', async () => {
		const res = await ensurePermission(
			makeRequest({ session_permissions: forgedPermissionsCookie }),
			RESOURCES.LEADS,
			PERMISSIONS.READ
		);

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe('Unauthorized');
		expect(mockDbConnect).not.toHaveBeenCalled();
	});
});
