import { describe, it, expect } from 'vitest';
import {
	sumHoursByMonth,
	buildProjectCostRows,
	buildProjectCostTotals,
	resolveHourlyRateOfFY,
	buildMonthlyAllocationRows,
	buildMonthlyAllocationEmployeeRows,
	buildMonthlyAllocationProjectRows,
	buildMonthlyAllocationTotals,
	type SalaryProfile,
	type ProjectCostRow,
} from '@/app/reports/company-monthly-cost/employee-cost-data-source';

import type {
	PayrollEmployeeCost,
	PayrollProjectShare,
} from '@/lib/company-expenditure/types';
function profile(overrides: Partial<SalaryProfile> = {}): SalaryProfile {
	return {
		employee_id: 1,
		gross: 0,
		gross_salary: 20000,
		employer_cost: 22000,
		hourly_rate: 0,
		daily_rate: 0,
		std_hours_per_day: 8,
		std_working_days: 26,
		salary_type: 'monthly',
		tds_percentage: 10,
		effective_from: '2026-01-01',
		effective_to: null,
		...overrides,
	};
}

function assignment(
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		project_id: 10,
		project_code: 'ATS-001',
		project_name: 'Tower Layout',
		client_name: 'Acme Ltd',
		daily_entries: '[]',
		...overrides,
	};
}

describe('sumHoursByMonth', () => {
	it('buckets daily-entry hours per calendar month from a JSON string', () => {
		const raw = JSON.stringify([
			{ date: '2026-04-01', hours: 8 },
			{ date: '2026-04-02', hours: '4.5' },
			{ date: '2026-04-03', hours: 0 },
			{ date: '2026-05-11', hours: 7 },
		]);
		expect(sumHoursByMonth(raw)).toEqual({
			'2026-04': 12.5,
			'2026-05': 7,
		});
	});

	it('accepts an already-parsed array and ignores malformed entries', () => {
		expect(
			sumHoursByMonth([
				{ date: '2026-06-01', hours: 3 },
				{ qty_done: 5 },
				null,
				{ date: '', hours: 5 },
				{ date: '2026-06-02' },
			])
		).toEqual({ '2026-06': 3 });
	});

	it('returns an empty object for null / invalid JSON', () => {
		expect(sumHoursByMonth(null)).toEqual({});
		expect(sumHoursByMonth('not json')).toEqual({});
	});
});

describe('buildProjectCostRows', () => {
	it('merges assignments per project and costs hours at the salary-derived rate', () => {
		const rows = buildProjectCostRows(
			[
				assignment({
					daily_entries: JSON.stringify([
						{ date: '2026-04-01', hours: 8 },
						{ date: '2026-04-02', hours: 8 },
					]),
				}),
				assignment({
					daily_entries: JSON.stringify([{ date: '2026-04-20', hours: 4 }]),
				}),
			],
			[profile()],
			2026
		);
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.project_code).toBe('ATS-001');
		expect(row.sr_no).toBe(1);
		expect(row.monthly_hours.apr).toBe(20);
		// Raw rate 20000 / 208 = 96.1538… × 20h = 1923.08 (unrounded-rate math)
		expect(row.monthly_cost.apr).toBe(1923.08);
		expect(row.total_hours).toBe(20);
		expect(row.total_cost).toBe(1923.08);
		// Display rate is the rounded payroll formula result
		expect(row.hourly_rate).toBe(96.15);
	});

	it('uses the stored hourly rate for hourly salary types', () => {
		const rows = buildProjectCostRows(
			[
				assignment({
					project_id: 11,
					project_code: 'ATS-002',
					daily_entries: JSON.stringify([{ date: '2026-07-05', hours: 10 }]),
				}),
			],
			[profile({ salary_type: 'hourly', hourly_rate: 250 })],
			2026
		);
		expect(rows[0].hourly_rate).toBe(250);
		expect(rows[0].monthly_cost.jul).toBe(2500);
	});

	it('applies each month’s own effective-dated profile (mid-year raise)', () => {
		const rows = buildProjectCostRows(
			[
				assignment({
					daily_entries: JSON.stringify([
						{ date: '2026-04-10', hours: 10 },
						{ date: '2026-10-15', hours: 4 },
					]),
				}),
			],
			[
				profile({ gross_salary: 20800, effective_to: '2026-09-30' }), // 100/hr
				profile({ gross_salary: 26000, effective_from: '2026-10-01' }), // 125/hr
			],
			2026
		);
		expect(rows[0].monthly_cost.apr).toBe(1000); // 10h × 100
		expect(rows[0].monthly_cost.oct).toBe(500); // 4h × 125
		expect(rows[0].total_cost).toBe(1500);
		expect(
			resolveHourlyRateOfFY(
				[
					profile({ gross_salary: 20800, effective_to: '2026-09-30' }),
					profile({ gross_salary: 26000, effective_from: '2026-10-01' }),
				],
				2026
			)
		).toBe(100); // profile covering FY start (Apr)
	});

	it('keeps only FY-window months and drops projects with no hours in the FY', () => {
		const rows = buildProjectCostRows(
			[
				// Hours only in FY 2025 → dropped from FY 2026 view
				assignment({
					project_id: 12,
					project_code: 'ATS-OLD',
					daily_entries: JSON.stringify([{ date: '2025-05-01', hours: 40 }]),
				}),
				// Apr 2026 hours land inside FY 2026; Mar 2027 also belongs to it
				assignment({
					daily_entries: JSON.stringify([
						{ date: '2026-04-02', hours: 5 },
						{ date: '2027-03-28', hours: 3 },
					]),
				}),
			],
			[profile()],
			2026
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].monthly_hours.apr).toBe(5);
		expect(rows[0].monthly_hours.mar).toBe(3);
		expect(rows[0].total_hours).toBe(8);
	});

	it('sorts rows by project code and assigns sequential sr_no', () => {
		const rows = buildProjectCostRows(
			[
				assignment({
					project_id: 22,
					project_code: 'B-002',
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 2 }]),
				}),
				assignment({
					project_id: 21,
					project_code: 'A-001',
					daily_entries: JSON.stringify([{ date: '2026-04-01', hours: 2 }]),
				}),
			],
			[profile()],
			2026
		);
		expect(rows.map((r) => r.project_code)).toEqual(['A-001', 'B-002']);
		expect(rows.map((r) => r.sr_no)).toEqual([1, 2]);
	});

	it('returns [] when there are no assignments', () => {
		expect(buildProjectCostRows([], [profile()], 2026)).toEqual([]);
	});
});

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
		const unpriced: PayrollEmployeeCost = {
			employee_id: 1,
			employee_code: 'EMP-1',
			employee_name: 'Missing profile',
			pay_stream: 'unknown',
			status: 'unknown',
			recorded_amount: null,
			estimated_amount: null,
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
		const recorded: PayrollEmployeeCost = {
			...unpriced,
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
			},
			{
				project_id: 51,
				hours: 4,
				cost: 0,
				cost_status: 'unknown',
				missing_salary_profile: true,
			},
		]);
		expect(buildMonthlyAllocationEmployeeRows(rows)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					employee_id: 1,
					hours: 12,
					cost: 0,
					missing_salary_profile: true,
				}),
				expect.objectContaining({
					employee_id: 2,
					hours: 2,
					cost: 200,
					missing_salary_profile: false,
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
