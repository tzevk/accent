/**
 * Server-side data fetch + pure transforms for the Attendance report.
 *
 * Shared by GET /api/reports/attendance-report (route.ts). The report is a
 * month matrix: every Employee on the Payroll roster is a row and every day of
 * the month is a column. Each cell carries two independent figures side by
 * side and never derives one from the other:
 *
 *  - **Logged Hours** — the canonical numerator from `@/lib/logged-hours`
 *    (`hoursByDateForMonth`, uncapped per ADR-0010). This is the same module
 *    payroll prices, so the figures equal payroll's exactly.
 *  - **Time Present** — a measured span from `@/lib/time-present`
 *    (first punch of the day → last, direction-agnostic, pooled across
 *    devices, with the bounded cross-midnight merge of issue #281).
 *
 * The roster comes from `./roster` (`selectPayrollRoster`): the report filters
 * on the Employee record, payroll filters on `salary_profile.salary_type`, and
 * the accepted divergence is reported on `ArData.disclosure` rather than
 * hidden.
 *
 * Hours are never re-derived here — a second hours parser would drift from the
 * canonical one. Punch direction normalization lives in `@/lib/punch`;
 * `resolveDirection` is re-exported here for the webhook route that imports it
 * through this module.
 */

import { query } from '@/utils/database';
import { computeTimePresent } from '@/lib/time-present';
import { hoursByDateForMonth } from '@/lib/logged-hours';
import { applyInferredDirections, type PunchDirection } from '@/lib/punch';
import {
	selectPayrollRoster,
	type RosterDisclosure,
	type RosterEmployeeInput,
	type RosterMember,
} from './roster';

export { resolveDirection } from '@/lib/punch';

// ─── Public types ───────────────────────────────────────────────────

/** The punch fields the month's stats strip reads. */
export interface ArPunch {
	/** Smart Office employee code (attendance_logs.employee_code) */
	employee_code: string;
	/** Full device timestamp 'YYYY-MM-DD HH:mm:ss' */
	log_date: string;
	/** 'YYYY-MM-DD' */
	date: string;
	/** Biometric device serial number */
	serial_number: string;
	/** Accent employee the punch mapped to, null when unmapped */
	employee_id: number | null;
}

export interface ArStats {
	total_punches: number;
	mapped_punches: number;
	unmapped_punches: number;
	distinct_days: number;
	distinct_employees: number;
	distinct_devices: number;
}

/**
 * One raw Punch of the month, as the drill-down needs it. Carried once on
 * `ArData` (not per cell) so the modal never needs a second round-trip.
 */
export interface ArMonthPunch extends ArPunch {
	/** `attendance_logs.id` — a stable React key for the drill-down row. */
	id: number;
	/** 'HH:MM:SS' device wall clock of this punch. */
	time: string;
	/**
	 * The device's own direction, or the inferred one (first punch of the day
	 * = in, next = out) when the device reported none — resolved once here so
	 * the grid and the drill-down badge never disagree.
	 */
	direction: PunchDirection;
}

/** One employee-day cell of the matrix. */
export interface ArCell {
	/** 'YYYY-MM-DD' */
	date: string;
	/**
	 * Time Present hours, or null when the day is uncomputable — no punches, a
	 * lone punch with no partner, or a refused cross-midnight merge. Never 0:
	 * zero would read as "was there and left instantly" (ADR / @/lib/time-present).
	 */
	hours: number | null;
	/**
	 * Canonical Logged Hours for the day, uncapped (ADR-0010), or null when
	 * nothing was logged. Independent of `hours` — never derived from it.
	 */
	logged_hours: number | null;
	/** Authored `employee_attendance.status` for the employee-day, if any. */
	status: string | null;
	/** `attendance_logs` rows recorded for this employee-day. */
	punch_count: number;
	/** Time Present refused to merge the next day's punch into this day. */
	merge_refused: boolean;
}

/** One Employee down the left of the matrix. */
export interface ArMatrixRow {
	/** Accent employee row id */
	id: number;
	/** Accent's own employee code (employees.employee_id) */
	employee_id: string;
	name: string;
	department: string | null;
	/** Smart Office code the device punches arrive under; null when unenrolled */
	smartoffice_code: string | null;
	/** Punches recorded under that code for this employee in the month */
	punch_count: number;
	/** One cell per day of the month, in date order */
	cells: ArCell[];
}

