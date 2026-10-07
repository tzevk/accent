import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse, Page } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	CONSUMPTION_LATER_MONTH,
	CONSUMPTION_MONTH,
	CONSUMPTION_NEXT_MONTH,
	CONSUMPTION_PREFIX,
	CONSUMPTION_SPEC_IP,
	cleanupOrderConsumptionFixtures,
	loginConsumptionProcurement,
	loginConsumptionViewer,
	seedOrderConsumptionFixtures,
	type SeededConsumptionFixtures,
} from '../lib/order-consumption-fixtures';

/**
 * Ticket #312 — recognized supplier cost consumes the supplier order.
 *
 * Expected values come from the fixture literals (the seeded order values,
 * native slices, and the recorded 2018 acts) and from the parent rules: only
 * a supported supplier order carries a commitment, a client order and a
 * client-invoice link never reduce it, a payment never defines consumption,
 * and one native slice is consumed once. Persisted state is asserted through
 * `e2e/lib/db.ts`, never through the app's own aggregation.
 */

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
const LIVE_ORDER_NUMBER = `${CONSUMPTION_PREFIX}ORD-9001`;
const LIVE_ORDER_GROSS = 5000;
const LIVE_ORDER_CURRENCY = 'CHF';

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': CONSUMPTION_SPEC_IP },
});
test.describe.configure({ mode: 'serial', timeout: 180_000 });

interface ConsumptionRecordJson {
	id: number;
	orderUid: string;
	costUid: string;
	amount: number;
	taxBasis: string;
	currency: string;
	recognizedPeriod: string;
	sourceVersion: number;
	state: string;
	version: number;
	effective: boolean;
	releaseReason: string | null;
	releaseEvidenceReference: string | null;
}

interface CommitmentCandidateJson {
	costUid: string;
	recognizedPeriod: string;
	label: string | null;
	amount: number | null;
	financialVersion: number;
}

interface CommitmentDetailJson {
	order: {
		orderUid: string;
		orderNumber: string;
		amountBasis: string;
		currency: string;
		status: string;
		financialVersion: number;
	};
	consumptions: ConsumptionRecordJson[];
	effectiveConsumption: number;
	remainingCommitment: number | null;
	eligible: boolean;
	exceptions: string[];
	candidates: CommitmentCandidateJson[];
}

interface CommitmentMonthJson {
	month: string;
	opening: number;
	newCommitment: number;
	consumption: number;
	cancellation: number;
	closing: number;
}

interface CommitmentTotalJson {
	currency: string;
	basis: string;
	months: CommitmentMonthJson[];
	closingCommitment: number;
	consumptionInMonth: number;
	unconsumedOrderCount: number;
}

interface CommitmentSectionJson {
	month: string;
	totals: CommitmentTotalJson[];
	exceptions: Array<{
		code: string;
		orderCount: number;
		value: number | null;
		currency: string | null;
		basis: string | null;
		detail: string;
	}>;
	orders: Array<{
		orderUid: string;
		orderNumber: string;
		value: number | null;
		consumption: number;
		remaining: number | null;
		status: string;
	}>;
	ineffectiveConsumption: number;
}

interface ReconciliationJson {
	month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{ currency: string; incurred_cost: number }>;
	};
	supplier_commitment: CommitmentSectionJson;
}

interface ConsumptionResultJson {
	consumption: ConsumptionRecordJson;
	order: { orderUid: string; financialVersion: number };
	remainingCommitment: number;
}

interface OrderJson {
	orderUid: string;
	orderNumber: string;
	status: string;
	financialVersion: number;
}

