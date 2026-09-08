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
 *   where fractional = CTC hourly rate × logged hours. Fractional + bench
 *   always foots to monthly. Rows with no covering salary profile show blank
 *   (null, never zero) costs with an explicit `no-profile` flag.
 *
 * Cost basis note: the CTC hourly rate mirrors `computeRawHourlyRate` but is
 * denominated in CTC, with direct rates for hourly/daily/custom types and
 * monthly apportionment over `std_working_days` (default 26) ×
 * `std_hours_per_day` (default 8) otherwise. That standard-days denominator
 * is intentionally distinct from the actual-working-days capacity denominator
 * above; the gap is documented, not hidden.
 *
 * Calendar logic is reused verbatim from the timesheet report (`statusKind`,
 * `dayTypeFor`, `isScheduledWeeklyOff`); profile selection reuses
 * `pickActiveProfile` (effective-range cover, else latest active). Holiday
 * sets are injected by the caller, so this module has no DB dependency.
 * No mid-month pro-rating: joiners/leavers are measured against full-month
 * capacity in v1.
 */

import {
	statusKind,
	dayTypeFor,
	isScheduledWeeklyOff,
} from '@/app/reports/timesheet-report/data-source';
import {
	parseDailyEntries,
	pickActiveProfile,
	type SalaryProfile,
} from '@/app/reports/manhours-billing/data-source';
import { R, add, sub, mul, div, toNumber } from '@/lib/money';

// ─── Constants ────────────────────────────────────────────────────────

/** Standard working day in hours; half-day leave credits half of this. */
export const STANDARD_WORKING_HOURS = 8;
/** Capacity credited for a half-day (`HD`) leave on a working day. */
export const HALF_DAY_HOURS = 4;
/** Utilization below this percent reads as under-loaded. */
export const UNDER_UTILIZATION_THRESHOLD = 80;
/** Utilization above this percent reads as over-loaded. */
export const OVER_UTILIZATION_THRESHOLD = 100;
/** Rate-apportionment fallback when a profile omits standard working days. */
export const STD_WORKING_DAYS_DEFAULT = 26;
/** Rate-apportionment fallback when a profile omits standard hours per day. */
export const STD_HOURS_PER_DAY_DEFAULT = 8;

// ─── Public types ─────────────────────────────────────────────────────

export type UtilizationBand = 'under' | 'healthy' | 'over';

/** `priced` rows carry costs; `no-profile` rows show blank (null) costs. */
export type CostStatus = 'priced' | 'no-profile';

/** Minimal attendance input for capacity: one entry per recorded day. */
export interface UtilizationAttendance {
	date: string;
	status: string | null;
	/** Attendance `is_weekly_off` flag when a record exists; else scheduled. */
	is_weekly_off?: number | boolean | null;
}

export interface UtilizationCapacity {
	month: string;
	working_days: number;
	weekly_off_days: number;
	holiday_days: number;
	leave_days: number;
	half_days: number;
	gross_capacity_hours: number;
	capacity_hours: number;
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
	/** Injected active-holiday dates (YYYY-MM-DD). */
	holidays?: ReadonlySet<string>;
	profiles?: SalaryProfile[];
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

function toNum(v: unknown): number {
	const num = Number(v);
	return Number.isFinite(num) ? num : 0;
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
 */
export function buildCapacity(
	month: string,
	attendance: UtilizationAttendance[],
	holidays: ReadonlySet<string>
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
	};
	if (total <= 0) return empty;

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

	for (let day = 1; day <= total; day++) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const row = byDate.get(date);
		const flag = row?.is_weekly_off;
		const isWeeklyOff =
			flag === null || flag === undefined
				? isScheduledWeeklyOff(date)
				: flag === true || flag === 1;
		const dayType = dayTypeFor(date, holidaySet, isWeeklyOff);
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
	};
}

// ─── Logged hours ─────────────────────────────────────────────────────

/**
 * Uncapped project hours logged in the month across assignment payloads.
 * Entries outside the month and hours ≤ 0 are ignored. Equals the
 * timesheet `computeMonthlyHours` normal + overtime total: the daily cap is
 * a display split, never a clip, so overtime stays in the numerator.
 */
export function sumLoggedHours(
	dailyEntriesList: unknown[],
	month: string
): number {
	let total = 0;
	for (const raw of dailyEntriesList) {
		for (const entry of parseDailyEntries(raw)) {
			if (typeof entry.date !== 'string' || !entry.date.startsWith(month)) {
				continue;
			}
			const hours = toNum(entry.hours);
			if (hours > 0) total += hours;
		}
	}
	return round2(total);
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
 * Unrounded CTC hourly rate — mirrors `computeRawHourlyRate` but denominated
 * in CTC. Direct stored rate for hourly/daily/custom types; otherwise the
 * monthly CTC apportioned over standard days × hours per day. Money math
 * uses this unrounded value; the display rounds via `resolveCtcHourlyRate`.
 */
export function computeCtcHourlyRate(profile: SalaryProfile): number {
	if (profile.salary_type === 'hourly' && profile.hourly_rate > 0) {
		return profile.hourly_rate;
	}
	if (profile.salary_type === 'daily' && profile.daily_rate > 0) {
		return profile.daily_rate;
	}
	if (profile.salary_type === 'custom' && profile.hourly_rate > 0) {
		return profile.hourly_rate;
	}
	const monthly = resolveMonthlyCost(profile);
	const days =
		profile.std_working_days > 0
			? profile.std_working_days
			: STD_WORKING_DAYS_DEFAULT;
	const hoursPerDay =
		profile.std_hours_per_day > 0
			? profile.std_hours_per_day
			: STD_HOURS_PER_DAY_DEFAULT;
	const divisor = toNumber(mul(R(days), R(hoursPerDay)));
	return divisor > 0 ? toNumber(div(R(monthly), R(divisor))) : 0;
}

/** Display CTC rate: the raw rate rounded to 2dp. */
export function resolveCtcHourlyRate(profile: SalaryProfile): number {
	return toNumber(R(computeCtcHourlyRate(profile)).toDecimalPlaces(2));
}

// ─── Team row + totals ────────────────────────────────────────────────

/** One priced team row; hours and utilization always shown. */
export function buildTeamRow(input: TeamRowInput): UtilizationRow {
	const month = input.month;
	const capacity = buildCapacity(
		month,
		input.attendance ?? [],
		input.holidays ?? new Set()
	);
	const loggedHours = sumLoggedHours(input.daily_entries ?? [], month);
	const percent = utilizationPercent(loggedHours, capacity.capacity_hours);
	const profile = pickActiveProfile(input.profiles ?? [], month);

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
			monthly_cost: null,
			fractional_cost: null,
			bench_cost: null,
			cost_status: 'no-profile',
		};
	}

	const monthlyCost = round2(resolveMonthlyCost(profile));
	const rawRate = computeCtcHourlyRate(profile);
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

	const capacityNum = round2(toNumber(capacity));
	const loggedNum = round2(toNumber(logged));
	const hasCost = priced > 0;

	return {
		employee_count: rows.length,
		priced_count: priced,
		unpriced_count: rows.length - priced,
		capacity_hours: capacityNum,
		logged_hours: loggedNum,
		utilization_percent: utilizationPercent(loggedNum, capacityNum),
		monthly_cost: hasCost ? round2(toNumber(monthly)) : null,
		fractional_cost: hasCost ? round2(toNumber(fractional)) : null,
		bench_cost: hasCost ? round2(toNumber(bench)) : null,
	};
}
