import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import { exec, rows } from '../lib/db';
import { EMPLOYEE_USER } from '../lib/fixtures';

/**
 * Closing a Work Session (ticket #331): the page-close beacon, the stale-session
 * sweep, and the Punch Out tile's disclosure of an end nobody chose.
 *
 * Three flows are proven end to end against the real app and the real database:
 *
 *  - Beacon: the fixture employee signs in through the real sign-in page, opens
 *    the dashboard and closes the page WITHOUT pressing Sign out. The database
 *    row — read back with this harness's own client — is the assertion.
 *  - Sweep: `scripts/close-stale-work-sessions.mjs` runs as a real process
 *    twice. The second run proves idempotence, and live table checksums prove
 *    the sweep never moves an attendance or payroll figure.
 *  - Tile: the Punch Out tile's sub-line discloses an end the sweep stamped and
 *    stays silent for a real logout.
 *
 * The work sessions, presence rows and daily summaries this spec needs are
 * seeded through the harness's own client; nothing here imports the app's own
 * close path, so the script cannot mark its own homework.
 */

const NO_LOGOUT_LINE = 'No logout recorded — ended from your last activity.';

/** Presence silence after which the sweep ends a session (the script's own). */
const STALE_MINUTES = 10;

/** The isolated database this spec asserts against and points the script at. */
const E2E_DB = process.env.E2E_DB_NAME;
if (!E2E_DB) {
	throw new Error(
		'E2E_DB_NAME must be set: this spec seeds work sessions and runs the sweep script against the isolated database.'
	);
}

const runScript = promisify(execFile);

/* ── Fixture users ────────────────────────────────────────────────── */

interface SpecUser {
	id: number;
	username: string;
	email: string;
	password: string;
}

const SPEC_USERNAMES = [
	'e2e_ws_sweep',
	'e2e_ws_tile_sweep',
	'e2e_ws_tile_logout',
];

/** Create (or recreate) a plain user account and return its id. */
async function ensureUser(username: string): Promise<SpecUser> {
	const password = 'E2e#WsClose1';
	const passwordHash = await bcrypt.hash(password, 10);
	// Cascades remove any work session, presence and daily summary the user owns.
	await exec(`DELETE FROM users WHERE username = ?`, [username]);
	const inserted = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
		[
			username,
			passwordHash,
			`${username}@accent.test`,
			username.replace(/_/g, ' '),
		]
	);
	return {
		id: inserted.insertId,
		username,
		email: `${username}@accent.test`,
		password,
	};
}

async function purgeUsers(): Promise<void> {
	await exec(`DELETE FROM users WHERE username IN (?, ?, ?)`, SPEC_USERNAMES);
}

/* ── Database readers ──────────────────────────────────────────────── */

interface WorkSessionRow {
	id: number;
	user_id: number;
	session_start: string;
	session_end: string | null;
	duration_minutes: number | null;
	status: string;
	end_source: string | null;
}

async function workSessions(userId: number): Promise<WorkSessionRow[]> {
	return rows<WorkSessionRow>(
		`SELECT id, user_id, session_start, session_end, duration_minutes, status, end_source
     FROM user_work_sessions
    WHERE user_id = ?
        ORDER BY id`,
		[userId]
	);
}

async function totalWorkMinutes(userId: number): Promise<number | null> {
	const [summary] = await rows<{ total_work_minutes: number | null }>(
		`SELECT total_work_minutes FROM user_daily_summary
     WHERE user_id = ? AND date = CURDATE() LIMIT 1`,
		[userId]
	);
	return summary ? summary.total_work_minutes : null;
}

/** Silence a user's heartbeat, and read back the timestamp the database stored. */
async function silenceHeartbeat(
	userId: number,
	minutesAgo: number
): Promise<string> {
	await exec(
		`INSERT INTO user_presence (user_id, last_seen, is_idle)
     VALUES (?, NOW() - INTERVAL ? MINUTE, 0)
     ON DUPLICATE KEY UPDATE last_seen = NOW() - INTERVAL ? MINUTE, is_idle = 0`,
		[userId, minutesAgo, minutesAgo]
	);
	const [presence] = await rows<{ last_seen: string }>(
		`SELECT last_seen FROM user_presence WHERE user_id = ?`,
		[userId]
	);
	return presence.last_seen;
}

/** Live checksum of each table: any row insert, update or delete moves it. */
async function tableChecksums(
	tables: string[]
): Promise<Record<string, string>> {
	interface ChecksumRow extends RowDataPacket {
		Table: string;
		Checksum: string | null;
	}

	const connection = await mysql.createConnection({
		host: process.env.E2E_DB_HOST || process.env.DB_HOST,
		port: Number(process.env.E2E_DB_PORT || process.env.DB_PORT || 3306),
		user: process.env.E2E_DB_USER || process.env.DEV_DB_USER,
		password: process.env.E2E_DB_PASSWORD || process.env.DEV_DB_PASSWORD,
		database: E2E_DB,
	});
	try {
		const [checksums] = await connection.query<ChecksumRow[]>(
			`CHECKSUM TABLE ${tables.join(', ')}`
		);
		const fingerprints: Record<string, string> = {};
		for (const row of checksums) fingerprints[row.Table] = String(row.Checksum);
		return fingerprints;
	} finally {
		await connection.end();
	}
}

