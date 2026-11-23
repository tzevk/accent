/**
 * Owned seed for the profile self-service and linked-employee dashboard
 * browser journeys.
 *
 * Both journeys start from an ordinary active user created through
 * `journey-user.ts`. The profile journey needs exactly the one grant its
 * visible Save control calls (`PUT /api/users` requires `users:update`); the
 * dashboard journey needs no grant at all. The dashboard fixture adds one
 * owned Employee record, links it through `users.employee_id`, and writes the
 * current-month rows the dashboard and self-service Timesheet read.
 *
 * The live `/api/users/[id]/attendance` reader still probes a legacy
 * `attendance` table that the migrations never create, so its monthly Present
 * count comes from distinct `user_activity_logs` days. This fixture seeds
 * those app-entry days for the dashboard figures, and gives the same dates
 * `employee_attendance` rows so the Timesheet handoff has the linked
 * employee's own month to show.
 *
 * Cleanup deletes every row this module created, including failure paths, and
 * is safe to call twice.
 */
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** `PUT /api/users` on My Profile is the only write the page performs. */
const PROFILE_SAVE_PERMISSION = 'users:update';

/** Fixed evidence the dashboard journey writes and the spec asserts. */
const PRESENT_DAY_COUNT = 3;
const LEAVE_TOTAL = 20;
const LEAVE_USED = 6;

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

export interface StoredPermissions {
	role: string[];
	user: string[];
}

export interface ProfileSelfServiceFixture {
	journey: JourneyUser;
	/** The stored address the page opens with. */
	currentEmail: string;
	/** Unique replacement the person types. */
	savedEmail: string;
	/** The exact grants the journey starts from. */
	storedPermissions: StoredPermissions;
	dispose(): Promise<void>;
}

export interface EmployeeDashboardFixture {
	journey: JourneyUser;
	employeeId: number;
	employeeCode: string;
	employeeName: string;
	/** YYYY-MM of the seeded rows. */
	monthKey: string;
	/** e.g. "November 2026". */
	monthLabel: string;
	daysInMonth: number;
	presentDays: number;
	/** DECIMAL sums arrive as strings from mysql2. */
	leaveUsed: string;
	leaveTotal: string;
	leaveBalance: number;
	dispose(): Promise<void>;
}

/**
 * Normalize a MySQL JSON/text permission column. MariaDB may hand back the
 * parsed value already, so only strings are parsed.
 */
