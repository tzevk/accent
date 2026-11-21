import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	readCostEvents,
	readDirectCostsBySourceReference,
	RECOGNITION_ADJACENT_MONTH,
	RECOGNITION_MONTH,
	seedDirectCostFixture,
} from '../fixtures/expense-recognition.ts';

const RECOGNITION_REASON =
	'E2E invoice received and matched to the service period';

/**
 * Actor: an expense operator signed in as an ordinary user whose namespaced
 * role grants exactly `reports:read`, `other_expenses:read`,
 * `other_expenses:create`, `other_expenses:approve` and `payroll:read` — the
 * financial read gate, plus the create and approval privileges the Expenditure
 * view's own controls require.
 *
 * Starting state: the isolated month March 2021 has no confirmed cost, no
 * unconfirmed cost and no direct-expense record for this identity.
 *
 * Action: open Company Expenditure on that month, choose Record cost, classify
 * the spend as Company Overhead with one service period inside March 2021,
 * gross ₹1,234.56, a unique source reference and receipt evidence, then choose
 * Save and submit and recognize the queued cost with a reason. Finally switch
 * the same picker to February 2021.
 *
 * Proof: before recognition the confirmed total stays ₹0.00 while the review
 * summary names one unconfirmed record; after recognition the company states
 * exactly one recognized record and ₹1,234.56 as both Company Incurred Cost and
 * Company Overhead, with Project and Unallocated Cost at ₹0.00. February 2021
 * reports no recognized record, and an independent MySQL read finds one expense
 * row recognized into 2021-03-01 with its `recorded` then `recognized` journal
 * events. A duplicate count, a wrong month, or a skipped approval fails this
 * test.
 */
