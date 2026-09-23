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

const { GET } = await import('@/app/api/payroll/da-schedule/current/route');

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
	execute: vi.fn(),
	release: vi.fn(),
};

describe('current DA API — either-or permission, security gap closed (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(db);
	});

	// This route had ZERO permission check before this issue.
	it('denies a caller holding neither employees:read nor payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/da-schedule/current')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows an employees-only caller', async () => {
		grant('employees:read');
		db.execute.mockResolvedValue([
			[
				{
					da_amount: 250,
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
		expect(body.data.da_amount).toBe(250);
	});

	it('allows a payroll-only caller (PAYROLL must be sufficient everywhere)', async () => {
		grant('payroll:read');
		db.execute.mockResolvedValue([
			[
				{
					da_amount: 250,
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
