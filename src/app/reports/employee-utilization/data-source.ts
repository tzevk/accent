/**
 * Pure computation for the Employee Utilization report (team, monthly).
 *
 * One row per employee per month:
 * - Capacity: working days × 8h, net of scheduled weekly offs (Sundays plus
 *   2nd/4th Saturdays), injected active holidays, and approved leave
 *   (full day 8h, half day 4h). Unsanctioned absence keeps its capacity.
 * - Logged Hours: uncapped sum of `user_activity_assignments.daily_entries`
 *   hours for the month — overtime counts, so overload reads above 100.
 * - Utilization: logged / capacity × 100, banded under 80 / 80–100 / over 100.
 * - Monthly Cost on a CTC basis (stored `employer_cost` first — a deliberate
 *   divergence from the billing Gross-first convention, so bench
 *   prioritization reflects true burn), Bench Cost = monthly − fractional,
 *   where fractional = the Payroll Slip's rate × logged hours. Fractional +
 *   bench always foots to monthly. Rows with no covering salary profile show
 *   blank (null, never zero) costs with an explicit `no-profile` flag.
 *
 * Rate (payroll-aligned, ADR-0010): CTC ÷ Basis Hours, where Basis Hours =
 * the month's basis days (every non-Sunday day minus the injected active
 * NON-optional holidays — 2nd/4th Saturdays stay in) × the profile's
 * `std_hours_per_day` (default 8). Direct stored hourly/daily/custom rates
 * and the profile's `std_working_days` never price a row, exactly as they
 * never price a slip, so a fully logged month reconciles with the slip. The
 * rate's calendar and the Capacity calendar above differ by design — the
 * page says so.
 *
 * Calendar logic is reused verbatim from the timesheet report (`statusKind`,
 * `dayTypeFor`); the weekly-off rule comes from the shared predicate.
 * Profile selection reuses `pickActiveProfile` (effective-range cover, else
 * latest active). Holiday
 * sets are injected by the caller, so this module has no DB dependency.
 *
 * Roster: each month is scoped to the shared payroll roster
 * (`@/lib/payroll-roster`): live (isDelete = 0), Employee Type = Payroll, and
 * the employment window (joining/exit dates, with recorded attendance and
 * Logged Hours as the fallback evidence) must intersect the month. The payload
 * carries the selector's exclusion disclosure, and every row carries its
 * resolved window.
 *
 * Partial months: Capacity counts only the working days inside the resolved
 * employment window (weekly-off and leave rules inside it unchanged; days
 * outside it land in no bucket), and Monthly Cost is pro-rated by employed
 * working days ÷ the month's working days on the same capacity calendar — so
 * a full-month window reproduces the full CTC. Rows whose window does not
 * cover the whole month carry `is_partial_window` so the page can name the
 * dates; a window with no working days costs 0 with capacity 0.
 *
 * Zero Logged Hours: such a row carries the `no_time_logged` state — missing
 * timesheet evidence, not a 0% underuse verdict. The state changes neither
 * the percent nor the band nor the sort position (the row keeps its Under
 * band and its band-then-bench slot, so the most expensive idle rows stay
 * visible), and it is independent of `cost_status`: a no-log row with no
 * covering profile keeps its blank costs. The totals' `no_logged_count` is
 * the viewed month's count (pre-band-filter, the same set the department
 * rollup counts); the other totals narrow with the grid.
 *
 * Holidays: the caller injects active NON-optional holidays only. An optional
 * holiday is a full working day for Capacity — matching the attendance and
 * payroll paths — regardless of the attendance status recorded on it (an `H`
 * row falls through to the standard 8h credit).
 *
 * Lenses: every row carries its trailing window — the viewed month and the
 * two before it, oldest first — where each month runs the same per-month
 * pipeline (month-scoped roster, window-pro-rated Capacity, the month's own
 * Basis Hours rate); a cell is blank where the window does not cover the
 * month. `chronic_under` marks a row whose every employed month of the window
 * reads below 80 with a real percent, with at least two months of history.
 * The payload's `trend` carries the six months ending at the viewed month,
 * oldest first: capacity-weighted utilization and the Bench Cost of the
 * month's priced rows. The fetch loads attendance, holidays and Logged Hours
 * for that span once and derives all six months from that single load.
 *
 * Departments: `employees.department` is free text whose empty string
 * normalizes to null (the repo-wide `s(row,'department') || null` idiom), and
 * that raw value rides on every row. The payload also carries the month's
 * department rollup (`departments`) — one entry per department present in the
 * month's roster rows, unset grouped as `null` and sorted last, each with its
 * headcount, capacity-weighted utilization, logged/capacity hours, Bench Cost
 * and no-log count. It is computed BEFORE the band filter: the rollup
 * describes the month, the grid's filters narrow only the detail.
 */

import {
	statusKind,
	dayTypeFor,
} from '@/app/reports/timesheet-report/data-source';
import { isWeeklyOff } from '@/utils/weekly-off';
import {
	pickActiveProfile,
	type SalaryProfile,
} from '@/app/reports/manhours-billing/data-source';
import {
	parseDailyEntries,
	parseDailyEntryRecords,
	sumLoggedHoursForMonth,
	type LoggedEntry,
} from '@/lib/logged-hours';
import { resolveLoggedHoursEmployeeId } from '@/lib/logged-hours-source';
import { R, add, sub, mul, div, toNumber } from '@/lib/money';
import {
	selectPayrollRoster,
	type RosterDisclosure,
	type RosterEmployeeInput,
	type RosterMember,
} from '@/lib/payroll-roster';
import { query } from '@/utils/database';
import { dbNum, dbStr, type DbRow } from './db-values';

// ─── Constants ────────────────────────────────────────────────────────

/** Standard working day in hours; half-day leave credits half of this. */
export const STANDARD_WORKING_HOURS = 8;
/** Capacity credited for a half-day (`HD`) leave on a working day. */
export const HALF_DAY_HOURS = 4;
/** Utilization below this percent reads as under-loaded. */
export const UNDER_UTILIZATION_THRESHOLD = 80;
/** Utilization above this percent reads as over-loaded. */
export const OVER_UTILIZATION_THRESHOLD = 100;
/** Basis Hours fallback when a profile omits standard hours per day. */
export const STD_HOURS_PER_DAY_DEFAULT = 8;

// ─── Public types ─────────────────────────────────────────────────────

export type UtilizationBand = 'under' | 'healthy' | 'over';

/**
 * `no_time_logged` when the viewed month's Logged Hours are 0 — missing
 * timesheet evidence, not a 0% underuse verdict. The state changes neither
 * the percent, the band nor the sort position (the row keeps its Under band
 * and its band-then-bench slot).
 */
export type UtilizationState = 'no_time_logged';

/** `priced` rows carry costs; `no-profile` rows show blank (null) costs. */
export type CostStatus = 'priced' | 'no-profile';

/** Minimal attendance input for capacity: one entry per recorded day. */
export interface UtilizationAttendance {
	date: string;
	status: string | null;
	/** Attendance `is_weekly_off` flag when a record exists; else scheduled. */
	is_weekly_off?: number | boolean | null;
}

/**
 * The resolved employment window capacity is scoped to. `start`/`end` are
 * `YYYY-MM-DD` days; `null` (or omitted) = open on that side.
 */
export interface CapacityWindow {
	start?: string | null;
	end?: string | null;
}

export interface UtilizationCapacity {
	month: string;
	/** Working days inside the window; days outside it land in no bucket. */
	working_days: number;
	weekly_off_days: number;
	holiday_days: number;
	leave_days: number;
	half_days: number;
	gross_capacity_hours: number;
	capacity_hours: number;
	/** `working_days` again, named for the pro-rating formula (they are equal). */
	employed_working_days: number;
	/** The full month's working days on the same calendar — the pro-rating denominator. */
	month_working_days: number;
}

/**
 * One trailing-month cell: the month, whether the employment window covers it,
 * and the utilization that month's pipeline reads (`null` when the month has no
 * capacity). A cell whose month is not employed has no reading at all — it
 * renders blank, unlike a `null` percent, which renders as an em dash.
 */
export interface TrailingMonth {
	month: string;
	employed: boolean;
	utilization_percent: number | null;
}

/** An employee's trailing window: the three cells (oldest first) plus the chronic verdict. */
export interface TrailingWindow {
	trailing: TrailingMonth[];
	chronic_under: boolean;
}

/** One team-trend point: the month, its capacity-weighted utilization and priced Bench Cost. */
export interface TrendPoint {
	month: string;
	utilization_percent: number | null;
	bench_cost: number | null;
}

