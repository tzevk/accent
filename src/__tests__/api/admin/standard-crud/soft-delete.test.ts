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
	RESOURCES: { PROPOSALS: 'proposals', OTHER_EXPENSES: 'other_expenses' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));
vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn().mockResolvedValue(undefined),
}));

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
		url: opts.url || 'http://localhost/api/test',
		method: opts.method || 'GET',
		headers: new Headers(),
	};
	if (opts.body) req.json = vi.fn().mockResolvedValue(opts.body);
	return req;
}

const { GET: expensesGET } = await import('@/app/api/admin/expenses/route');
const { DELETE: expensesIdDELETE } =
	await import('@/app/api/admin/expenses/[id]/route');
const { GET: payablesGET } =
	await import('@/app/api/admin/payment-payables/route');
const { DELETE: payablesIdDELETE } =
	await import('@/app/api/admin/payment-payables/[id]/route');
const { DELETE: receivablesIdDELETE } =
	await import('@/app/api/admin/payment-receivables/[id]/route');
const { DELETE: invoicesIdDELETE } =
	await import('@/app/api/admin/purchase-invoices/[id]/route');
describe('Standard admin CRUD — soft delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const tables = [
		{
			name: 'expenses',
			GET: expensesGET,
			DEL: expensesIdDELETE,
			needsParams: true,
		},
		{
			name: 'payment_payables',
			GET: payablesGET,
			DEL: payablesIdDELETE,
			needsParams: true,
		},
	];

	for (const { name, GET, DEL, needsParams } of tables) {
		describe(name, () => {
			it('SELECTs filter by isDelete = 0 in GET', async () => {
				mockExecute.mockImplementation((sql: string) => {
					if (sql.includes('SELECT COUNT'))
						return Promise.resolve([[{ total: 0 }]]);
					if (sql.includes('FROM')) return Promise.resolve([[]]);
					return Promise.resolve([[{ total: 0, draft: 0 }]]);
				});
				await GET(createRequest({ url: `http://localhost/api/admin/${name}` }));
				const sqls = mockExecute.mock.calls
					.map((c: MockCall) => c[0])
					.join(' ');
				expect(sqls).toContain('isDelete = 0');
			});

			it('uses UPDATE SET isDelete = 1, not DELETE FROM', async () => {
				mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
				const r = needsParams
					? await DEL(
							createRequest({
								method: 'DELETE',
								url: `http://localhost/api/admin/${name}/1`,
							}),
							{ params: Promise.resolve({ id: '1' }) }
						)
					: await DEL(
							createRequest({
								method: 'DELETE',
								url: `http://localhost/api/admin/${name}?id=1`,
							})
						);
				if (r instanceof Response) {
					const json = await r.json();
					expect(json.success).toBe(true);
				}
				const sql = mockExecute.mock.calls[0][0] as string;
				expect(sql).toContain('SET isDelete = 1');
				expect(sql).not.toContain('DELETE FROM');
				expect(sql).toContain('isDelete = 0');
			});
		});
	}

	it('payment_payables [id] DELETE soft-deletes with isDelete guard', async () => {
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		await payablesIdDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const sql = mockExecute.mock.calls[0][0];
		expect(sql).toContain('SET isDelete = 1');
		expect(sql).toContain('isDelete = 0');
	});

	it('payment_receivables [id] DELETE soft-deletes with isDelete guard', async () => {
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		await receivablesIdDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const sql = mockExecute.mock.calls[0][0];
		expect(sql).toContain('SET isDelete = 1');
	});

	it('purchase_invoices [id] DELETE soft-deletes with isDelete guard', async () => {
		mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
		await invoicesIdDELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const sql = mockExecute.mock.calls[0][0];
		expect(sql).toContain('SET isDelete = 1');
	});

	it('nextNumber queries exclude soft-deleted records', async () => {
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('SELECT COUNT'))
				return Promise.resolve([[{ total: 0 }]]);
			if (sql.includes('FROM')) return Promise.resolve([[]]);
			return Promise.resolve([[{ total: 0 }]]);
		});
		const { GET } = await import('@/app/api/admin/payment-payables/route');
		await GET(
			createRequest({ url: 'http://localhost/api/admin/payment-payables' })
		);
		const sqls = mockExecute.mock.calls.map((c: MockCall) => c[0]).join(' ');
		expect(sqls).toContain('isDelete');
	});
});
