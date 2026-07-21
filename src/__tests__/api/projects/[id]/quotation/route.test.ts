import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	end: vi.fn(),
	release: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

const { GET, POST } = await import('@/app/api/projects/[id]/quotation/route');

function createRequest({
	method = 'GET',
	body = null,
	url = 'http://localhost/api/projects/1/quotation',
} = {}) {
	return {
		url,
		method,
		headers: new Headers(),
		...(body ? { json: vi.fn().mockResolvedValue(body) } : {}),
	};
}

const mockQuotation = {
	id: 1,
	project_id: 1,
	quotation_number: 'ATSPL/Q/07/26-27/107',
	quotation_date: '2026-07-21',
	client_name: 'Test Client',
	enquiry_number: 'EQ-001',
	enquiry_quantity: '1',
	scope_of_work: 'Engineering services',
	gross_amount: 50000,
	gst_percentage: 18,
	gst_amount: 9000,
	net_amount: 59000,
	isDelete: 0,
	created_at: '2026-07-21T00:00:00.000Z',
	updated_at: '2026-07-21T00:00:00.000Z',
};

describe('Project Quotation API', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/projects/[id]/quotation', () => {
		it('fetches quotation filtered by isDelete', async () => {
			mockExecute.mockResolvedValueOnce([[mockQuotation]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			const sql = mockExecute.mock.calls[0][0];
			expect(sql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});

		it('COUNT query excludes soft-deleted quotations for next number', async () => {
			mockExecute
				.mockResolvedValueOnce([[]])
				.mockResolvedValueOnce([[{ count: 10 }]]);

			const response = await GET(createRequest(), {
				params: Promise.resolve({ id: '1' }),
			});
			const json = await response.json();

			expect(json.success).toBe(true);
			expect(mockExecute.mock.calls.length).toBe(2);
			const countSql = mockExecute.mock.calls[1][0];
			expect(countSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});
	});

	describe('POST /api/projects/[id]/quotation', () => {
		it('checks existence with isDelete filter', async () => {
			mockExecute
				.mockResolvedValueOnce([[]])
				.mockResolvedValueOnce([{ insertId: 2 }])
				.mockResolvedValueOnce([[{ ...mockQuotation, id: 2 }]]);

			const response = await POST(
				createRequest({
					method: 'POST',
					body: {
						quotation_number: 'ATSPL/Q/07/26-27/108',
						quotation_date: '2026-07-21',
						client_name: 'Test Client',
						enquiry_number: 'EQ-002',
						enquiry_quantity: '2',
						scope_of_work: 'New project',
						gross_amount: 100000,
						gst_percentage: 18,
						gst_amount: 18000,
						net_amount: 118000,
					},
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			const checkSql = mockExecute.mock.calls[0][0];
			expect(checkSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});

		it('post-upsert fetch filters by isDelete', async () => {
			mockExecute
				.mockResolvedValueOnce([[]])
				.mockResolvedValueOnce([{ insertId: 2 }])
				.mockResolvedValueOnce([[{ ...mockQuotation, id: 2 }]]);

			const response = await POST(
				createRequest({
					method: 'POST',
					body: {
						quotation_number: 'ATSPL/Q/07/26-27/108',
						quotation_date: '2026-07-21',
						client_name: 'Test Client',
					},
				}),
				{ params: Promise.resolve({ id: '1' }) }
			);
			const json = await response.json();

			expect(json.success).toBe(true);
			const fetchSql = mockExecute.mock.calls[2][0];
			expect(fetchSql).toContain('(isDelete = 0 OR isDelete IS NULL)');
		});
	});
});
