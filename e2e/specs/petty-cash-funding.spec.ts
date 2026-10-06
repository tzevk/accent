/**
 * Ticket #316 — petty-cash funding and spending controls.
 *
 * Everything here is stated from the fixture literals and the business rules,
 * never from the report module's own aggregation: the fixture rows say what
 * they are worth, this file says what the register and the reconciliation must
 * therefore show, and the assertions compare the app's answer with that
 * arithmetic. The browser drives the real register controls (record spending,
 * recognize it) and the real report; the API drives the versioned commands and
 * the authorization outcomes; the database is read back independently.
 *
 * The namespace and the months (2019-06, 2019-08) belong to this spec alone
 * (`e2e/lib/petty-cash-fixtures.ts`); 2019-01/02 belong to #306 and 2019-10/11/12
 * to #319.
 */

import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import { rows } from '../lib/db';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import {
	PETTY_CASH_LATER_MONTH,
	PETTY_CASH_MONTH,
	PETTY_CASH_PREFIX,
	PETTY_CASH_PROJECTS,
	cleanupPettyCashFixtures,
	findPettyCashSpendByAmount,
	loginPettyCashUser,
	seedPettyCashFixtures,
	type SeededPettyCash,
} from '../lib/petty-cash-fixtures';

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.26' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = PETTY_CASH_MONTH;
const LATER_MONTH = PETTY_CASH_LATER_MONTH;
const MONTH_LABEL = 'June 2019';
const REGISTER = '/api/admin/petty-cash-expenses';

/** The independently stated expectations, from the fixture literals. */
const EXPECTED = {
	voucherTotal: 5000,
	voucherReduced: 4500,
	targetCost: 800,
	spendA: 1200,
	spendB: 300,
	spendC: 800,
	spendD: 400,
	spendE: 500,
} as const;

type ReconciliationData = {
	month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		groups: Array<{ key: string; amount: number }>;
	};
	projects: Array<{
		project_id: number;
		project_code: string;
		currency: string;
		incurred_cost: number;
	}>;
	coverage: Array<{ code: string; severity: string }>;
	petty_cash: {
		month: string | null;
		currency: string | null;
		funding: number | null;
		spend: number | null;
		remaining_funding: number | null;
		recognized_cost: number | null;
		by_currency: Array<{
			currency: string;
			funding: number;
			spend: number;
			funded_spend: number;
			settled_spend: number;
			remaining_funding: number;
			recognized_cost: number;
			unconfirmed_spend: number;
			funding_event_count: number;
		}>;
		unresolved_settlements: { count: number; amount: number | null };
		unlinked_spend: { count: number; amount: number | null };
	};
};

let seeded: SeededPettyCash;
let voucherId = 0;
let voucherNumber = '';
let mirrorId = '';
const spends: Record<string, Record<string, unknown>> = {};
const controlEvidence: Record<string, unknown> = {};
const authorizationEvidence: Record<string, unknown> = {};

async function reconciliation(
	request: APIRequestContext,
	month: string
): Promise<ReconciliationData> {
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost?view=expenditure&month=${month}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as ReconciliationData;
}

function group(data: ReconciliationData, key: string): number {
	const found = data.company.groups.find((entry) => entry.key === key);
	expect(found, `group ${key}`).toBeTruthy();
	return found!.amount;
}

function coverageCodes(data: ReconciliationData): string[] {
	return data.coverage.map((entry) => entry.code);
}

function projectCost(data: ReconciliationData, code: string): number {
	const row = data.projects.find((entry) => entry.project_code === code);
	expect(row, `project row ${code}`).toBeTruthy();
	return row!.incurred_cost;
}

async function createVoucher(
	request: APIRequestContext,
	totalAmount: number
): Promise<void> {
	const response = await request.post('/api/admin/cash-vouchers', {
		data: {
			voucher_date: `${MONTH}-03`,
			voucher_type: 'payment',
			paid_to: `${PETTY_CASH_PREFIX} Vendor`,
			// Free text on purpose: the report must never infer a Project from it.
			project_number: PETTY_CASH_PROJECTS.alpha.code,
			payment_mode: 'cash',
			total_amount: totalAmount,
			description: `${PETTY_CASH_PREFIX} voucher A`,
			notes: `${PETTY_CASH_PREFIX} funding`,
			line_items: [],
			status: 'approved',
		},
	});
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	voucherId = Number(body.data.id);
	voucherNumber = String(body.data.voucher_number);
}

async function recordSpend(
	request: APIRequestContext,
	data: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post(REGISTER, { data });
	return {
		status: response.status(),
		body: (await response.json()) as Record<string, unknown>,
	};
}

async function runCommand(
	request: APIRequestContext,
	id: string,
	data: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post(`${REGISTER}/${id}/commands`, { data });
	return {
		status: response.status(),
		body: (await response.json()) as Record<string, unknown>,
	};
}

