/**
 * Server-side data fetch + pure transforms for the Attendance report.
 *
 * Shared by GET /api/reports/attendance-report (route.ts). The report is a
 * sanity-check view over raw Smart Office biometric punches: every
 * `attendance_logs` row joined to the Accent employee it mapped to
 * (`employees.smartoffice_code` = `attendance_logs.employee_code`), with
 * the daily in/out direction inferred when the device didn't send one
 * (face-scan units routinely leave `AttDirection` blank — first punch of
 * the day = in, next = out).
 *
 * Pure helpers (`resolveDirection`, `applyInferredDirections`, `buildStats`,
 * `monthLabel`) are exported for unit tests.
 */

import { query } from '@/utils/database';

// ─── Public types ───────────────────────────────────────────────────

export type PunchDirection = 'in' | 'out' | 'unknown';

export interface ArEmployee {
	id: number;
	/** Accent's own employee code (employees.employee_id) */
	employee_id: string;
	name: string;
	department: string | null;
	/** Smart Office code the biometric punches arrive under */
	smartoffice_code: string | null;
}

export interface ArPunch {
	id: number;
	/** Smart Office employee code (attendance_logs.employee_code) */
	employee_code: string;
	/** Full device timestamp 'YYYY-MM-DD HH:mm:ss' */
	log_date: string;
	/** 'YYYY-MM-DD' */
	date: string;
	/** 'HH:mm:ss' */
	time: string;
	serial_number: string;
	/** Raw device direction, or '' when none */
	raw_direction: string;
	/** Resolved/inferred direction */
	direction: PunchDirection;
	/** Accent employee the punch mapped to, null when unmapped */
	employee_id: number | null;
	employee_name: string | null;
	/** employees.employee_id when mapped */
	acc_employee_code: string | null;
}

export interface ArStats {
	total_punches: number;
	mapped_punches: number;
	unmapped_punches: number;
	distinct_days: number;
	distinct_employees: number;
	distinct_devices: number;
}

export interface ArDevice {
	serial_number: string;
	punch_count: number;
}

export interface ArMeta {
	employees: ArEmployee[];
	/** YYYY-MM months with logs, newest first */
	months: string[];
	/** Latest month with logs, or null when empty */
	latest_month: string | null;
	devices: ArDevice[];
	has_data: boolean;
}

