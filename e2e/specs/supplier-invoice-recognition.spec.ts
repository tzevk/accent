import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';
import { apiGet, apiPost, apiPut } from '../lib/rate-limit-pacing';
import {
	SUPPLIER_API_INVOICE,
	SUPPLIER_INVOICE_MONTH,
	SUPPLIER_MONTH,
	SUPPLIER_LATER_MONTH,
	SUPPLIER_PROJECTS,
	SUPPLIER_UI_INVOICE,
	cleanupSupplierInvoiceFixtures,
	loginSupplierEditor,
	loginSupplierReportsOnly,
	seedSupplierInvoiceFixtures,
	seededInvoice,
	type SeededSupplierInvoices,
} from '../lib/supplier-invoice-fixtures';

/**
 * Ticket #311 — supplier invoice recognition without payable duplication.
 *
 * Everything here is stated from the fixture literals and the business rules,
 * never from the report module's own aggregation. The fixture rows state what
 * each invoice is worth; this file states what the reconciliation must show,
 * then compares the app's answer with that arithmetic and re-checks the rows
 * in the database independently.
 *
 * Two extra invoices are recorded through the real app: one through the admin
 * browser form + recognition dialog, one through the authenticated command
 * API with its period splits. Their amounts are asserted as exact totals of a
 * reserved month range (2020-03..2020-05), which no other spec seeds.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's browser identity, set through the proxy's trusted header
	// (ADR-0013), so a combined run cannot exhaust the shared budget.
	// `API_HEADERS` below gives the same session a second identity for the
	// direct API calls: one in-memory `api` budget (120/min) per identity
	// cannot cover both the five page loads and the API context.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.73' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

/**
 * The direct API calls' rate-limit identity, distinct from the browser one
 * above. The report pages this spec drives spend one `api` budget between
 * their shell and their own queries, so sharing an identity with the
 * `request` fixture would 429 the reconciliation read at the end of the file.
 */
const API_HEADERS = { 'x-vercel-forwarded-for': '198.18.0.74' } as const;

const MONTH = SUPPLIER_MONTH;
const INVOICE_MONTH = SUPPLIER_INVOICE_MONTH;
const LATER_MONTH = SUPPLIER_LATER_MONTH;
const MONTH_LABEL = 'March 2020';
const INVOICE_MONTH_LABEL = 'April 2020';

const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

