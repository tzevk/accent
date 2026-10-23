import { describe, expect, it } from 'vitest';
import { loadPayrollMonth } from './payroll';
import type { SqlConnection } from './records';

const MONTH = '2026-09';

/**
 * Draft disclosure through real `loadPayrollMonth`: slip rows without a
 * covering profile stay unknown, a profile-based estimate stays out of
 * recorded cost, and a frozen allocation survives profile removal.
 */

type Table = Record<string, unknown>[];
type Tables = Partial<Record<string, Table>>;

const MATCHERS: Array<[string, string]> = [
	['CONCAT_WS', 'employees'],
	['FROM employee_salary_profile', 'canonical'],
	['FROM salary_structures', 'legacy'],
	['FROM payroll_slips', 'slips'],
	['FROM payroll_runs', 'runs'],
	['FROM payroll_employee_allocations a', 'allocations'],
	['FROM payroll_employee_allocation_shares', 'shares'],
	['FROM user_activity_assignments', 'assignments'],
	['FROM employees WHERE isDelete', 'hourEmployees'],
	['FROM payroll_schedules', 'schedules'],
	['FROM holiday_master', 'holidays'],
];

function fixtureDb(partial: Tables): SqlConnection {
	const tables: Record<string, Table> = { hourUsers: [], ...partial };
	return {
		execute: async (sql: string): Promise<[unknown, unknown]> => {
			if (sql.includes('FROM users'))
				return [tables.hourUsers ?? [], undefined];
			for (const [marker, key] of MATCHERS) {
				if (sql.includes(marker)) return [tables[key] ?? [], undefined];
			}
			throw new Error(`unfixture table in: ${sql.slice(0, 80)}`);
		},
	};
}

function employeeRow(id: number): Record<string, unknown> {
	return {
		id,
		employee_id: `EMP-${id}`,
		name: `Employee ${id}`,
		status: 'active',
		isDelete: 0,
		employee_type: 'Payroll',
	};
}

function pricedMonth(employeeId: number): Tables {
	return {
		employees: [employeeRow(employeeId)],
		canonical: [
			{
				id: employeeId,
				employee_id: employeeId,
				employer_cost: 26000,
				salary_type: 'monthly',
				std_hours_per_day: 8,
				effective_from: '2026-01-01',
				effective_to: null,
			},
		],
		runs: [{ status: 'draft' }],
		assignments: [
			{
				employee_id: employeeId,
				project_id: null,
				daily_entries: JSON.stringify([{ date: `${MONTH}-04`, hours: 104 }]),
				user_employee_id: null,
				user_email: null,
				user_username: null,
				project_code: null,
				project_name: null,
				client_name: null,
			},
		],
	};
}

describe('payroll draft disclosure', () => {
	it('keeps a draft slip without a covering profile unknown, not zero', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb({
				employees: [employeeRow(7)],
				slips: [{ id: 70, employee_id: 7, employer_cost: 12000 }],
				runs: [{ status: 'draft' }],
			}),
			MONTH
		);
		const [row] = interpretation.employees;
		expect(interpretation.employees).toHaveLength(1);
		expect(row.status).toBe('unknown');
		expect(row.recorded_amount).toBeNull();
		expect(row.estimated_amount).toBeNull();
		expect(row.missing_pricing).toBe(true);
		expect(interpretation.totals.recorded_total).toBe(0);
		expect(interpretation.totals.estimated_total).toBe(0);
		const notice = interpretation.coverage.find(
			(entry) => entry.code === 'payroll_pricing_missing'
		);
		expect(notice?.severity).toBe('warning');
	});

	it('keeps a profile-based estimate out of recorded cost while draft', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(pricedMonth(11)),
			MONTH
		);
		const [row] = interpretation.employees;
		expect(interpretation.employees).toHaveLength(1);
		expect(row.status).toBe('estimated');
		expect(row.recorded_amount).toBeNull();
		expect(row.estimated_amount).toBeGreaterThan(0);
		expect(interpretation.totals.recorded_total).toBe(0);
		expect(interpretation.totals.estimated_total).toBeGreaterThan(0);
		const draft = interpretation.coverage.find(
			(entry) => entry.code === 'payroll_not_finalized'
		);
		expect(draft?.severity).toBe('warning');
	});

	it('keeps frozen recorded cost after the covering profile is removed', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb({
				employees: [employeeRow(9)],
				slips: [{ id: 90, employee_id: 9, employer_cost: 18000 }],
				runs: [{ status: 'finalized' }],
				allocations: [
					{
						id: 900,
						allocation_uid: 'ALLOC-900',
						payroll_slip_id: 90,
						employee_id: 9,
						employee_code: 'EMP-9',
						employee_name: 'Employee 9',
						pay_stream: 'payroll',
						version: 1,
						kind: 'finalization',
						recorded_employer_cost: 18000,
						total_logged_hours: 0,
						project_hours: 0,
						no_project_hours: 0,
						rounding_adjustment: 0,
					},
				],
				shares: [
					{
						allocation_id: 900,
						project_id: null,
						project_code: null,
						project_name: null,
						client_name: null,
						hours: 0,
						amount: 18000,
						rounding_adjustment: 0,
						basis: 'no_logged_hours',
					},
				],
			}),
			MONTH
		);
		const [row] = interpretation.employees;
		expect(interpretation.employees).toHaveLength(1);
		expect(row.status).toBe('recorded');
		expect(row.recorded_amount).toBe(18000);
		expect(row.missing_pricing).toBe(false);
		expect(
			interpretation.coverage.some(
				(entry) => entry.code === 'payroll_pricing_missing'
			)
		).toBe(false);
	});
});
