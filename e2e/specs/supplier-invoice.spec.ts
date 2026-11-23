import type { RowDataPacket } from 'mysql2/promise';
import { test, expect } from '../support/test.ts';
import { signInThroughUi } from '../support/auth.ts';
import {
	createJourneyUser,
	type JourneyUser,
} from '../fixtures/journey-user.ts';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import {
	PROCUREMENT_INVOICE_GROSS,
	PROCUREMENT_INVOICE_RECOGNIZED,
	PROCUREMENT_RECOGNITION_PERIOD,
	PROCUREMENT_SERVICE_END,
	PROCUREMENT_SERVICE_START,
	seedDraftSupplierInvoice,
	type ProcurementInvoiceFixture,
} from '../fixtures/procurement.ts';

/**
 * `purchase_orders:read` lists the invoice register, `proposals:read` opens
 * its financial detail (the route's documented gate), `purchase_orders:update`
 * applies the versioned commands, and `other_expenses:read/approve` are the
 * /admin shell gate plus the financial approval act. No administrator or
 * super-admin is involved.
 */
const SUPPLIER_INVOICE_PERMISSIONS = [
	'purchase_orders:read',
	'purchase_orders:update',
	'proposals:read',
	'other_expenses:read',
	'other_expenses:approve',
] as const;

interface CommandBody {
	success: boolean;
	data: {
		id: number;
		cost_uid: string | null;
		recognition_state: string;
		financial_version: number;
		recognized_amount: number | null;
		recognition_period: string | null;
		component: string;
	};
}

interface StoredInvoiceRow extends RowDataPacket {
	cost_uid: string;
	recognition_state: string;
	recognition_period: string | null;
	period_basis: string;
	service_period_start: string | null;
	service_period_end: string | null;
	tax_treatment: string;
	tax_evidence_reference: string | null;
	recognized_amount: string | null;
	recognized_by: number | null;
	recognized_at: string | null;
	financial_version: number;
	status: string;
	currency: string;
	total: string;
	tax_amount: string;
	isDelete: number;
}

interface CostEventRow extends RowDataPacket {
	version: number;
	command: string;
}

interface CostLinkRow extends RowDataPacket {
	source_table: string;
	source_id: string;
	role: string;
	review_state: string;
}

/**
 * Actor: an ordinary signed-in employee whose custom role grants exactly
 * purchase_orders:read/update, proposals:read and
 * other_expenses:read/approve — no administrator and no super-admin.
 *
 * Starting state: one separately seeded draft supplier invoice from the
 * namespaced vendor for 23600.00 including 3600.00 tax, with no destination,
 * service period, tax treatment or recognized amount yet, and one recorded
 * journal version.
 *
 * Action: open the register, search the namespaced invoice number, open its
 * recognition dialog, set Company Overhead, the January 2027 service period and
 * recoverable tax with evidence, then Save, Submit and Recognize.
 *
 * Proof: the dialog moves Draft → Pending evidence → Recognized, shows
 * ₹20,000.00 as the recognized cost, and the closed register row is approved;
 * an independent MySQL read matches the recognized state, period, tax
 * evidence, 20000.00 cost and version 4, with updated/submitted/recognized
 * journal entries. A save that never persisted or a wrong cost fails.
 */