let seeded: SeededConsumptionFixtures;
const evidence: Record<string, unknown> = {
	ok: true,
	month: CONSUMPTION_MONTH,
	nextMonth: CONSUMPTION_NEXT_MONTH,
	laterMonth: CONSUMPTION_LATER_MONTH,
};
const authorizationEvidence: Record<string, number> = {};
const createdOrderUids: string[] = [];
const createdInvoiceIds: number[] = [];

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('order-consumption', {
		...evidence,
		fixtureScope: {
			prefix: CONSUMPTION_PREFIX,
			months: [
				CONSUMPTION_MONTH,
				CONSUMPTION_NEXT_MONTH,
				CONSUMPTION_LATER_MONTH,
			],
			project: 'E2E-312-P1',
			seededOrderUids: seeded?.orderUids ?? {},
			createdThroughApp: { orders: createdOrderUids },
		},
		authorization: authorizationEvidence,
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

function bucket(
	section: CommitmentSectionJson,
	currency: string,
	basis: string
): CommitmentTotalJson {
	const found = section.totals.find(
		(total) => total.currency === currency && total.basis === basis
	);
	expect(
		found,
		`expected a ${currency}/${basis} commitment bucket in ${JSON.stringify(
			section.totals.map((total) => `${total.currency}|${total.basis}`)
		)}`
	).toBeTruthy();
	return found as CommitmentTotalJson;
}

function lastMonth(total: CommitmentTotalJson): CommitmentMonthJson {
	expect(total.months.length).toBeGreaterThan(0);
	return total.months[total.months.length - 1];
}

function exceptionCodes(section: CommitmentSectionJson): string[] {
	return section.exceptions.map((exception) => exception.code);
}

async function dbOrder(orderNumber: string): Promise<Record<string, unknown>> {
	const found = await rows<Record<string, unknown>>(
		`SELECT * FROM orders WHERE order_number = ? AND isDelete = 0`,
		[orderNumber]
	);
	expect(found.length, `expected exactly one order ${orderNumber}`).toBe(1);
	return found[0];
}

async function dbConsumptions(
	orderUid: string
): Promise<Array<Record<string, unknown>>> {
	return rows<Record<string, unknown>>(
		`SELECT * FROM order_consumptions WHERE order_uid = ? ORDER BY id ASC`,
		[orderUid]
	);
}

async function postConsumption(
	request: APIRequestContext,
	orderUid: string,
	body: Record<string, unknown>
): Promise<APIResponse> {
	return request.post(
		`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption`,
		{ data: body }
	);
}

/** The standard record body for one seeded order + cost slice. */
function consumptionBody(input: {
	costUid: string;
	period: string;
	basis: string;
	orderVersion: number;
	sourceVersion?: number;
	reason?: string;
}): Record<string, unknown> {
	return {
		cost_uid: input.costUid,
		recognized_period: input.period,
		tax_basis: input.basis,
		expected_version: input.orderVersion,
		expected_source_version: input.sourceVersion ?? 1,
		reason: input.reason ?? 'E2E-312 consumption',
		evidence_reference: `E2E-312-EVID-${input.costUid}`,
	};
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
	seeded = await seedOrderConsumptionFixtures();
	evidence.seeded = {
		projectId: seeded.projectId,
		orders: Object.keys(seeded.orderUids).length,
		invoices: Object.keys(seeded.invoiceIds).length,
	};
});

test.afterAll(async () => {
	publish();
	for (const orderUid of createdOrderUids) {
		await exec(`DELETE FROM order_consumption_events WHERE order_uid = ?`, [
			orderUid,
		]);
		await exec(`DELETE FROM order_consumptions WHERE order_uid = ?`, [
			orderUid,
		]);
		await exec(`DELETE FROM order_events WHERE order_uid = ?`, [orderUid]);
		await exec(`DELETE FROM orders WHERE order_uid = ?`, [orderUid]);
	}
	for (const invoiceId of createdInvoiceIds) {
		await exec(`DELETE FROM invoices WHERE id = ?`, [invoiceId]);
	}
	await cleanupOrderConsumptionFixtures();
});

test('records consumption through the real order control and leaves the remainder', async ({
	page,
	request,
}) => {
	const order = await dbOrder('E2E-312-ORD-2002');
	const orderUid = String(order.order_uid);

	await openOrderInBrowser(page, 'E2E-312-ORD-2002');
	await expect(page.getByTestId('commitment-remaining')).toHaveAttribute(
		'data-amount',
		'300000'
	);

	// The duplicate-month splits (40k + 60k) are offered as one June slice of
	// 100000: the summed native period amount, never the first split's 40k.
	const candidate = page.getByTestId('consumption-candidate');
	const optionValue = `${seeded.costUids['INV-1002']}|${CONSUMPTION_NEXT_MONTH}-01`;
	await expect(candidate.locator(`option[value="${optionValue}"]`)).toHaveCount(
		1
	);
	await candidate.selectOption(optionValue);
	await page.getByTestId('consumption-reason').fill('E2E-312 received work');
	await page.getByTestId('consumption-confirm').click();
	await expect(page.getByTestId('consumption-notice')).toContainText(
		'Consumption recorded'
	);
	await expect(page.getByTestId('commitment-remaining')).toHaveAttribute(
		'data-amount',
		'200000'
	);
	const row = page.getByTestId('order-consumption-row').first();
	await expect(row).toHaveAttribute('data-amount', '100000');
	await expect(row).toHaveAttribute('data-state', 'active');

	// Independent persistence check.
	const stored = await dbConsumptions(orderUid);
	expect(stored.length).toBe(1);
	expect(Number(stored[0].amount)).toBe(100000);
	expect(stored[0].tax_basis).toBe('gross');
	expect(stored[0].currency).toBe('USD');
	expect(String(stored[0].recognized_period).slice(0, 10)).toBe(
		`${CONSUMPTION_NEXT_MONTH}-01`
	);
	expect(stored[0].state).toBe('active');
	expect(Number(stored[0].version)).toBe(1);
	expect(Number(stored[0].source_version)).toBe(1);
	const events = await rows<Record<string, unknown>>(
		`SELECT * FROM order_consumption_events WHERE consumption_id = ?`,
		[Number(stored[0].id)]
	);
	expect(events.length).toBe(1);
	expect(events[0].event).toBe('recorded');
	expect(Number(events[0].version)).toBe(1);
	const after = await dbOrder('E2E-312-ORD-2002');
	expect(Number(after.financial_version)).toBe(2);

	// The order detail API states the same figures.
	const detail = await commitment(request, orderUid);
	expect(detail.effectiveConsumption).toBe(100000);
	expect(detail.remainingCommitment).toBe(200000);
	expect(detail.eligible).toBe(true);

	evidence.recordedThroughForm = {
		orderNumber: 'E2E-312-ORD-2002',
		amount: 100000,
		remaining: 200000,
		consumptionId: Number(stored[0].id),
	};
});

test('reconstructs the commitment rollforward as of each month', async ({
	request,
}) => {
	// May: the 10k order becomes eligible; nothing consumed or cancelled yet.
	const may = await reconciliation(request, CONSUMPTION_MONTH);
	const mayInr = bucket(may.supplier_commitment, 'INR', 'gross');
	expect(lastMonth(mayInr)).toMatchObject({
		month: CONSUMPTION_MONTH,
		opening: 0,
		newCommitment: 10000,
		consumption: 0,
		cancellation: 0,
		closing: 10000,
	});
	expect(mayInr.closingCommitment).toBe(10000);

	// June: the seeded 3k June slice is consumption; the order stays committed.
	const june = await reconciliation(request, CONSUMPTION_NEXT_MONTH);
	const juneInr = bucket(june.supplier_commitment, 'INR', 'gross');
	expect(lastMonth(juneInr)).toMatchObject({
		month: CONSUMPTION_NEXT_MONTH,
		opening: 10000,
		newCommitment: 0,
		consumption: 3000,
		cancellation: 0,
		closing: 7000,
	});
	expect(juneInr.closingCommitment).toBe(7000);

	// July: the recorded cancellation takes only the remaining 7k — never the
	// 3k already consumed, and never a later month's consumption.
	const july = await reconciliation(request, CONSUMPTION_LATER_MONTH);
	const julyInr = bucket(july.supplier_commitment, 'INR', 'gross');
	expect(lastMonth(julyInr)).toMatchObject({
		month: CONSUMPTION_LATER_MONTH,
		opening: 7000,
		newCommitment: 0,
		consumption: 0,
		cancellation: 7000,
		closing: 0,
	});
	expect(julyInr.closingCommitment).toBe(0);
	const cancelled = july.supplier_commitment.orders.find(
		(entry) => entry.orderNumber === 'E2E-312-ORD-2001'
	);
	expect(cancelled?.remaining).toBe(0);
	expect(cancelled?.status).toBe('cancelled');

	// The July cancellation did not erase May's or June's new/opening figures.
	expect(
		mayInr.months.find((entry) => entry.month === CONSUMPTION_MONTH)
			?.newCommitment
	).toBe(10000);
	expect(
		juneInr.months.find((entry) => entry.month === CONSUMPTION_MONTH)
			?.newCommitment
	).toBe(10000);

	// The net-basis order is its own bucket: 300000 net, nothing consumed.
	const juneNet = bucket(june.supplier_commitment, 'INR', 'net');
	expect(juneNet.closingCommitment).toBe(300000);

	// Explicit exceptions, never counted as commitment.
	const codes = exceptionCodes(july.supplier_commitment);
	for (const code of [
		'pending_approval',
		'unsupported_basis',
		'missing_value',
		'unsupported_timing',
		'ambiguous_direction',
	]) {
		expect(codes, `expected exception ${code} in ${codes.join(',')}`).toContain(
			code
		);
	}
	const timing = july.supplier_commitment.exceptions.find(
		(entry) => entry.code === 'unsupported_timing'
	);
	expect(timing?.orderCount).toBeGreaterThanOrEqual(1);
	expect(timing?.value).toBe(8000);

	// No double count: May has no recognized cost at all, while the order
	// commitment is 10000 — the order value is never incurred expenditure.
	// An empty month states no company total (null), not a zero total: zero
	// is a stated amount, null is no statable amount (cf. types.ts and the
	// toBeNull empty-month pins in the payroll/currency/non-operating specs).
	expect(may.company.incurred_cost).toBeNull();
	// June's INR cost is the recognized supplier invoices only (3000 + 41000),
	// not the 7000 remaining commitment nor the 10000 order value.
	const juneInrCost = june.company.currency_totals.find(
		(total) => total.currency === 'INR'
	);
	expect(juneInrCost?.incurred_cost).toBe(44000);
	expect(june.supplier_commitment.ineffectiveConsumption).toBe(0);

	evidence.rollforward = {
		may: lastMonth(mayInr),
		june: lastMonth(juneInr),
		july: lastMonth(julyInr),
		exceptions: codes,
	};
});

test('keeps client-side invoice links outside the supplier commitment', async ({
	request,
}) => {
	const clientOrder = await dbOrder('E2E-312-ORD-2008');
	const clientUid = String(clientOrder.order_uid);
	const before = await reconciliation(request, CONSUMPTION_NEXT_MONTH);
	const beforeClosing = bucket(
		before.supplier_commitment,
		'INR',
		'gross'
	).closingCommitment;

	// A real client invoice links the client order through the app.
	const created = await apiJson<{ success: boolean }>(
		await request.post('/api/admin/invoices', {
			data: {
				invoice_number: `${CONSUMPTION_PREFIX}INV-CLI-1`,
				invoice_date: `${CONSUMPTION_NEXT_MONTH}-20`,
				client_name: 'E2E-312 Client',
				order_uid: clientUid,
				items: [],
				line_items: [],
				total: 20000,
				gst_type: 'cgst_sgst',
				status: 'sent',
			},
		})
	);
	expect(created.success).toBe(true);
	const invoiceRow = await rows<Record<string, unknown>>(
		`SELECT id FROM invoices WHERE invoice_number = ? AND isDelete = 0`,
		[`${CONSUMPTION_PREFIX}INV-CLI-1`]
	);
	createdInvoiceIds.push(Number(invoiceRow[0].id));

	const after = await dbOrder('E2E-312-ORD-2008');
	expect(Number(after.client_invoiced_value)).toBe(40000);
	const afterSection = await reconciliation(request, CONSUMPTION_NEXT_MONTH);
	expect(
		bucket(afterSection.supplier_commitment, 'INR', 'gross').closingCommitment
	).toBe(beforeClosing);
	expect(await dbConsumptions(clientUid)).toHaveLength(0);

	// A client order can never carry supplier consumption.
	const refused = await postConsumption(request, clientUid, {
		cost_uid: seeded.costUids['INV-1009'],
		recognized_period: `${CONSUMPTION_NEXT_MONTH}-01`,
		tax_basis: 'gross',
		expected_version: 1,
		expected_source_version: 1,
		reason: 'wrong side',
	});
	const refusedBody = await apiJson<{ code: string }>(refused, 422);
	expect(refusedBody.code).toBe('order_not_supplier');
	expect(await dbConsumptions(clientUid)).toHaveLength(0);

	evidence.clientSide = {
		clientInvoicedValue: 40000,
		supplierClosingBefore: beforeClosing,
		supplierClosingAfter: bucket(
			afterSection.supplier_commitment,
			'INR',
			'gross'
		).closingCommitment,
	};
});

test('refuses unsupported bases, wrong currencies, and invalid linkage without writes', async ({
	request,
}) => {
	const probes: Array<{
		name: string;
		orderNumber: string;
		body: Record<string, unknown>;
		status: number;
		code: string;
	}> = [
		{
			name: 'unknown basis',
			orderNumber: 'E2E-312-ORD-2009',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1001'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'order_basis_unknown',
		},
		{
			name: 'basis mismatch',
			orderNumber: 'E2E-312-ORD-2011',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1002'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'net',
				orderVersion: 1,
			}),
			status: 422,
			code: 'tax_basis_mismatch',
		},
		{
			name: 'currency mismatch',
			orderNumber: 'E2E-312-ORD-2010',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1001'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'currency_mismatch',
		},
		{
			// ORD-2014: cancelled with zero consumptions. ORD-2001 cannot be
			// used here: it carries the seeded historical consumption the
			// rollforward test needs, so its no-write check can never be 0.
			name: 'cancelled order',
			orderNumber: 'E2E-312-ORD-2014',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1009'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'order_cancelled',
		},
		{
			name: 'draft order',
			orderNumber: 'E2E-312-ORD-2017',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1009'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'order_not_eligible',
		},
		{
			name: 'unrecognized cost',
			orderNumber: 'E2E-312-ORD-2013',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1004'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'cost_not_recognized',
		},
		{
			name: 'unknown period',
			orderNumber: 'E2E-312-ORD-2013',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1006'],
				period: '2018-09',
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'unknown_recognition_period',
		},
		{
			name: 'over-consumption',
			orderNumber: 'E2E-312-ORD-2012',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1007'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
			}),
			status: 422,
			code: 'consumption_exceeds_commitment',
		},
		{
			name: 'stale order version',
			orderNumber: 'E2E-312-ORD-2015',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1008'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 99,
			}),
			status: 409,
			code: 'stale_version',
		},
		{
			name: 'stale source version',
			orderNumber: 'E2E-312-ORD-2016',
			body: consumptionBody({
				costUid: seeded.costUids['INV-1010'],
				period: CONSUMPTION_NEXT_MONTH,
				basis: 'gross',
				orderVersion: 1,
				sourceVersion: 99,
			}),
			status: 409,
			code: 'source_stale_version',
		},
	];

	const observed: Record<string, string> = {};
	for (const probe of probes) {
		const order = await dbOrder(probe.orderNumber);
		const orderUid = String(order.order_uid);
		const response = await postConsumption(request, orderUid, probe.body);
		const body = await apiJson<{ code: string }>(response, probe.status);
		expect(body.code, `${probe.name} expected ${probe.code}`).toBe(probe.code);
		// No partial writes: no row, no version advance, no journal row.
		expect(await dbConsumptions(orderUid)).toHaveLength(0);
		const after = await dbOrder(probe.orderNumber);
		expect(Number(after.financial_version)).toBe(
			Number(order.financial_version)
		);
		observed[probe.name] = body.code;
	}
	const journal = await rows<Record<string, unknown>>(
		`SELECT COUNT(*) AS n FROM order_consumption_events e
       JOIN orders o ON o.order_uid = e.order_uid
      WHERE o.order_number LIKE ?`,
		[`${CONSUMPTION_PREFIX}ORD-%`]
	);
	// Only the one UI-recorded consumption from the first test exists.
	expect(Number(journal[0].n)).toBe(1);
	evidence.refusals = observed;
});