export interface ArMeta {
	/** Latest month with logs, or null when empty */
	latest_month: string | null;
	has_data: boolean;
}

/**
 * The month's holidays, split the way payroll's Basis Hours treats them:
 * `non_optional` are excluded from the working days, `optional` are not.
 */
export interface ArHolidays {
	non_optional: string[];
	optional: string[];
}

export interface ArData {
	/** 'YYYY-MM' */
	month: string;
	/** Every 'YYYY-MM-DD' in the month, in order — the matrix columns */
	days: string[];
	/** Every Payroll employee, whether or not they punched or have a profile */
	employees: ArMatrixRow[];
	stats: ArStats;
	/** What the roster filter dropped, and why; null when it dropped nobody */
	disclosure: RosterDisclosure | null;
	/** Active holidays of the month, split optional / non-optional */
	holidays: ArHolidays;
	/** Distinct device serials in the month — the drill-down device filter */
	devices: string[];
	/**
	 * Every Punch of the month, mapped and unmapped. Unmapped rows are here on
	 * purpose: `aggregateUnmappedCodes` reports them, and no grid row is ever
	 * keyed off one (see `punchBucketsByEmployee`).
	 */
	punches: ArMonthPunch[];
}

// ─── Constants ──────────────────────────────────────────────────────

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

// mysql2 rows are plain objects keyed by column name; read them through
// narrow accessors so we never reach for `any`.
type DbRow = Record<string, unknown>;

function s(row: DbRow, key: string, fallback = ''): string {
	const v = row[key];
	if (v == null) return fallback;
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return fallback;
}

function n(row: DbRow, key: string, fallback = 0): number {
	const v = row[key];
	if (v == null || v === '') return fallback;
	const num = typeof v === 'number' ? v : parseFloat(String(v));
	return Number.isFinite(num) ? num : fallback;
}

/** Round to two places — the precision the canonical hours modules carry. */
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

// ─── Pure helpers ───────────────────────────────────────────────────

/** Aggregate raw punches into the report stats strip. */
export function buildStats(punches: ArPunch[]): ArStats {
	const days = new Set<string>();
	const employees = new Set<string>();
	const devices = new Set<string>();
	let mapped = 0;
	for (const punch of punches) {
		days.add(punch.date);
		employees.add(punch.employee_code);
		devices.add(punch.serial_number);
		if (punch.employee_id != null) mapped++;
	}
	return {
		total_punches: punches.length,
		mapped_punches: mapped,
		unmapped_punches: punches.length - mapped,
		distinct_days: days.size,
		distinct_employees: employees.size,
		distinct_devices: devices.size,
	};
}

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (!y || !m || m < 1 || m > 12) return month;
	return `${MONTH_NAMES[m - 1]} ${y}`;
}

interface CalendarMonth {
	/** Inclusive lower bound of the month, device wall clock. */
	from: string;
	/**
	 * Exclusive upper bound — the next month's first day. A half-open range
	 * on a DATETIME keeps the month index-friendly and needs no DATE_ADD,
	 * which MariaDB rejects with string params in prepared statements.
	 */
	to: string;
	days: string[];
}

/** The device-timestamp bounds and day list for 'YYYY-MM'; null if invalid. */
function calendarMonth(month: string): CalendarMonth | null {
	const [year, number] = month.split('-').map(Number);
	if (!year || !number || number < 1 || number > 12) return null;
	const total = new Date(Date.UTC(year, number, 0)).getUTCDate();
	const days: string[] = [];
	for (let day = 1; day <= total; day += 1) {
		days.push(`${month}-${String(day).padStart(2, '0')}`);
	}
	const nextMonth =
		number === 12
			? `${year + 1}-01`
			: `${month.slice(0, 4)}-${String(number + 1).padStart(2, '0')}`;
	return {
		from: `${month}-01 00:00:00`,
		to: `${nextMonth}-01 00:00:00`,
		days,
	};
}

/** `('a', 'b', …)` → `'?, ?, …'`; empty input yields a never-true condition. */
function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

// ─── Server data fetch ──────────────────────────────────────────────

