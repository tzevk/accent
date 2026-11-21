import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readProposalProjectState,
	seedProposalProjectFixture,
} from '../fixtures/project-workspace.ts';

// The owned Next dev server compiles the Proposal and Project routes on first
// visit; the assertions still wait for their observable result. This only
// bounds compilation time.
test.setTimeout(180_000);

/**
 * Actor: an ordinary signed-in user with exactly `proposals:read`,
 * `proposals:convert`, `proposals:approve`, and `projects:read`, whose stored
 * `projects:read` scope is `all`; not a super admin.
 *
 * Starting state: a fixture-owned company and an unconverted DRAFT Proposal
 * with a unique title and client, no lead link, no project, and no child
 * documents.
 *
 * Action: open the Proposals list, confirm and run the row's Convert to
 * Project action, and follow the redirected Project workspace.
 *
 * Proof: the conversion response and URL name one Project; the Project edit
 * workspace shows the Proposal title and client, again after a reload; an
 * independent database read shows the Proposal is `CONVERTED` and points at
 * that Project, while the Project points back at this Proposal and carries the
 * copied name, client, and company.
 *
 * Anonymous sign-in requests: 1.
 */
test('converting a proposal creates a correctly linked project that reopens', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedProposalProjectFixture(
		db,
		`${namespace}-proposal-project`
	);
	try {
		page.setDefaultNavigationTimeout(60_000);
		// The list confirms with window.confirm and then reports success with
		// an alert before routing to the new Project.
		page.on('dialog', (dialog) => {
			void dialog.accept();
		});

		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto('/proposals');
		await expect(
			page.getByRole('heading', {
				name: 'Proposals Management',
				exact: true,
			})
		).toBeVisible();

		const proposalRow = page
			.getByRole('row')
			.filter({ hasText: fixture.proposalTitle });
		await expect(proposalRow).toBeVisible();

		const conversionResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname ===
					`/api/proposals/${fixture.proposalId}`
		);
		const projectNavigation = page.waitForURL(/\/projects\/\d+\/edit$/);
		await proposalRow.getByTitle('Convert to Project').click();

		const response = await conversionResponse;
		expect(response.status()).toBe(201);
		const body = await response.json();
		expect(body.success).toBe(true);
		const createdProjectId = Number(body.data?.project?.project_id);
		expect(Number.isInteger(createdProjectId)).toBe(true);
		expect(createdProjectId).toBeGreaterThan(0);

		await projectNavigation;
		expect(new URL(page.url()).pathname).toBe(
			`/projects/${createdProjectId}/edit`
		);
		await expect(
			page.getByRole('heading', { name: 'Edit Project', exact: true })
		).toBeVisible();

		const header = page.getByRole('banner');
		await expect(
			header.getByText(fixture.proposalTitle, { exact: true })
		).toBeVisible();
		await expect(
			header.getByText(fixture.clientName, { exact: true })
		).toBeVisible();

		// A fresh read of the created Project keeps the copied identity.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Edit Project', exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('banner').getByText(fixture.proposalTitle, {
				exact: true,
			})
		).toBeVisible();
		await expect(
			page.getByRole('banner').getByText(fixture.clientName, {
				exact: true,
			})
		).toBeVisible();

		// Independent linkage evidence in both directions.
		const stored = await readProposalProjectState(db, fixture.proposalId);
		expect(stored.proposal).not.toBeNull();
		expect(stored.proposal?.id).toBe(fixture.proposalId);
		expect(stored.proposal?.proposalTitle).toBe(fixture.proposalTitle);
		expect(stored.proposal?.status).toBe('CONVERTED');
		expect(stored.proposal?.projectId).toBe(createdProjectId);
		expect(stored.proposal?.convertedAt).not.toBeNull();
		expect(stored.proposal?.isDelete).toBe(0);

		expect(stored.project).not.toBeNull();
		expect(stored.project?.projectId).toBe(createdProjectId);
		expect(stored.project?.proposalId).toBe(fixture.proposalId);
		expect(stored.project?.name).toBe(fixture.proposalTitle);
		expect(stored.project?.clientName).toBe(fixture.clientName);
		expect(stored.project?.companyId).toBe(fixture.companyId);
		expect(stored.project?.isDelete).toBe(0);
	} finally {
		await fixture.dispose();
	}
});
