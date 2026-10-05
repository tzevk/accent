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
 * resolved window for the pro-rating tickets.
 *
 * No mid-month pro-rating yet: a joiner/leaver inside the window is measured
 * against full-month capacity in v1.
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
	/** Resolved employment window; null = open bound (or no month scope). */
	employment_start: string | null;
	employment_end: string | null;
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
		const weeklyOff =
			flag === null || flag === undefined
				? isWeeklyOff(date)
				: flag === true || flag === 1;
		const dayType = dayTypeFor(date, holidaySet, weeklyOff);
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
	const loggedHours = sumLoggedHoursForMonth(input.daily_entries ?? [], month);
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
			employment_start: input.employment_start ?? null,
			employment_end: input.employment_end ?? null,
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
		employment_start: input.employment_start ?? null,
		employment_end: input.employment_end ?? null,
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
 * Payroll roster, against full-month capacity (no mid-month pro-rating in
 * v1), sorted by flag band then bench cost descending, plus the roster's
 * exclusion disclosure. Optional flag narrows to one band.
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

	let holidaySet = new Set<string>();
	try {
		const [holidayRows] = (await query(
			`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date
			 FROM holiday_master
			 WHERE is_active = 1 AND date BETWEEN ? AND ?
			 ORDER BY date`,
			[`${month}-01`, `${month}-31`]
		)) as [DbRow[], unknown];
		holidaySet = new Set(
			holidayRows.map((r) => dbStr(r, 'date')).filter(Boolean)
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