export interface ArData {
	from: string;
	to: string;
	punches: ArPunch[];
	stats: ArStats;
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

/** Cap on rows returned by the punch query — this is a sanity view. */
const MAX_PUNCHES = 5000;

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

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

/** Normalize a raw device direction; blank/unknown values → 'unknown'. */
export function resolveDirection(
	raw: string | null | undefined
): PunchDirection {
	if (!raw) return 'unknown';
	const normalized = raw.trim().toLowerCase();
	if (normalized === 'in') return 'in';
	if (normalized === 'out') return 'out';
	return 'unknown';
}

interface DirectionSource {
	employee_code: string;
	/** 'YYYY-MM-DD HH:mm:ss' */
	log_date: string;
	direction?: string | null;
}

/**
 * Fill in missing directions by alternating in → out per employee per day.
 *
 * Face-scan units leave `AttDirection` blank, so the direction is inferred
 * from punch order: first punch of the day = in, next = out, and so on.
 * Device-provided directions are always kept. Input order is preserved —
 * only the `direction` field changes.
 */
export function applyInferredDirections<P extends DirectionSource>(
	punches: P[]
): (P & { direction: PunchDirection })[] {
	// Indices per (employee_code, date), sorted by punch time so the
	// alternating assignment follows the day's real sequence.
	const buckets = new Map<string, number[]>();
	punches.forEach((punch, index) => {
		const date = punch.log_date.slice(0, 10);
		const key = `${punch.employee_code}|${date}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(index);
		else buckets.set(key, [index]);
	});
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) => (punches[a].log_date < punches[b].log_date ? -1 : 1));
	}

	const result: (P & { direction: PunchDirection })[] = punches.map(
		(punch) => ({ ...punch, direction: 'unknown' })
	);
	for (const bucket of buckets.values()) {
		// Every punch in the day advances the position — a device-reported
		// 'in' followed by a blank punch yields 'out' for the blank.
		let position = 0;
		for (const index of bucket) {
			const resolved = resolveDirection(punches[index].direction);
			result[index].direction =
				resolved === 'unknown' ? (position % 2 === 0 ? 'in' : 'out') : resolved;
			position++;
		}
	}
	return result;
}

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

// ─── Server data fetch ──────────────────────────────────────────────

/** Employees, months with logs, and devices for the filter bar. */
export async function fetchAttendanceMeta(): Promise<ArMeta> {
	const [employeeRows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, smartoffice_code
		 FROM employees
		 WHERE isDelete = 0
		 ORDER BY first_name, last_name`
	)) as [DbRow[], unknown];

	const employees: ArEmployee[] = employeeRows.map((r) => ({
		id: n(r, 'id'),
		employee_id: s(r, 'employee_id'),
		name: s(r, 'name') || `Employee ${s(r, 'id')}`,
		department: s(r, 'department', '') || null,
		smartoffice_code: s(r, 'smartoffice_code', '') || null,
	}));

	let months: string[] = [];
	let devices: ArDevice[] = [];
	try {
		const [monthRows] = (await query(
			`SELECT DATE_FORMAT(log_date, '%Y-%m') AS month
			 FROM attendance_logs
			 GROUP BY month
			 ORDER BY month DESC`
		)) as [DbRow[], unknown];
		months = monthRows.map((r) => s(r, 'month')).filter(Boolean);

		const [deviceRows] = (await query(
			`SELECT serial_number, COUNT(*) AS punch_count
			 FROM attendance_logs
			 GROUP BY serial_number
			 ORDER BY punch_count DESC, serial_number`
		)) as [DbRow[], unknown];
		devices = deviceRows.map((r) => ({
			serial_number: s(r, 'serial_number'),
			punch_count: n(r, 'punch_count'),
		}));
	} catch {
		/* attendance_logs may be empty/missing — treat as no data yet */
	}

	const latest = months[0] ?? null;
	return {
		employees,
		months,
		latest_month: latest,
		devices,
		has_data: !!latest,
	};
}

/** Punches in a date range (inclusive), optionally filtered by employee/device. */
export async function fetchAttendanceData(options: {
	from: string;
	to: string;
	employeeId?: number | null;
	device?: string | null;
}): Promise<ArData> {
	const { from, to, employeeId = null, device = null } = options;
	// Device timestamps are second-precision ('YYYY-MM-DD HH:mm:ss'); an
	// explicit inclusive upper bound avoids DATE_ADD(?, INTERVAL …) which
	// MariaDB rejects in prepared statements with string params.
	const conditions = ['al.log_date >= ?', 'al.log_date <= ?'];
	const params: (string | number)[] = [from, `${to} 23:59:59`];
	if (employeeId) {
		conditions.push('al.employee_id = ?');
		params.push(employeeId);
	}
	if (device) {
		conditions.push('al.serial_number = ?');
		params.push(device);
	}

	const sql = `SELECT al.id, al.employee_code,
		        DATE_FORMAT(al.log_date, '%Y-%m-%d') AS date,
		        DATE_FORMAT(al.log_date, '%H:%i:%s') AS time,
		        al.log_date, al.serial_number, al.direction,
		        al.employee_id,
		        CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
		        e.employee_id AS acc_employee_code
		 FROM attendance_logs al
		 LEFT JOIN employees e ON e.id = al.employee_id
		 WHERE ${conditions.join(' AND ')}
		 ORDER BY al.log_date DESC, al.employee_code
		 LIMIT ${MAX_PUNCHES}`;
	const [rows] = (await query(sql, params)) as [DbRow[], unknown];

	const punches: ArPunch[] = applyInferredDirections(
		rows.map((r) => ({
			id: n(r, 'id'),
			employee_code: s(r, 'employee_code'),
			log_date: s(r, 'log_date'),
			date: s(r, 'date'),
			time: s(r, 'time'),
			serial_number: s(r, 'serial_number'),
			raw_direction: s(r, 'direction', '') || '',
			direction: s(r, 'direction', '') || null,
			employee_id: r['employee_id'] == null ? null : n(r, 'employee_id'),
			employee_name: s(r, 'employee_name', '') || null,
			acc_employee_code: s(r, 'acc_employee_code', '') || null,
		}))
	);

	return { from, to, punches, stats: buildStats(punches) };
}
