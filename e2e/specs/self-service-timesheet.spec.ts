import { expect, test } from '@playwright/test';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { rows } from '../lib/db';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import {
	HALF_DAY_HOURS,
	NO_EMPLOYEE_USER,
	PRESENT_HOURS,
	TIMESHEET_EMPLOYEE_CODE,
	TIMESHEET_USER,
	cleanupSelfServiceTimesheetFixtures,
	seedSelfServiceTimesheetFixtures,
	type SelfServiceTimesheetSeed,
} from '../lib/self-service-timesheet-fixtures';

/**
 * Self-service Timesheet (issue #332), proven end to end.
 *
 * The fixture employee signs in through the real sign-in page and reads their
 * own Timesheet: the rendered grid is compared against the database rows it
 * must show, the endpoint is proven to derive identity from the session (a
 * caller-supplied employee id changes nothing), the page carries no export
 * control, an account with no linked Employee record gets the explanatory
 * empty state, a month with project daily entries and no attendance rows is
 * offered and renders, and the admin report's permission gate is unchanged.
 *
 * Expected figures are re-derived in this spec from the raw fixture rows —
 * never imported from the app's own calculators.
 */

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

/** `2026-09` becomes `September 2026`, the page's own month label. */
function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** `YYYY-MM-DD` dates of a month. */
function monthDates(month: string): string[] {
	const [year, monthNumber] = month.split('-').map(Number);
	const total = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return Array.from(
		{ length: total },
		(_, index) => `${month}-${String(index + 1).padStart(2, '0')}`
	);
}

