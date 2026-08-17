import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({ dbConnect: mockDbConnect }));
vi.mock('@/utils/server-auth', () => ({
	getServerAuth: vi.fn().mockResolvedValue({
		user: {
			id: 1,
			is_super_admin: true,
			full_name: 'Admin',
			username: 'admin',
		},
	}),
}));

const { GET: idGET, DELETE: idDELETE } =
	await import('@/app/api/tickets/[id]/route');
const { POST } = await import('@/app/api/tickets/route');

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
		const deleteSql = mockExecute.mock.calls.find((c: MockCall) =>
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
			.filter((c: MockCall) => (c[0] as string).includes('support_tickets'))
			.map((c: MockCall) => c[0] as string);
		for (const sql of selectSqls) {
			if (sql.includes('SELECT')) {
				expect(sql).toContain('isDelete = 0');
			}
		}
	});

	it('uses a schema-supported category when category is omitted', async () => {
		mockExecute
			.mockResolvedValueOnce([[]])
			.mockResolvedValueOnce([{ insertId: 1 }])
			.mockResolvedValueOnce([[{ id: 1, category: 'other' }]]);

		const response = await POST(
			createRequest({
				method: 'POST',
				body: {
					subject: 'Cannot access report',
					description: 'The report page is unavailable.',
				},
			})
		);

		const json = await response.json();
		expect(response.status).toBe(200);
		expect(json.success).toBe(true);

		const insertCall = mockExecute.mock.calls[1] as MockCall;
		expect(insertCall[1]).toEqual([
			expect.stringMatching(/^TKT-\d{6}-\d{4}$/),
			1,
			'Cannot access report',
			'The report page is unavailable.',
			'other',
			'medium',
		]);
	});

	it('returns empty attachments for malformed comment JSON', async () => {
		mockExecute.mockReset();
		mockExecute
			.mockResolvedValueOnce([
				[{ id: 4, user_id: 1, title: 'Cannot access report' }],
			])
			.mockResolvedValueOnce([
				[
					{ id: 1, attachments: '' },
					{ id: 2, attachments: 'not-json' },
					{ id: 3, attachments: '["file.pdf"]' },
				],
			]);

		const response = await idGET(createRequest(), {
			params: Promise.resolve({ id: '4' }),
		});

		const json = await response.json();
		expect(response.status).toBe(200);
		expect(json.success).toBe(true);
		expect(json.data.comments).toEqual([
			{ id: 1, attachments: [] },
			{ id: 2, attachments: [] },
			{ id: 3, attachments: ['file.pdf'] },
		]);
	});
});
