import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/server-auth', () => ({
	getServerAuth: vi
		.fn()
		.mockResolvedValue({
			user: {
				id: 1,
				is_super_admin: true,
				full_name: 'Admin',
				username: 'admin',
			},
		}),
}));

const { DELETE: idDELETE } = await import('@/app/api/tickets/[id]/route');

function createRequest(opts: any = {}) {
	const req: any = {
		url: opts.url || 'http://localhost/api/tickets/1',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

describe('Tickets — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('DELETE uses UPDATE SET isDelete = 1, not DELETE FROM', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE support_tickets SET isDelete'))
				return Promise.resolve([{ affectedRows: 1 }]);
			return Promise.resolve([
				[{ id: 1, user_id: 1, status: 'new', assigned_to: null }],
			]);
		});
		const r = await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await r.json();
		expect(json.success).toBe(true);
		const deleteSql = mockExecute.mock.calls.find((c: any) =>
			(c[0] as string).includes('SET isDelete = 1')
		)?.[0] as string;
		expect(deleteSql).toContain('SET isDelete = 1');
		expect(deleteSql).toContain('isDelete = 0');
	});

	it('SELECT queries filter by isDelete = 0', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('support_tickets'))
				return Promise.resolve([
					[{ id: 1, user_id: 1, status: 'new', assigned_to: null }],
				]);
			if (sql.includes('ticket_comments')) return Promise.resolve([[]]);
			return Promise.resolve([[]]);
		});
		await idDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const selectSqls = mockExecute.mock.calls
			.filter((c: any) => (c[0] as string).includes('support_tickets'))
			.map((c: any) => c[0] as string);
		for (const sql of selectSqls) {
			if (sql.includes('SELECT')) {
				expect(sql).toContain('isDelete = 0');
			}
		}
	});
});
