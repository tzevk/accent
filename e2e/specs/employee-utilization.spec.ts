import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from '@playwright/test';
import ExcelJS from 'exceljs';
import { R } from '@/lib/money';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import {
	UTILIZATION_CTC,
	UTILIZATION_DEPARTMENTS,
	UTILIZATION_LATER_MONTH,
	UTILIZATION_MONTH,
	UTILIZATION_OPTIONAL_HOLIDAY,
	UTILIZATION_PROJECTS,
	UTILIZATION_ROSTER,
	cleanupUtilizationFixtures,
	utilizationMemberForPlan,
	type UtilizationMember,
	type UtilizationPlan,
} from '../lib/utilization-fixtures';

/**
 * Employee Utilization: month-scoped payroll roster (ticket #293),
 * window-pro-rated Capacity / Monthly Cost (ticket #294) and the
 * payroll-aligned CTC ÷ Basis Hours rate (ticket #295).
 *
 * Every expected figure is re-derived in this file from the raw `employees`
 * rows, `employee_attendance` evidence, `user_activity_assignments` payloads,
 * `employee_salary_profile` rows, `holiday_master` and the calendar. Nothing
 * here imports the report's `data-source`, the shared roster selector,
 * `@/lib/logged-hours` or `@/utils/weekly-off`, so the report cannot mark its
 * own homework; the expected rules are the documented ones:
 *
 *   window start = joining_date → hire_date → first attendance → first Logged
 *                  Hours → open if active, unresolved otherwise
 *   window end   = exit_date → last attendance → last Logged Hours
 *                  → open if active, unresolved otherwise
 *   capacity     = working days inside the window × 8h, where a working day is
 *                  neither a weekly off (Sundays + 2nd/4th Saturdays, or the
 *                  attendance `is_weekly_off` flag when a record exists) nor
 *                  an active NON-optional holiday; leave zeroes its day and
 *                  a half day credits 4h. An active optional holiday is a
 *                  working day — an 'H'-status row on it still credits 8h.
 *   monthly cost = round2(CTC × employed working days ÷ the month's working
 *                  days) over the Capacity calendar.
 *   rate         = CTC ÷ Basis Hours, Basis Hours = the month's basis days
 *                  (every non-Sunday day minus the active non-optional
 *                  holidays — 2nd/4th Saturdays STAY IN, unlike Capacity) ×
 *                  the profile's std_hours_per_day (default 8). Fractional =
 *                  round2(rate × logged hours), bench = monthly − fractional
 *                  (footing must hold); a fully logged month pays the CTC.
 *                  No covering profile → null costs, never zero.
 *   partial flag = the window does not cover the whole month; the chip names
 *                  the window clamped to the month (`15 Jan – 31 Jan`).
 *   state        = `no_time_logged` when the month's Logged Hours are 0 —
 *                  missing timesheet evidence, not a 0% verdict. The percent,
 *                  the band and the band-then-bench position are unchanged,
 *                  and `totals.no_logged_count` counts the viewed month's
 *                  such rows — month-wide, pre-band-filter like the
 *                  department rollup (ticket #296).
 *   trailing     = the viewed month and the two before it, oldest first. A
 *                  cell's `employed` is the employment window intersecting
 *                  that month; its percent is the value `deriveRow` gives that
 *                  employee in that month (null when the month has no
 *                  capacity). `chronic_under` = at least two employed months
 *                  and every employed month below 80 with a real percent.
 *   trend        = the six months ending at the viewed month, oldest first:
 *                  capacity-weighted utilization (round2(Σ logged ÷ Σ capacity
 *                  × 100) over each month's roster rows, null when no
 *                  capacity) and the priced rows' Bench Cost total (null when
 *                  none is priced) — unfiltered by the flag band.
 *   department   = the raw `employees.department` (free text, '' = unset) on
 *                  every row, and the payload's `departments` rollup: one
 *                  entry per department present in the month's roster rows
 *                  (unset as null, sorted last by name ascending), each with
 *                  headcount, capacity-weighted utilization, logged/capacity
 *                  hours, the priced rows' Bench Cost sum (null when none is
 *                  priced) and the zero-Logged-Hours count. Computed before
 *                  the flag filter — the rollup describes the month, the grid
 *                  narrows only. The page labels null "Unassigned" and filters
 *                  the grid client-side from the summary table or the
 *                  Department control (both compose with month/band/search).
 *   breakdown    = the lazily fetched `/api/reports/employee-utilization/
 *                  projects?month&employee_id` payload: every non-cancelled
 *                  assignment resolved to the employee and summed for the
 *                  month with the canonical reader, bucketed by its project
 *                  (activity/discipline pairs as detail, each summed and
 *                  hours descending); project groups sorted hours descending
 *                  (ties by project id ascending), the top N = 5 shown and
 *                  the rest in `other` (hours + spilled project count); hours
 *                  whose assignment carries no project — or a project row the
 *                  fixture/DB does not resolve — stay in `no_project`, never
 *                  merged into `other`. `logged_hours` is the buckets' sum,
 *                  which must equal the row's Logged Hours. The display name
 *                  is `project_title` → `projects.name` → `project_code` →
 *                  `Project #<id>`. The page fetches it on row expansion and
 *                  renders it under `project-breakdown` (bucket rows
 *                  `project-row`/`no-project-row` with `data-project`,
 *                  `data-hours`; activity rows `activity-row`; an Other row
 *                  only when something spilled) with the month's timesheet
 *                  link (`breakdown-timesheet-link`).
 *
 * The page's own API payload is asserted against that derivation; the DOM is
 * read through the page's `data-testid`/`data-*` attributes, never classes.
 * The chart is asserted through its `data-points` hook (`month:utilization:
 * bench` triples, oldest first, empty between the colons for a null).
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header the way `security-fixtures` does for isolation (ADR-0013): in a
	// combined run the attendance suite's grid traffic otherwise exhausts the
	// in-memory `api` budget (120/min per identity) and 429s this file's later
	// tests. TEST-NET-style address that never routes anywhere.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.11' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = UTILIZATION_MONTH;
const LATER_MONTH = UTILIZATION_LATER_MONTH;
const MONTH_LABEL = 'January 2019';
const LATER_MONTH_LABEL = 'March 2019';
const DAYS_IN_MONTH = 31;
const STANDARD_DAY_HOURS = 8;

/**
 * The report's fixed span rule, re-implemented: the six months ending at the
 * viewed month, oldest first (2018-08 … 2019-01). The trailing window is its
 * last three months.
 */
function spanMonths(month: string): string[] {
	const [year, monthNumber] = month.split('-').map(Number);
	const months: string[] = [];
	for (let delta = 5; delta >= 0; delta--) {
		const absolute = year * 12 + (monthNumber - 1) - delta;
		months.push(
			`${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`
		);
	}
	return months;
}

const SPAN_MONTHS = spanMonths(MONTH);
const TRAILING_MONTHS = SPAN_MONTHS.slice(-3);

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

/** The display rule the page's `monthLabel` applies, re-implemented. */
function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/**
 * Parse the chart's `data-points` hook: `month:utilization:bench` triples,
 * oldest first, comma-separated, an empty field for a null.
 */
function parseChartPoints(raw: string): Array<{
	month: string;
	utilizationPercent: number | null;
	benchCost: number | null;
}> {
	if (!raw) return [];
	return raw.split(',').map((triple) => {
		const [month, utilization, bench] = triple.split(':');
		return {
			month,
			utilizationPercent: utilization === '' ? null : Number(utilization),
			benchCost: bench === '' ? null : Number(bench),
		};
	});
}

// ─── Independent derivations ─────────────────────────────────────────

/** ADR-0004 weekly-off rule, re-implemented: Sundays + 2nd/4th Saturdays. */
function isWeeklyOff(date: string): boolean {
	const day = Number(date.slice(8, 10));
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	if (weekday === 0) return true;
	if (weekday !== 6) return false;
	const week = Math.ceil(day / 7);
	return week === 2 || week === 4;
}

/** Logged Hours days carried by one `daily_entries` blob. */
function loggedDays(payload: unknown): string[] {
	let parsed = payload;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	const items: unknown[] = parsed;
	const days: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object' || !('date' in item)) continue;
		const date = item.date;
		if (typeof date !== 'string') continue;
		const day = date.slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
		days.push(day);
	}
	return days;
}

/** Hours carried by one `daily_entries` blob inside a month; uncapped. */
function loggedHoursInMonth(payload: unknown, month: string): number {
	let parsed = payload;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return 0;
		}
	}
	if (!Array.isArray(parsed)) return 0;
	const items: unknown[] = parsed;
	let total = 0;
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		if (!('date' in item) || !('hours' in item)) continue;
		const { date, hours } = item;
		if (typeof date !== 'string') continue;
		const day = date.slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !day.startsWith(month)) continue;
		const parsedHours =
			typeof hours === 'number'
				? hours
				: typeof hours === 'string'
					? Number.parseFloat(hours)
					: Number.NaN;
		if (Number.isFinite(parsedHours) && parsedHours > 0) total += parsedHours;
	}
	return Math.round(total * 100) / 100;
}

interface EmploymentWindow {
	start: string | null;
	end: string | null;
	unresolved: boolean;
}

interface RawEmployee {
	id: number;
	employee_id: string;
	employee_type: string | null;
	status: string;
	joining_date: string | null;
	hire_date: string | null;
	exit_date: string | null;
	/** Raw `employees.department`; '' = unset, exactly as the report reads it. */
	department: string | null;
	first_attendance: string | null;
	last_attendance: string | null;
	first_logged: string | null;
	last_logged: string | null;
}

/** The documented fallback order, re-implemented for the assertion side. */
function deriveWindow(employee: RawEmployee): EmploymentWindow {
	const isActive = employee.status === 'active';
	const start =
		employee.joining_date ??
		employee.hire_date ??
		employee.first_attendance ??
		employee.first_logged ??
		null;
	const end =
		employee.exit_date ??
		employee.last_attendance ??
		employee.last_logged ??
		null;
	const unresolved = (!start && !isActive) || (!end && !isActive);
	return { start: start ?? null, end: end ?? null, unresolved };
}

function lastDayOf(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return `${month}-${String(last).padStart(2, '0')}`;
}

function intersects(window: EmploymentWindow, month: string): boolean {
	if (window.unresolved) return false;
	const start = `${month}-01`;
	const end = lastDayOf(month);
	if (window.start !== null && window.start > end) return false;
	if (window.end !== null && window.end < start) return false;
	return true;
}

// ─── Capacity, pro-rated cost and the partial chip (ticket #294) ─────

/** The timesheet report's leave statuses: a leave day nets its capacity out. */
const LEAVE_STATUS: Record<string, true> = {
	PL: true,
	CL: true,
	SL: true,
	ML: true,
	EL: true,
	L: true,
	LWP: true,
};

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

/** The report's 2dp rounding: Decimal HALF_UP (src/lib/money), never float. */
function round2(value: number): number {
	return R(value).toDecimalPlaces(2).toNumber();
}

interface AttendanceDay {
	status: string | null;
	isWeeklyOff: number;
}

interface MonthCalendar {
	/** Active optional holidays — working days, never subtracted. */
	optionalHolidays: string[];
	/** Active non-optional holidays — the days Capacity subtracts. */
	nonOptionalHolidays: Set<string>;
}

/** Split the month's holidays by the `is_optional` switch, active ones only. */
function deriveHolidaySets(
	holidays: { date: string; is_optional: number; is_active: number }[]
): MonthCalendar {
	const optionalHolidays: string[] = [];
	const nonOptionalHolidays = new Set<string>();
	for (const holiday of holidays) {
		if (Number(holiday.is_active) !== 1) continue;
		const date = String(holiday.date).slice(0, 10);
		if (Number(holiday.is_optional) === 1) optionalHolidays.push(date);
		else nonOptionalHolidays.add(date);
	}
	return { optionalHolidays, nonOptionalHolidays };
}

/**
 * The Payroll Slip's Basis Days (ADR-0010), re-implemented: every non-Sunday
 * day of the month minus the active non-optional holidays. 2nd/4th Saturdays
 * stay in — that is exactly where this calendar parts ways with Capacity.
 */
function basisDaysIn(
	month: string,
	nonOptionalHolidays: ReadonlySet<string>
): number {
	const daysInMonth = Number(lastDayOf(month).slice(8, 10));
	const [year, monthNumber] = month.split('-').map(Number);
	let basisDays = 0;
	for (let day = 1; day <= daysInMonth; day++) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const isSunday =
			new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay() === 0;
		if (isSunday || nonOptionalHolidays.has(date)) continue;
		basisDays++;
	}
	return basisDays;
}

/** The row's salary-profile inputs: CTC and hours per day, or none. */
interface DerivedRate {
	ctc: number;
	hoursPerDay: number;
}

interface DerivedRow {
	capacityHours: number;
	employedWorkingDays: number;
	monthWorkingDays: number;
	loggedHours: number;
	utilizationPercent: number | null;
	utilizationBand: string | null;
	/** `no_time_logged` when the month's Logged Hours are 0. */
	state: string | null;
	/** The month's Basis Days the rate divided CTC by (payroll's calendar). */
	basisDays: number;
	/** Unrounded CTC ÷ Basis Hours; null when no profile covers the month. */
	rate: number | null;
	costStatus: 'priced' | 'no-profile';
	monthlyCost: number | null;
	fractionalCost: number | null;
	benchCost: number | null;
	isPartialWindow: boolean;
	chip: string | null;
}

/**
 * The report's capacity, rate and cost rules, re-derived from raw rows: only
 * the working days inside the window credit hours (the attendance weekly-off
 * flag wins over the schedule; leave zeroes its day, HD credits 4h, everything
 * else — including 'H' on an optional holiday — credits 8h); the rate is
 * CTC ÷ (the month's Basis Days × the profile's hours per day); Monthly Cost
 * is `CTC × employed ÷ month working days` at 2dp with bench footing. No
 * covering profile → blank (null) costs, never zero.
 */
function deriveRow(
	window: EmploymentWindow,
	month: string,
	calendar: MonthCalendar,
	attendanceByDate: Map<string, AttendanceDay>,
	loggedHours: number,
	profile: DerivedRate | null
): DerivedRow {
	const daysInMonth = Number(lastDayOf(month).slice(8, 10));
	const monthStart = `${month}-01`;
	const monthEnd = lastDayOf(month);
	let monthWorkingDays = 0;
	let employedWorkingDays = 0;
	let capacityHours = 0;

	for (let day = 1; day <= daysInMonth; day++) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const attendance = attendanceByDate.get(date);
		const weeklyOff =
			attendance !== undefined
				? attendance.isWeeklyOff === 1
				: isWeeklyOff(date);
		if (weeklyOff || calendar.nonOptionalHolidays.has(date)) continue;
		monthWorkingDays++;
		if (window.start !== null && date < window.start) continue;
		if (window.end !== null && date > window.end) continue;
		employedWorkingDays++;
		const status = (attendance?.status ?? '').toUpperCase();
		if (LEAVE_STATUS[status]) continue;
		capacityHours += status === 'HD' ? 4 : 8;
	}

	const utilizationPercent =
		capacityHours > 0 ? round2((loggedHours / capacityHours) * 100) : null;
	const utilizationBand =
		utilizationPercent === null
			? null
			: utilizationPercent < 80
				? 'under'
				: utilizationPercent <= 100
					? 'healthy'
					: 'over';
	// Zero Logged Hours is missing timesheet evidence, not a band: the state
	// rides alongside the Under band without moving percent or order.
	const state = loggedHours === 0 ? 'no_time_logged' : null;
	// The rate's own calendar: the same holidays, but 2nd/4th Saturdays stay.
	const basisDays = basisDaysIn(month, calendar.nonOptionalHolidays);
	const rate = profile ? profile.ctc / (basisDays * profile.hoursPerDay) : null;
	const monthlyCost = profile
		? employedWorkingDays > 0 && monthWorkingDays > 0
			? round2((profile.ctc * employedWorkingDays) / monthWorkingDays)
			: 0
		: null;
	const fractionalCost = rate === null ? null : round2(rate * loggedHours);
	const benchCost =
		monthlyCost === null || fractionalCost === null
			? null
			: round2(monthlyCost - fractionalCost);
	const isPartialWindow =
		(window.start !== null && window.start > monthStart) ||
		(window.end !== null && window.end < monthEnd);
	const chipDay = (iso: string) =>
		`${Number(iso.slice(8, 10))} ${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]}`;
	const chipStart =
		window.start !== null && window.start > monthStart
			? window.start
			: monthStart;
	const chipEnd =
		window.end !== null && window.end < monthEnd ? window.end : monthEnd;

	return {
		capacityHours,
		employedWorkingDays,
		monthWorkingDays,
		loggedHours,
		utilizationPercent,
		utilizationBand,
		state,
		basisDays,
		rate,
		costStatus: profile ? 'priced' : 'no-profile',
		monthlyCost,
		fractionalCost,
		benchCost,
		isPartialWindow,
		chip: isPartialWindow
			? `Partial (${chipDay(chipStart)} – ${chipDay(chipEnd)})`
			: null,
	};
}

/** One trailing-month cell as the report promises it. */
interface DerivedTrailingCell {
	month: string;
	employed: boolean;
	utilizationPercent: number | null;
}

/** One employee's trailing window plus the chronic verdict. */
interface DerivedTrailing {
	trailing: DerivedTrailingCell[];
	chronicUnder: boolean;
}

/** One team-trend point as the report promises it. */
interface DerivedTrendPoint {
	month: string;
	utilizationPercent: number | null;
	benchCost: number | null;
}

/**
 * The trailing lens, re-derived: for each month (oldest first) `employed` is
 * the resolved window intersecting it and the percent is the month's own
 * derived row — the value the row would show if that month were viewed. The
 * chronic marker needs at least two employed months and every employed month
 * below 80 with a real percent (a null percent never counts as below).
 */
function deriveTrailing(
	window: EmploymentWindow,
	months: string[],
	rowFor: (month: string) => DerivedRow | undefined
): DerivedTrailing {
	const trailing = months.map((month) => {
		const employed = intersects(window, month);
		const row = employed ? rowFor(month) : undefined;
		return {
			month,
			employed,
			utilizationPercent: row ? row.utilizationPercent : null,
		};
	});
	const employedCells = trailing.filter((cell) => cell.employed);
	return {
		trailing,
		chronicUnder:
			employedCells.length >= 2 &&
			employedCells.every(
				(cell) =>
					cell.utilizationPercent !== null && cell.utilizationPercent < 80
			),
	};
}

/**
 * The team trend, re-derived: per month, the capacity-weighted utilization of
 * the month's roster rows (`null` when they credit no capacity) and the Bench
 * Cost of its priced rows (`null` when none is priced).
 */
function deriveTrendSeries(
	months: string[],
	rowsByMonth: Map<string, Map<number, DerivedRow>>
): DerivedTrendPoint[] {
	return months.map((month) => {
		let capacity = 0;
		let logged = 0;
		let bench = 0;
		let priced = 0;
		for (const row of rowsByMonth.get(month)?.values() ?? []) {
			capacity += row.capacityHours;
			logged += row.loggedHours;
			if (row.costStatus !== 'priced') continue;
			priced++;
			bench += row.benchCost ?? 0;
		}
		const capacityHours = round2(capacity);
		const loggedHours = round2(logged);
		return {
			month,
			utilizationPercent:
				capacityHours > 0 ? round2((loggedHours / capacityHours) * 100) : null,
			benchCost: priced > 0 ? round2(bench) : null,
		};
	});
}

/** One department's rollup as the report promises it. */
interface DerivedDepartment {
	department: string | null;
	headcount: number;
	utilizationPercent: number | null;
	loggedHours: number;
	capacityHours: number;
	benchCost: number | null;
	noLoggedCount: number;
}

/**
 * The month's department rollup, re-derived from the raw directory plus the
 * month's derived rows: one entry per department present on the roster (unset
 * last, names ascending), utilization weighted by Σ logged ÷ Σ capacity, Bench
 * Cost summed over the department's priced rows only (null when none is
 * priced) and the zero-Logged-Hours rows counted. Computed from the month's
 * whole roster — the flag filter must not move it.
 */
