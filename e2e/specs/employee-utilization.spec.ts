import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import {
	UTILIZATION_LATER_MONTH,
	UTILIZATION_MONTH,
	UTILIZATION_ROSTER,
	cleanupUtilizationFixtures,
	utilizationMemberForPlan,
	type UtilizationMember,
} from '../lib/utilization-fixtures';

/**
 * Employee Utilization, month-scoped payroll roster (ticket #293).
 *
 * Every expected figure is re-derived in this file from the raw `employees`
 * rows, `employee_attendance` evidence, `user_activity_assignments` payloads
 * and the calendar. Nothing here imports the report's `data-source`, the
 * shared roster selector, `@/lib/logged-hours` or `@/utils/weekly-off`, so the
 * report cannot mark its own homework; the expected window resolution is the
 * documented order:
 *
 *   start = joining_date → hire_date → first attendance → first Logged Hours
 *           → open if active, unresolved otherwise
 *   end   = exit_date → last attendance → last Logged Hours
 *           → open if active, unresolved otherwise
 *
 * The page's own API payload is asserted against that derivation; the DOM is
 * read through the page's `data-testid`/`data-*` attributes, never classes.
 */

test.use({ storageState: 'e2e/.auth/admin-report.json' });
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = UTILIZATION_MONTH;
const LATER_MONTH = UTILIZATION_LATER_MONTH;
const MONTH_LABEL = 'January 2019';
const LATER_MONTH_LABEL = 'March 2019';
const DAYS_IN_MONTH = 31;
const STANDARD_DAY_HOURS = 8;

// ─── Independent derivations ─────────────────────────────────────────

/** ADR-0004 weekly-off rule, re-implemented: Sundays + 2nd/4th Saturdays. */
function isWeeklyOff(date: string): boolean {
	const day = Number(date.slice(8, 10));
	const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
	if (weekday === 0) return true;
	if (weekday !== 6) return false;
	const week = Math.ceil(day / 7);
	return week === 2 || week === 4;
}

/** Logged Hours days carried by one `daily_entries` blob. */
function loggedDays(payload: unknown): string[] {
	let parsed = payload;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	const items: unknown[] = parsed;
	const days: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object' || !('date' in item)) continue;
		const date = item.date;
		if (typeof date !== 'string') continue;
		const day = date.slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
		days.push(day);
	}
	return days;
}

/** Hours carried by one `daily_entries` blob inside a month; uncapped. */
function loggedHoursInMonth(payload: unknown, month: string): number {
	let parsed = payload;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			return 0;
		}
	}
	if (!Array.isArray(parsed)) return 0;
	const items: unknown[] = parsed;
	let total = 0;
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		if (!('date' in item) || !('hours' in item)) continue;
		const { date, hours } = item;
		if (typeof date !== 'string') continue;
		const day = date.slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !day.startsWith(month)) continue;
		const parsedHours =
			typeof hours === 'number'
				? hours
				: typeof hours === 'string'
					? Number.parseFloat(hours)
					: Number.NaN;
		if (Number.isFinite(parsedHours) && parsedHours > 0) total += parsedHours;
	}
	return Math.round(total * 100) / 100;
}

interface EmploymentWindow {
	start: string | null;
	end: string | null;
	unresolved: boolean;
}

interface RawEmployee {
	id: number;
	employee_id: string;
	employee_type: string | null;
	status: string;
	joining_date: string | null;
	hire_date: string | null;
	exit_date: string | null;
	first_attendance: string | null;
	last_attendance: string | null;
	first_logged: string | null;
	last_logged: string | null;
}

/** The documented fallback order, re-implemented for the assertion side. */
function deriveWindow(employee: RawEmployee): EmploymentWindow {
	const isActive = employee.status === 'active';
	const start =
		employee.joining_date ??
		employee.hire_date ??
		employee.first_attendance ??
		employee.first_logged ??
		null;
	const end =
		employee.exit_date ??
		employee.last_attendance ??
		employee.last_logged ??
		null;
	const unresolved = (!start && !isActive) || (!end && !isActive);
	return { start: start ?? null, end: end ?? null, unresolved };
}

function lastDayOf(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return `${month}-${String(last).padStart(2, '0')}`;
}

