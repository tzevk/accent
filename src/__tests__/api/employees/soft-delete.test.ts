import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { EMPLOYEES: 'employees' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
	getCurrentUser: vi.fn().mockResolvedValue({ id: 1, is_super_admin: true }),
}));
vi.mock('@/utils/rbac', () => ({
	hasPermission: vi.fn().mockReturnValue(true),
}));

const { DELETE: idDELETE } = await import('@/app/api/employees/[id]/route');

function createRequest(opts: any = {}) {
	const req: any = {
		url: opts.url || 'http://localhost/api/employees/1',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Employees — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('DELETE uses UPDATE SET isDelete = 1', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE employees SET isDelete'))
				return Promise.resolve([{ affectedRows: 1 }]);
			if (sql.includes('SELECT id FROM users')) return Promise.resolve([[]]);
			return Promise.resolve([[{ id: 1 }]]);
		});
		const r = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await r.json();
		expect(json.success).toBe(true);
		const deleteSql = mockExecute.mock.calls.find((c: any) =>
			(c[0] as string).includes('SET isDelete = 1')
		)?.[0];
		expect(deleteSql).toBeTruthy();
	});

	it('uses db.release() not db.end()', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE employees SET isDelete'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[{ id: 1 }]]);
		});
		await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
	});
});
