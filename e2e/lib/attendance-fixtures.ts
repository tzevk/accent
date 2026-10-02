import { isWeeklyOff } from '@/utils/weekly-off';
import { exec, rows } from './db';

/**
 * Attendance-report fixtures — the E2E harness's own September 2026 month.
 *
 * The dev database has zero punches and one attendance cell, so a daily-hours
 * report renders nothing. This module seeds one employee per behaviour the
 * report and the Time Present calculator must survive: clean and odd-punch
 * days, a forgot-to-check-out day, a night shift crossing midnight, a refused
 * cross-midnight merge, two-device and duplicate-tap days, authored statuses,
 * missing/contract salary profiles, hidden employee types, a terminated
 * employee with punches, an intermittent employee and unmapped device codes.
 *
 * Namespace (everything this module owns; nothing else is touched):
 *   users                      `e2e_att_user`
 *   employees                  `E2E-ATT-*` (smart-office code `E2E<n>`)
 *   attendance_logs            employee_id of those employees, plus unmapped
 *                              employee_code `E2E9*`
 *   employee_attendance        employee_id of those employees
 *   employee_salary_profile    employee_id of those employees
 *   user_activity_assignments  `e2e-att-*`
 *   holiday_master             `E2E Attendance Holiday`
 *
 * Intended call order (a later integration step wires this into the harness):
 *   1. `await seedAttendanceFixtures()` once before the attendance specs —
 *      from global setup or a spec's `beforeAll`. It runs cleanup first, so
 *      it is idempotent across runs.
 *   2. Run the specs.
 *   3. `await cleanupAttendanceFixtures()` in the matching teardown. It is
 *      safe to call repeatedly, and seeding calls it first, so residue never
 *      has to survive a run.
 * Both use the shared pool in `e2e/lib/db.ts`, so call them before
 * `closeDb()`.
 *
 * Weekly Off and holiday days follow the app's canonical rule: `isWeeklyOff`
 * (ADR-0004: Sundays + 2nd/4th Saturdays) and non-optional holidays only, so
 * the seeded calendar matches the Basis Hours payroll computes.
 */

export const ATTENDANCE_MONTH = '2026-09';
export const ATTENDANCE_EMPLOYEE_PREFIX = 'E2E-ATT-';
export const ATTENDANCE_ASSIGNMENT_PREFIX = 'e2e-att-';
export const ATTENDANCE_USERNAME = 'e2e_att_user';
/** Smart-office codes that resolve to no employee, so they can never be a grid row. */
export const ATTENDANCE_UNMAPPED_CODE_PREFIX = 'E2E9';
/** Smart-office code prefix; the full code is this plus the roster number. */
export const ATTENDANCE_SMARTOFFICE_PREFIX = 'E2E';

export const ATTENDANCE_HOLIDAY = {
	name: 'E2E Attendance Holiday',
	date: '2026-09-15',
	/** Non-optional: payroll's getHolidaysForMonth(month, false) keeps it non-working. */
	isOptional: false,
} as const;

const [FIXTURE_YEAR, FIXTURE_MONTH] = ATTENDANCE_MONTH.split('-').map(Number);

/** `YYYY-MM-DD` for a 1-based day number; day 31+ rolls into the next month. */
function monthDate(day: number): string {
	const date = new Date(Date.UTC(FIXTURE_YEAR, FIXTURE_MONTH - 1, day));
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
	return `${date.getUTCFullYear()}-${month}-${dayOfMonth}`;
}

export const ATTENDANCE_DAYS_IN_MONTH = new Date(
	Date.UTC(FIXTURE_YEAR, FIXTURE_MONTH, 0)
).getUTCDate();

/** Day numbers the company treats as Weekly Off in the fixture month. */
export const ATTENDANCE_WEEKLY_OFF_DAYS = Array.from(
	{ length: ATTENDANCE_DAYS_IN_MONTH },
	(_, index) => index + 1
).filter((day) => isWeeklyOff(monthDate(day)));

function isWorkingDay(day: number): boolean {
	const date = monthDate(day);
	if (isWeeklyOff(date)) return false;
	// Only a non-optional holiday removes a working day (payroll's
	// getHolidaysForMonth(month, false)); an optional one stays working.
	return !(date === ATTENDANCE_HOLIDAY.date && !ATTENDANCE_HOLIDAY.isOptional);
}