function labelOf(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** The invoice the browser records, submits, and recognizes. */
const UI_INVOICE = {
	number: SUPPLIER_UI_INVOICE,
	gross: 118000,
	tax: 18000,
	recognized: 100000,
	serviceStart: '2020-03-01',
	serviceEnd: '2020-03-31',
	invoiceDate: '2020-04-05',
	sourceReference: 'E2E-SINV-VENDOR-9001',
} as const;

/** The split invoice the API records and recognizes across two periods. */
const API_INVOICE = {
	number: SUPPLIER_API_INVOICE,
	gross: 100000,
	march: 60000,
	april: 40000,
	sourceReference: 'E2E-SINV-VENDOR-9002',
} as const;

/**
 * The USD invoice proving a native supplier record captures and versions
 * original → reporting conversion evidence (never a null placeholder and never
 * a guessed rate), in its own reserved months.
 */
const FX_INVOICE = {
	number: 'E2E-SINV-9003',
	month: '2020-06',
	gross: 1200,
	rate: 83.5,
	updatedRate: 84,
	/** A fresh triple for the changed pair (USD → EUR). */
	pairRate: 0.9,
	rateDate: '2020-06-10',
	evidenceReference: 'E2E-SINV-FX-9003',
	converted: 1200 * 84,
	sourceReference: 'E2E-SINV-VENDOR-9003',
} as const;

/** A USD invoice recognized with no conversion evidence at all. */
const FX_UNSUPPORTED = {
	number: 'E2E-SINV-9004',
	month: '2020-07',
	gross: 500,
	sourceReference: 'E2E-SINV-VENDOR-9004',
} as const;

/**
 * A converted multi-period invoice whose per-slice rounding must agree with
 * the report: 33.33 × 1.5 = 49.995 → 50.00 and 66.67 × 1.5 = 100.005 →
 * 100.01, so the frozen invoice figure is the per-slice sum 150.01, not the
 * single 150.00 a whole-invoice conversion would give.
 */
const FX_SPLIT = {
	number: 'E2E-SINV-9005',
	monthA: '2020-11',
	monthB: '2020-12',
	rate: 1.5,
	rateDate: '2020-11-05',
	evidenceReference: 'E2E-SINV-FX-9005',
	slices: [
		{
			start: '2020-11-01',
			end: '2020-11-30',
			amount: '33.33',
			converted: 50.0,
		},
		{
			start: '2020-12-01',
			end: '2020-12-31',
			amount: '66.67',
			converted: 100.01,
		},
	],
	convertedTotal: 150.01,
	sourceReference: 'E2E-SINV-VENDOR-9005',
} as const;

/**
 * Hand-computed from the fixture literals plus the two app-created invoices:
 * March confirmed = alpha 50000+25000+12000+100000+60000, beta 60000,
 * overhead 15000, unallocated 5000; the UI invoice's gross carries 18000 of
 * evidenced recoverable tax, so gross liability is 345000.
 */
const MARCH = {
	alpha: 50000 + 25000 + 12000 + UI_INVOICE.recognized + API_INVOICE.march,
	beta: 60000,
	overhead: 15000,
	unallocated: 5000,
	gross: 345000,
	recoverableTax: 18000,
	records: 8,
	/** The source summary's review queue counts draft + pending evidence. */
	pendingCount: 3,
	pendingGross: 9999 + 7777 + 333,
	/** The evidence summary separates pending evidence from draft. */
	pendingEvidenceCount: 2,
	pendingEvidenceGross: 9999 + 7777,
	draftCount: 1,
	rejectedCount: 1,
	cancelledCount: 1,
	unresolvedClassificationCount: 2,
	unresolvedClassificationGross: 7777 + 333,
} as const;
const MARCH_PROJECT = MARCH.alpha + MARCH.beta;
const MARCH_TOTAL = MARCH_PROJECT + MARCH.overhead + MARCH.unallocated;
/** Before the API test records its split invoice (tests run in order). */
const MARCH_BEFORE_SPLIT = {
	alpha: MARCH.alpha - API_INVOICE.march,
	total: MARCH_TOTAL - API_INVOICE.march,
	records: MARCH.records - 1,
} as const;

/**
 * April confirmed = alpha 118000+59000+40000, beta 40000. The 109000/9000
 * invoice's treatment is unresolved and the 50000/9000 claim has no evidence,
 * so both count at gross and stay visible as unresolved tax.
 */
const APRIL = {
	alpha: 118000 + 59000 + API_INVOICE.april,
	beta: 40000,
	unresolvedTaxCount: 2,
	unresolvedTaxGross: 118000 + 59000,
	recoverableTax: 0,
	records: 4,
} as const;
const APRIL_TOTAL = APRIL.alpha + APRIL.beta;

interface ReconciliationData {
	month: string;
	month_label: string;
	company: {
		currency: string | null;
		reporting_currency: string;
		conversion: {
			status: string;
			converted_records: number;
			unsupported_records: number;
			unsupported_currencies: string[];
			unknown_currency_records: number;
		};
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
		project_id: number;
		project_code: string;
		currency: string;
		incurred_cost: number;
		record_count: number;
		not_confirmed_cost: number | null;
	}>;
	evidence: Record<
		'recognized' | 'pending_evidence' | 'draft' | 'rejected' | 'cancelled',
		{ count: number; currency: string | null; amount: number | null }
	> & {
		missing_amount: { count: number };
		unresolved_classification: {
			count: number;
			currency: string | null;
			gross_amount: number | null;
		};
	};
	sources: Array<{
		source: string;
		label: string;
		confirmed_count: number;
		confirmed_amount: number | null;
		currency: string | null;
		pending_count: number;
		pending_amount: number | null;
		unresolved_evidence_count: number;
	}>;
	coverage: Array<{
		code: string;
		label: string;
		detail: string;
		severity: string;
	}>;
}

interface DrilldownRecord {
	id: number;
	cost_uid: string | null;
	source: string;
	split: { id: number; index: number; count: number } | null;
	expense_number: string;
	recognition_state: string;
	cost_classification: string | null;
	recognition_period: string | null;
	period_basis: string;
	currency: string | null;
	converted_amount: number | null;
	conversion_status: string;
	gross_amount: number | null;
	recognized_amount: number | null;
	source_reference: string | null;
	project_code: string | null;
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

interface CommandResult {
	id: number;
	cost_uid: string | null;
	recognition_state: string;
	financial_version: number;
	recognized_amount: number | null;
	recognition_period: string | null;
	component: string;
}

let seeded: SeededSupplierInvoices;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
/** Ids this spec records through the app, so the run leaves nothing behind. */
const createdInvoices: Array<{ id: number; cost_uid: string; where: string }> =
	[];
const createdPayables: Array<{ id: number; where: string }> = [];

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('supplier-invoice-recognition', {
		...evidence,
		fixtureScope: {
			projects: Object.values(SUPPLIER_PROJECTS).map((p) => p.code),
			invoicePrefix: 'E2E-SINV-',
			payablePrefix: 'E2E-SINV-PP-',
			months: [
				MONTH,
				INVOICE_MONTH,
				LATER_MONTH,
				FX_INVOICE.month,
				FX_UNSUPPORTED.month,
				FX_SPLIT.monthA,
				FX_SPLIT.monthB,
			],
		},
		createdThroughApp: { invoices: createdInvoices, payables: createdPayables },
	});
}

async function reconciliation(
	request: APIRequestContext,
	month: string
): Promise<ReconciliationData> {
	const params = new URLSearchParams({ view: 'expenditure', month });
	const response = await apiGet(
		request,
		`/api/reports/employee-project-monthly-cost?${params.toString()}`,
		API_HEADERS
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	expect(body.view).toBe('expenditure');
	return body.data as ReconciliationData;
}

async function drilldown(
	request: APIRequestContext,
	params: Record<string, string>
): Promise<DrilldownData> {
	const query = new URLSearchParams(params).toString();
	const response = await apiGet(
		request,
		`/api/reports/employee-project-monthly-cost/expenses?${query}`,
		API_HEADERS
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as DrilldownData;
}

async function supplierDetail(
	request: APIRequestContext,
	id: number
): Promise<{
	data: {
		id: number;
		cost_uid: string;
		recognition_state: string;
		financial_version: number;
		recognized_amount: number | null;
		splits: Array<{
			id: number;
			service_period_start: string | null;
			service_period_end: string;
			amount: number;
			tax_amount: number;
			recognized_amount: number | null;
		}>;
		links: Array<{
			cost_uid: string;
			source_table: string;
			source_id: string;
			role: string;
			basis: string;
			review_state: string;
		}>;
		link_candidates: Array<{
			source_table: string;
			source_id: string;
			reference_number: string;
			vendor_invoice_number: string | null;
			invoice_amount: number | null;
			cost_uid: string | null;
			match_basis: string;
		}>;
	};
}> {
	const response = await apiGet(
		request,
		`/api/admin/purchase-invoices/${id}`,
		API_HEADERS
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body;
}

async function command(
	request: APIRequestContext,
	id: number,
	payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await apiPost(
		request,
		`/api/admin/purchase-invoices/${id}/commands`,
		payload,
		API_HEADERS
	);
	return { status: response.status(), body: await response.json() };
}

function group(data: ReconciliationData, key: string): number {
	const found = data.company.groups.find((entry) => entry.key === key);
	expect(found, `group ${key}`).toBeTruthy();
	return found!.amount;
}

function sourceOf(data: ReconciliationData, source: string) {
	const found = data.sources.find((entry) => entry.source === source);
	expect(found, `source ${source}`).toBeTruthy();
	return found!;
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

/** Open the invoice's recognition dialog from the admin register. */
async function openRecognition(
	page: Page,
	invoiceNumber: string
): Promise<void> {
	await page.goto('/admin/purchase-invoice');
	const button = page.getByTestId(`recognition-open-${invoiceNumber}`);
	await expect(button).toBeVisible();
	await button.click();
	await expect(page.getByTestId('supplier-recognition-dialog')).toBeVisible();
}

test.beforeAll(async () => {
	seeded = await seedSupplierInvoiceFixtures();
	evidence.seeded = {
		invoices: seeded.invoices,
		projects: seeded.projects,
	};
});

test.afterAll(async () => {
	publish();
	for (const entry of createdPayables) {
		await exec(
			`DELETE FROM financial_cost_links WHERE source_table = 'payment_payables' AND source_id = ?`,
			[String(entry.id)]
		);
		await exec(`DELETE FROM payment_payables WHERE id = ?`, [entry.id]);
	}
	if (createdInvoices.length) {
		for (const entry of createdInvoices) {
			await exec(
				`DELETE FROM financial_cost_events WHERE source_table = 'purchase_invoices' AND source_id = ?`,
				[entry.id]
			);
			await exec(
				`DELETE FROM financial_cost_links WHERE source_table = 'purchase_invoices' AND source_id = ?`,
				[String(entry.id)]
			);
			await exec(`DELETE FROM supplier_invoice_periods WHERE invoice_id = ?`, [
				entry.id,
			]);
		}
		const ids = createdInvoices.map((entry) => entry.id);
		const placeholders = ids.map(() => '?').join(', ');
		await exec(
			`DELETE FROM purchase_invoices WHERE id IN (${placeholders})`,
			ids
		);
	}
	await cleanupSupplierInvoiceFixtures();
});

test('records and recognizes a supplier invoice through the admin controls', async ({
	page,
	request,
}) => {
	// Browser entry: the existing register form now captures the financial
	// identity fields (destination, service period, currency, tax, evidence).
	await page.goto('/admin/purchase-invoice');
	await page.getByRole('button', { name: 'Add Purchase Invoice' }).click();
	await page.locator('#invoice_number').fill(UI_INVOICE.number);
	await page.locator('#vendor_name').fill('E2E Supplier Vendor ui');
	await page.locator('#invoice_date').fill(UI_INVOICE.invoiceDate);
	await page
		.locator('#subtotal')
		.fill(String(UI_INVOICE.gross - UI_INVOICE.tax));
	await page.locator('#tax_amount').fill(String(UI_INVOICE.tax));
	await page.locator('#total').fill(String(UI_INVOICE.gross));
	await page.locator('#cost_classification').selectOption('project');
	await page.locator('button[aria-label="Project"]').click();
	await page.getByPlaceholder('Search...').fill(SUPPLIER_PROJECTS.alpha.code);
	await page
		.getByRole('button', {
			name: `${SUPPLIER_PROJECTS.alpha.code} — ${SUPPLIER_PROJECTS.alpha.title}`,
			exact: true,
		})
		.click();
	await page.locator('#service_period_start').fill(UI_INVOICE.serviceStart);
	await page.locator('#service_period_end').fill(UI_INVOICE.serviceEnd);
	await page.locator('#tax_treatment').selectOption('recoverable');
	await page.locator('#tax_evidence_reference').fill('E2E-SINV-GST-9001');
	await page.locator('#source_reference').fill(UI_INVOICE.sourceReference);
	await page.locator('#evidence_reference').fill('E2E-SINV-GRN-9001');
	await page.getByRole('button', { name: 'Create Purchase Invoice' }).click();
	await expect(page.getByText(UI_INVOICE.number)).toBeVisible();

	// The row persisted with its canonical identity, and starts unconfirmed.
	const persisted = await rows<{
		id: number;
		cost_uid: string;
		recognition_state: string;
		financial_version: number;
		recognition_period: string | null;
		period_basis: string;
		cost_classification: string;
		project_id: number;
		currency: string;
		total: string;
	}>(
		`SELECT id, cost_uid, recognition_state, financial_version, recognition_period,
            period_basis, cost_classification, project_id, currency, total
       FROM purchase_invoices WHERE invoice_number = ? AND isDelete = 0`,
		[UI_INVOICE.number]
	);
	expect(persisted).toHaveLength(1);
	const row = persisted[0];
	expect(row.cost_uid).toMatch(/^cost-/);
	expect(row.recognition_state).toBe('draft');
	expect(row.financial_version).toBe(1);
	expect(String(row.recognition_period).slice(0, 10)).toBe(`${MONTH}-01`);
	expect(row.period_basis).toBe('service_period');
	expect(row.cost_classification).toBe('project');
	expect(row.project_id).toBe(seeded.projects.alpha);
	expect(row.currency).toBe('INR');
	expect(Number(row.total)).toBe(UI_INVOICE.gross);
	createdInvoices.push({
		id: row.id,
		cost_uid: row.cost_uid,
		where: 'browser entry',
	});

	// Recognition through the dialog: submit, then recognize.
	await openRecognition(page, UI_INVOICE.number);
	await expect(page.getByTestId('recognition-state')).toHaveText(/draft/i);
	await page.getByTestId('recognition-submit').click();
	await expect(page.getByTestId('recognition-state')).toHaveText(
		/pending evidence/i
	);
	await page.getByTestId('recognition-recognize').click();
	await expect(page.getByTestId('recognition-state')).toHaveText(/recognized/i);
	await expect(
		page.getByTestId('recognition-recognized-amount')
	).toHaveAttribute('data-amount', String(UI_INVOICE.recognized));
	await page.getByTestId('recognition-close').click();

	// Persisted evidence: recognized at gross − evidenced tax, versioned, and
	// journaled with one row per command.
	const recognized = await rows<{
		recognition_state: string;
		recognized_amount: string;
		financial_version: number;
		recognized_by: number | null;
		recognized_at: string | null;
	}>(
		`SELECT recognition_state, recognized_amount, financial_version, recognized_by, recognized_at
       FROM purchase_invoices WHERE id = ?`,
		[row.id]
	);
	expect(recognized[0].recognition_state).toBe('recognized');
	expect(Number(recognized[0].recognized_amount)).toBe(UI_INVOICE.recognized);
	expect(recognized[0].financial_version).toBe(3);
	expect(recognized[0].recognized_by).toBeTruthy();
	expect(recognized[0].recognized_at).toBeTruthy();
	const journal = await rows<{ command: string; version: number }>(
		`SELECT command, version FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[row.cost_uid]
	);
	expect(journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'submitted',
		'recognized',
	]);
	expect(journal.map((entry) => Number(entry.version))).toEqual([1, 2, 3]);

	// The report states it once, in its service month, with the tax excluded.
	const march = await reconciliation(request, MONTH);
	const alpha = march.projects.find(
		(entry) => entry.project_code === SUPPLIER_PROJECTS.alpha.code
	);
	expect(alpha?.incurred_cost).toBe(MARCH_BEFORE_SPLIT.alpha);
	const supplier = sourceOf(march, 'supplier_invoice');
	expect(supplier.confirmed_amount).toBe(MARCH_BEFORE_SPLIT.total);
	expect(supplier.confirmed_count).toBe(MARCH_BEFORE_SPLIT.records);

	evidence.uiInvoice = {
		id: row.id,
		state: 'recognized',
		recognized: UI_INVOICE.recognized,
		version: recognized[0].financial_version,
		journal: journal.map((entry) => entry.command),
	};
});

test('splits one invoice across service periods without repeating it', async ({
	request,
}) => {
	// Create through the authenticated register API, as an operator would.
	const created = await apiPost(
		request,
		'/api/admin/purchase-invoices',
		{
			invoice_number: API_INVOICE.number,
			vendor_name: 'E2E Supplier Vendor api',
			invoice_date: '2020-04-20',
			subtotal: API_INVOICE.gross,
			tax_amount: 0,
			total: API_INVOICE.gross,
			currency: 'INR',
			cost_classification: 'project',
			project_id: seeded.projects.alpha,
			service_period_start: '2020-03-01',
			service_period_end: '2020-04-30',
			tax_treatment: 'none',
			source_reference: API_INVOICE.sourceReference,
			evidence_reference: 'E2E-SINV-GRN-9002',
			withholding_tax_amount: 0,
		},
		API_HEADERS
	);
	expect(created.status(), await created.text()).toBe(200);
	const createdBody = await created.json();
	const id = Number(createdBody.data.id);
	createdInvoices.push({
		id,
		cost_uid: createdBody.data.cost_uid,
		where: 'api entry',
	});

	// One split that does not total the invoice must not be recognizable: the
	// whole amount may not be repeated per period, and it may not silently
	// under-count either.
	const partial = await command(request, id, {
		command: 'update',
		expected_version: 1,
		patch: {
			splits: [
				{
					service_period_start: '2020-03-01',
					service_period_end: '2020-03-31',
					amount: API_INVOICE.march,
					tax_amount: 0,
					note: 'E2E March slice',
				},
			],
		},
	});
	expect(partial.status).toBe(200);
	const refused = await command(request, id, {
		command: 'recognize',
		expected_version: 2,
	});
	expect(refused.status, JSON.stringify(refused.body)).toBe(422);
	expect(refused.body.code).toBe('not_ready_for_recognition');
	expect(refused.body.missing).toContain('split_total_mismatch');

	// The complete split totals the invoice gross; recognition freezes the
	// slices and the cost lands in each service period.
	const updated = await command(request, id, {
		command: 'update',
		expected_version: 2,
		patch: {
			splits: [
				{
					service_period_start: '2020-03-01',
					service_period_end: '2020-03-31',
					amount: API_INVOICE.march,
					tax_amount: 0,
					note: 'E2E March slice',
				},
				{
					service_period_start: '2020-04-01',
					service_period_end: '2020-04-30',
					amount: API_INVOICE.april,
					tax_amount: 0,
					note: 'E2E April slice',
				},
			],
		},
	});
	expect(updated.status, JSON.stringify(updated.body)).toBe(200);
	const recognized = await command(request, id, {
		command: 'recognize',
		expected_version: 3,
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);
	const result = recognized.body.data as unknown as CommandResult;
	expect(result.recognized_amount).toBe(API_INVOICE.gross);
	expect(result.recognition_period).toBe(`${MONTH}-01`);

	const splits = await rows<{
		recognition_period: string;
		amount: string;
		recognized_amount: string | null;
	}>(
		`SELECT recognition_period, amount, recognized_amount
       FROM supplier_invoice_periods WHERE invoice_id = ? ORDER BY recognition_period`,
		[id]
	);
	expect(
		splits.map((entry) => String(entry.recognition_period).slice(0, 7))
	).toEqual([MONTH, INVOICE_MONTH]);
	expect(splits.map((entry) => Number(entry.amount))).toEqual([
		API_INVOICE.march,
		API_INVOICE.april,
	]);
	expect(splits.map((entry) => Number(entry.recognized_amount))).toEqual([
		API_INVOICE.march,
		API_INVOICE.april,
	]);

	// Each month counts only its own slice; neither counts the whole invoice.
	const march = await reconciliation(request, MONTH);
	const april = await reconciliation(request, INVOICE_MONTH);
	const marchAlpha = march.projects.find(
		(entry) => entry.project_code === SUPPLIER_PROJECTS.alpha.code
	);
	const aprilAlpha = april.projects.find(
		(entry) => entry.project_code === SUPPLIER_PROJECTS.alpha.code
	);
	expect(marchAlpha?.incurred_cost).toBe(MARCH.alpha);
	expect(aprilAlpha?.incurred_cost).toBe(APRIL.alpha);

	const marchDrill = await drilldown(request, { month: MONTH, state: 'all' });
	const splitRecords = marchDrill.records.filter(
		(entry) => entry.cost_uid === createdBody.data.cost_uid
	);
	expect(splitRecords).toHaveLength(1);
	expect(splitRecords[0].split).toEqual({
		id: expect.any(Number),
		index: 1,
		count: 2,
	});
	expect(splitRecords[0].recognized_amount).toBe(API_INVOICE.march);
	expect(splitRecords[0].gross_amount).toBe(API_INVOICE.march);

	const aprilDrill = await drilldown(request, {
		month: INVOICE_MONTH,
		state: 'all',
	});
	const aprilSlice = aprilDrill.records.filter(
		(entry) => entry.cost_uid === createdBody.data.cost_uid
	);
	expect(aprilSlice).toHaveLength(1);
	expect(aprilSlice[0].split).toEqual({
		id: expect.any(Number),
		index: 2,
		count: 2,
	});
	expect(aprilSlice[0].recognized_amount).toBe(API_INVOICE.april);

	// Independent database check: the split-aware sum of recognized supplier
	// cost for each month matches the report figure exactly.
	for (const [month, expected] of [
		[MONTH, MARCH_TOTAL],
		[INVOICE_MONTH, APRIL_TOTAL],
	] as const) {
		const monthRows = await rows<{ total: string; records: number }>(
			`SELECT COALESCE(SUM(CASE WHEN sp.id IS NULL THEN i.recognized_amount
                                ELSE sp.recognized_amount END), 0) AS total,
              COUNT(*) AS records
         FROM purchase_invoices i
         LEFT JOIN supplier_invoice_periods sp ON sp.invoice_id = i.id
        WHERE i.isDelete = 0 AND i.recognition_state = 'recognized'
          AND (
            (sp.id IS NULL AND i.recognition_period BETWEEN ? AND ?)
            OR (sp.id IS NOT NULL AND sp.recognition_period BETWEEN ? AND ?)
          )`,
			[`${month}-01`, `${month}-31`, `${month}-01`, `${month}-31`]
		);
		expect(Number(monthRows[0].total)).toBe(expected);
	}

	evidence.splits = {
		invoice: API_INVOICE.number,
		march: API_INVOICE.march,
		april: API_INVOICE.april,
		refusedMissing: refused.body.missing,
		recognized: result,
	};
});

test('freezes reverse-order and same-period splits onto their own rows', async ({
	request,
}) => {
	// One invoice, four slices: two in August and two in September, supplied to
	// the recognize command in a deliberately shuffled (reverse) order. Each
	// month and each row must hold its own amounts — a zip against request
	// order would silently move September's amount onto August's row.
	const slices = [
		{
			start: '2020-09-16',
			end: '2020-09-30',
			amount: 20000,
			month: '2020-09',
		},
		{
			start: '2020-08-01',
			end: '2020-08-15',
			amount: 10000,
			month: '2020-08',
		},
		{
			start: '2020-09-01',
			end: '2020-09-15',
			amount: 10000,
			month: '2020-09',
		},
		{
			start: '2020-08-16',
			end: '2020-08-31',
			amount: 20000,
			month: '2020-08',
		},
	] as const;
	const created = await apiPost(
		request,
		'/api/admin/purchase-invoices',
		{
			invoice_number: 'E2E-SINV-9006',
			vendor_name: 'E2E Supplier Vendor shuffled',
			invoice_date: '2020-09-05',
			subtotal: 60000,
			tax_amount: 0,
			total: 60000,
			currency: 'INR',
			cost_classification: 'project',
			project_id: seeded.projects.alpha,
			service_period_start: '2020-08-01',
			service_period_end: '2020-09-30',
			tax_treatment: 'none',
			source_reference: 'E2E-SINV-VENDOR-9006',
			evidence_reference: 'E2E-SINV-GRN-9006',
			withholding_tax_amount: 0,
		},
		API_HEADERS
	);
	expect(created.status(), await created.text()).toBe(200);
	const createdBody = await created.json();
	const id = Number(createdBody.data.id);
	createdInvoices.push({
		id,
		cost_uid: createdBody.data.cost_uid,
		where: 'api entry (shuffled splits)',
	});

	const recognized = await command(request, id, {
		command: 'recognize',
		expected_version: 1,
		patch: {
			splits: slices.map((slice) => ({
				service_period_start: slice.start,
				service_period_end: slice.end,
				amount: slice.amount,
				tax_amount: 0,
				note: `E2E ${slice.start}`,
			})),
		},
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);

	// Canonical order (month, then received-work start) with each row's own
	// frozen amounts.
	const sliceRows = await rows<{
		service_period_start: string;
		amount: string;
		recognized_amount: string;
		converted_amount: string;
	}>(
		`SELECT service_period_start, amount, recognized_amount, converted_amount
       FROM supplier_invoice_periods WHERE invoice_id = ?
      ORDER BY recognition_period, service_period_start`,
		[id]
	);
	expect(
		sliceRows.map((row) => String(row.service_period_start).slice(0, 10))
	).toEqual(['2020-08-01', '2020-08-16', '2020-09-01', '2020-09-16']);
	expect(sliceRows.map((row) => Number(row.amount))).toEqual([
		10000, 20000, 10000, 20000,
	]);
	expect(sliceRows.map((row) => Number(row.recognized_amount))).toEqual([
		10000, 20000, 10000, 20000,
	]);
	expect(sliceRows.map((row) => Number(row.converted_amount))).toEqual([
		10000, 20000, 10000, 20000,
	]);

	// The report reads each month's own slices (duplicate periods supported),
	// and the invoice states the full 60000 exactly once.
	for (const [month, expectedSlices] of [
		['2020-08', [10000, 20000]],
		['2020-09', [10000, 20000]],
	] as const) {
		const report = await reconciliation(request, month);
		const alpha = report.projects.find(
			(entry) => entry.project_code === SUPPLIER_PROJECTS.alpha.code
		);
		expect(alpha?.incurred_cost).toBe(expectedSlices[0] + expectedSlices[1]);

		const drill = await drilldown(request, { month, state: 'all' });
		const slicesInMonth = drill.records
			.filter((entry) => entry.cost_uid === createdBody.data.cost_uid)
			.sort((a, b) => (a.split?.index ?? 0) - (b.split?.index ?? 0));
		expect(slicesInMonth.map((entry) => entry.recognized_amount)).toEqual([
			...expectedSlices,
		]);
		expect(slicesInMonth.map((entry) => entry.split?.count)).toEqual([4, 4]);
	}
	const frozen = await rows<{
		recognized_amount: string;
		converted_amount: string;
	}>(
		`SELECT recognized_amount, converted_amount FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(Number(frozen[0].recognized_amount)).toBe(60000);
	expect(Number(frozen[0].converted_amount)).toBe(60000);

	evidence.shuffledSplits = {
		invoice: 'E2E-SINV-9006',
		requestOrder: slices.map((slice) => slice.start),
		frozenRows: sliceRows.map((row) => ({
			start: String(row.service_period_start).slice(0, 10),
			recognized: Number(row.recognized_amount),
		})),
	};
});

test('keeps a March service in March when invoiced in April and paid in May', async ({
	request,
}) => {
	const invoice = seededInvoice('septemberService');
	const marchBefore = await reconciliation(request, MONTH);

	// April holds no cost for the March service: the invoice month is evidence,
	// not the recognition period.
	const april = await reconciliation(request, INVOICE_MONTH);
	const aprilHasSeptember = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM purchase_invoices
      WHERE invoice_number = ? AND recognition_period BETWEEN ? AND ?`,
		[invoice.invoiceNumber, `${INVOICE_MONTH}-01`, `${INVOICE_MONTH}-31`]
	);
	expect(Number(aprilHasSeptember[0].count)).toBe(0);
	const aprilTotal = april.company.incurred_cost;
	expect(aprilTotal).toBe(APRIL_TOTAL);

	// Pay the payable in May; the settlement is not another expense.
	const payableId = seeded.payableIds.septemberPayable;
	const paid = await apiPut(
		request,
		`/api/admin/payment-payables/${payableId}`,
		{
			paid_amount: 50000,
			balance_due: 0,
			status: 'paid',
			paid_date: `${LATER_MONTH}-08`,
		},
		API_HEADERS
	);
	expect(paid.status(), await paid.text()).toBe(200);

	const marchAfter = await reconciliation(request, MONTH);
	expect(marchAfter.company.incurred_cost).toBe(MARCH_TOTAL);
	expect(marchBefore.company.incurred_cost).toBe(MARCH_TOTAL);
	const may = await reconciliation(request, LATER_MONTH);
	expect(may.company.incurred_cost).toBeNull();
	expect(may.company.record_count).toBe(0);
	expect(may.coverage.map((entry) => entry.code)).toContain(
		'no_recognized_cost'
	);
	// No cost row was created by the payment in any store.
	const mayCosts = await rows<{ invoices: number; expenses: number }>(
		`SELECT (SELECT COUNT(*) FROM purchase_invoices
              WHERE isDelete = 0 AND recognition_state = 'recognized'
                AND recognition_period BETWEEN ? AND ?) AS invoices,
            (SELECT COUNT(*) FROM expenses
              WHERE isDelete = 0 AND recognition_state = 'recognized'
                AND recognition_period BETWEEN ? AND ?) AS expenses`,
		[
			`${LATER_MONTH}-01`,
			`${LATER_MONTH}-31`,
			`${LATER_MONTH}-01`,
			`${LATER_MONTH}-31`,
		]
	);
	expect(Number(mayCosts[0].invoices)).toBe(0);
	expect(Number(mayCosts[0].expenses)).toBe(0);

	evidence.septemberInvoice = {
		invoice: invoice.invoiceNumber,
		recognitionPeriod: invoice.recognitionMonth,
		invoiceDate: invoice.invoiceDate,
		paidDate: `${LATER_MONTH}-08`,
		marchCost: MARCH.alpha,
		mayCost: null,
	};
});

test('links payable follow-ups and a receipt reference to one supplier cost', async ({
	page,
	request,
}) => {
	const invoice = seededInvoice('linkedCandidate');
	const invoiceId = seeded.invoiceIds.linkedCandidate;

	// The seeded explicit link is a confirmed mapping to the invoice's cost.
	const explicit = await rows<{ cost_uid: string | null }>(
		`SELECT cost_uid FROM payment_payables WHERE id = ?`,
		[seeded.payableIds.linkedPayable]
	);
	expect(explicit[0].cost_uid).toBe(invoice.costUid);
	const explicitLink = await rows<{ basis: string; review_state: string }>(
		`SELECT basis, review_state FROM financial_cost_links
      WHERE source_table = 'payment_payables' AND source_id = ? AND role = 'liability'`,
		[String(seeded.payableIds.linkedPayable)]
	);
	expect(explicitLink[0]).toEqual({
		basis: 'explicit',
		review_state: 'confirmed',
	});

	// The text match is preserved for review, not applied: it must not have
	// changed the payable's identity or the report total.
	const candidateBefore = await rows<{ cost_uid: string | null }>(
		`SELECT cost_uid FROM payment_payables WHERE id = ?`,
		[seeded.payableIds.candidatePayable]
	);
	expect(candidateBefore[0].cost_uid).toBeNull();
	const marchBefore = await reconciliation(request, MONTH);
	expect(marchBefore.company.incurred_cost).toBe(MARCH_TOTAL);

	// The invoice detail surfaces the candidate with its match basis.
	const detail = await supplierDetail(request, invoiceId);
	const candidate = detail.data.link_candidates.find(
		(entry) => entry.source_id === String(seeded.payableIds.candidatePayable)
	);
	expect(candidate, JSON.stringify(detail.data.link_candidates)).toBeTruthy();
	expect(candidate!.reference_number).toBe('E2E-SINV-PP-1013B');
	expect(candidate!.match_basis).toBe('vendor_invoice_number');

	// Confirm the mapping in the recognition dialog: the payable now points at
	// the same cost and still creates no second expense.
	await openRecognition(page, invoice.invoiceNumber);
	await page
		.getByTestId(`link-confirm-${seeded.payableIds.candidatePayable}`)
		.click();
	await expect(
		page.getByTestId(`link-confirm-${seeded.payableIds.candidatePayable}`)
	).toHaveCount(0);
	await page.getByTestId('recognition-close').click();

	const candidateAfter = await rows<{ cost_uid: string | null }>(
		`SELECT cost_uid FROM payment_payables WHERE id = ?`,
		[seeded.payableIds.candidatePayable]
	);
	expect(candidateAfter[0].cost_uid).toBe(invoice.costUid);
	const confirmedLink = await rows<{ basis: string; review_state: string }>(
		`SELECT basis, review_state FROM financial_cost_links
      WHERE source_table = 'payment_payables' AND source_id = ? AND role = 'liability'`,
		[String(seeded.payableIds.candidatePayable)]
	);
	expect(confirmedLink[0]).toEqual({
		basis: 'document',
		review_state: 'confirmed',
	});
	const marchAfter = await reconciliation(request, MONTH);
	expect(marchAfter.company.incurred_cost).toBe(MARCH_TOTAL);

	// A payable created with an explicit invoice reference migrates to the
	// authoritative cost, and the register refuses ad-hoc link rewrites.
	const createdPayable = await apiPost(
		request,
		'/api/admin/payment-payables',
		{
			vendor_name: 'E2E Supplier Vendor linked note',
			vendor_invoice_number: invoice.sourceReference,
			purchase_invoice_id: invoiceId,
			invoice_amount: 12000,
			balance_due: 12000,
			status: 'pending',
		},
		API_HEADERS
	);
	expect(createdPayable.status(), await createdPayable.text()).toBe(200);
	const createdPayableBody = await createdPayable.json();
	expect(createdPayableBody.data.cost_uid).toBe(invoice.costUid);
	createdPayables.push({
		id: Number(createdPayableBody.data.id),
		where: 'api',
	});

	const refusedRewrite = await apiPut(
		request,
		`/api/admin/payment-payables/${createdPayableBody.data.id}`,
		{ purchase_invoice_id: null },
		API_HEADERS
	);
	expect(refusedRewrite.status()).toBe(422);
	const refusedBody = await refusedRewrite.json();
	expect(refusedBody.code).toBe('link_change_requires_review');

	const marchLinked = await reconciliation(request, MONTH);
	expect(marchLinked.company.incurred_cost).toBe(MARCH_TOTAL);
	const supplierInvoices = await rows<{ count: number }>(
		`SELECT COUNT(*) AS count FROM purchase_invoices
      WHERE isDelete = 0 AND recognition_state = 'recognized'
        AND recognition_period BETWEEN ? AND ?`,
		[`${MONTH}-01`, `${MONTH}-31`]
	);
	expect(Number(supplierInvoices[0].count)).toBe(MARCH.records);

	evidence.payableLinks = {
		invoice: invoice.invoiceNumber,
		explicitPayable: seeded.payableIds.linkedPayable,
		confirmedCandidate: seeded.payableIds.candidatePayable,
		createdPayable: createdPayableBody.data,
		refusedRewrite: refusedBody,
		reportTotalAfterLinks: marchLinked.company.incurred_cost,
	};
});

test('reports approved tax treatment without assuming GST credit', async ({
	request,
}) => {
	const march = await reconciliation(request, MONTH);
	const april = await reconciliation(request, INVOICE_MONTH);

	// March: the only recoverable claim carries its evidence and is excluded.
	expect(march.company.gross_liability).toBe(MARCH.gross);
	expect(march.company.recoverable_tax).toBe(MARCH.recoverableTax);
	expect(march.company.incurred_cost).toBe(MARCH_TOTAL);
	expect(march.company.unresolved_tax.count).toBe(0);

	// April: an unresolved treatment and an unevidenced recoverable claim both
	// stay in cost at gross and stay visible as open tax.
	expect(april.company.incurred_cost).toBe(APRIL_TOTAL);
	expect(april.company.recoverable_tax).toBe(APRIL.recoverableTax);
	expect(april.company.unresolved_tax.count).toBe(APRIL.unresolvedTaxCount);
	expect(april.company.unresolved_tax.gross_amount).toBe(
		APRIL.unresolvedTaxGross
	);

	const noEvidence = await rows<{
		recognized_amount: string;
		tax_treatment: string;
		tax_evidence_reference: string | null;
	}>(
		`SELECT recognized_amount, tax_treatment, tax_evidence_reference
       FROM purchase_invoices WHERE invoice_number = ?`,
		[seededInvoice('recoverableNoEvidence').invoiceNumber]
	);
	expect(noEvidence[0].tax_treatment).toBe('recoverable');
	expect(noEvidence[0].tax_evidence_reference).toBeNull();
	expect(Number(noEvidence[0].recognized_amount)).toBe(59000);

	// Withholding is settlement-only: the invoice with TDS still counts its
	// gross-consistent cost, and the TDS stays on its own column.
	const withholding = await rows<{
		recognized_amount: string;
		withholding_tax_amount: string;
	}>(
		`SELECT recognized_amount, withholding_tax_amount FROM purchase_invoices
      WHERE invoice_number = ?`,
		[seededInvoice('linkedCandidate').invoiceNumber]
	);
	expect(Number(withholding[0].recognized_amount)).toBe(12000);
	expect(Number(withholding[0].withholding_tax_amount)).toBe(2000);

	evidence.tax = {
		march: {
			gross: march.company.gross_liability,
			recoverable: march.company.recoverable_tax,
			incurred: march.company.incurred_cost,
			unresolved: march.company.unresolved_tax,
		},
		april: {
			gross: april.company.gross_liability,
			recoverable: april.company.recoverable_tax,
			incurred: april.company.incurred_cost,
			unresolved: april.company.unresolved_tax,
		},
	};
});

test('captures and versions conversion evidence on a native supplier invoice', async ({
	request,
}) => {
	// Capture through the register API with the full original → reporting
	// evidence triple. The invoice is USD; its reporting target is INR.
	const created = await apiPost(
		request,
		'/api/admin/purchase-invoices',
		{
			invoice_number: FX_INVOICE.number,
			vendor_name: 'E2E Supplier Vendor fx',
			invoice_date: '2020-06-05',
			subtotal: FX_INVOICE.gross,
			tax_amount: 0,
			total: FX_INVOICE.gross,
			currency: 'USD',
			cost_classification: 'project',
			project_id: seeded.projects.alpha,
			service_period_start: '2020-06-05',
			service_period_end: '2020-06-05',
			tax_treatment: 'none',
			source_reference: FX_INVOICE.sourceReference,
			evidence_reference: 'E2E-SINV-GRN-9003',
			withholding_tax_amount: 0,
			reporting_currency: 'INR',
			conversion_rate: FX_INVOICE.rate,
			conversion_date: FX_INVOICE.rateDate,
			conversion_evidence_reference: FX_INVOICE.evidenceReference,
		},
		API_HEADERS
	);
	expect(created.status(), await created.text()).toBe(200);
	const createdBody = await created.json();
	const id = Number(createdBody.data.id);
	createdInvoices.push({
		id,
		cost_uid: createdBody.data.cost_uid,
		where: 'api entry (USD)',
	});

	const persisted = await rows<{
		currency: string;
		reporting_currency: string;
		conversion_rate: string;
		conversion_date: string;
		conversion_evidence_reference: string;
		converted_amount: string | null;
	}>(
		`SELECT currency, reporting_currency, conversion_rate, conversion_date,
            conversion_evidence_reference, converted_amount
       FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(persisted[0].currency).toBe('USD');
	expect(persisted[0].reporting_currency).toBe('INR');
	expect(Number(persisted[0].conversion_rate)).toBe(FX_INVOICE.rate);
	expect(String(persisted[0].conversion_date).slice(0, 10)).toBe(
		FX_INVOICE.rateDate
	);
	expect(persisted[0].conversion_evidence_reference).toBe(
		FX_INVOICE.evidenceReference
	);
	expect(persisted[0].converted_amount).toBeNull();

	// A contradictory or partial triple is refused and changes nothing.
	const notApplicable = await apiPost(
		request,
		'/api/admin/purchase-invoices',
		{
			invoice_number: 'E2E-SINV-9004-BAD',
			vendor_name: 'E2E Supplier Vendor fx',
			total: 100,
			currency: 'INR',
			reporting_currency: 'INR',
			conversion_rate: 2,
			conversion_date: FX_INVOICE.rateDate,
			conversion_evidence_reference: 'E2E-SINV-FX-BAD',
		},
		API_HEADERS
	);
	expect(notApplicable.status()).toBe(422);
	expect((await notApplicable.json()).code).toBe('conversion_not_applicable');
	const partial = await command(request, id, {
		command: 'update',
		expected_version: 1,
		patch: { conversion_date: null },
	});
	expect(partial.status, JSON.stringify(partial.body)).toBe(422);
	expect(partial.body.code).toBe('conversion_evidence_incomplete');
	const invalidRate = await command(request, id, {
		command: 'update',
		expected_version: 1,
		patch: {
			conversion_rate: 0,
			conversion_date: FX_INVOICE.rateDate,
			conversion_evidence_reference: FX_INVOICE.evidenceReference,
		},
	});
	expect(invalidRate.status).toBe(422);
	expect(invalidRate.body.code).toBe('invalid_conversion_rate');

	// The evidence itself is versioned: the rate change persists.
	const corrected = await command(request, id, {
		command: 'update',
		expected_version: 1,
		patch: {
			conversion_rate: FX_INVOICE.updatedRate,
			conversion_date: FX_INVOICE.rateDate,
			conversion_evidence_reference: FX_INVOICE.evidenceReference,
		},
	});
	expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
	const correctedRow = await rows<{
		conversion_rate: string;
		financial_version: number;
	}>(
		`SELECT conversion_rate, financial_version FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(Number(correctedRow[0].conversion_rate)).toBe(FX_INVOICE.updatedRate);
	expect(Number(correctedRow[0].financial_version)).toBe(2);

	// A rate is evidence for one currency pair: a convertible pair change
	// without a fresh triple is refused and nothing changes.
	const refusedPair = await command(request, id, {
		command: 'update',
		expected_version: 2,
		patch: { reporting_currency: 'EUR' },
	});
	expect(refusedPair.status, JSON.stringify(refusedPair.body)).toBe(422);
	expect(refusedPair.body.code).toBe('conversion_evidence_required');
	expect(refusedPair.body.fields).toContain('conversion_rate');
	const unchangedPair = await rows<{
		reporting_currency: string;
		conversion_rate: string | null;
		financial_version: number;
	}>(
		`SELECT reporting_currency, conversion_rate, financial_version
       FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(unchangedPair[0].reporting_currency).toBe('INR');
	expect(Number(unchangedPair[0].conversion_rate)).toBe(FX_INVOICE.updatedRate);
	expect(Number(unchangedPair[0].financial_version)).toBe(2);

	// The same pair change with a fresh, explicit triple is accepted and the
	// stored evidence is the new pair's, never the old one's.
	const repriced = await command(request, id, {
		command: 'update',
		expected_version: 2,
		patch: {
			reporting_currency: 'EUR',
			conversion_rate: FX_INVOICE.pairRate,
			conversion_date: FX_INVOICE.rateDate,
			conversion_evidence_reference: FX_INVOICE.evidenceReference,
		},
	});
	expect(repriced.status, JSON.stringify(repriced.body)).toBe(200);
	const repricedRow = await rows<{
		reporting_currency: string;
		conversion_rate: string | null;
		financial_version: number;
	}>(
		`SELECT reporting_currency, conversion_rate, financial_version
       FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(repricedRow[0].reporting_currency).toBe('EUR');
	expect(Number(repricedRow[0].conversion_rate)).toBe(FX_INVOICE.pairRate);
	expect(Number(repricedRow[0].financial_version)).toBe(3);
	const pairJournal = await rows<{
		reporting_currency: string;
		conversion_rate: string;
		conversion_evidence_reference: string;
	}>(
		`SELECT JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.reporting_currency')) AS reporting_currency,
            JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.conversion_rate')) AS conversion_rate,
            JSON_UNQUOTE(JSON_EXTRACT(snapshot, '$.conversion_evidence_reference')) AS conversion_evidence_reference
       FROM financial_cost_events WHERE cost_uid = ? AND version = 3`,
		[createdBody.data.cost_uid]
	);
	expect(pairJournal[0].reporting_currency).toBe('EUR');
	expect(Number(pairJournal[0].conversion_rate)).toBe(FX_INVOICE.pairRate);
	expect(pairJournal[0].conversion_evidence_reference).toBe(
		FX_INVOICE.evidenceReference
	);

	// A same-currency pair needs no conversion: the triple is cleared.
	const sameCurrency = await command(request, id, {
		command: 'update',
		expected_version: 3,
		patch: { reporting_currency: 'USD' },
	});
	expect(sameCurrency.status, JSON.stringify(sameCurrency.body)).toBe(200);
	const clearedRow = await rows<{
		reporting_currency: string;
		conversion_rate: string | null;
		conversion_date: string | null;
		conversion_evidence_reference: string | null;
		financial_version: number;
	}>(
		`SELECT reporting_currency, conversion_rate, conversion_date,
            conversion_evidence_reference, financial_version
       FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(clearedRow[0].reporting_currency).toBe('USD');
	expect(clearedRow[0].conversion_rate).toBeNull();
	expect(clearedRow[0].conversion_date).toBeNull();
	expect(clearedRow[0].conversion_evidence_reference).toBeNull();
	expect(Number(clearedRow[0].financial_version)).toBe(4);

	// Back to the INR basis with a fresh triple; recognition freezes it.
	const fresh = await command(request, id, {
		command: 'update',
		expected_version: 4,
		patch: {
			reporting_currency: 'INR',
			conversion_rate: FX_INVOICE.updatedRate,
			conversion_date: FX_INVOICE.rateDate,
			conversion_evidence_reference: FX_INVOICE.evidenceReference,
		},
	});
	expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
	const freshRow = await rows<{ conversion_rate: string }>(
		`SELECT conversion_rate FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(Number(freshRow[0].conversion_rate)).toBe(FX_INVOICE.updatedRate);

	// Recognition freezes the reporting-currency statement from that evidence.
	const recognized = await command(request, id, {
		command: 'recognize',
		expected_version: 5,
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);
	const frozen = await rows<{
		recognized_amount: string;
		converted_amount: string;
	}>(
		`SELECT recognized_amount, converted_amount FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(Number(frozen[0].recognized_amount)).toBe(FX_INVOICE.gross);
	expect(Number(frozen[0].converted_amount)).toBe(FX_INVOICE.converted);

	const report = await reconciliation(request, FX_INVOICE.month);
	expect(report.company.reporting_currency).toBe('INR');
	expect(report.company.conversion.status).toBe('converted');
	expect(report.company.incurred_cost).toBe(FX_INVOICE.converted);
	expect(report.company.currency_totals).toHaveLength(1);
	expect(report.company.currency_totals[0].currency).toBe('USD');
	expect(report.company.currency_totals[0].incurred_cost).toBe(
		FX_INVOICE.gross
	);
	expect(report.company.currency_totals[0].reporting.status).toBe('converted');
	expect(report.company.currency_totals[0].reporting.incurred_cost).toBe(
		FX_INVOICE.converted
	);

	const drill = await drilldown(request, {
		month: FX_INVOICE.month,
		state: 'all',
	});
	const record = drill.records.find(
		(entry) => entry.cost_uid === createdBody.data.cost_uid
	);
	expect(record, JSON.stringify(drill.records)).toBeTruthy();
	expect(record!.conversion_status).toBe('converted');
	expect(record!.converted_amount).toBe(FX_INVOICE.converted);

	evidence.conversion = {
		invoice: FX_INVOICE.number,
		currency: 'USD',
		reportingCurrency: 'INR',
		rate: FX_INVOICE.updatedRate,
		converted: FX_INVOICE.converted,
		pairChange: {
			refusedWithoutFreshTriple: 'conversion_evidence_required',
			repricedWithFreshTriple: repricedRow[0],
			sameCurrencyPairCleared: clearedRow[0],
			journal: pairJournal[0],
		},
		refusals: {
			notApplicable: 'conversion_not_applicable',
			partial: partial.body.code,
			invalidRate: invalidRate.body.code,
		},
	};
});

test('states a foreign supplier cost without evidence as unsupported', async ({
	request,
}) => {
	// A USD invoice recognized without conversion evidence: it keeps its own
	// currency total and is never given a guessed reporting-currency figure.
	const created = await apiPost(
		request,
		'/api/admin/purchase-invoices',
		{
			invoice_number: FX_UNSUPPORTED.number,
			vendor_name: 'E2E Supplier Vendor fx-unsupported',
			invoice_date: '2020-07-06',
			subtotal: FX_UNSUPPORTED.gross,
			tax_amount: 0,
			total: FX_UNSUPPORTED.gross,
			currency: 'USD',
			cost_classification: 'company_overhead',
			service_period_start: '2020-07-06',
			service_period_end: '2020-07-06',
			tax_treatment: 'none',
			source_reference: FX_UNSUPPORTED.sourceReference,
			evidence_reference: 'E2E-SINV-GRN-9005',
		},
		API_HEADERS
	);
	expect(created.status(), await created.text()).toBe(200);
	const createdBody = await created.json();
	const id = Number(createdBody.data.id);
	createdInvoices.push({
		id,
		cost_uid: createdBody.data.cost_uid,
		where: 'api entry (USD, no evidence)',
	});
	const recognized = await command(request, id, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);

	const report = await reconciliation(request, FX_UNSUPPORTED.month);
	expect(report.company.conversion.status).toBe('unsupported');
	expect(report.company.currency).toBe('USD');
	expect(report.company.incurred_cost).toBe(FX_UNSUPPORTED.gross);
	expect(report.company.currency_totals).toHaveLength(1);
	expect(report.company.currency_totals[0].reporting.status).toBe(
		'unsupported'
	);
	expect(report.company.currency_totals[0].reporting.incurred_cost).toBeNull();

	const stored = await rows<{ converted_amount: string | null }>(
		`SELECT converted_amount FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(stored[0].converted_amount).toBeNull();

	evidence.unsupported = {
		invoice: FX_UNSUPPORTED.number,
		currency: 'USD',
		incurred: report.company.incurred_cost,
		reportingIncurred:
			report.company.currency_totals[0].reporting.incurred_cost,
	};
});

test('reconciles a converted multi-period invoice by per-slice rounding', async ({
	request,
}) => {
	// Capture a USD invoice with two service-period slices and full evidence.
	const created = await apiPost(
		request,
		'/api/admin/purchase-invoices',
		{
			invoice_number: FX_SPLIT.number,
			vendor_name: 'E2E Supplier Vendor fx-split',
			invoice_date: `${FX_SPLIT.monthA}-05`,
			subtotal: 100,
			tax_amount: 0,
			total: 100,
			currency: 'USD',
			cost_classification: 'project',
			project_id: seeded.projects.beta,
			service_period_start: FX_SPLIT.slices[0].start,
			service_period_end: FX_SPLIT.slices[1].end,
			tax_treatment: 'none',
			source_reference: FX_SPLIT.sourceReference,
			evidence_reference: 'E2E-SINV-GRN-9005',
			withholding_tax_amount: 0,
			reporting_currency: 'INR',
			conversion_rate: FX_SPLIT.rate,
			conversion_date: FX_SPLIT.rateDate,
			conversion_evidence_reference: FX_SPLIT.evidenceReference,
			splits: FX_SPLIT.slices.map((slice) => ({
				service_period_start: slice.start,
				service_period_end: slice.end,
				amount: Number(slice.amount),
				tax_amount: 0,
				note: `E2E slice ${slice.start}`,
			})),
		},
		API_HEADERS
	);
	expect(created.status(), await created.text()).toBe(200);
	const createdBody = await created.json();
	const id = Number(createdBody.data.id);
	createdInvoices.push({
		id,
		cost_uid: createdBody.data.cost_uid,
		where: 'api entry (USD, split, converted)',
	});

	const recognized = await command(request, id, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(recognized.status, JSON.stringify(recognized.body)).toBe(200);

	// The frozen invoice statement is the per-slice conversion sum, so it
	// agrees with the report's per-record rounding to the cent.
	const frozen = await rows<{
		recognized_amount: string;
		converted_amount: string;
	}>(
		`SELECT recognized_amount, converted_amount FROM purchase_invoices WHERE id = ?`,
		[id]
	);
	expect(Number(frozen[0].recognized_amount)).toBe(100);
	expect(Number(frozen[0].converted_amount)).toBe(FX_SPLIT.convertedTotal);

	const sliceRows = await rows<{
		recognized_amount: string;
		converted_amount: string;
	}>(
		`SELECT recognized_amount, converted_amount
       FROM supplier_invoice_periods WHERE invoice_id = ?
      ORDER BY recognition_period`,
		[id]
	);
	expect(sliceRows.map((row) => Number(row.recognized_amount))).toEqual([
		33.33, 66.67,
	]);
	expect(sliceRows.map((row) => Number(row.converted_amount))).toEqual([
		FX_SPLIT.slices[0].converted,
		FX_SPLIT.slices[1].converted,
	]);

	for (const [month, slice] of [
		[FX_SPLIT.monthA, FX_SPLIT.slices[0]],
		[FX_SPLIT.monthB, FX_SPLIT.slices[1]],
	] as const) {
		const report = await reconciliation(request, month);
		expect(report.company.conversion.status).toBe('converted');
		expect(report.company.incurred_cost).toBe(slice.converted);
		expect(report.company.currency_totals[0].currency).toBe('USD');
		expect(report.company.currency_totals[0].incurred_cost).toBe(
			Number(slice.amount)
		);
		expect(report.company.currency_totals[0].reporting.incurred_cost).toBe(
			slice.converted
		);

		const drill = await drilldown(request, { month, state: 'all' });
		const record = drill.records.find(
			(entry) => entry.cost_uid === createdBody.data.cost_uid
		);
		expect(record, JSON.stringify(drill.records)).toBeTruthy();
		expect(record!.conversion_status).toBe('converted');
		expect(record!.converted_amount).toBe(slice.converted);
	}

	evidence.convertedSplit = {
		invoice: FX_SPLIT.number,
		slices: FX_SPLIT.slices.map((slice) => ({
			amount: slice.amount,
			converted: slice.converted,
		})),
		frozenInvoiceConverted: Number(frozen[0].converted_amount),
		frozenSliceConverted: sliceRows.map((row) => Number(row.converted_amount)),
	};
});

test('excludes pending, rejected, cancelled, draft and unresolved records', async ({
	request,
}) => {
	const march = await reconciliation(request, MONTH);
	expect(march.company.incurred_cost).toBe(MARCH_TOTAL);
	expect(march.company.record_count).toBe(MARCH.records);
	expect(march.evidence.pending_evidence.count).toBe(
		MARCH.pendingEvidenceCount
	);
	expect(march.evidence.pending_evidence.amount).toBe(
		MARCH.pendingEvidenceGross
	);
	expect(march.evidence.draft.count).toBe(MARCH.draftCount);
	expect(march.evidence.rejected.count).toBe(MARCH.rejectedCount);
	expect(march.evidence.cancelled.count).toBe(MARCH.cancelledCount);
	expect(march.evidence.unresolved_classification.count).toBe(
		MARCH.unresolvedClassificationCount
	);
	expect(march.evidence.unresolved_classification.gross_amount).toBe(
		MARCH.unresolvedClassificationGross
	);

	// The source section counts the supplier source separately, so the company
	// total can never silently depend on which store a cost lives in.
	const supplier = sourceOf(march, 'supplier_invoice');
	expect(supplier.confirmed_amount).toBe(MARCH_TOTAL);
	expect(supplier.pending_count).toBe(MARCH.pendingCount);
	expect(supplier.pending_amount).toBe(MARCH.pendingGross);
	expect(supplier.currency).toBe('INR');
	const direct = sourceOf(march, 'direct_expense');
	expect(direct.confirmed_amount).toBe(0);

	// Drilldown states address exactly the non-confirmed rows.
	const rejected = await drilldown(request, {
		month: MONTH,
		state: 'rejected',
	});
	expect(rejected.records.map((entry) => entry.expense_number)).toEqual([
		seededInvoice('rejected').invoiceNumber,
	]);
	const cancelled = await drilldown(request, {
		month: MONTH,
		state: 'cancelled',
	});
	expect(cancelled.records.map((entry) => entry.expense_number)).toEqual([
		seededInvoice('cancelled').invoiceNumber,
	]);
	const draft = await drilldown(request, { month: MONTH, state: 'draft' });
	expect(draft.records.map((entry) => entry.expense_number)).toEqual([
		seededInvoice('draft').invoiceNumber,
	]);
	const pending = await drilldown(request, {
		month: MONTH,
		state: 'pending_evidence',
	});
	expect(pending.records.map((entry) => entry.expense_number).sort()).toEqual(
		[
			seededInvoice('pending').invoiceNumber,
			seededInvoice('unresolvedClassification').invoiceNumber,
		].sort()
	);
	const unresolved = await drilldown(request, {
		month: MONTH,
		classification: 'unresolved',
	});
	expect(
		unresolved.records.map((entry) => entry.expense_number).sort()
	).toEqual(
		[
			seededInvoice('unresolvedClassification').invoiceNumber,
			seededInvoice('draft').invoiceNumber,
		].sort()
	);
	for (const record of [
		...rejected.records,
		...cancelled.records,
		...draft.records,
	]) {
		expect(record.recognition_state).not.toBe('recognized');
		expect(record.recognized_amount).toBeNull();
	}
	expect(march.company.incurred_cost).toBe(MARCH_TOTAL);

	// A standalone invoice with only a free-text PO number recognized normally,
	// and the number stayed descriptive: no order identity was invented and its
	// only link row is its own cost identity.
	const noPo = await rows<{
		po_number: string;
		po_id: number | null;
		cost_uid: string;
	}>(`SELECT po_number, po_id, cost_uid FROM purchase_invoices WHERE id = ?`, [
		seeded.invoiceIds.noPurchaseOrder,
	]);
	expect(noPo[0].po_number).toBe('E2E-SINV-PO-FREE-1003');
	expect(noPo[0].po_id).toBeNull();
	const noPoLinks = await rows<{ role: string; source_table: string }>(
		`SELECT role, source_table FROM financial_cost_links WHERE cost_uid = ?`,
		[noPo[0].cost_uid]
	);
	expect(noPoLinks).toEqual([
		{ role: 'cost', source_table: 'purchase_invoices' },
	]);
	const noPoDrill = await drilldown(request, {
		month: MONTH,
		state: 'recognized',
	});
	expect(
		noPoDrill.records.some(
			(entry) =>
				entry.expense_number === seededInvoice('noPurchaseOrder').invoiceNumber
		)
	).toBe(true);

	evidence.states = {
		evidence: march.evidence,
		rejected: rejected.records.map((entry) => entry.expense_number),
		cancelled: cancelled.records.map((entry) => entry.expense_number),
		draft: draft.records.map((entry) => entry.expense_number),
	};
});

test('refuses recognition to unapproved and unauthorized identities', async ({
	playwright,
	request,
	baseURL,
}) => {
	// The login fixtures need the configured base URL; the Playwright option
	// is typed optional, so fail before any work when it is unset.
	if (!baseURL) {
		throw new Error('The E2E run is missing its configured baseURL');
	}

	// Error outcomes for a stale version and an unknown command (admin).
	const invoice = seededInvoice('pending');
	const stale = await command(request, seeded.invoiceIds.pending, {
		command: 'recognize',
		expected_version: 99,
	});
	expect(stale.status).toBe(409);
	expect(stale.body.code).toBe('version_conflict');
	const invalid = await command(request, seeded.invoiceIds.pending, {
		command: 'explode',
		expected_version: 1,
	});
	expect(invalid.status).toBe(400);
	expect(invalid.body.code).toBe('invalid_command');
	const noVersion = await command(request, seeded.invoiceIds.pending, {
		command: 'recognize',
	});
	expect(noVersion.status).toBe(400);
	expect(noVersion.body.code).toBe('version_required');
	const noReason = await command(request, seeded.invoiceIds.pending, {
		command: 'reject',
		expected_version: 1,
	});
	expect(noReason.status).toBe(422);
	expect(noReason.body.code).toBe('reason_required');
	// None of the failed commands changed the row.
	const unchanged = await rows<{
		recognition_state: string;
		financial_version: number;
	}>(
		`SELECT recognition_state, financial_version FROM purchase_invoices WHERE id = ?`,
		[seeded.invoiceIds.pending]
	);
	expect(unchanged[0]).toEqual({
		recognition_state: 'pending_evidence',
		financial_version: 1,
	});

	// The editor may read and update but not recognize: approval privilege is
	// separate from the source register privilege.
	const editor = await loginSupplierEditor(playwright, baseURL);
	try {
		const editorRecognize = await editor.post(
			`/api/admin/purchase-invoices/${seeded.invoiceIds.pending}/commands`,
			{ data: { command: 'recognize', expected_version: 1 } }
		);
		expect(editorRecognize.status()).toBe(403);
		// Repricing conversion evidence is also an approval act.
		const editorReprice = await editor.post(
			`/api/admin/purchase-invoices/${seeded.invoiceIds.pending}/commands`,
			{
				data: {
					command: 'update',
					expected_version: 1,
					patch: { conversion_rate: 80 },
				},
			}
		);
		expect(editorReprice.status()).toBe(403);
		// A currency-only patch is the same approval act and cannot bypass it.
		const editorCurrency = await editor.post(
			`/api/admin/purchase-invoices/${seeded.invoiceIds.pending}/commands`,
			{
				data: {
					command: 'update',
					expected_version: 1,
					patch: { currency: 'EUR' },
				},
			}
		);
		expect(editorCurrency.status()).toBe(403);
		const stillPending = await rows<{ recognition_state: string }>(
			`SELECT recognition_state FROM purchase_invoices WHERE id = ?`,
			[seeded.invoiceIds.pending]
		);
		expect(stillPending[0].recognition_state).toBe('pending_evidence');
	} finally {
		await editor.dispose();
	}

	// A reader with neither the report source privilege nor supplier access
	// gets no sensitive values and no writes.
	const reader = await loginSupplierReportsOnly(playwright, baseURL);
	try {
		const reportView = await reader.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${MONTH}`
		);
		expect(reportView.status()).toBe(403);
		const reportText = await reportView.text();
		expect(reportText).not.toContain('E2E-SINV');
		const drill = await reader.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${MONTH}`
		);
		expect(drill.status()).toBe(403);
		const register = await reader.get('/api/admin/purchase-invoices');
		expect(register.status()).toBe(403);
		const denyCommand = await reader.post(
			`/api/admin/purchase-invoices/${seeded.invoiceIds.pending}/commands`,
			{ data: { command: 'recognize', expected_version: 1 } }
		);
		expect(denyCommand.status()).toBe(403);
		const denyCreate = await reader.post('/api/admin/purchase-invoices', {
			data: { vendor_name: 'E2E Supplier Vendor denied' },
		});
		expect(denyCreate.status()).toBe(403);
	} finally {
		await reader.dispose();
	}

	evidence.authorization = {
		editorRecognize: 403,
		readerReport: 403,
		readerDrilldown: 403,
		readerRegister: 403,
		refusals: {
			stale: stale.body.code,
			invalid: invalid.body.code,
			versionRequired: noVersion.body.code,
			reasonRequired: noReason.body.code,
		},
	};
});

test('shows the supplier figures through the report browser controls', async ({
	page,
	request,
}) => {
	await openExpenditure(page, MONTH_LABEL);
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(MARCH_TOTAL);
	expect(await kpi(page, 'kpi-project-cost')).toBe(MARCH_PROJECT);
	expect(await kpi(page, 'kpi-overhead')).toBe(MARCH.overhead);
	expect(await kpi(page, 'kpi-unallocated')).toBe(MARCH.unallocated);

	const alpha = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${SUPPLIER_PROJECTS.alpha.code}"]`
	);
	await expect(alpha).toBeVisible();
	expect(await alpha.getAttribute('data-project-cost')).toBe(
		String(MARCH.alpha)
	);
	const beta = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${SUPPLIER_PROJECTS.beta.code}"]`
	);
	await expect(beta).toBeVisible();
	expect(await beta.getAttribute('data-project-cost')).toBe(String(MARCH.beta));

	// Expanding the Project lists the supplier source document behind the cost.
	await alpha.getByTestId('project-expand').click();
	await expect(
		page.locator(
			`[data-testid="drilldown-record"][data-source-reference="E2E-SINV-VENDOR-1002"]`
		)
	).toBeVisible();

	// April shows only April's slices and costs.
	await openExpenditure(page, INVOICE_MONTH_LABEL);
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(APRIL_TOTAL);

	const data = await reconciliation(request, MONTH);
	expect(data.coverage.map((entry) => entry.code)).not.toContain(
		'supplier_source_not_incorporated'
	);

	evidence.browser = {
		march: {
			incurred: MARCH_TOTAL,
			project: MARCH_PROJECT,
			overhead: MARCH.overhead,
			unallocated: MARCH.unallocated,
		},
		april: { incurred: APRIL_TOTAL },
		coverage: data.coverage.map((entry) => entry.code),
	};
});

test('publishes the repeatable evidence artifact', async () => {
	publish();
	const artifact = readArtifact('supplier-invoice-recognition');
	expect(artifact.flow).toBe('supplier-invoice-recognition');
	expect(artifact.ok).toBe(true);
	expect(artifact.generatedAt).toBeTruthy();
	const fixtureScope = artifact.fixtureScope as { months: string[] };
	expect(fixtureScope.months).toEqual([
		MONTH,
		INVOICE_MONTH,
		LATER_MONTH,
		FX_INVOICE.month,
		FX_UNSUPPORTED.month,
		FX_SPLIT.monthA,
		FX_SPLIT.monthB,
	]);
	const created = artifact.createdThroughApp as {
		invoices: Array<{ id: number }>;
	};
	expect(created.invoices.length).toBe(6);
});
