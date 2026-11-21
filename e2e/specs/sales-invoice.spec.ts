import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import {
	CREATED_INVOICE_AMOUNTS,
	CREATED_INVOICE_DATE,
	CREATED_INVOICE_DESCRIPTION,
	CREATED_INVOICE_DUE_DATE,
	CREATED_INVOICE_GROSS_DISPLAY,
	CREATED_INVOICE_NET_DISPLAY,
	CREATED_INVOICE_TAX_DISPLAY,
	SEEDED_INVOICE_AMOUNTS,
	SEEDED_INVOICE_DATE,
	SEEDED_INVOICE_DUE_DATE,
	SEEDED_INVOICE_GROSS_DISPLAY,
	SEEDED_INVOICE_NET_DISPLAY,
	SEEDED_INVOICE_TAX_DISPLAY,
	cleanupSalesCompany,
	cleanupSeededInvoice,
	cleanupUiCreatedInvoice,
	countInvoicesForClient,
	readInvoiceById,
	seedClientInvoice,
	seedSalesCompany,
} from '../fixtures/sales-workflows.ts';

/**
 * The invoice list and create/edit pages live under `/admin`, whose shell
 * admits a non-admin identity holding `other_expenses:read` (ADR-0022).
 * Listing needs `invoices:read`, saving needs `invoices:create`, and the real
 * company picker needs `companies:read`. No administrator or super admin.
 */
const INVOICE_CREATE_PERMISSIONS = [
	'invoices:read',
	'invoices:create',
	'companies:read',
	'other_expenses:read',
] as const;

/**
 * The sales register (page title "Outstanding Balances") needs `reports:read`.
 * Following its invoice link lands in `/admin`, so the same shell needs
 * `other_expenses:read`; the invoice detail GET itself is authentication-only.
 */
const REGISTER_LINK_PERMISSIONS = [
	'reports:read',
	'other_expenses:read',
] as const;

interface CreateInvoiceResponse {
	success: boolean;
	data?: {
		id?: number;
		invoice_number?: string;
	};
}

// The owned Next dev server compiles the create/edit routes on first visit;
// the assertions are not weakened, only the wall-clock budget accommodates it.
test.setTimeout(180_000);

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `invoices:read`, `invoices:create`, `companies:read` and
 * `other_expenses:read` — no administrator, no super admin.
 *
 * Starting state: one owned company in Maharashtra (state code 27) and no
 * active invoice for that unique client name.
 *
 * Action: open Create Invoice from the Sale Invoices register, pick the owned
 * company, let the server allocate the invoice number, author one ₹30,000 line
 * on a 5 Nov 2026 invoice, save, find the row by its allocated number, then
 * reopen it through the row's Edit Invoice action.
 *
 * Proof: the reopened Edit Invoice page shows the stored number, client, date
 * and the fixed ₹30,000.00 gross / ₹5,400.00 GST / ₹35,400.00 net; an
 * independent MySQL read of the captured invoice id matches those columns,
 * the 9% + 9% CGST/SGST split and the one-line JSON.
 */
