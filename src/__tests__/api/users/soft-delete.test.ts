import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

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
	RESOURCES: { USERS: 'users' },
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

const { DELETE: routeDELETE } = await import('@/app/api/users/route');
const { DELETE: idDELETE } = await import('@/app/api/users/[id]/route');
const { GET: listGET } = await import('@/app/api/users/list/route');

function createRequest(opts: any = {}) {
	const req: any = {
		url: opts.url || 'http://localhost/api/users',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Users — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('route.js DELETE uses UPDATE SET isDelete = 1', async () => {
		mockExecute
			.mockResolvedValueOnce([[{ id: '1' }]])
			.mockResolvedValueOnce([{ affectedRows: 1 }]);
		const r = await routeDELETE(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/users?id=1',
			})
		);
		const json = await r.json();
		expect(json.success).toBe(true);
		const sql = mockExecute.mock.calls[1][0] as string;
		expect(sql).toContain('SET isDelete = 1');
		expect(sql).not.toContain('DELETE FROM');
	});

	it('[id]/route.js DELETE uses UPDATE SET isDelete = 1', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE users SET isDelete'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[{ id: 1, is_super_admin: false }]]);
		});
		const r = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await r.json();
		expect(json.success).toBe(true);
		const deleteSql = mockExecute.mock.calls.find((c: any) =>
			(c[0] as string).includes('isDelete = 1')
		)?.[0];
		expect(deleteSql).toBeTruthy();
	});

	it('list/route.js filters by isDelete = 0 on all queries', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('COUNT')) return Promise.resolve([[{ total: 0 }]]);
			if (sql.includes('SUM'))
				return Promise.resolve([
					[{ total: 0, active: 0, inactive: 0, admins: 0 }],
				]);
			return Promise.resolve([[]]);
		});
		await listGET(createRequest({ url: 'http://localhost/api/users/list' }));
		const sqls = mockExecute.mock.calls.map((c: any) => c[0]).join(' ');
		expect(sqls).toContain('isDelete = 0');
		const count = (sqls.match(/isDelete = 0/g) || []).length;
		expect(count).toBeGreaterThanOrEqual(3);
	});
});
