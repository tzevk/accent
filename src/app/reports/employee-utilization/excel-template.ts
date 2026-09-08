/**
 * Server-side Excel workbook builder for the Employee Utilization report.
 *
 * One sheet ("Utilization") mirroring the team month view: one row per
 * employee in the server's default sort (flag band, then bench cost
 * descending) plus a totals footer. Money columns use a 2dp number format
 * with the rupee carried in the header; rows without a covering salary
 * profile leave all three money cells blank (never zero, never "—").
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server routes.
 */

import ExcelJS from 'exceljs';
import type { UtilizationData } from './data-source';

const TINT_YELLOW = 'FFFFE598'; // Sr.
const TINT_EMP = 'FFFEF3C7'; // Employee
const TINT_PURPLE_LIGHT = 'FFE1D5E7'; // Capacity / Logged hours
const TINT_BLUE = 'FFDCE2F2'; // Utilization / Flag
const TINT_GREEN = 'FFC6DFB4'; // Money columns

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

function bandText(band: string | null): string {
	if (band === 'under') return 'Under';
	if (band === 'healthy') return 'Healthy';
	if (band === 'over') return 'Over';
	return 'No capacity';
}

function flagSuffix(data: UtilizationData): string {
	if (data.flag === 'under') return '_under';
	if (data.flag === 'healthy') return '_healthy';
	if (data.flag === 'over') return '_over';
	return '';
}

export function fileBaseForExcel(data: UtilizationData): string {
	return `Utilization_${sanitizeName(data.month)}${flagSuffix(data)}.xlsx`;
}