/** `YYYY-MM-DD` working days of the fixture month (Weekly Off + holiday excluded). */
export const ATTENDANCE_WORKING_DATES = Array.from(
	{ length: ATTENDANCE_DAYS_IN_MONTH },
	(_, index) => index + 1
)
	.filter(isWorkingDay)
	.map(monthDate);

/* ------------------------------------------------------------------ *
 * The roster. Each entry is one behaviour the report must handle.
 * ------------------------------------------------------------------ */

export type AttendancePlan =
	| 'clean'
	| 'accidental'
	| 'forgotOut'
	| 'nightShift'
	| 'noMerge'
	| 'twoDevices'
	| 'dupTaps'
	| 'statuses'
	| 'sparse';

export type AttendanceEmployeeType =
	| 'Payroll'
	| 'Contract'
	| 'Deputation'
	| 'Permanent'
	| 'Intern';

export type AttendanceEmployeeStatus = 'active' | 'terminated';

/** Salary profile kind seeded for a member; null = no profile row at all. */
export type AttendanceSalaryType = 'payroll' | 'contract' | null;

export interface AttendanceMember {
	/** Zero-padded roster number, e.g. '0001'. */
	n: string;
	/** Accent employee code (`employees.employee_id`), e.g. 'E2E-ATT-0001'. */
	code: string;
	/** Smart-office code (`employees.smartoffice_code`), e.g. 'E2E0001'. */
	smartofficeCode: string;
	type: AttendanceEmployeeType;
	status: AttendanceEmployeeStatus;
	profile: AttendanceSalaryType;
	plan: AttendancePlan;
}

export function attendanceCode(n: string): string {
	return `${ATTENDANCE_EMPLOYEE_PREFIX}${n}`;
}

export function attendanceSmartofficeCode(n: string): string {
	return `${ATTENDANCE_SMARTOFFICE_PREFIX}${n}`;
}

const ROSTER_DEF: ReadonlyArray<{
	n: string;
	type: AttendanceEmployeeType;
	status: AttendanceEmployeeStatus;
	profile: AttendanceSalaryType;
	plan: AttendancePlan;
}> = [
	{
		n: '0001',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'clean',
	},
	{
		n: '0002',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'accidental',
	},
	{
		n: '0003',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'forgotOut',
	},
	{
		n: '0004',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'nightShift',
	},
	{
		n: '0005',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'noMerge',
	},
	{
		n: '0006',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'twoDevices',
	},
	{
		n: '0007',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'dupTaps',
	},
	{
		n: '0008',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'statuses',
	},
	{
		n: '0009',
		type: 'Payroll',
		status: 'active',
		profile: null,
		plan: 'clean',
	},
	{
		n: '0010',
		type: 'Payroll',
		status: 'active',
		profile: 'contract',
		plan: 'clean',
	},
	{
		n: '0011',
		type: 'Contract',
		status: 'active',
		profile: 'contract',
		plan: 'clean',
	},
	{
		n: '0012',
		type: 'Deputation',
		status: 'active',
		profile: null,
		plan: 'clean',
	},
	{
		n: '0013',
		type: 'Permanent',
		status: 'active',
		profile: null,
		plan: 'clean',
	},
	{
		n: '0014',
		type: 'Intern',
		status: 'active',
		profile: null,
		plan: 'clean',
	},
	{
		n: '0015',
		type: 'Payroll',
		status: 'terminated',
		profile: 'payroll',
		plan: 'clean',
	},
	{
		n: '0016',
		type: 'Payroll',
		status: 'active',
		profile: 'payroll',
		plan: 'sparse',
	},
];

export const ATTENDANCE_ROSTER: readonly AttendanceMember[] = ROSTER_DEF.map(
	(member) => ({
		...member,
		code: attendanceCode(member.n),
		smartofficeCode: attendanceSmartofficeCode(member.n),
	})
);

const MEMBERS_BY_PLAN = new Map<AttendancePlan, AttendanceMember[]>();
for (const member of ATTENDANCE_ROSTER) {
	const members = MEMBERS_BY_PLAN.get(member.plan) ?? [];
	members.push(member);
	MEMBERS_BY_PLAN.set(member.plan, members);
}

