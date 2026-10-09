import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { rows } from '../lib/db';
import { apiDelete, apiGet, apiPost } from '../lib/rate-limit-pacing';
import { loginExpenditureReportOnlyReader } from '../lib/expenditure-fixtures';
import {
	OTHER_EXPENSE_MONTH,
	OTHER_EXPENSE_PREFIX,
	OTHER_EXPENSE_PROJECT_CODE,
	OTHER_EXPENSE_TARGET,
	OTHER_EXPENSE_VENDOR_PREFIX,
	cleanupOtherExpenseFixtures,
	ensureExpenditureReportOnlyReader,
	loginOtherExpenseReader,
	seedOtherExpenseFixtures,
	type SeededOtherExpenses,
} from '../lib/other-expense-fixtures';

/**
 * Ticket #315 — other-expense capture, receipt copies, and duplicate review.
 *
 * Every expectation is stated from the fixture literals and the business rules
 * (gross minus evidenced recoverable tax; only `recognized` is confirmed cost;
 * a linked copy is never a second cost), never from the module's own
 * aggregation. The month (2019-04) belongs to this ticket alone, so its
 * company figures are asserted exactly, while rows recorded through the app
 * are also read back from MySQL independently.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.22' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = OTHER_EXPENSE_MONTH;
const MONTH_LABEL = 'April 2019';
const VENDOR = `${OTHER_EXPENSE_VENDOR_PREFIX}register`;

/** The browser-entered Project cost (ticket case 1). */
const UI_PROJECT = 1200;
/** The API-recorded Company Overhead cost with evidenced recoverable tax. */
const API_OVERHEAD = { gross: 1180, tax: 180, recognized: 1000 } as const;
/** The API-recorded entry completed through the review queue. */
const REVIEW_UNALLOCATED = 640;
/** The second text-similar entry a reviewer keeps as its own cost. */
const DUP_STANDALONE = OTHER_EXPENSE_TARGET.gross;

/**
 * The figures this spec states for the month, carried forward as each case
 * records its own row. The seed is one recognized direct expense of 2500
 * (the receipt-copy target).
 */
const expected = {
	project: OTHER_EXPENSE_TARGET.gross,
	overhead: 0,
	unallocated: 0,
	grossLiability: OTHER_EXPENSE_TARGET.gross,
	recoverableTax: 0,
	confirmedRecords: 1,
} as const;

/**
 * The month's confirmed figures once every case has recorded its row: the
 * seed, the browser entry, the second text-similar entry, and the classified
 * entry — the cancelled overhead and foreign-currency rows contribute nothing.
 */
const CONFIRMED = {
	project: OTHER_EXPENSE_TARGET.gross + UI_PROJECT + DUP_STANDALONE,
	overhead: 0,
	unallocated: REVIEW_UNALLOCATED,
	total:
		OTHER_EXPENSE_TARGET.gross +
		UI_PROJECT +
		DUP_STANDALONE +
		REVIEW_UNALLOCATED,
} as const;

/** The rows this spec records through the app, so cleanup is complete. */
const created: Array<{
	where: string;
	id?: string;
	voucher?: string;
	number?: number;
}> = [];

let seeded: SeededOtherExpenses;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('other-expense-controls', {
		...evidence,
		fixtureScope: {
			month: MONTH,
			projectCode: OTHER_EXPENSE_PROJECT_CODE,
			otherExpensePrefix: OTHER_EXPENSE_PREFIX,
			targetCostUid: OTHER_EXPENSE_TARGET.costUid,
		},
		createdThroughApp: created,
	});
}

interface ReconciliationData {
	month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{
			currency: string;
			incurred_project_cost: number;
			company_overhead: number;
			unallocated_cost: number;
			incurred_cost: number;
			gross_liability: number;
			recoverable_tax: number;
			unresolved_tax_gross: number;
			record_count: number;
			reporting: {
				currency: string;
				status: string;
				unsupported_count: number;
				incurred_cost: number | null;
				company_overhead: number | null;
			};
		}>;
		groups: Array<{
			key: string;
			label: string;
			amount: number;
			record_count: number;
		}>;
		gross_liability: number | null;
		recoverable_tax: number | null;
		unresolved_tax: {
			count: number;
			currency: string | null;
			gross_amount: number | null;
		};
		record_count: number;
	};
	projects: Array<{
		project_code: string;
		currency: string;
		incurred_cost: number;
		record_count: number;
	}>;
	evidence: Record<
		'recognized' | 'pending_evidence' | 'draft' | 'rejected' | 'cancelled',
		{ count: number; currency: string | null; amount: number | null }
	> & {
		unresolved_classification: {
			count: number;
			currency: string | null;
			gross_amount: number | null;
		};
		missing_amount: { count: number };
		known_zero: { count: number };
	};
	coverage: Array<{ code: string; severity: string }>;
}

interface DrilldownRecord {
	id: number;
	cost_uid: string | null;
	source: string;
	expense_number: string;
	recognition_state: string;
	cost_classification: string | null;
	currency: string;
	gross_amount: number | null;
	recognized_amount: number | null;
	converted_amount: number | null;
	conversion_status: string;
	source_reference: string | null;
	evidence_reference: string | null;
	financial_version: number;
	exceptions: string[];
}

interface DrilldownData {
	month: string;
	total: number;
	records: DrilldownRecord[];
	totals: {
		confirmed_amount: number | null;
		currency: string | null;
		records: number;
	};
}

interface CapturedOtherExpense {
	id: string;
	voucher_number: string;
	cost_uid: string | null;
	linked_cost_uid: string | null;
	recognition_state: string;
	financial_version: number;
	recognition_period: string | null;
	period_basis: string;
	recognized_amount: number | null;
	cost_classification: string | null;
	duplicate_candidates: Array<{
		cost_uid: string;
		label: string | null;
		source_table: string;
		recognition_state: string;
	}>;
}

interface ReviewQueue {
	pending_copies: Array<{
		link_id: number;
		copy_id: string;
		voucher_number: string;
		gross_amount: number | null;
		currency: string | null;
		target: {
			cost_uid: string;
			label: string | null;
			source_table: string;
			recognition_state: string | null;
		};
	}>;
	linked_copies: Array<{
		copy_id: string;
		voucher_number: string;
		target_cost_uid: string;
		basis: string;
	}>;
	unresolved: Array<{
		id: string;
		voucher_number: string;
		recognition_state: string;
		financial_version: number;
		gross_amount: number | null;
		cost_classification: string | null;
		missing: string[];
	}>;
}

async function reconciliation(
	request: APIRequestContext,
	month = MONTH
): Promise<ReconciliationData> {
	const response = await apiGet(
		request,
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
	const response = await apiGet(
		request,
		`/api/reports/employee-project-monthly-cost/expenses?${query}`
	);
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()).data as DrilldownData;
}

function group(data: ReconciliationData, key: string): number {
	const found = data.company.groups.find((entry) => entry.key === key);
	expect(found, `group ${key}`).toBeTruthy();
	return found!.amount;
}

function inr(data: ReconciliationData) {
	return data.company.currency_totals.find((row) => row.currency === 'INR');
}

/** Record a standalone cost and return the captured row. */
async function captureStandalone(
	request: APIRequestContext,
	data: Record<string, unknown>
): Promise<CapturedOtherExpense> {
	const response = await apiPost(request, '/api/admin/other-expenses', data);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as CapturedOtherExpense;
}

async function command(
	request: APIRequestContext,
	id: string,
	body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await apiPost(
		request,
		`/api/admin/other-expenses/${id}/commands`,
		body
	);
	return { status: response.status(), body: await response.json() };
}

async function reviewQueue(request: APIRequestContext): Promise<ReviewQueue> {
	const response = await apiGet(request, '/api/admin/other-expenses/review');
	expect(response.status(), await response.text()).toBe(200);
	return (await response.json()).data as ReviewQueue;
}

interface ApiErrorBody {
	code?: string;
	missing?: string[];
}

