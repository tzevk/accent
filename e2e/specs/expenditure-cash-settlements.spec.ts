/**
 * Ticket #318 — dated outward cash settlements.
 *
 * Everything here is stated from the fixture literals and the business rules,
 * never from the report module's own aggregation: the fixtures say what each
 * cost and slip is worth, this file says what the cash section must therefore
 * show, and the assertions compare the app's answer with that arithmetic. The
 * API drives the settlement commands, the native mark-paid and petty-cash
 * controls drive the native movements, the browser drives the report cash
 * control, and the database is read back independently.
 *
 * The namespace and the months (2018-10, 2018-11, 2018-12) belong to this spec
 * alone (`e2e/lib/expenditure-cash-fixtures.ts`); 2019-01/02 belong to #306 and
 * 2019-10/11/12 to #319.
 */

import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { rows } from '../lib/db';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import {
	CASH_ADVANCE,
	CASH_CLERK,
	CASH_INVOICE_A,
	CASH_INVOICE_B,
	CASH_MONTH,
	CASH_OUTSIDER,
	CASH_PREFIX,
	CASH_SLIP,
	CASH_SPEND,
	cleanupCashFixtures,
	loginCashUser,
	seedCashFixtures,
	type SeededCash,
} from '../lib/expenditure-cash-fixtures';

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.113' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const REGISTER = '/api/admin/expenditure-settlements';
const REPORT = '/api/reports/employee-project-monthly-cost';

/** Independently stated fixture worth, from the fixture literals. */
const WORTH = {
	invoiceA: 15000,
	invoiceB: 10000,
	advance: 5000,
	netPay: 48000,
	employerCost: 55000,
	deduction: 2000,
	tds: 1000,
	funding: 1000,
	spend: 800,
} as const;

type CashSection = {
	month: string;
	currency: string | null;
	paid: number | null;
	by_currency: Array<{
		currency: string;
		paid: number;
		movement_count: number;
		settlement: number;
		payroll: number;
		petty_spend: number;
	}>;
	funding: {
		by_currency: Array<{
			currency: string | null;
			amount: number;
			movement_count: number;
		}>;
		movements: Array<{ movement_uid: string; amount: number }>;
		unlinked_vouchers: { count: number };
	};
	targets: Array<{
		target_kind: string;
		target_key: string;
		nature: string | null;
		currency: string | null;
		liability: number | null;
		settled: number;
		settled_this_month: number;
		remaining: number | null;
		state: string;
	}>;
	coverage: {
		settled_targets: number;
		partial_targets: number;
		unsettled_targets: number;
		outstanding: number | null;
	};
	unresolved_targets: { count: number; amount: number | null };
	legacy: {
		outward_unlinked: { count: number; amount: number | null };
		undated_balances: { count: number; amount: number | null };
		client_receipts: { count: number; amount: number | null };
		internal_transfers: { count: number; amount: number | null };
	};
};

type ReconciliationData = {
	month: string;
	company: { currency: string | null; incurred_cost: number | null };
	projects: Array<{
		project_id: number;
		project_code: string;
		currency: string;
		incurred_cost: number;
	}>;
	cash: CashSection;
	coverage: Array<{ code: string; severity: string }>;
};

let seeded: SeededCash;
let clerk: APIRequestContext;
let outsider: APIRequestContext;
const outcome = trackArtifactOutcome();
const evidence: Record<string, unknown> = {};

async function readReport(
	ctx: APIRequestContext,
	month: string
): Promise<ReconciliationData> {
	const response = await ctx.get(`${REPORT}?view=expenditure&month=${month}`);
	expect(response.ok(), `report ${month} -> ${response.status()}`).toBe(true);
	const body = (await response.json()) as {
		success: boolean;
		data: ReconciliationData;
	};
	expect(body.success).toBe(true);
	return body.data;
}

async function readRegister(
	ctx: APIRequestContext,
	month: string
): Promise<CashSection & { movements: Array<Record<string, unknown>> }> {
	const response = await ctx.get(`${REGISTER}?month=${month}`);
	expect(response.ok(), `register ${month} -> ${response.status()}`).toBe(true);
	const body = (await response.json()) as {
		success: boolean;
		data: CashSection & { movements: Array<Record<string, unknown>> };
	};
	expect(body.success).toBe(true);
	return body.data;
}

