import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	CENTS_INVOICES,
	CREATED_ORDERS,
	INVOICE_LINK,
	LEGACY_AMOUNTS,
	LEGACY_NUMBERS,
	ORDER_FIXTURE_PREFIX,
	ORDER_MONTH,
	ORDER_PROJECT,
	ORDER_SUPPLIER,
	cleanupOrderFixtures,
	loginOrderViewer,
	seedOrderFixtures,
	type SeededOrderFixtures,
} from '../lib/order-fixtures';

/**
 * Ticket #310 — canonical client/supplier orders and legacy direction review.
 *
 * Expected values come from the fixture literals (this file says what the
 * stored copies are worth; the app must therefore show those values against
 * the direction a document-backed review decided) and from the parent rule
 * that a supplier order is not an expense and client order value is commercial
 * context only. Persisted state is asserted through `e2e/lib/db.ts`, never
 * through the app's own aggregation.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity through the proxy's trusted header
	// (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.26' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const PREFIX = ORDER_FIXTURE_PREFIX;
const MONTH = ORDER_MONTH;
const PROJECT = ORDER_PROJECT;
/** Every supported client order value in the Project, to the cent. */
const CLIENT_ORDER_TOTAL =
	CREATED_ORDERS.client.net + CREATED_ORDERS.centsClient.net;

interface OrderRecord {
	orderUid: string;
	orderNumber: string;
	direction: 'client' | 'supplier';
	counterpartyName: string;
	projectId: number | null;
	projectCode: string | null;
	currency: string;
	amountBasis: 'gross' | 'net' | 'unknown';
	grossAmount: number | null;
	taxAmount: number | null;
	netAmount: number | null;
	clientInvoicedValue: number | null;
	clientRemainingValue: number | null;
	orderDate: string | null;
	status: string;
	firmness: string;
	firmnessEvidenceReference: string | null;
	sourceDocumentReference: string | null;
	remarks: string | null;
	financialVersion: number;
	createdFrom: string;
	originMappingId: number | null;
}

interface OrderValueTotal {
	direction: 'client' | 'supplier';
	currency: string;
	basis: 'gross' | 'net';
	orderValue: number;
	orderCount: number;
}

interface OrderList {
	orders: OrderRecord[];
	totals: OrderValueTotal[];
	unknownValueCount: number;
}

interface LegacyMapping {
	mappingId: number;
	legacyStore: string;
	legacyId: number;
	documentNumber: string | null;
	counterpartyName: string | null;
	legacyAmount: number | null;
	reviewState: string;
	resolvedDirection: string | null;
	canonicalOrderUid: string | null;
	duplicateOfMappingId: number | null;
	version: number;
	reason: string | null;
	evidenceReference: string | null;
	collisions: Array<{
		mappingId: number;
		legacyStore: string;
		legacyId: number;
		documentNumber: string | null;
		reviewState: string;
	}>;
}

interface ReviewQueue {
	items: LegacyMapping[];
	pendingCount: number;
}

interface Reconciliation {
	company: { incurred_cost: number | null };
	coverage: Array<{ code: string }>;
}

let seeded: SeededOrderFixtures;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
/** Canonical order UIDs this spec created through the app. */
const created: Array<{ orderUid: string; orderNumber: string; by: string }> = [];
/** Status codes observed for the read/write authorization probes. */
const authorizationEvidence: Record<string, number> = {};

function publish(): void {
	writeArtifact('order-classification', {
		...evidence,
		fixtureScope: {
			prefix: PREFIX,
			month: MONTH,
			project: PROJECT.code,
			legacyStores: [
				'purchase_orders',
				'outgoing_purchase_orders',
				'project_purchase_orders',
				'project_invoices',
			],
		},
		createdThroughApp: created,
	});
}

function recordCreated(orderUid: string, orderNumber: string, by: string): void {
	created.push({ orderUid, orderNumber, by });
}

async function apiJson<T>(response: APIResponse, expectStatus = 200): Promise<T> {
	const body = await response.json();
	expect(response.status(), JSON.stringify(body)).toBe(expectStatus);
	return body as T;
}

async function listOrders(
	request: APIRequestContext,
	params: Record<string, string> = {}
): Promise<OrderList> {
	const query = new URLSearchParams({ include_cancelled: '1', ...params });
	const body = await apiJson<{ success: boolean; data: OrderList }>(
		await request.get(`/api/admin/orders?${query.toString()}`)
	);
	expect(body.success).toBe(true);
	return body.data;
}

async function reviewQueue(request: APIRequestContext): Promise<ReviewQueue> {
	const body = await apiJson<{ success: boolean; data: ReviewQueue }>(
		await request.get('/api/admin/orders/review')
	);
	expect(body.success).toBe(true);
	return body.data;
}