function intersects(window: EmploymentWindow, month: string): boolean {
	if (window.unresolved) return false;
	const start = `${month}-01`;
	const end = lastDayOf(month);
	if (window.start !== null && window.start > end) return false;
	if (window.end !== null && window.end < start) return false;
	return true;
}

interface DerivedMonth {
	/** The employees the month's report must hold, by code. */
	rosterCodes: string[];
	consideredCount: number;
	rosterCount: number;
	/** Excluded non-Payroll candidates bucketed by Employee Type value. */
	buckets: { value: string | null; count: number }[];
	excludedCodes: string[];
}

/** The month's roster + disclosure, derived from the raw directory. */
function deriveMonth(employees: RawEmployee[], month: string): DerivedMonth {
	const considered = employees.filter((row) =>
		intersects(deriveWindow(row), month)
	);
	const roster = considered.filter((row) => row.employee_type === 'Payroll');
	const excluded = considered.filter((row) => row.employee_type !== 'Payroll');

	const counts = new Map<string, { value: string | null; count: number }>();
	for (const row of excluded) {
		const key = row.employee_type ?? '';
		const bucket = counts.get(key);
		if (bucket) bucket.count++;
		else counts.set(key, { value: row.employee_type, count: 1 });
	}
	const buckets = [...counts.values()].sort((a, b) => {
		if (a.value === b.value) return 0;
		if (a.value === null) return 1;
		if (b.value === null) return -1;
		return a.value < b.value ? -1 : 1;
	});

	return {
		rosterCodes: roster.map((row) => row.employee_id).sort(),
		consideredCount: considered.length,
		rosterCount: roster.length,
		buckets,
		excludedCodes: excluded.map((row) => row.employee_id).sort(),
	};
}

// ─── API payload shapes (what the route returns, not the module types) ─

interface ApiRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	utilization_band: string | null;
	employment_start: string | null;
	employment_end: string | null;
	monthly_cost: number | null;
	cost_status: string;
}

interface ApiDisclosure {
	considered_count: number;
	roster_count: number;
	excluded_count: number;
	excluded_type_count: number;
	excluded_status_count: number;
	buckets: { reason: string; value: string | null; count: number }[];
	excluded: { employee_id: string; reason: string }[];
}

interface ApiPayload {
	month: string;
	month_label: string;
	flag: string | null;
	rows: ApiRow[];
	totals: { employee_count: number };
	disclosure: ApiDisclosure | null;
}

