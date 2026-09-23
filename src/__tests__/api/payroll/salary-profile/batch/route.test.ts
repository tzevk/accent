import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll', EMPLOYEES: 'employees' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));

const { GET } = await import('@/app/api/payroll/salary-profile/batch/route');

const grant = grantFor(mocks.mockEnsurePermission);

const connection = {
	execute: vi.fn(),
	release: vi.fn(),
};

describe('batch salary-profile API — either-or permission (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		connection.execute.mockResolvedValue([[], undefined]);
	});

	// Previously EMPLOYEES-only; PAYROLL must now be sufficient everywhere.
	it('denies a caller holding neither employees:read nor payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows an employees-only caller (caller sits behind /employees gating)', async () => {
		grant('employees:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});

	it('allows a payroll-only caller (PAYROLL must be sufficient everywhere)', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});
});