test('never lets two orders consume one native slice, and never duplicates a request', async ({
	request,
}) => {
	const slice = seeded.costUids['INV-1003'];
	const period = `${CONSUMPTION_NEXT_MONTH}-01`;
	const first = await dbOrder('E2E-312-ORD-2005');
	const second = await dbOrder('E2E-312-ORD-2006');

	// Sequential competition: the slice goes to exactly one order.
	const won = await postConsumption(request, String(first.order_uid), {
		cost_uid: slice,
		recognized_period: period,
		tax_basis: 'gross',
		expected_version: 1,
		expected_source_version: 1,
		reason: 'E2E-312 competing order',
	});
	const wonBody = await apiJson<{ data: ConsumptionResultJson }>(won, 200);
	expect(wonBody.data.consumption.amount).toBe(25000);
	expect(wonBody.data.remainingCommitment).toBe(175000);

	const lost = await postConsumption(request, String(second.order_uid), {
		cost_uid: slice,
		recognized_period: period,
		tax_basis: 'gross',
		expected_version: 1,
		expected_source_version: 1,
		reason: 'E2E-312 competing order',
	});
	const lostBody = await apiJson<{ code: string }>(lost, 409);
	expect(lostBody.code).toBe('slice_already_consumed');
	expect(await dbConsumptions(String(second.order_uid))).toHaveLength(0);

	// The whole slice is consumed once, never twice.
	const sliceRows = await rows<Record<string, unknown>>(
		`SELECT * FROM order_consumptions WHERE cost_uid = ? AND state = 'active'`,
		[slice]
	);
	expect(sliceRows).toHaveLength(1);
	expect(Number(sliceRows[0].amount)).toBe(25000);

	// Concurrent identical requests: exactly one succeeds, one row results.
	const concurrentSlice = seeded.costUids['INV-1009'];
	const concurrentOrder = await dbOrder('E2E-312-ORD-2003');
	const body = {
		cost_uid: concurrentSlice,
		recognized_period: `${CONSUMPTION_NEXT_MONTH}-01`,
		tax_basis: 'gross',
		expected_version: 1,
		expected_source_version: 1,
		reason: 'E2E-312 concurrent',
	};
	const [left, right] = await Promise.all([
		postConsumption(request, String(concurrentOrder.order_uid), body),
		postConsumption(request, String(concurrentOrder.order_uid), body),
	]);
	const statuses = [left.status(), right.status()].sort((a, b) => a - b);
	expect(statuses).toEqual([200, 409]);
	const concurrentRows = await rows<Record<string, unknown>>(
		`SELECT * FROM order_consumptions WHERE cost_uid = ? AND state = 'active'`,
		[concurrentSlice]
	);
	expect(concurrentRows).toHaveLength(1);
	expect(Number(concurrentRows[0].amount)).toBe(15000);

	// A repeat of the same request still refuses and adds nothing.
	const repeat = await postConsumption(
		request,
		String(concurrentOrder.order_uid),
		{
			...body,
			expected_version: Number(concurrentOrder.financial_version),
		}
	);
	await apiJson(repeat, 409);
	expect(
		await rows<Record<string, unknown>>(
			`SELECT * FROM order_consumptions WHERE cost_uid = ? AND state = 'active'`,
			[concurrentSlice]
		)
	).toHaveLength(1);

	evidence.sliceGuard = {
		sliceActiveRows: sliceRows.length,
		concurrentStatuses: statuses,
		duplicateMonthSplits: 100000,
	};
});

