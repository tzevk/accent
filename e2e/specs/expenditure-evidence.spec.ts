import ExcelJS from 'exceljs';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	EXPORT_COST,
	EXPORT_SETTLEMENT,
	FINANCIAL_EXPORT_MONTH,
	FINANCIAL_SETTLEMENT_MONTH,
	SETTLEMENT_COST,
	SETTLEMENT_PAID,
	readFinancialExpense,
	readFinancialSettlementsForCost,
	readSettlementEvents,
	seedFinancialMonth,
} from '../fixtures/financial-close.ts';
import type { Page } from '@playwright/test';

const SETTLEMENT_COST_DISPLAY = '₹20,000.00';
const SETTLEMENT_PAID_DISPLAY = '₹5,000.00';
const EXPORT_COST_DISPLAY = '₹34,567.89';
const EXPORT_REMAINING = 22222.22;

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

function cellValue(
	worksheet: ExcelJS.Worksheet,
	row: number,
	column: number
): unknown {
	const value = worksheet.getCell(row, column).value;
	if (value !== null && typeof value === 'object') {
		if ('result' in value) return value.result;
		if ('text' in value) return value.text;
		if ('richText' in value && Array.isArray(value.richText)) {
			return value.richText
				.map((part: unknown) =>
					part !== null &&
					typeof part === 'object' &&
					'text' in part &&
					typeof part.text === 'string'
						? part.text
						: ''
				)
				.join('');
		}
	}
	return value;
}

function findRow(
	worksheet: ExcelJS.Worksheet,
	column: number,
	predicate: (value: unknown) => boolean
): number {
	for (let row = 1; row <= worksheet.rowCount; row += 1) {
		if (predicate(cellValue(worksheet, row, column))) return row;
	}
	throw new Error(
		`[expenditure-evidence] no row in "${worksheet.name}" matched the authored expectation`
	);
}

/**
 * Actor: an ordinary signed-in employee with exactly `reports:read`,
 * `other_expenses:read`, and `payroll:read` — the financial read gate, with no
 * update grant because recording cash is the action under test.
 *
 * Starting state: one reserved historic open month (2015-06) with one
 * recognized INR Company Overhead cost of ₹20,000.00 and no settlement, so
 * outward cash paid starts at ₹0.00.
 *
 * Action: open the month, expand Outward cash paid, choose that cost, and
 * record one ₹5,000.00 payment dated 2015-06-18 with a reference and payee.
 *
 * Proof: cash paid becomes ₹5,000.00, the target states Partial with
 * ₹5,000.00 of ₹20,000.00, and the movement names the reference; after a
 * reload both values return while confirmed cost stays ₹20,000.00; an
 * independent MySQL read shows one recorded settlement and its journal, and
 * the cost's recognized amount and version unchanged.
 */