/**
 * The roster member carrying `plan`. Every plan has exactly one member except
 * `clean`, which four members share; the first (lowest roster number) is
 * returned. Enumerate `ATTENDANCE_ROSTER` for the others.
 */
export function attendanceMemberForPlan(
	plan: AttendancePlan
): AttendanceMember {
	const member = MEMBERS_BY_PLAN.get(plan)?.[0];
	if (!member)
		throw new Error(`No attendance fixture member has plan '${plan}'`);
	return member;
}

/* ------------------------------------------------------------------ *
 * Punch + attendance plans, per employee per working day
 * ------------------------------------------------------------------ */

type AttendanceStatus = 'P' | 'PL' | 'HD' | 'A';

interface PlannedPunch {
	/** 'HH:MM:SS' device-local time. */
	time: string;
	/** `serial_number` the punch arrived with (the device identity). */
	serial: string;
	/** 1 when the punch belongs to the next calendar day (night shift). */
	dayOffset?: number;
}

interface PlannedDay {
	punches: PlannedPunch[];
	/** Hours to append to the assignment's daily_entries; null = no entry. */
	logged: number | null;
	/** Authored attendance status the seeding writes instead of 'P'. */
	status?: AttendanceStatus;
	/**
	 * Forgot to check out: the next working day's real 09:00 badge-in is
	 * written as a tail punch for this employee, making the would-be merge
	 * span 15h and therefore refusable (> MAX_MERGED_SPAN_HOURS).
	 */
	tailNextMorning?: boolean;
}

/**
 * The script believed the next-morning badge-in arrived on the device that
 * recorded the forgotten checkout, so the tail reuses its serial. That also
 * keeps the tail clear of the next day's own punches on the
 * (employee_code, log_date, serial_number) unique key.
 */
const TAIL_PUNCH_SERIAL = '2';

