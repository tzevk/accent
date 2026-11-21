import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readCreatedLead,
	readLeadWorkState,
	seedLeadCreationFixture,
	seedLeadWorkFixture,
} from '../fixtures/lead-work.ts';

// The owned Next dev server compiles routes on first visit; every assertion
// still waits for its observable result. This only bounds compilation time.
test.setTimeout(120_000);

// Actor: an ordinary user whose custom role grants exactly leads:read and
// leads:create — no administrator, no assignment and no other module rights.
// Starting state: the run's namespaced company name does not exist yet.
// Action: Add New Lead → author company, contact, email, phone, designation,
// city, source, priority, enquiry type, project and notes → Save Lead → search
// the register for the saved company and open its detail page.
// Proof: the reopened Lead shows the authored values, the New stage, the
// creator as owner and the creator named as the owner-change actor; an
// independent database read by the saved company name matches every authored
// value, the owner id, the New stage and isDelete 0.
test('creating a lead through the form saves the creator as owner at New', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedLeadCreationFixture(db, namespace);
	try {
		expect(await readCreatedLead(db, fixture.companyName)).toBeNull();

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto('/leads/new');
		await expect(
			page.getByRole('heading', { name: 'Add New Lead', exact: true })
		).toBeVisible({ timeout: 60_000 });

		await page.getByLabel(/^Company\b/).fill(fixture.companyName);
		await page
			.getByLabel('Contact Name', { exact: true })
			.fill(fixture.contactName);
		await page
			.getByLabel('Designation', { exact: true })
			.fill(fixture.designation);
		await page.getByLabel('City', { exact: true }).fill(fixture.city);
		await page.getByLabel('Phone Number', { exact: true }).fill(fixture.phone);
		await page
			.getByLabel('Lead Source', { exact: true })
			.fill(fixture.leadSource);
		await page
			.getByLabel('Contact Email', { exact: true })
			.fill(fixture.contactEmail);
		await page
			.getByLabel('Inquiry Email', { exact: true })
			.fill(fixture.inquiryEmail);
		await page
			.getByLabel('Enquiry Date', { exact: true })
			.fill(fixture.enquiryDate);
		await page
			.getByLabel('Priority', { exact: true })
			.selectOption(fixture.priority);
		await page
			.getByLabel('Enquiry Type', { exact: true })
			.selectOption(fixture.enquiryType);
		await page
			.getByLabel('Project Description', { exact: true })
			.fill(fixture.projectDescription);
		await page.getByLabel('Notes', { exact: true }).fill(fixture.notes);

		await page.getByRole('button', { name: 'Save Lead', exact: true }).click();
		await page.waitForURL((url) => url.pathname === '/leads', {
			timeout: 60_000,
		});

		const search = page.getByLabel('Search leads', { exact: true });
		await expect(search).toBeVisible({ timeout: 60_000 });
		await search.fill(fixture.companyName);

		const row = page.getByRole('row').filter({ hasText: fixture.companyName });
		await expect(row).toBeVisible();
		await expect(row).toContainText(fixture.contactName);
		await expect(row).toContainText(fixture.contactEmail);
		await expect(row).toContainText(fixture.phone);
		await expect(row).toContainText(fixture.username);
		await expect(row.getByText('New', { exact: true })).toBeVisible();

		await row
			.getByRole('button', {
				name: `View lead ${fixture.companyName}`,
				exact: true,
			})
			.click();
		await page.waitForURL(/\/leads\/\d+$/, { timeout: 60_000 });

		const openedId = Number(
			new URL(page.url()).pathname.split('/').filter(Boolean).pop()
		);
		await expect(
			page.getByRole('heading', { name: fixture.companyName, exact: true })
		).toBeVisible({ timeout: 60_000 });

		// Each field label and its value share one container on the detail
		// page; scope the proof to that container instead of the whole page.
		const field = (label: string) =>
			page.getByText(label, { exact: true }).locator('..');
		await expect(field('Company Name')).toContainText(fixture.companyName);
		await expect(field('Contact Person')).toContainText(fixture.contactName);
		await expect(field('Contact Email')).toContainText(fixture.contactEmail);
		await expect(field('Phone')).toContainText(fixture.phone);
		await expect(field('Location')).toContainText(fixture.city);
		await expect(field('Inquiry Email')).toContainText(fixture.inquiryEmail);
		await expect(field('Project Description')).toContainText(
			fixture.projectDescription
		);
		await expect(field('Enquiry Type')).toContainText(fixture.enquiryType);
		await expect(field('Lead Source')).toContainText(fixture.leadSource);
		await expect(field('Notes')).toContainText(fixture.notes);
		await expect(field('Priority')).toContainText(
			fixture.priority.toUpperCase()
		);
		await expect(field('Lead Stage')).toContainText('New');
		await expect(
			page
				.getByRole('heading', { name: 'Lead Owner', exact: true })
				.locator('..')
		).toContainText(fixture.username);

		// The audit trail of the new Lead names the creator as the actor.
		const timeline = page.getByRole('region', { name: 'Lead timeline' });
		await expect(timeline).toContainText(
			`Owner changed to ${fixture.username}`,
			{ timeout: 30_000 }
		);
		await expect(timeline).toContainText(`by ${fixture.username}`);

		const stored = await readCreatedLead(db, fixture.companyName);
		if (stored === null) {
			throw new Error(
				`[e2e] the browser did not persist ${fixture.companyName}`
			);
		}
		expect(stored.id).toBe(openedId);
		expect(stored).toMatchObject({
			companyName: fixture.companyName,
			contactName: fixture.contactName,
			contactEmail: fixture.contactEmail,
			inquiryEmail: fixture.inquiryEmail,
			phone: fixture.phone,
			designation: fixture.designation,
			city: fixture.city,
			projectDescription: fixture.projectDescription,
			enquiryType: fixture.enquiryType,
			enquiryStatus: 'New',
			leadSource: fixture.leadSource,
			priority: fixture.priority,
			notes: fixture.notes,
			enquiryDate: fixture.enquiryDate,
			followUpDate: null,
			ownerUserId: fixture.userId,
			isDelete: 0,
		});
	} finally {
		await fixture.dispose();
	}
});

