/**
 * Label text shared by the Employee Utilization page and its Excel workbook.
 *
 * Pure — no DB and no React imports — so the screen and the workbook render
 * the same strings from one place and cannot drift. The `d MMM` day is
 * parsed from the ISO string by hand: `formatDate` renders the year and
 * `new Date('YYYY-MM-DD')` is UTC midnight, so a local formatter could shift
 * the day; the chip needs exactly `15 Jan` and nothing else.
 */

import type { UtilizationBand, UtilizationRow } from './data-source';

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

/** The band reading; `null` (no capacity) reads "No capacity". */
export function bandText(band: UtilizationBand | null): string {
	if (band === 'under') return 'Under';
	if (band === 'healthy') return 'Healthy';
	if (band === 'over') return 'Over';
	return 'No capacity';
}

/** The zero-Logged-Hours state's own reading, shown in place of the band. */
export const NO_TIME_LOGGED_LABEL = 'No time logged';

/**
 * The row's Flag reading: a zero-Logged-Hours month reads "No time logged"
 * in place of its band (the chronic chip rides beside it on both surfaces).
 */
export function flagText(row: UtilizationRow): string {
	return row.state === 'no_time_logged'
		? NO_TIME_LOGGED_LABEL
		: bandText(row.utilization_band);
}

/**
 * The "Partial (window)" chip label, clamped to the viewed month so an open
 * bound reads as the month's own edge (`15 Jan – 31 Jan`).
 */
export function partialWindowLabel(row: UtilizationRow): string {
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