test('releases a consumption with evidence, frees its slice, and re-records it', async ({
	page,
	request,
}) => {
	const order = await dbOrder('E2E-312-ORD-2013');
	const orderUid = String(order.order_uid);
	const slice = seeded.costUids['INV-1006'];
	const period = `${CONSUMPTION_NEXT_MONTH}-01`;

	const recorded = await apiJson<{ data: ConsumptionResultJson }>(
		await postConsumption(request, orderUid, {
			cost_uid: slice,
			recognized_period: period,
			tax_basis: 'gross',
			expected_version: 1,
			expected_source_version: 1,
			reason: 'E2E-312 to release',
		}),
		200
	);
	expect(recorded.data.remainingCommitment).toBe(0);
	const consumptionId = recorded.data.consumption.id;

	// Release through the real order control, with its reason.
	await openOrderInBrowser(page, 'E2E-312-ORD-2013');
	await page.getByTestId('consumption-release').click();
	await page.getByTestId('release-reason').fill('E2E-312 invoice cancelled');
	await page.getByTestId('release-evidence').fill('E2E-312-RELEASE-EVID');
	await page.getByTestId('release-confirm').click();
	await expect(page.getByTestId('consumption-notice')).toContainText(
		'released'
	);
	await expect(page.getByTestId('consumption-release-evidence')).toContainText(
		'E2E-312 invoice cancelled'
	);
	await expect(page.getByTestId('commitment-remaining')).toHaveAttribute(
		'data-amount',
		'5000'
	);

	const releasedRows = await dbConsumptions(orderUid);
	expect(releasedRows).toHaveLength(1);
	expect(releasedRows[0].state).toBe('released');
	expect(Number(releasedRows[0].version)).toBe(2);
	expect(releasedRows[0].release_reason).toBe('E2E-312 invoice cancelled');
	expect(releasedRows[0].release_evidence_reference).toBe(
		'E2E-312-RELEASE-EVID'
	);
	const releaseEvents = await rows<Record<string, unknown>>(
		`SELECT * FROM order_consumption_events WHERE consumption_id = ? ORDER BY version ASC`,
		[consumptionId]
	);
	expect(releaseEvents.map((event) => event.event)).toEqual([
		'recorded',
		'released',
	]);

	// Releasing again refuses; a missing reason refuses.
	const again = await request.post(
		`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption/release`,
		{
			data: {
				consumption_id: consumptionId,
				expected_version: 2,
				reason: 'again',
			},
		}
	);
	expect((await apiJson<{ code: string }>(again, 422)).code).toBe(
		'consumption_already_released'
	);
	const noReason = await request.post(
		`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption/release`,
		{ data: { consumption_id: consumptionId, expected_version: 2 } }
	);
	expect((await apiJson<{ code: string }>(noReason, 422)).code).toBe(
		'reason_required'
	);

	// The released slice is free again: the re-record succeeds.
	const rerecorded = await apiJson<{ data: ConsumptionResultJson }>(
		await postConsumption(request, orderUid, {
			cost_uid: slice,
			recognized_period: period,
			tax_basis: 'gross',
			expected_version: 3,
			expected_source_version: 1,
			reason: 'E2E-312 re-recorded',
		}),
		200
	);
	expect(rerecorded.data.remainingCommitment).toBe(0);
	const allRows = await dbConsumptions(orderUid);
	expect(allRows).toHaveLength(2);
	expect(allRows.filter((row) => row.state === 'active')).toHaveLength(1);

	evidence.release = {
		consumptionId,
		releasedVersion: 2,
		activeAfterRerecord: 1,
	};
});