function deriveDepartmentSummaries(
	employees: RawEmployee[],
	rows: Map<number, DerivedRow>
): DerivedDepartment[] {
	const groups = new Map<string | null, DerivedRow[]>();
	for (const employee of employees) {
		const derived = rows.get(employee.id);
		if (!derived) continue;
		const key = employee.department || null;
		const group = groups.get(key) ?? [];
		group.push(derived);
		groups.set(key, group);
	}

	const summaries = [...groups.entries()].map(([department, members]) => {
		const capacityHours = round2(
			members.reduce((sum, row) => sum + row.capacityHours, 0)
		);
		const loggedHours = round2(
			members.reduce((sum, row) => sum + row.loggedHours, 0)
		);
		const priced = members.filter((row) => row.costStatus === 'priced');
		return {
			department,
			headcount: members.length,
			utilizationPercent:
				capacityHours > 0 ? round2((loggedHours / capacityHours) * 100) : null,
			loggedHours,
			capacityHours,
			benchCost: priced.length
				? round2(priced.reduce((sum, row) => sum + (row.benchCost ?? 0), 0))
				: null,
			noLoggedCount: members.filter((row) => row.loggedHours === 0).length,
		};
	});

	return summaries.sort((a, b) => {
		if (a.department === b.department) return 0;
		if (a.department === null) return 1;
		if (b.department === null) return -1;
		return a.department.localeCompare(b.department);
	});
}

// ─── Project breakdown (ticket #299) ─────────────────────────────────

/** The breakdown's pinned top N, re-implemented from the report's rule. */
const PROJECT_TOP_N = 5;

/** One raw `projects` row, straight from the database. */
interface RawProject {
	project_id: number;
	project_code: string | null;
	project_title: string | null;
	name: string | null;
	client_name: string | null;
}

/** One raw assignment row the breakdown derivation groups. */
interface RawBreakdownAssignment {
	project_id: number | null;
	activity_name: string | null;
	discipline_name: string | null;
	/** The assignment's viewed-month Logged Hours. */
	hours: number;
}

/** The display-name rule: title → name → code → `Project #<id>`. */
function projectDisplayName(
	project: RawProject | undefined,
	projectId: number
): string {
	if (!project) return `Project #${projectId}`;
	const title = (project.project_title ?? '').trim();
	const name = (project.name ?? '').trim();
	const code = (project.project_code ?? '').trim();
	return title || name || code || `Project #${projectId}`;
}

interface DerivedBucketActivity {
	activity: string;
	discipline: string | null;
	hours: number;
}

interface DerivedProjectBucket {
	projectId: number | null;
	projectCode: string | null;
	projectName: string | null;
	clientName: string | null;
	hours: number;
	activities: DerivedBucketActivity[];
}

interface DerivedBreakdown {
	/** The top-N project groups, hours descending (ties by id ascending). */
	projects: DerivedProjectBucket[];
	other: { hours: number; project_count: number };
	noProject: DerivedProjectBucket | null;
	loggedHours: number;
}

/**
 * The breakdown rule, re-implemented from the raw assignments: group by the
 * assignment's project (a project id the `projects` rows do not resolve — or
 * none at all — lands in No project), accumulate activity/discipline detail,
 * sort hours descending, then split the top N from Other. No project is never
 * merged into Other, and the bucket sum is the month's Logged Hours.
 */
function deriveBreakdown(
	assignments: RawBreakdownAssignment[],
	projectById: Map<number, RawProject>
): DerivedBreakdown {
	const buckets = new Map<
		number | null,
		{
			projectId: number | null;
			projectCode: string | null;
			projectName: string | null;
			clientName: string | null;
			hours: number;
			activities: DerivedBucketActivity[];
		}
	>();
	let total = 0;

	for (const assignment of assignments) {
		if (!(assignment.hours > 0)) continue;
		total += assignment.hours;
		const resolved =
			assignment.project_id !== null && projectById.has(assignment.project_id);
		const key = resolved ? assignment.project_id : null;
		let bucket = buckets.get(key);
		if (!bucket) {
			const project = resolved
				? projectById.get(assignment.project_id as number)
				: undefined;
			bucket = {
				projectId: resolved ? (assignment.project_id as number) : null,
				projectCode: resolved ? (project?.project_code ?? null) : null,
				projectName: resolved
					? projectDisplayName(project, assignment.project_id as number)
					: null,
				clientName: resolved ? (project?.client_name ?? null) : null,
				hours: 0,
				activities: [],
			};
			buckets.set(key, bucket);
		}
		bucket.hours += assignment.hours;
		const activityName =
			(assignment.activity_name ?? '').trim() || 'Unspecified activity';
		const discipline = assignment.discipline_name ?? null;
		let activity = bucket.activities.find(
			(candidate) =>
				candidate.activity === activityName &&
				candidate.discipline === discipline
		);
		if (!activity) {
			activity = { activity: activityName, discipline, hours: 0 };
			bucket.activities.push(activity);
		}
		activity.hours += assignment.hours;
	}

	const projects: DerivedProjectBucket[] = [];
	let noProject: DerivedProjectBucket | null = null;
	for (const bucket of buckets.values()) {
		bucket.activities = bucket.activities
			.map((activity) => ({ ...activity, hours: round2(activity.hours) }))
			.sort(
				(a, b) =>
					b.hours - a.hours ||
					a.activity.localeCompare(b.activity) ||
					(a.discipline ?? '').localeCompare(b.discipline ?? '')
			);
		bucket.hours = round2(bucket.hours);
		if (bucket.projectId === null) noProject = bucket;
		else projects.push(bucket);
	}
	projects.sort(
		(a, b) => b.hours - a.hours || Number(a.projectId) - Number(b.projectId)
	);

	const top = projects.slice(0, PROJECT_TOP_N);
	const rest = projects.slice(PROJECT_TOP_N);
	return {
		projects: top,
		other: {
			hours: round2(rest.reduce((sum, bucket) => sum + bucket.hours, 0)),
			project_count: rest.length,
		},
		noProject,
		loggedHours: round2(total),
	};
}

/** One derived bucket in the API's payload shape, for direct comparison. */
function bucketPayload(bucket: DerivedProjectBucket) {
	return {
		project_id: bucket.projectId,
		project_code: bucket.projectCode,
		project_name: bucket.projectName,
		client_name: bucket.clientName,
		hours: bucket.hours,
		activities: bucket.activities.map((activity) => ({
			activity_name: activity.activity,
			discipline_name: activity.discipline,
			hours: activity.hours,
		})),
	};
}

interface DerivedMonth {
	/** The employees the month's report must hold, by code. */
	rosterCodes: string[];
	consideredCount: number;
	rosterCount: number;
	/** Excluded non-Payroll candidates bucketed by Employee Type value. */
	buckets: { value: string | null; count: number }[];
	excludedCodes: string[];
}

/** The month's roster + disclosure, derived from the raw directory. */
function deriveMonth(employees: RawEmployee[], month: string): DerivedMonth {
	const considered = employees.filter((row) =>
		intersects(deriveWindow(row), month)
	);
	const roster = considered.filter((row) => row.employee_type === 'Payroll');
	const excluded = considered.filter((row) => row.employee_type !== 'Payroll');

	const counts = new Map<string, { value: string | null; count: number }>();
	for (const row of excluded) {
		const key = row.employee_type ?? '';
		const bucket = counts.get(key);
		if (bucket) bucket.count++;
		else counts.set(key, { value: row.employee_type, count: 1 });
	}
	const buckets = [...counts.values()].sort((a, b) => {
		if (a.value === b.value) return 0;
		if (a.value === null) return 1;
		if (b.value === null) return -1;
		return a.value < b.value ? -1 : 1;
	});

	return {
		rosterCodes: roster.map((row) => row.employee_id).sort(),
		consideredCount: considered.length,
		rosterCount: roster.length,
		buckets,
		excludedCodes: excluded.map((row) => row.employee_id).sort(),
	};
}

// ─── API payload shapes (what the route returns, not the module types) ─

interface ApiRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	/** Raw `employees.department`; null = unset (never the "Unassigned" label). */
	department: string | null;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	utilization_band: string | null;
	state: string | null;
	employment_start: string | null;
	employment_end: string | null;
	is_partial_window: boolean;
	trailing: {
		month: string;
		employed: boolean;
		utilization_percent: number | null;
	}[];
	chronic_under: boolean;
	monthly_cost: number | null;
	fractional_cost: number | null;
	bench_cost: number | null;
	cost_status: string;
}

interface ApiTrendPoint {
	month: string;
	utilization_percent: number | null;
	bench_cost: number | null;
}

interface ApiDisclosure {
	considered_count: number;
	roster_count: number;
	excluded_count: number;
	excluded_type_count: number;
	excluded_status_count: number;
	buckets: { reason: string; value: string | null; count: number }[];
	excluded: { employee_id: string; reason: string }[];
}

/** One department rollup as the payload promises it. */
interface ApiDepartmentSummary {
	department: string | null;
	headcount: number;
	capacity_weighted_utilization: number | null;
	logged_hours: number;
	capacity_hours: number;
	bench_cost: number | null;
	no_logged_count: number;
}

/** One bucket of the projects route's payload. */
interface ApiBreakdownBucket {
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	hours: number;
	activities: {
		activity_name: string;
		discipline_name: string | null;
		hours: number;
	}[];
}

/** The projects route's `data` payload. */
interface ApiBreakdown {
	month: string;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	logged_hours: number;
	top_n: number;
	projects: ApiBreakdownBucket[];
	other: { hours: number; project_count: number };
	no_project: ApiBreakdownBucket | null;
}

interface ApiPayload {
	month: string;
	month_label: string;
	flag: string | null;
	rows: ApiRow[];
	totals: {
		employee_count: number;
		no_logged_count: number;
		capacity_hours: number;
		logged_hours: number;
		monthly_cost: number | null;
		fractional_cost: number | null;
		bench_cost: number | null;
	};
	trend: ApiTrendPoint[];
	disclosure: ApiDisclosure | null;
	/** The month's department rollup, computed before the flag filter. */
	departments: ApiDepartmentSummary[];
}