async function spendRow(id: string): Promise<Record<string, unknown>> {
	const found = await rows<Record<string, unknown>>(
		`SELECT id, transaction_number, cost_uid, entry_kind, recognition_state,
            financial_version, cost_classification, project_id, recognition_period,
            period_basis, debit_amount, credit_amount, source_voucher_id,
            linked_cost_uid, recognized_amount, evidence_reference, notes, isDelete
       FROM petty_cash_expenses WHERE id = ?`,
		[id]
	);
	expect(found.length, `petty-cash row ${id}`).toBe(1);
	return found[0];
}

async function journalFor(costUid: string) {
	return rows<{ version: number; command: string }>(
		`SELECT version, command FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[costUid]
	);
}

/** Open the report on the expenditure view for one month. */
async function openExpenditure(page: Page, monthLabel: string): Promise<void> {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(monthLabel);
	await page.getByRole('button', { name: monthLabel, exact: true }).click();
}

async function kpi(page: Page, testId: string): Promise<number> {
	await expect(page.getByTestId(testId)).toBeVisible();
	const raw = await page.getByTestId(testId).getAttribute('data-amount');
	return Number(raw);
}

async function registerCards(page: Page) {
	return {
		funding: await kpi(page, 'petty-funding-amount'),
		spend: await kpi(page, 'petty-spend-amount'),
		remaining: await kpi(page, 'petty-remaining-amount'),
		recognized: await kpi(page, 'petty-recognized-amount'),
	};
}

/** Wait for the app-created spend row to appear, then read it back. */
async function waitForSpendByAmount(
	amount: number
): Promise<Record<string, unknown>> {
	for (let attempt = 0; attempt < 40; attempt++) {
		const found = await findPettyCashSpendByAmount(amount);
		if (found) return found;
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 250);
		await promise;
	}
	throw new Error(`No petty-cash spending of ${amount} appeared in the register`);
}

function publish() {
	const artifact = writeArtifact('petty-cash-funding', {
		fixtureScope: {
			prefix: PETTY_CASH_PREFIX,
			months: [MONTH, LATER_MONTH],
			projects: PETTY_CASH_PROJECTS,
			targetCostUid: seeded?.targetCostUid,
			targetExpenseId: seeded?.targetExpenseId,
		},
		expectedAmounts: EXPECTED,
		voucher: {
			id: voucherId,
			number: voucherNumber,
			mirrorId,
		},
		createdThroughApp: spends,
		controls: controlEvidence,
		authorization: authorizationEvidence,
	});
	return artifact;
}

test.beforeAll(async () => {
	seeded = await seedPettyCashFixtures();
});

test.afterAll(async () => {
	publish();
	await cleanupPettyCashFixtures();
});

test('keeps a voucher and its mirrored credit as one funding event, never expense', async ({
	request,
}) => {
	await createVoucher(request, EXPECTED.voucherTotal);

	// Exactly one mirrored credit, carrying the funding-event identity.
	const mirrors = await rows<Record<string, unknown>>(
		`SELECT id, credit_amount, debit_amount, entry_kind, cost_uid, currency
       FROM petty_cash_expenses
      WHERE source_voucher_id = ? AND entry_kind = 'funding' AND isDelete = 0`,
		[voucherId]
	);
	expect(mirrors.length).toBe(1);
	mirrorId = String(mirrors[0].id);
	expect(Number(mirrors[0].credit_amount)).toBe(EXPECTED.voucherTotal);
	expect(Number(mirrors[0].debit_amount)).toBe(0);
	expect(mirrors[0].cost_uid).toBe(`fund-${voucherId}`);

	// The pair is registered as funding + mirror, never as a cost.
	const links = await rows<{ role: string; source_table: string }>(
		`SELECT role, source_table FROM financial_cost_links
      WHERE cost_uid = ? ORDER BY role`,
		[`fund-${voucherId}`]
	);
	expect(links.map((link) => link.role).sort()).toEqual(['funding', 'mirror']);
	expect(links.some((link) => link.role === 'cost')).toBe(false);
	const costRows = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_cost_links
      WHERE cost_uid = ? AND role = 'cost'`,
		[`fund-${voucherId}`]
	);
	expect(Number(costRows[0].count)).toBe(0);

	// Funding never creates an expense row: the only namespaced expense is the
	// seeded target.
	const expenses = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM expenses
      WHERE isDelete = 0 AND expense_number LIKE ?`,
		[`${PETTY_CASH_PREFIX}%`]
	);
	expect(Number(expenses[0].count)).toBe(1);

	// The report states funding separately from incurred cost.
	const data = await reconciliation(request, MONTH);
	expect(data.petty_cash.funding).toBe(EXPECTED.voucherTotal);
	expect(data.petty_cash.spend).toBe(0);
	expect(data.petty_cash.remaining_funding).toBe(EXPECTED.voucherTotal);
	expect(data.petty_cash.recognized_cost).toBe(0);
	expect(data.petty_cash.by_currency[0].funding_event_count).toBe(1);
	expect(data.company.incurred_cost).toBe(EXPECTED.targetCost);
	expect(data.company.incurred_cost).not.toBe(EXPECTED.voucherTotal);

	// Repeating the mirroring (a voucher edit with the same total) must not
	// create a second funding event.
	const editResponse = await request.put(`/api/admin/cash-vouchers/${voucherId}`, {
		data: {
			voucher_date: `${MONTH}-03`,
			paid_to: `${PETTY_CASH_PREFIX} Vendor`,
			project_number: PETTY_CASH_PROJECTS.alpha.code,
			payment_mode: 'cash',
			total_amount: EXPECTED.voucherTotal,
			description: `${PETTY_CASH_PREFIX} voucher A`,
			notes: `${PETTY_CASH_PREFIX} funding`,
			line_items: [],
		},
	});
	expect(editResponse.status(), await editResponse.text()).toBe(200);
	const afterEdit = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM petty_cash_expenses
      WHERE source_voucher_id = ? AND entry_kind = 'funding' AND isDelete = 0`,
		[voucherId]
	);
	expect(Number(afterEdit[0].count)).toBe(1);
	const repeated = await reconciliation(request, MONTH);
	expect(repeated.petty_cash.funding).toBe(EXPECTED.voucherTotal);
	expect(repeated.company.incurred_cost).toBe(EXPECTED.targetCost);

	controlEvidence.repeatedMirroring = {
		fundingRowsAfterSecondWrite: Number(afterEdit[0].count),
		funding: repeated.petty_cash.funding,
		companyCost: repeated.company.incurred_cost,
	};
});

