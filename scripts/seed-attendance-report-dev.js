#!/usr/bin/env node
/**
 * Seed the DEV database with one month of attendance, so the Attendance
 * Report has real rows to render instead of "No attendance logs yet".
 *
 * Run: node scripts/seed-attendance-report-dev.js            # defaults to 2026-09
 *      node scripts/seed-attendance-report-dev.js 2026-10    # another month
 *
 * What it writes, and only in dev:
 *
 *  1. A Smart Office device code on every Payroll employee who has none, so
 *     Punches can be attributed to a row on the report's roster.
 *  2. `attendance_logs` — one month of Punches, with the anomalies worth
 *     seeing on the page: a night shift that crosses midnight, a lone Punch, a
 *     three-Punch day, days where the device reported no direction, a second
 *     device on one day, worked Sundays, and a few Punches under a code no
 *     employee is enrolled under (the amber strip).
 *  3. `holiday_master` — two non-optional and one optional holiday.
 *  4. `employee_attendance` — authored statuses so the badges render.
 *  5. `user_activity_assignments` — daily entries so Logged Hours renders.
 *
 * Idempotent: every run deletes what it is about to insert, scoped by device
 * code and month. Safe to run twice.
 *
 * Guards against anything that is not dev. The script refuses to run when the
 * database it resolved is not named like a dev database, or when NODE_ENV says
 * production or staging. Never point DEV_DB_* at a shared database.
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { isWeeklyOff } from '../src/utils/weekly-off.ts';

dotenv.config();

const DEV_ONLY = /dev/i;

function resolveTarget() {
	const env = process.env.NODE_ENV || 'development';
	let database, user, password;
	if (env === 'production') {
		database = process.env.PROD_DB_NAME;
		user = process.env.PROD_DB_USER;
		password = process.env.PROD_DB_PASSWORD;
	} else if (env === 'staging') {
		database = process.env.STAGING_DB_NAME;
		user = process.env.STAGING_DB_USER;
		password = process.env.STAGING_DB_PASSWORD;
	} else {
		database = process.env.DEV_DB_NAME;
		user = process.env.DEV_DB_USER;
		password = process.env.DEV_DB_PASSWORD;
	}
	return { env, database, user, password };
}

const target = resolveTarget();

if (target.env === 'production' || target.env === 'staging') {
	console.error(
		`Refusing to run: NODE_ENV is "${target.env}". This seed writes dev attendance data.`
	);
	process.exit(1);
}
if (!target.database || !DEV_ONLY.test(target.database)) {
	console.error(
		`Refusing to run: resolved database "${target.database}" is not named like a dev database.`
	);
	process.exit(1);
}

const MONTH = process.argv[2] || '2026-09';
const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;
if (!MONTH_RE.test(MONTH)) {
	console.error(`Refusing to run: "${MONTH}" is not a YYYY-MM month.`);
	process.exit(1);
}

/** Two device serials, so a pooled multi-device day is possible. */
const SERIAL_A = '84E0F42938231501';
const SERIAL_B = '84E0F42938231599';

/** Punches under this code match no employee, so the amber strip renders. */
const UNMAPPED_CODE = 'SO-999';
const UNMAPPED_SERIAL = 'BB00000000000003';

/**
 * The workplace the report covers. Must match `REPORT_WORKPLACE` in
 * `src/app/reports/attendance-report/data-source.ts`, or the report filters
 * every seeded employee out and shows an empty grid.
 */
const WORKPLACE = 'Mumbai';

/**
 * Holidays for the seeded month. Non-optional days are excluded from working
 * days and mute; an optional holiday is a working day and must not.
 */
const HOLIDAYS = [
	{ date: `${MONTH}-05`, name: 'Seeded Teachers Day', optional: false },
	{ date: `${MONTH}-19`, name: 'Seeded Company Day', optional: false },
	{ date: `${MONTH}-25`, name: 'Seeded Optional Day', optional: true },
];

/**
 * Authored statuses, so the badge column renders something other than
 * Present. A row here also overrides what the Punches imply, per ADR-0007.
 * Keyed by `employees.employee_id`.
 */
