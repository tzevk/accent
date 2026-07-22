import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});
const mockQuery = vi.fn().mockResolvedValue([[]]);

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi
		.fn()
		.mockResolvedValue({ authorized: true, user: { id: 1 } }),
	RESOURCES: { LEADS: 'leads' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { DELETE: idDELETE } = await import('@/app/api/followups/[id]/route');

function createRequest(opts: any = {}) {
	const req: any = {
		url: opts.url || 'http://localhost/api/followups/1',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Followups — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('DELETE uses UPDATE SET isDelete = 1 with isDelete guard', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE follow_ups SET isDelete'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[{ id: 1 }]]);
		});
		const r = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: { id: '1' },
		});
		const json = await r.json();
		expect(json.success).toBe(true);
		const deleteSql = mockExecute.mock.calls.find((c: any) =>
			(c[0] as string).includes('SET isDelete = 1')
		)?.[0] as string;
		expect(deleteSql).toContain('SET isDelete = 1');
		expect(deleteSql).toContain('isDelete = 0');
	});

	it('existence check filters by isDelete = 0', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('SET isDelete'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([[{ id: 1 }]]);
		});
		await idDELETE(createRequest({ method: 'DELETE' }), {
			params: { id: '1' },
		});
		const checkSql = mockExecute.mock.calls[0][0] as string;
		expect(checkSql).toContain('isDelete = 0');
	});
});