/** Narrow a failed response's body without trusting its shape. */
function errorBody(value: unknown): ApiErrorBody {
	if (!value || typeof value !== 'object') return {};
	const code = 'code' in value ? value.code : undefined;
	const missing = 'missing' in value ? value.missing : undefined;
	return {
		code: typeof code === 'string' ? code : undefined,
		missing: Array.isArray(missing)
			? missing.filter((entry): entry is string => typeof entry === 'string')
			: undefined,
	};
}

async function storedOtherExpense(id: string) {
	const found = await rows<Record<string, unknown>>(
		`SELECT * FROM other_expenses WHERE id = ?`,
		[id]
	);
	expect(found).toHaveLength(1);
	return found[0];
}

async function journalOf(costUid: string) {
	return rows<{
		version: number;
		command: string;
		reason: string | null;
		source_id: number;
	}>(
		`SELECT version, command, reason, source_id FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[costUid]
	);
}

/** Fill one create-form field in the register modal. */
async function fillField(page: Page, id: string, value: string): Promise<void> {
	await page.locator(`#${id}`).fill(value);
}

async function openRegister(page: Page): Promise<void> {
	await page.goto('/admin/other-expenses');
	await expect(
		page.getByRole('heading', { name: 'Other Expenses' })
	).toBeVisible();
}

/** Open one register entry's review dialog through the row action. */
async function openEntryReview(page: Page, voucher: string): Promise<void> {
	await page.getByTestId('tab-register').click();
	const row = page.locator(`[data-testid="oe-row"][data-voucher="${voucher}"]`);
	await expect(row).toBeVisible();
	await row.getByTestId('oe-row-review').click();
	const dialog = page.getByTestId('oe-review-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog).toHaveAttribute('data-voucher', voucher);
}

async function openReport(page: Page, monthLabel: string): Promise<void> {
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

test.beforeAll(async () => {
	seeded = await seedOtherExpenseFixtures();
	evidence.seeded = { ...seeded, target: OTHER_EXPENSE_TARGET };
});

test.afterAll(async () => {
	publish();
	await cleanupOtherExpenseFixtures();
});

test('records and recognizes a project-classified other expense through the entry screen', async ({
	page,
	request,
}) => {
	const voucher = `${OTHER_EXPENSE_PREFIX}UI-1`;
	const gross = 1200;

	await openRegister(page);
	await page.getByRole('button', { name: 'Add Other Expenses' }).click();
	await expect(page.getByText('New Other Expenses')).toBeVisible();

	await fillField(page, 'voucher_number', voucher);
	await fillField(page, 'voucher_date', `${MONTH}-05`);
	await page.locator('#expense_category').selectOption('Office Supplies');
	await page.locator('#payee_type').selectOption('vendor');
	await fillField(page, 'vendor_name', VENDOR);
	await fillField(page, 'bill_no', `${OTHER_EXPENSE_PREFIX}BILL-UI-1`);
	await fillField(page, 'bill_date', `${MONTH}-05`);
	await fillField(page, 'bill_amount', String(gross));
	await fillField(page, 'gst_amount', '0');
	await fillField(
		page,
		'description',
		`${OTHER_EXPENSE_PREFIX}UI project cost`
	);
	await page.locator('#cost_classification').selectOption('project');
	await page.locator('#project_id').selectOption(String(seeded.projectId));
	await fillField(page, 'service_period_start', `${MONTH}-02`);
	await fillField(page, 'service_period_end', `${MONTH}-02`);
	await fillField(page, 'currency', 'INR');
	await page.locator('#tax_treatment').selectOption('none');
	await fillField(page, 'tax_evidence_reference', '');
	await fillField(page, 'source_reference', `${OTHER_EXPENSE_PREFIX}SRC-UI-1`);
	await fillField(page, 'evidence_reference', `${OTHER_EXPENSE_PREFIX}EV-UI-1`);
	await fillField(
		page,
		'receipt_url',
		`https://e2e.test/${voucher}/receipt.pdf`
	);
	await page.locator('#submit').selectOption('submitted');
	await page.getByRole('button', { name: 'Create Other Expenses' }).click();
	await expect(page.getByText('New Other Expenses')).toBeHidden();

	// The row lands in the register as an open entry: period and amount are
	// stored, and the company total still excludes it.
	const row = page.locator(`[data-testid="oe-row"][data-voucher="${voucher}"]`);
	await expect(row).toBeVisible();
	await expect(
		page.locator(`[data-testid="oe-state"][data-voucher="${voucher}"]`)
	).toHaveText('Pending evidence');

	const persisted = await rows<Record<string, unknown>>(
		`SELECT * FROM other_expenses WHERE voucher_number = ?`,
		[voucher]
	);
	expect(persisted).toHaveLength(1);
	const stored = persisted[0];
	const id = String(stored.id);
	created.push({ where: 'ui', id, voucher });
	expect(stored.cost_classification).toBe('project');
	expect(Number(stored.project_id)).toBe(seeded.projectId);
	expect(stored.recognition_state).toBe('pending_evidence');
	expect(String(stored.recognition_period).slice(0, 10)).toBe(`${MONTH}-01`);
	expect(stored.period_basis).toBe('service_period');
	expect(Number(stored.net_amount)).toBe(gross);
	expect(stored.currency).toBe('INR');
	expect(String(stored.cost_uid)).toMatch(/^cost-/);
	expect(Number(stored.financial_version)).toBe(1);
	expect(Number(stored.recognized_amount ?? 0)).toBe(0);

	// Its canonical identity is registered, and the journal has one row.
	const link = await rows<Record<string, unknown>>(
		`SELECT role, basis, review_state FROM financial_cost_links
      WHERE source_table = 'other_expenses' AND source_id = ?`,
		[id]
	);
	expect(link).toHaveLength(1);
	expect(link[0].role).toBe('cost');
	expect(link[0].basis).toBe('system');
	const firstJournal = await journalOf(String(stored.cost_uid));
	expect(firstJournal).toHaveLength(1);
	// The journal's INT source key is the register's numeric row_no, never a
	// coerced UUID; the link table keeps the UUID as the register's own key.
	expect(Number(stored.row_no)).toBeGreaterThan(0);
	expect(firstJournal[0].source_id).toBe(Number(stored.row_no));

	const before = await reconciliation(request);
	expect(group(before, 'incurred_project_cost')).toBe(
		OTHER_EXPENSE_TARGET.gross
	);
	expect(before.evidence.pending_evidence.count).toBe(1);

	// Recognize it through the row's own review dialog.
	await openEntryReview(page, voucher);
	await page.locator('#oe-reason').fill('E2E evidence reviewed');
	await page.getByTestId('oe-recognize').click();
	await expect(page.getByTestId('oe-review-dialog')).toBeHidden();

	const after = await reconciliation(request);
	expect(group(after, 'incurred_project_cost')).toBe(expected.project + gross);
	expect(group(after, 'company_overhead')).toBe(0);
	expect(group(after, 'unallocated_cost')).toBe(0);
	expect(after.company.incurred_cost).toBe(expected.project + gross);
	expect(after.company.record_count).toBe(expected.confirmedRecords + 1);

	const recognized = await storedOtherExpense(id);
	expect(recognized.recognition_state).toBe('recognized');
	expect(Number(recognized.financial_version)).toBe(2);
	expect(Number(recognized.recognized_amount)).toBe(gross);
	expect(Number(recognized.recognized_by)).toBeGreaterThan(0);
	const journal = await journalOf(String(stored.cost_uid));
	expect(journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'recognized',
	]);

	// The project breakdown and the source drilldown carry the same row.
	const projectRow = after.projects.find(
		(entry) => entry.project_code === OTHER_EXPENSE_PROJECT_CODE
	);
	expect(projectRow?.incurred_cost).toBe(expected.project + gross);
	const source = await drilldown(request, { month: MONTH, state: 'all' });
	const uiRecord = source.records.find(
		(entry) => entry.expense_number === voucher
	);
	expect(uiRecord, 'drilldown carries the other-expense row').toBeTruthy();
	expect(uiRecord!.source).toBe('other_expense');
	expect(uiRecord!.recognized_amount).toBe(gross);

	evidence.entryScreen = {
		voucher,
		expected: { gross, recognized: gross },
		observed: {
			state: recognized.recognition_state,
			version: Number(recognized.financial_version),
			group: group(after, 'incurred_project_cost'),
		},
		journal: journal.map((entry) => entry.command),
	};
});

test('counts company overhead at gross minus evidenced recoverable tax', async ({
	request,
}) => {
	const voucher = `${OTHER_EXPENSE_PREFIX}API-OH`;
	const captured = await captureStandalone(request, {
		voucher_number: voucher,
		voucher_date: `${MONTH}-08`,
		expense_category: 'Bank Charges',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}overhead`,
		bill_no: `${OTHER_EXPENSE_PREFIX}BILL-API-OH`,
		bill_date: `${MONTH}-08`,
		bill_amount: 1000,
		gst_amount: 180,
		description: `${OTHER_EXPENSE_PREFIX}API overhead with recoverable tax`,
		cost_classification: 'company_overhead',
		service_period_start: `${MONTH}-07`,
		service_period_end: `${MONTH}-07`,
		currency: 'INR',
		tax_treatment: 'recoverable',
		tax_evidence_reference: `${OTHER_EXPENSE_PREFIX}GST-API-OH`,
		source_reference: `${OTHER_EXPENSE_PREFIX}SRC-API-OH`,
		evidence_reference: `${OTHER_EXPENSE_PREFIX}EV-API-OH`,
		submit: true,
	});
	created.push({ where: 'api-overhead', id: captured.id, voucher });
	expect(captured.recognition_state).toBe('pending_evidence');
	expect(captured.cost_classification).toBe('company_overhead');
	expect(captured.duplicate_candidates).toEqual([]);

	// A stale expected version changes nothing.
	const stale = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 99,
		reason: 'E2E stale version',
	});
	expect(stale.status).toBe(409);
	expect(stale.body.code).toBe('version_conflict');

	const recognized = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 1,
		reason: 'E2E overhead evidence reviewed',
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);

	const data = await reconciliation(request);
	expect(group(data, 'company_overhead')).toBe(API_OVERHEAD.recognized);
	expect(group(data, 'incurred_project_cost')).toBe(
		expected.project + UI_PROJECT
	);
	expect(group(data, 'unallocated_cost')).toBe(0);
	expect(data.company.incurred_cost).toBe(
		expected.project + UI_PROJECT + API_OVERHEAD.recognized
	);
	expect(inr(data)!.recoverable_tax).toBe(API_OVERHEAD.tax);
	expect(inr(data)!.gross_liability).toBe(
		expected.grossLiability + UI_PROJECT + API_OVERHEAD.gross
	);
	expect(data.company.unresolved_tax.count).toBe(0);

	const stored = await storedOtherExpense(captured.id);
	expect(stored.recognition_state).toBe('recognized');
	expect(Number(stored.recognized_amount)).toBe(API_OVERHEAD.recognized);
	expect(Number(stored.gross_amount ?? stored.net_amount)).toBe(
		API_OVERHEAD.gross
	);
	expect(stored.tax_evidence_reference).toBe(
		`${OTHER_EXPENSE_PREFIX}GST-API-OH`
	);
	expect(Number(stored.financial_version)).toBe(2);

	evidence.overhead = {
		voucher,
		expected: { gross: 1180, tax: 180, recognized: 1000 },
		observed: {
			group: group(data, 'company_overhead'),
			recoverableTax: inr(data)!.recoverable_tax,
			grossLiability: inr(data)!.gross_liability,
		},
		staleVersion: { status: stale.status, code: stale.body.code },
	};
});

test('completes an entry with unresolved classification through the review queue', async ({
	page,
	request,
}) => {
	const voucher = `${OTHER_EXPENSE_PREFIX}REVIEW-1`;
	const captured = await captureStandalone(request, {
		voucher_number: voucher,
		voucher_date: `${MONTH}-09`,
		expense_category: 'Miscellaneous',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}unresolved`,
		bill_no: `${OTHER_EXPENSE_PREFIX}BILL-REVIEW-1`,
		bill_date: `${MONTH}-09`,
		bill_amount: 640,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}entry awaiting classification`,
		service_period_start: `${MONTH}-09`,
		service_period_end: `${MONTH}-09`,
		currency: 'INR',
		submit: true,
	});
	created.push({ where: 'api-review', id: captured.id, voucher });
	expect(captured.cost_classification).toBeNull();

	// Unresolved classification blocks recognition: the destination is a
	// deliberate decision, not a guess.
	const refused = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 1,
		reason: 'E2E should be refused',
	});
	expect(refused.status).toBe(422);
	expect(refused.body.code).toBe('not_ready_for_recognition');
	expect(String(JSON.stringify(refused.body))).toContain('cost_classification');
	expect((await storedOtherExpense(captured.id)).recognition_state).toBe(
		'pending_evidence'
	);

	const before = await reconciliation(request);
	expect(before.evidence.unresolved_classification.count).toBe(1);
	expect(before.evidence.unresolved_classification.gross_amount).toBe(
		REVIEW_UNALLOCATED
	);

	// The review queue lists it, and the browser completes it in place: no
	// source or evidence reference is recorded, and that stays disclosed on
	// the recognized row instead of being invented.
	const queue = await reviewQueue(request);
	const queued = queue.unresolved.find(
		(entry) => entry.voucher_number === voucher
	);
	expect(queued, 'review queue carries the unresolved entry').toBeTruthy();
	expect(queued!.missing).toContain('cost_classification');
	expect(queued!.financial_version).toBe(1);

	await page.goto('/admin/other-expenses');
	await page.getByTestId('tab-review').click();
	const panel = page.getByTestId('other-expense-review');
	await expect(panel).toBeVisible();
	const reviewRow = page.locator(
		`[data-testid="unresolved-row"][data-voucher="${voucher}"]`
	);
	await expect(reviewRow).toBeVisible();
	await expect(reviewRow).toHaveAttribute(
		'data-missing',
		/cost_classification/
	);
	await reviewRow.getByTestId('open-entry-review').click();
	const dialog = page.getByTestId('oe-review-dialog');
	await expect(dialog).toBeVisible();
	await page.locator('#oe-classification').selectOption('unallocated');
	await page.locator('#oe-reason').fill('E2E classification decided');
	await page.getByTestId('oe-save').click();
	await expect(dialog).toBeHidden();

	await openEntryReview(page, voucher);
	await page.locator('#oe-reason').fill('E2E classified and reviewed');
	await page.getByTestId('oe-recognize').click();
	await expect(page.getByTestId('oe-review-dialog')).toBeHidden();

	const data = await reconciliation(request);
	expect(group(data, 'unallocated_cost')).toBe(REVIEW_UNALLOCATED);
	expect(data.company.incurred_cost).toBe(
		expected.project + UI_PROJECT + API_OVERHEAD.recognized + REVIEW_UNALLOCATED
	);
	expect(data.evidence.unresolved_classification.count).toBe(0);

	const stored = await storedOtherExpense(captured.id);
	expect(stored.recognition_state).toBe('recognized');
	expect(stored.cost_classification).toBe('unallocated');
	expect(Number(stored.financial_version)).toBe(3);
	expect(stored.source_reference).toBeNull();
	expect(stored.evidence_reference).toBeNull();
	const journal = await journalOf(String(stored.cost_uid));
	expect(journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'updated',
		'recognized',
	]);

	// Missing source evidence is disclosed on the recognized row and in the
	// review queue's own missing list, and the row still counts once.
	const source = await drilldown(request, {
		month: MONTH,
		state: 'recognized',
	});
	const record = source.records.find(
		(entry) => entry.expense_number === voucher
	)!;
	expect(record.exceptions).toContain('missing_source_reference');
	expect(record.exceptions).toContain('missing_evidence_reference');
	expect(record.recognized_amount).toBe(REVIEW_UNALLOCATED);

	evidence.classificationReview = {
		voucher,
		refused: { status: refused.status, code: refused.body.code },
		observed: {
			group: group(data, 'unallocated_cost'),
			version: Number(stored.financial_version),
			exceptions: record.exceptions,
		},
		journal: journal.map((entry) => entry.command),
	};
});

test('keeps drafts, pending, rejected and cancelled entries out of confirmed cost', async ({
	request,
}) => {
	const draft = await captureStandalone(request, {
		voucher_number: `${OTHER_EXPENSE_PREFIX}DRAFT-1`,
		voucher_date: `${MONTH}-11`,
		expense_category: 'Printing & Stationery',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}draft`,
		bill_amount: 750,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}kept as a draft`,
		service_period_start: `${MONTH}-11`,
		service_period_end: `${MONTH}-11`,
		currency: 'INR',
	});
	created.push({ where: 'api-draft', id: draft.id });
	expect(draft.recognition_state).toBe('draft');

	const rejected = await captureStandalone(request, {
		voucher_number: `${OTHER_EXPENSE_PREFIX}REJECTED-1`,
		voucher_date: `${MONTH}-12`,
		expense_category: 'Conveyance',
		payee_type: 'employee',
		employee_name: `${OTHER_EXPENSE_VENDOR_PREFIX}employee`,
		bill_amount: 900,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}to be rejected`,
		cost_classification: 'unallocated',
		service_period_start: `${MONTH}-12`,
		service_period_end: `${MONTH}-12`,
		currency: 'INR',
		submit: true,
	});
	created.push({ where: 'api-rejected', id: rejected.id });
	const rejection = await command(request, rejected.id, {
		command: 'reject',
		expected_version: 1,
		reason: 'E2E duplicate receipt',
	});
	expect(rejection.status, JSON.stringify(rejection.body)).toBe(200);

	const cancelled = await captureStandalone(request, {
		voucher_number: `${OTHER_EXPENSE_PREFIX}CANCELLED-1`,
		voucher_date: `${MONTH}-13`,
		expense_category: 'Subscription',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}cancelled`,
		bill_amount: 800,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}to be cancelled`,
		cost_classification: 'unallocated',
		service_period_start: `${MONTH}-13`,
		service_period_end: `${MONTH}-13`,
		currency: 'INR',
		submit: true,
	});
	created.push({ where: 'api-cancelled', id: cancelled.id });
	const cancellation = await command(request, cancelled.id, {
		command: 'cancel',
		expected_version: 1,
		reason: 'E2E entered against the wrong period',
	});
	expect(cancellation.status, JSON.stringify(cancellation.body)).toBe(200);

	// A rejection without a reason is refused, and nothing is written.
	const unreasoned = await command(request, draft.id, {
		command: 'reject',
		expected_version: 1,
	});
	expect(unreasoned.status).toBe(422);
	expect(unreasoned.body.code).toBe('reason_required');
	expect(Number((await storedOtherExpense(draft.id)).financial_version)).toBe(
		1
	);

	const data = await reconciliation(request);
	const confirmedTotal =
		expected.project +
		UI_PROJECT +
		API_OVERHEAD.recognized +
		REVIEW_UNALLOCATED;
	expect(data.company.incurred_cost).toBe(confirmedTotal);
	expect(data.evidence.draft.count).toBe(1);
	expect(data.evidence.draft.amount).toBe(750);
	expect(data.evidence.rejected.count).toBe(1);
	expect(data.evidence.rejected.amount).toBe(900);
	expect(data.evidence.cancelled.count).toBe(1);
	expect(data.evidence.cancelled.amount).toBe(800);
	expect(data.evidence.recognized.amount).toBe(confirmedTotal);

	const draftRow = await storedOtherExpense(draft.id);
	expect(draftRow.recognition_state).toBe('draft');
	expect(Number(draftRow.recognized_amount ?? 0)).toBe(0);
	const rejectedRow = await storedOtherExpense(rejected.id);
	expect(rejectedRow.recognition_state).toBe('rejected');
	expect(Number(rejectedRow.financial_version)).toBe(2);
	const rejectedJournal = await journalOf(String(rejectedRow.cost_uid));
	expect(rejectedJournal.map((entry) => entry.command)).toEqual([
		'recorded',
		'rejected',
	]);
	const cancelledRow = await storedOtherExpense(cancelled.id);
	expect(cancelledRow.recognition_state).toBe('cancelled');
	expect(Number(cancelledRow.recognized_amount ?? 0)).toBe(0);

	evidence.unconfirmed = {
		expected: { draft: 750, rejected: 900, cancelled: 800 },
		observed: {
			draft: data.evidence.draft,
			rejected: data.evidence.rejected,
			cancelled: data.evidence.cancelled,
			company: data.company.incurred_cost,
		},
		unreasoned: { status: unreasoned.status, code: unreasoned.body.code },
	};
});

