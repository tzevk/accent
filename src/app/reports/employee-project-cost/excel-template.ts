/**
 * Server-side Excel workbook builder for the Employee Project Cost report.
 *
 * Produces one workbook with two sheets sharing the same row order:
 *   1. "Monthly Hours" — Apr–Mar hours matrix per project
 *   2. "Monthly Cost"  — Apr–Mar payroll cost matrix per project
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { EmployeeProjectCostData } from './data-source';

const TINT_YELLOW = 'FFFFE598'; // Sr. No. | Project
const TINT_BLUE = 'FFDCE2F2'; // Rate/Hr | Client
const TINT_AMBER_LIGHT = 'FFFFF2CC'; // Monthly cells Apr–Mar
const TINT_PURPLE_LIGHT = 'FFE1D5E7'; // Total hours column
const TINT_GREEN = 'FFC6DFB4'; // Cost totals

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
