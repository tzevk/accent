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
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { DELETE: softwareDELETE } = await import('@/app/api/software/route');
const { DELETE: versionsDELETE } =
	await import('@/app/api/software-versions/route');
const { DELETE: masterDELETE } =
	await import('@/app/api/software-master/route');

function createRequest(opts: any = {}) {
	const req: any = {
		url: opts.url || 'http://localhost/api/test',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Software — cascade soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('software/route.js soft-deletes software and cascades to versions', async () => {
		mockExecute
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);
		const r = await softwareDELETE(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/software?id=1',
			})
		);
		const json = await r.json();
		expect(json.success).toBeTruthy();
		const sqls = mockExecute.mock.calls.map((c: any) => c[0] as string);
		expect(sqls[0]).toContain('software_versions');
		expect(sqls[0]).toContain('SET isDelete = 1');
		expect(sqls[1]).toContain('softwares');
		expect(sqls[1]).toContain('SET isDelete = 1');
	});

	it('software-versions/route.js soft-deletes single version', async () => {
		mockExecute.mockResolvedValueOnce([
			[{ id: '1', software_id: '1', name: 'v1' }],
		]);
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		const r = await versionsDELETE(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/software-versions?id=1',
			})
		);
		const json = await r.json();
		expect(json.success).toBeTruthy();
		const sql = mockExecute.mock.calls[1][0];
		expect(sql).toContain('SET isDelete = 1');
		expect(sql).toContain('isDelete = 0');
	});

	it('software-master/route.js cascades: versions → softwares → category', async () => {
		mockExecute.mockImplementation(() => Promise.resolve(undefined));
		const r = await masterDELETE(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/software-master?id=1',
			})
		);
		const json = await r.json();
		expect(json.success).toBeTruthy();
		const sqls = mockExecute.mock.calls.map((c: any) => c[0] as string);
		expect(sqls[0]).toContain('software_versions');
		expect(sqls[0]).toContain('SET isDelete = 1');
		expect(sqls[1]).toContain('softwares');
		expect(sqls[1]).toContain('SET isDelete = 1');
		expect(sqls[2]).toContain('software_categories');
		expect(sqls[2]).toContain('SET isDelete = 1');
	});
});
