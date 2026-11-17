import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type {
	AnnualBillingData,
	AnnualEmployeeRow,
	BillingData,
	BillingEmployeeRow,
	ReportSalaryEvidence,
	ReportSalarySummary,
} from './data-source';
import { buildAnnualWorkbook, buildWorkbook } from './excel-template';

const FY_MONTH_KEYS = [
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec',
	'jan',
	'feb',
	'mar',
];

function evidence(
	overrides: Partial<ReportSalaryEvidence> = {}
): ReportSalaryEvidence {
	return {
		availability: 'available',
		anchor: '2026-04-01',
		profile_id: 11,
		profile_source: 'employee_salary_profile',
		salary_type: 'monthly',
		ctc_source: 'employer_cost',
		legacy_fallback: false,
		conflict_ids: [],
		...overrides,
	};
}

function summary(
	overrides: Partial<ReportSalarySummary> = {}
): ReportSalarySummary {
	return {
		available_count: 0,
		missing_count: 0,
		ambiguous_count: 0,
		ctc_missing_count: 0,
		ctc_invalid_count: 0,
		legacy_fallback_count: 0,
		unpriced_count: 0,
		complete: true,
		...overrides,
	};
}

function billingRow(
	overrides: Partial<BillingEmployeeRow> = {}
): BillingEmployeeRow {
	return {
		sr_no: 1,
		employee_id: 1,
		employee_code: 'EMP-1',
		employee_name: 'Employee One',
		designation: 'Engineer',
		employee_charges: 96.15,
		total_manhours: 10,
		amount: 961.5,
		tds_rate: 10,
		tds: 96.15,
		net_payable: 865.35,
		accent_charges: 100,
		accent_amount: 1000,
		pnl_after_deductions: 134.65,
		pnl_tds: 38.5,
		pricing_source: 'salary',
		salary: evidence(),
		...overrides,
	};
}

function monthlyData(
	rows: BillingEmployeeRow[],
	salary: ReportSalarySummary
): BillingData {
	return {
		client_name: 'Acme',
		project: {
			project_id: 1,
			project_code: 'P-1',
			project_name: 'Project One',
		},
		month: '2026-09',
		month_label: 'September 2026',
		year: 2026,
		rows,
		totals: {
			total_manhours: rows.reduce((sum, row) => sum + row.total_manhours, 0),
			total_amount: rows.reduce((sum, row) => sum + row.amount, 0),
			total_tds: rows.reduce((sum, row) => sum + row.tds, 0),
			total_net_payable: rows.reduce((sum, row) => sum + row.net_payable, 0),
			total_accent_amount: rows.reduce(
				(sum, row) => sum + row.accent_amount,
				0
			),
			total_pnl_after_deductions: rows.reduce(
				(sum, row) => sum + row.pnl_after_deductions,
				0
			),
			total_pnl_tds: rows.reduce((sum, row) => sum + row.pnl_tds, 0),
			salary,
		},
	};
}

function zeroMonths(): Record<string, number> {
	return Object.fromEntries(FY_MONTH_KEYS.map((key) => [key, 0]));
}

function annualRow(
	overrides: Partial<AnnualEmployeeRow> = {}
): AnnualEmployeeRow {
	return {
		sr_no: 1,
		id: 1,
		employee_id: 1,
		employee_code: 'EMP-1',
		employee_name: 'Employee One',
		designation: 'Engineer',
		salary_type: 'monthly',
		rate_employee: 86.54,
		rate_client: 100,
		monthly_hours: zeroMonths(),
		total_hours: 0,
		monthly_rates: {},
		monthly_company_cost: {},
		salary_months: {},
		company_cost: 0,
		accent_cost: 0,
		pnl: 0,
		...overrides,
	};
}

function annualData(
	rows: AnnualEmployeeRow[],
	salary: ReportSalarySummary
): AnnualBillingData {
	const monthlyHours = zeroMonths();
	for (const row of rows) {
		for (const key of FY_MONTH_KEYS) {
			monthlyHours[key] += row.monthly_hours[key] ?? 0;
		}
	}
	return {
		client_name: 'Acme',
		project: {
			project_id: 1,
			project_code: 'P-1',
			project_name: 'Project One',
		},
		fy_label: 'FY 2026-27',
		fy_year: 2026,
		months: [
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
		],
		month_keys: FY_MONTH_KEYS,
		rows,
		totals: {
			monthly_hours: monthlyHours,
			total_hours: rows.reduce((sum, row) => sum + row.total_hours, 0),
			total_company_cost: rows.reduce((sum, row) => sum + row.company_cost, 0),
			total_accent_cost: rows.reduce((sum, row) => sum + row.accent_cost, 0),
			total_pnl: rows.reduce((sum, row) => sum + row.pnl, 0),
			salary,
		},
	};
}

function sheetText(ws: ExcelJS.Worksheet): string {
	const values: string[] = [];
	ws.eachRow((row) => {
		row.eachCell((cell) => {
			if (cell.value !== null && cell.value !== undefined) {
				values.push(String(cell.value));
			}
		});
	});
	return values.join(' | ');
}

