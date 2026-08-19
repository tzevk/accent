/**
 * Server-side Excel workbook builder for the Manhours Billing report.
 *
 * Supports two templates:
 * 1. Monthly Billing Statement (buildWorkbook / buildWorkbookBuffer)
 * 2. Annual FY Deputation Matrix (buildAnnualWorkbook / buildAnnualWorkbookBuffer)
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { BillingData, AnnualBillingData } from './data-source';

// Section tints sampled from the company template (Excel palette fills).
const TINT_YELLOW = 'FFFFE598'; // Sr. No. | Employee Name | Designation
const TINT_BLUE = 'FFDCE2F2'; // Manhours | Charges | Amount | TDS | Net Payable
const TINT_GREEN = 'FFC6DFB4'; // Accent Charges | Amount
const TINT_PINK = 'FFF8CBAB'; // P&L → After Deductions
const TINT_YELLOW_BRIGHT = 'FFFFFF00'; // P&L header + P&L TDS
const TINT_AMBER_LIGHT = 'FFFFF2CC'; // Monthly hours Apr–Mar
const TINT_PURPLE_LIGHT = 'FFE1D5E7'; // Total hours column

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

export function fileBaseForExcel(data: BillingData): string {
	const c = sanitizeName(data.client_name || 'Client');
	const p = sanitizeName(
		data.project.project_code || `Proj_${data.project.project_id}`
	);
	return `Manhours_Billing_${c}_${p}_${data.month}.xlsx`;
}

export function fileBaseForAnnualExcel(data: AnnualBillingData): string {
	const c = sanitizeName(data.client_name || 'Client');
	const p = sanitizeName(
		data.project.project_code || `Proj_${data.project.project_id}`
	);
	const fy = sanitizeName(data.fy_label || `FY_${data.fy_year}`);
	return `Deputation_Summary_${c}_${p}_${fy}.xlsx`;
}

// ─── 1. Monthly Billing Statement Template ──────────────────────────

export function buildWorkbook(data: BillingData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	const ws = wb.addWorksheet('Manhours Billing', {
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
		{ key: 'employee_name', width: 26 },
		{ key: 'designation', width: 18 },
		{ key: 'total_manhours', width: 14 },
		{ key: 'employee_charges', width: 15 },
		{ key: 'amount', width: 15 },
		{ key: 'tds', width: 13 },
		{ key: 'net_payable', width: 15 },
		{ key: 'accent_charges', width: 15 },
		{ key: 'accent_amount', width: 15 },
		{ key: 'pnl_after_deductions', width: 17 },
		{ key: 'pnl_tds', width: 15 },
	];

	// Header block (Rows 1–3)
	const projectLabel = [data.project.project_code, data.project.project_name]
		.filter(Boolean)
		.join(' - ');

	const headerSpecs = [
		{ label: 'Client Name :', value: data.client_name },
		{ label: 'Project Name/Number :', value: projectLabel },
		{ label: 'Month/Year :', value: data.month_label },
	];

	headerSpecs.forEach((spec, idx) => {
		const rowNum = idx + 1;
		const row = ws.getRow(rowNum);
		row.height = 20;

		const cellA = row.getCell(1);
		cellA.value = spec.label;
		setFont(cellA, { bold: true, size: 10 });
		cellA.alignment = { vertical: 'middle', horizontal: 'left' };
		box(cellA);

		ws.mergeCells(rowNum, 2, rowNum, 12);
		const cellB = row.getCell(2);
		cellB.value = spec.value;
		setFont(cellB, { bold: false, size: 10 });
		cellB.alignment = { vertical: 'middle', horizontal: 'left' };
		for (let c = 2; c <= 12; c++) {
			box(row.getCell(c));
		}
	});

	ws.getRow(4).height = 10;

	// Table Header (Rows 5–6)
	const row5 = ws.getRow(5);
	const row6 = ws.getRow(6);
	row5.height = 22;
	row6.height = 22;

	const plainColumns: Array<{
		col: number;
		label: string;
		align: 'left' | 'center' | 'right';
		tint: string;
	}> = [
		{ col: 1, label: 'Sr. No.', align: 'center', tint: TINT_YELLOW },
		{ col: 2, label: 'Employee Name', align: 'left', tint: TINT_YELLOW },
		{ col: 3, label: 'Designation', align: 'left', tint: TINT_YELLOW },
		{ col: 4, label: 'Total Manhours', align: 'right', tint: TINT_BLUE },
		{ col: 5, label: 'Employee Charges', align: 'right', tint: TINT_BLUE },
		{ col: 6, label: 'Amount', align: 'right', tint: TINT_BLUE },
		{ col: 7, label: 'TDS', align: 'right', tint: TINT_BLUE },
		{ col: 8, label: 'Net Payable', align: 'right', tint: TINT_BLUE },
		{ col: 9, label: 'Accent Charges', align: 'right', tint: TINT_GREEN },
		{ col: 10, label: 'Amount', align: 'right', tint: TINT_GREEN },
	];

	for (const pc of plainColumns) {
		ws.mergeCells(5, pc.col, 6, pc.col);
		const cell = row5.getCell(pc.col);
		cell.value = pc.label;
		setFont(cell, { bold: true, size: 9.5 });
		setFill(cell, pc.tint);
		cell.alignment = {
			vertical: 'middle',
			horizontal: pc.align,
			wrapText: true,
		};
		box(cell);
		box(row6.getCell(pc.col));
	}

	ws.mergeCells(5, 11, 5, 12);
	const cellPnl = row5.getCell(11);
	cellPnl.value = 'P&L';
	setFont(cellPnl, { bold: true, size: 9.5 });
	setFill(cellPnl, TINT_YELLOW_BRIGHT);
	cellPnl.alignment = { vertical: 'middle', horizontal: 'center' };
	box(cellPnl);
	box(row5.getCell(12));

	const cellAfterDed = row6.getCell(11);
	cellAfterDed.value = 'After Deductions';
	setFont(cellAfterDed, { bold: true, size: 9 });
	setFill(cellAfterDed, TINT_PINK);
	cellAfterDed.alignment = { vertical: 'middle', horizontal: 'right' };
	box(cellAfterDed);

	const cellPnlTds = row6.getCell(12);
	cellPnlTds.value = 'TDS';
	setFont(cellPnlTds, { bold: true, size: 9 });
	setFill(cellPnlTds, TINT_YELLOW_BRIGHT);
	cellPnlTds.alignment = { vertical: 'middle', horizontal: 'right' };
	box(cellPnlTds);

	// Data rows (Row 7+)
	let currentRowNum = 7;
	for (const r of data.rows) {
		const row = ws.getRow(currentRowNum);
		row.height = 20;

		const values: Array<{
			val: number | string;
			align: 'left' | 'center' | 'right';
			numFmt?: string;
			tint: string;
			bold?: boolean;
		}> = [
			{ val: r.sr_no, align: 'center', tint: TINT_YELLOW },
			{ val: r.employee_name, align: 'left', tint: TINT_YELLOW },
			{ val: r.designation || '—', align: 'left', tint: TINT_YELLOW },
			{
				val: r.total_manhours,
				align: 'right',
				numFmt: '#,##0.##',
				tint: TINT_BLUE,
			},
			{
				val: r.employee_charges,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
			},
			{
				val: r.amount,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
				bold: true,
			},
			{ val: r.tds, align: 'right', numFmt: '#,##0.00', tint: TINT_BLUE },
			{
				val: r.net_payable,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
			},
			{
				val: r.accent_charges,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_GREEN,
			},
			{
				val: r.accent_amount,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_GREEN,
			},
			{
				val: r.pnl_after_deductions,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_PINK,
			},
			{
				val: r.pnl_tds,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_YELLOW_BRIGHT,
			},
		];

		values.forEach((v, idx) => {
			const cell = row.getCell(idx + 1);
			cell.value = v.val;
			setFont(cell, { bold: v.bold ?? false, size: 9.5 });
			setFill(cell, v.tint);
			cell.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt) cell.numFmt = v.numFmt;
			box(cell);
		});

		currentRowNum++;
	}

	// Totals row
	const totalRow = ws.getRow(currentRowNum);
	totalRow.height = 22;

	ws.mergeCells(currentRowNum, 1, currentRowNum, 3);
	const cellTotalLabel = totalRow.getCell(1);
	cellTotalLabel.value = 'Total';
	setFont(cellTotalLabel, { bold: true, size: 10 });
	setFill(cellTotalLabel, TINT_YELLOW);
	cellTotalLabel.alignment = { vertical: 'middle', horizontal: 'right' };
	box(cellTotalLabel);
	box(totalRow.getCell(2));
	box(totalRow.getCell(3));

	const totalCells: Array<{
		col: number;
		val: number | string;
		numFmt?: string;
		tint: string;
	}> = [
		{
			col: 4,
			val: data.totals.total_manhours,
			numFmt: '#,##0.##',
			tint: TINT_BLUE,
		},
		{ col: 5, val: '', tint: TINT_BLUE },
		{
			col: 6,
			val: data.totals.total_amount,
			numFmt: '#,##0.00',
			tint: TINT_BLUE,
		},
		{ col: 7, val: data.totals.total_tds, numFmt: '#,##0.00', tint: TINT_BLUE },
		{
			col: 8,
			val: data.totals.total_net_payable,
			numFmt: '#,##0.00',
			tint: TINT_BLUE,
		},
		{ col: 9, val: '', tint: TINT_GREEN },
		{
			col: 10,
			val: data.totals.total_accent_amount,
			numFmt: '#,##0.00',
			tint: TINT_GREEN,
		},
		{
			col: 11,
			val: data.totals.total_pnl_after_deductions,
			numFmt: '#,##0.00',
			tint: TINT_PINK,
		},
		{
			col: 12,
			val: data.totals.total_pnl_tds,
			numFmt: '#,##0.00',
			tint: TINT_YELLOW_BRIGHT,
		},
	];

	for (const tc of totalCells) {
		const cell = totalRow.getCell(tc.col);
		cell.value = tc.val;
		setFont(cell, { bold: true, size: 10 });
		setFill(cell, tc.tint);
		cell.alignment = { vertical: 'middle', horizontal: 'right' };
		if (tc.numFmt) cell.numFmt = tc.numFmt;
		box(cell);
	}

	return wb;
}

export async function buildWorkbookBuffer(data: BillingData): Promise<Buffer> {
	const wb = buildWorkbook(data);
	const arrayBuffer = await wb.xlsx.writeBuffer();
	return Buffer.from(arrayBuffer);
}

// ─── 2. Annual FY Deputation Matrix Template ────────────────────────

export function buildAnnualWorkbook(data: AnnualBillingData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	const ws = wb.addWorksheet('Deputation Summary', {
		pageSetup: {
			orientation: 'landscape',
			paperSize: 9, // A4
			fitToPage: true,
			fitToWidth: 1,
			fitToHeight: 0,
			margins: {
				left: 0.3,
				right: 0.3,
				top: 0.4,
				bottom: 0.4,
				header: 0.2,
				footer: 0.2,
			},
		},
	});

	ws.columns = [
		{ key: 'sr_no', width: 6 },
		{ key: 'employee_name', width: 26 },
		{ key: 'salary_type', width: 13 },
		{ key: 'rate_company', width: 14 },
		{ key: 'rate_accent', width: 14 },
		// 12 months columns
		{ key: 'apr', width: 9 },
		{ key: 'may', width: 9 },
		{ key: 'jun', width: 9 },
		{ key: 'jul', width: 9 },
		{ key: 'aug', width: 9 },
		{ key: 'sep', width: 9 },
		{ key: 'oct', width: 9 },
		{ key: 'nov', width: 9 },
		{ key: 'dec', width: 9 },
		{ key: 'jan', width: 9 },
		{ key: 'feb', width: 9 },
		{ key: 'mar', width: 9 },
		// Totals
		{ key: 'total_hours', width: 12 },
		{ key: 'company_cost', width: 16 },
		{ key: 'accent_cost', width: 16 },
		{ key: 'pnl', width: 16 },
	];

	// Header block (Rows 1–3)
	const projectLabel = [data.project.project_code, data.project.project_name]
		.filter(Boolean)
		.join(' - ');

	const headerSpecs = [
		{ label: 'Client Name :', value: data.client_name },
		{ label: 'Project Name/Number :', value: projectLabel },
		{ label: 'Period / Financial Year :', value: data.fy_label },
	];

	headerSpecs.forEach((spec, idx) => {
		const rowNum = idx + 1;
		const row = ws.getRow(rowNum);
		row.height = 20;

		const cellA = row.getCell(1);
		cellA.value = spec.label;
		setFont(cellA, { bold: true, size: 10 });
		cellA.alignment = { vertical: 'middle', horizontal: 'left' };
		box(cellA);

		ws.mergeCells(rowNum, 2, rowNum, 21);
		const cellB = row.getCell(2);
		cellB.value = spec.value;
		setFont(cellB, { bold: false, size: 10 });
		cellB.alignment = { vertical: 'middle', horizontal: 'left' };
		for (let c = 2; c <= 21; c++) {
			box(row.getCell(c));
		}
	});

	ws.getRow(4).height = 10;

	// Table Header (Row 5)
	const row5 = ws.getRow(5);
	row5.height = 24;

	const colHeaders: Array<{
		col: number;
		label: string;
		align: 'left' | 'center' | 'right';
		tint: string;
	}> = [
		{ col: 1, label: 'Sr. No.', align: 'center', tint: TINT_YELLOW },
		{ col: 2, label: 'Team Member', align: 'left', tint: TINT_YELLOW },
		{ col: 3, label: 'Salary Type', align: 'center', tint: TINT_YELLOW },
		{ col: 4, label: 'RT/HR (Company)', align: 'right', tint: TINT_BLUE },
		{ col: 5, label: 'RT/HR (Accent)', align: 'right', tint: TINT_BLUE },
		// 12 Months
		{ col: 6, label: 'Apr', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 7, label: 'May', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 8, label: 'Jun', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 9, label: 'Jul', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 10, label: 'Aug', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 11, label: 'Sep', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 12, label: 'Oct', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 13, label: 'Nov', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 14, label: 'Dec', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 15, label: 'Jan', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 16, label: 'Feb', align: 'right', tint: TINT_AMBER_LIGHT },
		{ col: 17, label: 'Mar', align: 'right', tint: TINT_AMBER_LIGHT },
		// Totals
		{ col: 18, label: 'Total Hrs', align: 'right', tint: TINT_PURPLE_LIGHT },
		{ col: 19, label: 'Company Cost', align: 'right', tint: TINT_GREEN },
		{ col: 20, label: 'Accent Cost', align: 'right', tint: TINT_BLUE },
		{ col: 21, label: 'P&L', align: 'right', tint: TINT_YELLOW_BRIGHT },
	];

	for (const ch of colHeaders) {
		const cell = row5.getCell(ch.col);
		cell.value = ch.label;
		setFont(cell, { bold: true, size: 9.5 });
		setFill(cell, ch.tint);
		cell.alignment = { vertical: 'middle', horizontal: ch.align };
		box(cell);
	}

	// Data rows (Row 6+)
	let currentRowNum = 6;
	for (const r of data.rows) {
		const row = ws.getRow(currentRowNum);
		row.height = 20;

		const values: Array<{
			val: number | string;
			align: 'left' | 'center' | 'right';
			numFmt?: string;
			tint: string;
			bold?: boolean;
		}> = [
			{ val: r.sr_no, align: 'center', tint: TINT_YELLOW },
			{ val: r.employee_name, align: 'left', tint: TINT_YELLOW },
			{ val: r.salary_type || 'monthly', align: 'center', tint: TINT_YELLOW },
			{
				val: r.rate_company,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
			},
			{
				val: r.rate_accent,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
			},
			// 12 Months
			...data.month_keys.map((mKey) => ({
				val: r.monthly_hours?.[mKey] || 0,
				align: 'right' as const,
				numFmt: '#,##0.##',
				tint: TINT_AMBER_LIGHT,
			})),
			// Totals
			{
				val: r.total_hours,
				align: 'right',
				numFmt: '#,##0.##',
				tint: TINT_PURPLE_LIGHT,
				bold: true,
			},
			{
				val: r.company_cost,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_GREEN,
			},
			{
				val: r.accent_cost,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_BLUE,
			},
			{
				val: r.pnl,
				align: 'right',
				numFmt: '#,##0.00',
				tint: TINT_YELLOW_BRIGHT,
				bold: true,
			},
		];

		values.forEach((v, idx) => {
			const cell = row.getCell(idx + 1);
			cell.value = v.val;
			setFont(cell, { bold: v.bold ?? false, size: 9.5 });
			setFill(cell, v.tint);
			cell.alignment = { vertical: 'middle', horizontal: v.align };
			if (v.numFmt) cell.numFmt = v.numFmt;
			box(cell);
		});

		currentRowNum++;
	}

	// Grand Totals row
	const totalRow = ws.getRow(currentRowNum);
	totalRow.height = 22;

	ws.mergeCells(currentRowNum, 1, currentRowNum, 5);
	const cellTotalLabel = totalRow.getCell(1);
	cellTotalLabel.value = 'Grand Total';
	setFont(cellTotalLabel, { bold: true, size: 10 });
	setFill(cellTotalLabel, TINT_YELLOW);
	cellTotalLabel.alignment = { vertical: 'middle', horizontal: 'right' };
	for (let c = 1; c <= 5; c++) {
		box(totalRow.getCell(c));
	}

	// 12 Month Totals
	data.month_keys.forEach((mKey, idx) => {
		const col = 6 + idx;
		const cell = totalRow.getCell(col);
		cell.value = data.totals.monthly_hours?.[mKey] || 0;
		setFont(cell, { bold: true, size: 9.5 });
		setFill(cell, TINT_AMBER_LIGHT);
		cell.alignment = { vertical: 'middle', horizontal: 'right' };
		cell.numFmt = '#,##0.##';
		box(cell);
	});

	// Column Totals
	const endTotals: Array<{
		col: number;
		val: number;
		tint: string;
	}> = [
		{ col: 18, val: data.totals.total_hours, tint: TINT_PURPLE_LIGHT },
		{ col: 19, val: data.totals.total_company_cost, tint: TINT_GREEN },
		{ col: 20, val: data.totals.total_accent_cost, tint: TINT_BLUE },
		{ col: 21, val: data.totals.total_pnl, tint: TINT_YELLOW_BRIGHT },
	];

	for (const et of endTotals) {
		const cell = totalRow.getCell(et.col);
		cell.value = et.val;
		setFont(cell, { bold: true, size: 10 });
		setFill(cell, et.tint);
		cell.alignment = { vertical: 'middle', horizontal: 'right' };
		cell.numFmt = et.col === 18 ? '#,##0.##' : '#,##0.00';
		box(cell);
	}

	return wb;
}

export async function buildAnnualWorkbookBuffer(
	data: AnnualBillingData
): Promise<Buffer> {
	const wb = buildAnnualWorkbook(data);
	const arrayBuffer = await wb.xlsx.writeBuffer();
	return Buffer.from(arrayBuffer);
}
