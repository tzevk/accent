/**
 * Server-side Excel workbook builder for the Manhours Billing report.
 *
 * Mirrors the company's Excel billing template: a header block with
 * Client Name / Project Name-Number / Month-Year and a
 * Sr. No. | Employee Name | Designation | Monthly Salary CTC |
 * Hourly Rate CTC | Total Manhours | Amount grid with a totals row.
 * Uses the same visual conventions as the Timesheet/Project Activities
 * Excel exports (brand purple headers, hairline borders).
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { BillingData } from './data-source';

const BRAND_PURPLE = 'FF7F2487';
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
		{ width: 8 }, // Sr. No.
		{ width: 28 }, // Employee Name
		{ width: 22 }, // Designation
		{ width: 16 }, // Monthly Salary CTC
		{ width: 14 }, // Hourly Rate CTC
		{ width: 14 }, // Total Manhours
		{ width: 16 }, // Amount
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

		ws.mergeCells(`C${r}:G${r}`);
		ws.getCell(`C${r}`).value = value;
		setFont(ws.getCell(`C${r}`), { size: 10 });
		box(ws.getCell(`C${r}`));
		['D', 'E', 'F', 'G'].forEach((col) => box(ws.getCell(`${col}${r}`)));
		ws.getRow(r).height = 20;
	});

	// ── Row 5: table header ─────────────────────────────────────────
	const headerRow = 5;
	const headers = [
		'Sr. No.',
		'Employee Name',
		'Designation',
		'Monthly Salary CTC',
		'Hourly Rate CTC',
		'Total Manhours',
		'Amount',
	];
	headers.forEach((title, i) => {
		const cell = ws.getCell(headerRow, i + 1);
		cell.value = title;
		setFill(cell, BRAND_PURPLE);
		setFont(cell, { bold: true, size: 10, color: 'FFFFFFFF' });
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		box(cell);
	});
	ws.getRow(headerRow).height = 22;

	// ── Data rows ───────────────────────────────────────────────────
	const moneyFmt = '#,##0.00';
	const startRow = headerRow + 1;
	data.rows.forEach((row, i) => {
		const r = startRow + i;
		const values: (string | number)[] = [
			row.sr_no,
			row.employee_name,
			row.designation,
			row.monthly_salary_ctc,
			row.hourly_rate_ctc,
			row.total_manhours,
			row.amount,
		];
		values.forEach((v, col) => {
			const cell = ws.getCell(r, col + 1);
			cell.value = v;
			setFont(cell, { size: 10 });
			box(cell);
			if (col === 0) cell.alignment = { horizontal: 'center' };
			if (col >= 3) {
				cell.numFmt = moneyFmt;
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
	['A', 'B', 'C'].forEach((col) => box(ws.getCell(`${col}${totalRow}`)));

	const totalValues: [number, string][] = [
		[data.totals.total_manhours, 'F'],
		[data.totals.total_amount, 'G'],
	];
	for (const [value, col] of totalValues) {
		const cell = ws.getCell(`${col}${totalRow}`);
		cell.value = value;
		cell.numFmt = moneyFmt;
		setFont(cell, { bold: true, size: 10 });
		cell.alignment = { horizontal: 'right' };
		box(cell);
	}
	// D and E stay empty but boxed.
	['D', 'E'].forEach((col) => box(ws.getCell(`${col}${totalRow}`)));
	ws.getRow(totalRow).height = 20;

	return wb;
}

export async function buildWorkbookBuffer(data: BillingData): Promise<Buffer> {
	const wb = buildWorkbook(data);
	const bytes = await wb.xlsx.writeBuffer();
	return Buffer.from(bytes);
}
