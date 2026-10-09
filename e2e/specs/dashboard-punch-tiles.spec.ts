import { expect, test } from '@playwright/test';
import type {
	APIRequestContext,
	Browser,
	BrowserContext,
	Locator,
	Page,
} from '@playwright/test';
import bcrypt from 'bcrypt';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';

/**
 * The Punch In and Punch Out tiles read the day's Punches (ticket #334).
 *
 * Raw `attendance_logs` rows are seeded through this harness's own client for
 * Employees linked to fixture accounts by `users.employee_id` — the link the
 * extended attendance endpoint resolves server-side. Every expected figure is
 * RE-DERIVED here from the rows read back out of the database: the rows are
 * sorted in this spec and the cross-midnight merge is applied by hand, so the
 * app's own punch calculator can never mark its own homework.
 *
 * Both surfaces are asserted from the same seeded rows: the per-user
 * attendance endpoint's punch fields, and the Attendance report's day cell for
 * the same Employee and day — the report being the rule's other reader.
 *
 * The browser seam runs the real sign-in page as each fixture employee and
 * reads the rendered tiles. Every sign-in uses a context of its own: a fresh
 * session cookie keeps that page-load volume off the shared per-session
 * request budget, and off other specs'. The suite shares one brute-force
 * budget of ten sign-ins per fifteen minutes (src/proxy.ts), so this spec
 * renders six fixture accounts and the tests are ordered to keep it there.
 */

const artifactOutcome = trackArtifactOutcome();

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The shared ceiling on a merged cross-midnight span. */
const MAX_MERGED_HOURS = 12;

/** The isolated database this spec seeds and asserts against. */
const E2E_DB = process.env.E2E_DB_NAME;
if (!E2E_DB) {
	throw new Error(
		'E2E_DB_NAME must be set: this spec seeds punches and work sessions in the isolated database.'
	);
}

const PASSWORD = 'E2e#PunchTiles1';
const USERNAME_PREFIX = 'e2e_punch_tile';
const EMPLOYEE_CODE_PREFIX = 'E2E-PUNCH-';
/** Device code for the punch row nobody owns (no Employee stamped at ingest). */
const UNMAPPED_CODE = 'E2EPUNCHUNMAPPED';
/** The one project the dashboard's activity rows and project picker name. */
const PROJECT_CODE = 'E2E-PUNCH-PRJ';
const PROJECT_NAME = 'Punch Tile Project';

/** The tile's own sub-line copy, quoted once so the wording is asserted here. */
const SIGNED_IN_LINE = 'Signed in';
const LOGGED_OUT_LINE = 'Logged out';
const SESSION_ENDED_LINE = 'Session ended';
const NO_PUNCH_PAIR_LINE = 'The device recorded no punch pair for the day.';
const NO_EMPLOYEE_LINE =
	'No Employee record is linked to this account, so no punch can exist.';
const NO_LOGOUT_LINE = 'No logout recorded — ended from your last activity.';
/** The one way the dashboard's project navigation link names its action. */
const PROJECT_LINK_ACTION = 'Open documents for';
/** The one accessible name the project navigation link carries. */
const PROJECT_LINK_LABEL = `${PROJECT_LINK_ACTION} ${PROJECT_NAME}`;
/** The one way the dashboard's project picker names that project. */
const PROJECT_LABEL = `${PROJECT_CODE} – ${PROJECT_NAME}`;
/**
 * The browser's own today, read in UTC exactly as the dashboard reads it: the
 * default activity range ends there, so a seeded assignment due on this day is
 * inside the range whichever side of midnight the server's day falls.
 */
const CLIENT_TODAY = new Date().toISOString().slice(0, 10);

/* ── Dates and clock ────────────────────────────────────────────── */

