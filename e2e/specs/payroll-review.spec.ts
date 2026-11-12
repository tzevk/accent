import { test, expect } from '../support/test.ts';
import type { Response } from '@playwright/test';
import { signInThroughUi } from '../support/auth.ts';
import {
	cleanupPayrollReviewFixture,
	readPayrollReviewState,
	seedPayrollReviewFixture,
	type PayrollReviewFixture,
} from '../fixtures/payroll-review.ts';
import {
	expectFrozenIdentityAtFinancialEnd,
	expectProjectionMatchesFixture,
	expectSlipDocument,
	expectStoredStateMatchesFixture,
	guardPayrollWrites,
	payrollColumnIndexes,
	type PayrollProjectionPayload,
} from '../support/payroll-review-journey.ts';

/** Only the contract sentinels this journey reads, never the full catalog. */
const REVIEW_COLUMNS = [
	'Employee Code',
	'Full Name',
	'Total Days',
	'Days Present',
	'GROSS',
	'TOTAL DED',
	'NET SAL',
] as const;

let fixture: PayrollReviewFixture | null = null;

// The owned Next dev server compiles routes on first visit; assertions are not
// weakened, only the surrounding wall-clock budget accommodates that compile.
test.setTimeout(120_000);

test.afterEach(async ({ db }) => {
	if (fixture === null) return;
	const owned = fixture;
	fixture = null;
	await cleanupPayrollReviewFixture(db, owned);
});

test('payroll review separates current attendance from recorded money', async ({
	page,
	db,
	namespace,
}) => {
	fixture = await seedPayrollReviewFixture(db, namespace);
	const review = fixture;
	// The hook owns the payroll-only reference the ordinary admin reuses.
	expect(review.admin.roleOwned).toBe(false);

	const before = await readPayrollReviewState(db, review);
	expectStoredStateMatchesFixture(before, review);

	await signInThroughUi(page, {
		username: review.admin.username,
		password: review.admin.password,
	});
	const payrollWrites = guardPayrollWrites(page);

	const isCompanySheetProjection = (response: Response) => {
		if (response.request().method() !== 'GET') return false;
		const url = new URL(response.url());
		return (
			url.pathname === '/api/payroll/slips' &&
			url.searchParams.get('include') === 'company-sheet'
		);
	};
	const initialProjection = page.waitForResponse(isCompanySheetProjection);
	const projectionResponse = page.waitForResponse(
		(response) =>
			isCompanySheetProjection(response) &&
			new URL(response.url()).searchParams.get('month') === review.month
	);
	await page.goto('/admin/payroll');
	// The first query response proves the client is hydrated before the month changes.
	await initialProjection;
	const monthInput = page.getByLabel('Month:', { exact: true });
	await expect(monthInput).toBeVisible();
	await monthInput.fill(review.monthSlug);
	await expect(monthInput).toHaveValue(review.monthSlug);
	await expect(
		page
			.getByRole('group', { name: 'Employee Type' })
			.getByRole('button', { name: 'Payroll', exact: true })
	).toHaveAttribute('aria-pressed', 'true');

	const response = await projectionResponse;
	expect(response.ok()).toBe(true);
	expectProjectionMatchesFixture(
		(await response.json()) as PayrollProjectionPayload,
		review
	);

	const sheet = page.getByRole('region', { name: 'Company payroll sheet' });
	await expect(sheet).toBeVisible();
	await expect(
		page.getByText(
			'Attendance is current evidence; amounts are the generated Payroll Slip.',
			{ exact: true }
		)
	).toBeVisible();
	const nameLink = sheet.getByRole('link', {
		name: review.employee.fullName,
		exact: true,
	});
	await expect(nameLink).toBeVisible();
	const employeeRow = sheet
		.getByRole('row')
		.filter({ hasText: review.employee.fullName });
	const indexes = await payrollColumnIndexes(sheet, REVIEW_COLUMNS);
	const cells = employeeRow.getByRole('cell');
	await expect(cells.nth(indexes['Total Days'])).toHaveText('31.00');
	await expect(cells.nth(indexes['Days Present'])).toHaveText('5.50');
	await expect(cells.nth(indexes['GROSS'])).toHaveText('₹44,000.00');
	await expect(cells.nth(indexes['TOTAL DED'])).toHaveText('₹5,275.00');
	await expect(cells.nth(indexes['NET SAL'])).toHaveText('₹38,725.00');

	await page
		.getByRole('button', {
			name: `Expand attendance and deduction details for ${review.employee.fullName}`,
		})
		.click();
	const details = page.getByRole('region', {
		name: 'Current attendance — generated payroll amounts are unchanged',
	});
	await expect(details).toBeVisible();
	await expect(
		details.getByRole('heading', {
			name: 'Current attendance — generated payroll amounts are unchanged',
			exact: true,
		})
	).toBeVisible();
	await expect(
		details.getByRole('heading', {
			name: 'Monthly attendance categories',
			exact: true,
		})
	).toBeVisible();
	await expect(details).toContainText('Outside Employment 20.00');
	await expect(details).toContainText('Unpaid leave 2.50');
	await expect(
		details
			.getByText('MLWF (labour welfare)', { exact: true })
			.locator('xpath=..')
	).toContainText('₹25.00');
	await expect(
		details
			.getByText('Other deductions (combined)', { exact: true })
			.locator('xpath=..')
	).toContainText('₹1,250.00');

	await expectFrozenIdentityAtFinancialEnd(
		sheet,
		employeeRow,
		indexes,
		'₹38,725.00'
	);

	await nameLink.click();
	await expectSlipDocument(page, review);

	const after = await readPayrollReviewState(db, review);
	expect(after).toEqual(before);
	expect(payrollWrites.violations).toEqual([]);
});
