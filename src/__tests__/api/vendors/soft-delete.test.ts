import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockQuery = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	query: mockQuery,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { VENDORS: 'vendors' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { DELETE: idDELETE } = await import('@/app/api/vendors/[id]/route');

type CreateRequestOpts = { url?: string; method?: string; body?: unknown };
type MockRequest = {
	url: string;
	method: string;
	headers: Headers;
	json?: () => Promise<unknown>;
};

function createRequest(opts: CreateRequestOpts = {}) {
	const req: MockRequest = {
		url: opts.url || 'http://localhost/api/vendors/1',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Vendors — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('DELETE uses UPDATE SET isDelete = 1', async () => {
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
});
