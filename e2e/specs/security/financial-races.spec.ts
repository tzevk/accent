import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { readArtifact, writeArtifact } from '../../lib/artifacts';
import { exec, rows } from '../../lib/db';
import { E2E_ENV } from '../../lib/env';
import { loginAs } from '../../lib/security-fixtures';

/**
 * Financial races under workstream E of the security remediation plan,
 * verified through the real API against the real database.
 *
 * E1 — canonical order rollup race. Six concurrent `POST /api/admin/invoices`
 * (each 300) reference one canonical client order. Since the #310 cutover an
 * invoice links its order by the durable `order_uid`; the free-text
 * `po_number` match that used to decrement `purchase_orders.remaining_balance`
 * is gone, and the balance owner is the order's `client_invoiced_value`
 * rollup. The remediated invariant is *consistency*, not a floor: the
 * invoice route locks the order row (`SELECT ... FOR UPDATE`) and rolls the
 * invoiced value up inside the caller's transaction, so concurrent creates
 * must never lose an increment — and the route has no ceiling rule, so the
 * remaining client value may go negative exactly as the old purchase-order
 * balance did. The spec therefore asserts `client_invoiced_value ===
 * 300 x successfulCount`, one stored invoice row per 2xx (each carrying the
 * canonical order reference and its own running remaining value), one
 * `client_invoiced` journal event per 2xx, and a supplier-order link refused
 * with no partial write. Requests carry distinct client-supplied numbers so
 * the number-generator race cannot mask the rollup race.
 *
 * E2 — number-generator race. Six concurrent `POST /api/admin/purchase-invoices`
 * without a client-supplied number must mint distinct `PI-#####` numbers: the
 * generator reads the newest row `FOR UPDATE` inside the transaction and the
 * unique `active_invoice_number` index is the backstop, so the successful
 * responses and the stored rows must be duplicate-free.
 *
 * Rows are namespaced `E2E-RACE-*` / `E2E Race *`; the last test hard-deletes
 * them (and `afterAll` repeats the purge as a safety net when a test fails).
 */

const ARTIFACT = 'security-financial-races';
const RUN = Date.now().toString(36);
const RACE_PREFIX = 'E2E-RACE-';
const ORDER_NUMBER = `${RACE_PREFIX}${RUN}-ORD`;
const SUPPLIER_ORDER_NUMBER = `${RACE_PREFIX}${RUN}-SUP`;
const INVOICE_NUMBER_PREFIX = `${RACE_PREFIX}${RUN}-INV-`;
const CLIENT_NAME = `E2E Race Client ${RUN}`;
const VENDOR_PREFIX = 'E2E Race Vendor ';
const VENDOR_NAME = `${VENDOR_PREFIX}${RUN}`;
const ORDER_STATED_VALUE = 1000;
const INVOICE_AMOUNT = 300;
const PURCHASE_INVOICE_AMOUNT = 100;
const CONCURRENCY = 6;

/**
 * The running remaining client value after each successful link, sorted. The
 * invariant is consistency: every link stores its own step down from the
 * stated value, so the set of stored steps is fixed no matter the order the
 * six transactions commit in. The old purchase-order balance ended at -800;
 * the canonical remaining client value ends at the same figure.
 */
const EXPECTED_REMAINING_VALUES = Array.from(
	{ length: CONCURRENCY },
	(_, index) => ORDER_STATED_VALUE - INVOICE_AMOUNT * (index + 1)
).sort((left, right) => left - right);

interface Attempt {
	status: number;
	id: number | null;
	number: string | null;
	message: string | null;
}

interface ApiJson {
	success?: boolean;
	message?: string;
	error?: string;
	code?: string;
	data?: { id?: number; invoice_number?: string; orderUid?: string };
}

interface OrderRow {
	gross_amount: string;
	client_invoiced_value: string;
}

interface RaceInvoiceRow {
	id: number;
	invoice_number: string;
	total: string;
	balance_po_value: string;
	order_uid: string;
}

interface RaceEventRow {
	event: string;
	amount: string;
	reference: string;
}

/**
 * Evidence collected across the tests, rewritten to the artifact after every
 * test so a failing assertion still leaves the observed statuses on disk.
 */
