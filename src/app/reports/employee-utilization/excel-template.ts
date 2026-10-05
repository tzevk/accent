/**
 * Server-side Excel workbook builder for the Employee Utilization report.
 *
 * One sheet ("Utilization") mirroring the team month view: one row per
 * employee in the server's default sort (flag band, then bench cost
 * descending), a totals footer, the exclusion disclosure and the department
 * summary below it. The columns mirror the screen — Sr., Employee (name/code),
 * Department, Partial window, Capacity, Logged, the two trailing-month
 * Utilization columns, Utilization, Flag ("No time logged" or the band, plus
 * the chronic marker), Monthly Cost, Utilized Cost, Bench Cost and the
 * no-profile Note. Money columns use a 2dp number format with the rupee
 * carried in the header; rows without a covering salary profile leave all
 * three money cells blank (never zero, never "—"). A cell with no reading at
 * all (a trailing month the employee was not employed in, an unset
 * department figure) stays truly blank too.
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server routes.
 */

import ExcelJS from 'exceljs';
import {
	ROSTER_MONTH_FILTER_DESCRIPTION,
	ROSTER_MONTH_MEMBERSHIP_NOTE,
} from '@/lib/payroll-roster';
import {
	monthLabel,
	type UtilizationData,
	type UtilizationRow,
} from './data-source';

const TINT_YELLOW = 'FFFFE598'; // Sr.
const TINT_EMP = 'FFFEF3C7'; // Employee
const TINT_PURPLE_LIGHT = 'FFE1D5E7'; // Capacity / Logged hours
const TINT_BLUE = 'FFDCE2F2'; // Utilization / Flag
const TINT_GREEN = 'FFC6DFB4'; // Money columns

const GRAY_BORDER = 'FFD1D5DB';

const MONTH_SHORT = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

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

/**
 * The page's "Partial (window)" chip label, clamped to the viewed month so an
 * open bound reads as the month's own edge (`15 Jan – 31 Jan`). Parsed from
 * the ISO day by hand — no Date construction, so timezone can never shift it.
 */
function partialWindowLabel(row: UtilizationRow): string {
	const [year, month] = row.month.split('-').map(Number);
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const monthStart = `${row.month}-01`;
	const monthEnd = `${row.month}-${String(lastDay).padStart(2, '0')}`;
	const start =
		row.employment_start && row.employment_start > monthStart
			? row.employment_start
			: monthStart;
	const end =
		row.employment_end && row.employment_end < monthEnd
			? row.employment_end
			: monthEnd;
	const dayLabel = (iso: string) =>
		`${Number(iso.slice(8, 10))} ${MONTH_SHORT[Number(iso.slice(5, 7)) - 1] ?? ''}`;
	return `Partial (${dayLabel(start)} – ${dayLabel(end)})`;
}

/**
 * The Flag cell as the screen reads it: "No time logged" replaces the band
 * for a zero-Logged-Hours month, and the chronic chip rides beside it.
 */
function flagText(row: UtilizationRow): string {
	const base =
		row.state === 'no_time_logged'
			? 'No time logged'
			: bandText(row.utilization_band);
	return row.chronic_under ? `${base} · Chronic under` : base;
}

/**
 * One trailing-month cell. `null` (a truly blank cell) covers both a month
 * the employee was not employed in and an employed month with no capacity —
 * the workbook carries the payload's reading, never a substitute zero.
 */
function trailingValue(row: UtilizationRow, index: number): number | null {
	const cell = row.trailing[index];
	if (!cell || !cell.employed) return null;
	return cell.utilization_percent;
}