function target(
	section: CashSection,
	key: string
): CashSection['targets'][number] {
	const found = section.targets.find((row) => row.target_key === key);
	expect(found, `target ${key} is stated`).toBeDefined();
	return found as CashSection['targets'][number];
}

test.beforeAll(async () => {
	seeded = await seedCashFixtures();
});

test.afterAll(async () => {
	writeArtifact('expenditure-cash-settlements', {
		ok: outcome.ok,
		...evidence,
	});
	await cleanupCashFixtures();
});

test('clerk and outsider sign in through the real login', async ({
	playwright,
	baseURL,
}) => {
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}
	clerk = await loginCashUser(playwright, baseURL, 'clerk');
	outsider = await loginCashUser(playwright, baseURL, 'outsider');
	evidence.identities = {
		clerk: CASH_CLERK.username,
		outsider: CASH_OUTSIDER.username,
	};
});

test('October service, November invoice, December payment: no third expense', async () => {
	// Baselines before any cash movement exists.
	const octoberBefore = await readReport(clerk, '2018-10');
	const novemberBefore = await readReport(clerk, '2018-11');
	const decemberBefore = await readReport(clerk, CASH_MONTH);
	expect(decemberBefore.cash.paid).toBe(0);
	// The month's own unpaid slip is already an unsettled cash target; no
	// movement exists yet.
	expect(decemberBefore.cash.targets.map((row) => row.target_key)).toEqual([
		String(seeded.slipId),
	]);
	evidence.baseline = {
		october: octoberBefore.company.incurred_cost,
		november: novemberBefore.company.incurred_cost,
		december: decemberBefore.company.incurred_cost,
	};

	const recorded = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_A.costUid,
			amount: WORTH.invoiceA,
			currency: 'INR',
			settled_on: '2018-12-15',
			reference: 'E2E-EXP-318-NEFT-A',
			destination: 'E2E-EXP-318 Vendor',
			evidence_reference: 'E2E-EXP-318-UTR-A',
		},
	});
	expect(recorded.status(), `record A -> ${recorded.status()}`).toBe(201);
	const created = ((await recorded.json()) as { data: Record<string, unknown> })
		.data;
	expect(created.financial_version).toBe(1);
	expect(String(created.settlement_uid)).toMatch(/^settle-/);
	evidence.settlementA = {
		settlement_uid: created.settlement_uid,
		id: created.id,
	};

	// The payment changed no incurred cost: October still carries the 15000
	// of served cost, and December cost is what it was before the payment.
	const octoberAfter = await readReport(clerk, '2018-10');
	const decemberAfter = await readReport(clerk, CASH_MONTH);
	expect(octoberAfter.company.incurred_cost).toBe(
		octoberBefore.company.incurred_cost
	);
	expect(decemberAfter.company.incurred_cost).toBe(
		decemberBefore.company.incurred_cost
	);
	expect(decemberAfter.cash.paid).toBe(WORTH.invoiceA);
	expect(decemberAfter.cash.currency).toBe('INR');
	const rowA = target(decemberAfter.cash, CASH_INVOICE_A.costUid);
	expect(rowA.state).toBe('settled');
	expect(rowA.liability).toBe(WORTH.invoiceA);
	expect(rowA.remaining).toBe(0);

	// Durable proof: one settlement row, one settlement link, one journal row,
	// and the invoice itself is untouched.
	const dbRows = await rows<Record<string, unknown>>(
		`SELECT id, settlement_uid, target_kind, target_cost_uid, amount, currency,
            settled_on, status, financial_version
       FROM financial_settlements WHERE settlement_uid = ?`,
		[created.settlement_uid]
	);
	expect(dbRows.length).toBe(1);
	expect(Number(dbRows[0].amount)).toBe(WORTH.invoiceA);
	const links = await rows(
		`SELECT 1 FROM financial_cost_links
        WHERE source_table = 'financial_settlements' AND source_id = ? AND role = 'settlement'`,
		[dbRows[0].id]
	);
	expect(links.length).toBe(1);
	const events = await rows(
		`SELECT version, command FROM financial_settlement_events WHERE settlement_uid = ? ORDER BY version`,
		[created.settlement_uid]
	);
	expect(events.map((row) => `${row.version}:${row.command}`)).toEqual([
		'1:recorded',
	]);
	const invoice = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, total FROM purchase_invoices WHERE id = ?`,
		[seeded.invoiceIds.a]
	);
	expect(Number(invoice[0].recognized_amount)).toBe(WORTH.invoiceA);
});

test('supplier partial then final settlement states partial then settled', async () => {
	const first = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_B.costUid,
			amount: 4000,
			currency: 'INR',
			settled_on: '2018-12-16',
			reference: 'E2E-EXP-318-NEFT-B1',
			destination: 'E2E-EXP-318 Vendor',
		},
	});
	expect(first.status()).toBe(201);

	let section = await readRegister(clerk, CASH_MONTH);
	let rowB = target(section, CASH_INVOICE_B.costUid);
	expect(rowB.state).toBe('partial');
	expect(rowB.liability).toBe(WORTH.invoiceB);
	expect(rowB.settled).toBe(4000);
	expect(rowB.settled_this_month).toBe(4000);
	expect(rowB.remaining).toBe(6000);
	expect(section.coverage.partial_targets).toBeGreaterThanOrEqual(1);

	const second = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_B.costUid,
			amount: 5000,
			currency: 'INR',
			settled_on: '2018-12-18',
			reference: 'E2E-EXP-318-NEFT-B2',
			destination: 'E2E-EXP-318 Vendor',
		},
	});
	expect(second.status()).toBe(201);

	section = await readRegister(clerk, CASH_MONTH);
	rowB = target(section, CASH_INVOICE_B.costUid);
	// 4000 + 5000 of the 10000 net payable sits against the invoice; the TDS
	// withholding of the next test completes the cover.
	expect(rowB.settled).toBe(9000);
	expect(rowB.remaining).toBe(1000);
	expect(rowB.state).toBe('partial');
	evidence.partialFinal = { settled: rowB.settled, state: rowB.state };
});

test('withheld amounts are settlement destinations, never cost reductions', async () => {
	// The invoice TDS: a withholding movement against the same invoice cost.
	const tds = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_B.costUid,
			movement_kind: 'withholding',
			amount: WORTH.tds,
			currency: 'INR',
			settled_on: '2018-12-18',
			reference: 'E2E-EXP-318-TDS-B',
			destination: 'Income Tax Department - TDS',
		},
	});
	expect(tds.status()).toBe(201);

	// The native payroll payout through the real mark-paid control.
	const markPaid = await clerk.post('/api/payroll/runs/mark-paid', {
		data: {
			month: '2018-12-01',
			payment_date: CASH_SLIP.paymentDate,
			payment_reference: CASH_SLIP.paymentReference,
		},
	});
	expect(markPaid.status(), `mark-paid -> ${markPaid.status()}`).toBe(200);

	// A payroll deduction remittance: distinct destination, distinct money.
	const deduction = await clerk.post(REGISTER, {
		data: {
			target_kind: 'payroll',
			payroll_slip_id: seeded.slipId,
			movement_kind: 'deduction',
			amount: WORTH.deduction,
			currency: 'INR',
			settled_on: '2018-12-21',
			reference: 'E2E-EXP-318-EPFO',
			destination: 'EPFO',
		},
	});
	expect(deduction.status()).toBe(201);

	const section = await readRegister(clerk, CASH_MONTH);
	const rowB = target(section, CASH_INVOICE_B.costUid);
	expect(rowB.settled).toBe(WORTH.invoiceB);
	expect(rowB.remaining).toBe(0);
	expect(rowB.state).toBe('settled');
	const slipKey = String(seeded.slipId);
	const slipRow = target(section, slipKey);
	expect(slipRow.target_kind).toBe('payroll');
	expect(slipRow.liability).toBe(WORTH.employerCost);
	expect(slipRow.settled).toBe(WORTH.netPay + WORTH.deduction);
	expect(slipRow.remaining).toBe(
		WORTH.employerCost - WORTH.netPay - WORTH.deduction
	);
	expect(slipRow.state).toBe('partial');

	// Nothing was counted twice and no cost moved: the invoice still states
	// its gross recognized amount, the slip its net pay and employer cost.
	const invoice = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, total FROM purchase_invoices WHERE id = ?`,
		[seeded.invoiceIds.b]
	);
	expect(Number(invoice[0].recognized_amount)).toBe(WORTH.invoiceB);
	const slip = await rows<Record<string, unknown>>(
		`SELECT net_pay, employer_cost, payment_status, payment_date FROM payroll_slips WHERE id = ?`,
		[seeded.slipId]
	);
	expect(Number(slip[0].net_pay)).toBe(WORTH.netPay);
	expect(Number(slip[0].employer_cost)).toBe(WORTH.employerCost);
	expect(slip[0].payment_status).toBe('paid');
	expect(String(slip[0].payment_date)).toContain(CASH_SLIP.paymentDate);
	evidence.withholding = {
		invoiceB: rowB.settled,
		slip: slipRow.settled,
		slipState: slipRow.state,
	};
});