export interface TeamRowInput {
	employee_id: number;
	employee_code?: string;
	employee_name?: string;
	/** Raw `employees.department`; null = unset (`''` normalizes to null). */
	department?: string | null;
	/** YYYY-MM */
	month: string;
	/** Raw `daily_entries` payloads (JSON string or parsed array) per assignment. */
	daily_entries?: unknown[];
	attendance?: UtilizationAttendance[];
	/** Injected active NON-optional holiday dates (YYYY-MM-DD); they shorten Capacity and the rate's Basis Hours alike — an optional holiday is a working day for both. */
	holidays?: ReadonlySet<string>;
	profiles?: SalaryProfile[];
	/** Resolved employment window from the shared roster selector. */
	employment_start?: string | null;
	employment_end?: string | null;
	/** The cross-month trailing window; omitted (single-month use) yields an empty one. */
	trailing?: TrailingWindow;
}

export interface UtilizationRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	/** Raw `employees.department`; null = unset (the page labels it "Unassigned"). */
	department: string | null;
	month: string;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	utilization_band: UtilizationBand | null;
	/** Missing timesheet evidence: the month's Logged Hours are 0. */
	state: UtilizationState | null;
	/** Resolved employment window; null = open bound (or no month scope). */
	employment_start: string | null;
	employment_end: string | null;
	/** The window does not cover the whole month (a chip names the dates). */
	is_partial_window: boolean;
	/** The trailing lens: three month cells (oldest first) — see `TrailingWindow`. */
	trailing: TrailingMonth[];
	/** Every employed month of the trailing window is under 80 (min two months). */
	chronic_under: boolean;
	/** Null when no profile covers the month — blank, never zero. */
	monthly_cost: number | null;
	/** Utilized portion: CTC hourly rate × logged hours (footing support). */
	fractional_cost: number | null;
	bench_cost: number | null;
	cost_status: CostStatus;
}

export interface UtilizationTotals {
	employee_count: number;
	priced_count: number;
	unpriced_count: number;
	/**
	 * The viewed month's rows with zero Logged Hours — month-wide by design
	 * (pre-band-filter, like the department rollup), unlike the counts above.
	 */
	no_logged_count: number;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	/** Sums cover priced rows only; unpriced rows contribute no cost. */
	monthly_cost: number | null;
	fractional_cost: number | null;
	bench_cost: number | null;
}

/** One department's rollup over a month's roster rows — the summary table's row. */
export interface DepartmentSummary {
	/** Raw `employees.department`; null = the unset bucket ("Unassigned" on screen). */
	department: string | null;
	headcount: number;
	/** Σ logged ÷ Σ capacity × 100, 2dp; null when the department credits no capacity. */
	capacity_weighted_utilization: number | null;
	logged_hours: number;
	capacity_hours: number;
	/** Σ over the department's priced rows; null when none of them is priced. */
	bench_cost: number | null;
	/** Rows in the department with zero Logged Hours for the month. */
	no_logged_count: number;
}

// ─── Small helpers ────────────────────────────────────────────────────

function round2(v: number): number {
	return toNumber(R(v).toDecimalPlaces(2));
}

function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number);
	if (!y || !m || m < 1 || m > 12) return 0;
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (!y || !m || m < 1 || m > 12) return month;
	return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Shift a `YYYY-MM` month by whole months; invalid input is returned as-is. */
function shiftMonth(month: string, delta: number): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	const absolute = year * 12 + (monthNumber - 1) + delta;
	const y = Math.floor(absolute / 12);
	const m = ((absolute % 12) + 12) % 12;
	return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * The six months ending at `month`, oldest first — the trend lens' span. The
 * row trailing window is its last three months (fixed by the spec).
 */
export function trendMonths(month: string): string[] {
	if (!isValidUtilizationMonth(month)) return [];
	const months: string[] = [];
	for (let delta = -5; delta <= 0; delta++) {
		months.push(shiftMonth(month, delta));
	}
	return months;
}

// ─── Capacity ─────────────────────────────────────────────────────────

/**
 * Net monthly capacity: each working day credits the standard day; weekly
 * offs and injected holidays credit zero; full-day leave zeroes its working
 * day and half-day leave halves it. Leave on a non-working day is ignored
 * (nothing to net out). The attendance weekly-off flag wins when a record
 * exists; days without records follow the scheduled rule.
 *
 * Only days inside `window` are counted, in any bucket (`working_days`,
 * `weekly_off_days`, `holiday_days`, `leave_days`, `half_days`,
 * `gross_capacity_hours`, `capacity_hours`); `month_working_days` always
 * counts the full month so costs can be pro-rated against it. `holidays` is
 * the active NON-optional set — an optional holiday is a full working day.
 */
export function buildCapacity(
	month: string,
	attendance: UtilizationAttendance[],
	holidays: ReadonlySet<string>,
	window: CapacityWindow = {}
): UtilizationCapacity {
	const total = daysInMonth(month);
	const empty: UtilizationCapacity = {
		month,
		working_days: 0,
		weekly_off_days: 0,
		holiday_days: 0,
		leave_days: 0,
		half_days: 0,
		gross_capacity_hours: 0,
		capacity_hours: 0,
		employed_working_days: 0,
		month_working_days: 0,
	};
	if (total <= 0) return empty;

	const start = window.start ?? null;
	const end = window.end ?? null;
	const byDate = new Map<string, UtilizationAttendance>();
	for (const row of attendance) {
		if (row && typeof row.date === 'string') byDate.set(row.date, row);
	}
	// `dayTypeFor` takes a mutable set; copy once so callers can pass read-only sets.
	const holidaySet = new Set(holidays);
	let workingDays = 0;
	let weeklyOffDays = 0;
	let holidayDays = 0;
	let leaveDays = 0;
	let halfDays = 0;
	let capacityHours = 0;
	let monthWorkingDays = 0;

	for (let day = 1; day <= total; day++) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const row = byDate.get(date);
		const flag = row?.is_weekly_off;
		const weeklyOff =
			flag === null || flag === undefined
				? isWeeklyOff(date)
				: flag === true || flag === 1;
		const dayType = dayTypeFor(date, holidaySet, weeklyOff);
		if (dayType === 'working') monthWorkingDays++;
		// Days outside the employment window land in no bucket at all.
		if ((start !== null && date < start) || (end !== null && date > end)) {
			continue;
		}
		if (dayType === 'weekly_off') {
			weeklyOffDays++;
			continue;
		}
		if (dayType === 'holiday') {
			holidayDays++;
			continue;
		}
		workingDays++;
		const kind = statusKind(row?.status ?? null);
		if (kind === 'leave') {
			leaveDays++;
		} else if (kind === 'half_day') {
			halfDays++;
			capacityHours += HALF_DAY_HOURS;
		} else {
			// Includes 'H' rows: on an optional holiday (never in the injected
			// set) the standard credit stands, not a holiday zero.
			capacityHours += STANDARD_WORKING_HOURS;
		}
	}

	return {
		month,
		working_days: workingDays,
		weekly_off_days: weeklyOffDays,
		holiday_days: holidayDays,
		leave_days: leaveDays,
		half_days: halfDays,
		gross_capacity_hours: workingDays * STANDARD_WORKING_HOURS,
		capacity_hours: capacityHours,
		employed_working_days: workingDays,
		month_working_days: monthWorkingDays,
	};
}

// ─── Utilization ──────────────────────────────────────────────────────

/** Logged-over-capacity percentage, or null when capacity is zero. */
export function utilizationPercent(
	loggedHours: number,
	capacityHours: number
): number | null {
	if (!(capacityHours > 0)) return null;
	return toNumber(
		div(mul(R(loggedHours), 100), R(capacityHours)).toDecimalPlaces(2)
	);
}

/** Under below 80, healthy from 80 through 100 inclusive, over above 100. */
export function bandForUtilization(
	percent: number | null
): UtilizationBand | null {
	if (percent === null || !Number.isFinite(percent)) return null;
	if (percent < UNDER_UTILIZATION_THRESHOLD) return 'under';
	if (percent <= OVER_UTILIZATION_THRESHOLD) return 'healthy';
	return 'over';
}

// ─── Basis hours (the payroll-aligned rate denominator) ──────────────

/**
 * The month's Basis Days under the Payroll Slip's rule (ADR-0010): every
 * non-Sunday day of the month, minus the injected active NON-optional
 * holidays. 2nd/4th Saturdays are NOT excluded — that is the Capacity
 * calendar, not this one. Mirrors `getWorkingDaysForMonth` day-for-day,
 * deliberately without importing it: that module pulls DB access into unit
 * tests. E2E proves the two agree against the shipped slip.
 */
export function basisDaysInMonth(
	month: string,
	holidays: ReadonlySet<string>
): number {
	const total = daysInMonth(month);
	if (total <= 0) return 0;
	const [year, monthNumber] = month.split('-').map(Number);
	let sundays = 0;
	let holidaysNotOnSunday = 0;
	for (let day = 1; day <= total; day++) {
		const isSunday =
			new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay() === 0;
		if (isSunday) {
			sundays++;
		} else if (holidays.has(`${month}-${String(day).padStart(2, '0')}`)) {
			holidaysNotOnSunday++;
		}
	}
	return total - sundays - holidaysNotOnSunday;
}

