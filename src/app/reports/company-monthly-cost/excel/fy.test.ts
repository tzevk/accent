import type { CellValue, Row, Worksheet } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildFYWorkbook } from './fy';
import type { FYCompanyCostData, FYCompanyRow } from '../types';

function fyRow(
	overrides: Partial<FYCompanyRow> & Pick<FYCompanyRow, 'employee_id'>
): FYCompanyRow {
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
		monthly_cost_known: { apr: true },
		monthly_hours: { apr: 8 },
		monthly_cost: { apr: 0 },
		total_hours: 8,
		total_cost: 0,
		cost_known: true,
		worked_outside_finalized_run: false,
		in_saved_roster: true,
		employment_issue: null,
		...overrides,
	};
}

const data: FYCompanyCostData = {
	fy_label: 'FY 2026–27',
	fy_year: 2026,
	months: ['Apr'],
	month_keys: ['apr'],
	rows: [
		fyRow({ employee_id: 1, employee_name: 'Known Zero' }),
		fyRow({
			employee_id: 2,
			employee_name: 'Unknown Zero',
			monthly_cost_known: { apr: false },
			monthly_cost: { apr: 0 },
			total_cost: 0,
			cost_known: false,
		}),
		fyRow({
			employee_id: 3,
			employee_name: 'Unknown Part',
			monthly_cost_known: { apr: false },
			monthly_cost: { apr: 250 },
			total_cost: 250,
			cost_known: false,
		}),
	],
	employee_rows: [],
	project_rows: [],
	totals: {
		monthly_cost_known: { apr: false },
		monthly_hours: { apr: 24 },
		monthly_cost: { apr: 250 },
		total_hours: 24,
		total_cost: 250,
		cost_known: false,
		blended_rate: 10.42,
	},
	summary: {
		total_hours: 24,
		total_cost: 250,
		cost_known: false,
		blended_rate: 10.42,
		employee_count: 3,
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

describe('FY company cost workbook unknown and known cost', () => {
	it('keeps unknown months as an em dash and states a known zero instead of hiding it', () => {
		const wb = buildFYWorkbook(data);
		const sheet = wb.getWorksheet('Detailed Cost');
		expect(sheet).toBeDefined();
		if (!sheet) return;

		const knownZero = rowFor(sheet, 'Known Zero');
		expect(knownZero.getCell(6).value).toBe(0);
		expect(knownZero.getCell(8).value).toBe(0);

		const unknownZero = rowFor(sheet, 'Unknown Zero');
		expect(unknownZero.getCell(6).value).toBe('—');
		expect(unknownZero.getCell(8).value).toBe('—');

		const unknownPart = rowFor(sheet, 'Unknown Part');
		expect(unknownPart.getCell(6).value).toBe('250.00 *');
		expect(text(unknownPart.getCell(2).value)).toContain(
			'cost unavailable for this month (unknown, not zero)'
		);

		expect(text(sheet.getCell(2, 1).value)).toContain(
			'unknown months are excluded from partial totals'
		);
		expect(text(sheet.getRow(sheet.rowCount).getCell(1).value)).toContain(
			'partial'
		);
	});
});
