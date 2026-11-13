import { beforeEach, describe, expect, it, vi } from 'vitest';
import { grantFor } from '../test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
	mockExecute: vi.fn(),
	mockLoadPayrollRunRoster: vi.fn(),
	mockLoadFrozenPayrollRunRoster: vi.fn(),
}));

vi.mock('@/utils/database', () => ({
	dbConnect: mocks.mockDbConnect,
	withTransaction: vi.fn(),
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
	loadFrozenPayrollRunRoster: mocks.mockLoadFrozenPayrollRunRoster,
}));

const { GET } = await import('@/app/api/payroll/runs/route');

const grant = grantFor(mocks.mockEnsurePermission);

const runRequest = (month?: string) =>
	new Request(
		`http://localhost/api/payroll/runs${month ? `?month=${month}` : ''}`
	);

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

const monthSlips = (employeeIds: number[] = [11, 12]) =>
	employeeIds.map((employeeId, index) => ({
		id: index + 1,
		employee_id: employeeId,
		employee_code: `EMP0${employeeId}`,
		name: `Employee ${employeeId}`,
		payment_status: 'pending',
		gross: '100.00',
		total_earnings: '100.00',
		total_deductions: '0.00',
		net_pay: '100.00',
		total_employer_contributions: '0.00',
	}));

const roster = (
	members: readonly unknown[] = ELIGIBLE_MEMBERS,
	excluded: readonly unknown[] = []
) => ({
	month: '2026-08-01',
	members,
	excluded,
});

const frozenRoster = (members = ELIGIBLE_MEMBERS) => ({
	run_id: 7,
	month: '2026-08-01',
	version: 1,
	frozen_at: '2026-09-01 10:00:00',
	members: members.map((m) => ({
		employee_id: m.employee_id,
		employee_code: m.employee_code,
		name: m.name,
		employment_start: m.employment_start,
		employment_end: m.employment_end,
		profile_date: m.profile_date,
		profile_source: m.profile_source,
		profile_id: m.profile_id,
		salary_type: m.salary_type,
	})),
});

interface RunsState {
	run: Record<string, unknown> | null;
	slips: unknown[];
}

let state: RunsState;

