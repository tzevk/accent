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
