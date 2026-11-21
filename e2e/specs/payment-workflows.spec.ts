import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import {
	NET_BALANCE_AFTER_RECEIPT_DISPLAY,
	PAYMENT_ISSUE_AMOUNT,
	PAYMENT_ISSUE_AMOUNT_DISPLAY,
	PAYMENT_ISSUE_DATE,
	PAYMENT_ISSUE_DATE_DISPLAY,
	PAYMENT_ISSUE_DEDUCTION,
	PAYMENT_ISSUE_DEDUCTION_DISPLAY,
	PAYMENT_ISSUE_NET,
	PAYMENT_ISSUE_NET_DISPLAY,
	RECEIPT_AMOUNT,
	RECEIPT_AMOUNT_DISPLAY,
	RECEIPT_DATE,
	SEEDED_INVOICE_AMOUNTS,
	SEEDED_INVOICE_NET_DISPLAY,
	cleanupPaymentEntry,
	cleanupPaymentIssue,
	cleanupSalesCompany,
	cleanupSeededInvoice,
	countPaymentEntriesForInvoice,
	readPaymentEntryById,
	readPaymentIssueById,
	seedClientInvoice,
	seedSalesCompany,
} from '../fixtures/sales-workflows.ts';

/**
 * The payment registers live under `/admin`, whose shell admits a non-admin
 * identity holding `other_expenses:read` (ADR-0022). Listing needs
 * `admin:read`, saving needs `admin:create`, the invoice picker needs
 * `invoices:read`, the company picker needs `companies:read`, and the client
 * balance detail needs `reports:read`. No administrator or super admin.
 */
const RECEIPT_PERMISSIONS = [
	'reports:read',
	'admin:read',
	'admin:create',
	'invoices:read',
	'companies:read',
	'other_expenses:read',
] as const;

/**
 * The payment-issue register lists with `admin:read`, saves with
 * `admin:create`, and its payee picker also uses `admin:read`. The `/admin`
 * shell additionally needs `other_expenses:read`.
 */
const PAYMENT_ISSUE_PERMISSIONS = [
	'admin:read',
	'admin:create',
	'other_expenses:read',
] as const;

interface CreatePaymentEntryResponse {
	success: boolean;
	data?: { id?: string };
}

interface CreatePaymentIssueResponse {
	success: boolean;
	id?: number;
}

// The owned Next dev server compiles the payment routes on first visit; the
// assertions are not weakened, only the wall-clock budget accommodates it.
test.setTimeout(180_000);

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `reports:read`, `admin:read`, `admin:create`, `invoices:read`,
 * `companies:read` and `other_expenses:read` — no super admin.
 *
 * Starting state: one owned company with one seeded ₹59,000 invoice and no
 * active receipt against that invoice number; the client balance shows
 * Received ₹0.00 and Net Balance ₹59,000.00.
 *
 * Action: record a ₹20,000 part receipt through the real Payment Received
 * form, selecting that company and invoice and keeping the form's computed
 * net amount, then reopen the client balance detail.
 *
 * Proof: the fresh client balance shows Received ₹20,000.00 and Net Balance
 * ₹39,000.00, lists the receipt against the invoice, and an independent MySQL
 * read shows the stored receipt (company, invoice, amount/net, dates,
 * transaction id, creator).
 */