test('records actual spending through the register and recognizes it once', async ({
	page,
	request,
}) => {
	await page.goto('/admin/petty-cash-expenses');
	await expect(page.getByTestId('petty-cash-financial-controls')).toHaveCount(0);
	await page.getByRole('button', { name: 'Add Expense' }).click();
	await expect(page.getByTestId('petty-cash-financial-controls')).toBeVisible();

	await page.getByLabel('Amount').fill(String(EXPECTED.spendA));
	await page.getByLabel('Notes').fill(`${PETTY_CASH_PREFIX} spend A`);
	await page.getByLabel('Bill date').fill(`${MONTH}-10`);
	await page.getByLabel('Receipt evidence').fill(`${PETTY_CASH_PREFIX}-RECEIPT-A`);
	await page.getByLabel('Source reference').fill(`${PETTY_CASH_PREFIX}-BILL-A`);

	// Reliable voucher reference: chosen from the real voucher-balance list.
	await page.getByLabel('Voucher', { exact: true }).click();
	await page.getByRole('button', { name: new RegExp(voucherNumber) }).click();

	// Reliable Project reference: the classification selects the real project
	// id; the voucher's free-text project number is never used.
	await page.getByLabel('Classification').click();
	await page.getByRole('button', { name: 'Project', exact: true }).click();
	await page.getByLabel('Project').click();
	await page
		.getByRole('button', { name: new RegExp(PETTY_CASH_PROJECTS.alpha.code) })
		.click();

	await page.locator('button[title="Save"]').click();

	const created = await waitForSpendByAmount(EXPECTED.spendA);
	const spendAId = String(created.id);
	const transactionNumber = String(created.transaction_number);
	spends.spendA = created;
	const spendA = created;

	// The entry carries its identity, evidence, period, destination, and the
	// one voucher reference — and nothing is inferred from free text.
	expect(spendA.entry_kind).toBe('spend');
	expect(spendA.recognition_state).toBe('draft');
	expect(spendA.cost_classification).toBe('project');
	expect(Number(spendA.project_id)).toBe(seeded.projects.alpha);
	expect(spendA.source_voucher_id).toBe(voucherId);
	expect(String(spendA.cost_uid)).toMatch(/^cost-/);
	expect(spendA.recognition_period).toBe(`${MONTH}-01`);
	expect(spendA.period_basis).toBe('bill_date_fallback');
	expect(Number(spendA.financial_version)).toBe(1);
	expect(await journalFor(String(spendA.cost_uid))).toEqual([
		{ version: 1, command: 'recorded' },
	]);

	// It is not confirmed cost yet.
	const beforeRecognition = await reconciliation(request, MONTH);
	expect(beforeRecognition.petty_cash.spend).toBe(EXPECTED.spendA);
	expect(beforeRecognition.petty_cash.recognized_cost).toBe(0);
	expect(beforeRecognition.company.incurred_cost).toBe(EXPECTED.targetCost);
	expect(coverageCodes(beforeRecognition)).toContain(
		'petty_cash_spending_awaiting_recognition'
	);

	// Recognize through the real register control.
	await page.getByRole('button', { name: 'Refresh' }).click();
	await expect(page.getByTestId(`petty-state-${transactionNumber}`)).toHaveText(
		'Draft'
	);
	await page
		.getByRole('button', { name: `Recognize ${transactionNumber}` })
		.click();
	await expect(page.getByTestId(`petty-state-${transactionNumber}`)).toHaveText(
		'Recognized'
	);

	const recognized = await spendRow(spendAId);
	expect(recognized.recognition_state).toBe('recognized');
	expect(Number(recognized.recognized_amount)).toBe(EXPECTED.spendA);
	expect(Number(recognized.financial_version)).toBe(2);
	expect(await journalFor(String(spendA.cost_uid))).toEqual([
		{ version: 1, command: 'recorded' },
		{ version: 2, command: 'recognized' },
	]);

	// The register states funding, spending, remaining, and recognized cost.
	const cards = await registerCards(page);
	expect(cards).toEqual({
		funding: EXPECTED.voucherTotal,
		spend: EXPECTED.spendA,
		remaining: EXPECTED.voucherTotal - EXPECTED.spendA,
		recognized: EXPECTED.spendA,
	});

	// The report: cost recognized once, into the Project's month, while the
	// rest of the funding stays outside incurred cost.
	const data = await reconciliation(request, MONTH);
	expect(data.company.incurred_cost).toBe(
		EXPECTED.targetCost + EXPECTED.spendA
	);
	expect(projectCost(data, PETTY_CASH_PROJECTS.alpha.code)).toBe(
		EXPECTED.targetCost + EXPECTED.spendA
	);
	expect(data.petty_cash.funding).toBe(EXPECTED.voucherTotal);
	expect(data.petty_cash.spend).toBe(EXPECTED.spendA);
	expect(data.petty_cash.remaining_funding).toBe(
		EXPECTED.voucherTotal - EXPECTED.spendA
	);
	expect(data.petty_cash.recognized_cost).toBe(EXPECTED.spendA);

	await openExpenditure(page, MONTH_LABEL);
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(
		EXPECTED.targetCost + EXPECTED.spendA
	);
	expect(await kpi(page, 'petty-funding-amount')).toBe(EXPECTED.voucherTotal);
	expect(await kpi(page, 'petty-recognized-amount')).toBe(EXPECTED.spendA);
});

