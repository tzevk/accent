import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import {
	UTILIZATION_CTC,
	UTILIZATION_LATER_MONTH,
	UTILIZATION_MONTH,
	UTILIZATION_OPTIONAL_HOLIDAY,
	UTILIZATION_ROSTER,
	cleanupUtilizationFixtures,
	utilizationMemberForPlan,
	type UtilizationMember,
	type UtilizationPlan,
} from '../lib/utilization-fixtures';

/**
 * Employee Utilization: month-scoped payroll roster (ticket #293) and
 * window-pro-rated Capacity / Monthly Cost (ticket #294).
 *
 * Every expected figure is re-derived in this file from the raw `employees`
 * rows, `employee_attendance` evidence, `user_activity_assignments` payloads,
 * `holiday_master` and the calendar. Nothing here imports the report's
 * `data-source`, the shared roster selector, `@/lib/logged-hours` or
 * `@/utils/weekly-off`, so the report cannot mark its own homework; the
 * expected rules are the documented ones:
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
 *                  days), fractional = round2(CTC ÷ (26 × 8) × logged hours),
 *                  bench = monthly − fractional (footing must hold).
 *   partial flag = the window does not cover the whole month; the chip names
 *                  the window clamped to the month (`15 Jan – 31 Jan`).
 *
 * The page's own API payload is asserted against that derivation; the DOM is
 * read through the page's `data-testid`/`data-*` attributes, never classes.
 */

test.use({ storageState: 'e2e/.auth/admin-report.json' });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = UTILIZATION_MONTH;
const LATER_MONTH = UTILIZATION_LATER_MONTH;
const MONTH_LABEL = 'January 2019';
const LATER_MONTH_LABEL = 'March 2019';
const DAYS_IN_MONTH = 31;
const STANDARD_DAY_HOURS = 8;

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

