import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	PETTY_CASH_MONTH,
	readCostEvents,
	readCostLinks,
	readPettyCashFundingByVoucher,
	readPettyCashSpendsByCreator,
	seedPettyCashFixture,
} from '../fixtures/expense-recognition.ts';

/**
 * Actor: a petty-cash operator signed in as an ordinary user whose namespaced
 * role grants exactly `petty_cash_expenses:read`, `petty_cash_expenses:create`
 * and `petty_cash_expenses:approve`, plus the company report's
 * `reports:read`, `other_expenses:read` and `payroll:read`.
 *
 * Starting state: an approved cash voucher of ₹5,000.00 dated June 2022 and its
 * mirrored petty-cash funding credit, seeded with one funding and one mirror
 * cost link and no `cost` link. The petty-cash register has no spending.
 *
 * Action: open Petty Cash Expenses, add one ₹1,250.50 spend against that
 * voucher with a June 2022 service period classified as Company Overhead,
 * save it, then recognize the spending from its row. Finally open Company
 * Expenditure on June 2022.
 *
 * Proof: the supported voucher picker states the voucher still has ₹5,000.00
 * remaining before the spend; spending becomes ₹1,250.50 and recognized cost
 * stays ₹0.00 until the approval, then becomes ₹1,250.50. The June 2022 report's
 * petty-cash section states funding ₹5,000.00, spending ₹1,250.50, remaining
 * funding ₹3,749.50, and recognized cost ₹1,250.50, while Company Expenditure
 * for the month states exactly one recognized record and ₹1,250.50 — never the
 * ₹6,250.50 that would double-count the funding. An independent MySQL read
 * keeps the funding row a `funding` event with no recognition, no journal event
 * and only funding/mirror links, while the spend row is recognized once.
 * Treating the voucher or its mirror as expense fails this test.
 */
