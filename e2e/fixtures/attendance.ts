/**
 * Disposable attendance fixtures for the Attendance grid, Attendance Report
 * and Holiday Master browser journeys.
 *
 * Every fixture owns one ordinary Employee row (`employees.id`) plus the
 * `employee_attendance` / `attendance_logs` rows named by the caller. The
 * employee is a real active Payroll employee at the Mumbai workplace, so the
 * Attendance Report's roster includes it without granting any projection or
 * super-admin permission. Values are authored literals: the tests assert those
 * literals are still shown and stored, never that the implementation recomputed
 * them.
 *
 * `attendance_logs` rows carry the same `employee_id` the report reads and a
 * namespaced device code; the device direction is explicit, so the report's
 * direction inference is not what makes the evidence pass.
 *
 * Cleanup deletes rows only for the owned Employee primary key. It removes
 * punches, authored attendance, the summary the save route writes, and finally
 * the employee. A partially seeded fixture cleans up after itself before
 * rethrowing.
 */
import { randomBytes } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';

const EMPLOYEE_WORKPLACE = 'Mumbai';
const EMPLOYEE_TYPE = 'Payroll';
const EMPLOYEE_DEPARTMENT = 'E2E Attendance';

export interface AttendanceDaySeed {
	/** 'YYYY-MM-DD' inside the fixture month. */
	date: string;
	/** `employee_attendance.status`, for example P / A / HD / WO / H. */
	status: string;
	/** 'HH:MM' or 'HH:MM:SS'; omitted means no time authored. */
	inTime?: string;
	outTime?: string;
	overtimeHours?: number;
	remarks?: string;
	isWeeklyOff?: boolean;
	isHoliday?: boolean;
}

export interface AttendancePunchSeed {
	/** Device wall clock 'YYYY-MM-DD HH:MM:SS'. */
	logDate: string;
	serialNumber: string;
	direction: 'in' | 'out';
}

export interface AttendanceFixture {
	employeeId: number;
	employeeCode: string;
	firstName: string;
	lastName: string;
	fullName: string;
	email: string;
	department: string;
	smartofficeCode: string;
	/** 'YYYY-MM' the journey opens. */
	month: string;
	/** The primary-key rows this fixture created. */
	attendanceIds: number[];
	punchIds: number[];
}

export interface SeedAttendanceOptions {
	/** Distinguishes fixtures that share one Playwright namespace. */
	suffix: string;
	/** 'YYYY-MM' shown by the grid/report. */
	month: string;
	attendance?: readonly AttendanceDaySeed[];
	punches?: readonly AttendancePunchSeed[];
}

export interface StoredAttendanceRow extends RowDataPacket {
	id: number;
	employee_id: number;
	attendance_date: string;
	status: string;
	overtime_hours: string | number;
	is_weekly_off: number;
	is_holiday: number;
	remarks: string | null;
	in_time: string | null;
	out_time: string | null;
	idle_time: number;
}

export interface StoredAttendanceSummaryRow extends RowDataPacket {
	employee_id: number;
	month: string;
	total_present: number;
	total_absent: number;
	total_half_day: number;
	total_weekly_off: number;
	total_holiday: number;
	total_overtime_hours: string | number;
	total_working_hours: string | number;
}

export interface StoredPunchRow extends RowDataPacket {
	id: number;
	employee_code: string;
	log_date: string;
	serial_number: string;
	direction: string | null;
	employee_id: number | null;
}

/**
 * Seed one owned Employee and optionally its authored attendance rows and raw
 * punches. All supplied dates must fall inside `month`, so a test's selected
 * month and its starting state cannot drift apart.
 */
