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

const mockRevokeAllUserSessions = vi.fn().mockResolvedValue(undefined);
vi.mock('@/utils/session', () => ({
	revokeAllUserSessions: (...args: unknown[]) =>
		mockRevokeAllUserSessions(...args),
	SESSION_TTL_SECONDS: 2592000,
}));

describe('SEC-05 — Account deactivation and session revocation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentMockUser = {
			id: 1,
			username: 'admin',
			is_super_admin: 1,
			role_id: 1,
			role: { id: 1, hierarchy: 100 },
			merged_permissions: [
				'users:read',
				'users:update',
				'users:delete',
				'employees:read',
				'employees:update',
				'employees:delete',
			],
		};
	});

	it('PUT /api/users/[id] revokes all sessions when deactivating user via is_active = false', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 10, is_super_admin: 0, role_id: 2, role_hierarchy: 50 }],
		]); // existing
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // update
		mockExecute.mockResolvedValueOnce([[{ id: 10, is_active: 0 }]]); // select updated

		const { PUT } = await import('@/app/api/users/[id]/route');
		const req = new Request('http://localhost/api/users/10', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ is_active: false }),
		});

		const res = await PUT(req, { params: Promise.resolve({ id: '10' }) });
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			'10'
		);
	});

	it('PUT /api/users/[id] revokes all sessions when setting status = "inactive"', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 10, is_super_admin: 0, role_id: 2, role_hierarchy: 50 }],
		]); // existing
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // update
		mockExecute.mockResolvedValueOnce([[{ id: 10, status: 'inactive' }]]); // select updated

		const { PUT } = await import('@/app/api/users/[id]/route');
		const req = new Request('http://localhost/api/users/10', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'inactive' }),
		});

		const res = await PUT(req, { params: Promise.resolve({ id: '10' }) });
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			'10'
		);
	});

	it('DELETE /api/users/[id] revokes all sessions for deleted user', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 10, is_super_admin: 0, role_id: 2, role_hierarchy: 50 }],
		]); // existing
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // soft delete UPDATE

		const { DELETE } = await import('@/app/api/users/[id]/route');
		const req = new Request('http://localhost/api/users/10', {
			method: 'DELETE',
		});

		const res = await DELETE(req, { params: Promise.resolve({ id: '10' }) });
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			'10'
		);
	});

	it('PUT /api/users revokes all sessions when deactivating user via status = "inactive"', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 10, is_super_admin: 0, role_id: 2, role_hierarchy: 50 }],
		]); // existing
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // update
		mockExecute.mockResolvedValueOnce([[{ id: 10, status: 'inactive' }]]); // select updated

		const { PUT } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: 10, status: 'inactive' }),
		});

		const res = await PUT(req);
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			10
		);
	});

	it('DELETE /api/users revokes all sessions for deleted user', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 10, is_super_admin: 0, role_id: 2, role_hierarchy: 50 }],
		]); // existing
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // soft delete UPDATE

		const { DELETE } = await import('@/app/api/users/route');
		const req = new Request('http://localhost/api/users?id=10', {
			method: 'DELETE',
		});

		const res = await DELETE(req);
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			'10'
		);
	});

	it('PUT /api/employees revokes linked user sessions when deactivating employee', async () => {
		mockExecute.mockResolvedValueOnce([[{ id: 5 }]]); // SELECT employees existing
		mockExecute.mockResolvedValueOnce([[{ Field: 'status' }]]); // SHOW COLUMNS FROM employees
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE employees
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE users is_active/status
		mockExecute.mockResolvedValueOnce([[{ id: 25 }]]); // SELECT users WHERE employee_id = ?
		const { PUT } = await import('@/app/api/employees/route');
		const req = new Request('http://localhost/api/employees', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id: 5, status: 'inactive' }),
		});

		const res = await PUT(req);
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			25
		);
	});

	it('DELETE /api/employees revokes linked user sessions when deleting employee', async () => {
		mockExecute.mockResolvedValueOnce([[{ id: 5 }]]); // SELECT employees existing
		mockExecute.mockResolvedValueOnce([[{ count: 0 }]]); // managedEmployees check
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE employees isDelete = 1
		mockExecute.mockResolvedValueOnce([[{ id: 25 }]]); // SELECT users WHERE employee_id = ?
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE users is_active = FALSE

		const { DELETE } = await import('@/app/api/employees/route');
		const req = new Request('http://localhost/api/employees?id=5', {
			method: 'DELETE',
		});
		const res = await DELETE(req);
		expect(res.status).toBe(200);

		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			25
		);
	});
});