// ─── Cost (CTC basis) ─────────────────────────────────────────────────

/**
 * Monthly cost basis: stored CTC first, then gross salary, then gross.
 * Deliberate divergence from the billing Gross-first order — bench
 * prioritization needs true burn. Contract, lumpsum, hourly, and daily
 * engagements persist their monthly amount into these same stored fields,
 * so every salary type prices through this one rule.
 */
export function resolveMonthlyCost(profile: SalaryProfile): number {
	return profile.employer_cost || profile.gross_salary || profile.gross;
}

/**
 * Unrounded payroll-aligned CTC hourly rate: CTC ÷ Basis Hours, where
 * Basis Hours = the month's basis days × the profile's `std_hours_per_day`
 * (8 when unset). Mirrors the Payroll Slip (ADR-0010); the profile's own
 * `std_working_days` and its direct hourly/daily/custom rates never price a
 * row, exactly as they never price a slip. Money math uses this unrounded
 * value; the display rounds via `resolveCtcHourlyRate`.
 */
export function computeCtcHourlyRate(
	profile: SalaryProfile,
	basisDays: number
): number {
	const monthly = resolveMonthlyCost(profile);
	const hoursPerDay =
		profile.std_hours_per_day > 0
			? profile.std_hours_per_day
			: STD_HOURS_PER_DAY_DEFAULT;
	const basisHours = toNumber(mul(R(basisDays), R(hoursPerDay)));
	return basisHours > 0 ? toNumber(div(R(monthly), R(basisHours))) : 0;
}

/** Display CTC rate: the raw rate rounded to 2dp. */
export function resolveCtcHourlyRate(
	profile: SalaryProfile,
	basisDays: number
): number {
	return toNumber(
		R(computeCtcHourlyRate(profile, basisDays)).toDecimalPlaces(2)
	);
}

/**
 * Monthly Cost pro-rated by employed working days ÷ the month's working days
 * on the capacity calendar: `round2(monthly × employed / monthWorking)`.
 * Decimal math, never floats. A full-month window (the two counts equal)
 * reproduces the full monthly cost exactly; a window with no working days
 * costs 0 — its capacity is 0, so utilization reads null, not 0%.
 */
export function proratedMonthlyCost(
	monthlyCost: number,
	employedWorkingDays: number,
	monthWorkingDays: number
): number {
	if (!(employedWorkingDays > 0) || !(monthWorkingDays > 0)) return 0;
	return round2(
		toNumber(div(mul(R(monthlyCost), employedWorkingDays), monthWorkingDays))
	);
}

// ─── Team row + totals ────────────────────────────────────────────────

/** One priced team row; hours and utilization always shown. */
export function buildTeamRow(input: TeamRowInput): UtilizationRow {
	const month = input.month;
	const employmentStart = input.employment_start ?? null;
	const employmentEnd = input.employment_end ?? null;
	const holidaySet = input.holidays ?? new Set<string>();
	const capacity = buildCapacity(month, input.attendance ?? [], holidaySet, {
		start: employmentStart,
		end: employmentEnd,
	});
	const loggedHours = sumLoggedHoursForMonth(input.daily_entries ?? [], month);
	const percent = utilizationPercent(loggedHours, capacity.capacity_hours);
	// Zero Logged Hours is missing evidence, not a verdict: the state rides
	// along without touching the percent, the band or the row's sort slot.
	const state: UtilizationState | null =
		loggedHours === 0 ? 'no_time_logged' : null;
	// The rate and Capacity share this holiday set but not the calendar:
	// Basis Days keep 2nd/4th Saturdays, unlike the Capacity weekly-off rule.
	const basisDays = basisDaysInMonth(month, holidaySet);
	const profile = pickActiveProfile(input.profiles ?? [], month);
	// The window leaves days of the month outside it: start after the 1st, or
	// end before the month's last day (a null bound is open, never partial).
	const lastDay = daysInMonth(month);
	const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
	const isPartialWindow =
		lastDay > 0 &&
		((employmentStart !== null && employmentStart > `${month}-01`) ||
			(employmentEnd !== null && employmentEnd < monthEnd));
	// The trailing window is derived across months by the fetch; a single-month
	// row (unit use) has no history to show.
	const trailingWindow = input.trailing;
	const trailing = trailingWindow?.trailing ?? [];
	const chronicUnder = trailingWindow?.chronic_under ?? false;

	if (!profile) {
		return {
			employee_id: input.employee_id,
			employee_code: input.employee_code ?? '',
			employee_name: input.employee_name ?? '',
			department: input.department || null,
			month,
			capacity_hours: capacity.capacity_hours,
			logged_hours: loggedHours,
			utilization_percent: percent,
			utilization_band: bandForUtilization(percent),
			state,
			employment_start: employmentStart,
			employment_end: employmentEnd,
			is_partial_window: isPartialWindow,
			trailing,
			chronic_under: chronicUnder,
			monthly_cost: null,
			fractional_cost: null,
			bench_cost: null,
			cost_status: 'no-profile',
		};
	}

	const monthlyCost = proratedMonthlyCost(
		resolveMonthlyCost(profile),
		capacity.employed_working_days,
		capacity.month_working_days
	);
	const rawRate = computeCtcHourlyRate(profile, basisDays);
	const fractionalCost =
		loggedHours > 0 && rawRate > 0
			? toNumber(mul(R(rawRate), loggedHours).toDecimalPlaces(2))
			: 0;
	// Bench derives from the rounded fractional so the pair always foots to
	// monthly; overload past the monthly value goes honestly negative.
	const benchCost = toNumber(
		sub(R(monthlyCost), R(fractionalCost)).toDecimalPlaces(2)
	);

	return {
		employee_id: input.employee_id,
		employee_code: input.employee_code ?? '',
		employee_name: input.employee_name ?? '',
		department: input.department || null,
		month,
		capacity_hours: capacity.capacity_hours,
		logged_hours: loggedHours,
		utilization_percent: percent,
		utilization_band: bandForUtilization(percent),
		state,
		employment_start: employmentStart,
		employment_end: employmentEnd,
		is_partial_window: isPartialWindow,
		trailing,
		chronic_under: chronicUnder,
		monthly_cost: monthlyCost,
		fractional_cost: fractionalCost,
		bench_cost: benchCost,
		cost_status: 'priced',
	};
}

/**
 * Team totals; cost sums cover priced rows only, footing preserved.
 *
 * `rows` are the totalled grid (the payload's band-filtered rows when a flag
 * is set). `monthRows` is the viewed month's unfiltered roster and only
 * feeds `no_logged_count`: that count describes the month, like the
 * department rollup, so the summary line can never disagree with the rollup.
 * It defaults to `rows` for the unfiltered call.
 */
export function buildUtilizationTotals(
	rows: UtilizationRow[],
	monthRows: UtilizationRow[] = rows
): UtilizationTotals {
	let capacity = R(0);
	let logged = R(0);
	let monthly = R(0);
	let fractional = R(0);
	let bench = R(0);
	let priced = 0;

	for (const row of rows) {
		capacity = add(capacity, row.capacity_hours);
		logged = add(logged, row.logged_hours);
		if (row.cost_status === 'priced') {
			priced++;
			monthly = add(monthly, row.monthly_cost ?? 0);
			fractional = add(fractional, row.fractional_cost ?? 0);
			bench = add(bench, row.bench_cost ?? 0);
		}
	}

	let noLogged = 0;
	for (const row of monthRows) {
		if (row.state === 'no_time_logged') noLogged++;
	}

	const capacityNum = round2(toNumber(capacity));
	const loggedNum = round2(toNumber(logged));
	const hasCost = priced > 0;

	return {
		employee_count: rows.length,
		priced_count: priced,
		unpriced_count: rows.length - priced,
		no_logged_count: noLogged,
		capacity_hours: capacityNum,
		logged_hours: loggedNum,
		utilization_percent: utilizationPercent(loggedNum, capacityNum),
		monthly_cost: hasCost ? round2(toNumber(monthly)) : null,
		fractional_cost: hasCost ? round2(toNumber(fractional)) : null,
		bench_cost: hasCost ? round2(toNumber(bench)) : null,
	};
}

/**
 * Summarize one employee's per-month figures into the trailing window — the
 * months in the order the caller passes them (oldest first, exactly three) —
 * and the chronic verdict: at least two employed months, every employed month
 * below the under threshold with a real percent. A `null` percent never counts
 * as below (no capacity is not a low reading), so it blocks the marker.
 */
