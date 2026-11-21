import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	CLOSE_COST,
	FINANCIAL_CLOSE_MONTH,
	FINANCIAL_REVISION_MONTH,
	REVISION_CORRECTED_COST,
	REVISION_FROZEN_COST,
	readFinancialClose,
	readFinancialExpense,
	readFinancialRevisions,
	seedFinancialMonth,
} from '../fixtures/financial-close.ts';
import type { Page } from '@playwright/test';

const CLOSE_COST_DISPLAY = '₹12,345.67';
const REVISION_FROZEN_DISPLAY = '₹25,000.50';
const REVISION_CURRENT_DISPLAY = '₹31,000.75';

/**
 * Open the expenditure view on the fixture month and wait until its
 * reconciliation (including the close and revision state) is rendered.
 */
async function openExpenditureMonth(page: Page, month: string): Promise<void> {
	page.setDefaultNavigationTimeout(60_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/reports/company-monthly-cost?month=${month}`);
	await expect(page.getByTestId('decision-view')).toHaveAttribute(
		'data-month',
		month,
		{ timeout: 60_000 }
	);
}

/**
 * Actor: an ordinary signed-in employee with `reports:read`,
 * `other_expenses:read`, `payroll:read`, and `other_expenses:update` — the
 * financial read gate plus the cost-update grant the close route requires.
 *
 * Starting state: one reserved historic open month (2015-02) with exactly one
 * recognized, classified INR Company Overhead cost of ₹12,345.67, whose
 * service period sits inside the month, so the close review has confirmed
 * cost and no blocker.
 *
 * Action: open the month's expenditure report, read the successful review,
 * enter a closure reason and evidence reference, and press the close button.
 *
 * Proof: the section states Closed and the frozen Company Incurred Cost
 * ₹12,345.67; after a reload the same closed state and figures return; an
 * independent MySQL read shows the immutable snapshot, its frozen amount, the
 * actor, reason, and evidence.
 */
test('financial close freezes a clean reviewed month at its recognized cost', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedFinancialMonth(db, namespace, {
		month: FINANCIAL_CLOSE_MONTH,
		amount: CLOSE_COST,
		writeAccess: true,
	});
	const closeReason = `Close review ${namespace}`;
	const closeEvidence = `CLOSE-EVID-${namespace}`;

	try {
		await signInThroughUi(page, fixture);
		await openExpenditureMonth(page, fixture.month);

		await expect(page.getByTestId('kpi-confirmed-cost')).toHaveText(
			CLOSE_COST_DISPLAY
		);
		await expect(page.getByTestId('financial-close-status')).toHaveText('Open');
		await expect(page.getByTestId('financial-close-section')).toContainText(
			'Review complete: every source is wired'
		);

		await page.getByTestId('financial-close-reason-input').fill(closeReason);
		await page
			.getByTestId('financial-close-evidence-input')
			.fill(closeEvidence);
		await page.getByTestId('financial-close-button').click();

		await expect(page.getByTestId('financial-close-status')).toHaveText(
			'Closed',
			{ timeout: 60_000 }
		);
		await expect(page.getByTestId('financial-close-totals')).toContainText(
			`Frozen Company Incurred Cost ${CLOSE_COST_DISPLAY}`
		);
		await expect(page.getByTestId('financial-close-history')).toContainText(
			closeReason
		);
		await expect(page.getByTestId('financial-close-history')).toContainText(
			closeEvidence
		);
		await expect(page.getByTestId('financial-close-history')).toContainText(
			`by user #${fixture.userId}`
		);

		const stored = await readFinancialClose(db, fixture.month);
		if (!stored) {
			throw new Error(
				`[financial-close] no close snapshot was stored for ${fixture.month}`
			);
		}
		expect(stored.closeUid).toMatch(/^close-/);
		expect(stored.financialVersion).toBe(1);
		expect(stored.reviewedBy).toBe(fixture.userId);
		expect(stored.reviewReason).toBe(closeReason);
		expect(stored.evidenceReference).toBe(closeEvidence);
		expect(stored.snapshot).toMatchObject({
			month: fixture.month,
			company: {
				incurred_cost: CLOSE_COST,
				currency: 'INR',
				record_count: 1,
			},
		});

		await page.reload();
		await expect(page.getByTestId('decision-view')).toHaveAttribute(
			'data-month',
			fixture.month,
			{ timeout: 60_000 }
		);
		await expect(page.getByTestId('financial-close-status')).toHaveText(
			'Closed'
		);
		await expect(page.getByTestId('financial-close-totals')).toContainText(
			`Frozen Company Incurred Cost ${CLOSE_COST_DISPLAY}`
		);
		await expect(page.getByTestId('financial-close-history')).toContainText(
			closeReason
		);
	} finally {
		await fixture.dispose();
	}
});

/**
 * Actor: an ordinary signed-in employee with the same financial read gate plus
 * `other_expenses:update` — the correction grant the revision route requires.
 *
 * Starting state: one reserved historic month (2015-04) already closed with a
 * frozen Company Incurred Cost of ₹25,000.50 and one recognized INR Company
 * Overhead cost of the same amount; no revision exists.
 *
 * Action: open the closed month, choose that cost in Financial revisions,
 * correct its gross amount to ₹31,000.75 with a reason and evidence reference,
 * and submit.
 *
 * Proof: the revision section keeps the frozen ₹25,000.50 beside the live
 * current ₹31,000.75 and lists the correction with its reason; after a reload
 * the same history and totals return; the close section still states the
 * frozen ₹25,000.50; independent MySQL reads show the cost now recognized at
 * ₹31,000.75 on version 2, one revision header with prior/new figures, and the
 * close snapshot unchanged.
 */