/** Latest month with logs, for the month picker's default. */
export async function fetchAttendanceMeta(): Promise<ArMeta> {
	let latestMonth: string | null = null;
	try {
		const [monthRows] = (await query(
			`SELECT DATE_FORMAT(log_date, '%Y-%m') AS month
			 FROM attendance_logs
			 GROUP BY month
			 ORDER BY month DESC
			 LIMIT 1`
		)) as [DbRow[], unknown];
		latestMonth = monthRows[0] ? s(monthRows[0], 'month') || null : null;
	} catch {
		/* attendance_logs may be missing — treat as no data yet */
	}

	return { latest_month: latestMonth, has_data: !!latestMonth };
}

/** The `ArData` for a month the calendar cannot describe. */
function emptyMonth(month: string): ArData {
	return {
		month,
		days: [],
		employees: [],
		stats: buildStats([]),
		disclosure: null,
		holidays: { non_optional: [], optional: [] },
		devices: [],
		punches: [],
	};
}

/** One `employees` row, in the shape the roster filter and the reader share. */
interface DirectoryRow {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	smartoffice_code: string | null;
	employee_type: string | null;
	status: string;
	isDelete: number;
	email: string;
	username: string | null;
}

/**
 * The whole employee directory — not a filtered subset. `selectPayrollRoster`
 * owns the filter and reports what it dropped, so the SQL layer must not
 * pre-filter it away.
 */