async function fetchMonth(
	request: APIRequestContext,
	month: string
): Promise<ApiPayload> {
	const response = await request.get(
		`/api/reports/employee-utilization?month=${encodeURIComponent(month)}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ApiPayload;
}

// ─── Page helpers ────────────────────────────────────────────────────

async function selectMonth(page: Page, label: string): Promise<void> {
	await page.getByLabel('Month').click();
	await page.getByPlaceholder('Search...').fill(label);
	await page.getByRole('button', { name: label, exact: true }).click();
	await expect(page.getByTestId('utilization-summary')).toContainText(label);
}

async function openMonth(page: Page, label: string): Promise<void> {
	await page.goto('/reports/employee-utilization');
	await expect(
		page.getByRole('heading', { name: 'Employee Utilization' })
	).toBeVisible();
	await selectMonth(page, label);
}

interface RenderedRow {
	code: string;
	band: string;
	capacity: string;
	logged: string;
	utilization: string;
	monthly: string;
}

function readRows(page: Page): Promise<RenderedRow[]> {
	return page.$$eval('[data-testid="utilization-row"]', (elements) =>
		elements.map((row) => {
			const cell = (testId: string) =>
				row.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ??
				'';
			return {
				code: row.getAttribute('data-employee-code') ?? '',
				band: row.getAttribute('data-band') ?? '',
				capacity: cell('cell-capacity'),
				logged: cell('cell-logged'),
				utilization: cell('cell-utilization'),
				monthly: cell('cell-monthly-cost'),
			};
		})
	);
}

/** en-IN, 2dp — the display rule the page's `formatNumber` applies. */
const number2 = new Intl.NumberFormat('en-IN', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

// ─── Model ───────────────────────────────────────────────────────────

interface Model {
	employees: RawEmployee[];
	windows: Map<number, EmploymentWindow>;
	month: DerivedMonth;
	laterMonth: DerivedMonth;
	monthCapacityHours: number;
	loggedHoursByEmployee: Map<number, number>;
	monthLabel: string;
}

const model = {} as Model;
const observed: Record<string, unknown> = {};

test.beforeAll(async () => {
	// The live directory: every `isDelete = 0` row, no type or status filter —
	// the roster rule belongs to the report, not the assertion.
	const directory = await rows<{
		id: number;
		employee_id: string;
		employee_type: string | null;
		status: string;
		joining_date: string | null;
		hire_date: string | null;
		exit_date: string | null;
	}>(
		`SELECT id, employee_id, employee_type, status,
		        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
		        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date,
		        DATE_FORMAT(exit_date, '%Y-%m-%d') AS exit_date
		 FROM employees
		 WHERE isDelete = 0`
	);

	const attendanceBounds = await rows<{
		employee_id: number;
		first_date: string | null;
		last_date: string | null;
	}>(
		`SELECT employee_id,
		        DATE_FORMAT(MIN(attendance_date), '%Y-%m-%d') AS first_date,
		        DATE_FORMAT(MAX(attendance_date), '%Y-%m-%d') AS last_date
		 FROM employee_attendance
		 GROUP BY employee_id`
	);
	const boundsById = new Map(
		attendanceBounds.map((row) => [Number(row.employee_id), row])
	);

	// Logged Hours evidence, resolved exactly like the report resolves an
	// assignment to an employee: stamped `employee_id` first, then the linked
	// user, then the user's email/username.
	const assignments = await rows<{
		user_id: number | null;
		employee_id: number | null;
		email: string | null;
		username: string | null;
		daily_entries: string | null;
	}>(
		`SELECT uaa.user_id, uaa.employee_id, u.email, u.username, uaa.daily_entries
		 FROM user_activity_assignments uaa
		 LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
		 WHERE uaa.status <> 'Cancelled'
		   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
	);
	const users = await rows<{
		id: number;
		employee_id: number | null;
		email: string | null;
		username: string | null;
	}>(`SELECT id, employee_id, email, username FROM users WHERE isDelete = 0`);
	// The report keys its identifier map by the employee record's email and
	// username first, then by the linked users' — later writes win.
	const employeesByKeys = await rows<{
		id: number;
		email: string | null;
		username: string | null;
	}>(`SELECT id, email, username FROM employees WHERE isDelete = 0`);
	const userToEmployee = new Map<number, number>();
	const userKeyToEmployee = new Map<string, number>();
	for (const employee of employeesByKeys) {
		const email = String(employee.email ?? '').toLowerCase();
		const username = String(employee.username ?? '').toLowerCase();
		if (email) userKeyToEmployee.set(email, Number(employee.id));
		if (username) userKeyToEmployee.set(username, Number(employee.id));
	}
	for (const user of users) {
		const empId = Number(user.employee_id ?? 0);
		if (user.id && empId) userToEmployee.set(Number(user.id), empId);
		const email = String(user.email ?? '').toLowerCase();
		const username = String(user.username ?? '').toLowerCase();
		if (email && empId) userKeyToEmployee.set(email, empId);
		if (username && empId) userKeyToEmployee.set(username, empId);
	}

	const loggedBounds = new Map<
		number,
		{ first: string | null; last: string | null }
	>();
	const loggedHoursByEmployee = new Map<number, number>();
	for (const assignment of assignments) {
		let empId = Number(assignment.employee_id ?? 0);
		if (!empId) {
			const userId = Number(assignment.user_id ?? 0);
			if (userId && userToEmployee.has(userId))
				empId = userToEmployee.get(userId)!;
			else {
				const email = String(assignment.email ?? '').toLowerCase();
				const username = String(assignment.username ?? '').toLowerCase();
				if (email && userKeyToEmployee.has(email))
					empId = userKeyToEmployee.get(email)!;
				else if (username && userKeyToEmployee.has(username))
					empId = userKeyToEmployee.get(username)!;
			}
		}
		if (!empId) continue;

		const hours = loggedHoursInMonth(assignment.daily_entries, MONTH);
		if (hours > 0) {
			loggedHoursByEmployee.set(
				empId,
				(loggedHoursByEmployee.get(empId) ?? 0) + hours
			);
		}

		for (const day of loggedDays(assignment.daily_entries)) {
			const bound = loggedBounds.get(empId) ?? { first: null, last: null };
			if (bound.first === null || day < bound.first) bound.first = day;
			if (bound.last === null || day > bound.last) bound.last = day;
			loggedBounds.set(empId, bound);
		}
	}

	const employees: RawEmployee[] = directory.map((row) => {
		const attendance = boundsById.get(Number(row.id));
		const logged = loggedBounds.get(Number(row.id));
		return {
			...row,
			first_attendance: attendance?.first_date ?? null,
			last_attendance: attendance?.last_date ?? null,
			first_logged: logged?.first ?? null,
			last_logged: logged?.last ?? null,
		};
	});
	const windows = new Map(employees.map((row) => [row.id, deriveWindow(row)]));

	// The viewed month's capacity calendar: weekly offs + active holidays, the
	// report's v1 rule (all active holidays, optional included).
	const holidays = await rows<{ date: string }>(
		`SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date
		 FROM holiday_master
		 WHERE is_active = 1 AND date BETWEEN ? AND ?`,
		[`${MONTH}-01`, `${MONTH}-${DAYS_IN_MONTH}`]
	);
	const holidaySet = new Set(
		holidays.map((row) => String(row.date).slice(0, 10))
	);
	let workingDays = 0;
	for (let day = 1; day <= DAYS_IN_MONTH; day++) {
		const date = `${MONTH}-${String(day).padStart(2, '0')}`;
		if (isWeeklyOff(date) || holidaySet.has(date)) continue;
		workingDays++;
	}

	model.employees = employees;
	model.windows = windows;
	model.month = deriveMonth(employees, MONTH);
	model.laterMonth = deriveMonth(employees, LATER_MONTH);
	model.monthCapacityHours = workingDays * STANDARD_DAY_HOURS;
	model.loggedHoursByEmployee = loggedHoursByEmployee;
	model.monthLabel = MONTH_LABEL;
});

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('employee utilization roster', () => {
	test('the viewed month lists exactly the payroll roster derived from the database', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);

		expect(api.month).toBe(MONTH);
		expect(api.month_label).toBe(MONTH_LABEL);
		expect(api.rows.map((row) => row.employee_code).sort()).toEqual(
			model.month.rosterCodes
		);
		expect(api.totals.employee_count).toBe(model.month.rosterCodes.length);

		// The fixture membership the derivation promises: the leaver and the
		// evidence-only payroll employees are rows; the joiner, the leaver who
		// left earlier and the unplaceable employee are not.
		const codes = new Set(api.rows.map((row) => row.employee_code));
		const mustBeRows: UtilizationMember[] = [
			utilizationMemberForPlan('payrollWithHours'),
			utilizationMemberForPlan('payrollIdle'),
			utilizationMemberForPlan('leaverInViewedMonth'),
			utilizationMemberForPlan('evidenceOnly'),
			utilizationMemberForPlan('evidenceLeaver'),
		];
		for (const member of mustBeRows) {
			expect(
				codes.has(member.code),
				`${member.code} must be on the roster`
			).toBe(true);
		}
		const mustBeAbsent: UtilizationMember[] = [
			utilizationMemberForPlan('leaverBeforeViewedMonth'),
			utilizationMemberForPlan('joinerAfterViewedMonth'),
			utilizationMemberForPlan('hireDateJoiner'),
			utilizationMemberForPlan('unplacedPayroll'),
		];
		for (const member of mustBeAbsent) {
			expect(codes.has(member.code), `${member.code} must be absent`).toBe(
				false
			);
		}

		// No misfiled Employee Type can ever be a row.
		for (const member of UTILIZATION_ROSTER) {
			if (member.type !== 'Payroll') {
				expect(
					codes.has(member.code),
					`${member.code} must never be a row`
				).toBe(false);
			}
		}
		expect(model.month.rosterCodes).not.toContain(
			utilizationMemberForPlan('unplacedPayroll').code
		);

		// The priced row's hours and band read off the raw evidence.
		const withHours = utilizationMemberForPlan('payrollWithHours');
		const withHoursId = model.employees.find(
			(row) => row.employee_id === withHours.code
		)!.id;
		const apiRow = api.rows.find(
			(row) => row.employee_code === withHours.code
		)!;
		const loggedHours = model.loggedHoursByEmployee.get(withHoursId) ?? 0;
		expect(apiRow.logged_hours).toBe(loggedHours);
		expect(apiRow.capacity_hours).toBe(model.monthCapacityHours);
		expect(apiRow.utilization_percent).toBe(
			Math.round((loggedHours / model.monthCapacityHours) * 10000) / 100
		);
		expect(apiRow.utilization_band).toBe('under');
		expect(apiRow.monthly_cost).toBe(26000);
		expect(apiRow.cost_status).toBe('priced');
		expect(apiRow.employment_start).toBe(model.windows.get(withHoursId)!.start);
		expect(apiRow.employment_end).toBe(model.windows.get(withHoursId)!.end);

		observed.roster = {
			month: MONTH,
			derivedCount: model.month.rosterCodes.length,
			apiCount: api.rows.length,
			leaverVisible: codes.has(
				utilizationMemberForPlan('leaverInViewedMonth').code
			),
			joinerAbsent: !codes.has(
				utilizationMemberForPlan('joinerAfterViewedMonth').code
			),
			nonPayrollRows: api.rows.filter((row) => {
				const member = UTILIZATION_ROSTER.find(
					(m) => m.code === row.employee_code
				);
				return member ? member.type !== 'Payroll' : false;
			}).length,
			withHours: {
				capacity: apiRow.capacity_hours,
				logged: apiRow.logged_hours,
				utilization: apiRow.utilization_percent,
				band: apiRow.utilization_band,
			},
		};
	});

	test('the exclusion disclosure counts the misfiled Employee Types of the viewed month', async ({
		request,
	}) => {
		const api = await fetchMonth(request, MONTH);
		const disclosure = api.disclosure;
		expect(disclosure, 'January 2019 has excluded fixtures').not.toBeNull();
		const d = disclosure!;

		expect(d.considered_count).toBe(model.month.consideredCount);
		expect(d.roster_count).toBe(model.month.rosterCount);
		expect(d.excluded_count).toBe(
			model.month.buckets.reduce((n, b) => n + b.count, 0)
		);
		expect(d.excluded_type_count).toBe(d.excluded_count);
		// Status never disqualifies a month-scoped roster.
		expect(d.excluded_status_count).toBe(0);

		// Buckets carry the Employee Type value, reason not_payroll_type, in the
		// derived order (values ascending, NULL last).
		expect(d.buckets).toEqual(
			model.month.buckets.map((bucket) => ({
				reason: 'not_payroll_type',
				value: bucket.value,
				count: bucket.count,
			}))
		);
		expect(d.excluded.map((row) => row.employee_id).sort()).toEqual(
			model.month.excludedCodes
		);

		// Each seeded misfiled type is part of the count it belongs to.
		for (const plan of [
			'contractInViewedMonth',
			'deputationInViewedMonth',
			'unsetInViewedMonth',
			'internNoEvidence',
		] as const) {
			const member = utilizationMemberForPlan(plan);
			expect(d.excluded.map((row) => row.employee_id)).toContain(member.code);
		}

		observed.disclosure = {
			month: MONTH,
			considered: d.considered_count,
			roster: d.roster_count,
			excluded: d.excluded_count,
			buckets: d.buckets,
		};
	});

	test('a leaver stays in their month and a joiner is absent before theirs', async ({
		request,
	}) => {
		const january = await fetchMonth(request, MONTH);
		const march = await fetchMonth(request, LATER_MONTH);

		expect(march.month).toBe(LATER_MONTH);
		expect(march.month_label).toBe(LATER_MONTH_LABEL);
		expect(march.rows.map((row) => row.employee_code).sort()).toEqual(
			model.laterMonth.rosterCodes
		);

		const marchCodes = new Set(march.rows.map((row) => row.employee_code));
		const januaryCodes = new Set(january.rows.map((row) => row.employee_code));
		const leaver = utilizationMemberForPlan('leaverInViewedMonth');
		const joiner = utilizationMemberForPlan('joinerAfterViewedMonth');
		const hireJoiner = utilizationMemberForPlan('hireDateJoiner');

		expect(januaryCodes.has(leaver.code)).toBe(true);
		expect(januaryCodes.has(joiner.code)).toBe(false);
		expect(januaryCodes.has(hireJoiner.code)).toBe(false);
		expect(marchCodes.has(leaver.code)).toBe(false);
		expect(marchCodes.has(joiner.code)).toBe(true);
		expect(marchCodes.has(hireJoiner.code)).toBe(true);

		// The March disclosure is derived from the same raw directory.
		const marchDisclosure = march.disclosure;
		if (model.laterMonth.buckets.length === 0) {
			expect(marchDisclosure).toBeNull();
		} else {
			expect(marchDisclosure).not.toBeNull();
			expect(marchDisclosure!.buckets).toEqual(
				model.laterMonth.buckets.map((bucket) => ({
					reason: 'not_payroll_type',
					value: bucket.value,
					count: bucket.count,
				}))
			);
		}

		observed.monthScoping = {
			january: {
				derived: model.month.rosterCodes.length,
				leaverPresent: januaryCodes.has(leaver.code),
				joinerPresent: januaryCodes.has(joiner.code),
			},
			march: {
				derived: model.laterMonth.rosterCodes.length,
				leaverPresent: marchCodes.has(leaver.code),
				joinerPresent: marchCodes.has(joiner.code),
			},
		};
	});

	test('the page renders the month roster and names the excluded types', async ({
		page,
	}) => {
		await openMonth(page, MONTH_LABEL);

		const renderedRows = await readRows(page);
		expect(renderedRows.map((row) => row.code).sort()).toEqual(
			model.month.rosterCodes
		);

		// The priced fixture row: hours and band read off the derived evidence.
		const withHours = utilizationMemberForPlan('payrollWithHours');
		const withHoursId = model.employees.find(
			(row) => row.employee_id === withHours.code
		)!.id;
		const loggedHours = model.loggedHoursByEmployee.get(withHoursId) ?? 0;
		const rendered = renderedRows.find((row) => row.code === withHours.code)!;
		expect(rendered.capacity).toBe(number2.format(model.monthCapacityHours));
		expect(rendered.logged).toBe(number2.format(loggedHours));
		expect(rendered.utilization).toBe(
			`${number2.format(
				Math.round((loggedHours / model.monthCapacityHours) * 10000) / 100
			)}%`
		);
		expect(rendered.band).toBe('under');
		expect(rendered.monthly).toContain(number2.format(26000));

		// Misfiled types never render as rows.
		for (const member of UTILIZATION_ROSTER) {
			if (member.type !== 'Payroll') {
				expect(
					renderedRows.some((row) => row.code === member.code),
					`${member.code} must never render a row`
				).toBe(false);
			}
		}

		// The disclosure strip names the counts by Employee Type value.
		const strip = page.getByTestId('roster-disclosure');
		await expect(strip).toBeVisible();
		await expect(page.getByTestId('roster-disclosure-filter')).toContainText(
			'Employee Type = Payroll'
		);
		await expect(page.getByTestId('roster-disclosure-note')).toContainText(
			'employment window'
		);
		const summary = page.getByTestId('roster-disclosure-summary');
		const excludedCount = model.month.buckets.reduce((n, b) => n + b.count, 0);
		await expect(summary).toContainText(
			`${excludedCount} ${excludedCount === 1 ? 'employee' : 'employees'} excluded`
		);
		await expect(summary).toContainText(
			`of ${model.month.consideredCount} considered for the month`
		);
		await expect(summary).toContainText(
			`leaving ${model.month.rosterCount} on the roster`
		);

		for (const bucket of model.month.buckets) {
			const chip = page.locator(
				`[data-testid="roster-disclosure-bucket"][data-value="${
					bucket.value ?? ''
				}"]`
			);
			await expect(chip).toHaveCount(1);
			await expect(chip).toContainText(
				`${bucket.count} ${bucket.value ?? 'unset'}`
			);
			await expect(chip).toHaveAttribute('data-reason', 'not_payroll_type');
		}

		// And the dropped people are nameable behind the details.
		await page.getByTestId('roster-disclosure-list').locator('summary').click();
		for (const plan of [
			'contractInViewedMonth',
			'deputationInViewedMonth',
			'unsetInViewedMonth',
			'internNoEvidence',
		] as const) {
			const member = utilizationMemberForPlan(plan);
			await expect(
				page.locator(
					`[data-testid="roster-disclosure-item"][data-code="${member.code}"]`
				)
			).toBeVisible();
		}

		observed.page = {
			renderedRows: renderedRows.length,
			derivedRows: model.month.rosterCodes.length,
			withHours: {
				capacity: rendered.capacity,
				logged: rendered.logged,
				utilization: rendered.utilization,
				band: rendered.band,
			},
			disclosureChips: model.month.buckets.length,
		};
	});

	test('the page keeps the disclosure absent when the month has no exclusions', async ({
		page,
		request,
	}) => {
		const payload = await fetchMonth(request, MONTH);
		// The month's real payload, minus the exclusions: the page must render
		// the grid and no strip at all.
		await page.route(
			/\/api\/reports\/employee-utilization\?/,
			async (route) => {
				if (!route.request().url().includes('month=')) {
					await route.continue();
					return;
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						success: true,
						data: { ...payload, disclosure: null },
					}),
				});
			}
		);

		await page.goto('/reports/employee-utilization');
		await expect(page.getByTestId('utilization-row').first()).toBeVisible();
		await expect(page.getByTestId('roster-disclosure')).toHaveCount(0);
		await expect(page.getByTestId('utilization-summary')).toBeVisible();

		observed.emptyDisclosure = { rowsRendered: true, stripRendered: false };
	});

	test('the fixtures leave no residue and the run writes its artifact', async () => {
		const owned = await rows<{ id: number }>(
			`SELECT id FROM employees WHERE employee_id LIKE 'E2E-UTIL-%'`
		);
		const ownedIds = owned.map((row) => row.id);
		expect(ownedIds.length).toBe(UTILIZATION_ROSTER.length);
		const placeholders = ownedIds.map(() => '?').join(', ');

		const removed = await cleanupUtilizationFixtures();
		expect(removed).toBe(ownedIds.length);

		const count = async (sql: string, params: unknown[] = []) => {
			const [row] = await rows<{ n: number | string }>(sql, params);
			return Number(row.n);
		};
		const residue = {
			employees: await count(
				`SELECT COUNT(*) AS n FROM employees WHERE employee_id LIKE 'E2E-UTIL-%'`
			),
			attendance: ownedIds.length
				? await count(
						`SELECT COUNT(*) AS n FROM employee_attendance WHERE employee_id IN (${placeholders})`,
						ownedIds
					)
				: 0,
			assignments: await count(
				`SELECT COUNT(*) AS n FROM user_activity_assignments WHERE id LIKE 'e2e-util-%'`
			),
			profiles: ownedIds.length
				? await count(
						`SELECT COUNT(*) AS n FROM employee_salary_profile WHERE employee_id IN (${placeholders})`,
						ownedIds
					)
				: 0,
			users: await count(`SELECT COUNT(*) AS n FROM users WHERE username = ?`, [
				'e2e_util_user',
			]),
		};
		expect(residue).toEqual({
			employees: 0,
			attendance: 0,
			assignments: 0,
			profiles: 0,
			users: 0,
		});

		writeArtifact('employee-utilization', {
			month: MONTH,
			laterMonth: LATER_MONTH,
			derivation: {
				windowStart:
					'joining_date → hire_date → first attendance → first Logged Hours → open if active, unresolved otherwise',
				windowEnd:
					'exit_date → last attendance → last Logged Hours → open if active, unresolved otherwise',
				intersects:
					'(start == null || start <= monthEnd) && (end == null || end >= monthStart)',
				disclosure:
					'live employees whose resolved window intersects the month, excluding Employee Type ≠ Payroll, bucketed by Employee Type value',
			},
			calendar: {
				month: MONTH,
				daysInMonth: DAYS_IN_MONTH,
				capacityHours: model.monthCapacityHours,
			},
			seeded: {
				employees: UTILIZATION_ROSTER.length,
				plans: UTILIZATION_ROSTER.map((member) => member.plan),
			},
			derived: {
				rosterCount: model.month.rosterCodes.length,
				laterRosterCount: model.laterMonth.rosterCodes.length,
				disclosureBuckets: model.month.buckets,
			},
			observed,
			residue,
			ok: true,
		});
		expect(readArtifact('employee-utilization')).toMatchObject({
			month: MONTH,
			ok: true,
		});
	});
});
