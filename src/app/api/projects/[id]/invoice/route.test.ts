import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mockExecute = vi.fn();
const mockRelease = vi.fn();
const mockDbConnect = vi.fn();
const mockGetCurrentUser = vi.fn();
const mockGetTableColumns = vi.fn();

const mockDb = {
	execute: mockExecute,
	release: mockRelease,
	beginTransaction: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
};

vi.mock('@/utils/database', () => ({
	dbConnect: mockDbConnect,
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

const { GET, POST, PUT, DELETE } =
	await import('@/app/api/projects/[id]/invoice/route');

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
let invoiceRows: Record<string, unknown>[] = [];

function request(method: string, url = 'invoice') {
	return new Request(`http://localhost/api/projects/PRJ-10/${url}`, {
		method,
		body:
			method === 'POST' || method === 'PUT'
				? JSON.stringify({ invoiceId: 5, invoice_number: 'ATS/I/11-26/228' })
				: undefined,
	});
}

function params(id = 'PRJ-10') {
	return { params: Promise.resolve({ id }) };
}

describe('project invoice project-scope contract', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentUser = null;
		projectRows = [project];
		invoiceRows = [];
		mockDbConnect.mockResolvedValue(mockDb);
		mockGetCurrentUser.mockImplementation(async () => currentUser);
		mockGetTableColumns.mockResolvedValue(
			new Set(['project_id', 'id', 'project_code', 'project_team'])
		);
		mockExecute.mockImplementation(async (sql: string) => {
			if (sql.includes('FROM projects p')) return [projectRows, []];
			if (sql.includes('MAX(CAST')) return [[{ max_seq: 227 }], []];
			if (sql.includes('FROM project_invoices')) return [invoiceRows, []];
			return [[], []];
		});
	});

	it('returns 401 without a session', async () => {
		const response = await GET(request('GET'), params());

		expect(response.status).toBe(401);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('returns 403 without the invoice resource permission', async () => {
		currentUser = userWith([]);

		const response = await GET(request('GET'), params());

		expect(response.status).toBe(403);
		expect(mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an out-of-scope project with the same body as an unknown project', async () => {
		currentUser = userWith(['invoices:read']);
		projectRows = [outsiderProject];
		const denied = await GET(request('GET'), params());
		const deniedBody = await denied.json();

		projectRows = [];
		const missing = await GET(request('GET'), params('missing-project'));
		const missingBody = await missing.json();

		expect(denied.status).toBe(403);
		expect(missing.status).toBe(403);
		expect(deniedBody).toEqual(missingBody);
		expect(deniedBody.error).toBe(
			'You do not have permission to access this project'
		);
	});

	it('serves the invoices to a permissioned actor on an openable project', async () => {
		currentUser = userWith(['invoices:read']);
		invoiceRows = [{ id: 5, invoice_number: 'ATS/I/11-26/228' }];

		const response = await GET(request('GET'), params());
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.invoices).toHaveLength(1);
	});

	it('rejects POST, PUT and DELETE outside scope without mutating invoices', async () => {
		currentUser = userWith([
			'invoices:read',
			'invoices:create',
			'invoices:update',
			'invoices:delete',
		]);
		projectRows = [outsiderProject];

		const responses = await Promise.all([
			POST(request('POST'), params()),
			PUT(request('PUT'), params()),
			DELETE(request('DELETE', 'invoice?invoiceId=5'), params()),
		]);

		expect(responses.map((response) => response.status)).toEqual([
			403, 403, 403,
		]);
		const writes = mockExecute.mock.calls.filter(([sql]) =>
			/INSERT INTO project_invoices|UPDATE project_invoices/i.test(String(sql))
		);
		expect(writes).toHaveLength(0);
	});
});