async function fetchEmployeeDirectory(): Promise<DirectoryRow[]> {
	const [rows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, smartoffice_code, employee_type, status, isDelete,
		        email, username
		 FROM employees`
	)) as [DbRow[], unknown];

	return rows.map((row) => ({
		id: n(row, 'id'),
		employee_id: s(row, 'employee_id'),
		name: s(row, 'name') || `Employee ${s(row, 'id')}`,
		department: s(row, 'department') || null,
		smartoffice_code: s(row, 'smartoffice_code') || null,
		employee_type: s(row, 'employee_type') || null,
		status: s(row, 'status'),
		isDelete: n(row, 'isDelete'),
		email: s(row, 'email'),
		username: s(row, 'username') || null,
	}));
}

/** The roster filter's input for one directory row. */
function toRosterInput(row: DirectoryRow): RosterEmployeeInput {
	return {
		id: row.id,
		employee_id: row.employee_id,
		name: row.name,
		department: row.department,
		smartoffice_code: row.smartoffice_code,
		employee_type: row.employee_type,
		status: row.status,
		isDelete: row.isDelete,
	};
}

/** Every Punch of the month, with directions resolved once, device or inferred. */
async function fetchMonthPunches(
	calendar: CalendarMonth
): Promise<ArMonthPunch[]> {
	// Bounded by the month, never by a row cap: the stats strip, the drill-down
	// and the unmapped-code aggregation are all computed from every punch the
	// month holds, so a cap would silently drop punches (and employees).
	const [rows] = (await query(
		`SELECT al.id, al.employee_code, al.log_date, al.serial_number,
		        al.direction, al.employee_id
		 FROM attendance_logs al
		 WHERE al.log_date >= ? AND al.log_date < ?`,
		[calendar.from, calendar.to]
	)) as [DbRow[], unknown];

	const punches = rows.map((row) => {
		// The device timestamp is 'YYYY-MM-DD HH:mm:ss', so the calendar day
		// and the clock time are its prefixes — cheaper than asking MariaDB to
		// format every row.
		const logDate = s(row, 'log_date');
		const raw = row['direction'];
		return {
			id: n(row, 'id'),
			employee_code: s(row, 'employee_code'),
			log_date: logDate,
			date: logDate.slice(0, 10),
			time: logDate.slice(11, 19),
			serial_number: s(row, 'serial_number'),
			direction: typeof raw === 'string' ? raw : null,
			employee_id: row['employee_id'] == null ? null : n(row, 'employee_id'),
		};
	});

	return applyInferredDirections(punches);
}

/**
 * Authored Attendance Record statuses for the roster, keyed
 * `${employee_id}|${YYYY-MM-DD}`.
 *
 * `employee_attendance` carries no `isDelete` column — a row is either there
 * or it is not — so there is nothing to filter beyond the roster and the month.
 * Ordered by id so a duplicated employee-day resolves to the same row every
 * time (the last one wins).
 */
async function fetchAttendanceStatuses(
	employeeIds: number[],
	calendar: CalendarMonth
): Promise<Map<string, string>> {
	const statuses = new Map<string, string>();
	if (employeeIds.length === 0) return statuses;

	const [rows] = (await query(
		`SELECT employee_id,
		        DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
		        status
		 FROM employee_attendance
		 WHERE attendance_date >= ? AND attendance_date < ?
		   AND employee_id IN (${placeholders(employeeIds.length)})
		 ORDER BY id`,
		[calendar.from.slice(0, 10), calendar.to.slice(0, 10), ...employeeIds]
	)) as [DbRow[], unknown];

	for (const row of rows) {
		const date = s(row, 'date');
		const status = s(row, 'status');
		if (!date || !status) continue;
		statuses.set(`${n(row, 'employee_id')}|${date}`, status);
	}
	return statuses;
}

/**
 * The month's active holidays, split as payroll's Basis Hours sees them:
 * `getHolidaysForMonth(month, false)` excludes only the non-optional ones.
 */
async function fetchMonthHolidays(
	calendar: CalendarMonth
): Promise<ArHolidays> {
	const holidays: ArHolidays = { non_optional: [], optional: [] };
	const [rows] = (await query(
		`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
		        COALESCE(is_optional, 0) AS is_optional
		 FROM holiday_master
		 WHERE is_active = 1 AND date >= ? AND date < ?
		 ORDER BY date`,
		[calendar.from.slice(0, 10), calendar.to.slice(0, 10)]
	)) as [DbRow[], unknown];

	for (const row of rows) {
		const date = s(row, 'date');
		if (!date) continue;
		if (n(row, 'is_optional') === 1) holidays.optional.push(date);
		else holidays.non_optional.push(date);
	}
	return holidays;
}

/**
 * Canonical Logged Hours per roster employee, keyed `${employee_id}` → date →
 * hours (ADR-0010, uncapped).
 *
 * The employee an assignment belongs to is resolved in the order
 * `batchGetLoggedHours` in `src/utils/payroll-calculator.js` established —
 * the assignment's own `employee_id`, else the linked user's `employee_id`,
 * else a case-insensitive match on the user's email, then username — so this
 * report reads payroll's own numerator. The order is replicated here rather
 * than imported: that module owns money, and pulling the calculator into a
 * report is a coupling the report does not need. The identifier map is built
 * from the roster's employees and their linked users only, which resolves
 * identically for every employee this report reports on.
 */
async function fetchLoggedHoursByEmployee(
	members: readonly RosterMember[],
	directory: readonly DirectoryRow[],
	month: string
): Promise<Map<number, Record<string, number>>> {
	const byEmployee = new Map<number, Record<string, number>>();
	if (members.length === 0) return byEmployee;

	const directoryById = new Map(directory.map((row) => [row.id, row]));
	const identifiers = new Map<string, number>();
	const addIdentifier = (value: string | null, employeeId: number) => {
		const key = (value ?? '').trim().toLowerCase();
		if (key && !identifiers.has(key)) identifiers.set(key, employeeId);
	};
	const memberIds = members.map((member) => member.id);
	for (const member of members) {
		const row = directoryById.get(member.id);
		addIdentifier(row?.email ?? null, member.id);
		addIdentifier(row?.username ?? null, member.id);
	}

	const [userRows] = (await query(
		`SELECT employee_id, email, username FROM users
		 WHERE isDelete = 0 AND employee_id IS NOT NULL
		   AND employee_id IN (${placeholders(memberIds.length)})`,
		memberIds
	)) as [DbRow[], unknown];
	for (const row of userRows) {
		const employeeId = n(row, 'employee_id');
		if (!employeeId) continue;
		addIdentifier(s(row, 'email'), employeeId);
		addIdentifier(s(row, 'username'), employeeId);
	}

	const [assignmentRows] = (await query(
		`SELECT uaa.employee_id, uaa.daily_entries,
		        u.employee_id AS user_employee_id,
		        u.email AS user_email, u.username AS user_username
		 FROM user_activity_assignments uaa
		 LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
		 WHERE uaa.status <> 'Cancelled'
		   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
	)) as [DbRow[], unknown];

	const wanted = new Set(memberIds);
	const payloads = new Map<number, unknown[]>();
	for (const row of assignmentRows) {
		const employeeId =
			n(row, 'employee_id') ||
			n(row, 'user_employee_id') ||
			identifiers.get(s(row, 'user_email').toLowerCase()) ||
			identifiers.get(s(row, 'user_username').toLowerCase()) ||
			0;
		if (!employeeId || !wanted.has(employeeId)) continue;
		const bucket = payloads.get(employeeId);
		if (bucket) bucket.push(row['daily_entries']);
		else payloads.set(employeeId, [row['daily_entries']]);
	}

	for (const [employeeId, entries] of payloads) {
		// The canonical per-day parser, fed every non-cancelled assignment for
		// the employee at once — the same total payroll sums.
		const byDate = hoursByDateForMonth(entries, month);
		const rounded: Record<string, number> = {};
		for (const [date, hours] of Object.entries(byDate)) {
			rounded[date] = round2(hours);
		}
		byEmployee.set(employeeId, rounded);
	}
	return byEmployee;
}

