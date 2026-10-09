import bcrypt from 'bcrypt';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { exec, rows } from '../lib/db';
import { readArtifact, writeArtifact } from '../lib/artifacts';

/**
 * Ticket #341 — one name for the project navigation link.
 *
 * The dashboard renders a project navigation link in two places: the activity
 * rows' Project Number cell and the assigned-projects list the empty state
 * renders. Both must read once. The spec's own user signs in through the real
 * sign-in page, and the rendered accessible names of those links are read out
 * of the browser's accessibility tree — matched by role and accessible name,
 * with each name taken from the link's own aria snapshot, never from the
 * source that renders them. Every name must follow the single
 * `Open documents for <project>` pattern and carry the project its link
 * opens, so a screen-reader user walking a link list hears one destination per
 * project instead of two differently worded links.
 */

const ARTIFACT = 'project-link-name';

const PROJECT_PREFIX = 'E2E Project Link Name';
const ASSIGNMENT_PREFIX = 'e2e-link-name-';
const ASSIGNMENT_ACTIVITY_PREFIX = 'e2e-link-name-act-';

/** The one label every project navigation link carries (ticket #341). */
const PROJECT_DOCUMENTS_LABEL = 'Open documents for';
/** The single pattern: the label, then the project it opens. */
const NAME_PATTERN = new RegExp(`^${PROJECT_DOCUMENTS_LABEL} \\S`);

const LINK_USER = {
	username: 'e2e_link_name',
	email: 'e2e.link.name@accent.test',
	password: 'E2e#LinkName1',
	fullName: 'E2E Link Name',
};

interface ProjectFixture {
	id: number;
	code: string;
	name: string;
	assignmentId: string;
	activityId: string;
}

/** A project navigation link, read from the accessibility tree. */
interface ProjectLink {
	name: string;
	href: string;
	title: string;
	/** The link's own node in the browser's accessibility tree. */
	snapshot: string;
}

/** Purge this spec's namespace: assignments, session, user and projects. */
async function purgeNamespace(): Promise<void> {
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		`${ASSIGNMENT_PREFIX}%`,
	]);
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[LINK_USER.username]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [LINK_USER.username]);
	await exec(`DELETE FROM projects WHERE project_title LIKE ?`, [
		`${PROJECT_PREFIX}%`,
	]);
}

/**
 * Read every project navigation link on the page from the accessibility tree.
 * The links are selected by role and accessible name, and each name comes
 * from the link's own aria snapshot, so the assertion rests on what a screen
 * reader hears rather than on the copy in the source.
 */
async function readProjectLinks(page: Page): Promise<ProjectLink[]> {
	const links = page.getByRole('link', { name: /^Open documents for/ });
	await expect(links.first()).toBeVisible();
	const total = await links.count();
	const read: ProjectLink[] = [];
	for (let index = 0; index < total; index += 1) {
		const link = links.nth(index);
		const snapshot = await link.ariaSnapshot();
		const name = snapshot.match(/^- link "(.*)":?$/m)?.[1] ?? '';
		read.push({
			name,
			href: (await link.getAttribute('href')) ?? '',
			title: (await link.getAttribute('title')) ?? '',
			snapshot,
		});
	}
	return read;
}

/**
 * The shared assertions for one surface: one pattern, the project it opens
 * carried in the name, one distinguishable destination per project, the tooltip
 * agreeing with the accessible name, and the deep link to that project.
 */
function expectOneLinkPattern(links: ProjectLink[]): void {
	const names = links.map((link) => link.name);
	expect(names).toHaveLength(2);

	for (const link of links) {
		// The single pattern, with the project the link opens carried in it.
		expect(link.name, `aria snapshot: ${link.snapshot}`).toMatch(NAME_PATTERN);
		// Plain language: the label names the destination, not the click — no
		// click verb, and no bare action label without the project.
		expect(link.name).not.toMatch(/^click\b/i);
		expect(link.name).not.toBe(PROJECT_DOCUMENTS_LABEL);
		// The tooltip the hover shows names the same destination.
		expect(link.title).toBe(link.name);
	}

	// A link list stays distinguishable between projects.
	expect(new Set(names).size).toBe(names.length);

	for (const project of [alpha, beta]) {
		const expected = `${PROJECT_DOCUMENTS_LABEL} ${project.name}`;
		expect(
			links.map(({ name, href, title }) => ({ name, href, title })),
			`${project.code} renders one navigation link`
		).toContainEqual({
			name: expected,
			href: `/projects/${project.id}?tab=upload_documents`,
			title: expected,
		});
	}
}

