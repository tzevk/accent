import { describe, expect, it } from 'vitest';
import { freezeMonthAllocations, loadPayrollMonth } from './payroll';
import type { SqlConnection } from './records';

const MONTH = '2026-10';
const MONTH_DAY = `${MONTH}-01`;

type Table = Record<string, unknown>[];
type Tables = Partial<Record<string, Table>>;

const MATCHERS: Array<[string, string]> = [
	['CONCAT_WS', 'employees'],
	['FROM employee_salary_profile', 'canonical'],
	['FROM salary_structures', 'legacy'],
	['FROM payroll_slips', 'slips'],
	['FROM payroll_runs', 'runs'],
	['FROM payroll_run_rosters', 'rosters'],
	['FROM payroll_employee_allocations a', 'allocations'],
	['FROM payroll_employee_allocation_shares', 'shares'],
	['FROM user_activity_assignments', 'assignments'],
	['FROM payroll_schedules', 'schedules'],
	['FROM holiday_master', 'holidays'],
];

interface Insert {
	sql: string;
	params: unknown[];
}

function fixtureDb(
	tables: Tables,
	inserts: Insert[] = []
): SqlConnection {
	return {
		execute: async (
			sql: string,
			params?: Array<string | number | boolean | null>
		): Promise<[unknown, unknown]> => {
			if (sql.includes('INSERT INTO')) {
				inserts.push({ sql, params: params ?? [] });
				if (sql.includes('INSERT INTO payroll_employee_allocations'))
					return [{ insertId: 500, affectedRows: 1 }, undefined];
				return [{ affectedRows: 1 }, undefined];
			}
			if (sql.includes('COALESCE(MAX(version)'))
				return [[{ version: 0 }], undefined];
			if (sql.includes('FROM users'))
				return [tables.hourUsers ?? [], undefined];
			for (const [marker, key] of MATCHERS) {
				if (sql.includes(marker)) return [tables[key] ?? [], undefined];
			}
			throw new Error(`unfixture table in: ${sql.slice(0, 90)}`);
		},
	};
}

function employee(
	id: number,
	options: {
		name?: string;
		status?: string;
		joining?: string | null;
		exit?: string | null;
	} = {}
): Record<string, unknown> {
	return {
		id,
		employee_id: `EMP-${id}`,
		name: options.name ?? `Employee ${id}`,
		status: options.status ?? 'active',
		isDelete: 0,
		employee_type: 'Payroll',
		joining_date: options.joining ?? '2026-01-01',
		hire_date: null,
		exit_date: options.exit ?? null,
	};
}

function canonical(
	employeeId: number,
	options: { effectiveFrom?: string; salaryType?: string; cost?: number } = {}
): Record<string, unknown> {
	return {
		id: employeeId,
		employee_id: employeeId,
		employer_cost: options.cost ?? 25000,
		salary_type: options.salaryType ?? 'monthly',
		std_hours_per_day: 8,
		effective_from: options.effectiveFrom ?? '2026-01-01',
		effective_to: null,
	};
}

function slip(employeeId: number, cost: number): Record<string, unknown> {
	return {
		id: employeeId * 10,
		employee_id: employeeId,
		employer_cost: cost,
	};
}

function allocation(
	employeeId: number,
	options: {
		cost?: number;
		payStream?: 'payroll' | 'contract';
		code?: string;
		name?: string;
	} = {}
): Record<string, unknown> {
	return {
		id: employeeId * 100,
		allocation_uid: `ALLOC-${employeeId}`,
		payroll_slip_id: employeeId * 10,
		employee_id: employeeId,
		employee_code: options.code ?? `EMP-${employeeId}`,
		employee_name: options.name ?? `Employee ${employeeId}`,
		pay_stream: options.payStream ?? 'payroll',
		version: 1,
		kind: 'finalization',
		recorded_employer_cost: options.cost ?? 25000,
		total_logged_hours: 0,
		project_hours: 0,
		no_project_hours: 0,
		rounding_adjustment: 0,
	};
}

function allocationShare(employeeId: number, cost: number): Record<string, unknown> {
	return {
		allocation_id: employeeId * 100,
		project_id: null,
		project_code: null,
		project_name: null,
		client_name: null,
		hours: 0,
		amount: cost,
		rounding_adjustment: 0,
		basis: 'no_logged_hours',
	};
}