test('a fixed-tax client invoice saves and reopens from the sale invoice register', async ({
	page,
	db,
	namespace,
}) => {
	const flow = `${namespace}-invoice`;
	const company = await seedSalesCompany(db, flow);
	let user: JourneyUser | null = null;
	let invoiceId: number | null = null;

	try {
		expect(await countInvoicesForClient(db, company.companyName)).toBe(0);
		const actor = await createJourneyUser(
			db,
			`${flow}-actor`,
			INVOICE_CREATE_PERMISSIONS
		);
		user = actor;

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, actor);

		await page.goto('/admin/invoice');
		await expect(
			page.getByRole('heading', { name: 'Sale Invoices', exact: true })
		).toBeVisible({ timeout: 60_000 });
		await page
			.getByRole('button', { name: 'Create Invoice', exact: true })
			.click();
		await page.waitForURL(/\/admin\/invoice\/create$/, { timeout: 60_000 });
		await expect(
			page.getByRole('heading', { name: 'Create Invoice', exact: true })
		).toBeVisible({ timeout: 60_000 });

		// The page prefetches a number outside the create transaction. Clearing
		// it makes the POST allocate under the route's row lock, so parallel
		// journeys cannot collide on a number fetched before another insert.
		const numberInput = page.getByPlaceholder('ATS/I/MAY-26/001', {
			exact: true,
		});
		await expect(numberInput).not.toHaveValue('', { timeout: 60_000 });
		await numberInput.fill('');

		const invoiceDateInput = page.locator('input[name="invoice_date"]');
		await invoiceDateInput.fill(CREATED_INVOICE_DATE);
		await expect(invoiceDateInput).toHaveValue(CREATED_INVOICE_DATE);
		await expect(page.locator('input[name="due_date"]')).toHaveValue(
			CREATED_INVOICE_DUE_DATE
		);

		const clientInput = page.getByPlaceholder('Client Name', { exact: true });
		await clientInput.fill(company.companyName);
		const companyOption = page
			.getByRole('button')
			.filter({ hasText: company.companyName });
		await expect(companyOption).toHaveCount(1);
		await companyOption.click();
		await expect(clientInput).toHaveValue(company.companyName);
		await expect(page.locator('input[name="client_state_code"]')).toHaveValue(
			company.stateCode
		);
		await expect(page.locator('select[name="gst_type"]')).toHaveValue(
			'cgst_sgst'
		);

		const lineRow = page.getByRole('row').filter({
			has: page.getByPlaceholder('Description of service'),
		});
		await expect(lineRow).toHaveCount(1);
		await lineRow
			.getByPlaceholder('Description of service')
			.fill(CREATED_INVOICE_DESCRIPTION);
		await lineRow
			.getByPlaceholder('0.00', { exact: true })
			.fill(String(CREATED_INVOICE_AMOUNTS.gross));

		const totalRow = (label: string) =>
			page.getByText(label, { exact: true }).locator('..');
		await expect(totalRow('Total Amount Before Tax >>')).toContainText(
			CREATED_INVOICE_GROSS_DISPLAY
		);
		await expect(totalRow('Add : CGST @ 9% >>')).toContainText('₹2,700.00');
		await expect(totalRow('Add : SGST @ 9% >>')).toContainText('₹2,700.00');
		await expect(totalRow('Total Amount : GST >>')).toContainText(
			CREATED_INVOICE_TAX_DISPLAY
		);
		await expect(totalRow('Total Amount After Tax >>')).toContainText(
			CREATED_INVOICE_NET_DISPLAY
		);

		// A late StrictMode number fetch must not silently replace the blank
		// field before the POST; re-clear it at the point of action.
		await numberInput.fill('');
		await expect(numberInput).toHaveValue('');

		const createResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/admin/invoices'
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByRole('button', { name: 'Save Invoice', exact: true })
			.click();
		const created = await createResponse;
		expect(created.ok()).toBe(true);
		const createdBody = (await created.json()) as CreateInvoiceResponse;
		expect(createdBody.success).toBe(true);
		const createdId = createdBody.data?.id;
		if (typeof createdId !== 'number' || !Number.isInteger(createdId)) {
			throw new Error('[sales-invoice] the create response has no id');
		}
		invoiceId = createdId;
		expect(invoiceId).toBeGreaterThan(0);
		const invoiceNumber = createdBody.data?.invoice_number;
		expect(invoiceNumber).toMatch(/^ATS\/I\/[A-Z]{3}-\d{2}\/\d{3,}$/);
		if (!invoiceNumber) {
			throw new Error('[sales-invoice] the create response has no number');
		}
		await page.waitForURL(/\/admin\/invoice$/, { timeout: 60_000 });

		const stored = await readInvoiceById(db, invoiceId);
		expect(stored.invoiceNumber).toBe(invoiceNumber);
		expect(stored.invoiceDate).toBe(CREATED_INVOICE_DATE);
		expect(stored.dueDate).toBe(CREATED_INVOICE_DUE_DATE);
		expect(stored.clientName).toBe(company.companyName);
		expect(stored.clientStateCode).toBe(company.stateCode);
		expect(stored.status).toBe('draft');
		expect(stored.isDelete).toBe(0);
		expect(stored.gstType).toBe('cgst_sgst');
		expect(Number(stored.taxRate)).toBe(18);
		expect(Number(stored.cgstRate)).toBe(9);
		expect(Number(stored.sgstRate)).toBe(9);
		expect(Number(stored.subtotal)).toBe(CREATED_INVOICE_AMOUNTS.gross);
		expect(Number(stored.grossAmount)).toBe(CREATED_INVOICE_AMOUNTS.gross);
		expect(Number(stored.taxAmount)).toBe(CREATED_INVOICE_AMOUNTS.tax);
		expect(Number(stored.total)).toBe(CREATED_INVOICE_AMOUNTS.net);
		expect(Number(stored.netAmount)).toBe(CREATED_INVOICE_AMOUNTS.net);
		expect(Number(stored.amountPaid)).toBe(0);
		expect(Number(stored.balanceDue)).toBe(CREATED_INVOICE_AMOUNTS.net);
		expect(stored.items).toEqual([]);
		expect(Array.isArray(stored.lineItems)).toBe(true);
		const lineItems = stored.lineItems as Array<Record<string, unknown>>;
		expect(lineItems).toHaveLength(1);
		expect(String(lineItems[0].description)).toBe(CREATED_INVOICE_DESCRIPTION);
		expect(Number(lineItems[0].amount)).toBe(CREATED_INVOICE_AMOUNTS.gross);

		const listResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/admin/invoices' &&
					url.searchParams.get('search') === invoiceNumber
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByPlaceholder('Search invoices...', { exact: true })
			.fill(invoiceNumber);
		expect((await listResponse).ok()).toBe(true);

		const row = page.getByRole('row').filter({ hasText: invoiceNumber });
		await expect(row).toHaveCount(1);
		await expect(row.getByRole('cell').nth(0)).toHaveText(invoiceNumber);
		await expect(row.getByRole('cell').nth(1)).toContainText(
			company.companyName
		);
		await expect(row.getByRole('cell').nth(2)).toHaveText(
			CREATED_INVOICE_GROSS_DISPLAY
		);
		await expect(row.getByRole('cell').nth(3)).toHaveText(
			CREATED_INVOICE_TAX_DISPLAY
		);
		await expect(row.getByRole('cell').nth(4)).toHaveText(
			CREATED_INVOICE_NET_DISPLAY
		);

		const detailResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/invoices/${invoiceId}`
				);
			},
			{ timeout: 60_000 }
		);
		await row.getByTitle('Edit Invoice', { exact: true }).click();
		await page.waitForURL(
			(url) => url.pathname === `/admin/invoice/edit/${invoiceId}`,
			{ timeout: 60_000 }
		);
		expect((await detailResponse).ok()).toBe(true);

		await expect(
			page.getByRole('heading', { name: 'Edit Invoice', exact: true })
		).toBeVisible({ timeout: 60_000 });
		// Edit shows the allocated number as immutable text in the Invoice No.
		// row; only the create form exposes input[name="invoice_number"].
		await expect(
			page
				.getByText('Invoice No.', { exact: true })
				.locator('..')
				.getByText(invoiceNumber, { exact: true })
		).toBeVisible();
		await expect(page.locator('input[name="client_name"]')).toHaveValue(
			company.companyName
		);
		await expect(page.locator('input[name="invoice_date"]')).toHaveValue(
			CREATED_INVOICE_DATE
		);
		await expect(page.locator('input[name="due_date"]')).toHaveValue(
			CREATED_INVOICE_DUE_DATE
		);
		const reopenedTotalRow = (label: string) =>
			page.getByText(label, { exact: true }).locator('..');
		await expect(reopenedTotalRow('Total Amount Before Tax >>')).toContainText(
			CREATED_INVOICE_GROSS_DISPLAY
		);
		await expect(reopenedTotalRow('Total Amount : GST >>')).toContainText(
			CREATED_INVOICE_TAX_DISPLAY
		);
		await expect(reopenedTotalRow('Total Amount After Tax >>')).toContainText(
			CREATED_INVOICE_NET_DISPLAY
		);
	} finally {
		try {
			await cleanupUiCreatedInvoice(db, company.companyName, invoiceId);
		} finally {
			try {
				await cleanupSalesCompany(db, company);
			} finally {
				if (user !== null) await user.dispose();
			}
		}
	}
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `reports:read` and `other_expenses:read` — no invoices permission, no
 * administrator, no super admin.
 *
 * Starting state: one owned company with one seeded, sent ₹50,000 + ₹9,000 GST
 * invoice (₹59,000 net) in the 5 Nov 2026 period.
 *
 * Action: open the sales register (titled Outstanding Balances), search the
 * seeded invoice number, then follow its invoice-number link.
 *
 * Proof: the link opens the exact `/admin/invoice/edit/<seeded id>` document,
 * which shows the seeded number, client, date and ₹50,000.00 / ₹9,000.00 /
 * ₹59,000.00 totals; an independent MySQL read of that id matches.
 */
test('the client balance register invoice link opens the seeded invoice document', async ({
	page,
	db,
	namespace,
}) => {
	const flow = `${namespace}-outstanding`;
	const company = await seedSalesCompany(db, flow);
	const invoiceNumber = fitIdentifier(`${flow}-INV`, 50);
	const invoice = await seedClientInvoice(
		db,
		company,
		invoiceNumber,
		SEEDED_INVOICE_AMOUNTS
	);
	let user: JourneyUser | null = null;

	try {
		const before = await readInvoiceById(db, invoice.id);
		expect(before.invoiceNumber).toBe(invoiceNumber);
		expect(before.status).toBe('sent');
		expect(before.clientName).toBe(company.companyName);

		user = await createJourneyUser(
			db,
			`${flow}-actor`,
			REGISTER_LINK_PERMISSIONS
		);
		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, user);

		await page.goto('/reports/sales-register');
		await expect(
			page.getByRole('heading', {
				name: 'Outstanding Balances',
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });

		const searchResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/reports/sales-register' &&
					url.searchParams.get('search') === invoiceNumber
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByPlaceholder('Search company or invoice...', { exact: true })
			.fill(invoiceNumber);
		expect((await searchResponse).ok()).toBe(true);

		const row = page.getByRole('row').filter({ hasText: invoiceNumber });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(company.companyName);
		await expect(row).toContainText(SEEDED_INVOICE_GROSS_DISPLAY);
		await expect(row).toContainText(SEEDED_INVOICE_NET_DISPLAY);

		const invoiceLink = page.getByRole('link', {
			name: invoiceNumber,
			exact: true,
		});
		await expect(invoiceLink).toHaveAttribute(
			'href',
			`/admin/invoice/edit/${invoice.id}`
		);

		const detailResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/invoices/${invoice.id}`
				);
			},
			{ timeout: 60_000 }
		);
		await invoiceLink.click();
		await page.waitForURL(
			(url) => url.pathname === `/admin/invoice/edit/${invoice.id}`,
			{ timeout: 60_000 }
		);
		expect((await detailResponse).ok()).toBe(true);

		await expect(
			page.getByRole('heading', { name: 'Edit Invoice', exact: true })
		).toBeVisible({ timeout: 60_000 });
		// Edit shows the allocated number as immutable text in the Invoice No.
		// row; only the create form exposes input[name="invoice_number"].
		await expect(
			page
				.getByText('Invoice No.', { exact: true })
				.locator('..')
				.getByText(invoiceNumber, { exact: true })
		).toBeVisible();
		await expect(page.locator('input[name="client_name"]')).toHaveValue(
			company.companyName
		);
		await expect(page.locator('input[name="invoice_date"]')).toHaveValue(
			SEEDED_INVOICE_DATE
		);
		await expect(page.locator('input[name="due_date"]')).toHaveValue(
			SEEDED_INVOICE_DUE_DATE
		);
		const totalRow = (label: string) =>
			page.getByText(label, { exact: true }).locator('..');
		await expect(totalRow('Total Amount Before Tax >>')).toContainText(
			SEEDED_INVOICE_GROSS_DISPLAY
		);
		await expect(totalRow('Total Amount : GST >>')).toContainText(
			SEEDED_INVOICE_TAX_DISPLAY
		);
		await expect(totalRow('Total Amount After Tax >>')).toContainText(
			SEEDED_INVOICE_NET_DISPLAY
		);

		const stored = await readInvoiceById(db, invoice.id);
		expect(stored.invoiceNumber).toBe(invoiceNumber);
		expect(stored.clientName).toBe(company.companyName);
		expect(stored.invoiceDate).toBe(SEEDED_INVOICE_DATE);
		expect(stored.dueDate).toBe(SEEDED_INVOICE_DUE_DATE);
		expect(stored.status).toBe('sent');
		expect(stored.isDelete).toBe(0);
		expect(Number(stored.grossAmount)).toBe(SEEDED_INVOICE_AMOUNTS.gross);
		expect(Number(stored.taxAmount)).toBe(SEEDED_INVOICE_AMOUNTS.tax);
		expect(Number(stored.netAmount)).toBe(SEEDED_INVOICE_AMOUNTS.net);
	} finally {
		try {
			await cleanupSeededInvoice(db, invoice.id, invoice.invoiceNumber);
		} finally {
			try {
				await cleanupSalesCompany(db, company);
			} finally {
				if (user !== null) await user.dispose();
			}
		}
	}
});