export function summarizeTrailing(months: TrailingMonth[]): TrailingWindow {
	const employed = months.filter((entry) => entry.employed);
	const chronicUnder =
		employed.length >= 2 &&
		employed.every(
			(entry) =>
				entry.utilization_percent !== null &&
				entry.utilization_percent < UNDER_UTILIZATION_THRESHOLD
		);
	return {
		trailing: months.map((entry) => ({ ...entry })),
		chronic_under: chronicUnder,
	};
}

/**
 * One team-trend point over a month's roster rows: capacity-weighted
 * utilization = `round2(Σ logged ÷ Σ capacity × 100)` (`null` when the roster
 * credits no capacity) and the Bench Cost summed over the month's priced rows
 * (`null` when none is priced). Money and percent math via `src/lib/money.ts`.
 */
export function buildTrendPoint(
	month: string,
	rows: UtilizationRow[]
): TrendPoint {
	let capacity = R(0);
	let logged = R(0);
	let bench = R(0);
	let priced = 0;
	for (const row of rows) {
		capacity = add(capacity, row.capacity_hours);
		logged = add(logged, row.logged_hours);
		if (row.cost_status === 'priced') {
			priced++;
			bench = add(bench, row.bench_cost ?? 0);
		}
	}
	const capacityHours = round2(toNumber(capacity));
	const loggedHours = round2(toNumber(logged));
	return {
		month,
		utilization_percent: utilizationPercent(loggedHours, capacityHours),
		bench_cost: priced > 0 ? round2(toNumber(bench)) : null,
	};
}

/**
 * One entry per department present in `rows` — the team summary table. The
 * department is the raw `Employees.department` value (`null` = unset, sorted
 * last; the page labels that bucket "Unassigned"); the name order ascending.
 *
 * Utilization is capacity-weighted exactly like the team trend (`round2(Σ
 * logged ÷ Σ capacity × 100)`, `null` when the bucket credits no capacity)
 * and Bench Cost sums the bucket's priced rows (`null` when none is priced),
 * so a department reads as its own team. Callers pass the month's roster rows
 * BEFORE the band filter: the rollup describes the month, and only the grid
 * narrows with the filters.
 */
export function buildDepartmentSummary(
	rows: UtilizationRow[]
): DepartmentSummary[] {
	const buckets = new Map<string | null, UtilizationRow[]>();
	for (const row of rows) {
		// `''` never reaches a row (the loader and `buildTeamRow` normalize it),
		// but the bucket rule is the same either way: unset is unset.
		const key = row.department || null;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(row);
		else buckets.set(key, [row]);
	}

	const summaries = [...buckets.entries()].map(([department, members]) => {
		let capacity = R(0);
		let logged = R(0);
		let bench = R(0);
		let priced = 0;
		let noLogged = 0;
		for (const row of members) {
			capacity = add(capacity, row.capacity_hours);
			logged = add(logged, row.logged_hours);
			if (row.state === 'no_time_logged') noLogged++;
			if (row.cost_status === 'priced') {
				priced++;
				bench = add(bench, row.bench_cost ?? 0);
			}
		}
		const capacityHours = round2(toNumber(capacity));
		const loggedHours = round2(toNumber(logged));
		return {
			department,
			headcount: members.length,
			capacity_weighted_utilization: utilizationPercent(
				loggedHours,
				capacityHours
			),
			logged_hours: loggedHours,
			capacity_hours: capacityHours,
			bench_cost: priced > 0 ? round2(toNumber(bench)) : null,
			no_logged_count: noLogged,
		};
	});

	return summaries.sort((a, b) => {
		if (a.department === b.department) return 0;
		if (a.department === null) return 1;
		if (b.department === null) return -1;
		return a.department.localeCompare(b.department);
	});
}

// ─── Server data fetch ──────────────────────────────────────────────

/** Filter-bar metadata for the team utilization report. */
export interface UtilizationMeta {
	months: string[];
	latest_month: string | null;
	current_month: string;
	flags: { value: UtilizationBand; label: string }[];
}

/** One month of team utilization rows plus totals. */
export interface UtilizationData {
	month: string;
	month_label: string;
	flag: UtilizationBand | null;
	rows: UtilizationRow[];
	totals: UtilizationTotals;
	/**
	 * The team trend: the six months ending at the viewed month, oldest first,
	 * each with capacity-weighted utilization and the priced Bench Cost total.
	 */
	trend: TrendPoint[];
	/**
	 * The month's Logged-versus-Capacity buckets: ISO weeks over the whole
	 * month, on the month's whole roster, so they foot to the payload's
	 * totals. The admin dashboard's trend chart reads this; the report page
	 * reads `trend` above.
	 */
	hours_trend: UtilizationBucketPoint[];
	/** What the month's roster filter dropped, and why; null when it dropped nobody. */
	disclosure: RosterDisclosure | null;
	/**
	 * The month's department rollup: one entry per department present in the
	 * month's roster rows (unset grouped as `null`), computed before the band
	 * filter — it describes the month, and the grid's filters narrow the
	 * detail only.
	 */
	departments: DepartmentSummary[];
}

/** Flag filter options for the filter bar (band labels match the 80/100 bands). */
export const UTILIZATION_FLAGS: { value: UtilizationBand; label: string }[] = [
	{ value: 'under', label: 'Under (< 80%)' },
	{ value: 'healthy', label: 'Healthy (80–100%)' },
	{ value: 'over', label: 'Over (> 100%)' },
];

/** YYYY-MM with a real calendar month. */
export function isValidUtilizationMonth(month: unknown): month is string {
	if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return false;
	const m = Number(month.slice(5, 7));
	return m >= 1 && m <= 12;
}

/** One of the three utilization bands. */
export function isValidUtilizationFlag(flag: unknown): flag is UtilizationBand {
	return flag === 'under' || flag === 'healthy' || flag === 'over';
}

/**
 * Default team sort: band (under, healthy, over, then null capacity) and
 * within a band bench cost descending so the biggest bleed surfaces first.
 * Unpriced (null bench) rows sort after priced rows in their band; ties
 * break by employee name, then id for stability.
 */
export function sortUtilizationRows(rows: UtilizationRow[]): UtilizationRow[] {
	const bandOrder = (band: UtilizationBand | null): number => {
		if (band === 'under') return 0;
		if (band === 'healthy') return 1;
		if (band === 'over') return 2;
		return 3;
	};
	return [...rows].sort((a, b) => {
		const bandDiff =
			bandOrder(a.utilization_band) - bandOrder(b.utilization_band);
		if (bandDiff !== 0) return bandDiff;
		const aBench = a.bench_cost;
		const bBench = b.bench_cost;
		if (aBench !== null && bBench !== null && aBench !== bBench) {
			return bBench - aBench;
		}
		if (aBench === null && bBench !== null) return 1;
		if (aBench !== null && bBench === null) return -1;
		return (
			a.employee_name.localeCompare(b.employee_name) ||
			a.employee_id - b.employee_id
		);
	});
}

function currentMonth(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

async function collectUtilizationMonths(): Promise<string[]> {
	const monthSet = new Set<string>();
	try {
		const [monthRows] = (await query(
			`SELECT DATE_FORMAT(attendance_date, '%Y-%m') AS month
			 FROM employee_attendance
			 GROUP BY month
			 ORDER BY month DESC`
		)) as [DbRow[], unknown];
		for (const r of monthRows) {
			const m = dbStr(r, 'month');
			if (m) monthSet.add(m);
		}
	} catch {
		/* employee_attendance may be empty */
	}
	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		for (const row of asgRows) {
			for (const { date } of parseDailyEntryRecords(row.daily_entries)) {
				if (date.length >= 7) monthSet.add(date.slice(0, 7));
			}
		}
	} catch {
		/* user_activity_assignments may not exist */
	}
	// App-activity months: the same two sources the employment window falls
	// back to. Restricted to live Payroll employees so the picker matches the
	// roster the grid shows — an admin-only month would render an empty grid.
	try {
		const [screenRows] = (await query(
			`SELECT DATE_FORMAT(st.date, '%Y-%m') AS month
			 FROM user_screen_time st
			 JOIN users u ON u.id = st.user_id
			 JOIN employees e ON e.id = u.employee_id AND e.isDelete = 0
			      AND e.employee_type = 'Payroll'
			 GROUP BY month
			 ORDER BY month DESC`
		)) as [DbRow[], unknown];
		for (const r of screenRows) {
			const m = dbStr(r, 'month');
			if (m) monthSet.add(m);
		}
	} catch {
		/* user_screen_time may not exist */
	}
	try {
		const [logRows] = (await query(
			`SELECT DATE_FORMAT(al.created_at, '%Y-%m') AS month
			 FROM user_activity_logs al
			 JOIN users u ON u.id = al.user_id
			 JOIN employees e ON e.id = u.employee_id AND e.isDelete = 0
			      AND e.employee_type = 'Payroll'
			 GROUP BY month
			 ORDER BY month DESC`
		)) as [DbRow[], unknown];
		for (const r of logRows) {
			const m = dbStr(r, 'month');
			if (m) monthSet.add(m);
		}
	} catch {
		/* user_activity_logs may not exist */
	}
	// Always offer the current month so the grid can be viewed even when
	// no attendance has been entered yet. Added before sorting so the
	// newest-first order holds.
	monthSet.add(currentMonth());
	// YYYY-MM sorts lexically, so reverse() = newest first.
	return Array.from(monthSet).sort().reverse();
}

