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
	PROCUREMENT_RECOGNITION_PERIOD,
	cleanupOrdersByNumber,
	seedRecognizedSupplierInvoice,
	seedSupplierOrder,
	type ProcurementInvoiceFixture,
	type ProcurementOrderFixture,
} from '../fixtures/procurement.ts';

/**
 * `purchase_orders:read/create` records and lists orders; `other_expenses:read`
 * is only the documented /admin shell gate (ADR-0022). The consumption act
 * additionally needs `purchase_orders:update` and `other_expenses:approve`,
 * because a recognized slice changes the supplier commitment.
 */
const CLIENT_ORDER_PERMISSIONS = [
	'purchase_orders:read',
	'purchase_orders:create',
	'other_expenses:read',
] as const;

const SUPPLIER_ORDER_PERMISSIONS = CLIENT_ORDER_PERMISSIONS;

const CONSUMPTION_PERMISSIONS = [
	'purchase_orders:read',
	'purchase_orders:update',
	'other_expenses:read',
	'other_expenses:approve',
] as const;

interface CreateOrderBody {
	success: boolean;
	data: {
		orderUid: string;
		orderNumber: string;
		direction: string;
		financialVersion: number;
	};
}

interface ConsumptionBody {
	success: boolean;
	data: {
		remainingCommitment: number;
		consumption: {
			id: number;
			amount: number;
			state: string;
			recognizedPeriod: string;
			costUid: string;
		};
	};
}

interface StoredOrderRow extends RowDataPacket {
	order_uid: string;
	order_number: string;
	direction: string;
	counterparty_name: string;
	currency: string;
	amount_basis: string;
	gross_amount: string | null;
	tax_amount: string | null;
	net_amount: string | null;
	order_date: string | null;
	status: string;
	firmness: string;
	firmness_evidence_reference: string | null;
	source_document_reference: string | null;
	remarks: string | null;
	financial_version: number;
	created_by: number | null;
	isDelete: number;
}

interface OrderEventRow extends RowDataPacket {
	event: string;
	version: number;
}

interface StoredConsumptionRow extends RowDataPacket {
	order_uid: string;
	cost_uid: string;
	cost_source: string;
	amount: string;
	tax_basis: string;
	currency: string;
	recognized_period: string;
	source: string;
	source_version: number;
	state: string;
	version: number;
	actor_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
}

interface ConsumptionEventRow extends RowDataPacket {
	event: string;
	version: number;
	amount: string;
	tax_basis: string;
	currency: string;
	recognized_period: string;
	actor_user_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
}

const CLIENT_COUNTERPARTY = 'E2E Client Counterparty';
const CLIENT_GROSS = '250000.75';
const CLIENT_GROSS_DISPLAY = '2,50,000.75';

/**
 * Actor: an ordinary signed-in employee whose custom role grants exactly
 * purchase_orders:read, purchase_orders:create and other_expenses:read (the
 * /admin shell gate) — no administrator and no super-admin.
 *
 * Starting state: no order with this namespaced number exists.
 *
 * Action: open Orders, record one client order with direction Client order,
 * the namespaced number and counterparty, a gross-basis value of 250000.75,
 * approved status and firm evidence, then open that row from the register.
 *
 * Proof: the success notice names a Client order, the row shows the authored
 * number, counterparty, INR 2,50,000.75, approved and firm with its evidence,
 * the opened detail shows the same value as remaining commercial context, and
 * an independent MySQL read matches the order columns plus its created event.
 * A save that silently dropped direction, money or firmness fails.
 */
