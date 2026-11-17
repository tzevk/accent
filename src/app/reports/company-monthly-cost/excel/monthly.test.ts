import type { CellValue, Row, Worksheet } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildMonthlyWorkbook } from './monthly';
import type {
	CostSalaryEvidence,
	MonthlyCompanyCostData,
	MonthlyEmployeeRow,
	MonthlyProjectRow,
	MonthlyRow,
} from '../types';

function salary(
	overrides: Partial<CostSalaryEvidence> = {}
): CostSalaryEvidence {
	return {
		availability: 'available',
		issue: null,
		profile_id: 1,
		profile_source: 'employee_salary_profile',
		salary_type: 'monthly',
		ctc_source: 'employer_cost',
		conflict_ids: [],
		legacy_fallback: false,
		...overrides,
	};
}

const ambiguousSalary = salary({
	availability: 'ambiguous',
	issue: 'salary_profile_ambiguous',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
	conflict_ids: [7, 8],
});
const canonicalZeroSalary = salary({ profile_id: 2 });
const legacySalary = salary({
	profile_id: 3,
	ctc_source: 'gross_salary',
	legacy_fallback: true,
});
const recordedSalary = salary({
	availability: 'recorded',
	profile_id: null,
	profile_source: null,
	salary_type: null,
	ctc_source: 'none',
});

function costRow(
	overrides: Partial<MonthlyRow> & Pick<MonthlyRow, 'employee_id'>
): MonthlyRow {
	return {
		sr_no: overrides.employee_id,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: 'Engineering',
		designation: 'Engineer',
		project_id: 10,
		project_code: 'PRJ-10',
		project_name: 'Project Ten',
		client_name: 'Client',
		hourly_rate: 100,
		hours: 8,
		cost: 0,
		cost_known: true,
		missing_salary_profile: false,
		in_saved_roster: true,
		worked_outside_finalized_run: false,
		employment_issue: null,
		salary: canonicalZeroSalary,
		...overrides,
	};
}

function employeeRow(
	overrides: Partial<MonthlyEmployeeRow> &
		Pick<MonthlyEmployeeRow, 'employee_id'>
): MonthlyEmployeeRow {
	return {
		sr_no: overrides.employee_id,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: 'Engineering',
		designation: 'Engineer',
		hourly_rate: 100,
		hours: 8,
		cost: 0,
		cost_known: true,
		project_count: 1,
		missing_salary_profile: false,
		in_saved_roster: true,
		worked_outside_finalized_run: false,
		employment_issue: null,
		salary: canonicalZeroSalary,
		...overrides,
	};
}

const rows: MonthlyRow[] = [
	costRow({
		employee_id: 1,
		employee_name: 'Asha Ambiguous',
		cost_known: false,
		missing_salary_profile: true,
		salary: ambiguousSalary,
	}),
	costRow({
		employee_id: 2,
		employee_name: 'Rohan Zero',
		cost: 0,
		salary: canonicalZeroSalary,
	}),
	costRow({
		employee_id: 3,
		employee_name: 'Kabir Legacy',
		cost: 1000,
		salary: legacySalary,
	}),
	costRow({
		employee_id: 4,
		employee_name: 'Priya Recorded',
		cost: 500,
		salary: recordedSalary,
	}),
];

const employeeRows: MonthlyEmployeeRow[] = [
	employeeRow({
		employee_id: 1,
		employee_name: 'Asha Ambiguous',
		cost_known: false,
		missing_salary_profile: true,
		salary: ambiguousSalary,
	}),
	employeeRow({
		employee_id: 2,
		employee_name: 'Rohan Zero',
		cost: 0,
		salary: canonicalZeroSalary,
	}),
	employeeRow({
		employee_id: 3,
		employee_name: 'Kabir Legacy',
		cost: 1000,
		salary: legacySalary,
	}),
	employeeRow({
		employee_id: 4,
		employee_name: 'Priya Recorded',
		cost: 500,
		salary: recordedSalary,
	}),
];

const project: MonthlyProjectRow = {
	sr_no: 1,
	project_id: 10,
	project_code: 'PRJ-10',
	project_name: 'Project Ten',
	client_name: 'Client',
	hours: 32,
	cost: 1500,
	cost_known: true,
	employee_count: 4,
	missing_salary_profile_count: 1,
	salary_availability_counts: {
		recorded: 1,
		not_consulted: 0,
		available: 2,
		missing: 0,
		ambiguous: 1,
		ctc_missing: 0,
		ctc_invalid: 0,
		unavailable: 0,
	},
	unknown_cost_count: 1,
};

