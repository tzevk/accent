import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const mockQuery = vi.fn();
const mockDbConnect = vi.fn().mockResolvedValue({
	query: mockQuery,
	release: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn().mockResolvedValue({ authorized: true }),
	RESOURCES: { MATERIAL_REQUISITION: 'material_requisition' },
	PERMISSIONS: { READ: 'read' },
}));

const { GET } =
	await import('@/app/api/admin/material-requisitions/download/route');

function createRequest(url: string) {
	return { url };
}

describe('Material Requisition Download — GET', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 403 when user lacks permission', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		ensurePermission.mockResolvedValueOnce({
			authorized: false,
			response: NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			),
		});

		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download?id=1'
		);
		const response = await GET(req as any);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe('Forbidden');
	});

	it('returns 401 when unauthenticated', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
		ensurePermission.mockResolvedValueOnce(deniedResponse);

		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download?id=1'
		);
		const response = await GET(req as any);

		expect(response.status).toBe(401);
	});

	it('returns 400 when no ID is provided', async () => {
		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download'
		);
		const response = await GET(req as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('ID is required');
	});

	it('returns 404 when requisition is not found', async () => {
		mockQuery.mockResolvedValueOnce([[]]);

		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download?id=999'
		);
		const response = await GET(req as any);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error).toBe('Requisition not found');
	});

	it('returns HTML with requisition data when found', async () => {
		const mockRequisition = {
			id: 1,
			requisition_number: 'MR-2024-001',
			requisition_date: '2024-01-15',
			requested_by: 'John Doe',
			department: 'Engineering',
			prepared_by: 'Jane Smith',
			checked_by: 'Bob Wilson',
			approved_by: 'Alice Brown',
			received_by: 'Charlie Davis',
			receipt_date: '2024-01-20',
			line_items: JSON.stringify([
				{
					sr_no: 1,
					description: 'Laptop',
					unit_qty: '1 pcs',
					purpose: 'Development',
				},
				{
					sr_no: 2,
					description: 'Monitor',
					unit_qty: '2 pcs',
					purpose: 'Design',
				},
			]),
		};

		mockQuery.mockResolvedValueOnce([[mockRequisition]]);

		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download?id=1'
		);
		const response = await GET(req as any);

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('text/html');

		const html = await response.text();

		// Verify key data is present in the HTML
		expect(html).toContain('MR-2024-001');
		expect(html).toContain('John Doe');
		expect(html).toContain('Engineering');
		expect(html).toContain('Laptop');
		expect(html).toContain('Monitor');
		expect(html).toContain('MATERIAL / STATIONERY REQUISITION FORM');
	});

	it('handles string line_items that are valid JSON', async () => {
		const mockRequisition = {
			id: 2,
			requisition_number: 'MR-2024-002',
			requisition_date: '2024-02-01',
			requested_by: '',
			department: '',
			prepared_by: '',
			checked_by: '',
			approved_by: '',
			received_by: '',
			receipt_date: null,
			line_items: JSON.stringify([
				{
					sr_no: 1,
					description: 'Paper',
					unit_qty: '5 reams',
					purpose: 'Office',
				},
			]),
		};

		mockQuery.mockResolvedValueOnce([[mockRequisition]]);

		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download?id=2'
		);
		const response = await GET(req as any);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('Paper');
		expect(html).toContain('5 reams');
	});

	it('handles already-parsed line_items (object array)', async () => {
		const mockRequisition = {
			id: 3,
			requisition_number: 'MR-2024-003',
			requisition_date: '2024-03-01',
			requested_by: '',
			department: '',
			prepared_by: '',
			checked_by: '',
			approved_by: '',
			received_by: '',
			receipt_date: null,
			line_items: [
				{
					sr_no: 1,
					description: 'Pen',
					unit_qty: '10 pcs',
					purpose: 'Stationery',
				},
			],
		};

		mockQuery.mockResolvedValueOnce([[mockRequisition]]);

		const req = createRequest(
			'http://localhost/api/admin/material-requisitions/download?id=3'
		);
		const response = await GET(req as any);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain('Pen');
	});
});