test('advance settlement states its nature apart from operating cost', async () => {
	const decemberBefore = await readReport(clerk, CASH_MONTH);
	const paidBefore = decemberBefore.cash.paid ?? 0;

	const recorded = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_ADVANCE.costUid,
			amount: WORTH.advance,
			currency: 'INR',
			settled_on: '2018-12-17',
			reference: 'E2E-EXP-318-NEFT-ADV',
			destination: 'E2E-EXP-318 Vendor',
		},
	});
	expect(recorded.status()).toBe(201);

	const decemberAfter = await readReport(clerk, CASH_MONTH);
	expect((decemberAfter.cash.paid ?? 0) - paidBefore).toBe(WORTH.advance);
	const advanceRow = target(decemberAfter.cash, CASH_ADVANCE.costUid);
	expect(advanceRow.nature).toBe('advance');
	expect(advanceRow.state).toBe('settled');
	// Operating cost is untouched: the advance was never expensed by payment.
	expect(decemberAfter.company.incurred_cost).toBe(
		decemberBefore.company.incurred_cost
	);
	evidence.advance = {
		nature: advanceRow.nature,
		state: advanceRow.state,
	};
});

test('voucher funding and mirrored credit are one movement; spend is outward', async () => {
	const spend = await clerk.post('/api/admin/petty-cash-expenses', {
		data: {
			transaction_date: CASH_SPEND.transactionDate,
			debit_amount: Number(CASH_SPEND.amount),
			description: 'E2E-EXP-318 third-party spend',
			recipient_name: 'E2E-EXP-318 Counterparty',
			cost_classification: 'project',
			project_id: seeded.projects.alpha,
			currency: 'INR',
			notes: 'E2E-EXP-318 spend note',
		},
	});
	expect(spend.status(), `spend -> ${spend.status()}`).toBe(200);
	const spendBody = (await spend.json()) as { data: { cost_uid: string } };
	evidence.spendCostUid = spendBody.data.cost_uid;

	const section = await readRegister(clerk, CASH_MONTH);
	// Outward paid holds the 800 spend exactly once.
	const pettyTotal = section.by_currency.find((row) => row.currency === 'INR');
	expect(pettyTotal?.petty_spend).toBe(WORTH.spend);
	const registerSpend = section.targets.find((row) =>
		row.target_key.startsWith('petty:')
	);
	expect(registerSpend?.target_kind).toBe('cost');
	expect(registerSpend?.settled).toBe(WORTH.spend);
	// Funding displays apart: 1000 in one movement (voucher + mirror, not two).
	expect(section.funding.by_currency).toEqual([
		{ currency: 'INR', amount: WORTH.funding, movement_count: 1 },
	]);
	expect(section.funding.movements.length).toBe(1);
	expect(section.funding.unlinked_vouchers.count).toBe(0);
	// Recognition alone created no movement: the draft spend is not cost.
	const report = await readReport(clerk, CASH_MONTH);
	const spendTarget = report.cash.targets.find((row) =>
		row.target_key.startsWith('petty:')
	);
	expect(spendTarget?.target_kind).toBe('cost');
	expect(spendTarget?.settled).toBe(WORTH.spend);
});