export async function seedAttendanceFixture(
	connection: Connection,
	namespace: string,
	options: SeedAttendanceOptions
): Promise<AttendanceFixture> {
	const month = assertMonth(options.month);
	const token = randomBytes(5).toString('hex');
	const employeeCode = fitIdentifier(`AT-${token}`, 20);
	const firstName = 'E2E';
	const lastName = `Attendance ${options.suffix} ${token}`;
	const fullName = `${firstName} ${lastName}`;
	const email = `${fitIdentifier(
		`attendance-${namespace}-${token}`,
		60
	).toLowerCase()}@e2e.invalid`;
	const smartofficeCode = fitIdentifier(`SO-${token}`, 50);

	for (const day of options.attendance ?? []) {
		assertDateInMonth(day.date, month, `attendance ${day.status}`);
	}
	for (const punch of options.punches ?? []) {
		assertPunchInMonth(punch.logDate, month);
	}

	const fixture: AttendanceFixture = {
		employeeId: 0,
		employeeCode,
		firstName,
		lastName,
		fullName,
		email,
		department: EMPLOYEE_DEPARTMENT,
		smartofficeCode,
		month,
		attendanceIds: [],
		punchIds: [],
	};

	try {
		const [employee] = await connection.execute<ResultSetHeader>(
			`INSERT INTO employees (
          employee_id, first_name, last_name, email, department, status,
          employee_type, workplace, smartoffice_code, isDelete
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`,
			[
				employeeCode,
				firstName,
				lastName,
				email,
				EMPLOYEE_DEPARTMENT,
				EMPLOYEE_TYPE,
				EMPLOYEE_WORKPLACE,
				smartofficeCode,
			]
		);
		fixture.employeeId = Number(employee.insertId);

		for (const day of options.attendance ?? []) {
			const [inserted] = await connection.execute<ResultSetHeader>(
				`INSERT INTO employee_attendance (
            employee_id, attendance_date, status, overtime_hours,
            is_weekly_off, is_holiday, remarks, in_time, out_time, idle_time
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
				[
					fixture.employeeId,
					day.date,
					day.status.toUpperCase(),
					day.overtimeHours ?? 0,
					(day.isWeeklyOff ?? day.status.toUpperCase() === 'WO') ? 1 : 0,
					(day.isHoliday ?? day.status.toUpperCase() === 'H') ? 1 : 0,
					day.remarks ?? null,
					normalizeTime(day.inTime),
					normalizeTime(day.outTime),
				]
			);
			fixture.attendanceIds.push(Number(inserted.insertId));
		}

		for (const punch of options.punches ?? []) {
			const [inserted] = await connection.execute<ResultSetHeader>(
				`INSERT INTO attendance_logs (
            employee_code, log_date, serial_number, direction, employee_id
          ) VALUES (?, ?, ?, ?, ?)`,
				[
					smartofficeCode,
					punch.logDate,
					punch.serialNumber,
					punch.direction,
					fixture.employeeId,
				]
			);
			fixture.punchIds.push(Number(inserted.insertId));
		}

		return fixture;
	} catch (error) {
		try {
			await cleanupAttendanceFixture(connection, fixture);
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; attendance fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

/** Read the authored attendance row for an owned employee/day. */
export async function readAttendanceRow(
	connection: Connection,
	fixture: AttendanceFixture,
	date: string
): Promise<StoredAttendanceRow | null> {
	const [rows] = await connection.execute<StoredAttendanceRow[]>(
		`SELECT id, employee_id, attendance_date, status, overtime_hours,
            is_weekly_off, is_holiday, remarks, in_time, out_time, idle_time
       FROM employee_attendance
      WHERE employee_id = ? AND attendance_date = ?`,
		[fixture.employeeId, date]
	);
	return rows[0] ?? null;
}

/** Read the monthly summary the attendance save route owns. */
export async function readAttendanceSummary(
	connection: Connection,
	fixture: AttendanceFixture
): Promise<StoredAttendanceSummaryRow | null> {
	const [rows] = await connection.execute<StoredAttendanceSummaryRow[]>(
		`SELECT employee_id, month, total_present, total_absent, total_half_day,
            total_weekly_off, total_holiday, total_overtime_hours,
            total_working_hours
       FROM employee_attendance_summary
      WHERE employee_id = ? AND month = ?`,
		[fixture.employeeId, fixture.month]
	);
	return rows[0] ?? null;
}

/** Read the owned raw punches in device-time order. */
export async function readPunchRows(
	connection: Connection,
	fixture: AttendanceFixture
): Promise<StoredPunchRow[]> {
	const [rows] = await connection.execute<StoredPunchRow[]>(
		`SELECT id, employee_code, log_date, serial_number, direction, employee_id
       FROM attendance_logs
      WHERE employee_id = ?
      ORDER BY log_date, id`,
		[fixture.employeeId]
	);
	return rows;
}

/** Delete only this fixture's rows, in foreign-key-safe order. */
export async function cleanupAttendanceFixture(
	connection: Connection,
	fixture: AttendanceFixture
): Promise<void> {
	if (fixture.employeeId > 0) {
		await connection.execute(
			'DELETE FROM attendance_logs WHERE employee_id = ?',
			[fixture.employeeId]
		);
		await connection.execute(
			'DELETE FROM employee_attendance WHERE employee_id = ?',
			[fixture.employeeId]
		);
		await connection.execute(
			'DELETE FROM employee_attendance_summary WHERE employee_id = ?',
			[fixture.employeeId]
		);
		await connection.execute('DELETE FROM employees WHERE id = ?', [
			fixture.employeeId,
		]);
	}
}

/* ── Holiday fixture ─────────────────────────────────────────────── */

export const HOLIDAY_YEAR = '2027';
/** A Monday, so the report's muted Holiday cell cannot be a Weekly Off. */
export const HOLIDAY_DATE = '2027-03-15';

export interface HolidayFixture {
	name: string;
	date: string;
	year: string;
	type: 'company';
	description: string;
}

export interface StoredHolidayRow extends RowDataPacket {
	id: number;
	name: string;
	date: string;
	type: string;
	is_optional: number;
	description: string | null;
	is_active: number;
}

/** Generate the authored holiday the browser creates through Holiday Master. */
export function holidayFixture(namespace: string): HolidayFixture {
	const token = randomBytes(4).toString('hex');
	return {
		name: fitIdentifier(`E2E Holiday ${token} ${namespace}`, 255),
		date: HOLIDAY_DATE,
		year: HOLIDAY_YEAR,
		type: 'company',
		description: `Optional-free E2E holiday ${token}`,
	};
}

/** Read the holiday by the response id, or by its uniquely owned name/date. */
export async function readHolidayRows(
	connection: Connection,
	fixture: HolidayFixture,
	holidayId: number | null
): Promise<StoredHolidayRow[]> {
	const [rows] = holidayId
		? await connection.execute<StoredHolidayRow[]>(
				`SELECT id, name, date, type, is_optional, description, is_active
           FROM holiday_master
          WHERE id = ? AND name = ? AND date = ?`,
				[holidayId, fixture.name, fixture.date]
			)
		: await connection.execute<StoredHolidayRow[]>(
				`SELECT id, name, date, type, is_optional, description, is_active
           FROM holiday_master
          WHERE name = ? AND date = ?`,
				[fixture.name, fixture.date]
			);
	return rows;
}

/** Delete the holiday this journey created; a no-op when it never saved. */
export async function cleanupHolidayFixture(
	connection: Connection,
	fixture: HolidayFixture,
	holidayId: number | null
): Promise<void> {
	if (holidayId !== null) {
		await connection.execute(
			'DELETE FROM holiday_master WHERE id = ? AND name = ? AND date = ?',
			[holidayId, fixture.name, fixture.date]
		);
		return;
	}
	await connection.execute(
		'DELETE FROM holiday_master WHERE name = ? AND date = ?',
		[fixture.name, fixture.date]
	);
}

/* ── Validation helpers ──────────────────────────────────────────── */

const MONTH_SHAPE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function assertMonth(value: string): string {
	if (!MONTH_SHAPE.test(value)) {
		throw new Error(
			`[attendance-fixture] month must be YYYY-MM, got ${JSON.stringify(value)}.`
		);
	}
	return value;
}

function assertDateInMonth(date: string, month: string, label: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0, 7) !== month) {
		throw new Error(
			`[attendance-fixture] ${label} date ${JSON.stringify(date)} is outside ${month}.`
		);
	}
}

function assertPunchInMonth(logDate: string, month: string): void {
	if (
		!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(logDate) ||
		logDate.slice(0, 7) !== month
	) {
		throw new Error(
			`[attendance-fixture] punch ${JSON.stringify(logDate)} is outside ${month}.`
		);
	}
}

/** Accept 'HH:MM' or 'HH:MM:SS' and store MySQL's full TIME shape. */
function normalizeTime(value: string | undefined): string | null {
	if (!value) return null;
	if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
		throw new Error(
			`[attendance-fixture] time must be HH:MM or HH:MM:SS, got ${JSON.stringify(value)}.`
		);
	}
	return value.length === 5 ? `${value}:00` : value;
}
