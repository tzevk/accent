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
 * Logged Hours as the fallback evidence) must cover the month. The payload
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
 * covering profile keeps its blank costs. Totals count such rows
 * (`no_logged_count`) over the same flag-filtered scope as `employee_count`.
 *
 * Holidays: the caller injects active NON-optional holidays only. An optional
 * holiday is a full working day for Capacity — matching the attendance and
 * payroll paths — regardless of the attendance status recorded on it (an `H`
 * row falls through to the standard 8h credit).
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
	parseDailyEntryRecords,
	sumLoggedHoursForMonth,
} from '@/lib/logged-hours';
import { R, add, sub, mul, div, toNumber } from '@/lib/money';
import {
	selectPayrollRoster,
	type RosterDisclosure,
	type RosterEmployeeInput,
} from '@/lib/payroll-roster';
import { query } from '@/utils/database';

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

export interface TeamRowInput {
	employee_id: number;
	employee_code?: string;
	employee_name?: string;
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
}

export interface UtilizationRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
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
	/** Rows with zero Logged Hours for the month — same scope as the counts. */
	no_logged_count: number;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	/** Sums cover priced rows only; unpriced rows contribute no cost. */
	monthly_cost: number | null;
	fractional_cost: number | null;
	bench_cost: number | null;
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

	if (!profile) {
		return {
			employee_id: input.employee_id,
			employee_code: input.employee_code ?? '',
			employee_name: input.employee_name ?? '',
			month,
			capacity_hours: capacity.capacity_hours,
			logged_hours: loggedHours,
			utilization_percent: percent,
			utilization_band: bandForUtilization(percent),
			state,
			employment_start: employmentStart,
			employment_end: employmentEnd,
			is_partial_window: isPartialWindow,
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
		month,
		capacity_hours: capacity.capacity_hours,
		logged_hours: loggedHours,
		utilization_percent: percent,
		utilization_band: bandForUtilization(percent),
		state,
		employment_start: employmentStart,
		employment_end: employmentEnd,
		is_partial_window: isPartialWindow,
		monthly_cost: monthlyCost,
		fractional_cost: fractionalCost,
		bench_cost: benchCost,
		cost_status: 'priced',
	};
}

