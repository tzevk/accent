/**
 * Server-side data fetch + pure transforms for the Timesheet report.
 *
 * Shared by:
 *   - GET /api/reports/timesheet-report          (JSON, route.ts)
 *   - GET /api/reports/timesheet-report/download (Excel, download/route.ts)
 *
 * The report renders a monthly timesheet matrix for one employee, in the
 * same shape as the Excel monthly-timesheet template used by the company
 * (see docs/extras/*_TIMESHEET_*). Day-level values come from
 * `employee_attendance` (status, overtime), holiday names from
 * `holiday_master`, and the project/activity rows from
 * `user_activity_assignments`. Pure helpers (`statusKind`,
 * `hoursForStatus`, `buildSummary`, …) are exported for unit tests.
 */

import { query } from '@/utils/database';

// ─── Public types ───────────────────────────────────────────────────

export type DayType = 'working' | 'weekly_off' | 'holiday';

export type StatusKind =
	| 'present'
	| 'half_day'
	| 'weekly_off'
	| 'holiday'
	| 'absent'
	| 'leave'
	| 'other';

export interface TsEmployee {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	position: string | null;
	designation: string | null;
}

export interface TsDay {
	/** YYYY-MM-DD */
	date: string;
	/** 1–31 */
	day: number;
	/** Sun / Mon / … */
	weekday: string;
	status: string | null;
	overtime_hours: number;
	is_weekly_off: boolean;
	is_holiday: boolean;
	/** Holiday name when the date is in holiday_master */
	holiday_name: string | null;
	/** Standard (regular) hours worked that day */
	hours: number;
	day_type: DayType;
}

export interface TsProject {
	project_id: number | null;
	project_code: string;
	project_name: string;
	activity_name: string;
	discipline_name: string | null;
	status: string | null;
	estimated_hours: number;
	actual_hours: number;
	qty_assigned: number;
	qty_completed: number;
	start_date: string | null;
	due_date: string | null;
	/** Hours logged per YYYY-MM-DD (from the assignment's daily_entries, month-filtered) */
	days: Record<string, number>;
	/** Sum of `days` (rounded to 2dp) */
	total_hours: number;
}

/** Monthly normal-hours breakdown — the row/column the matrix totals use. */
export interface TsMonthlyHours {
	/** Normal hours per YYYY-MM-DD: project hours when logged, else attendance-derived */
	daily: Record<string, number>;
	/** Sum of `daily` */
	normal: number;
	/** Attendance overtime hours */
	overtime: number;
	/** normal + overtime */
	total: number;
	/** Whether the normal hours come from logged project time */
	source: 'project' | 'attendance';
}

/**
 * Screen-time tracking (user_screen_time) — actual active/idle seconds per
 * day from the client heartbeat bucket. Informational: NOT part of the
 * project/attendance hour totals.
 */
export interface TsScreenTime {
	/** Active seconds per YYYY-MM-DD, aggregated across the employee's linked users */
	days: Record<string, number>;
	/** Total active seconds in the month */
	total_active_sec: number;
	/** Total idle seconds in the month */
	total_idle_sec: number;
	/** Whether any screen-time data exists for the month */
	present: boolean;
}

export interface TsSummary {
	present_days: number;
	half_days: number;
	weekly_offs: number;
	holidays: number;
	absent_days: number;
	leave_days: number;
	standard_hours: number;
	overtime_hours: number;
	total_hours: number;
}

export interface TsSettings {
	standard_working_hours: number;
	half_day_hours: number;
}

export interface TimesheetData {
	employee: TsEmployee | null;
	/** YYYY-MM */
	month: string;
	/** 2026 */
	year: number;
	/** e.g. "March 2026" */
	month_label: string;
	days: TsDay[];
	holidays: { name: string; date: string }[];
	projects: TsProject[];
	summary: TsSummary;
	hours: TsMonthlyHours;
	screen_time: TsScreenTime;
	settings: TsSettings;
}