/**
 * Punches grouped per `${employee_id}|${employee_code}`, the one lookup the
 * matrix makes per roster member.
 *
 * This is where an unmapped Punch is proven harmless: a row is only ever read
 * under a key built from the roster member's own id AND their enrolled device
 * code, and `attendance_logs.employee_id` is exactly what the webhook set from
 * that same `employees.smartoffice_code` lookup. An unmapped Punch has no
 * employee id, so it can never be read as anybody's presence and never reaches
 * Time Present — while still travelling to the page for `aggregateUnmappedCodes`.
 */
function punchBucketsByEmployee(
	punches: readonly ArMonthPunch[]
): Map<string, ArMonthPunch[]> {
	const buckets = new Map<string, ArMonthPunch[]>();
	for (const punch of punches) {
		if (punch.employee_id == null) continue;
		const key = `${punch.employee_id}|${punch.employee_code}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(punch);
		else buckets.set(key, [punch]);
	}
	return buckets;
}

/**
 * The month matrix: the whole Payroll roster down, every day of `month` across,
 * and both figures on every cell.
 */
export async function fetchAttendanceData(options: {
	month: string;
}): Promise<ArData> {
	const { month } = options;
	const calendar = calendarMonth(month);
	if (!calendar) return emptyMonth(month);

	const [punches, directory] = await Promise.all([
		fetchMonthPunches(calendar),
		fetchEmployeeDirectory(),
	]);

	const { roster, disclosure } = selectPayrollRoster(
		directory.map(toRosterInput)
	);
	const memberIds = roster.map((member) => member.id);

	const [statusByEmployeeDay, holidays, loggedByEmployee] = await Promise.all([
		fetchAttendanceStatuses(memberIds, calendar),
		fetchMonthHolidays(calendar),
		fetchLoggedHoursByEmployee(roster, directory, month),
	]);

	const buckets = punchBucketsByEmployee(punches);
	const devices = [
		...new Set(punches.map((punch) => punch.serial_number).filter(Boolean)),
	].sort();

	const employees: ArMatrixRow[] = roster.map((member) => {
		// Both halves must match: the id the webhook resolved the Punch to and
		// the code this member is enrolled under.
		const ownPunches =
			member.smartoffice_code == null
				? []
				: (buckets.get(`${member.id}|${member.smartoffice_code}`) ?? []);

		const hoursByDate = new Map<string, number | null>();
		const refusedDates = new Set<string>();
		for (const day of computeTimePresent(ownPunches)) {
			hoursByDate.set(day.date, day.hours);
			if (day.mergeRefused) refusedDates.add(day.date);
		}

		const punchesByDate = new Map<string, number>();
		for (const punch of ownPunches) {
			punchesByDate.set(punch.date, (punchesByDate.get(punch.date) ?? 0) + 1);
		}

		const logged = loggedByEmployee.get(member.id) ?? {};

		return {
			id: member.id,
			employee_id: member.employee_id,
			name: member.name,
			department: member.department,
			smartoffice_code: member.smartoffice_code,
			punch_count: ownPunches.length,
			// Every day of the month, so an employee who never punched is a full
			// row of blanks rather than a silently absent person.
			cells: calendar.days.map((date) => ({
				date,
				hours: hoursByDate.get(date) ?? null,
				logged_hours: logged[date] ?? null,
				status: statusByEmployeeDay.get(`${member.id}|${date}`) ?? null,
				punch_count: punchesByDate.get(date) ?? 0,
				merge_refused: refusedDates.has(date),
			})),
		};
	});

	return {
		month,
		days: calendar.days,
		employees,
		stats: buildStats(punches),
		disclosure,
		holidays,
		devices,
		punches,
	};
}
