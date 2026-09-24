import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';

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

const { GET } = await import('@/app/api/payroll/da-schedule/current/route');

const grant = grantFor(mocks.mockEnsurePermission);

const db = {
	execute: vi.fn(),
	release: vi.fn(),
};

describe('current DA API — payroll permission only (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	// This route had ZERO permission check before this issue, then either-or;
	// DA is one Component Rate among many, so it authorizes with PAYROLL alone.
	it('denies a caller without payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/da-schedule/current')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller', async () => {
		grant('employees:read');
		db.execute.mockResolvedValue([
			[
				{
					value_type: 'fixed',
					value: '250',
					effective_from: '2026-01-01',
					effective_to: null,
				},
			],
			[],
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/da-schedule/current')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows a payroll caller', async () => {
		grant('payroll:read');
		db.execute.mockResolvedValue([
			[
				{
					value_type: 'fixed',
					value: '250',
					effective_from: '2026-01-01',
					effective_to: null,
				},
			],
			[],
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/da-schedule/current')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});
});