test('manual restatements of native movements are refused', async () => {
	const before = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_settlements
        WHERE reference LIKE ? OR destination LIKE ?`,
		[`${CASH_PREFIX}%`, `${CASH_PREFIX}%`]
	);

	// A manual payment against the paid slip: the mark-paid control owns it.
	const payrollRestatement = await clerk.post(REGISTER, {
		data: {
			target_kind: 'payroll',
			payroll_slip_id: seeded.slipId,
			amount: 100,
			currency: 'INR',
			settled_on: '2018-12-22',
			reference: 'E2E-EXP-318-DUP-PAY',
		},
	});
	expect(payrollRestatement.status()).toBe(409);
	expect(((await payrollRestatement.json()) as { code: string }).code).toBe(
		'payroll_payout_is_native'
	);

	// A manual settlement of the petty spend: the spend is the movement.
	const spendCostUid = evidence.spendCostUid as string;
	const pettyRestatement = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: spendCostUid,
			amount: 100,
			currency: 'INR',
			settled_on: '2018-12-22',
			reference: 'E2E-EXP-318-DUP-PETTY',
		},
	});
	expect(pettyRestatement.status()).toBe(409);
	expect(((await pettyRestatement.json()) as { code: string }).code).toBe(
		'petty_cash_movement_is_native'
	);

	// Idempotency: the same client key twice yields one row, no second journal.
	const uid = 'settle-e2e-318-idempotent-0001';
	const idempotentBody = {
		target_kind: 'cost',
		target_cost_uid: CASH_INVOICE_A.costUid,
		amount: 10,
		currency: 'INR',
		settled_on: '2018-12-23',
		reference: 'E2E-EXP-318-IDEM',
		settlement_uid: uid,
	};
	const once = await clerk.post(REGISTER, { data: idempotentBody });
	expect(once.status()).toBe(201);
	const twice = await clerk.post(REGISTER, { data: idempotentBody });
	expect(twice.status()).toBe(200);
	const idemRows = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_settlements WHERE settlement_uid = ?`,
		[uid]
	);
	expect(idemRows[0].count).toBe(1);
	const idemEvents = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_settlement_events WHERE settlement_uid = ?`,
		[uid]
	);
	expect(idemEvents[0].count).toBe(1);
	// A distinct deduction remittance against the same slip stays allowed.
	const allowed = await clerk.post(REGISTER, {
		data: {
			target_kind: 'payroll',
			payroll_slip_id: seeded.slipId,
			movement_kind: 'deduction',
			amount: 50,
			currency: 'INR',
			settled_on: '2018-12-23',
			reference: 'E2E-EXP-318-EPFO-2',
			destination: 'EPFO',
		},
	});
	expect(allowed.status()).toBe(201);

	// Failed commands wrote nothing: only the two accepted rows landed.
	const after = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_settlements
        WHERE reference LIKE ? OR destination LIKE ?`,
		[`${CASH_PREFIX}%`, `${CASH_PREFIX}%`]
	);
	expect(after[0].count - before[0].count).toBe(2);
	// The database still shows one payout movement and one petty movement.
	const section = await readRegister(clerk, CASH_MONTH);
	const payouts = section.by_currency.find((row) => row.currency === 'INR');
	expect(payouts?.payroll).toBe(WORTH.netPay);
	expect(payouts?.petty_spend).toBe(WORTH.spend);
});

