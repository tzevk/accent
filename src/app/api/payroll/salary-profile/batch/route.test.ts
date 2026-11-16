import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';
import type * as SalaryDirectoryModule from '@/lib/salary-profile-directory';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockLoadBatch: vi.fn(),
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
		loadSalaryProfileBatch: mocks.mockLoadBatch,
	};
});

// Imported after mock hoisting so the handler uses the mocked payroll gate and
// batch loader; a static import would capture the real modules first.
const { GET } = await import('@/app/api/payroll/salary-profile/batch/route');

const grant = grantFor(mocks.mockEnsurePermission);

const connection = {
	execute: vi.fn(),
	release: vi.fn(),
};

const batchResult = {
	period: {
		kind: 'month',
		date: null,
		month: '2026-11-01',
		start: '2026-11-01',
		end: '2026-11-30',
	},
	as_of: '2026-11-01',
	data: {
		'2': {
			employee_id: 2,
			state: 'unavailable',
			anchor: '2026-11-01',
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
		},
	},
	missing_ids: [],
};

describe('batch salary-profile API — period resolution, payroll permission only', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		mocks.mockLoadBatch.mockResolvedValue(batchResult);
	});

	it('denies a caller without payroll:read', async () => {
		grant();

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockLoadBatch).not.toHaveBeenCalled();
	});

	it('denies an employees-only caller: what people are paid is payroll data', async () => {
		grant('employees:read');

		const res = await GET(
			new Request('http://localhost/api/payroll/salary-profile/batch')
		);

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockLoadBatch).not.toHaveBeenCalled();
	});

	it('returns the requested period state for a payroll caller', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/batch?ids=2&month=2026-11&full=1'
			)
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data['2'].state).toBe('unavailable');
		expect(body.period.month).toBe('2026-11-01');
		const query = mocks.mockLoadBatch.mock.calls[0][1];
		expect(query.ids).toEqual([2]);
		expect(query.full).toBe(true);
		expect(query.period.month).toBe('2026-11-01');
	});

	it('rejects invalid ids before touching the database', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/batch?ids=2,nope'
			)
		);

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		expect(mocks.mockLoadBatch).not.toHaveBeenCalled();
	});

	it('rejects a date and month supplied together', async () => {
		grant('payroll:read');

		const res = await GET(
			new Request(
				'http://localhost/api/payroll/salary-profile/batch?ids=2&date=2026-11-15&month=2026-11'
			)
		);

		expect(res.status).toBe(400);
		expect(mocks.mockLoadBatch).not.toHaveBeenCalled();
	});
});
