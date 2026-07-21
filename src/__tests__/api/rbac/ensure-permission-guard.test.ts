import { describe, it, expect, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn().mockResolvedValue([[]]);
const mockDbConnect = vi.fn().mockResolvedValue({
	execute: mockExecute,
	end: vi.fn(),
	release: vi.fn(),
});

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
	query: vi.fn().mockResolvedValue([[]]),
}));

vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: vi.fn(),
	RESOURCES: {
		PROPOSALS: 'proposals',
		PROJECTS: 'projects',
		LEADS: 'leads',
		FOLLOWUPS: 'followups',
		EMPLOYEES: 'employees',
		ATTENDANCE: 'attendance',
		VENDORS: 'vendors',
	},
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
	getCurrentUser: vi.fn(),
}));

vi.mock('@/utils/rbac', () => ({
	hasPermission: vi.fn().mockReturnValue(false),
}));

vi.mock('@/utils/activity-logger', () => ({
	logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: vi.fn().mockResolvedValue(new Set()),
	getPrimaryKeyColumn: vi.fn().mockResolvedValue('id'),
	hasColumn: vi.fn().mockResolvedValue(false),
}));

function createRequest({
	method = 'GET',
	body = null,
	url = 'http://localhost/api/test',
	searchParams = '',
} = {}) {
	const req = {
		url: url + (searchParams ? `?${searchParams}` : ''),
		method,
		headers: new Headers(),
	};
	if (body) {
		(req as any).json = vi.fn().mockResolvedValue(body);
	}
	return req;
}

describe('ensurePermission guard — instanceof Response pattern', () => {
	it('returns the NextResponse when ensurePermission fails with 403', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
		ensurePermission.mockResolvedValue(deniedResponse);

		const { GET } = await import('@/app/api/admin/quotations/route');
		const response = await GET(
			createRequest({ url: 'http://localhost/api/admin/quotations' })
		);
		expect(response.status).toBe(403);
	});

	it('rejects unauthorized deletion with NextResponse guard', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
		ensurePermission.mockResolvedValueOnce(deniedResponse);

		const { DELETE: DELETE_ } =
			await import('@/app/api/admin/quotations/route');
		const response = await DELETE_(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/admin/quotations?id=1&source=quotations',
			})
		);
		expect(response.status).toBe(403);
	});

	it('rejects unauthorized POST with NextResponse guard', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
		ensurePermission.mockResolvedValue(deniedResponse);

		const { POST } = await import('@/app/api/admin/quotations/route');
		const response = await POST(
			createRequest({
				method: 'POST',
				body: { quotation_number: 'Q-001', client_name: 'Test' },
				url: 'http://localhost/api/admin/quotations',
			})
		);
		expect(response.status).toBe(403);
	});

	it('rejects unauthorized DELETE with NextResponse guard', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
		ensurePermission.mockResolvedValue(deniedResponse);

		const { DELETE: DELETE_ } =
			await import('@/app/api/admin/quotations/route');
		const response = await DELETE_(
			createRequest({
				method: 'DELETE',
				url: 'http://localhost/api/admin/quotations?id=1&source=quotations',
			})
		);
		expect(response.status).toBe(403);
	});

	it('rejects unauthorized PUT with NextResponse guard', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
		ensurePermission.mockResolvedValue(deniedResponse);

		const { PUT } = await import('@/app/api/admin/quotations/[id]/route');
		const response = await PUT(
			createRequest({
				method: 'PUT',
				body: {},
				url: 'http://localhost/api/admin/quotations/1?source=quotations',
			}),
			{ params: Promise.resolve({ id: '1' }) }
		);
		expect(response.status).toBe(403);
	});

	it('rejects unauthorized followups POST with NextResponse guard', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		const deniedResponse = NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
		ensurePermission.mockResolvedValue(deniedResponse);

		const { POST } = await import('@/app/api/projects/[id]/followups/route');
		const response = await POST(
			createRequest({
				method: 'POST',
				body: { follow_up_date: '2026-07-21', description: 'Test' },
				url: 'http://localhost/api/projects/1/followups',
			}),
			{ params: Promise.resolve({ id: '1' }) }
		);
		expect(response.status).toBe(403);
	});

	it('allows request when ensurePermission returns authorized', async () => {
		const { ensurePermission } = await import('@/utils/api-permissions');
		ensurePermission.mockResolvedValue({
			authorized: true,
			user: { id: 1, is_super_admin: true },
		});
		mockExecute.mockImplementation((sql: string) => {
			if (sql.includes('FROM quotations')) {
				return Promise.resolve([
					[
						{
							id: 1,
							quotation_number: 'Q-001',
							client_name: 'Test',
							total: 100,
							status: 'draft',
							created_at: '2026-01-01',
						},
					],
				]);
			}
			return Promise.resolve([[]]);
		});

		const { GET } = await import('@/app/api/admin/quotations/route');
		const response = await GET(
			createRequest({ url: 'http://localhost/api/admin/quotations' })
		);
		const json = await response.json();
		expect(json.success).toBe(true);
	});
});