test('links a receipt copy to an already recognized cost instead of a second expense', async ({
	request,
}) => {
	const voucher = `${OTHER_EXPENSE_PREFIX}COPY-1`;
	const before = await reconciliation(request);

	const captured = await captureStandalone(request, {
		voucher_number: voucher,
		voucher_date: `${MONTH}-14`,
		expense_category: 'Repairs & Maintenance',
		payee_type: 'vendor',
		vendor_name: OTHER_EXPENSE_TARGET.vendor,
		bill_no: `${OTHER_EXPENSE_PREFIX}BILL-COPY-1`,
		bill_amount: OTHER_EXPENSE_TARGET.gross,
		gst_amount: OTHER_EXPENSE_TARGET.tax,
		description: `${OTHER_EXPENSE_PREFIX}receipt copy of the target cost`,
		linked_cost_uid: OTHER_EXPENSE_TARGET.costUid,
		currency: 'INR',
		evidence_reference: `${OTHER_EXPENSE_PREFIX}EV-COPY-1`,
	});
	created.push({ where: 'api-copy', id: captured.id, voucher });
	expect(captured.linked_cost_uid).toBe(OTHER_EXPENSE_TARGET.costUid);

	const stored = await storedOtherExpense(captured.id);
	expect(stored.linked_cost_uid).toBe(OTHER_EXPENSE_TARGET.costUid);
	// The copy has its own row identity for its journal, but it is not the
	// cost: the authoritative identity lives on the linked target.
	expect(String(stored.cost_uid)).toMatch(/^cost-/);
	const links = await rows<Record<string, unknown>>(
		`SELECT cost_uid, role, basis, review_state FROM financial_cost_links
      WHERE source_table = 'other_expenses' AND source_id = ?`,
		[captured.id]
	);
	expect(links).toHaveLength(1);
	expect(links[0].role).toBe('receipt');
	expect(links[0].basis).toBe('explicit');
	expect(links[0].review_state).toBe('confirmed');
	expect(links[0].cost_uid).toBe(OTHER_EXPENSE_TARGET.costUid);

	// The copy never becomes a second cost: nothing changes in the report and
	// it cannot be recognized or edited as a cost.
	const after = await reconciliation(request);
	expect(after.company.incurred_cost).toBe(before.company.incurred_cost);
	expect(after.company.record_count).toBe(before.company.record_count);
	const refusedRecognize = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 1,
		reason: 'E2E must be refused',
	});
	expect(refusedRecognize.status).toBe(422);
	expect(refusedRecognize.body.code).toBe('receipt_copy_not_cost');
	const refusedEdit = await command(request, captured.id, {
		command: 'update',
		expected_version: 1,
		patch: { classification: 'unallocated' },
	});
	expect(refusedEdit.status).toBe(422);
	expect(refusedEdit.body.code).toBe('receipt_copy_not_cost');
	expect((await storedOtherExpense(captured.id)).linked_cost_uid).toBe(
		OTHER_EXPENSE_TARGET.costUid
	);

	// An unknown or not-yet-recognized target fails visibly.
	const unknownTarget = await apiPost(request, '/api/admin/other-expenses', {
		voucher_number: `${OTHER_EXPENSE_PREFIX}COPY-BAD`,
		voucher_date: `${MONTH}-14`,
		expense_category: 'Repairs & Maintenance',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}copy-bad`,
		bill_amount: 10,
		gst_amount: 0,
		linked_cost_uid: `${OTHER_EXPENSE_PREFIX}no-such-cost`,
	});
	expect(unknownTarget.status()).toBe(422);
	expect((await unknownTarget.json()).code).toBe('cost_reference_unresolved');

	const draftCostUid = String(
		(
			await storedOtherExpense(
				String(created.find((entry) => entry.where === 'api-draft')!.id)
			)
		).cost_uid
	);
	const notRecognized = await apiPost(request, '/api/admin/other-expenses', {
		voucher_number: `${OTHER_EXPENSE_PREFIX}COPY-DRAFT`,
		voucher_date: `${MONTH}-14`,
		expense_category: 'Repairs & Maintenance',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}copy-draft`,
		bill_amount: 10,
		gst_amount: 0,
		linked_cost_uid: draftCostUid,
	});
	expect(notRecognized.status()).toBe(422);
	expect((await notRecognized.json()).code).toBe('cost_not_recognized');

	// The register's own read shows the copy as linked, not as a cost.
	const queue = await reviewQueue(request);
	const linked = queue.linked_copies.find(
		(entry) => entry.voucher_number === voucher
	);
	expect(linked, 'linked copy in the review read').toBeTruthy();
	expect(linked!.target_cost_uid).toBe(OTHER_EXPENSE_TARGET.costUid);
	expect(linked!.basis).toBe('explicit');

	evidence.receiptCopy = {
		voucher,
		target: OTHER_EXPENSE_TARGET.costUid,
		expected: { companyUnchanged: before.company.incurred_cost },
		observed: {
			company: after.company.incurred_cost,
			link: links[0],
			refused: {
				recognize: refusedRecognize.body.code,
				update: refusedEdit.body.code,
				unknownTarget: 422,
				notRecognized: 422,
			},
		},
	};
});