test('shows the commitment section for an order-only historical month in the report view', async ({
	page,
	request,
}) => {
	// The month control lists months from the API meta, which includes months
	// with order activity only (no cost).
	const meta = await apiJson<{
		meta: { expenditure_months?: string[] };
	}>(await request.get('/api/reports/employee-project-monthly-cost'));
	const months = meta.meta.expenditure_months ?? [];
	for (const month of [
		CONSUMPTION_MONTH,
		CONSUMPTION_NEXT_MONTH,
		CONSUMPTION_LATER_MONTH,
	]) {
		expect(months, `expected ${month} in ${months.join(',')}`).toContain(month);
	}

	// And the real report view renders the reconstructed section for it.
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('button', { name: 'Month' }).click();
	await page.getByRole('button', { name: 'July 2018' }).click();
	await expect(page.getByTestId('expenditure-view')).toHaveAttribute(
		'data-month',
		CONSUMPTION_LATER_MONTH
	);
	const section = page.getByTestId('commitment-section');
	await expect(section).toBeVisible();
	const inrRow = section.locator(
		'[data-testid="commitment-row"][data-currency="INR"][data-basis="gross"]'
	);
	await expect(inrRow).toHaveAttribute('data-closing', '0');
	await expect(inrRow).toHaveAttribute('data-consumption', '0');
	await expect(
		section.locator('[data-testid="commitment-order"]', {
			hasText: 'E2E-312-ORD-2001',
		})
	).toHaveAttribute('data-remaining', '0');
	await expect(
		section.locator(
			'[data-testid="commitment-exception"][data-code="unsupported_timing"]'
		)
	).toBeVisible();

	evidence.reportView = {
		monthsWithOrders: [
			CONSUMPTION_MONTH,
			CONSUMPTION_NEXT_MONTH,
			CONSUMPTION_LATER_MONTH,
		],
		monthShown: CONSUMPTION_LATER_MONTH,
	};
});