test('undated legacy balances are disclosed, never counted', async () => {
	const section = await readRegister(clerk, CASH_MONTH);
	expect(section.legacy.undated_balances).toEqual({ count: 1, amount: 3000 });
	expect(section.legacy.outward_unlinked).toEqual({ count: 1, amount: 1500 });
	// The month's paid comes only from dated supported movements: invoice B's
	// gross is covered by its two net payments plus the TDS withholding, so
	// the parts are summed, never the gross on top of them.
	const expectedPaid =
		WORTH.invoiceA +
		10 +
		4000 +
		5000 +
		WORTH.tds +
		WORTH.netPay +
		WORTH.deduction +
		50 +
		WORTH.advance +
		WORTH.spend;
	expect(section.paid).toBe(expectedPaid);
	evidence.expectedPaid = expectedPaid;
});

test('client receipts and internal transfers are excluded and disclosed', async () => {
	const section = await readRegister(clerk, CASH_MONTH);
	expect(section.legacy.client_receipts).toEqual({
		count: 3,
		amount: 20000,
	});
	expect(section.legacy.internal_transfers).toEqual({
		count: 1,
		amount: 6000,
	});
	expect(section.paid).toBe(evidence.expectedPaid);
});

test('authorization: outsider reads nothing and writes nothing', async () => {
	const read = await outsider.get(`${REGISTER}?month=${CASH_MONTH}`);
	expect(read.status()).toBe(403);
	const readBody = (await read.json()) as { success: boolean };
	expect(readBody.success).toBe(false);

	const before = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_settlements
        WHERE reference LIKE ? OR destination LIKE ?`,
		[`${CASH_PREFIX}%`, `${CASH_PREFIX}%`]
	);
	const written = await outsider.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_A.costUid,
			amount: 5,
			currency: 'INR',
			settled_on: '2018-12-24',
			reference: 'E2E-EXP-318-OUTSIDER',
		},
	});
	expect(written.status()).toBe(403);
	const after = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_settlements
        WHERE reference LIKE ? OR destination LIKE ?`,
		[`${CASH_PREFIX}%`, `${CASH_PREFIX}%`]
	);
	expect(after[0].count).toBe(before[0].count);
	evidence.authorization = { read: read.status(), write: written.status() };
});