const data: MonthlyCompanyCostData = {
	month: '2026-09',
	month_label: 'September 2026',
	fy_label: 'FY 2026–27',
	fy_year: 2026,
	rows,
	employee_rows: employeeRows,
	project_rows: [project],
	payroll: {
		currency: 'INR',
		recorded_total: 1500,
		estimated_total: 0,
		allocated_total: 0,
		unallocated_total: 0,
		estimated_allocated_total: 0,
		estimated_unallocated_total: 0,
		total_logged_hours: 32,
		project_hours: 32,
		no_project_hours: 0,
		rounding_adjustment: 0,
		recorded_count: 2,
		known_zero_count: 1,
		estimated_count: 0,
		missing_slip_count: 0,
		missing_pricing_count: 1,
		allocation_missing_count: 0,
		unpriced_count: 0,
	},
	salary: {
		available_count: 2,
		missing_count: 0,
		ambiguous_count: 1,
		ctc_missing_count: 0,
		ctc_invalid_count: 0,
		unavailable_count: 0,
		legacy_fallback_count: 1,
		recorded_count: 1,
		not_consulted_count: 0,
		complete: false,
	},
	coverage: [],
	totals: {
		total_hours: 32,
		total_cost: 1500,
		blended_rate: 46.88,
		employee_count: 4,
		project_count: 1,
	},
};

function text(value: CellValue): string {
	return value === null || value === undefined ? '' : String(value);
}

function rowFor(ws: Worksheet, employeeName: string): Row {
	for (let index = 1; index <= ws.rowCount; index += 1) {
		if (text(ws.getRow(index).getCell(2).value).includes(employeeName)) {
			return ws.getRow(index);
		}
	}
	throw new Error(`No workbook row for ${employeeName}`);
}

describe('monthly company cost workbook salary disclosure', () => {
	it('distinguishes unavailable salary, canonical zero, legacy basis and recorded cost', () => {
		const wb = buildMonthlyWorkbook(data);
		const detailed = wb.getWorksheet('Detailed');
		expect(detailed).toBeDefined();
		if (!detailed) return;

		const ambiguous = rowFor(detailed, 'Asha Ambiguous');
		expect(text(ambiguous.getCell(2).value)).toContain(
			'Unpriced · Several Salary Profiles cover this month (#7, #8)'
		);
		expect(ambiguous.getCell(8).value).toBe('—');

		const zero = rowFor(detailed, 'Rohan Zero');
		expect(text(zero.getCell(2).value)).toContain(
			'Confirmed zero · explicit employer-cost CTC'
		);
		expect(zero.getCell(8).value).toBe(0);

		const legacy = rowFor(detailed, 'Kabir Legacy');
		expect(text(legacy.getCell(2).value)).toContain(
			'Legacy gross basis — not agreed CTC'
		);
		expect(legacy.getCell(8).value).toBe(1000);

		const recorded = rowFor(detailed, 'Priya Recorded');
		expect(text(recorded.getCell(2).value)).toContain(
			'Recorded · frozen allocation'
		);
		expect(recorded.getCell(8).value).toBe(500);

		expect(text(detailed.getCell(2, 1).value)).toContain('Salary basis');
		expect(text(detailed.getCell(2, 1).value)).toContain(
			'Ambiguous Salary Profiles: 1'
		);
		expect(text(detailed.getCell(2, 1).value)).toContain(
			'Legacy gross basis (not agreed CTC): 1'
		);
		expect(text(detailed.getCell(2, 1).value)).toContain(
			'Recorded from frozen allocations: 1'
		);
		expect(text(detailed.getRow(detailed.rowCount).getCell(1).value)).toContain(
			'partial'
		);
	});

	it('keeps the same distinctions on the By Employee sheet', () => {
		const wb = buildMonthlyWorkbook(data);
		const sheet = wb.getWorksheet('By Employee');
		expect(sheet).toBeDefined();
		if (!sheet) return;

		expect(text(rowFor(sheet, 'Asha Ambiguous').getCell(2).value)).toContain(
			'Unpriced · Several Salary Profiles cover this month (#7, #8)'
		);
		expect(text(rowFor(sheet, 'Rohan Zero').getCell(2).value)).toContain(
			'Confirmed zero · explicit employer-cost CTC'
		);
		expect(text(rowFor(sheet, 'Kabir Legacy').getCell(2).value)).toContain(
			'Legacy gross basis — not agreed CTC'
		);
		expect(text(sheet.getCell(2, 1).value)).toContain('Salary basis');
	});

	it('states project salary counts and the derived legacy basis on By Project', () => {
		const wb = buildMonthlyWorkbook(data);
		const sheet = wb.getWorksheet('By Project');
		expect(sheet).toBeDefined();
		if (!sheet) return;

		const projectRow = rowFor(sheet, 'PRJ-10');
		const projectCell = text(projectRow.getCell(2).value);
		expect(projectCell).toContain('Ambiguous Salary Profiles: 1');
		expect(projectCell).toContain('Legacy gross basis (not agreed CTC): 1');
		expect(projectCell).not.toContain('missing Salary Profile');
		expect(text(sheet.getCell(2, 1).value)).toContain('Salary basis');
		expect(text(sheet.getRow(sheet.rowCount).getCell(1).value)).toContain(
			'partial'
		);
	});
});
