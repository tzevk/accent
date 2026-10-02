import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import {
	ATTENDANCE_HOLIDAY,
	ATTENDANCE_MONTH,
	ATTENDANCE_ROSTER,
	ATTENDANCE_UNMAPPED_CODE_PREFIX,
	cleanupAttendanceFixtures,
	type AttendanceMember,
} from '../lib/attendance-fixtures';

/**
 * The Attendance report grid (issue #285), proven end to end: the real page in
 * a real browser against the real database.
 *
 * Every expected figure below is derived HERE, from the raw rows the attendance
 * fixtures wrote plus the calendar. The Time Present rule is re-implemented
 * from its written form — the day's first punch to its last, direction
 * agnostic, pooled across devices, a next-day punch merging in only inside a
 * 12-hour window and then being consumed, a lone punch uncomputable — and the
 * roster and week-off rules are re-derived from `employees` and the calendar
 * too. Nothing in this file imports `@/lib/time-present`, `@/lib/logged-hours`,
 * `@/utils/weekly-off`, the report's `data-source`, `cell-status` or `roster`,
 * so the report cannot mark its own homework.
 *
 * Each test asserts both halves: what the API returned and what the browser
 * rendered, against rows read back with this harness's own mysql2 client.
 */

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
 * Time Present for one device code's punches, in the order they were punched.
 *
 * Days are walked in date order, so the day that owns a tail is measured
 * before the day the tail landed on: the tail is credited once and dropped
 * from the following day, which is what makes a night shift read as 8.5 hours
 * on the day it began rather than 6 hours and a half on each of two days.
 */