interface RaceEvidence {
	order: {
		orderNumber: string;
		orderUid: string | null;
		direction: 'client';
		statedValue: number;
	};
	supplierOrder: {
		orderNumber: string;
		orderUid: string | null;
	};
	finding: string;
	[key: string]: unknown;
}

const evidence: RaceEvidence = {
	order: {
		orderNumber: ORDER_NUMBER,
		orderUid: null,
		direction: 'client',
		statedValue: ORDER_STATED_VALUE,
	},
	supplierOrder: {
		orderNumber: SUPPLIER_ORDER_NUMBER,
		orderUid: null,
	},
	finding:
		'POST /api/admin/invoices links a client order by order_uid and rolls client_invoiced_value up under a row lock; the remediated invariant is consistency (no lost updates), not a floor — the remaining client value may go negative exactly as the old purchase-order balance did',
};

let api: APIRequestContext | undefined;
let orderUid = '';
let supplierOrderUid = '';

function context(): APIRequestContext {
	if (!api) {
		throw new Error('[e2e] super-admin API context was not created');
	}
	return api;
}

async function readJson(res: APIResponse): Promise<ApiJson> {
	try {
		return (await res.json()) as ApiJson;
	} catch {
		return {};
	}
}

async function attempts(responses: APIResponse[]): Promise<Attempt[]> {
	return Promise.all(
		responses.map(async (res) => {
			const json = await readJson(res);
			return {
				status: res.status(),
				id: json.data?.id ?? null,
				number: json.data?.invoice_number ?? null,
				message: json.message ?? json.error ?? null,
			};
		})
	);
}

function numbersOf(list: Attempt[]): string[] {
	return list
		.map((attempt) => attempt.number)
		.filter((number): number is string => number !== null);
}

function idsOf(list: Attempt[]): number[] {
	return list
		.map((attempt) => attempt.id)
		.filter((id): id is number => id !== null);
}

function sortedIds(ids: number[]): number[] {
	return [...ids].sort((a, b) => a - b);
}

/** Create one canonical order through the entry API; return its `order_uid`. */
async function createRaceOrder(
	direction: 'client' | 'supplier',
	orderNumber: string,
	counterpartyName: string
): Promise<string> {
	const response = await context().post('/api/admin/orders', {
		data: {
			direction,
			order_number: orderNumber,
			counterparty_name: counterpartyName,
			currency: 'INR',
			amount_basis: 'gross',
			gross_amount: ORDER_STATED_VALUE,
			tax_amount: 0,
			net_amount: ORDER_STATED_VALUE,
			order_date: new Date().toISOString().slice(0, 10),
			status: 'approved',
			firmness: 'firm',
			firmness_evidence_reference: `${orderNumber}-DOC`,
			source_document_reference: orderNumber,
			remarks: 'e2e/specs/security/financial-races.spec.ts',
		},
	});
	const body = await readJson(response);
	expect(response.status(), `order creation ${orderNumber}`).toBe(200);
	expect(body.success, `order creation ${orderNumber}`).toBe(true);
	const createdUid = String(body.data?.orderUid ?? '');
	expect(
		createdUid,
		`order creation ${orderNumber} returned a canonical order_uid`
	).toMatch(/^ord-/);
	return createdUid;
}

/** Table, column and prefix identifying every row this spec creates. */
const RACE_ROWS = [
	{ table: 'invoices', column: 'invoice_number', prefix: RACE_PREFIX },
	{ table: 'purchase_invoices', column: 'vendor_name', prefix: VENDOR_PREFIX },
	{ table: 'orders', column: 'order_number', prefix: RACE_PREFIX },
];

/** Hard-delete every row this spec owns, journal rows before their orders. */
async function purgeRaceRows(): Promise<void> {
	await exec(
		`DELETE FROM order_events WHERE order_uid IN
         (SELECT order_uid FROM orders WHERE order_number LIKE ?)`,
		[`${RACE_PREFIX}%`]
	);
	for (const { table, column, prefix } of RACE_ROWS) {
		await exec(`DELETE FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}%`]);
	}
}

/** Rows still on disk per race table, for the cleanup assertions. */
async function countRaceRows(): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const { table, column, prefix } of RACE_ROWS) {
		const [row] = await rows<{ c: number }>(
			`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`,
			[`${prefix}%`]
		);
		counts[table] = Number(row?.c ?? 0);
	}
	return counts;
}