async function fetchMonth(
	request: APIRequestContext,
	month: string,
	flag?: string
): Promise<ApiPayload> {
	const params = new URLSearchParams({ month });
	if (flag) params.set('flag', flag);
	const response = await request.get(
		`/api/reports/employee-utilization?${params.toString()}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ApiPayload;
}

// ─── Page helpers ────────────────────────────────────────────────────

async function selectMonth(page: Page, label: string): Promise<void> {
	// `exact` keeps the selector safe from employee names that contain "Month"
	// (midMonthJoiner): their timesheet links' aria-labels would otherwise
	// substring-match and trip strict mode once the grid has rendered.
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(label);
	await page.getByRole('button', { name: label, exact: true }).click();
	await expect(page.getByTestId('utilization-summary')).toContainText(label);
}

async function openMonth(page: Page, label: string): Promise<void> {
	await page.goto('/reports/employee-utilization');
	await expect(
		page.getByRole('heading', { name: 'Employee Utilization' })
	).toBeVisible();
	await selectMonth(page, label);
}

interface RenderedRow {
	code: string;
	band: string;
	state: string;
	/** The Flag cell's reading: the band badge text, or "No time logged". */
	flagCell: string;
	/** The Department cell's reading ("Unassigned" for the unset bucket). */
	department: string;
	capacity: string;
	logged: string;
	utilization: string;
	monthly: string;
	bench: string;
	partial: string;
	/** The two trailing-month cells, oldest first. */
	trailing: { month: string; employed: string; text: string }[];
	/** The chronic marker chip is present on the row. */
	chronic: boolean;
}

function readRows(page: Page): Promise<RenderedRow[]> {
	return page.$$eval('[data-testid="utilization-row"]', (elements) =>
		elements.map((row) => {
			const cell = (testId: string) =>
				row.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
				'';
			return {
				code: row.getAttribute('data-employee-code') ?? '',
				band: row.getAttribute('data-band') ?? '',
				state: row.getAttribute('data-state') ?? '',
				flagCell: cell('cell-band'),
				department: cell('cell-department'),
				capacity: cell('cell-capacity'),
				logged: cell('cell-logged'),
				utilization: cell('cell-utilization'),
				monthly: cell('cell-monthly-cost'),
				bench: cell('cell-bench-cost'),
				partial: cell('partial-window-chip'),
				trailing: Array.from(
					row.querySelectorAll('[data-testid="cell-trailing-utilization"]')
				).map((trailingCell) => ({
					month: trailingCell.getAttribute('data-month') ?? '',
					employed: trailingCell.getAttribute('data-employed') ?? '',
					text: trailingCell.textContent?.trim() ?? '',
				})),
				chronic: row.querySelector('[data-testid="chronic-marker"]') !== null,
			};
		})
	);
}

/** en-IN, 2dp — the display rule the page's `formatNumber` applies. */
const number2 = new Intl.NumberFormat('en-IN', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

/** One rendered `department-summary-row`, as the page exposes it. */
interface RenderedDepartmentSummary {
	/** `data-department`: the raw payload value, '' for the unset bucket. */
	department: string;
	/** The first cell's reading: the name, or "Unassigned". */
	label: string;
	/** `data-selected`: 'true' while the row drives the grid's filter. */
	selected: string;
	headcount: string;
	utilization: string;
	logged: string;
	capacity: string;
	bench: string;
	noLogged: string;
}

function readDepartmentSummary(
	page: Page
): Promise<RenderedDepartmentSummary[]> {
	return page.$$eval('[data-testid="department-summary-row"]', (elements) =>
		elements.map((row) => {
			const cell = (testId: string) =>
				row.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
				'';
			return {
				department: row.getAttribute('data-department') ?? '',
				label: row.querySelector('th')?.textContent?.trim() ?? '',
				selected: row.getAttribute('data-selected') ?? '',
				headcount: cell('cell-dept-headcount'),
				utilization: cell('cell-dept-utilization'),
				logged: cell('cell-dept-logged'),
				capacity: cell('cell-dept-capacity'),
				bench: cell('cell-dept-bench'),
				noLogged: cell('cell-dept-no-logged'),
			};
		})
	);
}

/** One rendered breakdown bucket row plus the activity rows under it. */
interface RenderedBreakdownBucket {
	/** 'project' for a project row, 'no-project' for the explicit bucket. */
	kind: string;
	/** `data-project`: the project id, '' for the No-project bucket. */
	project: string;
	name: string;
	code: string;
	client: string;
	/** `data-hours`: the bucket's hour total as the payload carries it. */
	rawHours: string;
	/** The rendered Hours cell (`formatNumber`). */
	hours: string;
	activities: {
		activity: string;
		discipline: string;
		rawHours: string;
		hours: string;
	}[];
}

interface RenderedBreakdown {
	employeeCode: string;
	/** `data-logged-hours`: the payload's footing total. */
	loggedHours: string;
	linkHref: string;
	projects: RenderedBreakdownBucket[];
	other: { rawHours: string; count: string; hours: string } | null;
	noProject: RenderedBreakdownBucket | null;
}

/**
 * Read the expanded row's breakdown panel: the bucket rows in DOM order (with
 * their activity rows attached to the bucket above them), the Other row when
 * it spilled, and the No-project bucket. `data-*` carries the payload's own
 * numbers; the cell text is the rendered `formatNumber` value.
 */
function readBreakdown(page: Page): Promise<RenderedBreakdown> {
	return page.locator('[data-testid="project-breakdown"]').evaluate((panel) => {
		const text = (root: Element, testId: string) =>
			root.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
			'';
		const buckets: RenderedBreakdownBucket[] = [];
		let current: RenderedBreakdownBucket | null = null;
		let other: { rawHours: string; count: string; hours: string } | null = null;
		for (const row of Array.from(panel.querySelectorAll('tbody > tr'))) {
			const testId = row.getAttribute('data-testid') ?? '';
			if (testId === 'project-row' || testId === 'no-project-row') {
				current = {
					kind: testId === 'project-row' ? 'project' : 'no-project',
					project: row.getAttribute('data-project') ?? '',
					name: text(row, 'breakdown-row-name'),
					code: text(row, 'breakdown-row-code'),
					client: text(row, 'breakdown-row-client'),
					rawHours: row.getAttribute('data-hours') ?? '',
					hours: text(row, 'breakdown-row-hours'),
					activities: [],
				};
				buckets.push(current);
			} else if (testId === 'activity-row') {
				current?.activities.push({
					activity: row.getAttribute('data-activity') ?? '',
					discipline: row.getAttribute('data-discipline') ?? '',
					rawHours: row.getAttribute('data-hours') ?? '',
					hours: text(row, 'activity-hours'),
				});
			} else if (testId === 'other-projects-row') {
				other = {
					rawHours: row.getAttribute('data-hours') ?? '',
					count: row.getAttribute('data-project-count') ?? '',
					hours: text(row, 'other-hours'),
				};
				current = null;
			}
		}
		return {
			employeeCode: panel.getAttribute('data-employee-code') ?? '',
			loggedHours: panel.getAttribute('data-logged-hours') ?? '',
			linkHref:
				panel
					.querySelector('[data-testid="breakdown-timesheet-link"]')
					?.getAttribute('href') ?? '',
			projects: buckets.filter((bucket) => bucket.kind === 'project'),
			other,
			noProject: buckets.find((bucket) => bucket.kind === 'no-project') ?? null,
		};
	});
}

/** The Department filter control's trigger button. */
function departmentControl(page: Page) {
	return page.getByLabel('Department', { exact: true });
}

/**
 * Open the Department control and return its dropdown (portalled to `body`,
 * so the search box's grandparent is the option list's container).
 */
async function openDepartmentOptions(page: Page) {
	await departmentControl(page).click();
	const dropdown = page.getByPlaceholder('Search...').locator('xpath=../..');
	await expect(dropdown).toBeVisible();
	return dropdown;
}

/** The employee codes of one derived row map, sorted. */
function codesOfRows(rows: Map<number, DerivedRow>): string[] {
	return model.employees
		.filter((employee) => rows.has(employee.id))
		.map((employee) => employee.employee_id)
		.sort();
}

/** The codes of `codes` whose raw department is `department` (null = unset). */
function codesWithDepartment(
	department: string | null,
	codes: string[]
): string[] {
	return codes
		.filter(
			(code) =>
				(model.employees.find((employee) => employee.employee_id === code)
					?.department || null) === department
		)
		.sort();
}

/** One `employee_salary_profile` row as the database hands it over. */
interface RawProfile {
	employee_id: number;
	gross: string | number | null;
	gross_salary: string | number | null;
	employer_cost: string | number | null;
	hourly_rate: string | number | null;
	std_hours_per_day: string | number | null;
	std_working_days: string | number | null;
	salary_type: string;
	effective_from: string | null;
	effective_to: string | null;
}

const profilesByEmployee = new Map<number, RawProfile[]>();

/** One month's holiday split, straight from `holiday_master`. */
async function monthCalendar(month: string): Promise<MonthCalendar> {
	const holidayRows = await rows<{
		date: string;
		is_optional: number;
		is_active: number;
	}>(
		`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
		        COALESCE(is_optional, 0) AS is_optional,
		        COALESCE(is_active, 1) AS is_active
		 FROM holiday_master
		 WHERE date BETWEEN ? AND ?`,
		[`${month}-01`, lastDayOf(month)]
	);
	return deriveHolidaySets(holidayRows);
}

/**
 * The profile in force for `month`, mirroring the report's documented pick:
 * first active profile whose effective range covers the month, else the
 * latest active one by `effective_from`.
 */
function coveringProfile(employeeId: number, month: string): RawProfile | null {
	const profiles = profilesByEmployee.get(employeeId) ?? [];
	if (!profiles.length) return null;
	const monthStart = `${month}-01`;
	const monthEnd = lastDayOf(month);
	const covering = profiles.find((profile) => {
		const from = profile.effective_from || '1970-01-01';
		const to = profile.effective_to || '9999-12-31';
		return from <= monthEnd && to >= monthStart;
	});
	return (
		covering ??
		[...profiles].sort((a, b) =>
			(b.effective_from || '').localeCompare(a.effective_from || '')
		)[0] ??
		null
	);
}

/** The row's CTC chain (employer_cost → gross_salary → gross) and hours/day. */
function rateFor(employeeId: number, month: string): DerivedRate | null {
	const profile = coveringProfile(employeeId, month);
	if (!profile) return null;
	return {
		ctc:
			Number(profile.employer_cost) ||
			Number(profile.gross_salary) ||
			Number(profile.gross),
		hoursPerDay:
			Number(profile.std_hours_per_day) > 0
				? Number(profile.std_hours_per_day)
				: 8,
	};
}

// ─── Model ───────────────────────────────────────────────────────────

interface Model {
	employees: RawEmployee[];
	windows: Map<number, EmploymentWindow>;
	month: DerivedMonth;
	laterMonth: DerivedMonth;
	calendar: MonthCalendar;
	/** Derived capacity/cost per viewed-month roster member, by employee id. */
	rows: Map<number, DerivedRow>;
	monthLabel: string;
	/** #297: the six months ending at the viewed month, oldest first. */
	span: string[];
	/** #297: per span month, the derived roster rows by employee id. */
	spanRows: Map<string, Map<number, DerivedRow>>;
	/** #297: per viewed-roster employee, the derived trailing window. */
	trailing: Map<number, DerivedTrailing>;
	/** #297: the derived team trend, oldest first. */
	trend: DerivedTrendPoint[];
	/** #298: the viewed month's derived department rollup, in payload order. */
	departments: DerivedDepartment[];
	/** #299: per viewed-roster employee, the derived project breakdown. */
	breakdowns: Map<number, DerivedBreakdown>;
	/** #299: `projects.project_code` → id, for asserting the payload's ids. */
	projectIdByCode: Map<string, number>;
}

const model = {} as Model;
const observed: Record<string, unknown> = {};

test.beforeAll(async () => {
	// The live directory: every `isDelete = 0` row, no type or status filter —
	// the roster rule belongs to the report, not the assertion.
	const directory = await rows<{
		id: number;
		employee_id: string;
		employee_type: string | null;
		status: string;
		joining_date: string | null;
		hire_date: string | null;
		exit_date: string | null;
		department: string | null;
	}>(
		`SELECT id, employee_id, employee_type, status,
		        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
		        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date,
		        DATE_FORMAT(exit_date, '%Y-%m-%d') AS exit_date,
		        department
		 FROM employees
		 WHERE isDelete = 0`
	);

	const attendanceBounds = await rows<{
		employee_id: number;
		first_date: string | null;
		last_date: string | null;
	}>(
		`SELECT employee_id,
		        DATE_FORMAT(MIN(attendance_date), '%Y-%m-%d') AS first_date,
		        DATE_FORMAT(MAX(attendance_date), '%Y-%m-%d') AS last_date
		 FROM employee_attendance
		 GROUP BY employee_id`
	);
	const boundsById = new Map(
		attendanceBounds.map((row) => [Number(row.employee_id), row])
	);

	// Logged Hours evidence, resolved exactly like the report resolves an
	// assignment to an employee: stamped `employee_id` first, then the linked
	// user, then the user's email/username. The project/activity columns ride
	// along for the #299 breakdown derivation — the same raw rows feed both.
	const assignments = await rows<{
		user_id: number | null;
		employee_id: number | null;
		email: string | null;
		username: string | null;
		daily_entries: string | null;
		project_id: number | null;
		activity_name: string | null;
		discipline_name: string | null;
	}>(
		`SELECT uaa.user_id, uaa.employee_id, u.email, u.username,
		        uaa.daily_entries, uaa.project_id, uaa.activity_name,
		        uaa.discipline_name
		 FROM user_activity_assignments uaa
		 LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
		 WHERE uaa.status <> 'Cancelled'
		   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
	);
	const users = await rows<{
		id: number;
		employee_id: number | null;
		email: string | null;
		username: string | null;
	}>(`SELECT id, employee_id, email, username FROM users WHERE isDelete = 0`);
	// The report keys its identifier map by the employee record's email and
	// username first, then by the linked users' — later writes win.
	const employeesByKeys = await rows<{
		id: number;
		email: string | null;
		username: string | null;
	}>(`SELECT id, email, username FROM employees WHERE isDelete = 0`);
	const userToEmployee = new Map<number, number>();
	const userKeyToEmployee = new Map<string, number>();
	for (const employee of employeesByKeys) {
		const email = String(employee.email ?? '').toLowerCase();
		const username = String(employee.username ?? '').toLowerCase();
		if (email) userKeyToEmployee.set(email, Number(employee.id));
		if (username) userKeyToEmployee.set(username, Number(employee.id));
	}
	for (const user of users) {
		const empId = Number(user.employee_id ?? 0);
		if (user.id && empId) userToEmployee.set(Number(user.id), empId);
		const email = String(user.email ?? '').toLowerCase();
		const username = String(user.username ?? '').toLowerCase();
		if (email && empId) userKeyToEmployee.set(email, empId);
		if (username && empId) userKeyToEmployee.set(username, empId);
	}

	const loggedBounds = new Map<
		number,
		{ first: string | null; last: string | null }
	>();
	const loggedHoursByMonth = new Map<string, Map<number, number>>();
	// #299: the viewed month's raw assignment rows, by employee — the
	// breakdown derivation's input (grouping is derived from these below).
	const breakdownAssignments = new Map<number, RawBreakdownAssignment[]>();
	for (const assignment of assignments) {
		let empId = Number(assignment.employee_id ?? 0);
		if (!empId) {
			const userId = Number(assignment.user_id ?? 0);
			if (userId && userToEmployee.has(userId))
				empId = userToEmployee.get(userId)!;
			else {
				const email = String(assignment.email ?? '').toLowerCase();
				const username = String(assignment.username ?? '').toLowerCase();
				if (email && userKeyToEmployee.has(email))
					empId = userKeyToEmployee.get(email)!;
				else if (username && userKeyToEmployee.has(username))
					empId = userKeyToEmployee.get(username)!;
			}
		}
		if (!empId) continue;

		// Every span month's Logged Hours, summed from the raw payloads.
		for (const spanMonth of SPAN_MONTHS) {
			const hours = loggedHoursInMonth(assignment.daily_entries, spanMonth);
			if (hours <= 0) continue;
			const byEmployee =
				loggedHoursByMonth.get(spanMonth) ?? new Map<number, number>();
			byEmployee.set(empId, (byEmployee.get(empId) ?? 0) + hours);
			loggedHoursByMonth.set(spanMonth, byEmployee);
		}

		// The breakdown's raw row: the assignment's viewed-month hours plus
		// its project/activity columns (project resolution happens below,
		// against the raw `projects` rows).
		const monthHours = loggedHoursInMonth(assignment.daily_entries, MONTH);
		if (monthHours > 0) {
			const owned = breakdownAssignments.get(empId) ?? [];
			owned.push({
				project_id:
					assignment.project_id === null ? null : Number(assignment.project_id),
				activity_name: assignment.activity_name,
				discipline_name: assignment.discipline_name,
				hours: monthHours,
			});
			breakdownAssignments.set(empId, owned);
		}

		for (const day of loggedDays(assignment.daily_entries)) {
			const bound = loggedBounds.get(empId) ?? { first: null, last: null };
			if (bound.first === null || day < bound.first) bound.first = day;
			if (bound.last === null || day > bound.last) bound.last = day;
			loggedBounds.set(empId, bound);
		}
	}

	// The raw `projects` rows the breakdown resolves assignment project ids
	// against; a soft-deleted (or missing) row is the No-project bucket's
	// other path.
	const projectRows = await rows<RawProject>(
		`SELECT project_id, project_code, project_title, name, client_name
		 FROM projects WHERE isDelete = 0`
	);
	const projectById = new Map(
		projectRows.map((project) => [Number(project.project_id), project])
	);

	const employees: RawEmployee[] = directory.map((row) => {
		const attendance = boundsById.get(Number(row.id));
		const logged = loggedBounds.get(Number(row.id));
		return {
			...row,
			first_attendance: attendance?.first_date ?? null,
			last_attendance: attendance?.last_date ?? null,
			first_logged: logged?.first ?? null,
			last_logged: logged?.last ?? null,
		};
	});
	const windows = new Map(employees.map((row) => [row.id, deriveWindow(row)]));

	// One calendar per span month: Capacity and the rate share the active
	// NON-optional holiday set but not the weekly-off rule (see `deriveRow`).
	const calendars = new Map<string, MonthCalendar>();
	for (const spanMonth of SPAN_MONTHS) {
		calendars.set(spanMonth, await monthCalendar(spanMonth));
	}

	// The whole span's attendance, by month then employee: the recorded status
	// and the `is_weekly_off` flag that wins over the schedule.
	const attendanceRows = await rows<{
		employee_id: number;
		date: string;
		status: string | null;
		is_weekly_off: number;
	}>(
		`SELECT employee_id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
		        status, COALESCE(is_weekly_off, 0) AS is_weekly_off
		 FROM employee_attendance
		 WHERE attendance_date BETWEEN ? AND ?
		 ORDER BY attendance_date`,
		[`${SPAN_MONTHS[0]}-01`, lastDayOf(MONTH)]
	);
	const attendanceByMonth = new Map<
		string,
		Map<number, Map<string, AttendanceDay>>
	>();
	for (const row of attendanceRows) {
		const employeeId = Number(row.employee_id);
		if (!employeeId) continue;
		const date = String(row.date).slice(0, 10);
		const byEmployee =
			attendanceByMonth.get(date.slice(0, 7)) ??
			new Map<number, Map<string, AttendanceDay>>();
		const byDate =
			byEmployee.get(employeeId) ?? new Map<string, AttendanceDay>();
		byDate.set(date, {
			status: row.status === null ? null : String(row.status),
			isWeeklyOff: Number(row.is_weekly_off) === 1 ? 1 : 0,
		});
		byEmployee.set(employeeId, byDate);
		attendanceByMonth.set(date.slice(0, 7), byEmployee);
	}

	// Active salary profiles: the rate's CTC chain (employer_cost → gross
	// salary → gross) and the profile's hours per day, read raw.
	const profileRows = await rows<RawProfile>(
		`SELECT employee_id, gross, gross_salary, employer_cost, hourly_rate,
		        std_hours_per_day, std_working_days, salary_type,
		        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
		        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
		 FROM employee_salary_profile
		 WHERE is_active = 1`
	);
	for (const profile of profileRows) {
		const employeeId = Number(profile.employee_id);
		if (!employeeId) continue;
		const profiles = profilesByEmployee.get(employeeId) ?? [];
		profiles.push(profile);
		profilesByEmployee.set(employeeId, profiles);
	}

	// One derived capacity/cost row per roster member per span month — the
	// viewed month's rows are just the last of these views.
	const spanRows = new Map<string, Map<number, DerivedRow>>();
	for (const spanMonth of SPAN_MONTHS) {
		const calendar = calendars.get(spanMonth)!;
		const attendanceByEmployee =
			attendanceByMonth.get(spanMonth) ??
			new Map<number, Map<string, AttendanceDay>>();
		const rowsForMonth = new Map<number, DerivedRow>();
		for (const employee of employees) {
			const window = windows.get(employee.id);
			if (!window || !intersects(window, spanMonth)) continue;
			if (employee.employee_type !== 'Payroll') continue;
			rowsForMonth.set(
				employee.id,
				deriveRow(
					window,
					spanMonth,
					calendar,
					attendanceByEmployee.get(employee.id) ?? new Map(),
					loggedHoursByMonth.get(spanMonth)?.get(employee.id) ?? 0,
					rateFor(employee.id, spanMonth)
				)
			);
		}
		spanRows.set(spanMonth, rowsForMonth);
	}
	const derivedRows = spanRows.get(MONTH)!;

	// The trailing window and the team trend, off the same span views.
	const trailing = new Map<number, DerivedTrailing>();
	for (const [employeeId, row] of derivedRows) {
		trailing.set(
			employeeId,
			deriveTrailing(windows.get(employeeId)!, TRAILING_MONTHS, (month) =>
				spanRows.get(month)!.get(employeeId)
			)
		);
	}
	const trend = deriveTrendSeries(SPAN_MONTHS, spanRows);

	// #299: every viewed-roster member's breakdown, derived from the raw
	// assignment rows plus the raw `projects` rows (never the report's code).
	const breakdowns = new Map<number, DerivedBreakdown>();
	for (const [employeeId] of derivedRows) {
		breakdowns.set(
			employeeId,
			deriveBreakdown(breakdownAssignments.get(employeeId) ?? [], projectById)
		);
	}

	model.employees = employees;
	model.windows = windows;
	model.month = deriveMonth(employees, MONTH);
	model.laterMonth = deriveMonth(employees, LATER_MONTH);
	model.calendar = calendars.get(MONTH)!;
	model.rows = derivedRows;
	model.monthLabel = MONTH_LABEL;
	model.span = SPAN_MONTHS;
	model.spanRows = spanRows;
	model.trailing = trailing;
	model.trend = trend;
	model.departments = deriveDepartmentSummaries(employees, derivedRows);
	model.breakdowns = breakdowns;
	model.projectIdByCode = new Map(
		projectRows.map((project) => [
			project.project_code ?? '',
			Number(project.project_id),
		])
	);
});

// ─── Excel workbook (#300) ───────────────────────────────────────────

/** Plain text of a cell, whatever shape exceljs hands back. */
function cellText(value: ExcelJS.CellValue): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value instanceof Date) return value.toISOString();
	if ('richText' in value) {
		return value.richText.map((part) => part.text).join('');
	}
	if ('result' in value) return String(value.result ?? '');
	return '';
}

interface SheetTable {
	/** The header row's sheet row number. */
	headerRow: number;
	/** Header label → column index. */
	columns: Map<string, number>;
}

/**
 * Locate a sheet table by its first header label and map its labels to
 * columns, so the assertions read cells by header, never by fixed index.
 */
function findTable(ws: ExcelJS.Worksheet, firstLabel: string): SheetTable {
	for (let rowNumber = 1; rowNumber <= ws.rowCount; rowNumber++) {
		const row = ws.getRow(rowNumber);
		if (cellText(row.getCell(1).value) !== firstLabel) continue;
		const columns = new Map<string, number>();
		row.eachCell({ includeEmpty: false }, (cell, col) => {
			const label = cellText(cell.value);
			if (label) columns.set(label, col);
		});
		return { headerRow: rowNumber, columns };
	}
	throw new Error(`sheet header '${firstLabel}' not found`);
}

/** The cell of a sheet row under one of the table's header labels. */
function cellUnder(
	ws: ExcelJS.Worksheet,
	table: SheetTable,
	rowNumber: number,
	label: string
): ExcelJS.Cell {
	const column = table.columns.get(label);
	if (!column) throw new Error(`sheet column '${label}' not found`);
	return ws.getRow(rowNumber).getCell(column);
}

/** A cell reads as its expected figure; a null expectation must stay blank. */
function expectFigure(cell: ExcelJS.Cell, expected: number | null): void {
	const value = typeof cell.value === 'number' ? cell.value : null;
	if (expected === null) {
		expect(value).toBeNull();
		return;
	}
	expect(value).not.toBeNull();
	expect(value as number).toBeCloseTo(expected, 2);
}

/** Every non-empty cell's text, joined — for the below-table sections. */
function sheetText(ws: ExcelJS.Worksheet): string {
	const parts: string[] = [];
	ws.eachRow((row) =>
		row.eachCell({ includeEmpty: false }, (cell) => {
			parts.push(cellText(cell.value));
		})
	);
	return parts.join('\n');
}

const BAND_TEXT: Record<string, string> = {
	under: 'Under',
	healthy: 'Healthy',
	over: 'Over',
};

