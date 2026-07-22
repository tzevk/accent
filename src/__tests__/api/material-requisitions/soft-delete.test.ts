import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	query: mockQuery,
	execute: vi.fn(),
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));

const { DELETE } = await import('@/app/api/admin/material-requisitions/route');
const { GET: nextGET } =
	await import('@/app/api/admin/material-requisitions/next-number/route');

function createRequest(opts: any = {}) {
	const req: any = {
		url: opts.url || 'http://localhost/api/admin/material-requisitions',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Material requisitions — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('DELETE uses UPDATE SET isDelete = 1, not DELETE FROM', async () => {
		mockQuery.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE material_requisitions'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[]]);
		});
		const r = await DELETE(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/admin/material-requisitions?id=1',
			})
		);
		const json = await r.json();
		expect(json.success).toBe(true);
		const sql = (mockQuery as any).mock.calls[0][0];
		expect(sql).toContain('SET isDelete = 1');
		expect(sql).not.toContain('DELETE FROM');
	});

	it('next-number GET excludes soft-deleted records', async () => {
		mockQuery.mockResolvedValueOnce([[]]);
		await nextGET();
		const sql = (mockQuery as any).mock.calls[0][0];
		expect(sql).toContain('isDelete = 0');
	});

	it('next-number has no CREATE TABLE DDL', async () => {
		mockQuery.mockResolvedValueOnce([[]]);
		await nextGET();
		const sqls = (mockQuery as any).mock.calls.map((c: any) => c[0]).join(' ');
		expect(sqls).not.toContain('CREATE TABLE');
	});
});