/** Months + flag options for the filter bar. */
export async function fetchUtilizationMeta(): Promise<UtilizationMeta> {
	const months = await collectUtilizationMonths();
	const current = currentMonth();
	return {
		months,
		latest_month: months[0] ?? current,
		current_month: current,
		flags: UTILIZATION_FLAGS,
	};
}

/** One live `employees` row plus the evidence its employment window falls back to. */
interface UtilizationEmployee {
	id: number;
	code: string;
	name: string;
	department: string | null;
	employee_type: string | null;
	status: string;
	joining_date: string | null;
	hire_date: string | null;
	exit_date: string | null;
	first_attendance_date: string | null;
	last_attendance_date: string | null;
	first_logged_date: string | null;
	last_logged_date: string | null;
	first_screen_time_date: string | null;
	last_screen_time_date: string | null;
	first_activity_log_date: string | null;
	last_activity_log_date: string | null;
}

/**
 * The live employee directory (`isDelete = 0`) — never pre-filtered by type or
 * status: the shared roster selector owns the rule and reports what it drops.
 * The employment-window evidence needs recorded days, so the loader asks for
 * first/last days from attendance, screen time and activity logs — one grouped
 * query each, scoped to the employees whose start bound lacks
 * `joining_date`/`hire_date` or whose end bound lacks `exit_date`, the only
 * ones `resolveEmploymentWindow` reads evidence for. Screen time and activity
 * logs are keyed by user, mapped to the employee through `users.employee_id`
 * (the same directory join the Logged Hours payloads resolve by). The Logged
 * Hours bounds are filled from the assignment payloads the month fetch
 * already reads.
 */