/** 'YYYY-MM-DD' shifted by whole days, in UTC so padding never shifts. */
function addDays(day: string, delta: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

/** 'YYYY-MM-DD HH:mm:ss' of a day, for the sign-in and session rows the tile reads. */
function at(day: string, time: string): string {
	return `${day} ${time}`;
}

/**
 * A wall clock — 'HH:MM:SS' or a 'YYYY-MM-DD HH:mm:ss' timestamp — as the
 * tile's 12-hour rendering ('5:35 PM').
 */
function wallClock(value: string): string {
	const time = value.includes(' ') ? value.split(' ')[1] : value;
	const [hour, minute] = time.split(':').map(Number);
	return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${
		hour >= 12 ? 'PM' : 'AM'
	}`;
}

/** A device wall clock → epoch ms, read as UTC so midnight arithmetic is real. */
function punchMs(logDate: string): number {
	return Date.parse(`${logDate.replace(' ', 'T')}Z`);
}

/* ── Seeding ────────────────────────────────────────────────────── */

interface RawPunch {
	id: number;
	employee_code: string;
	log_date: string;
	employee_id: number | null;
}

/** The re-derived day this spec expects both surfaces to report. */
interface DerivedDay {
	punchCount: number;
	firstPunch: string | null;
	lastPunch: string | null;
	computable: boolean;
	hours: number | null;
	merged: boolean;
	mergeRefused: boolean;
}

interface Fixture {
	key: string;
	username: string;
	password: string;
	userId: number;
	employeeDbId: number | null;
	code: string;
	/** Seeded `user_daily_summary.first_login`, 'HH:MM:SS'. */
	signIn: string;
	/** Seeded ended `user_work_sessions.session_end`, 'HH:MM:SS'. */
	logout: string;
	/** How that session ended, and therefore how the tile discloses it. */
	endSource: 'logout' | 'beacon' | 'sweep';
	/** Every punch row this fixture owns, read back from the database. */
	punches: RawPunch[];
	derived: DerivedDay;
	payload: AttendancePayload | null;
	reportCell: ReportCell | null;
}

const USERNAMES = [
	'pair',
	'late',
	'night',
	'lone',
	'refused',
	'noemp',
	'poll',
].map((key) => `${USERNAME_PREFIX}_${key}`);

/** The attendance endpoint's payload, as this spec reads it. */
interface AttendancePayload {
	loginTime: string | null;
	logoutTime: string | null;
	endSource: string | null;
	punchInTime: string | null;
	punchOutTime: string | null;
	punchCount: number;
	punchComputable: boolean;
	punchEmployeeId: number | null;
}

/** One Attendance report cell for the day under test. */
interface ReportCell {
	hours: number | null;
	punch_count: number;
	merge_refused: boolean;
}

/** One Attendance report punch row. */
interface ReportPunch {
	employee_code: string;
	employee_id: number | null;
	date: string;
}

/** The Attendance report's month matrix, as this spec reads it. */
interface AttendanceReport {
	month: string;
	employees: {
		id: number;
		employee_id: string;
		cells: (ReportCell & { date: string })[];
	}[];
	punches: ReportPunch[];
}

interface PunchSeed {
	/** Whole days from the day under test. */
	dayOffset: number;
	time: string;
}

interface FixturePlan {
	key: string;
	/** Employee code (`employees.employee_id`); null = no linked Employee. */
	code: string | null;
	signIn: string;
	logout: string;
	endSource: 'logout' | 'beacon' | 'sweep';
	punches: PunchSeed[];
	/** A punch row with no Employee stamped at ingest, owned by nobody. */
	unmappedPunch?: PunchSeed;
}

const PLANS: FixturePlan[] = [
	{
		// Three punches of its own: an ordinary workday with an accidental
		// middle punch that neither shortens nor lengthens the span.
		key: 'pair',
		code: 'E2E-PUNCH-0001',
		signIn: '09:00:00',
		logout: '18:00:00',
		endSource: 'logout',
		punches: [
			{ dayOffset: 0, time: '08:55:00' },
			{ dayOffset: 0, time: '13:05:00' },
			{ dayOffset: 0, time: '18:40:00' },
		],
	},
	{
		// A late arrival: the chip carries the state, not the colour.
		key: 'late',
		code: 'E2E-PUNCH-0002',
		signIn: '09:35:00',
		logout: '18:30:00',
		endSource: 'logout',
		punches: [
			{ dayOffset: 0, time: '09:40:00' },
			{ dayOffset: 0, time: '18:20:00' },
		],
	},
	{
		// A shift crossing midnight: the next day's first punch joins inside
		// the 12-hour window and is consumed, so it counts on its own date.
		key: 'night',
		code: 'E2E-PUNCH-0003',
		signIn: '22:00:00',
		logout: '23:45:00',
		endSource: 'logout',
		punches: [
			{ dayOffset: 0, time: '23:30:00' },
			{ dayOffset: 1, time: '00:40:00' },
		],
	},
	{
		// One punch of its own: no pair to measure, so the sign-in stays the
		// value and a note says why. Never a zero-length span.
		key: 'lone',
		code: 'E2E-PUNCH-0004',
		signIn: '09:10:00',
		logout: '18:00:00',
		endSource: 'logout',
		punches: [{ dayOffset: 0, time: '09:20:00' }],
	},
	{
		// A lone punch whose next-day candidate falls outside the window: the
		// merge is refused and the day stays uncomputable.
		key: 'refused',
		code: 'E2E-PUNCH-0005',
		signIn: '09:00:00',
		logout: '18:00:00',
		endSource: 'logout',
		punches: [
			{ dayOffset: 0, time: '23:50:00' },
			{ dayOffset: 1, time: '12:10:00' },
		],
	},
	{
		// No linked Employee record at all: no punch can exist for the
		// account, and an unmapped punch row stays nobody's presence.
		key: 'noemp',
		code: null,
		signIn: '09:00:00',
		logout: '18:00:00',
		endSource: 'logout',
		punches: [],
		unmappedPunch: { dayOffset: 0, time: '09:05:00' },
	},
	{
		// A session the sweep closed: the poll must keep refreshing the punch
		// fields because a late device punch still has to reach the tile.
		key: 'poll',
		code: 'E2E-PUNCH-0006',
		signIn: '09:00:00',
		logout: '17:00:00',
		endSource: 'sweep',
		punches: [],
	},
];

/** Purge the namespace, children first so foreign keys never block a delete. */
async function purgeFixtures(): Promise<void> {
	// The assignment rows reference users and projects; the users delete
	// cascades them, but naming them keeps the purge honest on its own.
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		'e2e-punch-%',
	]);
	await exec(`DELETE FROM projects WHERE project_code LIKE ?`, ['E2E-PUNCH-%']);
	// Every punch row this namespace owns, mapped or unmapped, carries a
	// device code under the namespace's prefix.
	await exec(`DELETE FROM attendance_logs WHERE employee_code LIKE ?`, [
		'E2EPUNCH%',
	]);
	// Cascades remove the work sessions, presence rows, daily summaries and
	// screen time each fixture user owns.
	await exec(`DELETE FROM users WHERE username LIKE ?`, [
		`${USERNAME_PREFIX}\\_%`,
	]);
	await exec(`DELETE FROM employees WHERE employee_id LIKE ?`, [
		`${EMPLOYEE_CODE_PREFIX}%`,
	]);
}

/** How many rows the namespace still owns, per table. */
async function namespaceCounts(): Promise<Record<string, number>> {
	const count = async (
		table: string,
		column: string,
		like: string
	): Promise<number> => {
		const [row] = await rows<{ total: number }>(
			`SELECT COUNT(*) AS total FROM ${table} WHERE ${column} LIKE ?`,
			[like]
		);
		return Number(row?.total ?? 0);
	};
	return {
		users: await count('users', 'username', `${USERNAME_PREFIX}\\_%`),
		employees: await count(
			'employees',
			'employee_id',
			`${EMPLOYEE_CODE_PREFIX}%`
		),
		punches: await count('attendance_logs', 'employee_code', 'E2EPUNCH%'),
		assignments: await count('user_activity_assignments', 'id', 'e2e-punch-%'),
		projects: await count('projects', 'project_code', 'E2E-PUNCH-%'),
	};
}

async function seedFixtures(
	today: string
): Promise<{ fixtures: Fixture[]; projectId: number }> {
	await purgeFixtures();

	// The one project the dashboard's activity rows and picker both name, so
	// the project navigation link's label pattern is asserted on both. Every
	// fixture account joins its team, which is how the dashboard learns the
	// project belongs to them.
	const project = await exec(
		`INSERT INTO projects (project_code, name, project_title, status, start_date, created_by)
     VALUES (?, ?, ?, 'ACTIVE', CURDATE(), 'e2e-punch-tiles')`,
		[PROJECT_CODE, PROJECT_NAME, PROJECT_NAME]
	);
	const projectId = project.insertId;

	const fixtures: Fixture[] = [];
	for (const plan of PLANS) {
		const passwordHash = await bcrypt.hash(PASSWORD, 10);
		const fullName = `Punch Tile ${plan.key}`;
		const user = await exec(
			`INSERT INTO users
         (username, password_hash, email, full_name, status, is_active,
          is_super_admin, account_type, isDelete)
       VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
			[
				`${USERNAME_PREFIX}_${plan.key}`,
				passwordHash,
				`${USERNAME_PREFIX}_${plan.key}@accent.test`,
				fullName,
			]
		);
		const userId = user.insertId;

		let employeeDbId: number | null = null;
		if (plan.code) {
			const smartofficeCode = plan.code.replace(/-/g, '');
			const employee = await exec(
				`INSERT INTO employees
           (employee_id, first_name, last_name, email, status, employee_type,
            joining_date, smartoffice_code, isDelete)
         VALUES (?, 'E2E', ?, ?, 'active', 'Payroll', '2024-01-01', ?, 0)`,
				[plan.code, plan.key, `${plan.key}@accent.test`, smartofficeCode]
			);
			employeeDbId = employee.insertId;
			// The server-side resolution the attendance endpoint reads: the
			// account's linked Employee is `users.employee_id` → `employees.id`.
			await exec(`UPDATE users SET employee_id = ? WHERE id = ?`, [
				employeeDbId,
				userId,
			]);
		}

		await exec(
			`INSERT INTO user_daily_summary (user_id, date, first_login)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE first_login = VALUES(first_login)`,
			[userId, today, at(today, plan.signIn)]
		);
		await exec(
			`INSERT INTO user_work_sessions
         (user_id, session_start, session_end, duration_minutes, status, end_source)
       VALUES (?, ?, ?, ?, 'ended', ?)`,
			[
				userId,
				at(today, plan.signIn),
				at(today, plan.logout),
				540,
				plan.endSource,
			]
		);

		let serial = 0;
		for (const punch of plan.punches) {
			const when = at(addDays(today, punch.dayOffset), punch.time);
			serial += 1;
			await exec(
				`INSERT INTO attendance_logs
           (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
         VALUES (?, ?, ?, NULL, ?, ?)`,
				[
					plan.code ? plan.code.replace(/-/g, '') : UNMAPPED_CODE,
					when,
					`${plan.key}-${serial}`,
					JSON.stringify({ LogDate: when }),
					employeeDbId,
				]
			);
		}
		if (plan.unmappedPunch) {
			const when = at(
				addDays(today, plan.unmappedPunch.dayOffset),
				plan.unmappedPunch.time
			);
			await exec(
				`INSERT INTO attendance_logs
           (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
         VALUES (?, ?, ?, NULL, ?, NULL)`,
				[
					UNMAPPED_CODE,
					when,
					`${plan.key}-unmapped`,
					JSON.stringify({ LogDate: when }),
				]
			);
		}

		// One activity row, so the project navigation link renders in the
		// dashboard's activity table and the add-activity picker. Its due date
		// is the browser's own today, which keeps it inside the dashboard's
		// default activity range. The account with no linked Employee keeps no
		// activity row, so its dashboard renders the project through the
		// assigned-projects list instead — the link's other surface.
		if (plan.code) {
			await exec(
				`INSERT INTO user_activity_assignments
         (id, user_id, project_id, activity_name, discipline_name, status,
          start_date, due_date, qty_assigned, qty_completed)
       VALUES (?, ?, ?, 'Foundation Work', 'Civil', 'In Progress', CURDATE(), ?, 10, 0)`,
				[`e2e-punch-assign-${plan.key}`, userId, projectId, CLIENT_TODAY]
			);
		}

		fixtures.push({
			key: plan.key,
			username: `${USERNAME_PREFIX}_${plan.key}`,
			password: PASSWORD,
			userId,
			employeeDbId,
			code: plan.code ?? '',
			signIn: plan.signIn,
			logout: plan.logout,
			endSource: plan.endSource,
			punches: [],
			derived: {
				punchCount: 0,
				firstPunch: null,
				lastPunch: null,
				computable: false,
				hours: null,
				merged: false,
				mergeRefused: false,
			},
			payload: null,
			reportCell: null,
		});
	}

	// Every fixture account joins the project's team, the dashboard's own rule
	// for which projects a user may log an activity against.
	await exec(`UPDATE projects SET project_team = ? WHERE project_code = ?`, [
		JSON.stringify(fixtures.map((fixture) => ({ user_id: fixture.userId }))),
		PROJECT_CODE,
	]);

	return { fixtures, projectId };
}

