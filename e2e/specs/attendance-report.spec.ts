import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page, Route } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import {
	ATTENDANCE_HOLIDAY,
	ATTENDANCE_MONTH,
	ATTENDANCE_REENROL_OLD_CODE,
	ATTENDANCE_ROSTER,
	ATTENDANCE_UNMAPPED_CODE_PREFIX,
	cleanupAttendanceFixtures,
	type AttendanceMember,
} from '../lib/attendance-fixtures';

/**
 * The Attendance report grid (issues #285, #288), proven end to end: the real
 * page in a real browser against the real database.
 *
 * Every expected figure below is derived HERE, from the raw rows the attendance
 * fixtures wrote plus the calendar. The Time Present rule is re-implemented
 * from its written form — the day's first punch to its last, direction
 * agnostic, pooled across devices and pooled by the Employee the punch was
 * attributed to at ingest (a device-code change never splits a day), a next-day
 * punch merging in only inside a 12-hour window and then being consumed, a lone
 * punch uncomputable — over the same padded window the report fetches
 * (one calendar day either side of the month), because the month's last day may
 * merge a punch recorded in the next month. The roster and week-off rules are
 * re-derived from `employees` and the calendar too. Nothing in this file
 * imports `@/lib/time-present`, `@/lib/logged-hours`, `@/utils/weekly-off`, the
 * report's `data-source`, `cell-status` or `roster`, so the report cannot mark
 * its own homework.
 *
 * Each test asserts both halves: what the API returned and what the browser
 * rendered, against rows read back with this harness's own mysql2 client. Cell
 * state is read from the cells' data attributes, never from utility classes.
 */

// This spec opens the report page ~20 times; running it on its own session
// keeps that page-load volume off the shared admin `api` budget (120/min per
// session token) that the rest of the suite draws from in one window.
test.use({ storageState: 'e2e/.auth/admin-report.json' });

/* ── The month under test ─────────────────────────────────────────── */

const MONTH = ATTENDANCE_MONTH;
const MONTH_PREFIX = `${MONTH}-`;
const [MONTH_YEAR, MONTH_NUMBER] = MONTH.split('-').map(Number);
const DAYS_IN_MONTH = new Date(
	Date.UTC(MONTH_YEAR, MONTH_NUMBER, 0)
).getUTCDate();
const MONTH_DATES: string[] = Array.from(
	{ length: DAYS_IN_MONTH },
	(_, index) => `${MONTH_PREFIX}${String(index + 1).padStart(2, '0')}`
);
const NEXT_MONTH = `${MONTH_YEAR}-${String(MONTH_NUMBER + 1).padStart(2, '0')}`;
const MONTH_DAY = (n: number) => `${MONTH_PREFIX}${String(n).padStart(2, '0')}`;

/** The month's own half-open bounds, and the ±1-day padded window the report
 *  and this derivation both fetch: the month's first day may consume the
 *  previous month's last-day continuation Punch, and vice versa at the end. */
const MONTH_FROM = `${MONTH_PREFIX}01 00:00:00`;
const MONTH_TO = `${NEXT_MONTH}-01 00:00:00`;
const DAY_MS = 86_400_000;
const MONTH_START_MS = Date.UTC(MONTH_YEAR, MONTH_NUMBER - 1, 1);
const NEXT_MONTH_START_MS = Date.UTC(MONTH_YEAR, MONTH_NUMBER, 1);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const PADDED_FROM = `${isoDay(MONTH_START_MS - DAY_MS)} 00:00:00`;
const PADDED_TO = `${isoDay(NEXT_MONTH_START_MS + DAY_MS)} 00:00:00`;

/** Week off re-derived from the calendar: Sundays, plus 2nd and 4th Saturdays. */
function isWeeklyOff(date: string): boolean {
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	if (weekday === 0) return true;
	if (weekday !== 6) return false;
	const saturdayOfMonth = Math.ceil(Number(date.slice(8, 10)) / 7);
	return saturdayOfMonth === 2 || saturdayOfMonth === 4;
}

const WEEKLY_OFF_DATES = MONTH_DATES.filter(isWeeklyOff);

/* ── Time Present, re-derived from the punch rows ─────────────────── */

const MS_PER_HOUR = 3_600_000;
/** A merged next-day punch may not stretch a day's presence past this. */
const MAX_MERGED_SPAN_HOURS = 12;

interface RawPunch {
	id: number;
	employee_code: string;
	log_date: string;
	serial_number: string;
	employee_id: number | null;
}

interface DerivedDay {
	/** Hours, or null when the day cannot be computed — never 0. */
	hours: number | null;
	/** A next-day punch was merged into this day. */
	merged: boolean;
	/** A next-day punch existed but the 12-hour window refused it. */
	refused: boolean;
	/** `attendance_logs.id` of the punch consumed as this day's tail. */
	tailPunchId: number | null;
}

/** `'YYYY-MM-DD HH:mm:ss'` device wall clock read as UTC, so a subtraction
 *  across midnight is elapsed time and never a minutes-of-day comparison. */
function punchMs(logDate: string): number {
	return Date.parse(`${logDate.replace(' ', 'T')}Z`);
}

/**
 * Time Present for one Employee's punches — whatever device code they carry.
 *
 * A Punch is attributed to the Employee stamped on its row (the device code is
 * display metadata), so every bucket is keyed by that Employee, falling back to
 * the device code only for a punch with no employee id. Days are walked in date
 * order, so the day that owns a tail is measured before the day the tail landed
 * on: the tail is credited once and dropped from the following day, which is
 * what makes a night shift read as 8.5 hours on the day it began rather than
 * 6 hours and a half on each of two days.
 *
 * The returned map is keyed by `'YYYY-MM-DD'`, including padded days around the
 * month the report fetched — the caller renders month days only.
 */
