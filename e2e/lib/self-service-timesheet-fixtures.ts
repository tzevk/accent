import bcrypt from 'bcrypt';
import { isWeeklyOff } from '@/utils/weekly-off';
import { exec, rows } from './db';

/**
 * Self-service Timesheet fixtures (ticket #332).
 *
 * The spec signs in as its own employee through the real sign-in page, so the
 * harness owns the whole identity chain: the Employee, the login linked to it,
 * and the unlinked login that must get the explanatory empty state. Nothing
 * outside this namespace is read or written.
 *
 * Namespace (everything this module owns; nothing else is touched):
 *   users                      `e2e_ts_employee` (linked), `e2e_ts_no_employee` (not linked)
 *   employees                  `E2E-TS-0001`
 *   employee_salary_profile    employee_id of that employee
 *   employee_attendance        employee_id of that employee
 *   user_activity_assignments  `e2e-ts-%`
 *   payroll_slips              employee_id of that employee (inert gate slips
 *                              other fixtures can write for the E2E- namespace)
 *
 * Intended call order:
 *   1. `await seedSelfServiceTimesheetFixtures()` once, from the spec's
 *      `beforeAll`. It runs cleanup first, so it is idempotent across runs.
 *   2. Run the spec.
 *   3. `await cleanupSelfServiceTimesheetFixtures()` in the matching
 *      teardown.
 * Both use the shared pool in `e2e/lib/db.ts`, so call them before
 * `closeDb()`.
 *
 * The months are calendar-relative so the flow always has a current month
 * (the page's default) and a previous month beside it, plus one month that
 * carries project daily entries and no attendance rows at all.
 */

export const TIMESHEET_EMPLOYEE_CODE = 'E2E-TS-0001';

/** The login the spec signs in as; linked to the Employee above. */
export const TIMESHEET_USER = {
	username: 'e2e_ts_employee',
	email: 'e2e.ts.employee@accent.test',
	password: 'E2e#Timesheet1',
	fullName: 'E2E Timesheet Employee',
};

/** The same account shape with no linked Employee record. */
export const NO_EMPLOYEE_USER = {
	username: 'e2e_ts_no_employee',
	email: 'e2e.ts.noemployee@accent.test',
	password: 'E2e#NoEmployee1',
	fullName: 'E2E Timesheet No Employee',
};

export const TIMESHEET_ASSIGNMENT_PREFIX = 'e2e-ts-';

/** Standard hours a present day credits, and a half day (the report's defaults). */
export const PRESENT_HOURS = 8;
export const HALF_DAY_HOURS = 4;
/** The overtime the current month's last worked day carries. */
export const CURRENT_MONTH_OVERTIME_HOURS = 1.5;

