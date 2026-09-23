import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: {
		PAYROLL: 'payroll',
		SETTINGS: 'settings',
		EMPLOYEES: 'employees',
	},
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { GET, POST, PUT, DELETE } =
	await import('@/app/api/payroll/schedules/route');

const grant = grantFor(mocks.mockEnsurePermission);

const db = {
	query: vi.fn(),
	beginTransaction: vi.fn(),
	commit: vi.fn(),
	rollback: vi.fn(),
	end: vi.fn(),
};

const jsonRequest = (method: string, body: unknown) =>
	new Request('http://localhost/api/payroll/schedules', {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

describe('payroll component schedules API — PAYROLL permission (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	describe('GET', () => {
		it('denies a settings-only caller — RBAC consults payroll, not settings', async () => {
			grant('settings:read');

			const res = await GET(
				new Request('http://localhost/api/payroll/schedules')
			);

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:read', async () => {
			grant('payroll:read');
			db.query.mockResolvedValue([[{ id: 1, component_type: 'pt' }], []]);

			const res = await GET(
				new Request('http://localhost/api/payroll/schedules')
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data).toHaveLength(1);
		});
	});

	describe('POST', () => {
		it('denies a settings-only caller', async () => {
			grant('settings:create');

			const res = await POST(
				jsonRequest('POST', {
					component_type: 'pt',
					value_type: 'fixed',
					value: 200,
					effective_from: '2026-04-01',
				})
			);

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:create', async () => {
			grant('payroll:create');
			db.query.mockResolvedValue([{ insertId: 7 }, []]);

			const res = await POST(
				jsonRequest('POST', {
					component_type: 'pt',
					value_type: 'fixed',
					value: 200,
					effective_from: '2026-04-01',
				})
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
			expect(body.data.id).toBe(7);
		});
	});

	describe('PUT', () => {
		it('denies a settings-only caller', async () => {
			grant('settings:update');

			const res = await PUT(jsonRequest('PUT', { id: 1, value: 250 }));

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:update', async () => {
			grant('payroll:update');
			db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

			const res = await PUT(jsonRequest('PUT', { id: 1, value: 250 }));

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});

	describe('DELETE', () => {
		it('denies a settings-only caller', async () => {
			grant('settings:delete');

			const res = await DELETE(
				new Request('http://localhost/api/payroll/schedules?id=1', {
					method: 'DELETE',
				})
			);

			expect(res.status).toBe(403);
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		});

		it('allows a caller holding payroll:delete', async () => {
			grant('payroll:delete');
			db.query.mockResolvedValue([{ affectedRows: 1 }, []]);

			const res = await DELETE(
				new Request('http://localhost/api/payroll/schedules?id=1', {
					method: 'DELETE',
				})
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.success).toBe(true);
		});
	});
});
