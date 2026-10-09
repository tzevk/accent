import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	ACCRUAL_CONSUMPTION_INVOICE_PREFIX,
	ACCRUAL_CONSUMPTION_MONTH,
	ACCRUAL_CONSUMPTION_NEXT_MONTH,
	ACCRUAL_CONSUMPTION_PREFIX,
	ACCRUAL_CONSUMPTION_PROJECT_CODE,
	ACCRUAL_CONSUMPTION_SPEC_IP,
	cleanupAccrualConsumptionFixtures,
	linkedAccrual,
	loginAccrualConsumptionRestricted,
	seedAccrualConsumptionFixtures,
	transferInvoice,
	type SeededAccrualConsumption,
} from '../lib/accrual-consumption-fixtures';

/**
 * Ticket #314 — recognized Cost Accruals consume their supplier order, and an
 * invoice replacement transfers that consumption instead of duplicating or
 * dropping it.
 *
 * Every expected amount is stated here from the fixture literals and the
 * parent rules, never from the report module's own aggregation: #312 owns the
 * consumption rule (native slice amounts, one currency + tax basis pair), and
 * #313 owns replacement and the remaining-slice reader. This slice only wires
 * the two together in one transaction per act. Persisted state is asserted
 * through `e2e/lib/db.ts`, never through the app's own aggregation.
 *
 * Reserved scope: months 2018-10/2018-11, projects `E2E-314-P*`, accruals
 * `E2E-314-*`, invoices `E2E-314-INV-*`, cost identities `e2e-314-*`, users
 * `e2e_314_*`. No other spec seeds there.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': ACCRUAL_CONSUMPTION_SPEC_IP },
});
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const MONTH = ACCRUAL_CONSUMPTION_MONTH;
const NEXT_MONTH = ACCRUAL_CONSUMPTION_NEXT_MONTH;

/** The accrual the browser captures with an order link and recognizes. */
const UI_ACCRUAL = {
	description: `${ACCRUAL_CONSUMPTION_PREFIX}received work UI (25000 estimate)`,
	gross: 25000,
	tax: 0,
	recognized: 25000,
	serviceStart: `${MONTH}-01`,
	serviceEnd: `${MONTH}-28`,
	sourceReference: `${ACCRUAL_CONSUMPTION_PREFIX}UI-SRC-9010`,
	evidenceReference: `${ACCRUAL_CONSUMPTION_PREFIX}UI-EV-9010`,
} as const;

interface CommitmentDetailJson {
	order: {
		orderUid: string;
		orderNumber: string;
		amountBasis: string;
		currency: string;
		status: string;
		financialVersion: number;
	};
	consumptions: Array<{
		id: number;
		costUid: string;
		amount: number;
		taxBasis: string;
		currency: string;
		recognizedPeriod: string;
		state: string;
		version: number;
		effective: boolean;
		costSource: string;
		source: string;
		reason: string | null;
		releaseReason: string | null;
	}>;
	effectiveConsumption: number;
	remainingCommitment: number | null;
}

interface CommitmentSectionJson {
	month: string;
	totals: Array<{
		currency: string;
		basis: string;
		months: Array<{
			month: string;
			opening: number;
			newCommitment: number;
			consumption: number;
			cancellation: number;
			closing: number;
		}>;
		closingCommitment: number;
		consumptionInMonth: number;
		unconsumedOrderCount: number;
	}>;
	orders: Array<{
		orderUid: string;
		orderNumber: string;
		value: number | null;
		consumption: number;
		remaining: number | null;
		status: string;
	}>;
}

interface ReconciliationJson {
	month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
	};
	projects: Array<{
		project_code: string;
		currency: string;
		incurred_cost: number;
	}>;
	supplier_commitment: CommitmentSectionJson;
}

let seeded: SeededAccrualConsumption;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
/** Accrual ids this spec records through the app, removed on teardown. */
const createdAccrualIds: number[] = [];

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('accrual-consumption', {
		...evidence,
		fixtureScope: {
			project: ACCRUAL_CONSUMPTION_PROJECT_CODE,
			accrualPrefix: ACCRUAL_CONSUMPTION_PREFIX,
			invoicePrefix: ACCRUAL_CONSUMPTION_INVOICE_PREFIX,
			months: [MONTH, NEXT_MONTH],
		},
		createdThroughApp: { accruals: createdAccrualIds },
	});
}

async function apiJson<T>(
	response: APIResponse,
	expectStatus = 200
): Promise<T> {
	const body = await response.json();
	expect(response.status(), JSON.stringify(body)).toBe(expectStatus);
	return body as T;
}

