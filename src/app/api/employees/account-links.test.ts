import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecute, mockRelease, mockEnd, mockRevokeAllUserSessions } =
	vi.hoisted(() => ({
		mockExecute: vi.fn(),
		mockRelease: vi.fn(),
		mockEnd: vi.fn(),
		mockRevokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
	}));

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		release: mockRelease,
		end: mockEnd,
		beginTransaction: vi.fn().mockResolvedValue(undefined),
		commit: vi.fn().mockResolvedValue(undefined),
		rollback: vi.fn().mockResolvedValue(undefined),
	}),
}));

vi.mock('@/utils/api-permissions', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('@/utils/api-permissions')>();
	return {
		...actual,
		ensurePermission: vi.fn().mockResolvedValue({
			authorized: true,
			user: {
				id: 1,
				username: 'admin',
				is_super_admin: 1,
				role_id: 1,
				role: { id: 1, hierarchy: 100 },
				merged_permissions: [
					'employees:read',
					'employees:create',
					'employees:update',
					'employees:delete',
				],
			},
		}),
		getCurrentUser: vi.fn().mockResolvedValue({
			id: 1,
			is_super_admin: 1,
			merged_permissions: ['employees:read'],
		}),
		invalidateUserCache: vi.fn(),
	};
});

vi.mock('@/utils/session', () => ({
	revokeAllUserSessions: (...args: unknown[]) =>
		mockRevokeAllUserSessions(...args),
	SESSION_TTL_SECONDS: 2592000,
}));

describe('Employee account links', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockRelease.mockReset();
		mockEnd.mockReset();
		mockRevokeAllUserSessions.mockReset();
		mockRevokeAllUserSessions.mockResolvedValue(undefined);
	});

	it.each([
		['create', 'username'],
		['create', 'user_id'],
		['update', 'username'],
		['update', 'user_id'],
	])(
		'rejects legacy %s ownership field %s without touching employee storage',
		async (operation, field) => {
			const payload = {
				employee_id: 'ATS006',
				first_name: 'Grace',
				last_name: 'Hopper',
				email: 'grace@example.com',
				[field]: field === 'user_id' ? 25 : 'legacy-account',
				...(operation === 'update' ? { id: 5 } : {}),
			};
			const { POST, PUT } = await import('@/app/api/employees/route');
			const response = await (operation === 'create' ? POST : PUT)(
				new Request('http://localhost/api/employees', {
					method: operation === 'create' ? 'POST' : 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
			);
			expect(response.status).toBe(400);
			expect(mockExecute).not.toHaveBeenCalled();
		}
	);

	it('does not restore account access when employment is activated', async () => {
		let linkedAccountStatus = 'inactive';
		mockExecute.mockImplementation(async (sql: unknown) => {
			const statement = String(sql);
			if (statement.includes('SELECT id FROM employees')) return [[{ id: 5 }]];
			if (statement.startsWith('SHOW COLUMNS')) return [[{ Field: 'status' }]];
			if (statement.startsWith('UPDATE employees'))
				return [{ affectedRows: 1 }];
			if (statement.startsWith('UPDATE users')) {
				linkedAccountStatus = 'active';
				return [{ affectedRows: 1 }];
			}
			return [[]];
		});

		const { PUT } = await import('@/app/api/employees/route');
		const response = await PUT(
			new Request('http://localhost/api/employees?id=5', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: 5, status: 'active' }),
			})
		);
		expect(response.status).toBe(200);
		expect(linkedAccountStatus).toBe('inactive');
		expect(mockRevokeAllUserSessions).not.toHaveBeenCalled();
	});

	it('deactivates a linked account and revokes its sessions', async () => {
		mockExecute
			.mockResolvedValueOnce([[{ id: 5 }]])
			.mockResolvedValueOnce([[{ Field: 'status' }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([{ affectedRows: 1 }])
			.mockResolvedValueOnce([[{ id: 25 }]]);

		const { PUT } = await import('@/app/api/employees/route');
		const response = await PUT(
			new Request('http://localhost/api/employees?id=5', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: 5, status: 'inactive' }),
			})
		);
		expect(response.status).toBe(200);
		expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(
			expect.anything(),
			25
		);
	});

	it('updates employee contact email without changing linked account login email', async () => {
		let linkedAccountLoginEmail = 'ada.login@example.com';
		mockExecute.mockImplementation(async (sql: unknown) => {
			const statement = String(sql);
			if (statement.includes('email = ?')) return [[]];
			if (statement.includes('SELECT id FROM employees')) return [[{ id: 5 }]];
			if (statement.startsWith('SHOW COLUMNS')) return [[{ Field: 'email' }]];
			if (statement.startsWith('UPDATE employees'))
				return [{ affectedRows: 1 }];
			if (statement.startsWith('UPDATE users')) {
				linkedAccountLoginEmail = 'ada.work@example.com';
				return [{ affectedRows: 1 }];
			}
			return [[]];
		});

		const { PUT } = await import('@/app/api/employees/route');
		const response = await PUT(
			new Request('http://localhost/api/employees?id=5', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: 5,
					employee_id: 'ATS005',
					first_name: 'Ada',
					last_name: 'Lovelace',
					email: 'ada.work@example.com',
				}),
			})
		);
		expect(response.status).toBe(200);
		expect(linkedAccountLoginEmail).toBe('ada.login@example.com');
		expect(mockRevokeAllUserSessions).not.toHaveBeenCalled();
	});
	it('blocks deleting an employee with a linked account through the collection endpoint', async () => {
		mockExecute
			.mockResolvedValueOnce([[{ id: 5 }]])
			.mockResolvedValueOnce([[{ id: 25 }]]);

		const { DELETE } = await import('@/app/api/employees/route');
		const response = await DELETE(
			new Request('http://localhost/api/employees?id=5', { method: 'DELETE' })
		);
		expect(response.status).toBe(409);
		expect(mockRevokeAllUserSessions).not.toHaveBeenCalled();
	});

	it('blocks deleting an employee with a linked account through the item endpoint', async () => {
		mockExecute
			.mockResolvedValueOnce([[{ id: 5 }]])
			.mockResolvedValueOnce([[{ id: 25 }]]);

		const { DELETE } = await import('@/app/api/employees/[id]/route');
		const response = await DELETE(
			new Request('http://localhost/api/employees/5', { method: 'DELETE' }),
			{ params: Promise.resolve({ id: '5' }) }
		);
		expect(response.status).toBe(409);
		expect(mockRevokeAllUserSessions).not.toHaveBeenCalled();
	});
});