/** Insert one more punch row for a fixture, the device pushing it late. */
async function insertPunch(
	fixture: Fixture,
	dayOffset: number,
	time: string
): Promise<RawPunch> {
	const when = at(addDays(today, dayOffset), time);
	const inserted = await exec(
		`INSERT INTO attendance_logs
       (employee_code, log_date, serial_number, direction, raw_payload, employee_id)
     VALUES (?, ?, ?, NULL, ?, ?)`,
		[
			fixture.code.replace(/-/g, ''),
			when,
			`${fixture.key}-late-${time.replace(/:/g, '')}`,
			JSON.stringify({ LogDate: when }),
			fixture.employeeDbId,
		]
	);
	return {
		id: inserted.insertId,
		employee_code: fixture.code.replace(/-/g, ''),
		log_date: when,
		employee_id: fixture.employeeDbId,
	};
}

/**
 * The day's punch span, re-derived from the rows themselves: sorted here, with
 * the 12-hour cross-midnight merge applied by hand. Nothing is imported from
 * the app's calculator.
 */
function deriveDay(punches: RawPunch[], day: string): DerivedDay {
	const byLog = (a: RawPunch, b: RawPunch) =>
		a.log_date === b.log_date ? a.id - b.id : a.log_date < b.log_date ? -1 : 1;
	const own = punches
		.filter((punch) => punch.log_date.slice(0, 10) === day)
		.sort(byLog);
	const next = punches
		.filter((punch) => punch.log_date.slice(0, 10) === addDays(day, 1))
		.sort(byLog);

	if (own.length === 0) {
		return {
			punchCount: 0,
			firstPunch: null,
			lastPunch: null,
			computable: false,
			hours: null,
			merged: false,
			mergeRefused: false,
		};
	}

	const firstPunch = own[0];
	let lastPunch = own[own.length - 1];
	const firstMs = punchMs(firstPunch.log_date);
	let lastMs = punchMs(lastPunch.log_date);
	let merged = false;
	let mergeRefused = false;

	const tail = next[0];
	if (tail) {
		const tailMs = punchMs(tail.log_date);
		if (tailMs > lastMs) {
			if (tailMs - firstMs <= MAX_MERGED_HOURS * HOUR_MS) {
				// Consumed: it is credited to the day it was recorded on, so it
				// counts once and never shortens or lengthens its own day.
				lastMs = tailMs;
				lastPunch = tail;
				merged = true;
			} else if (own.length < 2) {
				// Only a day with no span of its own can be refused.
				mergeRefused = true;
			}
		}
	}

	const effectivePunches = own.length + (merged ? 1 : 0);
	const computable =
		!mergeRefused && effectivePunches >= 2 && lastMs >= firstMs;
	return {
		punchCount: own.length,
		firstPunch: firstPunch.log_date,
		lastPunch: lastPunch.log_date,
		computable,
		// Two decimal places, the precision both surfaces publish (ms/36000 is
		// hours×100).
		hours: computable ? Math.round((lastMs - firstMs) / 36_000) / 100 : null,
		merged,
		mergeRefused,
	};
}