describe('payroll runs API — month status, totals and derived paid indicator (issues #242, #245)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		state = { run: null, slips: [] };
		mocks.mockDbConnect.mockResolvedValue({
			execute: mocks.mockExecute,
			release: vi.fn(),
		});
		mocks.mockExecute.mockImplementation(
			async (sql: string) => {
				const text = String(sql);
				if (text.includes('FROM payroll_runs')) {
					return [state.run ? [state.run] : [], undefined];
				}
				if (text.includes('FROM payroll_slips')) {
					return [state.slips, undefined];
				}
				return [[], undefined];
			}
		);
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(roster());
		mocks.mockLoadFrozenPayrollRunRoster.mockResolvedValue(null);
	});

	it('denies a caller without payroll:read', async () => {
		grant('employees:read');

		const res = await GET(runRequest('2026-08-01'));

		expect(res.status).toBe(403);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('rejects a request without a month', async () => {
		grant('payroll:read');

		const res = await GET(runRequest());

		expect(res.status).toBe(400);
		expect(mocks.mockDbConnect).not.toHaveBeenCalled();
	});

	it('reports no run and an empty summary for a month never generated', async () => {
		grant('payroll:read');
		state = { run: null, slips: [] };
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(roster([]));

		const res = await GET(runRequest('2026-08-01'));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.run).toBeNull();
		expect(body.data.summary).toEqual({
			headcount: 0,
			total_gross: 0,
			total_deductions: 0,
			total_net_pay: 0,
			total_employer_contribution: 0,
			paid_slips: 0,
			is_paid: false,
		});
		expect(body.data.readiness).toEqual({
			basis: 'live',
			eligible_count: 0,
			slip_count: 0,
			missing_slip_count: 0,
			missing_profile_count: 0,
			employment_issue_count: 0,
			unexpected_slip_count: 0,
			excluded_count: 0,
			can_finalize: false,
		});
	});

	it('reports the run as paid only once every slip of the month is paid', async () => {
		grant('payroll:read');
		state = {
			run: { ...DRAFT_RUN, status: 'finalized' },
			slips: [
				{ ...monthSlips([11])[0], payment_status: 'paid' },
				{ ...monthSlips([12])[0], payment_status: 'processed' },
			],
		};

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		// Derived from the slips on every read, so the indicator drops the moment
		// one slip leaves `paid` — the header can never disagree with them.
		expect(body.data.summary.paid_slips).toBe(1);
		expect(body.data.summary.is_paid).toBe(false);
	});

	it('reports the run as paid when all of its slips are paid', async () => {
		grant('payroll:read');
		state = {
			run: { ...DRAFT_RUN, status: 'finalized' },
			slips: [
				{ ...monthSlips([11])[0], payment_status: 'paid' },
				{ ...monthSlips([12])[0], payment_status: 'paid' },
			],
		};

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.summary.paid_slips).toBe(2);
		expect(body.data.summary.is_paid).toBe(true);
	});

	it("returns the month's run status with money-library totals", async () => {
		grant('payroll:read');
		state = {
			run: DRAFT_RUN,
			slips: [
				{
					...monthSlips([11])[0],
					gross: '48000.00',
					total_earnings: '48000.00',
					total_deductions: '200.10',
					net_pay: '47799.90',
					total_employer_contributions: '150.00',
				},
				{
					...monthSlips([12])[0],
					gross: '31405.46',
					total_earnings: '31405.46',
					total_deductions: '0.20',
					net_pay: '31405.26',
					total_employer_contributions: '150.00',
				},
			],
		};

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.run).toMatchObject({ id: 7, status: 'draft' });
		expect(body.data.summary.total_gross).toBe(79405.46);
		expect(body.data.summary.total_deductions).toBe(200.3);
		expect(body.data.summary.total_net_pay).toBe(79205.16);
		expect(body.data.summary.total_employer_contribution).toBe(300);
	});

	it("sums the slips' own earnings, never the contractual gross", async () => {
		grant('payroll:read');
		state = {
			run: DRAFT_RUN,
			slips: [
				{
					...monthSlips([11])[0],
					gross: '45000.00',
					total_earnings: '54000.00',
					total_deductions: '2000.00',
					net_pay: '52000.00',
					total_employer_contributions: '3250.00',
				},
			],
		};

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.summary.total_gross).toBe(54000);
		expect(body.data.summary.total_net_pay).toBe(52000);
	});

	it('corrects February PT the way the run dashboard does', async () => {
		grant('payroll:read');
		state = {
			run: { ...DRAFT_RUN, month: 2 },
			slips: [
				{
					...monthSlips([11])[0],
					gross: '45000.00',
					total_earnings: '54000.00',
					total_deductions: '2000.00',
					net_pay: '52000.00',
					total_employer_contributions: '3250.00',
					pt: '200.00',
				},
			],
		};

		const res = await GET(runRequest('2026-02-01'));

		const body = await res.json();
		// February's PT is a flat 300 for everyone: the 200 stored is corrected by
		// the difference, so the dialog that asks for sign-off cannot disagree with
		// the dashboard's own Net Pay for the same slip.
		expect(body.data.summary.total_deductions).toBe(2100);
		expect(body.data.summary.total_net_pay).toBe(51900);
	});

	it('reports a draft as ready only when the live roster has no gap', async () => {
		grant('payroll:read');
		state = { run: DRAFT_RUN, slips: monthSlips([11, 12]) };

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.readiness).toEqual({
			basis: 'live',
			eligible_count: 2,
			slip_count: 2,
			missing_slip_count: 0,
			missing_profile_count: 0,
			employment_issue_count: 0,
			unexpected_slip_count: 0,
			excluded_count: 0,
			can_finalize: true,
		});
	});

	it('counts every live gap and refuses readiness while any remains', async () => {
		grant('payroll:read');
		state = { run: DRAFT_RUN, slips: monthSlips([11, 99]) };
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(
			roster(
				[
					ELIGIBLE_MEMBERS[0],
					member(12, 'EMP012', 'Ravi Kumar', {
						salary_profile: null,
						profile_source: null,
						profile_id: null,
						salary_type: null,
					}),
					member(13, 'EMP013', 'Future Hire', {
						issue: 'employment_dates_missing',
						employment_start: null,
					}),
					member(14, 'EMP014', 'Meera Nair'),
				],
				[
					{
						employee_id: 40,
						employee_code: 'EMP040',
						name: 'Left Before Month',
						reason: 'not_employed',
					},
				]
			)
		);

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.readiness).toEqual({
			basis: 'live',
			eligible_count: 2, // 11 and 14
			slip_count: 2,
			missing_slip_count: 1, // 14 has no slip
			missing_profile_count: 1, // 12
			employment_issue_count: 1, // 13
			unexpected_slip_count: 1, // slip for 99
			excluded_count: 1,
			can_finalize: false,
		});
	});

	it('uses the saved roster for a locked run instead of live profiles', async () => {
		grant('payroll:read');
		state = {
			run: { ...DRAFT_RUN, status: 'finalized' },
			slips: monthSlips([11]),
		};
		mocks.mockLoadFrozenPayrollRunRoster.mockResolvedValue(frozenRoster());
		// A future hire in the live roster must not join the historical report.
		mocks.mockLoadPayrollRunRoster.mockResolvedValue(
			roster([...ELIGIBLE_MEMBERS, member(13, 'EMP013', 'Future Hire')])
		);

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.readiness).toEqual({
			basis: 'frozen',
			eligible_count: 2,
			slip_count: 1,
			missing_slip_count: 1,
			missing_profile_count: 0,
			employment_issue_count: 0,
			unexpected_slip_count: 0,
			excluded_count: 0,
			can_finalize: false,
		});
		expect(mocks.mockLoadPayrollRunRoster).not.toHaveBeenCalled();
	});

	it('labels a locked run with no saved roster as legacy without promising a count', async () => {
		grant('payroll:read');
		state = {
			run: { ...DRAFT_RUN, status: 'finalized' },
			slips: monthSlips([11, 12]),
		};
		mocks.mockLoadFrozenPayrollRunRoster.mockResolvedValue(null);

		const res = await GET(runRequest('2026-08-01'));

		const body = await res.json();
		expect(body.data.readiness).toEqual({
			basis: 'legacy',
			eligible_count: null,
			slip_count: 2,
			missing_slip_count: 0,
			missing_profile_count: 0,
			employment_issue_count: 0,
			unexpected_slip_count: 0,
			excluded_count: 0,
			can_finalize: false,
		});
		expect(mocks.mockLoadPayrollRunRoster).not.toHaveBeenCalled();
	});
});