function parsePermissions(value: unknown): string[] {
	let parsed: unknown = value;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Create the disposable My Profile identity. Reads the stored email and grants
 * before the browser starts, so the journey can prove both the starting state
 * and the reopened result.
 */
export async function createProfileSelfServiceFixture(
	connection: Connection,
	namespace: string
): Promise<ProfileSelfServiceFixture> {
	const journey = await createJourneyUser(connection, namespace, [
		PROFILE_SAVE_PERMISSION,
	]);
	try {
		const [rows] = await connection.execute<RowDataPacket[]>(
			`SELECT u.email AS email,
              r.permissions AS role_permissions,
              u.permissions AS user_permissions
         FROM users u
         LEFT JOIN roles_master r ON r.id = u.role_id
        WHERE u.id = ? AND u.isDelete = 0
        LIMIT 1`,
			[journey.userId]
		);
		const row = rows[0];
		if (!row) {
			throw new Error(
				'[profile-dashboard] the created profile user disappeared.'
			);
		}
		return {
			journey,
			currentEmail: String(row.email ?? ''),
			savedEmail: `${fitIdentifier(`${namespace}-saved`, 80).toLowerCase()}@e2e.invalid`,
			storedPermissions: {
				role: parsePermissions(row.role_permissions),
				user: parsePermissions(row.user_permissions),
			},
			async dispose(): Promise<void> {
				await journey.dispose();
			},
		};
	} catch (error) {
		await journey.dispose();
		throw error;
	}
}

/**
 * Create an active employee with no permission grants, link it to a fresh
 * user, and seed one current-month dashboard. Call `dispose()` in `finally`.
 */
export async function createEmployeeDashboardFixture(
	connection: Connection,
	namespace: string
): Promise<EmployeeDashboardFixture> {
	const journey = await createJourneyUser(connection, namespace, []);
	let employeeId: number | null = null;

	const dispose = async (): Promise<void> => {
		if (employeeId !== null) {
			await connection.execute(
				'DELETE FROM employee_leaves WHERE employee_id = ?',
				[employeeId]
			);
			await connection.execute(
				'DELETE FROM employee_attendance WHERE employee_id = ?',
				[employeeId]
			);
		}
		await connection.execute(
			'DELETE FROM user_activity_logs WHERE user_id = ?',
			[journey.userId]
		);
		await journey.dispose();
		if (employeeId !== null) {
			await connection.execute('DELETE FROM employees WHERE id = ?', [
				employeeId,
			]);
			employeeId = null;
		}
	};

	try {
		const employeeCode = fitIdentifier(`${namespace}-EMP`, 20);
		const firstName = 'E2E';
		const lastName = fitIdentifier(namespace, 50);
		const employeeName = `${firstName} ${lastName}`;
		const employeeEmail = `${fitIdentifier(
			`${namespace}-dashboard`,
			80
		).toLowerCase()}@e2e.invalid`;

		const [employeeResult] = await connection.execute<ResultSetHeader>(
			`INSERT INTO employees (
          employee_id, first_name, last_name, email, department, position,
          status, employee_type
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', 'Permanent')`,
			[employeeCode, firstName, lastName, employeeEmail, 'E2E', 'E2E Dashboard']
		);
		const linkId = Number(employeeResult.insertId);
		employeeId = linkId;

		await connection.execute(
			'UPDATE users SET employee_id = ? WHERE id = ? AND isDelete = 0',
			[linkId, journey.userId]
		);

		// The database clock owns "today", matching the attendance route's
		// CURDATE() predicates in both the monthly count and the access clocks.
		const [clockRows] = await connection.execute<RowDataPacket[]>(
			`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today_date`
		);
		const todayDate = String(clockRows[0]?.today_date ?? '');
		if (!/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) {
			throw new Error('[profile-dashboard] could not read the database date.');
		}
		const [year, month, dayOfMonth] = todayDate.split('-').map(Number);
		const daysInMonth = new Date(year, month, 0).getDate();
		const monthKey = `${year}-${String(month).padStart(2, '0')}`;

		// Today is always one seeded day; two other mid-month days keep the
		// count at three even when the run happens on the 1st or 2nd.
		const dayNumbers = [dayOfMonth];
		for (
			let day = 1;
			day <= 28 && dayNumbers.length < PRESENT_DAY_COUNT;
			day += 1
		) {
			if (!dayNumbers.includes(day)) dayNumbers.push(day);
		}
		const presentDates = dayNumbers
			.map((day) => `${monthKey}-${String(day).padStart(2, '0')}`)
			.sort();

		const logPlaceholders = presentDates
			.map(() => '(?, ?, ?, ?, ?, ?)')
			.join(', ');
		const logValues: ExecuteValues[] = [];
		for (const date of presentDates) {
			logValues.push(
				journey.userId,
				'login',
				'session',
				`[profile-dashboard] seeded app entry ${date}`,
				'success',
				`${date} ${date === todayDate ? '00:00:00' : '09:00:00'}`
			);
		}
		await connection.execute(
			`INSERT INTO user_activity_logs (
        user_id, action_type, resource_type, description, status, created_at
      ) VALUES ${logPlaceholders}`,
			logValues
		);

		const attendancePlaceholders = presentDates
			.map(() => '(?, ?, ?, ?, ?, ?)')
			.join(', ');
		const attendanceValues: ExecuteValues[] = [];
		for (const date of presentDates) {
			attendanceValues.push(linkId, date, 'P', 0, 0, 0);
		}
		await connection.execute(
			`INSERT INTO employee_attendance (
        employee_id, attendance_date, status, overtime_hours, is_weekly_off,
        is_holiday
      ) VALUES ${attendancePlaceholders}`,
			attendanceValues
		);

		const [leaveTypes] = await connection.execute<RowDataPacket[]>(
			'SELECT id FROM leave_types ORDER BY id LIMIT 1'
		);
		const leaveTypeId = leaveTypes[0]?.id;
		if (leaveTypeId === undefined) {
			throw new Error(
				'[profile-dashboard] migrations did not seed a leave type.'
			);
		}
		await connection.execute(
			`INSERT INTO employee_leaves (
        employee_id, leave_type_id, year, total_leaves, used_leaves
      ) VALUES (?, ?, ?, ?, ?)`,
			[linkId, Number(leaveTypeId), year, LEAVE_TOTAL, LEAVE_USED]
		);

		return {
			journey,
			employeeId: linkId,
			employeeCode,
			employeeName,
			monthKey,
			monthLabel: `${MONTH_NAMES[month - 1]} ${year}`,
			daysInMonth,
			presentDays: PRESENT_DAY_COUNT,
			leaveUsed: LEAVE_USED.toFixed(1),
			leaveTotal: LEAVE_TOTAL.toFixed(1),
			leaveBalance: LEAVE_TOTAL - LEAVE_USED,
			dispose,
		};
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; profile-dashboard fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}