/** How a day cell paints a figure: 8 hours becomes 08:00. */
function formatClock(hours: number): string {
	const minutes = Math.round(hours * 60);
	const hh = Math.floor(minutes / 60);
	const mm = minutes % 60;
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** How a total cell paints a figure: 24.5 hours becomes 24:30:00. */
function formatElapsed(hours: number): string {
	const seconds = Math.round(hours * 3600);
	const hh = Math.floor(seconds / 3600);
	const mm = Math.floor((seconds % 3600) / 60);
	const ss = seconds % 60;
	return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** The month's standard day, over which every minute is worked overtime. */
const STANDARD_DAY_HOURS = PRESENT_HOURS;

/* ── The database rows behind the grid ────────────────────────────── */

interface AttendanceRow {
	date: string;
	status: string;
	overtime_hours: number;
}

interface AssignmentRow {
	id: string;
	activity_name: string;
	qty_completed: number;
	daily_entries: string;
}

async function attendanceRowsFor(
	employeeId: number,
	month: string
): Promise<AttendanceRow[]> {
	return rows<AttendanceRow>(
		`SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS date,
	        status, overtime_hours
	 FROM employee_attendance
	 WHERE employee_id = ? AND attendance_date LIKE ?
	 ORDER BY attendance_date`,
		[employeeId, `${month}%`]
	);
}

async function assignmentsFor(employeeId: number): Promise<AssignmentRow[]> {
	return rows<AssignmentRow>(
		`SELECT id, activity_name, qty_completed, daily_entries
	 FROM user_activity_assignments
	 WHERE employee_id = ? AND id LIKE 'e2e-ts-%'
	 ORDER BY id`,
		[employeeId]
	);
}

/** Logged Hours per date for one month, summed across the employee's
 *  assignments and read straight from each `daily_entries` payload. */
async function loggedHoursByDate(
	employeeId: number,
	month: string
): Promise<Record<string, number>> {
	const assignments = await assignmentsFor(employeeId);
	const byDate: Record<string, number> = {};
	for (const assignment of assignments) {
		let entries: unknown;
		try {
			entries = JSON.parse(assignment.daily_entries);
		} catch {
			continue;
		}
		if (!Array.isArray(entries)) continue;
		for (const entry of entries) {
			if (!entry || typeof entry !== 'object') continue;
			const record = entry as Record<string, unknown>;
			const date = typeof record.date === 'string' ? record.date : '';
			if (!date.startsWith(month)) continue;
			const hours = Number(record.hours);
			if (!Number.isFinite(hours) || hours <= 0) continue;
			byDate[date.slice(0, 10)] = (byDate[date.slice(0, 10)] ?? 0) + hours;
		}
	}
	return byDate;
}

/** What the hours must be for a month whose hours come from the attendance
 *  status: a present day credits the standard day, a half day half of it, and
 *  the stored overtime column is the worked-hours overtime. */
function expectedFromAttendance(attendance: AttendanceRow[]): {
	daily: Record<string, number>;
	overtimeDaily: Record<string, number>;
	normal: number;
	overtime: number;
} {
	const daily: Record<string, number> = {};
	const overtimeDaily: Record<string, number> = {};
	for (const row of attendance) {
		if (row.status === 'P') daily[row.date] = PRESENT_HOURS;
		if (row.status === 'HD') daily[row.date] = HALF_DAY_HOURS;
		const overtime = Number(row.overtime_hours);
		if (overtime > 0) overtimeDaily[row.date] = overtime;
	}
	const sum = (values: Record<string, number>) =>
		Object.values(values).reduce((total, value) => total + value, 0);
	return {
		daily,
		overtimeDaily,
		normal: sum(daily),
		overtime: sum(overtimeDaily),
	};
}

/** What the hours must be for a month whose hours come from logged project
 *  time: the standard day caps the normal figure and every minute past it is
 *  worked-hours overtime. */
function expectedFromLogged(logged: Record<string, number>): {
	daily: Record<string, number>;
	overtimeDaily: Record<string, number>;
	normal: number;
	overtime: number;
} {
	const daily: Record<string, number> = {};
	const overtimeDaily: Record<string, number> = {};
	for (const [date, hours] of Object.entries(logged)) {
		daily[date] = Math.min(hours, STANDARD_DAY_HOURS);
		if (hours > STANDARD_DAY_HOURS) {
			overtimeDaily[date] = hours - STANDARD_DAY_HOURS;
		}
	}
	const sum = (values: Record<string, number>) =>
		Object.values(values).reduce((total, value) => total + value, 0);
	return {
		daily,
		overtimeDaily,
		normal: sum(daily),
		overtime: sum(overtimeDaily),
	};
}

/* ── The grid, as the browser paints it ───────────────────────────── */

const gridRows = (page: Page): Locator => page.locator('table tbody tr');

/** The normal section's project rows: the first is row 0. */
function projectRow(page: Page, index: number): Locator {
	return gridRows(page).nth(index);
}

/** A project row's day cells start after the code, activity and count cells. */
function projectDayCell(row: Locator, day: number): Locator {
	return row.locator('td').nth(2 + day);
}

function dailyManHoursRow(page: Page): Locator {
	return gridRows(page).filter({ hasText: 'Daily Man Hours' });
}

/**
 * The overtime section's first row, the one that carries the day's overtime
 * figures. The label row is told apart from the "Sub-Total Of Over Time Hours"
 * row — both carry the words "Over Time Hours" — by its own neighbour text.
 */
function overtimeRow(page: Page): Locator {
	return gridRows(page)
		.filter({ hasText: 'Over Time Hours' })
		.filter({ hasText: 'Sub-Total Of Normal Hours' })
		.locator('xpath=following-sibling::tr[1]');
}

function totalMonthlyHoursRow(page: Page): Locator {
	return gridRows(page).filter({ hasText: 'Total Monthly Hours' });
}

/**
 * Every day cell that must paint a figure. Days with no hours are left to the
 * row-rendering rule: the Daily Man Hours row leaves them empty, while the
 * project rows spell the blue day label down a non-working column.
 */
async function expectDayCells(
	row: Locator,
	month: string,
	cellAt: (day: number) => Locator,
	expected: Record<string, number>
): Promise<void> {
	for (const date of monthDates(month)) {
		const hours = expected[date] ?? 0;
		if (hours <= 0) continue;
		const day = Number(date.slice(8));
		await expect(cellAt(day)).toHaveText(formatClock(hours));
	}
}

/* ── The fixture identity chain ───────────────────────────────────── */

let context: BrowserContext | undefined;
let seed: SelfServiceTimesheetSeed;
/** Another employee, named in the query string to prove it is ignored. */
let otherEmployeeId: number;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
	// The seed and the first sign-in share a loaded machine with the dev
	// server's on-demand compiles; give the hook room to finish.
	test.slow();
	seed = await seedSelfServiceTimesheetFixtures();

	const [other] = await rows<{ id: number }>(
		`SELECT id FROM employees WHERE employee_id = 'E2E-EMP-0002' AND isDelete = 0`
	);
	if (!other) throw new Error('The base fixtures must seed E2E-EMP-0002');
	otherEmployeeId = Number(other.id);

	// One session for the whole flow: the fixture employee signs in through
	// the real sign-in page once, and every test opens a page on it. The
	// context starts with no cookies — the project's default storage state
	// would carry the admin session in.
	context = await browser.newContext({
		storageState: { cookies: [], origins: [] },
	});
	const page = await context.newPage();
	await page.goto('/signin');
	await page.locator('#email').fill(TIMESHEET_USER.email);
	await page.locator('input[type="password"]').fill(TIMESHEET_USER.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL('**/user/dashboard');
	await page.close();
});

test.afterAll(async () => {
	if (context) await context.close();
	await cleanupSelfServiceTimesheetFixtures();
});

/** Open the self-service Timesheet on the shared signed-in session. */
async function openTimesheet(page: Page, query = ''): Promise<void> {
	await page.goto(`/user/timesheet${query}`);
	await expect(page.getByTestId('active-month')).toBeVisible();
}

/** A page on the one signed-in session the flow keeps. */
async function newPage(): Promise<Page> {
	if (!context) throw new Error('The fixture session was not created');
	return context.newPage();
}

/**
 * The dashboard's activity reminder opens over the page while the employee has
 * pending assignments for today. Dismiss it before touching anything under it.
 */
async function dismissActivityReminder(page: Page): Promise<void> {
	const remindLater = page.getByRole('button', { name: 'Remind Later' });
	try {
		await remindLater.waitFor({ state: 'visible', timeout: 5_000 });
		await remindLater.click();
		await remindLater.waitFor({ state: 'hidden', timeout: 5_000 });
	} catch {
		// No reminder this run — nothing to dismiss.
	}
}

test.describe('self-service timesheet', () => {
	test('the dashboard carries the Timesheet link and the page defaults to the current month', async () => {
		const page = await newPage();
		await page.goto('/user/dashboard');
		await dismissActivityReminder(page);

		// One link in the dashboard's attendance area, beside the figures it
		// explains.
		const dashboardLink = page.locator(
			`h2:has-text("Today's Attendance") + a[href="/user/timesheet"]`
		);
		await expect(dashboardLink).toBeVisible();
		await dashboardLink.click();
		await page.waitForURL('**/user/timesheet');

		// The same destination sits in the user-area navigation.
		await expect(page.locator('aside a[href="/user/timesheet"]')).toHaveCount(
			1
		);

		// The current month is the default, and its figures are this
		// employee's own attendance rows on disk.
		await expect(page.getByTestId('active-month')).toHaveText(
			monthLabel(seed.currentMonth)
		);
		await expect(
			page.getByText(TIMESHEET_EMPLOYEE_CODE, { exact: true })
		).toBeVisible();

		const attendance = await attendanceRowsFor(
			seed.employeeId,
			seed.currentMonth
		);
		expect(attendance.length).toBeGreaterThan(0);
		const expected = expectedFromAttendance(attendance);

		// A day with no attendance row at all — the first such day of the
		// month — must paint no hours.
		const recordedDays = new Set(
			attendance.map((row) => Number(row.date.slice(8)))
		);
		const unrecordedDay = monthDates(seed.currentMonth)
			.map((date) => Number(date.slice(8)))
			.find((day) => !recordedDays.has(day));
		if (!unrecordedDay) {
			throw new Error('The current month has no unrecorded day to check');
		}

		// The month's own Daily Man Hours cells: status-derived hours, and
		// nothing on a day with no attendance row.
		await expectDayCells(
			dailyManHoursRow(page),
			seed.currentMonth,
			(day) => dailyManHoursRow(page).locator('td').nth(day),
			expected.daily
		);
		// A day with no attendance row at all paints no hours.
		await expect(
			dailyManHoursRow(page).locator('td').nth(unrecordedDay)
		).toHaveText('');

		// The worked-hours overtime sits in its own row, every minute past the
		// standard day, and the month totals add up.
		const overtimeDays = Object.keys(expected.overtimeDaily);
		if (overtimeDays.length > 0) {
			await expectDayCells(
				overtimeRow(page),
				seed.currentMonth,
				(day) =>
					overtimeRow(page)
						.locator('td')
						.nth(2 + day),
				expected.overtimeDaily
			);
			await expect(overtimeRow(page).locator('td').last()).toHaveText(
				formatElapsed(expected.overtime)
			);
		}
		await expect(totalMonthlyHoursRow(page).locator('td').last()).toHaveText(
			formatElapsed(expected.normal + expected.overtime)
		);

		// No project hours this month: the first project row is empty.
		await expect(projectRow(page, 0).locator('td').nth(1)).toHaveText('');
		await expect(projectRow(page, 0).locator('td').last()).toHaveText(
			'0:00:00'
		);

		await page.close();
	});

	test('the previous month opens its own data, with Logged Hours and worked overtime', async () => {
		const page = await newPage();
		await openTimesheet(page);

		const metaResponse = await page.request.get('/api/me/timesheet');
		const meta = (await metaResponse.json()).meta;
		// Newest first, the current month included, the previous month next.
		expect(meta.current_month).toBe(seed.currentMonth);
		expect(meta.months[0]).toBe(seed.currentMonth);
		expect(meta.months[1]).toBe(seed.previousMonth);

		await page
			.getByRole('button', { name: 'Show the previous offered month' })
			.click();
		await expect(page.getByTestId('active-month')).toHaveText(
			monthLabel(seed.previousMonth)
		);

		// The month's hours come from the assignment's daily_entries: the
		// standard day caps the normal figure and the excess is overtime.
		const logged = await loggedHoursByDate(seed.employeeId, seed.previousMonth);
		const expected = expectedFromLogged(logged);
		expect(expected.normal).toBeGreaterThan(0);
		expect(expected.overtime).toBeGreaterThan(0);

		const row = projectRow(page, 0);
		await expect(row.locator('td').nth(1)).toHaveText(
			'E2E timesheet project work'
		);
		await expect(row.locator('td').nth(2)).toHaveText('3');
		await expectDayCells(
			row,
			seed.previousMonth,
			(day) => projectDayCell(row, day),
			expected.daily
		);
		await expect(row.locator('td').last()).toHaveText(
			formatElapsed(expected.normal)
		);

		await expectDayCells(
			overtimeRow(page),
			seed.previousMonth,
			(day) =>
				overtimeRow(page)
					.locator('td')
					.nth(2 + day),
			expected.overtimeDaily
		);
		await expect(overtimeRow(page).locator('td').last()).toHaveText(
			formatElapsed(expected.overtime)
		);

		// The month's totals: normal + overtime, never one fused figure.
		await expect(dailyManHoursRow(page).locator('td').last()).toHaveText(
			formatElapsed(expected.normal)
		);
		await expect(totalMonthlyHoursRow(page).locator('td').last()).toHaveText(
			formatElapsed(expected.normal + expected.overtime)
		);

		// And one step forward returns to the current month.
		await page
			.getByRole('button', { name: 'Show the next offered month' })
			.click();
		await expect(page.getByTestId('active-month')).toHaveText(
			monthLabel(seed.currentMonth)
		);

		await page.close();
	});

	test('identity comes from the session, so a caller-supplied employee id changes nothing', async () => {
		const page = await newPage();

		// The page with another employee's id in the URL still shows this
		// employee's own grid.
		await openTimesheet(page, `?employee_id=${otherEmployeeId}`);
		await expect(
			page.getByText(TIMESHEET_EMPLOYEE_CODE, { exact: true })
		).toBeVisible();
		await expect(page.getByTestId('active-month')).toHaveText(
			monthLabel(seed.currentMonth)
		);

		// The endpoint ignores the parameter too.
		const response = await page.request.get(
			`/api/me/timesheet?employee_id=${otherEmployeeId}&month=${seed.currentMonth}`
		);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.data.employee.id).toBe(seed.employeeId);
		expect(body.data.employee.employee_id).toBe(TIMESHEET_EMPLOYEE_CODE);

		// Only this employee's assignments are in the payload: no other
		// fixture employee's activity reaches the page.
		const ownIds = new Set(
			(await assignmentsFor(seed.employeeId)).map((row) => row.id)
		);
		const ownActivities = new Set(
			(await assignmentsFor(seed.employeeId)).map((row) => row.activity_name)
		);
		expect(ownIds.size).toBeGreaterThan(0);
		for (const project of body.data.projects) {
			expect(ownActivities.has(project.activity_name)).toBe(true);
		}
		await expect(
			page.getByText('E2E project work', { exact: true })
		).toHaveCount(0);

		await page.close();
	});

	test('the self-service page carries no export control', async () => {
		const page = await newPage();
		await openTimesheet(page);

		await expect(page.getByRole('button', { name: /export/i })).toHaveCount(0);
		await expect(page.getByRole('link', { name: /export/i })).toHaveCount(0);
		await expect(page.locator('a[href*="download"]')).toHaveCount(0);
		await expect(page.getByText(/export/i)).toHaveCount(0);

		await page.close();
	});

	test('a month with project daily entries and no attendance rows is offered and renders', async () => {
		const page = await newPage();

		const metaResponse = await page.request.get('/api/me/timesheet');
		const meta = (await metaResponse.json()).meta;
		expect(meta.months).toContain(seed.projectOnlyMonth);

		// The month really holds no attendance rows for anybody, so only the
		// project entries can put it on the offered list.
		const [attendanceCount] = await rows<{ c: number }>(
			`SELECT COUNT(*) AS c FROM employee_attendance WHERE attendance_date LIKE ?`,
			[`${seed.projectOnlyMonth}%`]
		);
		expect(Number(attendanceCount.c)).toBe(0);

		await openTimesheet(page, `?month=${seed.projectOnlyMonth}`);
		await expect(page.getByTestId('active-month')).toHaveText(
			monthLabel(seed.projectOnlyMonth)
		);

		const logged = await loggedHoursByDate(
			seed.employeeId,
			seed.projectOnlyMonth
		);
		const expected = expectedFromLogged(logged);
		expect(expected.normal).toBeGreaterThan(0);
		expect(expected.overtime).toBe(0);

		const row = projectRow(page, 0);
		await expect(row.locator('td').nth(1)).toHaveText(
			'E2E timesheet quiet month work'
		);
		await expectDayCells(
			row,
			seed.projectOnlyMonth,
			(day) => projectDayCell(row, day),
			expected.daily
		);
		await expect(row.locator('td').last()).toHaveText(
			formatElapsed(expected.normal)
		);
		await expect(totalMonthlyHoursRow(page).locator('td').last()).toHaveText(
			formatElapsed(expected.normal)
		);

		await page.close();
	});

	test('the admin Timesheet report keeps its permission gate', async () => {
		const page = await newPage();

		// The browser reaches the report's own access-denied state.
		await page.goto('/reports/timesheet-report');
		await expect(page.getByText('Access Denied')).toBeVisible();

		// The API refuses the same read with 403.
		const response = await page.request.get(
			`/api/reports/timesheet-report?employee_id=${seed.employeeId}&month=${seed.currentMonth}`
		);
		expect(response.status()).toBe(403);

		await page.close();
	});

	test('an account with no linked Employee record gets an explanatory empty state', async ({
		browser,
	}) => {
		// Its own session: this account is not the fixture employee, and the
		// context starts with no cookies of its own.
		const emptyContext = await browser.newContext({
			storageState: { cookies: [], origins: [] },
		});
		const page = await emptyContext.newPage();
		await page.goto('/signin');
		await page.locator('#email').fill(NO_EMPLOYEE_USER.email);
		await page
			.locator('input[type="password"]')
			.fill(NO_EMPLOYEE_USER.password);
		await page.locator('button[type="submit"]').click();
		await page.waitForURL('**/user/dashboard');

		await page.goto('/user/timesheet');
		await expect(page.getByText('No Timesheet yet')).toBeVisible();
		await expect(
			page.getByText(/not linked to an Employee record/)
		).toBeVisible();
		// An explanation, not an error and not an empty grid.
		await expect(page.locator('table')).toHaveCount(0);

		const response = await page.request.get('/api/me/timesheet');
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(body.data).toBeNull();
		expect(body.meta.current_month).toBe(seed.currentMonth);

		await emptyContext.close();
	});

	test('the flow writes its artifact', async () => {
		const currentAttendance = await attendanceRowsFor(
			seed.employeeId,
			seed.currentMonth
		);
		const currentHours = expectedFromAttendance(currentAttendance);
		const previousLogged = await loggedHoursByDate(
			seed.employeeId,
			seed.previousMonth
		);
		const previousHours = expectedFromLogged(previousLogged);
		const projectOnlyLogged = await loggedHoursByDate(
			seed.employeeId,
			seed.projectOnlyMonth
		);

		writeArtifact('self-service-timesheet', {
			employee: {
				code: TIMESHEET_EMPLOYEE_CODE,
				id: seed.employeeId,
				login: TIMESHEET_USER.username,
			},
			months: {
				current: seed.currentMonth,
				previous: seed.previousMonth,
				projectOnly: seed.projectOnlyMonth,
			},
			renderedAgainstDatabase: {
				currentMonth: {
					attendanceRows: currentAttendance.length,
					overtimeHours: currentHours.overtime,
					normalHours: currentHours.normal,
					asserted: true,
				},
				previousMonth: {
					loggedDays: Object.keys(previousLogged).length,
					normalHours: previousHours.normal,
					overtimeHours: previousHours.overtime,
					asserted: true,
				},
				projectOnlyMonth: {
					loggedDays: Object.keys(projectOnlyLogged).length,
					attendanceRows: 0,
					asserted: true,
				},
			},
			identity: {
				otherEmployeeId,
				otherEmployeeDataReturned: false,
				asserted: true,
			},
			exportControls: 0,
			emptyState: {
				account: NO_EMPLOYEE_USER.username,
				linkedEmployee: false,
				asserted: true,
			},
			adminReportGate: { status: 403, accessDeniedRendered: true },
			ok: true,
		});

		const recorded = readArtifact('self-service-timesheet');
		expect(recorded).toMatchObject({ ok: true });
	});
});
