import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';
import type * as SalaryDirectoryModule from '@/lib/salary-profile-directory';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockResolve: vi.fn(),
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
vi.mock('@/lib/salary-profile-directory', async () => {
	const actual = await vi.importActual<typeof SalaryDirectoryModule>(
		'@/lib/salary-profile-directory'
	);
	return {
		...actual,
		loadSalaryProfileResolution: mocks.mockResolve,
	};
});

// Imported after mock hoisting so the handler uses the mocked payroll gate and
// resolver; a static import would capture the real modules first.
const { GET } = await import('@/app/api/payroll/salary-profile/resolve/route');

const grant = grantFor(mocks.mockEnsurePermission);

const connection = {
	execute: vi.fn(),
	release: vi.fn(),
};

const resolution = {
	employee_id: 2,
	state: 'unavailable',
	anchor: '2026-11-15',
	source: null,
	agreement_id: null,
	conflict_ids: [],
	conflict_source: null,
	salary_type: null,
	pay_stream: null,
	effective_from: null,
	effective_to: null,
	classification: null,
	ctc: {
		status: 'missing',
		amount: null,
		source: 'none',
		legacy_fallback: false,
		invalid_reason: null,
	},
	timeline_version: 0,
	used: false,
	use_ambiguous: false,
	use_unknown_history: false,
	profile: null,
	employee: {
		id: 2,
		employee_id: 'E-002',
		full_name: 'Grace Hopper',
		department: 'Operations',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2024-01-01',
		hire_date: '2024-01-01',
		exit_date: null,
	},
};

describe('salary-profile resolve API — requested period, payroll read only', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		mocks.mockResolve.mockResolvedValue(resolution);
	});

	it('denies a caller without payroll:read', async () => {
		grant();

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/resolve?employee_id=2'
			)
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockResolve).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller', async () => {
		grant('employees:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/resolve?employee_id=2'
			)
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('requires an Employee id', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/resolve')
		);

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('returns the requested period resolution for a payroll reader', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/resolve?employee_id=2&date=2026-11-15'
			)
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data).toMatchObject({
			employee_id: 2,
			state: 'unavailable',
		});
		expect(mocks.mockResolve).toHaveBeenCalledTimes(1);
		const [db, employeeId, query] = mocks.mockResolve.mock.calls[0];
		expect(db).toBe(connection);
		expect(employeeId).toBe(2);
		expect(query.period.date).toBe('2026-11-15');
	});

	it('returns 404 for an Employee that is not live', async () => {
		grant('payroll:read');
		mocks.mockResolve.mockResolvedValue(null);

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/resolve?employee_id=999'
			)
		);

		expect(res.status).toBe(404);
	});

	it('rejects a date and month supplied together', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/resolve?employee_id=2&date=2026-11-15&month=2026-11'
			)
		);

		expect(res.status).toBe(400);
		expect(mocks.mockResolve).not.toHaveBeenCalled();
	});
});
