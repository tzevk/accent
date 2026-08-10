/**
 * Server-side Excel workbook builder for the Timesheet report.
 *
 * Mirrors the layout of the company's Excel monthly-timesheet template
 * (docs/extras/*_TIMESHEET_*): employee info block, a day-column matrix
 * with status + hours rows, sub-totals, and the signature strip. Uses the
 * same visual conventions as the Project Activities Excel export (brand
 * purple headers, semantic status fills, hairline borders).
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { TimesheetData, TsDay } from './data-source';
import { monthLabel } from './data-source';

const BRAND_PURPLE = 'FF7F2487';
const BRAND_PURPLE_LIGHT = 'FFF3E5F5';
const GRAY_BORDER = 'FFD1D5DB';
// Reference timesheet's weekend/holiday column fill (Excel blue 0070C0).
const BLUE = 'FF0070C0';

// Day-column status fills (Tailwind 100-level equivalents from AGENTS.md).
const STATUS_FILL: Record<string, string> = {
	P: 'FFDCFCE7', // green-100
	OT: 'FFDBEAFE', // blue-100
	HD: 'FFFEF9C3', // yellow-100
	WO: 'FFF3F4F6', // gray-100
	H: 'FFF3E5F5', // purple-50
	A: 'FFFEE2E2', // red-100
	PL: 'FFF0FDFA', // teal-50
	CL: 'FFECFEFF', // cyan-50
	SL: 'FFFFF7ED', // orange-50
	LWP: 'FFFEF3C7', // amber-100
};

const STATUS_TEXT: Record<string, string> = {
	P: 'FF15803D',
	OT: 'FF1D4ED8',
	HD: 'FFA16207',
	WO: 'FF4B5563',
	H: 'FF5B21B6',
	A: 'FFB91C1C',
	PL: 'FF0F766E',
	CL: 'FF0E7490',
	SL: 'FFC2410C',
	LWP: 'FFB45309',
};

const HEADER_FILL = 'FF7F2487'; // brand purple

function colLetter(index: number): string {
	let letter = '';
	let n = index;
	while (n > 0) {
		const rem = (n - 1) % 26;
		letter = String.fromCharCode(65 + rem) + letter;
		n = Math.floor((n - 1) / 26);
	}
	return letter;
}

/** Number of day columns = days in month; total column after them. */
function layoutColumns(dayCount: number): number {
	// A = label, B..(B+dayCount-1) = days, last = Total
	return 1 + dayCount + 1;
}

function thinBorder(
	cell: ExcelJS.Cell,
	{ left = false, right = false, top = false, bottom = false } = {}
): void {
	const side = { style: 'thin' as const, color: { argb: GRAY_BORDER } };
	cell.border = {
		...(left ? { left: side } : {}),
		...(right ? { right: side } : {}),
		...(top ? { top: side } : {}),
		...(bottom ? { bottom: side } : {}),
	};
}

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
		italic = false,
	}: { bold?: boolean; size?: number; color?: string; italic?: boolean } = {}
): void {
	cell.font = { name: 'Calibri', bold, size, color: { argb: color }, italic };
}