export interface TimesheetMeta {
	employees: TsEmployee[];
	/** YYYY-MM months that have attendance records, newest first */
	months: string[];
	/** Newest month with attendance, or null when none */
	latest_month: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────

export const LEAVE_STATUSES = new Set([
	'PL',
	'CL',
	'SL',
	'ML',
	'EL',
	'L',
	'LWP',
]);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

const DEFAULT_SETTINGS: TsSettings = {
	standard_working_hours: 8,
	half_day_hours: 4,
};

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

function toNumber(v: unknown, fallback = 0): number {
	if (v == null || v === '') return fallback;
	const num = typeof v === 'number' ? v : parseFloat(String(v));
	return Number.isFinite(num) ? num : fallback;
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

/** Classify an attendance status into a display kind. */
export function statusKind(status: string | null | undefined): StatusKind {
	if (!status) return 'other';
	const st = status.toUpperCase();
	if (st === 'P') return 'present';
	if (st === 'OT') return 'present'; // overtime day still counts as present
	if (st === 'HD') return 'half_day';
	if (st === 'WO') return 'weekly_off';
	if (st === 'H') return 'holiday';
	if (st === 'A') return 'absent';
	if (LEAVE_STATUSES.has(st)) return 'leave';
	return 'other';
}

/** Standard (regular) hours credited for an attendance status. */
export function hoursForStatus(
	status: string | null | undefined,
	settings: TsSettings = DEFAULT_SETTINGS
): number {
	const kind = statusKind(status);
	if (kind === 'present') return settings.standard_working_hours;
	if (kind === 'half_day') return settings.half_day_hours;
	return 0;
}

export function weekdayFor(date: string): string {
	const [y, m, d] = date.split('-').map(Number);
	if (!y || !m || !d) return '';
	// Date.UTC keeps the weekday stable regardless of server timezone.
	return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Resolve the day type: holiday_master wins, then weekly off, else working. */
export function dayTypeFor(
	date: string,
	holidays: Set<string>,
	isWeeklyOff: boolean
): DayType {
	if (holidays.has(date)) return 'holiday';
	if (isWeeklyOff) return 'weekly_off';
	return 'working';
}

/**
 * Build the day matrix for a month from raw attendance rows.
 * `month` is 'YYYY-MM'; rows are { date: 'YYYY-MM-DD', status, overtime_hours, is_weekly_off, is_holiday }.
 * Dates with no attendance record are still included (status null) so the
 * grid always shows every day of the month, like the Excel template.
 */
export function buildDays(
	month: string,
	attendanceRows: DbRow[],
	holidays: { name: string; date: string }[],
	settings: TsSettings = DEFAULT_SETTINGS
): TsDay[] {
	const [yearStr, monthStr] = month.split('-');
	const year = Number(yearStr);
	const monthNum = Number(monthStr);
	if (!year || !monthNum) return [];

	const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
	const holidaySet = new Set(holidays.map((h) => h.date));
	const holidayNameByDate = new Map(holidays.map((h) => [h.date, h.name]));
	const rowByDate = new Map<string, DbRow>();
	for (const row of attendanceRows) {
		const d = s(row, 'date');
		if (d) rowByDate.set(d, row);
	}

	const days: TsDay[] = [];
	for (let day = 1; day <= daysInMonth; day++) {
		const date = `${month}-${String(day).padStart(2, '0')}`;
		const row = rowByDate.get(date);
		const rawStatus = row ? row['status'] : undefined;
		const status =
			typeof rawStatus === 'string' && rawStatus !== '' ? rawStatus : null;
		const weekday = weekdayFor(date);
		// Weekly off comes from the attendance flag when a record exists;
		// without a record, Sat/Sun are treated as weekends (the company's
		// timesheet template colors Saturday + Sunday columns).
		const isWeeklyOff = row
			? n(row, 'is_weekly_off') === 1
			: weekday === 'Sat' || weekday === 'Sun';
		const holidayName = holidayNameByDate.get(date) ?? null;
		days.push({
			date,
			day,
			weekday,
			status,
			overtime_hours: row ? n(row, 'overtime_hours') : 0,
			is_weekly_off: isWeeklyOff,
			is_holiday: holidayName != null,
			holiday_name: holidayName,
			hours: hoursForStatus(status, settings),
			day_type: dayTypeFor(date, holidaySet, isWeeklyOff),
		});
	}
	return days;
}

/** Aggregate the day matrix into the summary strip (mirrors the Excel totals). */
export function buildSummary(days: TsDay[]): TsSummary {
	let presentDays = 0;
	let halfDays = 0;
	let weeklyOffs = 0;
	let holidays = 0;
	let absentDays = 0;
	let leaveDays = 0;
	let standardHours = 0;
	let overtimeHours = 0;

	for (const day of days) {
		const kind = statusKind(day.status);
		if (kind === 'present') presentDays++;
		else if (kind === 'half_day') halfDays++;
		else if (kind === 'weekly_off') weeklyOffs++;
		else if (kind === 'holiday') holidays++;
		else if (kind === 'absent') absentDays++;
		else if (kind === 'leave') leaveDays++;
		standardHours += day.hours;
		overtimeHours += day.overtime_hours;
	}

	return {
		present_days: presentDays,
		half_days: halfDays,
		weekly_offs: weeklyOffs,
		holidays,
		absent_days: absentDays,
		leave_days: leaveDays,
		standard_hours: round2(standardHours),
		overtime_hours: round2(overtimeHours),
		total_hours: round2(standardHours + overtimeHours),
	};
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (!y || !m || m < 1 || m > 12) return month;
	return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ─── Project hours (daily_entries) ──────────────────────────────────

interface DailyEntryShape {
	date?: string | null;
	hours?: number | string | null;
}

function parseDailyEntries(raw: unknown): DailyEntryShape[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(e): e is DailyEntryShape => !!e && typeof e === 'object' && 'date' in e
		);
	} catch {
		return [];
	}
}

/**
 * Build the per-day project-hour rows for a month from raw assignment rows.
 *
 * Each raw row must carry the assignment columns plus `daily_entries`
 * (JSON array of { date, hours, qty_done, … }) and the project lookup
 * columns (project_code / project_name). Entries outside the month are
 * dropped; duplicate dates within one assignment are summed (a single
 * assignment can log several entries per day).
 */
export function buildProjectRows(rawRows: DbRow[], month: string): TsProject[] {
	const rows: TsProject[] = [];
	for (const r of rawRows) {
		const days: Record<string, number> = {};
		let totalHours = 0;
		for (const entry of parseDailyEntries(r.daily_entries)) {
			const date = typeof entry.date === 'string' ? entry.date : '';
			if (!date || date < `${month}-01` || date > `${month}-31`) continue;
			const hours = toNumber(entry.hours);
			if (hours <= 0) continue;
			days[date] = round2((days[date] || 0) + hours);
			totalHours += hours;
		}
		rows.push({
			project_id: n(r, 'project_id') || null,
			project_code: s(r, 'project_code'),
			project_name: s(r, 'project_name'),
			activity_name: s(r, 'activity_name') || 'Unnamed',
			discipline_name: s(r, 'discipline_name', '') || null,
			status: s(r, 'status', '') || null,
			estimated_hours: n(r, 'estimated_hours'),
			actual_hours: n(r, 'actual_hours'),
			qty_assigned: n(r, 'qty_assigned'),
			qty_completed: n(r, 'qty_completed'),
			start_date: s(r, 'start_date', '') || null,
			due_date: s(r, 'due_date', '') || null,
			days,
			total_hours: round2(totalHours),
		});
	}
	return rows;
}

/**
 * Resolve the monthly normal hours.
 *
 * When the employee logged project time in the month, those logged hours
 * ARE the normal hours (the Excel timesheet is a project-hours log).
 * Otherwise fall back to attendance-derived hours (status → 8h/4h).
 */
export function computeMonthlyHours(
	projects: TsProject[],
	days: TsDay[]
): TsMonthlyHours {
	const withProjectHours = projects.filter((p) => p.total_hours > 0);
	const daily: Record<string, number> = {};

	if (withProjectHours.length > 0) {
		for (const p of withProjectHours) {
			for (const [date, hours] of Object.entries(p.days)) {
				daily[date] = round2((daily[date] || 0) + hours);
			}
		}
	} else {
		for (const day of days) {
			if (day.hours > 0) daily[day.date] = day.hours;
		}
	}

	const normal = round2(Object.values(daily).reduce((a, b) => a + b, 0));
	const overtime = round2(days.reduce((a, d) => a + d.overtime_hours, 0));
	return {
		daily,
		normal,
		overtime,
		total: round2(normal + overtime),
		source: withProjectHours.length > 0 ? 'project' : 'attendance',
	};
}

// ─── Screen time (user_screen_time) ─────────────────────────────────

/**
 * Aggregate raw user_screen_time rows into per-day active/idle seconds.
 * Rows are { date: 'YYYY-MM-DD', active_time_seconds, idle_time_seconds }
 * and may span several linked login accounts — all are summed per day.
 */
export function buildScreenTime(rawRows: DbRow[], month: string): TsScreenTime {
	const days: Record<string, number> = {};
	let totalActiveSec = 0;
	let totalIdleSec = 0;

	for (const r of rawRows) {
		const date = s(r, 'date');
		if (!date || date < `${month}-01` || date > `${month}-31`) continue;
		const activeSec = n(r, 'active_time_seconds');
		const idleSec = n(r, 'idle_time_seconds');
		if (activeSec <= 0 && idleSec <= 0) continue;
		if (activeSec > 0) {
			days[date] = (days[date] || 0) + activeSec;
			totalActiveSec += activeSec;
		}
		totalIdleSec += idleSec;
	}

	return {
		days,
		total_active_sec: totalActiveSec,
		total_idle_sec: totalIdleSec,
		present: totalActiveSec > 0,
	};
}

// ─── Server data fetch ──────────────────────────────────────────────

/** Employees + available months for the filter bar. */
export async function fetchTimesheetMeta(): Promise<TimesheetMeta> {
	const [employeeRows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, position, designation
		 FROM employees
		 WHERE isDelete = 0 AND status = 'active'
		 ORDER BY first_name, last_name`
	)) as [DbRow[], unknown];

	const employees: TsEmployee[] = employeeRows.map((r) => ({
		id: n(r, 'id'),
		employee_id: s(r, 'employee_id'),
		name: s(r, 'name') || `Employee ${s(r, 'id')}`,
		department: s(r, 'department', '') || null,
		position: s(r, 'position', '') || null,
		designation: s(r, 'designation', '') || null,
	}));

	let months: string[] = [];
	try {
		const [monthRows] = (await query(
			`SELECT DATE_FORMAT(attendance_date, '%Y-%m') AS month
			 FROM employee_attendance
			 GROUP BY month
			 ORDER BY month DESC`
		)) as [DbRow[], unknown];
		months = monthRows.map((r) => s(r, 'month')).filter(Boolean);
	} catch {
		/* employee_attendance may be empty — treat as no months */
	}

	// Union in months with logged project hours (daily_entries) so a
	// timesheet is reachable even when no attendance was entered for that
	// month — e.g. May 2026 has project entries but no attendance rows.
	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		const monthSet = new Set(months);
		for (const row of asgRows) {
			for (const entry of parseDailyEntries(row.daily_entries)) {
				const date = typeof entry.date === 'string' ? entry.date : '';
				if (date.length >= 7) monthSet.add(date.slice(0, 7));
			}
		}
		// YYYY-MM sorts lexically, so reverse() = newest first.
		months = Array.from(monthSet).sort().reverse();
	} catch {
		/* user_activity_assignments may not exist */
	}

	// Always offer the current month so the grid can be viewed even when
	// no attendance has been entered yet.
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	if (!months.includes(currentMonth)) months.push(currentMonth);

	return { employees, months, latest_month: months[0] ?? currentMonth };
}

/** Full timesheet payload for one employee + month. */
export async function fetchTimesheetData(
	employeeId: number,
	month: string
): Promise<TimesheetData> {
	const [employeeRows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, position, designation, email, username
		 FROM employees
		 WHERE id = ? AND isDelete = 0`,
		[employeeId]
	)) as [DbRow[], unknown];

	const employee: TsEmployee | null =
		employeeRows.length > 0
			? {
					id: n(employeeRows[0], 'id'),
					employee_id: s(employeeRows[0], 'employee_id'),
					name: s(employeeRows[0], 'name') || `Employee ${employeeId}`,
					department: s(employeeRows[0], 'department', '') || null,
					position: s(employeeRows[0], 'position', '') || null,
					designation: s(employeeRows[0], 'designation', '') || null,
				}
			: null;
	// Link to login accounts: assignments carry user_id, not employee_id, so
	// the employee's login email/username widen the match.
	const employeeEmail =
		employeeRows.length > 0 ? s(employeeRows[0], 'email', '') : '';
	const employeeUsername =
		employeeRows.length > 0 ? s(employeeRows[0], 'username', '') : '';

	const [attendanceRows] = (await query(
		`SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
		        status, overtime_hours, is_weekly_off, is_holiday
		 FROM employee_attendance
		 WHERE employee_id = ? AND DATE_FORMAT(attendance_date, '%Y-%m') = ?
		 ORDER BY attendance_date`,
		[employeeId, month]
	)) as [DbRow[], unknown];

	const [holidayRows] = (await query(
		`SELECT name, DATE_FORMAT(date, '%Y-%m-%d') AS date
		 FROM holiday_master
		 WHERE is_active = 1 AND date BETWEEN ? AND ?
		 ORDER BY date`,
		[`${month}-01`, `${month}-31`]
	)) as [DbRow[], unknown];
	const holidays = holidayRows.map((r) => ({
		name: s(r, 'name'),
		date: s(r, 'date'),
	}));

	// attendance_settings is optional; fall back to the standard defaults.
	let settings: TsSettings = { ...DEFAULT_SETTINGS };
	try {
		const [settingsRows] = (await query(
			'SELECT standard_working_hours, half_day_hours FROM attendance_settings LIMIT 1'
		)) as [DbRow[], unknown];
		if (settingsRows.length > 0) {
			const std = n(settingsRows[0], 'standard_working_hours');
			const half = n(settingsRows[0], 'half_day_hours');
			settings = {
				standard_working_hours:
					std > 0 ? std : DEFAULT_SETTINGS.standard_working_hours,
				half_day_hours: half > 0 ? half : DEFAULT_SETTINGS.half_day_hours,
			};
		}
	} catch {
		/* table may not exist */
	}

	const days = buildDays(month, attendanceRows, holidays, settings);
	const summary = buildSummary(days);

	// Project/activity rows the employee worked on, with per-day hours from
	// the assignments' daily_entries (the same source the Project Status
	// report's person×day matrix aggregates). Assignments are keyed by
	// user_id, so the employee's login email/username widen the match.
	let projects: TsProject[] = [];
	try {
		const [projectRows] = (await query(
			`SELECT uaa.project_id, uaa.activity_name, uaa.discipline_name, uaa.status,
			        uaa.estimated_hours, uaa.actual_hours,
			        uaa.qty_assigned, uaa.qty_completed, uaa.daily_entries,
			        DATE_FORMAT(uaa.start_date, '%Y-%m-%d') AS start_date,
			        DATE_FORMAT(uaa.due_date, '%Y-%m-%d') AS due_date,
			        p.project_code,
			        COALESCE(NULLIF(p.project_title, ''), NULLIF(p.name, ''), '') AS project_name
			 FROM user_activity_assignments uaa
			 LEFT JOIN projects p ON p.project_id = uaa.project_id
			 WHERE uaa.status <> 'Cancelled'
			   AND (
			     uaa.employee_id = ?
			     OR uaa.user_id IN (
			       SELECT u.id FROM users u
			       WHERE (u.email <> '' AND u.email = ?)
			          OR (u.username <> '' AND u.username = ?)
			     )
			   )
			 ORDER BY uaa.updated_at DESC`,
			[employeeId, employeeEmail, employeeUsername]
		)) as [DbRow[], unknown];
		projects = buildProjectRows(projectRows, month);
	} catch {
		/* table may not exist */
	}

	const hours = computeMonthlyHours(projects, days);

	// Screen-time tracking (user_screen_time): real active seconds per day
	// from the client heartbeat bucket. Keyed by login account, so the
	// employee's linked user ids are resolved first (same link as projects).
	let screenTime: TsScreenTime = {
		days: {},
		total_active_sec: 0,
		total_idle_sec: 0,
		present: false,
	};
	try {
		const [userRows] = (await query(
			`SELECT id FROM users u
			 WHERE (u.email <> '' AND u.email = ?) OR (u.username <> '' AND u.username = ?)`,
			[employeeEmail, employeeUsername]
		)) as [DbRow[], unknown];
		const userIds = userRows.map((r) => n(r, 'id')).filter((id) => id > 0);
		if (userIds.length > 0) {
			const [screenRows] = (await query(
				`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date,
				        active_time_seconds, idle_time_seconds
				 FROM user_screen_time
				 WHERE user_id IN (${userIds.map(() => '?').join(', ')})
				   AND date BETWEEN ? AND ?`,
				[...userIds, `${month}-01`, `${month}-31`]
			)) as [DbRow[], unknown];
			screenTime = buildScreenTime(screenRows, month);
		}
	} catch {
		/* user_screen_time may not exist */
	}

	const y = Number(month.split('-')[0]);
	return {
		employee,
		month,
		year: y || 0,
		month_label: monthLabel(month),
		days,
		holidays,
		projects,
		summary,
		hours,
		screen_time: screenTime,
		settings,
	};
}