test('keeps missing linkage unresolved and refuses recognition or access without it', async ({
	request,
	playwright,
	baseURL,
}) => {
	// A deliberate destination without a voucher reference: still cost,
	// attributed to no funding.
	const spendB = await recordSpend(request, {
		transaction_date: `${MONTH}-12`,
		debit_amount: EXPECTED.spendB,
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-12`,
		evidence_reference: `${PETTY_CASH_PREFIX}-RECEIPT-B`,
		notes: `${PETTY_CASH_PREFIX} spend B`,
	});
	expect(spendB.status, JSON.stringify(spendB.body)).toBe(200);
	const spendBId = String((spendB.body.data as Record<string, unknown>).id);
	spends.spendB = await spendRow(spendBId);

	// Missing linkage stays unresolved: no classification, no Project — and it
	// must not be inferred from anything else.
	const spendD = await recordSpend(request, {
		transaction_date: `${MONTH}-14`,
		debit_amount: EXPECTED.spendD,
		bill_date: `${MONTH}-14`,
		notes: `${PETTY_CASH_PREFIX} spend D unresolved`,
	});
	expect(spendD.status, JSON.stringify(spendD.body)).toBe(200);
	const spendDId = String((spendD.body.data as Record<string, unknown>).id);
	spends.spendD = await spendRow(spendDId);
	expect(spends.spendD.cost_classification).toBeNull();
	expect(spends.spendD.project_id).toBeNull();

	// The clerk may not recognize (no approve privilege) ...
	const clerk = await loginPettyCashUser(playwright, baseURL, 'clerk');
	try {
		const clerkB = await recordSpend(clerk, {
			transaction_date: `${MONTH}-15`,
			debit_amount: 99,
			cost_classification: 'unallocated',
			bill_date: `${MONTH}-15`,
			notes: `${PETTY_CASH_PREFIX} clerk attempt`,
		});
		expect(clerkB.status).toBe(200);
		const clerkSpendId = String(
			(clerkB.body.data as Record<string, unknown>).id
		);
		const clerkRecognize = await runCommand(clerk, clerkSpendId, {
			command: 'recognize',
			expected_version: 1,
		});
		expect(clerkRecognize.status).toBe(403);
		authorizationEvidence.clerk = {
			create: clerkB.status,
			recognize: clerkRecognize.status,
		};
		const clerkDelete = await clerk.delete(`${REGISTER}/${clerkSpendId}`);
		expect(clerkDelete.status()).toBe(200);
	} finally {
		await clerk.dispose();
	}

	// ... and a user with no petty-cash privilege reads and writes nothing.
	const outsider = await loginPettyCashUser(playwright, baseURL, 'outsider');
	try {
		const read = await outsider.get(REGISTER);
		expect(read.status()).toBe(403);
		const write = await outsider.post(REGISTER, {
			data: {
				transaction_date: `${MONTH}-16`,
				debit_amount: 99,
				notes: `${PETTY_CASH_PREFIX} outsider attempt`,
			},
		});
		expect(write.status()).toBe(403);
		const rowsAfter = await rows<{ count: number }>(
			`SELECT COUNT(*) AS count FROM petty_cash_expenses
        WHERE notes LIKE ?`,
			[`${PETTY_CASH_PREFIX} outsider attempt%`]
		);
		expect(Number(rowsAfter[0].count)).toBe(0);
		authorizationEvidence.outsider = {
			read: read.status(),
			write: write.status(),
			persistedRows: Number(rowsAfter[0].count),
		};
	} finally {
		await outsider.dispose();
	}

	// Approval is blocked by the missing classification, not guessed.
	const recognizeD = await runCommand(request, spendDId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeD.status).toBe(422);
	expect(recognizeD.body.code).toBe('not_ready_for_recognition');
	expect(recognizeD.body.missing).toContain('cost_classification');
	controlEvidence.unresolvedRecognitionRefused = {
		status: recognizeD.status,
		code: recognizeD.body.code,
		missing: recognizeD.body.missing,
	};

	// The deliberate unallocated destination is confirmed cost once.
	const recognizeB = await runCommand(request, spendBId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeB.status, JSON.stringify(recognizeB.body)).toBe(200);
	expect(Number((recognizeB.body.data as Record<string, unknown>).financial_version)).toBe(
		2
	);

	const data = await reconciliation(request, MONTH);
	expect(data.company.incurred_cost).toBe(
		EXPECTED.targetCost + EXPECTED.spendA + EXPECTED.spendB
	);
	expect(group(data, 'unallocated_cost')).toBe(EXPECTED.spendB);
	expect(data.petty_cash.spend).toBe(
		EXPECTED.spendA + EXPECTED.spendB + EXPECTED.spendD
	);
	expect(data.petty_cash.unconfirmed_spend).toBe(EXPECTED.spendD);
	expect(data.petty_cash.unlinked_spend.count).toBe(2);
	expect(data.petty_cash.unlinked_spend.amount).toBe(
		EXPECTED.spendB + EXPECTED.spendD
	);
	expect(coverageCodes(data)).toContain('unresolved_classification');
	expect(coverageCodes(data)).toContain('petty_cash_spend_without_voucher');
});

test('a receipt already linked to another cost settles it instead of duplicating it', async ({
	request,
}) => {
	const before = await reconciliation(request, MONTH);

	// 800.00 of petty cash for a cost that is already recognized: the receipt
	// references that cost identity.
	const spendC = await recordSpend(request, {
		transaction_date: `${MONTH}-18`,
		debit_amount: EXPECTED.spendC,
		source_voucher_id: voucherId,
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-18`,
		linked_cost_uid: seeded.targetCostUid,
		evidence_reference: `${PETTY_CASH_PREFIX}-RECEIPT-C`,
		notes: `${PETTY_CASH_PREFIX} spend C settlement`,
	});
	expect(spendC.status, JSON.stringify(spendC.body)).toBe(200);
	const spendCId = String((spendC.body.data as Record<string, unknown>).id);
	spends.spendC = await spendRow(spendCId);
	expect(spends.spendC.linked_cost_uid).toBe(seeded.targetCostUid);

	// It is registered as a settlement of that cost, never as another cost.
	const settlementLinks = await rows<{ role: string }>(
		`SELECT role FROM financial_cost_links
      WHERE source_table = 'petty_cash_expenses' AND source_id = ?`,
		[spendCId]
	);
	expect(settlementLinks.map((link) => link.role)).toEqual(['settlement']);
	const ownCostLinks = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM financial_cost_links
      WHERE source_table = 'petty_cash_expenses' AND source_id = ? AND role = 'cost'`,
		[spendCId]
	);
	expect(Number(ownCostLinks[0].count)).toBe(0);

	const recognizeC = await runCommand(request, spendCId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeC.status, JSON.stringify(recognizeC.body)).toBe(200);
	const recognizedC = await spendRow(spendCId);
	expect(recognizedC.recognition_state).toBe('recognized');
	// A settlement recognizes no new cost of its own.
	expect(recognizedC.recognized_amount).toBeNull();

	// No second expense, no duplicated cost.
	const expenses = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM expenses
      WHERE isDelete = 0 AND expense_number LIKE ?`,
		[`${PETTY_CASH_PREFIX}%`]
	);
	expect(Number(expenses[0].count)).toBe(1);
	const after = await reconciliation(request, MONTH);
	expect(after.company.incurred_cost).toBe(before.company.incurred_cost);
	expect(after.petty_cash.recognized_cost).toBe(before.petty_cash.recognized_cost);
	expect(after.petty_cash.by_currency[0].settled_spend).toBe(EXPECTED.spendC);
	expect(after.petty_cash.unresolved_settlements.count).toBe(0);
	expect(after.petty_cash.remaining_funding).toBe(
		EXPECTED.voucherTotal - EXPECTED.spendA - EXPECTED.spendC
	);

	// A link that does not resolve is refused and changes nothing.
	const bogus = await recordSpend(request, {
		transaction_date: `${MONTH}-19`,
		debit_amount: 111,
		linked_cost_uid: 'cost-does-not-exist',
		notes: `${PETTY_CASH_PREFIX} bogus link`,
	});
	expect(bogus.status).toBe(422);
	expect(bogus.body.code).toBe('unknown_source_reference');
	const bogusRows = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM petty_cash_expenses WHERE notes LIKE ?`,
		[`${PETTY_CASH_PREFIX} bogus link%`]
	);
	expect(Number(bogusRows[0].count)).toBe(0);
	controlEvidence.unresolvedLinkRefused = {
		status: bogus.status,
		code: bogus.body.code,
		persistedRows: Number(bogusRows[0].count),
	};
});

test('recognizes a later-month spend in its own period only', async ({
	request,
}) => {
	const spendE = await recordSpend(request, {
		transaction_date: `${LATER_MONTH}-05`,
		debit_amount: EXPECTED.spendE,
		cost_classification: 'project',
		project_id: seeded.projects.beta,
		service_period_start: `${LATER_MONTH}-01`,
		service_period_end: `${LATER_MONTH}-05`,
		bill_date: `${LATER_MONTH}-06`,
		notes: `${PETTY_CASH_PREFIX} spend E later month`,
	});
	expect(spendE.status, JSON.stringify(spendE.body)).toBe(200);
	const spendEId = String((spendE.body.data as Record<string, unknown>).id);
	spends.spendE = await spendRow(spendEId);
	expect(spends.spendE.recognition_period).toBe(`${LATER_MONTH}-01`);
	expect(spends.spendE.period_basis).toBe('service_period');

	const recognizeE = await runCommand(request, spendEId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeE.status, JSON.stringify(recognizeE.body)).toBe(200);

	// The June reconciliation is unchanged by a later-period spend.
	const june = await reconciliation(request, MONTH);
	expect(june.company.incurred_cost).toBe(
		EXPECTED.targetCost + EXPECTED.spendA + EXPECTED.spendB
	);
	expect(june.petty_cash.spend).toBe(
		EXPECTED.spendA + EXPECTED.spendB + EXPECTED.spendC + EXPECTED.spendD
	);

	const later = await reconciliation(request, LATER_MONTH);
	expect(later.company.incurred_cost).toBe(EXPECTED.spendE);
	expect(projectCost(later, PETTY_CASH_PROJECTS.beta.code)).toBe(
		EXPECTED.spendE
	);
	expect(later.petty_cash.spend).toBe(EXPECTED.spendE);
	expect(later.petty_cash.recognized_cost).toBe(EXPECTED.spendE);
	expect(later.petty_cash.funding).toBe(0);
});

test('preserves relationships and controls across edits and deletions', async ({
	request,
}) => {
	const spendAId = String(spends.spendA.id);
	const spendDId = String(spends.spendD.id);

	// A register edit cannot rewrite versioned financial fields.
	const editFinancial = await request.put(`${REGISTER}/${spendDId}`, {
		data: { debit_amount: 999 },
	});
	expect(editFinancial.status()).toBe(422);
	const editFinancialBody = await editFinancial.json();
	expect(editFinancialBody.code).toBe('financial_fields_versioned');
	expect(editFinancialBody.fields).toContain('debit_amount');

	// Operational fields stay editable.
	const editOperational = await request.put(`${REGISTER}/${spendDId}`, {
		data: { notes: `${PETTY_CASH_PREFIX} spend D unresolved (edited)` },
	});
	expect(editOperational.status()).toBe(200);

	// Deleting a draft spend removes it from cost without erasing its row.
	const deleteDraft = await request.delete(`${REGISTER}/${spendDId}`);
	expect(deleteDraft.status()).toBe(200);
	expect(Number((await spendRow(spendDId)).isDelete)).toBe(1);
	const afterDraftDelete = await reconciliation(request, MONTH);
	expect(afterDraftDelete.petty_cash.spend).toBe(
		EXPECTED.spendA + EXPECTED.spendB + EXPECTED.spendC
	);
	expect(afterDraftDelete.petty_cash.unconfirmed_spend).toBe(0);
	expect(afterDraftDelete.petty_cash.unlinked_spend.count).toBe(1);
	expect(afterDraftDelete.company.incurred_cost).toBe(
		EXPECTED.targetCost + EXPECTED.spendA + EXPECTED.spendB
	);

	// Confirmed cost is frozen against register edits and deletes.
	const editRecognized = await request.put(`${REGISTER}/${spendAId}`, {
		data: { notes: 'should not land' },
	});
	expect(editRecognized.status()).toBe(409);
	expect((await editRecognized.json()).code).toBe('cost_recognized');
	const deleteRecognized = await request.delete(`${REGISTER}/${spendAId}`);
	expect(deleteRecognized.status()).toBe(409);
	expect((await deleteRecognized.json()).code).toBe('cost_recognized');
	expect((await spendRow(spendAId)).notes).toBe(
		`${PETTY_CASH_PREFIX} spend A`
	);

	// A voucher edit updates the one funding row; it never touches spending.
	const voucherEdit = await request.put(
		`/api/admin/cash-vouchers/${voucherId}`,
		{
			data: {
				voucher_date: `${MONTH}-03`,
				paid_to: `${PETTY_CASH_PREFIX} Vendor`,
				project_number: PETTY_CASH_PROJECTS.alpha.code,
				payment_mode: 'cash',
				total_amount: EXPECTED.voucherReduced,
				description: `${PETTY_CASH_PREFIX} voucher A`,
				notes: `${PETTY_CASH_PREFIX} funding`,
				line_items: [],
			},
		}
	);
	expect(voucherEdit.status(), await voucherEdit.text()).toBe(200);
	const fundingRows = await rows<Record<string, unknown>>(
		`SELECT id, credit_amount FROM petty_cash_expenses
      WHERE source_voucher_id = ? AND entry_kind = 'funding' AND isDelete = 0`,
		[voucherId]
	);
	expect(fundingRows.length).toBe(1);
	expect(String(fundingRows[0].id)).toBe(mirrorId);
	expect(Number(fundingRows[0].credit_amount)).toBe(EXPECTED.voucherReduced);
	const spendAfterVoucherEdit = await spendRow(spendAId);
	expect(Number(spendAfterVoucherEdit.debit_amount)).toBe(EXPECTED.spendA);

	// Funding cannot fall below what is already drawn from it ...
	const tooLow = await request.put(
		`/api/admin/cash-vouchers/${voucherId}`,
		{
			data: {
				voucher_date: `${MONTH}-03`,
				paid_to: `${PETTY_CASH_PREFIX} Vendor`,
				payment_mode: 'cash',
				total_amount: 1000,
				description: `${PETTY_CASH_PREFIX} voucher A`,
				notes: `${PETTY_CASH_PREFIX} funding`,
				line_items: [],
			},
		}
	);
	expect(tooLow.status()).toBe(409);
	const tooLowBody = await tooLow.json();
	expect(tooLowBody.code).toBe('funding_below_spend');
	expect(tooLowBody.funded_spend).toBe(EXPECTED.spendA + EXPECTED.spendC);

	// ... and a voucher with spending cannot be deleted.
	const deleteVoucher = await request.delete(
		`/api/admin/cash-vouchers/${voucherId}`
	);
	expect(deleteVoucher.status()).toBe(409);
	const deleteVoucherBody = await deleteVoucher.json();
	expect(deleteVoucherBody.code).toBe('voucher_has_spending');

	const final = await reconciliation(request, MONTH);
	expect(final.petty_cash.funding).toBe(EXPECTED.voucherReduced);
	expect(final.petty_cash.remaining_funding).toBe(
		EXPECTED.voucherReduced - EXPECTED.spendA - EXPECTED.spendC
	);
	expect(final.company.incurred_cost).toBe(
		EXPECTED.targetCost + EXPECTED.spendA + EXPECTED.spendB
	);

	controlEvidence.editsAndDeletion = {
		financialFieldsRefused: {
			status: editFinancial.status(),
			code: editFinancialBody.code,
			fields: editFinancialBody.fields,
		},
		recognizedEdit: editRecognized.status(),
		recognizedDelete: deleteRecognized.status(),
		draftDelete: {
			status: deleteDraft.status(),
			softDeleted: Number((await spendRow(spendDId)).isDelete),
		},
		voucherFundingRows: fundingRows.length,
		fundingBelowSpend: {
			status: tooLow.status(),
			code: tooLowBody.code,
			fundedSpend: tooLowBody.funded_spend,
		},
		voucherDelete: {
			status: deleteVoucher.status(),
			code: deleteVoucherBody.code,
		},
		finalFunding: final.petty_cash.funding,
		finalRemaining: final.petty_cash.remaining_funding,
	};
});

test('refuses stale commands and keeps cancelled history', async ({ request }) => {
	const spendBId = String(spends.spendB.id);

	// A repeated/stale command is a no-op.
	const stale = await runCommand(request, spendBId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(stale.status).toBe(409);
	expect(stale.body.code).toBe('version_conflict');
	expect(Number(stale.body.current_version)).toBe(2);

	// A recognized spend is cancelled with a reason, and the row and journal
	// remain as the evidence of what was recognized before.
	const spendEId = String(spends.spendE.id);
	const withoutReason = await runCommand(request, spendEId, {
		command: 'cancel',
		expected_version: 2,
	});
	expect(withoutReason.status).toBe(422);
	expect(withoutReason.body.code).toBe('reason_required');

	const cancelled = await runCommand(request, spendEId, {
		command: 'cancel',
		expected_version: 2,
		reason: `${PETTY_CASH_PREFIX} cancelled by review`,
	});
	expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
	expect(
		Number((cancelled.body.data as Record<string, unknown>).financial_version)
	).toBe(3);
	const cancelledRow = await spendRow(spendEId);
	expect(cancelledRow.recognition_state).toBe('cancelled');
	expect(Number(cancelledRow.isDelete)).toBe(0);
	expect(Number(cancelledRow.recognized_amount)).toBe(EXPECTED.spendE);
	expect(await journalFor(String(cancelledRow.cost_uid))).toEqual([
		{ version: 1, command: 'recorded' },
		{ version: 2, command: 'recognized' },
		{ version: 3, command: 'cancelled' },
	]);

	const later = await reconciliation(request, LATER_MONTH);
	// The month now has no confirmed cost at all: the module states that as a
	// coverage-warned empty month (null total), not as a known zero.
	expect(later.company.incurred_cost).toBeNull();
	expect(later.petty_cash.recognized_cost).toBe(0);
	expect(later.petty_cash.spend).toBe(EXPECTED.spendE);

	controlEvidence.versioning = {
		staleStatus: stale.status,
		staleCode: stale.body.code,
		versionConflictReported: stale.body.current_version,
		cancelWithoutReason: withoutReason.body.code,
		cancelledVersion: 3,
		historyKept: Number(cancelledRow.isDelete),
	};
});

test('leaves the funding mirror deleted with its voucher when nothing was spent', async ({
	request,
}) => {
	// A second voucher that never funds spending: mirroring follows the delete.
	const response = await request.post('/api/admin/cash-vouchers', {
		data: {
			voucher_date: `${LATER_MONTH}-01`,
			paid_to: `${PETTY_CASH_PREFIX} Vendor unused`,
			payment_mode: 'cash',
			total_amount: 250,
			description: `${PETTY_CASH_PREFIX} unused voucher`,
			notes: `${PETTY_CASH_PREFIX} funding`,
			line_items: [],
			status: 'pending',
		},
	});
	expect(response.status(), await response.text()).toBe(200);
	const { id } = (await response.json()).data as { id: number };
	const mirrors = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM petty_cash_expenses
      WHERE source_voucher_id = ? AND entry_kind = 'funding' AND isDelete = 0`,
		[id]
	);
	expect(Number(mirrors[0].count)).toBe(1);

	const deleted = await request.delete(`/api/admin/cash-vouchers/${id}`);
	expect(deleted.status(), await deleted.text()).toBe(200);
	const afterDelete = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM petty_cash_expenses
      WHERE source_voucher_id = ? AND entry_kind = 'funding' AND isDelete = 0`,
		[id]
	);
	expect(Number(afterDelete[0].count)).toBe(0);
	controlEvidence.unusedVoucherDelete = { deleted: true, liveMirrors: 0 };

	// The deleted voucher no longer states funding.
	const later = await reconciliation(request, LATER_MONTH);
	expect(later.petty_cash.funding).toBe(0);
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	const artifact = readArtifact('petty-cash-funding');
	expect(artifact).toBeTruthy();
	expect(artifact!.expectedAmounts).toEqual(EXPECTED);
	expect(artifact!.voucher.id).toBe(voucherId);
	expect(artifact!.fixtureScope.prefix).toBe(PETTY_CASH_PREFIX);
	const controls = artifact!.controls as Record<string, unknown>;
	expect(controls.repeatedMirroring).toBeTruthy();
	expect(controls.editsAndDeletion).toBeTruthy();
	const authorization = artifact!.authorization as Record<string, unknown>;
	expect(authorization.clerk).toEqual({ create: 200, recognize: 403 });
	expect((authorization.outsider as Record<string, unknown>).read).toBe(403);
});
