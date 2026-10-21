import { describe, it, expect } from 'vitest';
import {
	MOCK_FY_YEAR,
	MOCK_MONTH,
	mockCostData,
	mockFy,
	mockFyResponse,
	mockMeta,
	mockMetaResponse,
	mockMonth,
	mockMonthResponse,
	mockPayrollEmployees,
	mockPayrollResponse,
	MOCK_INPUTS,
	MOCK_SEPTEMBER_HOURS,
	MOCK_OCTOBER_HOURS,
	MOCK_AUGUST_HOURS,
} from '@/app/reports/company-monthly-cost/employee-cost-mock-data';

/**
 * The fixture's promises, held. Structural first (details and aggregates
 * agree; the FY matrix and the monthly views agree), then the scenario the
 * declarations pin. Expected values are literals from the spec, never
 * recomputed the way the builders compute them.
 */

const september = mockMonth();
const october = mockMonth('2026-10');
const august = mockMonth('2026-08');
const fy = mockFy();

describe('mockMonth', () => {
	it('states the month, its label, and its financial year', () => {
		expect(september.month).toBe('2026-09');
		expect(september.month_label).toBe('September 2026');
		expect(september.fy_label).toBe('FY 2026–27');
		expect(september.fy_year).toBe(2026);
	});

	it('holds one detail row per employee and destination', () => {
		expect(september.rows).toHaveLength(6);
		expect(september.rows.map((row) => row.sr_no)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('orders details by employee name then project code', () => {
		expect(
			september.rows.map((row) => `${row.employee_name} ${row.project_code}`)
		).toEqual([
			'Ananya Sharma PRJ-201',
			'Ananya Sharma PRJ-202',
			'Kabir Nair NO-PROJECT',
			'Kabir Nair PRJ-203',
			'Priya Iyer PRJ-202',
			'Rohan Mehta PRJ-201',
		]);
	});

	it('foots employee rows to their details', () => {
		for (const employee of september.employee_rows) {
			const details = september.rows.filter(
				(row) => row.employee_id === employee.employee_id
			);
			const hours = details.reduce((sum, row) => sum + row.hours, 0);
			const cost = details.reduce((sum, row) => sum + row.cost, 0);
			expect(employee.hours).toBeCloseTo(hours, 2);
			expect(employee.cost).toBeCloseTo(cost, 2);
			expect(employee.recorded_cost + employee.estimated_cost).toBeCloseTo(
				employee.cost,
				2
			);
		}
	});

	it('foots project rows to their details', () => {
		for (const project of september.project_rows) {
			const details = september.rows.filter(
				(row) =>
					(row.project_id !== null
						? String(row.project_id)
						: row.project_code) ===
					(project.project_id !== null
						? String(project.project_id)
						: project.project_code)
			);
			expect(details.length).toBeGreaterThan(0);
			expect(project.hours).toBeCloseTo(
				details.reduce((sum, row) => sum + row.hours, 0),
				2
			);
			expect(project.cost).toBeCloseTo(
				details.reduce((sum, row) => sum + row.cost, 0),
				2
			);
		}
	});

	it('foots totals to the details', () => {
		expect(september.totals.total_hours).toBeCloseTo(
			september.rows.reduce((sum, row) => sum + row.hours, 0),
			2
		);
		expect(september.totals.total_cost).toBeCloseTo(
			september.rows.reduce((sum, row) => sum + row.cost, 0),
			2
		);
		expect(
			september.totals.recorded_cost + september.totals.estimated_cost
		).toBeCloseTo(september.totals.total_cost, 2);
		expect(september.totals.employee_count).toBe(
			new Set(september.rows.map((row) => row.employee_id)).size
		);
	});

	it('excludes the unallocated bucket from the project count', () => {
		expect(
			september.project_rows.some((row) => row.project_code === 'NO-PROJECT')
		).toBe(true);
		expect(september.totals.project_count).toBe(3);
	});
});

describe('mockMonth scenario', () => {
	it('states the September worked example the declarations pin', () => {
		expect(september.totals.total_hours).toBe(568);
		expect(september.totals.total_cost).toBe(381000);
		expect(september.totals.recorded_cost).toBe(381000);
		expect(september.totals.estimated_cost).toBe(0);
		expect(september.totals.blended_rate).toBe(670.77);
		expect(september.totals.employee_count).toBe(4);
		expect(september.totals.project_count).toBe(3);
	});

	it('splits Ananya across two projects in proportion to hours', () => {
		const rows = september.rows.filter((row) => row.employee_code === 'EMP001');
		expect(rows.map((row) => row.hours)).toEqual([120, 48]);
		// 145000 × 120/168 and 145000 × 48/168, to the cent.
		expect(rows.map((row) => row.cost)).toEqual([103571.43, 41428.57]);
		expect(rows[0].cost + rows[1].cost).toBeCloseTo(145000, 2);
	});

	it('keeps one-project employees whole', () => {
		const rohan = september.employee_rows.find(
			(row) => row.employee_code === 'EMP002'
		)!;
		expect(rohan.hours).toBe(160);
		expect(rohan.cost).toBe(98000);
		expect(rohan.project_count).toBe(1);
	});

	it('carries Kabir’s unassigned hours in the NO-PROJECT bucket', () => {
		const bucket = september.rows.find(
			(row) =>
				row.employee_code === 'EMP003' && row.project_code === 'NO-PROJECT'
		)!;
		expect(bucket.hours).toBe(12);
		expect(bucket.project_id).toBeNull();
		expect(bucket.client_name).toBe('');
		const kabir = september.employee_rows.find(
			(row) => row.employee_code === 'EMP003'
		)!;
		expect(kabir.hours).toBe(152);
		expect(kabir.cost).toBe(76000);
		expect(kabir.project_count).toBe(1);
	});

	it('marks a finalized month recorded with no coverage notices', () => {
		expect(september.rows.every((row) => row.cost_status === 'recorded')).toBe(
			true
		);
		expect(september.coverage).toEqual([]);
		expect(september.payroll.recorded_total).toBe(381000);
		expect(september.payroll.estimated_total).toBe(0);
		expect(september.payroll.recorded_count).toBe(4);
		expect(september.payroll.estimated_count).toBe(0);
	});
});

describe('open months', () => {
	it('states October as an estimate with the shared not-finalized warning', () => {
		expect(october.month_label).toBe('October 2026');
		expect(october.rows.every((row) => row.cost_status === 'estimated')).toBe(
			true
		);
		expect(october.totals.recorded_cost).toBe(0);
		expect(october.totals.estimated_cost).toBe(october.totals.total_cost);
		expect(october.coverage).toEqual([
			{
				code: 'payroll_not_finalized',
				label: 'Payroll not finalized for this month',
				detail:
					'The month’s Payroll Run is not finalized, so employee cost is an estimate; Payroll Finalize freezes the recorded allocation.',
				severity: 'warning',
			},
		]);
		expect(october.payroll.estimated_total).toBe(october.totals.total_cost);
		expect(october.payroll.recorded_total).toBe(0);
	});

	it('pays Priya’s October estimate from the raised figure', () => {
		const priya = october.employee_rows.find(
			(row) => row.employee_code === 'EMP004'
		)!;
		expect(priya.cost).toBe(64000);
	});

	it('keeps the August trend month quieter and finalized', () => {
		expect(august.totals.total_cost).toBe(319000);
		expect(august.totals.total_hours).toBe(432);
		expect(august.rows.every((row) => row.cost_status === 'recorded')).toBe(
			true
		);
	});
});

describe('mockCostData', () => {
	it('rejects a malformed month', () => {
		expect(() =>
			mockCostData(
				{ month: '2026-9', finalized: true, hours: MOCK_SEPTEMBER_HOURS },
				MOCK_INPUTS
			)
		).toThrow('Invalid month');
	});

	it('rejects hours for an undeclared employee or project', () => {
		expect(() =>
			mockCostData(
				{
					month: '2026-09',
					finalized: true,
					hours: [{ employee: 'EMP999', project: 'PRJ-201', hours: 8 }],
				},
				MOCK_INPUTS
			)
		).toThrow('Unknown employee');
		expect(() =>
			mockCostData(
				{
					month: '2026-09',
					finalized: true,
					hours: [{ employee: 'EMP001', project: 'PRJ-999', hours: 8 }],
				},
				MOCK_INPUTS
			)
		).toThrow('Unknown project');
	});

	it('rejects non-positive hours', () => {
		expect(() =>
			mockCostData(
				{
					month: '2026-09',
					finalized: true,
					hours: [{ employee: 'EMP001', project: 'PRJ-201', hours: 0 }],
				},
				MOCK_INPUTS
			)
		).toThrow('Mock hours must be positive');
	});

	it('absorbs the rounding cent so shares sum to the stated amount', () => {
		const data = mockCostData(
			{
				month: '2026-09',
				finalized: true,
				// 98000 split 1:1:1 rounds each share up a cent, so the
				// largest-share step absorbs a −2¢ drift.
				hours: [
					{ employee: 'EMP002', project: 'PRJ-201', hours: 10 },
					{ employee: 'EMP002', project: 'PRJ-202', hours: 10 },
					{ employee: 'EMP002', project: 'PRJ-203', hours: 10 },
				],
			},
			MOCK_INPUTS
		);
		const costs = data.rows.map((row) => row.cost);
		expect(costs.reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(98000, 2);
		expect(costs).toEqual([32666.66, 32666.67, 32666.67]);
	});
});

describe('mockFy', () => {
	it('labels the FY matrix Apr–Mar', () => {
		expect(fy.fy_label).toBe('FY 2026–27');
		expect(fy.fy_year).toBe(MOCK_FY_YEAR);
		expect(fy.months).toEqual([
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec',
			'Jan',
			'Feb',
			'Mar',
		]);
		expect(fy.month_keys).toHaveLength(12);
	});

	it('reuses each month’s cells, so FY columns match the monthly views', () => {
		expect(fy.totals.monthly_hours.sep).toBe(september.totals.total_hours);
		expect(fy.totals.monthly_cost.sep).toBe(september.totals.total_cost);
		expect(fy.totals.monthly_hours.oct).toBe(october.totals.total_hours);
		expect(fy.totals.monthly_cost.oct).toBe(october.totals.total_cost);
		expect(fy.totals.monthly_hours.aug).toBe(august.totals.total_hours);
		expect(fy.totals.monthly_cost.aug).toBe(august.totals.total_cost);
	});

	it('foots FY totals to the monthly totals', () => {
		const hours = ['aug', 'sep', 'oct'].reduce(
			(sum, key) => sum + (fy.totals.monthly_hours[key] ?? 0),
			0
		);
		const cost = ['aug', 'sep', 'oct'].reduce(
			(sum, key) => sum + (fy.totals.monthly_cost[key] ?? 0),
			0
		);
		expect(fy.totals.total_hours).toBeCloseTo(hours, 2);
		expect(fy.totals.total_cost).toBeCloseTo(cost, 2);
		expect(fy.summary.total_hours).toBe(fy.totals.total_hours);
		expect(fy.summary.total_cost).toBe(fy.totals.total_cost);
	});

	it('keeps recorded and estimated months apart in the FY split', () => {
		// Aug + Sep finalized, Oct open.
		expect(fy.totals.recorded_cost).toBe(700000);
		expect(fy.totals.estimated_cost).toBe(october.totals.total_cost);
	});

	it('renders empty months as zero, never undefined', () => {
		for (const key of [
			'apr',
			'may',
			'jun',
			'jul',
			'nov',
			'dec',
			'jan',
			'feb',
			'mar',
		]) {
			expect(fy.totals.monthly_hours[key]).toBe(0);
			expect(fy.totals.monthly_cost[key]).toBe(0);
		}
	});

	it('groups one FY row per employee and destination', () => {
		const ananya = fy.rows.filter((row) => row.employee_code === 'EMP001');
		expect(ananya.map((row) => row.project_code).sort()).toEqual([
			'PRJ-201',
			'PRJ-202',
		]);
		expect(ananya[0].sr_no).toBeGreaterThan(0);
	});
});

describe('payroll drilldown', () => {
	it('matches the monthly payload row for row', () => {
		const employees = mockPayrollEmployees(
			{ month: '2026-09', finalized: true, hours: MOCK_SEPTEMBER_HOURS },
			MOCK_INPUTS
		);
		expect(employees).toHaveLength(september.employee_rows.length);
		for (const employee of employees) {
			const payload = september.employee_rows.find(
				(row) => row.employee_id === employee.employee_id
			)!;
			expect(employee.logged_hours).toBe(payload.hours);
			expect(
				employee.shares.reduce((sum, share) => sum + share.amount, 0)
			).toBeCloseTo(payload.cost, 2);
		}
	});

	it('flags the NO-PROJECT share with the shared no-project basis', () => {
		const employees = mockPayrollEmployees(
			{ month: '2026-09', finalized: true, hours: MOCK_SEPTEMBER_HOURS },
			MOCK_INPUTS
		);
		const kabir = employees.find(
			(employee) => employee.employee_code === 'EMP003'
		)!;
		const bucket = kabir.shares.find((share) => share.project_id === null)!;
		expect(bucket.basis).toBe('no_project');
		expect(bucket.hours).toBe(12);
		expect(kabir.no_project_hours).toBe(12);
	});
});

describe('envelopes', () => {
	it('answers the meta probe with the mock months and no matrix', () => {
		expect(mockMeta().latest_month).toBe('2026-10');
		const response = mockMetaResponse();
		expect(response.success).toBe(true);
		expect(response.meta?.months).toEqual(['2026-10', '2026-09', '2026-08']);
		expect(response.meta?.expenditure_months).toEqual([]);
		expect(response.data).toBeUndefined();
	});

	it('answers a month request with the whole monthly payload', () => {
		const response = mockMonthResponse();
		expect(response.success).toBe(true);
		expect(response.view).toBe('monthly');
		expect((response.data as { month?: string } | undefined)?.month).toBe(
			MOCK_MONTH
		);
	});

	it('answers an FY request with the whole matrix', () => {
		const response = mockFyResponse();
		expect(response.success).toBe(true);
		expect(response.view).toBe('fy');
		expect((response.data as { fy_year?: number } | undefined)?.fy_year).toBe(
			MOCK_FY_YEAR
		);
	});

	it('answers the payroll drilldown with totals, employees, and coverage', () => {
		const response = mockPayrollResponse();
		expect(response.data.month).toBe(MOCK_MONTH);
		expect(response.data.month_label).toBe('September 2026');
		expect(response.data.totals.recorded_total).toBe(381000);
		expect(response.data.employees).toHaveLength(4);
		expect(response.data.coverage).toEqual([]);
	});
});

describe('declarations', () => {
	it('holds every hour line against a declared employee and project', () => {
		const employees = new Set(
			MOCK_INPUTS.employees.map((employee) => employee.employee_id)
		);
		const projects = new Set(
			MOCK_INPUTS.projects.map((project) => project.project_code)
		);
		for (const line of [
			...MOCK_SEPTEMBER_HOURS,
			...MOCK_OCTOBER_HOURS,
			...MOCK_AUGUST_HOURS,
		]) {
			expect(employees.has(line.employee)).toBe(true);
			expect(projects.has(line.project)).toBe(true);
			expect(line.hours).toBeGreaterThan(0);
		}
	});
});