/** Persist the evidence gathered so far and prove the artifact round-trips. */
function saveEvidence(): void {
	writeArtifact(ARTIFACT, { ...evidence });
	const artifact = readArtifact(ARTIFACT);
	expect(artifact.order).toMatchObject({ orderNumber: ORDER_NUMBER });
}

test.describe('financial races', () => {
	test.describe.configure({ timeout: 120_000 });

	test.beforeAll(async ({ playwright }) => {
		// Leftovers from a crashed earlier run would collide with the order
		// and invoice numbers.
		await purgeRaceRows();
		api = await loginAs(playwright, E2E_ENV.baseURL, 'superAdmin');

		// The rollup owner is a canonical client order; the supplier order is
		// the refusal probe (a client invoice can never reference it). Both are
		// created through the real entry API, not inserted directly.
		orderUid = await createRaceOrder('client', ORDER_NUMBER, CLIENT_NAME);
		supplierOrderUid = await createRaceOrder(
			'supplier',
			SUPPLIER_ORDER_NUMBER,
			VENDOR_NAME
		);
		evidence.order.orderUid = orderUid;
		evidence.supplierOrder.orderUid = supplierOrderUid;

		const seeded = await rows<{ order_uid: string; direction: string }>(
			'SELECT order_uid, direction FROM orders WHERE order_number IN (?, ?)',
			[ORDER_NUMBER, SUPPLIER_ORDER_NUMBER]
		);
		expect(seeded).toHaveLength(2);
		expect(new Set(seeded.map((row) => row.direction))).toEqual(
			new Set(['client', 'supplier'])
		);
	});

	test.afterAll(async () => {
		await purgeRaceRows();
		await api?.dispose();
	});

	test('concurrent invoice POSTs never lose an order rollup', async () => {
		const payloads = Array.from({ length: CONCURRENCY }, (_, index) => ({
			client_name: CLIENT_NAME,
			order_uid: orderUid,
			total: INVOICE_AMOUNT,
			invoice_number: `${INVOICE_NUMBER_PREFIX}${index + 1}`,
			status: 'draft',
		}));

		const responses = await Promise.all(
			payloads.map((data) => context().post('/api/admin/invoices', { data }))
		);
		const results = await attempts(responses);
		const successes = results.filter(
			(attempt) => attempt.status >= 200 && attempt.status < 300
		);
		const failures = results.filter(
			(attempt) => attempt.status < 200 || attempt.status >= 300
		);

		const [orderRow] = await rows<OrderRow>(
			'SELECT gross_amount, client_invoiced_value FROM orders WHERE order_uid = ?',
			[orderUid]
		);
		expect(orderRow).toBeTruthy();
		const finalInvoiced = Number(orderRow.client_invoiced_value);

		const storedInvoices = await rows<RaceInvoiceRow>(
			`SELECT id, invoice_number, total, balance_po_value, order_uid
           FROM invoices
          WHERE order_uid = ? AND isDelete = 0
          ORDER BY id`,
			[orderUid]
		);
		const storedNumbers = storedInvoices.map((row) => row.invoice_number);
		const storedSum = (
			await rows<{ sum_total: string | null }>(
				`SELECT SUM(total) AS sum_total FROM invoices
           WHERE order_uid = ? AND isDelete = 0`,
				[orderUid]
			)
		)[0]?.sum_total;
		const duplicateGroups = await rows<{ invoice_number: string; c: number }>(
			`SELECT invoice_number, COUNT(*) AS c FROM invoices
           WHERE order_uid = ? AND isDelete = 0
           GROUP BY invoice_number HAVING c > 1`,
			[orderUid]
		);
		const remainingValues = storedInvoices
			.map((row) => Number(row.balance_po_value))
			.sort((left, right) => left - right);
		const linkedEvents = await rows<RaceEventRow>(
			`SELECT event, amount, reference FROM order_events
           WHERE order_uid = ? AND event = 'client_invoiced'
           ORDER BY id`,
			[orderUid]
		);

		// A supplier order refuses the link, and the refusal must leave no
		// invoice row and no rollup behind.
		const refused = await context().post('/api/admin/invoices', {
			data: {
				client_name: CLIENT_NAME,
				order_uid: supplierOrderUid,
				total: INVOICE_AMOUNT,
				invoice_number: `${INVOICE_NUMBER_PREFIX}REFUSED`,
				status: 'draft',
			},
		});
		const refusedBody = await readJson(refused);
		const refusedRows = await rows<{ n: number }>(
			'SELECT COUNT(*) AS n FROM invoices WHERE invoice_number = ?',
			[`${INVOICE_NUMBER_PREFIX}REFUSED`]
		);
		const supplierAfter = await rows<{ client_invoiced_value: string | null }>(
			'SELECT client_invoiced_value FROM orders WHERE order_uid = ?',
			[supplierOrderUid]
		);

		evidence.invoiceRace = {
			statuses: results.map((attempt) => attempt.status),
			successCount: successes.length,
			failureCount: failures.length,
			failures: failures.map((attempt) => ({
				status: attempt.status,
				message: attempt.message,
			})),
			responseNumbers: numbersOf(successes),
			storedIds: sortedIds(storedInvoices.map((row) => Number(row.id))),
			storedNumbers,
			storedSum,
			finalInvoiced,
			statedValue: Number(orderRow.gross_amount),
			remainingValues,
			expectedRemainingValues: EXPECTED_REMAINING_VALUES,
			storedRowCount: storedInvoices.length,
			duplicateGroups: duplicateGroups.length,
			linkedEventCount: linkedEvents.length,
			refusal: {
				status: refused.status(),
				code: refusedBody.code ?? null,
				storedRows: Number(refusedRows[0]?.n ?? 0),
				supplierInvoicedValue: supplierAfter[0]?.client_invoiced_value ?? null,
			},
		};
		saveEvidence();

		// Every create lands: the requests carry distinct client numbers, and
		// the order-row lock serializes the rollups behind them.
		expect(failures).toEqual([]);
		expect(successes).toHaveLength(CONCURRENCY);
		expect(new Set(numbersOf(successes))).toEqual(
			new Set(payloads.map((payload) => payload.invoice_number))
		);

		// The lost-update invariant: exactly one rollup per successful create.
		expect(finalInvoiced).toBe(INVOICE_AMOUNT * successes.length);
		expect(Number(orderRow.gross_amount)).toBe(ORDER_STATED_VALUE);

		// The database mirrors the 2xx count: one row, one number, one total
		// each, every row carrying the canonical order reference.
		expect(storedInvoices).toHaveLength(successes.length);
		expect(sortedIds(storedInvoices.map((row) => Number(row.id)))).toEqual(
			sortedIds(idsOf(successes))
		);
		expect(new Set(storedNumbers).size).toBe(storedNumbers.length);
		expect(Number(storedSum)).toBe(INVOICE_AMOUNT * successes.length);
		expect(
			storedInvoices.every((row) => Number(row.total) === INVOICE_AMOUNT)
		).toBe(true);
		expect(storedInvoices.every((row) => row.order_uid === orderUid)).toBe(
			true
		);
		expect(duplicateGroups).toHaveLength(0);
		for (const number of numbersOf(successes)) {
			expect(storedNumbers.filter((stored) => stored === number)).toHaveLength(
				1
			);
		}

		// Each successful link stored its own running remaining value: the six
		// serialized steps from the stated value, none lost, none repeated.
		expect(remainingValues).toEqual(EXPECTED_REMAINING_VALUES);

		// One journal event per successful link, each carrying its amount and
		// the invoice number as its reference.
		expect(linkedEvents).toHaveLength(successes.length);
		expect(
			linkedEvents.every((event) => Number(event.amount) === INVOICE_AMOUNT)
		).toBe(true);
		expect(new Set(linkedEvents.map((event) => event.reference))).toEqual(
			new Set(storedNumbers)
		);

		// The refusal changes nothing: no invoice row behind it, and the
		// supplier order keeps its null rollup.
		expect(refused.status()).toBe(422);
		expect(refusedBody.success).toBe(false);
		expect(refusedBody.code).toBe('order_not_client');
		expect(Number(refusedRows[0]?.n ?? 0)).toBe(0);
		expect(supplierAfter[0]?.client_invoiced_value ?? null).toBeNull();
	});

	test('concurrent purchase-invoice creates mint unique numbers', async () => {
		const responses = await Promise.all(
			Array.from({ length: CONCURRENCY }, () =>
				context().post('/api/admin/purchase-invoices', {
					data: { vendor_name: VENDOR_NAME, total: PURCHASE_INVOICE_AMOUNT },
				})
			)
		);
		const results = await attempts(responses);
		const successes = results.filter(
			(attempt) => attempt.status >= 200 && attempt.status < 300
		);
		const responseNumbers = numbersOf(successes);

		const stored = await rows<{ id: number; invoice_number: string }>(
			`SELECT id, invoice_number FROM purchase_invoices
          WHERE vendor_name = ? AND isDelete = 0
          ORDER BY id`,
			[VENDOR_NAME]
		);
		const storedNumbers = stored.map((row) => row.invoice_number);
		const scopedDuplicates = await rows<{ invoice_number: string; c: number }>(
			`SELECT invoice_number, COUNT(*) AS c FROM purchase_invoices
          WHERE vendor_name = ? AND isDelete = 0
          GROUP BY invoice_number HAVING c > 1`,
			[VENDOR_NAME]
		);
		const tableDuplicates = responseNumbers.length
			? await rows<{ invoice_number: string; c: number }>(
					`SELECT invoice_number, COUNT(*) AS c FROM purchase_invoices
              WHERE isDelete = 0
                AND invoice_number IN (${responseNumbers.map(() => '?').join(', ')})
              GROUP BY invoice_number HAVING c > 1`,
					responseNumbers
				)
			: [];

		evidence.numberRace = {
			statuses: results.map((attempt) => attempt.status),
			successCount: successes.length,
			responseNumbers,
			storedIds: sortedIds(stored.map((row) => Number(row.id))),
			storedNumbers,
			scopedDuplicateGroups: scopedDuplicates.length,
			tableDuplicateGroups: tableDuplicates.length,
		};
		saveEvidence();

		// Every create must land: the generator serializes on a locking read and
		// retries a lost race, and nothing legitimately rejects these requests, so
		// the uniqueness assertions below must not be vacuous. The artifact keeps
		// the exact statuses of the burst for diagnosis.
		expect(successes).toHaveLength(CONCURRENCY);
		expect(responseNumbers).toHaveLength(successes.length);
		for (const number of responseNumbers) {
			expect(number).toMatch(/^PI-\d+$/);
		}

		// No two successful creates — and no two stored rows — share a number.
		expect(new Set(responseNumbers).size).toBe(responseNumbers.length);
		expect(new Set(storedNumbers).size).toBe(storedNumbers.length);
		expect(stored).toHaveLength(successes.length);
		expect(new Set(storedNumbers)).toEqual(new Set(responseNumbers));
		expect(sortedIds(stored.map((row) => Number(row.id)))).toEqual(
			sortedIds(idsOf(successes))
		);
		expect(scopedDuplicates).toHaveLength(0);
		expect(tableDuplicates).toHaveLength(0);
	});

	test('cleanup hard-deletes every row the races created', async () => {
		// `before` is recorded for the artifact, not asserted per table: a retry or
		// a filtered run re-enters `beforeAll`, which re-purges the namespace and
		// re-creates the orders, so the invoice tables can legitimately be empty
		// here. The orders always exist in this attempt, so they are safe to assert.
		const before = await countRaceRows();
		expect(before.orders).toBe(2);

		await purgeRaceRows();

		const after = await countRaceRows();
		evidence.cleanup = { before, after, orderUid, supplierOrderUid };
		saveEvidence();

		expect(after).toEqual({
			invoices: 0,
			purchase_invoices: 0,
			orders: 0,
		});
		const [orderByUid] = await rows<{ c: number }>(
			'SELECT COUNT(*) AS c FROM orders WHERE order_uid = ?',
			[orderUid]
		);
		expect(Number(orderByUid.c)).toBe(0);
		// The journal rows go with their orders: none may survive the purge.
		const [eventsByUid] = await rows<{ c: number }>(
			'SELECT COUNT(*) AS c FROM order_events WHERE order_uid IN (?, ?)',
			[orderUid, supplierOrderUid]
		);
		expect(Number(eventsByUid.c)).toBe(0);

		// The flow is only ok once every row is verifiably gone.
		writeArtifact(ARTIFACT, { ok: true, ...evidence });
		expect(readArtifact(ARTIFACT)).toMatchObject({ ok: true });
	});
});
