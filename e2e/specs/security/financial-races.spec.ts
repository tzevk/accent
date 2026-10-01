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
 * E1 — PO balance race. Six concurrent `POST /api/admin/invoices` (each 300)
 * hit one purchase order whose `remaining_balance` is 1000. The remediated
 * invariant is *consistency*, not a floor: `admin/invoices/route.js` locks the
 * PO row (`SELECT ... FOR UPDATE`) and decrements it relatively
 * (`remaining_balance = remaining_balance - ?`), so concurrent creates must
 * never lose a decrement — but over-limit rejection is explicitly out of scope
 * (the route never had a negative-balance rule), so `remaining_balance` may go
 * negative exactly as before. The spec therefore asserts
 * `final remaining_balance === 1000 - 300 x successfulCount`, one stored
 * invoice row per 2xx, and each 2xx number stored exactly once. Requests carry
 * distinct client-supplied numbers so the number-generator race cannot mask
 * the balance race.
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
const PO_PREFIX = 'E2E-RACE-PO-';
const PO_NUMBER = `${PO_PREFIX}${RUN}`;
const INVOICE_NUMBER_PREFIX = `${PO_PREFIX}INV-${RUN}-`;
const CLIENT_NAME = `E2E Race Client ${RUN}`;
const VENDOR_PREFIX = 'E2E Race Vendor ';
const VENDOR_NAME = `${VENDOR_PREFIX}${RUN}`;
const PO_OPENING_BALANCE = 1000;
const INVOICE_AMOUNT = 300;
const PURCHASE_INVOICE_AMOUNT = 100;
const CONCURRENCY = 6;

interface Attempt {
	status: number;
	id: number | null;
	number: string | null;
	message: string | null;
}

interface ApiJson {
	message?: string;
	error?: string;
	data?: { id?: number; invoice_number?: string };
}

interface PoRow {
	original_value: string;
	remaining_balance: string;
}

/**
 * Evidence collected across the tests, rewritten to the artifact after every
 * test so a failing assertion still leaves the observed statuses on disk.
 */
const evidence: Record<string, unknown> = {
	po: { poNumber: PO_NUMBER, openingBalance: PO_OPENING_BALANCE },
	finding:
		'POST allows remaining_balance to go negative by design; the remediated invariant is consistency (no lost updates), not a floor',
};

let api: APIRequestContext | undefined;
let poId = 0;

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

/** Table, column and prefix identifying every row this spec creates. */
const RACE_ROWS = [
	{ table: 'invoices', column: 'po_number', prefix: PO_PREFIX },
	{ table: 'purchase_invoices', column: 'vendor_name', prefix: VENDOR_PREFIX },
	{ table: 'purchase_orders', column: 'po_number', prefix: PO_PREFIX },
];

/** Hard-delete every row this spec owns, child tables first. */
async function purgeRaceRows(): Promise<void> {
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
	expect(artifact.po).toMatchObject({ poNumber: PO_NUMBER });
}