test('queues a text-similar entry for duplicate review and resolves it by decision', async ({
	page,
	request,
}) => {
	const voucher = `${OTHER_EXPENSE_PREFIX}DUP-1`;
	const before = await reconciliation(request);
	const captured = await captureStandalone(request, {
		voucher_number: voucher,
		voucher_date: `${MONTH}-15`,
		expense_category: 'Miscellaneous',
		payee_type: 'vendor',
		vendor_name: OTHER_EXPENSE_TARGET.vendor,
		bill_no: `${OTHER_EXPENSE_PREFIX}BILL-DUP-1`,
		bill_date: `${MONTH}-15`,
		bill_amount: OTHER_EXPENSE_TARGET.gross,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}possible duplicate of the target`,
		cost_classification: 'project',
		project_id: seeded.projectId,
		service_period_start: `${MONTH}-15`,
		service_period_end: `${MONTH}-15`,
		currency: 'INR',
		submit: true,
	});
	created.push({ where: 'api-duplicate', id: captured.id, voucher });

	// Similarity is preserved as a candidate: it names the target but merges
	// nothing, and recognition waits for the reviewer.
	expect(captured.duplicate_candidates).toHaveLength(1);
	expect(captured.duplicate_candidates[0].cost_uid).toBe(
		OTHER_EXPENSE_TARGET.costUid
	);
	const candidates = await rows<Record<string, unknown>>(
		`SELECT cost_uid, role, basis, review_state FROM financial_cost_links
      WHERE source_table = 'other_expenses' AND source_id = ?`,
		[captured.id]
	);
	expect(candidates).toHaveLength(2);
	const candidate = candidates.find((entry) => entry.role === 'receipt')!;
	expect(candidate.basis).toBe('candidate');
	expect(candidate.review_state).toBe('pending_review');

	const blocked = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 1,
		reason: 'E2E must wait for review',
	});
	expect(blocked.status).toBe(422);
	expect(blocked.body.code).toBe('duplicate_review_pending');
	const untouched = await reconciliation(request);
	expect(untouched.company.incurred_cost).toBe(before.company.incurred_cost);
	expect(untouched.evidence.recognized.count).toBe(
		before.evidence.recognized.count
	);

	// The reviewer confirms the copy: it becomes the target's evidence and
	// still adds nothing to cost.
	await page.goto('/admin/other-expenses');
	await page.getByTestId('tab-review').click();
	const copyRow = page.locator(
		`[data-testid="copy-review-row"][data-voucher="${voucher}"]`
	);
	await expect(copyRow).toBeVisible();
	await expect(copyRow).toHaveAttribute(
		'data-target',
		OTHER_EXPENSE_TARGET.costUid
	);
	await copyRow.getByTestId('confirm-copy').click();
	const decision = page.getByTestId('copy-decision-dialog');
	await expect(decision).toBeVisible();
	await decision
		.getByTestId('copy-decision-reason')
		.fill('E2E document-backed review: same bill already recognized');
	await decision.getByTestId('copy-decision-submit').click();
	await expect(decision).toBeHidden();

	const copyStored = await storedOtherExpense(captured.id);
	expect(copyStored.linked_cost_uid).toBe(OTHER_EXPENSE_TARGET.costUid);
	expect(Number(copyStored.financial_version)).toBe(2);
	const confirmed = await rows<Record<string, unknown>>(
		`SELECT cost_uid, role, basis, review_state FROM financial_cost_links
      WHERE source_table = 'other_expenses' AND source_id = ? AND role = 'receipt'`,
		[captured.id]
	);
	expect(confirmed[0].basis).toBe('document');
	expect(confirmed[0].review_state).toBe('confirmed');
	const copyJournal = await journalOf(String(copyStored.cost_uid));
	expect(copyJournal.map((entry) => entry.command)).toEqual([
		'recorded',
		'updated',
	]);
	const afterConfirm = await reconciliation(request);
	expect(afterConfirm.company.incurred_cost).toBe(before.company.incurred_cost);
	expect(afterConfirm.company.record_count).toBe(before.company.record_count);

	// A second similar entry is rejected by the reviewer and stays a standalone
	// cost: text similarity alone never merged it, so it counts once only
	// because a person decided it is its own expense.
	const standaloneVoucher = `${OTHER_EXPENSE_PREFIX}DUP-2`;
	const second = await captureStandalone(request, {
		voucher_number: standaloneVoucher,
		voucher_date: `${MONTH}-16`,
		expense_category: 'Miscellaneous',
		payee_type: 'vendor',
		vendor_name: OTHER_EXPENSE_TARGET.vendor,
		bill_no: `${OTHER_EXPENSE_PREFIX}BILL-DUP-2`,
		bill_date: `${MONTH}-16`,
		bill_amount: OTHER_EXPENSE_TARGET.gross,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}separate expense with a similar bill`,
		cost_classification: 'project',
		project_id: seeded.projectId,
		service_period_start: `${MONTH}-16`,
		service_period_end: `${MONTH}-16`,
		currency: 'INR',
		submit: true,
	});
	created.push({
		where: 'api-standalone',
		id: second.id,
		voucher: standaloneVoucher,
	});
	expect(second.duplicate_candidates).toHaveLength(1);

	await page.goto('/admin/other-expenses');
	await page.getByTestId('tab-review').click();
	const secondRow = page.locator(
		`[data-testid="copy-review-row"][data-voucher="${standaloneVoucher}"]`
	);
	await expect(secondRow).toBeVisible();
	await secondRow.getByTestId('reject-copy').click();
	const rejectDialog = page.getByTestId('copy-decision-dialog');
	await rejectDialog
		.getByTestId('copy-decision-reason')
		.fill('E2E different work, not a copy');
	await rejectDialog.getByTestId('copy-decision-submit').click();
	await expect(rejectDialog).toBeHidden();

	const rejectedLink = await rows<Record<string, unknown>>(
		`SELECT review_state, basis FROM financial_cost_links
      WHERE source_table = 'other_expenses' AND source_id = ? AND role = 'receipt'`,
		[second.id]
	);
	expect(rejectedLink[0].review_state).toBe('rejected');
	const secondStored = await storedOtherExpense(second.id);
	expect(secondStored.linked_cost_uid).toBeNull();
	expect(Number(secondStored.financial_version)).toBe(2);

	const secondRecognized = await command(request, second.id, {
		command: 'recognize',
		expected_version: 2,
		reason: 'E2E reviewed as its own expense',
	});
	expect(secondRecognized.status, JSON.stringify(secondRecognized.body)).toBe(
		200
	);
	const final = await reconciliation(request);
	expect(group(final, 'incurred_project_cost')).toBe(CONFIRMED.project);
	expect((await storedOtherExpense(second.id)).recognition_state).toBe(
		'recognized'
	);

	evidence.duplicateReview = {
		copy: voucher,
		standalone: standaloneVoucher,
		target: OTHER_EXPENSE_TARGET.costUid,
		observed: {
			blocked: { status: blocked.status, code: blocked.body.code },
			confirmedCopy: {
				link: confirmed[0],
				version: Number(copyStored.financial_version),
			},
			rejectedCandidate: {
				link: rejectedLink[0],
				version: Number(secondStored.financial_version),
			},
			projectGroup: group(final, 'incurred_project_cost'),
		},
	};
});