function hours(
	employeeId: number,
	hoursValue = 8,
	day = 4
): Record<string, unknown> {
	return {
		employee_id: employeeId,
		project_id: null,
		daily_entries: JSON.stringify([
			{ date: `${MONTH}-${String(day).padStart(2, '0')}`, hours: hoursValue },
		]),
		user_employee_id: null,
		project_code: null,
		project_name: null,
		client_name: null,
	};
}

function frozenMember(
	employeeId: number,
	options: { name?: string; salaryType?: string } = {}
): Record<string, unknown> {
	return {
		employee_id: employeeId,
		employee_code: `EMP-${employeeId}`,
		name: options.name ?? `Employee ${employeeId}`,
		employment_start: '2026-01-01',
		employment_end: null,
		profile_date: MONTH_DAY,
		profile_source: 'employee_salary_profile',
		profile_id: employeeId,
		salary_type: options.salaryType ?? 'monthly',
	};
}

function snapshot(memberIds: number[]): Record<string, unknown> {
	return {
		month: MONTH_DAY,
		version: 1,
		frozen_at: '2026-11-01 10:00:00',
		members: JSON.stringify(memberIds.map((id) => frozenMember(id))),
	};
}

describe('finalized payroll roster in the reported month', () => {
	it('keeps the saved roster and costs when a backdated profile-only hire appears later', async () => {
		const tables: Tables = {
			employees: [
				employee(1),
				employee(4, { status: 'inactive' }),
				employee(5),
				employee(6),
			],
			// Employee 6 is the late November hire with a backdated October
			// profile: eligible today, never in the finalized October run.
			// Employee 5 worked in October but the saved roster excludes them.
			legacy: [],
			canonical: [
				canonical(1),
				canonical(4, { cost: 18000 }),
				canonical(5),
				canonical(6, { effectiveFrom: `${MONTH}-01`, cost: 30000 }),
			],
			runs: [{ id: 77, status: 'finalized', month: 10, year: 2026 }],
			rosters: [snapshot([1, 4])],
			slips: [slip(1, 25000), slip(4, 18000)],
			allocations: [allocation(1), allocation(4, { cost: 18000 })],
			shares: [allocationShare(1, 25000), allocationShare(4, 18000)],
			assignments: [hours(5)],
		};

		const interpretation = await loadPayrollMonth(fixtureDb(tables), MONTH);

		expect(interpretation.roster).toMatchObject({
			basis: 'saved',
			member_count: 2,
			not_in_saved_roster_count: 1,
			worked_outside_count: 1,
		});
		expect(interpretation.employees.map((row) => row.employee_id)).toEqual([
			1, 4, 5,
		]);
		expect(
			interpretation.employees.find((row) => row.employee_id === 6)
		).toBeUndefined();
		expect(interpretation.totals.recorded_total).toBe(43000);
		expect(interpretation.totals.estimated_total).toBe(0);

		const inactive = interpretation.employees.find(
			(row) => row.employee_id === 4
		);
		expect(inactive?.status).toBe('recorded');
		expect(inactive?.in_saved_roster).toBe(true);

		const offRoster = interpretation.employees.find(
			(row) => row.employee_id === 5
		);
		expect(offRoster?.status).toBe('unknown');
		expect(offRoster?.estimated_amount).toBeNull();
		expect(offRoster?.in_saved_roster).toBe(false);
		expect(offRoster?.worked_outside_finalized_run).toBe(true);
		expect(offRoster?.logged_hours).toBe(8);

		const workedNotice = interpretation.coverage.find(
			(notice) => notice.code === 'payroll_work_outside_finalized_run'
		);
		expect(workedNotice?.label).toBe(
			'Worked in month — not included in finalized payroll'
		);
		expect(workedNotice?.severity).toBe('warning');
		expect(
			interpretation.coverage.some(
				(notice) => notice.code === 'payroll_outside_finalized_roster'
			)
		).toBe(true);
	});

	it('keeps a legacy locked run truthful when no roster snapshot exists', async () => {
		const tables: Tables = {
			employees: [employee(1), employee(4), employee(5), employee(6)],
			legacy: [],
			canonical: [
				canonical(1),
				canonical(4),
				canonical(5),
				canonical(6),
			],
			runs: [{ id: 88, status: 'finalized', month: 10, year: 2026 }],
			// No rosters row: the legacy run predates saved validated rosters.
			slips: [slip(1, 25000), { id: 40, employee_id: 4, employer_cost: 18000 }],
			allocations: [allocation(1)],
			shares: [allocationShare(1, 25000)],
			assignments: [hours(5)],
		};

		const interpretation = await loadPayrollMonth(fixtureDb(tables), MONTH);

		expect(interpretation.roster.basis).toBe('unavailable');
		expect(interpretation.roster.member_count).toBeNull();
		expect(interpretation.roster.not_in_saved_roster_count).toBe(0);
		expect(
			interpretation.coverage.find(
				(notice) => notice.code === 'payroll_roster_unavailable'
			)?.severity
		).toBe('warning');

		// Employee 6 has a live profile but no October slip or work: a legacy
		// locked month must not promote today's roster into historical cost.
		expect(
			interpretation.employees.find((row) => row.employee_id === 6)
		).toBeUndefined();

		const recorded = interpretation.employees.find(
			(row) => row.employee_id === 1
		);
		expect(recorded?.status).toBe('recorded');
		expect(recorded?.in_saved_roster).toBeNull();

		const missingAllocation = interpretation.employees.find(
			(row) => row.employee_id === 4
		);
		expect(missingAllocation?.status).toBe('unknown');
		expect(missingAllocation?.estimated_amount).toBeNull();
		expect(missingAllocation?.slip_amount).toBe(18000);
		expect(missingAllocation?.allocation_missing).toBe(true);
		expect(missingAllocation?.employee_name).toBe('Employee 4');

		const worked = interpretation.employees.find(
			(row) => row.employee_id === 5
		);
		expect(worked?.status).toBe('unknown');
		expect(worked?.estimated_amount).toBeNull();
		expect(worked?.logged_hours).toBe(8);
		expect(worked?.worked_outside_finalized_run).toBe(false);
	});

	it('prices a draft midmonth contract hire from the shared roster selection', async () => {
		const tables: Tables = {
			employees: [employee(2, { joining: `${MONTH}-15` })],
			legacy: [],
			canonical: [
				{
					...canonical(2, {
						effectiveFrom: `${MONTH}-15`,
						salaryType: 'contract',
						cost: 31000,
					}),
					gross_salary: 31000,
					contract_amount: 31000,
				},
			],
			runs: [{ id: 90, status: 'draft', month: 10, year: 2026 }],
			// Real hours after the mid-month joining date; ownership is the
			// assignment's employee id, so the roster recognizes the work.
			assignments: [hours(2, 80, 20)],
		};

		const interpretation = await loadPayrollMonth(fixtureDb(tables), MONTH);

		expect(interpretation.roster.basis).toBe('draft');
		const [row] = interpretation.employees;
		expect(row.pay_stream).toBe('contract');
		expect(row.status).toBe('estimated');
		expect(row.estimated_amount).toBeGreaterThan(0);
		expect(row.missing_pricing).toBe(false);
		expect(row.employment_issue).toBeNull();
	});

	it('freezes the saved roster identity and contract stream, not live profile edits', async () => {
		const inserts: Insert[] = [];
		const tables: Tables = {
			employees: [employee(1, { name: 'Live Renamed Employee' })],
			legacy: [],
			// The live profile now reads monthly; the saved run froze contract.
			canonical: [canonical(1, { salaryType: 'monthly' })],
			runs: [{ id: 99, status: 'finalized', month: 10, year: 2026 }],
			rosters: [
				{
					month: MONTH_DAY,
					version: 1,
					frozen_at: '2026-11-01 10:00:00',
					members: JSON.stringify([
						frozenMember(1, {
							name: 'Frozen Employee',
							salaryType: 'contract',
						}),
					]),
				},
			],
			slips: [slip(1, 25000)],
			allocations: [],
			shares: [],
			assignments: [],
		};

		const summary = await freezeMonthAllocations(
			fixtureDb(tables, inserts),
			MONTH_DAY,
			null
		);
		expect(summary).toEqual({ allocations: 1, total: 25000 });

		const allocationInsert = inserts.find((entry) =>
			entry.sql.includes('INSERT INTO payroll_employee_allocations')
		);
		expect(allocationInsert).toBeDefined();
		// [uid, slip, month, employee, code, name, stream, version, cost, ...]
		expect(allocationInsert?.params[4]).toBe('EMP-1');
		expect(allocationInsert?.params[5]).toBe('Frozen Employee');
		expect(allocationInsert?.params[6]).toBe('contract');
	});
});
