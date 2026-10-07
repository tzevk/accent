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
 * The namespace and the months (2021-06, 2021-08) belong to this spec alone
 * (`e2e/lib/petty-cash-fixtures.ts`); 2019-01/02 belong to #306 and 2019-10/11/12
 * to #319.
 */

import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import { rows } from '../lib/db';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { parseJsonColumn } from '../lib/json-column';
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
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.60' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = PETTY_CASH_MONTH;
const LATER_MONTH = PETTY_CASH_LATER_MONTH;
const MONTH_LABEL = 'June 2021';
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
	spendF: 100,
	spendG: 50,
	fxRate: '82.00',
	fxRateUpdated: '83.50',
} as const;

type ReconciliationData = {
	month: string;
	company: {
		currency: string | null;
		reporting_currency: string;
		incurred_cost: number | null;
		groups: Array<{ key: string; amount: number }>;
		conversion: {
			status: 'reporting' | 'converted' | 'unsupported';
			converted_records: number;
			unsupported_records: number;
			unsupported_currencies: string[];
		};
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
		unconfirmed_spend: number | null;
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

type DrilldownData = {
	total: number;
	records: Array<{
		id: number;
		source: string;
		expense_number: string;
		recognition_state: string;
		recognized_amount: number | null;
		currency: string | null;
		conversion_status: string;
	}>;
	totals: {
		confirmed_amount: number | null;
		currency: string | null;
		records: number;
	};
};

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

async function drilldown(
	request: APIRequestContext,
	params: Record<string, string>
): Promise<DrilldownData> {
	const query = new URLSearchParams(params).toString();
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost/expenses?${query}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as DrilldownData;
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
	throw new Error(
		`No petty-cash spending of ${amount} appeared in the register`
	);
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
	const editResponse = await request.put(
		`/api/admin/cash-vouchers/${voucherId}`,
		{
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
		}
	);
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
	await expect(page.getByTestId('petty-cash-financial-controls')).toHaveCount(
		0
	);
	await page.getByRole('button', { name: 'Add Expense' }).click();
	await expect(page.getByTestId('petty-cash-financial-controls')).toBeVisible();

	await page
		.getByLabel('Amount', { exact: true })
		.fill(String(EXPECTED.spendA));
	await page.getByLabel('Transaction date').fill(`${MONTH}-10`);
	await page.getByLabel('Notes').fill(`${PETTY_CASH_PREFIX} spend A`);
	await page.getByLabel('Bill date').fill(`${MONTH}-10`);
	await page
		.getByLabel('Receipt evidence')
		.fill(`${PETTY_CASH_PREFIX}-RECEIPT-A`);
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

	// The drilldown carries the source rows behind those figures: the petty-cash
	// spend appears once, with its native identity, beside the direct expense.
	const drill = await drilldown(request, { month: MONTH, state: 'recognized' });
	const pettyRows = drill.records.filter(
		(record) => record.source === 'petty_cash'
	);
	expect(pettyRows.length).toBe(1);
	expect(pettyRows[0].expense_number).toBe(transactionNumber);
	expect(Number(pettyRows[0].recognized_amount)).toBe(EXPECTED.spendA);
	expect(pettyRows[0].currency).toBe('INR');
	expect(drill.totals.confirmed_amount).toBe(
		EXPECTED.targetCost + EXPECTED.spendA
	);
	expect(drill.totals.currency).toBe('INR');
});

test('keeps missing linkage unresolved and refuses recognition or access without it', async ({
	request,
	playwright,
	baseURL,
}) => {
	// The login fixtures need the configured base URL; the Playwright option
	// is typed optional, so fail before any work when it is unset.
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}

	// A deliberate destination without a voucher reference: still cost,
	// attributed to no funding.
	const spendB = await recordSpend(request, {
		transaction_date: `${MONTH}-12`,
		debit_amount: EXPECTED.spendB,
		currency: 'INR',
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
		currency: 'INR',
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
			currency: 'INR',
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
	expect(
		Number((recognizeB.body.data as Record<string, unknown>).financial_version)
	).toBe(2);

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
		currency: 'INR',
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
	expect(after.petty_cash.recognized_cost).toBe(
		before.petty_cash.recognized_cost
	);
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
		currency: 'INR',
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
	expect((await spendRow(spendAId)).notes).toBe(`${PETTY_CASH_PREFIX} spend A`);

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
	const tooLow = await request.put(`/api/admin/cash-vouchers/${voucherId}`, {
		data: {
			voucher_date: `${MONTH}-03`,
			paid_to: `${PETTY_CASH_PREFIX} Vendor`,
			payment_mode: 'cash',
			total_amount: 1000,
			description: `${PETTY_CASH_PREFIX} voucher A`,
			notes: `${PETTY_CASH_PREFIX} funding`,
			line_items: [],
		},
	});
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

test('refuses stale commands and keeps cancelled history', async ({
	request,
}) => {
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

test('captures and versions foreign-currency conversion evidence on petty cash', async ({
	request,
	playwright,
	baseURL,
}) => {
	// The login fixtures need the configured base URL; the Playwright option
	// is typed optional, so fail before any work when it is unset.
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}

	// A partial triple is refused: evidence moves as a whole or not at all.
	const partial = await recordSpend(request, {
		transaction_date: `${LATER_MONTH}-08`,
		debit_amount: EXPECTED.spendF,
		currency: 'USD',
		conversion_rate: EXPECTED.fxRate,
		notes: `${PETTY_CASH_PREFIX} spend F partial evidence`,
	});
	expect(partial.status).toBe(422);
	expect(partial.body.code).toBe('conversion_evidence_incomplete');
	const invalidRate = await recordSpend(request, {
		transaction_date: `${LATER_MONTH}-08`,
		debit_amount: EXPECTED.spendF,
		currency: 'USD',
		conversion_rate: '0',
		conversion_date: `${LATER_MONTH}-08`,
		conversion_evidence_reference: `${PETTY_CASH_PREFIX}-FX-0`,
		notes: `${PETTY_CASH_PREFIX} spend F invalid rate`,
	});
	expect(invalidRate.status).toBe(422);
	expect(invalidRate.body.code).toBe('invalid_conversion_rate');
	const refusedRows = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM petty_cash_expenses WHERE notes LIKE ?`,
		[`${PETTY_CASH_PREFIX} spend F%`]
	);
	expect(Number(refusedRows[0].count)).toBe(0);

	// The full triple is captured with the spending, and the reporting-currency
	// figure is computed from the recognized amount, not at capture.
	const spendF = await recordSpend(request, {
		transaction_date: `${LATER_MONTH}-08`,
		debit_amount: EXPECTED.spendF,
		currency: 'USD',
		cost_classification: 'project',
		project_id: seeded.projects.beta,
		service_period_start: `${LATER_MONTH}-08`,
		service_period_end: `${LATER_MONTH}-08`,
		conversion_rate: EXPECTED.fxRate,
		conversion_date: `${LATER_MONTH}-08`,
		conversion_evidence_reference: `${PETTY_CASH_PREFIX}-FX-1`,
		notes: `${PETTY_CASH_PREFIX} spend F foreign currency`,
	});
	expect(spendF.status, JSON.stringify(spendF.body)).toBe(200);
	const spendFId = String((spendF.body.data as Record<string, unknown>).id);
	spends.spendF = await spendRow(spendFId);
	expect(spends.spendF.currency).toBe('USD');
	expect(spends.spendF.conversion_rate).toBe(EXPECTED.fxRate);
	expect(spends.spendF.conversion_date).toBe(`${LATER_MONTH}-08`);
	expect(spends.spendF.conversion_evidence_reference).toBe(
		`${PETTY_CASH_PREFIX}-FX-1`
	);
	expect(spends.spendF.converted_amount).toBeNull();
	expect(Number(spends.spendF.conversion_rate)).toBe(Number(EXPECTED.fxRate));

	// The register edit path refuses the conversion fields; they change only
	// through the versioned update command.
	const registerRefusal = await request.put(`${REGISTER}/${spendFId}`, {
		data: { conversion_rate: '1.00' },
	});
	expect(registerRefusal.status()).toBe(422);
	expect((await registerRefusal.json()).code).toBe(
		'financial_fields_versioned'
	);

	const recognizeF = await runCommand(request, spendFId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeF.status, JSON.stringify(recognizeF.body)).toBe(200);
	const recognizedF = await spendRow(spendFId);
	// 100.00 USD × 82.00 = 8,200.00 INR, computed by the shared conversion.
	expect(Number(recognizedF.converted_amount)).toBe(
		EXPECTED.spendF * Number(EXPECTED.fxRate)
	);
	const journalF = await journalFor(String(recognizedF.cost_uid));
	expect(journalF).toEqual([
		{ version: 1, command: 'recorded' },
		{ version: 2, command: 'recognized' },
	]);
	const [recognizedEvent] = await rows<{ snapshot: string }>(
		`SELECT snapshot FROM financial_cost_events
      WHERE cost_uid = ? AND version = 2`,
		[String(recognizedF.cost_uid)]
	);
	const snapshot = parseJsonColumn(recognizedEvent.snapshot) as Record<
		string,
		unknown
	>;
	expect(snapshot.conversion_rate).toBe(EXPECTED.fxRate);
	expect(Number(snapshot.converted_amount)).toBe(8200);

	// Changing the evidence afterwards is a versioned update with a new
	// converted figure.
	const repriced = await runCommand(request, spendFId, {
		command: 'update',
		expected_version: 2,
		patch: { conversionRate: EXPECTED.fxRateUpdated },
	});
	expect(repriced.status, JSON.stringify(repriced.body)).toBe(200);
	const repricedRow = await spendRow(spendFId);
	expect(Number(repricedRow.converted_amount)).toBe(
		EXPECTED.spendF * Number(EXPECTED.fxRateUpdated)
	);

	// A rate is evidence for one currency pair: changing the original currency
	// without the fresh triple is refused, and a currency-only patch is
	// approval territory (403 for a clerk without `:approve`).
	const pairChange = await runCommand(request, spendFId, {
		command: 'update',
		expected_version: 3,
		patch: { currency: 'EUR' },
	});
	expect(pairChange.status).toBe(422);
	expect(pairChange.body.code).toBe('conversion_evidence_required');
	const clerk = await loginPettyCashUser(playwright, baseURL, 'clerk');
	try {
		const clerkPatch = await runCommand(clerk, spendFId, {
			command: 'update',
			expected_version: 3,
			patch: { currency: 'EUR' },
		});
		expect(clerkPatch.status).toBe(403);
		authorizationEvidence.clerkCurrencyPatch = clerkPatch.status;
	} finally {
		await clerk.dispose();
	}
	const stillUsd = await spendRow(spendFId);
	expect(stillUsd.currency).toBe('USD');
	expect(Number(stillUsd.converted_amount)).toBe(
		EXPECTED.spendF * Number(EXPECTED.fxRateUpdated)
	);

	// A second foreign spend without evidence stays explicit: recognized cost
	// in its own currency, no reporting-currency figure, and no false total.
	const spendG = await recordSpend(request, {
		transaction_date: `${LATER_MONTH}-09`,
		debit_amount: EXPECTED.spendG,
		currency: 'USD',
		cost_classification: 'project',
		project_id: seeded.projects.beta,
		bill_date: `${LATER_MONTH}-09`,
		notes: `${PETTY_CASH_PREFIX} spend G unconverted`,
	});
	expect(spendG.status, JSON.stringify(spendG.body)).toBe(200);
	const spendGId = String((spendG.body.data as Record<string, unknown>).id);
	const recognizeG = await runCommand(request, spendGId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeG.status, JSON.stringify(recognizeG.body)).toBe(200);
	const recognizedG = await spendRow(spendGId);
	expect(recognizedG.converted_amount).toBeNull();

	const later = await reconciliation(request, LATER_MONTH);
	expect(later.company.reporting_currency).toBe('INR');
	expect(later.company.conversion.converted_records).toBe(1);
	expect(later.company.conversion.unsupported_records).toBe(1);
	expect(later.company.conversion.unsupported_currencies).toEqual(['USD']);
	// An unsupported slice keeps its own single currency instead of inventing
	// a converted total: 100 + 50 USD, both original amounts.
	expect(later.company.currency).toBe('USD');
	expect(later.company.incurred_cost).toBe(EXPECTED.spendF + EXPECTED.spendG);
	expect(coverageCodes(later)).toContain('currency_conversion_missing');

	controlEvidence.conversion = {
		partialEvidence: partial.body.code,
		invalidRate: invalidRate.body.code,
		convertedAmount: Number(recognizedF.converted_amount),
		repricedConvertedAmount: Number(repricedRow.converted_amount),
		unconvertedAmount: recognizedG.converted_amount,
		unsupportedRecords: later.company.conversion.unsupported_records,
	};
});

test('reconciles cost and settlement identities and preserves recognized history', async ({
	request,
}) => {
	const linksFor = async (id: string) => {
		const found = await rows<{ role: string }>(
			`SELECT role FROM financial_cost_links
        WHERE source_table = 'petty_cash_expenses' AND source_id = ?
        ORDER BY role`,
			[id]
		);
		return found.map((link) => link.role);
	};

	// A confirmed petty-cash spend registers as a cost identity that the shared
	// registry resolves: another petty-cash receipt can settle it.
	const spendP = await recordSpend(request, {
		transaction_date: `${MONTH}-20`,
		debit_amount: 200,
		currency: 'INR',
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-20`,
		notes: `${PETTY_CASH_PREFIX} spend P cost identity`,
	});
	expect(spendP.status, JSON.stringify(spendP.body)).toBe(200);
	const spendPId = String((spendP.body.data as Record<string, unknown>).id);
	const spendPRow = await spendRow(spendPId);
	expect(await linksFor(spendPId)).toEqual(['cost']);
	const recognizeP = await runCommand(request, spendPId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeP.status, JSON.stringify(recognizeP.body)).toBe(200);

	const spendQ = await recordSpend(request, {
		transaction_date: `${MONTH}-21`,
		debit_amount: 100,
		currency: 'INR',
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-21`,
		linked_cost_uid: String(spendPRow.cost_uid),
		notes: `${PETTY_CASH_PREFIX} spend Q settles P`,
	});
	expect(spendQ.status, JSON.stringify(spendQ.body)).toBe(200);
	const spendQId = String((spendQ.body.data as Record<string, unknown>).id);
	expect(await linksFor(spendQId)).toEqual(['settlement']);
	const recognizeQ = await runCommand(request, spendQId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeQ.status, JSON.stringify(recognizeQ.body)).toBe(200);
	expect((await spendRow(spendQId)).recognized_amount).toBeNull();

	// A versioned link transition moves the registry row with the meaning: to a
	// settlement it drops the cost registration, and back to cost it restores
	// it, so nothing resolves a cost the report excludes and nothing refuses a
	// valid link to a counted cost.
	const spendR = await recordSpend(request, {
		transaction_date: `${MONTH}-22`,
		debit_amount: 50,
		currency: 'INR',
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-22`,
		notes: `${PETTY_CASH_PREFIX} spend R transition`,
	});
	expect(spendR.status, JSON.stringify(spendR.body)).toBe(200);
	const spendRId = String((spendR.body.data as Record<string, unknown>).id);
	const spendRRow = await spendRow(spendRId);
	expect(await linksFor(spendRId)).toEqual(['cost']);

	const toSettlement = await runCommand(request, spendRId, {
		command: 'update',
		expected_version: 1,
		patch: { linkedCostUid: seeded.targetCostUid },
	});
	expect(toSettlement.status, JSON.stringify(toSettlement.body)).toBe(200);
	expect(await linksFor(spendRId)).toEqual(['settlement']);

	const backToCost = await runCommand(request, spendRId, {
		command: 'update',
		expected_version: 2,
		patch: { linkedCostUid: null },
	});
	expect(backToCost.status, JSON.stringify(backToCost.body)).toBe(200);
	expect(await linksFor(spendRId)).toEqual(['cost']);

	// The restored identity resolves: a new receipt may settle R.
	const spendT = await recordSpend(request, {
		transaction_date: `${MONTH}-23`,
		debit_amount: 10,
		currency: 'INR',
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-23`,
		linked_cost_uid: String(spendRRow.cost_uid),
		notes: `${PETTY_CASH_PREFIX} spend T settles R`,
	});
	expect(spendT.status, JSON.stringify(spendT.body)).toBe(200);
	const spendTId = String((spendT.body.data as Record<string, unknown>).id);
	expect(await linksFor(spendTId)).toEqual(['settlement']);

	// A recognized-then-cancelled spend keeps its history: an ordinary register
	// delete is refused, the row stays, and the journal keeps all three
	// transitions (the #322 close/revision path reads this).
	const spendS = await recordSpend(request, {
		transaction_date: `${MONTH}-24`,
		debit_amount: 300,
		currency: 'INR',
		cost_classification: 'unallocated',
		bill_date: `${MONTH}-24`,
		notes: `${PETTY_CASH_PREFIX} spend S reversed history`,
	});
	expect(spendS.status, JSON.stringify(spendS.body)).toBe(200);
	const spendSId = String((spendS.body.data as Record<string, unknown>).id);
	const recognizeS = await runCommand(request, spendSId, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognizeS.status, JSON.stringify(recognizeS.body)).toBe(200);
	const cancelS = await runCommand(request, spendSId, {
		command: 'cancel',
		expected_version: 2,
		reason: `${PETTY_CASH_PREFIX} reversed after review`,
	});
	expect(cancelS.status, JSON.stringify(cancelS.body)).toBe(200);

	const deleteS = await request.delete(`${REGISTER}/${spendSId}`);
	expect(deleteS.status()).toBe(409);
	expect((await deleteS.json()).code).toBe('cost_history_preserved');
	const spendSRow = await spendRow(spendSId);
	expect(Number(spendSRow.isDelete)).toBe(0);
	expect(spendSRow.recognition_state).toBe('cancelled');
	expect(await journalFor(String(spendSRow.cost_uid))).toEqual([
		{ version: 1, command: 'recorded' },
		{ version: 2, command: 'recognized' },
		{ version: 3, command: 'cancelled' },
	]);

	// The final June reconciliation counts the two new cost identities once and
	// nothing from the settlements or the reversed spend.
	const june = await reconciliation(request, MONTH);
	expect(june.company.incurred_cost).toBe(
		EXPECTED.targetCost + EXPECTED.spendA + EXPECTED.spendB + 200
	);
	expect(group(june, 'unallocated_cost')).toBe(EXPECTED.spendB + 200);
	expect(june.petty_cash.recognized_cost).toBe(
		EXPECTED.spendA + EXPECTED.spendB + 200
	);
	expect(june.petty_cash.by_currency[0].settled_spend).toBe(
		EXPECTED.spendC + 100 + 10
	);
	const drill = await drilldown(request, { month: MONTH, state: 'recognized' });
	expect(drill.totals.confirmed_amount).toBe(
		EXPECTED.targetCost + EXPECTED.spendA + EXPECTED.spendB + 200
	);

	controlEvidence.identityTransitions = {
		costLinks: await linksFor(spendPId),
		settlementLinks: await linksFor(spendQId),
		reconciledLinks: await linksFor(spendRId),
		restoredSettlementLinks: await linksFor(spendTId),
		historyDelete: {
			status: deleteS.status(),
			code: 'cost_history_preserved',
			live: Number(spendSRow.isDelete),
			journal: 3,
		},
	};
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	const artifact = readArtifact('petty-cash-funding');
	expect(artifact).toBeTruthy();
	expect(artifact!.expectedAmounts).toEqual(EXPECTED);
	const voucher = artifact!.voucher as { id: number };
	expect(voucher.id).toBe(voucherId);
	const fixtureScope = artifact!.fixtureScope as { prefix: string };
	expect(fixtureScope.prefix).toBe(PETTY_CASH_PREFIX);
	const controls = artifact!.controls as Record<string, unknown>;
	expect(controls.repeatedMirroring).toBeTruthy();
	expect(controls.editsAndDeletion).toBeTruthy();
	const authorization = artifact!.authorization as Record<string, unknown>;
	expect(authorization.clerk).toEqual({ create: 200, recognize: 403 });
	expect((authorization.outsider as Record<string, unknown>).read).toBe(403);
});