async function reconciliation(
	request: APIRequestContext,
	month: string
): Promise<Reconciliation> {
	const body = await apiJson<{
		success: boolean;
		data: Reconciliation;
	}>(
		await request.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${month}`
		)
	);
	expect(body.success).toBe(true);
	return body.data;
}

/** Fill the canonical order entry form and submit it. */
async function createOrderThroughForm(
	page: Page,
	order: {
		direction: 'client' | 'supplier';
		number: string;
		counterparty: string;
		currency: string;
		basis: string;
		net?: number;
		tax?: number;
		gross?: number;
		orderDate: string;
		status: string;
		firmness: string;
		firmnessEvidence?: string;
		sourceDocument?: string;
		remarks?: string;
	}
): Promise<void> {
	await page.getByTestId('order-direction').selectOption(order.direction);
	await page.getByTestId('order-number').fill(order.number);
	await page.getByTestId('order-counterparty').fill(order.counterparty);
	await page.getByTestId('order-currency').selectOption(order.currency);
	await page.getByTestId('order-basis').selectOption(order.basis);
	if (order.basis !== 'unknown') {
		await page.getByTestId('order-net').fill(String(order.net ?? ''));
		await page.getByTestId('order-tax').fill(String(order.tax ?? ''));
		await page.getByTestId('order-gross').fill(String(order.gross ?? ''));
	}
	await page.getByTestId('order-date').fill(order.orderDate);
	await page.getByTestId('order-status').selectOption(order.status);
	await page.getByTestId('order-firmness').selectOption(order.firmness);
	if (order.firmnessEvidence) {
		await page
			.getByTestId('order-firmness-evidence')
			.fill(order.firmnessEvidence);
	}
	if (order.sourceDocument) {
		await page
			.getByTestId('order-source-document')
			.fill(order.sourceDocument);
	}
	if (order.remarks) await page.getByTestId('order-remarks').fill(order.remarks);
	await page.getByTestId('order-create-submit').click();
	await expect(page.getByTestId('order-form-success')).toBeVisible();
	await expect(page.locator(`[data-testid="order-row"][data-order-number="${order.number}"]`)).toBeVisible();
}

function totalsRow(
	totals: OrderValueTotal[],
	direction: string,
	currency: string,
	basis: string
): OrderValueTotal | undefined {
	return totals.find(
		(row) =>
			row.direction === direction &&
			row.currency === currency &&
			row.basis === basis
	);
}

async function dbOrder(orderNumber: string): Promise<Record<string, unknown>> {
	const found = await rows<Record<string, unknown>>(
		`SELECT * FROM orders WHERE order_number = ?`,
		[orderNumber]
	);
	expect(found.length, `orders row ${orderNumber}`).toBe(1);
	return found[0];
}

async function dbMapping(
	legacyStore: string,
	legacyId: number
): Promise<Record<string, unknown>> {
	const found = await rows<Record<string, unknown>>(
		`SELECT * FROM order_legacy_mappings WHERE legacy_store = ? AND legacy_id = ?`,
		[legacyStore, legacyId]
	);
	expect(found.length, `mapping ${legacyStore}#${legacyId}`).toBe(1);
	return found[0];
}

/** Resolve one queue row through the review controls (browser). */
async function resolveThroughQueue(
	page: Page,
	mappingId: number,
	fields: {
		decision: string;
		direction?: string;
		reason: string;
		evidence: string;
		linkTarget?: string;
		duplicateTarget?: string;
		currency?: string;
		amounts?: { net?: number; tax?: number; gross?: number; basis?: string };
		counterparty?: string;
	}
): Promise<void> {
	const row = page.locator(
		`[data-testid="review-row"][data-mapping-id="${mappingId}"]`
	);
	await expect(row).toBeVisible();
	await row.getByTestId('review-decision').selectOption(fields.decision);
	if (fields.direction) {
		await row.getByTestId('review-direction').selectOption(fields.direction);
	}
	if (fields.currency) {
		await row.getByTestId('review-currency').selectOption(fields.currency);
	}
	if (fields.amounts) {
		await row
			.getByTestId('review-basis')
			.selectOption(fields.amounts.basis ?? 'net');
		await row
			.getByTestId('review-net')
			.fill(String(fields.amounts.net ?? ''));
		await row
			.getByTestId('review-tax')
			.fill(String(fields.amounts.tax ?? ''));
		await row
			.getByTestId('review-gross')
			.fill(String(fields.amounts.gross ?? ''));
	}
	if (fields.counterparty) {
		await row.getByTestId('review-counterparty').fill(fields.counterparty);
	}
	if (fields.linkTarget) {
		await row.getByTestId('review-link-target').selectOption(fields.linkTarget);
	}
	if (fields.duplicateTarget) {
		await row
			.getByTestId('review-duplicate-target')
			.selectOption(fields.duplicateTarget);
	}
	await row.getByTestId('review-reason').fill(fields.reason);
	await row.getByTestId('review-evidence').fill(fields.evidence);
	await row.getByTestId('review-submit').click();
	await expect(row.getByTestId('review-state')).toHaveText(/resolved|duplicate/i, {
		timeout: 10_000,
	});
}

test.beforeAll(async () => {
	seeded = await seedOrderFixtures();
	evidence.seeded = {
		projectId: seeded.projectId,
		legacy: seeded.legacy,
	};
});

test.afterAll(async () => {
	publish();
	await cleanupOrderFixtures();
});

test('queues every legacy copy without guessing direction from names or tables', async ({
	request,
}) => {
	// No canonical order exists yet: none of the legacy copies has been
	// classified, whatever their store or counterparty text looks like.
	const list = await listOrders(request);
	const legacyNumbers = Object.values(LEGACY_NUMBERS);
	for (const number of legacyNumbers) {
		expect(
			list.orders.some((order) => order.orderNumber === number),
			`canonical order ${number} must not exist before review`
		).toBe(false);
	}

	const queue = await reviewQueue(request);
	const mine = queue.items.filter((item) =>
		(item.documentNumber ?? '').startsWith(PREFIX)
	);
	expect(mine).toHaveLength(5);
	for (const item of mine) {
		expect(item.reviewState).toBe('pending');
		expect(item.resolvedDirection).toBeNull();
		expect(item.canonicalOrderUid).toBeNull();
	}

	const byStore = new Map(mine.map((item) => [item.legacyStore, item]));
	expect(byStore.has('purchase_orders')).toBe(true);
	expect(byStore.has('outgoing_purchase_orders')).toBe(true);
	expect(byStore.has('project_purchase_orders')).toBe(true);
	expect(byStore.has('project_invoices')).toBe(true);

	// Same document number in two stores is a collision candidate, not proof.
	// Both queued copies must see each other as candidates on the real surface.
	const incoming = mine.find(
		(item) =>
			item.legacyStore === 'purchase_orders' &&
			item.documentNumber === LEGACY_NUMBERS.colliding
	)!;
	expect(incoming).toBeTruthy();
	const collisionStores = incoming.collisions.map((c) => c.legacyStore);
	expect(collisionStores).toContain('outgoing_purchase_orders');
	const outgoingCopy = mine.find(
		(item) => item.legacyStore === 'outgoing_purchase_orders'
	)!;
	expect(outgoingCopy.collisions.map((c) => c.legacyStore)).toContain(
		'purchase_orders'
	);
	expect(
		incoming.collisions.some((c) => c.mappingId === outgoingCopy.mappingId)
	).toBe(true);

	evidence.queue = mine.map((item) => ({
		mappingId: item.mappingId,
		legacyStore: item.legacyStore,
		legacyId: item.legacyId,
		documentNumber: item.documentNumber,
		reviewState: item.reviewState,
		collisions: item.collisions.length,
	}));

	// The database agrees: five queued mappings, zero canonical rows.
	const mappingCount = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM order_legacy_mappings WHERE document_number LIKE ?`,
		[`${PREFIX}%`]
	);
	expect(Number(mappingCount[0].n)).toBe(5);
	const canonical = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?`,
		[`${PREFIX}%`]
	);
	expect(Number(canonical[0].n)).toBe(0);
});

