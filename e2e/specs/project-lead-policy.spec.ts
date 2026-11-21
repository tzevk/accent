import type { BrowserContext } from '@playwright/test';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	HIDDEN_POLICY_SETTING,
	seedProjectLeadPolicyFixture,
} from '../fixtures/project-lead-policy.ts';

// This spec changes the single global Project Lead policy row, which every
// project reads immediately. It must run in its own full-suite group (a fresh
// database and app server) with no other spec sharing that runtime. The
// fixture snapshots and restores the exact original row around the journey.
test.setTimeout(300_000);

/**
 * Actor: an ordinary, non-super-admin user with exactly `projects:update`,
 * whose stored `field_permissions.projectScopes.projects.update` is `all`.
 *
 * Starting state: a fixture-owned project names a separate fixture Project
 * Lead; the stored shared policy still allows that section (`project_schedule`)
 * for every lead, and no project policy scope is narrower than `all`.
 *
 * Action: the all-projects actor opens `/admin/project-lead-policy`, changes
 * the Schedule section to Hidden, and saves it. The separate Project Lead
 * signs in through `/signin` in its own browser context, first seeing the
 * original section, then reloading the same project after the save.
 *
 * Proof: the actor's reloaded form shows Schedule = Hidden; the lead's project
 * no longer offers the Schedule tab while Project Details and Scope remain.
 * An independent database read shows Schedule hidden with the actor as
 * `updated_by` and every other section unchanged. The fixture restores the
 * exact original policy row by ownership, and the spec rereads it to prove the
 * restore.
 */
test('an all-projects administrator hides a Project Lead section and the lead loses that project tab', async ({
	page,
	browser,
	db,
	namespace,
}) => {
	const fixture = await seedProjectLeadPolicyFixture(db, namespace);
	let leadContext: BrowserContext | null = null;
	try {
		page.setDefaultNavigationTimeout(60_000);

		// The starting policy is the approved all-editable policy for this
		// section. The fixture snapshot is the independent starting evidence.
		expect(fixture.originalPolicy.sections[fixture.sectionId]).toBe('edit');

		// Actor: the ordinary administrator with projects:update + all scope.
		await signInThroughUi(page, {
			username: fixture.actor.username,
			password: fixture.actor.password,
		});
		await page.goto('/admin/project-lead-policy');
		await expect(
			page.getByRole('heading', { name: 'Project Lead Policy', exact: true })
		).toBeVisible();

		const policySection = page.getByLabel(fixture.sectionLabel, {
			exact: true,
		});
		await expect(policySection).toHaveValue('edit');

		// A separate Project Lead signs in in a new context and sees the
		// section under the original policy before the actor saves.
		leadContext = await browser.newContext();
		const leadPage = await leadContext.newPage();
		leadPage.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(leadPage, {
			username: fixture.lead.username,
			password: fixture.lead.password,
		});
		await leadPage.goto(`/projects/${fixture.projectId}`);
		await expect(
			leadPage.getByRole('heading', { name: 'Project Overview', exact: true })
		).toBeVisible();
		// The title renders both as the header chip and inside the Project
		// Details body, so scope to the header that owns the page heading.
		const leadHeader = leadPage.locator('header').filter({
			has: leadPage.getByRole('heading', {
				name: 'Project Overview',
				exact: true,
			}),
		});
		await expect(
			leadHeader.getByText(fixture.projectTitle, { exact: true })
		).toBeVisible();
		await expect(
			leadPage.getByRole('tab', { name: 'Project Details', exact: true })
		).toBeVisible();
		await expect(
			leadPage.getByRole('tab', { name: fixture.sectionLabel, exact: true })
		).toBeVisible();

		// Save only the one section from the policy page.
		await policySection.selectOption(HIDDEN_POLICY_SETTING);
		const saveResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'PUT' &&
				new URL(response.url()).pathname === '/api/admin/project-lead-policy'
		);
		await page.getByRole('button', { name: 'Save', exact: true }).click();
		const response = await saveResponse;
		expect(response.status()).toBe(200);
		const savedBody = await response.json();
		expect(savedBody.success).toBe(true);
		expect(savedBody.data.sections[fixture.sectionId]).toBe(
			HIDDEN_POLICY_SETTING
		);
		await expect(page.getByRole('status')).toContainText(
			'Policy saved. Changes apply immediately.'
		);

		// The saved value survives a fresh page read, not just cached state.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Project Lead Policy', exact: true })
		).toBeVisible();
		await expect(
			page.getByLabel(fixture.sectionLabel, { exact: true })
		).toHaveValue(HIDDEN_POLICY_SETTING);

		// Independent persisted evidence: exactly one section changed and the
		// ordinary actor, not a super admin, owns the save.
		const stored = await fixture.readPolicy();
		expect(stored).not.toBeNull();
		expect(stored?.sections).toEqual({
			...fixture.originalPolicy.sections,
			[fixture.sectionId]: HIDDEN_POLICY_SETTING,
		});
		expect(stored?.updatedBy).toBe(fixture.actor.userId);

		// The same lead's fresh project read reflects the saved policy: the
		// changed tab is gone while the rest of the workspace still renders.
		await leadPage.reload();
		await expect(
			leadPage.getByRole('heading', { name: 'Project Overview', exact: true })
		).toBeVisible();
		await expect(
			leadPage.getByRole('tab', { name: 'Project Details', exact: true })
		).toBeVisible();
		await expect(
			leadPage.getByRole('tab', { name: 'Scope', exact: true })
		).toBeVisible();
		await expect(
			leadPage.getByRole('tab', { name: fixture.sectionLabel, exact: true })
		).toHaveCount(0);

		// Restore the shared row while this actor still owns the latest write,
		// then prove the exact original snapshot is back.
		await fixture.restorePolicy();
		expect(await fixture.readPolicy()).toEqual(fixture.originalPolicy);
	} finally {
		try {
			await leadContext?.close();
		} finally {
			await fixture.dispose();
		}
	}
});