/** Run the sweep as a real process against the isolated database. */
async function runSweep(): Promise<{ stdout: string; stderr: string }> {
	return runScript(
		process.execPath,
		['scripts/close-stale-work-sessions.mjs'],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				E2E_DB_NAME: E2E_DB,
				DEV_DB_NAME: E2E_DB,
				E2E_DB_USER: process.env.E2E_DB_USER ?? process.env.DEV_DB_USER,
				E2E_DB_PASSWORD:
					process.env.E2E_DB_PASSWORD ?? process.env.DEV_DB_PASSWORD,
				// The shared close path resolves its pool from NODE_ENV; make the
				// script a development run so it reads the database named above.
				NODE_ENV: 'development',
			},
		}
	);
}

/* ── Browser seam ──────────────────────────────────────────────────── */

/** `'YYYY-MM-DD HH:mm:ss'` as the tile renders it (`'5:35 PM'`). */
function wallClockTime(value: string): string {
	const [, time = ''] = value.split(' ');
	const [hour, minute] = time.split(':').map(Number);
	return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${
		hour >= 12 ? 'PM' : 'AM'
	}`;
}

/** Whole minutes between two database timestamps, truncated like TIMESTAMPDIFF. */
function minutesBetween(start: string, end: string): number {
	const ms =
		Date.parse(`${end.replace(' ', 'T')}`) -
		Date.parse(`${start.replace(' ', 'T')}`);
	return Math.max(0, Math.floor(ms / 60000));
}

/** Sign in through the real sign-in page and land on the rendered dashboard. */
async function openDashboard(
	browser: Browser,
	user: SpecUser | typeof EMPLOYEE_USER
): Promise<{ context: BrowserContext; page: Page }> {
	// A context of this spec's own: a fresh session cookie, so the page-load
	// volume never shares another spec's per-session request budget. The empty
	// storage state matters — the chromium project signs in as the admin, and
	// without this the dashboard would redirect every sign-in away from
	// /signin.
	const context = await browser.newContext({
		storageState: { cookies: [], origins: [] },
	});
	const page = await context.newPage();
	await signIn(page, user);
	await expect(page.getByText('Punch Out', { exact: true })).toBeVisible();
	return { context, page };
}

async function signIn(
	page: Page,
	user: { email: string; password: string }
): Promise<void> {
	await page.goto('/signin');
	await page.locator('#email').fill(user.email);
	await page.locator('input[type="password"]').fill(user.password);
	await page.locator('button[type="submit"]').click();
	await page.waitForURL('**/user/dashboard');
}

/** The Punch Out tile's rendered value. */
function punchOutValue(page: Page) {
	return page
		.locator('div.grid > div.group', { hasText: 'Punch Out' })
		.locator('p.text-base');
}

test.beforeAll(async () => {
	await purgeUsers();
});

test.afterAll(async () => {
	await purgeUsers();
});

/* ── The beacon ────────────────────────────────────────────────────── */

test('closing the dashboard tab without signing out ends the work session', async ({
	browser,
}) => {
	// Against a dev server the dashboard's routes compile on first hit, which is
	// slower than the production build the suite normally runs.
	test.slow();
	const { context, page } = await openDashboard(browser, EMPLOYEE_USER);

	const [employee] = await rows<{ id: number }>(
		`SELECT id FROM users WHERE username = ?`,
		[EMPLOYEE_USER.username]
	);
	const userId = employee.id;

	// The sign-in opened a Work Session; that is the row the page close must end.
	await expect
		.poll(async () => {
			const active = (await workSessions(userId)).filter(
				(s) => s.status === 'active'
			);
			return active.length;
		})
		.toBeGreaterThan(0);
	const openIds = (await workSessions(userId))
		.filter((s) => s.status === 'active')
		.map((s) => s.id);

	// Close the page without pressing Sign out: `pagehide` fires, the beacon
	// posts, and the row is ended.
	await page.close();

	await expect
		.poll(
			async () =>
				(await workSessions(userId)).filter(
					(s) =>
						openIds.includes(s.id) &&
						s.status === 'ended' &&
						!!s.session_end &&
						s.end_source === 'beacon'
				).length,
			{ timeout: 20_000 }
		)
		.toBe(openIds.length);

	// The browser reported the close time, so it is stamped on the row and the
	// duration follows from it — never before the start, never negative.
	for (const session of await workSessions(userId)) {
		if (!openIds.includes(session.id)) continue;
		expect(session.session_end).not.toBeNull();
		expect(String(session.session_end) >= String(session.session_start)).toBe(
			true
		);
		expect(session.duration_minutes).toBeGreaterThanOrEqual(0);
	}

	await context.close();
});

/* ── The sweep ─────────────────────────────────────────────────────── */

test('the sweep ends a silent session at its last heartbeat and refreshes the daily figure', async () => {
	const user = await ensureUser('e2e_ws_sweep');

	// Attendance status/cells and payroll figures, checksummed before the run.
	const before = await tableChecksums(['attendance', 'payroll_slips']);

	// An active session started today, a heartbeat silent for longer than the
	// ten-minute threshold, and a daily figure waiting to be refreshed.
	await exec(
		`INSERT INTO user_work_sessions (user_id, session_start, status, activities_count)
     VALUES (?, GREATEST(NOW() - INTERVAL 3 HOUR, CURDATE()), 'active', 1)`,
		[user.id]
	);
	await exec(
		`INSERT INTO user_daily_summary (user_id, date, total_work_minutes)
     VALUES (?, CURDATE(), 0)
     ON DUPLICATE KEY UPDATE total_work_minutes = 0`,
		[user.id]
	);
	const lastSeen = await silenceHeartbeat(user.id, STALE_MINUTES + 5);
	expect(await totalWorkMinutes(user.id)).toBe(0);

	const first = await runSweep();
	expect(first.stdout).toMatch(/closed [1-9]\d* stale work session\(s\)/);
	expect(first.stdout).toContain(`user ${user.id}:`);

	const [swept] = await workSessions(user.id);
	expect(swept.status).toBe('ended');
	expect(swept.end_source).toBe('sweep');
	// Stamped at the last heartbeat, not at "now".
	expect(swept.session_end).toBe(lastSeen);
	expect(swept.duration_minutes).toBe(
		minutesBetween(swept.session_start, String(swept.session_end))
	);
	expect(await totalWorkMinutes(user.id)).toBe(swept.duration_minutes);

	const after = await tableChecksums(['attendance', 'payroll_slips']);
	expect(after).toEqual(before);

	// A second run is a no-op: nothing left to close, nothing rewritten.
	const second = await runSweep();
	expect(second.stdout).toContain('closed 0 stale work session(s)');

	const [again] = await workSessions(user.id);
	expect(again).toEqual(swept);
	expect(await totalWorkMinutes(user.id)).toBe(swept.duration_minutes);
});

/* ── The tile's disclosure ─────────────────────────────────────────── */

test('the Punch Out tile discloses an end with no logout recorded', async ({
	browser,
}) => {
	test.slow(); // dev-server compile time on the dashboard's first hit
	const user = await ensureUser('e2e_ws_tile_sweep');
	const { context, page } = await openDashboard(browser, user);

	// Backdate the live session and its first sign-in, so the day the tile
	// tells stays coherent: signed in half an hour ago, last heartbeat a
	// quarter of an hour ago.
	await exec(
		`UPDATE user_work_sessions SET session_start = NOW() - INTERVAL 30 MINUTE
      WHERE user_id = ? AND status = 'active'`,
		[user.id]
	);
	await exec(
		`UPDATE user_daily_summary SET first_login = NOW() - INTERVAL 30 MINUTE
      WHERE user_id = ? AND date = CURDATE()`,
		[user.id]
	);
	const lastSeen = await silenceHeartbeat(user.id, STALE_MINUTES + 5);

	await runSweep();

	const [swept] = await workSessions(user.id);
	expect(swept.status).toBe('ended');
	expect(swept.end_source).toBe('sweep');
	expect(swept.session_end).toBe(lastSeen);

	await page.reload();
	await expect(punchOutValue(page)).toContainText(
		wallClockTime(String(swept.session_end))
	);
	await expect(page.getByText(NO_LOGOUT_LINE)).toBeVisible();

	await context.close();
});

test('a real logout keeps the disclosure off the tile', async ({ browser }) => {
	test.slow(); // dev-server compile time on the dashboard's first hit
	const user = await ensureUser('e2e_ws_tile_logout');
	const { context, page } = await openDashboard(browser, user);

	await expect(page.getByText(NO_LOGOUT_LINE)).toHaveCount(0);

	// The sign-out flow: the same authenticated endpoint the dashboard's Sign
	// Out button posts to, carrying this page's session cookie.
	const logout = await page.request.post('/api/logout');
	expect(logout.ok()).toBe(true);
	const logoutBody = await logout.json();
	expect(logoutBody.success).toBe(true);

	// The logout route ends the session without awaiting the write, so poll for
	// the row rather than assuming it landed with the response.
	await expect
		.poll(
			async () =>
				(await workSessions(user.id)).filter((s) => s.status === 'ended').length
		)
		.toBe(1);
	const loggedOut = (await workSessions(user.id)).find(
		(s) => s.status === 'ended'
	);
	if (!loggedOut) throw new Error('the logout did not end the work session');
	expect(loggedOut.end_source).toBe('logout');
	expect(loggedOut.session_end).not.toBeNull();

	// Signed back in, the tile shows the logout — and says nothing about it.
	await signIn(page, user);
	await expect(page.getByText('Punch Out', { exact: true })).toBeVisible();
	await expect(punchOutValue(page)).toContainText(
		wallClockTime(String(loggedOut.session_end))
	);
	await expect(page.getByText(NO_LOGOUT_LINE)).toHaveCount(0);

	await context.close();
});