test('refuses an order without explicit direction, evidence, a valid reference or currency', async ({
	request,
}) => {
	const noDirection = await request.post('/api/admin/orders', {
		data: {
			order_number: `${PREFIX}NO-DIRECTION`,
			counterparty_name: ORDER_SUPPLIER,
		},
	});
	const noDirectionBody = await apiJson<{ success: boolean; code: string }>(
		noDirection,
		422
	);
	expect(noDirectionBody.success).toBe(false);
	expect(noDirectionBody.code).toBe('direction_required');

	const noEvidence = await request.post('/api/admin/orders', {
		data: {
			direction: 'supplier',
			order_number: `${PREFIX}NO-EVIDENCE`,
			counterparty_name: ORDER_SUPPLIER,
			firmness: 'firm',
			currency: 'INR',
			amount_basis: 'unknown',
		},
	});
	const noEvidenceBody = await apiJson<{ success: boolean; code: string }>(
		noEvidence,
		422
	);
	expect(noEvidenceBody.success).toBe(false);
	expect(noEvidenceBody.code).toBe('firmness_evidence_required');

	// A Project reference that is not a live positive integer is refused, not
	// dropped to NULL: a typo must not silently remove the order from its
	// Project and its Project totals.
	const badProject = await request.post('/api/admin/orders', {
		data: {
			direction: 'supplier',
			order_number: `${PREFIX}BAD-PROJECT`,
			counterparty_name: ORDER_SUPPLIER,
			project_id: PROJECT.code,
			amount_basis: 'unknown',
		},
	});
	const badProjectBody = await apiJson<{ success: boolean; code: string }>(
		badProject,
		422
	);
	expect(badProjectBody.success).toBe(false);
	expect(badProjectBody.code).toBe('invalid_project');

	const badCompany = await request.post('/api/admin/orders', {
		data: {
			direction: 'supplier',
			order_number: `${PREFIX}BAD-COMPANY`,
			counterparty_name: ORDER_SUPPLIER,
			company_id: -4,
			amount_basis: 'unknown',
		},
	});
	const badCompanyBody = await apiJson<{ success: boolean; code: string }>(
		badCompany,
		422
	);
	expect(badCompanyBody.success).toBe(false);
	expect(badCompanyBody.code).toBe('invalid_company');

	// A currency longer than ISO 4217 is refused, never truncated into a
	// different valid code (USDT must not become USD).
	const badCurrency = await request.post('/api/admin/orders', {
		data: {
			direction: 'supplier',
			order_number: `${PREFIX}BAD-CURRENCY`,
			counterparty_name: ORDER_SUPPLIER,
			currency: 'USDT',
			amount_basis: 'unknown',
		},
	});
	const badCurrencyBody = await apiJson<{ success: boolean; code: string }>(
		badCurrency,
		422
	);
	expect(badCurrencyBody.success).toBe(false);
	expect(badCurrencyBody.code).toBe('invalid_currency');

	// A bad Project filter on the read path is refused too (a filter that
	// silently disappears would show company-wide orders as Project orders).
	const badFilter = await request.get(
		'/api/admin/orders?project_id=E2E-EXP-310-P1'
	);
	expect(badFilter.status()).toBe(400);

	const stored = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?`,
		[`${PREFIX}NO-%`]
	);
	expect(Number(stored[0].n)).toBe(0);
	const storedBad = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?`,
		[`${PREFIX}BAD-%`]
	);
	expect(Number(storedBad[0].n)).toBe(0);
	evidence.refusedInvalidOrders = {
		noDirection: noDirectionBody.code,
		noEvidence: noEvidenceBody.code,
		badProject: badProjectBody.code,
		badCompany: badCompanyBody.code,
		badCurrency: badCurrencyBody.code,
		badFilter: badFilter.status(),
	};
});

test('records a supplier order through the real order entry form', async ({
	page,
	request,
}) => {
	const before = await reconciliation(request, MONTH);

	await page.goto(`/admin/orders?project_id=${seeded.projectId}`);
	await expect(page.getByTestId('orders-page')).toBeVisible();
	await expect(page.getByTestId('order-project')).toHaveValue(
		String(seeded.projectId)
	);

	await createOrderThroughForm(page, {
		direction: 'supplier',
		number: CREATED_ORDERS.supplier.number,
		counterparty: CREATED_ORDERS.supplier.counterparty,
		currency: CREATED_ORDERS.supplier.currency,
		basis: CREATED_ORDERS.supplier.basis,
		net: CREATED_ORDERS.supplier.net,
		tax: CREATED_ORDERS.supplier.tax,
		gross: CREATED_ORDERS.supplier.gross,
		orderDate: CREATED_ORDERS.supplier.orderDate,
		status: CREATED_ORDERS.supplier.status,
		firmness: CREATED_ORDERS.supplier.firmness,
		firmnessEvidence: CREATED_ORDERS.supplier.firmnessEvidence,
		sourceDocument: CREATED_ORDERS.supplier.sourceDocument,
		remarks: CREATED_ORDERS.supplier.remarks,
	});

	const stored = await dbOrder(CREATED_ORDERS.supplier.number);
	expect(stored.direction).toBe('supplier');
	expect(Number(stored.project_id)).toBe(seeded.projectId);
	expect(stored.currency).toBe('INR');
	expect(stored.amount_basis).toBe('net');
	expect(Number(stored.net_amount)).toBe(CREATED_ORDERS.supplier.net);
	expect(Number(stored.tax_amount)).toBe(CREATED_ORDERS.supplier.tax);
	expect(Number(stored.gross_amount)).toBe(CREATED_ORDERS.supplier.gross);
	expect(stored.status).toBe('approved');
	expect(stored.firmness).toBe('firm');
	expect(stored.firmness_evidence_reference).toBe(
		CREATED_ORDERS.supplier.firmnessEvidence
	);
	expect(stored.source_document_reference).toBe(
		CREATED_ORDERS.supplier.sourceDocument
	);
	expect(stored.created_from).toBe('entry');
	expect(Number(stored.financial_version)).toBe(1);

	const events = await rows<{ event: string; version: number }>(
		`SELECT event, version FROM order_events WHERE order_uid = ?`,
		[String(stored.order_uid)]
	);
	expect(events).toHaveLength(1);
	expect(events[0].event).toBe('created');
	expect(Number(events[0].version)).toBe(1);

	// The supplier order value is a commitment, not cost: the report is
	// unchanged by its capture.
	const after = await reconciliation(request, MONTH);
	expect(after.company.incurred_cost).toBe(before.company.incurred_cost);

	recordCreated(
		String(stored.order_uid),
		String(stored.order_number),
		'browser-form'
	);
	evidence.supplierOrder = {
		orderUid: stored.order_uid,
		net: stored.net_amount,
		firmness: stored.firmness,
	};
});