const AUTHORED_STATUSES = [
	{
		employee: 'EMP-002',
		date: `${MONTH}-10`,
		status: 'HD',
		in: '09:20',
		out: '13:40',
	},
	{
		employee: 'EMP-002',
		date: `${MONTH}-17`,
		status: 'PL',
		in: null,
		out: null,
	},
	{
		employee: 'EMP-002',
		date: `${MONTH}-22`,
		status: 'A',
		in: null,
		out: null,
	},
	{
		employee: 'E2E-EMP-0001',
		date: `${MONTH}-13`,
		status: 'WO',
		in: null,
		out: null,
	},
	{
		employee: 'E2E-EMP-0002',
		date: `${MONTH}-15`,
		status: 'SL',
		in: null,
		out: null,
	},
	{
		employee: 'E2E-ALLOC-06',
		date: `${MONTH}-23`,
		status: 'LWP',
		in: null,
		out: null,
	},
];

/**
 * Per-employee punch shape, keyed by `employees.employee_id` — a stable value
 * the seed did not generate, so a plan can never drift onto the wrong person
 * when the roster changes. Employees with no plan get the ordinary shape.
 */
const PUNCH_PLAN = {
	'EMP-002': {
		serial: SERIAL_A,
		inHour: 9,
		outHour: 17,
		outMinute: 42,
		// A lone Punch: an arrival and no departure.
		lonePunch: [`${MONTH}-09`],
		// Three Punches, the middle one accidental.
		threePunch: [`${MONTH}-11`],
		// A night shift: 22:00 on the 14th, 00:30 on the 15th.
		nightShift: [{ date: `${MONTH}-14`, time: '22:00' }],
		nightTail: { date: `${MONTH}-15`, time: '00:30' },
		// Works a non-optional holiday, so that day renders as worked rather
		// than muted for this employee.
		extraWork: [`${MONTH}-05`],
	},
	'E2E-EMP-0001': {
		serial: SERIAL_A,
		inHour: 8,
		outHour: 16,
		outMinute: 55,
		// The device reported no direction at all on these days, so the report
		// has to infer one.
		directionless: [`${MONTH}-03`, `${MONTH}-04`],
	},
	'E2E-EMP-0002': {
		serial: SERIAL_B,
		inHour: 9,
		outHour: 18,
		outMinute: 10,
		// A second device on this day: two serials, one pooled span.
		multiDeviceDay: [`${MONTH}-08`],
	},
	'E2E-ALLOC-06': {
		serial: SERIAL_B,
		inHour: 10,
		outHour: 19,
		outMinute: 5,
		// Works a Sunday, so that day renders as worked rather than muted.
		extraWork: [`${MONTH}-06`],
	},
};

/** The ordinary shape, for an employee the plan does not name. */
const DEFAULT_PLAN = {
	serial: SERIAL_A,
	inHour: 9,
	outHour: 17,
	outMinute: 30,
};

/** Employees who get no `user_activity_assignments` row, so Logged Hours is absent. */
const SKIP_LOGGED_HOURS = new Set(['E2E-EMP-0002']);

/** The marker that makes a seeded Logged Hours row findable and removable. */
const LOGGED_HOURS_ACTIVITY = 'Seeded attendance-report dev work';

/** Dates the seeded non-optional holidays fall on, so those days do not count as working. */
const NON_OPTIONAL_HOLIDAY_DATES = new Set(
	HOLIDAYS.filter((holiday) => !holiday.optional).map((holiday) => holiday.date)
);

/**
 * A day that is not a working day: the weekly-off rule (ADR-0004) or an active
 * non-optional holiday. An optional holiday is a working day.
 */
function isNonWorkingDate(date) {
	return isWeeklyOff(date) || NON_OPTIONAL_HOLIDAY_DATES.has(date);
}

/** Deterministic jitter, so two runs produce the same month. */
function jitter(seed, spread) {
	const value = Math.abs(Math.sin(seed * 12.9898) * 43758.5453);
	return Math.floor((value - Math.floor(value)) * spread);
}