async function loadUtilizationEmployees(): Promise<UtilizationEmployee[]> {
	const [rows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, employee_type, status,
		        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
		        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date,
		        DATE_FORMAT(exit_date, '%Y-%m-%d') AS exit_date
		 FROM employees
		 WHERE isDelete = 0
		 ORDER BY first_name, last_name`
	)) as [DbRow[], unknown];

	const evidenceIds: number[] = [];
	for (const r of rows) {
		const id = dbNum(r, 'id');
		if (!id) continue;
		const hasStart = Boolean(dbStr(r, 'joining_date') || dbStr(r, 'hire_date'));
		const hasEnd = Boolean(dbStr(r, 'exit_date'));
		if (!hasStart || !hasEnd) evidenceIds.push(id);
	}

	const attendanceBounds = new Map<
		number,
		{ first: string | null; last: string | null }
	>();
	const screenTimeBounds = new Map<
		number,
		{ first: string | null; last: string | null }
	>();
	const activityLogBounds = new Map<
		number,
		{ first: string | null; last: string | null }
	>();
	if (evidenceIds.length > 0) {
		const placeholders = evidenceIds.map(() => '?').join(', ');
		/** One grouped `employee_id → first/last day` query's rows, keyed. */
		const collectBounds = async (
			sql: string
		): Promise<Map<number, { first: string | null; last: string | null }>> => {
			const bounds = new Map<
				number,
				{ first: string | null; last: string | null }
			>();
			const [boundRows] = (await query(sql, evidenceIds)) as [DbRow[], unknown];
			for (const r of boundRows) {
				const empId = dbNum(r, 'employee_id');
				if (!empId) continue;
				bounds.set(empId, {
					first: dbStr(r, 'first_date') || null,
					last: dbStr(r, 'last_date') || null,
				});
			}
			return bounds;
		};
		try {
			const collected = await collectBounds(
				`SELECT employee_id,
				        DATE_FORMAT(MIN(attendance_date), '%Y-%m-%d') AS first_date,
				        DATE_FORMAT(MAX(attendance_date), '%Y-%m-%d') AS last_date
				 FROM employee_attendance
				 WHERE employee_id IN (${placeholders})
				 GROUP BY employee_id`
			);
			for (const [empId, bounds] of collected)
				attendanceBounds.set(empId, bounds);
		} catch {
			/* employee_attendance may not exist */
		}
		try {
			const collected = await collectBounds(
				`SELECT u.employee_id,
				        DATE_FORMAT(MIN(st.date), '%Y-%m-%d') AS first_date,
				        DATE_FORMAT(MAX(st.date), '%Y-%m-%d') AS last_date
				 FROM user_screen_time st
				 JOIN users u ON u.id = st.user_id
				 WHERE u.employee_id IN (${placeholders})
				 GROUP BY u.employee_id`
			);
			for (const [empId, bounds] of collected)
				screenTimeBounds.set(empId, bounds);
		} catch {
			/* user_screen_time may not exist */
		}
		try {
			const collected = await collectBounds(
				`SELECT u.employee_id,
				        DATE_FORMAT(MIN(l.created_at), '%Y-%m-%d') AS first_date,
				        DATE_FORMAT(MAX(l.created_at), '%Y-%m-%d') AS last_date
				 FROM user_activity_logs l
				 JOIN users u ON u.id = l.user_id
				 WHERE u.employee_id IN (${placeholders})
				 GROUP BY u.employee_id`
			);
			for (const [empId, bounds] of collected)
				activityLogBounds.set(empId, bounds);
		} catch {
			/* user_activity_logs may not exist */
		}
	}

	const employees: UtilizationEmployee[] = [];
	for (const r of rows) {
		const id = dbNum(r, 'id');
		if (!id) continue;
		const bounds = attendanceBounds.get(id);
		const screenTime = screenTimeBounds.get(id);
		const activityLogs = activityLogBounds.get(id);
		employees.push({
			id,
			code: dbStr(r, 'employee_id'),
			name: dbStr(r, 'name') || `Employee ${id}`,
			department: dbStr(r, 'department') || null,
			employee_type: dbStr(r, 'employee_type') || null,
			status: dbStr(r, 'status'),
			joining_date: dbStr(r, 'joining_date') || null,
			hire_date: dbStr(r, 'hire_date') || null,
			exit_date: dbStr(r, 'exit_date') || null,
			first_attendance_date: bounds?.first ?? null,
			last_attendance_date: bounds?.last ?? null,
			first_logged_date: null,
			last_logged_date: null,
			first_screen_time_date: screenTime?.first ?? null,
			last_screen_time_date: screenTime?.last ?? null,
			first_activity_log_date: activityLogs?.first ?? null,
			last_activity_log_date: activityLogs?.last ?? null,
		});
	}
	return employees;
}

/** The shared roster selector's input for one directory row. */
function toRosterInput(row: UtilizationEmployee): RosterEmployeeInput {
	return {
		id: row.id,
		employee_id: row.code,
		name: row.name,
		department: row.department,
		employee_type: row.employee_type,
		status: row.status,
		isDelete: 0,
		joining_date: row.joining_date,
		hire_date: row.hire_date,
		exit_date: row.exit_date,
		first_attendance_date: row.first_attendance_date,
		last_attendance_date: row.last_attendance_date,
		first_logged_date: row.first_logged_date,
		last_logged_date: row.last_logged_date,
		first_screen_time_date: row.first_screen_time_date,
		last_screen_time_date: row.last_screen_time_date,
		first_activity_log_date: row.first_activity_log_date,
		last_activity_log_date: row.last_activity_log_date,
	};
}

async function loadSalaryProfilesGrouped(): Promise<
	Map<number, SalaryProfile[]>
> {
	const grouped = new Map<number, SalaryProfile[]>();
	try {
		const [rows] = (await query(
			`SELECT employee_id, gross, gross_salary, employer_cost,
			        hourly_rate, daily_rate, std_hours_per_day, std_working_days,
			        salary_type, tds_percentage,
			        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
			        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
			 FROM employee_salary_profile
			 WHERE is_active = 1`
		)) as [DbRow[], unknown];
		for (const p of rows) {
			const employeeId = dbNum(p, 'employee_id');
			if (!employeeId) continue;
			const profile: SalaryProfile = {
				employee_id: employeeId,
				gross: dbNum(p, 'gross'),
				gross_salary: dbNum(p, 'gross_salary'),
				employer_cost: dbNum(p, 'employer_cost'),
				hourly_rate: dbNum(p, 'hourly_rate'),
				daily_rate: dbNum(p, 'daily_rate'),
				std_hours_per_day: dbNum(p, 'std_hours_per_day', 8),
				std_working_days: dbNum(p, 'std_working_days', 26),
				salary_type: dbStr(p, 'salary_type', 'monthly'),
				tds_percentage: dbNum(p, 'tds_percentage', 0),
				effective_from: dbStr(p, 'effective_from', '') || null,
				effective_to: dbStr(p, 'effective_to', '') || null,
			};
			const arr = grouped.get(employeeId) || [];
			arr.push(profile);
			grouped.set(employeeId, arr);
		}
	} catch {
		/* table may not exist */
	}
	return grouped;
}

/** What one month of the lens needs beyond the shared directory/profile load. */
interface UtilizationMonthScope {
	holidays: ReadonlySet<string>;
	attendanceByEmployee: Map<number, UtilizationAttendance[]>;
	loggedEntriesByEmployee: Map<number, LoggedEntry[]>;
	/**
	 * Capacity clamp for a view narrower than the whole month (the range
	 * fetch), omitted for a whole-month view. Days outside it credit no
	 * capacity, so each row's employment window narrows to the intersection.
	 */
	capacityWindow?: CapacityWindow;
}

/** One month's roster and rows — the per-month view every lens reads. */
interface UtilizationMonthView {
	rows: UtilizationRow[];
	rowByEmployee: Map<number, UtilizationRow>;
	disclosure: RosterDisclosure | null;
}

/** One month's Payroll roster, with what the selector left out. */
interface UtilizationMonthRoster {
	members: RosterMember[];
	disclosure: RosterDisclosure | null;
}

/** Narrow a lower window bound down to a clamp day; `null` stays open. */
function clampStart(
	start: string | null,
	clamp: string | null | undefined
): string | null {
	if (clamp === undefined || clamp === null) return start;
	if (start === null) return clamp;
	return start > clamp ? start : clamp;
}

/** Narrow an upper window bound down to a clamp day; `null` stays open. */
function clampEnd(
	end: string | null,
	clamp: string | null | undefined
): string | null {
	if (clamp === undefined || clamp === null) return end;
	if (end === null) return clamp;
	return end < clamp ? end : clamp;
}

/**
 * Select the month-scoped Payroll roster for one month: every lens reads the
 * same selector, so a month's membership never differs between the report, a
 * trailing cell and the dashboard's range.
 */
function selectMonthRoster(
	employees: UtilizationEmployee[],
	month: string
): UtilizationMonthRoster {
	const { roster, disclosure } = selectPayrollRoster(
		employees.map(toRosterInput),
		{ month }
	);
	return { members: roster, disclosure };
}

/**
 * Build one month's view from a roster the caller selected: one row per member
 * with that month's attendance, holidays, Logged Hours and effective-dated
 * profile — the same pipeline the viewed month always ran, so a trailing or
 * trend month reads exactly as it would if it were viewed. A caller that reads
 * several months off one roster (the dashboard's range) passes the same roster
 * to every month, so the row set cannot change between segments.
 */
function buildMonthView(
	month: string,
	salaryGrouped: Map<number, SalaryProfile[]>,
	scope: UtilizationMonthScope,
	roster: UtilizationMonthRoster
): UtilizationMonthView {
	const rows = roster.members.map((member) => {
		// Logged Hours arrive pre-parsed (one already-parsed payload) and
		// already scoped to the month, so six months cost one parse per
		// assignment instead of one per month.
		const entries = scope.loggedEntriesByEmployee.get(member.id) ?? [];
		return buildTeamRow({
			employee_id: member.id,
			employee_code: member.employee_id,
			employee_name: member.name,
			department: member.department ?? null,
			month,
			employment_start: clampStart(
				member.employment_start ?? null,
				scope.capacityWindow?.start
			),
			employment_end: clampEnd(
				member.employment_end ?? null,
				scope.capacityWindow?.end
			),
			daily_entries: [entries],
			attendance: scope.attendanceByEmployee.get(member.id) ?? [],
			holidays: scope.holidays,
			profiles: salaryGrouped.get(member.id) ?? [],
		});
	});
	return {
		rows,
		rowByEmployee: new Map(rows.map((row) => [row.employee_id, row])),
		disclosure: roster.disclosure,
	};
}

// ─── Shared span load ────────────────────────────────────────────────

/**
 * Everything one span of months loads once, before any view is built.
 *
 * A span is a run of contiguous months, oldest first. The directory and the
 * salary profiles are loaded whole (neither is date-scoped); holidays,
 * attendance and Logged Hours are loaded for the span's calendar bounds and
 * bucketed back per month, so any number of months costs one query per source.
 */
interface UtilizationSpanLoad {
	employees: UtilizationEmployee[];
	salaryGrouped: Map<number, SalaryProfile[]>;
	/** Active NON-optional holidays, per span month. */
	holidaysByMonth: Map<string, Set<string>>;
	/** Attendance, per span month then per employee. */
	attendanceByMonth: Map<string, Map<number, UtilizationAttendance[]>>;
	/** Parsed Logged Hours entries, per span month then per employee. */
	entriesByMonth: Map<string, Map<number, LoggedEntry[]>>;
}

/**
 * Load one span of months. `months` is non-empty and contiguous, oldest first.
 *
 * The employees' Logged Hours evidence bounds are filled here, from the
 * payloads already in hand, because the employment window's fallback reads
 * them before a month can be selected.
 */
async function loadUtilizationSpan(
	months: readonly string[]
): Promise<UtilizationSpanLoad> {
	const monthSet = new Set(months);
	const spanStart = `${months[0]}-01`;
	const lastMonth = months[months.length - 1];
	const spanEnd = `${lastMonth}-${String(daysInMonth(lastMonth)).padStart(2, '0')}`;

	const employees = await loadUtilizationEmployees();
	const salaryGrouped = await loadSalaryProfilesGrouped();

	// Capacity and the rate's Basis Hours consume the active NON-optional
	// holidays only: an optional holiday is a full working day for this
	// report, exactly as it is for the attendance and payroll paths.
	// `is_optional` is the switch; the `type` enum is ignored by every
	// consumer. One span query, split back per month.
	const holidaysByMonth = new Map<string, Set<string>>();
	try {
		const [holidayRows] = (await query(
			`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
			        COALESCE(is_optional, 0) AS is_optional
			 FROM holiday_master
			 WHERE is_active = 1 AND date BETWEEN ? AND ?
			 ORDER BY date`,
			[spanStart, spanEnd]
		)) as [DbRow[], unknown];
		for (const r of holidayRows) {
			if (dbNum(r, 'is_optional', 0) === 1) continue;
			const date = dbStr(r, 'date');
			const dateMonth = date.slice(0, 7);
			if (!monthSet.has(dateMonth)) continue;
			const set = holidaysByMonth.get(dateMonth) ?? new Set<string>();
			set.add(date);
			holidaysByMonth.set(dateMonth, set);
		}
	} catch {
		/* holiday_master unavailable — capacity falls back to weekly offs only */
	}

	const attendanceByMonth = new Map<
		string,
		Map<number, UtilizationAttendance[]>
	>();
	try {
		const [attendanceRows] = (await query(
			`SELECT employee_id,
			        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
			        status, is_weekly_off
			 FROM employee_attendance
			 WHERE attendance_date BETWEEN ? AND ?
			 ORDER BY attendance_date`,
			[spanStart, spanEnd]
		)) as [DbRow[], unknown];
		for (const r of attendanceRows) {
			const empId = dbNum(r, 'employee_id');
			const date = dbStr(r, 'date');
			if (!empId || !date) continue;
			const dateMonth = date.slice(0, 7);
			if (!monthSet.has(dateMonth)) continue;
			const byEmployee =
				attendanceByMonth.get(dateMonth) ??
				new Map<number, UtilizationAttendance[]>();
			const arr = byEmployee.get(empId) || [];
			arr.push({
				date,
				status: dbStr(r, 'status', '') || null,
				is_weekly_off: dbNum(r, 'is_weekly_off', 0),
			});
			byEmployee.set(empId, arr);
			attendanceByMonth.set(dateMonth, byEmployee);
		}
	} catch {
		/* employee_attendance may not exist */
	}

	const entriesByEmployee = new Map<number, unknown[]>();
	try {
		const [assignmentRows] = (await query(
			`SELECT uaa.employee_id, uaa.daily_entries,
			        u.employee_id AS user_employee_id
			 FROM user_activity_assignments uaa
			 LEFT JOIN users u ON u.id = uaa.user_id
			 WHERE uaa.status <> 'Cancelled'
			   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		for (const row of assignmentRows) {
			const empId = resolveLoggedHoursEmployeeId({
				employee_id: dbNum(row, 'employee_id', 0) || null,
				user_employee_id: dbNum(row, 'user_employee_id', 0) || null,
			});
			if (!empId) continue;
			const arr = entriesByEmployee.get(empId) || [];
			arr.push(row.daily_entries);
			entriesByEmployee.set(empId, arr);
		}
	} catch {
		/* user_activity_assignments may not exist */
	}

	// The Logged Hours evidence bounds come from the payloads already in hand:
	// the earliest and latest day an employee logged anything, which the
	// employment window falls back to when the record has no joining/exit date.
	// The same pass buckets the parsed entries by month for the span, so a
	// span of any length costs one parse per payload, not one per month.
	const employeeById = new Map(employees.map((emp) => [emp.id, emp]));
	const entriesByMonth = new Map<string, Map<number, LoggedEntry[]>>();
	for (const [empId, payloads] of entriesByEmployee) {
		const employee = employeeById.get(empId);
		if (!employee) continue;
		for (const payload of payloads) {
			for (const { date } of parseDailyEntryRecords(payload)) {
				const day = date.slice(0, 10);
				if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
				if (
					employee.first_logged_date === null ||
					day < employee.first_logged_date
				) {
					employee.first_logged_date = day;
				}
				if (
					employee.last_logged_date === null ||
					day > employee.last_logged_date
				) {
					employee.last_logged_date = day;
				}
			}
			for (const entry of parseDailyEntries(payload)) {
				const entryMonth = entry.date.slice(0, 7);
				if (!monthSet.has(entryMonth)) continue;
				const byEmployee =
					entriesByMonth.get(entryMonth) ?? new Map<number, LoggedEntry[]>();
				const arr = byEmployee.get(empId) || [];
				arr.push(entry);
				byEmployee.set(empId, arr);
				entriesByMonth.set(entryMonth, byEmployee);
			}
		}
	}

	return {
		employees,
		salaryGrouped,
		holidaysByMonth,
		attendanceByMonth,
		entriesByMonth,
	};
}