async function accrualCommand(
	request: APIRequestContext,
	id: number,
	payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post(
		`/api/admin/cost-accruals/${id}/commands`,
		{ data: payload }
	);
	return { status: response.status(), body: await response.json() };
}

async function accrualReplacement(
	request: APIRequestContext,
	id: number,
	payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post(
		`/api/admin/cost-accruals/${id}/replacements`,
		{ data: payload }
	);
	return { status: response.status(), body: await response.json() };
}

async function captureAccrual(
	request: APIRequestContext,
	payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post('/api/admin/cost-accruals', {
		data: payload,
	});
	return { status: response.status(), body: await response.json() };
}

async function invoiceCommand(
	request: APIRequestContext,
	id: number,
	payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post(
		`/api/admin/purchase-invoices/${id}/commands`,
		{ data: payload }
	);
	return { status: response.status(), body: await response.json() };
}

async function commitment(
	request: APIRequestContext,
	orderUid: string
): Promise<CommitmentDetailJson> {
	const body = await apiJson<{ success: boolean; data: CommitmentDetailJson }>(
		await request.get(
			`/api/admin/orders/${encodeURIComponent(orderUid)}/commitment`
		)
	);
	expect(body.success).toBe(true);
	return body.data;
}

async function reconciliation(
	request: APIRequestContext,
	month: string
): Promise<ReconciliationJson> {
	const body = await apiJson<{ success: boolean; data: ReconciliationJson }>(
		await request.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${month}`
		)
	);
	expect(body.success).toBe(true);
	return body.data;
}

function projectRow(data: ReconciliationJson, code: string) {
	const found = data.projects.find((row) => row.project_code === code);
	expect(found, `project row ${code}`).toBeTruthy();
	return found!;
}

function bucket(
	section: CommitmentSectionJson,
	currency: string,
	basis: string
) {
	const found = section.totals.find(
		(total) => total.currency === currency && total.basis === basis
	);
	expect(
		found,
		`expected a ${currency}/${basis} bucket in ${JSON.stringify(
			section.totals.map((total) => `${total.currency}|${total.basis}`)
		)}`
	).toBeTruthy();
	return found!;
}

function monthRow(
	total: NonNullable<ReturnType<typeof bucket>>,
	month: string
) {
	const found = total.months.find((entry) => entry.month === month);
	expect(found, `month row ${month}`).toBeTruthy();
	return found!;
}

async function dbConsumptions(
	orderUid: string
): Promise<Array<Record<string, unknown>>> {
	return rows<Record<string, unknown>>(
		`SELECT * FROM order_consumptions WHERE order_uid = ? ORDER BY id ASC`,
		[orderUid]
	);
}

async function dbAccrual(id: number): Promise<Record<string, unknown>> {
	const found = await rows<Record<string, unknown>>(
		`SELECT id, recognition_state, recognized_amount, replaced_amount,
            financial_version, order_uid, cost_uid
       FROM cost_accruals WHERE id = ?`,
		[id]
	);
	expect(found.length, `expected accrual ${id}`).toBe(1);
	return found[0];
}

async function openOrderInBrowser(
	page: Page,
	orderNumber: string
): Promise<void> {
	await page.goto('/admin/orders');
	const row = page.locator(
		`[data-testid="order-row"][data-order-number="${orderNumber}"]`
	);
	await expect(row).toBeVisible();
	await row.getByTestId('order-row-open').click();
	await expect(page.getByTestId('order-commitment')).toBeVisible();
}

test.beforeAll(async () => {
	seeded = await seedAccrualConsumptionFixtures();
	evidence.seeded = {
		projectId: seeded.projectId,
		orders: Object.keys(seeded.orderUids).length,
		accruals: Object.keys(seeded.accrualIds).length,
		invoices: Object.keys(seeded.invoiceIds).length,
	};
});

test.afterAll(async () => {
	publish();
	if (createdAccrualIds.length) {
		const placeholders = createdAccrualIds.map(() => '?').join(', ');
		await exec(
			`DELETE FROM order_consumption_events WHERE cost_uid IN (SELECT cost_uid FROM cost_accruals WHERE id IN (${placeholders}))`,
			createdAccrualIds
		);
		await exec(
			`DELETE FROM order_consumptions WHERE cost_uid IN (SELECT cost_uid FROM cost_accruals WHERE id IN (${placeholders}))`,
			createdAccrualIds
		);
		await exec(
			`DELETE FROM cost_accrual_replacements WHERE accrual_id IN (${placeholders})`,
			createdAccrualIds
		);
		await exec(
			`DELETE FROM financial_cost_events WHERE source_table = 'cost_accruals' AND source_id IN (${placeholders})`,
			createdAccrualIds
		);
		await exec(
			`DELETE FROM financial_cost_links WHERE source_table = 'cost_accruals' AND source_id IN (${placeholders})`,
			createdAccrualIds.map(String)
		);
		await exec(
			`DELETE FROM cost_accruals WHERE id IN (${placeholders})`,
			createdAccrualIds
		);
	}
	await cleanupAccrualConsumptionFixtures();
});

test('recognizing a linked accrual records its remaining slice as order consumption', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const result = await accrualCommand(request, seeded.accrualIds['A1'], {
		command: 'recognize',
		expected_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const data = result.body.data as Record<string, unknown>;
	expect(data.recognition_state).toBe('recognized');
	expect(data.recognized_amount).toBe(100000);
	expect(data.financial_version).toBe(2);
	// #314 wires recognition to #312's consumption: the composition outcome
	// travels on the command result.
	const consumption = data.consumption as Record<string, unknown>;
	expect(consumption.order_uid).toBe(orderUid);
	expect(consumption.amount).toBe(100000);
	expect(consumption.recognized_period).toBe(`${MONTH}-01`);
	expect(consumption.source).toBe('accrual');

	const stored = await dbAccrual(seeded.accrualIds['A1']);
	expect(stored.recognition_state).toBe('recognized');
	expect(Number(stored.recognized_amount)).toBe(100000);

	const consumptions = await dbConsumptions(orderUid);
	expect(consumptions).toHaveLength(1);
	expect(consumptions[0].cost_uid).toBe(linkedAccrual('A1').costUid);
	expect(Number(consumptions[0].amount)).toBe(100000);
	expect(consumptions[0].tax_basis).toBe('gross');
	expect(consumptions[0].currency).toBe('INR');
	expect(consumptions[0].source).toBe('accrual');
	expect(consumptions[0].state).toBe('active');
	expect(String(consumptions[0].recognized_period)).toContain(MONTH);

	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(100000);
	expect(detail.remainingCommitment).toBe(200000);
	evidence.recognize = {
		consumptionId: consumptions[0].id,
		remaining: detail.remainingCommitment,
	};
});

test('captures and recognizes a linked accrual through the admin browser controls', async ({
	page,
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	await page.goto('/admin/cost-accrual');
	await page.getByTestId('accrual-capture-open').click();
	await expect(page.getByTestId('accrual-capture-form')).toBeVisible();
	await page.getByTestId('accrual-description').fill(UI_ACCRUAL.description);
	await page.getByTestId('accrual-vendor').fill('E2E-314 Vendor UI');
	await page
		.getByTestId('accrual-evidence-basis')
		.selectOption('received_work');
	await page.getByTestId('accrual-service-start').fill(UI_ACCRUAL.serviceStart);
	await page.getByTestId('accrual-service-end').fill(UI_ACCRUAL.serviceEnd);
	await page.getByTestId('accrual-classification').selectOption('project');
	await page
		.getByTestId('accrual-project')
		.selectOption(String(seeded.projectId));
	await page.getByTestId('accrual-gross').fill(String(UI_ACCRUAL.gross));
	await page.getByTestId('accrual-tax').fill(String(UI_ACCRUAL.tax));
	await page.getByTestId('accrual-tax-treatment').selectOption('none');
	await page.getByTestId('accrual-currency').fill('INR');
	await page
		.getByTestId('accrual-source-reference')
		.fill(UI_ACCRUAL.sourceReference);
	await page
		.getByTestId('accrual-evidence-reference')
		.fill(UI_ACCRUAL.evidenceReference);
	// The entry control links the estimate to its supplier order.
	await page.getByTestId('accrual-order').fill(orderUid);
	const capturePosted = page.waitForResponse(
		(response) =>
			response.url().includes('/api/admin/cost-accruals') &&
			response.request().method() === 'POST'
	);
	await page.getByTestId('accrual-capture-submit').click();
	const captureResponse = await capturePosted;
	expect(captureResponse.status(), await captureResponse.text()).toBe(201);
	await expect(page.getByTestId('accrual-capture-form')).toBeHidden();

	const created = await rows<{ id: number; accrual_number: string }>(
		`SELECT id, accrual_number FROM cost_accruals
      WHERE description = ? AND isDelete = 0`,
		[UI_ACCRUAL.description]
	);
	expect(created.length, 'browser-created accrual row').toBe(1);
	createdAccrualIds.push(created[0].id);

	await page.goto('/admin/cost-accrual');
	const openButton = page.getByTestId(
		`accrual-open-${created[0].accrual_number}`
	);
	await expect(openButton).toBeVisible();
	await openButton.click();
	await expect(page.getByTestId('accrual-recognition-dialog')).toBeVisible();
	// The dialog states the order the estimate will consume.
	await expect(page.getByTestId('accrual-order-link')).toContainText(orderUid);
	await page.getByTestId('accrual-submit').click();
	await expect(page.getByTestId('accrual-state')).toContainText(
		'Pending evidence'
	);
	await page.getByTestId('accrual-recognize').click();
	await expect(page.getByTestId('accrual-state')).toContainText('Recognized');

	const stored = await dbAccrual(created[0].id);
	expect(stored.recognition_state).toBe('recognized');
	expect(Number(stored.recognized_amount)).toBe(UI_ACCRUAL.recognized);
	expect(stored.order_uid).toBe(orderUid);

	const uiCostUid = (
		await rows<{ cost_uid: string }>(
			`SELECT cost_uid FROM cost_accruals WHERE id = ?`,
			[created[0].id]
		)
	)[0].cost_uid;
	const consumptions = await dbConsumptions(orderUid);
	const uiRow = consumptions.find((entry) => entry.cost_uid === uiCostUid);
	expect(uiRow, 'browser-recognized accrual consumption').toBeTruthy();
	expect(Number(uiRow!.amount)).toBe(UI_ACCRUAL.recognized);

	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(125000);
	expect(detail.remainingCommitment).toBe(175000);
	evidence.browser = { accrualId: created[0].id, recognized: 25000 };
});

test('recognizing two more linked estimates consumes the order down to its remainder', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	for (const key of ['A2', 'A3'] as const) {
		const result = await accrualCommand(request, seeded.accrualIds[key], {
			command: 'recognize',
			expected_version: 1,
		});
		expect(result.status, JSON.stringify(result.body)).toBe(200);
		const data = result.body.data as Record<string, unknown>;
		expect(
			(data.consumption as Record<string, unknown>).amount,
			`consumption for ${key}`
		).toBe(key === 'A2' ? 50000 : 30000);
	}
	const detail = await commitment(request, orderUid);
	// 100000 + 25000 + 50000 + 30000 received work against a 300000 order.
	expect(detail.effectiveConsumption).toBe(205000);
	expect(detail.remainingCommitment).toBe(95000);
});

test('recognition refuses when the linked order cannot cover the estimate', async ({
	request,
}) => {
	const smallUid = seeded.orderUids['ORD-3002'];
	const before = await rows<Record<string, unknown>>(
		`SELECT financial_version FROM orders WHERE order_uid = ?`,
		[smallUid]
	);
	const result = await accrualCommand(request, seeded.accrualIds['A4'], {
		command: 'recognize',
		expected_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(422);
	expect(result.body.code).toBe('consumption_exceeds_commitment');

	// The refusal writes nothing: the estimate stays a draft at version 1,
	// the order version is untouched, and no consumption row exists.
	const stored = await dbAccrual(seeded.accrualIds['A4']);
	expect(stored.recognition_state).toBe('draft');
	expect(Number(stored.financial_version)).toBe(1);
	const after = await rows<Record<string, unknown>>(
		`SELECT financial_version FROM orders WHERE order_uid = ?`,
		[smallUid]
	);
	expect(Number(after[0].financial_version)).toBe(
		Number(before[0].financial_version)
	);
	const consumptions = await rows<Record<string, unknown>>(
		`SELECT id FROM order_consumptions WHERE cost_uid = ?`,
		[linkedAccrual('A4').costUid]
	);
	expect(consumptions).toHaveLength(0);
	evidence.exceedsRefusal = result.body.code;
});

test('October states every recognized estimate once, drafts never', async ({
	request,
}) => {
	const october = await reconciliation(request, MONTH);
	// Estimates: A1 100000 + UI 25000 + A2 50000 + A3 30000. Actuals already
	// recognized: I1 60000 + I4 50000 + I5a 20000 + I5b 20000. All Project P1,
	// all INR. Drafts (A4, A5) never count.
	expect(october.company.incurred_cost).toBe(355000);
	expect(
		projectRow(october, ACCRUAL_CONSUMPTION_PROJECT_CODE).incurred_cost
	).toBe(355000);
});

test('partial replacement moves the matched amount to the invoice and keeps the remainder', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const result = await accrualReplacement(request, seeded.accrualIds['A1'], {
		invoice_id: seeded.invoiceIds['I1'],
		final: false,
		reason: `${ACCRUAL_CONSUMPTION_PREFIX}partial transfer to October invoice`,
		evidence_reference: `${ACCRUAL_CONSUMPTION_PREFIX}TR-EV-9101`,
		expected_accrual_version: 2,
		expected_invoice_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const data = result.body.data as Record<string, unknown>;
	expect(data.replaced_amount).toBe(60000);
	expect(data.accrual_remaining_amount).toBe(40000);
	expect(data.final).toBe(false);
	const consumption = data.consumption as Record<string, unknown>;
	expect(consumption.order_uid).toBe(orderUid);
	expect(consumption.transferred_amount).toBe(60000);

	const stored = await dbAccrual(seeded.accrualIds['A1']);
	expect(Number(stored.recognized_amount)).toBe(40000);
	expect(Number(stored.financial_version)).toBe(3);

	// One commitment event survives replacement: the replaced 60000 moves
	// from the accrual cost to the invoice cost, the 40000 remainder stays.
	const consumptions = await dbConsumptions(orderUid);
	const released = consumptions.filter(
		(entry) => entry.cost_uid === linkedAccrual('A1').costUid
	);
	expect(released.filter((entry) => entry.state === 'released')).toHaveLength(
		1
	);
	expect(released.filter((entry) => entry.state === 'active')).toHaveLength(1);
	expect(
		Number(released.find((entry) => entry.state === 'active')!.amount)
	).toBe(40000);
	const invoiceRows = consumptions.filter(
		(entry) => entry.cost_uid === transferInvoice('I1').costUid
	);
	expect(invoiceRows.filter((entry) => entry.state === 'active')).toHaveLength(
		1
	);
	expect(Number(invoiceRows[0].amount)).toBe(60000);
	expect(String(invoiceRows[0].recognized_period)).toContain(MONTH);
	expect(invoiceRows[0].source).toBe('invoice');

	const releaseRow = released.find((entry) => entry.state === 'released')!;
	expect(String(releaseRow.release_reason)).toContain('replacement');
	expect(releaseRow.release_evidence_reference).toBeTruthy();

	const journal = await rows<{ event: string }>(
		`SELECT event FROM order_consumption_events
      WHERE order_uid = ? AND (cost_uid = ? OR cost_uid = ?)
      ORDER BY id`,
		[orderUid, linkedAccrual('A1').costUid, transferInvoice('I1').costUid]
	);
	expect(journal.map((entry) => entry.event)).toEqual([
		'recorded',
		'released',
		'recorded',
		'recorded',
	]);

	// The consumed total is preserved: nothing doubled, nothing restored.
	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(205000);
	expect(detail.remainingCommitment).toBe(95000);
	evidence.partial = { replaced: 60000, remainder: 40000 };
});

test('final replacement into another month consumes the invoice in its own period', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const result = await accrualReplacement(request, seeded.accrualIds['A1'], {
		invoice_id: seeded.invoiceIds['I2'],
		final: true,
		reason: `${ACCRUAL_CONSUMPTION_PREFIX}final transfer to November invoice`,
		evidence_reference: `${ACCRUAL_CONSUMPTION_PREFIX}TR-EV-9102`,
		expected_accrual_version: 3,
		expected_invoice_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const data = result.body.data as Record<string, unknown>;
	expect(data.replaced_amount).toBe(40000);
	expect(data.accrual_remaining_amount).toBe(0);
	expect(data.final).toBe(true);

	const stored = await dbAccrual(seeded.accrualIds['A1']);
	expect(Number(stored.recognized_amount)).toBe(0);
	expect(Number(stored.financial_version)).toBe(4);

	const consumptions = await dbConsumptions(orderUid);
	const accrualRows = consumptions.filter(
		(entry) => entry.cost_uid === linkedAccrual('A1').costUid
	);
	expect(accrualRows.filter((entry) => entry.state === 'active')).toHaveLength(
		0
	);
	const invoiceRows = consumptions.filter(
		(entry) => entry.cost_uid === transferInvoice('I2').costUid
	);
	expect(invoiceRows).toHaveLength(1);
	expect(Number(invoiceRows[0].amount)).toBe(40000);
	expect(String(invoiceRows[0].recognized_period)).toContain(NEXT_MONTH);

	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(205000);
	expect(detail.remainingCommitment).toBe(95000);
	evidence.final = { replaced: 40000, period: `${NEXT_MONTH}-01` };
});

test('a foreign-currency actual releases the estimate without consuming another currency', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const result = await accrualReplacement(request, seeded.accrualIds['A3'], {
		invoice_id: seeded.invoiceIds['I3'],
		final: true,
		difference_reason: `${ACCRUAL_CONSUMPTION_PREFIX}USD actual below the INR estimate`,
		difference_period: `${NEXT_MONTH}-01`,
		evidence_reference: `${ACCRUAL_CONSUMPTION_PREFIX}FX-EV-9103`,
		reason: `${ACCRUAL_CONSUMPTION_PREFIX}FX final replacement`,
		expected_accrual_version: 2,
		expected_invoice_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const data = result.body.data as Record<string, unknown>;
	expect(data.replaced_amount).toBe(30000);
	expect(data.final).toBe(true);
	const consumption = data.consumption as Record<string, unknown>;
	// Currencies are never mixed: the INR estimate leaves the order and the
	// USD invoice is explicitly left unconsumed, with its variance explained
	// on the replacement row.
	expect(consumption.released_amount).toBe(30000);
	expect((consumption.skipped_invoice as Record<string, unknown>).code).toBe(
		'invoice_currency_unconsumed'
	);

	const consumptions = await dbConsumptions(orderUid);
	expect(
		consumptions.filter(
			(entry) =>
				entry.cost_uid === transferInvoice('I3').costUid &&
				entry.state === 'active'
		)
	).toHaveLength(0);
	expect(
		consumptions.filter(
			(entry) =>
				entry.cost_uid === linkedAccrual('A3').costUid &&
				entry.state === 'active'
		)
	).toHaveLength(0);

	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(175000);
	expect(detail.remainingCommitment).toBe(125000);
	evidence.fx = { released: 30000, skipped: 'invoice_currency_unconsumed' };
});

test('cancelling the foreign invoice restores the estimate and its consumption', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const cancelled = await invoiceCommand(request, seeded.invoiceIds['I3'], {
		command: 'cancel',
		expected_version: 1,
		reason: `${ACCRUAL_CONSUMPTION_PREFIX}lifecycle: USD invoice cancelled`,
		evidence_reference: `${ACCRUAL_CONSUMPTION_PREFIX}CANCEL-EV-9103`,
	});
	expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

	const stored = await dbAccrual(seeded.accrualIds['A3']);
	expect(Number(stored.recognized_amount)).toBe(30000);
	expect(Number(stored.replaced_amount)).toBe(0);

	// The restored remainder consumes again: no committed state counts the
	// cancelled invoice and the restored estimate together, and none of the
	// received-work cost silently disappears.
	const consumptions = await dbConsumptions(orderUid);
	const restored = consumptions.filter(
		(entry) =>
			entry.cost_uid === linkedAccrual('A3').costUid && entry.state === 'active'
	);
	expect(restored).toHaveLength(1);
	expect(Number(restored[0].amount)).toBe(30000);
	expect(String(restored[0].recognized_period)).toContain(MONTH);

	const releaseRows = await rows<Record<string, unknown>>(
		`SELECT state FROM cost_accrual_replacements WHERE accrual_id = ? AND invoice_id = ?`,
		[seeded.accrualIds['A3'], seeded.invoiceIds['I3']]
	);
	expect(releaseRows[0].state).toBe('released');

	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(205000);
	expect(detail.remainingCommitment).toBe(95000);
	evidence.cancelRestore = { restored: 30000 };
});

test('recognizing the last estimate keeps the order exactly covered', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const result = await accrualCommand(request, seeded.accrualIds['A5'], {
		command: 'recognize',
		expected_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(225000);
	expect(detail.remainingCommitment).toBe(75000);
});

test('concurrent replacements transfer once and refuse the loser without writes', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const accrualId = seeded.accrualIds['A5'];
	const attempt = (invoiceKey: 'I5a' | 'I5b') =>
		accrualReplacement(request, accrualId, {
			invoice_id: seeded.invoiceIds[invoiceKey],
			final: false,
			expected_accrual_version: 2,
			expected_invoice_version: 1,
		});
	const [first, second] = await Promise.all([attempt('I5a'), attempt('I5b')]);
	const statuses = [first.status, second.status].sort();
	expect(statuses).toEqual([200, 409]);
	const winner = first.status === 200 ? first : second;
	expect((winner.body.data as Record<string, unknown>).replaced_amount).toBe(
		20000
	);
	const loser = first.status === 200 ? second : first;
	expect(loser.body.code).toBe('version_conflict');

	// Exactly one transfer happened: the accrual row is released once, one
	// invoice holds the active consumption, and the consumed total is intact.
	const consumptions = await dbConsumptions(orderUid);
	const accrualRows = consumptions.filter(
		(entry) => entry.cost_uid === linkedAccrual('A5').costUid
	);
	expect(accrualRows.filter((entry) => entry.state === 'active')).toHaveLength(
		0
	);
	const winnerKeys = ['I5a', 'I5b'].filter((key) =>
		consumptions.some(
			(entry) =>
				entry.cost_uid === transferInvoice(key).costUid &&
				entry.state === 'active'
		)
	);
	expect(winnerKeys).toHaveLength(1);
	const stored = await dbAccrual(accrualId);
	expect(Number(stored.financial_version)).toBe(3);

	const replacements = await rows<Record<string, unknown>>(
		`SELECT invoice_id, state FROM cost_accrual_replacements WHERE accrual_id = ?`,
		[accrualId]
	);
	expect(replacements.filter((entry) => entry.state === 'active')).toHaveLength(
		1
	);

	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(225000);
	expect(detail.remainingCommitment).toBe(75000);
	evidence.concurrency = { winner: winnerKeys[0] };
});

test('a stale replacement version fails closed with zero writes', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const orderBefore = await rows<Record<string, unknown>>(
		`SELECT financial_version FROM orders WHERE order_uid = ?`,
		[orderUid]
	);
	const result = await accrualReplacement(request, seeded.accrualIds['A2'], {
		invoice_id: seeded.invoiceIds['I4'],
		final: false,
		expected_accrual_version: 1,
		expected_invoice_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(409);
	expect(result.body.code).toBe('version_conflict');

	const stored = await dbAccrual(seeded.accrualIds['A2']);
	expect(Number(stored.financial_version)).toBe(2);
	const replacements = await rows<Record<string, unknown>>(
		`SELECT id FROM cost_accrual_replacements WHERE accrual_id = ? AND invoice_id = ?`,
		[seeded.accrualIds['A2'], seeded.invoiceIds['I4']]
	);
	expect(replacements).toHaveLength(0);
	const orderAfter = await rows<Record<string, unknown>>(
		`SELECT financial_version FROM orders WHERE order_uid = ?`,
		[orderUid]
	);
	expect(Number(orderAfter[0].financial_version)).toBe(
		Number(orderBefore[0].financial_version)
	);
	const untouched = await dbConsumptions(orderUid);
	expect(
		untouched.filter(
			(entry) =>
				entry.cost_uid === linkedAccrual('A2').costUid &&
				entry.state === 'active'
		)
	).toHaveLength(1);
	evidence.staleRefusal = result.body.code;
});

test('authorization keeps recognition, replacement, and consumption behind their privileges', async ({
	playwright,
}) => {
	const baseURL = E2E_ENV.baseURL;
	const restricted = await loginAccrualConsumptionRestricted(
		playwright,
		baseURL
	);
	try {
		const recognized = await accrualCommand(
			restricted,
			seeded.accrualIds['A4'],
			{
				command: 'recognize',
				expected_version: 1,
			}
		);
		expect(recognized.status).toBe(403);

		const replaced = await accrualReplacement(
			restricted,
			seeded.accrualIds['A2'],
			{
				invoice_id: seeded.invoiceIds['I4'],
				final: false,
				expected_accrual_version: 2,
				expected_invoice_version: 1,
			}
		);
		expect(replaced.status).toBe(403);

		const recordResponse = await restricted.post(
			`/api/admin/orders/${encodeURIComponent(seeded.orderUids['ORD-3001'])}/consumption`,
			{
				data: {
					cost_uid: linkedAccrual('A2').costUid,
					recognized_period: `${MONTH}-01`,
					tax_basis: 'gross',
					expected_version: 999,
					expected_source_version: 2,
				},
			}
		);
		expect(recordResponse.status()).toBe(403);

		const stored = await dbAccrual(seeded.accrualIds['A4']);
		expect(stored.recognition_state).toBe('draft');
		evidence.authorization = { recognize: 403, replace: 403, consume: 403 };
	} finally {
		await restricted.dispose();
	}
});

test('the procurement detail shows one coherent order, accrual, and invoice chain', async ({
	page,
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	await openOrderInBrowser(page, `${ACCRUAL_CONSUMPTION_PREFIX}ORD-3001`);
	await expect(page.getByTestId('commitment-remaining')).toHaveAttribute(
		'data-amount',
		'75000'
	);
	const rows = page.getByTestId('order-consumption-row');
	await expect(rows.first()).toBeVisible();
	for (const documentNumber of [
		'E2E-314-9001',
		'E2E-314-9002',
		'E2E-314-INV-9101',
		'E2E-314-INV-9102',
	]) {
		await expect(
			rows.filter({ hasText: documentNumber }).first()
		).toBeVisible();
	}

	const detail = await commitment(request, orderUid);
	const activeSources = detail.consumptions
		.filter((entry) => entry.state === 'active')
		.map((entry) => entry.source)
		.sort();
	expect(activeSources).toEqual([
		'accrual',
		'accrual',
		'accrual',
		'invoice',
		'invoice',
		'invoice',
	]);
	evidence.chain = { activeSources };
});

test('the report states the transferred commitment per month without double count', async ({
	page,
	request,
}) => {
	const october = await reconciliation(request, MONTH);
	// I1 60000 + I4 50000 + I5a 20000 + I5b 20000 + UI 25000 + A2 50000 +
	// A3 30000: the replaced A1 estimate and the replaced/cancelled A5 chain
	// are gone, every remainder and actual counts once.
	expect(october.company.incurred_cost).toBe(255000);
	expect(
		projectRow(october, ACCRUAL_CONSUMPTION_PROJECT_CODE).incurred_cost
	).toBe(255000);
	const november = await reconciliation(request, NEXT_MONTH);
	expect(november.company.incurred_cost).toBe(40000);
	expect(
		projectRow(november, ACCRUAL_CONSUMPTION_PROJECT_CODE).incurred_cost
	).toBe(40000);

	const section = november.supplier_commitment;
	const inr = bucket(section, 'INR', 'gross');
	const octoberRow = monthRow(inr, MONTH);
	// October: both orders open (O1 300000 + O2 10000) and 185000 of
	// received work consumes O1. O2's refused estimate never touches it.
	expect(octoberRow.opening).toBe(0);
	expect(octoberRow.newCommitment).toBe(310000);
	expect(octoberRow.consumption).toBe(185000);
	expect(octoberRow.closing).toBe(125000);
	const novemberRow = monthRow(inr, NEXT_MONTH);
	expect(novemberRow.opening).toBe(125000);
	expect(novemberRow.consumption).toBe(40000);
	expect(novemberRow.closing).toBe(85000);
	expect(inr.closingCommitment).toBe(85000);
	expect(inr.consumptionInMonth).toBe(40000);
	expect(inr.unconsumedOrderCount).toBe(2);
	const orderRow = section.orders.find(
		(entry) => entry.orderUid === seeded.orderUids['ORD-3001']
	);
	expect(orderRow, 'O1 in the report month rows').toBeTruthy();
	expect(orderRow!.consumption).toBe(225000);
	expect(orderRow!.remaining).toBe(75000);
	const smallRow = section.orders.find(
		(entry) => entry.orderUid === seeded.orderUids['ORD-3002']
	);
	expect(smallRow, 'O2 in the report month rows').toBeTruthy();
	expect(smallRow!.consumption).toBe(0);
	expect(smallRow!.remaining).toBe(10000);

	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill('November 2018');
	await page
		.getByRole('button', { name: 'November 2018', exact: true })
		.click();
	await expect(page.getByTestId('expenditure-view')).toHaveAttribute(
		'data-month',
		NEXT_MONTH
	);
	await expect(page.getByTestId('commitment-section')).toBeVisible();
	evidence.report = { october: 255000, november: 40000 };
});

test('an unlinked accrual recognizes without consuming anything', async ({
	request,
}) => {
	const orderUid = seeded.orderUids['ORD-3001'];
	const before = await dbConsumptions(orderUid);
	for (const [label, extra] of [
		['omitted link', {}],
		['explicit null link', { order_uid: null }],
	] as const) {
		const captured = await captureAccrual(request, {
			description: `${ACCRUAL_CONSUMPTION_PREFIX}received work ${label} (10000 estimate)`,
			evidence_basis: 'received_work',
			service_period_start: `${MONTH}-01`,
			service_period_end: `${MONTH}-28`,
			cost_classification: 'project',
			project_id: seeded.projectId,
			gross_amount: 10000,
			tax_amount: 0,
			tax_treatment: 'none',
			currency: 'INR',
			source_reference: `${ACCRUAL_CONSUMPTION_PREFIX}SRC-${label}`,
			evidence_reference: `${ACCRUAL_CONSUMPTION_PREFIX}EV-${label}`,
			...extra,
		});
		expect(captured.status, JSON.stringify(captured.body)).toBe(201);
		const accrualId = (captured.body.data as { id: number }).id;
		createdAccrualIds.push(accrualId);
		const result = await accrualCommand(request, accrualId, {
			command: 'recognize',
			expected_version: 1,
		});
		expect(result.status, JSON.stringify(result.body)).toBe(200);
		const data = result.body.data as Record<string, unknown>;
		expect(data.recognition_state).toBe('recognized');
		// No link, no composition: the outcome is explicitly null and the
		// stored link stays NULL (never the text "null").
		expect(data.consumption).toBeNull();
		const stored = await dbAccrual(accrualId);
		expect(stored.order_uid).toBeNull();
	}
	const after = await dbConsumptions(orderUid);
	expect(after.length).toBe(before.length);
	evidence.unlinked = { recognized: 2, consumed: 0 };
});

test('the artifact records the accrual consumption evidence', async () => {
	expect(outcome.ok, 'all accrual consumption tests passed').toBe(true);
	publish();
});
