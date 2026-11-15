import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockWithTransaction: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
	mockLoadPayrollRunRoster: vi.fn(),
	mockSavePayrollRunRoster: vi.fn(),
	mockLoadFrozenPayrollRunRoster: vi.fn(),
	mockFreezeMonthAllocations: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: mocks.mockDbConnect,
	withTransaction: mocks.mockWithTransaction,
}));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: {
		READ: 'read',
		CREATE: 'create',
		UPDATE: 'update',
		DELETE: 'delete',
	},
}));
vi.mock('@/lib/payroll-run-roster', () => ({
	loadPayrollRunRoster: mocks.mockLoadPayrollRunRoster,
	savePayrollRunRoster: mocks.mockSavePayrollRunRoster,
	loadFrozenPayrollRunRoster: mocks.mockLoadFrozenPayrollRunRoster,
}));
vi.mock('@/lib/company-expenditure', () => ({
	freezeMonthAllocations: mocks.mockFreezeMonthAllocations,
}));

const { POST } = await import('@/app/api/payroll/runs/finalize/route');

const grant = grantFor(mocks.mockEnsurePermission);

const DRAFT_RUN = {
	id: 7,
	month: 8,
	year: 2026,
	run_number: 1,
	status: 'draft',
};

const member = (
	employeeId: number,
	code: string,
	name: string,
	overrides: Record<string, unknown> = {}
) => ({
	employee_id: employeeId,
	employee_code: code,
	name,
	employee_type: 'Payroll',
	employment_start: '2026-01-01',
	employment_end: null,
	profile_date: '2026-08-01',
	salary_profile: { employer_cost: 26_000 },
	profile_source: 'employee_salary_profile',
	profile_id: employeeId,
	salary_type: 'monthly',
	issue: null,
	...overrides,
});

const ELIGIBLE_MEMBERS = [
	member(11, 'EMP011', 'Asha Rao'),
	member(12, 'EMP012', 'Ravi Kumar'),
];

/** The two slips the month carries: 48000.00 and 31405.46 gross. */
const MONTH_SLIPS = [
	{
		id: 1,
		employee_id: 11,
		employee_code: 'EMP011',
		name: 'Asha Rao',
		gross: '48000.00',
		total_deductions: '200.10',
		net_pay: '47799.90',
		total_employer_contributions: '150.00',
	},
	{
		id: 2,
		employee_id: 12,
		employee_code: 'EMP012',
		name: 'Ravi Kumar',
		gross: '31405.46',
		total_deductions: '0.20',
		net_pay: '31405.26',
		total_employer_contributions: '150.00',
	},
];

interface DbState {
	run: Record<string, unknown> | null;
	slips: unknown[];
	updateAffected: number;
}

let state: DbState;

