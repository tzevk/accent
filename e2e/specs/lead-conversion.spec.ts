import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readLeadConversionState,
	seedLeadConversionFixture,
} from '../fixtures/lead-conversion.ts';

// The owned Next dev server compiles routes on first visit; every assertion
// still waits for its observable result. This only bounds compilation time.
test.setTimeout(120_000);

/**
 * Actor: an ordinary signed-in user with exactly `leads:read`,
 * `leads:update`, `leads:convert`, `proposals:read`, and
 * `proposals:create` — no super admin and no other module grants.
 *
 * Starting state: a fixture-owned Qualified Lead with a named contact, a
 * usable phone and email, a project need, and this user as owner; the Lead
 * has no Proposal and no prior conversion.
 *
 * Action: open the Lead, use its Convert to Proposal panel to name and
 * create the canonical Proposal, then reopen the Lead and follow the
 * canonical Proposal link shown there.
 *
 * Proof: the Proposal page is identified by the new Proposal ID and links
 * back to the Lead; the reopened Lead says the enquiry already has its
 * canonical proposal and offers `Open Proposal #N`, which opens that same
 * page. Independently read rows must show the exact two-way linkage between
 * this Lead and this Proposal, the stored Proposal title, and one conversion
 * recorded against this user.
 */
test('converting a qualified lead opens its named proposal and keeps the canonical link on the lead', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedLeadConversionFixture(db, namespace);
	try {
		page.setDefaultNavigationTimeout(60_000);

		// The Lead starts exactly as the handoff requires: Qualified, owned,
		// and without the Proposal it is about to gain.
		const before = await readLeadConversionState(db, fixture);
		if (before.lead === null) {
			throw new Error(`[e2e] fixture Lead ${fixture.leadId} is missing`);
		}
		expect(before.lead.companyName).toBe(fixture.companyName);
		expect(before.lead.enquiryStatus).toBe('Qualified');
		expect(before.lead.canonicalProposalId).toBeNull();
		expect(before.lead.convertedAt).toBeNull();
		expect(before.proposals).toEqual([]);
		expect(before.conversions).toEqual([]);

		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto(`/leads/${fixture.leadId}`);
		await expect(
			page.getByRole('heading', { name: fixture.companyName, exact: true })
		).toBeVisible();

		const conversionPanel = page.getByRole('region', {
			name: 'Convert to Proposal',
		});
		await expect(conversionPanel).toBeVisible();
		await conversionPanel
			.getByRole('button', { name: 'Convert to Proposal', exact: true })
			.click();
		await conversionPanel
			.getByLabel('Proposal title', { exact: true })
			.fill(fixture.proposalTitle);

		// Arm both waits before the action that guarantees them.
		const conversionResponse = page.waitForResponse(
			(response) =>
				response.request().method() === 'POST' &&
				new URL(response.url()).pathname ===
					`/api/leads/${fixture.leadId}/convert`
		);
		const proposalNavigation = page.waitForURL(/\/proposals\/\d+$/);
		await conversionPanel
			.getByRole('button', { name: 'Convert lead', exact: true })
			.click();

		expect((await conversionResponse).ok()).toBe(true);
		await proposalNavigation;

		const proposalId = Number(
			new URL(page.url()).pathname.split('/').filter(Boolean).pop()
		);
		expect(Number.isInteger(proposalId) && proposalId > 0).toBe(true);

		// The destination is the Proposal the conversion created. The header
		// identifies it by its Proposal ID (the stored proposal_title is a
		// separate column), and it links back to this Lead.
		await expect(
			page.getByText(`Proposal ID: ${proposalId}`, { exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('link', {
				name: `Linked Lead: ${fixture.companyName}`,
				exact: true,
			})
		).toHaveAttribute('href', `/leads/${fixture.leadId}/edit`);

		// Independent persisted evidence: the Lead points at the Proposal,
		// the Proposal points back at the Lead, and one conversion names
		// this user as its actor.
		const after = await readLeadConversionState(db, fixture);
		if (after.lead === null) {
			throw new Error(
				`[e2e] Lead ${fixture.leadId} is missing after conversion`
			);
		}
		expect(after.lead.enquiryStatus).toBe('Converted');
		expect(after.lead.canonicalProposalId).toBe(proposalId);
		expect(after.lead.convertedAt).not.toBeNull();
		expect(after.lead.convertedBy).toBe(fixture.userId);
		expect(after.lead.isDelete).toBe(0);
		expect(after.proposals).toEqual([
			{
				id: proposalId,
				title: fixture.proposalTitle,
				leadId: fixture.leadId,
				canonicalLeadId: fixture.leadId,
				status: 'DRAFT',
				isDelete: 0,
			},
		]);
		expect(after.conversions).toEqual([
			{
				leadId: fixture.leadId,
				proposalId,
				convertedBy: fixture.userId,
			},
		]);

		// Reopening the Lead presents the canonical Proposal link, and that
		// link leads back to the same named Proposal.
		await page.goto(`/leads/${fixture.leadId}`);
		const storedConversionPanel = page.getByRole('region', {
			name: 'Convert to Proposal',
		});
		await expect(storedConversionPanel).toContainText(
			'This enquiry already has its canonical proposal.'
		);
		const canonicalLink = storedConversionPanel.getByRole('button', {
			name: `Open Proposal #${proposalId}`,
			exact: true,
		});
		await expect(canonicalLink).toBeVisible();

		const canonicalNavigation = page.waitForURL(
			new RegExp(`/proposals/${proposalId}$`)
		);
		await canonicalLink.click();
		await canonicalNavigation;
		await expect(
			page.getByText(`Proposal ID: ${proposalId}`, { exact: true })
		).toBeVisible();
		await expect(
			page.getByRole('link', {
				name: `Linked Lead: ${fixture.companyName}`,
				exact: true,
			})
		).toHaveAttribute('href', `/leads/${fixture.leadId}/edit`);
	} finally {
		await fixture.dispose();
	}
});