function daysInMonth(month) {
	const year = Number(month.slice(0, 4));
	const index = Number(month.slice(5, 7)) - 1;
	const out = [];
	const cursor = new Date(Date.UTC(year, index, 1));
	while (cursor.getUTCMonth() === index) {
		out.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
}

const pad = (value) => String(value).padStart(2, '0');
const clock = (hour, minute) => `${pad(hour)}:${pad(minute)}:00`;

/**
 * One employee's Punches for the month, in device order: the rows
 * `attendance_logs` holds. A day is skipped when it is not a working day,
 * unless the employee's plan names it in `extraWork` — that is what makes a
 * worked holiday or a worked Sunday render as worked rather than muted.
 */
function buildPunches(employee, plan, days) {
	const rows = [];
	const code = employee.smartoffice_code;

	for (const date of days) {
		const nonWorking = isNonWorkingDate(date);
		const worked = plan.extraWork?.includes(date) === true;
		if (nonWorking && !worked) continue;

		const seed = Number(date.replaceAll('-', ''));
		const lone = plan.lonePunch?.includes(date);
		const three = plan.threePunch?.includes(date);
		const shift = plan.nightShift?.find((entry) => entry.date === date);
		const tail = plan.nightTail?.date === date ? plan.nightTail.time : null;
		const multi = plan.multiDeviceDay?.includes(date);
		const noDirection = plan.directionless?.includes(date);

		const times = [];
		if (lone) {
			times.push(clock(plan.inHour + jitter(seed, 2), jitter(seed + 1, 60)));
		} else if (shift) {
			times.push(`${shift.time}:00`);
		} else if (tail) {
			times.push(`${tail}:00`);
		} else if (three) {
			times.push(clock(plan.inHour + jitter(seed, 2), jitter(seed + 1, 60)));
			times.push(clock(12, jitter(seed + 2, 60)));
			times.push(clock(plan.outHour - 1, jitter(seed + 3, 60)));
		} else {
			times.push(clock(plan.inHour + jitter(seed, 2), jitter(seed + 1, 60)));
			times.push(
				clock(plan.outHour, (plan.outMinute + jitter(seed + 4, 25)) % 60)
			);
		}

		for (const [index, time] of times.entries()) {
			// A second device takes every other Punch, so the day shows two
			// serials and still one span.
			const serial =
				multi && index % 2 === 1 ? SERIAL_B : multi ? SERIAL_A : plan.serial;
			rows.push({
				employee_code: code,
				log_date: `${date} ${time}`,
				serial_number: serial,
				direction: noDirection ? null : index % 2 === 0 ? 'in' : 'out',
				employee_id: employee.id,
			});
		}
	}

	return rows;
}

async function main() {
	const connection = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT) || 3306,
		user: target.user,
		password: target.password,
		database: target.database,
		multipleStatements: false,
		connectTimeout: 10_000,
	});

	const monthStart = `${MONTH}-01`;
	const spanStart = new Date(`${monthStart}T00:00:00Z`);
	spanStart.setUTCDate(spanStart.getUTCDate() - 1);
	const spanEnd = new Date(
		Date.UTC(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)), 1)
	);
	const from = spanStart.toISOString().slice(0, 19).replace('T', ' ');
	const to = spanEnd.toISOString().slice(0, 19).replace('T', ' ');
	const days = daysInMonth(MONTH);

	try {
		await connection.beginTransaction();

		// 1. The roster the report filters on.
		const [roster] = await connection.execute(
			`SELECT id, employee_id, smartoffice_code, workplace,
			        CONCAT_WS(' ', first_name, last_name) AS name
			   FROM employees
			  WHERE isDelete = 0 AND status = 'active' AND employee_type = 'Payroll'
			  ORDER BY id`
		);
		if (roster.length === 0) {
			throw new Error(
				'No Payroll employees on the roster. Nothing to seed against.'
			);
		}

		const enrolled = [];
		const codes = new Map();
		/** `employees.employee_id` → row id, for the plan and status lookups. */
		const employeeIdByCode = new Map();
		for (const [index, employee] of roster.entries()) {
			// Rahul already carries a device code; leave it alone. Everyone else
			// gets a deterministic one derived from their position on the roster.
			const code = employee.smartoffice_code || String(10 + index);
			codes.set(code, employee.id);
			employeeIdByCode.set(employee.employee_id, employee.id);
			enrolled.push({
				id: employee.id,
				employee_id: employee.employee_id,
				name: employee.name,
				smartoffice_code: code,
			});
			if (!employee.smartoffice_code) {
				await connection.execute(
					'UPDATE employees SET smartoffice_code = ? WHERE id = ?',
					[code, employee.id]
				);
			}
			// The report covers one workplace. Without this the report filters
			// every seeded employee out and shows an empty grid.
			await connection.execute(
				'UPDATE employees SET workplace = ?, updated_at = NOW() WHERE id = ?',
				[WORKPLACE, employee.id]
			);
		}

		// 2. Punches. Delete first, so a re-run is a fresh month.
		const codeList = [...codes.keys()];
		const placeholders = codeList.map(() => '?').join(', ');
		const [deleted] = await connection.execute(
			`DELETE FROM attendance_logs
			  WHERE (employee_code IN (${placeholders}) OR employee_code = ?)
			    AND log_date >= ? AND log_date < ?`,
			[...codeList, UNMAPPED_CODE, from, to]
		);

		const punchRows = [];
		for (const employee of enrolled) {
			punchRows.push(
				...buildPunches(
					employee,
					PUNCH_PLAN[employee.employee_id] ?? DEFAULT_PLAN,
					days
				)
			);
		}

		// A few Punches under a code nobody is enrolled under.
		for (const date of [`${MONTH}-07`, `${MONTH}-21`]) {
			punchRows.push({
				employee_code: UNMAPPED_CODE,
				log_date: `${date} 08:52:00`,
				serial_number: UNMAPPED_SERIAL,
				direction: 'in',
				employee_id: null,
			});
			punchRows.push({
				employee_code: UNMAPPED_CODE,
				log_date: `${date} 17:31:00`,
				serial_number: UNMAPPED_SERIAL,
				direction: 'out',
				employee_id: null,
			});
		}

		for (const row of punchRows) {
			await connection.execute(
				`INSERT INTO attendance_logs
				   (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				[
					row.employee_code,
					row.log_date,
					row.serial_number,
					row.direction,
					JSON.stringify({
						EmployeeCode: row.employee_code,
						LogDate: row.log_date,
						SerialNumber: row.serial_number,
						Direction: row.direction ?? '',
					}),
					row.employee_id,
				]
			);
		}

		// 3. Holidays. Idempotent by name, so a re-run updates rather than duplicates.
		for (const holiday of HOLIDAYS) {
			await connection.execute(
				`INSERT INTO holiday_master (name, date, type, is_optional, is_active, description)
				 VALUES (?, ?, ?, ?, 1, ?)
				 ON DUPLICATE KEY UPDATE date = VALUES(date), is_optional = VALUES(is_optional), is_active = 1`,
				[
					holiday.name,
					holiday.date,
					holiday.optional ? 'optional' : 'national',
					holiday.optional ? 1 : 0,
					'Seeded for the Attendance Report dev run.',
				]
			);
		}

		// 4. Authored statuses, scoped to the seeded month. Delete first, so a
		// re-run cannot leave a status behind that this run no longer writes.
		const enrolledIds = enrolled.map((employee) => employee.id);
		const idPlaceholders = enrolledIds.map(() => '?').join(', ');
		const [removedStatuses] = await connection.execute(
			`DELETE FROM employee_attendance
			  WHERE attendance_date >= ? AND attendance_date < ?
			    AND employee_id IN (${idPlaceholders})`,
			[monthStart, spanEnd.toISOString().slice(0, 10), ...enrolledIds]
		);
		for (const entry of AUTHORED_STATUSES) {
			const employeeId = employeeIdByCode.get(entry.employee);
			if (employeeId == null) continue;
			await connection.execute(
				`INSERT INTO employee_attendance
				   (employee_id, attendance_date, status, in_time, out_time, overtime_hours, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, 0, NOW(), NOW())
				 ON DUPLICATE KEY UPDATE status = VALUES(status), in_time = VALUES(in_time),
				   out_time = VALUES(out_time), updated_at = NOW()`,
				[employeeId, entry.date, entry.status, entry.in, entry.out]
			);
		}

		// 5. Logged Hours, one assignment per employee who is not skipped.
		// Delete first, so a re-run does not double everyone's month.
		const [removedActivity] = await connection.execute(
			'DELETE FROM user_activity_assignments WHERE activity_name = ?',
			[LOGGED_HOURS_ACTIVITY]
		);

		// `user_id` is NOT NULL, and only Rahul has a user row. The Logged
		// Hours resolver reads the assignment's own `employee_id` first, so a
		// shared dev user is an honest filler: it changes who the row appears
		// under in the activity UI, never whose hours this month reports.
		const [userRows] = await connection.execute(
			`SELECT employee_id, MIN(id) AS user_id FROM users
			  WHERE isDelete = 0 GROUP BY employee_id`
		);
		const userByEmployee = new Map(
			userRows
				.filter((row) => row.employee_id != null)
				.map((row) => [Number(row.employee_id), row.user_id])
		);
		const [fallbackUser] = await connection.execute(
			'SELECT MIN(id) AS id FROM users WHERE isDelete = 0'
		);
		const fallbackUserId = fallbackUser[0]?.id;
		if (fallbackUserId == null) {
			throw new Error('No user row to own a seeded activity assignment.');
		}

		const [existingProject] = await connection.execute(
			'SELECT project_id FROM projects ORDER BY project_id LIMIT 1'
		);
		const projectId = existingProject[0]?.project_id ?? null;
		let loggedHoursRows = 0;
		for (const employee of enrolled) {
			if (SKIP_LOGGED_HOURS.has(employee.employee_id)) continue;
			// Logged Hours follow the same working calendar as the Punches, so a
			// non-optional holiday carries neither and can mute.
			const entries = days
				.filter((date) => !isNonWorkingDate(date))
				.map((date) => ({
					date,
					hours: 8,
					qty_done: 2,
				}));
			await connection.execute(
				`INSERT INTO user_activity_assignments
				   (id, user_id, employee_id, project_id, activity_name, daily_entries)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					userByEmployee.get(employee.id) ?? fallbackUserId,
					employee.id,
					projectId,
					LOGGED_HOURS_ACTIVITY,
					JSON.stringify(entries),
				]
			);
			loggedHoursRows += 1;
		}

		await connection.commit();

		// ─── Report ────────────────────────────────────────────────────
		const byEmployee = new Map();
		for (const row of punchRows) {
			const bucket = byEmployee.get(row.employee_code) ?? [];
			bucket.push(row);
			byEmployee.set(row.employee_code, bucket);
		}

		console.log(`\nSeeded ${target.database} for ${MONTH}.`);
		console.log(
			`Roster: ${enrolled.length} Payroll employees at ${WORKPLACE}, ${punchRows.length} Punches (${punchRows.length - 4} mapped, 4 unmapped).`
		);
		console.log(
			`Deleted ${deleted.affectedRows} Punches and ${removedActivity.affectedRows} Logged Hours rows from the window.`
		);
		console.log(
			`Holidays: ${HOLIDAYS.length}. Authored statuses: ${AUTHORED_STATUSES.length}. Logged Hours rows: ${loggedHoursRows}.`
		);
		console.log(
			`Cleaned ${removedStatuses.affectedRows} old status rows in the month.`
		);
		console.log('\nEmployee            code  punches  Logged Hours');
		for (const employee of enrolled) {
			const punches = byEmployee.get(employee.smartoffice_code)?.length ?? 0;
			const hours = SKIP_LOGGED_HOURS.has(employee.employee_id)
				? 'absent'
				: '8 per working day';
			console.log(
				`${String(employee.name).padEnd(19)} ${String(employee.smartoffice_code).padEnd(5)} ${String(punches).padEnd(8)} ${hours}`
			);
		}
		console.log('\nWhat the page will show:');
		console.log(`  night shift on ${MONTH}-14, Out ${MONTH}-15 00:30`);
		console.log(`  lone Punch on ${MONTH}-09, an em dash for Out`);
		console.log(`  three Punches on ${MONTH}-11, middle one ignored`);
		console.log(`  no device direction on ${MONTH}-03 and ${MONTH}-04`);
		console.log(`  two devices on ${MONTH}-08`);
		console.log(`  worked holidays and Sundays, so they do not mute`);
		console.log(
			`  ${UNMAPPED_CODE} Punches on ${MONTH}-07 and ${MONTH}-21, amber strip`
		);
		console.log(`  HD / PL / A / WO / SL / LWP badges`);
		console.log(
			`\nOpen the Attendance Report and it defaults to ${MONTH}. Undo is in the rollback lines below.`
		);
		console.log('\nRollback (run only if you want the month gone):');
		for (const employee of enrolled) {
			console.log(
				`  UPDATE employees SET smartoffice_code = NULL WHERE id = ${employee.id};`
			);
		}
		console.log(
			`  -- restore the workplace you had before this seed:\n  UPDATE employees SET workplace = NULL WHERE id IN (${enrolled
				.map((employee) => employee.id)
				.join(', ')});`
		);
		console.log(
			`  DELETE FROM attendance_logs WHERE log_date >= '${from}' AND log_date < '${to}';`
		);
		for (const holiday of HOLIDAYS) {
			console.log(
				`  DELETE FROM holiday_master WHERE name = '${holiday.name}';`
			);
		}
		console.log(
			`  DELETE FROM employee_attendance WHERE attendance_date >= '${monthStart}' AND attendance_date < '${spanEnd.toISOString().slice(0, 10)}';`
		);
		console.log(
			`  DELETE FROM user_activity_assignments WHERE activity_name = '${LOGGED_HOURS_ACTIVITY}';`
		);
		console.log('');
	} catch (error) {
		await connection.rollback();
		console.error(`\nSeed failed and rolled back: ${error.message}`);
		process.exitCode = 1;
	} finally {
		await connection.end();
	}
}

main();