// Actor: an ordinary user whose custom role grants exactly leads:read and
// leads:update — no administrator, no assignment and no other module rights.
// Starting state: a New-stage Lead owned by that user, with only its company,
// contact, project and owner stored and no prior activity or stage history.
// Action: open the Lead, record a Connected call with its notes, and schedule
// a Call next action by date and description in the same form.
// Proof: after reloading the detail page the timeline shows the Completed call
// with its outcome, notes and author, plus the Scheduled next action dated and
// described; the stage is Connected and the next follow-up is that date. An
// independent database read by the owned Lead id shows exactly one completed
// call, one scheduled call, the mirrored follow-up date and one automatic
// New → Connected history row attributed to the actor.
test('recording a connected call keeps its completed activity and dated next step', async ({
	page,
	db,
	namespace,
}) => {
	const fixture = await seedLeadWorkFixture(db, namespace);
	try {
		const before = await readLeadWorkState(db, fixture.leadId);
		expect(before.lead?.enquiryStatus).toBe('New');
		expect(before.lead?.ownerUserId).toBe(fixture.userId);
		expect(before.activities).toEqual([]);
		expect(before.stageHistory).toEqual([]);

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, {
			username: fixture.username,
			password: fixture.password,
		});

		await page.goto(`/leads/${fixture.leadId}`);
		await expect(
			page.getByRole('heading', { name: fixture.companyName, exact: true })
		).toBeVisible({ timeout: 60_000 });

		const activityCard = page
			.getByRole('heading', { name: 'Log activity', exact: true })
			.locator('..');
		await activityCard
			.getByLabel('Activity type', { exact: true })
			.selectOption('Call');
		await activityCard
			.getByLabel('Call outcome', { exact: true })
			.selectOption(fixture.callOutcome);
		await activityCard.getByLabel('Notes', { exact: true }).fill(fixture.notes);
		await activityCard
			.getByLabel('Schedule the next action now', { exact: true })
			.check();
		await activityCard
			.getByLabel('Next action type', { exact: true })
			.selectOption('Call');
		await activityCard
			.getByLabel('Next action date', { exact: true })
			.fill(fixture.scheduledFor);
		await activityCard
			.getByLabel('Next action description', { exact: true })
			.fill(fixture.nextActionText);
		await activityCard
			.getByRole('button', { name: 'Record activity', exact: true })
			.click();
		await expect(
			activityCard.getByText(
				`Activity recorded. Next action: ${fixture.scheduledFor}.`,
				{ exact: true }
			)
		).toBeVisible();

		// The reopen is a fresh read of the saved Lead, not the form's state.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: fixture.companyName, exact: true })
		).toBeVisible();

		const timeline = page.getByRole('region', { name: 'Lead timeline' });
		const completedCall = timeline
			.locator('li')
			.filter({ hasText: `Call — ${fixture.callOutcome}` });
		await expect(completedCall).toContainText('Completed', {
			timeout: 30_000,
		});
		await expect(completedCall).toContainText(fixture.notes);
		await expect(completedCall).toContainText(`by ${fixture.username}`);

		const scheduledCall = timeline
			.locator('li')
			.filter({ hasText: `Call scheduled for ${fixture.scheduledLabel}` });
		await expect(scheduledCall).toContainText('Scheduled');
		await expect(scheduledCall).toContainText(fixture.nextActionText);
		await expect(scheduledCall).toContainText(`by ${fixture.username}`);

		await expect(timeline).toContainText('Stage: New → Connected');
		await expect(
			page.getByText('Lead Stage', { exact: true }).locator('..')
		).toContainText('Connected');
		const followUp = page
			.getByText('Next follow-up', { exact: true })
			.locator('..');
		await expect(followUp).toContainText('Next action: Call');
		await expect(followUp).toContainText(fixture.scheduledLabel);
		await expect(
			page.getByText('Completed activities', { exact: true }).locator('..')
		).toContainText('1');
		await expect(
			page.getByText('Latest activity', { exact: true }).locator('..')
		).toContainText(`Latest outcome: ${fixture.callOutcome}`);

		const stored = await readLeadWorkState(db, fixture.leadId);
		expect(stored.lead?.enquiryStatus).toBe('Connected');
		expect(stored.lead?.ownerUserId).toBe(fixture.userId);
		expect(stored.lead?.followUpDate).toBe(fixture.scheduledFor);
		expect(stored.lead?.isDelete).toBe(0);

		const completed = stored.activities.filter(
			(activity) => activity.status === 'Completed'
		);
		const scheduled = stored.activities.filter(
			(activity) => activity.status === 'Scheduled'
		);
		expect(completed).toHaveLength(1);
		expect(scheduled).toHaveLength(1);
		expect(completed[0]).toMatchObject({
			activityType: 'Call',
			callOutcome: fixture.callOutcome,
			notes: fixture.notes,
			scheduledFor: null,
			createdBy: fixture.userId,
			isDelete: 0,
		});
		expect(completed[0]?.occurredAt).not.toBeNull();
		expect(completed[0]?.completedAt).not.toBeNull();
		expect(scheduled[0]).toMatchObject({
			activityType: 'Call',
			callOutcome: null,
			scheduledFor: fixture.scheduledFor,
			occurredAt: null,
			nextAction: fixture.nextActionText,
			createdBy: fixture.userId,
			isDelete: 0,
		});
		expect(
			stored.stageHistory.map((row) => [
				row.fromStage,
				row.toStage,
				row.changeSource,
				row.actorUserId,
			])
		).toEqual([['New', 'Connected', 'automatic', fixture.userId]]);
	} finally {
		await fixture.dispose();
	}
});