/** Dismiss the dashboard's activity reminder when it opens over the table. */
async function dismissActivityReminder(page: Page): Promise<void> {
	const remindLater = page.getByRole('button', { name: 'Remind Later' });
	try {
		await remindLater.waitFor({ state: 'visible', timeout: 10_000 });
		await remindLater.click();
		await expect(remindLater).toBeHidden();
	} catch {
		// No reminder this run — nothing to dismiss.
	}
}

let alpha: ProjectFixture;
let beta: ProjectFixture;
let userId = 0;
let context: BrowserContext;
/** The names the activity rows rendered, for the cross-surface comparison. */
let rowLinkNames: string[] = [];

const observed: Record<string, unknown> = {};

/** Flipped only after every assertion in every test has passed. */
let artifactOk = false;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe.serial('project link name', () => {
	test.beforeAll(async ({ browser }) => {
		// A crashed or cancelled previous run skips afterAll, so purge first.
		await purgeNamespace();

		const created = await exec(
			`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
       VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
			[
				LINK_USER.username,
				await bcrypt.hash(LINK_USER.password, 10),
				LINK_USER.email,
				LINK_USER.fullName,
			]
		);
		userId = created.insertId;

		// Team membership is what makes both projects reachable on the
		// dashboard: with an activity row each renders as a table row link,
		// without one each renders in the assigned-projects list.
		const team = JSON.stringify([
			{
				user_id: userId,
				email: LINK_USER.email,
				full_name: LINK_USER.fullName,
				role: 'Team Member',
			},
		]);
		const specs: Array<Omit<ProjectFixture, 'id'>> = [
			{
				code: 'E2E-LINK-001',
				name: 'Alpha Plant',
				assignmentId: `${ASSIGNMENT_PREFIX}alpha`,
				activityId: `${ASSIGNMENT_ACTIVITY_PREFIX}alpha`,
			},
			{
				code: 'E2E-LINK-002',
				name: 'Beta Plant',
				assignmentId: `${ASSIGNMENT_PREFIX}beta`,
				activityId: `${ASSIGNMENT_ACTIVITY_PREFIX}beta`,
			},
		];
		const seeded: ProjectFixture[] = [];
		for (const spec of specs) {
			const project = await exec(
				`INSERT INTO projects
           (project_title, name, project_code, status, start_date, project_team, isDelete)
         VALUES (?, ?, ?, 'Active', '2026-01-01', ?, 0)`,
				[`${PROJECT_PREFIX} ${spec.name}`, spec.name, spec.code, team]
			);
			seeded.push({ id: project.insertId, ...spec });
		}
		[alpha, beta] = seeded;

		// One activity row per project, due inside the component's default
		// filter window (the same UTC day the component reads).
		const today = new Date().toISOString().slice(0, 10);
		for (const project of seeded) {
			await exec(
				`INSERT INTO user_activity_assignments
           (id, user_id, project_id, activity_id, activity_name, discipline_name,
            status, estimated_hours, due_date)
         VALUES (?, ?, ?, ?, 'Foundation Work', 'Civil', 'In Progress', 8, ?)`,
				[project.assignmentId, userId, project.id, project.activityId, today]
			);
		}

		const [seededRows] = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM user_activity_assignments WHERE user_id = ?`,
			[userId]
		);
		expect(Number(seededRows.n), 'activity rows per project').toBe(2);

		// One session for the whole flow: this user signs in through the real
		// sign-in page, so the dashboard renders on a real session. The context
		// starts cookie-less — the project default carries the admin session.
		context = await browser.newContext({
			storageState: { cookies: [], origins: [] },
		});
		const signIn = await context.newPage();
		await signIn.goto('/signin');
		await signIn.locator('#email').fill(LINK_USER.email);
		await signIn.locator('input[type="password"]').fill(LINK_USER.password);
		await signIn.locator('button[type="submit"]').click();
		await signIn.waitForURL('**/user/dashboard');
		await signIn.close();
	});

	test.afterAll(async () => {
		if (context) await context.close();
		await purgeNamespace();

		// Nothing this spec owns may survive the run.
		const residue = {
			projects: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM projects WHERE project_title LIKE ?`,
				[`${PROJECT_PREFIX}%`]
			),
			assignments: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM user_activity_assignments WHERE id LIKE ?`,
				[`${ASSIGNMENT_PREFIX}%`]
			),
			users: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM users WHERE username = ?`,
				[LINK_USER.username]
			),
			sessions: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
				[LINK_USER.username]
			),
		};
		for (const [name, value] of Object.entries(residue)) {
			expect(Number(value[0].n), `${name} rows left behind`).toBe(0);
		}

		// Written here, not inside a test: `describe.serial` skips the remaining
		// tests after a failure, and a failed run must still leave its evidence.
		writeArtifact(ARTIFACT, { ...observed, ok: artifactOk });
		const saved = readArtifact(ARTIFACT);
		expect(saved.flow).toBe(ARTIFACT);
		expect(saved.ok).toBe(artifactOk);
	});

	test('the activity rows name the project each navigation link opens', async () => {
		const page = await context.newPage();
		await page.goto('/user/dashboard');
		await dismissActivityReminder(page);

		const links = await readProjectLinks(page);
		expectOneLinkPattern(links);
		rowLinkNames = links.map((link) => link.name);

		// No second wording for the same navigation action survives anywhere
		// on the dashboard.
		await expect(
			page.getByRole('link', { name: /^View (project )?details/ })
		).toHaveCount(0);

		observed.rowLinks = links.map(({ name, href, snapshot }) => ({
			name,
			href,
			snapshot,
		}));
		await page.close();
	});

	test('every project navigation link on the dashboard follows the one pattern', async () => {
		const page = await context.newPage();
		await page.goto('/user/dashboard');
		await dismissActivityReminder(page);

		// Every anchor that navigates to a project page, whatever surface
		// rendered it.
		const anchors = page.locator('a[href^="/projects/"]');
		const total = await anchors.count();
		expect(total, 'project navigation links on the dashboard').toBe(2);
		const names: string[] = [];
		for (let index = 0; index < total; index += 1) {
			const anchor = anchors.nth(index);
			const snapshot = await anchor.ariaSnapshot();
			const name = snapshot.match(/^- link "(.*)":?$/m)?.[1] ?? '';
			expect(name, `aria snapshot: ${snapshot}`).toMatch(NAME_PATTERN);
			names.push(name);
		}
		// The same two destinations the role query found — one per project.
		expect(names.sort()).toEqual(rowLinkNames.slice().sort());

		observed.dashboardProjectLinks = names;
		await page.close();
	});

	test('the assigned-projects list names the same destination as the activity rows', async () => {
		const page = await context.newPage();
		// With no activity rows the component renders its other project
		// navigation surface: the assigned-projects list.
		for (const project of [alpha, beta]) {
			await exec(`DELETE FROM user_activity_assignments WHERE id = ?`, [
				project.assignmentId,
			]);
		}
		await page.goto('/user/dashboard');
		await dismissActivityReminder(page);
		await expect(page.getByText('Assigned projects')).toBeVisible();

		const links = await readProjectLinks(page);
		expectOneLinkPattern(links);

		// One project, one destination name: the list reads exactly as the
		// activity rows did.
		expect(links.map((link) => link.name).sort()).toEqual(
			rowLinkNames.slice().sort()
		);

		observed.listLinks = links.map(({ name, href, snapshot }) => ({
			name,
			href,
			snapshot,
		}));
		observed.projects = [alpha, beta].map(({ id, code, name }) => ({
			id,
			code,
			name,
		}));
		observed.pattern = String(NAME_PATTERN);
		artifactOk = true;
		await page.close();
	});
});