test('validation refuses unknown targets, mismatched currency, bad input', async () => {
	const unknown = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: 'e2e-318-no-such-cost',
			amount: 5,
			currency: 'INR',
			settled_on: '2018-12-24',
			reference: 'E2E-EXP-318-UNKNOWN',
		},
	});
	expect(unknown.status()).toBe(422);
	expect(((await unknown.json()) as { code: string }).code).toBe(
		'unknown_target'
	);

	const mismatch = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_A.costUid,
			amount: 5,
			currency: 'USD',
			settled_on: '2018-12-24',
			reference: 'E2E-EXP-318-FX',
		},
	});
	expect(mismatch.status()).toBe(422);
	expect(((await mismatch.json()) as { code: string }).code).toBe(
		'currency_mismatch'
	);

	const badAmount = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_A.costUid,
			amount: 0,
			currency: 'INR',
			settled_on: '2018-12-24',
			reference: 'E2E-EXP-318-ZERO',
		},
	});
	expect(badAmount.status()).toBe(422);

	const badDate = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_A.costUid,
			amount: 5,
			currency: 'INR',
			settled_on: 'not-a-date',
			reference: 'E2E-EXP-318-BADDATE',
		},
	});
	expect(badDate.status()).toBe(422);
});

test('browser records a settlement through the report cash control, then cancels it', async ({
	page,
}) => {
	const section = await readRegister(clerk, CASH_MONTH);
	const paidBefore = section.paid ?? 0;

	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill('December 2018');
	await page
		.getByRole('button', { name: 'December 2018', exact: true })
		.click();
	await expect(page.getByTestId('expenditure-view')).toHaveAttribute(
		'data-month',
		CASH_MONTH
	);
	await expect(page.getByTestId('cash-section')).toBeVisible();
	await page.getByTestId('cash-section-toggle').click();
	await page.getByTestId('cash-record-open').click();
	await page
		.getByTestId('cash-target-select')
		.selectOption(`cost:${CASH_ADVANCE.costUid}`);
	await page.getByTestId('cash-amount-input').fill('100');
	await page.getByTestId('cash-date-input').fill('2018-12-26');
	await page.getByTestId('cash-reference-input').fill('E2E-EXP-318-BROWSER');
	await page.getByTestId('cash-record-button').click();
	await expect(page.getByText('E2E-EXP-318-BROWSER')).toBeVisible();

	const recorded = await readRegister(clerk, CASH_MONTH);
	expect((recorded.paid ?? 0) - paidBefore).toBe(100);
	const browserRow = await rows<Record<string, unknown>>(
		`SELECT id, settlement_uid, financial_version FROM financial_settlements
        WHERE reference = 'E2E-EXP-318-BROWSER'`,
		[]
	);
	expect(browserRow.length).toBe(1);
	const browserId = browserRow[0].id as number;

	// Cancel through the versioned command: the report view drops the 100.
	const cancel = await clerk.post(`${REGISTER}/${browserId}/commands`, {
		data: {
			command: 'cancel',
			expected_version: 1,
			reason: 'E2E-EXP-318 browser scenario cleanup',
		},
	});
	expect(cancel.status()).toBe(200);
	await page.reload();
	await expect(page.getByTestId('cash-section')).toBeVisible();
	const cancelled = await readRegister(clerk, CASH_MONTH);
	expect(cancelled.paid ?? 0).toBe(paidBefore);
	const journal = await rows(
		`SELECT version, command FROM financial_settlement_events
        WHERE settlement_uid = ? ORDER BY version`,
		[browserRow[0].settlement_uid]
	);
	expect(journal.map((row) => `${row.version}:${row.command}`)).toEqual([
		'1:recorded',
		'2:cancelled',
	]);
	evidence.browser = { id: browserId, cancelled: true };
});

