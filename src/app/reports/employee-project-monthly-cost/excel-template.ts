/**
 * Server-side Excel workbook builder for the Employee Project Monthly Cost report.
 *
 * Legacy: two sheets sharing same row order for per-employee FY view:
 *   1. "Monthly Hours" — Apr–Mar hours matrix per project
 *   2. "Monthly Cost"  — Apr–Mar payroll cost matrix per project
 *
 * New company-wide views:
 * - Monthly (YYYY-MM): 3 sheets
 *   1. "Detailed" — per employee-project hours & cost for that month
 *   2. "By Employee" — per employee totals for that month
 *   3. "By Project" — per project totals for that month
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
import type {
	EmployeeProjectCostData,
	MonthlyCompanyCostData,
	FYCompanyCostData,
} from './data-source';
import type {
	CompanyReconciliation,
	ClosePayload,
	RevisionPayload,
} from '@/lib/company-expenditure';

const TINT_YELLOW = 'FFFFE598'; // Sr. No. | Project
const TINT_BLUE = 'FFDCE2F2'; // Rate/Hr | Client
const TINT_AMBER_LIGHT = 'FFFFF2CC'; // Monthly cells Apr–Mar
const TINT_PURPLE_LIGHT = 'FFE1D5E7'; // Total hours column
const TINT_GREEN = 'FFC6DFB4'; // Cost totals
const TINT_EMP = 'FFFEF3C7'; // Employee columns
const TINT_PROJ = 'FFE0E7FF'; // Project columns

const GRAY_BORDER = 'FFD1D5DB';

function setFill(cell: ExcelJS.Cell, argb: string): void {
	cell.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb },
	};
}

function setFont(
	cell: ExcelJS.Cell,
	{
		bold = false,
		size = 10,
		color = 'FF111827',
	}: { bold?: boolean; size?: number; color?: string } = {}
): void {
	cell.font = { name: 'Calibri', bold, size, color: { argb: color } };
}

function box(cell: ExcelJS.Cell): void {
	const b: ExcelJS.Border = { style: 'thin', color: { argb: GRAY_BORDER } };
	cell.border = { top: b, left: b, bottom: b, right: b };
}

function sanitizeName(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_');
}

export function fileBaseForExcel(data: EmployeeProjectCostData): string {
	const e = sanitizeName(
		data.employee?.name || `Employee_${data.employee?.id ?? 'unknown'}`
	);
	const fy = sanitizeName(data.fy_label || `FY_${data.fy_year}`);
	return `Employee_Project_Cost_${e}_${fy}.xlsx`;
}

export function fileBaseForMonthlyExcel(data: MonthlyCompanyCostData): string {
	const m = sanitizeName(data.month);
	return `Company_Cost_Monthly_${m}.xlsx`;
}

export function fileBaseForFYExcel(data: FYCompanyCostData): string {
	const fy = sanitizeName(data.fy_label || `FY_${data.fy_year}`);
	return `Company_Cost_${fy}.xlsx`;
}

type Metric = 'hours' | 'cost';

function buildMetricSheet(
	wb: ExcelJS.Workbook,
	data: EmployeeProjectCostData,
	metric: Metric
): void {
	const isCost = metric === 'cost';
	const ws = wb.addWorksheet(isCost ? 'Monthly Cost' : 'Monthly Hours', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9, // A4
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

	ws.columns = [
		{ key: 'sr_no', width: 7 },
		{ key: 'project', width: 34 },
		{ key: 'client_name', width: 20 },
		{ key: 'hourly_rate', width: 12 },
		...data.month_keys.map(() => ({ width: 10 })),
		{ key: 'total_hours', width: 11 },
		{ key: 'total_cost', width: 15 },
	];

	// Title rows
	ws.mergeCells(1, 1, 1, 4 + data.month_keys.length + 2);
	const titleCell = ws.getCell(1, 1);
	titleCell.value = `Employee Project Cost — ${data.employee?.name || ''}${
		data.employee?.employee_id ? ` (${data.employee.employee_id})` : ''
	}`;
	setFont(titleCell, { bold: true, size: 13 });
	titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 22;

	ws.mergeCells(2, 1, 2, 4 + data.month_keys.length + 2);
	const subtitleCell = ws.getCell(2, 1);
	subtitleCell.value = `${isCost ? 'Monthly cost' : 'Manhours by month'} · ${data.fy_label} · Generated ${new Date().toLocaleDateString('en-IN')}`;
	setFont(subtitleCell, { size: 10, color: 'FF6B7280' });
	subtitleCell.alignment = { vertical: 'middle', horizontal: 'left' };

	// Header row (Row 3)
	const headerRow = ws.getRow(3);
	headerRow.height = 22;
	const headers: Array<{
		col: number;
		label: string;
		align: 'left' | 'center' | 'right';
		tint: string;
	}> = [
		{ col: 1, label: 'Sr. No.', align: 'center', tint: TINT_YELLOW },
		{ col: 2, label: 'Project', align: 'left', tint: TINT_YELLOW },
		{ col: 3, label: 'Client', align: 'left', tint: TINT_BLUE },
		{
			col: 4,
			label: isCost ? 'Rate/Hr (₹)' : 'Rate/Hr',
			align: 'right',
			tint: TINT_BLUE,
		},
		...data.months.map((m, i) => ({
			col: 5 + i,
			label: m,
			align: 'right' as const,
			tint: TINT_AMBER_LIGHT,
		})),
		{
			col: 5 + data.month_keys.length,
			label: 'Total Hrs',
			align: 'right',
			tint: TINT_PURPLE_LIGHT,
		},
		{
			col: 6 + data.month_keys.length,
			label: 'Total Cost (₹)',
			align: 'right',
			tint: TINT_GREEN,
		},
	];
	for (const h of headers) {
		const cell = headerRow.getCell(h.col);
		cell.value = h.label;
		setFont(cell, { bold: true, size: 9.5 });
		setFill(cell, h.tint);
		cell.alignment = { vertical: 'middle', horizontal: h.align };
		box(cell);
	}

	// Data rows
	let rowNum = 4;
	for (const r of data.rows) {
		const row = ws.getRow(rowNum);
		row.height = 18;

		const cellValues: Array<{
			val: number | string;
			align: 'left' | 'center' | 'right';
			numFmt?: string;
			tint: string;
			bold?: boolean;
		}> = [
			{ val: r.sr_no, align: 'center', tint: TINT_YELLOW },
			{
				val: [r.project_code, r.project_name].filter(Boolean).join(' – '),
				align: 'left',
				tint: TINT_YELLOW,
			},
			{ val: r.client_name || '—', align: 'left', tint: TINT_BLUE },
			{
				val: r.hourly_rate,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
			},
			...data.month_keys.map((mKey) => ({
				val: (isCost ? r.monthly_cost : r.monthly_hours)?.[mKey] || 0,
				align: 'right' as const,
				numFmt: isCost ? '#,##0.00' : '#,##0.##',
				tint: TINT_AMBER_LIGHT,
			})),
			{
				val: r.total_hours,
				align: 'right',
				numFmt: '#,##0.##',
				tint: TINT_PURPLE_LIGHT,
				bold: true,
			},
			{
				val: r.total_cost,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_GREEN,
				bold: true,
			},
		];

		cellValues.forEach((v, idx) => {
			const cell = row.getCell(idx + 1);
			cell.value = v.val;
			setFont(cell, { bold: v.bold ?? false, size: 9.5 });
			setFill(cell, v.tint);
			cell.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt) cell.numFmt = v.numFmt;
			box(cell);
		});

		rowNum++;
	}

	// Grand total row
	const totalRow = ws.getRow(rowNum);
	totalRow.height = 20;
	ws.mergeCells(rowNum, 1, rowNum, 4);
	const totalLabel = totalRow.getCell(1);
	totalLabel.value = 'Grand Total';
	setFont(totalLabel, { bold: true, size: 10 });
	totalLabel.alignment = { vertical: 'middle', horizontal: 'right' };
	for (let c = 1; c <= 4; c++) box(totalRow.getCell(c));

	data.month_keys.forEach((mKey, idx) => {
		const cell = totalRow.getCell(5 + idx);
		cell.value =
			(isCost ? data.totals.monthly_cost : data.totals.monthly_hours)?.[mKey] ||
			0;
		setFont(cell, { bold: true, size: 9.5 });
		setFill(cell, TINT_AMBER_LIGHT);
		cell.alignment = { vertical: 'middle', horizontal: 'right' };
		cell.numFmt = isCost ? '#,##0.00' : '#,##0.##';
		box(cell);
	});

	const totalHoursCell = totalRow.getCell(5 + data.month_keys.length);
	totalHoursCell.value = data.totals.total_hours;
	setFont(totalHoursCell, { bold: true, size: 10 });
	setFill(totalHoursCell, TINT_PURPLE_LIGHT);
	totalHoursCell.alignment = { vertical: 'middle', horizontal: 'right' };
	totalHoursCell.numFmt = '#,##0.##';
	box(totalHoursCell);

	const totalCostCell = totalRow.getCell(6 + data.month_keys.length);
	totalCostCell.value = data.totals.total_cost;
	setFont(totalCostCell, { bold: true, size: 10 });
	setFill(totalCostCell, TINT_GREEN);
	totalCostCell.alignment = { vertical: 'middle', horizontal: 'right' };
	totalCostCell.numFmt = '#,##0.00';
	box(totalCostCell);

	ws.views = [{ state: 'frozen', ySplit: 3 }];
}

export function buildWorkbook(data: EmployeeProjectCostData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();
	buildMetricSheet(wb, data, 'hours');
	buildMetricSheet(wb, data, 'cost');
	return wb;
}

export async function buildWorkbookBuffer(
	data: EmployeeProjectCostData
): Promise<Buffer> {
	const wb = buildWorkbook(data);
	const arrayBuffer = await wb.xlsx.writeBuffer();
	return Buffer.from(arrayBuffer);
}

// ─── New monthly company workbook ──────────────────────────────────

function buildMonthlyDetailedSheet(
	wb: ExcelJS.Workbook,
	data: MonthlyCompanyCostData
): void {
	const ws = wb.addWorksheet('Detailed', {
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

	ws.columns = [
		{ key: 'sr', width: 7 },
		{ key: 'employee', width: 28 },
		{ key: 'dept', width: 16 },
		{ key: 'project', width: 30 },
		{ key: 'client', width: 18 },
		{ key: 'rate', width: 12 },
		{ key: 'hours', width: 12 },
		{ key: 'cost', width: 15 },
	];

	ws.mergeCells(1, 1, 1, 8);
	const title = ws.getCell(1, 1);
	title.value = `Company Cost — ${data.month_label} (${data.fy_label})`;
	setFont(title, { bold: true, size: 13 });
	title.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 22;

	ws.mergeCells(2, 1, 2, 8);
	const sub = ws.getCell(2, 1);
	sub.value = `Total cost to company across all projects & employees · ${data.totals.employee_count} employees · ${data.totals.project_count} projects · Generated ${new Date().toLocaleDateString('en-IN')}`;
	setFont(sub, { size: 10, color: 'FF6B7280' });
	sub.alignment = { vertical: 'middle', horizontal: 'left' };

	const header = ws.getRow(3);
	header.height = 22;
	const headers = [
		{ col: 1, label: 'Sr.', tint: TINT_YELLOW },
		{ col: 2, label: 'Employee', tint: TINT_EMP },
		{ col: 3, label: 'Department', tint: TINT_EMP },
		{ col: 4, label: 'Project', tint: TINT_PROJ },
		{ col: 5, label: 'Client', tint: TINT_BLUE },
		{ col: 6, label: 'Rate/Hr (₹)', tint: TINT_BLUE },
		{ col: 7, label: 'Hours', tint: TINT_PURPLE_LIGHT },
		{ col: 8, label: 'Cost (₹)', tint: TINT_GREEN },
	];
	for (const h of headers) {
		const c = header.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, h.tint);
		c.alignment = {
			vertical: 'middle',
			horizontal: h.col === 1 ? 'center' : h.col <= 4 ? 'left' : 'right',
		};
		box(c);
	}

	let rowNum = 4;
	for (const r of data.rows) {
		const row = ws.getRow(rowNum);
		row.height = 18;
		const vals: Array<{
			val: string | number;
			tint: string;
			numFmt?: string;
			bold?: boolean;
			align: 'left' | 'center' | 'right';
		}> = [
			{ val: r.sr_no, tint: TINT_YELLOW, align: 'center' },
			{
				val: `${r.employee_name} (${r.employee_code || r.employee_id})`,
				tint: TINT_EMP,
				align: 'left',
			},
			{ val: r.department || '—', tint: TINT_EMP, align: 'left' },
			{
				val: [r.project_code, r.project_name].filter(Boolean).join(' – '),
				tint: TINT_PROJ,
				align: 'left',
			},
			{ val: r.client_name || '—', tint: TINT_BLUE, align: 'left' },
			{
				val: r.hourly_rate,
				tint: TINT_BLUE,
				align: 'right',
				numFmt: '#,##0.00',
			},
			{
				val: r.hours,
				tint: TINT_PURPLE_LIGHT,
				align: 'right',
				numFmt: '#,##0.##',
			},
			{
				val: r.cost,
				tint: TINT_GREEN,
				align: 'right',
				numFmt: '#,##0.00',
				bold: true,
			},
		];
		vals.forEach((v, idx) => {
			const c = row.getCell(idx + 1);
			c.value = v.val;
			setFont(c, { bold: v.bold ?? false, size: 9.5 });
			setFill(c, v.tint);
			c.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt) c.numFmt = v.numFmt;
			box(c);
		});
		rowNum++;
	}

	// Totals
	const totalRow = ws.getRow(rowNum);
	totalRow.height = 20;
	ws.mergeCells(rowNum, 1, rowNum, 5);
	const lbl = totalRow.getCell(1);
	lbl.value = 'Grand Total — Company Cost for ' + data.month_label;
	setFont(lbl, { bold: true, size: 10 });
	lbl.alignment = { vertical: 'middle', horizontal: 'right' };
	for (let c = 1; c <= 5; c++) box(totalRow.getCell(c));
	const rateCell = totalRow.getCell(6);
	rateCell.value = data.totals.blended_rate;
	setFont(rateCell, { bold: true, size: 9.5 });
	setFill(rateCell, TINT_BLUE);
	rateCell.alignment = { vertical: 'middle', horizontal: 'right' };
	rateCell.numFmt = '#,##0.00';
	box(rateCell);
	const hCell = totalRow.getCell(7);
	hCell.value = data.totals.total_hours;
	setFont(hCell, { bold: true, size: 10 });
	setFill(hCell, TINT_PURPLE_LIGHT);
	hCell.alignment = { vertical: 'middle', horizontal: 'right' };
	hCell.numFmt = '#,##0.##';
	box(hCell);
	const cCell = totalRow.getCell(8);
	cCell.value = data.totals.total_cost;
	setFont(cCell, { bold: true, size: 10 });
	setFill(cCell, TINT_GREEN);
	cCell.alignment = { vertical: 'middle', horizontal: 'right' };
	cCell.numFmt = '#,##0.00';
	box(cCell);

	ws.views = [{ state: 'frozen', ySplit: 3 }];
}

function buildMonthlyByEmployeeSheet(
	wb: ExcelJS.Workbook,
	data: MonthlyCompanyCostData
): void {
	const ws = wb.addWorksheet('By Employee', {
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
	ws.columns = [
		{ width: 7 },
		{ width: 28 },
		{ width: 16 },
		{ width: 18 },
		{ width: 12 },
		{ width: 12 },
		{ width: 15 },
		{ width: 12 },
	];
	ws.mergeCells(1, 1, 1, 8);
	const t = ws.getCell(1, 1);
	t.value = `By Employee — ${data.month_label}`;
	setFont(t, { bold: true, size: 12 });
	t.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 20;
	ws.mergeCells(2, 1, 2, 8);
	const s = ws.getCell(2, 1);
	s.value = `Aggregated per employee across all projects · ${data.totals.employee_count} employees`;
	setFont(s, { size: 9, color: 'FF6B7280' });
	s.alignment = { vertical: 'middle', horizontal: 'left' };

	const hdr = ws.getRow(3);
	hdr.height = 20;
	const cols = [
		{ col: 1, label: 'Sr.', tint: TINT_YELLOW },
		{ col: 2, label: 'Employee', tint: TINT_YELLOW },
		{ col: 3, label: 'Department', tint: TINT_BLUE },
		{ col: 4, label: 'Designation', tint: TINT_BLUE },
		{ col: 5, label: 'Rate/Hr (₹)', tint: TINT_BLUE },
		{ col: 6, label: 'Hours', tint: TINT_PURPLE_LIGHT },
		{ col: 7, label: 'Cost (₹)', tint: TINT_GREEN },
		{ col: 8, label: 'Projects', tint: TINT_AMBER_LIGHT },
	];
	for (const h of cols) {
		const c = hdr.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, h.tint);
		c.alignment = {
			vertical: 'middle',
			horizontal:
				h.col === 1 || h.col === 8
					? 'center'
					: h.col === 2
						? 'left'
						: h.col >= 5
							? 'right'
							: 'left',
		};
		box(c);
	}

	let rn = 4;
	for (const r of data.employee_rows) {
		const row = ws.getRow(rn);
		row.height = 18;
		const vals: Array<{
			val: string | number;
			tint: string;
			numFmt?: string;
			align: 'left' | 'center' | 'right';
			bold?: boolean;
		}> = [
			{ val: r.sr_no, tint: TINT_YELLOW, align: 'center' },
			{
				val: `${r.employee_name} (${r.employee_code || r.employee_id})`,
				tint: TINT_YELLOW,
				align: 'left',
			},
			{ val: r.department || '—', tint: TINT_BLUE, align: 'left' },
			{ val: r.designation || '—', tint: TINT_BLUE, align: 'left' },
			{
				val: r.hourly_rate,
				tint: TINT_BLUE,
				align: 'right',
				numFmt: '#,##0.00',
			},
			{
				val: r.hours,
				tint: TINT_PURPLE_LIGHT,
				align: 'right',
				numFmt: '#,##0.##',
			},
			{
				val: r.cost,
				tint: TINT_GREEN,
				align: 'right',
				numFmt: '#,##0.00',
				bold: true,
			},
			{ val: r.project_count, tint: TINT_AMBER_LIGHT, align: 'center' },
		];
		vals.forEach((v, idx) => {
			const c = row.getCell(idx + 1);
			c.value = v.val;
			setFont(c, { bold: v.bold ?? false, size: 9.5 });
			setFill(c, v.tint);
			c.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt) c.numFmt = v.numFmt;
			box(c);
		});
		rn++;
	}

	const tr = ws.getRow(rn);
	tr.height = 20;
	ws.mergeCells(rn, 1, rn, 5);
	const l = tr.getCell(1);
	l.value = 'Grand Total';
	setFont(l, { bold: true, size: 10 });
	l.alignment = { vertical: 'middle', horizontal: 'right' };
	for (let c = 1; c <= 5; c++) box(tr.getCell(c));
	const hc = tr.getCell(6);
	hc.value = data.totals.total_hours;
	setFont(hc, { bold: true, size: 10 });
	setFill(hc, TINT_PURPLE_LIGHT);
	hc.alignment = { vertical: 'middle', horizontal: 'right' };
	hc.numFmt = '#,##0.##';
	box(hc);
	const cc = tr.getCell(7);
	cc.value = data.totals.total_cost;
	setFont(cc, { bold: true, size: 10 });
	setFill(cc, TINT_GREEN);
	cc.alignment = { vertical: 'middle', horizontal: 'right' };
	cc.numFmt = '#,##0.00';
	box(cc);
	const pc = tr.getCell(8);
	pc.value = data.totals.project_count;
	setFont(pc, { bold: true, size: 10 });
	setFill(pc, TINT_AMBER_LIGHT);
	pc.alignment = { vertical: 'middle', horizontal: 'center' };
	box(pc);

	ws.views = [{ state: 'frozen', ySplit: 3 }];
}

function buildMonthlyByProjectSheet(
	wb: ExcelJS.Workbook,
	data: MonthlyCompanyCostData
): void {
	const ws = wb.addWorksheet('By Project', {
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
	ws.columns = [
		{ width: 7 },
		{ width: 32 },
		{ width: 20 },
		{ width: 12 },
		{ width: 15 },
		{ width: 12 },
	];
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `By Project — ${data.month_label}`;
	setFont(t, { bold: true, size: 12 });
	t.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 20;
	ws.mergeCells(2, 1, 2, 6);
	const s = ws.getCell(2, 1);
	s.value = `Aggregated per project across all employees · ${data.totals.project_count} projects`;
	setFont(s, { size: 9, color: 'FF6B7280' });
	s.alignment = { vertical: 'middle', horizontal: 'left' };

	const hdr = ws.getRow(3);
	hdr.height = 20;
	const cols = [
		{ col: 1, label: 'Sr.', tint: TINT_YELLOW },
		{ col: 2, label: 'Project', tint: TINT_YELLOW },
		{ col: 3, label: 'Client', tint: TINT_BLUE },
		{ col: 4, label: 'Hours', tint: TINT_PURPLE_LIGHT },
		{ col: 5, label: 'Cost (₹)', tint: TINT_GREEN },
		{ col: 6, label: 'Employees', tint: TINT_AMBER_LIGHT },
	];
	for (const h of cols) {
		const c = hdr.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, h.tint);
		c.alignment = {
			vertical: 'middle',
			horizontal:
				h.col === 1 || h.col === 6
					? 'center'
					: h.col === 2 || h.col === 3
						? 'left'
						: 'right',
		};
		box(c);
	}

	let rn = 4;
	for (const r of data.project_rows) {
		const row = ws.getRow(rn);
		row.height = 18;
		const vals: Array<{
			val: string | number;
			tint: string;
			numFmt?: string;
			align: 'left' | 'center' | 'right';
			bold?: boolean;
		}> = [
			{ val: r.sr_no, tint: TINT_YELLOW, align: 'center' },
			{
				val: [r.project_code, r.project_name].filter(Boolean).join(' – '),
				tint: TINT_YELLOW,
				align: 'left',
			},
			{ val: r.client_name || '—', tint: TINT_BLUE, align: 'left' },
			{
				val: r.hours,
				tint: TINT_PURPLE_LIGHT,
				align: 'right',
				numFmt: '#,##0.##',
			},
			{
				val: r.cost,
				tint: TINT_GREEN,
				align: 'right',
				numFmt: '#,##0.00',
				bold: true,
			},
			{ val: r.employee_count, tint: TINT_AMBER_LIGHT, align: 'center' },
		];
		vals.forEach((v, idx) => {
			const c = row.getCell(idx + 1);
			c.value = v.val;
			setFont(c, { bold: v.bold ?? false, size: 9.5 });
			setFill(c, v.tint);
			c.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt) c.numFmt = v.numFmt;
			box(c);
		});
		rn++;
	}

	const tr = ws.getRow(rn);
	tr.height = 20;
	ws.mergeCells(rn, 1, rn, 3);
	const l = tr.getCell(1);
	l.value = 'Grand Total';
	setFont(l, { bold: true, size: 10 });
	l.alignment = { vertical: 'middle', horizontal: 'right' };
	for (let c = 1; c <= 3; c++) box(tr.getCell(c));
	const hc = tr.getCell(4);
	hc.value = data.totals.total_hours;
	setFont(hc, { bold: true, size: 10 });
	setFill(hc, TINT_PURPLE_LIGHT);
	hc.alignment = { vertical: 'middle', horizontal: 'right' };
	hc.numFmt = '#,##0.##';
	box(hc);
	const cc = tr.getCell(5);
	cc.value = data.totals.total_cost;
	setFont(cc, { bold: true, size: 10 });
	setFill(cc, TINT_GREEN);
	cc.alignment = { vertical: 'middle', horizontal: 'right' };
	cc.numFmt = '#,##0.00';
	box(cc);
	const ec = tr.getCell(6);
	ec.value = data.totals.employee_count;
	setFont(ec, { bold: true, size: 10 });
	setFill(ec, TINT_AMBER_LIGHT);
	ec.alignment = { vertical: 'middle', horizontal: 'center' };
	box(ec);

	ws.views = [{ state: 'frozen', ySplit: 3 }];
}

export function buildMonthlyWorkbook(
	data: MonthlyCompanyCostData
): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();
	buildMonthlyDetailedSheet(wb, data);
	buildMonthlyByEmployeeSheet(wb, data);
	buildMonthlyByProjectSheet(wb, data);
	return wb;
}

export async function buildMonthlyWorkbookBuffer(
	data: MonthlyCompanyCostData
): Promise<Buffer> {
	const wb = buildMonthlyWorkbook(data);
	const ab = await wb.xlsx.writeBuffer();
	return Buffer.from(ab);
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

// ─── Company Expenditure Export (Ticket #324) ───────────────────────

const TINT_PURPLE_HDR = 'FF4D025B';
const TINT_PURPLE_SUB = 'FFE9D5FF';
const TINT_GRAY_LIGHT = 'FFF3F4F6';
const TINT_WARN_LIGHT = 'FFFEF3C7';
const TINT_ERROR_LIGHT = 'FFFEE2E2';
const TINT_GREEN_LIGHT = 'FFD1FAE5';

export interface ExpenditureClientOrder {
	orderNumber: string;
	counterpartyName: string;
	projectCode: string | null;
	projectName: string | null;
	orderDate: string | null;
	currency: string;
	grossAmount: number | null;
	netAmount: number | null;
	clientInvoicedValue: number | null;
	clientRemainingValue: number | null;
	status: string;
}

export interface ExpenditureExportInput {
	reconciliation: CompanyReconciliation;
	close: ClosePayload | null;
	revisions: RevisionPayload | null;
	asOf?: string | null;
	clientOrders?: ExpenditureClientOrder[];
}

export function fileBaseForExpenditureExcel(
	data: CompanyReconciliation,
	projectId?: number | null
): string {
	const m = sanitizeName(data.month);
	const p = projectId ? `_Project_${projectId}` : '';
	return `Company_Expenditure_${m}${p}.xlsx`;
}

function renderValue(
	cell: ExcelJS.Cell,
	val: number | string | null | undefined,
	numFmt?: string
): void {
	if (val === null || val === undefined) {
		cell.value = '—';
	} else if (typeof val === 'number') {
		cell.value = val;
		if (numFmt) cell.numFmt = numFmt;
	} else {
		cell.value = val;
	}
}

function buildExpenditureReconciliationSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation, close, asOf } = input;
	const ws = wb.addWorksheet('Company Reconciliation', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 32 },
		{ width: 22 },
		{ width: 18 },
		{ width: 24 },
		{ width: 16 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = 'Accent CRM — Company Expenditure Reconciliation';
	setFont(t, { bold: true, size: 14, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	ws.mergeCells(2, 1, 2, 6);
	const s = ws.getCell(2, 1);
	s.value =
		'Company Incurred Cost reconciled to Incurred Project Cost, Company Overhead, and Unallocated Cost';
	setFont(s, { size: 9.5, color: 'FF4B5563' });
	ws.getRow(2).height = 18;

	// Metadata Box
	const cutoff = asOf || reconciliation.month;
	const metaRows = [
		['Reporting Month', reconciliation.month_label || reconciliation.month],
		['Reporting Cutoff / As Of', cutoff],
		['Reporting Currency Basis', reconciliation.company.reporting_currency],
		['Financial Close Status', close?.status === 'closed' ? 'Closed' : 'Open'],
		['Financial Version', String(close?.financial_version ?? 0)],
		['Close Snapshot UID', close?.close_uid || '—'],
		[
			'Filter Scope',
			reconciliation.project_id
				? `Project ID: ${reconciliation.project_id}`
				: 'All Projects (Unfiltered)',
		],
		[
			'Conversion Evidence Status',
			reconciliation.company.conversion.status === 'reporting'
				? `All confirmed records natively in ${reconciliation.company.reporting_currency}`
				: reconciliation.company.conversion.status === 'converted'
					? `${reconciliation.company.conversion.converted_records} records converted into ${reconciliation.company.reporting_currency}`
					: `${reconciliation.company.conversion.unsupported_records} records unconverted into ${reconciliation.company.reporting_currency}`,
		],
	];

	let rNum = 4;
	for (const [k, v] of metaRows) {
		const row = ws.getRow(rNum);
		row.height = 18;
		const c1 = row.getCell(1);
		c1.value = k;
		setFont(c1, { bold: true, size: 9.5 });
		setFill(c1, TINT_GRAY_LIGHT);
		box(c1);

		const c2 = row.getCell(2);
		c2.value = v;
		setFont(c2, { size: 9.5 });
		setFill(c2, TINT_GRAY_LIGHT);
		box(c2);
		rNum++;
	}

	// Filter warning if applicable
	if (reconciliation.project_id) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 6);
		const warnCell = ws.getCell(rNum, 1);
		warnCell.value =
			'Note: Project filter narrows Project Detail only. Company Incurred Cost and summary figures below represent company-wide totals.';
		setFont(warnCell, { bold: true, size: 9.5, color: 'FF92400E' });
		setFill(warnCell, TINT_WARN_LIGHT);
		box(warnCell);
		ws.getRow(rNum).height = 20;
	}

	// Section: Company Incurred Cost
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 5);
	const sec1 = ws.getCell(rNum, 1);
	sec1.value = 'Company Incurred Cost Reconciliation';
	setFont(sec1, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(sec1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 22;

	rNum++;
	const th1 = ws.getRow(rNum);
	th1.height = 20;
	const thCols1 = [
		{ col: 1, label: 'Reconciliation Metric' },
		{ col: 2, label: `Amount (${reconciliation.company.reporting_currency})` },
		{ col: 3, label: 'Original Currency' },
		{ col: 4, label: 'Conversion / Treatment' },
		{ col: 5, label: 'Confirmed Records' },
	];
	for (const h of thCols1) {
		const c = th1.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: h.col === 2 || h.col === 5 ? 'right' : 'left',
		};
	}

	const companyMetrics: Array<{
		label: string;
		amount: number | null;
		currency: string | null;
		treatment: string;
		records: number | string;
		bold?: boolean;
	}> = [
		{
			label: 'Company Incurred Cost',
			amount: reconciliation.company.incurred_cost,
			currency:
				reconciliation.company.currency ||
				reconciliation.company.reporting_currency,
			treatment: reconciliation.company.conversion.status,
			records: reconciliation.company.record_count,
			bold: true,
		},
		{
			label: '— Incurred Project Cost',
			amount: reconciliation.company.currency_totals.reduce(
				(sum, ct) => sum + (ct.reporting.incurred_project_cost ?? 0),
				0
			),
			currency: reconciliation.company.reporting_currency,
			treatment: 'Attributed to Projects',
			records: reconciliation.projects.reduce((s, p) => s + p.record_count, 0),
		},
		{
			label: '— Company Overhead',
			amount: reconciliation.company.currency_totals.reduce(
				(sum, ct) => sum + (ct.reporting.company_overhead ?? 0),
				0
			),
			currency: reconciliation.company.reporting_currency,
			treatment: 'Unattributed General Overhead',
			records: '—',
		},
		{
			label: '— Unallocated Cost',
			amount: reconciliation.company.currency_totals.reduce(
				(sum, ct) => sum + (ct.reporting.unallocated_cost ?? 0),
				0
			),
			currency: reconciliation.company.reporting_currency,
			treatment: 'Unallocated Direct / Payroll Cost',
			records: '—',
		},
		{
			label: 'Gross Supplier & Expense Liability',
			amount: reconciliation.company.gross_liability,
			currency: reconciliation.company.reporting_currency,
			treatment: 'Gross Liability Before Tax Deduction',
			records: reconciliation.company.record_count,
		},
		{
			label: 'Recoverable Tax',
			amount: reconciliation.company.recoverable_tax,
			currency: reconciliation.company.reporting_currency,
			treatment: 'Confirmed Recoverable Input Tax',
			records: '—',
		},
		{
			label: 'Unresolved Tax Gross',
			amount: reconciliation.company.unresolved_tax.gross_amount,
			currency:
				reconciliation.company.unresolved_tax.currency ||
				reconciliation.company.reporting_currency,
			treatment: 'Excluded Pending Confirmation',
			records: reconciliation.company.unresolved_tax.count,
		},
		{
			label: 'Known Zero Records',
			amount: 0,
			currency: reconciliation.company.reporting_currency,
			treatment: 'Confirmed Zero-Cost Records',
			records: reconciliation.company.known_zero_count,
		},
	];

	for (const m of companyMetrics) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;

		const c1 = row.getCell(1);
		c1.value = m.label;
		setFont(c1, { bold: m.bold ?? false, size: 9.5 });
		box(c1);

		const c2 = row.getCell(2);
		renderValue(c2, m.amount, '#,##0.00');
		setFont(c2, { bold: m.bold ?? false, size: 9.5 });
		c2.alignment = { vertical: 'middle', horizontal: 'right' };
		box(c2);

		const c3 = row.getCell(3);
		c3.value = m.currency || '—';
		setFont(c3, { size: 9.5 });
		c3.alignment = { vertical: 'middle', horizontal: 'center' };
		box(c3);

		const c4 = row.getCell(4);
		c4.value = m.treatment;
		setFont(c4, { size: 9.5 });
		box(c4);

		const c5 = row.getCell(5);
		renderValue(c5, m.records);
		setFont(c5, { size: 9.5 });
		c5.alignment = { vertical: 'middle', horizontal: 'right' };
		box(c5);
	}

	// Filtered Project Subtotal Table (if filter applied)
	if (reconciliation.filtered_subtotal) {
		const fs = reconciliation.filtered_subtotal;
		const proj = reconciliation.projects.find(
			(p) => p.project_id === fs.project_id
		);
		const projName = proj
			? `${proj.project_code} — ${proj.project_name}`
			: `Project ${fs.project_id}`;

		rNum += 2;
		ws.mergeCells(rNum, 1, rNum, 5);
		const secFilter = ws.getCell(rNum, 1);
		secFilter.value = 'Filtered Project Subtotal (Selected Scope)';
		setFont(secFilter, { bold: true, size: 10.5, color: 'FFFFFFFF' });
		setFill(secFilter, TINT_PURPLE_HDR);
		ws.getRow(rNum).height = 20;

		rNum++;
		const thF = ws.getRow(rNum);
		thF.height = 20;
		const fCols = [
			{ col: 1, label: 'Project' },
			{ col: 2, label: 'Currency' },
			{ col: 3, label: 'Incurred Cost' },
			{ col: 4, label: 'Comparison Cost' },
			{ col: 5, label: 'Cost to Date' },
		];
		for (const h of fCols) {
			const c = thF.getCell(h.col);
			c.value = h.label;
			setFont(c, { bold: true, size: 9 });
			setFill(c, TINT_PURPLE_SUB);
			box(c);
			c.alignment = {
				vertical: 'middle',
				horizontal: [3, 4, 5].includes(h.col) ? 'right' : 'left',
			};
		}

		for (const ct of fs.currency_totals) {
			rNum++;
			const fRow = ws.getRow(rNum);
			fRow.height = 18;
			fRow.getCell(1).value = projName;
			fRow.getCell(2).value = ct.currency;
			renderValue(fRow.getCell(3), ct.incurred_cost, '#,##0.00');
			renderValue(fRow.getCell(4), ct.comparison_cost, '#,##0.00');
			renderValue(fRow.getCell(5), ct.cost_to_date, '#,##0.00');

			for (let i = 1; i <= 5; i++) {
				const c = fRow.getCell(i);
				setFont(c, { bold: true, size: 9.5 });
				box(c);
				if ([3, 4, 5].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	// Section: Currency Subtotals
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 10);
	const secCur = ws.getCell(rNum, 1);
	secCur.value = 'Currency Subtotals';
	setFont(secCur, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secCur, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCur = ws.getRow(rNum);
	thCur.height = 20;
	const curHeaders = [
		'Currency',
		'Project Cost',
		'Overhead',
		'Unallocated',
		'Incurred Cost',
		'Gross Liability',
		'Recoverable Tax',
		'Unresolved Tax',
		'Period Charges',
		'Status',
	];
	curHeaders.forEach((label, idx) => {
		const c = thCur.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 1 && idx <= 8 ? 'right' : 'left',
		};
	});

	for (const ct of reconciliation.company.currency_totals) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;

		row.getCell(1).value = ct.currency;
		renderValue(row.getCell(2), ct.incurred_project_cost, '#,##0.00');
		renderValue(row.getCell(3), ct.company_overhead, '#,##0.00');
		renderValue(row.getCell(4), ct.unallocated_cost, '#,##0.00');
		renderValue(row.getCell(5), ct.incurred_cost, '#,##0.00');
		renderValue(row.getCell(6), ct.gross_liability, '#,##0.00');
		renderValue(row.getCell(7), ct.recoverable_tax, '#,##0.00');
		renderValue(row.getCell(8), ct.unresolved_tax_gross, '#,##0.00');
		renderValue(row.getCell(9), ct.period_charge_amount, '#,##0.00');
		row.getCell(10).value = ct.reporting.status;

		for (let i = 1; i <= 10; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 2 && i <= 9) {
				c.alignment = { vertical: 'middle', horizontal: 'right' };
			}
		}
	}

	// Section: Categorized Costs by Source Register
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 4);
	const secCat = ws.getCell(rNum, 1);
	secCat.value = 'Categorized Costs by Source Register';
	setFont(secCat, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secCat, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCat = ws.getRow(rNum);
	thCat.height = 20;
	const catHeaders = [
		'Source Category',
		'Register Key',
		'Incurred Cost Amount',
		'Records',
	];
	catHeaders.forEach((label, idx) => {
		const c = thCat.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 2 ? 'right' : 'left',
		};
	});

	for (const g of reconciliation.company.groups) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = g.label;
		row.getCell(2).value = g.key;
		renderValue(row.getCell(3), g.amount, '#,##0.00');
		renderValue(row.getCell(4), g.record_count);

		for (let i = 1; i <= 4; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 3) c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Section: Comparison against Prior Comparable Period
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 6);
	const secComp = ws.getCell(rNum, 1);
	secComp.value = 'Comparison Against Prior Comparable Period';
	setFont(secComp, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secComp, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thComp = ws.getRow(rNum);
	thComp.height = 20;
	const compHeaders = [
		'Prior Month',
		'Elapsed Days',
		'Prior Incurred Cost',
		'Cost Change Amount',
		'Cost Change %',
		'Trend',
	];
	compHeaders.forEach((label, idx) => {
		const c = thComp.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [2, 3, 4, 5].includes(idx + 1) ? 'right' : 'left',
		};
	});

	const cmp = reconciliation.comparison;
	rNum++;
	const compRow = ws.getRow(rNum);
	compRow.height = 18;
	compRow.getCell(1).value = cmp.prior_month || '—';
	renderValue(compRow.getCell(2), cmp.elapsed_days);
	renderValue(compRow.getCell(3), cmp.prior_cost, '#,##0.00');
	renderValue(compRow.getCell(4), cmp.change_amount, '#,##0.00');
	if (cmp.change_percent !== null && cmp.change_percent !== undefined) {
		compRow.getCell(5).value = cmp.change_percent / 100;
		compRow.getCell(5).numFmt = '0.00%';
	} else {
		compRow.getCell(5).value = '—';
	}
	compRow.getCell(6).value = cmp.change_state;

	for (let i = 1; i <= 6; i++) {
		const c = compRow.getCell(i);
		setFont(c, { size: 9.5 });
		box(c);
		if ([2, 3, 4, 5].includes(i)) {
			c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Section: Source Coverage Notices
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 5);
	const secCov = ws.getCell(rNum, 1);
	secCov.value = 'Source Coverage & Audit Disclosures';
	setFont(secCov, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(secCov, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCov = ws.getRow(rNum);
	thCov.height = 20;
	const covHeaders = ['Code', 'Source', 'Severity', 'Audit Finding'];
	covHeaders.forEach((label, idx) => {
		const c = thCov.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
	});

	for (const n of reconciliation.coverage) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = n.code;
		row.getCell(2).value = n.label;
		row.getCell(3).value = n.severity;
		row.getCell(4).value = n.detail;

		for (let i = 1; i <= 4; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i === 3) {
				if (n.severity === 'info') setFill(c, TINT_GREEN_LIGHT);
				else if (n.severity === 'warning') setFill(c, TINT_WARN_LIGHT);
				else if (n.severity === 'error') setFill(c, TINT_ERROR_LIGHT);
			}
		}
	}
}

function buildExpenditureProjectDetailSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation } = input;
	const ws = wb.addWorksheet('Project Detail', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 8 }, // Sr.
		{ width: 18 }, // Code
		{ width: 30 }, // Project Name
		{ width: 22 }, // Client Name
		{ width: 10 }, // Currency
		{ width: 16 }, // Logged Hours
		{ width: 20 }, // Incurred Cost (Orig)
		{ width: 18 }, // Conversion Status
		{ width: 22 }, // Converted Cost
		{ width: 18 }, // Cost to Date
		{ width: 16 }, // Evidence State
		{ width: 10 }, // Records
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Project Expenditure & Logged Hours — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	ws.mergeCells(2, 1, 2, 8);
	const s = ws.getCell(2, 1);
	s.value =
		'Individual Project Incurred Cost, Logged Hours, Cost to Date, and Historical Evidence States';
	setFont(s, { size: 9.5, color: 'FF4B5563' });
	ws.getRow(2).height = 18;

	// Table Headers
	const th = ws.getRow(4);
	th.height = 22;
	const cols: Array<{
		col: number;
		label: string;
		align: 'left' | 'center' | 'right';
	}> = [
		{ col: 1, label: 'Sr.', align: 'center' },
		{ col: 2, label: 'Project Code', align: 'left' },
		{ col: 3, label: 'Project Name', align: 'left' },
		{ col: 4, label: 'Client Name', align: 'left' },
		{ col: 5, label: 'Currency', align: 'center' },
		{ col: 6, label: 'Logged Hours', align: 'right' },
		{ col: 7, label: 'Incurred Cost (Orig)', align: 'right' },
		{ col: 8, label: 'Conversion Status', align: 'center' },
		{
			col: 9,
			label: `Converted (${reconciliation.company.reporting_currency})`,
			align: 'right',
		},
		{ col: 10, label: 'Cost to Date', align: 'right' },
		{ col: 11, label: 'Evidence State', align: 'center' },
		{ col: 12, label: 'Records', align: 'right' },
	];

	for (const h of cols) {
		const c = th.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = { vertical: 'middle', horizontal: h.align };
	}

	let rNum = 5;
	let totalHours = 0;
	let totalConverted = 0;
	let allConverted = true;

	for (let idx = 0; idx < reconciliation.projects.length; idx++) {
		const p = reconciliation.projects[idx];
		const row = ws.getRow(rNum);
		row.height = 18;

		row.getCell(1).value = idx + 1;
		row.getCell(2).value = p.project_code;
		row.getCell(3).value = p.project_name;
		row.getCell(4).value = p.client_name || '—';
		row.getCell(5).value = p.currency;
		renderValue(row.getCell(6), p.logged_hours, '#,##0.00');
		renderValue(row.getCell(7), p.incurred_cost, '#,##0.00');
		row.getCell(8).value = p.conversion_status;
		renderValue(row.getCell(9), p.converted_incurred_cost, '#,##0.00');
		renderValue(row.getCell(10), p.cost_to_date, '#,##0.00');
		row.getCell(11).value = p.evidence.state;
		renderValue(row.getCell(12), p.record_count);

		totalHours += p.logged_hours || 0;
		if (p.converted_incurred_cost !== null) {
			totalConverted += p.converted_incurred_cost;
		} else {
			allConverted = false;
		}

		for (const h of cols) {
			const c = row.getCell(h.col);
			setFont(c, { size: 9.5 });
			box(c);
			c.alignment = { vertical: 'middle', horizontal: h.align };
		}
		rNum++;
	}

	// Totals / Subtotal Row
	const totRow = ws.getRow(rNum);
	totRow.height = 20;
	ws.mergeCells(rNum, 1, rNum, 5);
	const lbl = totRow.getCell(1);
	lbl.value = reconciliation.filtered_subtotal
		? 'Filtered Project Subtotal'
		: 'Total Projects Detail';
	setFont(lbl, { bold: true, size: 9.5 });
	lbl.alignment = { vertical: 'middle', horizontal: 'right' };

	renderValue(totRow.getCell(6), totalHours, '#,##0.00');
	renderValue(
		totRow.getCell(9),
		allConverted ? totalConverted : null,
		'#,##0.00'
	);

	for (let i = 1; i <= 12; i++) {
		const c = totRow.getCell(i);
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		if ([6, 7, 9, 10, 12].includes(i)) {
			c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}
}

function buildExpenditureBudgetsCommitmentsSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation, clientOrders } = input;
	const ws = wb.addWorksheet('Budgets & Commitments', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 18 },
		{ width: 28 },
		{ width: 14 },
		{ width: 14 },
		{ width: 10 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 14 },
		{ width: 24 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Approved Budgets, Supplier Commitments & Orders — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	// Section 1: Approved Cost Budgets Comparison
	let rNum = 3;
	ws.mergeCells(rNum, 1, rNum, 8);
	const s1 = ws.getCell(rNum, 1);
	s1.value = 'Approved Cost Budgets Comparison';
	setFont(s1, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 8);
	const s1sub = ws.getCell(rNum, 1);
	s1sub.value =
		'Budgets compared with Incurred Project Cost where scope, currency, and period match exactly. Budgets never enter company expenditure totals.';
	setFont(s1sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	rNum++;
	const thB = ws.getRow(rNum);
	thB.height = 20;
	const bCols = [
		'Project Code',
		'Project Name',
		'Scope',
		'Period',
		'Currency',
		'Approved Budget',
		'Incurred Cost',
		'Variance',
		'Status',
		'Version',
		'Reference',
	];
	bCols.forEach((label, idx) => {
		const c = thB.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [6, 7, 8].includes(idx + 1) ? 'right' : 'left',
		};
	});

	if (reconciliation.budgets.comparisons.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 11);
		const emptyB = ws.getCell(rNum, 1);
		emptyB.value = 'No approved cost budgets matching this period.';
		setFont(emptyB, { size: 9.5 });
		box(emptyB);
		ws.getRow(rNum).height = 18;
	} else {
		for (const bc of reconciliation.budgets.comparisons) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = bc.project_code;
			row.getCell(2).value = bc.project_name;
			row.getCell(3).value = bc.budget?.scope || 'project';
			row.getCell(4).value = reconciliation.month;
			row.getCell(5).value = bc.currency;
			renderValue(row.getCell(6), bc.budget?.amount ?? null, '#,##0.00');
			renderValue(row.getCell(7), bc.incurred_cost, '#,##0.00');
			renderValue(row.getCell(8), bc.variance, '#,##0.00');
			row.getCell(9).value = bc.outcome;
			row.getCell(10).value = String(bc.budget?.financial_version ?? '—');
			row.getCell(11).value = bc.budget?.approval_evidence_reference || '—';

			for (let i = 1; i <= 11; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([6, 7, 8].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	// Section 2: Supplier Commitments
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 7);
	const s2 = ws.getCell(rNum, 1);
	s2.value = 'Outstanding Supplier Commitments (Rollforward)';
	setFont(s2, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s2, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 7);
	const s2sub = ws.getCell(rNum, 1);
	s2sub.value =
		'Supplier order value not yet consumed by recognized cost. Not incurred cost.';
	setFont(s2sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	rNum++;
	const thSC = ws.getRow(rNum);
	thSC.height = 20;
	const scCols = [
		'Currency',
		'Basis',
		'Closing Commitment',
		'Month Consumption',
		'Unconsumed Orders',
	];
	scCols.forEach((label, idx) => {
		const c = thSC.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [3, 4, 5].includes(idx + 1) ? 'right' : 'left',
		};
	});

	for (const t of reconciliation.supplier_commitment.totals) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = t.currency;
		row.getCell(2).value = t.basis;
		renderValue(row.getCell(3), t.closingCommitment, '#,##0.00');
		renderValue(row.getCell(4), t.consumptionInMonth, '#,##0.00');
		renderValue(row.getCell(5), t.unconsumedOrderCount);

		for (let i = 1; i <= 5; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if ([3, 4, 5].includes(i)) {
				c.alignment = { vertical: 'middle', horizontal: 'right' };
			}
		}
	}

	// Supplier Orders Detail
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 9);
	const s2det = ws.getCell(rNum, 1);
	s2det.value = 'Supplier Orders Detail';
	setFont(s2det, { bold: true, size: 10, color: TINT_PURPLE_HDR });
	ws.getRow(rNum).height = 18;

	rNum++;
	const thOrd = ws.getRow(rNum);
	thOrd.height = 20;
	const ordCols = [
		'Order No.',
		'Supplier',
		'Project Code',
		'Project Name',
		'Currency',
		'Basis',
		'Order Value',
		'Consumed Amount',
		'Outstanding Balance',
		'Status',
	];
	ordCols.forEach((label, idx) => {
		const c = thOrd.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [7, 8, 9].includes(idx + 1) ? 'right' : 'left',
		};
	});

	if (reconciliation.supplier_commitment.orders.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 10);
		const emptyO = ws.getCell(rNum, 1);
		emptyO.value = 'No supplier commitments recorded for this period.';
		setFont(emptyO, { size: 9.5 });
		box(emptyO);
		ws.getRow(rNum).height = 18;
	} else {
		for (const o of reconciliation.supplier_commitment.orders) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = o.orderNumber;
			row.getCell(2).value = o.counterpartyName;
			row.getCell(3).value = o.projectCode || '—';
			row.getCell(4).value = o.projectName || '—';
			row.getCell(5).value = o.currency;
			row.getCell(6).value = o.basis;
			renderValue(row.getCell(7), o.value, '#,##0.00');
			renderValue(row.getCell(8), o.consumption, '#,##0.00');
			renderValue(row.getCell(9), o.remaining, '#,##0.00');
			row.getCell(10).value = o.status;

			for (let i = 1; i <= 10; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([7, 8, 9].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}

	// Section 3: Client Order Context (Commercial Context Only)
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 10);
	const s3 = ws.getCell(rNum, 1);
	s3.value = 'Client Order Context (Commercial Context Only)';
	setFont(s3, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s3, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 10);
	const s3warn = ws.getCell(rNum, 1);
	s3warn.value =
		'CAUTION: Client order values represent commercial context only. They are NOT recognized revenue or profit, and NOT company expenditure. Do NOT subtract costs from client orders to calculate profit.';
	setFont(s3warn, { bold: true, size: 9, color: 'FF991B1B' });
	setFill(s3warn, TINT_ERROR_LIGHT);
	box(s3warn);
	ws.getRow(rNum).height = 20;

	rNum++;
	const thCl = ws.getRow(rNum);
	thCl.height = 20;
	const clCols = [
		'Client Name',
		'Project Code',
		'Project Name',
		'Order Reference',
		'Order Date',
		'Currency',
		'Order Value',
		'Invoiced Value',
		'Remaining Value',
		'Status',
	];
	clCols.forEach((label, idx) => {
		const c = thCl.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [7, 8, 9].includes(idx + 1) ? 'right' : 'left',
		};
	});

	if (!clientOrders || clientOrders.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 10);
		const emptyCl = ws.getCell(rNum, 1);
		emptyCl.value = 'No client orders recorded for this scope.';
		setFont(emptyCl, { size: 9.5 });
		box(emptyCl);
		ws.getRow(rNum).height = 18;
	} else {
		for (const co of clientOrders) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 18;
			row.getCell(1).value = co.counterpartyName;
			row.getCell(2).value = co.projectCode || '—';
			row.getCell(3).value = co.projectName || '—';
			row.getCell(4).value = co.orderNumber;
			row.getCell(5).value = co.orderDate || '—';
			row.getCell(6).value = co.currency;
			renderValue(row.getCell(7), co.grossAmount ?? co.netAmount, '#,##0.00');
			renderValue(row.getCell(8), co.clientInvoicedValue, '#,##0.00');
			renderValue(row.getCell(9), co.clientRemainingValue, '#,##0.00');
			row.getCell(10).value = co.status;

			for (let i = 1; i <= 10; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9.5 });
				box(c);
				if ([7, 8, 9].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}
}

function buildExpenditureCashPaidSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation } = input;
	const ws = wb.addWorksheet('Cash Paid', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 18 },
		{ width: 28 },
		{ width: 16 },
		{ width: 10 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 16 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Outward Cash Paid & Float Funding — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	ws.mergeCells(2, 1, 2, 8);
	const s = ws.getCell(2, 1);
	s.value =
		'Dated outward cash movements (settlements, native payroll payouts, petty cash spending). Funding is internal transfer and displayed apart.';
	setFont(s, { size: 9.5, color: 'FF4B5563' });
	ws.getRow(2).height = 18;

	// Table 1: Outward Paid by Currency
	let rNum = 4;
	ws.mergeCells(rNum, 1, rNum, 6);
	const s1 = ws.getCell(rNum, 1);
	s1.value = 'Outward Cash Paid by Currency';
	setFont(s1, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(s1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const th1 = ws.getRow(rNum);
	th1.height = 20;
	const c1Headers = [
		'Currency',
		'Total Paid',
		'Settlements',
		'Payroll Payouts',
		'Petty Cash Spending',
		'Movements',
	];
	c1Headers.forEach((label, idx) => {
		const c = th1.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 1 ? 'right' : 'left',
		};
	});

	for (const cur of reconciliation.cash.by_currency) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = cur.currency;
		renderValue(row.getCell(2), cur.paid, '#,##0.00');
		renderValue(row.getCell(3), cur.settlement, '#,##0.00');
		renderValue(row.getCell(4), cur.payroll, '#,##0.00');
		renderValue(row.getCell(5), cur.petty_spend, '#,##0.00');
		renderValue(row.getCell(6), cur.movement_count);

		for (let i = 1; i <= 6; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 2) c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Table 2: Float Funding Summary
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 4);
	const s2 = ws.getCell(rNum, 1);
	s2.value = 'Petty Float Funding Summary (Internal Transfers)';
	setFont(s2, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(s2, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 6);
	const s2sub = ws.getCell(rNum, 1);
	s2sub.value =
		'Voucher funding moves bank balance into petty float; it is not outward operating cash paid.';
	setFont(s2sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	rNum++;
	const th2 = ws.getRow(rNum);
	th2.height = 20;
	const c2Headers = ['Currency', 'Funding Amount', 'Movement Count'];
	c2Headers.forEach((label, idx) => {
		const c = th2.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: idx >= 1 ? 'right' : 'left',
		};
	});

	for (const f of reconciliation.cash.funding.by_currency) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = f.currency || 'INR';
		renderValue(row.getCell(2), f.amount, '#,##0.00');
		renderValue(row.getCell(3), f.movement_count);

		for (let i = 1; i <= 3; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if (i >= 2) c.alignment = { vertical: 'middle', horizontal: 'right' };
		}
	}

	// Table 3: Movement Targets & Settlement Status
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 9);
	const s3 = ws.getCell(rNum, 1);
	s3.value = 'Cash Targets & Settlement Balances';
	setFont(s3, { bold: true, size: 10.5, color: 'FFFFFFFF' });
	setFill(s3, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	const th3 = ws.getRow(rNum);
	th3.height = 20;
	const c3Headers = [
		'Target Type',
		'Target Label / Key',
		'Nature',
		'Currency',
		'Liability / Cost',
		'Settled in Month',
		'All-Time Settled',
		'Remaining Balance',
		'State',
	];
	c3Headers.forEach((label, idx) => {
		const c = th3.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [5, 6, 7, 8].includes(idx + 1) ? 'right' : 'left',
		};
	});

	for (const tg of reconciliation.cash.targets) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		row.getCell(1).value = tg.target_kind;
		row.getCell(2).value = tg.label || tg.target_key;
		row.getCell(3).value = tg.nature || '—';
		row.getCell(4).value = tg.currency || '—';
		renderValue(row.getCell(5), tg.liability, '#,##0.00');
		renderValue(row.getCell(6), tg.settled_this_month, '#,##0.00');
		renderValue(row.getCell(7), tg.settled, '#,##0.00');
		renderValue(row.getCell(8), tg.remaining, '#,##0.00');
		row.getCell(9).value = tg.state;

		for (let i = 1; i <= 9; i++) {
			const c = row.getCell(i);
			setFont(c, { size: 9.5 });
			box(c);
			if ([5, 6, 7, 8].includes(i)) {
				c.alignment = { vertical: 'middle', horizontal: 'right' };
			}
		}
	}
}

function buildExpenditureRevisionsCloseSheet(
	wb: ExcelJS.Workbook,
	input: ExpenditureExportInput
): void {
	const { reconciliation, close, revisions } = input;
	const ws = wb.addWorksheet('Revisions & Close', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9,
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
		},
	});

	ws.columns = [
		{ width: 24 },
		{ width: 16 },
		{ width: 22 },
		{ width: 14 },
		{ width: 14 },
		{ width: 14 },
		{ width: 34 },
		{ width: 34 },
		{ width: 28 },
		{ width: 24 },
		{ width: 20 },
	];

	// Title
	ws.mergeCells(1, 1, 1, 6);
	const t = ws.getCell(1, 1);
	t.value = `Financial Close & Revision History — ${reconciliation.month_label}`;
	setFont(t, { bold: true, size: 13, color: TINT_PURPLE_HDR });
	ws.getRow(1).height = 24;

	// Section 1: Financial Close Metadata
	let rNum = 3;
	ws.mergeCells(rNum, 1, rNum, 4);
	const s1 = ws.getCell(rNum, 1);
	s1.value = 'Financial Close Status & Frozen Snapshot';
	setFont(s1, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s1, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	const closeRows = [
		['Close Status', close?.status === 'closed' ? 'Closed' : 'Open'],
		['Financial Version', String(close?.financial_version ?? 0)],
		['Close Snapshot UID', close?.close_uid || '—'],
		['Closed / Reviewed At', close?.reviewed_at || close?.created_at || '—'],
		[
			'Reviewed By (User ID)',
			close?.reviewed_by ? String(close.reviewed_by) : '—',
		],
		['Review Reason', close?.review_reason || '—'],
		['Evidence Reference', close?.evidence_reference || '—'],
		[
			'Frozen Incurred Cost (Snapshot)',
			close?.snapshot?.company.incurred_cost !== null &&
			close?.snapshot?.company.incurred_cost !== undefined
				? String(close.snapshot.company.incurred_cost)
				: '—',
		],
		[
			'Frozen Snapshot Currency',
			close?.snapshot?.company.currency ||
				close?.snapshot?.company.reporting_currency ||
				'—',
		],
	];

	for (const [k, v] of closeRows) {
		rNum++;
		const row = ws.getRow(rNum);
		row.height = 18;
		const c1 = row.getCell(1);
		c1.value = k;
		setFont(c1, { bold: true, size: 9.5 });
		setFill(c1, TINT_GRAY_LIGHT);
		box(c1);

		const c2 = row.getCell(2);
		c2.value = v;
		setFont(c2, { size: 9.5 });
		setFill(c2, TINT_GRAY_LIGHT);
		box(c2);
	}

	// Close Review Findings (Blockers & Warnings)
	if (close?.review) {
		const findings = [
			...close.review.blockers.map((b) => ({ type: 'Blocker (Error)', ...b })),
			...close.review.warnings.map((w) => ({ type: 'Warning', ...w })),
		];
		if (findings.length > 0) {
			rNum += 2;
			ws.mergeCells(rNum, 1, rNum, 4);
			const sf = ws.getCell(rNum, 1);
			sf.value = 'Close Review Findings';
			setFont(sf, { bold: true, size: 10, color: TINT_PURPLE_HDR });
			ws.getRow(rNum).height = 18;

			rNum++;
			const thF = ws.getRow(rNum);
			thF.height = 20;
			['Severity', 'Code', 'Label', 'Detail'].forEach((l, idx) => {
				const c = thF.getCell(idx + 1);
				c.value = l;
				setFont(c, { bold: true, size: 9 });
				setFill(c, TINT_PURPLE_SUB);
				box(c);
			});

			for (const f of findings) {
				rNum++;
				const row = ws.getRow(rNum);
				row.height = 18;
				row.getCell(1).value = f.type;
				row.getCell(2).value = f.code;
				row.getCell(3).value = f.label;
				row.getCell(4).value = f.detail;

				for (let i = 1; i <= 4; i++) {
					const c = row.getCell(i);
					setFont(c, { size: 9.5 });
					box(c);
					if (i === 1) {
						setFill(
							c,
							f.type.startsWith('Blocker') ? TINT_ERROR_LIGHT : TINT_WARN_LIGHT
						);
					}
				}
			}
		}
	}

	// Section 2: Financial Revisions
	rNum += 2;
	ws.mergeCells(rNum, 1, rNum, 11);
	const s2 = ws.getCell(rNum, 1);
	s2.value = 'Explicit Financial Revisions Log';
	setFont(s2, { bold: true, size: 11, color: 'FFFFFFFF' });
	setFill(s2, TINT_PURPLE_HDR);
	ws.getRow(rNum).height = 20;

	rNum++;
	ws.mergeCells(rNum, 1, rNum, 11);
	const s2sub = ws.getCell(rNum, 1);
	s2sub.value =
		close?.status === 'closed'
			? 'Explicit versioned corrections recorded against the frozen closed financial month.'
			: 'Month is open. Corrections travel through standard operational command paths.';
	setFont(s2sub, { size: 9, color: 'FF4B5563' });
	ws.getRow(rNum).height = 16;

	rNum++;
	const thRev = ws.getRow(rNum);
	thRev.height = 20;
	const revHeaders = [
		'Revision UID',
		'Target Kind',
		'Target Reference',
		'Command',
		'Prior Version',
		'New Version',
		'Prior Figures',
		'New Figures',
		'Reason',
		'Evidence Reference',
		'Recorded At',
	];
	revHeaders.forEach((label, idx) => {
		const c = thRev.getCell(idx + 1);
		c.value = label;
		setFont(c, { bold: true, size: 9 });
		setFill(c, TINT_PURPLE_SUB);
		box(c);
		c.alignment = {
			vertical: 'middle',
			horizontal: [5, 6].includes(idx + 1) ? 'right' : 'left',
		};
	});

	const revList = revisions?.revisions ?? [];
	if (revList.length === 0) {
		rNum++;
		ws.mergeCells(rNum, 1, rNum, 11);
		const emptyR = ws.getCell(rNum, 1);
		emptyR.value = 'No financial revisions recorded for this month.';
		setFont(emptyR, { size: 9.5 });
		box(emptyR);
		ws.getRow(rNum).height = 18;
	} else {
		for (const r of revList) {
			rNum++;
			const row = ws.getRow(rNum);
			row.height = 20;

			const pf = r.prior_figures;
			const nf = r.new_figures;
			const priorText =
				`${pf.amount ?? '—'} ${pf.currency ?? ''} (${pf.classification || pf.state || '—'}, ${pf.period || '—'})`.trim();
			const newText =
				`${nf.amount ?? '—'} ${nf.currency ?? ''} (${nf.classification || nf.state || '—'}, ${nf.period || '—'})`.trim();

			row.getCell(1).value = r.revision_uid;
			row.getCell(2).value = r.target_kind;
			row.getCell(3).value = r.target_label || r.target_uid;
			row.getCell(4).value = r.command;
			row.getCell(5).value = r.prior_version;
			row.getCell(6).value = r.new_version;
			row.getCell(7).value = priorText;
			row.getCell(8).value = newText;
			row.getCell(9).value = r.reason || '—';
			row.getCell(10).value = r.evidence_reference || '—';
			row.getCell(11).value = r.created_at;

			for (let i = 1; i <= 11; i++) {
				const c = row.getCell(i);
				setFont(c, { size: 9 });
				box(c);
				if ([5, 6].includes(i)) {
					c.alignment = { vertical: 'middle', horizontal: 'right' };
				}
			}
		}
	}
}

export function buildExpenditureWorkbook(
	input: ExpenditureExportInput
): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	buildExpenditureReconciliationSheet(wb, input);
	buildExpenditureProjectDetailSheet(wb, input);
	buildExpenditureBudgetsCommitmentsSheet(wb, input);
	buildExpenditureCashPaidSheet(wb, input);
	buildExpenditureRevisionsCloseSheet(wb, input);

	return wb;
}

export async function buildExpenditureWorkbookBuffer(
	input: ExpenditureExportInput
): Promise<Buffer> {
	const wb = buildExpenditureWorkbook(input);
	const ab = await wb.xlsx.writeBuffer();
	return Buffer.from(ab);
}
