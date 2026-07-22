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
	RESOURCES: { COMPANIES: 'companies', LEADS: 'leads' },
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

const { GET: routeGET } = await import('@/app/api/companies/route');
const {
	GET: idGET,
	PUT: idPUT,
	DELETE: idDELETE,
} = await import('@/app/api/companies/[id]/route');

type CreateRequestOpts = { url?: string; method?: string; body?: unknown };
type MockRequest = {
	url: string;
	method: string;
	headers: Headers;
	json?: () => Promise<unknown>;
};
type MockCall = unknown[];

function createRequest(opts: CreateRequestOpts = {}) {
	const req: MockRequest = {
		url: opts.url || 'http://localhost/api/companies',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Companies — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('DELETE uses UPDATE SET isDelete = 1, not DELETE FROM', async () => {
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		const r = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await r.json();
		expect(json.success).toBe(true);
		const sql = mockExecute.mock.calls[0][0];
		expect(sql).toContain('SET isDelete = 1');
		expect(sql).not.toContain('DELETE FROM');
	});

	it('GET [id] filters by isDelete = 0', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: 1, company_name: 'Test', isDelete: 0 }],
		]);
		await idGET(createRequest(), { params: Promise.resolve({ id: '1' }) });
		expect(mockExecute.mock.calls[0][0]).toContain('isDelete = 0');
	});

	it('GET list joins with isDelete = 0', async () => {
		mockExecute.mockResolvedValueOnce([[]]);
		await routeGET(createRequest({ url: 'http://localhost/api/companies' }));
		expect(mockExecute.mock.calls[0][0]).toContain('c.isDelete = 0');
	});

	it('PUT UPDATE gates with isDelete = 0', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[]]);
		});
		await idPUT(
			createRequest({ method: 'PUT', body: { company_name: 'Updated' } }),
			{ params: Promise.resolve({ id: '1' }) }
		);
		const updateSql = mockExecute.mock.calls.find((c: MockCall) =>
			(c[0] as string).includes('UPDATE')
		)?.[0] as string;
		expect(updateSql).toContain('isDelete = 0');
	});
});