test.describe('financial races', () => {
	test.describe.configure({ timeout: 120_000 });

	test.beforeAll(async ({ playwright }) => {
		// Leftovers from a crashed earlier run would collide with the PO number.
		await purgeRaceRows();
		api = await loginAs(playwright, E2E_ENV.baseURL, 'superAdmin');

		// The POST only needs client_name + po_number + total; the PO row is
		// pre-inserted so the request takes the existing-PO branch
		// (`SELECT ... FOR UPDATE` + relative decrement).
		const po = await exec(
			`INSERT INTO purchase_orders
         (po_number, vendor_name, original_value, remaining_balance, po_date, status, isDelete)
       VALUES (?, ?, ?, ?, ?, 'draft', 0)`,
			[
				PO_NUMBER,
				VENDOR_NAME,
				PO_OPENING_BALANCE,
				PO_OPENING_BALANCE,
				new Date().toISOString().slice(0, 10),
			]
		);
		poId = po.insertId;
		evidence.po = {
			id: poId,
			poNumber: PO_NUMBER,
			openingBalance: PO_OPENING_BALANCE,
		};

		const seeded = await rows<{ id: number }>(
			'SELECT id FROM purchase_orders WHERE id = ?',
			[poId]
		);
		expect(seeded).toHaveLength(1);
	});

	test.afterAll(async () => {
		await purgeRaceRows();
		await api?.dispose();
	});

	test('concurrent invoice POSTs never lose a PO decrement', async () => {
		const payloads = Array.from({ length: CONCURRENCY }, (_, index) => ({
			client_name: CLIENT_NAME,
			po_number: PO_NUMBER,
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

		const [poRow] = await rows<PoRow>(
			'SELECT original_value, remaining_balance FROM purchase_orders WHERE id = ?',
			[poId]
		);
		expect(poRow).toBeTruthy();
		const finalBalance = Number(poRow.remaining_balance);

		const storedInvoices = await rows<{
			id: number;
			invoice_number: string;
			total: string;
		}>(
			`SELECT id, invoice_number, total FROM invoices
         WHERE po_number = ? AND isDelete = 0
         ORDER BY id`,
			[PO_NUMBER]
		);
		const storedNumbers = storedInvoices.map((row) => row.invoice_number);
		const storedSum = (
			await rows<{ sum_total: string | null }>(
				`SELECT SUM(total) AS sum_total FROM invoices
           WHERE po_number = ? AND isDelete = 0`,
				[PO_NUMBER]
			)
		)[0]?.sum_total;
		const duplicateGroups = await rows<{ invoice_number: string; c: number }>(
			`SELECT invoice_number, COUNT(*) AS c FROM invoices
         WHERE po_number = ? AND isDelete = 0
         GROUP BY invoice_number HAVING c > 1`,
			[PO_NUMBER]
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
			finalBalance,
			openingBalance: Number(poRow.original_value),
			storedRowCount: storedInvoices.length,
			duplicateGroups: duplicateGroups.length,
		};
		saveEvidence();

		// Every create lands: the requests carry distinct client numbers, so the
		// only shared resource is the locked PO row, which serializes them.
		expect(failures).toEqual([]);
		expect(successes).toHaveLength(CONCURRENCY);
		expect(new Set(numbersOf(successes))).toEqual(
			new Set(payloads.map((payload) => payload.invoice_number))
		);

		// The lost-update invariant: exactly one decrement per successful create.
		expect(finalBalance).toBe(
			PO_OPENING_BALANCE - INVOICE_AMOUNT * successes.length
		);
		expect(Number(poRow.original_value)).toBe(PO_OPENING_BALANCE);

		// The database mirrors the 2xx count: one row, one number, one total each.
		expect(storedInvoices).toHaveLength(successes.length);
		expect(sortedIds(storedInvoices.map((row) => Number(row.id)))).toEqual(
			sortedIds(idsOf(successes))
		);
		expect(new Set(storedNumbers).size).toBe(storedNumbers.length);
		expect(Number(storedSum)).toBe(INVOICE_AMOUNT * successes.length);
		expect(
			storedInvoices.every((row) => Number(row.total) === INVOICE_AMOUNT)
		).toBe(true);
		expect(duplicateGroups).toHaveLength(0);
		for (const number of numbersOf(successes)) {
			expect(storedNumbers.filter((stored) => stored === number)).toHaveLength(
				1
			);
		}
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
		// re-inserts only the PO, so the invoice tables can legitimately be empty
		// here. The PO always exists in this attempt, so it is safe to assert.
		const before = await countRaceRows();
		expect(before.purchase_orders).toBe(1);

		await purgeRaceRows();

		const after = await countRaceRows();
		evidence.cleanup = { before, after, poId };
		saveEvidence();

		expect(after).toEqual({
			purchase_orders: 0,
			invoices: 0,
			purchase_invoices: 0,
		});
		const [poById] = await rows<{ c: number }>(
			'SELECT COUNT(*) AS c FROM purchase_orders WHERE id = ?',
			[poId]
		);
		expect(Number(poById.c)).toBe(0);

		// The flow is only ok once every row is verifiably gone.
		writeArtifact(ARTIFACT, { ok: true, ...evidence });
		expect(readArtifact(ARTIFACT)).toMatchObject({ ok: true });
	});
});
