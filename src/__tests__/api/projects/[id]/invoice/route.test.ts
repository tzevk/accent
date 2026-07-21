import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	release: vi.fn(),
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

const { GET, DELETE: DELETE_ } =
	await import('@/app/api/projects/[id]/invoice/route');

function createRequest({
	method = 'GET',
	body = null,
	url = 'http://localhost/api/projects/1/invoice',
	searchParams = '',
} = {}) {
	return {
		url: url + (searchParams ? `?${searchParams}` : ''),
		method,
		headers: new Headers(),
		...(body ? { json: vi.fn().mockResolvedValue(body) } : {}),
	};
}

const mockInvoice = {
	id: 1,
	project_id: 1,
	invoice_number: 'ATS/I/07-26/228',
	invoice_date: '2026-07-21',
	company_name: 'Test Company',
	city: 'Mumbai',
	invoice_amount: 50000,
	project_number: '001_07_2026',
	expenses_head: 'Engineering',
	payment: 0,
	purchase_description: 'Test',
	payment_overdue_days: 0,
	remarks: null,
	tab_type: 'invoice',
	isDelete: 0,
	created_at: '2026-07-21T00:00:00.000Z',
	updated_at: '2026-07-21T00:00:00.000Z',
};

describe('Project Invoices API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/projects/[id]/invoice', () => {
		it('fetches invoices filtered by isDelete', async () => {
			mockExecute
				.mockResolvedValueOnce([[mockInvoice]])
				.mockResolvedValueOnce([[{ count: 1 }]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			const invoiceSql = mockExecute.mock.calls[0][0];
			expect(invoiceSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});

		it('COUNT query excludes soft-deleted invoices for next number', async () => {
			mockExecute
				.mockResolvedValueOnce([[]])
				.mockResolvedValueOnce([[{ count: 5 }]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			const countSql = mockExecute.mock.calls[1][0];
			expect(countSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});
	});

	describe('DELETE /api/projects/[id]/invoice', () => {
		it('soft-deletes invoice instead of hard delete', async () => {
			mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);

			const response = await DELETE_(
				createRequest({
					method: 'DELETE',
					url: 'http://localhost/api/projects/1/invoice?invoiceId=1',
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			const deleteSql = mockExecute.mock.calls[0][0];
			expect(deleteSql).toContain('SET isDelete = 1');
			expect(deleteSql).not.toContain('DELETE FROM');
			expect(deleteSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});
	});
});
