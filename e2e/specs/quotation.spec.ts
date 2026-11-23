import type { RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import {
	cleanupQuotationFixture,
	seedQuotationFixture,
	type QuotationFixture,
	type StoredQuotationRow,
} from '../fixtures/quotation.ts';

/**
 * `proposals:read` lists/reopens quotations, `proposals:create` saves a new
 * standalone one, and `companies:read` lets the real client picker load the
 * owned company. The quotation page lives under `/admin`, whose shell admits a
 * non-admin identity holding `other_expenses:read` (ADR-0022); that read grant
 * opens no other page's data because each API still authorizes separately.
 */
const QUOTATION_PERMISSIONS = [
	'proposals:read',
	'proposals:create',
	'companies:read',
	'other_expenses:read',
] as const;

interface CreateQuotationBody {
	success: boolean;
	id?: number;
}

interface QuotationDetailBody {
	success: boolean;
	data?: {
		id: number;
		client_name: string;
	};
}

interface CountRow extends RowDataPacket {
	count: number | string;
}

let identity: JourneyUser | null = null;
let fixture: QuotationFixture | null = null;
let quotationId: number | null = null;

// The owned Next dev server compiles the create/detail routes on first visit;
// the assertions are not weakened, only the surrounding wall-clock budget
// accommodates that compile.
test.setTimeout(180_000);

test.afterEach(async ({ db }) => {
	const ownedFixture = fixture;
	const ownedIdentity = identity;
	const ownedQuotationId = quotationId;
	fixture = null;
	identity = null;
	quotationId = null;
	try {
		if (ownedFixture !== null && ownedIdentity !== null) {
			await cleanupQuotationFixture(
				db,
				ownedFixture,
				ownedIdentity.userId,
				ownedQuotationId
			);
		}
	} finally {
		if (ownedIdentity !== null) {
			await ownedIdentity.dispose();
		}
	}
});

/**
 * Actor: an ordinary signed-in user whose custom role grants exactly
 * proposals:read, proposals:create, companies:read and other_expenses:read
 * (the documented /admin shell gate) — no administrator or super-admin.
 *
 * Starting state: one owned client company and no active quotation with the
 * namespaced number.
 *
 * Action: from the outgoing quotation list, choose Create Quotation, pick the
 * owned company in the real picker, author one scope line at qty 3 × ₹12,500
 * with 18% GST, save through the form, then reopen that row from the list and
 * reload the view page.
 *
 * Proof: after the reload the view shows the owned client, the scope line and
 * qty/rate/amount, plus Gross ₹37,500.00, GST ₹6,750.00 and Net ₹44,250.00;
 * an independent database read of the captured row matches. A save that did
 * not persist, a list row pointing at the wrong id, or a wrong total fails.
 */
test('standalone quotation saves and reopens with the authored client, scope and GST totals', async ({
	page,
	db,
	namespace,
}) => {
	const user = await createJourneyUser(
		db,
		`${namespace}-quotation`,
		QUOTATION_PERMISSIONS
	);
	identity = user;
	const quote = await seedQuotationFixture(db, namespace);
	fixture = quote;

	const [preexisting] = await db.execute<StoredQuotationRow[]>(
		'SELECT id FROM quotations WHERE quotation_number = ?',
		[quote.quotationNumber]
	);
	expect(preexisting).toHaveLength(0);

	page.setDefaultNavigationTimeout(60_000);
	await signInThroughUi(page, {
		username: user.username,
		password: user.password,
	});

	await page.goto('/admin/quotation');
	await expect(
		page.getByRole('heading', { name: 'Quotation (Outgoing)', exact: true })
	).toBeVisible();

	const nextNumberResponse = page.waitForResponse(
		(response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/admin/quotations/next-number'
			);
		},
		{ timeout: 60_000 }
	);
	const companiesResponse = page.waitForResponse(
		(response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' &&
				url.pathname === '/api/companies' &&
				url.searchParams.get('lean') === 'true'
			);
		},
		{ timeout: 60_000 }
	);

	await page
		.getByRole('button', { name: 'Create Quotation', exact: true })
		.click();
	await page.waitForURL(/\/admin\/quotation\/new\/edit\?source=quotations$/, {
		timeout: 60_000,
	});
	await expect(
		page.getByRole('heading', {
			name: 'Create Standalone Quotation',
			exact: true,
		})
	).toBeVisible();
	expect((await nextNumberResponse).ok()).toBe(true);
	expect((await companiesResponse).ok()).toBe(true);

	// The form pre-fills the generated sequence. Replace it with the owned
	// namespaced number: the create route upserts a client-supplied number, so
	// a shared sequence could silently update another row instead of creating.
	const numberInput = page.locator('input[name="quotation_number"]');
	await expect(numberInput).toHaveValue(
		/^ATSPL\/Q\/\d{2}\/\d{2}-\d{2}\/\d{3,}$/
	);
	await numberInput.fill(quote.quotationNumber);

	await page
		.getByRole('button', { name: 'Search company...', exact: true })
		.click();
	await page
		.getByPlaceholder('Search...', { exact: true })
		.fill(quote.companyName);
	const companyOption = page.getByRole('button', {
		name: quote.companyName,
		exact: true,
	});
	await expect(companyOption).toBeVisible();
	await companyOption.click();
	await expect(page.getByPlaceholder('Client Address')).toHaveValue(
		quote.clientAddress
	);

	const scopeTable = page.getByRole('table').filter({
		has: page.getByRole('columnheader', {
			name: 'Scope of the Work',
			exact: true,
		}),
	});
	await scopeTable.locator('[contenteditable="true"]').fill(quote.scopeLine);
	await scopeTable.getByPlaceholder('Qty', { exact: true }).fill(quote.qty);
	await scopeTable.getByPlaceholder('Rate', { exact: true }).fill(quote.rate);
	await expect(
		scopeTable.getByPlaceholder('Amount', { exact: true })
	).toHaveValue(quote.amount);
	await expect(page.getByLabel('GST Rate:')).toHaveValue('18');

	const totalRow = (label: string) =>
		page.getByText(label, { exact: true }).locator('..');
	await expect(totalRow('Gross Amount:')).toContainText('₹37,500.00');
	await expect(totalRow('CGST @ 9%:')).toContainText('₹3,375.00');
	await expect(totalRow('SGST @ 9%:')).toContainText('₹3,375.00');
	await expect(totalRow('Net Amount:')).toContainText('₹44,250.00');

	// StrictMode can run the number-generator effect twice in the owned dev
	// server. Re-assert the authored value after the form work so a late
	// generated number cannot silently replace it before the save.
	await expect(numberInput).toHaveValue(quote.quotationNumber);

	const createResponse = page.waitForResponse(
		(response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'POST' &&
				url.pathname === '/api/admin/standalone-quotations'
			);
		},
		{ timeout: 60_000 }
	);
	page.once('dialog', (dialog) => dialog.accept());
	await page
		.getByRole('button', { name: 'Save Quotation', exact: true })
		.click();
	const created = await createResponse;
	expect(created.ok()).toBe(true);
	const createBody = (await created.json()) as CreateQuotationBody;
	expect(createBody.success).toBe(true);
	expect(Number.isInteger(createBody.id)).toBe(true);
	quotationId = Number(createBody.id);
	expect(quotationId).toBeGreaterThan(0);
	await page.waitForURL(/\/admin\/quotation$/, { timeout: 60_000 });

	const row = page.getByRole('row').filter({ hasText: quote.companyName });
	await expect(row).toHaveCount(1);
	await expect(
		row.getByText(quote.quotationNumber, { exact: true })
	).toBeVisible();
	await expect(row.getByRole('cell').nth(1)).toContainText(quote.companyName);
	await expect(row.getByRole('cell').nth(2)).toHaveText('₹44,250.00');
	await expect(row).toContainText('Standalone');
	await expect(row.getByRole('cell').nth(5)).toHaveText('Draft');

	const detailPath = `/api/admin/standalone-quotations/${quotationId}`;
	const firstDetail = page.waitForResponse(
		(response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' && url.pathname === detailPath
			);
		},
		{ timeout: 60_000 }
	);
	await row.getByTitle('View Quotation', { exact: true }).click();
	await page.waitForURL(
		(url) =>
			url.pathname === `/admin/quotation/${quotationId}/view` &&
			url.searchParams.get('source') === 'quotations',
		{ timeout: 60_000 }
	);
	const opened = await firstDetail;
	expect(opened.ok()).toBe(true);
	const openedBody = (await opened.json()) as QuotationDetailBody;
	expect(openedBody.success).toBe(true);
	expect(openedBody.data?.id).toBe(quotationId);
	expect(openedBody.data?.client_name).toBe(quote.companyName);

	// Reload so every value asserted below is the stored row, not client state.
	const reloadedDetail = page.waitForResponse(
		(response) => {
			const url = new URL(response.url());
			return (
				response.request().method() === 'GET' && url.pathname === detailPath
			);
		},
		{ timeout: 60_000 }
	);
	await page.reload();
	expect((await reloadedDetail).ok()).toBe(true);

	await expect(
		page.getByRole('heading', { name: 'View Quotation', exact: true })
	).toBeVisible();
	const clientSection = page.getByText('To,', { exact: true }).locator('..');
	await expect(clientSection).toContainText(quote.companyName);
	await expect(clientSection).toContainText('411001');
	await expect(
		page.getByText(quote.quotationNumber, { exact: true }).first()
	).toBeVisible();
	await expect(
		page.getByText('Kind Attn:', { exact: true }).locator('..')
	).toContainText(quote.contactPerson);

	const viewScopeTable = page.getByRole('table').filter({
		has: page.getByRole('columnheader', {
			name: 'Scope of the Work',
			exact: true,
		}),
	});
	const scopeRow = viewScopeTable
		.getByRole('row')
		.filter({ hasText: quote.scopeLine });
	await expect(scopeRow.getByRole('cell').nth(1)).toHaveText(quote.scopeLine);
	await expect(scopeRow.getByRole('cell').nth(2)).toHaveText(quote.qty);
	await expect(scopeRow.getByRole('cell').nth(3)).toHaveText('₹12,500.00');
	await expect(scopeRow.getByRole('cell').nth(4)).toHaveText('₹37,500.00');

	const viewTotalRow = (label: string) =>
		page.getByText(label, { exact: true }).locator('..');
	await expect(viewTotalRow('Gross Amount:')).toContainText('₹37,500.00');
	// DECIMAL(5,2) comes back from MySQL as "18.00"; the view prints it raw.
	await expect(
		page.getByText(/^GST @ 18(?:\.00)?%:$/).locator('..')
	).toContainText('₹6,750.00');
	await expect(viewTotalRow('Net Amount:')).toContainText('₹44,250.00');

	const [storedRows] = await db.execute<StoredQuotationRow[]>(
		`SELECT id, quotation_number, client_name, client_address, scope_items,
            gross_amount, gst_percentage, gst_amount, net_amount, total,
            created_by, isDelete
       FROM quotations
      WHERE id = ?`,
		[quotationId]
	);
	expect(storedRows).toHaveLength(1);
	const stored = storedRows[0];
	expect(stored.quotation_number).toBe(quote.quotationNumber);
	expect(stored.client_name).toBe(quote.companyName);
	expect(stored.client_address).toBe(quote.clientAddress);
	expect(stored.created_by).toBe(user.userId);
	expect(stored.isDelete).toBe(0);
	expect(Number(stored.gross_amount)).toBe(quote.grossAmount);
	expect(Number(stored.gst_percentage)).toBe(quote.gstPercentage);
	expect(Number(stored.gst_amount)).toBe(quote.gstAmount);
	expect(Number(stored.net_amount)).toBe(quote.netAmount);
	expect(Number(stored.total)).toBe(quote.netAmount);

	const storedScopeItems =
		typeof stored.scope_items === 'string'
			? (JSON.parse(stored.scope_items) as unknown)
			: stored.scope_items;
	expect(Array.isArray(storedScopeItems)).toBe(true);
	const scopeItems = storedScopeItems as Array<Record<string, unknown>>;
	expect(scopeItems).toHaveLength(1);
	expect(scopeItems[0]).toMatchObject({
		sr_no: 1,
		qty: quote.qty,
		rate: quote.rate,
	});
	expect(Number(scopeItems[0].amount)).toBe(quote.grossAmount);
	expect(String(scopeItems[0].description)).toContain(quote.scopeLine);

	const [activeCounts] = await db.execute<CountRow[]>(
		`SELECT COUNT(*) AS count FROM quotations
      WHERE quotation_number = ? AND (isDelete = 0 OR isDelete IS NULL)`,
		[quote.quotationNumber]
	);
	expect(Number(activeCounts[0].count)).toBe(1);
});
