import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockRelease = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		release: mockRelease,
	}),
}));

let currentMockUser: Record<string, unknown> | null = null;

vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/utils/api-permissions')>();
	return {
		...actual,
		ensurePermission: vi.fn().mockImplementation(async () => {
			if (!currentMockUser) {
				return NextResponse.json(
					{ success: false, error: 'Unauthorized' },
					{ status: 401 }
				);
			}
			return { authorized: true, user: currentMockUser };
		}),
		invalidateUserCache: vi.fn(),
	};
});

vi.mock('@/utils/password', () => ({
	hashPassword: vi.fn().mockResolvedValue('hashed_new_password'),
	verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/utils/session', () => ({
	revokeAllUserSessions: vi.fn().mockResolvedValue(true),
}));

describe('SEC-04 — Privilege escalation and target user protection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentMockUser = null;
	});

	it('PUT /api/users does NOT update password_hash directly', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:update'],
		};

		// 1st query: existing user check (target user with lower hierarchy)
		mockExecute.mockResolvedValueOnce([
			[{ id: 20, is_super_admin: 0, role_id: 3, role_hierarchy: 20 }],
		]);
		// 2nd query: update users
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		// 3rd query: select updated user
		mockExecute.mockResolvedValueOnce([
			[{ id: 20, username: 'target_user', full_name: 'Target Updated' }],
		]);

		const { PUT } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 20,
				full_name: 'Target Updated',
				password_hash: '$2b$10$attacker_controlled_hash',
			}),
		});

		const res = await PUT(req);
		expect(res.status).toBe(200);

		// Check the SQL update query executed
		const updateCall = mockExecute.mock.calls.find((call) =>
			String(call[0]).includes('UPDATE users SET')
		);
		expect(updateCall).toBeDefined();
		expect(String(updateCall[0])).not.toContain('password_hash');
	});

	it('Non-super-admin CANNOT modify a Super Admin user', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:update'],
		};

		// Target user is super admin
		mockExecute.mockResolvedValueOnce([
			[{ id: 1, is_super_admin: 1, role_id: 1, role_hierarchy: 100 }],
		]);

		const { PUT } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 1,
				full_name: 'Attacked Super Admin',
			}),
		});

		const res = await PUT(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain('Cannot modify or delete a super admin user');
	});

	it('Non-super-admin CANNOT modify a user with equal or higher role hierarchy', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:update'],
		};

		// Target user has higher hierarchy (80 > 50)
		mockExecute.mockResolvedValueOnce([
			[{ id: 5, is_super_admin: 0, role_id: 1, role_hierarchy: 80 }],
		]);

		const { PUT } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 5,
				full_name: 'Higher Manager',
			}),
		});

		const res = await PUT(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain('equal or higher role hierarchy');
	});

	it('Non-super-admin CANNOT grant super_admin status', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:create'],
		};

		const { POST } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'new_admin',
				password: 'password123',
				account_type: 'employee',
				employee_id: 5,
				is_super_admin: true,
			}),
		});

		const res = await POST(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain(
			'Only super admins can grant super admin privileges'
		);
	});

	it('Non-super-admin CANNOT assign a role with equal or higher hierarchy', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:create'],
		};

		// roles_master query returns role with hierarchy 80 (80 >= 50)
		mockExecute.mockResolvedValueOnce([
			[{ id: 1, role_hierarchy: 80, status: 'active' }],
		]);

		const { POST } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'new_user',
				password: 'password123',
				account_type: 'employee',
				employee_id: 5,
				role_id: 1,
			}),
		});

		const res = await POST(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain('equal or higher hierarchy');
	});

	it('Non-super-admin CANNOT grant custom permissions not held by caller', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:create'],
		};

		const { POST } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'new_user',
				password: 'password123',
				account_type: 'employee',
				employee_id: 5,
				permissions: ['finance:delete'], // caller does not have finance:delete
			}),
		});

		const res = await POST(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain('Cannot grant permission "finance:delete"');
	});

	it('Non-super-admin CANNOT modify own role or permissions (self-escalation check)', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:update'],
		};

		mockExecute.mockResolvedValueOnce([
			[{ id: 10, is_super_admin: 0, role_id: 2, role_hierarchy: 50 }],
		]);

		const { PUT } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 10, // updating self
				role_id: 1, // trying to change own role
			}),
		});

		const res = await PUT(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain(
			'Only super admins can modify your own role or permissions'
		);
	});

	it('Non-super-admin CANNOT reset password of a Super Admin', async () => {
		currentMockUser = {
			id: 10,
			username: 'manager',
			is_super_admin: false,
			role_id: 2,
			role: { id: 2, hierarchy: 50 },
			merged_permissions: ['users:read', 'users:update'],
		};

		// Target user is super admin
		mockExecute.mockResolvedValueOnce([
			[
				{
					id: 1,
					username: 'admin',
					is_super_admin: 1,
					role_id: 1,
					role_hierarchy: 100,
				},
			],
		]);

		const { POST } = await import('@/app/api/users/reset-password/route');
		const req = new Request('http://localhost/api/users/reset-password', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				user_id: 1,
				new_password: 'newpassword123',
			}),
		});

		const res = await POST(req);
		expect(res.status).toBe(403);
		const json = await res.json();
		expect(json.error).toContain('Cannot modify or delete a super admin user');
	});

	it('Super admin CAN assign roles and modify users freely', async () => {
		currentMockUser = {
			id: 1,
			username: 'admin',
			is_super_admin: true,
			merged_permissions: [],
		};

		// Target user check
		mockExecute.mockResolvedValueOnce([
			[{ id: 20, is_super_admin: 0, role_id: 3, role_hierarchy: 20 }],
		]);
		// UPDATE
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		// SELECT updated
		mockExecute.mockResolvedValueOnce([
			[{ id: 20, username: 'target_user', full_name: 'Super Admin Updated' }],
		]);

		const { PUT } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				id: 20,
				full_name: 'Super Admin Updated',
				role_id: 2,
			}),
		});

		const res = await PUT(req);
		expect(res.status).toBe(200);
	});
});
