import { describe, it, expect } from 'vitest';
import {
	buildProjectCostTotals,
	buildMonthlyAllocationRows,
	buildMonthlyAllocationEmployeeRows,
	buildMonthlyAllocationProjectRows,
	buildMonthlyAllocationTotals,
	buildFYAllocationRows,
	buildFYAllocationEmployeeRows,
	buildFYAllocationProjectRows,
	buildFYAllocationTotals,
	type ProjectCostRow,
} from '@/app/reports/company-monthly-cost/employee-cost-data-source';

import type {
	PayrollEmployeeCost,
	PayrollProjectShare,
} from '@/lib/company-expenditure/types';

/** The salary evidence `loadPayrollMonth` attaches to every row. */
interface SalaryEvidenceFixture {
	availability:
		| 'recorded'
		| 'not_consulted'
		| 'available'
		| 'missing'
		| 'ambiguous'
		| 'ctc_missing'
		| 'ctc_invalid'
		| 'unavailable';
	issue:
		| 'salary_profile_missing'
		| 'salary_profile_ambiguous'
		| 'salary_ctc_missing'
		| 'salary_ctc_invalid'
		| null;
	profile_id: number | null;
	profile_source: 'employee_salary_profile' | 'salary_structures' | null;
	salary_type: string | null;
	ctc_source: 'employer_cost' | 'gross_salary' | 'gross' | 'none';
	conflict_ids: number[];
	legacy_fallback: boolean;
}

type PayrollCostRowFixture = PayrollEmployeeCost & {
	salary: SalaryEvidenceFixture;
};

function evidence(
	overrides: Partial<SalaryEvidenceFixture> = {}
): SalaryEvidenceFixture {
	return {
		availability: 'missing',
		issue: 'salary_profile_missing',
		profile_id: null,
		profile_source: null,
		salary_type: null,
		ctc_source: 'none',
		conflict_ids: [],
		legacy_fallback: false,
		...overrides,
	};
}

describe('buildProjectCostTotals', () => {
	const row = (overrides: Partial<ProjectCostRow> = {}): ProjectCostRow => ({
		sr_no: 1,
		project_id: 1,
		project_code: 'P',
		project_name: 'P',
		client_name: '',
		hourly_rate: 0,
		monthly_hours: { apr: 10 },
		monthly_cost: { apr: 961.54 },
		total_hours: 10,
		total_cost: 961.54,
		...overrides,
	});

	it('sums monthly hours/costs and derives the blended rate', () => {
		const totals = buildProjectCostTotals([
			row(),
			row({
				sr_no: 2,
				monthly_hours: { apr: 5, may: 5 },
				monthly_cost: { apr: 480.77, may: 480.77 },
				total_hours: 10,
				total_cost: 961.54,
			}),
		]);
		expect(totals.total_hours).toBe(20);
		expect(totals.total_cost).toBe(1923.08);
		expect(totals.monthly_hours.apr).toBe(15);
		expect(totals.monthly_cost.may).toBe(480.77);
		expect(totals.blended_rate).toBe(96.15); // 1923.08 / 20
	});

	it('returns zeros and a 0 blended rate for no rows', () => {
		const totals = buildProjectCostTotals([]);
		expect(totals.total_hours).toBe(0);
		expect(totals.total_cost).toBe(0);
		expect(totals.blended_rate).toBe(0);
		expect(totals.monthly_hours.apr).toBe(0);
	});
});