// ─── Range lens: a window shorter than a month ──────────────────────

/** How a window's Logged-versus-Capacity trend buckets its days. */
export type UtilizationTrendBucket = 'day' | 'iso-week';

/** One bucket of a window's Logged-versus-Capacity trend. */
export interface UtilizationBucketPoint {
	/** Bucket start, `YYYY-MM-DD`. */
	label: string;
	logged: number;
	capacity: number;
	/**
	 * The bucket has not finished: it holds today, or its ISO week runs past
	 * the window's end. The chart marks it in progress.
	 */
	partial: boolean;
}

/** Today as `YYYY-MM-DD` on the server's own calendar. */
function todayIso(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}

/** Every day from `start` to `end`, both inclusive, oldest first. */
function eachDay(start: string, end: string): string[] {
	const days: string[] = [];
	// UTC midnight keeps the arithmetic exact: no DST gap, no timezone shift.
	const cursor = new Date(`${start}T00:00:00Z`);
	const last = new Date(`${end}T00:00:00Z`);
	while (cursor <= last) {
		days.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return days;
}

/**
 * The Monday of the ISO week holding `day`. ISO weeks start on Monday and the
 * weekday is read in UTC, so the answer never shifts with the server's
 * timezone.
 */
function isoWeekStart(day: string): string {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	return date.toISOString().slice(0, 10);
}

/** The Sunday that ends the ISO week holding `day`. */
function isoWeekEnd(day: string): string {
	const monday = new Date(`${isoWeekStart(day)}T00:00:00Z`);
	monday.setUTCDate(monday.getUTCDate() + 6);
	return monday.toISOString().slice(0, 10);
}

/** A real calendar day, `YYYY-MM-DD`. */
function isValidDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, date] = value.split('-').map(Number);
	return (
		new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10) ===
		value
	);
}

/** The months a day range spans, oldest first. */
function monthsFromTo(firstMonth: string, lastMonth: string): string[] {
	const months: string[] = [];
	for (
		let month = firstMonth;
		month <= lastMonth;
		month = shiftMonth(month, 1)
	) {
		months.push(month);
	}
	return months;
}

/** Keep only the entries inside `[start, end]`, keyed by employee. */
function entriesInWindow(
	byEmployee: Map<number, LoggedEntry[]>,
	start: string,
	end: string
): Map<number, LoggedEntry[]> {
	const scoped = new Map<number, LoggedEntry[]>();
	if (start > end) return scoped;
	for (const [empId, entries] of byEmployee) {
		const kept = entries.filter(
			(entry) => entry.date >= start && entry.date <= end
		);
		if (kept.length > 0) scoped.set(empId, kept);
	}
	return scoped;
}

/**
 * Sum two segments of one employee's range row. The hours are the range's
 * Logged Hours and capacity on the report's capacity calendar, the percent
 * and band are recomputed from the sums, and the costs are the segments'
 * pro-rated costs added — a range's cost is whole only when every segment of
 * it is priced, because the profile covering one month need not cover the
 * next.
 */
function mergeRangeRow(
	base: UtilizationRow,
	segment: UtilizationRow
): UtilizationRow {
	const logged = round2(
		toNumber(add(R(base.logged_hours), R(segment.logged_hours)))
	);
	const capacity = round2(
		toNumber(add(R(base.capacity_hours), R(segment.capacity_hours)))
	);
	const percent = utilizationPercent(logged, capacity);
	const priced =
		base.cost_status === 'priced' && segment.cost_status === 'priced';
	return {
		...base,
		capacity_hours: capacity,
		logged_hours: logged,
		utilization_percent: percent,
		utilization_band: bandForUtilization(percent),
		// Zero Logged Hours is missing evidence, exactly as in the month row.
		state: logged === 0 ? 'no_time_logged' : null,
		monthly_cost: priced
			? round2(
					toNumber(add(R(base.monthly_cost ?? 0), R(segment.monthly_cost ?? 0)))
				)
			: null,
		fractional_cost: priced
			? round2(
					toNumber(
						add(R(base.fractional_cost ?? 0), R(segment.fractional_cost ?? 0))
					)
				)
			: null,
		bench_cost: priced
			? round2(
					toNumber(add(R(base.bench_cost ?? 0), R(segment.bench_cost ?? 0)))
				)
			: null,
		cost_status: priced ? 'priced' : 'no-profile',
	};
}

/**
 * Build a window's Logged-versus-Capacity buckets on the same calendar the
 * rows use, so the buckets always foot to the window's totals: each row's
 * capacity over the bucket is its employment window narrowed to the bucket's
 * days, and the buckets tile the window day for day.
 *
 * A bucket always holds whole days of exactly one month — a day bucket is one
 * day, and an ISO-week bucket is clipped to the window, which for the month
 * lens is one calendar month.
 */
function buildHoursTrend(input: {
	bucket: UtilizationTrendBucket;
	/** Window start, `YYYY-MM-DD`, inclusive. */
	start: string;
	/** Window end, `YYYY-MM-DD`, inclusive. */
	end: string;
	/** The days whose Logged Hours count. */
	loggedWindow: CapacityWindow;
	/** The window's roster rows; each carries its resolved employment window. */
	rows: readonly UtilizationRow[];
	load: UtilizationSpanLoad;
}): UtilizationBucketPoint[] {
	const today = todayIso();
	const loggedStart = input.loggedWindow.start ?? input.start;
	const loggedEnd = input.loggedWindow.end ?? input.end;
	const points: UtilizationBucketPoint[] = [];
	// Days arrive oldest first, and the days of one bucket are contiguous, so
	// the bucket's key marks where the previous one ended.
	let bucketKey = '';
	let bucket: string[] = [];
	const pushBucket = () => {
		if (bucket.length === 0) return;
		const bucketStart = bucket[0];
		const bucketEnd = bucket[bucket.length - 1];
		const bucketMonth = bucketStart.slice(0, 7);
		const entriesByEmployee =
			input.load.entriesByMonth.get(bucketMonth) ??
			new Map<number, LoggedEntry[]>();
		const attendanceByEmployee =
			input.load.attendanceByMonth.get(bucketMonth) ??
			new Map<number, UtilizationAttendance[]>();
		const holidays =
			input.load.holidaysByMonth.get(bucketMonth) ?? new Set<string>();

		let logged = R(0);
		let capacity = R(0);
		for (const row of input.rows) {
			for (const entry of entriesByEmployee.get(row.employee_id) ?? []) {
				if (entry.date < bucketStart || entry.date > bucketEnd) continue;
				if (entry.date < loggedStart || entry.date > loggedEnd) continue;
				logged = add(logged, entry.hours);
			}
			capacity = add(
				capacity,
				buildCapacity(
					bucketMonth,
					attendanceByEmployee.get(row.employee_id) ?? [],
					holidays,
					{
						start: clampStart(row.employment_start, bucketStart),
						end: clampEnd(row.employment_end, bucketEnd),
					}
				).capacity_hours
			);
		}
		// A day bucket ends with its own day; an ISO-week bucket ends on its
		// Sunday, which the window end can cut short.
		const naturalEnd =
			input.bucket === 'day' ? bucketStart : isoWeekEnd(bucketEnd);
		points.push({
			label: bucketStart,
			logged: round2(toNumber(logged)),
			capacity: round2(toNumber(capacity)),
			partial:
				(bucketStart <= today && today <= bucketEnd) || bucketEnd < naturalEnd,
		});
	};
	for (const day of eachDay(input.start, input.end)) {
		const key = input.bucket === 'day' ? day : isoWeekStart(day);
		if (bucket.length > 0 && key !== bucketKey) {
			pushBucket();
			bucket = [];
		}
		bucketKey = key;
		bucket.push(day);
	}
	pushBucket();
	return points;
}

