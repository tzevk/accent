import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.fn();
const mockEnd = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	end: mockEnd,
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/server-auth', () => ({
	getServerAuth: vi
		.fn()
		.mockResolvedValue({ authenticated: true, user: { id: 1 } }),
}));

const { GET, PUT, DELETE } =
	await import('@/app/api/admin/invoices/[id]/route');

function createRequest({ method = 'GET', body = null } = {}) {
	const req = { method };
	if (body) {
		req.json = vi.fn().mockResolvedValue(body);
	}
	return req;
}

describe('Invoice API — GET /api/admin/invoices/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockReset();
	});

	it('returns a single invoice by id', async () => {
		const invoice = {
			id: 1,
			invoice_number: 'ATS-I/JAN-26/001',
			client_name: 'Test Client',
			total: 50000,
			line_items: JSON.stringify([
				{ sr_no: 1, description: 'Service', amount: 50000 },
			]),
			items: null,
		};

		mockExecute.mockResolvedValueOnce([[invoice]]);

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.data.invoice_number).toBe('ATS-I/JAN-26/001');
	});

	it('returns 404 when invoice not found', async () => {
		mockExecute.mockResolvedValueOnce([[]]);

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: '999' }),
		});
		expect(response.status).toBe(404);
	});

	it('parses JSON line_items', async () => {
		const invoice = {
			id: 2,
			invoice_number: 'ATS-I/JAN-26/002',
			client_name: 'Client',
			line_items: JSON.stringify([
				{ sr_no: 1, description: 'Consulting', amount: 30000 },
			]),
		};

		mockExecute.mockResolvedValueOnce([[invoice]]);

		const response = await GET(createRequest(), {
			params: Promise.resolve({ id: '2' }),
		});
		const json = await response.json();

		expect(json.data.line_items).toEqual([
			{ sr_no: 1, description: 'Consulting', amount: 30000 },
		]);
	});
});

describe('Invoice API — PUT /api/admin/invoices/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockReset();
	});

	it('updates an invoice and adjusts PO balance', async () => {
		const body = {
			client_name: 'Client A',
			po_number: 'PO-001',
			original_po_value: '100000',
			total: 35000,
			line_items: [],
			gst_type: 'cgst_sgst',
			status: 'sent',
		};

		mockExecute.mockImplementation((sql) => {
			if (sql.includes('FROM invoices WHERE')) {
				return Promise.resolve([
					[
						{
							total: 25000,
							po_number: 'PO-001',
							client_name: 'Client A',
							balance_po_value: 75000,
							po_id: 5,
						},
					],
				]);
			}
			if (sql.includes('FROM purchase_orders WHERE')) {
				return Promise.resolve([[{ id: 5, remaining_balance: 75000 }]]);
			}
			if (sql.includes('UPDATE purchase_orders SET remaining_balance')) {
				return Promise.resolve([]);
			}
			if (sql.includes('SELECT remaining_balance FROM purchase_orders')) {
				return Promise.resolve([[{ remaining_balance: 65000 }]]);
			}
			return Promise.resolve([]);
		});

		const response = await PUT(createRequest({ method: 'PUT', body }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await response.json();

		expect(json.success).toBe(true);
		expect(json.message).toBe('Invoice updated successfully');

		const selectPoCall = mockExecute.mock.calls.find(
			([sql]) =>
				typeof sql === 'string' &&
				sql.includes('SELECT remaining_balance FROM purchase_orders')
		);
		expect(selectPoCall).toBeDefined();
		expect(selectPoCall[1][0]).toBe(5);
	});

	it('handles PO change — restores old PO, deducts from new PO', async () => {
		const body = {
			client_name: 'New Client',
			po_number: 'PO-NEW',
			original_po_value: '200000',
			total: 50000,
			line_items: [],
			gst_type: 'cgst_sgst',
			status: 'sent',
		};

		mockExecute.mockImplementation((sql) => {
			if (sql.includes('FROM invoices WHERE')) {
				return Promise.resolve([
					[
						{
							total: 25000,
							po_number: 'PO-OLD',
							client_name: 'Old Client',
							balance_po_value: 50000,
							po_id: 3,
						},
					],
				]);
			}
			if (
				sql.includes(
					'UPDATE purchase_orders SET remaining_balance = remaining_balance'
				)
			) {
				return Promise.resolve([]);
			}
			if (sql.includes('FROM purchase_orders WHERE')) {
				return Promise.resolve([[]]);
			}
			if (sql.includes('INSERT INTO purchase_orders')) {
				return Promise.resolve([{ insertId: 20 }]);
			}
			return Promise.resolve([]);
		});

		const response = await PUT(createRequest({ method: 'PUT', body }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await response.json();

		expect(json.success).toBe(true);

		const restoreCall = mockExecute.mock.calls.find(
			([sql]) =>
				typeof sql === 'string' &&
				sql.includes(
					'UPDATE purchase_orders SET remaining_balance = remaining_balance'
				)
		);
		expect(restoreCall).toBeDefined();
		expect(restoreCall[1][0]).toBeCloseTo(25000);
		expect(restoreCall[1][1]).toBe(3);
	});

	it('returns 401 when unauthorized', async () => {
		const { getServerAuth } = await import('@/utils/server-auth');
		getServerAuth.mockResolvedValueOnce({ authenticated: false });

		const response = await PUT(createRequest({ method: 'PUT', body: {} }), {
			params: Promise.resolve({ id: '1' }),
		});
		expect(response.status).toBe(401);
	});
});

describe('Invoice API — DELETE /api/admin/invoices/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockExecute.mockReset();
	});

	it('deletes an invoice and restores PO balance', async () => {
		mockExecute.mockImplementation((sql) => {
			if (sql.includes('FROM invoices WHERE')) {
				return Promise.resolve([[{ total: 25000, po_id: 5 }]]);
			}
			if (sql.includes('UPDATE purchase_orders')) {
				return Promise.resolve([]);
			}
			if (sql.includes('DELETE FROM invoices')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		});

		const response = await DELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '1' }),
		});
		const json = await response.json();

		expect(json.success).toBe(true);

		const restoreCall = mockExecute.mock.calls.find(
			([sql]) =>
				typeof sql === 'string' &&
				sql.includes('UPDATE purchase_orders SET remaining_balance')
		);
		expect(restoreCall).toBeDefined();
		expect(restoreCall[1][0]).toBeCloseTo(25000);
	});

	it('returns 404 when invoice not found', async () => {
		mockExecute.mockImplementation((sql) => {
			if (sql.includes('FROM invoices WHERE')) {
				return Promise.resolve([[]]);
			}
			return Promise.resolve([]);
		});

		const response = await DELETE(createRequest({ method: 'DELETE' }), {
			params: Promise.resolve({ id: '999' }),
		});
		expect(response.status).toBe(404);
	});
});
