import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTableColumns = vi.fn();
const mockFetchOrders = vi.fn();
const mockCreateOrder = vi.fn();

const mockDb = {
	execute: mockExecute,
	release: mockRelease,
};

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
	withTransaction: vi.fn(),
}));

let currentUser: Record<string, unknown> | null = null;

vi.mock('@/utils/api-permissions', () => ({
	getCurrentUser: mockGetCurrentUser,
	ensurePermission: vi.fn(async (_req, resource, permission) => {
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}
		const required = `${resource}:${permission}`;
		const merged = (currentUser.merged_permissions as string[]) || [];
		if (currentUser.is_super_admin || merged.includes(required)) {
			return { authorized: true, user: currentUser };
		}
		return NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
	}),
	RESOURCES: {
		QUOTATIONS: 'quotations',
		PURCHASE_ORDERS: 'purchase_orders',
		INVOICES: 'invoices',
		PROJECTS: 'projects',
	},
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

vi.mock('@/utils/schema-cache', () => ({
	getTableColumns: mockGetTableColumns,
}));

vi.mock('@/lib/company-expenditure', () => ({
	fetchOrders: mockFetchOrders,
	createOrder: mockCreateOrder,
	OrderError: class OrderError extends Error {
		status: number;
		code?: string;
		detail?: Record<string, unknown>;

		constructor(
			message: string,
			status = 400,
			code?: string,
			detail?: Record<string, unknown>
		) {
			super(message);
			this.status = status;
			this.code = code;
			this.detail = detail;
		}
	},
}));

const { GET, POST } =
	await import('@/app/api/projects/[id]/purchase-order/route');

const project = {
	project_id: 10,
	id: 10,
	project_code: 'PRJ-10',
	project_team: JSON.stringify([{ user_id: 42, role: 'Team Member' }]),
};
const outsiderProject = {
	...project,
	project_team: JSON.stringify([{ user_id: 7, role: 'Team Member' }]),
};

function userWith(permissions: string[]) {
	return {
		id: 42,
		email: 'member@example.com',
		is_super_admin: 0,
		permissions,
		role_permissions: [],
		merged_permissions: permissions,
		field_permissions: {},
	};
}

let projectRows: Record<string, unknown>[] = [];

function request(method = 'GET') {
	return new Request('http://localhost/api/projects/PRJ-10/purchase-order', {
		method,
		body:
			method === 'POST'
				? JSON.stringify({ direction: 'client', counterparty_name: 'ACME' })
				: undefined,
	});
}

function params(id = 'PRJ-10') {
	return { params: Promise.resolve({ id }) };
}

describe('project purchase-order project-scope contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentUser = null;
		projectRows = [project];
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockImplementation(async () => currentUser);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM projects p')) return [projectRows, []];
			return [[], []];
		});
		mockFetchOrders.mockResolvedValue([]);
		mockCreateOrder.mockResolvedValue({ id: 1 });
	});

	it('returns 401 without a session', async () => {
		const response = await GET(request(), params());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('returns 403 without the purchase-order resource permission', async () => {
		currentUser = userWith([]);

		const response = await GET(request(), params());

		expect(response.status).toBe(403);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an out-of-scope project with the same body as an unknown project', async () => {
		currentUser = userWith(['purchase_orders:read']);
		projectRows = [outsiderProject];
		const denied = await GET(request(), params());
		const deniedBody = await denied.json();

		projectRows = [];
		const missing = await GET(request(), params('missing-project'));
		const missingBody = await missing.json();

		expect(denied.status).toBe(403);
		expect(missing.status).toBe(403);
		expect(deniedBody).toEqual(missingBody);
		expect(deniedBody.error).toBe(
			'You do not have permission to access this project'
		);
	});

	it('serves the orders to a permissioned actor on an openable project', async () => {
		currentUser = userWith(['purchase_orders:read']);

		const response = await GET(request(), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(mockFetchOrders).toHaveBeenCalledWith(
			expect.objectContaining({ projectId: 'PRJ-10' })
		);
	});

	it('rejects a POST outside scope without creating an order', async () => {
		currentUser = userWith(['purchase_orders:read', 'purchase_orders:create']);
		projectRows = [outsiderProject];

		const response = await POST(request('POST'), params());

		expect(response.status).toBe(403);
		expect(mockCreateOrder).not.toHaveBeenCalled();
	});
});