test('live-path order creation and cancellation land in the current month', async ({
	request,
}) => {
	const created = await apiJson<{ data: OrderJson }>(
		await request.post('/api/admin/orders', {
			data: {
				direction: 'supplier',
				order_number: LIVE_ORDER_NUMBER,
				counterparty_name: `${CONSUMPTION_PREFIX}Live Supplier`,
				currency: LIVE_ORDER_CURRENCY,
				amount_basis: 'gross',
				gross_amount: LIVE_ORDER_GROSS,
				order_date: `${CURRENT_MONTH}-05`,
				status: 'approved',
				firmness: 'firm',
				firmness_evidence_reference: 'E2E-312-LIVE-DOC',
			},
		}),
		200
	);
	const orderUid = created.data.orderUid;
	createdOrderUids.push(orderUid);

	const afterCreate = await reconciliation(request, CURRENT_MONTH);
	const createdBucket = bucket(
		afterCreate.supplier_commitment,
		LIVE_ORDER_CURRENCY,
		'gross'
	);
	expect(lastMonth(createdBucket)).toMatchObject({
		month: CURRENT_MONTH,
		newCommitment: LIVE_ORDER_GROSS,
		cancellation: 0,
		closing: LIVE_ORDER_GROSS,
	});

	// The recorded cancellation lands in the same month's bucket.
	const cancelled = await apiJson<{ data: OrderJson }>(
		await request.put(`/api/admin/orders/${encodeURIComponent(orderUid)}`, {
			data: { expected_version: 1, status: 'cancelled' },
		}),
		200
	);
	expect(cancelled.data.status).toBe('cancelled');
	const afterCancel = await reconciliation(request, CURRENT_MONTH);
	const cancelledBucket = bucket(
		afterCancel.supplier_commitment,
		LIVE_ORDER_CURRENCY,
		'gross'
	);
	expect(lastMonth(cancelledBucket)).toMatchObject({
		month: CURRENT_MONTH,
		newCommitment: LIVE_ORDER_GROSS,
		cancellation: LIVE_ORDER_GROSS,
		closing: 0,
	});

	evidence.livePath = {
		orderNumber: LIVE_ORDER_NUMBER,
		newCommitment: LIVE_ORDER_GROSS,
		cancellation: LIVE_ORDER_GROSS,
		closing: 0,
	};
});