/** `YYYY-MM` of the calendar month a date sits in. */
export function calendarMonth(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** The calendar month before `month`. */
export function previousCalendarMonth(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const date = new Date(Date.UTC(year, monthNumber - 2, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for a 1-based day number; day 32+ rolls into the next month. */
function monthDate(month: string, day: number): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const date = new Date(Date.UTC(year, monthNumber - 1, day));
	const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(date.getUTCDate()).padStart(2, '0');
	return `${date.getUTCFullYear()}-${mm}-${dd}`;
}

function daysInMonth(month: string): number {
	const [year, monthNumber] = month.split('-').map(Number);
	return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** Active, non-optional holidays of the month — the days payroll also skips. */
async function nonOptionalHolidays(month: string): Promise<Set<string>> {
	const holidayRows = await rows<{ date: string }>(
		`SELECT date FROM holiday_master
      WHERE is_active = 1 AND is_optional = 0 AND date BETWEEN ? AND ?`,
		[`${month}-01`, `${month}-31`]
	);
	return new Set(holidayRows.map((row) => String(row.date).slice(0, 10)));
}

/** Working dates of the month, up to and including `throughDay` (default: all). */
async function workingDates(
	month: string,
	throughDay: number = daysInMonth(month)
): Promise<string[]> {
	const holidays = await nonOptionalHolidays(month);
	const dates: string[] = [];
	for (let day = 1; day <= Math.min(throughDay, daysInMonth(month)); day++) {
		const date = monthDate(month, day);
		if (isWeeklyOff(date)) continue;
		if (holidays.has(date)) continue;
		dates.push(date);
	}
	return dates;
}

/** Weekly-off dates of the month, up to `throughDay` (default: all). */
function weeklyOffDates(month: string, throughDay?: number): string[] {
	const dates: string[] = [];
	for (
		let day = 1;
		day <= Math.min(throughDay ?? 99, daysInMonth(month));
		day++
	) {
		const date = monthDate(month, day);
		if (isWeeklyOff(date)) dates.push(date);
	}
	return dates;
}

/** True when any employee has an attendance row dated in `month`. */
async function monthHasAttendance(month: string): Promise<boolean> {
	const [row] = await rows<{ c: number }>(
		`SELECT COUNT(*) AS c FROM employee_attendance WHERE attendance_date LIKE ?`,
		[`${month}%`]
	);
	return Number(row?.c ?? 0) > 0;
}

const ATTENDANCE_COLUMNS = [
	'employee_id',
	'attendance_date',
	'status',
	'is_weekly_off',
	'is_holiday',
	'overtime_hours',
	'remarks',
];

/**
 * mysql2's prepared-statement path renders an array bind as a JSON string, so
 * `VALUES ?` bulk inserts are unavailable; build one placeholder tuple per row
 * instead and flatten the parameters.
 */
async function insertRows(
	table: string,
	columns: string[],
	values: unknown[][]
): Promise<void> {
	const CHUNK_SIZE = 100;
	const tuple = `(${columns.map(() => '?').join(', ')})`;
	for (let start = 0; start < values.length; start += CHUNK_SIZE) {
		const chunk = values.slice(start, start + CHUNK_SIZE);
		await exec(
			`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk
				.map(() => tuple)
				.join(', ')}`,
			chunk.flat()
		);
	}
}

export interface SeededAttendanceDay {
	date: string;
	status: string;
	overtime_hours: number;
}

export interface SeededLoggedDay {
	date: string;
	hours: number;
}

export interface SelfServiceTimesheetSeed {
	employeeId: number;
	employeeUserId: number;
	noEmployeeUserId: number;
	currentMonth: string;
	previousMonth: string;
	/** A month with project daily entries and no attendance rows at all. */
	projectOnlyMonth: string;
	currentMonthAttendance: SeededAttendanceDay[];
	previousMonthAttendance: SeededAttendanceDay[];
	previousMonthLogged: SeededLoggedDay[];
	projectOnlyMonthLogged: SeededLoggedDay[];
}

/** Remove every row the fixtures own. Safe to run repeatedly. */
export async function cleanupSelfServiceTimesheetFixtures(): Promise<void> {
	const employees = await rows<{ id: number }>(
		`SELECT id FROM employees WHERE employee_id = ?`,
		[TIMESHEET_EMPLOYEE_CODE]
	);
	const employeeIds = employees.map((row) => row.id);
	const usernames = [TIMESHEET_USER.username, NO_EMPLOYEE_USER.username];

	// Children before parents: the inert gate slips other fixtures can write
	// for the E2E- namespace reference the employee, and so do the assignments.
	if (employeeIds.length) {
		const placeholders = employeeIds.map(() => '?').join(', ');
		await exec(
			`DELETE FROM payroll_slips WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM employee_attendance WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM user_activity_assignments WHERE id LIKE ? OR employee_id IN (${placeholders})`,
			[TIMESHEET_ASSIGNMENT_PREFIX, ...employeeIds]
		);
		await exec(
			`DELETE FROM employee_salary_profile WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
	}
	// The id namespace catches assignments even when the employee row is gone.
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		`${TIMESHEET_ASSIGNMENT_PREFIX}%`,
	]);
	// Dangling attendance rows of a removed employee, by month, for safety.
	await exec(
		`DELETE FROM employee_attendance
      WHERE employee_id NOT IN (SELECT id FROM employees)`
	);
	// The log tables are best-effort: the users cannot be blocked on them.
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username IN (?, ?))`,
	]) {
		try {
			await exec(sql, usernames);
		} catch {
			// Optional table — the fixture users cannot be blocked on it.
		}
	}
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		usernames
	);
	await exec(`DELETE FROM users WHERE username IN (?, ?)`, usernames);
	await exec(`DELETE FROM employees WHERE employee_id = ?`, [
		TIMESHEET_EMPLOYEE_CODE,
	]);
}

/** Purge leftovers, then seed the identity chain, attendance and assignments. */
export async function seedSelfServiceTimesheetFixtures(): Promise<SelfServiceTimesheetSeed> {
	await cleanupSelfServiceTimesheetFixtures();

	const employee = await exec(
		`INSERT INTO employees
       (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
     VALUES (?, ?, ?, ?, 'active', 'Payroll', '2019-01-01', 0)`,
		[TIMESHEET_EMPLOYEE_CODE, 'E2E', 'Timesheet', 'e2e.ts.employee@accent.test']
	);
	const employeeId = employee.insertId;

	const employeeUser = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, employee_id, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', ?, 0)`,
		[
			TIMESHEET_USER.username,
			await bcrypt.hash(TIMESHEET_USER.password, 10),
			TIMESHEET_USER.email,
			TIMESHEET_USER.fullName,
			employeeId,
		]
	);
	const noEmployeeUser = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
		[
			NO_EMPLOYEE_USER.username,
			await bcrypt.hash(NO_EMPLOYEE_USER.password, 10),
			NO_EMPLOYEE_USER.email,
			NO_EMPLOYEE_USER.fullName,
		]
	);

	// A Salary Profile that starts in the previous month: the payroll month
	// (2019-01) is untouched, while the employee is not a profile-less roster
	// member any completeness gate would name.
	await exec(
		`INSERT INTO employee_salary_profile
       (employee_id, gross, gross_salary, employer_cost, other_allowances,
        effective_from, is_active, pf_applicable, esic_applicable, pt_applicable,
        mlwf_applicable, salary_type, std_hours_per_day, std_working_days,
        tds_percentage, loan_amount, loan_amount_per_month, loan_active,
        advance_amount, advance_active)
     VALUES (?, 26000, 26000, 26000, 0, ?, 1, 0, 0, 0, 0, 'monthly', ?, 26,
             0, 0, 0, 0, 0, 0)`,
		[
			employeeId,
			`${previousCalendarMonth(calendarMonth(new Date()))}-01`,
			PRESENT_HOURS,
		]
	);

	const now = new Date();
	const currentMonth = calendarMonth(now);
	const previousMonth = previousCalendarMonth(currentMonth);

	// ── The previous month: a full month of attendance beside logged hours ──
	const previousWorking = await workingDates(previousMonth);
	const previousHalfDay = previousWorking[1] ?? null;
	const previousAttendance: SeededAttendanceDay[] = previousWorking.map(
		(date) => ({
			date,
			status: date === previousHalfDay ? 'HD' : 'P',
			overtime_hours: 0,
		})
	);
	await insertRows(
		'employee_attendance',
		ATTENDANCE_COLUMNS,
		previousAttendance.map((day) => [
			employeeId,
			day.date,
			day.status,
			0,
			0,
			'0.00',
			null,
		])
	);
	for (const date of weeklyOffDates(previousMonth)) {
		await exec(
			`INSERT INTO employee_attendance
         (employee_id, attendance_date, status, is_weekly_off, is_holiday, overtime_hours, remarks)
       VALUES (?, ?, 'WO', 1, 0, '0.00', 'Weekly Off')`,
			[employeeId, date]
		);
	}

	// Three logged days: 8h inside the standard day, 10h past it (2h worked
	// overtime), 6h under it.
	const previousMonthLogged: SeededLoggedDay[] = [
		{ date: previousWorking[0], hours: PRESENT_HOURS },
		{ date: previousWorking[1], hours: 10 },
		{ date: previousWorking[2], hours: 6 },
	];
	await exec(
		`INSERT INTO user_activity_assignments
       (id, user_id, employee_id, activity_id, activity_name, status,
        daily_entries, qty_completed, assigned_date, due_date)
     VALUES (?, ?, ?, ?, 'E2E timesheet project work', 'In Progress', ?, 3, ?, ?)`,
		[
			`${TIMESHEET_ASSIGNMENT_PREFIX}assign-0001`,
			employeeUser.insertId,
			employeeId,
			`${TIMESHEET_ASSIGNMENT_PREFIX}activity-0001`,
			JSON.stringify(previousMonthLogged),
			`${previousMonth}-01 09:00:00`,
			`${previousMonth}-28`,
		]
	);

	// ── The current month: hours come from the attendance status alone ──
	const today = now.getDate();
	const currentWorking = await workingDates(currentMonth, today);
	const currentHalfDay = currentWorking[1] ?? null;
	const overtimeDay = currentWorking[currentWorking.length - 1] ?? null;
	const currentAttendance: SeededAttendanceDay[] = currentWorking.map(
		(date) => ({
			date,
			status: date === currentHalfDay ? 'HD' : 'P',
			overtime_hours: date === overtimeDay ? CURRENT_MONTH_OVERTIME_HOURS : 0,
		})
	);
	await insertRows(
		'employee_attendance',
		ATTENDANCE_COLUMNS,
		currentAttendance.map((day) => [
			employeeId,
			day.date,
			day.status,
			0,
			0,
			day.overtime_hours.toFixed(2),
			null,
		])
	);
	for (const date of weeklyOffDates(currentMonth, today)) {
		await exec(
			`INSERT INTO employee_attendance
         (employee_id, attendance_date, status, is_weekly_off, is_holiday, overtime_hours, remarks)
       VALUES (?, ?, 'WO', 1, 0, '0.00', 'Weekly Off')`,
			[employeeId, date]
		);
	}

	// ── A month with project daily entries and no attendance rows at all ──
	// Start four months back and step back until the month is free of
	// attendance evidence, so the offered month proves the project-only case.
	let projectOnlyMonth = previousCalendarMonth(previousMonth);
	while (
		(await monthHasAttendance(projectOnlyMonth)) ||
		projectOnlyMonth === currentMonth ||
		projectOnlyMonth === previousMonth
	) {
		projectOnlyMonth = previousCalendarMonth(projectOnlyMonth);
	}
	const projectOnlyMonthLogged: SeededLoggedDay[] = [
		{ date: `${projectOnlyMonth}-08`, hours: 5 },
		{ date: `${projectOnlyMonth}-09`, hours: 3 },
	];
	await exec(
		`INSERT INTO user_activity_assignments
       (id, user_id, employee_id, activity_id, activity_name, status,
        daily_entries, qty_completed, assigned_date, due_date)
     VALUES (?, ?, ?, ?, 'E2E timesheet quiet month work', 'Completed', ?, 0, ?, ?)`,
		[
			`${TIMESHEET_ASSIGNMENT_PREFIX}assign-0002`,
			employeeUser.insertId,
			employeeId,
			`${TIMESHEET_ASSIGNMENT_PREFIX}activity-0002`,
			JSON.stringify(projectOnlyMonthLogged),
			`${projectOnlyMonth}-08 09:00:00`,
			`${projectOnlyMonth}-09`,
		]
	);

	return {
		employeeId: Number(employeeId),
		employeeUserId: Number(employeeUser.insertId),
		noEmployeeUserId: Number(noEmployeeUser.insertId),
		currentMonth,
		previousMonth,
		projectOnlyMonth,
		currentMonthAttendance: currentAttendance,
		previousMonthAttendance: previousAttendance,
		previousMonthLogged,
		projectOnlyMonthLogged,
	};
}
