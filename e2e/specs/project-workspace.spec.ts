import type { BrowserContext } from '@playwright/test';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readProjectById,
	readProjectByName,
	seedProjectCreationFixture,
	seedProjectEditorFixture,
	seedProjectTeamFixture,
} from '../fixtures/project-workspace.ts';

// The owned Next dev server compiles the Project routes on first visit; the
// assertions still wait for their observable result. This only bounds time.
test.setTimeout(180_000);

/**
 * Actor: an ordinary signed-in user who holds exactly `projects:create`,
 * `projects:read`, and `companies:read`, with a stored `projects:read` scope
 * of `all`; not a super admin.
 *
 * Starting state: a fixture-owned company and its unique name, and no Project
 * whose name belongs to this run.
 *
 * Action: open the real Create Project page, author the Project name, select
 * the owned company, and submit the form; then open the saved Project from the
 * Projects list.
 *
 * Proof: the create response names the stored row and the independent database
 * read matches the authored name, client, company, and active row; the
 * Projects list shows that row and its View Details action opens a Project
 * Overview whose header carries the saved name and client, again after a
 * reload. The form's own success redirect is not asserted: it reads the
 * missing `result.data.id` (src/app/projects/new/page.jsx:159) while this
 * schema returns the saved row keyed by `project_id`
 * (src/app/api/projects/route.js:332 and the baseline
 * migrations/20260722080106_baseline_schema.js:1980), so it leaves the form at
 * `/projects/undefined/edit`. The list path above is the reachable user
 * journey for the saved Project.
 *
 * Anonymous sign-in requests: 1.
 */
test('creating a project saves the authored name and client and reopens them', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedProjectCreationFixture(
		db,
		`${namespace}-project-create`
	);
	try {
		page.setDefaultNavigationTimeout(60_000);

		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto('/projects/new');
		await expect(
			page.getByRole('heading', { name: 'Create Project', exact: true })
		).toBeVisible();

		await page.locator('input[name="name"]').fill(fixture.projectName);
		const companySelect = page.locator('select[name="company_id"]');
		await companySelect.selectOption({ label: fixture.companyName });
		await expect(companySelect).toHaveValue(String(fixture.companyId));

		const createResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname === '/api/projects'
		);
		// Wait for the form to leave, whether or not the redirect key is the
		// schema's `project_id`; the defect above only decides where it lands.
		const createNavigation = page.waitForURL(
			(url) => !url.pathname.endsWith('/projects/new')
		);
		await page
			.getByRole('button', { name: 'Create Project', exact: true })
			.click();
		const response = await createResponse;
		expect(response.status()).toBe(201);
		const body = await response.json();
		expect(body.success).toBe(true);

		const createdProjectId = Number(body.data?.project_id ?? body.data?.id);
		expect(Number.isInteger(createdProjectId)).toBe(true);
		expect(createdProjectId).toBeGreaterThan(0);

		await createNavigation;

		// Independent persisted evidence, not the response echo.
		const created = await readProjectByName(db, fixture.projectName);
		expect(created).not.toBeNull();
		expect(created?.projectId).toBe(createdProjectId);
		expect(created?.name).toBe(fixture.projectName);
		expect(created?.clientName).toBe(fixture.companyName);
		expect(created?.companyId).toBe(fixture.companyId);
		expect(created?.isDelete).toBe(0);

		// Open the saved Project through the list, the reachable user path.
		await page.goto('/projects');
		const projectRow = page
			.getByRole('row')
			.filter({ hasText: fixture.projectName });
		await expect(projectRow).toBeVisible();
		const viewNavigation = page.waitForURL(
			new RegExp(`/projects/${createdProjectId}$`)
		);
		await projectRow.getByTitle('View Details').click();
		await viewNavigation;

		await expect(
			page.getByRole('heading', { name: 'Project Overview', exact: true })
		).toBeVisible();
		// The root layout wraps every route in `<main>`, so the project header
		// is not exposed as a banner landmark. Scope to the header that owns
		// the page heading instead.
		const header = page.locator('header').filter({
			has: page.getByRole('heading', {
				name: 'Project Overview',
				exact: true,
			}),
		});
		await expect(
			header.getByText(fixture.projectName, { exact: true })
		).toBeVisible();
		await expect(
			header.getByText(fixture.companyName, { exact: true })
		).toBeVisible();

		// A fresh page read still carries the authored values.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Project Overview', exact: true })
		).toBeVisible();
		await expect(
			header.getByText(fixture.projectName, { exact: true })
		).toBeVisible();
		await expect(
			header.getByText(fixture.companyName, { exact: true })
		).toBeVisible();
	} finally {
		await fixture.dispose();
	}
});