describe('monthly salary profile coverage', () => {
	it('keeps unpriced hours and projects beside known cost without claiming a complete total', () => {
		const share: PayrollProjectShare = {
			project_id: 50,
			project_code: 'P-50',
			project_name: 'Project 50',
			client_name: null,
			hours: 8,
			amount: 0,
			rounding_adjustment: 0,
			basis: 'project',
		};
		const unpriced: PayrollCostRowFixture = {
			employee_id: 1,
			employee_code: 'EMP-1',
			employee_name: 'Missing profile',
			pay_stream: 'unknown',
			status: 'unknown',
			salary: evidence(),
			recorded_amount: null,
			estimated_amount: null,
			slip_amount: null,
			in_saved_roster: null,
			worked_outside_finalized_run: false,
			employment_issue: null,
			logged_hours: 12,
			project_hours: 12,
			no_project_hours: 0,
			no_logged_hours: false,
			missing_slip: false,
			missing_pricing: true,
			allocation_missing: false,
			source: {
				payroll_slip_id: null,
				allocation_id: null,
				allocation_version: null,
				allocation_kind: null,
				month: '2026-10',
			},
			shares: [
				share,
				{
					...share,
					project_id: 51,
					project_code: 'P-51',
					project_name: 'Project 51',
					hours: 4,
				},
			],
			hours_by_project: [],
			reconstruction: null,
		};
		const recorded: PayrollCostRowFixture = {
			...unpriced,
			salary: evidence({ availability: 'recorded', issue: null }),
			employee_id: 2,
			employee_code: 'EMP-2',
			employee_name: 'Recorded employee',
			pay_stream: 'payroll',
			status: 'recorded',
			recorded_amount: 200,
			logged_hours: 2,
			project_hours: 2,
			missing_pricing: false,
			shares: [{ ...share, hours: 2, amount: 200 }],
		};
		const knownZero: PayrollEmployeeCost = {
			...recorded,
			employee_id: 3,
			employee_code: 'EMP-3',
			employee_name: 'Known zero',
			status: 'known_zero',
			recorded_amount: 0,
			logged_hours: 3,
			project_hours: 3,
			shares: [
				{
					...share,
					project_id: 51,
					project_code: 'P-51',
					project_name: 'Project 51',
					hours: 3,
					amount: 0,
				},
			],
		};
		const rows = buildMonthlyAllocationRows(
			[unpriced, recorded, knownZero],
			new Map()
		);
		expect(rows.find((row) => row.employee_id === 3)).toMatchObject({
			cost: 0,
			cost_status: 'known_zero',
			missing_salary_profile: false,
		});
		expect(rows.filter((row) => row.employee_id === 1)).toMatchObject([
			{
				project_id: 50,
				hours: 8,
				cost: 0,
				cost_status: 'unknown',
				missing_salary_profile: true,
				salary: evidence(),
			},
			{
				project_id: 51,
				hours: 4,
				cost: 0,
				cost_status: 'unknown',
				missing_salary_profile: true,
				salary: evidence(),
			},
		]);
		expect(buildMonthlyAllocationEmployeeRows(rows)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employee_id: 1,
					hours: 12,
					cost: 0,
					missing_salary_profile: true,
					salary: evidence(),
				}),
				expect.objectContaining({
					employee_id: 2,
					hours: 2,
					cost: 200,
					missing_salary_profile: false,
					salary: evidence({ availability: 'recorded', issue: null }),
				}),
				expect.objectContaining({
					employee_id: 3,
					cost: 0,
					missing_salary_profile: false,
				}),
			])
		);
		expect(buildMonthlyAllocationProjectRows(rows)).toMatchObject([
			{ project_id: 50, hours: 10, cost: 200, missing_salary_profile_count: 1 },
			{ project_id: 51, hours: 7, cost: 0, missing_salary_profile_count: 1 },
		]);
		expect(buildMonthlyAllocationTotals(rows)).toMatchObject({
			total_hours: 17,
			total_cost: 200,
			recorded_cost: 200,
			estimated_cost: 0,
			employee_count: 3,
			project_count: 2,
		});
	});
});

describe('monthly salary availability disclosure', () => {
	it('distinguishes missing, ambiguous, invalid, canonical zero and legacy fallback salary', () => {
		const share = (projectId: number, amount: number): PayrollProjectShare => ({
			project_id: projectId,
			project_code: `P-${projectId}`,
			project_name: `Project ${projectId}`,
			client_name: null,
			hours: 8,
			amount,
			rounding_adjustment: 0,
			basis: 'project',
		});
		const row = (
			employeeId: number,
			salary: SalaryEvidenceFixture,
			options: {
				estimatedAmount?: number | null;
				missingPricing?: boolean;
			} = {}
		): PayrollCostRowFixture => ({
			employee_id: employeeId,
			employee_code: `EMP-${employeeId}`,
			employee_name: `Employee ${employeeId}`,
			pay_stream: 'payroll',
			status:
				options.estimatedAmount === null
					? 'unknown'
					: options.estimatedAmount === undefined
						? 'unknown'
						: 'estimated',
			recorded_amount: null,
			estimated_amount: options.estimatedAmount ?? null,
			slip_amount: null,
			in_saved_roster: null,
			worked_outside_finalized_run: false,
			employment_issue: null,
			logged_hours: 8,
			project_hours: 8,
			no_project_hours: 0,
			no_logged_hours: false,
			missing_slip: false,
			missing_pricing: options.missingPricing ?? false,
			allocation_missing: false,
			source: {
				payroll_slip_id: null,
				allocation_id: null,
				allocation_version: null,
				allocation_kind: null,
				month: '2026-10',
			},
			shares: [share(70 + employeeId, options.estimatedAmount ?? 0)],
			hours_by_project: [],
			reconstruction: null,
			salary,
		});

		const rows = buildMonthlyAllocationRows(
			[
				row(1, evidence(), { missingPricing: true }),
				row(
					2,
					evidence({
						availability: 'ambiguous',
						issue: 'salary_profile_ambiguous',
						conflict_ids: [7, 8],
					}),
					{ missingPricing: true }
				),
				row(
					3,
					evidence({
						availability: 'ctc_invalid',
						issue: 'salary_ctc_invalid',
						profile_id: 9,
						profile_source: 'employee_salary_profile',
					}),
					{ missingPricing: true }
				),
				row(
					4,
					evidence({
						availability: 'available',
						issue: null,
						profile_id: 10,
						profile_source: 'employee_salary_profile',
						ctc_source: 'employer_cost',
					}),
					{ estimatedAmount: 0 }
				),
				row(
					5,
					evidence({
						availability: 'available',
						issue: null,
						profile_id: 11,
						profile_source: 'employee_salary_profile',
						ctc_source: 'gross_salary',
						legacy_fallback: true,
					}),
					{ estimatedAmount: 1000 }
				),
			],
			new Map()
		);

		expect(
			rows.find((candidate) => candidate.employee_id === 1)?.salary
		).toEqual(evidence());
		expect(
			rows.find((candidate) => candidate.employee_id === 2)?.salary
		).toMatchObject({ availability: 'ambiguous', conflict_ids: [7, 8] });
		expect(
			rows.find((candidate) => candidate.employee_id === 3)?.salary
		).toMatchObject({ availability: 'ctc_invalid' });
		expect(rows.find((candidate) => candidate.employee_id === 4)).toMatchObject(
			{
				cost: 0,
				cost_status: 'estimated',
				cost_known: true,
				salary: { availability: 'available', ctc_source: 'employer_cost' },
			}
		);
		expect(rows.find((candidate) => candidate.employee_id === 5)).toMatchObject(
			{
				cost: 1000,
				cost_known: true,
				salary: { ctc_source: 'gross_salary', legacy_fallback: true },
			}
		);

		const projects = buildMonthlyAllocationProjectRows(rows);
		expect(projects.find((project) => project.project_id === 72)).toMatchObject(
			{
				salary_availability_counts: expect.objectContaining({
					ambiguous: 1,
				}),
			}
		);
		expect(projects.find((project) => project.project_id === 73)).toMatchObject(
			{
				salary_availability_counts: expect.objectContaining({
					ctc_invalid: 1,
				}),
			}
		);
		expect(projects.find((project) => project.project_id === 74)).toMatchObject(
			{
				cost_known: true,
				salary_availability_counts: expect.objectContaining({
					available: 1,
				}),
			}
		);

		const employeeRows = buildMonthlyAllocationEmployeeRows(rows);
		expect(
			employeeRows.find((employee) => employee.employee_id === 2)
		).toMatchObject({
			salary: { availability: 'ambiguous', conflict_ids: [7, 8] },
		});
		expect(
			employeeRows.find((employee) => employee.employee_id === 4)
		).toMatchObject({
			cost: 0,
			cost_known: true,
			salary: { availability: 'available' },
		});
	});
});

