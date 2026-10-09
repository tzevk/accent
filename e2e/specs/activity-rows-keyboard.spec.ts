import { expect, test, type Locator, type Page } from '@playwright/test';

import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { EMPLOYEE_USER } from '../lib/fixtures';

/**
 * Ticket #339 — the dashboard's activity rows give their full value to a
 * keyboard.
 *
 * The four text cells of an activity row (Project Number, Discipline, Activity,
 * Sub Activity) clip their value to the column width, so the full value has to
 * reach a user who never touches a mouse. This spec seeds one row whose values
 * are longer than their columns and one whose values fit, reaches the long
 * values by Tab alone and reads them back out of the rendered page, then proves
 * the short row gained nothing: no tab stop, no revealed value, no ellipsis.
 */

const ARTIFACT = 'activity-rows-keyboard';

/** Namespaced fixture projects this spec owns. */
const PROJECT_PREFIX = 'E2E Activity Rows Keyboard';
const TRUNCATED_TITLE = `${PROJECT_PREFIX} Truncated Values`;
const FITS_TITLE = `${PROJECT_PREFIX} Fitting Values`;
const TRUNCATED_NAME = 'Truncated Values Plant';
const FITS_NAME = 'Fitting Values Plant';
const TRUNCATED_CODE = 'E2E-KB-2026-STRUCTURAL-DESIGN-PROJECT';
const FITS_CODE = 'E2E-KB-FITS-2';

/** Longer than the fixed columns they render into. */
const TRUNCATED_DISCIPLINE = 'Civil and Structural Engineering Consultancy';
const TRUNCATED_ACTIVITY = 'Detailed structural design and drawing preparation';
const TRUNCATED_SUB = 'Foundation reinforcement steel detailing review';

/** Short enough to render whole, ellipsis and all. */
const FITS_DISCIPLINE = 'Civil';
const FITS_ACTIVITY = 'Foundation Work';
const FITS_SUB = 'Formwork';

const TRUNCATED_ASSIGNMENT = 'e2e-kb-truncated-row';
const FITS_ASSIGNMENT = 'e2e-kb-fits-row';

/** The four clipped cells, in the row's column order. */
const CLIPPED_CELLS = [
	{ index: 0, name: 'project number', value: TRUNCATED_CODE },
	{ index: 1, name: 'discipline', value: TRUNCATED_DISCIPLINE },
	{ index: 2, name: 'activity', value: TRUNCATED_ACTIVITY },
	{ index: 3, name: 'sub activity', value: TRUNCATED_SUB },
];

const FITTING_CELLS = [
	{ index: 0, name: 'project number', value: FITS_CODE },
	{ index: 1, name: 'discipline', value: FITS_DISCIPLINE },
	{ index: 2, name: 'activity', value: FITS_ACTIVITY },
	{ index: 3, name: 'sub activity', value: FITS_SUB },
];

/** Purge this spec's namespace: its assignments and projects. */
async function purgeNamespace(): Promise<void> {
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		'e2e-kb-%',
	]);
	await exec(`DELETE FROM projects WHERE project_title LIKE ?`, [
		`${PROJECT_PREFIX}%`,
	]);
}

/**
 * Opens the employee dashboard with today's activity reminder marked as seen,
 * so that surface cannot cover the table this spec tabs through, and waits for
 * the seeded rows to render.
 */
async function openDashboard(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const today = new Date().toISOString().split('T')[0];
		sessionStorage.setItem(`activity_reminder_${today}`, '1');
	});
	await page.goto('/user/dashboard');
	// The activity section is lazy and its route compiles on the first hit of a
	// dev server, so the seeded row is waited for with room to appear.
	await expect(
		page.locator('tbody tr').filter({ hasText: TRUNCATED_CODE }),
		'the seeded activity rows render'
	).toHaveCount(1, { timeout: 60_000 });
	const remindLater = page.getByRole('button', { name: 'Remind Later' });
	if (await remindLater.isVisible()) {
		await remindLater.click();
	}
}

/**
 * Walks the page's tab order from wherever focus sits and stops on the element
 * whose text is `text`, reporting how many Tab presses it took. Reaching the
 * cell's affordance this way — never a scripted focus() — is what makes the
 * rest of this spec a keyboard claim.
 */
async function tabUntilText(
	page: Page,
	text: string,
	limit = 180
): Promise<number> {
	for (let stops = 0; stops <= limit; stops += 1) {
		const activeText = await page.evaluate(
			() => document.activeElement?.textContent?.trim() ?? ''
		);
		if (activeText === text) return stops;
		await page.keyboard.press('Tab');
	}
	throw new Error(`tabbed ${limit} times without focusing "${text}"`);
}

let employeeUserId = 0;
let truncatedProjectId = 0;
let fitsProjectId = 0;