test('expense operator records, submits and recognizes a direct cost once in the chosen month', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedDirectCostFixture(db, namespace);

	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, fixture);

		await page.goto(`/reports/company-monthly-cost?month=${RECOGNITION_MONTH}`);
		await expect(
			page.getByRole('heading', { name: 'Company Monthly Cost', exact: true })
		).toBeVisible({ timeout: 60_000 });

		const view = page.getByTestId('expenditure-view');
		await expect(view).toHaveAttribute('data-month', RECOGNITION_MONTH, {
			timeout: 60_000,
		});

		const confirmedCost = page.getByTestId('kpi-confirmed-cost');
		await expect(confirmedCost).toHaveText('₹0.00');
		await expect(
			view.getByText('0 recognized record(s)', { exact: true })
		).toBeVisible();
		await expect(
			view
				.locator(
					'[data-testid="coverage-notice"][data-code="no_recognized_cost"]'
				)
				.first()
		).toBeVisible();

		await page
			.getByRole('button', { name: 'Record cost', exact: true })
			.click();
		const costDialog = page.getByRole('dialog', { name: 'Record cost' });
		await expect(costDialog).toBeVisible({ timeout: 30_000 });

		await costDialog
			.getByLabel('Classification', { exact: true })
			.selectOption({ label: 'Company Overhead' });
		await costDialog
			.getByLabel('Source reference', { exact: true })
			.fill(fixture.sourceReference);
		await costDialog
			.getByLabel('Vendor', { exact: true })
			.fill(fixture.vendorName);
		await costDialog
			.getByLabel('Description', { exact: true })
			.fill(fixture.description);
		await costDialog
			.getByLabel('Service period start', { exact: true })
			.fill(fixture.servicePeriodStart);
		await costDialog
			.getByLabel('Service period end', { exact: true })
			.fill(fixture.servicePeriodEnd);
		await costDialog
			.getByLabel('Bill date', { exact: true })
			.fill(fixture.billDate);
		await costDialog
			.getByLabel('Gross amount', { exact: true })
			.fill(fixture.amount);
		await costDialog
			.getByLabel('Evidence reference', { exact: true })
			.fill(fixture.evidenceReference);
		await costDialog
			.getByRole('button', { name: 'Save and submit', exact: true })
			.click();

		const queue = page.getByTestId('recognition-queue');
		const queueRow = queue
			.getByTestId('queue-row')
			.filter({ hasText: fixture.sourceReference });
		await expect(queueRow).toHaveCount(1, { timeout: 30_000 });
		await expect(queueRow).toContainText(fixture.amountDisplay);
		await expect(queueRow).toContainText('Pending evidence');
		await expect(queueRow).toContainText('Company Overhead');
		await expect(confirmedCost).toHaveText('₹0.00');
		await expect(page.getByTestId('decision-review-queue')).toContainText(
			'1 unconfirmed record(s)'
		);

		await queueRow
			.getByRole('button', { name: 'Recognize', exact: true })
			.click();
		const commandDialog = page.getByRole('dialog', {
			name: 'Recognize expense',
		});
		await expect(commandDialog).toBeVisible({ timeout: 30_000 });
		await commandDialog
			.getByLabel('Reason', { exact: true })
			.fill(RECOGNITION_REASON);
		await commandDialog
			.getByRole('button', { name: 'Recognize expense', exact: true })
			.click();

		await expect(queue.getByTestId('queue-row')).toHaveCount(0, {
			timeout: 30_000,
		});
		await expect(queue).toContainText(
			'Nothing awaiting recognition for March 2021.'
		);
		await expect(confirmedCost).toHaveText(fixture.amountDisplay);
		await expect(
			view.getByText('1 recognized record(s)', { exact: true })
		).toBeVisible();
		await expect(page.getByTestId('kpi-overhead')).toHaveText(
			fixture.amountDisplay
		);
		await expect(page.getByTestId('kpi-overhead')).toHaveAttribute(
			'data-amount',
			fixture.amount
		);
		await expect(page.getByTestId('kpi-project-cost')).toHaveAttribute(
			'data-amount',
			'0'
		);
		await expect(page.getByTestId('kpi-unallocated')).toHaveAttribute(
			'data-amount',
			'0'
		);

		await page
			.getByLabel('Month', { exact: true })
			.selectOption(RECOGNITION_ADJACENT_MONTH);
		await expect(view).toHaveAttribute(
			'data-month',
			RECOGNITION_ADJACENT_MONTH,
			{ timeout: 30_000 }
		);
		await expect(confirmedCost).toHaveText('₹0.00');
		await expect(
			view.getByText('0 recognized record(s)', { exact: true })
		).toBeVisible();
		await expect(
			view
				.locator(
					'[data-testid="coverage-notice"][data-code="no_recognized_cost"]'
				)
				.first()
		).toBeVisible();

		const [stored] = await readDirectCostsBySourceReference(
			db,
			fixture.sourceReference
		);
		if (!stored) {
			throw new Error(
				`[expense-recognition] ${fixture.sourceReference} was not saved`
			);
		}
		expect(stored.id).toBeGreaterThan(0);
		if (!stored.costUid) {
			throw new Error('[expense-recognition] the saved cost has no cost uid');
		}
		const costUid = stored.costUid;
		expect(costUid).toMatch(/^cost-/);
		expect(stored.recognitionState).toBe('recognized');
		expect(stored.recognitionPeriod).toBe(`${RECOGNITION_MONTH}-01`);
		expect(stored.recognizedAmount).toBe(fixture.amount);
		expect(stored.totalAmount).toBe(fixture.amount);
		expect(stored.taxAmount).toBe('0.00');
		expect(stored.classification).toBe('company_overhead');
		expect(stored.currency).toBe('INR');
		expect(stored.financialVersion).toBe(2);
		expect(stored.createdBy).toBe(fixture.userId);

		const events = await readCostEvents(db, costUid);
		expect(events.map((event) => event.command)).toEqual([
			'recorded',
			'recognized',
		]);
		expect(events.map((event) => event.version)).toEqual([1, 2]);
		expect(events[0]?.reason).toBe('Submitted for recognition');
		expect(events[1]?.reason).toBe(RECOGNITION_REASON);
		expect(events[1]?.actorUserId).toBe(fixture.userId);
	} finally {
		await fixture.dispose();
	}
});