test('records a client order and shows it as commercial context only', async ({
	page,
	request,
}) => {
	const before = await reconciliation(request, MONTH);

	await page.goto(`/admin/orders?project_id=${seeded.projectId}`);
	await createOrderThroughForm(page, {
		direction: 'client',
		number: CREATED_ORDERS.client.number,
		counterparty: CREATED_ORDERS.client.counterparty,
		currency: CREATED_ORDERS.client.currency,
		basis: CREATED_ORDERS.client.basis,
		net: CREATED_ORDERS.client.net,
		tax: CREATED_ORDERS.client.tax,
		gross: CREATED_ORDERS.client.gross,
		orderDate: CREATED_ORDERS.client.orderDate,
		status: CREATED_ORDERS.client.status,
		firmness: CREATED_ORDERS.client.firmness,
		firmnessEvidence: CREATED_ORDERS.client.firmnessEvidence,
		sourceDocument: CREATED_ORDERS.client.sourceDocument,
		remarks: CREATED_ORDERS.client.remarks,
	});

	const stored = await dbOrder(CREATED_ORDERS.client.number);
	expect(stored.direction).toBe('client');

	// Client order value is commercial context: not incurred cost.
	const after = await reconciliation(request, MONTH);
	expect(after.company.incurred_cost).toBe(before.company.incurred_cost);
	const costSources = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM expenses WHERE source_reference LIKE ?`,
		[`${PREFIX}%`]
	);
	expect(Number(costSources[0].n)).toBe(0);

	// The two directions are shown apart and each keeps its own total.
	const list = await listOrders(request, {
		project_id: String(seeded.projectId),
	});
	const client = totalsRow(list.totals, 'client', 'INR', 'net');
	const supplier = totalsRow(list.totals, 'supplier', 'INR', 'net');
	expect(client?.orderValue).toBe(CREATED_ORDERS.client.net);
	expect(supplier?.orderValue).toBe(CREATED_ORDERS.supplier.net);

	recordCreated(
		String(stored.order_uid),
		String(stored.order_number),
		'browser-form'
	);
	evidence.clientOrder = {
		orderUid: stored.order_uid,
		net: stored.net_amount,
		reportIncurredCost: after.company.incurred_cost,
	};
});

test('keeps an unsupported supplier value unknown instead of zero', async ({
	request,
	page,
}) => {
	const createdOrder = await apiJson<{ success: boolean; data: OrderRecord }>(
		await request.post('/api/admin/orders', {
			data: {
				direction: 'supplier',
				order_number: CREATED_ORDERS.unknown.number,
				counterparty_name: CREATED_ORDERS.unknown.counterparty,
				project_id: seeded.projectId,
				currency: CREATED_ORDERS.unknown.currency,
				amount_basis: 'unknown',
				order_date: CREATED_ORDERS.unknown.orderDate,
				status: 'draft',
				firmness: 'unknown',
			},
		})
	);
	expect(createdOrder.data.direction).toBe('supplier');
	expect(createdOrder.data.grossAmount).toBeNull();
	expect(createdOrder.data.netAmount).toBeNull();

	const stored = await dbOrder(CREATED_ORDERS.unknown.number);
	expect(stored.gross_amount).toBeNull();
	expect(stored.net_amount).toBeNull();
	expect(stored.amount_basis).toBe('unknown');

	// No total invents a value for it and it is not silently mixed in.
	const list = await listOrders(request, {
		project_id: String(seeded.projectId),
	});
	expect(totalsRow(list.totals, 'supplier', 'USD', 'net')).toBeUndefined();
	expect(totalsRow(list.totals, 'supplier', 'USD', 'gross')).toBeUndefined();
	expect(list.unknownValueCount).toBeGreaterThanOrEqual(1);

	// The order screen says so too, distinctly per direction.
	await page.goto(`/admin/orders?project_id=${seeded.projectId}`);
	const unknownNote = page.getByTestId('supplier-order-unknown');
	await expect(unknownNote).toBeVisible();
	await expect(unknownNote).toHaveAttribute('data-count', /[1-9]/);

	recordCreated(
		createdOrder.data.orderUid,
		createdOrder.data.orderNumber,
		'api'
	);
	evidence.unknownSupplierOrder = {
		orderUid: stored.order_uid,
		currency: stored.currency,
		amount: stored.net_amount,
	};
});

test('resolves ambiguous copies only through document-backed review', async ({
	page,
	request,
}) => {
	// The review UI lists every pending legacy copy with its collisions.
	await page.goto('/admin/orders');
	await expect(page.getByTestId('review-queue')).toBeVisible();

	const queue = await reviewQueue(request);
	const mine = queue.items.filter((item) =>
		(item.documentNumber ?? '').startsWith(PREFIX)
	);
	const outgoing = mine.find(
		(item) => item.legacyStore === 'outgoing_purchase_orders'
	)!;
	const incoming = mine.find(
		(item) =>
			item.legacyStore === 'purchase_orders' &&
			item.documentNumber === LEGACY_NUMBERS.colliding
	)!;
	const projectCopy = mine.find(
		(item) => item.legacyStore === 'project_purchase_orders'
	)!;
	const invoiceCopy = mine.find(
		(item) => item.legacyStore === 'project_invoices'
	)!;

	// Classify the project copy as a supplier order (gross 177000 = tax 27000
	// + net 150000, the store's own figures) with a document reference.
	await resolveThroughQueue(page, projectCopy.mappingId, {
		decision: 'classify',
		direction: 'supplier',
		currency: 'INR',
		reason: 'E2E-EXP-310 signed supplier PO document reviewed',
		evidence: 'E2E-EXP-310-DOC-LEG-2',
		counterparty: `${ORDER_SUPPLIER} Legacy Three`,
		amounts: {
			basis: 'gross',
			gross: LEGACY_AMOUNTS.projectPoGross,
			tax: LEGACY_AMOUNTS.projectPoTax,
			net: LEGACY_AMOUNTS.projectPoNet,
		},
	});

	const projectMapping = await dbMapping(
		'project_purchase_orders',
		projectCopy.legacyId
	);
	expect(projectMapping.review_state).toBe('resolved');
	expect(projectMapping.resolved_direction).toBe('supplier');
	expect(projectMapping.canonical_order_uid).toBeTruthy();
	expect(Number(projectMapping.version)).toBe(2);

	const classified = await rows<Record<string, unknown>>(
		`SELECT * FROM orders WHERE order_uid = ?`,
		[String(projectMapping.canonical_order_uid)]
	);
	expect(classified).toHaveLength(1);
	expect(classified[0].direction).toBe('supplier');
	expect(classified[0].created_from).toBe('legacy_review');
	expect(Number(classified[0].origin_mapping_id)).toBe(projectCopy.mappingId);
	expect(Number(classified[0].gross_amount)).toBe(
		LEGACY_AMOUNTS.projectPoGross
	);
	expect(Number(classified[0].net_amount)).toBe(LEGACY_AMOUNTS.projectPoNet);
	expect(Number(classified[0].tax_amount)).toBe(LEGACY_AMOUNTS.projectPoTax);
	expect(classified[0].amount_basis).toBe('gross');
	expect(classified[0].evidence_reference).toBe('E2E-EXP-310-DOC-LEG-2');

	// Same number in another store is not proof of the same order: the
	// incoming copy is classified as its own supplier order...
	await resolveThroughQueue(page, incoming.mappingId, {
		decision: 'classify',
		direction: 'supplier',
		currency: 'INR',
		reason: 'E2E-EXP-310 supplier PO copy reviewed against its document',
		evidence: 'E2E-EXP-310-DOC-LEG-1',
		counterparty: `${ORDER_SUPPLIER} Legacy One`,
		amounts: { basis: 'net', net: LEGACY_AMOUNTS.purchaseOrder },
	});
	// ... and the outgoing copy as a client order, even though its document
	// number matches the incoming copy exactly.
	await resolveThroughQueue(page, outgoing.mappingId, {
		decision: 'classify',
		direction: 'client',
		currency: 'INR',
		reason: 'E2E-EXP-310 client order document reviewed',
		evidence: 'E2E-EXP-310-DOC-CLI-LEG-1',
		counterparty: PROJECT.client,
		amounts: { basis: 'net', net: LEGACY_AMOUNTS.outgoing },
	});

	const incomingCanonical = await rows<Record<string, unknown>>(
		`SELECT * FROM orders WHERE origin_mapping_id = ?`,
		[incoming.mappingId]
	);
	const outgoingCanonical = await rows<Record<string, unknown>>(
		`SELECT * FROM orders WHERE origin_mapping_id = ?`,
		[outgoing.mappingId]
	);
	expect(incomingCanonical[0].order_number).toBe(LEGACY_NUMBERS.colliding);
	expect(outgoingCanonical[0].order_number).toBe(LEGACY_NUMBERS.colliding);
	expect(incomingCanonical[0].direction).toBe('supplier');
	expect(outgoingCanonical[0].direction).toBe('client');
	expect(incomingCanonical[0].order_uid).not.toBe(
		outgoingCanonical[0].order_uid
	);

	// Link the lone copy (the second `purchase_orders` row) to the supplier
	// order the review already created.
	const lonely = mine.find(
		(item) => item.documentNumber === LEGACY_NUMBERS.lonely
	)!;
	expect(lonely).toBeTruthy();
	await resolveThroughQueue(page, lonely.mappingId, {
		decision: 'link',
		reason: 'E2E-EXP-310 same order as the reviewed supplier copy',
		evidence: 'E2E-EXP-310-DOC-LEG-3',
		linkTarget: String(incomingCanonical[0].order_uid),
	});

	// Mark the project_invoices copy as a duplicate representation of the
	// project purchase order — the reviewer's document-backed decision, with
	// both legacy rows kept intact.
	await resolveThroughQueue(page, invoiceCopy.mappingId, {
		decision: 'duplicate',
		reason: 'E2E-EXP-310 same order represented in both project stores',
		evidence: 'E2E-EXP-310-DOC-LEG-2',
		duplicateTarget: String(projectCopy.mappingId),
	});

	const duplicateMapping = await dbMapping(
		'project_invoices',
		invoiceCopy.legacyId
	);
	expect(duplicateMapping.review_state).toBe('duplicate');
	expect(Number(duplicateMapping.duplicate_of_mapping_id)).toBe(
		projectCopy.mappingId
	);
	expect(String(duplicateMapping.canonical_order_uid)).toBe(
		String(projectMapping.canonical_order_uid)
	);

	// Nothing was merged destructively: every legacy row is still there.
	const legacyCounts = {
		purchaseOrders: await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM purchase_orders WHERE po_number LIKE ?`,
			[`${PREFIX}%`]
		),
		outgoing: await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM outgoing_purchase_orders WHERE po_number LIKE ?`,
			[`${PREFIX}%`]
		),
		projectPurchaseOrders: await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM project_purchase_orders WHERE po_number LIKE ?`,
			[`${PREFIX}%`]
		),
		projectInvoices: await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM project_invoices WHERE invoice_number LIKE ? AND tab_type = 'purchase_order'`,
			[`${PREFIX}%`]
		),
	};
	expect(Number(legacyCounts.purchaseOrders[0].n)).toBe(2);
	expect(Number(legacyCounts.outgoing[0].n)).toBe(1);
	expect(Number(legacyCounts.projectPurchaseOrders[0].n)).toBe(1);
	expect(Number(legacyCounts.projectInvoices[0].n)).toBe(1);

	// Every decision is journalled with its reason, evidence, and version.
	const decisions = await rows<{
		mapping_id: number;
		decision: string;
		version: number;
		evidence_reference: string;
	}>(
		`SELECT od.mapping_id, od.decision, od.version, od.evidence_reference
       FROM order_review_decisions od
       JOIN order_legacy_mappings m ON m.id = od.mapping_id
      WHERE m.document_number LIKE ?
      ORDER BY od.id`,
		[`${PREFIX}%`]
	);
	expect(decisions).toHaveLength(5);
	const decisionByMapping = new Map(
		decisions.map((row) => [Number(row.mapping_id), row])
	);
	expect(decisionByMapping.get(projectCopy.mappingId)?.decision).toBe(
		'classify'
	);
	expect(decisionByMapping.get(outgoing.mappingId)?.decision).toBe('classify');
	expect(decisionByMapping.get(invoiceCopy.mappingId)?.decision).toBe(
		'duplicate'
	);
	expect(decisionByMapping.get(lonely.mappingId)?.decision).toBe('link');

	const afterQueue = await reviewQueue(request);
	const stillPending = afterQueue.items.filter(
		(item) =>
			(item.documentNumber ?? '').startsWith(PREFIX) &&
			item.reviewState === 'pending'
	);
	expect(stillPending).toHaveLength(0);

	evidence.reviewDecisions = decisions.map((row) => ({
		mappingId: row.mapping_id,
		decision: row.decision,
		version: row.version,
		evidence: row.evidence_reference,
	}));
	evidence.collisionProof = {
		documentNumber: LEGACY_NUMBERS.colliding,
		directions: [
			incomingCanonical[0].direction,
			outgoingCanonical[0].direction,
		],
	};
});

test('rejects repeated and stale review decisions without duplicating anything', async ({
	request,
}) => {
	const queue = await reviewQueue(request);
	const resolved = queue.items.find(
		(item) =>
			item.legacyStore === 'project_purchase_orders' &&
			item.reviewState === 'resolved'
	)!;
	expect(resolved).toBeTruthy();

	const canonicalBefore = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM orders WHERE origin_mapping_id = ?`,
		[resolved.mappingId]
	);
	const decisionsBefore = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM order_review_decisions WHERE mapping_id = ?`,
		[resolved.mappingId]
	);
	expect(Number(canonicalBefore[0].n)).toBe(1);
	expect(Number(decisionsBefore[0].n)).toBe(1);

	// Replaying the accepted decision (its version is now stale) must change
	// nothing — no second canonical order, no second decision row.
	const replay = await request.post('/api/admin/orders/review', {
		data: {
			mapping_id: resolved.mappingId,
			decision: 'classify',
			expected_version: 1,
			reason: 'E2E-EXP-310 replay must be refused',
			evidence_reference: 'E2E-EXP-310-DOC-REPLAY',
			direction: 'supplier',
			counterparty_name: `${ORDER_SUPPLIER} Legacy Three`,
			amount_basis: 'gross',
			gross_amount: LEGACY_AMOUNTS.projectPoGross,
			tax_amount: LEGACY_AMOUNTS.projectPoTax,
			net_amount: LEGACY_AMOUNTS.projectPoNet,
		},
	});
	const replayBody = await apiJson<{ success: boolean; code: string }>(
		replay,
		409
	);
	expect(replayBody.success).toBe(false);
	expect(replayBody.code).toBe('stale_version');

	const canonicalAfter = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM orders WHERE origin_mapping_id = ?`,
		[resolved.mappingId]
	);
	const decisionsAfter = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM order_review_decisions WHERE mapping_id = ?`,
		[resolved.mappingId]
	);
	expect(Number(canonicalAfter[0].n)).toBe(1);
	expect(Number(decisionsAfter[0].n)).toBe(1);

	// A decision without document evidence is refused outright.
	const noEvidence = await request.post('/api/admin/orders/review', {
		data: {
			mapping_id: resolved.mappingId,
			decision: 'classify',
			expected_version: 2,
			reason: 'E2E-EXP-310 attempt without evidence',
			direction: 'client',
			counterparty_name: PROJECT.client,
			amount_basis: 'net',
			net_amount: 1,
		},
	});
	const noEvidenceBody = await apiJson<{ success: boolean; code: string }>(
		noEvidence,
		422
	);
	expect(noEvidenceBody.success).toBe(false);
	expect(noEvidenceBody.code).toBe('evidence_required');

	evidence.replayRefusal = {
		code: replayBody.code,
		canonicalOrders: Number(canonicalAfter[0].n),
		decisions: Number(decisionsAfter[0].n),
		missingEvidence: noEvidenceBody.code,
	};
});

test('links a client invoice to a canonical client order, never a supplier order', async ({
	request,
}) => {
	const clientOrder = await dbOrder(CREATED_ORDERS.client.number);
	const supplierOrder = await dbOrder(CREATED_ORDERS.supplier.number);
	const clientUid = String(clientOrder.order_uid);
	const supplierUid = String(supplierOrder.order_uid);

	// Creating the invoice with the canonical reference links the two, and it
	// never fabricates a legacy purchase_orders row from the number.
	const first = await apiJson<{ success: boolean }>(
		await request.post('/api/admin/invoices', {
			data: {
				invoice_number: INVOICE_LINK.number,
				invoice_date: `${MONTH}-20`,
				client_name: INVOICE_LINK.client,
				order_uid: clientUid,
				po_number: CREATED_ORDERS.client.number,
				items: [],
				line_items: [],
				total: INVOICE_LINK.firstTotal,
				gst_type: 'cgst_sgst',
				status: 'sent',
			},
		})
	);
	expect(first.success).toBe(true);

	const invoice = await rows<Record<string, unknown>>(
		`SELECT id, order_uid, total, po_id FROM invoices WHERE invoice_number = ? AND isDelete = 0`,
		[INVOICE_LINK.number]
	);
	expect(invoice).toHaveLength(1);
	const invoiceId = Number(invoice[0].id);
	expect(invoice[0].order_uid).toBe(clientUid);
	expect(invoice[0].po_id).toBeNull();

	const linked = await dbOrder(CREATED_ORDERS.client.number);
	expect(Number(linked.client_invoiced_value)).toBe(INVOICE_LINK.firstTotal);

	const fabricated = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM purchase_orders WHERE po_number = ?`,
		[CREATED_ORDERS.client.number]
	);
	expect(Number(fabricated[0].n)).toBe(0);

	// Editing the invoice adjusts the linked order's rollup by the difference.
	await apiJson(
		await request.put(`/api/admin/invoices/${invoiceId}`, {
			data: {
				client_name: INVOICE_LINK.client,
				order_uid: clientUid,
				po_number: CREATED_ORDERS.client.number,
				items: [],
				line_items: [],
				total: INVOICE_LINK.secondTotal,
				gst_type: 'cgst_sgst',
				status: 'sent',
			},
		})
	);
	const adjusted = await dbOrder(CREATED_ORDERS.client.number);
	expect(Number(adjusted.client_invoiced_value)).toBe(
		INVOICE_LINK.secondTotal
	);

	// The canonical balance endpoint answers from the order, not a text match.
	const balance = await apiJson<{
		success: boolean;
		data: { exists: boolean; remaining_balance: number | null };
	}>(
		await request.get(
			`/api/admin/invoices/po-balance?order_uid=${encodeURIComponent(clientUid)}`
		)
	);
	expect(balance.data.exists).toBe(true);
	expect(Number(balance.data.remaining_balance)).toBe(
		CREATED_ORDERS.client.net - INVOICE_LINK.secondTotal
	);

	// A supplier order is refused as a client-invoice reference, and the
	// refusal leaves no invoice row behind.
	const refused = await request.post('/api/admin/invoices', {
		data: {
			invoice_number: `${PREFIX}INV-REFUSED`,
			invoice_date: `${MONTH}-21`,
			client_name: `${PREFIX} Refused Client`,
			order_uid: supplierUid,
			items: [],
			line_items: [],
			total: 111111,
			gst_type: 'cgst_sgst',
			status: 'draft',
		},
	});
	const refusedBody = await apiJson<{ success: boolean; code: string }>(
		refused,
		422
	);
	expect(refusedBody.success).toBe(false);
	expect(refusedBody.code).toBe('order_not_client');

	const refusedRows = await rows<{ n: number }>(
		`SELECT COUNT(*) AS n FROM invoices WHERE invoice_number = ?`,
		[`${PREFIX}INV-REFUSED`]
	);
	expect(Number(refusedRows[0].n)).toBe(0);
	const supplierAfter = await dbOrder(CREATED_ORDERS.supplier.number);
	expect(supplierAfter.client_invoiced_value).toBeNull();

	// Deleting the invoice reverses the rollup.
	await apiJson(
		await request.delete(`/api/admin/invoices/${invoiceId}`)
	);
	const reversed = await dbOrder(CREATED_ORDERS.client.number);
	expect(Number(reversed.client_invoiced_value)).toBe(0);

	evidence.invoiceLink = {
		orderUid: clientUid,
		firstTotal: INVOICE_LINK.firstTotal,
		secondTotal: INVOICE_LINK.secondTotal,
		refusedCode: refusedBody.code,
	};
});