/**
 * Actor: an ordinary signed-in user with no explicit project grant, stored in
 * one seeded Project's `project_team` with role exactly `Project Lead`.
 *
 * Starting state: a fixture-owned Project named and cliented by the fixture,
 * whose details are readable and editable under the shared lead policy.
 *
 * Action: open that Project's edit workspace, change its Project Name, and
 * save the Project Details section.
 *
 * Proof: the save response succeeds and its confirmation names the completed
 * save; after a full reload the Project Name field and the header chip show
 * the new fixed value, while an independent database read shows that name,
 * the unchanged client, and the unchanged lead team entry.
 *
 * Anonymous sign-in requests: 1.
 */
test('a project lead saves a work field that reopens after reload', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedProjectEditorFixture(
		db,
		`${namespace}-project-edit`
	);
	const updatedName = `${namespace} Revised Project`;
	try {
		page.setDefaultNavigationTimeout(60_000);

		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto(`/projects/${fixture.projectId}/edit`);
		await expect(
			page.getByRole('heading', { name: 'Edit Project', exact: true })
		).toBeVisible();
		const nameField = page.getByLabel(/Project Name/);
		await expect(nameField).toHaveValue(fixture.projectName);

		await nameField.fill(updatedName);

		const saveResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'PUT' &&
				new URL(response.url()).pathname ===
					`/api/projects/${fixture.projectId}`
		);
		// The success alert is a native modal and freezes the page until it is
		// answered. Answer it as soon as it opens, before reading the response
		// body, which would otherwise wait on the blocked renderer until the
		// test timeout.
		const savedDialog = page.waitForEvent('dialog').then(async (dialog) => {
			const message = dialog.message();
			await dialog.accept();
			return message;
		});
		await page
			.getByRole('button', { name: 'Update Project', exact: true })
			.click();

		const [response, dialogMessage] = await Promise.all([
			saveResponse,
			savedDialog,
		]);
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(dialogMessage).toBe('Project updated successfully!');

		// Fresh read through the real page, then through the database.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Edit Project', exact: true })
		).toBeVisible();
		await expect(page.getByLabel(/Project Name/)).toHaveValue(updatedName);
		// Same landmark constraint as above: scope to the header that owns the
		// page heading rather than the absent banner role.
		const header = page.locator('header').filter({
			has: page.getByRole('heading', { name: 'Edit Project', exact: true }),
		});
		await expect(header.getByText(updatedName, { exact: true })).toBeVisible();

		const stored = await readProjectById(db, fixture.projectId);
		expect(stored).not.toBeNull();
		expect(stored?.name).toBe(updatedName);
		expect(stored?.clientName).toBe(fixture.clientName);
		expect(stored?.isDelete).toBe(0);
		expect(stored?.projectTeam).toHaveLength(1);
		expect(stored?.projectTeam[0]?.id).toBe(fixture.userId);
		expect(stored?.projectTeam[0]?.role).toBe('Project Lead');
	} finally {
		await fixture.dispose();
	}
});