test('recording an outward settlement raises cash paid without changing recognized cost', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedFinancialMonth(db, namespace, {
		month: FINANCIAL_SETTLEMENT_MONTH,
		amount: SETTLEMENT_COST,
		writeAccess: true,
	});
	const settledOn = `${fixture.month}-18`;
	const reference = `REF-${fixture.expenseNumber}`;
	const destination = `Payee ${fixture.expenseNumber}`;

	try {
		await signInThroughUi(page, fixture);
		await openExpenditureMonth(page, fixture.month);

		await expect(page.getByTestId('cash-paid-amount')).toHaveText('₹0.00');
		await page.getByTestId('cash-section-toggle').click();
		// The section lists recorded liabilities from every month, so a
		// concurrently running group fixture can legitimately add another
		// target. Scope every target assertion to this authored cost.
		const targetRow = page
			.getByTestId('cash-target-row')
			.filter({ hasText: fixture.expenseNumber });
		await expect(targetRow).toHaveCount(1);
		await expect(targetRow).toContainText('Unsettled');

		await page.getByTestId('cash-record-open').click();
		await page
			.getByTestId('cash-target-select')
			.selectOption(`cost:${fixture.costUid}`);
		await expect(page.getByTestId('cash-remaining-hint')).toContainText(
			'Remaining on this target: 20000.00'
		);
		await page.getByTestId('cash-amount-input').fill(String(SETTLEMENT_PAID));
		await page.getByTestId('cash-date-input').fill(settledOn);
		await page.getByTestId('cash-reference-input').fill(reference);
		await page.getByTestId('cash-destination-input').fill(destination);
		await page.getByTestId('cash-record-button').click();

		await expect(page.getByTestId('cash-paid-amount')).toHaveText(
			SETTLEMENT_PAID_DISPLAY,
			{ timeout: 60_000 }
		);
		await expect(page.getByTestId('cash-record-open')).toBeVisible();
		await expect(targetRow).toContainText('Partial');
		await expect(targetRow).toContainText(
			`${SETTLEMENT_PAID_DISPLAY} of ${SETTLEMENT_COST_DISPLAY}`
		);
		await expect(page.getByTestId('cash-movement-row')).toContainText(
			reference
		);
		await expect(page.getByTestId('cash-movement-row')).toContainText(
			destination
		);

		const settlements = await readFinancialSettlementsForCost(
			db,
			fixture.costUid
		);
		expect(settlements).toHaveLength(1);
		expect(settlements[0]).toMatchObject({
			targetKind: 'cost',
			targetCostUid: fixture.costUid,
			amount: SETTLEMENT_PAID,
			currency: 'INR',
			settledOn,
			reference,
			destination,
			status: 'recorded',
			financialVersion: 1,
			createdBy: fixture.userId,
		});
		const events = await readSettlementEvents(db, settlements[0].settlementUid);
		expect(events).toEqual([
			{
				settlementUid: settlements[0].settlementUid,
				version: 1,
				command: 'recorded',
				actorUserId: fixture.userId,
			},
		]);

		const cost = await readFinancialExpense(db, fixture.costUid);
		expect(cost).toMatchObject({
			recognizedAmount: SETTLEMENT_COST,
			totalAmount: SETTLEMENT_COST,
			state: 'recognized',
			financialVersion: 1,
		});

		await page.reload();
		await expect(page.getByTestId('decision-view')).toHaveAttribute(
			'data-month',
			fixture.month,
			{ timeout: 60_000 }
		);
		await expect(page.getByTestId('kpi-confirmed-cost')).toHaveText(
			SETTLEMENT_COST_DISPLAY
		);
		await expect(page.getByTestId('cash-paid-amount')).toHaveText(
			SETTLEMENT_PAID_DISPLAY
		);
		await page.getByTestId('cash-section-toggle').click();
		await expect(page.getByTestId('cash-movement-row')).toContainText(
			reference
		);
		await expect(targetRow).toContainText(
			`${SETTLEMENT_PAID_DISPLAY} of ${SETTLEMENT_COST_DISPLAY}`
		);
	} finally {
		await fixture.dispose();
	}
});

/**
 * Actor: an ordinary signed-in employee with exactly `reports:read`,
 * `other_expenses:read`, and `payroll:read` — export is a read, so no update
 * grant is requested.
 *
 * Starting state: one reserved historic month (2015-08) already closed with a
 * frozen Company Incurred Cost of ₹34,567.89, one recognized INR Company
 * Overhead cost of that amount, and one recorded ₹12,345.67 settlement.
 *
 * Action: open the expenditure report, choose August 2015 in the Month
 * control, and use Export Excel.
 *
 * Proof: the downloaded workbook is `Company_Expenditure_2015-08.xlsx` with
 * the five authored sheets; Company Reconciliation states the month and the
 * confirmed ₹34,567.89; Cash Paid states the ₹12,345.67 paid, one movement, and
 * the target's remaining ₹22,222.22; Revisions & Close states Closed, the
 * seeded close UID, and the frozen ₹34,567.89.
 */