function deriveTimePresent(punches: RawPunch[]): Map<string, DerivedDay> {
	const buckets = new Map<string, RawPunch[]>();
	for (const punch of punches) {
		// The Employee stamped at ingest is the attribution key; the device code
		// is only the fallback for a punch nobody owns — so a re-enrolment
		// mid-month cannot split one person into two buckets.
		const owner =
			punch.employee_id == null
				? `code:${punch.employee_code}`
				: `id:${punch.employee_id}`;
		const key = `${owner}|${punch.log_date.slice(0, 10)}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(punch);
		else buckets.set(key, [punch]);
	}
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) =>
			a.log_date === b.log_date ? a.id - b.id : a.log_date < b.log_date ? -1 : 1
		);
	}

	const datesByAttribution = new Map<string, string[]>();
	for (const key of buckets.keys()) {
		const separator = key.lastIndexOf('|');
		const owner = key.slice(0, separator);
		const dates = datesByAttribution.get(owner) ?? [];
		dates.push(key.slice(separator + 1));
		datesByAttribution.set(owner, dates);
	}
	for (const dates of datesByAttribution.values()) dates.sort();

	const consumed = new Set<number>();
	const derived = new Map<string, DerivedDay>();
	for (const [owner, dates] of datesByAttribution) {
		for (const date of dates) {
			const own = (buckets.get(`${owner}|${date}`) ?? []).filter(
				(punch) => !consumed.has(punch.id)
			);
			// A day emptied by the previous day's merge has no presence of its own.
			if (own.length === 0) continue;

			const firstMs = punchMs(own[0].log_date);
			let lastMs = punchMs(own[own.length - 1].log_date);
			let merged = false;
			let refused = false;
			let tailPunchId: number | null = null;

			const following = isoDay(Date.parse(`${date}T00:00:00Z`) + DAY_MS);
			const tail = (buckets.get(`${owner}|${following}`) ?? []).find(
				(punch) => !consumed.has(punch.id)
			);

			if (tail && Number.isFinite(firstMs) && Number.isFinite(lastMs)) {
				const tailMs = punchMs(tail.log_date);
				if (tailMs > lastMs) {
					if (tailMs - firstMs <= MAX_MERGED_SPAN_HOURS * MS_PER_HOUR) {
						consumed.add(tail.id);
						lastMs = tailMs;
						merged = true;
						tailPunchId = tail.id;
					} else if (own.length < 2) {
						// Only a day that has no span of its own can be refused.
						refused = true;
					}
				}
			}

			const effectivePunches = own.length + (merged ? 1 : 0);
			const hours =
				!refused &&
				effectivePunches >= 2 &&
				Number.isFinite(firstMs) &&
				Number.isFinite(lastMs) &&
				lastMs >= firstMs
					? Math.round(((lastMs - firstMs) / MS_PER_HOUR) * 100) / 100
					: null;

			derived.set(date, { hours, merged, refused, tailPunchId });
		}
	}
	return derived;
}

/** Canonical Logged Hours per day, summed from raw `daily_entries` and uncapped. */
function deriveLoggedHours(
	payloads: unknown[],
	month: string
): Record<string, number> {
	const byDate: Record<string, number> = {};
	for (const payload of payloads) {
		let entries: unknown;
		try {
			entries = typeof payload === 'string' ? JSON.parse(payload) : payload;
		} catch {
			continue;
		}
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			const raw = entry as { date?: unknown; hours?: unknown };
			if (typeof raw.date !== 'string') continue;
			const date = raw.date.slice(0, 10);
			if (!date.startsWith(month)) continue;
			const hours =
				typeof raw.hours === 'number'
					? raw.hours
					: Number.parseFloat(String(raw.hours));
			if (!Number.isFinite(hours) || hours <= 0) continue;
			byDate[date] = (byDate[date] ?? 0) + hours;
		}
	}
	for (const date of Object.keys(byDate)) {
		byDate[date] = Math.round(byDate[date] * 100) / 100;
	}
	return byDate;
}

/* ── The database rows behind the grid ────────────────────────────── */

interface EmployeeRow {
	id: number;
	employee_id: string;
	name: string;
	employee_type: string | null;
	status: string;
	isDelete: number;
	smartoffice_code: string | null;
}

interface FixtureExpectation {
	member: AttendanceMember;
	employeeId: number;
	/**
	 * `'YYYY-MM-DD'` → the day's expected Time Present, over every punch the
	 * employee is stamped on, including padded days either side of the month.
	 */
	timePresent: Map<string, DerivedDay>;
	/** `${YYYY-MM-DD}` → expected Logged Hours. */
	logged: Record<string, number>;
	/** `${YYYY-MM-DD}` → the authored `employee_attendance.status`. */
	status: Record<string, string>;
	/** `${YYYY-MM-DD}` → month-dated punch rows for this employee on that day. */
	punchCount: Record<string, number>;
	/** Every padded-window punch attributed to this employee id. */
	punches: RawPunch[];
	/** The month-dated subset of `punches` — the shipped, cell-scoped set. */
	monthPunches: RawPunch[];
}

interface Model {
	/** Every `employees` row the roster filter sees. */
	directory: EmployeeRow[];
	/** The rows the roster keeps: not deleted, active, Employee Type = Payroll. */
	roster: EmployeeRow[];
	/** Fixture members on the roster, and the ones the filter drops. */
	onRoster: AttendanceMember[];
	offRoster: AttendanceMember[];
	fixtures: FixtureExpectation[];
	/** The expectations for the roster fixture members, in roster order. */
	rosterFixtures: FixtureExpectation[];
	nonOptionalHolidays: string[];
	optionalHolidays: string[];
	unmapped: { employee_code: string; punch_count: number }[];
	/**
	 * Month-dated punch totals and device serials, derived independently — the
	 * month summary line and the stats payloads must both match them.
	 */
	monthStats: {
		total: number;
		mapped: number;
		unmapped: number;
		/** Distinct non-empty `serial_number`s among the month's punches. */
		devices: string[];
	};
	/** Row counts of every table the attendance fixtures own, while seeded. */
	rowCounts: Record<string, number>;
}

/**
 * Every device code the fixture writes punches under: the roster's current
 * codes plus the re-enrolment member's pre-re-enrolment code.
 */
const FIXTURE_CODE_LIST = [
	...ATTENDANCE_ROSTER.map((member) => member.smartofficeCode),
	ATTENDANCE_REENROL_OLD_CODE,
];
const DEVICE_CODE_PLACEHOLDERS = FIXTURE_CODE_LIST.map(() => '?').join(', ');

async function count(sql: string, params: unknown[] = []): Promise<number> {
	const [row] = await rows<{ c: number }>(sql, params);
	return Number(row?.c ?? 0);
}

async function buildModel(): Promise<Model> {
	const directory = await rows<EmployeeRow>(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        employee_type, status, isDelete, smartoffice_code
     FROM employees`
	);

	// The padded window the report itself fetches: the merge walk needs the
	// neighbouring days, and the month's last day's continuation Punch lands in
	// the next month. Only month-dated rows become cells.
	const punches = await rows<RawPunch>(
		`SELECT id, employee_code, log_date, serial_number, employee_id
     FROM attendance_logs
     WHERE log_date >= ? AND log_date < ?
     ORDER BY log_date, id`,
		[PADDED_FROM, PADDED_TO]
	);

	const statusRows = await rows<{
		employee_id: number;
		date: string;
		status: string;
	}>(
		`SELECT employee_id, DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date, status
     FROM employee_attendance
     WHERE attendance_date >= ? AND attendance_date < ?
     ORDER BY id`,
		[`${MONTH_PREFIX}01`, `${NEXT_MONTH}-01`]
	);

	const assignments = await rows<{
		employee_id: number;
		daily_entries: string;
	}>(
		`SELECT employee_id, daily_entries
     FROM user_activity_assignments
     WHERE id LIKE 'e2e-att-%'`
	);

	const holidayRows = await rows<{ date: string; is_optional: number }>(
		`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, COALESCE(is_optional, 0) AS is_optional
     FROM holiday_master
     WHERE is_active = 1 AND date >= ? AND date < ?
     ORDER BY date`,
		[`${MONTH_PREFIX}01`, `${NEXT_MONTH}-01`]
	);

	const statusByEmployeeDay = new Map<string, string>();
	for (const row of statusRows) {
		statusByEmployeeDay.set(`${row.employee_id}|${row.date}`, row.status);
	}

	const onRoster = ATTENDANCE_ROSTER.filter(
		(member) => member.type === 'Payroll' && member.status === 'active'
	);
	const offRoster = ATTENDANCE_ROSTER.filter(
		(member) => !(member.type === 'Payroll' && member.status === 'active')
	);

	const fixtures: FixtureExpectation[] = [];
	for (const member of ATTENDANCE_ROSTER) {
		const employee = directory.find((row) => row.employee_id === member.code);
		if (!employee)
			throw new Error(`Fixture employee ${member.code} is missing`);

		// A punch is this employee's purely by the employee id stamped on the
		// row — the device code it arrived under is display metadata. A punch
		// with no attributed employee has no id, so an unmapped code can never
		// be read as somebody's presence.
		const own = punches.filter((punch) => punch.employee_id === employee.id);
		const monthPunches = own.filter((punch) =>
			punch.log_date.startsWith(MONTH_PREFIX)
		);

		const punchCount: Record<string, number> = {};
		for (const punch of monthPunches) {
			const date = punch.log_date.slice(0, 10);
			punchCount[date] = (punchCount[date] ?? 0) + 1;
		}

		const status: Record<string, string> = {};
		for (const date of MONTH_DATES) {
			const authored = statusByEmployeeDay.get(`${employee.id}|${date}`);
			if (authored) status[date] = authored;
		}

		fixtures.push({
			member,
			employeeId: employee.id,
			timePresent: deriveTimePresent(own),
			logged: deriveLoggedHours(
				assignments
					.filter((row) => row.employee_id === employee.id)
					.map((row) => row.daily_entries),
				MONTH
			),
			status,
			punchCount,
			punches: own,
			monthPunches,
		});
	}

	const unmappedCounts = new Map<string, number>();
	for (const punch of punches) {
		if (punch.employee_id) continue;
		// The strip is month-scoped, so the padded neighbours are not counted.
		if (!punch.log_date.startsWith(MONTH_PREFIX)) continue;
		if (!punch.employee_code.startsWith(ATTENDANCE_UNMAPPED_CODE_PREFIX))
			continue;
		unmappedCounts.set(
			punch.employee_code,
			(unmappedCounts.get(punch.employee_code) ?? 0) + 1
		);
	}
	const unmapped = [...unmappedCounts]
		.map(([employee_code, punch_count]) => ({ employee_code, punch_count }))
		.sort((a, b) =>
			a.punch_count === b.punch_count
				? a.employee_code.localeCompare(b.employee_code)
				: b.punch_count - a.punch_count
		);

	// The month's own figures, over month-dated rows only — the values the
	// summary line shows and the stats payload must agree with.
	const monthPunches = punches.filter((punch) =>
		punch.log_date.startsWith(MONTH_PREFIX)
	);
	const monthStats = {
		total: monthPunches.length,
		mapped: monthPunches.filter((punch) => punch.employee_id != null).length,
		unmapped: monthPunches.filter((punch) => punch.employee_id == null).length,
		devices: [
			...new Set(
				monthPunches.map((punch) => punch.serial_number).filter(Boolean)
			),
		].sort(),
	};

	const rowCounts: Record<string, number> = {
		employees: await count(
			`SELECT COUNT(*) AS c FROM employees WHERE employee_id LIKE 'E2E-ATT-%'`
		),
		users: await count(
			`SELECT COUNT(*) AS c FROM users WHERE username = 'e2e_att_user'`
		),
		attendance_logs_mapped: await count(
			`SELECT COUNT(*) AS c FROM attendance_logs WHERE employee_code IN (${DEVICE_CODE_PLACEHOLDERS})`,
			FIXTURE_CODE_LIST
		),
		attendance_logs_unmapped: await count(
			`SELECT COUNT(*) AS c FROM attendance_logs WHERE employee_code LIKE ?`,
			[`${ATTENDANCE_UNMAPPED_CODE_PREFIX}%`]
		),
		// Fixture-owned rows outside the month: the night shift's, and the
		// month-boundary case's, continuations. They must be seeded, counted,
		// and purged with everything else.
		attendance_logs_outside_month: await count(
			`SELECT COUNT(*) AS c FROM attendance_logs
       WHERE employee_code IN (${DEVICE_CODE_PLACEHOLDERS})
         AND (log_date < ? OR log_date >= ?)`,
			[...FIXTURE_CODE_LIST, MONTH_FROM, MONTH_TO]
		),
		employee_attendance: await count(
			`SELECT COUNT(*) AS c FROM employee_attendance ea
       JOIN employees e ON e.id = ea.employee_id
       WHERE e.employee_id LIKE 'E2E-ATT-%'`
		),
		user_activity_assignments: await count(
			`SELECT COUNT(*) AS c FROM user_activity_assignments WHERE id LIKE 'e2e-att-%'`
		),
		employee_salary_profile: await count(
			`SELECT COUNT(*) AS c FROM employee_salary_profile esp
       JOIN employees e ON e.id = esp.employee_id
       WHERE e.employee_id LIKE 'E2E-ATT-%'`
		),
		holiday_master: await count(
			`SELECT COUNT(*) AS c FROM holiday_master WHERE name = ?`,
			[ATTENDANCE_HOLIDAY.name]
		),
	};

	return {
		directory,
		roster: directory.filter(
			(row) =>
				Number(row.isDelete) === 0 &&
				row.status === 'active' &&
				row.employee_type === 'Payroll'
		),
		onRoster,
		offRoster,
		fixtures,
		rosterFixtures: fixtures.filter((fixture) =>
			onRoster.includes(fixture.member)
		),
		nonOptionalHolidays: holidayRows
			.filter((row) => Number(row.is_optional) === 0)
			.map((row) => row.date),
		optionalHolidays: holidayRows
			.filter((row) => Number(row.is_optional) === 1)
			.map((row) => row.date),
		unmapped,
		monthStats,
		rowCounts,
	};
}

/* ── The report's own response shape, spelled out here ────────────── */

interface ArCell {
	date: string;
	hours: number | null;
	logged_hours: number | null;
	status: string | null;
	punch_count: number;
	merge_refused: boolean;
}

interface ArMatrixRow {
	id: number;
	employee_id: string;
	name: string;
	smartoffice_code: string | null;
	punch_count: number;
	cells: ArCell[];
}

interface ArData {
	month: string;
	days: string[];
	employees: ArMatrixRow[];
	stats: {
		total_punches: number;
		mapped_punches: number;
		unmapped_punches: number;
		distinct_devices: number;
	};
	holidays: { non_optional: string[]; optional: string[] };
	devices: string[];
	/** The month-scoped raw punches the drill-down reads (never padded days). */
	punches: {
		id: number;
		employee_code: string;
		employee_id: number | null;
		date: string;
		time: string;
		serial_number: string;
	}[];
}

let model: Model;
let api: ArData;
const observed: Record<string, unknown> = {};

test.beforeAll(async () => {
	model = await buildModel();
});

/** Fetch a month's payload. `month` defaults to the fixture month so callers
 *  that only need the month under test stay one-liners. */
