import type { Page } from '@playwright/test';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import {
	cleanupSalesRegisterFixture,
	seedSalesRegisterFixture,
	type SalesRegisterFixture,
} from '../fixtures/report-data.ts';

// The owned Next dev server compiles the report and drill-down routes on first
// visit. Assertions keep their own timeouts; this only bounds compilation.
test.setTimeout(180_000);

/**
 * `reports:read` opens the register. `other_expenses:read` is the minimum
 * non-role grant the /admin shell admits for the invoice drill-down; it opens
 * no report data of its own.
 */
const SALES_REGISTER_PERMISSIONS = [
	'reports:read',
	'other_expenses:read',
] as const;
/** The receipt page's API gate is `admin:read`; the shell still needs its read. */
const SALES_RECEIPT_PERMISSIONS = [
	'reports:read',
	'other_expenses:read',
	'admin:read',
] as const;

let identity: JourneyUser | null = null;
let fixture: SalesRegisterFixture | null = null;

test.afterEach(async ({ db }) => {
	const ownedFixture = fixture;
	const ownedIdentity = identity;
	fixture = null;
	identity = null;
	try {
		if (ownedFixture !== null) {
			await cleanupSalesRegisterFixture(db, ownedFixture);
		}
	} finally {
		if (ownedIdentity !== null) await ownedIdentity.dispose();
	}
});

/**
 * Open Outstanding Balances and wait for the customer-narrowed response before
 * asserting the table. The page's search sends `search`; it does not send the
 * API's separate `company_id` filter.
 */
async function openCustomerRegister(
	page: Page,
	customerName: string
): Promise<void> {
	await page.goto('/reports/sales-register');
	await expect(
		page.getByRole('heading', { name: 'Outstanding Balances', exact: true })
	).toBeVisible({ timeout: 60_000 });
	const filtered = page.waitForResponse(
		(response) => {
			if (response.request().method() !== 'GET') return false;
			const url = new URL(response.url());
			return (
				url.pathname === '/api/reports/sales-register' &&
				url.searchParams.get('search') === customerName
			);
		},
		{ timeout: 60_000 }
	);
	await page
		.getByPlaceholder('Search company or invoice...')
		.fill(customerName);
	const response = await filtered;
	expect(response.ok()).toBe(true);
}

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `reports:read` and `other_expenses:read` (the /admin shell's permission
 * path), with no administrator role.
 *
 * Starting state: two owned customers. The chosen customer has two invoices
 * (₹10,000 gross / ₹11,800 with tax, with a ₹4,000 receipt; and ₹5,000 /
 * ₹5,900 with no payment) plus one unrelated invoice for the other customer.
 *
 * Action: open Outstanding Balances, search the chosen customer's exact name,
 * then open the chosen invoice's invoice number.
 *
 * Proof: only the chosen customer's two rows remain (the unrelated invoice is
 * absent); the chosen row shows ₹10,000.00 gross, ₹11,800.00 total,
 * ₹4,000.00 received and ₹7,800.00 net; the link opens
 * `/admin/invoice/edit/<owned id>` showing Edit Invoice, the same number and
 * the same client.
 */
test('sales register filters by customer and opens the chosen invoice', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(
		db,
		`${namespace}-sales-invoice`,
		SALES_REGISTER_PERMISSIONS
	);
	page.setDefaultNavigationTimeout(60_000);
	identity = user;
	const data = await seedSalesRegisterFixture(db, `${namespace}-sales-invoice`);
	fixture = data;

	await signInThroughUi(page, {
		username: user.username,
		password: user.password,
	});
	await openCustomerRegister(page, data.customerName);

	await expect(
		page.getByRole('row').filter({ hasText: data.customerName })
	).toHaveCount(2);
	await expect(
		page.getByRole('link', { name: data.invoices.other.number, exact: true })
	).toHaveCount(0);

	const chosenRow = page
		.getByRole('row')
		.filter({ hasText: data.invoices.chosen.number });
	await expect(chosenRow).toBeVisible();
	const cells = chosenRow.getByRole('cell');
	await expect(cells.nth(2)).toHaveText(data.customerName);
	await expect(cells.nth(3)).toHaveText(data.invoices.chosen.number);
	await expect(cells.nth(4)).toHaveText('₹10,000.00');
	await expect(cells.nth(8)).toHaveText('₹11,800.00');
	await expect(cells.nth(9)).toHaveText(data.receipt.number);
	await expect(cells.nth(10)).toHaveText('₹4,000.00');
	await expect(cells.nth(13)).toHaveText('₹7,800.00');

	await chosenRow
		.getByRole('link', { name: data.invoices.chosen.number, exact: true })
		.click();
	await expect(page).toHaveURL(
		new RegExp(`/admin/invoice/edit/${data.invoices.chosen.id}$`),
		{ timeout: 60_000 }
	);
	await expect(
		page.getByRole('heading', { name: 'Edit Invoice', exact: true })
	).toBeVisible({ timeout: 60_000 });
	await expect(page.locator('input[name="client_name"]')).toHaveValue(
		data.customerName
	);
	await expect(
		page.getByText(data.invoices.chosen.number, { exact: true }).first()
	).toBeVisible();
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `reports:read`, `other_expenses:read` and `admin:read` — the payment-entry
 * reader's own API gate plus the /admin shell permission, not an administrator
 * role or a super-admin.
 *
 * Starting state: the chosen customer's invoice carries a recorded receipt
 * entry for ₹4,000 dated 2033-04-20.
 *
 * Action: open Outstanding Balances, search the customer, then open the
 * receipt number in the chosen row.
 *
 * Proof: the browser lands on `/admin/payment-entry?search=<receipt>` with the
 * search box holding the receipt number and one row showing the same customer,
 * receipt and ₹4,000.00 amount.
 */
test('sales register customer receipt opens the matching payment entry', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(
		db,
		`${namespace}-sales-receipt`,
		SALES_RECEIPT_PERMISSIONS
	);
	page.setDefaultNavigationTimeout(60_000);
	identity = user;
	const data = await seedSalesRegisterFixture(db, `${namespace}-sales-receipt`);
	fixture = data;

	await signInThroughUi(page, {
		username: user.username,
		password: user.password,
	});
	await openCustomerRegister(page, data.customerName);

	const chosenRow = page
		.getByRole('row')
		.filter({ hasText: data.invoices.chosen.number });
	await expect(chosenRow).toBeVisible();
	const receiptNavigation = page.waitForURL(
		(url) =>
			url.pathname === '/admin/payment-entry' &&
			url.searchParams.get('search') === data.receipt.number,
		{ timeout: 60_000 }
	);
	await chosenRow
		.getByRole('link', { name: data.receipt.number, exact: true })
		.click();
	await receiptNavigation;

	await expect(
		page.getByRole('heading', {
			name: 'Payment Received from client',
			exact: true,
		})
	).toBeVisible({ timeout: 60_000 });
	await expect(
		page.getByPlaceholder(/Search company, receipt, transaction/)
	).toHaveValue(data.receipt.number);

	const receiptRow = page
		.getByRole('row')
		.filter({ hasText: data.receipt.number });
	await expect(receiptRow).toBeVisible();
	await expect(receiptRow).toContainText(data.customerName);
	await expect(receiptRow).toContainText('₹4,000.00');
});