function fmtHours(v: number): string {
	// 8 → "8", 2.5 → "2.5", 0 → "0"
	const rounded = Math.round(v * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Day cells store hours as a fraction of a day so hh:mm formats to "08:00". */
const DAY_CELL_NUMFMT = 'hh:mm';
/** Totals store the same fraction; [h]:mm:ss formats 7 days to "168:00:00". */
const TOTAL_NUMFMT = '[h]:mm:ss';

/** Vertical day label for non-working columns (like the reference's letters). */
function dayLabel(day: TsDay): string {
	if (day.day_type === 'holiday') return day.holiday_name || 'HOLIDAY';
	if (day.day_type === 'weekly_off') return day.weekday.toUpperCase();
	return '';
}

/** True for non-working day columns (blue fill, matching the reference). */
function isBlueColumn(day: TsDay): boolean {
	return day.day_type !== 'working';
}

/** Hours → fraction of a day (8 → 0.3333) so hh:mm formats to "08:00". */
function hoursToDays(hours: number): number {
	return Math.round((hours / 24) * 10000) / 10000;
}

function sanitizeName(name: string): string {
	return (
		name
			.replace(/[^A-Za-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.toUpperCase() || 'EMPLOYEE'
	);
}

export function fileBaseForExcel(data: TimesheetData): string {
	const [y, m] = data.month.split('-').map(Number);
	const label =
		y && m
			? monthLabel(data.month).toUpperCase().replace(/ /g, '_')
			: data.month;
	const name = sanitizeName(
		data.employee?.name ?? `EMP_${data.employee?.employee_id ?? ''}`
	);
	return `Timesheet_${name}_${label}.xlsx`;
}

export function buildWorkbook(data: TimesheetData): ExcelJS.Workbook {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Monthly Time Sheet');

	const dayCount = data.days.length;
	const totalCol = dayCount + 2; // 1-based index of the Total column (A + days)
	const lastCol = layoutColumns(dayCount);
	const lastLetter = colLetter(lastCol);

	// Column widths: label wide, days narrow, total medium.
	ws.columns = [
		{ width: 32 },
		...Array.from({ length: dayCount }, () => ({ width: 5.5 })),
		{ width: 12 },
	];

	const emp = data.employee;

	// ── Row 1: title ──────────────────────────────────────────────────
	ws.mergeCells(`A1:${lastLetter}1`);
	const title = ws.getCell('A1');
	title.value = 'MONTHLY TIME SHEET';
	setFill(title, BRAND_PURPLE);
	setFont(title, { bold: true, size: 14, color: 'FFFFFFFF' });
	title.alignment = { horizontal: 'center', vertical: 'middle' };
	ws.getRow(1).height = 26;

	// ── Rows 2–4: employee info block ─────────────────────────────────
	const infoRows: [string, string, string, string][] = [
		['Employee Code', emp?.employee_id ?? '—', 'Month', monthLabel(data.month)],
		[
			'Employee Name',
			emp?.name ?? '—',
			'Year',
			data.month.split('-')[0] ?? '—',
		],
		[
			'Designation',
			emp?.position || emp?.designation || '—',
			'Department',
			emp?.department || '—',
		],
	];
	infoRows.forEach(([labelA, valueA, labelB, valueB], idx) => {
		const r = idx + 2;
		ws.getCell(`A${r}`).value = labelA;
		setFont(ws.getCell(`A${r}`), { bold: true, size: 10, color: 'FF4B5563' });
		ws.mergeCells(`B${r}:F${r}`);
		ws.getCell(`B${r}`).value = valueA;
		setFont(ws.getCell(`B${r}`), { size: 10 });

		ws.getCell(`G${r}`).value = '';
		ws.getCell(`H${r}`).value = labelB;
		setFont(ws.getCell(`H${r}`), { bold: true, size: 10, color: 'FF4B5563' });
		ws.mergeCells(`I${r}:L${r}`);
		ws.getCell(`I${r}`).value = valueB;
		setFont(ws.getCell(`I${r}`), { size: 10 });
	});

	// ── Row 5: weekday headers ────────────────────────────────────────
	ws.getCell(`A5`).value = 'Day';
	setFill(ws.getCell('A5'), HEADER_FILL);
	setFont(ws.getCell('A5'), { bold: true, size: 10, color: 'FFFFFFFF' });
	ws.mergeCells(`A5:A6`);

	data.days.forEach((day: TsDay, i: number) => {
		const col = i + 2; // B.. ; 1-based
		const cell = ws.getCell(5, col);
		cell.value = day.weekday.slice(0, 2);
		const blue = isBlueColumn(day);
		setFill(cell, blue ? BLUE : 'FFF9FAFB');
		setFont(cell, {
			bold: true,
			size: 9,
			color: blue ? 'FFFFFFFF' : 'FF374151',
		});
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		thinBorder(cell, { left: true, right: true, top: true, bottom: true });
	});
	ws.getCell(5, totalCol).value = 'Total';
	setFill(ws.getCell(5, totalCol), HEADER_FILL);
	setFont(ws.getCell(5, totalCol), { bold: true, size: 10, color: 'FFFFFFFF' });
	ws.mergeCells(5, totalCol, 6, totalCol);
	thinBorder(ws.getCell(5, totalCol), {
		left: true,
		right: true,
		top: true,
		bottom: true,
	});
	thinBorder(ws.getCell(6, totalCol), {
		left: true,
		right: true,
		top: true,
		bottom: true,
	});
	ws.getRow(5).height = 30;

	// ── Row 6: day numbers ────────────────────────────────────────────
	ws.getCell(`A6`).value = 'Date';
	setFill(ws.getCell('A6'), HEADER_FILL);
	setFont(ws.getCell('A6'), { bold: true, size: 10, color: 'FFFFFFFF' });
	data.days.forEach((day: TsDay, i: number) => {
		const col = i + 2;
		const cell = ws.getCell(6, col);
		cell.value = day.day;
		const blue = isBlueColumn(day);
		setFill(cell, blue ? BLUE : 'FFF9FAFB');
		setFont(cell, {
			bold: true,
			size: 9,
			color: blue ? 'FFFFFFFF' : 'FF374151',
		});
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		thinBorder(cell, { left: true, right: true, top: true, bottom: true });
	});

	// ── Row 7: attendance statuses (vertical day labels on blue columns) ─
	ws.getCell(`A7`).value = 'Attendance';
	setFont(ws.getCell('A7'), { bold: true, size: 10 });
	ws.getCell(`A7`).alignment = { vertical: 'middle' };
	let maxLabelLen = 0;
	data.days.forEach((day: TsDay, i: number) => {
		const col = i + 2;
		const cell = ws.getCell(7, col);
		const label = dayLabel(day);
		if (label) {
			// Stack the label letter-per-line — the reference spells the day
			// name vertically down the blue column. (This exceljs build drops
			// alignment.textRotation, so newlines + wrapText carry the look.)
			cell.value = label.split('').join('\n');
			setFill(cell, BLUE);
			setFont(cell, { bold: true, size: 8, color: 'FFFFFFFF' });
			cell.alignment = {
				horizontal: 'center',
				vertical: 'middle',
				wrapText: true,
			};
			maxLabelLen = Math.max(maxLabelLen, label.length);
		} else {
			cell.value = day.status ?? '';
			if (day.status) {
				const fill = STATUS_FILL[day.status.toUpperCase()] ?? 'FFF9FAFB';
				setFill(cell, fill);
				setFont(cell, {
					bold: true,
					size: 9,
					color: STATUS_TEXT[day.status.toUpperCase()] ?? 'FF374151',
				});
			} else {
				setFont(cell, { size: 9, color: 'FFD1D5DB' });
			}
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
		}
		thinBorder(cell, { left: true, right: true, top: true, bottom: true });
	});
	ws.getCell(7, totalCol).value =
		`${data.summary.present_days}P · ${data.summary.weekly_offs}WO · ${data.summary.holidays}H`;
	setFont(ws.getCell(7, totalCol), { bold: true, size: 9 });
	thinBorder(ws.getCell(7, totalCol), {
		left: true,
		right: true,
		top: true,
		bottom: true,
	});
	if (maxLabelLen > 3)
		ws.getRow(7).height = Math.min(maxLabelLen * 8 + 12, 260);

	// ── Project/activity rows (per-day hours from daily_entries) ──────
	let cursor = 8;
	for (const project of data.projects) {
		if (project.total_hours <= 0) continue;
		const labelCell = ws.getCell(`A${cursor}`);
		labelCell.value =
			project.project_code && project.project_code !== project.activity_name
				? `${project.project_code} — ${project.activity_name}`
				: project.activity_name;
		setFont(labelCell, { size: 9.5 });
		labelCell.alignment = { vertical: 'middle', wrapText: true };
		thinBorder(labelCell, { left: true, right: true, top: true, bottom: true });

		data.days.forEach((day: TsDay, i: number) => {
			const col = i + 2;
			const cell = ws.getCell(cursor, col);
			const h = project.days[day.date] ?? 0;
			if (h > 0) {
				cell.value = hoursToDays(h);
				cell.numFmt = DAY_CELL_NUMFMT;
				setFont(cell, { size: 9, color: 'FF374151' });
			} else {
				cell.value = '';
			}
			if (isBlueColumn(day)) setFill(cell, BLUE);
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			thinBorder(cell, { left: true, right: true, top: true, bottom: true });
		});

		const totalCell = ws.getCell(cursor, totalCol);
		totalCell.value = hoursToDays(project.total_hours);
		totalCell.numFmt = TOTAL_NUMFMT;
		setFont(totalCell, { bold: true, size: 9.5 });
		totalCell.alignment = { horizontal: 'center' };
		thinBorder(totalCell, { left: true, right: true, top: true, bottom: true });
		cursor++;
	}

	// ── Daily Man Hours row (project log, or attendance-derived) ──────
	const manHoursLabel = ws.getCell(`A${cursor}`);
	manHoursLabel.value =
		data.hours.source === 'project'
			? 'Daily Man Hours (Project Log)'
			: 'Daily Man Hours';
	setFont(manHoursLabel, { bold: true, size: 10 });
	thinBorder(manHoursLabel, {
		left: true,
		right: true,
		top: true,
		bottom: true,
	});
	data.days.forEach((day: TsDay, i: number) => {
		const col = i + 2;
		const cell = ws.getCell(cursor, col);
		const h = data.hours.daily[day.date] ?? 0;
		if (h > 0) {
			cell.value = hoursToDays(h);
			cell.numFmt = DAY_CELL_NUMFMT;
			setFont(cell, { size: 9, color: 'FF374151' });
		} else {
			cell.value = '';
		}
		if (isBlueColumn(day)) setFill(cell, BLUE);
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		thinBorder(cell, { left: true, right: true, top: true, bottom: true });
	});
	const manHoursTotalCell = ws.getCell(cursor, totalCol);
	manHoursTotalCell.value = hoursToDays(data.hours.normal);
	manHoursTotalCell.numFmt = TOTAL_NUMFMT;
	setFont(manHoursTotalCell, { bold: true, size: 10 });
	manHoursTotalCell.alignment = { horizontal: 'center' };
	thinBorder(manHoursTotalCell, {
		left: true,
		right: true,
		top: true,
		bottom: true,
	});
	cursor++;

	// ── Overtime hours row ────────────────────────────────────────────
	ws.getCell(`A${cursor}`).value = 'Overtime Hours';
	setFont(ws.getCell(`A${cursor}`), { bold: true, size: 10 });
	thinBorder(ws.getCell(`A${cursor}`), {
		left: true,
		right: true,
		top: true,
		bottom: true,
	});
	data.days.forEach((day: TsDay, i: number) => {
		const col = i + 2;
		const cell = ws.getCell(cursor, col);
		if (day.overtime_hours > 0) {
			cell.value = hoursToDays(day.overtime_hours);
			cell.numFmt = DAY_CELL_NUMFMT;
			setFont(cell, { size: 9, color: 'FF1D4ED8' });
		} else {
			cell.value = '';
		}
		if (isBlueColumn(day)) setFill(cell, BLUE);
		cell.alignment = { horizontal: 'center', vertical: 'middle' };
		thinBorder(cell, { left: true, right: true, top: true, bottom: true });
	});
	const otCell = ws.getCell(cursor, totalCol);
	otCell.value = hoursToDays(data.hours.overtime);
	otCell.numFmt = TOTAL_NUMFMT;
	setFont(otCell, { bold: true, size: 10, color: 'FF1D4ED8' });
	otCell.alignment = { horizontal: 'center' };
	thinBorder(otCell, { left: true, right: true, top: true, bottom: true });
	cursor++;

	// ── Active Hours row (screen-time tracking; not part of the totals) ──
	if (data.screen_time.present) {
		const labelCell = ws.getCell(`A${cursor}`);
		labelCell.value = 'Active Hours (Screen Time)';
		setFont(labelCell, { bold: true, size: 10, color: 'FF047857' });
		data.days.forEach((day: TsDay, i: number) => {
			const col = i + 2;
			const cell = ws.getCell(cursor, col);
			const secs = data.screen_time.days[day.date] ?? 0;
			if (secs > 0) {
				cell.value = Math.round((secs / 86400) * 100000) / 100000;
				cell.numFmt = DAY_CELL_NUMFMT;
				setFont(cell, { size: 9, color: 'FF059669' });
			} else {
				cell.value = '';
			}
			if (isBlueColumn(day)) setFill(cell, BLUE);
			cell.alignment = { horizontal: 'center', vertical: 'middle' };
			thinBorder(cell, { left: true, right: true, top: true, bottom: true });
		});
		const actTotalCell = ws.getCell(cursor, totalCol);
		actTotalCell.value =
			Math.round((data.screen_time.total_active_sec / 86400) * 100000) / 100000;
		actTotalCell.numFmt = TOTAL_NUMFMT;
		setFont(actTotalCell, { bold: true, size: 10, color: 'FF059669' });
		actTotalCell.alignment = { horizontal: 'center' };
		thinBorder(actTotalCell, {
			left: true,
			right: true,
			top: true,
			bottom: true,
		});
		cursor++;
	}

	// ── Totals rows ───────────────────────────────────────────────────
	const totalsStartRow = cursor;
	const totalRows: [string, number, boolean][] = [
		['Sub-Total Of Normal Hours', data.hours.normal, false],
		['Sub-Total Of Over Time Hours', data.hours.overtime, false],
		['Total Monthly Hours', data.hours.total, true],
	];
	totalRows.forEach(([label, value, isGrand], idx) => {
		const r = totalsStartRow + idx;
		ws.mergeCells(`A${r}:${colLetter(totalCol - 1)}${r}`);
		const labelCell = ws.getCell(`A${r}`);
		labelCell.value = label;
		setFont(labelCell, {
			bold: isGrand,
			size: 10,
			color: isGrand ? BRAND_PURPLE : 'FF374151',
		});
		labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
		if (isGrand) setFill(labelCell, BRAND_PURPLE_LIGHT);

		const valueCell = ws.getCell(r, totalCol);
		valueCell.value = hoursToDays(value);
		valueCell.numFmt = TOTAL_NUMFMT;
		setFont(valueCell, {
			bold: true,
			size: 10,
			color: isGrand ? BRAND_PURPLE : 'FF374151',
		});
		valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
		if (isGrand) setFill(valueCell, BRAND_PURPLE_LIGHT);
		thinBorder(valueCell, { left: true, right: true, top: true, bottom: true });
	});
	const summaryRow = totalsStartRow + 3;

	// ── Day-type summary strip ────────────────────────────────────────
	ws.mergeCells(`A${summaryRow}:${lastLetter}${summaryRow}`);
	const summaryCell = ws.getCell(summaryRow, 1);
	const s = data.summary;
	summaryCell.value =
		`Present Days: ${s.present_days}   |   Half Days: ${s.half_days}   |   Weekly Offs: ${s.weekly_offs}   |   ` +
		`Holidays: ${s.holidays}   |   Absent Days: ${s.absent_days}   |   Leave Days: ${s.leave_days}`;
	setFont(summaryCell, { size: 10, color: 'FF4B5563' });
	summaryCell.alignment = { horizontal: 'left', vertical: 'middle' };
	setFill(summaryCell, 'FFF9FAFB');

	// ── Signature strip ───────────────────────────────────────────────
	const sigRow = summaryRow + 2;
	const sigBlock = (
		startCol: number,
		endCol: number,
		label: string,
		value: string
	) => {
		const cell = ws.getCell(sigRow, startCol);
		cell.value = `${value}\n${label}`;
		ws.mergeCells(sigRow, startCol, sigRow, endCol);
		setFont(cell, { size: 10, color: 'FF374151' });
		cell.alignment = {
			horizontal: 'center',
			vertical: 'bottom',
			wrapText: true,
		};
		cell.border = {
			top: { style: 'thin', color: { argb: GRAY_BORDER } },
		};
	};
	sigBlock(1, 6, 'Prepared By', emp?.name ?? '');
	sigBlock(8, 12, 'Checked By', '');
	sigBlock(14, 18, 'Approved By', '');
	ws.getRow(sigRow).height = 40;

	// ── Note ──────────────────────────────────────────────────────────
	const noteRow = sigRow + 2;
	ws.mergeCells(`A${noteRow}:${lastLetter}${noteRow}`);
	const noteCell = ws.getCell(noteRow, 1);
	noteCell.value =
		`Note: Per day working hours is ${fmtHours(data.settings.standard_working_hours)}:00 hours (excluding lunch). ` +
		(data.hours.source === 'project'
			? `Hours are from the project activity log for ${monthLabel(data.month)}. `
			: `Generated from employee attendance records for ${monthLabel(data.month)}. `) +
		'Overtime hours are from attendance records.' +
		(data.screen_time.present
			? ' Active hours are from screen-time tracking and are not included in the totals.'
			: '');
	setFont(noteCell, { size: 9, italic: true, color: 'FF6B7280' });
	noteCell.alignment = { horizontal: 'left', vertical: 'middle' };

	// Print setup: landscape, fit to width.
	ws.pageSetup = {
		orientation: 'landscape',
		fitToPage: true,
		fitToWidth: 1,
		fitToHeight: 0,
		paperSize: 9, // A4
	};

	return wb;
}

export async function buildWorkbookBuffer(
	data: TimesheetData
): Promise<Buffer> {
	const wb = buildWorkbook(data);
	const buf = await wb.xlsx.writeBuffer();
	return Buffer.from(buf);
}
