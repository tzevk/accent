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

const { GET } = await import('@/app/api/payroll/schedules/current/route');

const grant = grantFor(mocks.mockEnsurePermission);

const db = {
	query: vi.fn(),
	end: vi.fn(),
};

describe('current component values API — payroll permission only (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	// Component rates are payroll data: RESOURCES.PAYROLL is the only grant that
	// reads them, and the gate result must actually be consumed (the old check
	// discarded it).
	it('denies a caller without payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/schedules/current?gross=50000')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller', async () => {
		grant('employees:read');
		db.query.mockResolvedValue([
			[{ component_type: 'bonus', value_type: 'fixed', value: '100' }],
			[],
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/schedules/current?gross=50000')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows a payroll caller', async () => {
		grant('payroll:read');
		db.query.mockResolvedValue([
			[{ component_type: 'bonus', value_type: 'fixed', value: '100' }],
			[],
		]);

		const res = await GET(
			new Request('http://localhost/api/payroll/schedules/current?gross=50000')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});
});