test('financial revision preserves the frozen close and shows prior and corrected figures', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedFinancialMonth(db, namespace, {
		month: FINANCIAL_REVISION_MONTH,
		amount: REVISION_FROZEN_COST,
		writeAccess: true,
		closed: true,
	});
	const reason = `Vendor credit note ${namespace}`;
	const evidence = `CN-${fixture.expenseNumber}`;

	try {
		await signInThroughUi(page, fixture);
		await openExpenditureMonth(page, fixture.month);

		await expect(page.getByTestId('financial-close-status')).toHaveText(
			'Closed'
		);
		await expect(page.getByTestId('financial-revision-status')).toHaveText(
			'Closed'
		);
		await expect(page.getByTestId('financial-revision-totals')).toContainText(
			`Frozen ${REVISION_FROZEN_DISPLAY}`
		);
		await expect(page.getByTestId('financial-revision-totals')).toContainText(
			`current ${REVISION_FROZEN_DISPLAY}`
		);
		await expect(page.getByTestId('financial-revision-section')).toContainText(
			'No revisions yet.'
		);

		await page
			.getByTestId('financial-revision-target')
			.selectOption(fixture.costUid);
		await expect(page.getByTestId('financial-revision-command')).toHaveValue(
			'update'
		);
		await page
			.getByTestId('financial-revision-amount-input')
			.fill(String(REVISION_CORRECTED_COST));
		await page.getByTestId('financial-revision-reason-input').fill(reason);
		await page.getByTestId('financial-revision-evidence-input').fill(evidence);
		await page.getByTestId('financial-revision-submit').click();

		const entry = page.getByTestId('financial-revision-entry');
		await expect(entry).toHaveCount(1, { timeout: 60_000 });
		await expect(entry).toContainText(fixture.expenseNumber);
		await expect(entry).toContainText('corrected');
		await expect(entry).toContainText('25000.5');
		await expect(entry).toContainText('31000.75');
		await expect(entry).toContainText(reason);
		await expect(entry).toContainText(evidence);
		await expect(page.getByTestId('financial-revision-totals')).toContainText(
			`Frozen ${REVISION_FROZEN_DISPLAY}`
		);
		await expect(page.getByTestId('financial-revision-totals')).toContainText(
			`current ${REVISION_CURRENT_DISPLAY}`
		);
		await expect(page.getByTestId('financial-close-totals')).toContainText(
			`Frozen Company Incurred Cost ${REVISION_FROZEN_DISPLAY}`
		);

		const cost = await readFinancialExpense(db, fixture.costUid);
		expect(cost).not.toBeNull();
		expect(cost).toMatchObject({
			costUid: fixture.costUid,
			expenseNumber: fixture.expenseNumber,
			state: 'recognized',
			classification: 'company_overhead',
			recognitionPeriod: `${fixture.month}-01`,
			recognizedAmount: REVISION_CORRECTED_COST,
			totalAmount: REVISION_CORRECTED_COST,
			currency: 'INR',
			financialVersion: 2,
			isDelete: 0,
		});

		const revisions = await readFinancialRevisions(db, fixture.month);
		expect(revisions).toHaveLength(1);
		if (!fixture.closeUid) {
			throw new Error('[financial-close] the seeded month has no close UID');
		}
		expect(revisions[0]).toMatchObject({
			closeUid: fixture.closeUid,
			closeVersion: 1,
			targetKind: 'cost',
			targetUid: fixture.costUid,
			command: 'updated',
			priorVersion: 1,
			newVersion: 2,
			reason,
			evidenceReference: evidence,
			actorUserId: fixture.userId,
		});
		expect(revisions[0].priorFigures).toMatchObject({
			amount: REVISION_FROZEN_COST,
			currency: 'INR',
			classification: 'company_overhead',
			period: `${fixture.month}-01`,
			state: 'recognized',
			source_label: fixture.expenseNumber,
		});
		expect(revisions[0].newFigures).toMatchObject({
			amount: REVISION_CORRECTED_COST,
			currency: 'INR',
			classification: 'company_overhead',
			period: `${fixture.month}-01`,
			state: 'recognized',
			source_label: fixture.expenseNumber,
		});

		const close = await readFinancialClose(db, fixture.month);
		if (!close) {
			throw new Error(
				`[financial-close] the seeded close disappeared for ${fixture.month}`
			);
		}
		expect(close.closeUid).toBe(fixture.closeUid);
		expect(close.financialVersion).toBe(1);
		expect(close.snapshot).toMatchObject({
			company: { incurred_cost: REVISION_FROZEN_COST, currency: 'INR' },
		});

		await page.reload();
		await expect(page.getByTestId('decision-view')).toHaveAttribute(
			'data-month',
			fixture.month,
			{ timeout: 60_000 }
		);
		await expect(page.getByTestId('financial-revision-totals')).toContainText(
			`current ${REVISION_CURRENT_DISPLAY}`
		);
		await expect(page.getByTestId('financial-revision-entry')).toHaveCount(1);
		await expect(page.getByTestId('financial-revision-history')).toContainText(
			reason
		);
		await expect(page.getByTestId('financial-close-totals')).toContainText(
			`Frozen Company Incurred Cost ${REVISION_FROZEN_DISPLAY}`
		);
	} finally {
		await fixture.dispose();
	}
});
