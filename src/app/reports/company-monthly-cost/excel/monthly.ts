/**
 * Server-side Excel workbook builder for the Company Monthly Cost report.
 *
 * New company-wide views:
 * - Monthly (YYYY-MM): 3 sheets
 *   1. "Detailed" — per employee-project hours & cost for that month
 *   2. "By Employee" — per employee totals for that month
 *   3. "By Project" — per project totals for that month
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { MonthlyCompanyCostData } from '../employee-cost-data-source';
import {
	TINT_YELLOW,
	TINT_BLUE,
	TINT_AMBER_LIGHT,
	TINT_PURPLE_LIGHT,
	TINT_GREEN,
	TINT_EMP,
	TINT_PROJ,
	setFill,
	setFont,
	box,
	sanitizeName,
} from './theme';

export function fileBaseForMonthlyExcel(data: MonthlyCompanyCostData): string {
	const m = sanitizeName(data.month);
	return `Company_Cost_Monthly_${m}.xlsx`;
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
		row.height = r.missing_salary_profile ? 32 : 18;
		const vals: Array<{
			val: string | number;
			tint: string;
			numFmt?: string;
			bold?: boolean;
			align: 'left' | 'center' | 'right';
		}> = [
			{ val: r.sr_no, tint: TINT_YELLOW, align: 'center' },
			{
				val: `${r.employee_name} (${r.employee_code || r.employee_id})${r.missing_salary_profile ? ' — Salary Profile missing (unpriced)' : ''}`,
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
			c.alignment = {
				vertical: 'middle',
				horizontal: v.align,
				wrapText: r.missing_salary_profile,
			};
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
	lbl.value = `${data.payroll.missing_pricing_count > 0 ? 'Available cost — partial' : 'Grand Total — Company Cost'} for ${data.month_label}`;
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
		row.height = r.missing_salary_profile ? 32 : 18;
		const vals: Array<{
			val: string | number;
			tint: string;
			numFmt?: string;
			align: 'left' | 'center' | 'right';
			bold?: boolean;
		}> = [
			{ val: r.sr_no, tint: TINT_YELLOW, align: 'center' },
			{
				val: `${r.employee_name} (${r.employee_code || r.employee_id})${r.missing_salary_profile ? ' — Salary Profile missing (unpriced)' : ''}`,
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
			c.alignment = {
				vertical: 'middle',
				horizontal: v.align,
				wrapText: r.missing_salary_profile,
			};
			if (v.numFmt) c.numFmt = v.numFmt;
			box(c);
		});
		rn++;
	}

	const tr = ws.getRow(rn);
	tr.height = 20;
	ws.mergeCells(rn, 1, rn, 5);
	const l = tr.getCell(1);
	l.value =
		data.payroll.missing_pricing_count > 0
			? 'Available cost — partial'
			: 'Grand Total';
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
		row.height = r.missing_salary_profile_count > 0 ? 32 : 18;
		const vals: Array<{
			val: string | number;
			tint: string;
			numFmt?: string;
			align: 'left' | 'center' | 'right';
			bold?: boolean;
		}> = [
			{ val: r.sr_no, tint: TINT_YELLOW, align: 'center' },
			{
				val: `${[r.project_code, r.project_name].filter(Boolean).join(' – ')}${r.missing_salary_profile_count > 0 ? ` — Partial: ${r.missing_salary_profile_count} missing Salary Profile(s)` : ''}`,
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
			c.alignment = {
				vertical: 'middle',
				horizontal: v.align,
				wrapText: r.missing_salary_profile_count > 0,
			};
			if (v.numFmt) c.numFmt = v.numFmt;
			box(c);
		});
		rn++;
	}

	const tr = ws.getRow(rn);
	tr.height = 20;
	ws.mergeCells(rn, 1, rn, 3);
	const l = tr.getCell(1);
	l.value =
		data.payroll.missing_pricing_count > 0
			? 'Available cost — partial'
			: 'Grand Total';
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
	if (data.payroll.missing_pricing_count > 0) {
		for (const sheet of wb.worksheets) {
			const notice = sheet.getCell(2, 1);
			notice.value = `${notice.value} · Partial cost: ${data.payroll.missing_pricing_count} employee(s) have no covering Salary Profile. Their hours remain included; zero is an unpriced placeholder.`;
			notice.alignment = { ...notice.alignment, wrapText: true };
			sheet.getRow(2).height = 42;
			setFont(notice, { size: 10, color: 'FF92400E' });
		}
	}
	return wb;
}

export async function buildMonthlyWorkbookBuffer(
	data: MonthlyCompanyCostData
): Promise<Buffer> {
	const wb = buildMonthlyWorkbook(data);
	const ab = await wb.xlsx.writeBuffer();
	return Buffer.from(ab);
}