const observed: Record<string, unknown> = {};

/** Flipped only after every assertion in every test has passed. */
let artifactOk = false;

test.describe.configure({ mode: 'serial', timeout: 120_000 });

// The dashboard renders for the low-privilege fixture employee the same seeded
// assignments every other dashboard spec sees.
test.use({ storageState: 'e2e/.auth/employee.json' });

test.describe.serial('activity rows give their full value to a keyboard', () => {
	test.beforeAll(async () => {
		// A crashed or cancelled previous run skips afterAll, so purge first.
		await purgeNamespace();

		const [employee] = await rows<{ id: number; email: string }>(
			`SELECT id, email FROM users WHERE username = ? LIMIT 1`,
			[EMPLOYEE_USER.username]
		);
		if (!employee) {
			throw new Error(
				`[e2e] fixture employee ${EMPLOYEE_USER.username} is missing — ` +
					'seedFixtures() (run by e2e/global-setup.ts) must run first'
			);
		}
		employeeUserId = employee.id;

		// The employee reaches both projects as a team member, so the project
		// links in the rows stay theirs to open.
		const team = JSON.stringify([
			{
				user_id: employee.id,
				email: employee.email,
				full_name: EMPLOYEE_USER.fullName,
				role: 'Team Member',
			},
		]);
		const today = new Date().toISOString().slice(0, 10);

		// The fitting project carries the later start date so it sorts ahead of
		// the truncated one: the tab order then runs the whole fitting row
		// before it reaches the row under test.
		const truncated = await exec(
			`INSERT INTO projects
         (project_title, name, project_code, status, start_date, project_team, isDelete)
       VALUES (?, ?, ?, 'Active', '2026-01-01', ?, 0)`,
			[TRUNCATED_TITLE, TRUNCATED_NAME, TRUNCATED_CODE, team]
		);
		truncatedProjectId = truncated.insertId;

		const fits = await exec(
			`INSERT INTO projects
         (project_title, name, project_code, status, start_date, project_team, isDelete)
       VALUES (?, ?, ?, 'Active', '2026-02-01', ?, 0)`,
			[FITS_TITLE, FITS_NAME, FITS_CODE, team]
		);
		fitsProjectId = fits.insertId;

		// Two activity rows, one whose four values outgrow their columns and one
		// whose do not. The due date sits inside the component's default filter
		// window (current month → today, both read from the same UTC clock the
		// component uses).
		const rowsToSeed: Array<[string, number, string, string, string, string]> = [
			[
				TRUNCATED_ASSIGNMENT,
				truncatedProjectId,
				TRUNCATED_ACTIVITY,
				TRUNCATED_DISCIPLINE,
				TRUNCATED_SUB,
				'e2e-kb-act-1',
			],
			[
				FITS_ASSIGNMENT,
				fitsProjectId,
				FITS_ACTIVITY,
				FITS_DISCIPLINE,
				FITS_SUB,
				'e2e-kb-act-2',
			],
		];
		for (const [id, projectId, activity, discipline, sub, activityId] of rowsToSeed) {
			await exec(
				`INSERT INTO user_activity_assignments
           (id, user_id, project_id, activity_id, activity_name, discipline_name,
            sub_activity_name, status, estimated_hours, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'In Progress', 8, ?)`,
				[id, employee.id, projectId, activityId, activity, discipline, sub, today]
			);
		}
	});

	test.afterAll(async () => {
		await purgeNamespace();

		// Nothing this spec owns may survive the run.
		const residue = {
			assignments: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM user_activity_assignments WHERE id LIKE ?`,
				['e2e-kb-%']
			),
			projects: await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM projects WHERE project_title LIKE ?`,
				[`${PROJECT_PREFIX}%`]
			),
		};
		for (const [name, value] of Object.entries(residue)) {
			expect(
				Number((value as Array<{ n: number }>)[0].n),
				`${name} rows left behind`
			).toBe(0);
		}

		// Written here, not inside a test: a failed run must still leave its
		// evidence.
		writeArtifact(ARTIFACT, { ...observed, ok: artifactOk });
		const saved = readArtifact(ARTIFACT);
		expect(saved.flow).toBe(ARTIFACT);
		expect(saved.ok).toBe(artifactOk);
	});

	test('the seeded rows reach the dashboard payload with every long value intact', async ({
		request,
	}) => {
		const response = await request.get(
			`/api/users/${employeeUserId}/activity-assignments`
		);
		expect(response.status(), await response.text()).toBe(200);
		const payload = await response.json();
		expect(payload.success).toBe(true);

		const assignments = payload.data.assignments as Array<
			Record<string, unknown>
		>;
		const truncated = assignments.find(
			(row) => row.activity_name === TRUNCATED_ACTIVITY
		);
		const fits = assignments.find(
			(row) => row.activity_name === FITS_ACTIVITY
		);
		expect(truncated, 'the long activity reaches the payload').toBeTruthy();
		expect(fits, 'the short activity reaches the payload').toBeTruthy();
		expect(truncated?.project_code).toBe(TRUNCATED_CODE);
		expect(truncated?.project_name).toBe(TRUNCATED_NAME);
		expect(truncated?.discipline).toBe(TRUNCATED_DISCIPLINE);
		expect(truncated?.sub_activity_name).toBe(TRUNCATED_SUB);
		expect(fits?.project_code).toBe(FITS_CODE);
		expect(fits?.discipline).toBe(FITS_DISCIPLINE);
		expect(fits?.sub_activity_name).toBe(FITS_SUB);

		// The rows the dashboard reads, asserted with the harness's own client.
		const seeded = await rows<{
			id: string;
			project_id: number;
			activity_name: string;
			discipline_name: string;
			sub_activity_name: string;
			due_date: string;
		}>(
			`SELECT id, project_id, activity_name, discipline_name, sub_activity_name, due_date
         FROM user_activity_assignments WHERE id LIKE ? ORDER BY id`,
			['e2e-kb-%']
		);
		expect(seeded).toHaveLength(2);
		expect(seeded.map((row) => row.id)).toEqual([
			FITS_ASSIGNMENT,
			TRUNCATED_ASSIGNMENT,
		]);
		expect(seeded.map((row) => row.project_id)).toEqual([
			fitsProjectId,
			truncatedProjectId,
		]);
		for (const row of seeded) {
			expect(row.due_date).toBe(new Date().toISOString().slice(0, 10));
		}

		observed.payload = {
			employeeUserId,
			truncatedProjectId,
			fitsProjectId,
			truncated: {
				code: TRUNCATED_CODE,
				discipline: TRUNCATED_DISCIPLINE,
				activity: TRUNCATED_ACTIVITY,
				subActivity: TRUNCATED_SUB,
			},
			fits: {
				code: FITS_CODE,
				discipline: FITS_DISCIPLINE,
				activity: FITS_ACTIVITY,
				subActivity: FITS_SUB,
			},
			seededRows: seeded.length,
		};
	});

	test('every clipped cell hands its full value to a keyboard, read from the rendered page', async ({
		page,
	}) => {
		await openDashboard(page);

		const row = page.locator('tbody tr').filter({ hasText: TRUNCATED_CODE });
		await expect(row, 'one activity row carries the long values').toHaveCount(1);

		const keyboard: Record<string, unknown> = {};
		let previousReveal: Locator | null = null;
		let previousName = '';

		for (const cell of CLIPPED_CELLS) {
			const td = row.locator('td').nth(cell.index);
			// The affordance exists only because the rendered text is cut off.
			const clippedValue = td.locator('[data-truncated="true"]');
			await expect(
				clippedValue,
				`${cell.name}: the value is measured as truncated`
			).toHaveCount(1);

			// The full value is not in the page until the cell is reached.
			const reveal = td.getByTestId('truncated-cell-value');
			await expect(
				reveal,
				`${cell.name}: the full value is absent before focus`
			).toBeHidden();

			// Keyboard only: Tab walks from wherever focus sits — the page top
			// for the first cell, the previous cell for the rest — onto this
			// cell's affordance.
			const stops = await tabUntilText(page, cell.value);
			if (previousReveal) {
				await expect(
					previousReveal,
					`${previousName}: the reveal left with focus`
				).toBeHidden();
			}

			// The Project Number cell keeps its link as the only control; the
			// other three become focusable values.
			const trigger = cell.index === 0 ? td.getByRole('link') : clippedValue;
			await expect(
				trigger,
				`${cell.name}: keyboard focus lands here`
			).toBeFocused();

			// The full value is rendered now — real text, not a title attribute.
			await expect(reveal).toBeVisible();
			await expect(reveal).toHaveText(cell.value);

			// The pointer tooltip is untouched, and the ellipsis stays: the box
			// still clips the value, so the reveal is the only place to read it.
			const pointerTitle =
				cell.index === 0
					? await trigger.getAttribute('title')
					: await clippedValue.getAttribute('title');
			expect(pointerTitle).toBeTruthy();
			const geometry = await clippedValue.evaluate((element) => ({
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
				textOverflow: getComputedStyle(element).textOverflow,
			}));
			expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
			expect(geometry.textOverflow, 'the ellipsis stays').toBe('ellipsis');

			// The code cell's link names the project documents affordance (#333)
			// and describes the whole code, so a screen reader reads the value
			// the ellipsis hides.
			if (cell.index === 0) {
				await expect(trigger).toHaveAccessibleName(
					`Open documents for ${TRUNCATED_NAME}`
				);
				await expect(trigger).toHaveAccessibleDescription(TRUNCATED_CODE);
				await expect(trigger).toHaveAttribute(
					'href',
					`/projects/${truncatedProjectId}?tab=upload_documents`
				);
			}

			keyboard[cell.name] = {
				tabStops: stops,
				revealed: true,
				scrollWidth: geometry.scrollWidth,
				clientWidth: geometry.clientWidth,
			};
			previousReveal = reveal;
			previousName = cell.name;
		}

		observed.keyboard = keyboard;
	});

	test('a row whose values fit gains no affordance at all', async ({ page }) => {
		await openDashboard(page);

		const row = page.locator('tbody tr').filter({ hasText: FITS_CODE });
		await expect(row, 'one activity row carries the short values').toHaveCount(
			1
		);

		const fitting: Record<string, unknown> = {};
		for (const cell of FITTING_CELLS) {
			const td = row.locator('td').nth(cell.index);
			await expect(
				td.locator('[data-truncated]'),
				`${cell.name}: no truncation measured`
			).toHaveCount(0);
			await expect(
				td.locator('[tabindex]'),
				`${cell.name}: no extra tab stop`
			).toHaveCount(0);
			await expect(
				td.getByTestId('truncated-cell-value'),
				`${cell.name}: nothing to reveal`
			).toHaveCount(0);

			// The Project Number cell is unchanged in every other respect too:
			// one link, named and tooltipped for the documents it opens, with
			// the code as its text.
			const value =
				cell.index === 0
					? td.getByRole('link').locator('span')
					: td.getByText(cell.value, { exact: true });
			await expect(value).toBeVisible();
			await expect(value).toHaveText(cell.value);
			if (cell.index === 0) {
				await expect(td.getByRole('link')).toHaveAttribute(
					'title',
					`Open documents for ${FITS_NAME}`
				);
			} else {
				await expect(value).toHaveAttribute('title', cell.value);
			}

			// The value is whole in the rendered output: the box does not clip
			// it, so there is nothing for an affordance to hand over.
			const geometry = await value.evaluate((element) => ({
				scrollWidth: element.scrollWidth,
				clientWidth: element.clientWidth,
			}));
			expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

			fitting[cell.name] = geometry;
		}

		// Keyboard proof from the other direction: tabbing from the top of the
		// page to the truncated row's link passes the whole fitting row — its
		// values included — without once landing on a truncation affordance.
		const walked: string[] = [];
		let affordance = '';
		let stops = 0;
		for (; stops <= 180; stops += 1) {
			const focus = await page.evaluate(() => {
				const active = document.activeElement as HTMLElement | null;
				return {
					text: active?.textContent?.trim() ?? '',
					// The affordance a truncated value carries, and only then.
					revealed: Boolean(active?.closest('[data-truncated]')),
				};
			});
			walked.push(focus.text);
			if (focus.revealed) {
				affordance = focus.text;
				break;
			}
			if (focus.text === TRUNCATED_CODE) break;
			await page.keyboard.press('Tab');
		}
		expect(affordance, 'no fitting value is a tab stop').toBe('');
		expect(stops, 'the tab walk reached the truncated row').toBeLessThanOrEqual(
			180
		);
		expect(
			walked,
			'the walk passed the fitting row before the truncated one'
		).toContain(FITS_CODE);

		observed.fitting = {
			geometry: fitting,
			tabStopsToTruncatedRow: stops,
			focusedBeforeTruncatedRow: walked,
		};
	});

	test('the dashboard links still open the project documents tab', async ({
		page,
	}) => {
		await openDashboard(page);
		const link = page
			.locator('tbody tr')
			.filter({ hasText: TRUNCATED_CODE })
			.getByRole('link');
		await expect(link).toHaveCount(1);
		await expect(link).toHaveAttribute(
			'href',
			`/projects/${truncatedProjectId}?tab=upload_documents`
		);
		await expect(link).toHaveAccessibleName(
			`Open documents for ${TRUNCATED_NAME}`
		);
		await link.click();
		await page.waitForURL(`**/projects/${truncatedProjectId}?tab=upload_documents`);
		// The project route compiles on its first hit in a dev server, so the
		// documents tab is given room to appear rather than a fixed moment.
		await expect(
			page.getByRole('tab', { name: 'Upload Documents' }),
			'the documents tab is the active tab'
		).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
		await expect(
			page.getByRole('heading', { name: 'Upload Documents' })
		).toBeVisible();
		expect(new URL(page.url()).searchParams.get('tab')).toBe(
			'upload_documents'
		);

		observed.documentsTab = { url: page.url(), selected: true };
		artifactOk = true;
	});
});