export function buildWorkbook(data: UtilizationData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	const ws = wb.addWorksheet('Utilization', {
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
		{ key: 'employee', width: 32 },
		{ key: 'capacity', width: 13 },
		{ key: 'logged', width: 13 },
		{ key: 'utilization', width: 14 },
		{ key: 'flag', width: 13 },
		{ key: 'monthly', width: 16 },
		{ key: 'utilized', width: 16 },
		{ key: 'bench', width: 16 },
		{ key: 'note', width: 13 },
	];

	const titleSuffix = data.flag ? ` (${bandText(data.flag)} band)` : '';
	ws.mergeCells(1, 1, 1, 10);
	const title = ws.getCell(1, 1);
	title.value = `Employee Utilization — ${data.month_label}${titleSuffix}`;
	setFont(title, { bold: true, size: 13 });
	title.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 22;

	ws.mergeCells(2, 1, 2, 10);
	const sub = ws.getCell(2, 1);
	sub.value =
		`Team capacity vs logged hours · ${data.totals.employee_count} employees · ` +
		`${data.totals.priced_count} priced · ${data.totals.unpriced_count} unpriced · ` +
		`Sorted by flag band, then bench cost descending · Generated ${new Date().toLocaleDateString('en-IN')}`;
	setFont(sub, { size: 10, color: 'FF6B7280' });
	sub.alignment = { vertical: 'middle', horizontal: 'left' };

	const header = ws.getRow(3);
	header.height = 22;
	const headers: Array<{
		col: number;
		label: string;
		tint: string;
		align: 'left' | 'center' | 'right';
	}> = [
		{ col: 1, label: 'Sr.', tint: TINT_YELLOW, align: 'center' },
		{ col: 2, label: 'Employee', tint: TINT_EMP, align: 'left' },
		{ col: 3, label: 'Capacity (h)', tint: TINT_PURPLE_LIGHT, align: 'right' },
		{ col: 4, label: 'Logged (h)', tint: TINT_PURPLE_LIGHT, align: 'right' },
		{ col: 5, label: 'Utilization %', tint: TINT_BLUE, align: 'right' },
		{ col: 6, label: 'Flag', tint: TINT_BLUE, align: 'left' },
		{ col: 7, label: 'Monthly Cost (₹)', tint: TINT_GREEN, align: 'right' },
		{ col: 8, label: 'Utilized Cost (₹)', tint: TINT_GREEN, align: 'right' },
		{ col: 9, label: 'Bench Cost (₹)', tint: TINT_GREEN, align: 'right' },
		{ col: 10, label: 'Note', tint: TINT_EMP, align: 'left' },
	];
	for (const h of headers) {
		const c = header.getCell(h.col);
		c.value = h.label;
		setFont(c, { bold: true, size: 9.5 });
		setFill(c, h.tint);
		c.alignment = {
			vertical: 'middle',
			horizontal: h.align,
			wrapText: true,
		};
		box(c);
	}

	let rowNum = 4;
	data.rows.forEach((r, index) => {
		const row = ws.getRow(rowNum);
		row.height = 18;
		const employeeLabel = r.employee_code
			? `${r.employee_name} (${r.employee_code})`
			: r.employee_name;

		const cells: Array<{
			val: string | number | null;
			tint: string;
			numFmt?: string;
			bold?: boolean;
			align: 'left' | 'center' | 'right';
		}> = [
			{ val: index + 1, tint: TINT_YELLOW, align: 'center' },
			{ val: employeeLabel, tint: TINT_EMP, align: 'left' },
			{
				val: r.capacity_hours,
				tint: TINT_PURPLE_LIGHT,
				align: 'right',
				numFmt: '#,##0.##',
			},
			{
				val: r.logged_hours,
				tint: TINT_PURPLE_LIGHT,
				align: 'right',
				numFmt: '#,##0.##',
			},
			{
				val: r.utilization_percent,
				tint: TINT_BLUE,
				align: 'right',
				numFmt: '#,##0.00"%"',
			},
			{ val: bandText(r.utilization_band), tint: TINT_BLUE, align: 'left' },
			// Unpriced rows stay blank — never zero, never a dash string.
			{
				val: r.monthly_cost,
				tint: TINT_GREEN,
				align: 'right',
				numFmt: '#,##0.00',
			},
			{
				val: r.fractional_cost,
				tint: TINT_GREEN,
				align: 'right',
				numFmt: '#,##0.00',
			},
			{
				val: r.bench_cost,
				tint: TINT_GREEN,
				align: 'right',
				numFmt: '#,##0.00',
				bold: true,
			},
			{
				val: r.cost_status === 'no-profile' ? 'No profile' : null,
				tint: TINT_EMP,
				align: 'left',
			},
		];

		cells.forEach((v, idx) => {
			const c = row.getCell(idx + 1);
			c.value = v.val;
			setFont(c, { bold: v.bold ?? false, size: 9.5 });
			setFill(c, v.tint);
			c.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt && v.val !== null) c.numFmt = v.numFmt;
			box(c);
		});
		rowNum++;
	});

	// Totals footer — same numbers as the screen footer; money totals are
	// blank when no priced rows exist.
	const totalRow = ws.getRow(rowNum);
	totalRow.height = 20;
	ws.mergeCells(rowNum, 1, rowNum, 2);
	const lbl = totalRow.getCell(1);
	lbl.value = `Total (${data.totals.employee_count} employees)`;
	setFont(lbl, { bold: true, size: 10 });
	lbl.alignment = { vertical: 'middle', horizontal: 'right' };
	box(lbl);
	box(totalRow.getCell(2));

	const totals: Array<{
		col: number;
		val: string | number | null;
		tint: string;
		numFmt?: string;
	}> = [
		{
			col: 3,
			val: data.totals.capacity_hours,
			tint: TINT_PURPLE_LIGHT,
			numFmt: '#,##0.##',
		},
		{
			col: 4,
			val: data.totals.logged_hours,
			tint: TINT_PURPLE_LIGHT,
			numFmt: '#,##0.##',
		},
		{
			col: 5,
			val: data.totals.utilization_percent,
			tint: TINT_BLUE,
			numFmt: '#,##0.00"%"',
		},
		{ col: 6, val: null, tint: TINT_BLUE },
		{
			col: 7,
			val: data.totals.monthly_cost,
			tint: TINT_GREEN,
			numFmt: '#,##0.00',
		},
		{
			col: 8,
			val: data.totals.fractional_cost,
			tint: TINT_GREEN,
			numFmt: '#,##0.00',
		},
		{
			col: 9,
			val: data.totals.bench_cost,
			tint: TINT_GREEN,
			numFmt: '#,##0.00',
		},
		{ col: 10, val: null, tint: TINT_EMP },
	];
	for (const t of totals) {
		const cell = totalRow.getCell(t.col);
		cell.value = t.val;
		setFont(cell, { bold: true, size: 10 });
		setFill(cell, t.tint);
		cell.alignment = {
			vertical: 'middle',
			horizontal: t.col <= 6 ? 'right' : 'right',
		};
		if (t.numFmt && t.val !== null) cell.numFmt = t.numFmt;
		box(cell);
	}

	ws.views = [{ state: 'frozen', ySplit: 3 }];
	return wb;
}

export async function buildWorkbookBuffer(
	data: UtilizationData
): Promise<Buffer> {
	const wb = buildWorkbook(data);
	const arrayBuffer = await wb.xlsx.writeBuffer();
	return Buffer.from(arrayBuffer);
}