function round2(value: number): number {
	return Math.round(value * 100) / 100;
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

interface DerivedRow {
	capacityHours: number;
	employedWorkingDays: number;
	monthWorkingDays: number;
	loggedHours: number;
	utilizationPercent: number | null;
	utilizationBand: string | null;
	monthlyCost: number;
	fractionalCost: number;
	benchCost: number;
	isPartialWindow: boolean;
	chip: string | null;
}

/**
 * The report's capacity and cost rules, re-derived from raw rows: only the
 * working days inside the window credit hours (the attendance weekly-off flag
 * wins over the schedule; leave zeroes its day, HD credits 4h, everything
 * else — including 'H' on an optional holiday — credits 8h), and Monthly Cost
 * is `CTC × employed ÷ month working days` at 2dp with bench footing.
 */
function deriveRow(
	window: EmploymentWindow,
	month: string,
	calendar: MonthCalendar,
	attendanceByDate: Map<string, AttendanceDay>,
	loggedHours: number
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
	const monthlyCost =
		employedWorkingDays > 0 && monthWorkingDays > 0
			? round2((UTILIZATION_CTC * employedWorkingDays) / monthWorkingDays)
			: 0;
	// The seeded profiles carry CTC ÷ (26 std days × 8 h).
	const fractionalCost = round2((UTILIZATION_CTC / (26 * 8)) * loggedHours);
	const benchCost = round2(monthlyCost - fractionalCost);
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
		monthlyCost,
		fractionalCost,
		benchCost,
		isPartialWindow,
		chip: isPartialWindow
			? `Partial (${chipDay(chipStart)} – ${chipDay(chipEnd)})`
			: null,
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
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	utilization_band: string | null;
	employment_start: string | null;
	employment_end: string | null;
	is_partial_window: boolean;
	monthly_cost: number | null;
	fractional_cost: number | null;
	bench_cost: number | null;
	cost_status: string;
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

interface ApiPayload {
	month: string;
	month_label: string;
	flag: string | null;
	rows: ApiRow[];
	totals: {
		employee_count: number;
		capacity_hours: number;
		logged_hours: number;
		monthly_cost: number | null;
		fractional_cost: number | null;
		bench_cost: number | null;
	};
	disclosure: ApiDisclosure | null;
}

async function fetchMonth(
	request: APIRequestContext,
	month: string
): Promise<ApiPayload> {
	const response = await request.get(
		`/api/reports/employee-utilization?month=${encodeURIComponent(month)}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ApiPayload;
}

// ─── Page helpers ────────────────────────────────────────────────────

async function selectMonth(page: Page, label: string): Promise<void> {
	await page.getByLabel('Month').click();
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
	capacity: string;
	logged: string;
	utilization: string;
	monthly: string;
	partial: string;
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
				capacity: cell('cell-capacity'),
				logged: cell('cell-logged'),
				utilization: cell('cell-utilization'),
				monthly: cell('cell-monthly-cost'),
				partial: cell('partial-window-chip'),
			};
		})
	);
}

/** en-IN, 2dp — the display rule the page's `formatNumber` applies. */
const number2 = new Intl.NumberFormat('en-IN', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

// ─── Model ───────────────────────────────────────────────────────────

interface Model {
	employees: RawEmployee[];
	windows: Map<number, EmploymentWindow>;
	month: DerivedMonth;
	laterMonth: DerivedMonth;
	calendar: MonthCalendar;
	/** Derived capacity/cost per viewed-month roster member, by employee id. */
	rows: Map<number, DerivedRow>;
	loggedHoursByEmployee: Map<number, number>;
	monthLabel: string;
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
	}>(
		`SELECT id, employee_id, employee_type, status,
		        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
		        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date,
		        DATE_FORMAT(exit_date, '%Y-%m-%d') AS exit_date
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
	// user, then the user's email/username.
	const assignments = await rows<{
		user_id: number | null;
		employee_id: number | null;
		email: string | null;
		username: string | null;
		daily_entries: string | null;
	}>(
		`SELECT uaa.user_id, uaa.employee_id, u.email, u.username, uaa.daily_entries
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
	const loggedHoursByEmployee = new Map<number, number>();
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

		const hours = loggedHoursInMonth(assignment.daily_entries, MONTH);
		if (hours > 0) {
			loggedHoursByEmployee.set(
				empId,
				(loggedHoursByEmployee.get(empId) ?? 0) + hours
			);
		}

		for (const day of loggedDays(assignment.daily_entries)) {
			const bound = loggedBounds.get(empId) ?? { first: null, last: null };
			if (bound.first === null || day < bound.first) bound.first = day;
			if (bound.last === null || day > bound.last) bound.last = day;
			loggedBounds.set(empId, bound);
		}
	}

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

	// The viewed month's capacity calendar: weekly offs + active NON-optional
	// holidays (optional holidays stay working days, as attendance and
	// payroll treat them).
	const holidays = await rows<{
		date: string;
		is_optional: number;
		is_active: number;
	}>(
		`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
		        COALESCE(is_optional, 0) AS is_optional,
		        COALESCE(is_active, 1) AS is_active
		 FROM holiday_master
		 WHERE date BETWEEN ? AND ?`,
		[`${MONTH}-01`, `${MONTH}-${DAYS_IN_MONTH}`]
	);
	const calendar = deriveHolidaySets(holidays);

	// The viewed month's attendance, by employee: the recorded status and the
	// `is_weekly_off` flag that wins over the schedule when a record exists.
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
		[`${MONTH}-01`, `${MONTH}-${DAYS_IN_MONTH}`]
	);
	const attendanceByEmployee = new Map<number, Map<string, AttendanceDay>>();
	for (const row of attendanceRows) {
		const employeeId = Number(row.employee_id);
		if (!employeeId) continue;
		const byDate =
			attendanceByEmployee.get(employeeId) ?? new Map<string, AttendanceDay>();
		byDate.set(String(row.date).slice(0, 10), {
			status: row.status === null ? null : String(row.status),
			isWeeklyOff: Number(row.is_weekly_off) === 1 ? 1 : 0,
		});
		attendanceByEmployee.set(employeeId, byDate);
	}

	// One derived capacity/cost row per viewed-month roster member.
	const derivedRows = new Map<number, DerivedRow>();
	for (const employee of employees) {
		const window = windows.get(employee.id);
		if (!window || !intersects(window, MONTH)) continue;
		if (employee.employee_type !== 'Payroll') continue;
		derivedRows.set(
			employee.id,
			deriveRow(
				window,
				MONTH,
				calendar,
				attendanceByEmployee.get(employee.id) ?? new Map(),
				loggedHoursByEmployee.get(employee.id) ?? 0
			)
		);
	}

	model.employees = employees;
	model.windows = windows;
	model.month = deriveMonth(employees, MONTH);
	model.laterMonth = deriveMonth(employees, LATER_MONTH);
	model.calendar = calendar;
	model.rows = derivedRows;
	model.loggedHoursByEmployee = loggedHoursByEmployee;
	model.monthLabel = MONTH_LABEL;
});

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
			expect(rendered.monthly, employee.employee_id).toContain(
				number2.format(derived.monthlyCost)
			);
			expect(rendered.partial, employee.employee_id).toBe(derived.chip ?? '');
			if (derived.chip) chipsSeen++;
		}
		expect(chipsSeen).toBeGreaterThan(0);

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
		// the partial flag; fractional + bench foots to monthly at 2dp.
		for (const row of api.rows) {
			const employee = model.employees.find(
				(candidate) => candidate.employee_id === row.employee_code
			)!;
			const derived = model.rows.get(employee.id)!;
			const window = model.windows.get(employee.id)!;
			expect(row.capacity_hours, row.employee_code).toBe(derived.capacityHours);
			expect(row.monthly_cost, row.employee_code).toBe(derived.monthlyCost);
			expect(row.fractional_cost, row.employee_code).toBe(
				derived.fractionalCost
			);
			expect(row.bench_cost, row.employee_code).toBe(derived.benchCost);
			expect(row.is_partial_window, row.employee_code).toBe(
				derived.isPartialWindow
			);
			expect(row.employment_start).toBe(window.start);
			expect(row.employment_end).toBe(window.end);
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

		// The totals are the derived sums over the same row set, footing too.
		let capacity = 0;
		let logged = 0;
		let monthly = 0;
		let fractional = 0;
		let bench = 0;
		for (const derived of model.rows.values()) {
			capacity += derived.capacityHours;
			logged += derived.loggedHours;
			monthly += derived.monthlyCost;
			fractional += derived.fractionalCost;
			bench += derived.benchCost;
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
		};
		expect(residue).toEqual({
			employees: 0,
			attendance: 0,
			assignments: 0,
			profiles: 0,
			users: 0,
			holidays: 0,
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
					'round2(CTC × employed working days ÷ the month’s working days); full-month windows reproduce the full CTC',
				footing:
					'fractional = round2(CTC ÷ (26×8) × logged); bench = monthly − fractional; sum foots per row and in totals',
				partialChip:
					'is_partial_window when the window does not cover the month; the chip names the window clamped to the month',
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
							capacityHours: derived.capacityHours,
							loggedHours: derived.loggedHours,
							utilizationPercent: derived.utilizationPercent,
							monthlyCost: derived.monthlyCost,
							fractionalCost: derived.fractionalCost,
							benchCost: derived.benchCost,
							partial: derived.isPartialWindow,
							chip: derived.chip,
						};
					}),
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
