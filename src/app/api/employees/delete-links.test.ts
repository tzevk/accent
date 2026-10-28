import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockExecute,
	mockBeginTransaction,
	mockCommit,
	mockRollback,
	mockRelease,
} = vi.hoisted(() => ({
	mockExecute: vi.fn(),
	mockBeginTransaction: vi.fn(),
	mockCommit: vi.fn(),
	mockRollback: vi.fn(),
	mockRelease: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		beginTransaction: mockBeginTransaction,
		commit: mockCommit,
		rollback: mockRollback,
		release: mockRelease,
	}),
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn().mockResolvedValue({
		authorized: true,
		user: { id: 1, is_super_admin: 1 },
	}),
	RESOURCES: { EMPLOYEES: 'employees' },
	PERMISSIONS: { DELETE: 'delete' },
	invalidateUserCache: vi.fn(),
}));

vi.mock('@/utils/session', () => ({
	revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
}));

type DeleteRoute = {
	DELETE: (
		request: Request,
		context?: { params: Promise<{ id: string }> }
	) => Promise<Response>;
};

const deleteRoutes = [
	{
		name: 'collection',
		load: () => import('@/app/api/employees/route') as Promise<DeleteRoute>,
		request: () =>
			new Request('http://localhost/api/employees?id=5', { method: 'DELETE' }),
	},
	{
		name: 'item',
		load: () =>
			import('@/app/api/employees/[id]/route') as Promise<DeleteRoute>,
		request: () =>
			new Request('http://localhost/api/employees/5', { method: 'DELETE' }),
		context: { params: Promise.resolve({ id: '5' }) },
	},
];

describe('Employee delete account-link locking', () => {
	beforeEach(() => {
		mockExecute.mockReset();
		mockBeginTransaction.mockReset().mockResolvedValue(undefined);
		mockCommit.mockReset().mockResolvedValue(undefined);
		mockRollback.mockReset().mockResolvedValue(undefined);
		mockRelease.mockReset();
	});

	it.each(deleteRoutes)(
		'$name delete finds an account after locking Employee and rolls back',
		async (route) => {
			const statements: string[] = [];
			mockExecute.mockImplementation(async (sql: unknown) => {
				const statement = String(sql);
				statements.push(statement);
				if (
					statement.includes('FROM employees') &&
					statement.includes('FOR UPDATE')
				) {
					return [[{ id: 5 }]];
				}
				if (
					statement.includes('FROM users') &&
					statement.includes('FOR UPDATE')
				) {
					return [[{ id: 25 }]];
				}
				return [[]];
			});

			const { DELETE } = await route.load();
			const response = await DELETE(route.request(), route.context);

			expect(response.status).toBe(409);
			expect(statements[0]).toContain('FROM employees');
			expect(statements[0]).toContain('FOR UPDATE');
			expect(statements[1]).toContain('FROM users');
			expect(statements[1]).toContain('FOR UPDATE');
			expect(mockBeginTransaction).toHaveBeenCalledOnce();
			expect(mockRollback).toHaveBeenCalledOnce();
			expect(mockCommit).not.toHaveBeenCalled();
			expect(mockExecute).not.toHaveBeenCalledWith(
				expect.stringContaining('UPDATE employees SET isDelete = 1'),
				expect.anything()
			);
			expect(mockRelease).toHaveBeenCalledOnce();
		}
	);

	it.each(deleteRoutes)(
		'$name delete rolls back and releases when a locked read fails',
		async (route) => {
			mockExecute.mockRejectedValueOnce(new Error('database read failed'));

			const { DELETE } = await route.load();
			const response = await DELETE(route.request(), route.context);

			expect(response.status).toBe(500);
			expect(mockRollback).toHaveBeenCalledOnce();
			expect(mockCommit).not.toHaveBeenCalled();
			expect(mockRelease).toHaveBeenCalledOnce();
		}
	);
});
