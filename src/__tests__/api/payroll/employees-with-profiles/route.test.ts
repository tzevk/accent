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

const { GET } = await import('@/app/api/payroll/employees-with-profiles/route');

const grant = grantFor(mocks.mockEnsurePermission);

const db = {
	query: vi.fn(),
	release: vi.fn(),
};

describe('employees-with-profiles API — PAYROLL permission (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	it('denies a caller without payroll:read (route previously had no check)', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/employees-with-profiles')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller — this route requires payroll:read', async () => {
		grant('employees:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/employees-with-profiles')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows a caller holding payroll:read', async () => {
		grant('payroll:read');
		db.query.mockResolvedValue([
			[{ id: 1, first_name: 'Priya', last_name: 'P' }],
			[],
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/employees-with-profiles')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.total).toBe(1);
	});
});