/* ── Database readers ───────────────────────────────────────────── */

/** Every punch row the fixture owns, over a window wider than the endpoint's. */
async function readPunches(
	employeeDbId: number,
	day: string
): Promise<RawPunch[]> {
	return rows<RawPunch>(
		`SELECT id, employee_code, log_date, employee_id
     FROM attendance_logs
     WHERE employee_id = ?
       AND log_date >= ? AND log_date < ?
     ORDER BY id`,
		[
			employeeDbId,
			`${addDays(day, -2)} 00:00:00`,
			`${addDays(day, 3)} 00:00:00`,
		]
	);
}

/* ── API seam ───────────────────────────────────────────────────── */

/** The per-user attendance endpoint, read as an admin viewer. */
async function fetchAttendancePayload(
	request: APIRequestContext,
	userId: number
): Promise<AttendancePayload> {
	const response = await request.get(`/api/users/${userId}/attendance`);
	expect(response.status(), await response.text()).toBe(200);
	const body = (await response.json()) as {
		success: boolean;
		data: AttendancePayload;
	};
	expect(body.success).toBe(true);
	return body.data;
}

/** The Attendance report — the tile's rule read by the other surface. */
async function fetchAttendanceReport(
	request: APIRequestContext,
	month: string
): Promise<AttendanceReport> {
	const response = await request.get(
		`/api/reports/attendance-report?month=${encodeURIComponent(month)}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = (await response.json()) as {
		success: boolean;
		data: AttendanceReport;
	};
	expect(body.success).toBe(true);
	return body.data;
}

/* ── Browser seam ───────────────────────────────────────────────── */

interface SpecUser {
	username: string;
	email: string;
	password: string;
}

function specUser(fixture: Fixture): SpecUser {
	return {
		username: fixture.username,
		email: `${fixture.username}@accent.test`,
		password: fixture.password,
	};
}

async function signIn(page: Page, user: SpecUser): Promise<void> {
	await page.goto('/signin');
	await page.locator('#email').fill(user.email);
	await page.locator('input[type="password"]').fill(user.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL('**/user/dashboard');
}

/**
 * A context of this spec's own: a fresh session cookie per sign-in, so the
 * page-load volume never shares another spec's per-session request budget. The
 * empty storage state matters — the chromium project signs in as the admin, and
 * without it the dashboard would redirect every sign-in away from /signin.
 */
async function openDashboard(
	browser: Browser,
	user: SpecUser
): Promise<{ context: BrowserContext; page: Page }> {
	const context = await browser.newContext({
		storageState: { cookies: [], origins: [] },
	});
	const page = await context.newPage();
	await signIn(page, user);
	await expect(page.getByText('Punch Out', { exact: true })).toBeVisible();
	return { context, page };
}

/** The tile by its label, in the attendance card's tile grid. */
function tile(page: Page, label: 'Punch In' | 'Punch Out' | 'Total Time') {
	return page.locator('div.grid > div.group', { hasText: label });
}

/** The tile's value paragraph — the figure the card is about. */
function tileValue(tileLocator: Locator) {
	return tileLocator.locator('p.text-base');
}

/** The activity reminder overlay owns the screen until it is dismissed. */
async function dismissActivityReminder(page: Page): Promise<void> {
	const remindLater = page.getByRole('button', { name: 'Remind Later' });
	if (await remindLater.isVisible().catch(() => false)) {
		await remindLater.click();
	}
}

/* ── The model: one pass over the seeded rows and both surfaces ──── */

let today = '';
let projectId = 0;
let model: Fixture[] = [];

const observed: Record<string, unknown> = {};

function byKey(key: string): Fixture {
	const fixture = model.find((candidate) => candidate.key === key);
	if (!fixture) throw new Error(`no fixture named ${key}`);
	return fixture;
}

test.beforeAll(async () => {
	const [todayRow] = await rows<{ today: string }>(
		`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today`
	);
	today = todayRow.today;

	const seeded = await seedFixtures(today);
	projectId = seeded.projectId;

	// Read the rows back out of the database — the seeded input is not the
	// evidence — then re-derive every day both surfaces have to agree on.
	for (const fixture of seeded.fixtures) {
		if (fixture.employeeDbId != null) {
			fixture.punches = await readPunches(fixture.employeeDbId, today);
		}
		fixture.derived = deriveDay(fixture.punches, today);
	}
	model = seeded.fixtures;
});

test.afterAll(async () => {
	const before = await namespaceCounts();
	await purgeFixtures();
	const residue = await namespaceCounts();
	const leftovers = Object.entries(residue).filter(([, value]) => value !== 0);
	expect(
		leftovers,
		`fixture rows left behind: ${JSON.stringify(leftovers)}`
	).toEqual([]);

	writeArtifact('dashboard-punch-tiles', {
		day: today,
		month: today.slice(0, 7),
		projectId,
		fixtures: model.map((fixture) => ({
			key: fixture.key,
			userId: fixture.userId,
			employeeId: fixture.employeeDbId,
			signIn: fixture.signIn,
			logout: fixture.logout,
			endSource: fixture.endSource,
			derived: fixture.derived,
			payload: fixture.payload,
			reportCell: fixture.reportCell,
		})),
		residueBeforePurge: before,
		residue: residue,
		...observed,
		ok: artifactOutcome.ok,
	});
});

/* ── The endpoint and the other reader of the same rule ─────────── */

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('punch tiles', () => {
	test('the endpoint reports the day punches the seeded rows derive, and the Attendance report agrees', async ({
		request,
	}) => {
		const month = today.slice(0, 7);
		const report = await fetchAttendanceReport(request, month);
		expect(report.month).toBe(month);

		const mismatches: string[] = [];
		const expectSame = (label: string, actual: unknown, derived: unknown) => {
			if (actual !== derived) {
				mismatches.push(
					`${label}: got ${JSON.stringify(actual)}, re-derived ${JSON.stringify(derived)}`
				);
			}
		};

		for (const fixture of model) {
			const payload = await fetchAttendancePayload(request, fixture.userId);
			fixture.payload = payload;
			const derived = fixture.derived;

			expectSame(
				`${fixture.key} loginTime`,
				payload.loginTime,
				fixture.signIn.slice(0, 5)
			);
			expectSame(
				`${fixture.key} logoutTime`,
				payload.logoutTime,
				fixture.logout.slice(0, 5)
			);
			expectSame(
				`${fixture.key} endSource`,
				payload.endSource,
				fixture.endSource
			);
			// The Employee is resolved server-side from the account's link.
			expectSame(
				`${fixture.key} punchEmployeeId`,
				payload.punchEmployeeId,
				fixture.employeeDbId
			);
			expectSame(
				`${fixture.key} punchCount`,
				payload.punchCount,
				derived.punchCount
			);
			expectSame(
				`${fixture.key} punchComputable`,
				payload.punchComputable,
				derived.computable
			);
			expectSame(
				`${fixture.key} punchInTime`,
				payload.punchInTime,
				derived.computable && derived.firstPunch
					? derived.firstPunch.slice(11, 16)
					: null
			);
			expectSame(
				`${fixture.key} punchOutTime`,
				payload.punchOutTime,
				derived.computable && derived.lastPunch
					? derived.lastPunch.slice(11, 16)
					: null
			);

			if (fixture.employeeDbId == null) continue;
			const row = report.employees.find(
				(candidate) => candidate.id === fixture.employeeDbId
			);
			if (!row) {
				mismatches.push(`${fixture.key} is not a row of the Attendance report`);
				continue;
			}
			const cell = row.cells.find((candidate) => candidate.date === today);
			if (!cell) {
				mismatches.push(`${fixture.key} has no report cell for ${today}`);
				continue;
			}
			fixture.reportCell = cell;
			// The tile's day and the report's day endpoints are one rule read
			// twice: hours, punch count and the refused-merge flag must agree.
			expectSame(`${fixture.key} report hours`, cell.hours, derived.hours);
			expectSame(
				`${fixture.key} report punch_count`,
				cell.punch_count,
				derived.punchCount
			);
			expectSame(
				`${fixture.key} report merge_refused`,
				cell.merge_refused,
				derived.mergeRefused
			);
		}

		// The punch row nobody owns is in the report and belongs to nobody.
		const unmapped = report.punches.find(
			(punch) => punch.employee_code === UNMAPPED_CODE
		);
		expect(
			unmapped,
			'the unmapped punch row is part of the report punch list'
		).toBeTruthy();
		expect(unmapped?.employee_id).toBeNull();
		expect(unmapped?.date).toBe(today);
		expect(byKey('noemp').payload?.punchEmployeeId).toBeNull();

		expect(mismatches, mismatches.join('\n')).toEqual([]);

		observed.endpoint = model.map((fixture) => ({
			key: fixture.key,
			derived: fixture.derived,
			payload: fixture.payload,
			reportCell: fixture.reportCell,
		}));
	});

	/* ── The tiles ───────────────────────────────────────────────── */

	/**
	 * The project navigation link's one label pattern, asserted on both
	 * surfaces the dashboard renders it. The link deep-links to the project's
	 * documents tab (#333); this spec pins the accessible name, which must read
	 * the same on every surface so a screen-reader link list names the action
	 * once. `surface` also opens the add-activity picker, whose option names
	 * the same project by its code and name.
	 */
	async function assertProjectLinkPattern(
		page: Page,
		surface: 'activity-row' | 'assigned-projects'
	): Promise<void> {
		const link = page.getByRole('link', { name: PROJECT_LINK_LABEL });
		await expect(link).toHaveAttribute(
			'href',
			`/projects/${projectId}?tab=upload_documents`
		);
		if (surface !== 'activity-row') return;
		await dismissActivityReminder(page);
		await page.getByTitle('Add a new activity').click();
		const picker = page.getByTitle('Select a project you are assigned to');
		await expect(picker).toBeVisible();
		await expect(
			picker.locator('option').filter({ hasText: PROJECT_CODE })
		).toHaveText(PROJECT_LABEL);
	}

	test('the tiles show the day punches with the session times as sub-lines', async ({
		browser,
	}) => {
		test.slow(); // dev-server compile time on the dashboard's first hit
		for (const key of ['pair', 'late']) {
			const fixture = byKey(key);
			const derived = fixture.derived;
			const { context, page } = await openDashboard(browser, specUser(fixture));
			const punchIn = tile(page, 'Punch In');
			const punchOut = tile(page, 'Punch Out');

			// The device is the value: the day's first and last Punch.
			await expect(tileValue(punchIn)).toContainText(
				wallClock(String(derived.firstPunch))
			);
			await expect(tileValue(punchOut)).toContainText(
				wallClock(String(derived.lastPunch))
			);

			// … and the session times stay visible as the sub-line.
			await expect(punchIn).toContainText(
				`${SIGNED_IN_LINE} ${wallClock(fixture.signIn)}`
			);
			await expect(punchOut).toContainText(
				`${LOGGED_OUT_LINE} ${wallClock(fixture.logout)}`
			);

			// No fallback note and no inferred-end disclosure: the day had a
			// computable pair and the session ended with a real logout.
			for (const note of [
				NO_PUNCH_PAIR_LINE,
				NO_EMPLOYEE_LINE,
				NO_LOGOUT_LINE,
			]) {
				await expect(punchIn).not.toContainText(note);
				await expect(punchOut).not.toContainText(note);
			}
			// The overtime chip the Late chip follows is still on the tile.
			await expect(punchOut).toContainText('OT');

			// Total Time keeps its meaning and is never moved by a punch: the
			// pair fixture works 09:00 → 18:00 on the session records, so the
			// tile reads 9h 0m — not the 08:55 → 18:40 punch span, which would
			// be 9h 45m. The figure is recomputed here from the seeded rows
			// rather than read back from the app.
			if (key === 'pair') {
				await expect(tileValue(tile(page, 'Total Time'))).toContainText(
					'9h 0m'
				);
				await expect(tileValue(tile(page, 'Total Time'))).not.toContainText(
					'9h 45m'
				);
				// The project navigation link names one action, in one pattern,
				// on the activity row and in the picker.
				await assertProjectLinkPattern(page, 'activity-row');
			}

			// A late arrival carries the chip; an on-time one does not.
			if (key === 'late') {
				await expect(punchIn).toContainText('Late');
			}
			if (key === 'pair') {
				await expect(punchIn).not.toContainText('Late');
			}

			observed[`tiles-${key}`] = {
				punchIn: await tileValue(punchIn).textContent(),
				punchOut: await tileValue(punchOut).textContent(),
			};
			await context.close();
		}
	});

	test('a day with no computable pair keeps the session time and names the device gap', async ({
		browser,
	}) => {
		test.slow();
		const fixture = byKey('lone');
		const { context, page } = await openDashboard(browser, specUser(fixture));
		const punchIn = tile(page, 'Punch In');
		const punchOut = tile(page, 'Punch Out');

		// The session time stays the value — the device's lone punch is never
		// rendered as a span, so no figure reads as zero.
		await expect(tileValue(punchIn)).toContainText(wallClock(fixture.signIn));
		await expect(tileValue(punchOut)).toContainText(wallClock(fixture.logout));

		// … and the sub-line states the device recorded no punch pair.
		await expect(punchIn).toContainText(NO_PUNCH_PAIR_LINE);
		await expect(punchOut).toContainText(NO_PUNCH_PAIR_LINE);
		await expect(punchIn).not.toContainText(SIGNED_IN_LINE);
		await expect(punchOut).not.toContainText(LOGGED_OUT_LINE);

		// The day really holds a punch — the fallback is the rule, not an empty
		// table, and that punch never reaches the tile.
		expect(fixture.derived.punchCount).toBeGreaterThan(0);
		expect(fixture.derived.computable).toBe(false);
		for (const punch of fixture.punches) {
			if (punch.log_date.slice(0, 10) !== today) continue;
			await expect(punchIn).not.toContainText(wallClock(punch.log_date));
		}
		await context.close();
	});

	test('an account with no linked Employee names why no punch can exist', async ({
		browser,
	}) => {
		test.slow();
		const fixture = byKey('noemp');
		const { context, page } = await openDashboard(browser, specUser(fixture));
		const punchIn = tile(page, 'Punch In');
		const punchOut = tile(page, 'Punch Out');

		await expect(tileValue(punchIn)).toContainText(wallClock(fixture.signIn));
		await expect(tileValue(punchOut)).toContainText(wallClock(fixture.logout));
		await expect(punchIn).toContainText(NO_EMPLOYEE_LINE);
		await expect(punchOut).toContainText(NO_EMPLOYEE_LINE);
		// The unmapped device row is nobody's presence, so it surfaces nowhere
		// on either tile.
		for (const punch of await rows<RawPunch>(
			`SELECT id, employee_code, log_date, employee_id
         FROM attendance_logs WHERE employee_code = ?`,
			[UNMAPPED_CODE]
		)) {
			await expect(punchIn).not.toContainText(wallClock(punch.log_date));
			await expect(punchOut).not.toContainText(wallClock(punch.log_date));
		}
		expect(fixture.payload?.punchEmployeeId).toBeNull();
		expect(fixture.payload?.punchCount).toBe(0);
		// The link's other surface — the assigned-projects list, which renders
		// because this account holds no activity row — carries the same name.
		await assertProjectLinkPattern(page, 'assigned-projects');
		await context.close();
	});

	/* ── The admin live-monitoring view ──────────────────────────── */

	test('the admin live-monitoring view renders the viewed user punches with the Employee resolved server-side', async ({
		browser,
	}) => {
		test.slow();
		const fixture = byKey('night');
		const derived = fixture.derived;
		const context = await browser.newContext({
			storageState: 'e2e/.auth/admin.json',
		});
		// No client-side employee lookup: nothing on this surface asks the
		// employee directory for the viewed user's Employee record.
		const employeeLookups: string[] = [];
		context.on('request', (request) => {
			const path = new URL(request.url()).pathname;
			if (path.startsWith('/api/employees')) employeeLookups.push(path);
		});
		const page = await context.newPage();

		await page.goto(`/admin/live-monitoring/user/${fixture.userId}`);
		const punchIn = tile(page, 'Punch In');
		const punchOut = tile(page, 'Punch Out');
		await expect(tileValue(punchIn)).toContainText(
			wallClock(String(derived.firstPunch))
		);
		await expect(tileValue(punchOut)).toContainText(
			wallClock(String(derived.lastPunch))
		);
		await expect(punchIn).toContainText(
			`${SIGNED_IN_LINE} ${wallClock(fixture.signIn)}`
		);
		await expect(punchOut).toContainText(
			`${LOGGED_OUT_LINE} ${wallClock(fixture.logout)}`
		);
		expect(employeeLookups).toEqual([]);
		await context.close();
	});

	/* ── The poll ────────────────────────────────────────────────── */

	test('the two-minute poll carries a late punch to the tile and keeps running after a sweep end', async ({
		browser,
	}) => {
		test.slow();
		const fixture = byKey('poll');
		const { context, page } = await openDashboard(browser, specUser(fixture));
		const punchIn = tile(page, 'Punch In');
		const punchOut = tile(page, 'Punch Out');

		// The sweep closed the session, so the tile discloses it — and the poll
		// keeps running, because a sweep end is not a logout.
		await expect(tileValue(punchIn)).toContainText(wallClock(fixture.signIn));
		await expect(punchIn).toContainText(NO_PUNCH_PAIR_LINE);
		await expect(punchOut).toContainText(NO_LOGOUT_LINE);

		// The device pushes the punch pair after the page was loaded.
		await insertPunch(fixture, 0, '08:58:00');
		await insertPunch(fixture, 0, '17:05:00');

		// The poll refreshes the punch fields, with no reload: the tiles read
		// the day's Punches and the session times drop to the sub-lines.
		await expect(tileValue(punchIn)).toContainText('8:58 AM', {
			timeout: 60_000,
		});
		await expect(tileValue(punchOut)).toContainText('5:05 PM');
		await expect(punchIn).toContainText(
			`${SIGNED_IN_LINE} ${wallClock(fixture.signIn)}`
		);
		await expect(punchOut).toContainText(
			`${SESSION_ENDED_LINE} ${wallClock(fixture.logout)}`
		);
		await expect(punchOut).toContainText(NO_LOGOUT_LINE);
		await expect(punchIn).not.toContainText(NO_PUNCH_PAIR_LINE);

		observed.poll = {
			punchIn: await tileValue(punchIn).textContent(),
			punchOut: await tileValue(punchOut).textContent(),
		};
		await context.close();
	});

	test('a real logout stops the attendance poll', async ({ browser }) => {
		test.slow();
		const fixture = byKey('night');
		const { context, page } = await openDashboard(browser, specUser(fixture));
		const punchOut = tileValue(tile(page, 'Punch Out'));
		await expect(punchOut).toContainText('12:40 AM');

		// The device pushes one more punch after the page was loaded. A real
		// logout ended the day, so the poll never asks for it.
		await insertPunch(fixture, 0, '19:10:00');
		await page.waitForTimeout(16_000);

		await expect(punchOut).toContainText('12:40 AM');
		await expect(punchOut).not.toContainText('7:10 PM');
		await context.close();
	});
});