test('refuses ordinary deletion of recognized cost and keeps cancelled history', async ({
	request,
}) => {
	const overheadId = String(
		created.find((entry) => entry.where === 'api-overhead')!.id
	);
	const before = await reconciliation(request);
	expect(group(before, 'company_overhead')).toBe(1000);

	// Ordinary deletion cannot remove confirmed cost.
	const refusal = await apiDelete(
		request,
		`/api/admin/other-expenses/${overheadId}`
	);
	expect(refusal.status()).toBe(409);
	expect((await refusal.json()).code).toBe('cost_recognized');
	const stillThere = await storedOtherExpense(overheadId);
	expect(Number(stillThere.isDelete)).toBe(0);
	expect((await reconciliation(request)).company.incurred_cost).toBe(
		before.company.incurred_cost
	);

	// The versioned cancellation is the supported correction: it keeps the row
	// and its recognized history, and stops the cost counting.
	const cancelled = await command(request, overheadId, {
		command: 'cancel',
		expected_version: 2,
		reason: 'E2E overhead belongs to another period',
		evidence_reference: `${OTHER_EXPENSE_PREFIX}EV-CANCEL-OH`,
	});
	expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
	const after = await reconciliation(request);
	expect(group(after, 'company_overhead')).toBe(CONFIRMED.overhead);
	expect(group(after, 'incurred_project_cost')).toBe(CONFIRMED.project);
	expect(group(after, 'unallocated_cost')).toBe(CONFIRMED.unallocated);
	expect(after.company.incurred_cost).toBe(CONFIRMED.total);
	expect(inr(after)!.gross_liability).toBe(CONFIRMED.total);
	expect(inr(after)!.recoverable_tax).toBe(0);

	// Even cancelled history cannot be deleted away.
	const secondRefusal = await apiDelete(
		request,
		`/api/admin/other-expenses/${overheadId}`
	);
	expect(secondRefusal.status()).toBe(409);
	expect((await secondRefusal.json()).code).toBe('cost_history_preserved');
	const historyRow = await storedOtherExpense(overheadId);
	expect(Number(historyRow.isDelete)).toBe(0);
	expect(historyRow.recognition_state).toBe('cancelled');
	expect(Number(historyRow.recognized_amount)).toBe(1000);
	const journal = await journalOf(String(historyRow.cost_uid));
	expect(journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'recognized',
		'cancelled',
	]);

	evidence.deletion = {
		expected: { recognizedRefusal: 409, historyRefusal: 409 },
		observed: {
			recognizedRefusal: 409,
			historyRefusal: 409,
			state: historyRow.recognition_state,
			recognizedAmount: Number(historyRow.recognized_amount),
			journal: journal.map((entry) => entry.command),
			company: after.company.incurred_cost,
		},
	};
});