test('a receipt against the seeded invoice reduces the client balance', async ({
	page,
	db,
	namespace,
}) => {
	const flow = `${namespace}-receipt`;
	const company = await seedSalesCompany(db, flow);
	const invoiceNumber = fitIdentifier(`${flow}-INV`, 50);
	const invoice = await seedClientInvoice(
		db,
		company,
		invoiceNumber,
		SEEDED_INVOICE_AMOUNTS
	);
	const transactionId = fitIdentifier(`${flow}-TXN`, 100);
	let user: JourneyUser | null = null;
	let paymentEntryId: string | null = null;

	try {
		expect(await countPaymentEntriesForInvoice(db, invoiceNumber)).toBe(0);
		const actor = await createJourneyUser(
			db,
			`${flow}-actor`,
			RECEIPT_PERMISSIONS
		);
		user = actor;

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, actor);

		const clientPath = `/reports/client-balance/${encodeURIComponent(
			company.companyName
		)}`;
		await page.goto(clientPath);
		await expect(
			page.getByRole('heading', {
				name: company.companyName,
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });
		const summaryCard = (label: string) =>
			page.getByText(label, { exact: true }).locator('../..');
		await expect(summaryCard('Received')).toContainText('₹0.00');
		await expect(summaryCard('Net Balance')).toContainText(
			SEEDED_INVOICE_NET_DISPLAY
		);

		await page.goto('/admin/payment-entry');
		await expect(
			page.getByRole('heading', {
				name: 'Payment Received from client',
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });
		await page
			.getByRole('button', {
				name: 'Add Payment Received from client',
				exact: true,
			})
			.click();
		const dialog = page.getByRole('dialog', {
			name: 'New Payment Received from client',
			exact: true,
		});
		await expect(dialog).toBeVisible({ timeout: 60_000 });

		await dialog
			.getByRole('button', { name: 'Company Name', exact: true })
			.click();
		await page
			.getByPlaceholder('Search...', { exact: true })
			.fill(company.companyName);
		const companyOption = page
			.getByRole('button')
			.filter({ hasText: company.companyName });
		await expect(companyOption).toHaveCount(1);
		await companyOption.click();
		await expect(
			dialog.getByRole('button', { name: 'Company Name', exact: true })
		).toContainText(company.companyName);

		await dialog
			.getByRole('button', { name: 'Invoice No', exact: true })
			.click();
		await page
			.getByPlaceholder('Search...', { exact: true })
			.fill(invoiceNumber);
		const invoiceOption = page
			.getByRole('button')
			.filter({ hasText: invoiceNumber });
		await expect(invoiceOption).toHaveCount(1);
		await invoiceOption.click();
		await expect(
			dialog.getByRole('button', { name: 'Invoice No', exact: true })
		).toContainText(invoiceNumber);
		await expect(
			dialog.getByLabel('Invoice Amount', { exact: true })
		).toHaveValue(SEEDED_INVOICE_AMOUNTS.gross.toFixed(2));

		await dialog.getByLabel('Receipt Date', { exact: true }).fill(RECEIPT_DATE);
		await dialog
			.getByLabel('Amount', { exact: true })
			.fill(String(RECEIPT_AMOUNT));
		await expect(dialog.getByLabel('Net Amount', { exact: true })).toHaveValue(
			String(RECEIPT_AMOUNT)
		);
		await dialog.getByLabel('Payment Date', { exact: true }).fill(RECEIPT_DATE);
		await dialog
			.getByLabel('Transaction ID', { exact: true })
			.fill(transactionId);
		await dialog
			.getByLabel('Payment Type', { exact: true })
			.selectOption('partial');

		const createResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/admin/payment-entries'
				);
			},
			{ timeout: 60_000 }
		);
		await dialog
			.getByRole('button', {
				name: 'Create Payment Received from client',
				exact: true,
			})
			.click();
		const created = await createResponse;
		expect(created.ok()).toBe(true);
		const createdBody = (await created.json()) as CreatePaymentEntryResponse;
		expect(createdBody.success).toBe(true);
		const createdEntryId = createdBody.data?.id;
		if (!createdEntryId) {
			throw new Error('[payment-workflows] the POST returned no entry id');
		}
		paymentEntryId = createdEntryId;
		await expect(dialog).toBeHidden();

		const entry = await readPaymentEntryById(db, paymentEntryId);
		expect(entry.companyName).toBe(company.companyName);
		expect(entry.invoiceNo).toBe(invoiceNumber);
		expect(Number(entry.amount)).toBe(RECEIPT_AMOUNT);
		expect(Number(entry.netAmount)).toBe(RECEIPT_AMOUNT);
		expect(Number(entry.tdsAmount)).toBe(0);
		expect(Number(entry.gstAmount)).toBe(0);
		expect(entry.paymentType).toBe('partial');
		expect(entry.receiptDate).toBe(RECEIPT_DATE);
		expect(entry.paymentDate).toBe(RECEIPT_DATE);
		expect(entry.transactionId).toBe(transactionId);
		expect(entry.createdBy).toBe(actor.userId);
		expect(entry.isDelete).toBe(0);
		expect(entry.receiptNo).toMatch(/^R-\d{2}-\d{3,}$/);
		const receiptNo = entry.receiptNo;
		if (!receiptNo) {
			throw new Error('[payment-workflows] the receipt has no number');
		}

		const refreshedDetail = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/reports/client-balance/detail' &&
					url.searchParams.get('client_name') === company.companyName
				);
			},
			{ timeout: 60_000 }
		);
		await page.goto(clientPath);
		expect((await refreshedDetail).ok()).toBe(true);

		await expect(
			page.getByRole('heading', {
				name: company.companyName,
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });
		await expect(summaryCard('Received')).toContainText(RECEIPT_AMOUNT_DISPLAY);
		await expect(summaryCard('Net Balance')).toContainText(
			NET_BALANCE_AFTER_RECEIPT_DISPLAY
		);
		const paymentRow = page.getByRole('row').filter({ hasText: receiptNo });
		await expect(paymentRow).toHaveCount(1);
		await expect(paymentRow).toContainText(invoiceNumber);
		await expect(paymentRow).toContainText(RECEIPT_AMOUNT_DISPLAY);
	} finally {
		try {
			await cleanupPaymentEntry(db, paymentEntryId, transactionId);
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
	}
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * `admin:read`, `admin:create` and `other_expenses:read` — no super admin.
 *
 * Starting state: one owned company available in the payee picker and no
 * payment issue for it.
 *
 * Action: open Add Payment Issued to client, select that payee, record
 * ₹12,500 less a ₹500 deduction with a 10 Nov 2026 issue date and Part status,
 * save, then reload the register and search the payee.
 *
 * Proof: the fresh register row shows the selected payee, 10 Nov 2026 and
 * ₹12,500.00 / ₹500.00 / ₹12,000.00; an independent MySQL read of the captured
 * issue id matches the payee, date, amount, deduction, net and status.
 */
test('a payment issue saves the selected payee and shows date and net on reload', async ({
	page,
	db,
	namespace,
}) => {
	const flow = `${namespace}-issue`;
	const company = await seedSalesCompany(db, flow);
	let user: JourneyUser | null = null;
	let paymentIssueId: number | null = null;

	try {
		const actor = await createJourneyUser(
			db,
			`${flow}-actor`,
			PAYMENT_ISSUE_PERMISSIONS
		);
		user = actor;

		page.setDefaultNavigationTimeout(60_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInThroughUi(page, actor);

		await page.goto('/admin/payment-issue');
		await expect(
			page.getByRole('heading', {
				name: 'Payment Issued to client',
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });
		await page
			.getByRole('button', {
				name: 'Add Payment Issued to client',
				exact: true,
			})
			.click();
		const dialog = page.getByRole('dialog', {
			name: 'New Payment Issued to client',
			exact: true,
		});
		await expect(dialog).toBeVisible({ timeout: 60_000 });

		await dialog
			.getByRole('button', {
				name: 'Client / Vendor Name',
				exact: true,
			})
			.click();
		await page
			.getByPlaceholder('Search...', { exact: true })
			.fill(company.companyName);
		const payeeOption = page
			.getByRole('button')
			.filter({ hasText: company.companyName })
			.filter({ hasText: '[Company]' });
		await expect(payeeOption).toHaveCount(1);
		await payeeOption.click();
		await expect(
			dialog.getByRole('button', {
				name: 'Client / Vendor Name',
				exact: true,
			})
		).toContainText(company.companyName);

		await dialog
			.getByLabel('Amount (Invoice Amount)', { exact: true })
			.fill(String(PAYMENT_ISSUE_AMOUNT));
		await dialog
			.getByLabel('Deduction', { exact: true })
			.fill(String(PAYMENT_ISSUE_DEDUCTION));
		await expect(
			dialog.getByLabel('Net Amount (Invoice Amount - Deduction)', {
				exact: true,
			})
		).toHaveValue(String(PAYMENT_ISSUE_NET));
		await dialog
			.getByLabel('Issue Date', { exact: true })
			.fill(PAYMENT_ISSUE_DATE);
		await dialog.getByLabel('Status', { exact: true }).selectOption('part');

		const createResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/admin/payment-issues'
				);
			},
			{ timeout: 60_000 }
		);
		await dialog
			.getByRole('button', {
				name: 'Create Payment Issued to client',
				exact: true,
			})
			.click();
		const created = await createResponse;
		expect(created.ok()).toBe(true);
		const createdBody = (await created.json()) as CreatePaymentIssueResponse;
		expect(createdBody.success).toBe(true);
		const createdId = createdBody.id;
		if (typeof createdId !== 'number' || !Number.isInteger(createdId)) {
			throw new Error('[payment-workflows] the POST returned no issue id');
		}
		paymentIssueId = createdId;
		expect(paymentIssueId).toBeGreaterThan(0);
		await expect(dialog).toBeHidden();

		const stored = await readPaymentIssueById(db, paymentIssueId);
		expect(stored.payeeName).toBe(company.companyName);
		expect(stored.payeeType).toBe('company');
		expect(stored.issueDate).toBe(PAYMENT_ISSUE_DATE);
		expect(Number(stored.amount)).toBe(PAYMENT_ISSUE_AMOUNT);
		expect(Number(stored.deduction)).toBe(PAYMENT_ISSUE_DEDUCTION);
		expect(Number(stored.netAmount)).toBe(PAYMENT_ISSUE_NET);
		expect(stored.status).toBe('part');
		expect(stored.invoiceNumber).toBeNull();
		expect(stored.isDelete).toBe(0);

		const reloadResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/admin/payment-issues'
				);
			},
			{ timeout: 60_000 }
		);
		await page.reload();
		expect((await reloadResponse).ok()).toBe(true);
		await expect(
			page.getByRole('heading', {
				name: 'Payment Issued to client',
				exact: true,
			})
		).toBeVisible({ timeout: 60_000 });

		const searchResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/admin/payment-issues' &&
					url.searchParams.get('search') === company.companyName
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByPlaceholder(/Search by payee, invoice, transaction ref, bank/)
			.fill(company.companyName);
		expect((await searchResponse).ok()).toBe(true);

		const row = page.getByRole('row').filter({ hasText: company.companyName });
		await expect(row).toHaveCount(1);
		await expect(row.getByRole('cell').nth(0)).toHaveText(company.companyName);
		await expect(row.getByRole('cell').nth(3)).toHaveText(
			PAYMENT_ISSUE_AMOUNT_DISPLAY
		);
		await expect(row.getByRole('cell').nth(4)).toHaveText(
			PAYMENT_ISSUE_DEDUCTION_DISPLAY
		);
		await expect(row.getByRole('cell').nth(5)).toHaveText(
			PAYMENT_ISSUE_NET_DISPLAY
		);
		await expect(row.getByRole('cell').nth(6)).toHaveText(
			PAYMENT_ISSUE_DATE_DISPLAY
		);
		await expect(row.getByRole('cell').nth(9)).toHaveText('Part');
	} finally {
		try {
			await cleanupPaymentIssue(
				db,
				paymentIssueId,
				company.companyName,
				PAYMENT_ISSUE_DATE
			);
		} finally {
			try {
				await cleanupSalesCompany(db, company);
			} finally {
				if (user !== null) await user.dispose();
			}
		}
	}
});