/** The Flag cell's reading: state or band, plus the chronic chip. */
function expectedFlagText(
	state: string | null,
	band: string | null,
	chronic: boolean
): string {
	const base =
		state === 'no_time_logged'
			? 'No time logged'
			: band === null
				? 'No capacity'
				: (BAND_TEXT[band] ?? band);
	return chronic ? `${base} · Chronic under` : base;
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('employee utilization roster', () => {
	test('the viewed month lists exactly the payroll roster derived from the database', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		expect(api.month).toBe(MONTH);
		expect(api.month_label).toBe(MONTH_LABEL);
		expect(api.rows.map((row) => row.employee_code).sort()).toEqual(
			model.month.rosterCodes
		);
		expect(api.totals.employee_count).toBe(model.month.rosterCodes.length);

		// The fixture membership the derivation promises: the leaver and the
		// evidence-only payroll employees are rows; the joiner, the leaver who
		// left earlier and the unplaceable employee are not.
		const codes = new Set(api.rows.map((row) => row.employee_code));
		const mustBeRows: UtilizationMember[] = [
			utilizationMemberForPlan('payrollWithHours'),
			utilizationMemberForPlan('payrollIdle'),
			utilizationMemberForPlan('leaverInViewedMonth'),
			utilizationMemberForPlan('evidenceOnly'),
			utilizationMemberForPlan('evidenceLeaver'),
		];
		for (const member of mustBeRows) {
			expect(
				codes.has(member.code),
				`${member.code} must be on the roster`
			).toBe(true);
		}
		const mustBeAbsent: UtilizationMember[] = [
			utilizationMemberForPlan('leaverBeforeViewedMonth'),
			utilizationMemberForPlan('joinerAfterViewedMonth'),
			utilizationMemberForPlan('hireDateJoiner'),
			utilizationMemberForPlan('unplacedPayroll'),
		];
		for (const member of mustBeAbsent) {
			expect(codes.has(member.code), `${member.code} must be absent`).toBe(
				false
			);
		}

		// No misfiled Employee Type can ever be a row.
		for (const member of UTILIZATION_ROSTER) {
			if (member.type !== 'Payroll') {
				expect(
					codes.has(member.code),
					`${member.code} must never be a row`
				).toBe(false);
			}
		}
		expect(model.month.rosterCodes).not.toContain(
			utilizationMemberForPlan('unplacedPayroll').code
		);

		// The priced row's window-scoped hours, band and pro-rated cost read
		// off the raw evidence.
		const withHours = utilizationMemberForPlan('payrollWithHours');
		const withHoursId = model.employees.find(
			(row) => row.employee_id === withHours.code
		)!.id;
		const apiRow = api.rows.find(
			(row) => row.employee_code === withHours.code
		)!;
		const derived = model.rows.get(withHoursId)!;
		expect(apiRow.logged_hours).toBe(derived.loggedHours);
		expect(apiRow.capacity_hours).toBe(derived.capacityHours);
		expect(apiRow.utilization_percent).toBe(derived.utilizationPercent);
		expect(apiRow.utilization_band).toBe(derived.utilizationBand);
		expect(apiRow.monthly_cost).toBe(derived.monthlyCost);
		expect(apiRow.fractional_cost).toBe(derived.fractionalCost);
		expect(apiRow.bench_cost).toBe(derived.benchCost);
		expect(apiRow.is_partial_window).toBe(derived.isPartialWindow);
		expect(apiRow.cost_status).toBe('priced');
		expect(apiRow.employment_start).toBe(model.windows.get(withHoursId)!.start);
		expect(apiRow.employment_end).toBe(model.windows.get(withHoursId)!.end);

		observed.roster = {
			month: MONTH,
			derivedCount: model.month.rosterCodes.length,
			apiCount: api.rows.length,
			leaverVisible: codes.has(
				utilizationMemberForPlan('leaverInViewedMonth').code
			),
			joinerAbsent: !codes.has(
				utilizationMemberForPlan('joinerAfterViewedMonth').code
			),
			nonPayrollRows: api.rows.filter((row) => {
				const member = UTILIZATION_ROSTER.find(
					(m) => m.code === row.employee_code
				);
				return member ? member.type !== 'Payroll' : false;
			}).length,
			withHours: {
				capacity: apiRow.capacity_hours,
				logged: apiRow.logged_hours,
				utilization: apiRow.utilization_percent,
				band: apiRow.utilization_band,
				monthly: apiRow.monthly_cost,
				partial: apiRow.is_partial_window,
			},
		};
	});

	test('the exclusion disclosure counts the misfiled Employee Types of the viewed month', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);
		const disclosure = api.disclosure;
		expect(disclosure, 'January 2019 has excluded fixtures').not.toBeNull();
		const d = disclosure!;

		expect(d.considered_count).toBe(model.month.consideredCount);
		expect(d.roster_count).toBe(model.month.rosterCount);
		expect(d.excluded_count).toBe(
			model.month.buckets.reduce((n, b) => n + b.count, 0)
		);
		expect(d.excluded_type_count).toBe(d.excluded_count);
		// Status never disqualifies a month-scoped roster.
		expect(d.excluded_status_count).toBe(0);

		// Buckets carry the Employee Type value, reason not_payroll_type, in the
		// derived order (values ascending, NULL last).
		expect(d.buckets).toEqual(
			model.month.buckets.map((bucket) => ({
				reason: 'not_payroll_type',
				value: bucket.value,
				count: bucket.count,
			}))
		);
		expect(d.excluded.map((row) => row.employee_id).sort()).toEqual(
			model.month.excludedCodes
		);

		// Each seeded misfiled type is part of the count it belongs to.
		for (const plan of [
			'contractInViewedMonth',
			'deputationInViewedMonth',
			'unsetInViewedMonth',
			'internNoEvidence',
		] as const) {
			const member = utilizationMemberForPlan(plan);
			expect(d.excluded.map((row) => row.employee_id)).toContain(member.code);
		}

		observed.disclosure = {
			month: MONTH,
			considered: d.considered_count,
			roster: d.roster_count,
			excluded: d.excluded_count,
			buckets: d.buckets,
		};
	});

	test('a leaver stays in their month and a joiner is absent before theirs', async ({
		request,
	}) => {
		const january = await fetchMonth(request, MONTH);
		const march = await fetchMonth(request, LATER_MONTH);

		expect(march.month).toBe(LATER_MONTH);
		expect(march.month_label).toBe(LATER_MONTH_LABEL);
		expect(march.rows.map((row) => row.employee_code).sort()).toEqual(
			model.laterMonth.rosterCodes
		);

		const marchCodes = new Set(march.rows.map((row) => row.employee_code));
		const januaryCodes = new Set(january.rows.map((row) => row.employee_code));
		const leaver = utilizationMemberForPlan('leaverInViewedMonth');
		const joiner = utilizationMemberForPlan('joinerAfterViewedMonth');
		const hireJoiner = utilizationMemberForPlan('hireDateJoiner');
		const midJoiner = utilizationMemberForPlan('midMonthJoiner');
		const midLeaver = utilizationMemberForPlan('midMonthLeaver');

		expect(januaryCodes.has(leaver.code)).toBe(true);
		expect(januaryCodes.has(joiner.code)).toBe(false);
		expect(januaryCodes.has(hireJoiner.code)).toBe(false);
		expect(marchCodes.has(leaver.code)).toBe(false);
		expect(marchCodes.has(joiner.code)).toBe(true);
		expect(marchCodes.has(hireJoiner.code)).toBe(true);

		// The mid-month pair is in January only in their own window; the open
		// bound of the joiner reaches March, the closed one of the leaver does
		// not.
		expect(januaryCodes.has(midJoiner.code)).toBe(true);
		expect(januaryCodes.has(midLeaver.code)).toBe(true);
		expect(marchCodes.has(midJoiner.code)).toBe(true);
		expect(marchCodes.has(midLeaver.code)).toBe(false);

		// The March disclosure is derived from the same raw directory.
		const marchDisclosure = march.disclosure;
		if (model.laterMonth.buckets.length === 0) {
			expect(marchDisclosure).toBeNull();
		} else {
			expect(marchDisclosure).not.toBeNull();
			expect(marchDisclosure!.buckets).toEqual(
				model.laterMonth.buckets.map((bucket) => ({
					reason: 'not_payroll_type',
					value: bucket.value,
					count: bucket.count,
				}))
			);
		}

		observed.monthScoping = {
			january: {
				derived: model.month.rosterCodes.length,
				leaverPresent: januaryCodes.has(leaver.code),
				joinerPresent: januaryCodes.has(joiner.code),
			},
			march: {
				derived: model.laterMonth.rosterCodes.length,
				leaverPresent: marchCodes.has(leaver.code),
				joinerPresent: marchCodes.has(joiner.code),
			},
		};
	});

	test('the page renders the month roster and names the excluded types', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);

		const renderedRows = await readRows(page);
		expect(renderedRows.map((row) => row.code).sort()).toEqual(
			model.month.rosterCodes
		);

		// Every rendered row carries the derived, window-scoped figures and
		// the chip exactly when (and as) the derivation promises one.
		let chipsSeen = 0;
		let blankCostRows = 0;
		for (const [employeeId, derived] of model.rows) {
			const employee = model.employees.find((row) => row.id === employeeId)!;
			const rendered = renderedRows.find(
				(row) => row.code === employee.employee_id
			)!;
			expect(rendered.capacity, employee.employee_id).toBe(
				number2.format(derived.capacityHours)
			);
			expect(rendered.logged, employee.employee_id).toBe(
				number2.format(derived.loggedHours)
			);
			expect(rendered.utilization, employee.employee_id).toBe(
				derived.utilizationPercent === null
					? '—'
					: `${number2.format(derived.utilizationPercent)}%`
			);
			expect(rendered.band, employee.employee_id).toBe(
				derived.utilizationBand ?? ''
			);
			expect(rendered.partial, employee.employee_id).toBe(derived.chip ?? '');
			if (derived.chip) chipsSeen++;
			if (derived.costStatus === 'no-profile') {
				// Blank, never zero: the em dash plus the "No profile" tag.
				expect(rendered.monthly, employee.employee_id).toContain('—');
				expect(rendered.monthly, employee.employee_id).toContain('No profile');
				expect(rendered.monthly, employee.employee_id).not.toContain('0');
				expect(rendered.bench, employee.employee_id).toBe('—');
				blankCostRows++;
				continue;
			}
			expect(rendered.monthly, employee.employee_id).toContain(
				number2.format(derived.monthlyCost!)
			);
			// The bench cell pins the payroll rate in the DOM: it is monthly −
			// round2(CTC ÷ Basis Hours × logged). Negative currency carries its
			// sign ahead of the symbol, so compare the magnitude.
			expect(rendered.bench, employee.employee_id).toContain(
				number2.format(Math.abs(derived.benchCost!))
			);
		}
		expect(chipsSeen).toBeGreaterThan(0);
		expect(blankCostRows).toBeGreaterThan(0);

		// Misfiled types never render as rows.
		for (const member of UTILIZATION_ROSTER) {
			if (member.type !== 'Payroll') {
				expect(
					renderedRows.some((row) => row.code === member.code),
					`${member.code} must never render a row`
				).toBe(false);
			}
		}

		// The disclosure strip names the counts by Employee Type value.
		const strip = page.getByTestId('roster-disclosure');
		await expect(strip).toBeVisible();
		await expect(page.getByTestId('roster-disclosure-filter')).toContainText(
			'Employee Type = Payroll'
		);
		await expect(page.getByTestId('roster-disclosure-note')).toContainText(
			'employment window'
		);
		const summary = page.getByTestId('roster-disclosure-summary');
		const excludedCount = model.month.buckets.reduce((n, b) => n + b.count, 0);
		await expect(summary).toContainText(
			`${excludedCount} ${excludedCount === 1 ? 'employee' : 'employees'} excluded`
		);
		await expect(summary).toContainText(
			`of ${model.month.consideredCount} considered for the month`
		);
		await expect(summary).toContainText(
			`leaving ${model.month.rosterCount} on the roster`
		);

		for (const bucket of model.month.buckets) {
			const chip = page.locator(
				`[data-testid="roster-disclosure-bucket"][data-value="${
					bucket.value ?? ''
				}"]`
			);
			await expect(chip).toHaveCount(1);
			await expect(chip).toContainText(
				`${bucket.count} ${bucket.value ?? 'unset'}`
			);
			await expect(chip).toHaveAttribute('data-reason', 'not_payroll_type');
		}

		// And the dropped people are nameable behind the details.
		await page.getByTestId('roster-disclosure-list').locator('summary').click();
		for (const plan of [
			'contractInViewedMonth',
			'deputationInViewedMonth',
			'unsetInViewedMonth',
			'internNoEvidence',
		] as const) {
			const member = utilizationMemberForPlan(plan);
			await expect(
				page.locator(
					`[data-testid="roster-disclosure-item"][data-code="${member.code}"]`
				)
			).toBeVisible();
		}

		observed.page = {
			renderedRows: renderedRows.length,
			derivedRows: model.month.rosterCodes.length,
			partialChips: chipsSeen,
			withHours: renderedRows.find(
				(row) => row.code === utilizationMemberForPlan('payrollWithHours').code
			),
			disclosureChips: model.month.buckets.length,
		};
	});

	test('partial windows pro-rate Capacity and Monthly Cost with footing preserved', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		// Every row carries the derived window-scoped figures, its window and
		// the partial flag; priced rows foot fractional + bench = monthly.
		for (const row of api.rows) {
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === row.employee_code
			)!;
			const derived = model.rows.get(employee.id)!;
			const window = model.windows.get(employee.id)!;
			expect(row.capacity_hours, row.employee_code).toBe(derived.capacityHours);
			expect(row.is_partial_window, row.employee_code).toBe(
				derived.isPartialWindow
			);
			expect(row.employment_start).toBe(window.start);
			expect(row.employment_end).toBe(window.end);
			if (derived.costStatus === 'no-profile') {
				expect(row.cost_status, row.employee_code).toBe('no-profile');
				expect(row.monthly_cost, row.employee_code).toBeNull();
				expect(row.fractional_cost, row.employee_code).toBeNull();
				expect(row.bench_cost, row.employee_code).toBeNull();
				continue;
			}
			expect(row.cost_status, row.employee_code).toBe('priced');
			expect(row.monthly_cost, row.employee_code).toBe(derived.monthlyCost);
			expect(row.fractional_cost, row.employee_code).toBe(
				derived.fractionalCost
			);
			expect(row.bench_cost, row.employee_code).toBe(derived.benchCost);
			expect(
				round2((row.fractional_cost ?? 0) + (row.bench_cost ?? 0)),
				row.employee_code
			).toBe(row.monthly_cost);
		}

		// The fixtures' window shapes, read off the derived rows.
		const byPlan = (plan: UtilizationPlan) => {
			const member = utilizationMemberForPlan(plan);
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === member.code
			)!;
			return {
				derived: model.rows.get(employee.id)!,
				row: api.rows.find(
					(candidate) => candidate.employee_code === member.code
				)!,
			};
		};
		const joiner = byPlan('midMonthJoiner');
		const leaver = byPlan('midMonthLeaver');
		const idle = byPlan('payrollIdle');
		const monthLeaver = byPlan('leaverInViewedMonth');

		// Mid-month joiner (15 Jan → open): 14 of January's 25 working days.
		expect(joiner.derived.isPartialWindow).toBe(true);
		expect(joiner.derived.employedWorkingDays).toBe(14);
		expect(joiner.derived.monthWorkingDays).toBe(25);
		expect(joiner.row.capacity_hours).toBe(14 * STANDARD_DAY_HOURS);
		expect(joiner.row.monthly_cost).toBe(round2((UTILIZATION_CTC * 14) / 25));
		expect(joiner.derived.chip).toBe('Partial (15 Jan – 31 Jan)');

		// Mid-month leaver (→ 18 Jan): 15 of the 25 working days, one a leave
		// day, so capacity is the 14 remaining days × 8h.
		expect(leaver.derived.isPartialWindow).toBe(true);
		expect(leaver.derived.employedWorkingDays).toBe(15);
		expect(leaver.row.capacity_hours).toBe(14 * STANDARD_DAY_HOURS);
		expect(leaver.row.monthly_cost).toBe(round2((UTILIZATION_CTC * 15) / 25));
		expect(leaver.derived.chip).toBe('Partial (1 Jan – 18 Jan)');

		// Full-month windows are not partial and reproduce the full CTC.
		expect(idle.derived.isPartialWindow).toBe(false);
		expect(idle.row.capacity_hours).toBe(
			idle.derived.monthWorkingDays * STANDARD_DAY_HOURS
		);
		expect(idle.row.monthly_cost).toBe(UTILIZATION_CTC);
		expect(monthLeaver.derived.isPartialWindow).toBe(false);
		expect(monthLeaver.row.monthly_cost).toBe(UTILIZATION_CTC);

		// The totals are the derived sums over the same row set (priced rows
		// only for money, exactly like the server), footing too.
		let capacity = 0;
		let logged = 0;
		let monthly = 0;
		let fractional = 0;
		let bench = 0;
		for (const derived of model.rows.values()) {
			capacity += derived.capacityHours;
			logged += derived.loggedHours;
			if (derived.costStatus !== 'priced') continue;
			monthly += derived.monthlyCost!;
			fractional += derived.fractionalCost!;
			bench += derived.benchCost!;
		}
		expect(api.totals.employee_count).toBe(model.rows.size);
		expect(api.totals.capacity_hours).toBe(round2(capacity));
		expect(api.totals.logged_hours).toBe(round2(logged));
		expect(api.totals.monthly_cost).toBe(round2(monthly));
		expect(api.totals.fractional_cost).toBe(round2(fractional));
		expect(api.totals.bench_cost).toBe(round2(bench));
		expect(round2(fractional + bench)).toBe(round2(monthly));

		observed.partialWindows = {
			month: MONTH,
			monthWorkingDays: idle.derived.monthWorkingDays,
			joiner: {
				window: [joiner.row.employment_start, joiner.row.employment_end],
				capacity: joiner.row.capacity_hours,
				monthly: joiner.row.monthly_cost,
				chip: joiner.derived.chip,
			},
			leaver: {
				window: [leaver.row.employment_start, leaver.row.employment_end],
				capacity: leaver.row.capacity_hours,
				monthly: leaver.row.monthly_cost,
				chip: leaver.derived.chip,
			},
			totals: {
				capacity: api.totals.capacity_hours,
				monthly: api.totals.monthly_cost,
				fractional: api.totals.fractional_cost,
				bench: api.totals.bench_cost,
			},
			partialRows: api.rows.filter((row) => row.is_partial_window).length,
		};
	});

	test('an active optional holiday is a working day for Capacity', async ({
		request,
	}) => {
		// The fixture's holiday is active and optional, on a Tuesday.
		const [holidayRow] = await rows<{
			is_optional: number;
			is_active: number;
		}>(
			`SELECT COALESCE(is_optional, 0) AS is_optional,
			        COALESCE(is_active, 1) AS is_active
			 FROM holiday_master WHERE name = ?`,
			[UTILIZATION_OPTIONAL_HOLIDAY.name]
		);
		expect(
			holidayRow,
			'the optional holiday fixture must be seeded'
		).toBeTruthy();
		expect(Number(holidayRow.is_active)).toBe(1);
		expect(Number(holidayRow.is_optional)).toBe(1);

		// The derived calendar keeps it out of the subtracted set; the base
		// fixture's non-optional holiday stays in it (it lands on the 4th
		// Saturday, so it cannot move the working-day count either way).
		expect(model.calendar.optionalHolidays).toContain(
			UTILIZATION_OPTIONAL_HOLIDAY.date
		);
		expect(
			model.calendar.nonOptionalHolidays.has(UTILIZATION_OPTIONAL_HOLIDAY.date)
		).toBe(false);
		expect(model.calendar.nonOptionalHolidays.has('2019-01-26')).toBe(true);

		const api = await fetchMonth(request, MONTH);
		const idleMember = utilizationMemberForPlan('payrollIdle');
		const idleEmployee = model.employees.find(
			(row) => row.employee_id === idleMember.code
		)!;
		const idleRow = api.rows.find(
			(row) => row.employee_code === idleMember.code
		)!;
		const leaverMember = utilizationMemberForPlan('midMonthLeaver');
		const leaverRow = api.rows.find(
			(row) => row.employee_code === leaverMember.code
		)!;

		// A full-month row keeps the month's whole capacity: 25 working days
		// (200h), not 24 (192h) — the optional holiday subtracts nothing.
		expect(idleRow.capacity_hours).toBe(200);
		expect(idleRow.monthly_cost).toBe(UTILIZATION_CTC);

		// The leaver's window covers the 15th and records 'H' attendance on
		// it: the day still credits the standard 8h, so capacity stays 112h
		// (15 working days less the 1 leave day) instead of 104h.
		expect(leaverRow.capacity_hours).toBe(112);

		observed.optionalHoliday = {
			name: UTILIZATION_OPTIONAL_HOLIDAY.name,
			date: UTILIZATION_OPTIONAL_HOLIDAY.date,
			isActive: Number(holidayRow.is_active),
			isOptional: Number(holidayRow.is_optional),
			nonOptionalBase: '2019-01-26',
			monthWorkingDays: model.rows.get(idleEmployee.id)!.monthWorkingDays,
			idleCapacity: idleRow.capacity_hours,
			leaverCapacity: leaverRow.capacity_hours,
			note: 'With the optional holiday subtracted, the full-month row would read 192h and the H-status leaver 104h.',
		};
	});

	// ─── #295: payroll-aligned Bench Cost rate ──────────────────────────

	test('the rate divides CTC by the month’s Basis Hours, not the profile’s own denominator', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);
		const basisDays = basisDaysIn(MONTH, model.calendar.nonOptionalHolidays);
		// January 2019: 31 days − 4 Sundays (6/13/20/27) − the E2E Holiday
		// (26 Jan, a Saturday) = 26; the 2nd/4th Saturdays (12/19) stay in.
		expect(basisDays).toBe(26);
		const januaryRate = UTILIZATION_CTC / (basisDays * STANDARD_DAY_HOURS);
		expect(round2(januaryRate)).toBe(125);

		// `std_working_days` = 22 would apportion the CTC over 176h (147.73/h);
		// the month's Basis Hours (26 × 8 = 208h) give 125/h.
		const overrideMember = utilizationMemberForPlan('basisDaysOverride');
		const overrideEmployee = model.employees.find(
			(row) => row.employee_id === overrideMember.code
		)!;
		const overrideProfile = coveringProfile(overrideEmployee.id, MONTH)!;
		expect(Number(overrideProfile.std_working_days)).toBe(22);
		expect(
			Number(overrideProfile.std_hours_per_day) || STANDARD_DAY_HOURS
		).toBe(8);
		const overrideRow = api.rows.find(
			(row) => row.employee_code === overrideMember.code
		)!;
		const overrideDerived = model.rows.get(overrideEmployee.id)!;
		expect(overrideDerived.basisDays).toBe(basisDays);
		expect(overrideDerived.rate).toBe(januaryRate);
		expect(overrideRow.logged_hours).toBe(32);
		const profileDenominator =
			Number(overrideProfile.std_working_days) *
			(Number(overrideProfile.std_hours_per_day) || STANDARD_DAY_HOURS);
		expect(profileDenominator).toBe(176);
		expect(overrideRow.fractional_cost).toBe(round2(januaryRate * 32));
		expect(overrideRow.fractional_cost).toBe(4000);
		expect(
			round2((UTILIZATION_CTC / profileDenominator) * 32),
			'the profile denominator would read 4727.27'
		).toBe(4727.27);
		expect(overrideRow.fractional_cost).not.toBe(4727.27);

		// An hourly profile's stored rate (999) must not price the row either:
		// CTC ÷ Basis Hours does, exactly as on the slip.
		const directMember = utilizationMemberForPlan('directRateIgnored');
		const directEmployee = model.employees.find(
			(row) => row.employee_id === directMember.code
		)!;
		const directProfile = coveringProfile(directEmployee.id, MONTH)!;
		expect(directProfile.salary_type).toBe('hourly');
		expect(Number(directProfile.hourly_rate)).toBe(999);
		const directRow = api.rows.find(
			(row) => row.employee_code === directMember.code
		)!;
		expect(directRow.logged_hours).toBe(24);
		expect(directRow.fractional_cost).toBe(round2(januaryRate * 24));
		expect(directRow.fractional_cost).toBe(3000);
		expect(directRow.fractional_cost).not.toBe(round2(999 * 24));
		expect(
			Math.abs(
				directRow.fractional_cost! / directRow.logged_hours - januaryRate
			)
		).toBeLessThan(0.0001);

		// Utilization still comes from the Capacity calendar: this member's
		// evidence window (1–5 Jan, its last Logged Hours day) reads 5 employed
		// working days, and the month itself has 25 working days — while the
		// rate's calendar has 26 basis days (the 2nd/4th Saturdays stay in).
		expect(overrideRow.capacity_hours).toBe(5 * STANDARD_DAY_HOURS);
		expect(overrideDerived.monthWorkingDays).toBe(25);
		expect(overrideDerived.basisDays).toBe(basisDays);
		expect(overrideDerived.basisDays).not.toBe(
			overrideDerived.monthWorkingDays
		);
		expect(overrideRow.monthly_cost).toBe(round2((UTILIZATION_CTC * 5) / 25));

		observed.rateBasis = {
			month: MONTH,
			basisDays,
			basisHours: basisDays * STANDARD_DAY_HOURS,
			rate: round2(januaryRate),
			capacityWorkingDays: overrideDerived.monthWorkingDays,
			profileDenominator,
			override: {
				code: overrideMember.code,
				logged: overrideRow.logged_hours,
				fractional: overrideRow.fractional_cost,
				bench: overrideRow.bench_cost,
			},
			direct: {
				code: directMember.code,
				storedHourlyRate: Number(directProfile.hourly_rate),
				logged: directRow.logged_hours,
				fractional: directRow.fractional_cost,
			},
		};
	});

	test('a fully logged month reconciles and the rate moves with the month’s Basis Hours', async ({
		request,
	}) => {
		const fullMember = utilizationMemberForPlan('basisRateFullMonth');
		const fullEmployee = model.employees.find(
			(row) => row.employee_id === fullMember.code
		)!;

		// January: Logged Hours == the month's Basis Hours (26 × 8 = 208h), so
		// the whole CTC pays out — fractional = monthly, bench = 0.
		const januaryBasisDays = basisDaysIn(
			MONTH,
			model.calendar.nonOptionalHolidays
		);
		const januaryRate =
			UTILIZATION_CTC / (januaryBasisDays * STANDARD_DAY_HOURS);
		expect(januaryBasisDays * STANDARD_DAY_HOURS).toBe(208);
		expect(round2(januaryRate)).toBe(125);
		const january = await fetchMonth(request, MONTH);
		const januaryRow = january.rows.find(
			(row) => row.employee_code === fullMember.code
		)!;
		expect(januaryRow.logged_hours).toBe(208);
		expect(januaryRow.monthly_cost).toBe(UTILIZATION_CTC);
		expect(januaryRow.fractional_cost).toBe(UTILIZATION_CTC);
		expect(januaryRow.bench_cost).toBe(0);

		// February: 28 days − 4 Sundays = 24 basis days for the same employee,
		// so the same CTC buys a different hourly rate. The evidence window
		// closes on the last Logged Hours day (19 Feb), so Monthly Cost is
		// pro-rated to the employed working days while the rate is not.
		const februaryCalendar = await monthCalendar('2019-02');
		const februaryBasisDays = basisDaysIn(
			'2019-02',
			februaryCalendar.nonOptionalHolidays
		);
		expect(februaryBasisDays).toBe(24);
		const februaryRate =
			UTILIZATION_CTC / (februaryBasisDays * STANDARD_DAY_HOURS);
		expect(round2(februaryRate)).toBe(135.42);
		expect(januaryRate).not.toBe(februaryRate);

		// February's Logged Hours, summed from the raw assignment payloads.
		const februaryAssignments = await rows<{ daily_entries: string | null }>(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE employee_id = ? AND status <> 'Cancelled'`,
			[fullEmployee.id]
		);
		const februaryLogged = februaryAssignments.reduce(
			(sum, assignment) =>
				sum + loggedHoursInMonth(assignment.daily_entries, '2019-02'),
			0
		);
		expect(februaryLogged).toBe(96);
		const february = await fetchMonth(request, '2019-02');
		const februaryRow = february.rows.find(
			(row) => row.employee_code === fullMember.code
		)!;
		const februaryDerived = deriveRow(
			model.windows.get(fullEmployee.id)!,
			'2019-02',
			februaryCalendar,
			new Map(),
			februaryLogged,
			rateFor(fullEmployee.id, '2019-02')
		);
		expect(februaryDerived.basisDays).toBe(februaryBasisDays);
		expect(februaryRow.logged_hours).toBe(februaryDerived.loggedHours);
		expect(februaryRow.capacity_hours).toBe(februaryDerived.capacityHours);
		expect(februaryRow.monthly_cost).toBe(februaryDerived.monthlyCost);
		expect(februaryRow.fractional_cost).toBe(februaryDerived.fractionalCost);
		expect(februaryRow.bench_cost).toBe(februaryDerived.benchCost);
		expect(februaryRow.logged_hours).toBe(februaryLogged);
		expect(februaryRow.fractional_cost).toBe(
			round2(februaryRate * februaryLogged)
		);
		expect(februaryRow.fractional_cost).toBe(13000);
		expect(februaryRow.is_partial_window).toBe(true);

		// A fixed 26 × 8 denominator (the old rule) would price February's 96h
		// at 12000; the month's own Basis Hours pay 13000.
		expect(
			round2((UTILIZATION_CTC / (26 * STANDARD_DAY_HOURS)) * februaryLogged)
		).toBe(12000);
		expect(februaryRow.fractional_cost).not.toBe(12000);

		// fractional ÷ logged recovers CTC ÷ Basis Hours in each month.
		expect(
			Math.abs(
				januaryRow.fractional_cost! / januaryRow.logged_hours - januaryRate
			)
		).toBeLessThan(0.0001);
		expect(
			Math.abs(
				februaryRow.fractional_cost! / februaryRow.logged_hours - februaryRate
			)
		).toBeLessThan(0.0001);

		observed.rateMoves = {
			january: {
				basisDays: januaryBasisDays,
				rate: round2(januaryRate),
				logged: januaryRow.logged_hours,
				fractional: januaryRow.fractional_cost,
				bench: januaryRow.bench_cost,
			},
			february: {
				basisDays: februaryBasisDays,
				rate: round2(februaryRate),
				logged: februaryRow.logged_hours,
				monthly: februaryRow.monthly_cost,
				fractional: februaryRow.fractional_cost,
				bench: februaryRow.bench_cost,
				partial: februaryRow.is_partial_window,
			},
		};
	});

	test('employees without a covering Salary Profile keep blank cost columns', async ({
		request,
		page,
	}) => {
		const member = utilizationMemberForPlan('payrollNoProfile');
		const employee = model.employees.find(
			(row) => row.employee_id === member.code
		)!;
		const profiles = await rows<{ n: number | string }>(
			`SELECT COUNT(*) AS n FROM employee_salary_profile
			 WHERE employee_id = ? AND is_active = 1`,
			[employee.id]
		);
		expect(Number(profiles[0].n)).toBe(0);

		const api = await fetchMonth(request, MONTH);
		const row = api.rows.find(
			(candidate) => candidate.employee_code === member.code
		)!;
		expect(row.cost_status).toBe('no-profile');
		expect(row.monthly_cost).toBeNull();
		expect(row.fractional_cost).toBeNull();
		expect(row.bench_cost).toBeNull();
		// Hours and utilization still read; a blank is not a zero.
		expect(row.capacity_hours).toBeGreaterThan(0);
		expect(row.logged_hours).toBeGreaterThan(0);
		expect(row.utilization_percent).toBeGreaterThan(0);

		await openMonth(page, MONTH_LABEL);
		const rendered = (await readRows(page)).find(
			(candidate) => candidate.code === member.code
		)!;
		expect(rendered.monthly).toContain('—');
		expect(rendered.monthly).toContain('No profile');
		expect(rendered.monthly).not.toContain('0');
		expect(rendered.bench).toBe('—');
		await expect(page.getByTestId('utilization-summary')).toContainText(
			'unpriced'
		);

		observed.noProfile = {
			code: member.code,
			costStatus: row.cost_status,
			logged: row.logged_hours,
			utilization: row.utilization_percent,
			monthlyCell: rendered.monthly,
			benchCell: rendered.bench,
		};
	});

	test('the page states that the rate’s and Capacity’s calendars differ by design', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const note = page.getByTestId('payroll-rate-note');
		await expect(note).toBeVisible();
		await expect(note).toContainText('CTC ÷ Basis Hours');
		await expect(note).toContainText('non-optional holidays');
		await expect(note).toContainText('Sundays, 2nd/4th Saturdays');
		await expect(note).toContainText('differ by design');
		observed.rateNote = (await note.textContent())?.trim();
	});

	test('the page keeps the disclosure absent when the month has no exclusions', async ({
		page,
		request,
	}) => {
		const payload = await fetchMonth(request, MONTH);
		// The month's real payload, minus the exclusions: the page must render
		// the grid and no strip at all.
		await page.route(
			/\/api\/reports\/employee-utilization\?/,
			async (route) => {
				if (!route.request().url().includes('month=')) {
					await route.continue();
					return;
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						success: true,
						data: { ...payload, disclosure: null },
					}),
				});
			}
		);

		await page.goto('/reports/employee-utilization');
		await expect(page.getByTestId('utilization-row').first()).toBeVisible();
		await expect(page.getByTestId('roster-disclosure')).toHaveCount(0);
		await expect(page.getByTestId('utilization-summary')).toBeVisible();

		observed.emptyDisclosure = { rowsRendered: true, stripRendered: false };
	});

	// ─── #296: "No time logged" state and count ─────────────────────────

	test('zero-Logged-Hours rows carry the no-time-logged state and keep their Under slot', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		// Every row's state is the derivation's: roster ∩ month with zero
		// Logged Hours. Nothing else about such a row moves — the percent and
		// the band stay the factual 0% Under.
		const noLogIds = new Set<number>();
		for (const row of api.rows) {
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === row.employee_code
			)!;
			const derived = model.rows.get(employee.id)!;
			expect(row.state, row.employee_code).toBe(derived.state);
			if (derived.loggedHours === 0) noLogIds.add(employee.id);
			if (derived.state === null) {
				expect(row.logged_hours, row.employee_code).toBeGreaterThan(0);
				continue;
			}
			expect(row.logged_hours, row.employee_code).toBe(0);
			if (derived.capacityHours > 0) {
				expect(row.utilization_percent, row.employee_code).toBe(0);
				expect(row.utilization_band, row.employee_code).toBe('under');
			}
		}
		expect(noLogIds.size).toBeGreaterThan(0);

		// The idle fixture: active, full month, no evidence — the state marks
		// missing timesheet data while the row keeps the whole month's bench.
		const idleMember = utilizationMemberForPlan('payrollIdle');
		const idleRow = api.rows.find(
			(row) => row.employee_code === idleMember.code
		)!;
		expect(idleRow.logged_hours).toBe(0);
		expect(idleRow.utilization_percent).toBe(0);
		expect(idleRow.utilization_band).toBe('under');
		expect(idleRow.state).toBe('no_time_logged');
		const idleDerived = model.rows.get(
			model.employees.find((row) => row.employee_id === idleMember.code)!.id
		)!;
		expect(idleRow.bench_cost).toBe(idleDerived.benchCost);
		expect(idleRow.bench_cost).toBeGreaterThan(0);

		// The summary count is the derived count over the month's roster...
		expect(api.totals.no_logged_count).toBe(noLogIds.size);
		expect(api.totals.employee_count).toBe(model.rows.size);

		// ...and unlike the other totals it stays month-wide under the band
		// filter (the department rollup's scope): the filtered grid narrows,
		// the count does not.
		const underPayload = await fetchMonth(request, MONTH, 'under');
		const derivedUnder = [...model.rows.values()].filter(
			(derived) => derived.utilizationBand === 'under'
		);
		expect(underPayload.totals.employee_count).toBe(derivedUnder.length);
		expect(underPayload.totals.no_logged_count).toBe(noLogIds.size);

		// The row keeps its band-then-bench position: the Under group runs by
		// Bench Cost descending (unpriced nulls last), and every no-log row
		// sits exactly where its derived bench puts it — neighbours included.
		const benchOf = (value: number | null) =>
			value === null ? Number.NEGATIVE_INFINITY : value;
		const under = api.rows.filter((row) => row.utilization_band === 'under');
		const underCodes = under.map((row) => row.employee_code);
		for (let i = 1; i < under.length; i++) {
			expect(
				benchOf(under[i].bench_cost),
				`${under[i].employee_code} must not out-rank ${under[i - 1].employee_code}`
			).toBeLessThanOrEqual(benchOf(under[i - 1].bench_cost));
		}
		for (const [employeeId, derived] of model.rows) {
			if (derived.utilizationBand !== 'under') continue;
			const employee = model.employees.find((row) => row.id === employeeId)!;
			const index = underCodes.indexOf(employee.employee_id);
			expect(index, employee.employee_id).toBeGreaterThanOrEqual(0);
			const bench = benchOf(derived.benchCost);
			for (const before of under.slice(0, index)) {
				expect(
					benchOf(before.bench_cost),
					`${before.employee_code} precedes ${employee.employee_id}`
				).toBeGreaterThanOrEqual(bench);
			}
			for (const after of under.slice(index + 1)) {
				expect(
					benchOf(after.bench_cost),
					`${after.employee_code} follows ${employee.employee_id}`
				).toBeLessThanOrEqual(bench);
			}
		}
		expect(underCodes).toContain(idleMember.code);

		observed.noTimeLogged = {
			month: MONTH,
			derivedCount: noLogIds.size,
			apiCount: api.totals.no_logged_count,
			// Month-wide under the band filter, like the rollup.
			underFlaggedCount: underPayload.totals.no_logged_count,
			underRows: under.length,
			idle: {
				code: idleMember.code,
				logged: idleRow.logged_hours,
				percent: idleRow.utilization_percent,
				band: idleRow.utilization_band,
				state: idleRow.state,
				bench: idleRow.bench_cost,
			},
		};
	});

	test('the page reads "No time logged" for those rows and counts them in the summary', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const renderedRows = await readRows(page);

		const derivedStateByCode = new Map<string, string>();
		const derivedBenchByCode = new Map<string, number | null>();
		let noLogCount = 0;
		for (const [employeeId, derived] of model.rows) {
			const employee = model.employees.find((row) => row.id === employeeId)!;
			derivedStateByCode.set(employee.employee_id, derived.state ?? '');
			derivedBenchByCode.set(employee.employee_id, derived.benchCost);
			if (derived.loggedHours === 0) noLogCount++;
		}
		expect(noLogCount).toBeGreaterThan(0);

		// `data-state` mirrors the derivation on every row, and the Flag cell
		// replaces the band reading for exactly those rows.
		const bandText: Record<string, string> = {
			under: 'Under',
			healthy: 'Healthy',
			over: 'Over',
		};
		for (const rendered of renderedRows) {
			expect(rendered.state, rendered.code).toBe(
				derivedStateByCode.get(rendered.code)
			);
			expect(rendered.flagCell, rendered.code).toBe(
				rendered.state === 'no_time_logged'
					? 'No time logged'
					: (bandText[rendered.band] ?? 'No capacity')
			);
		}

		// The idle fixture's row: badge, state attribute, factual % column and
		// its Under band intact.
		const idleMember = utilizationMemberForPlan('payrollIdle');
		const idleRendered = renderedRows.find(
			(row) => row.code === idleMember.code
		)!;
		expect(idleRendered.state).toBe('no_time_logged');
		expect(idleRendered.band).toBe('under');
		expect(idleRendered.flagCell).toBe('No time logged');
		expect(idleRendered.logged).toBe('0.00');
		expect(idleRendered.utilization).toBe('0.00%');
		const idleRowLocator = page.locator(
			`[data-testid="utilization-row"][data-employee-code="${idleMember.code}"]`
		);
		await expect(idleRowLocator).toHaveAttribute(
			'data-state',
			'no_time_logged'
		);
		await expect(idleRowLocator.getByTestId('no-time-logged')).toHaveText(
			'No time logged'
		);
		await expect(idleRowLocator.getByTestId('no-time-logged')).toHaveAttribute(
			'data-state',
			'no_time_logged'
		);

		// Position within the rendered Under group: Bench Cost descending,
		// the idle row's neighbours bracketing its own derived bench.
		const benchOf = (code: string) => {
			const bench = derivedBenchByCode.get(code);
			return bench === null || bench === undefined
				? Number.NEGATIVE_INFINITY
				: bench;
		};
		const renderedUnder = renderedRows.filter((row) => row.band === 'under');
		for (let i = 1; i < renderedUnder.length; i++) {
			expect(
				benchOf(renderedUnder[i].code),
				`${renderedUnder[i].code} must not out-rank ${renderedUnder[i - 1].code}`
			).toBeLessThanOrEqual(benchOf(renderedUnder[i - 1].code));
		}
		const idleIndex = renderedUnder.findIndex(
			(row) => row.code === idleMember.code
		);
		expect(idleIndex).toBeGreaterThanOrEqual(0);
		for (const before of renderedUnder.slice(0, idleIndex)) {
			expect(benchOf(before.code), before.code).toBeGreaterThanOrEqual(
				benchOf(idleMember.code)
			);
		}
		for (const after of renderedUnder.slice(idleIndex + 1)) {
			expect(benchOf(after.code), after.code).toBeLessThanOrEqual(
				benchOf(idleMember.code)
			);
		}
		expect(
			renderedRows.filter((row) => row.state === 'no_time_logged').length
		).toBe(noLogCount);

		// The summary line counts them month-wide — the viewed month's count,
		// not the band-filtered grid's — and labels that scope.
		const countLine = page.getByTestId('no-time-logged-count');
		const summaryText = `· ${noLogCount} no time logged in the month`;
		await expect(countLine).toContainText(summaryText);
		expect((await countLine.textContent())?.trim()).toBe(summaryText);

		// Narrowing the grid to the Healthy band — which holds no idle row —
		// leaves the count month-wide and the line standing: the filtered
		// count would read 0 here and hide the segment.
		const derivedHealthyCount = [...model.rows.values()].filter(
			(derived) => derived.utilizationBand === 'healthy'
		).length;
		expect(derivedHealthyCount).toBeGreaterThan(0);
		await page
			.getByRole('button', { name: 'Healthy (80–100%)', exact: true })
			.click();
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			derivedHealthyCount
		);
		await expect(countLine).toContainText(summaryText);
		expect((await countLine.textContent())?.trim()).toBe(summaryText);

		observed.noTimeLoggedPage = {
			month: MONTH,
			renderedNoLogRows: noLogCount,
			idleRow: {
				code: idleMember.code,
				state: idleRendered.state,
				band: idleRendered.band,
				flagCell: idleRendered.flagCell,
				utilization: idleRendered.utilization,
				underIndex: idleIndex,
				underRows: renderedUnder.length,
			},
			summaryCount: (await countLine.textContent())?.trim(),
			healthyFilteredRows: derivedHealthyCount,
		};
	});

	// ─── #297: trailing months, chronic marker and team trend ───────────

	test('every row carries the derived three trailing months and its chronic verdict', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		let chronicRows = 0;
		for (const row of api.rows) {
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === row.employee_code
			)!;
			const derived = model.trailing.get(employee.id)!;
			expect(derived, row.employee_code).toBeTruthy();

			expect(
				row.trailing.map((cell) => cell.month),
				row.employee_code
			).toEqual(model.span.slice(-3));
			expect(row.trailing, row.employee_code).toEqual(
				derived.trailing.map((cell) => ({
					month: cell.month,
					employed: cell.employed,
					utilization_percent: cell.utilizationPercent,
				}))
			);
			// The viewed month's cell is the row's own utilization.
			expect(row.trailing[2].employed, row.employee_code).toBe(true);
			expect(row.trailing[2].utilization_percent, row.employee_code).toBe(
				row.utilization_percent
			);
			expect(row.chronic_under, row.employee_code).toBe(derived.chronicUnder);
			if (derived.chronicUnder) chronicRows++;
		}
		expect(chronicRows).toBeGreaterThan(0);
		// The marker covers exactly the derived set: the chronic fixture is in
		// it, the one healthy month's member and the blank-cell member are not.
		const chronicCodes = api.rows
			.filter((row) => row.chronic_under)
			.map((row) => row.employee_code);
		expect(chronicCodes).toContain(
			utilizationMemberForPlan('chronicUnder').code
		);
		expect(chronicCodes).not.toContain(
			utilizationMemberForPlan('healthyHistory').code
		);
		expect(chronicCodes).not.toContain(
			utilizationMemberForPlan('trailingGap').code
		);

		const rowFor = (plan: UtilizationPlan) => {
			const member = utilizationMemberForPlan(plan);
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === member.code
			)!;
			return {
				derived: model.trailing.get(employee.id)!,
				row: api.rows.find(
					(candidate) => candidate.employee_code === member.code
				)!,
			};
		};

		// Employed every month of the window and low every month: chronic.
		// 16h logged against 192h (Nov), 192h (Dec) and the windowed 24h of
		// January (1–3 Jan) — 8.33 / 8.33 / 66.67, all below 80.
		const chronic = rowFor('chronicUnder');
		expect(chronic.derived.chronicUnder).toBe(true);
		expect(chronic.row.trailing).toEqual([
			{ month: TRAILING_MONTHS[0], employed: true, utilization_percent: 8.33 },
			{ month: TRAILING_MONTHS[1], employed: true, utilization_percent: 8.33 },
			{ month: TRAILING_MONTHS[2], employed: true, utilization_percent: 66.67 },
		]);
		expect(chronic.row.chronic_under).toBe(true);

		// One fully logged December (every 2018-12 working day = 100%) breaks
		// the marker although November and January read low.
		const healthy = rowFor('healthyHistory');
		expect(healthy.derived.chronicUnder).toBe(false);
		expect(healthy.row.trailing).toEqual([
			{ month: TRAILING_MONTHS[0], employed: true, utilization_percent: 8.33 },
			{ month: TRAILING_MONTHS[1], employed: true, utilization_percent: 100 },
			{ month: TRAILING_MONTHS[2], employed: true, utilization_percent: 66.67 },
		]);
		expect(healthy.row.chronic_under).toBe(false);

		// Joins 15 Dec: November is a month the window never covers (blank),
		// December reads the pro-rated 15–31 Dec pipeline (13 working days =
		// 104h against 24h logged) and January logs every windowed day (100%).
		const gap = rowFor('trailingGap');
		expect(gap.derived.chronicUnder).toBe(false);
		expect(gap.row.trailing).toEqual([
			{
				month: TRAILING_MONTHS[0],
				employed: false,
				utilization_percent: null,
			},
			{ month: TRAILING_MONTHS[1], employed: true, utilization_percent: 23.08 },
			{ month: TRAILING_MONTHS[2], employed: true, utilization_percent: 100 },
		]);

		// Joined 15 Jan: one employed month is a one-off, never chronic.
		const oneOff = rowFor('midMonthJoiner');
		expect(oneOff.derived.trailing.map((cell) => cell.employed)).toEqual([
			false,
			false,
			true,
		]);
		expect(oneOff.row.chronic_under).toBe(false);

		observed.trailing = {
			month: MONTH,
			months: model.span.slice(-3),
			derivedChronicRows: chronicRows,
			apiChronicRows: api.rows.filter((row) => row.chronic_under).length,
			chronicUnder: chronic.row.trailing,
			healthyHistory: healthy.row.trailing,
			trailingGap: gap.row.trailing,
		};
	});

	test('the page renders the two trailing columns and marks exactly the chronic rows', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const renderedRows = await readRows(page);

		// The headers name the two preceding months, oldest first, right before
		// the viewed month's Utilization column.
		const headers = await page.$$eval(
			'[data-testid="trailing-header"]',
			(cells) =>
				cells.map((cell) => ({
					month: cell.getAttribute('data-month') ?? '',
					text: cell.textContent?.trim() ?? '',
				}))
		);
		expect(headers.map((header) => header.month)).toEqual(
			TRAILING_MONTHS.slice(0, 2)
		);
		expect(headers.map((header) => header.text)).toEqual(
			TRAILING_MONTHS.slice(0, 2).map((month) => monthLabel(month))
		);

		let chronicRows = 0;
		let blankCells = 0;
		for (const rendered of renderedRows) {
			const employee = model.employees.find(
				(row) => row.employee_id === rendered.code
			)!;
			const derived = model.trailing.get(employee.id)!;
			expect(rendered.trailing, rendered.code).toHaveLength(2);
			derived.trailing.slice(0, 2).forEach((cell, index) => {
				const trailingCell = rendered.trailing[index];
				expect(trailingCell.month, rendered.code).toBe(cell.month);
				expect(trailingCell.employed, rendered.code).toBe(
					cell.employed ? 'true' : 'false'
				);
				expect(trailingCell.text, rendered.code).toBe(
					cell.employed
						? cell.utilizationPercent === null
							? '—'
							: `${number2.format(cell.utilizationPercent)}%`
						: ''
				);
				if (!cell.employed) blankCells++;
			});
			expect(rendered.chronic, rendered.code).toBe(derived.chronicUnder);
			if (derived.chronicUnder) chronicRows++;
		}
		expect(chronicRows).toBeGreaterThan(0);
		expect(blankCells).toBeGreaterThan(0);
		expect(renderedRows.filter((row) => row.chronic)).toHaveLength(chronicRows);

		// The marker's text on the chronic fixture, and no marker at all on the
		// member whose December saved them.
		const chronicMember = utilizationMemberForPlan('chronicUnder');
		await expect(
			page
				.locator(
					`[data-testid="utilization-row"][data-employee-code="${chronicMember.code}"]`
				)
				.getByTestId('chronic-marker')
		).toHaveText('Chronic under');
		const healthyMember = utilizationMemberForPlan('healthyHistory');
		await expect(
			page
				.locator(
					`[data-testid="utilization-row"][data-employee-code="${healthyMember.code}"]`
				)
				.getByTestId('chronic-marker')
		).toHaveCount(0);

		// A month the window does not cover renders blank, not an em dash.
		const gapMember = utilizationMemberForPlan('trailingGap');
		const gapRendered = renderedRows.find(
			(row) => row.code === gapMember.code
		)!;
		expect(gapRendered.trailing[0].employed).toBe('false');
		expect(gapRendered.trailing[0].text).toBe('');

		observed.trailingPage = {
			month: MONTH,
			headers,
			renderedChronicRows: chronicRows,
			blankCells,
			trailingGap: gapRendered.trailing,
			chronicUnder: renderedRows.find((row) => row.code === chronicMember.code)
				?.trailing,
		};
	});

	test('a not-employed trailing month renders blank and no capacity an em dash', async ({
		page,
		request,
	}) => {
		const payload = await fetchMonth(request, MONTH);
		// Rewrite the first row's two preceding cells into the two shapes a
		// fixture cannot force (a month the window covers but that holds no
		// working day): employed with a null percent, then not employed.
		const target = payload.rows[0];
		const rewritten = {
			...target,
			trailing: target.trailing.map((cell, index) =>
				index === 0
					? { ...cell, employed: true, utilization_percent: null }
					: index === 1
						? { ...cell, employed: false, utilization_percent: null }
						: cell
			),
		};
		const rows = [rewritten, ...payload.rows.slice(1)];

		await page.route(
			/\/api\/reports\/employee-utilization\?/,
			async (route) => {
				if (!route.request().url().includes('month=')) {
					await route.continue();
					return;
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ success: true, data: { ...payload, rows } }),
				});
			}
		);

		await openMonth(page, MONTH_LABEL);
		const cells = page
			.locator('[data-testid="utilization-row"]')
			.first()
			.locator('[data-testid="cell-trailing-utilization"]');
		await expect(cells).toHaveCount(2);
		await expect(cells.nth(0)).toHaveAttribute('data-employed', 'true');
		await expect(cells.nth(0)).toHaveText('—');
		await expect(cells.nth(1)).toHaveAttribute('data-employed', 'false');
		expect(await cells.nth(1).textContent()).toBe('');

		observed.trailingCellKinds = {
			row: rewritten.employee_code,
			employedNoCapacity: '—',
			notEmployed: 'blank',
		};
	});

	test('the six-month trend is the derived capacity-weighted utilization and priced bench', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		expect(api.trend.map((point) => point.month)).toEqual(model.span);
		expect(api.trend).toEqual(
			model.trend.map((point) => ({
				month: point.month,
				utilization_percent: point.utilizationPercent,
				bench_cost: point.benchCost,
			}))
		);

		// The series is non-trivial and carries bench money in every month.
		expect(
			new Set(api.trend.map((point) => point.utilization_percent)).size
		).toBeGreaterThan(1);
		for (const point of api.trend) {
			expect(point.bench_cost, point.month).not.toBeNull();
			expect(point.bench_cost, point.month).toBeGreaterThan(0);
		}

		// January's point is the viewed month's team figure: Σ logged ÷ Σ
		// capacity over every derived roster row, and the priced bench sum.
		const january = api.trend[api.trend.length - 1];
		const derivedRows = [...model.rows.values()];
		const capacityHours = round2(
			derivedRows.reduce((sum, row) => sum + row.capacityHours, 0)
		);
		const loggedHours = round2(
			derivedRows.reduce((sum, row) => sum + row.loggedHours, 0)
		);
		const benchCost = round2(
			derivedRows
				.filter((row) => row.costStatus === 'priced')
				.reduce((sum, row) => sum + (row.benchCost ?? 0), 0)
		);
		expect(january.month).toBe(MONTH);
		expect(january.utilization_percent).toBe(
			round2((loggedHours / capacityHours) * 100)
		);
		expect(january.bench_cost).toBe(benchCost);

		// The chart is a team lens: the band filter must not reshape it.
		const under = await fetchMonth(request, MONTH, 'under');
		expect(under.rows.length).toBeLessThan(api.rows.length);
		expect(under.trend).toEqual(api.trend);

		observed.trend = {
			months: api.trend.map((point) => point.month),
			series: api.trend,
			januaryTeam: { capacityHours, loggedHours, benchCost },
		};
	});

	test('the page charts the trend and exposes the derived series through its hook', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const chart = page.getByTestId('team-trend-chart');
		await expect(chart).toBeVisible();

		const raw = (await chart.getAttribute('data-points')) ?? '';
		expect(raw).toBe(
			model.trend
				.map(
					(point) =>
						`${point.month}:${point.utilizationPercent ?? ''}:${point.benchCost ?? ''}`
				)
				.join(',')
		);
		expect(parseChartPoints(raw)).toEqual(
			model.trend.map((point) => ({
				month: point.month,
				utilizationPercent: point.utilizationPercent,
				benchCost: point.benchCost,
			}))
		);

		// The series actually renders — bars for the bench, one utilization line.
		await expect(chart).toContainText('Bench Cost');
		await expect(chart).toContainText('Utilization');
		await expect(chart.locator('.recharts-line-curve')).toHaveCount(1);
		const bars = await chart.locator('.recharts-bar-rectangle').count();
		expect(bars).toBeGreaterThan(0);

		observed.trendPage = {
			months: model.trend.map((point) => point.month),
			dataPoints: raw,
			bars,
		};
	});

	// ─── #298: department column, filter and summary table ──────────────

	test('the payload carries each row’s raw department and the month’s derived rollup', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		// Every row carries its raw directory value — the payload never holds
		// the page's "Unassigned" label, only null for an unset department.
		for (const row of api.rows) {
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === row.employee_code
			)!;
			expect(row.department, row.employee_code).toBe(
				employee.department || null
			);
		}

		// The rollup equals the independent derivation, order included: names
		// ascending, the unset bucket last.
		expect(api.departments).toEqual(
			model.departments.map((summary) => ({
				department: summary.department,
				headcount: summary.headcount,
				capacity_weighted_utilization: summary.utilizationPercent,
				logged_hours: summary.loggedHours,
				capacity_hours: summary.capacityHours,
				bench_cost: summary.benchCost,
				no_logged_count: summary.noLoggedCount,
			}))
		);
		expect(api.departments.length).toBeGreaterThan(2);
		expect(api.departments[api.departments.length - 1].department).toBeNull();

		// The buckets partition the month's roster: headcounts and hours sum to
		// the derived team figures, cost to the priced rows' bench.
		expect(
			api.departments.reduce((sum, summary) => sum + summary.headcount, 0)
		).toBe(model.rows.size);
		expect(
			round2(
				api.departments.reduce(
					(sum, summary) => sum + summary.capacity_hours,
					0
				)
			)
		).toBe(
			round2(
				[...model.rows.values()].reduce(
					(sum, row) => sum + row.capacityHours,
					0
				)
			)
		);
		expect(
			round2(
				api.departments.reduce(
					(sum, summary) => sum + (summary.bench_cost ?? 0),
					0
				)
			)
		).toBe(
			round2(
				[...model.rows.values()]
					.filter((row) => row.costStatus === 'priced')
					.reduce((sum, row) => sum + (row.benchCost ?? 0), 0)
			)
		);

		// The fixtures' two departments carry the shapes they were seeded for:
		// Engineering is all under-band with nothing unlogged; Operations holds
		// the no-log members and reaches the over band.
		const januaryCodes = codesOfRows(model.rows);
		const engineering = api.departments.find(
			(summary) => summary.department === UTILIZATION_DEPARTMENTS.engineering
		)!;
		const operations = api.departments.find(
			(summary) => summary.department === UTILIZATION_DEPARTMENTS.operations
		)!;
		const engineeringCodes = codesWithDepartment(
			UTILIZATION_DEPARTMENTS.engineering,
			januaryCodes
		);
		const operationsCodes = codesWithDepartment(
			UTILIZATION_DEPARTMENTS.operations,
			januaryCodes
		);
		expect(engineering.headcount).toBe(engineeringCodes.length);
		expect(engineeringCodes.length).toBeGreaterThan(1);
		expect(engineering.no_logged_count).toBe(0);
		expect(operations.headcount).toBe(operationsCodes.length);
		expect(operationsCodes.length).toBeGreaterThan(1);
		expect(operations.no_logged_count).toBeGreaterThan(0);
		const bandsOfOperations = operationsCodes.map(
			(code) =>
				model.rows.get(
					model.employees.find((row) => row.employee_id === code)!.id
				)!.utilizationBand
		);
		expect(bandsOfOperations).toContain('under');
		expect(bandsOfOperations).toContain('healthy');
		expect(bandsOfOperations).toContain('over');

		// The rollup describes the month: the band filter narrows the grid only.
		const under = await fetchMonth(request, MONTH, 'under');
		expect(under.rows.length).toBeLessThan(api.rows.length);
		expect(under.departments).toEqual(api.departments);

		observed.departments = {
			month: MONTH,
			departments: api.departments.map((summary) => ({
				department: summary.department,
				headcount: summary.headcount,
				utilization: summary.capacity_weighted_utilization,
				logged: summary.logged_hours,
				capacity: summary.capacity_hours,
				bench: summary.bench_cost,
				noLogged: summary.no_logged_count,
			})),
			engineering: engineeringCodes,
			operations: operationsCodes,
		};
	});

	test('the page shows the department column and the summary table drives the grid filter', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const januaryCodes = codesOfRows(model.rows);
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			januaryCodes.length
		);

		// The column: both the summary table and the grid carry it. (The scoped
		// assertion keeps the two name-identical headers apart.)
		expect(
			await page
				.getByRole('columnheader', { name: 'Department', exact: true })
				.count()
		).toBe(2);
		await expect(
			page
				.getByTestId('department-summary')
				.getByRole('columnheader', { name: 'Department', exact: true })
		).toBeVisible();
		const renderedRows = await readRows(page);
		for (const rendered of renderedRows) {
			const employee = model.employees.find(
				(row) => row.employee_id === rendered.code
			)!;
			expect(rendered.department, rendered.code).toBe(
				employee.department || 'Unassigned'
			);
		}
		expect(renderedRows.some((row) => row.department === 'Unassigned')).toBe(
			true
		);
		expect(
			renderedRows.some(
				(row) => row.department === UTILIZATION_DEPARTMENTS.operations
			)
		).toBe(true);

		// The summary table: one row per derived department, in the derived
		// order, with the derived figures and the same label rule.
		const summaries = await readDepartmentSummary(page);
		expect(summaries.map((summary) => summary.department)).toEqual(
			model.departments.map((summary) => summary.department ?? '')
		);
		expect(summaries.map((summary) => summary.selected)).toEqual(
			model.departments.map(() => 'false')
		);
		model.departments.forEach((derived, index) => {
			const rendered = summaries[index];
			expect(rendered.label).toBe(derived.department ?? 'Unassigned');
			expect(rendered.headcount).toBe(String(derived.headcount));
			expect(rendered.utilization).toBe(
				derived.utilizationPercent === null
					? '—'
					: `${number2.format(derived.utilizationPercent)}%`
			);
			expect(rendered.logged).toBe(number2.format(derived.loggedHours));
			expect(rendered.capacity).toBe(number2.format(derived.capacityHours));
			expect(rendered.noLogged).toBe(String(derived.noLoggedCount));
			// Currency carries the sign ahead of the ₹; compare the magnitude,
			// like the grid's bench assertions.
			if (derived.benchCost === null) {
				expect(rendered.bench).toBe('—');
			} else {
				expect(rendered.bench).toContain(
					number2.format(Math.abs(derived.benchCost))
				);
			}
		});

		// The control lists All + the month's departments (unset as
		// "Unassigned"); picking one narrows the grid, picking All clears it.
		const operationsCodes = codesWithDepartment(
			UTILIZATION_DEPARTMENTS.operations,
			januaryCodes
		);
		const options = await openDepartmentOptions(page);
		expect(await options.getByRole('button').allTextContents()).toEqual([
			'All departments',
			...model.departments.map((summary) => summary.department ?? 'Unassigned'),
		]);
		await options
			.getByRole('button', {
				name: UTILIZATION_DEPARTMENTS.operations,
				exact: true,
			})
			.click();
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			operationsCodes.length
		);
		expect((await readRows(page)).map((row) => row.code).sort()).toEqual(
			operationsCodes
		);
		await expect(departmentControl(page)).toContainText(
			UTILIZATION_DEPARTMENTS.operations
		);
		await openDepartmentOptions(page);
		await options
			.getByRole('button', { name: 'All departments', exact: true })
			.click();
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			januaryCodes.length
		);

		// Clicking a summary row applies its department; clicking the selected
		// row again clears it.
		const operationsRow = page.locator(
			`[data-testid="department-summary-row"][data-department="${UTILIZATION_DEPARTMENTS.operations}"]`
		);
		await operationsRow.click();
		await expect(operationsRow).toHaveAttribute('data-selected', 'true');
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			operationsCodes.length
		);
		expect((await readRows(page)).map((row) => row.code).sort()).toEqual(
			operationsCodes
		);
		await operationsRow.click();
		await expect(operationsRow).toHaveAttribute('data-selected', 'false');
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			januaryCodes.length
		);

		// It composes with the band and the search: Operations, the Under flag
		// and the search box all narrow the same grid, and the summary block —
		// the month's rollup — does not move.
		const operationsUnderCodes = operationsCodes.filter((code) => {
			const employee = model.employees.find((row) => row.employee_id === code)!;
			return model.rows.get(employee.id)!.utilizationBand === 'under';
		});
		expect(operationsUnderCodes.length).toBeGreaterThan(0);
		expect(operationsUnderCodes.length).toBeLessThan(operationsCodes.length);
		await operationsRow.click();
		await page
			.getByRole('button', { name: 'Under (< 80%)', exact: true })
			.click();
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			operationsUnderCodes.length
		);
		expect((await readRows(page)).map((row) => row.code).sort()).toEqual(
			operationsUnderCodes
		);
		// The rollup is the month's, not the filter's: the band filter leaves
		// the summary block's figures untouched (the selected row keeps its
		// state).
		const afterBand = await readDepartmentSummary(page);
		expect(afterBand.length).toBe(summaries.length);
		afterBand.forEach((row, index) => {
			expect({ ...row, selected: '' }).toEqual({
				...summaries[index],
				selected: '',
			});
		});
		expect(
			afterBand.find(
				(row) => row.department === UTILIZATION_DEPARTMENTS.operations
			)?.selected
		).toBe('true');

		// The search narrows within the composed set; a code outside it (in the
		// department but over the band) empties the grid, and the reset clears
		// department, band and search alike.
		await page
			.getByLabel('Search by employee name or code')
			.fill(operationsUnderCodes[0]);
		await expect(page.getByTestId('utilization-row')).toHaveCount(1);
		expect((await readRows(page))[0].code).toBe(operationsUnderCodes[0]);
		await page
			.getByLabel('Search by employee name or code')
			.fill(utilizationMemberForPlan('basisRateFullMonth').code);
		await expect(page.getByTestId('utilization-row')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Clear filters', exact: true })
		).toBeVisible();
		await page
			.getByRole('button', { name: 'Clear filters', exact: true })
			.click();
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			januaryCodes.length
		);
		await expect(operationsRow).toHaveAttribute('data-selected', 'false');

		// The month owns the rollup: switching re-derives the summary from the
		// new month's roster and the department filter narrows the new grid.
		// February is seeded with evidence (so it is a selectable month) and
		// its roster is a strict subset of January's Operations members.
		await operationsRow.click();
		const februaryRoster = deriveMonth(model.employees, '2019-02').rosterCodes;
		await selectMonth(page, monthLabel('2019-02'));
		await expect(departmentControl(page)).toContainText(
			UTILIZATION_DEPARTMENTS.operations
		);
		const februaryOperations = codesWithDepartment(
			UTILIZATION_DEPARTMENTS.operations,
			februaryRoster
		);
		expect(februaryOperations.length).toBeGreaterThan(0);
		expect(februaryOperations.length).toBeLessThan(operationsCodes.length);
		await expect(page.getByTestId('utilization-row')).toHaveCount(
			februaryOperations.length
		);
		expect((await readRows(page)).map((row) => row.code).sort()).toEqual(
			februaryOperations
		);
		// The new month's rollup's headcounts partition its derived roster.
		const februaryHeadcounts = new Map<string, number>();
		for (const code of februaryRoster) {
			const employee = model.employees.find((row) => row.employee_id === code)!;
			const label = employee.department || 'Unassigned';
			februaryHeadcounts.set(label, (februaryHeadcounts.get(label) ?? 0) + 1);
		}
		const februarySummaries = await readDepartmentSummary(page);
		expect(februarySummaries.map((row) => row.label).sort()).toEqual(
			[...februaryHeadcounts.keys()].sort()
		);
		for (const row of februarySummaries) {
			expect(row.headcount, row.label).toBe(
				String(februaryHeadcounts.get(row.label))
			);
		}
		expect(
			februarySummaries.reduce((sum, row) => sum + Number(row.headcount), 0)
		).toBe(februaryRoster.length);

		observed.departmentsPage = {
			month: MONTH,
			summaryRows: summaries.length,
			unsetRows: renderedRows.filter((row) => row.department === 'Unassigned')
				.length,
			operations: {
				all: operationsCodes.length,
				under: operationsUnderCodes.length,
			},
			operationsSummary: summaries.find(
				(row) => row.label === UTILIZATION_DEPARTMENTS.operations
			),
			februarySummaryRows: februarySummaries.length,
		};
	});

	test('the projects route groups the month’s Logged Hours by project with top N, Other and No project', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		// Every roster row's breakdown equals the raw-row derivation and foots
		// to the row's Logged Hours — top N + Other + No project are the whole
		// month, with No project never merged into Other.
		const breakdownByCode = new Map<string, ApiBreakdown>();
		for (const row of api.rows) {
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === row.employee_code
			)!;
			const derived = model.breakdowns.get(employee.id)!;
			const response = await request.get(
				`/api/reports/employee-utilization/projects?month=${MONTH}&employee_id=${employee.id}`
			);
			expect(response.status(), row.employee_code).toBe(200);
			const body = await response.json();
			expect(body.success, row.employee_code).toBe(true);
			const breakdown = body.data as ApiBreakdown;
			breakdownByCode.set(row.employee_code, breakdown);

			expect(breakdown.month).toBe(MONTH);
			expect(breakdown.employee_id).toBe(employee.id);
			expect(breakdown.employee_code).toBe(row.employee_code);
			expect(breakdown.employee_name).toBe(row.employee_name);
			expect(breakdown.top_n).toBe(PROJECT_TOP_N);
			expect(breakdown.projects).toEqual(derived.projects.map(bucketPayload));
			expect(breakdown.other).toEqual(derived.other);
			expect(breakdown.no_project).toEqual(
				derived.noProject ? bucketPayload(derived.noProject) : null
			);

			// Footing: the buckets sum to the row's Logged Hours.
			expect(breakdown.logged_hours, row.employee_code).toBe(row.logged_hours);
			const summed = round2(
				[
					...breakdown.projects,
					...(breakdown.no_project ? [breakdown.no_project] : []),
				].reduce((sum, bucket) => sum + bucket.hours, 0) + breakdown.other.hours
			);
			expect(summed, row.employee_code).toBe(row.logged_hours);
		}

		// The split fixture: six projects in the month (alpha under two
		// activities) plus the project-less day. Hours 64/40/32/24/16/8 put
		// zeta beyond the top five and its 8h in Other; the project-less 8h
		// stays in No project.
		const split = utilizationMemberForPlan('projectSplit');
		const splitId = model.employees.find(
			(row) => row.employee_id === split.code
		)!.id;
		const splitDerived = model.breakdowns.get(splitId)!;
		const splitPayload = breakdownByCode.get(split.code)!;
		const splitRow = api.rows.find((row) => row.employee_code === split.code)!;
		expect(splitRow.logged_hours).toBe(192);
		expect(splitDerived.projects.map((bucket) => bucket.hours)).toEqual([
			64, 40, 32, 24, 16,
		]);
		expect(splitDerived.other).toEqual({ hours: 8, project_count: 1 });
		expect(splitDerived.noProject!.hours).toBe(8);
		expect(splitPayload.projects.length).toBe(PROJECT_TOP_N);
		expect(splitPayload.projects.map((bucket) => bucket.project_id)).toEqual(
			(['alpha', 'beta', 'gamma', 'delta', 'epsilon'] as const).map((key) =>
				model.projectIdByCode.get(UTILIZATION_PROJECTS[key].code)
			)
		);
		expect(splitPayload.other).toEqual({ hours: 8, project_count: 1 });
		expect(splitPayload.logged_hours).toBe(192);

		const alpha = splitPayload.projects[0];
		expect(alpha.project_code).toBe(UTILIZATION_PROJECTS.alpha.code);
		expect(alpha.project_name).toBe(UTILIZATION_PROJECTS.alpha.title);
		expect(alpha.client_name).toBe(UTILIZATION_PROJECTS.alpha.client);
		expect(alpha.activities).toEqual([
			{
				activity_name: 'E2E Piping Analysis',
				discipline_name: 'Piping',
				hours: 48,
			},
			{
				activity_name: 'E2E 3D Modeling',
				discipline_name: 'Piping',
				hours: 16,
			},
		]);
		// Beta carries no `project_title`: the display name falls back to the
		// project's `name`.
		expect(splitPayload.projects[1].project_name).toBe(
			UTILIZATION_PROJECTS.beta.name
		);
		expect(splitPayload.projects[1].activities).toEqual([
			{
				activity_name: 'E2E Stress Review',
				discipline_name: 'Stress',
				hours: 40,
			},
		]);
		// A missing discipline stays null — never an invented label.
		expect(splitPayload.projects[3].activities).toEqual([
			{ activity_name: 'E2E QA Review', discipline_name: null, hours: 24 },
		]);
		expect(splitPayload.no_project).toMatchObject({
			project_id: null,
			project_code: null,
			project_name: null,
			client_name: null,
			hours: 8,
		});
		expect(splitPayload.no_project!.activities).toEqual([
			{ activity_name: 'E2E Internal Work', discipline_name: null, hours: 8 },
		]);

		// A member whose month is project-less only: no project groups, an
		// empty Other, and the whole total in the explicit No-project bucket.
		const projectless = utilizationMemberForPlan('payrollWithHours');
		const projectlessRow = api.rows.find(
			(row) => row.employee_code === projectless.code
		)!;
		const projectlessPayload = breakdownByCode.get(projectless.code)!;
		expect(projectlessPayload.projects).toEqual([]);
		expect(projectlessPayload.other).toEqual({ hours: 0, project_count: 0 });
		expect(projectlessPayload.no_project!.hours).toBe(
			projectlessRow.logged_hours
		);
		expect(projectlessPayload.no_project!.project_id).toBeNull();
		expect(projectlessPayload.no_project!.activities.length).toBeGreaterThan(0);

		// A zero-Logged-Hours member: an empty breakdown, never a 404 — the
		// route answers for the employee, the month is just empty.
		const idle = utilizationMemberForPlan('payrollIdle');
		const idlePayload = breakdownByCode.get(idle.code)!;
		expect(idlePayload.logged_hours).toBe(0);
		expect(idlePayload.projects).toEqual([]);
		expect(idlePayload.other).toEqual({ hours: 0, project_count: 0 });
		expect(idlePayload.no_project).toBeNull();

		// Param validation: a malformed month/employee is a 400, an unknown
		// employee a 404.
		const badMonth = await request.get(
			`/api/reports/employee-utilization/projects?month=2019-13&employee_id=${splitId}`
		);
		expect(badMonth.status()).toBe(400);
		const missingEmployee = await request.get(
			`/api/reports/employee-utilization/projects?month=${MONTH}`
		);
		expect(missingEmployee.status()).toBe(400);
		const badEmployee = await request.get(
			`/api/reports/employee-utilization/projects?month=${MONTH}&employee_id=abc`
		);
		expect(badEmployee.status()).toBe(400);
		const unknownEmployee = await request.get(
			`/api/reports/employee-utilization/projects?month=${MONTH}&employee_id=2147483646`
		);
		expect(unknownEmployee.status()).toBe(404);

		observed.breakdown = {
			month: MONTH,
			rowsChecked: api.rows.length,
			split: {
				projects: splitPayload.projects.map((bucket) => ({
					project: bucket.project_id,
					name: bucket.project_name,
					hours: bucket.hours,
					activities: bucket.activities.length,
				})),
				other: splitPayload.other,
				noProject: splitPayload.no_project?.hours ?? null,
				loggedHours: splitPayload.logged_hours,
			},
			projectlessOnly: {
				code: projectless.code,
				noProjectHours: projectlessPayload.no_project?.hours ?? null,
				rowLoggedHours: projectlessRow.logged_hours,
			},
			validation: {
				badMonth: badMonth.status(),
				missingEmployee: missingEmployee.status(),
				badEmployee: badEmployee.status(),
				unknownEmployee: unknownEmployee.status(),
			},
		};
	});

	test('expanding a row shows the derived breakdown, the No project bucket and the month’s timesheet link', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const split = utilizationMemberForPlan('projectSplit');
		const splitId = model.employees.find(
			(row) => row.employee_id === split.code
		)!.id;
		const splitDerived = model.breakdowns.get(splitId)!;
		const splitRow = page.locator(
			`[data-testid="utilization-row"][data-employee-code="${split.code}"]`
		);
		const splitExpand = splitRow.getByTestId('row-expand');
		const splitPanel = page.locator(
			`[data-testid="project-breakdown"][data-employee-code="${split.code}"]`
		);

		// Collapsed by default: no control state, no panel, no request made.
		await expect(splitExpand).toHaveAttribute('aria-expanded', 'false');
		await expect(splitPanel).toHaveCount(0);

		await splitExpand.click();
		await expect(splitExpand).toHaveAttribute('aria-expanded', 'true');
		await expect(splitPanel.getByTestId('project-row')).toHaveCount(
			splitDerived.projects.length
		);
		const rendered = await readBreakdown(page);
		expect(rendered.employeeCode).toBe(split.code);
		expect(Number(rendered.loggedHours)).toBe(splitDerived.loggedHours);
		// The panel's footing total is the row's rendered Logged Hours.
		const splitGridRow = (await readRows(page)).find(
			(row) => row.code === split.code
		)!;
		expect(splitGridRow.logged).toBe(number2.format(splitDerived.loggedHours));

		expect(rendered.projects.map((bucket) => Number(bucket.project))).toEqual(
			splitDerived.projects.map((bucket) => bucket.projectId)
		);
		expect(rendered.projects.map((bucket) => bucket.name)).toEqual(
			splitDerived.projects.map((bucket) => bucket.projectName)
		);
		expect(rendered.projects.map((bucket) => Number(bucket.rawHours))).toEqual(
			splitDerived.projects.map((bucket) => bucket.hours)
		);
		expect(rendered.projects.map((bucket) => bucket.hours)).toEqual(
			splitDerived.projects.map((bucket) => number2.format(bucket.hours))
		);
		splitDerived.projects.forEach((bucket, index) => {
			expect(
				rendered.projects[index].activities.map((activity) => ({
					activity: activity.activity,
					discipline: activity.discipline,
					hours: activity.hours,
				})),
				bucket.projectCode ?? ''
			).toEqual(
				bucket.activities.map((activity) => ({
					activity: activity.activity,
					discipline: activity.discipline ?? '',
					hours: number2.format(activity.hours),
				}))
			);
		});

		// Other: the spilled project's hours and count; No project is separate
		// and explicit, with its own detail.
		expect(rendered.other).not.toBeNull();
		expect(Number(rendered.other!.rawHours)).toBe(splitDerived.other.hours);
		expect(rendered.other!.hours).toBe(
			number2.format(splitDerived.other.hours)
		);
		expect(rendered.other!.count).toBe(
			String(splitDerived.other.project_count)
		);
		expect(rendered.other!.count).toBe('1');
		expect(rendered.noProject).not.toBeNull();
		expect(rendered.noProject!.name).toBe('No project');
		expect(rendered.noProject!.project).toBe('');
		expect(Number(rendered.noProject!.rawHours)).toBe(
			splitDerived.noProject!.hours
		);
		expect(
			rendered.noProject!.activities.map((activity) => activity.activity)
		).toEqual(
			splitDerived.noProject!.activities.map((activity) => activity.activity)
		);
		expect(rendered.linkHref).toBe(
			`/reports/timesheet-report?employee_id=${splitId}&month=${MONTH}`
		);

		// Collapsing hides the panel again; the control reads collapsed.
		await splitExpand.click();
		await expect(splitExpand).toHaveAttribute('aria-expanded', 'false');
		await expect(splitPanel).toHaveCount(0);

		// A member whose month is project-less only: no project rows, no Other
		// row, the whole total in the explicit No-project bucket.
		const projectless = utilizationMemberForPlan('payrollWithHours');
		const projectlessId = model.employees.find(
			(row) => row.employee_id === projectless.code
		)!.id;
		const projectlessDerived = model.breakdowns.get(projectlessId)!;
		const projectlessRow = page.locator(
			`[data-testid="utilization-row"][data-employee-code="${projectless.code}"]`
		);
		await projectlessRow.getByTestId('row-expand').click();
		await expect(projectlessRow.getByTestId('row-expand')).toHaveAttribute(
			'aria-expanded',
			'true'
		);
		const projectlessPanel = page.locator(
			`[data-testid="project-breakdown"][data-employee-code="${projectless.code}"]`
		);
		await expect(projectlessPanel).toHaveAttribute(
			'data-logged-hours',
			String(projectlessDerived.loggedHours)
		);
		const projectlessRendered = await readBreakdown(page);
		expect(projectlessRendered.projects).toEqual([]);
		expect(projectlessRendered.other).toBeNull();
		expect(Number(projectlessRendered.noProject!.rawHours)).toBe(
			projectlessDerived.noProject!.hours
		);
		await projectlessRow.getByTestId('row-expand').click();

		// A member who logged nothing: the panel still answers, with an empty
		// zeroed breakdown — missing time is shown, not hidden.
		const idle = utilizationMemberForPlan('payrollIdle');
		const idleRow = page.locator(
			`[data-testid="utilization-row"][data-employee-code="${idle.code}"]`
		);
		await idleRow.getByTestId('row-expand').click();
		const idlePanel = page.locator(
			`[data-testid="project-breakdown"][data-employee-code="${idle.code}"]`
		);
		await expect(idlePanel).toHaveAttribute('data-logged-hours', '0');
		const idleRendered = await readBreakdown(page);
		expect(idleRendered.projects).toEqual([]);
		expect(idleRendered.other).toBeNull();
		expect(idleRendered.noProject).toBeNull();
		expect(Number(idleRendered.loggedHours)).toBe(0);
		expect(idleRendered.linkHref).toBe(
			`/reports/timesheet-report?employee_id=${
				model.employees.find((row) => row.employee_id === idle.code)!.id
			}&month=${MONTH}`
		);
		await idleRow.getByTestId('row-expand').click();

		observed.breakdownPage = {
			month: MONTH,
			split: {
				topProjects: splitDerived.projects.length,
				otherCount: rendered.other?.count ?? null,
				noProject: Number(rendered.noProject?.rawHours ?? ''),
				loggedHours: Number(rendered.loggedHours),
				link: rendered.linkHref,
			},
			projectless: {
				projects: projectlessRendered.projects.length,
				other: projectlessRendered.other,
				noProject: Number(projectlessRendered.noProject?.rawHours ?? ''),
			},
			idle: {
				loggedHours: Number(idleRendered.loggedHours),
				projects: idleRendered.projects.length,
				noProject: idleRendered.noProject,
			},
		};
	});

	test('the Excel download mirrors the month view, its disclosure and the department summary', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);
		const response = await request.get(
			`/api/reports/employee-utilization/download?month=${MONTH}`
		);
		expect(response.status(), await response.text()).toBe(200);
		expect(response.headers()['content-type']).toContain('spreadsheetml.sheet');
		expect(response.headers()['content-disposition']).toContain(
			`Utilization_${MONTH}.xlsx`
		);

		const wb = new ExcelJS.Workbook();
		// exceljs types `load` with its own ArrayBuffer-shaped Buffer; the
		// response body is a Node Buffer, which is one at runtime.
		await wb.xlsx.load(
			(await response.body()) as unknown as Parameters<typeof wb.xlsx.load>[0]
		);
		const ws = wb.getWorksheet('Utilization');
		expect(ws).toBeTruthy();
		if (!ws) throw new Error('the workbook must carry the Utilization sheet');

		// Every on-screen column is present, alongside the workbook's own
		// Sr. / Utilized Cost / Note columns.
		const table = findTable(ws, 'Sr.');
		for (const label of [
			'Employee',
			'Department',
			'Partial window',
			'Capacity (h)',
			'Logged (h)',
			monthLabel(TRAILING_MONTHS[0]),
			monthLabel(TRAILING_MONTHS[1]),
			'Utilization %',
			'Flag',
			'Monthly Cost (₹)',
			'Bench Cost (₹)',
			'Utilized Cost (₹)',
			'Note',
		]) {
			expect(table.columns.has(label)).toBe(true);
		}

		// One sheet row per payload row, in the payload's order, matched by
		// the employee code in the Employee cell.
		const sheetRows = new Map<string, number>();
		for (
			let rowNumber = table.headerRow + 1;
			rowNumber <= ws.rowCount;
			rowNumber++
		) {
			const sr = cellUnder(ws, table, rowNumber, 'Sr.').value;
			if (typeof sr !== 'number') continue;
			const employee = cellText(
				cellUnder(ws, table, rowNumber, 'Employee').value
			);
			const open = employee.lastIndexOf('(');
			if (open < 0) continue;
			sheetRows.set(employee.slice(open + 1, -1), rowNumber);
		}
		expect([...sheetRows.keys()]).toEqual(
			api.rows.map((row) => row.employee_code)
		);

		let pricedRows = 0;
		let blankRows = 0;
		for (const apiRow of api.rows) {
			const rowNumber = sheetRows.get(apiRow.employee_code);
			expect(rowNumber).toBeDefined();
			if (rowNumber === undefined) continue;
			const derived = model.rows.get(apiRow.employee_id);
			expect(derived).toBeTruthy();
			if (!derived) continue;

			expect(cellText(cellUnder(ws, table, rowNumber, 'Employee').value)).toBe(
				`${apiRow.employee_name} (${apiRow.employee_code})`
			);
			expect(
				cellText(cellUnder(ws, table, rowNumber, 'Department').value)
			).toBe(apiRow.department ?? 'Unassigned');
			expect(
				cellText(cellUnder(ws, table, rowNumber, 'Partial window').value)
			).toBe(derived.chip ?? '');
			expectFigure(
				cellUnder(ws, table, rowNumber, 'Capacity (h)'),
				apiRow.capacity_hours
			);
			expectFigure(
				cellUnder(ws, table, rowNumber, 'Logged (h)'),
				apiRow.logged_hours
			);
			// The two trailing columns: a not-employed month stays blank.
			for (const cell of apiRow.trailing.slice(0, 2)) {
				expectFigure(
					cellUnder(ws, table, rowNumber, monthLabel(cell.month)),
					cell.employed ? cell.utilization_percent : null
				);
			}
			expectFigure(
				cellUnder(ws, table, rowNumber, 'Utilization %'),
				apiRow.utilization_percent
			);
			expect(cellText(cellUnder(ws, table, rowNumber, 'Flag').value)).toBe(
				expectedFlagText(
					apiRow.state,
					apiRow.utilization_band,
					apiRow.chronic_under
				)
			);
			expectFigure(
				cellUnder(ws, table, rowNumber, 'Monthly Cost (₹)'),
				apiRow.monthly_cost
			);
			expectFigure(
				cellUnder(ws, table, rowNumber, 'Utilized Cost (₹)'),
				apiRow.fractional_cost
			);
			expectFigure(
				cellUnder(ws, table, rowNumber, 'Bench Cost (₹)'),
				apiRow.bench_cost
			);
			expect(cellText(cellUnder(ws, table, rowNumber, 'Note').value)).toBe(
				apiRow.cost_status === 'no-profile' ? 'No profile' : ''
			);

			const monthly = cellUnder(ws, table, rowNumber, 'Monthly Cost (₹)').value;
			const used = cellUnder(ws, table, rowNumber, 'Utilized Cost (₹)').value;
			const bench = cellUnder(ws, table, rowNumber, 'Bench Cost (₹)').value;
			if (apiRow.cost_status === 'no-profile') {
				// Blank, never zero.
				expect([monthly, used, bench]).toEqual([null, null, null]);
				blankRows++;
			} else {
				expect(typeof monthly).toBe('number');
				expect(typeof used).toBe('number');
				expect(typeof bench).toBe('number');
				expect((used as number) + (bench as number)).toBeCloseTo(
					monthly as number,
					2
				);
				pricedRows++;
			}
		}
		expect(pricedRows).toBe(
			[...model.rows.values()].filter((row) => row.costStatus === 'priced')
				.length
		);
		expect(blankRows).toBe(
			[...model.rows.values()].filter((row) => row.costStatus === 'no-profile')
				.length
		);

		// The totals footer equals the payload's totals and foots the same way.
		let totalsRow = 0;
		for (
			let rowNumber = table.headerRow + 1;
			rowNumber <= ws.rowCount;
			rowNumber++
		) {
			if (
				cellText(ws.getRow(rowNumber).getCell(1).value).startsWith('Total (')
			) {
				totalsRow = rowNumber;
				break;
			}
		}
		expect(totalsRow).toBeGreaterThan(0);
		expectFigure(
			cellUnder(ws, table, totalsRow, 'Capacity (h)'),
			api.totals.capacity_hours
		);
		expectFigure(
			cellUnder(ws, table, totalsRow, 'Logged (h)'),
			api.totals.logged_hours
		);
		expectFigure(
			cellUnder(ws, table, totalsRow, 'Monthly Cost (₹)'),
			api.totals.monthly_cost
		);
		expectFigure(
			cellUnder(ws, table, totalsRow, 'Utilized Cost (₹)'),
			api.totals.fractional_cost
		);
		expectFigure(
			cellUnder(ws, table, totalsRow, 'Bench Cost (₹)'),
			api.totals.bench_cost
		);
		const totalsMonthly = cellUnder(
			ws,
			table,
			totalsRow,
			'Monthly Cost (₹)'
		).value;
		const totalsUsed = cellUnder(
			ws,
			table,
			totalsRow,
			'Utilized Cost (₹)'
		).value;
		const totalsBench = cellUnder(ws, table, totalsRow, 'Bench Cost (₹)').value;
		expect(typeof totalsMonthly).toBe('number');
		expect(typeof totalsUsed).toBe('number');
		expect(typeof totalsBench).toBe('number');
		expect((totalsUsed as number) + (totalsBench as number)).toBeCloseTo(
			totalsMonthly as number,
			2
		);

		// The disclosure section: the payload's counts-by-Employee-Type wording.
		const text = sheetText(ws);
		const disclosure = api.disclosure;
		expect(disclosure).not.toBeNull();
		if (disclosure) {
			expect(disclosure.excluded_count).toBeGreaterThan(0);
			const noun = disclosure.excluded_count === 1 ? 'employee' : 'employees';
			expect(text).toContain('Excluded from the report');
			expect(text).toContain(
				`${disclosure.excluded_count} ${noun} excluded of ${disclosure.considered_count} considered for the month, leaving ${disclosure.roster_count} on the roster.`
			);
			for (const bucket of disclosure.buckets) {
				expect(text).toContain(
					`${bucket.count} ${bucket.value === null ? 'unset' : bucket.value}`
				);
			}
		}
		if (api.totals.no_logged_count > 0) {
			expect(text).toContain(
				`${api.totals.no_logged_count} ${
					api.totals.no_logged_count === 1 ? 'employee' : 'employees'
				} with no time logged in ${api.month_label}.`
			);
		}

		// The department summary table: one row per payload department, in
		// payload order, carrying the rollup's figures.
		const deptTable = findTable(ws, 'Department');
		const sheetDepartments = new Map<string, number>();
		for (
			let rowNumber = deptTable.headerRow + 1;
			rowNumber <= ws.rowCount;
			rowNumber++
		) {
			const headcount = cellUnder(ws, deptTable, rowNumber, 'Headcount').value;
			if (typeof headcount !== 'number') continue;
			sheetDepartments.set(
				cellText(cellUnder(ws, deptTable, rowNumber, 'Department').value),
				rowNumber
			);
		}
		expect([...sheetDepartments.keys()]).toEqual(
			api.departments.map((summary) => summary.department ?? 'Unassigned')
		);
		for (const summary of api.departments) {
			const rowNumber = sheetDepartments.get(
				summary.department ?? 'Unassigned'
			);
			expect(rowNumber).toBeDefined();
			if (rowNumber === undefined) continue;
			expect(cellUnder(ws, deptTable, rowNumber, 'Headcount').value).toBe(
				summary.headcount
			);
			expectFigure(
				cellUnder(ws, deptTable, rowNumber, 'Utilization %'),
				summary.capacity_weighted_utilization
			);
			expectFigure(
				cellUnder(ws, deptTable, rowNumber, 'Logged (h)'),
				summary.logged_hours
			);
			expectFigure(
				cellUnder(ws, deptTable, rowNumber, 'Capacity (h)'),
				summary.capacity_hours
			);
			expectFigure(
				cellUnder(ws, deptTable, rowNumber, 'Bench Cost (₹)'),
				summary.bench_cost
			);
			expect(cellUnder(ws, deptTable, rowNumber, 'No time logged').value).toBe(
				summary.no_logged_count
			);
		}

		observed.excel = {
			month: MONTH,
			headers: [...table.columns.keys()],
			rows: sheetRows.size,
			pricedRows,
			blankRows,
			disclosure: disclosure
				? {
						excluded: disclosure.excluded_count,
						considered: disclosure.considered_count,
						roster: disclosure.roster_count,
						buckets: disclosure.buckets.map((bucket) => ({
							value: bucket.value,
							count: bucket.count,
						})),
					}
				: null,
			departments: api.departments.map((summary) => ({
				department: summary.department,
				headcount: summary.headcount,
				utilizationPercent: summary.capacity_weighted_utilization,
				loggedHours: summary.logged_hours,
				capacityHours: summary.capacity_hours,
				benchCost: summary.bench_cost,
				noLoggedCount: summary.no_logged_count,
			})),
			totals: {
				capacityHours: api.totals.capacity_hours,
				loggedHours: api.totals.logged_hours,
				monthlyCost: api.totals.monthly_cost,
				fractionalCost: api.totals.fractional_cost,
				benchCost: api.totals.bench_cost,
			},
		};
	});

	test('the export button enables with a month roster and disables on an empty payload', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);
		const exportButton = page.getByRole('button', { name: /Export Excel/ });
		await expect(exportButton).toBeEnabled();
		// The button's real wiring: the click downloads the route's workbook.
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			exportButton.click(),
		]);
		expect(download.suggestedFilename()).toBe(`Utilization_${MONTH}.xlsx`);

		// A month with no roster rows disables the export — the unchanged rule.
		await page.route(/\/api\/reports\/employee-utilization\?/, (route) => {
			const month =
				new URL(route.request().url()).searchParams.get('month') ?? '';
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					data: {
						month,
						month_label: monthLabel(month),
						flag: null,
						rows: [],
						totals: {
							employee_count: 0,
							no_logged_count: 0,
							capacity_hours: 0,
							logged_hours: 0,
							monthly_cost: null,
							fractional_cost: null,
							bench_cost: null,
						},
						trend: [],
						disclosure: null,
						departments: [],
					},
				}),
			});
		});
		const dataRequest = page.waitForRequest(
			/\/api\/reports\/employee-utilization\?month=\d{4}-\d{2}/
		);
		await page.goto('/reports/employee-utilization');
		const requestedMonth = new URL((await dataRequest).url()).searchParams.get(
			'month'
		);
		expect(requestedMonth).toMatch(/^\d{4}-\d{2}$/);
		await expect(
			page.getByText(
				`No employees found for ${monthLabel(String(requestedMonth))}.`
			)
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: /Export Excel/ })
		).toBeDisabled();

		observed.excelExportState = {
			withRows: 'enabled',
			downloadName: `Utilization_${MONTH}.xlsx`,
			emptyPayloadMonth: requestedMonth,
			emptyPayload: 'disabled',
		};
	});

	test('the fixtures leave no residue and the run writes its artifact', async () => {
		const owned = await rows<{ id: number }>(
			`SELECT id FROM employees WHERE employee_id LIKE 'E2E-UTIL-%'`
		);
		const ownedIds = owned.map((row) => row.id);
		expect(ownedIds.length).toBe(UTILIZATION_ROSTER.length);
		const placeholders = ownedIds.map(() => '?').join(', ');

		const removed = await cleanupUtilizationFixtures();
		expect(removed).toBe(ownedIds.length);

		const count = async (sql: string, params: unknown[] = []) => {
			const [row] = await rows<{ n: number | string }>(sql, params);
			return Number(row.n);
		};
		const residue = {
			employees: await count(
				`SELECT COUNT(*) AS n FROM employees WHERE employee_id LIKE 'E2E-UTIL-%'`
			),
			attendance: ownedIds.length
				? await count(
						`SELECT COUNT(*) AS n FROM employee_attendance WHERE employee_id IN (${placeholders})`,
						ownedIds
					)
				: 0,
			assignments: await count(
				`SELECT COUNT(*) AS n FROM user_activity_assignments WHERE id LIKE 'e2e-util-%'`
			),
			profiles: ownedIds.length
				? await count(
						`SELECT COUNT(*) AS n FROM employee_salary_profile WHERE employee_id IN (${placeholders})`,
						ownedIds
					)
				: 0,
			users: await count(`SELECT COUNT(*) AS n FROM users WHERE username = ?`, [
				'e2e_util_user',
			]),
			holidays: await count(
				`SELECT COUNT(*) AS n FROM holiday_master WHERE name = ?`,
				[UTILIZATION_OPTIONAL_HOLIDAY.name]
			),
			projects: await count(
				`SELECT COUNT(*) AS n FROM projects WHERE project_code LIKE 'E2E-UTIL-P%'`
			),
		};
		expect(residue).toEqual({
			employees: 0,
			attendance: 0,
			assignments: 0,
			profiles: 0,
			users: 0,
			holidays: 0,
			projects: 0,
		});

		writeArtifact('employee-utilization', {
			month: MONTH,
			laterMonth: LATER_MONTH,
			derivation: {
				windowStart:
					'joining_date → hire_date → first attendance → first Logged Hours → open if active, unresolved otherwise',
				windowEnd:
					'exit_date → last attendance → last Logged Hours → open if active, unresolved otherwise',
				intersects:
					'(start == null || start <= monthEnd) && (end == null || end >= monthStart)',
				disclosure:
					'live employees whose resolved window intersects the month, excluding Employee Type ≠ Payroll, bucketed by Employee Type value',
				capacity:
					'working days inside the window × 8h; a working day is not a weekly off (Sundays + 2nd/4th Saturdays, else the attendance is_weekly_off flag) and not an active non-optional holiday; leave 0h, HD 4h, everything else (incl. H on an optional holiday) 8h',
				monthlyCost:
					'round2(CTC × employed working days ÷ the month’s working days) over the Capacity calendar; full-month windows reproduce the full CTC',
				rate: 'CTC ÷ Basis Hours, Basis Hours = the month’s basis days (non-Sunday days minus active non-optional holidays; 2nd/4th Saturdays stay in) × the profile’s std_hours_per_day (default 8) — a fully logged month pays the CTC',
				footing:
					'fractional = round2(rate × logged); bench = round2(monthly − fractional); sum foots per row and in totals; no covering profile → null costs, never zero',
				partialChip:
					'is_partial_window when the window does not cover the month; the chip names the window clamped to the month',
				noTimeLogged:
					'state = no_time_logged when the month’s Logged Hours are 0; percent, band and the band-then-bench position are unchanged; totals.no_logged_count counts them over the same flag-filtered row set as employee_count',
				trailing:
					'three cells (viewed month and the two before it, oldest first): employed = the resolved window intersects that month, utilization_percent = the same per-month pipeline’s value (null when the month credits no capacity); blank cells are not-employed months',
				chronicUnder:
					'at least two employed months in the window and every employed month below 80 with a real percent (a null percent never counts)',
				trend:
					'six months ending at the viewed month, oldest first: capacity-weighted utilization round2(Σ logged ÷ Σ capacity × 100) over each month’s roster rows (null when no capacity) and the priced rows’ Bench Cost total (null when none is priced) — unfiltered by the flag band',
				department:
					'employees.department (free text; "" normalizes to null) rides on every row and never carries the page’s "Unassigned" label; the payload’s departments rollup has one entry per department present in the month’s roster rows (unset null, sorted last, names ascending) with headcount, capacity-weighted utilization round2(Σ logged ÷ Σ capacity × 100), logged/capacity hours, priced Bench Cost sum (null when none priced) and the zero-Logged-Hours count — computed before the flag filter; the page labels null "Unassigned" and filters the grid client-side from the summary rows or the Department control (composing with month/band/search)',
				projectBreakdown:
					'the lazily fetched projects route: every non-cancelled assignment resolved through the shared Logged Hours rule and summed for the month with the canonical reader, bucketed by project (activity/discipline pairs summed, hours descending); project groups sorted hours descending (ties by project id ascending), top N = 5 plus other (hours + spilled project count); project-less hours — or a project id the projects rows do not resolve — stay in no_project, never merged into other; logged_hours is the buckets’ sum and must equal the row’s Logged Hours; the display name is project_title → projects.name → project_code → Project #<id>',
			},
			calendar: {
				month: MONTH,
				daysInMonth: DAYS_IN_MONTH,
				monthWorkingDays: model.rows.get(
					model.employees.find(
						(row) =>
							row.employee_id === utilizationMemberForPlan('payrollIdle').code
					)!.id
				)!.monthWorkingDays,
				optionalHolidays: model.calendar.optionalHolidays,
				nonOptionalHolidays: [...model.calendar.nonOptionalHolidays],
			},
			seeded: {
				employees: UTILIZATION_ROSTER.length,
				plans: UTILIZATION_ROSTER.map((member) => member.plan),
			},
			derived: {
				rosterCount: model.month.rosterCodes.length,
				laterRosterCount: model.laterMonth.rosterCodes.length,
				noLoggedCount: [...model.rows.values()].filter(
					(derived) => derived.loggedHours === 0
				).length,
				disclosureBuckets: model.month.buckets,
				rows: model.employees
					.filter((employee) => model.rows.has(employee.id))
					.map((employee) => {
						const derived = model.rows.get(employee.id)!;
						const window = model.windows.get(employee.id)!;
						return {
							code: employee.employee_id,
							windowStart: window.start,
							windowEnd: window.end,
							department: employee.department || null,
							capacityHours: derived.capacityHours,
							loggedHours: derived.loggedHours,
							utilizationPercent: derived.utilizationPercent,
							state: derived.state,
							basisDays: derived.basisDays,
							rate: derived.rate === null ? null : round2(derived.rate),
							costStatus: derived.costStatus,
							monthlyCost: derived.monthlyCost,
							fractionalCost: derived.fractionalCost,
							benchCost: derived.benchCost,
							partial: derived.isPartialWindow,
							chip: derived.chip,
							trailing: (model.trailing.get(employee.id)?.trailing ?? []).map(
								(cell) => ({
									month: cell.month,
									employed: cell.employed,
									utilizationPercent: cell.utilizationPercent,
								})
							),
							chronicUnder:
								model.trailing.get(employee.id)?.chronicUnder ?? false,
						};
					}),
			},
			trend: {
				months: model.trend.map((point) => point.month),
				series: model.trend.map((point) => ({
					month: point.month,
					utilizationPercent: point.utilizationPercent,
					benchCost: point.benchCost,
				})),
			},
			departments: {
				seeded: UTILIZATION_DEPARTMENTS,
				rollup: model.departments.map((summary) => ({
					department: summary.department,
					headcount: summary.headcount,
					utilizationPercent: summary.utilizationPercent,
					loggedHours: summary.loggedHours,
					capacityHours: summary.capacityHours,
					benchCost: summary.benchCost,
					noLoggedCount: summary.noLoggedCount,
				})),
			},
			projects: {
				seeded: UTILIZATION_PROJECTS,
				splitMember: (() => {
					const split = utilizationMemberForPlan('projectSplit');
					const derived = model.breakdowns.get(
						model.employees.find((row) => row.employee_id === split.code)!.id
					)!;
					return {
						code: split.code,
						topN: PROJECT_TOP_N,
						projects: derived.projects.map((bucket) => ({
							projectId: bucket.projectId,
							projectCode: bucket.projectCode,
							projectName: bucket.projectName,
							clientName: bucket.clientName,
							hours: bucket.hours,
							activities: bucket.activities,
						})),
						other: derived.other,
						noProject: derived.noProject,
						loggedHours: derived.loggedHours,
					};
				})(),
			},
			observed,
			residue,
			ok: true,
		});
		expect(readArtifact('employee-utilization')).toMatchObject({
			month: MONTH,
			ok: true,
		});
	});
});
