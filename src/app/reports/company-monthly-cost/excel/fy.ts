/**
 * Server-side Excel workbook builder for the Company Monthly Cost report.
 *
 * New company-wide views:
 * - FY (Apr–Mar): 4 sheets
 *   1. "Detailed Hours" — per employee-project FY hours matrix
 *   2. "Detailed Cost"  — per employee-project FY cost matrix
 *   3. "By Employee"    — per employee FY hours+cost matrix
 *   4. "By Project"     — per project FY hours+cost matrix
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { FYCompanyCostData } from '../employee-cost-data-source';
import {
	TINT_YELLOW,
	TINT_BLUE,
	TINT_AMBER_LIGHT,
	TINT_PURPLE_LIGHT,
	TINT_GREEN,
	TINT_EMP,
	setFill,
	setFont,
	box,
	sanitizeName,
	type Metric,
} from './theme';

export function fileBaseForFYExcel(data: FYCompanyCostData): string {
	const fy = sanitizeName(data.fy_label || `FY_${data.fy_year}`);
	return `Company_Cost_${fy}.xlsx`;
}

// ─── FY company workbook ──────────────────────────────────────────

function buildFYMetricSheet(
	wb: ExcelJS.Workbook,
	data: FYCompanyCostData,
	metric: Metric,
	rows:
		| FYCompanyCostData['rows']
		| FYCompanyCostData['employee_rows']
		| FYCompanyCostData['project_rows'],
	sheetName: string,
	options: {
		includeEmployee?: boolean;
		includeProject?: boolean;
		employeeColWidth?: number;
		projectColWidth?: number;
	}
): void {
	const isCost = metric === 'cost';
	const ws = wb.addWorksheet(sheetName, {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
			margins: {
				left: 0.35,
				right: 0.35,
				top: 0.45,
				bottom: 0.45,
				header: 0.2,
				footer: 0.2,
			},
		},
	});

	// Build columns dynamically
	const cols: Array<{ width: number }> = [{ width: 7 }]; // Sr
	if (options.includeEmployee)
		cols.push({ width: options.employeeColWidth ?? 24 });
	if (options.includeProject)
		cols.push({ width: options.projectColWidth ?? 28 });
	if (options.includeEmployee && options.includeProject) {
		// when both, we have separate cols for employee and project; else handled above
	}
	// For detailed (both), we already added employee+project, but need to handle rate column
	const hasRate =
		rows.length > 0 &&
		'hourly_rate' in (rows[0] as unknown as Record<string, unknown>);
	if (hasRate) cols.push({ width: 11 });
	// Client column for project-including sheets
	if (options.includeProject) cols.push({ width: 16 });
	// Monthly columns
	for (let i = 0; i < data.month_keys.length; i++) cols.push({ width: 10 });
	cols.push({ width: 11 }); // Total Hrs
	cols.push({ width: 14 }); // Total Cost

	ws.columns = cols.map((c) => ({ width: c.width }));

	const totalCols = cols.length;
	ws.mergeCells(1, 1, 1, totalCols);
	const title = ws.getCell(1, 1);
	title.value = `${sheetName} — ${data.fy_label}`;
	setFont(title, { bold: true, size: 12 });
	title.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 20;

	ws.mergeCells(2, 1, 2, totalCols);
	const sub = ws.getCell(2, 1);
	sub.value = `${isCost ? 'Monthly cost' : 'Monthly hours'} · ${data.fy_label} · ${data.summary.employee_count} employees · ${data.summary.project_count} projects · Generated ${new Date().toLocaleDateString('en-IN')}`;
	setFont(sub, { size: 9, color: 'FF6B7280' });
	sub.alignment = { vertical: 'middle', horizontal: 'left' };

	const headerRow = ws.getRow(3);
	headerRow.height = 22;
	let colIdx = 1;
	const addHeader = (
		label: string,
		tint: string,
		align: 'left' | 'center' | 'right' = 'center'
	) => {
		const c = headerRow.getCell(colIdx++);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, tint);
		c.alignment = { vertical: 'middle', horizontal: align };
		box(c);
	};
	addHeader('Sr.', TINT_YELLOW, 'center');
	if (options.includeEmployee) addHeader('Employee', TINT_EMP, 'left');
	if (options.includeProject) addHeader('Project', TINT_YELLOW, 'left');
	if (hasRate) addHeader('Rate/Hr', TINT_BLUE, 'right');
	if (options.includeProject) addHeader('Client', TINT_BLUE, 'left');
	for (const m of data.months) addHeader(m, TINT_AMBER_LIGHT, 'right');
	addHeader('Total Hrs', TINT_PURPLE_LIGHT, 'right');
	addHeader('Total Cost', TINT_GREEN, 'right');

	let rn = 4;
	for (const r of rows as unknown as Array<Record<string, unknown>>) {
		const row = ws.getRow(rn);
		row.height = 18;
		colIdx = 1;
		const make = (
			val: string | number,
			tint: string,
			align: 'left' | 'center' | 'right',
			numFmt?: string,
			bold?: boolean
		) => {
			const c = row.getCell(colIdx++);
			c.value = val;
			setFont(c, { bold: bold ?? false, size: 9 });
			setFill(c, tint);
			c.alignment = { vertical: 'middle', horizontal: align };
			if (numFmt) c.numFmt = numFmt;
			box(c);
		};
		make(r.sr_no as number, TINT_YELLOW, 'center');
		if (options.includeEmployee) {
			const empName = (r.employee_name as string) || '';
			const empCode =
				(r.employee_code as string) || String(r.employee_id ?? '');
			make(`${empName} (${empCode})`, TINT_EMP, 'left');
		}
		if (options.includeProject) {
			const proj =
				[r.project_code as string, r.project_name as string]
					.filter(Boolean)
					.join(' – ') || '—';
			make(proj, TINT_YELLOW, 'left');
		}
		if (hasRate) {
			make((r.hourly_rate as number) ?? 0, TINT_BLUE, 'right', '#,##0.00');
		}
		if (options.includeProject) {
			make((r.client_name as string) || '—', TINT_BLUE, 'left');
		}
		for (const mKey of data.month_keys) {
			const v =
				(isCost
					? (r.monthly_cost as Record<string, number>)?.[mKey]
					: (r.monthly_hours as Record<string, number>)?.[mKey]) || 0;
			make(v, TINT_AMBER_LIGHT, 'right', isCost ? '#,##0.00' : '#,##0.##');
		}
		make(
			(r.total_hours as number) ?? 0,
			TINT_PURPLE_LIGHT,
			'right',
			'#,##0.##',
			true
		);
		make((r.total_cost as number) ?? 0, TINT_GREEN, 'right', '#,##0.00', true);
		rn++;
	}

	// Totals row
	const tr = ws.getRow(rn);
	tr.height = 20;
	// Merge label across first columns up to before monthly cols
	const labelCols =
		(options.includeEmployee ? 1 : 0) +
		(options.includeProject ? 1 : 0) +
		(hasRate ? 1 : 0) +
		(options.includeProject ? 1 : 0) +
		1; // Sr + emp + proj + rate + client
	ws.mergeCells(rn, 1, rn, labelCols);
	const lbl = tr.getCell(1);
	lbl.value = 'Grand Total — Company';
	setFont(lbl, { bold: true, size: 9.5 });
	lbl.alignment = { vertical: 'middle', horizontal: 'right' };
	for (let c = 1; c <= labelCols; c++) box(tr.getCell(c));

	// monthly totals
	for (let i = 0; i < data.month_keys.length; i++) {
		const mKey = data.month_keys[i];
		const c = tr.getCell(labelCols + 1 + i);
		c.value =
			(isCost
				? data.totals.monthly_cost[mKey]
				: data.totals.monthly_hours[mKey]) || 0;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_AMBER_LIGHT);
		c.alignment = { vertical: 'middle', horizontal: 'right' };
		c.numFmt = isCost ? '#,##0.00' : '#,##0.##';
		box(c);
	}
	const th = tr.getCell(labelCols + 1 + data.month_keys.length);
	th.value = data.totals.total_hours;
	setFont(th, { bold: true, size: 9.5 });
	setFill(th, TINT_PURPLE_LIGHT);
	th.alignment = { vertical: 'middle', horizontal: 'right' };
	th.numFmt = '#,##0.##';
	box(th);
	const tc = tr.getCell(labelCols + 2 + data.month_keys.length);
	tc.value = data.totals.total_cost;
	setFont(tc, { bold: true, size: 9.5 });
	setFill(tc, TINT_GREEN);
	tc.alignment = { vertical: 'middle', horizontal: 'right' };
	tc.numFmt = '#,##0.00';
	box(tc);

	ws.views = [{ state: 'frozen', ySplit: 3 }];
}

export function buildFYWorkbook(data: FYCompanyCostData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	// Detailed per employee-project: Hours and Cost as separate sheets
	buildFYMetricSheet(wb, data, 'hours', data.rows, 'Detailed Hours', {
		includeEmployee: true,
		includeProject: true,
	});
	buildFYMetricSheet(wb, data, 'cost', data.rows, 'Detailed Cost', {
		includeEmployee: true,
		includeProject: true,
	});
	// By Employee aggregated
	buildFYMetricSheet(
		wb,
		data,
		'hours',
		data.employee_rows,
		'By Employee - Hours',
		{
			includeEmployee: true,
			includeProject: false,
			employeeColWidth: 32,
		}
	);
	buildFYMetricSheet(
		wb,
		data,
		'cost',
		data.employee_rows,
		'By Employee - Cost',
		{
			includeEmployee: true,
			includeProject: false,
			employeeColWidth: 32,
		}
	);
	// By Project aggregated
	buildFYMetricSheet(
		wb,
		data,
		'hours',
		data.project_rows,
		'By Project - Hours',
		{
			includeEmployee: false,
			includeProject: true,
			projectColWidth: 34,
		}
	);
	buildFYMetricSheet(wb, data, 'cost', data.project_rows, 'By Project - Cost', {
		includeEmployee: false,
		includeProject: true,
		projectColWidth: 34,
	});

	return wb;
}

export async function buildFYWorkbookBuffer(
	data: FYCompanyCostData
): Promise<Buffer> {
	const wb = buildFYWorkbook(data);
	const ab = await wb.xlsx.writeBuffer();
	return Buffer.from(ab);
}