test('keeps order money and its client rollup at cent precision', async ({
	page,
	request,
}) => {
	// A stated net carrying cents: whole-unit rounding would store 250001 and
	// drift from the invoices that follow.
	const created = await apiJson<{ success: boolean; data: OrderRecord }>(
		await request.post('/api/admin/orders', {
			data: {
				direction: 'client',
				order_number: CREATED_ORDERS.centsClient.number,
				counterparty_name: CREATED_ORDERS.centsClient.counterparty,
				project_id: seeded.projectId,
				currency: CREATED_ORDERS.centsClient.currency,
				amount_basis: CREATED_ORDERS.centsClient.basis,
				net_amount: CREATED_ORDERS.centsClient.net,
				tax_amount: CREATED_ORDERS.centsClient.tax,
				gross_amount: CREATED_ORDERS.centsClient.gross,
				order_date: CREATED_ORDERS.centsClient.orderDate,
				status: CREATED_ORDERS.centsClient.status,
				firmness: CREATED_ORDERS.centsClient.firmness,
			},
		})
	);
	const uid = created.data.orderUid;

	const stored = await dbOrder(CREATED_ORDERS.centsClient.number);
	expect(Number(stored.net_amount)).toBe(CREATED_ORDERS.centsClient.net);
	expect(Number(stored.gross_amount)).toBe(CREATED_ORDERS.centsClient.gross);
	expect(Number(stored.tax_amount)).toBe(CREATED_ORDERS.centsClient.tax);

	// The native order screen shows the cents in the row and the Project total.
	await page.goto(`/admin/orders?project_id=${seeded.projectId}`);
	const row = page.locator(
		`[data-testid="order-row"][data-order-number="${CREATED_ORDERS.centsClient.number}"]`
	);
	await expect(row.getByTestId('order-row-value')).toHaveAttribute(
		'data-amount',
		String(CREATED_ORDERS.centsClient.net)
	);
	const clientTotalRow = page.locator(
		'[data-testid="client-order-total-row"][data-currency="INR"][data-basis="net"]'
	);
	await expect(clientTotalRow).toHaveAttribute(
		'data-amount',
		String(CLIENT_ORDER_TOTAL)
	);

	// Two equal cent invoices roll up to exactly 66666.66, not whole-unit
	// 66666, and the remaining value is stated minus that rollup.
	for (const number of [CENTS_INVOICES.first, CENTS_INVOICES.second]) {
		await apiJson(
			await request.post('/api/admin/invoices', {
				data: {
					invoice_number: number,
					invoice_date: `${MONTH}-22`,
					client_name: ORDER_PROJECT.client,
					order_uid: uid,
					po_number: CREATED_ORDERS.centsClient.number,
					items: [],
					line_items: [],
					total: CENTS_INVOICES.total,
					gst_type: 'cgst_sgst',
					status: 'sent',
				},
			})
		);
	}

	const linked = await dbOrder(CREATED_ORDERS.centsClient.number);
	expect(Number(linked.client_invoiced_value)).toBe(66666.66);
	// 250000.75 − 2 × 33333.33, stated independently of the module's math.
	const remaining = 184034.09;
	const balance = await apiJson<{
		success: boolean;
		data: { remaining_balance: number | null };
	}>(
		await request.get(
			`/api/admin/invoices/po-balance?order_uid=${encodeURIComponent(uid)}`
		)
	);
	expect(Number(balance.data.remaining_balance)).toBe(remaining);

	// Deleting both invoices restores the rollup to a known zero.
	const invoiceRows = await rows<{ id: number }>(
		`SELECT id FROM invoices WHERE invoice_number LIKE ? AND isDelete = 0`,
		[`${PREFIX}INV-CENTS-%`]
	);
	expect(invoiceRows).toHaveLength(2);
	for (const invoice of invoiceRows) {
		await apiJson(
			await request.delete(`/api/admin/invoices/${invoice.id}`)
		);
	}
	const reversed = await dbOrder(CREATED_ORDERS.centsClient.number);
	expect(Number(reversed.client_invoiced_value)).toBe(0);

	recordCreated(uid, CREATED_ORDERS.centsClient.number, 'api');
	evidence.centPrecision = {
		orderUid: uid,
		net: Number(stored.net_amount),
		invoicedAfterTwoInvoices: Number(linked.client_invoiced_value),
		remaining,
		reversed: Number(reversed.client_invoiced_value),
	};
});

