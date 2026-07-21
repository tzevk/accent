import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	end: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn().mockResolvedValue({ authorized: true }),
	RESOURCES: { PROPOSALS: 'proposals' },
	PERMISSIONS: { READ: 'read', WRITE: 'write' },
}));

const { GET, POST } = await import('@/app/api/admin/invoices/route');

function createRequest({
	method = 'GET',
	body = null,
	url = 'http://localhost/api/admin/invoices',
} = {}) {
	const req = { url, method };
	if (body) {
		req.json = vi.fn().mockResolvedValue(body);
	}
	return req;
}

describe('Invoice API — GET /api/admin/invoices', () => {
	const mockInvoices = [
		{
			id: 1,
			invoice_number: 'ATS-I/JAN-26/001',
			client_name: 'Test Client',
			total: 50000,
			status: 'draft',
			line_items: null,
			items: null,
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockImplementation((sql) => {
			if (sql.includes('SELECT COUNT')) {
				return Promise.resolve([[{ total: 1 }]]);
			}
			if (sql.includes('SELECT * FROM invoices')) {
				return Promise.resolve([mockInvoices]);
			}
			if (sql.includes('SUM(CASE WHEN')) {
				return Promise.resolve([
					[{ total: 1, draft: 1, sent: 0, paid: 0, overdue: 0, cancelled: 0 }],
				]);
			}
			return Promise.resolve([]);
		});
	});

	it('returns paginated invoices with stats', async () => {
		const response = await GET(createRequest());
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data).toEqual(mockInvoices);
		expect(json.stats.total).toBe(1);
		expect(json.stats.draft).toBe(1);
	});

	it('returns 401 when unauthorized', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		ensurePermission.mockResolvedValueOnce({
			authorized: false,
			response: NextResponse.json(
				{ success: false, message: 'Unauthorized' },
				{ status: 401 }
			),
		});

		const response = await GET(createRequest());
		expect(response.status).toBe(401);
	});
});

describe('Invoice API — POST /api/admin/invoices', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates an invoice and upserts a purchase order', async () => {
		const body = {
			client_name: 'Test Client',
			po_number: 'PO-001',
			original_po_value: '100000',
			total: 25000,
			invoice_date: '2026-01-15',
			line_items: [
				{
					sr_no: 1,
					description: 'Service',
					unit: '1',
					charges: '25000',
					amount: '25000',
				},
			],
			gst_type: 'cgst_sgst',
			cgst_rate: 9,
			sgst_rate: 9,
			status: 'draft',
		};

		mockExecute.mockImplementation((sql) => {
			if (sql.includes('SELECT COUNT')) {
				return Promise.resolve([[{ count: 0 }]]);
			}
			if (sql.includes('FROM purchase_orders WHERE')) {
				return Promise.resolve([[]]);
			}
			if (sql.includes('FROM invoices WHERE invoice_number')) {
				return Promise.resolve([[]]);
			}
			if (sql.includes('INSERT INTO purchase_orders')) {
				return Promise.resolve([{ insertId: 10 }]);
			}
			if (sql.includes('INSERT INTO invoices')) {
				return Promise.resolve([{ insertId: 42 }]);
			}
			return Promise.resolve([]);
		});

		const response = await POST(createRequest({ method: 'POST', body }));
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.id).toBe(42);
		expect(json.data.invoice_number).toMatch(/^ATS-I\//);
	});

	it('returns 400 when client_name is missing', async () => {
		const body = { client_name: '' };
		const response = await POST(createRequest({ method: 'POST', body }));
		const json = await response.json();

		expect(response.status).toBe(400);
		expect(json.message).toBe('Client name is required');
	});

	it('uses existing PO and deducts balance', async () => {
		const body = {
			client_name: 'Existing Client',
			po_number: 'PO-EXISTING',
			original_po_value: '100000',
			total: 30000,
			line_items: [],
			gst_type: 'cgst_sgst',
			status: 'draft',
		};

		mockExecute.mockImplementation((sql) => {
			if (sql.includes('SELECT COUNT')) {
				return Promise.resolve([[{ count: 5 }]]);
			}
			if (sql.includes('FROM purchase_orders WHERE')) {
				return Promise.resolve([[{ id: 5, remaining_balance: 70000 }]]);
			}
			if (sql.includes('FROM invoices WHERE invoice_number')) {
				return Promise.resolve([[]]);
			}
			if (sql.includes('UPDATE purchase_orders')) {
				return Promise.resolve([]);
			}
			if (sql.includes('INSERT INTO invoices')) {
				return Promise.resolve([{ insertId: 43 }]);
			}
			return Promise.resolve([]);
		});

		const response = await POST(createRequest({ method: 'POST', body }));
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.id).toBe(43);

		const updateCall = mockExecute.mock.calls.find(
			([sql]) =>
				typeof sql === 'string' && sql.includes('UPDATE purchase_orders')
		);
		expect(updateCall).toBeDefined();
		expect(updateCall[1][0]).toBeCloseTo(40000);
	});

	it('returns 409 when invoice_number already exists', async () => {
		const body = {
			client_name: 'Test Client',
			invoice_number: 'ATS-I/JAN-26/001',
			line_items: [
				{
					sr_no: 1,
					description: 'Service',
					unit: '1',
					charges: '25000',
					amount: '25000',
				},
			],
			total: 25000,
			gst_type: 'cgst_sgst',
			status: 'draft',
		};

		mockExecute.mockImplementation((sql) => {
			if (sql.includes('FROM invoices WHERE invoice_number')) {
				return Promise.resolve([[{ id: 1 }]]);
			}
			return Promise.resolve([]);
		});

		const response = await POST(createRequest({ method: 'POST', body }));
		const json = await response.json();

		expect(response.status).toBe(409);
		expect(json.success).toBe(false);
		expect(json.message).toMatch(/already exists/);
	});

	it('returns 409 with po_number field when purchase_order po_number collides', async () => {
		const body = {
			client_name: 'Aaspire World',
			po_number: 'PO029929',
			original_po_value: '100000',
			total: 25000,
			line_items: [
				{
					sr_no: 1,
					description: 'Service',
					unit: '1',
					charges: '25000',
					amount: '25000',
				},
			],
			gst_type: 'cgst_sgst',
			status: 'draft',
		};

		mockExecute.mockImplementation((sql) => {
			if (sql.includes('SELECT COUNT')) {
				return Promise.resolve([[{ count: 0 }]]);
			}
			if (sql.includes('FROM invoices WHERE invoice_number')) {
				return Promise.resolve([[]]);
			}
			if (sql.includes('FROM purchase_orders WHERE')) {
				return Promise.resolve([[]]);
			}
			if (sql.includes('INSERT INTO invoices')) {
				const err = new Error("Duplicate entry 'PO029929' for key 'po_number'");
				err.code = 'ER_DUP_ENTRY';
				err.errno = 1062;
				err.sqlMessage = "Duplicate entry 'PO029929' for key 'po_number'";
				return Promise.reject(err);
			}
			return Promise.resolve([[]]);
		});

		const response = await POST(createRequest({ method: 'POST', body }));
		const json = await response.json();

		expect(response.status).toBe(409);
		expect(json.success).toBe(false);
		expect(json.errors?.[0]?.field).toBe('po_number');
		expect(json.errors?.[0]?.message).toMatch(/purchase order/i);
	});
});
