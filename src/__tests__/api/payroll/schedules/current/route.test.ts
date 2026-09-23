import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll', SETTINGS: 'settings', EMPLOYEES: 'employees' },
	PERMISSIONS: { READ: 'read', CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

const { GET } = await import('@/app/api/payroll/schedules/current/route');

/** Gate mirroring ensurePermission: authorized object or 403 Response. */
const grant = (...keys: string[]) =>
	mocks.mockEnsurePermission.mockImplementation(
		async (_request: Request, resource: string, permission: string) =>
			keys.includes(`${resource}:${permission}`)
				? { authorized: true, response: null }
				: NextResponse.json(
						{ success: false, error: 'Forbidden: missing permission' },
						{ status: 403 }
					)
	);

const db = {
	query: vi.fn(),
	end: vi.fn(),
};

describe('current component values API — either-or permission (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	// This route serves SalaryProfileSection behind /employees gating, so it
	// must accept EMPLOYEES:READ *or* PAYROLL:READ — never neither, and it
	// must actually consume the gate result (the old check discarded it).
	it('denies a caller holding neither employees:read nor payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/schedules/current?gross=50000')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows an employees-only caller (callers sit behind /employees gating)', async () => {
		grant('employees:read');
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
		expect(body.data.components).toHaveProperty('bonus');
	});

	it('allows a payroll-only caller (PAYROLL must be sufficient everywhere)', async () => {
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