test('shows canonical orders on the Project tab and keeps the legacy copies intact', async ({
	page,
	request,
}) => {
	await page.goto(`/projects/${seeded.projectId}`);
	await page.locator('#tab-purchase_order').click();
	const panel = page.getByTestId('project-orders-panel');
	await expect(panel).toBeVisible();

	// Client value (commercial context) and supplier order values are shown
	// separately, with the supplier note that order value is not cost. The
	// client total carries both client orders including their cents.
	const clientTotal = panel.getByTestId('project-client-order-total');
	await expect(clientTotal).toHaveAttribute(
		'data-amount',
		String(CLIENT_ORDER_TOTAL)
	);
	const supplierNet = panel.getByTestId('project-supplier-order-total-net');
	await expect(supplierNet).toHaveAttribute(
		'data-amount',
		String(
			CREATED_ORDERS.supplier.net + LEGACY_AMOUNTS.purchaseOrder
		)
	);
	const supplierGross = panel.getByTestId('project-supplier-order-total-gross');
	await expect(supplierGross).toHaveAttribute(
		'data-amount',
		String(LEGACY_AMOUNTS.projectPoGross)
	);
	await expect(
		panel.getByTestId('project-supplier-commitment-note')
	).toBeVisible();

	// The panel lists canonical orders only: the duplicate representation did
	// not become an extra order row.
	const rowsInPanel = panel.getByTestId('project-order-row');
	const projectOrders = await listOrders(request, {
		project_id: String(seeded.projectId),
	});
	await expect(rowsInPanel).toHaveCount(projectOrders.orders.length);

	evidence.projectTab = {
		client: CREATED_ORDERS.client.net,
		supplierNet:
			CREATED_ORDERS.supplier.net + LEGACY_AMOUNTS.purchaseOrder,
		supplierGross: LEGACY_AMOUNTS.projectPoGross,
		rows: projectOrders.orders.length,
	};
});