function planDay(plan: AttendancePlan, day: number): PlannedDay {
	switch (plan) {
		// Two punches, the ordinary case.
		case 'clean':
			return {
				punches: [
					{ time: '09:00:00', serial: '1' },
					{ time: '18:30:00', serial: '2' },
				],
				logged: 8,
			};

		// An odd punch count makes the current alternation infer the last
		// punch as an `in`, so `lastOut` lands on the second punch:
		// 09:00 / 12:00 / 18:30 reads 3h today, 9.5h under first->last.
		case 'accidental':
			if (day % 3 === 1)
				return {
					punches: [
						{ time: '09:02:00', serial: '1' },
						{ time: '12:10:00', serial: '2' },
						{ time: '18:41:00', serial: '3' },
					],
					logged: 8,
				};
			if (day % 3 === 2)
				return {
					punches: [
						{ time: '08:55:00', serial: '1' },
						{ time: '10:30:00', serial: '2' },
						{ time: '10:33:00', serial: '3' },
						{ time: '13:05:00', serial: '4' },
						{ time: '19:02:00', serial: '5' },
					],
					logged: 8,
				};
			return {
				punches: [
					{ time: '09:12:00', serial: '1' },
					{ time: '11:00:00', serial: '2' },
					{ time: '11:04:00', serial: '3' },
					{ time: '15:20:00', serial: '4' },
					{ time: '15:24:00', serial: '5' },
					{ time: '16:40:00', serial: '6' },
					{ time: '18:55:00', serial: '7' },
				],
				logged: 8,
			};

		// Punched in, never punched out: not computable, must render as an
		// em dash and never as 0h.
		case 'forgotOut':
			if (day % 4 === 0)
				return { punches: [{ time: '09:20:00', serial: '1' }], logged: 6 };
			return {
				punches: [
					{ time: '09:20:00', serial: '1' },
					{ time: '17:55:00', serial: '2' },
				],
				logged: 8,
			};

		// 22:00 -> 06:30 next day = 8.5h. The 06:30 punch belongs to the next
		// calendar day's bucket and is consumed by this day's merge, so the
		// shift is credited to the day it began.
		case 'nightShift':
			return {
				punches: [
					{ time: '22:00:00', serial: '1' },
					{ time: '23:58:00', serial: '2' },
					{ time: '06:30:00', serial: '3', dayOffset: 1 },
				],
				logged: 8,
			};

		// Forgot to punch out at 18:00, next badge-in 09:00 = 15h apart.
		// Exceeds MAX_MERGED_SPAN_HOURS, so the merge must be refused and the
		// day must read as uncomputable rather than inventing a 15-hour
		// presence. The seeding writes that next-morning punch for real (see
		// tails below) so the refusal is reproducible.
		case 'noMerge':
			if (day % 5 === 0) return { punches: [], logged: 4 };
			return {
				punches: [
					{ time: '09:00:00', serial: '1' },
					{ time: '18:00:00', serial: '2' },
				],
				logged: 8,
				tailNextMorning: true,
			};

		// Gate reader + desk reader on one day: pooled span, not per device.
		case 'twoDevices':
			return {
				punches: [
					{ time: '09:04:00', serial: '1' },
					{ time: '09:12:00', serial: '1' },
					{ time: '18:40:00', serial: '2' },
				],
				logged: 8,
			};

		// Retry taps inside and outside the 120s collapse window, plus
		// completely empty days.
		case 'dupTaps':
			if (day % 5 === 0) return { punches: [], logged: 0 };
			if (day % 5 === 1)
				return {
					punches: [
						{ time: '09:00:00', serial: '1' },
						{ time: '09:00:40', serial: '2' },
						{ time: '18:30:00', serial: '3' },
					],
					logged: 8,
				};
			if (day % 5 === 2)
				return {
					punches: [
						{ time: '09:00:00', serial: '1' },
						{ time: '09:06:00', serial: '2' },
						{ time: '18:30:00', serial: '3' },
					],
					logged: 8,
				};
			return {
				punches: [
					{ time: '09:00:00', serial: '1' },
					{ time: '18:30:00', serial: '2' },
				],
				logged: 8,
			};

		// Human-authored status variety for the cell badges.
		case 'statuses':
			if (day % 7 === 2) return { punches: [], logged: 0, status: 'PL' };
			if (day % 7 === 4)
				return {
					punches: [
						{ time: '09:00:00', serial: '1' },
						{ time: '19:00:00', serial: '2' },
					],
					logged: 4,
					status: 'HD',
				};
			if (day % 7 === 5) return { punches: [], logged: 0, status: 'A' };
			return {
				punches: [
					{ time: '08:50:00', serial: '1' },
					{ time: '17:40:00', serial: '2' },
				],
				logged: 8,
			};

		// No salary profile (must still be in the report) and an
		// intentionally empty roster row.
		case 'sparse':
			if (day % 6 === 0) return { punches: [], logged: null };
			return {
				punches: [
					{ time: '10:00:00', serial: '1' },
					{ time: '16:00:00', serial: '2' },
				],
				logged: 5,
			};
	}
}