describe('manhours billing workbook salary disclosure', () => {
	it('writes Unknown money for an unpriced row and labels the partial total', () => {
		const workbook = buildWorkbook(
			monthlyData(
				[
					billingRow(),
					billingRow({
						sr_no: 2,
						employee_id: 2,
						employee_code: 'EMP-2',
						employee_name: 'Employee Two',
						employee_charges: 0,
						amount: 0,
						tds: 0,
						net_payable: 0,
						pnl_after_deductions: 1000,
						pnl_tds: 1000,
						pricing_source: 'unavailable',
						salary: evidence({
							availability: 'missing',
							profile_id: null,
							ctc_source: 'none',
						}),
					}),
					billingRow({
						sr_no: 3,
						employee_id: 3,
						employee_code: 'EMP-3',
						employee_name: 'Employee Three',
						employee_charges: 50,
						amount: 500,
						tds: 50,
						net_payable: 450,
						pnl_after_deductions: 550,
						pnl_tds: 500,
						pricing_source: 'project',
						salary: evidence({
							availability: 'missing',
							profile_id: null,
							ctc_source: 'none',
						}),
					}),
				],
				summary({
					available_count: 1,
					missing_count: 2,
					unpriced_count: 1,
					complete: false,
				})
			)
		);
		const ws = workbook.getWorksheet('Manhours Billing');
		if (!ws) throw new Error('Missing Manhours Billing worksheet');

		// Row 8 is the unpriceable row: its money is Unknown, not a ₹0 price.
		expect(ws.getCell('E8').value).toBe('Unknown');
		expect(ws.getCell('F8').value).toBe('Unknown');
		expect(ws.getCell('G8').value).toBe('Unknown');
		expect(ws.getCell('H8').value).toBe('Unknown');
		expect(ws.getCell('K8').value).toBe('Unknown');
		expect(ws.getCell('L8').value).toBe('Unknown');
		// The recorded client charge survives beside the unknown salary cost.
		expect(ws.getCell('J8').value).toBe(1000);
		// A recorded project rate still prices its row.
		expect(ws.getCell('F9').value).toBe(500);

		expect(String(ws.getCell('A10').value)).toContain('partial');
		expect(String(ws.getCell('A10').value)).toContain('1 unpriced');
		const notes = sheetText(ws);
		expect(notes).toContain('Unknown');
		expect(notes).toContain('no Salary Profile covers the month');
		expect(notes).toContain('available: 1');
		expect(notes).toContain('missing: 2');
		expect(notes).toContain('recorded project rate');
	});

	it('keeps an explicit canonical zero as a confirmed price', () => {
		const workbook = buildWorkbook(
			monthlyData(
				[
					billingRow({
						employee_charges: 0,
						amount: 0,
						tds: 0,
						net_payable: 0,
						pnl_after_deductions: 1000,
						pnl_tds: 1000,
					}),
				],
				summary({ available_count: 1 })
			)
		);
		const ws = workbook.getWorksheet('Manhours Billing');
		if (!ws) throw new Error('Missing Manhours Billing worksheet');

		expect(ws.getCell('F7').value).toBe(0);
		expect(String(ws.getCell('A8').value)).not.toContain('partial');
		expect(sheetText(ws)).not.toContain('Unknown');
	});
});

describe('annual deputation workbook salary disclosure', () => {
	it('keeps the month-map company cost and discloses each unpriced month', () => {
		const octoberHours = zeroMonths();
		octoberHours.apr = 10;
		octoberHours.oct = 10;
		const mayHours = zeroMonths();
		mayHours.may = 10;

		const workbook = buildAnnualWorkbook(
			annualData(
				[
					annualRow({
						monthly_hours: octoberHours,
						total_hours: 20,
						monthly_company_cost: { apr: 865.4, oct: null },
						monthly_rates: { apr: 86.54 },
						salary_months: {
							apr: evidence(),
							oct: evidence({
								availability: 'missing',
								profile_id: null,
								ctc_source: 'none',
							}),
						},
						company_cost: 865.4,
						accent_cost: 2000,
						pnl: 1134.6,
					}),
					annualRow({
						sr_no: 2,
						id: 2,
						employee_id: 2,
						employee_code: 'EMP-2',
						employee_name: 'Employee Two',
						rate_employee: 50,
						monthly_hours: mayHours,
						total_hours: 10,
						monthly_company_cost: { may: 500 },
						monthly_rates: { may: 50 },
						salary_months: {
							may: evidence({
								ctc_source: 'gross_salary',
								legacy_fallback: true,
							}),
						},
						company_cost: 500,
						accent_cost: 1000,
						pnl: 500,
					}),
				],
				summary({
					available_count: 2,
					missing_count: 1,
					legacy_fallback_count: 1,
					unpriced_count: 1,
					complete: false,
				})
			)
		);
		const ws = workbook.getWorksheet('Deputation Summary');
		if (!ws) throw new Error('Missing Deputation Summary worksheet');

		// The payload's month-map cost is preserved, not recomputed from a rate.
		expect(ws.getCell('S6').value).toBe(865.4);
		expect(String(ws.getCell('A8').value)).toContain('partial');
		expect(String(ws.getCell('A8').value)).toContain('1 unpriced');
		const notes = sheetText(ws);
		expect(notes).toContain('Oct');
		expect(notes).toContain('no Salary Profile covers the month');
		expect(notes).toContain('legacy gross basis');
		expect(notes).toContain('available: 2');
		expect(notes).toContain('missing: 1');
	});
});