/**
 * Actor: the seeded Project Lead signs in first and adds a second ordinary
 * employee from the Project Team tab; that employee signs in through the real
 * form in a separate browser session.
 *
 * Starting state: a fixture-owned Project whose stored team contains only the
 * lead; the second identity is active but is not a team member and holds no
 * project permission.
 *
 * Action: the lead opens Project Team, searches the employee in Add Team
 * Member, and selects them; the employee then opens the same Project in a
 * second context.
 *
 * Proof: the add response and the visible team table show two members; an
 * independent database read stores the employee with role `Team Member`
 * beside the lead. In the second session the employee reaches the Project
 * edit workspace, sees the Project Team tab with both names, and gets the
 * read-only `View Only` action.
 *
 * Anonymous sign-in requests: 2 (one lead, one employee).
 */
test('a project lead adds an employee who opens the project in a second session', async ({
	page,
	browser,
	db,
	namespace,
}) => {
	const fixture = await seedProjectTeamFixture(db, `${namespace}-project-team`);
	let memberContext: BrowserContext | null = null;
	try {
		page.setDefaultNavigationTimeout(60_000);

		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto(`/projects/${fixture.projectId}/edit`);
		await expect(
			page.getByRole('heading', { name: 'Edit Project', exact: true })
		).toBeVisible();
		const sectionNavigation = page.getByRole('navigation', {
			name: 'Project sections',
		});
		await sectionNavigation
			.getByRole('button', { name: 'Project Team', exact: true })
			.click();

		await expect(
			page.getByText('Add Team Member', { exact: true })
		).toBeVisible();
		await page
			.getByRole('button', { name: 'Search users...', exact: true })
			.click();
		const userSearch = page.getByPlaceholder('Search...', { exact: true });
		await expect(userSearch).toBeVisible();
		await userSearch.fill(fixture.memberUsername);

		const addResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname ===
					`/api/projects/${fixture.projectId}/team`
		);
		await page
			.getByRole('button')
			.filter({ hasText: fixture.memberUsername })
			.first()
			.click();
		const response = await addResponse;
		expect(response.status()).toBe(200);
		const body = await response.json();
		expect(body.success).toBe(true);
		expect(Array.isArray(body.data?.project_team)).toBe(true);
		expect(body.data.project_team).toHaveLength(2);

		await expect(
			page.getByText('Current Team Members (2)', { exact: true })
		).toBeVisible();
		const addedRow = page
			.getByRole('row')
			.filter({ hasText: fixture.memberUsername });
		await expect(addedRow).toBeVisible();
		await expect(addedRow).toContainText('Team Member');

		// Independent database evidence for the stored team change.
		const stored = await readProjectById(db, fixture.projectId);
		expect(stored).not.toBeNull();
		expect(stored?.projectTeam).toHaveLength(2);
		const storedMember = stored?.projectTeam.find(
			(member) => Number(member.id) === fixture.memberUserId
		);
		const storedLead = stored?.projectTeam.find(
			(member) => Number(member.id) === fixture.userId
		);
		expect(storedMember?.role).toBe('Team Member');
		expect(storedLead?.role).toBe('Project Lead');

		// A separate browser session proves the employee can open the Project.
		memberContext = await browser.newContext();
		const memberPage = await memberContext.newPage();
		memberPage.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(memberPage, {
			username: fixture.memberUsername,
			password: fixture.memberPassword,
		});

		await memberPage.goto(`/projects/${fixture.projectId}/edit`);
		await expect(
			memberPage.getByRole('heading', { name: 'Edit Project', exact: true })
		).toBeVisible();
		await expect(
			memberPage.getByRole('button', { name: 'View Only', exact: true })
		).toBeDisabled();

		const memberSectionNavigation = memberPage.getByRole('navigation', {
			name: 'Project sections',
		});
		await memberSectionNavigation
			.getByRole('button', { name: 'Project Team', exact: true })
			.click();
		await expect(
			memberPage.getByText('Current Team Members (2)', { exact: true })
		).toBeVisible();
		await expect(
			memberPage.getByRole('row').filter({ hasText: fixture.memberUsername })
		).toBeVisible();
		await expect(
			memberPage.getByRole('row').filter({ hasText: fixture.username })
		).toBeVisible();
	} finally {
		if (memberContext) await memberContext.close();
		await fixture.dispose();
	}
});