test('refuses unauthorized readers and writers without changing data', async ({
	playwright,
	request,
}) => {
	const viewer = await loginConsumptionViewer(playwright, E2E_ENV.baseURL);
	const procurement = await loginConsumptionProcurement(
		playwright,
		E2E_ENV.baseURL
	);
	try {
		const order = await dbOrder('E2E-312-ORD-2002');
		const orderUid = String(order.order_uid);

		// A reader with only `purchase_orders:read` gets no supplier cost data.
		authorizationEvidence.viewerCommitment = (
			await viewer.get(
				`/api/admin/orders/${encodeURIComponent(orderUid)}/commitment`
			)
		).status();
		expect(authorizationEvidence.viewerCommitment).toBe(403);
		authorizationEvidence.viewerRecord = (
			await viewer.post(
				`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption`,
				{
					data: consumptionBody({
						costUid: seeded.costUids['INV-1009'],
						period: CONSUMPTION_NEXT_MONTH,
						basis: 'gross',
						orderVersion: Number(order.financial_version),
					}),
				}
			)
		).status();
		expect(authorizationEvidence.viewerRecord).toBe(403);
		authorizationEvidence.viewerRelease = (
			await viewer.post(
				`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption/release`,
				{ data: { consumption_id: 1, expected_version: 1, reason: 'x' } }
			)
		).status();
		expect(authorizationEvidence.viewerRelease).toBe(403);

		// Procurement with read + update but no financial approval: the detail
		// is readable, every financial write is refused.
		authorizationEvidence.procurementCommitment = (
			await procurement.get(
				`/api/admin/orders/${encodeURIComponent(orderUid)}/commitment`
			)
		).status();
		expect(authorizationEvidence.procurementCommitment).toBe(200);
		authorizationEvidence.procurementRecord = (
			await procurement.post(
				`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption`,
				{
					data: consumptionBody({
						costUid: seeded.costUids['INV-1009'],
						period: CONSUMPTION_NEXT_MONTH,
						basis: 'gross',
						orderVersion: Number(order.financial_version),
					}),
				}
			)
		).status();
		expect(authorizationEvidence.procurementRecord).toBe(403);
		authorizationEvidence.procurementRelease = (
			await procurement.post(
				`/api/admin/orders/${encodeURIComponent(orderUid)}/consumption/release`,
				{ data: { consumption_id: 1, expected_version: 1, reason: 'x' } }
			)
		).status();
		expect(authorizationEvidence.procurementRelease).toBe(403);

		// An employee session is refused outright.
		const employee = await playwright.request.newContext({
			baseURL: E2E_ENV.baseURL,
			storageState: 'e2e/.auth/employee.json',
			extraHTTPHeaders: { 'x-vercel-forwarded-for': CONSUMPTION_SPEC_IP },
		});
		try {
			authorizationEvidence.employeeCommitment = (
				await employee.get(
					`/api/admin/orders/${encodeURIComponent(orderUid)}/commitment`
				)
			).status();
			expect(authorizationEvidence.employeeCommitment).toBe(403);
		} finally {
			await employee.dispose();
		}

		// Nothing changed: the order still holds exactly its one consumption.
		const after = await dbOrder('E2E-312-ORD-2002');
		expect(Number(after.financial_version)).toBe(
			Number(order.financial_version)
		);
		expect(await dbConsumptions(orderUid)).toHaveLength(1);
	} finally {
		await viewer.dispose();
		await procurement.dispose();
	}
});

test('publishes the repeatable artifact and leaves the namespace intact', async ({
	request,
}) => {
	publish();
	const summary = await reconciliation(request, CONSUMPTION_LATER_MONTH);
	evidence.final = {
		inrGrossClosing: bucket(summary.supplier_commitment, 'INR', 'gross')
			.closingCommitment,
		exceptions: exceptionCodes(summary.supplier_commitment),
	};
	const orders = await rows<Record<string, unknown>>(
		`SELECT COUNT(*) AS n FROM orders WHERE order_number LIKE ?`,
		[`${CONSUMPTION_PREFIX}ORD-%`]
	);
	expect(Number(orders[0].n)).toBeGreaterThanOrEqual(17);
});