describe('FY unknown cost evidence', () => {
	it('keeps off-roster work unknown instead of a confirmed FY zero', () => {
		const share: PayrollProjectShare = {
			project_id: 60,
			project_code: 'P-60',
			project_name: 'Project 60',
			client_name: null,
			hours: 8,
			amount: 0,
			rounding_adjustment: 0,
			basis: 'project',
		};
		const base: PayrollEmployeeCost = {
			employee_id: 1,
			employee_code: 'EMP-1',
			employee_name: 'Off roster',
			pay_stream: 'unknown',
			status: 'unknown',
			recorded_amount: null,
			estimated_amount: null,
			slip_amount: null,
			in_saved_roster: false,
			worked_outside_finalized_run: true,
			employment_issue: null,
			logged_hours: 8,
			project_hours: 8,
			no_project_hours: 0,
			no_logged_hours: false,
			missing_slip: false,
			missing_pricing: false,
			allocation_missing: false,
			source: {
				payroll_slip_id: null,
				allocation_id: null,
				allocation_version: null,
				allocation_kind: null,
				month: '2026-10',
			},
			shares: [share],
			hours_by_project: [],
			reconstruction: null,
		};
		const known: PayrollEmployeeCost = {
			...base,
			employee_id: 2,
			employee_code: 'EMP-2',
			employee_name: 'Recorded',
			status: 'recorded',
			recorded_amount: 200,
			in_saved_roster: true,
			worked_outside_finalized_run: false,
			shares: [{ ...share, amount: 200 }],
			hours_by_project: [],
		};

		const rows = buildFYAllocationRows(
			2026,
			['2026-10'],
			new Map([['2026-10', [base, known]]]),
			new Map()
		);
		const unknownRow = rows.find((row) => row.employee_id === 1);
		expect(unknownRow).toMatchObject({
			total_hours: 8,
			total_cost: 0,
			cost_known: false,
			worked_outside_finalized_run: true,
			monthly_cost_known: { oct: false },
		});
		expect(unknownRow?.monthly_cost.oct).toBe(0);

		const employeeRow = buildFYAllocationEmployeeRows(rows).find(
			(row) => row.employee_id === 1
		);
		expect(employeeRow).toMatchObject({
			cost_known: false,
			worked_outside_finalized_run: true,
			monthly_cost_known: { oct: false },
		});

		const projectRow = buildFYAllocationProjectRows(rows).find(
			(row) => row.project_id === 60
		);
		expect(projectRow).toMatchObject({
			cost_known: false,
			unknown_cost_count: 1,
			monthly_cost_known: { oct: false },
		});

		const totals = buildFYAllocationTotals(rows);
		expect(totals.cost_known).toBe(false);
		expect(totals.monthly_cost_known.oct).toBe(false);
		expect(totals.monthly_cost.oct).toBe(200);
		expect(totals.total_cost).toBe(200);
	});
});
