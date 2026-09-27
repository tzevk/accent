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

describe('batch salary-profile API — payroll permission only (issue #239)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		connection.execute.mockResolvedValue([[], undefined]);
	});

	// Previously EMPLOYEES-only, then either-or; RESOURCES.PAYROLL is now the
	// only grant that reads salary data.
	it('denies a caller without payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller: what people are paid is payroll data', async () => {
		grant('employees:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('allows a payroll caller', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});
});