test('Excel evidence export carries the chosen closed month across its sheets', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	const fixture = await seedFinancialMonth(db, namespace, {
		month: FINANCIAL_EXPORT_MONTH,
		amount: EXPORT_COST,
		writeAccess: false,
		closed: true,
		seededSettlement: {
			amount: EXPORT_SETTLEMENT,
			settledOn: `${FINANCIAL_EXPORT_MONTH}-16`,
			reference: `EXPORT-REF-${namespace}`,
			destination: `Export Payee ${namespace}`,
		},
	});

	try {
		await signInThroughUi(page, fixture);
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/reports/company-monthly-cost');
		await expect(page.getByTestId('decision-view')).toBeVisible({
			timeout: 60_000,
		});

		await page.getByLabel('Month', { exact: true }).selectOption(fixture.month);
		await expect(page.getByTestId('decision-view')).toHaveAttribute(
			'data-month',
			fixture.month,
			{ timeout: 60_000 }
		);
		await expect(page.getByTestId('kpi-confirmed-cost')).toHaveText(
			EXPORT_COST_DISPLAY
		);

		const downloadPromise = page.waitForEvent('download');
		await page.getByTestId('expenditure-export-button').click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe(
			`Company_Expenditure_${fixture.month}.xlsx`
		);
		const filePath = await download.path();
		if (!filePath) {
			throw new Error(
				'[expenditure-evidence] the browser download produced no file'
			);
		}
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.readFile(filePath);

		expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
			'Company Reconciliation',
			'Project Detail',
			'Budgets & Commitments',
			'Cash Paid',
			'Revisions & Close',
		]);

		const reconciliation = workbook.getWorksheet('Company Reconciliation');
		const cashPaid = workbook.getWorksheet('Cash Paid');
		const closeSheet = workbook.getWorksheet('Revisions & Close');
		if (!reconciliation || !cashPaid || !closeSheet) {
			throw new Error(
				'[expenditure-evidence] the workbook is missing an authored sheet'
			);
		}

		const monthRow = findRow(
			reconciliation,
			1,
			(value) => value === 'Reporting Month'
		);
		expect(cellValue(reconciliation, monthRow, 2)).toBe('August 2015');
		const reconStatusRow = findRow(
			reconciliation,
			1,
			(value) => value === 'Financial Close Status'
		);
		expect(cellValue(reconciliation, reconStatusRow, 2)).toBe('Closed');
		const incurredRow = findRow(
			reconciliation,
			1,
			(value) => value === 'Company Incurred Cost'
		);
		expect(cellValue(reconciliation, incurredRow, 2)).toBe(EXPORT_COST);
		expect(cellValue(reconciliation, incurredRow, 3)).toBe('INR');

		const paidCurrencyRow = findRow(cashPaid, 1, (value) => value === 'INR');
		expect(cellValue(cashPaid, paidCurrencyRow, 2)).toBe(EXPORT_SETTLEMENT);
		expect(cellValue(cashPaid, paidCurrencyRow, 3)).toBe(EXPORT_SETTLEMENT);
		expect(cellValue(cashPaid, paidCurrencyRow, 4)).toBe(0);
		expect(cellValue(cashPaid, paidCurrencyRow, 5)).toBe(0);
		expect(cellValue(cashPaid, paidCurrencyRow, 6)).toBe(1);

		const targetRow = findRow(
			cashPaid,
			2,
			(value) => value === fixture.expenseNumber
		);
		expect(cellValue(cashPaid, targetRow, 1)).toBe('cost');
		expect(cellValue(cashPaid, targetRow, 3)).toBe('operating');
		expect(cellValue(cashPaid, targetRow, 4)).toBe('INR');
		expect(cellValue(cashPaid, targetRow, 5)).toBe(EXPORT_COST);
		expect(cellValue(cashPaid, targetRow, 6)).toBe(EXPORT_SETTLEMENT);
		expect(cellValue(cashPaid, targetRow, 7)).toBe(EXPORT_SETTLEMENT);
		expect(cellValue(cashPaid, targetRow, 8)).toBe(EXPORT_REMAINING);
		expect(cellValue(cashPaid, targetRow, 9)).toBe('partial');

		const closeStatusRow = findRow(
			closeSheet,
			1,
			(value) => value === 'Close Status'
		);
		expect(cellValue(closeSheet, closeStatusRow, 2)).toBe('Closed');
		const closeUidRow = findRow(
			closeSheet,
			1,
			(value) => value === 'Close Snapshot UID'
		);
		expect(cellValue(closeSheet, closeUidRow, 2)).toBe(fixture.closeUid);
		const frozenRow = findRow(
			closeSheet,
			1,
			(value) => value === 'Frozen Incurred Cost (Snapshot)'
		);
		expect(cellValue(closeSheet, frozenRow, 2)).toBe(String(EXPORT_COST));
		const frozenCurrencyRow = findRow(
			closeSheet,
			1,
			(value) => value === 'Frozen Snapshot Currency'
		);
		expect(cellValue(closeSheet, frozenCurrencyRow, 2)).toBe('INR');
		expect(
			findRow(
				closeSheet,
				1,
				(value) => value === 'No financial revisions recorded for this month.'
			)
		).toBeGreaterThan(0);
	} finally {
		await fixture.dispose();
	}
});