test('supplier invoice recognition sets matching cost and recognition state', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(240_000);
	let fixture: ProcurementInvoiceFixture | null = null;
	let user: JourneyUser | null = null;
	const taxEvidence = fitIdentifier(`${namespace}-SI-TAX-EVID`, 255);

	try {
		const invoice = await seedDraftSupplierInvoice(
			db,
			`${namespace}-recognition`
		);
		fixture = invoice;
		const identity = await createJourneyUser(
			db,
			`${namespace}-supplier-invoice`,
			SUPPLIER_INVOICE_PERMISSIONS
		);
		user = identity;

		const [starting] = await db.execute<StoredInvoiceRow[]>(
			`SELECT cost_uid, recognition_state, recognition_period, period_basis,
              service_period_start, service_period_end, tax_treatment,
              tax_evidence_reference, recognized_amount, recognized_by,
              recognized_at, financial_version, status, currency, total,
              tax_amount, isDelete
         FROM purchase_invoices
        WHERE id = ?`,
			[invoice.invoiceId]
		);
		expect(starting).toHaveLength(1);
		expect(starting[0]).toMatchObject({
			cost_uid: invoice.costUid,
			recognition_state: 'draft',
			recognition_period: null,
			period_basis: 'unresolved',
			service_period_start: null,
			service_period_end: null,
			tax_treatment: 'unresolved',
			tax_evidence_reference: null,
			recognized_amount: null,
			recognized_by: null,
			recognized_at: null,
			financial_version: 1,
			status: 'draft',
			currency: 'INR',
			total: PROCUREMENT_INVOICE_GROSS,
			tax_amount: '3600.00',
			isDelete: 0,
		});

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: identity.username,
			password: identity.password,
		});

		await page.goto('/admin/purchase-invoice');
		await expect(
			page.getByRole('heading', { name: 'Purchase Invoice', exact: true })
		).toBeVisible({ timeout: 60_000 });

		const searchResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/admin/purchase-invoices' &&
					url.searchParams.get('search') === invoice.invoiceNumber
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByPlaceholder('Search by invoice #, vendor, PO…')
			.fill(invoice.invoiceNumber);
		expect((await searchResponse).ok()).toBe(true);
		const registerRow = page
			.getByRole('row')
			.filter({ hasText: invoice.invoiceNumber });
		await expect(registerRow).toHaveCount(1);
		await expect(registerRow).toContainText(invoice.vendorName);
		await expect(registerRow).toContainText('₹23,600.00');
		await expect(registerRow.getByRole('cell').nth(6)).toHaveText('draft');

		const detailResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/purchase-invoices/${invoice.invoiceId}`
				);
			},
			{ timeout: 60_000 }
		);
		await page.getByTestId(`recognition-open-${invoice.invoiceNumber}`).click();
		expect((await detailResponse).ok()).toBe(true);

		const dialog = page.getByTestId('supplier-recognition-dialog');
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole('heading', {
				name: `Supplier cost recognition — ${invoice.invoiceNumber}`,
				exact: true,
			})
		).toBeVisible();
		await expect(dialog.getByTestId('recognition-state')).toHaveText('Draft');
		await expect(
			dialog.getByTestId('recognition-recognized-amount')
		).toHaveText('Not recognized');
		await expect(
			dialog.getByTestId('recognition-recognized-amount')
		).toHaveAttribute('data-amount', '');

		await dialog
			.getByTestId('recognition-classification')
			.selectOption('company_overhead');
		await dialog
			.getByTestId('recognition-service-start')
			.fill(PROCUREMENT_SERVICE_START);
		await dialog
			.getByTestId('recognition-service-end')
			.fill(PROCUREMENT_SERVICE_END);
		await dialog
			.getByTestId('recognition-tax-treatment')
			.selectOption('recoverable');
		await dialog.getByTestId('recognition-tax-evidence').fill(taxEvidence);

		const saveResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname ===
						`/api/admin/purchase-invoices/${invoice.invoiceId}/commands`
				);
			},
			{ timeout: 60_000 }
		);
		await dialog.getByTestId('recognition-save').click();
		const saved = await saveResponse;
		expect(saved.ok()).toBe(true);
		const savedBody = (await saved.json()) as CommandBody;
		expect(savedBody.success).toBe(true);
		expect(savedBody.data).toMatchObject({
			recognition_state: 'draft',
			financial_version: 2,
			component: 'update',
		});
		await expect(
			dialog.getByText('Commands carry version 2.', { exact: true })
		).toBeVisible();
		await expect(dialog.getByTestId('recognition-state')).toHaveText('Draft');

		const submitResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname ===
						`/api/admin/purchase-invoices/${invoice.invoiceId}/commands`
				);
			},
			{ timeout: 60_000 }
		);
		await dialog.getByTestId('recognition-submit').click();
		const submitted = await submitResponse;
		expect(submitted.ok()).toBe(true);
		const submittedBody = (await submitted.json()) as CommandBody;
		expect(submittedBody.success).toBe(true);
		expect(submittedBody.data).toMatchObject({
			recognition_state: 'pending_evidence',
			financial_version: 3,
			component: 'submit',
		});
		await expect(dialog.getByTestId('recognition-state')).toHaveText(
			'Pending evidence'
		);
		await expect(
			dialog.getByText('Commands carry version 3.', { exact: true })
		).toBeVisible();

		const recognizeResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname ===
						`/api/admin/purchase-invoices/${invoice.invoiceId}/commands`
				);
			},
			{ timeout: 60_000 }
		);
		await dialog.getByTestId('recognition-recognize').click();
		const recognized = await recognizeResponse;
		expect(recognized.ok()).toBe(true);
		const recognizedBody = (await recognized.json()) as CommandBody;
		expect(recognizedBody.success).toBe(true);
		expect(recognizedBody.data).toMatchObject({
			cost_uid: invoice.costUid,
			recognition_state: 'recognized',
			financial_version: 4,
			recognized_amount: 20_000,
			recognition_period: PROCUREMENT_RECOGNITION_PERIOD,
			component: 'recognize',
		});
		await expect(dialog.getByTestId('recognition-state')).toHaveText(
			'Recognized'
		);
		const recognizedAmount = dialog.getByTestId(
			'recognition-recognized-amount'
		);
		await expect(recognizedAmount).toHaveAttribute('data-amount', '20000');
		await expect(recognizedAmount).toHaveText('₹20,000.00');
		await expect(
			dialog.getByText('Commands carry version 4.', { exact: true })
		).toBeVisible();

		// The register reflects the saved recognition state, not only the dialog.
		await dialog.getByTestId('recognition-close').click();
		await expect(registerRow.getByRole('cell').nth(6)).toHaveText('approved');

		// Reload the register and reopen the dialog so the proof is the stored
		// row, not TanStack Query's cache.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Purchase Invoice', exact: true })
		).toBeVisible({ timeout: 60_000 });
		const reloadedSearch = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === '/api/admin/purchase-invoices' &&
					url.searchParams.get('search') === invoice.invoiceNumber
				);
			},
			{ timeout: 60_000 }
		);
		await page
			.getByPlaceholder('Search by invoice #, vendor, PO…')
			.fill(invoice.invoiceNumber);
		expect((await reloadedSearch).ok()).toBe(true);
		const reloadedRow = page
			.getByRole('row')
			.filter({ hasText: invoice.invoiceNumber });
		await expect(reloadedRow).toHaveCount(1);
		await expect(reloadedRow.getByRole('cell').nth(6)).toHaveText('approved');
		await reloadedRow
			.getByTestId(`recognition-open-${invoice.invoiceNumber}`)
			.click();
		const reloadedDialog = page.getByTestId('supplier-recognition-dialog');
		await expect(reloadedDialog.getByTestId('recognition-state')).toHaveText(
			'Recognized'
		);
		const reloadedAmount = reloadedDialog.getByTestId(
			'recognition-recognized-amount'
		);
		await expect(reloadedAmount).toHaveAttribute('data-amount', '20000');
		await expect(reloadedAmount).toHaveText('₹20,000.00');

		const [stored] = await db.execute<StoredInvoiceRow[]>(
			`SELECT cost_uid, recognition_state, recognition_period, period_basis,
              service_period_start, service_period_end, tax_treatment,
              tax_evidence_reference, recognized_amount, recognized_by,
              recognized_at, financial_version, status, currency, total,
              tax_amount, isDelete
         FROM purchase_invoices
        WHERE id = ?`,
			[invoice.invoiceId]
		);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			cost_uid: invoice.costUid,
			recognition_state: 'recognized',
			recognition_period: PROCUREMENT_RECOGNITION_PERIOD,
			period_basis: 'service_period',
			service_period_start: PROCUREMENT_SERVICE_START,
			service_period_end: PROCUREMENT_SERVICE_END,
			tax_treatment: 'recoverable',
			tax_evidence_reference: taxEvidence,
			recognized_amount: PROCUREMENT_INVOICE_RECOGNIZED,
			recognized_by: identity.userId,
			financial_version: 4,
			status: 'approved',
			currency: 'INR',
			total: PROCUREMENT_INVOICE_GROSS,
			tax_amount: '3600.00',
			isDelete: 0,
		});
		expect(stored[0].recognized_at).not.toBeNull();

		const [links] = await db.execute<CostLinkRow[]>(
			`SELECT source_table, source_id, role, review_state
         FROM financial_cost_links
        WHERE cost_uid = ? AND role = 'cost'`,
			[invoice.costUid]
		);
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({
			source_table: 'purchase_invoices',
			source_id: String(invoice.invoiceId),
			role: 'cost',
			review_state: 'confirmed',
		});

		const [events] = await db.execute<CostEventRow[]>(
			`SELECT version, command FROM financial_cost_events
        WHERE cost_uid = ? ORDER BY version`,
			[invoice.costUid]
		);
		expect(
			events.map((event) => ({
				version: event.version,
				command: event.command,
			}))
		).toEqual([
			{ version: 1, command: 'recorded' },
			{ version: 2, command: 'updated' },
			{ version: 3, command: 'submitted' },
			{ version: 4, command: 'recognized' },
		]);
	} finally {
		if (fixture !== null) await fixture.dispose();
		if (user !== null) await user.dispose();
	}
});