/** A full-width text line below the table, returned as the next free row. */
function textLine(
	ws: ExcelJS.Worksheet,
	row: number,
	text: string,
	{
		bold = false,
		size = 9,
		color = 'FF6B7280',
	}: { bold?: boolean; size?: number; color?: string } = {}
): number {
	const cell = ws.getCell(row, 1);
	cell.value = text;
	setFont(cell, { bold, size, color });
	return row + 1;
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

	// The two trailing months' labels, read off the cells they label so the
	// header can never drift from the body (the page's own rule).
	const trailingCells = data.rows[0]?.trailing.slice(0, 2) ?? [];
	const trailingHeaders = [
		trailingCells[0] ? monthLabel(trailingCells[0].month) : 'Prior month',
		trailingCells[1] ? monthLabel(trailingCells[1].month) : 'Prior month',
	];

	ws.columns = [
		{ key: 'sr', width: 7 },
		{ key: 'employee', width: 32 },
		{ key: 'department', width: 18 },
		{ key: 'window', width: 22 },
		{ key: 'capacity', width: 13 },
		{ key: 'logged', width: 13 },
		{ key: 'trailing0', width: 14 },
		{ key: 'trailing1', width: 14 },
		{ key: 'utilization', width: 14 },
		{ key: 'flag', width: 22 },
		{ key: 'monthly', width: 16 },
		{ key: 'utilized', width: 16 },
		{ key: 'bench', width: 16 },
		{ key: 'note', width: 13 },
	];
	const lastColumn = ws.columns.length;

	const titleSuffix = data.flag ? ` (${bandText(data.flag)} band)` : '';
	ws.mergeCells(1, 1, 1, lastColumn);
	const title = ws.getCell(1, 1);
	title.value = `Employee Utilization — ${data.month_label}${titleSuffix}`;
	setFont(title, { bold: true, size: 13 });
	title.alignment = { vertical: 'middle', horizontal: 'left' };
	ws.getRow(1).height = 22;

	ws.mergeCells(2, 1, 2, lastColumn);
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
		{ col: 3, label: 'Department', tint: TINT_EMP, align: 'left' },
		{ col: 4, label: 'Partial window', tint: TINT_EMP, align: 'left' },
		{ col: 5, label: 'Capacity (h)', tint: TINT_PURPLE_LIGHT, align: 'right' },
		{ col: 6, label: 'Logged (h)', tint: TINT_PURPLE_LIGHT, align: 'right' },
		{ col: 7, label: trailingHeaders[0], tint: TINT_BLUE, align: 'right' },
		{ col: 8, label: trailingHeaders[1], tint: TINT_BLUE, align: 'right' },
		{ col: 9, label: 'Utilization %', tint: TINT_BLUE, align: 'right' },
		{ col: 10, label: 'Flag', tint: TINT_BLUE, align: 'left' },
		{ col: 11, label: 'Monthly Cost (₹)', tint: TINT_GREEN, align: 'right' },
		{ col: 12, label: 'Utilized Cost (₹)', tint: TINT_GREEN, align: 'right' },
		{ col: 13, label: 'Bench Cost (₹)', tint: TINT_GREEN, align: 'right' },
		{ col: 14, label: 'Note', tint: TINT_EMP, align: 'left' },
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
			// The screen labels an unset department "Unassigned".
			{ val: r.department ?? 'Unassigned', tint: TINT_EMP, align: 'left' },
			{
				val: r.is_partial_window ? partialWindowLabel(r) : null,
				tint: TINT_EMP,
				align: 'left',
			},
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
				val: trailingValue(r, 0),
				tint: TINT_BLUE,
				align: 'right',
				numFmt: '#,##0.00"%"',
			},
			{
				val: trailingValue(r, 1),
				tint: TINT_BLUE,
				align: 'right',
				numFmt: '#,##0.00"%"',
			},
			{
				val: r.utilization_percent,
				tint: TINT_BLUE,
				align: 'right',
				numFmt: '#,##0.00"%"',
			},
			{ val: flagText(r), tint: TINT_BLUE, align: 'left' },
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
	// blank when no priced rows exist. The label spans Sr. + Employee, like
	// the footer on screen.
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
		{ col: 3, val: null, tint: TINT_EMP },
		{ col: 4, val: null, tint: TINT_EMP },
		{
			col: 5,
			val: data.totals.capacity_hours,
			tint: TINT_PURPLE_LIGHT,
			numFmt: '#,##0.##',
		},
		{
			col: 6,
			val: data.totals.logged_hours,
			tint: TINT_PURPLE_LIGHT,
			numFmt: '#,##0.##',
		},
		{ col: 7, val: null, tint: TINT_BLUE },
		{ col: 8, val: null, tint: TINT_BLUE },
		{
			col: 9,
			val: data.totals.utilization_percent,
			tint: TINT_BLUE,
			numFmt: '#,##0.00"%"',
		},
		{ col: 10, val: null, tint: TINT_BLUE },
		{
			col: 11,
			val: data.totals.monthly_cost,
			tint: TINT_GREEN,
			numFmt: '#,##0.00',
		},
		{
			col: 12,
			val: data.totals.fractional_cost,
			tint: TINT_GREEN,
			numFmt: '#,##0.00',
		},
		{
			col: 13,
			val: data.totals.bench_cost,
			tint: TINT_GREEN,
			numFmt: '#,##0.00',
		},
		{ col: 14, val: null, tint: TINT_EMP },
	];
	for (const t of totals) {
		const cell = totalRow.getCell(t.col);
		cell.value = t.val;
		setFont(cell, { bold: true, size: 10 });
		setFill(cell, t.tint);
		cell.alignment = { vertical: 'middle', horizontal: 'right' };
		if (t.numFmt && t.val !== null) cell.numFmt = t.numFmt;
		box(cell);
	}

	// ── Below the table: the exclusion disclosure (omitted when nobody was
	// dropped) and the department summary, mirroring the screen. ──
	let sectionRow = rowNum + 2; // one blank spacer row after the totals footer

	const disclosure = data.disclosure;
	if (disclosure && disclosure.excluded_count > 0) {
		sectionRow = textLine(ws, sectionRow, 'Excluded from the report', {
			bold: true,
			size: 11,
			color: 'FF111827',
		});
		sectionRow = textLine(
			ws,
			sectionRow,
			`This report covers every employee where ${ROSTER_MONTH_FILTER_DESCRIPTION}.`
		);
		const employeeNoun =
			disclosure.excluded_count === 1 ? 'employee' : 'employees';
		sectionRow = textLine(
			ws,
			sectionRow,
			`${disclosure.excluded_count} ${employeeNoun} excluded of ` +
				`${disclosure.considered_count} considered for the month, leaving ` +
				`${disclosure.roster_count} on the roster.`,
			{ size: 10, color: 'FF111827' }
		);
		sectionRow = textLine(
			ws,
			sectionRow,
			disclosure.buckets
				.map(
					(bucket) =>
						`${bucket.count} ${bucket.value === null ? 'unset' : bucket.value}`
				)
				.join(' · ')
		);
		sectionRow = textLine(ws, sectionRow, ROSTER_MONTH_MEMBERSHIP_NOTE);
		sectionRow += 1; // blank spacer between the sections
	}

	if (data.departments.length > 0) {
		sectionRow = textLine(ws, sectionRow, 'Department summary', {
			bold: true,
			size: 11,
			color: 'FF111827',
		});
		const deptHeader = ws.getRow(sectionRow);
		deptHeader.height = 18;
		const deptLabels = [
			'Department',
			'Headcount',
			'Utilization %',
			'Logged (h)',
			'Capacity (h)',
			'Bench Cost (₹)',
			'No time logged',
		];
		deptLabels.forEach((label, index) => {
			const c = deptHeader.getCell(index + 1);
			c.value = label;
			setFont(c, { bold: true, size: 9.5 });
			setFill(c, TINT_BLUE);
			c.alignment = {
				vertical: 'middle',
				horizontal: index === 0 ? 'left' : 'right',
			};
			box(c);
		});
		sectionRow++;

		for (const summary of data.departments) {
			const row = ws.getRow(sectionRow);
			row.height = 18;
			const cells: Array<{
				val: string | number | null;
				tint: string;
				numFmt?: string;
				align: 'left' | 'right';
			}> = [
				{
					val: summary.department ?? 'Unassigned',
					tint: TINT_EMP,
					align: 'left',
				},
				{ val: summary.headcount, tint: TINT_BLUE, align: 'right' },
				{
					val: summary.capacity_weighted_utilization,
					tint: TINT_BLUE,
					align: 'right',
					numFmt: '#,##0.00"%"',
				},
				{
					val: summary.logged_hours,
					tint: TINT_PURPLE_LIGHT,
					align: 'right',
					numFmt: '#,##0.##',
				},
				{
					val: summary.capacity_hours,
					tint: TINT_PURPLE_LIGHT,
					align: 'right',
					numFmt: '#,##0.##',
				},
				{
					val: summary.bench_cost,
					tint: TINT_GREEN,
					align: 'right',
					numFmt: '#,##0.00',
				},
				{ val: summary.no_logged_count, tint: TINT_BLUE, align: 'right' },
			];
			cells.forEach((v, idx) => {
				const c = row.getCell(idx + 1);
				c.value = v.val;
				setFont(c, { size: 9.5 });
				setFill(c, v.tint);
				c.alignment = { vertical: 'middle', horizontal: v.align };
				if (v.numFmt && v.val !== null) c.numFmt = v.numFmt;
				box(c);
			});
			sectionRow++;
		}

		// The month-level line the screen's summary carries: how many rows
		// logged nothing (shown only when there are any, like the screen).
		if (data.totals.no_logged_count > 0) {
			textLine(
				ws,
				sectionRow + 1,
				`${data.totals.no_logged_count} ${
					data.totals.no_logged_count === 1 ? 'employee' : 'employees'
				} with no time logged in ${data.month_label}.`
			);
		}
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