test('client order records and reopens with the authored counterparty, value and firmness', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(180_000);
	const orderNumber = fitIdentifier(`${namespace}-CO`, 100);
	const firmnessEvidence = fitIdentifier(`${namespace}-CO-FIRM`, 255);
	const sourceDocument = fitIdentifier(`${namespace}-CO-DOC`, 255);
	const remarks = 'E2E client order commercial context';
	const orderDate = '2026-11-15';
	const user = await createJourneyUser(
		db,
		`${namespace}-orders-client`,
		CLIENT_ORDER_PERMISSIONS
	);

	try {
		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});

		await page.goto('/admin/orders');
		await expect(
			page.getByRole('heading', { name: 'Orders', exact: true })
		).toBeVisible({ timeout: 60_000 });

		await page.getByTestId('order-direction').selectOption('client');
		await page.getByTestId('order-number').fill(orderNumber);
		await page.getByTestId('order-counterparty').fill(CLIENT_COUNTERPARTY);
		await page.getByTestId('order-basis').selectOption('gross');
		await page.getByTestId('order-gross').fill(CLIENT_GROSS);
		await page.getByTestId('order-date').fill(orderDate);
		await page.getByTestId('order-status').selectOption('approved');
		await page.getByTestId('order-firmness').selectOption('firm');
		await page.getByTestId('order-firmness-evidence').fill(firmnessEvidence);
		await page.getByTestId('order-source-document').fill(sourceDocument);
		await page.getByTestId('order-remarks').fill(remarks);

		const createResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/admin/orders'
				);
			},
			{ timeout: 60_000 }
		);
		await page.getByTestId('order-create-submit').click();
		const created = await createResponse;
		expect(created.ok()).toBe(true);
		const createdBody = (await created.json()) as CreateOrderBody;
		expect(createdBody.success).toBe(true);
		expect(createdBody.data.direction).toBe('client');
		expect(createdBody.data.orderNumber).toBe(orderNumber);
		const orderUid = createdBody.data.orderUid;
		expect(orderUid).toMatch(/^ord-/);

		await expect(page.getByTestId('order-form-success')).toHaveText(
			`Client order ${orderNumber} recorded.`
		);

		const row = page
			.locator('[data-testid="order-row"]')
			.filter({ hasText: orderNumber });
		await expect(row).toHaveCount(1);
		await expect(row).toHaveAttribute('data-order-uid', orderUid);
		await expect(row.getByTestId('order-row-number')).toHaveText(orderNumber);
		await expect(row.getByRole('cell').nth(1)).toHaveText('client');
		await expect(row.getByRole('cell').nth(2)).toHaveText(CLIENT_COUNTERPARTY);
		const valueCell = row.getByTestId('order-row-value');
		await expect(valueCell).toHaveAttribute('data-amount', CLIENT_GROSS);
		await expect(valueCell).toHaveAttribute('data-currency', 'INR');
		await expect(valueCell).toHaveAttribute('data-basis', 'gross');
		await expect(valueCell).toHaveText(`INR ${CLIENT_GROSS_DISPLAY}`);
		await expect(row.getByRole('cell').nth(5)).toHaveText('approved');
		await expect(row.getByRole('cell').nth(6)).toHaveText(
			`firm (${firmnessEvidence})`
		);

		const detailResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/orders/${orderUid}`
				);
			},
			{ timeout: 60_000 }
		);
		await row.getByTestId('order-row-open').click();
		const detail = await detailResponse;
		expect(detail.ok()).toBe(true);

		const detailPanel = page.getByTestId('order-detail');
		await expect(detailPanel).toContainText(`Number: ${orderNumber}`);
		await expect(detailPanel).toContainText('Direction: client');
		await expect(detailPanel).toContainText(
			`Counterparty: ${CLIENT_COUNTERPARTY}`
		);
		await expect(detailPanel).toContainText('Currency: INR (gross)');
		await expect(detailPanel).toContainText(`Order date: ${orderDate}`);
		await expect(detailPanel).toContainText(
			`Source document: ${sourceDocument}`
		);
		await expect(detailPanel).toContainText(
			`Remaining: ${CLIENT_GROSS_DISPLAY}`
		);
		await expect(
			detailPanel.getByTestId('order-event').filter({ hasText: 'created v1' })
		).toHaveCount(1);

		const [stored] = await db.execute<StoredOrderRow[]>(
			`SELECT order_uid, order_number, direction, counterparty_name, currency,
              amount_basis, gross_amount, tax_amount, net_amount, order_date,
              status, firmness, firmness_evidence_reference,
              source_document_reference, remarks, financial_version, created_by,
              isDelete
         FROM orders
        WHERE order_uid = ?`,
			[orderUid]
		);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			order_uid: orderUid,
			order_number: orderNumber,
			direction: 'client',
			counterparty_name: CLIENT_COUNTERPARTY,
			currency: 'INR',
			amount_basis: 'gross',
			gross_amount: CLIENT_GROSS,
			tax_amount: null,
			net_amount: null,
			order_date: orderDate,
			status: 'approved',
			firmness: 'firm',
			firmness_evidence_reference: firmnessEvidence,
			source_document_reference: sourceDocument,
			remarks,
			financial_version: 1,
			created_by: user.userId,
			isDelete: 0,
		});

		const [events] = await db.execute<OrderEventRow[]>(
			`SELECT event, version FROM order_events
        WHERE order_uid = ? ORDER BY id`,
			[orderUid]
		);
		expect(events.map((event) => ({ ...event }))).toEqual([
			{ event: 'created', version: 1 },
		]);
	} finally {
		await cleanupOrdersByNumber(db, [orderNumber]);
		await user.dispose();
	}
});

/**
 * Actor: an ordinary signed-in employee whose custom role grants exactly
 * purchase_orders:read, purchase_orders:create and other_expenses:read — no
 * administrator and no super-admin.
 *
 * Starting state: no order with this namespaced supplier number exists.
 *
 * Action: open Orders, record one supplier order with a gross-basis value of
 * 100000.00, approved status and firm evidence, then open that row.
 *
 * Proof: the row and opened detail name the Supplier order; the commitment
 * panel (which requires the supplier source read on top of the order read)
 * shows 1,00,000.00 remaining and 0.00 recognized consumption, and an
 * independent MySQL read matches the stored order and its created event. The
 * order value is never silently counted as incurred cost.
 */
test('supplier order records as an approved commitment with its stated value still remaining', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(180_000);
	const orderNumber = fitIdentifier(`${namespace}-SO`, 100);
	const firmnessEvidence = fitIdentifier(`${namespace}-SO-FIRM`, 255);
	const sourceDocument = fitIdentifier(`${namespace}-SO-DOC`, 255);
	const counterparty = 'E2E Supplier Counterparty';
	const remarks = 'E2E supplier commitment context';
	const orderDate = '2026-11-16';
	const gross = '100000.00';
	const net = '80000.00';
	const tax = '20000.00';
	const user = await createJourneyUser(
		db,
		`${namespace}-orders-supplier`,
		SUPPLIER_ORDER_PERMISSIONS
	);

	try {
		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: user.username,
			password: user.password,
		});

		await page.goto('/admin/orders');
		await expect(
			page.getByRole('heading', { name: 'Orders', exact: true })
		).toBeVisible({ timeout: 60_000 });

		await page.getByTestId('order-direction').selectOption('supplier');
		await page.getByTestId('order-number').fill(orderNumber);
		await page.getByTestId('order-counterparty').fill(counterparty);
		await page.getByTestId('order-basis').selectOption('gross');
		await page.getByTestId('order-gross').fill(gross);
		await page.getByTestId('order-tax').fill(tax);
		await page.getByTestId('order-net').fill(net);
		await page.getByTestId('order-date').fill(orderDate);
		await page.getByTestId('order-status').selectOption('approved');
		await page.getByTestId('order-firmness').selectOption('firm');
		await page.getByTestId('order-firmness-evidence').fill(firmnessEvidence);
		await page.getByTestId('order-source-document').fill(sourceDocument);
		await page.getByTestId('order-remarks').fill(remarks);

		const createResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === '/api/admin/orders'
				);
			},
			{ timeout: 60_000 }
		);
		await page.getByTestId('order-create-submit').click();
		const created = await createResponse;
		expect(created.ok()).toBe(true);
		const createdBody = (await created.json()) as CreateOrderBody;
		expect(createdBody.success).toBe(true);
		expect(createdBody.data.direction).toBe('supplier');
		expect(createdBody.data.orderNumber).toBe(orderNumber);
		const orderUid = createdBody.data.orderUid;

		await expect(page.getByTestId('order-form-success')).toHaveText(
			`Supplier order ${orderNumber} recorded.`
		);

		const row = page
			.locator('[data-testid="order-row"]')
			.filter({ hasText: orderNumber });
		await expect(row).toHaveCount(1);
		await expect(row.getByTestId('order-row-number')).toHaveText(orderNumber);
		await expect(row.getByRole('cell').nth(1)).toHaveText('supplier');
		await expect(row.getByRole('cell').nth(2)).toHaveText(counterparty);
		const valueCell = row.getByTestId('order-row-value');
		await expect(valueCell).toHaveAttribute('data-amount', '100000');
		await expect(valueCell).toHaveText('INR 1,00,000.00');
		await expect(row.getByRole('cell').nth(5)).toHaveText('approved');
		await expect(row.getByRole('cell').nth(6)).toHaveText(
			`firm (${firmnessEvidence})`
		);

		const detailResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/orders/${orderUid}`
				);
			},
			{ timeout: 60_000 }
		);
		const commitmentResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/orders/${orderUid}/commitment`
				);
			},
			{ timeout: 60_000 }
		);
		await row.getByTestId('order-row-open').click();
		expect((await detailResponse).ok()).toBe(true);
		expect((await commitmentResponse).ok()).toBe(true);

		await expect(page.getByTestId('order-detail')).toContainText(
			`Number: ${orderNumber}`
		);
		await expect(page.getByTestId('order-detail')).toContainText(
			'Direction: supplier'
		);
		const commitmentPanel = page.getByTestId('order-commitment');
		await expect(commitmentPanel).toBeVisible();
		const remaining = commitmentPanel.getByTestId('commitment-remaining');
		await expect(remaining).toHaveAttribute('data-amount', '100000');
		await expect(remaining).toContainText(
			'Remaining commitment: 1,00,000.00 (INR · gross)'
		);
		const consumed = commitmentPanel.getByTestId('commitment-consumed');
		await expect(consumed).toHaveAttribute('data-amount', '0');
		await expect(consumed).toContainText('Recognized consumption: 0.00');
		await expect(
			commitmentPanel.getByTestId('order-consumption-row')
		).toHaveCount(0);

		const [stored] = await db.execute<StoredOrderRow[]>(
			`SELECT order_uid, order_number, direction, counterparty_name, currency,
              amount_basis, gross_amount, tax_amount, net_amount, order_date,
              status, firmness, firmness_evidence_reference,
              source_document_reference, remarks, financial_version, created_by,
              isDelete
         FROM orders
        WHERE order_uid = ?`,
			[orderUid]
		);
		expect(stored).toHaveLength(1);
		expect(stored[0]).toMatchObject({
			order_uid: orderUid,
			order_number: orderNumber,
			direction: 'supplier',
			counterparty_name: counterparty,
			currency: 'INR',
			amount_basis: 'gross',
			gross_amount: gross,
			tax_amount: tax,
			net_amount: net,
			order_date: orderDate,
			status: 'approved',
			firmness: 'firm',
			firmness_evidence_reference: firmnessEvidence,
			source_document_reference: sourceDocument,
			remarks,
			financial_version: 1,
			created_by: user.userId,
			isDelete: 0,
		});
		const [events] = await db.execute<OrderEventRow[]>(
			`SELECT event, version FROM order_events
        WHERE order_uid = ? ORDER BY id`,
			[orderUid]
		);
		expect(events.map((event) => ({ ...event }))).toEqual([
			{ event: 'created', version: 1 },
		]);
	} finally {
		await cleanupOrdersByNumber(db, [orderNumber]);
		await user.dispose();
	}
});

/**
 * Actor: an ordinary signed-in employee whose custom role grants exactly
 * purchase_orders:read/update plus other_expenses:read/approve — the order
 * register, supplier commitment read and the financial approval act, with no
 * administrator and no super-admin.
 *
 * Starting state: one owned approved gross-basis supplier order for 100000.00
 * and one separately seeded recognized supplier invoice whose native gross
 * slice in 2027-01 is 23600.00 (20000.00 cost after 3600.00 recoverable tax).
 *
 * Action: open that supplier order from Orders, choose the recognized invoice
 * slice, give a reason and evidence, and record the consumption.
 *
 * Proof: the panel drops from 1,00,000.00 remaining to 76,400.00 and shows
 * 23,600.00 recognized consumption; the active row names the invoice and
 * period; an independent MySQL read matches the consumption, its recorded
 * event, and the advanced order version. A broken save, wrong amount or
 * unconsumed slice fails.
 */
test('recording a recognized slice consumes the supplier commitment and lowers its remaining value', async ({
	page,
	db,
	namespace,
}) => {
	test.setTimeout(180_000);
	let orderFixture: ProcurementOrderFixture | null = null;
	let invoiceFixture: ProcurementInvoiceFixture | null = null;
	let user: JourneyUser | null = null;
	const reason = fitIdentifier(`${namespace}-CONSUME-REASON`, 500);
	const evidenceReference = fitIdentifier(`${namespace}-CONSUME-EVID`, 500);

	try {
		const order = await seedSupplierOrder(db, `${namespace}-consumption`);
		orderFixture = order;
		const invoice = await seedRecognizedSupplierInvoice(
			db,
			`${namespace}-consumption`
		);
		invoiceFixture = invoice;
		const identity = await createJourneyUser(
			db,
			`${namespace}-orders-consume`,
			CONSUMPTION_PERMISSIONS
		);
		user = identity;

		// The seeded source is already recognized and registered under its own
		// cost identity; this read proves the candidate exists independently of
		// the UI that will offer it.
		const [startingInvoice] = await db.execute<RowDataPacket[]>(
			`SELECT cost_uid, recognition_state, recognition_period, total,
              tax_amount, recognized_amount, financial_version
         FROM purchase_invoices
        WHERE id = ?`,
			[invoice.invoiceId]
		);
		expect(startingInvoice).toHaveLength(1);
		expect(startingInvoice[0]).toMatchObject({
			cost_uid: invoice.costUid,
			recognition_state: 'recognized',
			recognition_period: PROCUREMENT_RECOGNITION_PERIOD,
			total: PROCUREMENT_INVOICE_GROSS,
			tax_amount: invoice.taxAmount,
			recognized_amount: '20000.00',
			financial_version: 1,
		});
		const [startingConsumptions] = await db.execute<RowDataPacket[]>(
			'SELECT id FROM order_consumptions WHERE order_uid = ?',
			[order.orderUid]
		);
		expect(startingConsumptions).toHaveLength(0);

		page.setDefaultNavigationTimeout(60_000);
		await signInThroughUi(page, {
			username: identity.username,
			password: identity.password,
		});

		await page.goto('/admin/orders');
		await expect(
			page.getByRole('heading', { name: 'Orders', exact: true })
		).toBeVisible({ timeout: 60_000 });

		const row = page
			.locator('[data-testid="order-row"]')
			.filter({ hasText: order.orderNumber });
		await expect(row).toHaveCount(1);
		await expect(row).toHaveAttribute('data-order-uid', order.orderUid);

		const detailResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/orders/${order.orderUid}`
				);
			},
			{ timeout: 60_000 }
		);
		const commitmentResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'GET' &&
					url.pathname === `/api/admin/orders/${order.orderUid}/commitment`
				);
			},
			{ timeout: 60_000 }
		);
		await row.getByTestId('order-row-open').click();
		expect((await detailResponse).ok()).toBe(true);
		expect((await commitmentResponse).ok()).toBe(true);

		const commitmentPanel = page.getByTestId('order-commitment');
		await expect(commitmentPanel).toBeVisible();
		const remainingBefore = commitmentPanel.getByTestId('commitment-remaining');
		await expect(remainingBefore).toHaveAttribute('data-amount', '100000');
		await expect(remainingBefore).toContainText(
			'Remaining commitment: 1,00,000.00 (INR · gross)'
		);
		await expect(
			commitmentPanel.getByTestId('commitment-consumed')
		).toHaveAttribute('data-amount', '0');

		const candidateValue = `${invoice.costUid}|${PROCUREMENT_RECOGNITION_PERIOD}`;
		const candidate = commitmentPanel.getByTestId('consumption-candidate');
		await expect(
			candidate.locator(`option[value="${candidateValue}"]`)
		).toHaveCount(1);
		await candidate.selectOption(candidateValue);
		await page.getByTestId('consumption-reason').fill(reason);
		await page.getByTestId('consumption-evidence').fill(evidenceReference);

		const consumeResponse = page.waitForResponse(
			(response) => {
				const url = new URL(response.url());
				return (
					response.request().method() === 'POST' &&
					url.pathname === `/api/admin/orders/${order.orderUid}/consumption`
				);
			},
			{ timeout: 60_000 }
		);
		await page.getByTestId('consumption-confirm').click();
		const consumed = await consumeResponse;
		expect(consumed.ok()).toBe(true);
		const consumedBody = (await consumed.json()) as ConsumptionBody;
		expect(consumedBody.success).toBe(true);
		expect(consumedBody.data.remainingCommitment).toBe(76_400);
		expect(consumedBody.data.consumption).toMatchObject({
			amount: 23_600,
			state: 'active',
			recognizedPeriod: PROCUREMENT_RECOGNITION_PERIOD,
			costUid: invoice.costUid,
		});

		await expect(page.getByTestId('consumption-notice')).toHaveText(
			'Consumption recorded; remaining 76400.'
		);

		const remainingAfter = commitmentPanel.getByTestId('commitment-remaining');
		await expect(remainingAfter).toHaveAttribute('data-amount', '76400');
		await expect(remainingAfter).toContainText(
			'Remaining commitment: 76,400.00 (INR · gross)'
		);
		await expect(
			commitmentPanel.getByTestId('commitment-consumed')
		).toHaveAttribute('data-amount', '23600');
		const consumptionRow = commitmentPanel.getByTestId('order-consumption-row');
		await expect(consumptionRow).toHaveCount(1);
		await expect(consumptionRow).toHaveAttribute('data-state', 'active');
		await expect(consumptionRow).toHaveAttribute('data-amount', '23600');
		await expect(consumptionRow).toContainText(invoice.invoiceNumber);
		await expect(consumptionRow).toContainText(PROCUREMENT_RECOGNITION_PERIOD);
		await expect(consumptionRow).toContainText('23,600.00 INR · gross');

		// Reload the register and reopen the order: the reduced commitment must
		// come from the stored consumption, not TanStack Query's cache.
		await page.reload();
		await expect(
			page.getByRole('heading', { name: 'Orders', exact: true })
		).toBeVisible({ timeout: 60_000 });
		const reloadedRow = page
			.locator('[data-testid="order-row"]')
			.filter({ hasText: order.orderNumber });
		await expect(reloadedRow).toHaveCount(1);
		await reloadedRow.getByTestId('order-row-open').click();
		const reloadedPanel = page.getByTestId('order-commitment');
		const reloadedRemaining = reloadedPanel.getByTestId('commitment-remaining');
		await expect(reloadedRemaining).toHaveAttribute('data-amount', '76400');
		await expect(reloadedRemaining).toContainText(
			'Remaining commitment: 76,400.00 (INR · gross)'
		);
		await expect(
			reloadedPanel.getByTestId('order-consumption-row')
		).toHaveCount(1);

		const [storedConsumptions] = await db.execute<StoredConsumptionRow[]>(
			`SELECT order_uid, cost_uid, cost_source, amount, tax_basis, currency,
              recognized_period, source, source_version, state, version, actor_id,
              reason, evidence_reference
         FROM order_consumptions
        WHERE order_uid = ? ORDER BY id`,
			[order.orderUid]
		);
		expect(storedConsumptions).toHaveLength(1);
		expect(storedConsumptions[0]).toMatchObject({
			order_uid: order.orderUid,
			cost_uid: invoice.costUid,
			cost_source: 'supplier_invoice',
			amount: '23600.00',
			tax_basis: 'gross',
			currency: 'INR',
			recognized_period: PROCUREMENT_RECOGNITION_PERIOD,
			source: 'invoice',
			source_version: 1,
			state: 'active',
			version: 1,
			actor_id: identity.userId,
			reason,
			evidence_reference: evidenceReference,
		});

		const [consumptionEvents] = await db.execute<ConsumptionEventRow[]>(
			`SELECT event, version, amount, tax_basis, currency, recognized_period,
              actor_user_id, reason, evidence_reference
         FROM order_consumption_events
        WHERE order_uid = ? ORDER BY id`,
			[order.orderUid]
		);
		expect(consumptionEvents).toHaveLength(1);
		expect(consumptionEvents[0]).toMatchObject({
			event: 'recorded',
			version: 1,
			amount: '23600.00',
			tax_basis: 'gross',
			currency: 'INR',
			recognized_period: PROCUREMENT_RECOGNITION_PERIOD,
			actor_user_id: identity.userId,
			reason,
			evidence_reference: evidenceReference,
		});

		const [storedOrder] = await db.execute<RowDataPacket[]>(
			`SELECT gross_amount, amount_basis, status, financial_version
         FROM orders WHERE order_uid = ?`,
			[order.orderUid]
		);
		expect(storedOrder).toHaveLength(1);
		expect(storedOrder[0]).toMatchObject({
			gross_amount: '100000.00',
			amount_basis: 'gross',
			status: 'approved',
			financial_version: 2,
		});
		const [consumedTotals] = await db.execute<RowDataPacket[]>(
			`SELECT SUM(amount) AS consumed
         FROM order_consumptions
        WHERE order_uid = ? AND state = 'active'`,
			[order.orderUid]
		);
		expect(Number(consumedTotals[0].consumed)).toBe(23_600);
		expect(
			Number(storedOrder[0].gross_amount) - Number(consumedTotals[0].consumed)
		).toBe(76_400);
	} finally {
		if (orderFixture !== null) await orderFixture.dispose();
		if (invoiceFixture !== null) await invoiceFixture.dispose();
		if (user !== null) await user.dispose();
	}
});
