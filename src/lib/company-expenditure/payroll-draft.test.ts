import { describe, expect, it } from 'vitest';
import { reviewReconciliation } from './close';
import { loadPayrollMonth } from './payroll';
import type { PayrollMonthInterpretation } from './payroll';
import type { SqlConnection } from './records';
import type { CompanyReconciliation } from './types';

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
	['FROM payroll_run_rosters', 'rosters'],
	['FROM payroll_employee_allocations a', 'allocations'],
	['FROM payroll_employee_allocation_shares', 'shares'],
	['FROM payroll_allocation_reconstruction_proposals', 'reconstructions'],
	['FROM logged_activity_assignments', 'assignments'],
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
		joining_date: '2026-01-01',
		hire_date: null,
		exit_date: null,
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
		runs: [{ id: 1, status: 'draft', month: 9, year: 2026 }],
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

/**
 * One paid run with one recorded employee (slip plus frozen allocation) and
 * one employee the report still prices from a covering Salary Profile but has
 * no slip for. The second employee is both `estimated` and `missing_slip`.
 */
function paidMonth(): Tables {
	return {
		employees: [employeeRow(1), employeeRow(2)],
		canonical: [
			{
				id: 2,
				employee_id: 2,
				employer_cost: 26000,
				salary_type: 'monthly',
				std_hours_per_day: 8,
				effective_from: '2026-01-01',
				effective_to: null,
			},
		],
		// Payment does not change the stored run status.
		runs: [{ id: 20, status: 'finalized', month: 9, year: 2026 }],
		rosters: [
			{
				month: `${MONTH}-01`,
				version: 1,
				frozen_at: '2026-10-01 10:00:00',
				members: JSON.stringify([
					{
						employee_id: 1,
						employee_code: 'EMP-1',
						name: 'Employee 1',
						employment_start: '2026-01-01',
						employment_end: null,
						profile_date: `${MONTH}-01`,
						profile_source: 'employee_salary_profile',
						profile_id: 1,
						salary_type: 'monthly',
					},
					{
						employee_id: 2,
						employee_code: 'EMP-2',
						name: 'Employee 2',
						employment_start: '2026-01-01',
						employment_end: null,
						profile_date: `${MONTH}-01`,
						profile_source: 'employee_salary_profile',
						profile_id: 2,
						salary_type: 'monthly',
					},
				]),
			},
		],
		slips: [
			{ id: 10, employee_id: 1, employer_cost: 20000, payment_status: 'paid' },
		],
		allocations: [
			{
				id: 100,
				allocation_uid: 'ALLOC-100',
				payroll_slip_id: 10,
				employee_id: 1,
				employee_code: 'EMP-1',
				employee_name: 'Employee 1',
				pay_stream: 'payroll',
				version: 1,
				kind: 'finalization',
				recorded_employer_cost: 20000,
				total_logged_hours: 0,
				project_hours: 0,
				no_project_hours: 0,
				rounding_adjustment: 0,
			},
		],
		shares: [
			{
				allocation_id: 100,
				project_id: null,
				project_code: null,
				project_name: null,
				client_name: null,
				hours: 0,
				amount: 20000,
				rounding_adjustment: 0,
				basis: 'no_logged_hours',
			},
		],
		assignments: [
			{
				employee_id: 2,
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

/**
 * The close review over a real payroll interpretation. Payroll, coverage, and
 * month are the interpretation itself; the remaining reconciliation sections
 * are empty because this seam reads nothing else from them.
 */
function reviewOf(interpretation: PayrollMonthInterpretation) {
	return reviewReconciliation({
		month: interpretation.month,
		coverage: interpretation.coverage,
		payroll: interpretation.totals,
		supplier_commitment: { exceptions: [] },
		cash: { coverage: { partial_targets: 0, unsettled_targets: 0 } },
	} as unknown as CompanyReconciliation);
}

describe('payroll draft disclosure', () => {
	it('keeps a draft slip without a covering profile unknown, not zero', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb({
				employees: [employeeRow(7)],
				slips: [{ id: 70, employee_id: 7, employer_cost: 12000 }],
				runs: [{ id: 1, status: 'draft', month: 9, year: 2026 }],
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
		const review = reviewOf(interpretation);
		expect(review.warnings.map((warning) => warning.code)).toContain(
			'payroll_not_finalized'
		);
		expect(review.warnings.map((warning) => warning.code)).not.toContain(
			'payroll_finalization_pending'
		);
		expect(review.can_close).toBe(true);
	});

	it('keeps frozen recorded cost after the covering profile is removed', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb({
				employees: [employeeRow(9)],
				slips: [{ id: 90, employee_id: 9, employer_cost: 18000 }],
				runs: [{ id: 30, status: 'finalized', month: 9, year: 2026 }],
				rosters: [
					{
						month: `${MONTH}-01`,
						version: 1,
						frozen_at: '2026-10-01 10:00:00',
						members: JSON.stringify([
							{
								employee_id: 9,
								employee_code: 'EMP-9',
								name: 'Employee 9',
								employment_start: '2026-01-01',
								employment_end: null,
								profile_date: `${MONTH}-01`,
								profile_source: 'employee_salary_profile',
								profile_id: 9,
								salary_type: 'monthly',
							},
						]),
					},
				],
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

describe('draft salary availability', () => {
	function draftTables(
		employeeId: number,
		canonicalRows: Array<Record<string, unknown>>,
		hoursValue: number
	): Tables {
		return {
			employees: [employeeRow(employeeId)],
			canonical: canonicalRows,
			runs: [{ id: 1, status: 'draft', month: 9, year: 2026 }],
			assignments: [
				{
					employee_id: employeeId,
					project_id: null,
					daily_entries: JSON.stringify([
						{ date: `${MONTH}-04`, hours: hoursValue },
					]),
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

	function salaryRow(
		employeeId: number,
		overrides: Record<string, unknown> = {}
	): Record<string, unknown> {
		return {
			id: employeeId,
			employee_id: employeeId,
			salary_type: 'monthly',
			std_hours_per_day: 8,
			effective_from: '2026-01-01',
			effective_to: null,
			...overrides,
		};
	}

	it('returns an ambiguous covering agreement as unavailable and names the competing ids', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(
				draftTables(
					12,
					[
						salaryRow(12, { employer_cost: 25000 }),
						salaryRow(13, {
							employee_id: 12,
							employer_cost: 26000,
							effective_from: '2026-02-01',
						}),
					],
					104
				)
			),
			MONTH
		);

		const [row] = interpretation.employees;
		expect(row.status).toBe('unknown');
		expect(row.estimated_amount).toBeNull();
		expect(row.missing_pricing).toBe(true);
		expect(row.salary).toEqual({
			availability: 'ambiguous',
			issue: 'salary_profile_ambiguous',
			profile_id: null,
			profile_source: null,
			salary_type: null,
			ctc_source: 'none',
			conflict_ids: [12, 13],
			legacy_fallback: false,
		});
		expect(interpretation.salary).toMatchObject({
			ambiguous_count: 1,
			complete: false,
		});
		expect(interpretation.totals.estimated_total).toBe(0);
		const notice = interpretation.coverage.find(
			(entry) => entry.code === 'payroll_salary_ambiguous'
		);
		expect(notice?.severity).toBe('warning');
		expect(notice?.detail).toContain('not zero');
	});

	it('keeps an explicit canonical zero as a confirmed zero, never the positive legacy fallback', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(
				draftTables(
					14,
					[salaryRow(14, { employer_cost: 0, gross_salary: 25000 })],
					104
				)
			),
			MONTH
		);

		const [row] = interpretation.employees;
		expect(row.status).toBe('estimated');
		expect(row.estimated_amount).toBe(0);
		expect(row.missing_pricing).toBe(false);
		expect(row.salary).toMatchObject({
			availability: 'available',
			issue: null,
			ctc_source: 'employer_cost',
			legacy_fallback: false,
		});
		expect(interpretation.totals.estimated_total).toBe(0);
		expect(interpretation.salary).toMatchObject({
			available_count: 1,
			legacy_fallback_count: 0,
			complete: true,
		});
		expect(
			interpretation.coverage.some((entry) =>
				entry.code.startsWith('payroll_salary_')
			)
		).toBe(false);
	});

	it('returns a present-but-invalid CTC as unavailable instead of throwing or falling back', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(
				draftTables(
					15,
					[
						salaryRow(15, {
							employer_cost: -100,
							gross_salary: 25000,
						}),
					],
					104
				)
			),
			MONTH
		);

		const [row] = interpretation.employees;
		expect(row.status).toBe('unknown');
		expect(row.estimated_amount).toBeNull();
		expect(row.missing_pricing).toBe(true);
		expect(row.salary).toMatchObject({
			availability: 'ctc_invalid',
			issue: 'salary_ctc_invalid',
			ctc_source: 'none',
		});
		expect(interpretation.salary).toMatchObject({
			ctc_invalid_count: 1,
			complete: false,
		});
		expect(
			interpretation.coverage.find(
				(entry) => entry.code === 'payroll_salary_ctc_invalid'
			)?.severity
		).toBe('warning');
	});

	it('discloses a legacy gross fallback instead of presenting it as agreed CTC', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(draftTables(16, [salaryRow(16, { gross_salary: 20800 })], 104)),
			MONTH
		);

		const [row] = interpretation.employees;
		// CTC apportionment 10,400 plus the rupee-rounded gratuity employer cost.
		expect(row.estimated_amount).toBe(10700);
		expect(row.salary).toMatchObject({
			availability: 'available',
			ctc_source: 'gross_salary',
			legacy_fallback: true,
			profile_id: 16,
			profile_source: 'employee_salary_profile',
		});
		expect(interpretation.salary).toMatchObject({
			available_count: 1,
			legacy_fallback_count: 1,
			complete: true,
		});
	});

	it('returns a covering agreement without any CTC as unavailable, not zero', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(draftTables(17, [salaryRow(17)], 104)),
			MONTH
		);

		const [row] = interpretation.employees;
		expect(row.status).toBe('unknown');
		expect(row.estimated_amount).toBeNull();
		expect(row.missing_pricing).toBe(true);
		expect(row.salary).toMatchObject({
			availability: 'ctc_missing',
			issue: 'salary_ctc_missing',
			ctc_source: 'none',
			profile_id: 17,
		});
		expect(
			interpretation.coverage.find(
				(entry) => entry.code === 'payroll_salary_ctc_missing'
			)?.severity
		).toBe('warning');
	});

	it('never anchors the month to a future agreement when no agreement covers it', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(
				draftTables(
					18,
					[
						salaryRow(18, {
							employer_cost: 26000,
							effective_from: '2026-11-01',
						}),
					],
					104
				)
			),
			MONTH
		);

		const [row] = interpretation.employees;
		expect(row.status).toBe('unknown');
		expect(row.estimated_amount).toBeNull();
		expect(row.missing_pricing).toBe(true);
		expect(row.salary).toEqual({
			availability: 'missing',
			issue: 'salary_profile_missing',
			profile_id: null,
			profile_source: null,
			salary_type: null,
			ctc_source: 'none',
			conflict_ids: [],
			legacy_fallback: false,
		});
		expect(
			interpretation.coverage.find(
				(entry) => entry.code === 'payroll_pricing_missing'
			)?.severity
		).toBe('warning');
	});

	it('prices an unclosed month from its live Logged Hours, not a frozen figure', async () => {
		const full = await loadPayrollMonth(
			fixtureDb(
				draftTables(19, [salaryRow(19, { employer_cost: 26000 })], 104)
			),
			MONTH
		);
		const corrected = await loadPayrollMonth(
			fixtureDb(draftTables(19, [salaryRow(19, { employer_cost: 26000 })], 52)),
			MONTH
		);

		// CTC apportionment plus the rupee-rounded gratuity employer cost.
		expect(full.employees[0].estimated_amount).toBe(13375);
		expect(corrected.employees[0].estimated_amount).toBe(6688);
	});
});

describe('payroll coverage through financial close', () => {
	it('keeps the no-run lifecycle warning through the close review', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb({ employees: [employeeRow(3)] }),
			MONTH
		);
		expect(interpretation.employees).toHaveLength(0);
		const codes = reviewOf(interpretation).warnings.map(
			(warning) => warning.code
		);
		expect(codes).toContain('payroll_not_generated');
		expect(codes).not.toContain('payroll_finalization_pending');
	});

	it('states a paid run’s missing slip once, without inventing an estimate', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(paidMonth()),
			MONTH
		);
		expect(interpretation.totals.recorded_count).toBe(1);
		expect(interpretation.totals.estimated_count).toBe(0);
		expect(interpretation.totals.missing_slip_count).toBe(1);
		const missing = interpretation.employees.find(
			(employee) => employee.employee_id === 2
		);
		expect(missing?.status).toBe('unknown');
		expect(missing?.estimated_amount).toBeNull();
		expect(missing?.in_saved_roster).toBe(true);

		const review = reviewOf(interpretation);
		const codes = review.warnings.map((warning) => warning.code);
		expect(codes).toContain('payroll_slip_missing');
		expect(codes).not.toContain('payroll_not_finalized');
		expect(codes).not.toContain('payroll_finalization_pending');
		// The missing slip is disclosed evidence; payroll never blocks the close.
		expect(review.can_close).toBe(true);
		expect(review.blockers).toHaveLength(0);
	});

	it('still blocks a close carrying a real cost blocker', async () => {
		const interpretation = await loadPayrollMonth(
			fixtureDb(paidMonth()),
			MONTH
		);
		const review = reviewOf({
			...interpretation,
			coverage: [
				...interpretation.coverage,
				{
					code: 'missing_amount',
					label: 'Amount missing',
					detail: 'A recognized record has no amount.',
					severity: 'warning',
				},
			],
		});
		expect(review.can_close).toBe(false);
		expect(review.blockers.map((blocker) => blocker.code)).toContain(
			'missing_amount'
		);
	});
});