/** The next working day strictly after `day`, or null when the month ends. */
function nextWorkingDayAfter(day: number): number | null {
	for (
		let candidate = day + 1;
		candidate <= ATTENDANCE_DAYS_IN_MONTH;
		candidate++
	) {
		if (isWorkingDay(candidate)) return candidate;
	}
	return null;
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

const PUNCH_COLUMNS = [
	'employee_code',
	'log_date',
	'serial_number',
	'direction',
	'raw_payload',
	'employee_id',
];

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

/** Remove every row the attendance fixtures own. Safe to run repeatedly. */
export async function cleanupAttendanceFixtures(): Promise<number> {
	const employees = await rows<{ id: number }>(
		`SELECT id FROM employees WHERE employee_id LIKE ? AND isDelete = 0`,
		[`${ATTENDANCE_EMPLOYEE_PREFIX}%`]
	);
	const employeeIds = employees.map((row) => row.id);

	// Children before parents, so foreign keys never block a delete: punch,
	// attendance and profile rows reference the employees, and assignments
	// reference both the employees and the fixture user.
	if (employeeIds.length) {
		const placeholders = employeeIds.map(() => '?').join(', ');
		await exec(
			`DELETE FROM attendance_logs WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM employee_attendance WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM user_activity_assignments WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM employee_salary_profile WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
	}
	// The id namespace catches assignments even when the employee row is
	// already gone.
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		`${ATTENDANCE_ASSIGNMENT_PREFIX}%`,
	]);
	// Unmapped punches are owned by the fixture too, and can never be reached
	// through an employee id, so they are matched on the code prefix.
	await exec(`DELETE FROM attendance_logs WHERE employee_code LIKE ?`, [
		`${ATTENDANCE_UNMAPPED_CODE_PREFIX}%`,
	]);
	// The user before the employees it was seeded beside; its assignments are
	// already gone, so the assignment FK cannot bite.
	await exec(`DELETE FROM users WHERE username = ?`, [ATTENDANCE_USERNAME]);
	await exec(`DELETE FROM employees WHERE employee_id LIKE ?`, [
		`${ATTENDANCE_EMPLOYEE_PREFIX}%`,
	]);
	await exec(`DELETE FROM holiday_master WHERE name = ?`, [
		ATTENDANCE_HOLIDAY.name,
	]);

	return employeeIds.length;
}

export interface AttendanceSeeded {
	month: string;
	/** `users.id` of the seeded `e2e_att_user`. */
	userId: number;
	employees: number;
	punches: number;
	attendance: number;
	assignments: number;
	profiles: number;
}

/** Purge leftovers, then seed the month's roster, punches and attendance. */
export async function seedAttendanceFixtures(): Promise<AttendanceSeeded> {
	await cleanupAttendanceFixtures();

	const summary: AttendanceSeeded = {
		month: ATTENDANCE_MONTH,
		userId: 0,
		employees: 0,
		punches: 0,
		attendance: 0,
		assignments: 0,
		profiles: 0,
	};

	const user = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, '', ?, 'E2E Attendance Fixture', 'active', 1, 0, 'employee', 0)`,
		[ATTENDANCE_USERNAME, `${ATTENDANCE_USERNAME}@accent.test`]
	);
	const userId = user.insertId;
	summary.userId = userId;

	await exec(
		`INSERT INTO holiday_master (name, date, type, is_optional, is_active)
     VALUES (?, ?, 'company', 0, 1)`,
		[ATTENDANCE_HOLIDAY.name, ATTENDANCE_HOLIDAY.date]
	);

	for (const member of ATTENDANCE_ROSTER) {
		const employee = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type,
          joining_date, smartoffice_code, isDelete)
       VALUES (?, 'E2E', ?, ?, ?, ?, '2024-01-01', ?, 0)`,
			[
				member.code,
				member.plan,
				`e2e.att.${member.n}@accent.test`,
				member.status,
				member.type,
				member.smartofficeCode,
			]
		);
		const employeeId = employee.insertId;
		summary.employees++;

		if (member.profile) {
			await exec(
				`INSERT INTO employee_salary_profile
           (employee_id, gross, gross_salary, employer_cost, other_allowances,
            effective_from, is_active, pf_applicable, esic_applicable, pt_applicable,
            mlwf_applicable, salary_type, std_hours_per_day, std_working_days,
            tds_percentage, loan_amount, loan_amount_per_month, loan_active,
            advance_amount, advance_active)
         VALUES (?, 26000, 26000, 26000, 0, '2026-01-01', 1, 0, 0, 0, 0, ?, 8, 26, 0, 0, 0, 0, 0, 0)`,
				[employeeId, member.profile === 'contract' ? 'contract' : 'monthly']
			);
			summary.profiles++;
		}

		const dailyEntries: { date: string; hours: number }[] = [];
		const punchRows: unknown[][] = [];
		const attendanceRows: unknown[][] = [];
		const tailDays: number[] = [];

		for (let day = 1; day <= ATTENDANCE_DAYS_IN_MONTH; day++) {
			const date = monthDate(day);

			if (!isWorkingDay(day)) {
				// Weekly Off / holiday cells: muted unless data exists.
				const weeklyOff = isWeeklyOff(date);
				attendanceRows.push([
					employeeId,
					date,
					'WO',
					weeklyOff ? 1 : 0,
					weeklyOff ? 0 : 1,
					'0.00',
					weeklyOff ? 'Weekly Off' : ATTENDANCE_HOLIDAY.name,
				]);
				continue;
			}

			const planned = planDay(member.plan, day);

			if (planned.logged !== null && planned.logged > 0) {
				dailyEntries.push({ date, hours: planned.logged });
			}

			for (const punch of planned.punches) {
				const when = `${monthDate(day + (punch.dayOffset ?? 0))} ${punch.time}`;
				punchRows.push([
					member.smartofficeCode,
					when,
					punch.serial,
					null, // direction: real devices report none
					JSON.stringify({ UserId: member.smartofficeCode, LogDate: when }),
					employeeId,
				]);
			}

			if (planned.tailNextMorning) tailDays.push(day);

			attendanceRows.push([
				employeeId,
				date,
				planned.status ?? 'P',
				0,
				0,
				'0.00',
				planned.status && planned.status !== 'P'
					? `${planned.status} (authored)`
					: null,
			]);
		}

		// The refused merge needs its next-morning punch to actually exist:
		// the next working day's 09:00 badge-in, as a punch of this same
		// employee. Without it every noMerge day would compute 9h and the
		// 15h refusal could never occur.
		for (const day of tailDays) {
			const nextWorkingDay = nextWorkingDayAfter(day);
			if (nextWorkingDay === null) continue;
			const when = `${monthDate(nextWorkingDay)} 09:00:00`;
			punchRows.push([
				member.smartofficeCode,
				when,
				TAIL_PUNCH_SERIAL,
				null,
				JSON.stringify({ UserId: member.smartofficeCode, LogDate: when }),
				employeeId,
			]);
		}

		if (punchRows.length) {
			await insertRows('attendance_logs', PUNCH_COLUMNS, punchRows);
			summary.punches += punchRows.length;
		}

		if (attendanceRows.length) {
			await insertRows(
				'employee_attendance',
				ATTENDANCE_COLUMNS,
				attendanceRows
			);
			summary.attendance += attendanceRows.length;
		}

		if (dailyEntries.length) {
			await exec(
				`INSERT INTO user_activity_assignments
           (id, user_id, employee_id, activity_id, activity_name, status,
            daily_entries, assigned_date, due_date)
         VALUES (?, ?, ?, ?, 'E2E attendance fixture work', 'In Progress', ?, ?, ?)`,
				[
					`${ATTENDANCE_ASSIGNMENT_PREFIX}${member.n}`,
					userId,
					employeeId,
					`${ATTENDANCE_ASSIGNMENT_PREFIX}act-${member.n}`,
					JSON.stringify(dailyEntries),
					`${ATTENDANCE_MONTH}-01 09:00:00`,
					`${ATTENDANCE_MONTH}-30`,
				]
			);
			summary.assignments++;
		}

		// A terminated employee still has rows, so the status filter is
		// provably doing work rather than passing on an empty set.
		if (member.status !== 'active' && !punchRows.length) {
			await exec(
				`INSERT INTO attendance_logs (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
           VALUES (?, ?, '1', NULL, NULL, ?)`,
				[member.smartofficeCode, `${monthDate(1)} 09:00:00`, employeeId]
			);
			summary.punches++;
		}
	}

	// Unmapped device codes: resolvable to nothing, so they can never become a
	// matrix row but must still show in the amber strip.
	const unmapped: unknown[][] = [
		[
			`${ATTENDANCE_UNMAPPED_CODE_PREFIX}001`,
			`${ATTENDANCE_MONTH}-02 09:00:00`,
			'1',
			null,
			null,
			null,
		],
		[
			`${ATTENDANCE_UNMAPPED_CODE_PREFIX}001`,
			`${ATTENDANCE_MONTH}-02 18:00:00`,
			'2',
			null,
			null,
			null,
		],
		[
			`${ATTENDANCE_UNMAPPED_CODE_PREFIX}002`,
			`${ATTENDANCE_MONTH}-03 09:30:00`,
			'1',
			null,
			null,
			null,
		],
		[
			`${ATTENDANCE_UNMAPPED_CODE_PREFIX}002`,
			`${ATTENDANCE_MONTH}-04 10:15:00`,
			'1',
			null,
			null,
			null,
		],
	];
	await insertRows('attendance_logs', PUNCH_COLUMNS, unmapped);
	summary.punches += unmapped.length;

	return summary;
}