/** One window's team utilization, read on the same pipeline as the month. */
export interface UtilizationRangeData {
	/** The months the window spans, oldest first. */
	months: string[];
	/** The days whose Logged Hours count. */
	logged_start: string;
	logged_end: string;
	/** The days credited capacity. */
	capacity_start: string;
	capacity_end: string;
	rows: UtilizationRow[];
	totals: UtilizationTotals;
	/** What the roster selector left out, and why; null when nobody. */
	disclosure: RosterDisclosure | null;
	/** Logged versus Capacity by day over the window. */
	hours_trend: UtilizationBucketPoint[];
}

/**
 * Team utilization for a range of days: the range's end month's Payroll
 * roster, read over the range on the same pipeline the month report runs, so
 * a short window cannot disagree with the month it reaches into.
 *
 * The range is split by calendar month and each segment reuses
 * `selectPayrollRoster` + `buildTeamRow` for its month, sharing the one
 * loader; the roster itself is selected once for the range's end month, so a
 * leaver whose employment window ended before that month is off every
 * segment — the disclosure counts them, exactly as the month report would.
 * Rows merge per employee: Logged Hours and capacity are the sums of the
 * segments, the percent and band are recomputed from those sums.
 *
 * `loggedStart`/`loggedEnd` bound the days whose hours count;
 * `capacityStart`/`capacityEnd` bound the days credited capacity. The two are
 * separate because a caller may want one window's hours against another's
 * capacity, and each segment clamps itself to its own pair.
 *
 * Returns null when either range is not a pair of real days in order.
 */
export async function fetchUtilizationRangeData(
	loggedStart: string,
	loggedEnd: string,
	capacityStart: string,
	capacityEnd: string
): Promise<UtilizationRangeData | null> {
	if (
		!isValidDay(loggedStart) ||
		!isValidDay(loggedEnd) ||
		loggedStart > loggedEnd
	) {
		return null;
	}
	if (
		!isValidDay(capacityStart) ||
		!isValidDay(capacityEnd) ||
		capacityStart > capacityEnd
	) {
		return null;
	}

	const start = loggedStart < capacityStart ? loggedStart : capacityStart;
	const end = loggedEnd > capacityEnd ? loggedEnd : capacityEnd;
	const endMonth = end.slice(0, 7);
	const months = monthsFromTo(start.slice(0, 7), endMonth);

	const load = await loadUtilizationSpan(months);
	const roster = selectMonthRoster(load.employees, endMonth);
	const rosterById = new Map(
		roster.members.map((member) => [member.id, member])
	);

	const merged = new Map<number, UtilizationRow>();
	for (const month of months) {
		const monthFirst = `${month}-01`;
		const monthLast = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
		const view = buildMonthView(
			month,
			load.salaryGrouped,
			{
				holidays: load.holidaysByMonth.get(month) ?? new Set<string>(),
				attendanceByEmployee: load.attendanceByMonth.get(month) ?? new Map(),
				loggedEntriesByEmployee: entriesInWindow(
					load.entriesByMonth.get(month) ?? new Map(),
					loggedStart > monthFirst ? loggedStart : monthFirst,
					loggedEnd < monthLast ? loggedEnd : monthLast
				),
				capacityWindow: { start: capacityStart, end: capacityEnd },
			},
			roster
		);
		for (const row of view.rows) {
			const existing = merged.get(row.employee_id);
			merged.set(
				row.employee_id,
				existing ? mergeRangeRow(existing, row) : row
			);
		}
	}

	// The segment rows carry their capacity-clamped window; the merged row
	// carries the roster's resolved window, so the range's own extent is what
	// `is_partial_window` measures against.
	const rows = [...merged.values()].map((row) => {
		const member = rosterById.get(row.employee_id);
		const employmentStart = member?.employment_start ?? null;
		const employmentEnd = member?.employment_end ?? null;
		return {
			...row,
			month: endMonth,
			employment_start: employmentStart,
			employment_end: employmentEnd,
			is_partial_window:
				(employmentStart !== null && employmentStart > start) ||
				(employmentEnd !== null && employmentEnd < end),
			// A range has no month history to read a trailing window from.
			trailing: [],
			chronic_under: false,
		};
	});

	return {
		months,
		logged_start: loggedStart,
		logged_end: loggedEnd,
		capacity_start: capacityStart,
		capacity_end: capacityEnd,
		rows,
		totals: buildUtilizationTotals(rows),
		disclosure: roster.disclosure,
		hours_trend: buildHoursTrend({
			bucket: 'day',
			start,
			end,
			loggedWindow: { start: loggedStart, end: loggedEnd },
			rows,
			load,
		}),
	};
}

/**
 * Full team payload for one month: one row per employee on the month-scoped
 * Payroll roster, with capacity and Monthly Cost pro-rated to each row's
 * resolved employment window, sorted by flag band then bench cost descending,
 * plus the roster's exclusion disclosure. Optional flag narrows to one band.
 * Returns null for an invalid month.
 *
 * The same call also drives the lenses: every row carries its trailing window
 * (the viewed month and the two before it) and the chronic verdict, and the
 * payload carries the six-month team trend. Attendance, holidays and Logged
 * Hours are loaded once for the six-month span and every month is derived
 * from that single load.
 */
export async function fetchUtilizationData(
	month: string,
	flag: UtilizationBand | null = null
): Promise<UtilizationData | null> {
	if (!isValidUtilizationMonth(month)) return null;
	if (flag !== null && !isValidUtilizationFlag(flag)) return null;

	const span = trendMonths(month);
	const load = await loadUtilizationSpan(span);

	// One view per span month — the same pipeline the viewed month runs, so a
	// trailing cell is exactly the value the row would show if that month were
	// viewed, and the trend reads each month's roster the same way.
	const views = new Map<string, UtilizationMonthView>();
	for (const spanMonth of span) {
		views.set(
			spanMonth,
			buildMonthView(
				spanMonth,
				load.salaryGrouped,
				{
					holidays: load.holidaysByMonth.get(spanMonth) ?? new Set<string>(),
					attendanceByEmployee:
						load.attendanceByMonth.get(spanMonth) ?? new Map(),
					loggedEntriesByEmployee:
						load.entriesByMonth.get(spanMonth) ?? new Map(),
				},
				selectMonthRoster(load.employees, spanMonth)
			)
		);
	}

	// The trailing window is the last three span months, oldest first; a month
	// the roster does not hold is a month the window did not cover (blank).
	const trailingSpan = span.slice(-3);
	const viewed = views.get(month)!;
	const rows: UtilizationRow[] = viewed.rows.map((row) => ({
		...row,
		...summarizeTrailing(
			trailingSpan.map((spanMonth) => {
				const monthRow = views
					.get(spanMonth)!
					.rowByEmployee.get(row.employee_id);
				return {
					month: spanMonth,
					employed: monthRow !== undefined,
					utilization_percent: monthRow ? monthRow.utilization_percent : null,
				};
			})
		),
	}));

	// The trend is the team lens over each month's whole roster, unfiltered by
	// the flag: the chart must not change shape with the band filter.
	const trend = span.map((spanMonth) =>
		buildTrendPoint(spanMonth, views.get(spanMonth)!.rows)
	);

	// The month's Logged-versus-Capacity buckets: ISO weeks over the whole
	// month on the viewed month's whole roster, unfiltered like the rollup, so
	// they foot to the month's totals.
	const monthFirst = `${month}-01`;
	const monthLast = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
	const hoursTrend = buildHoursTrend({
		bucket: 'iso-week',
		start: monthFirst,
		end: monthLast,
		loggedWindow: { start: monthFirst, end: monthLast },
		rows,
		load,
	});

	const sorted = sortUtilizationRows(rows);
	const filtered =
		flag !== null ? sorted.filter((r) => r.utilization_band === flag) : sorted;

	return {
		month,
		month_label: monthLabel(month),
		flag,
		rows: filtered,
		// The grid's totals follow the band filter, except the no-log count:
		// it counts the viewed month (the rollup's scope) so the summary line
		// and the department table can never disagree.
		totals: buildUtilizationTotals(filtered, rows),
		trend,
		hours_trend: hoursTrend,
		disclosure: viewed.disclosure,
		// The month's rollup reads the roster BEFORE the band filter.
		departments: buildDepartmentSummary(rows),
	};
}