test('petty-cash operator records a supported spend while funding stays outside cost', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedPettyCashFixture(db, namespace);

	try {
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, fixture);

		await page.goto('/admin/petty-cash-expenses');
		await expect(
			page.getByRole('heading', { name: 'Petty Cash Expenses', exact: true })
		).toBeVisible({ timeout: 60_000 });

		const spendCard = page.getByTestId('petty-spend-amount');
		const recognizedCard = page.getByTestId('petty-recognized-amount');

		await expect(spendCard).toHaveText(fixture.zeroDisplay);
		await expect(recognizedCard).toHaveText(fixture.zeroDisplay);

		await page
			.getByRole('button', { name: 'Add Expense', exact: true })
			.click();
		await page
			.getByLabel('Transaction date', { exact: true })
			.fill(fixture.transactionDate);
		await page.getByLabel('Amount', { exact: true }).fill(fixture.spendAmount);

		await page.getByRole('button', { name: 'Voucher', exact: true }).click();
		const voucherOption = page.getByRole('button', {
			name: fixture.voucherOptionLabel,
			exact: true,
		});
		await expect(voucherOption).toBeVisible({ timeout: 30_000 });
		await voucherOption.click();
		await expect(
			page.getByRole('button', { name: 'Voucher', exact: true })
		).toContainText(fixture.voucherNumber);

		await page
			.getByRole('button', { name: 'Classification', exact: true })
			.click();
		await page
			.getByRole('button', { name: 'Company Overhead', exact: true })
			.click();

		await page
			.getByLabel('Service period start', { exact: true })
			.fill(fixture.serviceDate);
		await page
			.getByLabel('Receipt evidence', { exact: true })
			.fill(fixture.evidenceReference);
		await page.getByLabel('Notes', { exact: true }).fill(fixture.note);
		await page.getByTitle('Save', { exact: true }).click();

		await expect
			.poll(
				async () =>
					(await readPettyCashSpendsByCreator(db, fixture.userId)).length,
				{ timeout: 30_000 }
			)
			.toBe(1);
		const [created] = await readPettyCashSpendsByCreator(db, fixture.userId);
		if (!created) {
			throw new Error('[petty-cash] the saved spend is not in the ledger');
		}

		const record = page.getByTestId(`petty-row-${created.transactionNumber}`);
		const recordState = page.getByTestId(
			`petty-state-${created.transactionNumber}`
		);
		await page
			.getByPlaceholder('Search by voucher #, particulars, recipient, bill #…')
			.fill(created.transactionNumber);
		await expect(record).toHaveCount(1, { timeout: 30_000 });
		await expect(record).toContainText(fixture.spendDisplay);
		await expect(recordState).toHaveText('Draft');
		await expect(spendCard).toHaveText(fixture.spendDisplay);
		await expect(recognizedCard).toHaveText(fixture.zeroDisplay);

		await page
			.getByRole('button', {
				name: `Recognize ${created.transactionNumber}`,
				exact: true,
			})
			.click();
		await expect(recordState).toHaveText('Recognized', { timeout: 30_000 });
		await expect(spendCard).toHaveText(fixture.spendDisplay);
		await expect(recognizedCard).toHaveText(fixture.spendDisplay);

		await page.goto(`/reports/company-monthly-cost?month=${PETTY_CASH_MONTH}`);
		await expect(
			page.getByRole('heading', { name: 'Company Monthly Cost', exact: true })
		).toBeVisible({ timeout: 60_000 });
		const view = page.getByTestId('expenditure-view');
		await expect(view).toHaveAttribute('data-month', PETTY_CASH_MONTH, {
			timeout: 60_000,
		});
		await expect(page.getByTestId('kpi-confirmed-cost')).toHaveText(
			fixture.spendDisplay,
			{ timeout: 30_000 }
		);
		await expect(page.getByTestId('kpi-overhead')).toHaveText(
			fixture.spendDisplay
		);
		await expect(
			view.getByText('1 recognized record(s)', { exact: true })
		).toBeVisible();

		// The month-scoped petty-cash section states the funding and the
		// remaining float for June 2022 itself, so another month's vouchers
		// cannot change these figures.
		const pettyCash = page.getByTestId('petty-cash-section');
		await expect(pettyCash.getByTestId('petty-funding-amount')).toHaveText(
			fixture.fundingDisplay
		);
		await expect(pettyCash.getByTestId('petty-spend-amount')).toHaveText(
			fixture.spendDisplay
		);
		await expect(pettyCash.getByTestId('petty-remaining-amount')).toHaveText(
			fixture.remainingDisplay
		);
		await expect(pettyCash.getByTestId('petty-recognized-amount')).toHaveText(
			fixture.spendDisplay
		);

		const [storedSpend] = await readPettyCashSpendsByCreator(
			db,
			fixture.userId
		);
		if (!storedSpend) {
			throw new Error('[petty-cash] the recognized spend is not in the ledger');
		}
		if (!storedSpend.costUid) {
			throw new Error('[petty-cash] the recognized spend has no cost uid');
		}
		const spendCostUid = storedSpend.costUid;
		expect(storedSpend.entryKind).toBe('spend');
		expect(storedSpend.sourceVoucherId).toBe(fixture.voucherId);
		expect(storedSpend.debitAmount).toBe(fixture.spendAmount);
		expect(storedSpend.creditAmount).toBe('0.00');
		expect(spendCostUid).toMatch(/^cost-/);
		expect(storedSpend.recognitionState).toBe('recognized');
		expect(storedSpend.recognitionPeriod).toBe(`${PETTY_CASH_MONTH}-01`);
		expect(storedSpend.recognizedAmount).toBe(fixture.spendAmount);
		expect(storedSpend.classification).toBe('company_overhead');
		expect(storedSpend.financialVersion).toBe(2);
		expect(storedSpend.linkedCostUid).toBeNull();
		expect(storedSpend.createdBy).toBe(fixture.userId);

		const [funding] = await readPettyCashFundingByVoucher(
			db,
			fixture.voucherId
		);
		if (!funding) {
			throw new Error('[petty-cash] the funding mirror is missing');
		}
		if (!funding.costUid) {
			throw new Error('[petty-cash] the funding row has no funding uid');
		}
		const fundingCostUid = funding.costUid;
		expect(funding.entryKind).toBe('funding');
		expect(funding.debitAmount).toBe('0.00');
		expect(funding.creditAmount).toBe(fixture.fundingAmount);
		expect(fundingCostUid).toBe(`fund-${fixture.voucherId}`);
		expect(funding.recognitionState).toBe('draft');
		expect(funding.recognizedAmount).toBeNull();
		expect(funding.linkedCostUid).toBeNull();

		const spendEvents = await readCostEvents(db, spendCostUid);
		expect(spendEvents.map((event) => event.command)).toEqual([
			'recorded',
			'recognized',
		]);
		expect(spendEvents.map((event) => event.version)).toEqual([1, 2]);
		expect(spendEvents[1]?.actorUserId).toBe(fixture.userId);

		const fundingEvents = await readCostEvents(db, fundingCostUid);
		expect(fundingEvents).toEqual([]);

		const fundingLinks = await readCostLinks(db, fundingCostUid);
		expect(fundingLinks.map((link) => link.role).sort()).toEqual([
			'funding',
			'mirror',
		]);
		expect(fundingLinks.some((link) => link.role === 'cost')).toBe(false);
	} finally {
		await fixture.dispose();
	}
});