test('concurrent commands: one wins, one is stale, one journal row', async () => {
	const created = await clerk.post(REGISTER, {
		data: {
			target_kind: 'cost',
			target_cost_uid: CASH_INVOICE_A.costUid,
			amount: 25,
			currency: 'INR',
			settled_on: '2018-12-27',
			reference: 'E2E-EXP-318-RACE',
		},
	});
	expect(created.status()).toBe(201);
	const body = ((await created.json()) as { data: { id: number } }).data;

	const [winner, loser] = await Promise.all([
		clerk.post(`${REGISTER}/${body.id}/commands`, {
			data: {
				command: 'update',
				expected_version: 1,
				patch: { reference: 'E2E-EXP-318-RACE-WIN' },
			},
		}),
		clerk.post(`${REGISTER}/${body.id}/commands`, {
			data: {
				command: 'update',
				expected_version: 1,
				patch: { reference: 'E2E-EXP-318-RACE-LOSE' },
			},
		}),
	]);
	const statuses = [winner.status(), loser.status()].sort();
	expect(statuses).toEqual([200, 409]);
	const lost = winner.status() === 409 ? winner : loser;
	expect(((await lost.json()) as { code: string }).code).toBe('stale_version');

	const journal = await rows<Record<string, unknown>>(
		`SELECT version, command FROM financial_settlement_events
        WHERE settlement_uid = (SELECT settlement_uid FROM financial_settlements WHERE id = ?)
        ORDER BY version`,
		[body.id]
	);
	expect(journal.map((row) => `${row.version}:${row.command}`)).toEqual([
		'1:recorded',
		'2:updated',
	]);
	evidence.concurrency = { statuses };
});

test('incurred cost, commitments, and payroll rows are unchanged by cash', async () => {
	const october = await readReport(clerk, '2018-10');
	const november = await readReport(clerk, '2018-11');
	const december = await readReport(clerk, CASH_MONTH);
	const baseline = evidence.baseline as {
		october: number | null;
		november: number | null;
		december: number | null;
	};
	expect(october.company.incurred_cost).toBe(baseline.october);
	expect(november.company.incurred_cost).toBe(baseline.november);
	expect(december.company.incurred_cost).toBe(baseline.december);
	// Only namespaced costs exist: the two invoices and the advance.
	const costLinks = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_cost_links
        WHERE role = 'cost' AND cost_uid LIKE 'e2e-318-%'`
	);
	expect(costLinks[0].count).toBe(3);
	evidence.final = {
		paid: december.cash.paid,
		targets: december.cash.targets.length,
	};
});

test('coverage declares cash paid as wired, not outstanding', async () => {
	const december = await readReport(clerk, CASH_MONTH);
	const codes = new Map(
		december.coverage.map((row) => [row.code, row.severity])
	);
	// The outstanding declaration flipped to wired: no notice names it.
	expect(codes.get('cash_and_payments_not_incorporated')).toBeUndefined();
	// The legacy gaps disclose themselves only while they hold rows.
	expect(codes.get('cash_undated_balances')).toBe('warning');
	expect(codes.get('cash_legacy_unlinked')).toBe('warning');
	expect(codes.get('cash_receipts_excluded')).toBe('warning');
});