test('keeps a foreign currency in its own subtotal instead of mixing it', async ({
	request,
}) => {
	const captured = await captureStandalone(request, {
		voucher_number: `${OTHER_EXPENSE_PREFIX}USD-1`,
		voucher_date: `${MONTH}-18`,
		expense_category: 'Subscription',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}usd`,
		bill_amount: 50,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}foreign-currency subscription`,
		cost_classification: 'company_overhead',
		service_period_start: `${MONTH}-18`,
		service_period_end: `${MONTH}-18`,
		currency: 'USD',
		submit: true,
	});
	created.push({ where: 'api-usd', id: captured.id });
	const recognized = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 1,
		reason: 'E2E foreign cost reviewed',
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);

	const mixed = await reconciliation(request);
	expect(mixed.company.currency).toBeNull();
	expect(mixed.company.incurred_cost).toBeNull();
	expect(mixed.company.groups).toEqual([]);
	expect(mixed.company.gross_liability).toBeNull();
	expect(mixed.company.recoverable_tax).toBeNull();
	const currencies = mixed.company.currency_totals
		.map((row) => row.currency)
		.sort();
	expect(currencies).toEqual(['INR', 'USD']);
	const usd = mixed.company.currency_totals.find(
		(row) => row.currency === 'USD'
	)!;
	expect(usd.company_overhead).toBe(50);
	expect(inr(mixed)!.incurred_cost).toBe(CONFIRMED.total);

	const stored = await storedOtherExpense(captured.id);
	expect(stored.currency).toBe('USD');
	expect(Number(stored.recognized_amount)).toBe(50);

	// Cancelling it restores the single-currency reconciliation.
	const cancelled = await command(request, captured.id, {
		command: 'cancel',
		expected_version: 2,
		reason: 'E2E entered in the wrong currency period',
	});
	expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
	const restored = await reconciliation(request);
	expect(restored.company.currency).toBe('INR');
	expect(restored.company.incurred_cost).toBe(CONFIRMED.total);
	expect(restored.company.currency_totals).toHaveLength(1);

	evidence.currency = {
		expected: { mixed: null, usdOverhead: 50 },
		observed: {
			mixed: {
				currency: null,
				currencies,
				USD_overhead: usd.company_overhead,
			},
			restored: restored.company.incurred_cost,
		},
	};
});