const jsonRequest = (body: unknown) =>
	new Request('http://localhost/api/payroll/runs/finalize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});

const statements = () =>
	mocks.mockExecute.mock.calls.map(([sql]) => String(sql));

/** The INSERT the route made into payroll_audit_logs, or undefined if none. */
const auditInsert = () =>
	mocks.mockExecute.mock.calls.find(([sql]) =>
		String(sql).includes('INSERT INTO payroll_audit_logs')
	);

const roster = (
	members: readonly unknown[] = ELIGIBLE_MEMBERS,
	excluded: readonly unknown[] = []
) => ({
	month: '2026-08-01',
	members,
	excluded,
});
describe('payroll finalize API — roster completeness gate (issue #242)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		state = { run: DRAFT_RUN, slips: MONTH_SLIPS, updateAffected: 1 };

		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockWithTransaction.mockImplementation(async (fn) =>
			fn(await mocks.mockDbConnect())
		);
		mocks.mockExecute.mockImplementation(async (sql: string) => {
			const text = String(sql);
			if (text.includes('FROM payroll_runs')) {
				return [state.run ? [state.run] : [], undefined];
			}
			if (text.includes('FROM payroll_slips')) {
				return [state.slips, undefined];
			}
			if (text.includes('UPDATE payroll_runs')) {
				return [{ affectedRows: state.updateAffected }, undefined];
			}
			if (text.includes('INSERT INTO payroll_audit_logs')) {
				return [{ insertId: 1 }, undefined];
			}
			return [[], undefined];
		});
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(roster());
		mocks.mockSavePayrollRunRoster.mockResolvedValue({
			run_id: 7,
			month: '2026-08-01',
			version: 1,
			frozen_at: null,
			members: [],
		});
		mocks.mockFreezeMonthAllocations.mockResolvedValue({
			allocations: 2,
			total: 300,
		});
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id: 9 },
		}));
	});

	it('denies a caller without payroll:update', async () => {
		grant('payroll:read');

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(403);
		expect(mocks.mockWithTransaction).not.toHaveBeenCalled();
	});

	it('rejects a request without a month', async () => {
		const res = await POST(jsonRequest({}));

		expect(res.status).toBe(400);
		expect(mocks.mockWithTransaction).not.toHaveBeenCalled();
	});

	it('refuses a month that has no Payroll Run yet', async () => {
		state.run = null;

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('locks the run row before reading the roster', async () => {
		await POST(jsonRequest({ month: '2026-08-01' }));

		expect(statements()[0]).toContain('FROM payroll_runs');
		expect(statements()[0]).toContain('FOR UPDATE');
	});

	it('refuses a month whose run is already finalized', async () => {
		state.run = { ...DRAFT_RUN, status: 'finalized' };

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/already finalized/i);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('refuses an empty eligible roster without locking the run or saving a snapshot', async () => {
		state.slips = [];
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(roster([], []));

		const res = await POST(jsonRequest({ month: '2025-12-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/no employees are eligible for payroll/);
		expect(body.missing_employees).toEqual([]);
		expect(body.employees_without_profiles).toEqual([]);
		expect(body.employees_needing_review).toEqual([]);
		expect(body.slips_outside_roster).toEqual([]);
		// An empty month must not become a locked run with an empty snapshot.
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
		expect(mocks.mockSavePayrollRunRoster).not.toHaveBeenCalled();
		expect(mocks.mockFreezeMonthAllocations).not.toHaveBeenCalled();
		expect(auditInsert()).toBeUndefined();
	});

	it('names every employee missing a Payroll Slip', async () => {
		state.slips = [MONTH_SLIPS[0]];

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toContain('Ravi Kumar (EMP012)');
		expect(body.error).toMatch(/no Payroll Slip/);
		expect(body.missing_employees).toEqual([
			{ employee_id: 12, employee_code: 'EMP012', name: 'Ravi Kumar' },
		]);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('names employees with no Salary Profile separately from missing slips', async () => {
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(
			roster([
				ELIGIBLE_MEMBERS[0],
				member(13, 'EMP013', 'Meera Nair', {
					employee_type: 'Contract',
					salary_profile: null,
					profile_source: null,
					profile_id: null,
					salary_type: null,
				}),
			])
		);
		state.slips = [MONTH_SLIPS[0]];

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toContain('Meera Nair (EMP013)');
		expect(body.error).toMatch(/no Salary Profile/);
		expect(body.employees_without_profiles).toEqual([
			{
				employee_id: 13,
				employee_code: 'EMP013',
				employee_type: 'Contract',
				name: 'Meera Nair',
			},
		]);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('refuses employees whose employment dates need review, naming the reason', async () => {
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(
			roster([
				ELIGIBLE_MEMBERS[0],
				member(12, 'EMP012', 'Ravi Kumar', {
					employment_start: null,
					issue: 'employment_dates_missing',
				}),
			])
		);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toContain('Ravi Kumar (EMP012)');
		expect(body.error).toMatch(/employment-date review/);
		expect(body.error).toMatch(/employment dates are missing/);
		expect(body.employees_needing_review).toEqual([
			{
				employee_id: 12,
				employee_code: 'EMP012',
				name: 'Ravi Kumar',
				review_reason: 'employment_dates_missing',
			},
		]);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('refuses a Payroll Slip whose employee is not on the expected roster', async () => {
		state.slips = [
			...MONTH_SLIPS,
			{
				id: 3,
				employee_id: 99,
				employee_code: 'EMP099',
				name: 'Off Roster',
				gross: '1000.00',
				total_deductions: '0.00',
				net_pay: '1000.00',
				total_employer_contributions: '0.00',
			},
		];

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toContain('Off Roster (EMP099)');
		expect(body.error).toMatch(/no expected member/);
		expect(body.slips_outside_roster).toEqual([
			{
				slip_id: 3,
				employee_id: 99,
				employee_code: 'EMP099',
				name: 'Off Roster',
			},
		]);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(false);
	});

	it('flips the run to finalized and records headcount and money totals', async () => {
		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
		expect(body.data.status).toBe('finalized');
		expect(body.data.finalized_by).toBe(9);
		expect(body.data.total_employees).toBe(2);
		// Decimal sums: 48000.00 + 31405.46 and 200.10 + 0.20. Float addition
		// yields 79405.45999999999 / 200.29999999999998, so these assertions
		// prove the money library.
		expect(body.data.total_gross).toBe(79405.46);
		expect(body.data.total_deductions).toBe(200.3);
		expect(body.data.total_net_pay).toBe(79205.16);
		expect(body.data.total_employer_contribution).toBe(300);
		expect(body.data.roster_version).toBe(1);
		expect(
			statements().some((sql) => sql.includes('UPDATE payroll_runs'))
		).toBe(true);
	});

	it('saves the validated roster and freezes allocations after the guarded transition', async () => {
		await POST(jsonRequest({ month: '2026-08-01' }));

		expect(mocks.mockSavePayrollRunRoster).toHaveBeenCalledWith(
			expect.objectContaining({ execute: mocks.mockExecute }),
			7,
			expect.objectContaining({
				month: '2026-08-01',
				members: ELIGIBLE_MEMBERS,
			}),
			9
		);
		expect(mocks.mockFreezeMonthAllocations).toHaveBeenCalledWith(
			expect.objectContaining({ execute: mocks.mockExecute }),
			'2026-08-01',
			9
		);
		// The documented order: transition, snapshot, freeze, audit.
		const updateIndex = statements().findIndex((sql) =>
			sql.includes('UPDATE payroll_runs')
		);
		expect(updateIndex).toBeGreaterThan(-1);
		expect(mocks.mockSavePayrollRunRoster.mock.invocationCallOrder[0]).toBeGreaterThan(
			mocks.mockExecute.mock.invocationCallOrder[updateIndex]
		);
		expect(
			mocks.mockFreezeMonthAllocations.mock.invocationCallOrder[0]
		).toBeGreaterThan(
			mocks.mockSavePayrollRunRoster.mock.invocationCallOrder[0]
		);
	});

	it('rolls back the finalize when saving the roster fails', async () => {
		mocks.mockSavePayrollRunRoster.mockRejectedValue(
			new Error('payroll_run_rosters is missing')
		);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.details).toMatch(/payroll_run_rosters is missing/);
		expect(mocks.mockFreezeMonthAllocations).not.toHaveBeenCalled();
		expect(auditInsert()).toBeUndefined();
	});

	it('rolls back the finalize when freezing allocations fails', async () => {
		mocks.mockFreezeMonthAllocations.mockRejectedValue(
			new Error('allocation insert failed')
		);

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.details).toMatch(/allocation insert failed/);
		expect(auditInsert()).toBeUndefined();
	});

	it('reports a conflict when another request finalized the run first', async () => {
		state.updateAffected = 0;

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.success).toBe(false);
		expect(body.error).toMatch(/finalized by another request/i);
		expect(mocks.mockSavePayrollRunRoster).not.toHaveBeenCalled();
		expect(mocks.mockFreezeMonthAllocations).not.toHaveBeenCalled();
		// The transition is guarded, so a losing racer cannot overwrite the winner's
		// finalized_by/at and totals.
		expect(statements().some((sql) => sql.includes("status = 'draft'"))).toBe(
			true
		);
	});

	it('normalises a short YYYY-MM month before loading the roster and slips', async () => {
		const res = await POST(jsonRequest({ month: '2026-08' }));

		expect(res.status).not.toBe(400);
		expect(mocks.mockLoadPayrollRunRoster).toHaveBeenCalledWith(
			expect.anything(),
			'2026-08-01'
		);
		const slipCalls = mocks.mockExecute.mock.calls.filter(([sql]) =>
			String(sql).includes('FROM payroll_slips')
		);
		expect(slipCalls).toHaveLength(1);
		expect(slipCalls[0][1]).toEqual(['2026-08-01']);
	});
});

describe('payroll finalize API — the transition is audited (issue #243)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		state = { run: DRAFT_RUN, slips: MONTH_SLIPS, updateAffected: 1 };
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockWithTransaction.mockImplementation(async (fn) =>
			fn(await mocks.mockDbConnect())
		);
		mocks.mockExecute.mockImplementation(async (sql: string) => {
			const text = String(sql);
			if (text.includes('FROM payroll_runs')) {
				return [state.run ? [state.run] : [], undefined];
			}
			if (text.includes('FROM payroll_slips')) {
				return [state.slips, undefined];
			}
			if (text.includes('UPDATE payroll_runs')) {
				return [{ affectedRows: state.updateAffected }, undefined];
			}
			if (text.includes('INSERT INTO payroll_audit_logs')) {
				return [{ insertId: 1 }, undefined];
			}
			return [[], undefined];
		});
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(roster());
		mocks.mockSavePayrollRunRoster.mockResolvedValue({
			run_id: 7,
			month: '2026-08-01',
			version: 1,
			frozen_at: null,
			members: [],
		});
		mocks.mockFreezeMonthAllocations.mockResolvedValue({
			allocations: 2,
			total: 300,
		});
		mocks.mockEnsurePermission.mockImplementation(async () => ({
			authorized: true,
			user: { id: 9 },
		}));
	});

	it('records who finalized the run, the saved roster version and the totals they signed off', async () => {
		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		expect(res.status).toBe(200);
		const insert = auditInsert();
		expect(insert).toBeDefined();
		const [sql, params] = insert!;
		// performed_at is deliberately absent from the column list: the column's
		// current_timestamp() default is the timestamp, so the entry is stamped by
		// the database rather than by an app clock.
		expect(String(sql)).toContain('performed_by');
		expect(String(sql)).not.toContain('performed_at');
		expect(params[0]).toBe('payroll_run');
		expect(params[1]).toBe(7);
		expect(params[2]).toBeNull(); // a run is not one employee
		expect(params[3]).toBe('finalize');
		expect(JSON.parse(params[4] as string)).toEqual({ status: 'draft' });
		expect(JSON.parse(params[5] as string)).toEqual({
			status: 'finalized',
			roster_version: 1,
			total_employees: 2,
			total_gross: 79405.46,
			total_deductions: 200.3,
			total_net_pay: 79205.16,
			total_employer_contribution: 300,
		});
		expect(params[6]).toBe(7); // payroll_run_id
		expect(params[7]).toBe(8); // month
		expect(params[8]).toBe(2026); // year
		// The performer is the authenticated session user.
		expect(params[9]).toBe(9);
	});

	it('still finalizes when the audit write fails', async () => {
		// An audit row that cannot be written must not cost the caller the
		// finalize they asked for — or the lock it put on the month.
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const realImplementation = mocks.mockExecute.getMockImplementation()!;
		mocks.mockExecute.mockImplementation(async (sql: string, params?: unknown[]) => {
			if (String(sql).includes('INSERT INTO payroll_audit_logs')) {
				return Promise.reject(new Error('payroll_audit_logs is missing'));
			}
			return realImplementation(sql, params);
		});

		const res = await POST(jsonRequest({ month: '2026-08-01' }));

		const body = await res.json();
		expect(res.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.data.status).toBe('finalized');
		expect(body.data.total_net_pay).toBe(79205.16);
		// The failure really happened (the INSERT was attempted) and the helper
		// owned it.
		expect(auditInsert()).toBeDefined();
		expect(errorSpy).toHaveBeenCalledWith(
			'Payroll audit log write failed:',
			expect.any(Error)
		);
		errorSpy.mockRestore();
	});
});