/** Team totals; cost sums cover priced rows only, footing preserved. */
export function buildUtilizationTotals(
	rows: UtilizationRow[]
): UtilizationTotals {
	let capacity = R(0);
	let logged = R(0);
	let monthly = R(0);
	let fractional = R(0);
	let bench = R(0);
	let priced = 0;
	let noLogged = 0;

	for (const row of rows) {
		capacity = add(capacity, row.capacity_hours);
		logged = add(logged, row.logged_hours);
		if (row.state === 'no_time_logged') noLogged++;
		if (row.cost_status === 'priced') {
			priced++;
			monthly = add(monthly, row.monthly_cost ?? 0);
			fractional = add(fractional, row.fractional_cost ?? 0);
			bench = add(bench, row.bench_cost ?? 0);
		}
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
	/** What the month's roster filter dropped, and why; null when it dropped nobody. */
	disclosure: RosterDisclosure | null;
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

type DbRow = Record<string, unknown>;

function dbStr(row: DbRow, key: string, fallback = ''): string {
	const v = row[key];
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'bigint') return String(v);
	return fallback;
}

function dbNum(row: DbRow, key: string, fallback = 0): number {
	const v = row[key];
	if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
	if (typeof v === 'string') {
		const parsed = Number(v);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
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
	email: string;
	username: string;
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
}

/**
 * The live employee directory (`isDelete = 0`) — never pre-filtered by type or
 * status: the shared roster selector owns the rule and reports what it drops.
 * The employment-window fallbacks need recorded evidence, so the loader also
 * asks for each employee's first/last attendance day in one grouped query; the
 * Logged Hours bounds are filled from the assignment payloads the month fetch
 * already reads.
 */
async function loadUtilizationEmployees(): Promise<UtilizationEmployee[]> {
	const [rows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        email, username, department, employee_type, status,
		        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
		        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date,
		        DATE_FORMAT(exit_date, '%Y-%m-%d') AS exit_date
		 FROM employees
		 WHERE isDelete = 0
		 ORDER BY first_name, last_name`
	)) as [DbRow[], unknown];

	const attendanceBounds = new Map<
		number,
		{ first: string | null; last: string | null }
	>();
	try {
		const [boundRows] = (await query(
			`SELECT employee_id,
			        DATE_FORMAT(MIN(attendance_date), '%Y-%m-%d') AS first_date,
			        DATE_FORMAT(MAX(attendance_date), '%Y-%m-%d') AS last_date
			 FROM employee_attendance
			 GROUP BY employee_id`
		)) as [DbRow[], unknown];
		for (const r of boundRows) {
			const empId = dbNum(r, 'employee_id');
			if (!empId) continue;
			attendanceBounds.set(empId, {
				first: dbStr(r, 'first_date') || null,
				last: dbStr(r, 'last_date') || null,
			});
		}
	} catch {
		/* employee_attendance may not exist */
	}

	const employees: UtilizationEmployee[] = [];
	for (const r of rows) {
		const id = dbNum(r, 'id');
		if (!id) continue;
		const bounds = attendanceBounds.get(id);
		employees.push({
			id,
			code: dbStr(r, 'employee_id'),
			name: dbStr(r, 'name') || `Employee ${id}`,
			email: dbStr(r, 'email'),
			username: dbStr(r, 'username'),
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
	};
}

async function loadUtilizationUserMaps(
	employees: UtilizationEmployee[]
): Promise<{
	userToEmployee: Map<number, number>;
	userKeyToEmployee: Map<string, number>;
}> {
	const userToEmployee = new Map<number, number>();
	const userKeyToEmployee = new Map<string, number>();
	for (const e of employees) {
		if (e.email) userKeyToEmployee.set(e.email.toLowerCase(), e.id);
		if (e.username) userKeyToEmployee.set(e.username.toLowerCase(), e.id);
	}
	try {
		const [userRows] = (await query(
			`SELECT id, employee_id, email, username FROM users WHERE isDelete = 0`
		)) as [DbRow[], unknown];
		for (const u of userRows) {
			const userId = dbNum(u, 'id');
			const empId = dbNum(u, 'employee_id', 0);
			if (userId && empId) userToEmployee.set(userId, empId);
			const email = dbStr(u, 'email').toLowerCase();
			const username = dbStr(u, 'username').toLowerCase();
			if (email && empId) userKeyToEmployee.set(email, empId);
			if (username && empId) userKeyToEmployee.set(username, empId);
		}
	} catch {
		/* users table unavailable */
	}
	return { userToEmployee, userKeyToEmployee };
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

/**
 * Full team payload for one month: one row per employee on the month-scoped
 * Payroll roster, with capacity and Monthly Cost pro-rated to each row's
 * resolved employment window, sorted by flag band then bench cost descending,
 * plus the roster's exclusion disclosure. Optional flag narrows to one band.
 * Returns null for an invalid month.
 */
export async function fetchUtilizationData(
	month: string,
	flag: UtilizationBand | null = null
): Promise<UtilizationData | null> {
	if (!isValidUtilizationMonth(month)) return null;
	if (flag !== null && !isValidUtilizationFlag(flag)) return null;

	const employees = await loadUtilizationEmployees();
	const [{ userToEmployee, userKeyToEmployee }, salaryGrouped] =
		await Promise.all([
			loadUtilizationUserMaps(employees),
			loadSalaryProfilesGrouped(),
		]);

	// Capacity and the rate's Basis Hours consume the active NON-optional
	// holidays only: an optional holiday is a full working day for this
	// report, exactly as it is for the attendance and payroll paths.
	// `is_optional` is the switch; the `type` enum is ignored by every
	// consumer.
	let holidaySet = new Set<string>();
	try {
		const [holidayRows] = (await query(
			`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
			        COALESCE(is_optional, 0) AS is_optional
			 FROM holiday_master
			 WHERE is_active = 1 AND date BETWEEN ? AND ?
			 ORDER BY date`,
			[`${month}-01`, `${month}-31`]
		)) as [DbRow[], unknown];
		holidaySet = new Set(
			holidayRows
				.filter((r) => dbNum(r, 'is_optional', 0) !== 1)
				.map((r) => dbStr(r, 'date'))
				.filter(Boolean)
		);
	} catch {
		/* holiday_master unavailable — capacity falls back to weekly offs only */
	}

	const attendanceByEmployee = new Map<number, UtilizationAttendance[]>();
	try {
		const [attendanceRows] = (await query(
			`SELECT employee_id,
			        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
			        status, is_weekly_off
			 FROM employee_attendance
			 WHERE DATE_FORMAT(attendance_date, '%Y-%m') = ?
			 ORDER BY attendance_date`,
			[month]
		)) as [DbRow[], unknown];
		for (const r of attendanceRows) {
			const empId = dbNum(r, 'employee_id');
			const date = dbStr(r, 'date');
			if (!empId || !date) continue;
			const arr = attendanceByEmployee.get(empId) || [];
			arr.push({
				date,
				status: dbStr(r, 'status', '') || null,
				is_weekly_off: dbNum(r, 'is_weekly_off', 0),
			});
			attendanceByEmployee.set(empId, arr);
		}
	} catch {
		/* employee_attendance may not exist */
	}

	const entriesByEmployee = new Map<number, unknown[]>();
	try {
		const [assignmentRows] = (await query(
			`SELECT uaa.user_id, uaa.employee_id, uaa.daily_entries,
			        u.email AS user_email, u.username AS user_username
			 FROM user_activity_assignments uaa
			 LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
			 WHERE uaa.status <> 'Cancelled'
			   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		for (const row of assignmentRows) {
			let empId = dbNum(row, 'employee_id', 0) || null;
			if (!empId) {
				const userId = dbNum(row, 'user_id', 0) || null;
				if (userId && userToEmployee.has(userId)) {
					empId = userToEmployee.get(userId)!;
				} else {
					const email = dbStr(row, 'user_email').toLowerCase();
					const username = dbStr(row, 'user_username').toLowerCase();
					if (email && userKeyToEmployee.has(email)) {
						empId = userKeyToEmployee.get(email)!;
					} else if (username && userKeyToEmployee.has(username)) {
						empId = userKeyToEmployee.get(username)!;
					}
				}
			}
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
	const employeeById = new Map(employees.map((emp) => [emp.id, emp]));
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
		}
	}

	// The shared selector owns the month's roster rule and the disclosure of
	// the non-Payroll candidates it drops.
	const { roster, disclosure } = selectPayrollRoster(
		employees.map(toRosterInput),
		{ month }
	);

	const rows: UtilizationRow[] = roster.map((member) =>
		buildTeamRow({
			employee_id: member.id,
			employee_code: member.employee_id,
			employee_name: member.name,
			month,
			employment_start: member.employment_start ?? null,
			employment_end: member.employment_end ?? null,
			daily_entries: entriesByEmployee.get(member.id) ?? [],
			attendance: attendanceByEmployee.get(member.id) ?? [],
			holidays: holidaySet,
			profiles: salaryGrouped.get(member.id) ?? [],
		})
	);

	const sorted = sortUtilizationRows(rows);
	const filtered =
		flag !== null ? sorted.filter((r) => r.utilization_band === flag) : sorted;

	return {
		month,
		month_label: monthLabel(month),
		flag,
		rows: filtered,
		totals: buildUtilizationTotals(filtered),
		disclosure,
	};
}
