/**
 * Server-side Excel workbook builder for the Manhours Billing report.
 *
 * Mirrors the company's Excel billing template: a header block with
 * Client Name / Project Name-Number / Month-Year and a
 * Sr. No. | Employee Name | Designation | Total Manhours | Employee
 * Charges | Amount | TDS | Net Payable | Accent Charges | Amount |
 * P&L (After Deductions | TDS) grid — two header rows, the ten plain
 * labels vertically merged and "P&L" merged across its two sub-columns,
 * with the template's section tints (yellow / blue / green / yellow+pink)
 * carried into the data rows. Totals row below.
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { BillingData } from './data-source';

// Section tints sampled from the company template (Excel palette fills).
const TINT_YELLOW = 'FFFFE598'; // Sr. No. | Employee Name | Designation
const TINT_BLUE = 'FFDCE2F2'; // Manhours | Charges | Amount | TDS | Net Payable
const TINT_GREEN = 'FFC6DFB4'; // Accent Charges | Amount
const TINT_PINK = 'FFF8CBAB'; // P&L → After Deductions
const TINT_YELLOW_BRIGHT = 'FFFFFF00'; // P&L header + P&L TDS

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
	const side = { style: 'thin' as const, color: { argb: GRAY_BORDER } };
	cell.border = { top: side, left: side, bottom: side, right: side };
}

function sanitizeName(name: string): string {
	return (
		name
			.replace(/[^A-Za-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.toUpperCase() || 'PROJECT'
	);
}

export function fileBaseForExcel(data: BillingData): string {
	const label = data.month_label.toUpperCase().replace(/ /g, '_');
	const client = sanitizeName(data.client_name).slice(0, 24);
	const code = sanitizeName(
		data.project.project_code || data.project.project_name
	);
	return `Manhours_Billing_${client}_${code}_${label}.xlsx`;
}

export function buildWorkbook(data: BillingData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Manhours Billing');

	ws.columns = [
		{ width: 7 }, // Sr. No.
		{ width: 22 }, // Employee Name
		{ width: 14 }, // Designation
		{ width: 10 }, // Total Manhours
		{ width: 11 }, // Employee Charges
		{ width: 12 }, // Amount
		{ width: 10 }, // TDS
		{ width: 12 }, // Net Payable
		{ width: 11 }, // Accent Charges
		{ width: 12 }, // Amount
		{ width: 12 }, // P&L → After Deductions
		{ width: 10 }, // P&L → TDS
	];

	// ── Rows 1–3: header block ──────────────────────────────────────
	const headerFields: [string, string][] = [
		['Client Name :', data.client_name],
		[
			'Project Name/Number :',
			[data.project.project_code, data.project.project_name]
				.filter(Boolean)
				.join(' - '),
		],
		['Month/Year :', data.month_label],
	];

	headerFields.forEach(([label, value], idx) => {
		const r = idx + 1;
		ws.mergeCells(`A${r}:B${r}`);
		ws.getCell(`A${r}`).value = label;
		setFont(ws.getCell(`A${r}`), { bold: true, size: 10, color: 'FF4B5563' });
		box(ws.getCell(`A${r}`));
		box(ws.getCell(`B${r}`));

		ws.mergeCells(`C${r}:L${r}`);
		ws.getCell(`C${r}`).value = value;
		setFont(ws.getCell(`C${r}`), { size: 10 });
		box(ws.getCell(`C${r}`));
		['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach((col) =>
			box(ws.getCell(`${col}${r}`))
		);
		ws.getRow(r).height = 20;
	});

	// ── Rows 5–6: two-row table header ──────────────────────────────
	// Row 5: ten vertically-merged labels + "P&L" across the last two.
	// Row 6: "After Deductions" / "TDS" under P&L.
	const headerRow = 5;
	const headers: {
		title: string;
		tint: string;
		align: 'left' | 'center' | 'right';
	}[] = [
		{ title: 'Sr. No.', tint: TINT_YELLOW, align: 'center' },
		{ title: 'Employee Name', tint: TINT_YELLOW, align: 'left' },
		{ title: 'Designation', tint: TINT_YELLOW, align: 'left' },
		{ title: 'Total Manhours', tint: TINT_BLUE, align: 'right' },
		{ title: 'Employee Charges', tint: TINT_BLUE, align: 'right' },
		{ title: 'Amount', tint: TINT_BLUE, align: 'right' },
		{ title: 'TDS', tint: TINT_BLUE, align: 'right' },
		{ title: 'Net Payable', tint: TINT_BLUE, align: 'right' },
		{ title: 'Accent Charges', tint: TINT_GREEN, align: 'right' },
		{ title: 'Amount', tint: TINT_GREEN, align: 'right' },
	];
	headers.forEach((h, i) => {
		const col = i + 1;
		const top = ws.getCell(headerRow, col);
		const bottom = ws.getCell(headerRow + 1, col);
		ws.mergeCells(headerRow, col, headerRow + 1, col);
		top.value = h.title;
		setFill(top, h.tint);
		setFill(bottom, h.tint);
		setFont(top, { bold: true, size: 10, color: 'FF111827' });
		top.alignment = { horizontal: h.align, vertical: 'middle' };
		box(top);
		box(bottom);
	});

	// P&L merged across the last two columns (K:L), bright yellow.
	ws.mergeCells(headerRow, 11, headerRow, 12);
	const pnlHeader = ws.getCell(headerRow, 11);
	pnlHeader.value = 'P&L';
	setFill(pnlHeader, TINT_YELLOW_BRIGHT);
	setFont(pnlHeader, { bold: true, size: 10, color: 'FF111827' });
	pnlHeader.alignment = { horizontal: 'center', vertical: 'middle' };
	box(pnlHeader);
	box(ws.getCell(headerRow, 12));

	// Row 6 sub-columns: pink "After Deductions", bright-yellow "TDS".
	const afterDeductions = ws.getCell(headerRow + 1, 11);
	afterDeductions.value = 'After Deductions';
	setFill(afterDeductions, TINT_PINK);
	setFont(afterDeductions, { bold: true, size: 10, color: 'FF111827' });
	afterDeductions.alignment = { horizontal: 'right', vertical: 'middle' };
	box(afterDeductions);

	const pnlTds = ws.getCell(headerRow + 1, 12);
	pnlTds.value = 'TDS';
	setFill(pnlTds, TINT_YELLOW_BRIGHT);
	setFont(pnlTds, { bold: true, size: 10, color: 'FF111827' });
	pnlTds.alignment = { horizontal: 'right', vertical: 'middle' };
	box(pnlTds);

	ws.getRow(headerRow).height = 24;
	ws.getRow(headerRow + 1).height = 20;

	// ── Data rows ───────────────────────────────────────────────────
	const moneyFmt = '#,##0.00';
	const hoursFmt = '0.##';
	// Tint + number format per column (1-based), matching the section colors.
	const colStyles: { tint: string; money: boolean }[] = [
		{ tint: TINT_YELLOW, money: false }, // Sr. No.
		{ tint: TINT_YELLOW, money: false }, // Employee Name
		{ tint: TINT_YELLOW, money: false }, // Designation
		{ tint: TINT_BLUE, money: false }, // Total Manhours
		{ tint: TINT_BLUE, money: true }, // Employee Charges
		{ tint: TINT_BLUE, money: true }, // Amount
		{ tint: TINT_BLUE, money: true }, // TDS
		{ tint: TINT_BLUE, money: true }, // Net Payable
		{ tint: TINT_GREEN, money: true }, // Accent Charges
		{ tint: TINT_GREEN, money: true }, // Amount
		{ tint: TINT_PINK, money: true }, // P&L After Deductions
		{ tint: TINT_YELLOW_BRIGHT, money: true }, // P&L TDS
	];
	const startRow = headerRow + 2;
	data.rows.forEach((row, i) => {
		const r = startRow + i;
		const values: (string | number)[] = [
			row.sr_no,
			row.employee_name,
			row.designation,
			row.total_manhours,
			row.employee_charges,
			row.amount,
			row.tds,
			row.net_payable,
			row.accent_charges,
			row.accent_amount,
			row.pnl_after_deductions,
			row.pnl_tds,
		];
		values.forEach((v, col) => {
			const cell = ws.getCell(r, col + 1);
			cell.value = v;
			setFont(cell, { size: 10 });
			setFill(cell, colStyles[col].tint);
			box(cell);
			if (col === 0) cell.alignment = { horizontal: 'center' };
			if (col === 1 || col === 2) cell.alignment = { horizontal: 'left' };
			if (col >= 3) {
				cell.numFmt = colStyles[col].money ? moneyFmt : hoursFmt;
				cell.alignment = { horizontal: 'right' };
			}
		});
		ws.getRow(r).height = 18;
	});

	// ── Totals row ──────────────────────────────────────────────────
	const totalRow = startRow + data.rows.length;
	ws.mergeCells(`A${totalRow}:C${totalRow}`);
	ws.getCell(`A${totalRow}`).value = 'Total';
	setFont(ws.getCell(`A${totalRow}`), { bold: true, size: 10 });
	ws.getCell(`A${totalRow}`).alignment = { horizontal: 'right' };
	['A', 'B', 'C'].forEach((col) => {
		box(ws.getCell(`${col}${totalRow}`));
		setFill(ws.getCell(`${col}${totalRow}`), TINT_YELLOW);
	});

	const totalValues: [number, string][] = [
		[data.totals.total_manhours, 'D'],
		[data.totals.total_amount, 'F'],
		[data.totals.total_tds, 'G'],
		[data.totals.total_net_payable, 'H'],
		[data.totals.total_accent_amount, 'J'],
		[data.totals.total_pnl_after_deductions, 'K'],
		[data.totals.total_pnl_tds, 'L'],
	];
	for (const [value, col] of totalValues) {
		const cell = ws.getCell(`${col}${totalRow}`);
		cell.value = value;
		cell.numFmt = col === 'D' ? hoursFmt : moneyFmt;
		setFont(cell, { bold: true, size: 10 });
		cell.alignment = { horizontal: 'right' };
		box(cell);
	}
	// Tinted, empty rate cells on the totals row (E and I stay blank).
	(
		[
			['E', TINT_BLUE],
			['I', TINT_GREEN],
		] as [string, string][]
	).forEach(([col, tint]) => {
		const cell = ws.getCell(`${col}${totalRow}`);
		setFill(cell, tint);
		box(cell);
	});
	// Tints for the remaining totals cells.
	(
		[
			['D', TINT_BLUE],
			['F', TINT_BLUE],
			['G', TINT_BLUE],
			['H', TINT_BLUE],
			['J', TINT_GREEN],
			['K', TINT_PINK],
			['L', TINT_YELLOW_BRIGHT],
		] as [string, string][]
	).forEach(([col, tint]) => {
		setFill(ws.getCell(`${col}${totalRow}`), tint);
	});
	ws.getRow(totalRow).height = 20;

	// Print setup: landscape A4, fit to width (12 columns need the room).
	ws.pageSetup = {
		orientation: 'landscape',
		fitToPage: true,
		fitToWidth: 1,
		fitToHeight: 0,
		paperSize: 9, // A4
	};

	return wb;
}

export async function buildWorkbookBuffer(data: BillingData): Promise<Buffer> {
	const wb = buildWorkbook(data);
	const bytes = await wb.xlsx.writeBuffer();
	return Buffer.from(bytes);
}
