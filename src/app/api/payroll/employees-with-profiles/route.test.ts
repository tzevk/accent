import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';
import type * as SalaryDirectoryModule from '@/lib/salary-profile-directory';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockLoadDirectory: vi.fn(),
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
vi.mock('@/lib/salary-profile-directory', async () => {
	const actual = await vi.importActual<typeof SalaryDirectoryModule>(
		'@/lib/salary-profile-directory'
	);
	return {
		...actual,
		loadSalaryProfileDirectory: mocks.mockLoadDirectory,
	};
});

// Imported after mock hoisting so the route sees the permission and directory
// loader mocks; a static import would capture the real gate before vi.mock runs.
const { GET } = await import('@/app/api/payroll/employees-with-profiles/route');

const grant = grantFor(mocks.mockEnsurePermission);

const connection = {
	execute: vi.fn(),
	release: vi.fn(),
};

const directoryResult = {
	period: {
		kind: 'date',
		date: '2026-11-15',
		month: null,
		start: '2026-11-15',
		end: '2026-11-15',
	},
	as_of: '2026-11-15',
	page: 1,
	limit: 25,
	total: 1,
	counts: {
		total: 1,
		payroll: 0,
		contract: 0,
		missing: 1,
		ambiguous: 0,
	},
	data: [
		{
			id: 2,
			employee_id: 'E-002',
			full_name: 'Grace Hopper',
			department: 'Operations',
			employee_type: 'Payroll',
			status: 'active',
			joining_date: '2024-01-01',
			hire_date: '2024-01-01',
			exit_date: null,
			has_agreement: false,
			state: 'unavailable',
			anchor: '2026-11-15',
			agreement: null,
			conflict_ids: [],
			conflict_source: null,
			timeline_version: 0,
			use_ambiguous: false,
			use_unknown_history: false,
		},
	],
};

describe('employees-with-profiles API — payroll-only directory (issue #443)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		mocks.mockLoadDirectory.mockResolvedValue(directoryResult);
	});

	it('denies a caller without payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/employees-with-profiles')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockLoadDirectory).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller — this projection requires payroll:read', async () => {
		grant('employees:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/employees-with-profiles')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockLoadDirectory).not.toHaveBeenCalled();
	});

	it('allows payroll:read and returns the requested-date projection', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/employees-with-profiles?date=2026-11-15&stream=missing'
			)
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.total).toBe(1);
		expect(body.data[0]).toMatchObject({
			id: 2,
			state: 'unavailable',
		});
		expect(mocks.mockLoadDirectory).toHaveBeenCalledTimes(1);
		const query = mocks.mockLoadDirectory.mock.calls[0][1];
		expect(query.period.date).toBe('2026-11-15');
		expect(query.stream).toBe('missing');
	});

	it('rejects an invalid requested date before touching the database', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/employees-with-profiles?date=2026-02-31'
			)
		);

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockLoadDirectory).not.toHaveBeenCalled();
	});

	it('rejects invalid pagination before touching the database', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/employees-with-profiles?page=0')
		);

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});
});