test('attaches a source document to a canonical order', async ({ page }) => {
	await page.goto('/admin/orders');
	const row = page.locator(
		`[data-testid="order-row"][data-order-number="${CREATED_ORDERS.supplier.number}"]`
	);
	await row.getByTestId('order-row-open').click();
	const detail = page.getByTestId('order-detail');
	await expect(detail).toBeVisible();
	await detail
		.locator('input[type="file"]')
		.setInputFiles({
			name: `${PREFIX}SUP-1.pdf`,
			mimeType: 'application/pdf',
			buffer: Buffer.from(
				'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF\n'
			),
		});
	await expect(detail.getByText(`${PREFIX}SUP-1.pdf`)).toBeVisible();

	const stored = await dbOrder(CREATED_ORDERS.supplier.number);
	const docs = await rows<Record<string, unknown>>(
		`SELECT * FROM entity_documents WHERE entity_type = 'order' AND entity_id = ?`,
		[Number(stored.id)]
	);
	expect(docs).toHaveLength(1);
	expect(docs[0].original_name).toBe(`${PREFIX}SUP-1.pdf`);

	evidence.sourceDocument = {
		entityType: docs[0].entity_type,
		entityId: docs[0].entity_id,
		name: docs[0].original_name,
	};
});

test('refuses order writes and review decisions without order write permission', async ({
	playwright,
	request,
}) => {
	const viewer = await loginOrderViewer(playwright, E2E_ENV.baseURL);
	try {
		const read = await viewer.get('/api/admin/orders');
		const readBody = await apiJson<{ success: boolean }>(read);
		expect(readBody.success).toBe(true);

		const write = await viewer.post('/api/admin/orders', {
			data: {
				direction: 'supplier',
				order_number: `${PREFIX}FORBIDDEN`,
				counterparty_name: ORDER_SUPPLIER,
				amount_basis: 'unknown',
			},
		});
		expect(write.status()).toBe(403);

		const queue = await reviewQueue(request);
		const resolved = queue.items.find(
			(item) =>
				item.documentNumber?.startsWith(PREFIX) &&
				item.reviewState === 'resolved'
		)!;
		const review = await viewer.post('/api/admin/orders/review', {
			data: {
				mapping_id: resolved.mappingId,
				decision: 'classify',
				expected_version: resolved.version,
				reason: 'E2E-EXP-310 forbidden',
				evidence_reference: 'E2E-EXP-310-DOC-FORBIDDEN',
				direction: 'client',
				counterparty_name: PROJECT.client,
				amount_basis: 'net',
				net_amount: 1,
			},
		});
		expect(review.status()).toBe(403);

		const forbidden = await rows<{ n: number }>(
			`SELECT COUNT(*) AS n FROM orders WHERE order_number = ?`,
			[`${PREFIX}FORBIDDEN`]
		);
		expect(Number(forbidden[0].n)).toBe(0);
		authorizationEvidence.read = read.status();
		authorizationEvidence.write = write.status();
		authorizationEvidence.review = review.status();
	} finally {
		await viewer.dispose();
	}

	// An identity with no role at all is refused even the read.
	const employee = await playwright.request.newContext({
		baseURL: E2E_ENV.baseURL,
		storageState: 'e2e/.auth/employee.json',
		extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.25' },
	});
	try {
		const denied = await employee.get('/api/admin/orders');
		expect(denied.status()).toBe(403);
		authorizationEvidence.employeeRead = denied.status();
	} finally {
		await employee.dispose();
	}
	evidence.authorization = authorizationEvidence;
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	await expect
		.poll(async () => {
			const found = await rows<{ n: number }>(
				`SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?`,
				[`${PREFIX}%`]
			);
			return Number(found[0].n);
		})
		.toBe(7);
});