function deriveTimePresent(punches: RawPunch[]): Map<string, DerivedDay> {
	const buckets = new Map<string, RawPunch[]>();
	for (const punch of punches) {
		const key = `${punch.employee_code}|${punch.log_date.slice(0, 10)}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(punch);
		else buckets.set(key, [punch]);
	}
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
	}

	const datesByCode = new Map<string, string[]>();
	for (const key of buckets.keys()) {
		const separator = key.lastIndexOf('|');
		const code = key.slice(0, separator);
		const dates = datesByCode.get(code) ?? [];
		dates.push(key.slice(separator + 1));
		datesByCode.set(code, dates);
	}
	for (const dates of datesByCode.values()) dates.sort();

	const consumed = new Set<number>();
	const derived = new Map<string, DerivedDay>();
	for (const [code, dates] of datesByCode) {
		for (const date of dates) {
			const own = (buckets.get(`${code}|${date}`) ?? []).filter(
				(punch) => !consumed.has(punch.id)
			);
			// A day emptied by the previous day's merge has no presence of its own.
			if (own.length === 0) continue;

			const firstMs = punchMs(own[0].log_date);
			let lastMs = punchMs(own[own.length - 1].log_date);
			let merged = false;
			let refused = false;
			let tailPunchId: number | null = null;

			const followingMs = Date.parse(`${date}T00:00:00Z`) + 86_400_000;
			const following = Number.isFinite(followingMs)
				? new Date(followingMs).toISOString().slice(0, 10)
				: null;
			const tail = following
				? (buckets.get(`${code}|${following}`) ?? []).find(
						(punch) => !consumed.has(punch.id)
					)
				: undefined;

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

			derived.set(`${code}|${date}`, { hours, merged, refused, tailPunchId });
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
	employee_type: string | null;
	status: string;
	isDelete: number;
	smartoffice_code: string | null;
}

interface FixtureExpectation {
	member: AttendanceMember;
	employeeId: number;
	/** `${deviceCode}|${date}` → the day's expected Time Present. */
	timePresent: Map<string, DerivedDay>;
	/** `${YYYY-MM-DD}` → expected Logged Hours. */
	logged: Record<string, number>;
	/** `${YYYY-MM-DD}` → the authored `employee_attendance.status`. */
	status: Record<string, string>;
	/** `${YYYY-MM-DD}` → punch rows for this employee on that day. */
	punchCount: Record<string, number>;
	punches: RawPunch[];
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
	/** Row counts of every table the attendance fixtures own, while seeded. */
	rowCounts: Record<string, number>;
}

const FIXTURE_CODE_LIST = ATTENDANCE_ROSTER.map(
	(member) => member.smartofficeCode
);
const DEVICE_CODE_PLACEHOLDERS = FIXTURE_CODE_LIST.map(() => '?').join(', ');

async function count(sql: string, params: unknown[] = []): Promise<number> {
	const [row] = await rows<{ c: number }>(sql, params);
	return Number(row?.c ?? 0);
}

async function buildModel(): Promise<Model> {
	const directory = await rows<EmployeeRow>(
		`SELECT id, employee_id, employee_type, status, isDelete, smartoffice_code
     FROM employees`
	);

	const punches = await rows<RawPunch>(
		`SELECT id, employee_code, log_date, serial_number, employee_id
     FROM attendance_logs
     WHERE log_date >= ? AND log_date < ?
     ORDER BY log_date, id`,
		[`${MONTH_PREFIX}01 00:00:00`, `${NEXT_MONTH}-01 00:00:00`]
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

		// A punch is this employee's only when the resolved row id AND the
		// enrolled device code both match, so an unmapped code can never be
		// read as somebody's presence.
		const own = punches.filter(
			(punch) =>
				punch.employee_id === employee.id &&
				punch.employee_code === member.smartofficeCode
		);

		const punchCount: Record<string, number> = {};
		for (const punch of own) {
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
		});
	}

	const unmappedCounts = new Map<string, number>();
	for (const punch of punches) {
		if (punch.employee_id) continue;
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
	};
	holidays: { non_optional: string[]; optional: string[] };
	devices: string[];
}

let model: Model;
let api: ArData;
const observed: Record<string, unknown> = {};

test.beforeAll(async () => {
	model = await buildModel();
});

async function fetchReport(request: APIRequestContext): Promise<ArData> {
	const response = await request.get(
		`/api/reports/attendance-report?month=${encodeURIComponent(MONTH)}`
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
	muted: boolean;
}

/**
 * The whole grid as the browser painted it: one entry per employee per day,
 * read from the DOM of the page under test.
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
					cells[td.getAttribute('data-date') ?? ''] = {
						logged: text('[data-testid="cell-logged-hours"]'),
						timePresent: text('[data-testid="cell-time-present"]'),
						status:
							td
								.querySelector('[data-status-code]')
								?.getAttribute('data-status-code') ?? null,
						muted: td.className.includes('bg-gray-50'),
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
	const hours =
		fixture.timePresent.get(`${fixture.member.smartofficeCode}|${date}`)
			?.hours ?? null;
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
		// it has a salary profile — the filter reads the employee record.
		expect(model.onRoster).toHaveLength(11);
		for (const member of model.onRoster) {
			const fixture = fixtureFor(member.code);
			const apiRow = api.employees.find(
				(row) => row.employee_id === member.code
			);
			expect(apiRow, `${member.code} missing from the API roster`).toBeTruthy();
			expect(apiRow?.cells).toHaveLength(DAYS_IN_MONTH);
			expect(apiRow?.smartoffice_code).toBe(member.smartofficeCode);
			expect(apiRow?.punch_count).toBe(fixture.punches.length);
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
			if (apiRow.punch_count !== fixture.punches.length) {
				mismatches.push(
					`${fixture.member.code}: ${apiRow.punch_count} punches on the row vs ${fixture.punches.length} on disk`
				);
			}
			for (const cell of apiRow.cells) {
				const derived = fixture.timePresent.get(
					`${fixture.member.smartofficeCode}|${cell.date}`
				);
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

		observed.apiCells = {
			cellsChecked: model.onRoster.length * DAYS_IN_MONTH,
			mismatches: mismatches.length,
			derivedFrom:
				'attendance_logs + user_activity_assignments + employee_attendance rows read back with the harness client',
			unmappedPunches: api.stats.unmapped_punches,
			totalPunches: api.stats.total_punches,
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
			accidental.timePresent.get(
				`${accidental.member.smartofficeCode}|${accidentalDay}`
			)?.hours ?? null;
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
		const nightDerived = night.timePresent.get(
			`${night.member.smartofficeCode}|${nightDay}`
		);
		expect(nightDerived?.merged).toBe(true);
		expect(nightDerived?.hours).toBeCloseTo(8.5, 2);
		expect(apiCell(nightCode, nightDay).hours).toBeCloseTo(8.5, 2);
		const tailPunch = night.punches.find(
			(punch) => punch.id === nightDerived?.tailPunchId
		);
		expect(tailPunch?.log_date).toBe(`${nightNextDay} 06:30:00`);
		// The tail is consumed, so it cannot also open the next day's span: that
		// day still reads 8.5 hours from its own 22:00 → 06:30 shift.
		expect(
			night.timePresent.get(`${night.member.smartofficeCode}|${nightNextDay}`)
				?.hours
		).toBeCloseTo(8.5, 2);
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
			const key = `${punch.employee_code}|${punch.log_date.slice(0, 10)}`;
			const bucket = buckets.get(key) ?? [];
			bucket.push(punch);
			buckets.set(key, bucket);
		}
		const creditedDays = new Map<number, Set<string>>();
		let mergedDays = 0;
		for (const [key, bucket] of buckets) {
			const derived = night.timePresent.get(key);
			if (!derived) continue;
			const date = key.slice(key.lastIndexOf('|') + 1);
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
		// tail on the following calendar day; only the very last working day's
		// tail lands in October, outside this month's query window.
		const nightWorkingDays = MONTH_DATES.filter(
			(date) => !isWeeklyOff(date) && !model.nonOptionalHolidays.includes(date)
		).length;
		expect(night.punches).toHaveLength(nightWorkingDays * 3 - 1);

		// ── Half day: measured hours uncapped, beside the authored badge ──
		const halfCode = 'E2E-ATT-0008';
		const halfDay = MONTH_DAY(4);
		const half = fixtureFor(halfCode);
		expect(half.status[halfDay]).toBe('HD');
		expect(half.logged[halfDay]).toBe(4);
		const halfMeasured =
			half.timePresent.get(`${half.member.smartofficeCode}|${halfDay}`)
				?.hours ?? null;
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
		expect(
			forgot.timePresent.get(`${forgot.member.smartofficeCode}|${singleDay}`)
				?.hours
		).toBeNull();
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

	test('the drill-down lists the raw punches, and the Device filter scopes only the drill-down', async ({
		page,
	}) => {
		await openGrid(page);

		// ── Drill-down: the accidental middle tap is listed, in time order ──
		const accidentalCode = 'E2E-ATT-0002';
		const accidentalDay = MONTH_DAY(1);
		await cell(page, accidentalCode, accidentalDay)
			.getByTestId('cell-punch-trigger')
			.click();
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
		await page.getByTestId('cell-punch-close').click();
		await expect(modal).toHaveCount(0);

		// ── A consumed tail punch is still a real punch: it is listed under the
		//    calendar day it was recorded on ──
		const nightCode = 'E2E-ATT-0004';
		const nightNextDay = MONTH_DAY(2);
		await cell(page, nightCode, nightNextDay)
			.getByTestId('cell-punch-trigger')
			.click();
		const nightOnDisk = fixtureFor(nightCode)
			.punches.filter((punch) => punch.log_date.startsWith(nightNextDay))
			.sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
		expect(nightOnDisk).toHaveLength(3);
		await expect(page.getByTestId('cell-punch-row')).toHaveCount(3);
		await expect(page.getByTestId('cell-punch-row').first()).toHaveAttribute(
			'data-time',
			'06:30:00'
		);
		await page.getByTestId('cell-punch-close').click();

		// ── Device filter: the grid figures never move, the drill-down does ──
		const twoDeviceCode = 'E2E-ATT-0006';
		const twoDeviceDay = MONTH_DAY(1);
		const twoDeviceCell = cell(page, twoDeviceCode, twoDeviceDay);
		const loggedBefore = (
			await twoDeviceCell.getByTestId('cell-logged-hours').innerText()
		).trim();
		const presentBefore = (
			await twoDeviceCell.getByTestId('cell-time-present').innerText()
		).trim();
		expect(loggedBefore).toBe('8.00');
		expect(presentBefore).toBe('9.60');
		const gridBefore = await readRenderedGrid(page);

		const deviceSelect = page.getByLabel('Device');
		await expect(deviceSelect.locator('option')).toHaveCount(
			api.devices.length + 1
		);
		await deviceSelect.selectOption('2');

		await expect(twoDeviceCell.getByTestId('cell-logged-hours')).toHaveText(
			loggedBefore
		);
		await expect(twoDeviceCell.getByTestId('cell-time-present')).toHaveText(
			presentBefore
		);
		expect(await readRenderedGrid(page)).toEqual(gridBefore);

		await twoDeviceCell.getByTestId('cell-punch-trigger').click();
		const filteredRows = page.getByTestId('cell-punch-row');
		await expect(filteredRows).toHaveCount(1);
		await expect(filteredRows.first()).toHaveAttribute('data-time', '18:40:00');
		await expect(filteredRows.first()).toHaveAttribute('data-serial', '2');
		await page.getByTestId('cell-punch-close').click();

		await deviceSelect.selectOption('');
		await expect(twoDeviceCell.getByTestId('cell-logged-hours')).toHaveText(
			loggedBefore
		);
		await expect(twoDeviceCell.getByTestId('cell-time-present')).toHaveText(
			presentBefore
		);
		expect(await readRenderedGrid(page)).toEqual(gridBefore);

		observed.drilldown = {
			accidentalPunchDay: {
				employee: accidentalCode,
				date: accidentalDay,
				onDisk: accidentalOnDisk.map((punch) => ({
					time: punch.log_date.slice(11),
					serial: punch.serial_number,
				})),
			},
			nightShiftNextDay: {
				employee: nightCode,
				date: nightNextDay,
				onDisk: nightOnDisk.map((punch) => punch.log_date.slice(11)),
				firstRowIsTheConsumedTail: '06:30:00',
			},
		};
		observed.deviceFilter = {
			devices: api.devices,
			cell: `${twoDeviceCode} ${twoDeviceDay}`,
			loggedHours: loggedBefore,
			timePresent: presentBefore,
			gridIdenticalWithDeviceSetAndCleared: true,
			drilldownRowsAllDevices: 3,
			drilldownRowsDevice2: 1,
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
			await expect(quiet).toHaveClass(/bg-gray-50/);
			await expect(quiet.getByTestId('cell-time-present')).toHaveCount(0);
			await expect(quiet.getByTestId('cell-logged-hours')).toHaveCount(0);
		}

		// The night shift's 06:30 tail lands on the Sunday that follows its last
		// Friday, so that non-working day carries a punch: it must render as a
		// working day rather than be muted away.
		const sundayPunches = fixtureFor(nightCode).punchCount[sunday] ?? 0;
		expect(sundayPunches).toBeGreaterThan(0);
		const sundayCell = cell(page, nightCode, sunday);
		await expect(sundayCell).not.toHaveClass(/bg-gray-50/);
		await expect(sundayCell.getByTestId('cell-time-present')).toHaveText('—');
		await expect(sundayCell.getByTestId('cell-time-present')).toHaveCount(1);

		// Working days are never muted.
		await expect(cell(page, cleanCode, MONTH_DAY(1))).not.toHaveClass(
			/bg-gray-50/
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

		await expect(page.getByTestId('unmapped-codes-strip')).toBeVisible();
		await expect(page.getByTestId('unmapped-codes-summary')).toContainText(
			'4 Punches from 2 codes not linked to an employee'
		);
		// The summary names them in one sentence; the chips below carry counts.
		await expect(page.getByTestId('unmapped-codes-summary')).toContainText(
			'E2E9001, E2E9002'
		);
		await expect(page.getByTestId('unmapped-codes-item')).toHaveCount(2);
		for (const code of model.unmapped) {
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

		observed.unmappedCodes = {
			codes: model.unmapped,
			rowsOnDisk: unmappedRows,
			gridRows: 0,
			note: 'These Punches are excluded from the grid, so any shortfall against expected attendance comes from these unlinked device codes rather than missing time.',
		};
	});

	test('the attendance fixtures leave no rows behind once cleaned up', async () => {
		// Captured while the rows still exist, so the artifact proves the run
		// really read them.
		expect(model.rowCounts.employees).toBe(ATTENDANCE_ROSTER.length);
		expect(model.rowCounts.attendance_logs_unmapped).toBe(4);
		expect(model.rowCounts.employee_attendance).toBe(
			ATTENDANCE_ROSTER.length * DAYS_IN_MONTH
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
					"Re-implemented in this spec from the raw attendance_logs rows: the day's first punch to its last, direction-agnostic and pooled across devices; the next day's first punch joins it only when it lands after this day's last punch and within 12 hours of this day's first, and a joined punch is consumed; a lone punch or a refused join is uncomputable (null), never 0.",
				loggedHours:
					"Summed per day from the assignment's raw daily_entries JSON, uncapped (ADR-0010).",
				roster:
					'Read straight off employees: isDelete = 0, status = active, employee_type = Payroll. No salary profile is consulted.',
				muting:
					'Week off (Sundays, 2nd and 4th Saturdays) or an active non-optional holiday, with no Logged Hours and no punches on it.',
				applicationHelpersImported: [],
			},
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