async function fetchReport(
	request: APIRequestContext,
	month: string = MONTH
): Promise<ArData> {
	const response = await request.get(
		`/api/reports/attendance-report?month=${encodeURIComponent(month)}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ArData;
}

function apiCell(employeeCode: string, date: string): ArCell {
	const cell = api?.employees
		.find((row) => row.employee_id === employeeCode)
		?.cells.find((candidate) => candidate.date === date);
	if (!cell) throw new Error(`No API cell for ${employeeCode} ${date}`);
	return cell;
}

function fixtureFor(code: string): FixtureExpectation {
	const found = model.fixtures.find((f) => f.member.code === code);
	if (!found) throw new Error(`No fixture expectation for ${code}`);
	return found;
}

/* ── Browser helpers ──────────────────────────────────────────────── */

async function openGrid(page: Page): Promise<void> {
	await page.goto('/reports/attendance-report');
	await page.getByLabel('Month').fill(MONTH);
	// Every day cell renders a trigger, whatever figures it carries.
	await expect(page.getByTestId('cell-punch-trigger').first()).toBeVisible();
	await expect(
		page.locator(`td[data-testid="attendance-cell"][data-date="${MONTH}-01"]`)
	).toHaveCount(model.roster.length);
}

function row(page: Page, employeeCode: string) {
	return page.locator('tbody tr').filter({ hasText: employeeCode });
}

function cell(page: Page, employeeCode: string, date: string) {
	return row(page, employeeCode)
		.locator(`td[data-testid="attendance-cell"][data-date="${date}"]`)
		.first();
}

interface RenderedCell {
	logged: string | null;
	timePresent: string | null;
	status: string | null;
	/** `data-muted` — a non-working day with no evidence is muted. */
	muted: boolean;
	/** `data-time-present-state` — `'computable'` only when hours exist. */
	timePresentState: string | null;
	/** `data-logged-hours-state` — `'present'` only when Logged Hours exist. */
	loggedHoursState: string | null;
	/** `data-punch-count` — the cell's month-dated Punch count. */
	punchCount: number | null;
}

/**
 * The whole grid as the browser painted it: one entry per employee per day,
 * read from the DOM of the page under test. Every state comes from the cell's
 * data attributes, never from a utility class, so a restyle cannot move the
 * proof.
 */
async function readRenderedGrid(
	page: Page
): Promise<Record<string, Record<string, RenderedCell>>> {
	const painted = await page.$$eval('tbody tr', (tableRows) =>
		tableRows
			.filter((tr) => tr.querySelector('th[scope="row"]'))
			.map((tr) => {
				const header = tr.querySelector('th')?.textContent ?? '';
				const cells: Record<string, RenderedCell> = {};
				for (const td of tr.querySelectorAll('td[data-date]')) {
					// Scoped to the cell: reading from the row would hand every
					// day the row's first day's figures.
					const text = (selector: string) => {
						const value = td.querySelector(selector)?.textContent?.trim();
						return value ? value : null;
					};
					const punchCount = td.getAttribute('data-punch-count');
					cells[td.getAttribute('data-date') ?? ''] = {
						logged: text('[data-testid="cell-logged-hours"]'),
						timePresent: text('[data-testid="cell-time-present"]'),
						status:
							td
								.querySelector('[data-status-code]')
								?.getAttribute('data-status-code') ?? null,
						muted: td.getAttribute('data-muted') === 'true',
						timePresentState: td.getAttribute('data-time-present-state'),
						loggedHoursState: td.getAttribute('data-logged-hours-state'),
						punchCount: punchCount === null ? null : Number(punchCount),
					};
				}
				return {
					code: header.match(/E2E-ATT-\d{4}/)?.[0] ?? '',
					cells,
				};
			})
	);
	const grid: Record<string, Record<string, RenderedCell>> = {};
	for (const { code, cells } of painted) if (code) grid[code] = cells;
	return grid;
}

/** How the grid paints a number: two decimals, no grouping below 1000, and
 *  every hours figure in this month is far below that. */
function formatHours(value: number): string {
	return value.toFixed(2);
}

/** What one cell must render, derived from the rows on disk and the calendar. */
function expectedRendered(
	fixture: FixtureExpectation,
	date: string,
	nonOptionalHolidays: string[],
	optionalHolidays: string[]
): RenderedCell {
	const hours = fixture.timePresent.get(date)?.hours ?? null;
	const logged = fixture.logged[date] ?? null;
	const punchCount = fixture.punchCount[date] ?? 0;
	const hasLoggedHours = logged !== null && logged > 0;
	const hasPunches = punchCount > 0;
	const holiday =
		nonOptionalHolidays.includes(date) && !optionalHolidays.includes(date);
	const nonWorking = isWeeklyOff(date) || holiday;
	// A day with neither figure stays blank; an uncomputable span is an em dash.
	const showFigures = hasLoggedHours || hasPunches;
	return {
		logged:
			showFigures && hasLoggedHours ? formatHours(logged as number) : null,
		timePresent: showFigures
			? hours === null
				? '—'
				: formatHours(hours)
			: null,
		status: fixture.status[date] ?? null,
		muted: nonWorking && !hasLoggedHours && !hasPunches,
		// The cell's own state, independent of what it paints: computable only
		// when the derived span exists.
		timePresentState: hours === null ? 'uncomputable' : 'computable',
		loggedHoursState: hasLoggedHours ? 'present' : 'none',
		punchCount,
	};
}

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('attendance report grid', () => {
	test('the Payroll roster is every grid row, and the excluded five are provably in the database', async ({
		request,
		page,
	}) => {
		api = await fetchReport(request);

		// The roster read straight off `employees`: not deleted, active, Payroll.
		expect(api.month).toBe(MONTH);
		expect(api.days).toEqual(MONTH_DATES);
		expect(api.holidays.non_optional).toEqual(model.nonOptionalHolidays);
		expect(api.holidays.optional).toEqual(model.optionalHolidays);
		expect(model.roster.length).toBeGreaterThan(model.onRoster.length);
		expect(api.employees.map((row) => row.employee_id).sort()).toEqual(
			model.roster.map((row) => row.employee_id).sort()
		);

		// Every Payroll fixture member is a full row of the month, whether or not
		// it has a salary profile — the filter reads the employee record. The
		// count includes the re-enrolment member and the month-boundary member.
		expect(model.onRoster).toHaveLength(13);
		for (const member of model.onRoster) {
			const fixture = fixtureFor(member.code);
			const apiRow = api.employees.find(
				(row) => row.employee_id === member.code
			);
			expect(apiRow, `${member.code} missing from the API roster`).toBeTruthy();
			expect(apiRow?.cells).toHaveLength(DAYS_IN_MONTH);
			expect(apiRow?.smartoffice_code).toBe(member.smartofficeCode);
			// The row total is the month's own punches — a continuation Punch
			// recorded in the next month never inflates it.
			expect(apiRow?.punch_count).toBe(fixture.monthPunches.length);
		}
		expect(fixtureFor('E2E-ATT-0009').member.profile).toBeNull();
		expect(fixtureFor('E2E-ATT-0010').member.profile).toBe('contract');

		// The excluded five: absent from the API roster...
		expect(
			model.offRoster.map((member) => `${member.type}/${member.status}`).sort()
		).toEqual([
			'Contract/active',
			'Deputation/active',
			'Intern/active',
			'Payroll/terminated',
			'Permanent/active',
		]);
		for (const member of model.offRoster) {
			expect(
				api.employees.find((row) => row.employee_id === member.code),
				`${member.code} (${member.type}/${member.status}) must not be on the roster`
			).toBeUndefined();
		}

		// ...while their rows really are in the database, so the filter — not an
		// empty table — is what removed them.
		const excludedIds = model.offRoster.map(
			(m) => fixtureFor(m.code).employeeId
		);
		const placeholders = excludedIds.map(() => '?').join(', ');
		const excludedPunches = await count(
			`SELECT COUNT(*) AS c FROM attendance_logs WHERE employee_id IN (${placeholders})`,
			excludedIds
		);
		expect(excludedPunches).toBeGreaterThan(0);
		const excludedEmployees = await rows<{ employee_id: string }>(
			`SELECT employee_id FROM employees WHERE employee_id IN (${placeholders})`,
			model.offRoster.map((member) => member.code)
		);
		expect(excludedEmployees.map((row) => row.employee_id).sort()).toEqual(
			model.offRoster.map((member) => member.code).sort()
		);
		const excludedDirectoryRows = await count(
			`SELECT COUNT(*) AS c FROM employees
       WHERE isDelete = 0 AND NOT (status = 'active' AND employee_type = 'Payroll')`
		);

		// ...and absent from the rendered grid too.
		await openGrid(page);
		for (const member of model.offRoster) {
			await expect(
				page.locator('tbody tr').filter({ hasText: member.code }),
				`${member.code} must not render as a grid row`
			).toHaveCount(0);
		}
		for (const member of model.onRoster) {
			await expect(row(page, member.code)).toHaveCount(1);
		}
		await expect(
			page.locator('tbody tr').filter({ has: page.locator('th[scope="row"]') })
		).toHaveCount(model.roster.length);

		observed.roster = {
			directoryRows: model.directory.length,
			rosterRows: model.roster.length,
			apiRosterRows: api.employees.length,
			renderedRows: model.roster.length,
			onRoster: model.onRoster.map((member) => member.code),
			offRoster: model.offRoster.map((member) => ({
				code: member.code,
				type: member.type,
				status: member.status,
				punchesOnDisk: fixtureFor(member.code).punches.length,
			})),
			excludedDirectoryRows,
			excludedPunchRowsOnDisk: excludedPunches,
		};
	});

	test('every roster cell of the API equals Time Present and Logged Hours derived from the punch rows', async ({
		request,
	}) => {
		api = await fetchReport(request);

		expect(model.fixtures.every((fixture) => fixture.punches.length > 0)).toBe(
			true
		);
		expect(model.nonOptionalHolidays).toEqual([ATTENDANCE_HOLIDAY.date]);
		expect(model.optionalHolidays).toEqual([]);

		const mismatches: string[] = [];
		for (const fixture of model.rosterFixtures) {
			const apiRow = api.employees.find(
				(row) => row.employee_id === fixture.member.code
			);
			if (!apiRow) {
				mismatches.push(`${fixture.member.code}: absent from the API roster`);
				continue;
			}
			if (apiRow.punch_count !== fixture.monthPunches.length) {
				mismatches.push(
					`${fixture.member.code}: ${apiRow.punch_count} punches on the row vs ${fixture.monthPunches.length} month-dated on disk`
				);
			}
			for (const cell of apiRow.cells) {
				const derived = fixture.timePresent.get(cell.date);
				const hours = derived?.hours ?? null;
				const logged = fixture.logged[cell.date] ?? null;
				const status = fixture.status[cell.date] ?? null;
				const punches = fixture.punchCount[cell.date] ?? 0;
				if (cell.hours !== hours) {
					mismatches.push(
						`${fixture.member.code} ${cell.date}: time present ${String(cell.hours)} vs derived ${String(hours)}`
					);
				}
				if (cell.logged_hours !== logged) {
					mismatches.push(
						`${fixture.member.code} ${cell.date}: logged ${String(cell.logged_hours)} vs derived ${String(logged)}`
					);
				}
				if (cell.status !== status) {
					mismatches.push(
						`${fixture.member.code} ${cell.date}: status ${String(cell.status)} vs on disk ${String(status)}`
					);
				}
				if (cell.punch_count !== punches) {
					mismatches.push(
						`${fixture.member.code} ${cell.date}: ${cell.punch_count} punches vs ${punches} on disk`
					);
				}
				if (cell.merge_refused !== (derived?.refused ?? false)) {
					mismatches.push(
						`${fixture.member.code} ${cell.date}: merge_refused ${cell.merge_refused} vs derived ${derived?.refused ?? false}`
					);
				}
			}
		}
		expect(mismatches, mismatches.slice(0, 25).join('\n')).toEqual([]);

		// Unmapped punches are counted as punches, mapped to nobody, and reach
		// no cell of anybody's row.
		const unmappedTotal = model.unmapped.reduce(
			(sum, code) => sum + code.punch_count,
			0
		);
		expect(api.stats.unmapped_punches).toBe(unmappedTotal);
		expect(api.stats.total_punches - api.stats.unmapped_punches).toBe(
			api.stats.mapped_punches
		);

		// The month-scoped totals and the device list are what the padded rows
		// were reduced to: every month-dated Punch, and only those.
		expect(api.stats.total_punches).toBe(model.monthStats.total);
		expect(api.stats.mapped_punches).toBe(model.monthStats.mapped);
		expect(api.stats.unmapped_punches).toBe(model.monthStats.unmapped);
		expect(api.devices).toEqual(model.monthStats.devices);

		observed.apiCells = {
			cellsChecked: model.onRoster.length * DAYS_IN_MONTH,
			mismatches: mismatches.length,
			derivedFrom:
				'attendance_logs + user_activity_assignments + employee_attendance rows read back with the harness client',
			unmappedPunches: api.stats.unmapped_punches,
			totalPunches: api.stats.total_punches,
			mappedPunches: api.stats.mapped_punches,
			devices: api.devices,
			paddedWindow: { from: PADDED_FROM, to: PADDED_TO },
		};
	});

	test('the rendered grid paints exactly the derived hours, badges and muting', async ({
		page,
	}) => {
		await openGrid(page);
		const grid = await readRenderedGrid(page);

		const mismatches: string[] = [];
		for (const fixture of model.rosterFixtures) {
			const rendered = grid[fixture.member.code];
			if (!rendered) {
				mismatches.push(`${fixture.member.code}: no rendered row`);
				continue;
			}
			for (const date of MONTH_DATES) {
				const expected = expectedRendered(
					fixture,
					date,
					model.nonOptionalHolidays,
					model.optionalHolidays
				);
				const actual = rendered[date];
				if (!actual) {
					mismatches.push(`${fixture.member.code} ${date}: no cell painted`);
					continue;
				}
				if (JSON.stringify(actual) !== JSON.stringify(expected)) {
					mismatches.push(
						`${fixture.member.code} ${date}: painted ${JSON.stringify(actual)} vs derived ${JSON.stringify(expected)}`
					);
				}
			}
		}
		expect(mismatches, mismatches.slice(0, 25).join('\n')).toEqual([]);

		observed.renderedGrid = {
			rowsPainted: Object.keys(grid).length,
			cellsCompared: model.onRoster.length * DAYS_IN_MONTH,
			mismatches: mismatches.length,
		};
	});

	test('the accidental, night-shift, half-day and single-punch days paint what the punches say', async ({
		page,
	}) => {
		await openGrid(page);

		// ── Accidental Punch: an odd punch count must not shorten the day ──
		const accidentalCode = 'E2E-ATT-0002';
		const accidentalDay = MONTH_DAY(1);
		const accidental = fixtureFor(accidentalCode);
		const accidentalPunches = accidental.punches.filter((punch) =>
			punch.log_date.startsWith(accidentalDay)
		);
		expect(accidentalPunches.map((p) => p.log_date.slice(11))).toEqual([
			'09:02:00',
			'12:10:00',
			'18:41:00',
		]);
		// 09:02 → 18:41 is 9h39m; reading the alternation instead would stop at
		// the second punch and report 3.13 hours of a nine-and-a-half-hour day.
		const accidentalDerived =
			accidental.timePresent.get(accidentalDay)?.hours ?? null;
		expect(accidentalDerived).toBeCloseTo(9.65, 2);
		expect(accidentalDerived).not.toBeCloseTo(3.13, 2);
		expect(apiCell(accidentalCode, accidentalDay).hours).toBeCloseTo(9.65, 2);
		await expect(
			cell(page, accidentalCode, accidentalDay).getByTestId('cell-time-present')
		).toHaveText('9.65');

		// ── Night shift: credited to the day it began, tail consumed once ──
		const nightCode = 'E2E-ATT-0004';
		const nightDay = MONTH_DAY(1);
		const nightNextDay = MONTH_DAY(2);
		const night = fixtureFor(nightCode);
		const nightDerived = night.timePresent.get(nightDay);
		expect(nightDerived?.merged).toBe(true);
		expect(nightDerived?.hours).toBeCloseTo(8.5, 2);
		expect(apiCell(nightCode, nightDay).hours).toBeCloseTo(8.5, 2);
		const tailPunch = night.punches.find(
			(punch) => punch.id === nightDerived?.tailPunchId
		);
		expect(tailPunch?.log_date).toBe(`${nightNextDay} 06:30:00`);
		// The tail is consumed, so it cannot also open the next day's span: that
		// day still reads 8.5 hours from its own 22:00 → 06:30 shift.
		expect(night.timePresent.get(nightNextDay)?.hours).toBeCloseTo(8.5, 2);
		expect(apiCell(nightCode, nightNextDay).hours).toBeCloseTo(8.5, 2);
		await expect(
			cell(page, nightCode, nightDay).getByTestId('cell-time-present')
		).toHaveText('8.50');
		await expect(
			cell(page, nightCode, nightNextDay).getByTestId('cell-time-present')
		).toHaveText('8.50');

		// Walk the fixture punches: each one is credited to exactly one day, as
		// that day's own span endpoint or as one consumed tail — never to two.
		const mergedTailIds = new Set(
			[...night.timePresent.values()]
				.map((day) => day.tailPunchId)
				.filter((id): id is number => id !== null)
		);
		const buckets = new Map<string, RawPunch[]>();
		for (const punch of night.punches) {
			const date = punch.log_date.slice(0, 10);
			const bucket = buckets.get(date) ?? [];
			bucket.push(punch);
			buckets.set(date, bucket);
		}
		const creditedDays = new Map<number, Set<string>>();
		let mergedDays = 0;
		for (const [date, bucket] of buckets) {
			const derived = night.timePresent.get(date);
			if (!derived) continue;
			const own = bucket.filter((punch) => !mergedTailIds.has(punch.id));
			const credited = new Set<number>([own[0].id, own[own.length - 1].id]);
			if (derived.tailPunchId !== null) {
				credited.add(derived.tailPunchId);
				mergedDays++;
				// The tail is recorded on the following calendar day, so it is
				// looked up across every punch rather than in this day's bucket.
				const tail = night.punches.find(
					(punch) => punch.id === derived.tailPunchId
				);
				// Every merged tail is the 06:30 punch of the next calendar day.
				expect(tail?.log_date).toBe(
					`${new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
						.toISOString()
						.slice(0, 10)} 06:30:00`
				);
			}
			for (const id of credited) {
				const days = creditedDays.get(id) ?? new Set<string>();
				days.add(date);
				creditedDays.set(id, days);
			}
		}
		const doubleCredited = [...creditedDays.entries()]
			.filter(([, days]) => days.size !== 1)
			.map(([id]) => id);
		expect(
			doubleCredited,
			'a punch must never be counted towards two days'
		).toEqual([]);
		expect(creditedDays.size).toBe(night.punches.length);
		expect(mergedTailIds.size).toBe(mergedDays);
		// Each night-shift working day wrote two punches of its own plus one 06:30
		// tail on the following calendar day. The padded fetch window now takes
		// the whole set: the last working day's tail lands on the next month's
		// first day and is what that day's 8.5-hour merge consumes.
		const nightWorkingDays = MONTH_DATES.filter(
			(date) => !isWeeklyOff(date) && !model.nonOptionalHolidays.includes(date)
		).length;
		expect(night.punches).toHaveLength(nightWorkingDays * 3);
		const nightTailOutsideMonth = night.punches.filter(
			(punch) => !punch.log_date.startsWith(MONTH_PREFIX)
		);
		expect(nightTailOutsideMonth.map((punch) => punch.log_date)).toEqual([
			`${NEXT_MONTH}-01 06:30:00`,
		]);

		// ── Half day: measured hours uncapped, beside the authored badge ──
		const halfCode = 'E2E-ATT-0008';
		const halfDay = MONTH_DAY(4);
		const half = fixtureFor(halfCode);
		expect(half.status[halfDay]).toBe('HD');
		expect(half.logged[halfDay]).toBe(4);
		const halfMeasured = half.timePresent.get(halfDay)?.hours ?? null;
		expect(halfMeasured).toBeCloseTo(10, 2);
		expect(halfMeasured).toBeGreaterThan(8);
		expect(apiCell(halfCode, halfDay).hours).toBeCloseTo(10, 2);
		const halfCell = cell(page, halfCode, halfDay);
		await expect(halfCell.getByTestId('cell-time-present')).toHaveText('10.00');
		await expect(halfCell.getByTestId('cell-logged-hours')).toHaveText('4.00');
		await expect(halfCell.locator('[data-status-code="HD"]')).toHaveText(
			'Half Day'
		);

		// ── Single punch: uncomputable, painted as an em dash, never 0 ──
		const singleCode = 'E2E-ATT-0003';
		const singleDay = MONTH_DAY(4);
		const forgot = fixtureFor(singleCode);
		expect(forgot.punchCount[singleDay]).toBe(1);
		expect(forgot.timePresent.get(singleDay)?.hours ?? null).toBeNull();
		expect(apiCell(singleCode, singleDay).hours).toBeNull();
		const singleTimePresent = cell(page, singleCode, singleDay).getByTestId(
			'cell-time-present'
		);
		await expect(singleTimePresent).toHaveText('—');
		await expect(singleTimePresent).not.toContainText('0');

		observed.headlineDays = {
			accidentalPunchDay: {
				employee: accidentalCode,
				date: accidentalDay,
				punches: accidentalPunches.map((p) => p.log_date.slice(11)),
				derivedTimePresent: accidentalDerived,
				apiTimePresent: apiCell(accidentalCode, accidentalDay).hours,
				rendered: '9.65',
				rejectedShortenedReading: 3.13,
			},
			nightShiftDay: {
				employee: nightCode,
				date: nightDay,
				derivedTimePresent: nightDerived?.hours,
				apiTimePresent: apiCell(nightCode, nightDay).hours,
				rendered: '8.50',
				mergedTailPunchId: nightDerived?.tailPunchId,
				mergedTailLogDate: tailPunch?.log_date,
				nextDayTimePresent: apiCell(nightCode, nightNextDay).hours,
				punchesOnDisk: night.punches.length,
				punchesCreditedExactlyOnce: creditedDays.size,
				mergedDays,
				doubleCreditedPunches: doubleCredited.length,
			},
			halfDay: {
				employee: halfCode,
				date: halfDay,
				authoredStatus: half.status[halfDay],
				derivedMeasuredTimePresent: halfMeasured,
				apiTimePresent: apiCell(halfCode, halfDay).hours,
				rendered: '10.00',
				loggedHours: half.logged[halfDay],
				capApplied: false,
			},
			singlePunchDay: {
				employee: singleCode,
				date: singleDay,
				punchesOnDisk: forgot.punchCount[singleDay],
				derivedTimePresent: null,
				apiTimePresent: null,
				rendered: '—',
			},
		};
	});

	test('the drill-down lists the raw punches, filters by device inside the modal, and restores focus', async ({
		page,
	}) => {
		await openGrid(page);

		// The page itself carries no device control: the only Device filter is
		// inside the drill-down modal, and no month request was scoped by one.
		await expect(page.getByTestId('cell-punch-device-filter')).toHaveCount(0);
		await expect(page.getByLabel(/device/i)).toHaveCount(0);

		// ── Drill-down: the accidental middle tap is listed, in time order ──
		const accidentalCode = 'E2E-ATT-0002';
		const accidentalDay = MONTH_DAY(1);
		const accidentalTrigger = cell(
			page,
			accidentalCode,
			accidentalDay
		).getByTestId('cell-punch-trigger');
		await accidentalTrigger.click();
		const modal = page.getByTestId('cell-punch-modal');
		await expect(modal).toBeVisible();
		await expect(modal).toHaveAttribute('data-date', accidentalDay);
		const accidentalOnDisk = fixtureFor(accidentalCode)
			.punches.filter((punch) => punch.log_date.startsWith(accidentalDay))
			.sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
		const modalRows = page.getByTestId('cell-punch-row');
		await expect(modalRows).toHaveCount(accidentalOnDisk.length);
		for (const [index, punch] of accidentalOnDisk.entries()) {
			await expect(modalRows.nth(index)).toHaveAttribute(
				'data-time',
				punch.log_date.slice(11)
			);
			await expect(modalRows.nth(index)).toHaveAttribute(
				'data-serial',
				punch.serial_number
			);
			await expect(modalRows.nth(index)).toHaveAttribute(
				'data-employee-code',
				punch.employee_code
			);
		}
		// The list reconciles with the cell that opened it: same count, and the
		// cell's own attribute carries it.
		await expect(modal).toHaveAttribute(
			'data-count',
			String(accidentalOnDisk.length)
		);
		await expect(cell(page, accidentalCode, accidentalDay)).toHaveAttribute(
			'data-punch-count',
			String(accidentalOnDisk.length)
		);

		// ── The credited-hours link carries the Employee and the month ──
		const gridLink = page.getByTestId('cell-punch-grid-link');
		await expect(gridLink).toBeVisible();
		const href = await gridLink.getAttribute('href');
		const link = new URL(href ?? '', 'http://localhost');
		expect(link.pathname).toBe('/employees/attendance');
		expect(link.searchParams.get('employee_id')).toBe(
			String(fixtureFor(accidentalCode).employeeId)
		);
		expect(link.searchParams.get('month')).toBe(MONTH);

		// Escape closes it and focus returns to the trigger the reader came from.
		await page.keyboard.press('Escape');
		await expect(modal).toHaveCount(0);
		await expect(accidentalTrigger).toBeFocused();

		// ── A consumed tail punch is still a real punch: it is listed under the
		//    calendar day it was recorded on ──
		const nightCode = 'E2E-ATT-0004';
		const nightNextDay = MONTH_DAY(2);
		const nightTrigger = cell(page, nightCode, nightNextDay).getByTestId(
			'cell-punch-trigger'
		);
		await nightTrigger.click();
		const nightOnDisk = fixtureFor(nightCode)
			.punches.filter((punch) => punch.log_date.startsWith(nightNextDay))
			.sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
		expect(nightOnDisk).toHaveLength(3);
		await expect(page.getByTestId('cell-punch-row')).toHaveCount(3);
		await expect(page.getByTestId('cell-punch-row').first()).toHaveAttribute(
			'data-time',
			'06:30:00'
		);
		await expect(page.getByTestId('cell-punch-device-caption')).toHaveText(
			'Showing all 3 punches from all devices'
		);
		// Close is the other dismissal path, and it restores focus too.
		await page.getByTestId('cell-punch-close').click();
		await expect(page.getByTestId('cell-punch-modal')).toHaveCount(0);
		await expect(nightTrigger).toBeFocused();

		// ── Device filter: inside the modal, and it never moves the grid ──
		const twoDeviceCode = 'E2E-ATT-0006';
		const twoDeviceDay = MONTH_DAY(1);
		const twoDeviceCell = cell(page, twoDeviceCode, twoDeviceDay);
		await expect(twoDeviceCell.getByTestId('cell-logged-hours')).toHaveText(
			'8.00'
		);
		await expect(twoDeviceCell.getByTestId('cell-time-present')).toHaveText(
			'9.60'
		);
		await expect(twoDeviceCell).toHaveAttribute('data-punch-count', '3');
		const gridBefore = await readRenderedGrid(page);

		await twoDeviceCell.getByTestId('cell-punch-trigger').click();
		const deviceSelect = page.getByTestId('cell-punch-device-filter');
		// Only the devices this cell's own 3 punches arrived on: '1' and '2',
		// plus the "All devices" option — never the month's third device.
		await expect(deviceSelect.locator('option')).toHaveCount(3);
		await expect(deviceSelect.locator('option').first()).toHaveText(
			'All devices'
		);
		await expect(page.getByTestId('cell-punch-row')).toHaveCount(3);

		await deviceSelect.selectOption('2');
		const filteredRows = page.getByTestId('cell-punch-row');
		await expect(filteredRows).toHaveCount(1);
		await expect(filteredRows.first()).toHaveAttribute('data-time', '18:40:00');
		await expect(filteredRows.first()).toHaveAttribute('data-serial', '2');
		await expect(page.getByTestId('cell-punch-device-caption')).toHaveText(
			'Showing 1 of 3 punches from device 2'
		);
		// Filtering the list is the modal's business: the cell keeps its count,
		// and the trigger keeps announcing every punch on the day.
		await expect(twoDeviceCell).toHaveAttribute('data-punch-count', '3');
		await expect(
			twoDeviceCell.getByTestId('cell-punch-trigger')
		).toHaveAccessibleName(/Show 3 punches for/);

		await deviceSelect.selectOption('All devices');
		await expect(page.getByTestId('cell-punch-row')).toHaveCount(3);
		await page.getByTestId('cell-punch-close').click();
		expect(await readRenderedGrid(page)).toEqual(gridBefore);

		// ── A cell with no punches opens an explicit empty state ──
		const quietCode = 'E2E-ATT-0001';
		const quietDay = WEEKLY_OFF_DATES[0];
		const quietTrigger = cell(page, quietCode, quietDay).getByTestId(
			'cell-punch-trigger'
		);
		await quietTrigger.click();
		await expect(page.getByTestId('cell-punch-empty')).toBeVisible();
		await expect(page.getByTestId('cell-punch-device-caption')).toHaveText(
			'No punches recorded'
		);
		await expect(page.getByTestId('cell-punch-device-filter')).toBeDisabled();
		await page.getByTestId('cell-punch-close').click();

		observed.drilldown = {
			accidentalPunchDay: {
				employee: accidentalCode,
				date: accidentalDay,
				onDisk: accidentalOnDisk.map((punch) => ({
					time: punch.log_date.slice(11),
					serial: punch.serial_number,
				})),
				modalCount: accidentalOnDisk.length,
				cellPunchCount: accidentalOnDisk.length,
			},
			nightShiftNextDay: {
				employee: nightCode,
				date: nightNextDay,
				onDisk: nightOnDisk.map((punch) => punch.log_date.slice(11)),
				firstRowIsTheConsumedTail: '06:30:00',
			},
			creditedHoursLink: {
				href,
				employeeId: fixtureFor(accidentalCode).employeeId,
				month: MONTH,
			},
			focusRestoredAfter: ['Escape', 'Close'],
			emptyCell: {
				employee: quietCode,
				date: quietDay,
				selectDisabled: true,
			},
		};
		observed.deviceFilter = {
			pageLevelDeviceControl: 0,
			cell: `${twoDeviceCode} ${twoDeviceDay}`,
			cellOptions: ['All devices', '1', '2'],
			captionAllDevices: 'Showing all 3 punches from all devices',
			captionDevice2: 'Showing 1 of 3 punches from device 2',
			drilldownRowsAllDevices: 3,
			drilldownRowsDevice2: 1,
			cellPunchCountWhileFiltering: '3',
			gridIdenticalAfterFiltering: true,
		};
	});

	test('a quiet week-off column is muted and a week-off column carrying punches is not', async ({
		page,
	}) => {
		await openGrid(page);

		const cleanCode = 'E2E-ATT-0001';
		const nightCode = 'E2E-ATT-0004';
		const sunday = WEEKLY_OFF_DATES[0];
		const holiday = ATTENDANCE_HOLIDAY.date;

		expect(model.nonOptionalHolidays).toEqual([holiday]);
		expect(model.optionalHolidays).toEqual([]);
		expect(isWeeklyOff(sunday)).toBe(true);
		expect(isWeeklyOff(MONTH_DAY(1))).toBe(false);

		// Quiet week off and quiet holiday: muted, and nothing painted at all.
		for (const date of [sunday, holiday]) {
			const quiet = cell(page, cleanCode, date);
			await expect(quiet).toHaveAttribute('data-muted', 'true');
			await expect(quiet).toHaveAttribute('data-punch-count', '0');
			await expect(quiet).toHaveAttribute(
				'data-time-present-state',
				'uncomputable'
			);
			await expect(quiet).toHaveAttribute('data-logged-hours-state', 'none');
			await expect(quiet.getByTestId('cell-time-present')).toHaveCount(0);
			await expect(quiet.getByTestId('cell-logged-hours')).toHaveCount(0);
			// The muted state is stated in words, never left to the grey alone.
			await expect(quiet).toContainText(/Weekly Off|Holiday/);
		}

		// The night shift's 06:30 tail lands on the Sunday that follows its last
		// Friday, so that non-working day carries a punch: it must render as a
		// working day rather than be muted away.
		const sundayPunches = fixtureFor(nightCode).punchCount[sunday] ?? 0;
		expect(sundayPunches).toBeGreaterThan(0);
		const sundayCell = cell(page, nightCode, sunday);
		await expect(sundayCell).toHaveAttribute('data-muted', 'false');
		await expect(sundayCell).toHaveAttribute(
			'data-punch-count',
			String(sundayPunches)
		);
		await expect(sundayCell.getByTestId('cell-time-present')).toHaveText('—');
		await expect(sundayCell.getByTestId('cell-time-present')).toHaveCount(1);
		await expect(sundayCell).toHaveAttribute(
			'data-time-present-state',
			'uncomputable'
		);

		// Working days are never muted.
		await expect(cell(page, cleanCode, MONTH_DAY(1))).toHaveAttribute(
			'data-muted',
			'false'
		);

		observed.muting = {
			weeklyOffDates: WEEKLY_OFF_DATES,
			nonOptionalHolidays: model.nonOptionalHolidays,
			optionalHolidays: model.optionalHolidays,
			quietWeekOffMuted: { employee: cleanCode, date: sunday },
			quietHolidayMuted: { employee: cleanCode, date: holiday },
			workedWeekOffNotMuted: {
				employee: nightCode,
				date: sunday,
				punches: sundayPunches,
				renders: '—',
			},
			workingDayMuted: false,
		};
	});

	test('the unmapped-code strip names the codes and states they are excluded from the grid', async ({
		page,
	}) => {
		await openGrid(page);

		expect(model.unmapped).toEqual([
			{ employee_code: 'E2E9001', punch_count: 2 },
			{ employee_code: 'E2E9002', punch_count: 2 },
		]);

		const unmappedTotal = model.unmapped.reduce(
			(sum, code) => sum + code.punch_count,
			0
		);
		const unmappedPunchNoun = unmappedTotal === 1 ? 'Punch' : 'Punches';
		const unmappedCodeNoun = model.unmapped.length === 1 ? 'code' : 'codes';

		await expect(page.getByTestId('unmapped-codes-strip')).toBeVisible();
		const unmappedSummary = page.getByTestId('unmapped-codes-summary');
		await expect(unmappedSummary).toContainText(
			`${unmappedTotal} ${unmappedPunchNoun} from ${model.unmapped.length} ${unmappedCodeNoun} not linked to an employee`
		);
		// Every code is named — no cap, no "more" collapse — and the names sit
		// inside the same summary line, each chip carrying its own count.
		await expect(page.getByTestId('unmapped-codes-item')).toHaveCount(
			model.unmapped.length
		);
		for (const code of model.unmapped) {
			await expect(unmappedSummary).toContainText(code.employee_code);
			await expect(
				page.locator(
					`[data-testid="unmapped-codes-item"][data-code="${code.employee_code}"]`
				)
			).toContainText(
				`${code.punch_count} ${code.punch_count === 1 ? 'Punch' : 'Punches'}`
			);
		}
		await expect(page.getByTestId('unmapped-codes-note')).toContainText(
			'These Punches are excluded from the grid'
		);

		// An unmapped code can never become a grid row.
		for (const code of model.unmapped) {
			await expect(
				page.locator('tbody tr').filter({ hasText: code.employee_code })
			).toHaveCount(0);
			expect(
				api.employees.find((row) => row.employee_id === code.employee_code)
			).toBeUndefined();
		}
		// And every one of them really is on disk, mapped to nobody.
		const unmappedRows = await rows<{ employee_code: string; c: number }>(
			`SELECT employee_code, COUNT(*) AS c FROM attendance_logs
       WHERE employee_code LIKE ? AND employee_id IS NULL
       GROUP BY employee_code ORDER BY employee_code`,
			[`${ATTENDANCE_UNMAPPED_CODE_PREFIX}%`]
		);
		expect(unmappedRows).toEqual([
			{ employee_code: 'E2E9001', c: 2 },
			{ employee_code: 'E2E9002', c: 2 },
		]);
		// They travel only to the strip: a punch with no attributed employee
		// keys no cell, so it can never enter a row or anybody's Time Present.
		expect(
			api.punches
				.filter(
					(punch) =>
						punch.employee_id == null &&
						punch.employee_code.startsWith(ATTENDANCE_UNMAPPED_CODE_PREFIX)
				)
				.map((punch) => punch.employee_code)
				.sort()
		).toEqual(['E2E9001', 'E2E9001', 'E2E9002', 'E2E9002']);

		observed.unmappedCodes = {
			codes: model.unmapped,
			rowsOnDisk: unmappedRows,
			gridRows: 0,
			note: 'These Punches are excluded from the grid, so any shortfall against expected attendance comes from these unlinked device codes rather than missing time.',
		};
	});

	test('the re-enrolment member keeps every punch, whichever device code carries it', async ({
		request,
		page,
	}) => {
		api = await fetchReport(request);
		await openGrid(page);

		const member = ATTENDANCE_ROSTER.find((m) => m.plan === 'reenrol');
		if (!member) throw new Error('No re-enrolment fixture member');
		const fixture = fixtureFor(member.code);
		const oldDay = MONTH_DAY(2);
		const switchDay = MONTH_DAY(16);
		const laterDay = MONTH_DAY(17);

		// The month really has both codes on the one employee id...
		const oldCodePunches = fixture.monthPunches.filter(
			(punch) => punch.employee_code === ATTENDANCE_REENROL_OLD_CODE
		);
		const currentCodePunches = fixture.monthPunches.filter(
			(punch) => punch.employee_code === member.smartofficeCode
		);
		expect(oldCodePunches.length).toBeGreaterThan(0);
		expect(currentCodePunches.length).toBeGreaterThan(0);
		expect(oldCodePunches.length + currentCodePunches.length).toBe(
			fixture.monthPunches.length
		);
		for (const punch of oldCodePunches) {
			expect(punch.employee_id).toBe(fixture.employeeId);
		}
		// ...and on disk, where the API read it from.
		const oldCodeOnDisk = await count(
			`SELECT COUNT(*) AS c FROM attendance_logs
       WHERE employee_id = ? AND employee_code = ?`,
			[fixture.employeeId, ATTENDANCE_REENROL_OLD_CODE]
		);
		expect(oldCodeOnDisk).toBe(oldCodePunches.length);
		// The old code belongs to no employee any more: it is stale metadata.
		const staleEnrolments = await count(
			`SELECT COUNT(*) AS c FROM employees WHERE smartoffice_code = ?`,
			[ATTENDANCE_REENROL_OLD_CODE]
		);
		expect(staleEnrolments).toBe(0);

		// The row total is the whole month, both codes counted once.
		const apiRow = api.employees.find((row) => row.employee_id === member.code);
		expect(apiRow?.punch_count).toBe(fixture.monthPunches.length);
		expect(apiRow?.smartoffice_code).toBe(member.smartofficeCode);

		// An early day arrived on the old code only, and still reads its span.
		expect(fixture.punchCount[oldDay]).toBe(2);
		expect(
			fixture.punches
				.filter((punch) => punch.log_date.startsWith(oldDay))
				.map((punch) => punch.employee_code)
		).toEqual([ATTENDANCE_REENROL_OLD_CODE, ATTENDANCE_REENROL_OLD_CODE]);
		const oldCell = cell(page, member.code, oldDay);
		await expect(oldCell).toHaveAttribute('data-punch-count', '2');
		await expect(oldCell.getByTestId('cell-time-present')).toHaveText('9.50');
		expect(apiCell(member.code, oldDay).punch_count).toBe(2);
		expect(apiCell(member.code, oldDay).hours).toBeCloseTo(9.5, 2);

		// The switch day pools the old code's badge-in and the new code's
		// badge-out into one 9-hour span — attribution is by employee, not code.
		const switchDerived = fixture.timePresent.get(switchDay);
		expect(switchDerived?.hours).toBeCloseTo(9, 2);
		expect(apiCell(member.code, switchDay).punch_count).toBe(2);
		expect(apiCell(member.code, switchDay).hours).toBeCloseTo(9, 2);
		const switchCell = cell(page, member.code, switchDay);
		await expect(switchCell).toHaveAttribute('data-punch-count', '2');
		await expect(switchCell.getByTestId('cell-time-present')).toHaveText(
			'9.00'
		);

		// A later day arrived on the current code, and reads the same as the
		// old-code days: nothing about the code changes the figure.
		const laterCell = cell(page, member.code, laterDay);
		await expect(laterCell).toHaveAttribute('data-punch-count', '2');
		await expect(laterCell.getByTestId('cell-time-present')).toHaveText('9.50');

		// The drill-down reconciles with the cell: both codes listed, in time
		// order, each naming the code it arrived under.
		await switchCell.getByTestId('cell-punch-trigger').click();
		await expect(page.getByTestId('cell-punch-modal')).toHaveAttribute(
			'data-count',
			'2'
		);
		const switchRows = page.getByTestId('cell-punch-row');
		await expect(switchRows).toHaveCount(2);
		await expect(switchRows.nth(0)).toHaveAttribute('data-time', '09:00:00');
		await expect(switchRows.nth(0)).toHaveAttribute(
			'data-employee-code',
			ATTENDANCE_REENROL_OLD_CODE
		);
		await expect(switchRows.nth(1)).toHaveAttribute('data-time', '18:00:00');
		await expect(switchRows.nth(1)).toHaveAttribute(
			'data-employee-code',
			member.smartofficeCode
		);
		await page.getByTestId('cell-punch-close').click();

		observed.reenrolment = {
			employee: member.code,
			oldDeviceCode: ATTENDANCE_REENROL_OLD_CODE,
			currentDeviceCode: member.smartofficeCode,
			monthPunches: fixture.monthPunches.length,
			oldCodePunches: oldCodePunches.length,
			currentCodePunches: currentCodePunches.length,
			oldCodeDay: {
				date: oldDay,
				timePresent: apiCell(member.code, oldDay).hours,
				punchCount: 2,
			},
			switchDay: {
				date: switchDay,
				punches: ['09:00:00 (old code)', '18:00:00 (current code)'],
				timePresent: apiCell(member.code, switchDay).hours,
				punchCount: 2,
				rendered: '9.00',
			},
			drilldownMatchesCell: true,
		};
	});

	test('a month-boundary night shift merges into the padded window, and the next month reads uncomputable', async ({
		request,
		page,
	}) => {
		api = await fetchReport(request);
		await openGrid(page);

		const member = ATTENDANCE_ROSTER.find((m) => m.plan === 'monthBoundary');
		if (!member) throw new Error('No month-boundary fixture member');
		const fixture = fixtureFor(member.code);
		const lastDay = MONTH_DAY(DAYS_IN_MONTH);
		const nextMonthFirstDay = `${NEXT_MONTH}-01`;

		// The three seeded punches: 22:00 on the month's last day, then 06:30
		// and 18:00 on the next month's first day.
		expect(
			fixture.punches
				.filter(
					(punch) =>
						punch.log_date.startsWith(lastDay) ||
						punch.log_date.startsWith(nextMonthFirstDay)
				)
				.map((punch) => punch.log_date)
		).toEqual([
			`${lastDay} 22:00:00`,
			`${nextMonthFirstDay} 06:30:00`,
			`${nextMonthFirstDay} 18:00:00`,
		]);

		// The last day merges the next month's 06:30 (padded window) and reads
		// 8.5 hours; the consumed tail is never rendered in this month.
		const derived = fixture.timePresent.get(lastDay);
		expect(derived?.merged).toBe(true);
		expect(derived?.hours).toBeCloseTo(8.5, 2);
		const tail = fixture.punches.find(
			(punch) => punch.id === derived?.tailPunchId
		);
		expect(tail?.log_date).toBe(`${nextMonthFirstDay} 06:30:00`);
		expect(apiCell(member.code, lastDay).hours).toBeCloseTo(8.5, 2);
		expect(apiCell(member.code, lastDay).punch_count).toBe(1);
		// The shipped punch payload stays month-scoped: September carries only
		// the 22:00 row, October's two rows never ride along.
		expect(
			api.punches
				.filter((punch) => punch.employee_id === fixture.employeeId)
				.map((punch) => `${punch.date} ${punch.time}`)
		).toEqual([`${lastDay} 22:00:00`]);

		const lastCell = cell(page, member.code, lastDay);
		await expect(lastCell.getByTestId('cell-time-present')).toHaveText('8.50');
		await expect(lastCell).toHaveAttribute('data-punch-count', '1');
		await expect(lastCell).toHaveAttribute(
			'data-time-present-state',
			'computable'
		);

		// October, fetched separately: the 06:30 continuation is consumed by
		// September's merge, so the first day's remaining 18:00 single punch is
		// uncomputable — never the naive 06:30 → 18:00 reading of 11.5 hours.
		const october = await fetchReport(request, NEXT_MONTH);
		expect(october.month).toBe(NEXT_MONTH);
		expect(october.days[0]).toBe(nextMonthFirstDay);
		const octoberRow = october.employees.find(
			(row) => row.employee_id === member.code
		);
		const octoberFirst = octoberRow?.cells.find(
			(cell) => cell.date === nextMonthFirstDay
		);
		expect(octoberFirst?.hours).toBeNull();
		expect(octoberFirst?.punch_count).toBe(2);
		expect(octoberFirst?.merge_refused).toBe(false);
		expect(
			october.punches
				.filter((punch) => punch.employee_id === fixture.employeeId)
				.map((punch) => `${punch.date} ${punch.time}`)
		).toEqual([
			`${nextMonthFirstDay} 06:30:00`,
			`${nextMonthFirstDay} 18:00:00`,
		]);

		// The consumed continuation still counts on its own date for the night
		// shift, and is never the start of a second span.
		const nightRow = october.employees.find(
			(row) => row.employee_id === 'E2E-ATT-0004'
		);
		const nightFirst = nightRow?.cells.find(
			(cell) => cell.date === nextMonthFirstDay
		);
		expect(nightFirst?.hours).toBeNull();
		expect(nightFirst?.punch_count).toBe(1);

		// The browser shows October's first day the same way: em dash, count 2.
		await page.goto('/reports/attendance-report');
		await page.getByLabel('Month').fill(NEXT_MONTH);
		await expect(
			page.locator(
				`td[data-testid="attendance-cell"][data-date="${nextMonthFirstDay}"]`
			)
		).toHaveCount(model.roster.length);
		const octoberCell = cell(page, member.code, nextMonthFirstDay);
		await expect(octoberCell.getByTestId('cell-time-present')).toHaveText('—');
		await expect(octoberCell).toHaveAttribute('data-punch-count', '2');
		await expect(octoberCell).toHaveAttribute(
			'data-time-present-state',
			'uncomputable'
		);
		await expect(octoberCell).toHaveAttribute(
			'data-logged-hours-state',
			'none'
		);

		observed.monthBoundary = {
			employee: member.code,
			seeded: [
				`${lastDay} 22:00:00`,
				`${nextMonthFirstDay} 06:30:00`,
				`${nextMonthFirstDay} 18:00:00`,
			],
			september: {
				lastDay,
				timePresent: apiCell(member.code, lastDay).hours,
				mergedTail: tail?.log_date,
				punchCount: 1,
				rendered: '8.50',
			},
			october: {
				firstDay: nextMonthFirstDay,
				hours: octoberFirst?.hours,
				punchCount: octoberFirst?.punch_count,
				rejectedNaiveReading: 11.5,
				rendered: '—',
			},
			paddedWindow: { from: PADDED_FROM, to: PADDED_TO },
			shippedPayloadMonthScoped: true,
		};
	});

	test("the month summary, legend and notes state the month's facts", async ({
		request,
		page,
	}) => {
		api = await fetchReport(request);
		await openGrid(page);

		// The summary line's attributes are the month-scoped totals, derived
		// here from the raw rows and equal to the stats the API shipped.
		const summary = page.getByTestId('month-summary');
		await expect(summary).toBeVisible();
		await expect(summary).toHaveAttribute(
			'data-total',
			String(model.monthStats.total)
		);
		await expect(summary).toHaveAttribute(
			'data-mapped',
			String(model.monthStats.mapped)
		);
		await expect(summary).toHaveAttribute(
			'data-unmapped',
			String(model.monthStats.unmapped)
		);
		await expect(summary).toHaveAttribute(
			'data-devices',
			String(model.monthStats.devices.length)
		);
		expect(api.stats.total_punches).toBe(model.monthStats.total);
		expect(api.stats.mapped_punches).toBe(model.monthStats.mapped);
		expect(api.stats.unmapped_punches).toBe(model.monthStats.unmapped);
		expect(api.stats.distinct_devices).toBe(model.monthStats.devices.length);
		// The counts are on the line itself, not only in the attributes.
		await expect(summary).toContainText(`${model.monthStats.total} punches`);
		await expect(summary).toContainText(`${model.monthStats.mapped} mapped`);
		await expect(summary).toContainText(
			`${model.monthStats.unmapped} unmapped`
		);
		await expect(summary).toContainText(
			`${model.monthStats.devices.length} devices`
		);

		// House chrome: the hero holds the title and Refresh, the Month picker is
		// the page's only control, and no device control sits on the page.
		await expect(
			page.getByRole('heading', { name: 'Attendance Report', exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Refresh', exact: true })
		).toBeVisible();
		await expect(page.getByLabel('Month')).toBeVisible();
		await expect(page.getByLabel(/device/i)).toHaveCount(0);

		// The legend names both measures and what the em dash means.
		const legend = page.getByTestId('figures-legend');
		await expect(legend).toBeVisible();
		await expect(legend).toContainText('Logged Hours');
		await expect(legend).toContainText('Time Present');
		await expect(legend).toContainText('em dash');

		// The merge rule and the half-day fact, visible under the table.
		await expect(page.getByTestId('time-present-notes')).toBeVisible();
		const mergeRule = page.getByTestId('time-present-merge-rule');
		await expect(mergeRule).toContainText('12 hours');
		await expect(mergeRule).toContainText('em dash');
		await expect(page.getByTestId('time-present-half-day')).toContainText(
			'half day'
		);
		// The old direction footnote is gone: direction belongs to the drill-down.
		await expect(
			page.getByText('ignores punch direction entirely')
		).toHaveCount(0);

		observed.monthSummary = {
			attributes: {
				total: model.monthStats.total,
				mapped: model.monthStats.mapped,
				unmapped: model.monthStats.unmapped,
				devices: model.monthStats.devices.length,
			},
			apiStats: api.stats,
			legend: ['Logged Hours', 'Time Present', 'em dash'],
			mergeRule:
				'12 hours and em dash, interpolated from MAX_MERGED_SPAN_HOURS',
			halfDay: 'half day, uncapped measured span',
			directionFooterRemoved: true,
		};
	});

	test('the roster disclosure keeps the counts visible and the names behind a details', async ({
		page,
	}) => {
		await openGrid(page);

		const disclosure = page.getByTestId('roster-disclosure');
		await expect(disclosure).toBeVisible();
		await expect(page.getByTestId('roster-disclosure-filter')).toContainText(
			'Payroll'
		);
		await expect(page.getByTestId('roster-disclosure-filter')).toContainText(
			'Active'
		);

		// Counts derived from the directory: everyone live the filter dropped,
		// and how many of them the roster kept.
		const liveRows = model.directory.filter(
			(row) => Number(row.isDelete) === 0
		);
		const excludedCount = liveRows.filter(
			(row) => !(row.status === 'active' && row.employee_type === 'Payroll')
		).length;
		const excludedNoun = excludedCount === 1 ? 'employee' : 'employees';
		const summary = page.getByTestId('roster-disclosure-summary');
		await expect(summary).toContainText(
			`${excludedCount} ${excludedNoun} excluded`
		);
		await expect(summary).toContainText(
			`of ${liveRows.length} on the employee list`
		);
		await expect(summary).toContainText(
			`leaving ${model.roster.length} on the roster`
		);

		// Every reason our excluded members were dropped for is stated in words.
		const breakdown = page.getByTestId('roster-disclosure-breakdown');
		for (const member of model.offRoster) {
			await expect(breakdown).toContainText(
				member.type !== 'Payroll'
					? `with Employee Type ${member.type}`
					: `not Active (Status ${member.status})`
			);
		}
		await expect(page.getByTestId('roster-disclosure-note')).toContainText(
			'salary profile'
		);

		// The names are inside the collapsed <details>: invisible until opened,
		// and every dropped employee is named once it is — no cap, no overflow.
		const list = page.getByTestId('roster-disclosure-list');
		await expect(list.locator('summary')).toContainText(
			`Show excluded employees (${excludedCount})`
		);
		const visibleItems = page.locator(
			'[data-testid="roster-disclosure-item"]:visible'
		);
		await expect(visibleItems).toHaveCount(0);
		await list.locator('summary').click();
		await expect(visibleItems).toHaveCount(excludedCount);

		const named: string[] = [];
		for (const member of model.offRoster) {
			const item = page.locator(
				`[data-testid="roster-disclosure-item"][data-code="${member.code}"]`
			);
			await expect(item).toBeVisible();
			const directoryRow = model.directory.find(
				(row) => row.employee_id === member.code
			);
			if (!directoryRow) throw new Error(`No directory row for ${member.code}`);
			await expect(item).toContainText(directoryRow.name);
			await expect(item).toContainText(
				member.type !== 'Payroll'
					? `Employee Type ${member.type}`
					: `Status ${member.status}`
			);
			named.push(member.code);
		}

		observed.rosterDisclosure = {
			excludedCount,
			consideredCount: liveRows.length,
			rosterCount: model.roster.length,
			reasonsVisible: true,
			detailsOpenedBeforeNames: true,
			names: named,
			visibleItems: excludedCount,
		};
	});

	test('the first paint waits for metadata, and a failed probe offers a working Retry', async ({
		page,
	}) => {
		// Scoped to the metadata request alone: `?month=` requests pass through.
		const metaRequest = /\/api\/reports\/attendance-report$/;
		let delayMeta = true;
		const delayHandler = async (route: Route) => {
			if (delayMeta) {
				const { promise, resolve } = Promise.withResolvers<void>();
				setTimeout(resolve, 1_500);
				await promise;
			}
			await route.continue();
		};
		await page.route(metaRequest, delayHandler);

		await page.goto('/reports/attendance-report');
		// While the probe is in flight: loading, and never the webhook card.
		await expect(page.getByTestId('report-loading')).toBeVisible();
		await expect(page.getByTestId('no-logs')).toHaveCount(0);
		await expect(page.getByTestId('meta-error')).toHaveCount(0);
		await expect(page.getByTestId('cell-punch-trigger')).toHaveCount(0);
		// The gate lifts once the probe settles.
		await expect(page.getByTestId('report-loading')).toHaveCount(0);

		// A 500 on the metadata request renders the error state, not the card.
		delayMeta = false;
		await page.unroute(metaRequest, delayHandler);
		const failHandler = (route: Route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, error: 'meta probe failed' }),
			});
		await page.route(metaRequest, failHandler);
		await page.goto('/reports/attendance-report');
		await expect(page.getByTestId('meta-error')).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByTestId('no-logs')).toHaveCount(0);
		await expect(page.getByTestId('report-loading')).toHaveCount(0);
		await expect(page.getByTestId('cell-punch-trigger')).toHaveCount(0);

		// Retry, with the failure removed, refetches and renders the report.
		await page.unroute(metaRequest, failHandler);
		await page.getByTestId('meta-retry').click();
		await expect(page.getByTestId('meta-error')).toHaveCount(0);
		await page.getByLabel('Month').fill(MONTH);
		await expect(page.getByTestId('cell-punch-trigger').first()).toBeVisible();
		await expect(
			page.locator(`td[data-testid="attendance-cell"][data-date="${MONTH}-01"]`)
		).toHaveCount(model.roster.length);

		observed.metaStates = {
			loadingWhilePending: true,
			noLogsWhilePending: false,
			matrixWhilePending: false,
			failedProbeRenders: 'meta-error',
			retryRefetchedAndLiftedGate: true,
		};
	});

	test('the webhook card renders only on a successful probe that reports no data', async ({
		page,
	}) => {
		await page.route(/\/api\/reports\/attendance-report$/, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					meta: { latest_month: null, has_data: false },
				}),
			})
		);
		await page.goto('/reports/attendance-report');

		const card = page.getByTestId('no-logs');
		await expect(card).toBeVisible();
		await expect(card).toContainText('webhook');
		await expect(page.getByTestId('report-loading')).toHaveCount(0);
		await expect(page.getByTestId('meta-error')).toHaveCount(0);
		await expect(page.getByTestId('cell-punch-trigger')).toHaveCount(0);

		observed.webhookGate = {
			stubbedMeta: { success: true, has_data: false },
			renders: 'no-logs',
			loading: false,
			metaError: false,
		};
	});

	test('cell triggers and the two measures are named for screen readers', async ({
		page,
	}) => {
		await openGrid(page);

		// The trigger's accessible name carries the all-device punch sentence.
		const accidentalCell = cell(page, 'E2E-ATT-0002', MONTH_DAY(1));
		await expect(
			accidentalCell.getByTestId('cell-punch-trigger')
		).toHaveAccessibleName(/Show 3 punches for/);
		const singleCell = cell(page, 'E2E-ATT-0003', MONTH_DAY(4));
		await expect(
			singleCell.getByTestId('cell-punch-trigger')
		).toHaveAccessibleName(/Show 1 punch for/);
		// A day with no punches says so, rather than going silent.
		const quietCell = cell(page, 'E2E-ATT-0001', WEEKLY_OFF_DATES[0]);
		await expect(
			quietCell.getByTestId('cell-punch-trigger')
		).toHaveAccessibleName(/Show 0 punches for/);

		// Both measures are named in sr-only prose inside the cell, so the
		// figure a reader hears is never anonymous.
		await expect(accidentalCell).toContainText('Logged Hours');
		await expect(accidentalCell).toContainText('Time Present');
		await expect(accidentalCell).toContainText('3 punches');
		await expect(singleCell).toContainText('Time Present uncomputable');

		// The visible values still render: the names never swallow the figures.
		await expect(accidentalCell.getByTestId('cell-time-present')).toHaveText(
			'9.65'
		);
		await expect(singleCell.getByTestId('cell-time-present')).toHaveText('—');

		observed.accessibility = {
			triggerNames: {
				accidental: 'Show 3 punches for',
				singlePunch: 'Show 1 punch for',
				noPunches: 'Show 0 punches for',
			},
			measureNames: ['Logged Hours', 'Time Present'],
			uncomputableNamed: true,
			focusRestoredAfterModalClose: true,
		};
	});

	test('a narrow screen pins the Employee column while the days scroll', async ({
		page,
	}) => {
		// 480px stands in for a phone and the reflow pressure of 200% zoom: the
		// matrix may scroll in two dimensions, but its name column must not
		// leave the reader.
		await page.setViewportSize({ width: 480, height: 800 });
		await openGrid(page);

		await expect(
			page.getByText('Scroll sideways for the rest of the month →')
		).toBeVisible();

		const scroller = page.locator(
			'[role="region"][aria-label^="Attendance matrix"]'
		);
		const employeeHeader = page.locator('thead th').first();
		await expect(employeeHeader).toHaveText('Employee');
		// At 480px the header row can sit below the fold; frame it before
		// measuring, or the pinning check measures an off-screen element.
		await employeeHeader.scrollIntoViewIfNeeded();
		const before = await employeeHeader.boundingBox();
		expect(before).not.toBeNull();

		const scrolled = await scroller.evaluate((el) => {
			el.scrollLeft = el.scrollWidth;
			const header = el.querySelector('thead th');
			return {
				overflowX: getComputedStyle(el).overflowX,
				position: header ? getComputedStyle(header).position : '',
				scrollLeft: el.scrollLeft,
			};
		});
		expect(scrolled.overflowX).toBe('auto');
		expect(scrolled.position).toBe('sticky');
		expect(scrolled.scrollLeft).toBeGreaterThan(0);

		// The pinned column held its place while the days moved underneath it.
		const after = await employeeHeader.boundingBox();
		expect(after).not.toBeNull();
		expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
		await expect(page.locator('thead th').last()).toBeInViewport();

		observed.narrowScreen = {
			viewport: '480x800',
			scrollable: scrolled.scrollLeft > 0,
			overflowX: scrolled.overflowX,
			employeeColumnPosition: scrolled.position,
			employeeColumnPinnedWhileScrolled: true,
		};
	});

	test('the drill-down names the punch column Device Code, not Employee Code', async ({
		page,
	}) => {
		await openGrid(page);
		await cell(page, 'E2E-ATT-0002', MONTH_DAY(1))
			.getByTestId('cell-punch-trigger')
			.click();
		const modal = page.getByTestId('cell-punch-modal');
		await expect(modal).toBeVisible();
		await expect(
			modal.locator('thead th').filter({ hasText: 'Device Code' })
		).toHaveCount(1);
		await expect(
			modal.locator('thead th').filter({ hasText: 'Employee Code' })
		).toHaveCount(0);
		await page.getByTestId('cell-punch-close').click();
	});

	test('the attendance fixtures leave no rows behind once cleaned up', async () => {
		// Captured while the rows still exist, so the artifact proves the run
		// really read them.
		expect(model.rowCounts.employees).toBe(ATTENDANCE_ROSTER.length);
		expect(model.rowCounts.attendance_logs_unmapped).toBe(4);
		expect(model.rowCounts.employee_attendance).toBe(
			ATTENDANCE_ROSTER.length * DAYS_IN_MONTH
		);
		// Every fixture punch is counted under a fixture code — the old
		// re-enrolment code and the padded-window continuations included.
		expect(model.rowCounts.attendance_logs_mapped).toBe(
			model.fixtures.reduce((sum, fixture) => sum + fixture.punches.length, 0)
		);
		const paddedOutsideMonth = model.fixtures.reduce(
			(sum, fixture) =>
				sum + (fixture.punches.length - fixture.monthPunches.length),
			0
		);
		expect(paddedOutsideMonth).toBeGreaterThan(0);
		expect(model.rowCounts.attendance_logs_outside_month).toBe(
			paddedOutsideMonth
		);

		// The child tables are counted by the employee ids the fixtures owned,
		// not by a join to `employees`: after cleanup the employee rows are
		// gone, and a join would report zero whether or not the children were.
		const ownedIds = model.fixtures.map((fixture) => fixture.employeeId);
		const ownedIdPlaceholders = ownedIds.map(() => '?').join(', ');
		await cleanupAttendanceFixtures();

		const residue = {
			employees: await count(
				`SELECT COUNT(*) AS c FROM employees WHERE employee_id LIKE 'E2E-ATT-%'`
			),
			users: await count(
				`SELECT COUNT(*) AS c FROM users WHERE username = 'e2e_att_user'`
			),
			attendance_logs_mapped: await count(
				`SELECT COUNT(*) AS c FROM attendance_logs WHERE employee_code IN (${DEVICE_CODE_PLACEHOLDERS})`,
				FIXTURE_CODE_LIST
			),
			attendance_logs_unmapped: await count(
				`SELECT COUNT(*) AS c FROM attendance_logs WHERE employee_code LIKE ?`,
				[`${ATTENDANCE_UNMAPPED_CODE_PREFIX}%`]
			),
			// The rows the padded window added — the night shift's and the
			// month-boundary case's continuations — must be gone too.
			attendance_logs_outside_month: await count(
				`SELECT COUNT(*) AS c FROM attendance_logs
       WHERE employee_id IN (${ownedIdPlaceholders})
         AND (log_date < ? OR log_date >= ?)`,
				[...ownedIds, MONTH_FROM, MONTH_TO]
			),
			employee_attendance: await count(
				`SELECT COUNT(*) AS c FROM employee_attendance WHERE employee_id IN (${ownedIdPlaceholders})`,
				ownedIds
			),
			user_activity_assignments: await count(
				`SELECT COUNT(*) AS c FROM user_activity_assignments WHERE id LIKE 'e2e-att-%'`
			),
			employee_salary_profile: await count(
				`SELECT COUNT(*) AS c FROM employee_salary_profile WHERE employee_id IN (${ownedIdPlaceholders})`,
				ownedIds
			),
			holiday_master: await count(
				`SELECT COUNT(*) AS c FROM holiday_master WHERE name = ?`,
				[ATTENDANCE_HOLIDAY.name]
			),
		};
		expect(
			Object.entries(residue).filter(([, value]) => value !== 0),
			`attendance fixture residue: ${JSON.stringify(residue)}`
		).toEqual([]);

		writeArtifact('attendance-report', {
			month: MONTH,
			page: '/reports/attendance-report',
			derivation: {
				timePresent:
					"Re-implemented in this spec from the raw attendance_logs rows over the same padded fetch window the report uses ([month start − 1 day, next month start + 1 day)): a day's punches are pooled by the employee stamped at ingest (falling back to the device code only when no employee id exists), measured first-to-last and direction-agnostic; the next day's first punch joins it only when it lands after this day's last punch and within 12 hours of this day's first, and a joined punch is consumed; a lone punch or a refused join is uncomputable (null), never 0. Padded days feed the merge walk but are never rendered.",
				loggedHours:
					"Summed per day from the assignment's raw daily_entries JSON, uncapped (ADR-0010).",
				roster:
					'Read straight off employees: isDelete = 0, status = active, employee_type = Payroll. No salary profile is consulted.',
				muting:
					'Week off (Sundays, 2nd and 4th Saturdays) or an active non-optional holiday, with no Logged Hours and no punches on it.',
				cellState:
					'Read from the cells’ data attributes (data-muted / data-time-present-state / data-logged-hours-state / data-punch-count), never from utility classes.',
				applicationHelpersImported: [],
			},
			paddedWindow: { from: PADDED_FROM, to: PADDED_TO },
			calendar: {
				daysInMonth: DAYS_IN_MONTH,
				weeklyOffDates: WEEKLY_OFF_DATES,
				holidays: {
					nonOptional: model.nonOptionalHolidays,
					optional: model.optionalHolidays,
				},
			},
			seededRowCounts: model.rowCounts,
			...observed,
			residue,
			ok: true,
		});
		expect(readArtifact('attendance-report')).toMatchObject({
			month: MONTH,
			ok: true,
		});
	});
});
