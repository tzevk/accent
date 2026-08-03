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
	RESOURCES: { SETTINGS: 'settings' },
	PERMISSIONS: { READ: 'read', UPDATE: 'update', DELETE: 'delete' },
	invalidateUserCache: vi.fn(),
}));

const { PUT, DELETE } = await import('@/app/api/roles/route');

type MockCall = unknown[];

function createRequest(opts: {
	url?: string;
	method?: string;
	body?: unknown;
}) {
	const req: Request & {
		json?: () => Promise<unknown>;
	} = new Request(opts.url || 'http://localhost/api/roles', {
		method: opts.method || 'GET',
	});
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Roles — cache invalidation on permission mutations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('PUT invalidates the whole user cache when role permissions change', async () => {
		const invalidateUserCache = (await import('@/utils/api-permissions'))
			.invalidateUserCache as ReturnType<typeof vi.fn>;
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('CREATE TABLE')) return Promise.resolve([]);
			if (sql.includes('UPDATE roles'))
				return Promise.resolve([{ affectedRows: 1 }]);
			if (sql.includes('SELECT * FROM roles'))
				return Promise.resolve([[{ id: 1, role_key: 'manager' }]]);
			return Promise.resolve([[{ id: 1 }]]); // existing role
		});
		const r = await PUT(
			createRequest({
				method: 'PUT',
				body: { id: 1, permissions: ['leads:read'] },
			})
		);
		const json = await r.json();
		expect(json.success).toBe(true);
		expect(invalidateUserCache).toHaveBeenCalledWith();
	});

	it('DELETE invalidates the whole user cache', async () => {
		const invalidateUserCache = (await import('@/utils/api-permissions'))
			.invalidateUserCache as ReturnType<typeof vi.fn>;
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('CREATE TABLE')) return Promise.resolve([]);
			if (sql.includes('DELETE FROM roles'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[{ id: 1 }]]); // existing role
		});
		const r = await DELETE(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/roles?id=1',
			})
		);
		const json = await r.json();
		expect(json.success).toBe(true);
		expect(invalidateUserCache).toHaveBeenCalledWith();
	});
});