test('carries conversion evidence from capture to the reporting figure', async ({
	request,
}) => {
	const voucher = `${OTHER_EXPENSE_PREFIX}FX-1`;
	/** 50 USD at 84.5, rounded half-up to cents by the shared helper. */
	const converted = 50 * 84.5;

	const captured = await captureStandalone(request, {
		voucher_number: voucher,
		voucher_date: `${MONTH}-19`,
		expense_category: 'Subscription',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}fx`,
		bill_amount: 50,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}USD cost with conversion evidence`,
		cost_classification: 'company_overhead',
		service_period_start: `${MONTH}-19`,
		service_period_end: `${MONTH}-19`,
		currency: 'USD',
		reporting_currency: 'INR',
		conversion_rate: '84.5000000000',
		conversion_date: `${MONTH}-19`,
		conversion_evidence_reference: `${OTHER_EXPENSE_PREFIX}RATE-1`,
		submit: true,
	});
	created.push({ where: 'api-conversion', id: captured.id, voucher });

	// Evidence moves as a whole: a rate without its date is refused, and a rate
	// on an amount already in its reporting currency is contradictory.
	const partial = await apiPost(request, '/api/admin/other-expenses', {
		voucher_number: `${OTHER_EXPENSE_PREFIX}FX-PARTIAL`,
		voucher_date: `${MONTH}-19`,
		expense_category: 'Subscription',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}fx-partial`,
		bill_amount: 50,
		gst_amount: 0,
		currency: 'USD',
		reporting_currency: 'INR',
		conversion_rate: '84.5',
	});
	expect(partial.status()).toBe(422);
	const partialBody = errorBody(await partial.json());
	expect(partialBody.code).toBe('conversion_evidence_incomplete');
	expect(partialBody.missing).toContain('conversion_date');

	const notApplicable = await apiPost(request, '/api/admin/other-expenses', {
		voucher_number: `${OTHER_EXPENSE_PREFIX}FX-INR`,
		voucher_date: `${MONTH}-19`,
		expense_category: 'Subscription',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}fx-inr`,
		bill_amount: 10,
		gst_amount: 0,
		currency: 'INR',
		reporting_currency: 'INR',
		conversion_rate: '1.0',
		conversion_date: `${MONTH}-19`,
		conversion_evidence_reference: `${OTHER_EXPENSE_PREFIX}RATE-NONE`,
	});
	expect(notApplicable.status()).toBe(422);
	expect(errorBody(await notApplicable.json()).code).toBe(
		'conversion_not_applicable'
	);

	// A rate belongs to one currency pair: changing the original currency
	// without fresh evidence for the new pair is refused, not inherited.
	const pairChange = await command(request, captured.id, {
		command: 'update',
		expected_version: 1,
		patch: { currency: 'EUR' },
	});
	expect(pairChange.status).toBe(422);
	expect(pairChange.body.code).toBe('conversion_evidence_required');
	expect((await storedOtherExpense(captured.id)).currency).toBe('USD');

	// Moving an entry onto its reporting currency clears the triple instead.
	const cleared = await captureStandalone(request, {
		voucher_number: `${OTHER_EXPENSE_PREFIX}FX-CLEAR`,
		voucher_date: `${MONTH}-19`,
		expense_category: 'Subscription',
		payee_type: 'vendor',
		vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}fx-clear`,
		bill_amount: 10,
		gst_amount: 0,
		description: `${OTHER_EXPENSE_PREFIX}USD cost moved to the reporting currency`,
		cost_classification: 'company_overhead',
		service_period_start: `${MONTH}-19`,
		service_period_end: `${MONTH}-19`,
		currency: 'USD',
		reporting_currency: 'INR',
		conversion_rate: '84.5000000000',
		conversion_date: `${MONTH}-19`,
		conversion_evidence_reference: `${OTHER_EXPENSE_PREFIX}RATE-CLEAR`,
		submit: true,
	});
	created.push({ where: 'api-conversion-clear', id: cleared.id });
	const clearedUpdate = await command(request, cleared.id, {
		command: 'update',
		expected_version: 1,
		patch: { currency: 'INR' },
	});
	expect(clearedUpdate.status, JSON.stringify(clearedUpdate.body)).toBe(200);
	const clearedRow = await storedOtherExpense(cleared.id);
	expect(clearedRow.currency).toBe('INR');
	expect(clearedRow.reporting_currency).toBe('INR');
	expect(clearedRow.conversion_rate).toBeNull();
	expect(clearedRow.conversion_date).toBeNull();
	expect(clearedRow.conversion_evidence_reference).toBeNull();

	const recognized = await command(request, captured.id, {
		command: 'recognize',
		expected_version: 1,
		reason: 'E2E conversion evidence reviewed',
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);

	const stored = await storedOtherExpense(captured.id);
	expect(stored.currency).toBe('USD');
	expect(stored.reporting_currency).toBe('INR');
	expect(String(stored.conversion_rate)).toMatch(/^84\.5/);
	expect(String(stored.conversion_date).slice(0, 10)).toBe(`${MONTH}-19`);
	expect(stored.conversion_evidence_reference).toBe(
		`${OTHER_EXPENSE_PREFIX}RATE-1`
	);
	expect(Number(stored.converted_amount)).toBe(converted);

	// The month becomes complete in the reporting currency: the INR slice plus
	// this record's converted figure.
	const data = await reconciliation(request);
	expect(data.company.currency).toBe('INR');
	expect(data.company.incurred_cost).toBe(CONFIRMED.total + converted);
	const usd = data.company.currency_totals.find(
		(row) => row.currency === 'USD'
	)!;
	expect(usd.reporting.status).toBe('converted');
	expect(usd.reporting.incurred_cost).toBe(converted);
	expect(inr(data)!.incurred_cost).toBe(CONFIRMED.total);

	const source = await drilldown(request, {
		month: MONTH,
		state: 'recognized',
	});
	const row = source.records.find((entry) => entry.expense_number === voucher)!;
	expect(row.conversion_status).toBe('converted');
	expect(row.converted_amount).toBe(converted);

	// Cancelling it restores the month to its INR-only reconciliation.
	const cancelled = await command(request, captured.id, {
		command: 'cancel',
		expected_version: 2,
		reason: 'E2E conversion evidence period closed',
	});
	expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
	expect((await reconciliation(request)).company.incurred_cost).toBe(
		CONFIRMED.total
	);

	evidence.conversion = {
		voucher,
		expected: { rate: '84.5', converted },
		observed: {
			storedRate: String(stored.conversion_rate),
			convertedAmount: Number(stored.converted_amount),
			monthTotalWithConversion: CONFIRMED.total + converted,
			usdReporting: usd.reporting,
		},
		refused: {
			partial: partialBody.code,
			notApplicable: 422,
		},
	};
});

test('agrees with the browser report and the independently persisted rows', async ({
	page,
	request,
}) => {
	const total = CONFIRMED.total;

	await openReport(page, MONTH_LABEL);
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(total);
	expect(await kpi(page, 'kpi-project-cost')).toBe(CONFIRMED.project);
	expect(await kpi(page, 'kpi-overhead')).toBe(CONFIRMED.overhead);
	expect(await kpi(page, 'kpi-unallocated')).toBe(CONFIRMED.unallocated);

	const api = await reconciliation(request);
	expect(api.company.incurred_cost).toBe(total);
	expect(api.company.currency).toBe('INR');
	expect(api.company.record_count).toBe(expected.confirmedRecords + 3);
	expect(group(api, 'incurred_project_cost')).toBe(CONFIRMED.project);
	expect(group(api, 'company_overhead')).toBe(CONFIRMED.overhead);
	expect(group(api, 'unallocated_cost')).toBe(CONFIRMED.unallocated);
	expect(inr(api)!.gross_liability).toBe(total);
	expect(inr(api)!.recoverable_tax).toBe(0);

	// The month's records are exactly this ticket's: the seed, seven rows
	// recorded through the app, and the cancelled ones, minus the linked copies
	// which are never costs.
	const source = await drilldown(request, {
		month: MONTH,
		state: 'all',
		limit: '200',
	});
	expect(source.total).toBe(11);
	expect(source.totals.confirmed_amount).toBe(total);
	expect(source.totals.records).toBe(11);
	const otherExpenseRows = source.records.filter(
		(entry) => entry.source === 'other_expense'
	);
	expect(otherExpenseRows.length).toBe(10);
	expect(
		otherExpenseRows.some((entry) => entry.recognition_state === 'cancelled')
	).toBe(true);
	expect(
		otherExpenseRows
			.filter((entry) => entry.recognition_state === 'recognized')
			.every((entry) => (entry.recognized_amount ?? 0) >= 0)
	).toBe(true);

	// Independent database check: confirmed other-expense cost plus the seeded
	// direct expense equals the report's company total, for the same month.
	const persisted = await rows<{ total: string; records: number }>(
		`SELECT COALESCE(SUM(recognized_amount), 0) AS total, COUNT(*) AS records
       FROM other_expenses
      WHERE isDelete = 0 AND recognition_state = 'recognized'
        AND linked_cost_uid IS NULL
        AND recognition_period BETWEEN ? AND ?`,
		[`${MONTH}-01`, `${MONTH}-31`]
	);
	expect(Number(persisted[0].records)).toBe(3);
	expect(Number(persisted[0].total) + OTHER_EXPENSE_TARGET.gross).toBe(total);
	const copies = await rows<{ total: number }>(
		`SELECT COUNT(*) AS total FROM other_expenses
      WHERE isDelete = 0 AND linked_cost_uid IS NOT NULL`
	);
	expect(Number(copies[0].total)).toBe(2);

	evidence.report = {
		expected: {
			total,
			project: CONFIRMED.project,
			unallocated: CONFIRMED.unallocated,
		},
		observed: {
			browserTotal: total,
			apiTotal: api.company.incurred_cost,
			drilldown: source.totals,
			persisted: {
				otherExpenses: Number(persisted[0].total),
				records: Number(persisted[0].records),
			},
		},
	};
});

test('enforces source authorization on reads, capture, approval and review', async ({
	request,
	playwright,
	browser,
	baseURL,
}) => {
	const overheadId = String(
		created.find((entry) => entry.where === 'api-overhead')!.id
	);
	const before = await storedOtherExpense(overheadId);
	const reader = await loginOtherExpenseReader(playwright, baseURL!);
	try {
		// The read-only reader may list the register, and nothing else.
		const list = await reader.get('/api/admin/other-expenses?limit=5');
		expect(list.status()).toBe(200);

		const read = await reader.get(`/api/admin/other-expenses/${overheadId}`);
		expect(read.status()).toBe(200);

		const deniedCreate = await reader.post('/api/admin/other-expenses', {
			data: {
				voucher_date: `${MONTH}-20`,
				expense_category: 'Miscellaneous',
				payee_type: 'vendor',
				bill_amount: 1,
			},
		});
		expect(deniedCreate.status()).toBe(403);

		const deniedApprove = await reader.post(
			`/api/admin/other-expenses/${overheadId}/commands`,
			{
				data: {
					command: 'recognize',
					expected_version: Number(before.financial_version),
					reason: 'E2E unauthorized approval',
				},
			}
		);
		expect(deniedApprove.status()).toBe(403);

		const deniedReview = await reader.post(
			`/api/admin/other-expenses/${overheadId}/review`,
			{
				data: {
					action: 'confirm_copy',
					expected_version: Number(before.financial_version),
					reason: 'E2E unauthorized review',
					target_cost_uid: OTHER_EXPENSE_TARGET.costUid,
				},
			}
		);
		expect(deniedReview.status()).toBe(403);

		const deniedDelete = await reader.delete(
			`/api/admin/other-expenses/${overheadId}`
		);
		expect(deniedDelete.status()).toBe(403);

		// The reader may edit operational fields (update), but the conversion
		// evidence is an approval-gated financial change and is refused.
		const throwaway = await captureStandalone(request, {
			voucher_number: `${OTHER_EXPENSE_PREFIX}AUTH-1`,
			voucher_date: `${MONTH}-20`,
			expense_category: 'Miscellaneous',
			payee_type: 'vendor',
			vendor_name: `${OTHER_EXPENSE_VENDOR_PREFIX}auth`,
			bill_amount: 25,
			gst_amount: 0,
			description: `${OTHER_EXPENSE_PREFIX}authorization probe`,
			cost_classification: 'unallocated',
			service_period_start: `${MONTH}-20`,
			service_period_end: `${MONTH}-20`,
			currency: 'INR',
			submit: true,
		});
		created.push({ where: 'api-auth', id: throwaway.id });
		const allowedEdit = await reader.post(
			`/api/admin/other-expenses/${throwaway.id}/commands`,
			{
				data: {
					command: 'update',
					expected_version: 1,
					patch: { classification: 'company_overhead' },
				},
			}
		);
		expect(allowedEdit.status(), await allowedEdit.text()).toBe(200);
		const deniedConversion = await reader.post(
			`/api/admin/other-expenses/${throwaway.id}/commands`,
			{
				data: {
					command: 'update',
					expected_version: 2,
					patch: {
						reporting_currency: 'INR',
						conversion_rate: '2.0',
						conversion_date: `${MONTH}-20`,
						conversion_evidence_reference: `${OTHER_EXPENSE_PREFIX}RATE-AUTH`,
					},
				},
			}
		);
		expect(deniedConversion.status()).toBe(403);
		const probe = await storedOtherExpense(throwaway.id);
		expect(probe.conversion_rate).toBeNull();
		expect(probe.converted_amount).toBeNull();
		expect(Number(probe.financial_version)).toBe(2);
		expect(probe.cost_classification).toBe('company_overhead');

		// The same identity through the real browser controls: an operational
		// save is allowed, a conversion-rate save is refused and writes nothing.
		let savedThroughBrowser: Record<string, unknown> = {};
		let refusedThroughBrowser: Record<string, unknown> = {};
		const browserState = await reader.storageState();
		const readerContext = await browser.newContext({
			baseURL,
			storageState: browserState,
			extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.24' },
		});
		try {
			const readerPage = await readerContext.newPage();
			await readerPage.goto('/admin/other-expenses');
			const authRow = readerPage.locator(
				`[data-testid="oe-row"][data-voucher="${OTHER_EXPENSE_PREFIX}AUTH-1"]`
			);
			await expect(authRow).toBeVisible();
			await authRow.getByTestId('oe-row-review').click();
			const authDialog = readerPage.getByTestId('oe-review-dialog');
			await expect(authDialog).toBeVisible();
			await readerPage
				.locator('#oe-classification')
				.selectOption('unallocated');
			await readerPage.getByTestId('oe-save').click();
			await expect(authDialog).toBeHidden();
			savedThroughBrowser = await storedOtherExpense(throwaway.id);
			expect(savedThroughBrowser.cost_classification).toBe('unallocated');
			expect(Number(savedThroughBrowser.financial_version)).toBe(3);
			expect(savedThroughBrowser.conversion_rate).toBeNull();

			await authRow.getByTestId('oe-row-review').click();
			await expect(authDialog).toBeVisible();
			await readerPage.locator('#oe-conversion-rate').fill('2.0');
			await readerPage.getByTestId('oe-save').click();
			// Refused: the dialog stays open and the rate is not stored.
			await expect(authDialog).toBeVisible();
			await expect(
				readerPage.getByText(/Forbidden|approval access/i).first()
			).toBeVisible();
			refusedThroughBrowser = await storedOtherExpense(throwaway.id);
			expect(refusedThroughBrowser.conversion_rate).toBeNull();
			expect(Number(refusedThroughBrowser.financial_version)).toBe(3);
		} finally {
			await readerContext.close();
		}

		// No failed command changed anything.
		const after = await storedOtherExpense(overheadId);
		expect(after).toEqual(before);
		evidence.authorization = {
			expected: {
				list: 200,
				read: 200,
				create: 403,
				approve: 403,
				review: 403,
				delete: 403,
				update: 200,
				conversionUpdate: 403,
			},
			observed: {
				list: list.status(),
				read: read.status(),
				create: deniedCreate.status(),
				approve: deniedApprove.status(),
				review: deniedReview.status(),
				delete: deniedDelete.status(),
				update: allowedEdit.status(),
				conversionUpdate: deniedConversion.status(),
				browserSave: savedThroughBrowser.cost_classification,
				browserRateRefused: refusedThroughBrowser.conversion_rate === null,
				unchanged: true,
			},
		};
	} finally {
		await reader.dispose();
	}

	// A reader without `other_expenses:read` sees nothing at all: the register
	// gate refuses the ledger even though the same identity may read reports.
	// Sibling specs purge this shared identity in their own teardowns, so make
	// sure the row exists before logging in as it (order-dependent 401).
	await ensureExpenditureReportOnlyReader();
	const reportOnly = await loginExpenditureReportOnlyReader(
		playwright,
		baseURL!
	);
	try {
		const denied = await reportOnly.get('/api/admin/other-expenses?limit=5');
		expect(denied.status()).toBe(403);
	} finally {
		await reportOnly.dispose();
	}
});

/** Keep the final aggregate in the artifact for every rerun. */
test('regenerates the artifact', async ({ request }) => {
	const data = await reconciliation(request);
	const source = await drilldown(request, { month: MONTH, state: 'all' });
	evidence.final = {
		month: MONTH,
		company: {
			currency: data.company.currency,
			incurredCost: data.company.incurred_cost,
			groups: data.company.groups,
			grossLiability: data.company.gross_liability,
			recoverableTax: data.company.recoverable_tax,
			evidence: data.evidence,
		},
		drilldown: {
			total: source.total,
			totals: source.totals,
			sources: [...new Set(source.records.map((entry) => entry.source))],
		},
	};
	publish();
});
