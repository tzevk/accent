import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';
import {
	ACCRUAL_FINAL_MONTH,
	ACCRUAL_INVOICE_PREFIX,
	ACCRUAL_MONTH,
	ACCRUAL_NUMBER_PREFIX,
	ACCRUAL_PARTIAL_MONTH,
	ACCRUAL_PROJECTS,
	cleanupCostAccrualFixtures,
	loginAccrualEditor,
	loginAccrualReportsOnly,
	seedCostAccrualFixtures,
	seededAccrual,
	seededAccrualInvoice,
	type SeededCostAccruals,
} from '../lib/cost-accrual-fixtures';

/**
 * Ticket #313 — evidenced Cost Accruals and partial/final invoice replacement.
 *
 * Every expected amount is stated here from the fixture literals and the
 * business rules, never from the report module's own aggregation. The fixture
 * rows state what each accrual and invoice is worth; this file states what the
 * reconciliation must show, then compares the app's answer with that
 * arithmetic and re-checks the rows in the database independently.
 *
 * Reserved scope: months 2018-07..2018-09, projects `E2E-ACCR-P*`, accrual and
 * invoice prefixes, and its own fixture identities. No other spec seeds there.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.112' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = ACCRUAL_MONTH;
const PARTIAL_MONTH = ACCRUAL_PARTIAL_MONTH;
const FINAL_MONTH = ACCRUAL_FINAL_MONTH;

/** The accrual the browser captures and recognizes in July. */
const UI_ACCRUAL = {
	description: 'E2E-ACCR received work UI (59000 gross, 9000 recoverable tax)',
	gross: 59000,
	tax: 9000,
	recognized: 50000,
	serviceStart: '2018-07-01',
	serviceEnd: '2018-07-31',
	sourceReference: 'E2E-ACCR-UI-SRC-9006',
	evidenceReference: 'E2E-ACCR-UI-EV-9006',
	taxEvidence: 'E2E-ACCR-UI-TAX-9006',
} as const;

interface ReconciliationData {
	month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{
			currency: string;
			incurred_project_cost: number;
			incurred_cost: number;
			record_count: number;
		}>;
		groups: Array<{ key: string; amount: number; record_count: number }>;
		record_count: number;
	};
	projects: Array<{
		project_id: number;
		project_code: string;
		currency: string;
		incurred_cost: number;
		record_count: number;
		previous_period_cost: number | null;
		change_amount: number | null;
		cost_to_date: number | null;
	}>;
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
	expense_number: string;
	recognition_state: string;
	recognition_period: string | null;
	currency: string | null;
	gross_amount: number | null;
	recognized_amount: number | null;
	source_reference: string | null;
	project_code: string | null;
	financial_version: number;
	accrual: {
		evidence_basis: string;
		order_uid: string | null;
		owner_user_id: number | null;
		replaced_amount: number;
		remaining_amount: number | null;
		replacement_count: number;
	} | null;
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

let seeded: SeededCostAccruals;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
/** Rows this spec records through the app, so the run leaves nothing behind. */
const createdAccruals: Array<{ id: number; cost_uid: string; where: string }> =
	[];
const createdReplacements: Array<{
	accrual_id: number;
	invoice_id: number;
	where: string;
}> = [];

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('cost-accruals', {
		...evidence,
		fixtureScope: {
			projects: Object.values(ACCRUAL_PROJECTS).map((p) => p.code),
			accrualPrefix: ACCRUAL_NUMBER_PREFIX,
			invoicePrefix: ACCRUAL_INVOICE_PREFIX,
			months: [MONTH, PARTIAL_MONTH, FINAL_MONTH],
		},
		createdThroughApp: {
			accruals: createdAccruals,
			replacements: createdReplacements,
		},
	});
}

async function reconciliation(
	request: APIRequestContext,
	month: string
): Promise<ReconciliationData> {
	const params = new URLSearchParams({ view: 'expenditure', month });
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost?${params.toString()}`
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

async function captureAccrual(
	request: APIRequestContext,
	payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await request.post('/api/admin/cost-accruals', {
		data: payload,
	});
	return { status: response.status(), body: await response.json() };
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

async function accrualDetail(
	request: APIRequestContext,
	id: number
): Promise<{
	status: number;
	data: {
		id: number;
		accrual_number: string;
		cost_uid: string;
		recognition_state: string;
		financial_version: number;
		recognized_amount: number | null;
		replaced_amount: number;
		evidence_basis: string;
		owner_user_id: number | null;
		replacements: Array<{
			id: number;
			invoice_id: number;
			invoice_cost_uid: string;
			replaced_amount: number;
			invoice_amount: number | null;
			difference_amount: number;
			difference_period: string | null;
			difference_reason: string | null;
			evidence_reference: string | null;
			state: string;
			is_final: number | boolean;
			release_reason: string | null;
		}>;
		links: Array<{
			cost_uid: string;
			source_table: string;
			source_id: string;
			role: string;
			basis: string;
			review_state: string;
		}>;
		replacement_candidates: Array<{
			invoice_id: number;
			invoice_number: string;
			cost_uid: string;
			recognized_amount: number | null;
			financial_version: number;
		}>;
	};
}> {
	const response = await request.get(`/api/admin/cost-accruals/${id}`);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return { status: response.status(), data: body.data };
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

function projectRow(data: ReconciliationData, code: string) {
	const found = data.projects.find((row) => row.project_code === code);
	expect(found, `project row ${code}`).toBeTruthy();
	return found!;
}

function sourceOf(data: ReconciliationData, source: string) {
	const found = data.sources.find((entry) => entry.source === source);
	expect(found, `source ${source}`).toBeTruthy();
	return found!;
}

/** Open the admin accrual register and the capture form. */
async function openAccrualCapture(page: Page): Promise<void> {
	await page.goto('/admin/cost-accrual');
	await page.getByTestId('accrual-capture-open').click();
	await expect(page.getByTestId('accrual-capture-form')).toBeVisible();
}

/** Open an accrual's recognition dialog from the admin register. */
async function openAccrualDialog(
	page: Page,
	accrualNumber: string
): Promise<void> {
	await page.goto('/admin/cost-accrual');
	const button = page.getByTestId(`accrual-open-${accrualNumber}`);
	await expect(button).toBeVisible();
	await button.click();
	await expect(page.getByTestId('accrual-recognition-dialog')).toBeVisible();
}

/** Open the report on the expenditure view for one month. */
async function openExpenditure(page: Page, month: string): Promise<void> {
	const [year, monthNumber] = month.split('-').map(Number);
	const label = `${new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString(
		'en-US',
		{ month: 'long', timeZone: 'UTC' }
	)} ${year}`;
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(label);
	await page.getByRole('button', { name: label, exact: true }).click();
}

async function kpi(page: Page, testId: string): Promise<number> {
	await expect(page.getByTestId(testId)).toBeVisible();
	const raw = await page.getByTestId(testId).getAttribute('data-amount');
	return Number(raw);
}

test.beforeAll(async () => {
	seeded = await seedCostAccrualFixtures();
	evidence.seeded = {
		accruals: seeded.accruals,
		invoices: seeded.invoices,
		projects: seeded.projects,
	};
});

test.afterAll(async () => {
	publish();
	for (const entry of createdReplacements) {
		await exec(
			`DELETE FROM cost_accrual_replacements WHERE accrual_id = ? AND invoice_id = ?`,
			[entry.accrual_id, entry.invoice_id]
		);
	}
	for (const entry of createdAccruals) {
		await exec(
			`DELETE FROM financial_cost_events WHERE source_table = 'cost_accruals' AND source_id = ?`,
			[entry.id]
		);
		await exec(
			`DELETE FROM financial_cost_links WHERE source_table = 'cost_accruals' AND source_id = ?`,
			[String(entry.id)]
		);
	}
	if (createdAccruals.length) {
		const ids = createdAccruals.map((entry) => entry.id);
		const placeholders = ids.map(() => '?').join(', ');
		await exec(`DELETE FROM cost_accruals WHERE id IN (${placeholders})`, ids);
	}
	await cleanupCostAccrualFixtures();
});

test('seeded accruals are counted once in July, drafts and pending never are', async ({
	request,
}) => {
	const july = await reconciliation(request, MONTH);
	// a1 100000 + a2 100000 + a5 40000, all Project alpha, all INR.
	expect(july.company.incurred_cost).toBe(240000);
	expect(projectRow(july, ACCRUAL_PROJECTS.alpha.code).incurred_cost).toBe(
		240000
	);
	// August already states every recognized invoice (i1 60000 + i3 80000 +
	// i4 30000 + i5 10000): the invoice is authoritative cost from
	// recognition, so replacement linkage later moves July only.
	const august = await reconciliation(request, PARTIAL_MONTH);
	expect(august.company.incurred_cost).toBe(180000);
	// The seeded Project accruals carry their Project identity in the database,
	// so the report's Project cost can attribute them to alpha.
	const seededProjectRows = await rows<{ project_id: number }>(
		`SELECT project_id FROM cost_accruals
      WHERE accrual_number LIKE ? AND cost_classification = 'project' AND isDelete = 0`,
		[`${ACCRUAL_NUMBER_PREFIX}%`]
	);
	expect(seededProjectRows.length).toBeGreaterThanOrEqual(6);
	for (const row of seededProjectRows) {
		expect(Number(row.project_id)).toBe(seeded.projects.alpha);
	}
	const accrualSource = sourceOf(july, 'cost_accrual');
	expect(accrualSource.confirmed_amount).toBe(240000);
	expect(accrualSource.confirmed_count).toBe(3);
	// a3 (pending evidence) + a4 (draft) are review-queue rows, not cost.
	expect(accrualSource.pending_count).toBe(2);
	expect(accrualSource.pending_amount).toBe(75000);

	// The PO-balance accrual cannot become cost: an unused PO balance is not
	// evidence of received work.
	const poRefusal = await accrualCommand(request, seeded.accrualIds.a4, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(poRefusal.status, JSON.stringify(poRefusal.body)).toBe(422);
	expect(poRefusal.body.code).toBe('po_balance_not_evidence');
	// The pending-evidence accrual is refused for its missing evidence.
	const evidenceRefusal = await accrualCommand(request, seeded.accrualIds.a3, {
		command: 'recognize',
		expected_version: 1,
	});
	expect(evidenceRefusal.status, JSON.stringify(evidenceRefusal.body)).toBe(
		422
	);
	expect(evidenceRefusal.body.code).toBe('not_ready_for_recognition');
	expect(evidenceRefusal.body.missing).toContain('evidence_reference');

	// Capturing with a PO balance as its basis is refused at the source.
	const captureRefusal = await captureAccrual(request, {
		description: 'E2E-ACCR PO balance must be refused',
		evidence_basis: 'purchase_order',
		gross_amount: 1000,
		service_period_start: '2018-07-01',
		service_period_end: '2018-07-31',
		cost_classification: 'project',
		project_id: seeded.projects.alpha,
		currency: 'INR',
		source_reference: 'E2E-ACCR-PO-REFUSED',
	});
	expect(captureRefusal.status, JSON.stringify(captureRefusal.body)).toBe(422);
	expect(captureRefusal.body.code).toBe('po_balance_not_evidence');
	evidence.seededRefusals = {
		poBalance: poRefusal.body.code,
		pendingEvidence: evidenceRefusal.body.code,
		capturePoBalance: captureRefusal.body.code,
	};
});

test('captures and recognizes an accrual through the admin browser controls', async ({
	page,
	request,
}) => {
	await openAccrualCapture(page);
	await page.getByTestId('accrual-description').fill(UI_ACCRUAL.description);
	await page.getByTestId('accrual-vendor').fill('E2E Accrual Vendor UI');
	await page
		.getByTestId('accrual-evidence-basis')
		.selectOption('received_work');
	await page.getByTestId('accrual-service-start').fill(UI_ACCRUAL.serviceStart);
	await page.getByTestId('accrual-service-end').fill(UI_ACCRUAL.serviceEnd);
	await page.getByTestId('accrual-classification').selectOption('project');
	await page
		.getByTestId('accrual-project')
		.selectOption(String(seeded.projects.alpha));
	await page.getByTestId('accrual-gross').fill(String(UI_ACCRUAL.gross));
	await page.getByTestId('accrual-tax').fill(String(UI_ACCRUAL.tax));
	await page.getByTestId('accrual-tax-treatment').selectOption('recoverable');
	await page.getByTestId('accrual-tax-evidence').fill(UI_ACCRUAL.taxEvidence);
	await page.getByTestId('accrual-currency').fill('INR');
	await page
		.getByTestId('accrual-source-reference')
		.fill(UI_ACCRUAL.sourceReference);
	await page
		.getByTestId('accrual-evidence-reference')
		.fill(UI_ACCRUAL.evidenceReference);
	const capturePosted = page.waitForResponse(
		(response) =>
			response.url().includes('/api/admin/cost-accruals') &&
			response.request().method() === 'POST'
	);
	await page.getByTestId('accrual-capture-submit').click();
	const captureResponse = await capturePosted;
	expect(captureResponse.status(), await captureResponse.text()).toBe(201);
	await expect(page.getByTestId('accrual-capture-form')).toBeHidden();

	const created = await rows<{
		id: number;
		accrual_number: string;
		cost_uid: string;
	}>(
		`SELECT id, accrual_number, cost_uid FROM cost_accruals
      WHERE description = ? AND isDelete = 0`,
		[UI_ACCRUAL.description]
	);
	expect(created.length, 'browser-created accrual row').toBe(1);
	const rowId = created[0].id;
	createdAccruals.push({
		id: rowId,
		cost_uid: created[0].cost_uid,
		where: 'browser capture',
	});

	// The capture is a draft until the recognize command establishes cost.
	let stored = await rows<Record<string, unknown>>(
		`SELECT recognition_state, recognized_amount, financial_version, evidence_basis,
            owner_user_id, currency, cost_classification, recognition_period
       FROM cost_accruals WHERE id = ?`,
		[rowId]
	);
	expect(stored[0].recognition_state).toBe('draft');
	expect(stored[0].recognized_amount).toBeNull();
	expect(stored[0].evidence_basis).toBe('received_work');
	expect(Number(stored[0].owner_user_id)).toBeGreaterThan(0);
	expect(stored[0].recognition_period).toBe(`${MONTH}-01`);

	await openAccrualDialog(page, created[0].accrual_number);
	await page.getByTestId('accrual-submit').click();
	await expect(page.getByTestId('accrual-state')).toContainText(
		'Pending evidence'
	);
	await page.getByTestId('accrual-recognize').click();
	await expect(page.getByTestId('accrual-state')).toContainText('Recognized');

	stored = await rows<Record<string, unknown>>(
		`SELECT recognition_state, recognized_amount, financial_version,
            cost_classification, project_id, currency
       FROM cost_accruals WHERE id = ?`,
		[rowId]
	);
	expect(stored[0].recognition_state).toBe('recognized');
	expect(Number(stored[0].recognized_amount)).toBe(UI_ACCRUAL.recognized);
	expect(Number(stored[0].financial_version)).toBe(3);
	expect(stored[0].cost_classification).toBe('project');
	expect(Number(stored[0].project_id)).toBe(seeded.projects.alpha);

	const journal = await rows<{ command: string; version: number }>(
		`SELECT command, version FROM financial_cost_events
      WHERE source_table = 'cost_accruals' AND source_id = ?
      ORDER BY version`,
		[rowId]
	);
	expect(journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'submitted',
		'recognized',
	]);
	const links = await rows<{ role: string; basis: string }>(
		`SELECT role, basis FROM financial_cost_links
      WHERE source_table = 'cost_accruals' AND source_id = ?`,
		[String(rowId)]
	);
	expect(links).toEqual([{ role: 'cost', basis: 'system' }]);

	const july = await reconciliation(request, MONTH);
	expect(july.company.incurred_cost).toBe(290000);
	evidence.browser = { accrualId: rowId, recognized: UI_ACCRUAL.recognized };
});

test('partial replacement supersedes only the matched amount', async ({
	request,
}) => {
	const a1 = seededAccrual('a1');
	const i1 = seededAccrualInvoice('i1');
	const result = await accrualReplacement(request, seeded.accrualIds.a1, {
		invoice_id: seeded.invoiceIds.i1,
		final: false,
		expected_accrual_version: 1,
		expected_invoice_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const data = result.body.data as Record<string, number | string | boolean>;
	expect(data.replaced_amount).toBe(60000);
	expect(data.invoice_amount).toBe(60000);
	expect(data.difference_amount).toBe(0);
	expect(data.accrual_remaining_amount).toBe(40000);
	expect(data.final).toBe(false);
	createdReplacements.push({
		accrual_id: seeded.accrualIds.a1,
		invoice_id: seeded.invoiceIds.i1,
		where: 'partial replacement',
	});

	const stored = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, replaced_amount, financial_version
       FROM cost_accruals WHERE id = ?`,
		[seeded.accrualIds.a1]
	);
	expect(Number(stored[0].recognized_amount)).toBe(40000);
	expect(Number(stored[0].replaced_amount)).toBe(60000);
	expect(Number(stored[0].financial_version)).toBe(2);

	const replacements = await rows<Record<string, unknown>>(
		`SELECT replaced_amount, invoice_amount, difference_amount, state, is_final
       FROM cost_accrual_replacements
      WHERE accrual_id = ? AND invoice_id = ?`,
		[seeded.accrualIds.a1, seeded.invoiceIds.i1]
	);
	expect(replacements.length).toBe(1);
	expect(Number(replacements[0].replaced_amount)).toBe(60000);
	expect(replacements[0].state).toBe('active');

	const links = await rows<Record<string, unknown>>(
		`SELECT role, basis, review_state FROM financial_cost_links
      WHERE source_table = 'purchase_invoices' AND source_id = ?`,
		[String(seeded.invoiceIds.i1)]
	);
	expect(
		links.some(
			(link) =>
				link.role === 'replacement' &&
				link.basis === 'explicit' &&
				link.review_state === 'confirmed'
		)
	).toBe(true);

	// July drops by the replaced amount; August already states every recognized
	// invoice (the invoice is authoritative cost from recognition and is never
	// mutated by the replacement): the chain states the invoice plus the
	// accrual's unmatched remainder, never both in full.
	const july = await reconciliation(request, MONTH);
	expect(july.company.incurred_cost).toBe(230000);
	const august = await reconciliation(request, PARTIAL_MONTH);
	expect(august.company.incurred_cost).toBe(180000);

	const detail = await accrualDetail(request, seeded.accrualIds.a1);
	expect(detail.data.recognized_amount).toBe(40000);
	expect(detail.data.replaced_amount).toBe(60000);
	expect(detail.data.replacements[0].state).toBe('active');
	// The unmatched remainder stays visible in the drilldown block.
	const julyDrilldown = await drilldown(request, { month: MONTH });
	const a1Record = julyDrilldown.records.find(
		(record) => record.cost_uid === a1.costUid
	);
	expect(a1Record?.accrual?.remaining_amount).toBe(40000);
	expect(a1Record?.accrual?.replaced_amount).toBe(60000);
	expect(a1Record?.accrual?.replacement_count).toBe(1);
	evidence.partial = { replaced: 60000, remaining: 40000 };
});

test('final replacement explains the estimate-versus-actual difference', async ({
	page,
	request,
}) => {
	// The browser replaces the rest of a1 with the 50000 invoice: actual
	// above the 40000 remaining, so the difference needs a period and reason.
	await openAccrualDialog(page, seededAccrual('a1').accrualNumber);
	await expect(page.getByTestId('accrual-remaining-amount')).toContainText(
		'40,000'
	);
	await expect(page.getByTestId('accrual-replaced-amount')).toContainText(
		'60,000'
	);
	await page
		.getByTestId('accrual-replacement-invoice')
		.selectOption(String(seeded.invoiceIds.i2));
	await page.getByTestId('accrual-replacement-final').check();
	await page
		.getByTestId('accrual-replacement-difference-reason')
		.fill('E2E-ACCR difference 9001: actual invoice above estimate');
	await page
		.getByTestId('accrual-replacement-evidence')
		.fill('E2E-ACCR-DIFF-EV-9001');
	// Await the replacement POST before reading the database: the row the
	// assertions below query only exists after the server commits, and the
	// '0' substring also matches the pre-replacement '₹40,000.00', so it
	// gates nothing on its own (same waitForResponse shape as :450 above).
	const replacementPosted = page.waitForResponse(
		(response) =>
			response
				.url()
				.includes(
					`/api/admin/cost-accruals/${seeded.accrualIds.a1}/replacements`
				) && response.request().method() === 'POST'
	);
	await page.getByTestId('accrual-replacement-submit').click();
	const replacementResponse = await replacementPosted;
	expect(replacementResponse.status(), await replacementResponse.text()).toBe(
		200
	);
	await expect(page.getByTestId('accrual-remaining-amount')).toContainText('0');

	const replacements = await rows<Record<string, unknown>>(
		`SELECT replaced_amount, invoice_amount, difference_amount, difference_period,
            difference_reason, evidence_reference, is_final, state
       FROM cost_accrual_replacements
      WHERE accrual_id = ? AND invoice_id = ?`,
		[seeded.accrualIds.a1, seeded.invoiceIds.i2]
	);
	expect(replacements.length).toBe(1);
	expect(Number(replacements[0].replaced_amount)).toBe(40000);
	expect(Number(replacements[0].invoice_amount)).toBe(50000);
	expect(Number(replacements[0].difference_amount)).toBe(10000);
	expect(replacements[0].difference_period).toBe(`${FINAL_MONTH}-01`);
	expect(replacements[0].difference_reason).toContain('E2E-ACCR difference');
	expect(replacements[0].evidence_reference).toBe('E2E-ACCR-DIFF-EV-9001');
	expect(Number(replacements[0].is_final)).toBe(1);
	createdReplacements.push({
		accrual_id: seeded.accrualIds.a1,
		invoice_id: seeded.invoiceIds.i2,
		where: 'browser final replacement',
	});

	const stored = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, replaced_amount, financial_version
       FROM cost_accruals WHERE id = ?`,
		[seeded.accrualIds.a1]
	);
	expect(Number(stored[0].recognized_amount)).toBe(0);
	expect(Number(stored[0].replaced_amount)).toBe(100000);
	expect(Number(stored[0].financial_version)).toBe(3);

	const july = await reconciliation(request, MONTH);
	expect(july.company.incurred_cost).toBe(190000);
	// September states the linked invoice plus the still-unlinked September
	// rows (a6 20000 + i2 50000 + i6 8000): linkage moves July only.
	const september = await reconciliation(request, FINAL_MONTH);
	expect(september.company.incurred_cost).toBe(78000);
	evidence.final = { replaced: 40000, difference: 10000 };
});

test('a final replacement below the estimate releases the variance', async ({
	request,
}) => {
	const result = await accrualReplacement(request, seeded.accrualIds.a2, {
		invoice_id: seeded.invoiceIds.i3,
		final: true,
		difference_reason: 'E2E-ACCR variance 9002: final invoice below estimate',
		evidence_reference: 'E2E-ACCR-DIFF-EV-9002',
		expected_accrual_version: 1,
		expected_invoice_version: 1,
	});
	expect(result.status, JSON.stringify(result.body)).toBe(200);
	const data = result.body.data as Record<string, number | string | boolean>;
	expect(data.replaced_amount).toBe(100000);
	expect(data.invoice_amount).toBe(80000);
	expect(data.difference_amount).toBe(-20000);
	expect(data.accrual_remaining_amount).toBe(0);
	expect(data.final).toBe(true);
	createdReplacements.push({
		accrual_id: seeded.accrualIds.a2,
		invoice_id: seeded.invoiceIds.i3,
		where: 'final below estimate',
	});

	const stored = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, replaced_amount FROM cost_accruals WHERE id = ?`,
		[seeded.accrualIds.a2]
	);
	expect(Number(stored[0].recognized_amount)).toBe(0);
	expect(Number(stored[0].replaced_amount)).toBe(100000);

	const july = await reconciliation(request, MONTH);
	expect(july.company.incurred_cost).toBe(90000);
	// August still states every recognized invoice; linking i3 moves July only.
	const august = await reconciliation(request, PARTIAL_MONTH);
	expect(august.company.incurred_cost).toBe(180000);
	evidence.belowEstimate = { replaced: 100000, difference: -20000 };
});

test('cancelling a replaced invoice restores the estimate atomically', async ({
	request,
}) => {
	// Partial replacement first: a5 keeps a 10000 remainder.
	const replaced = await accrualReplacement(request, seeded.accrualIds.a5, {
		invoice_id: seeded.invoiceIds.i4,
		final: false,
		expected_accrual_version: 1,
		expected_invoice_version: 1,
	});
	expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
	createdReplacements.push({
		accrual_id: seeded.accrualIds.a5,
		invoice_id: seeded.invoiceIds.i4,
		where: 'lifecycle partial',
	});
	const beforeJuly = await reconciliation(request, MONTH);
	const beforeAugust = await reconciliation(request, PARTIAL_MONTH);
	expect(beforeJuly.company.incurred_cost).toBe(60000);
	expect(beforeAugust.company.incurred_cost).toBe(180000);
	const beforeSum =
		(beforeJuly.company.incurred_cost ?? 0) +
		(beforeAugust.company.incurred_cost ?? 0);

	// Cancelling the invoice releases its live replacement in the same
	// transaction: the matched estimate returns to a5, the invoice stops
	// counting, and no committed state ever holds both.
	const cancelled = await invoiceCommand(request, seeded.invoiceIds.i4, {
		command: 'cancel',
		expected_version: 1,
		reason: 'E2E-ACCR lifecycle: invoice cancelled after partial replacement',
		evidence_reference: 'E2E-ACCR-CANCEL-EV-9104',
	});
	expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);

	const invoiceRow = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version FROM purchase_invoices WHERE id = ?`,
		[seeded.invoiceIds.i4]
	);
	expect(invoiceRow[0].recognition_state).toBe('cancelled');
	expect(Number(invoiceRow[0].financial_version)).toBe(2);

	const accrualRow = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, replaced_amount, financial_version
       FROM cost_accruals WHERE id = ?`,
		[seeded.accrualIds.a5]
	);
	expect(Number(accrualRow[0].recognized_amount)).toBe(40000);
	expect(Number(accrualRow[0].replaced_amount)).toBe(0);
	expect(Number(accrualRow[0].financial_version)).toBe(3);

	const replacementRow = await rows<Record<string, unknown>>(
		`SELECT state, release_reason, released_by, release_evidence_reference
       FROM cost_accrual_replacements
      WHERE accrual_id = ? AND invoice_id = ?`,
		[seeded.accrualIds.a5, seeded.invoiceIds.i4]
	);
	expect(replacementRow.length).toBe(1);
	expect(replacementRow[0].state).toBe('released');
	expect(String(replacementRow[0].release_reason)).toContain(
		'E2E-ACCR lifecycle'
	);
	expect(Number(replacementRow[0].released_by)).toBeGreaterThan(0);

	const releaseJournal = await rows<Record<string, unknown>>(
		`SELECT command, version FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[seededAccrual('a5').costUid]
	);
	expect(releaseJournal.map((entry) => entry.command)).toEqual([
		'recorded',
		'replaced',
		'released',
	]);

	// The released remainder counts again, the invoice no longer counts, and
	// the two months together still state the same received-work cost.
	const afterJuly = await reconciliation(request, MONTH);
	const afterAugust = await reconciliation(request, PARTIAL_MONTH);
	expect(afterJuly.company.incurred_cost).toBe(90000);
	expect(afterAugust.company.incurred_cost).toBe(150000);
	const afterSum =
		(afterJuly.company.incurred_cost ?? 0) +
		(afterAugust.company.incurred_cost ?? 0);
	expect(afterSum).toBe(beforeSum);

	// A repeated cancel changes nothing.
	const repeatCancel = await invoiceCommand(request, seeded.invoiceIds.i4, {
		command: 'cancel',
		expected_version: 2,
		reason: 'E2E-ACCR lifecycle repeat',
	});
	expect(repeatCancel.status).toBe(422);
	expect(repeatCancel.body.code).toBe('command_not_allowed');

	// A recognized invoice cannot be repriced or deleted: the register refuses
	// recognized cost first and the command path has no update from recognized.
	const repricing = await request.put(
		`/api/admin/purchase-invoices/${seeded.invoiceIds.i1}`,
		{ data: { total: 1 } }
	);
	expect(repricing.status()).toBe(409);
	const repricingBody = await repricing.json();
	expect(repricingBody.code).toBe('cost_recognized');
	// i1 stays at version 1: replacements guard the invoice version but only
	// ever bump the accrual row, so the pin must match the seeded version for
	// the command-allowed check (422) to run instead of the version check.
	const updateCommand = await invoiceCommand(request, seeded.invoiceIds.i1, {
		command: 'update',
		expected_version: 1,
		patch: { gross_amount: 1 },
	});
	expect(updateCommand.status).toBe(422);
	expect(updateCommand.body.code).toBe('command_not_allowed');
	evidence.lifecycle = {
		beforeSum,
		afterSum,
		restored: 40000,
		releaseReason: replacementRow[0].release_reason,
	};
});

test('replacement commands are version-checked, non-duplicating, and race-safe', async ({
	request,
}) => {
	// A successful replacement, then the same request again: the accrual moved
	// on, so the repeat is a version conflict and writes nothing.
	const first = await accrualReplacement(request, seeded.accrualIds.a5, {
		invoice_id: seeded.invoiceIds.i5,
		final: false,
		expected_accrual_version: 3,
		expected_invoice_version: 1,
	});
	expect(first.status, JSON.stringify(first.body)).toBe(200);
	createdReplacements.push({
		accrual_id: seeded.accrualIds.a5,
		invoice_id: seeded.invoiceIds.i5,
		where: 'repeat target',
	});
	const repeat = await accrualReplacement(request, seeded.accrualIds.a5, {
		invoice_id: seeded.invoiceIds.i5,
		final: false,
		expected_accrual_version: 3,
		expected_invoice_version: 1,
	});
	expect(repeat.status).toBe(409);
	expect(repeat.body.code).toBe('version_conflict');
	const activeRows = await rows<Record<string, unknown>>(
		`SELECT id FROM cost_accrual_replacements
      WHERE accrual_id = ? AND invoice_id = ? AND state = 'active'`,
		[seeded.accrualIds.a5, seeded.invoiceIds.i5]
	);
	expect(activeRows.length).toBe(1);

	// An invoice already superseding one accrual cannot silently supersede a
	// second one. a6 is the target (recognized, 20000 remaining, version 1):
	// a2 is fully replaced (remaining 0), so pairing with a2 would stop at
	// the remaining-estimate guard instead of the cross-link guard. i1 stays
	// at version 1 (replacements only bump the accrual row).
	const crossLink = await accrualReplacement(request, seeded.accrualIds.a6, {
		invoice_id: seeded.invoiceIds.i1,
		final: false,
		expected_accrual_version: 1,
		expected_invoice_version: 1,
	});
	expect(crossLink.status, JSON.stringify(crossLink.body)).toBe(409);
	expect(crossLink.body.code).toBe('invoice_already_replacement');

	// Two concurrent replacements of the same pair: exactly one wins.
	const [one, two] = await Promise.all([
		accrualReplacement(request, seeded.accrualIds.a6, {
			invoice_id: seeded.invoiceIds.i6,
			final: false,
			expected_accrual_version: 1,
			expected_invoice_version: 1,
		}),
		accrualReplacement(request, seeded.accrualIds.a6, {
			invoice_id: seeded.invoiceIds.i6,
			final: false,
			expected_accrual_version: 1,
			expected_invoice_version: 1,
		}),
	]);
	const statuses = [one.status, two.status].sort((a, b) => a - b);
	expect(statuses).toEqual([200, 409]);
	createdReplacements.push({
		accrual_id: seeded.accrualIds.a6,
		invoice_id: seeded.invoiceIds.i6,
		where: 'concurrent winner',
	});
	const concurrentRows = await rows<Record<string, unknown>>(
		`SELECT id, replaced_amount FROM cost_accrual_replacements
      WHERE accrual_id = ? AND invoice_id = ?`,
		[seeded.accrualIds.a6, seeded.invoiceIds.i6]
	);
	expect(concurrentRows.length).toBe(1);
	expect(Number(concurrentRows[0].replaced_amount)).toBe(8000);
	const a6Row = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, replaced_amount, financial_version
       FROM cost_accruals WHERE id = ?`,
		[seeded.accrualIds.a6]
	);
	expect(Number(a6Row[0].recognized_amount)).toBe(12000);
	expect(Number(a6Row[0].replaced_amount)).toBe(8000);
	expect(Number(a6Row[0].financial_version)).toBe(2);
	evidence.concurrency = { statuses, active: 1, remaining: 12000 };
});

test('authorization keeps capture and financial acts behind their privileges', async ({
	playwright,
	baseURL,
	request,
}) => {
	const editor = await loginAccrualEditor(playwright, baseURL!);
	try {
		// The editor may capture (a draft is not cost) and read the register.
		const captured = await captureAccrual(editor, {
			description:
				'E2E-ACCR received work editor capture (no approval privilege)',
			evidence_basis: 'received_work',
			gross_amount: 12000,
			service_period_start: '2018-07-01',
			service_period_end: '2018-07-31',
			cost_classification: 'project',
			project_id: seeded.projects.alpha,
			currency: 'INR',
			source_reference: 'E2E-ACCR-EDITOR-SRC',
			evidence_reference: 'E2E-ACCR-EDITOR-EV',
			submit: true,
		});
		expect(captured.status, JSON.stringify(captured.body)).toBe(201);
		const capturedId = Number(
			(captured.body.data as Record<string, unknown>).id
		);
		createdAccruals.push({
			id: capturedId,
			cost_uid: String(
				(captured.body.data as Record<string, unknown>).cost_uid
			),
			where: 'editor capture',
		});
		const editorRow = await rows<{ id: number }>(
			`SELECT id FROM users WHERE username = 'e2e_313_editor'`
		);
		const storedOwner = await rows<Record<string, unknown>>(
			`SELECT owner_user_id FROM cost_accruals WHERE id = ?`,
			[capturedId]
		);
		expect(Number(storedOwner[0].owner_user_id)).toBe(editorRow[0].id);

		const register = await editor.get('/api/admin/cost-accruals');
		expect(register.status()).toBe(200);

		// Recognition and replacement are financial acts: 403, no writes.
		const recognize = await accrualCommand(editor, capturedId, {
			command: 'recognize',
			expected_version: 1,
		});
		expect(recognize.status).toBe(403);
		const replacement = await accrualReplacement(editor, capturedId, {
			invoice_id: seeded.invoiceIds.i5,
			final: false,
			expected_accrual_version: 1,
			expected_invoice_version: 2,
		});
		expect(replacement.status).toBe(403);
		const unchanged = await rows<Record<string, unknown>>(
			`SELECT recognition_state, financial_version FROM cost_accruals WHERE id = ?`,
			[capturedId]
		);
		expect(unchanged[0].recognition_state).toBe('pending_evidence');
		expect(Number(unchanged[0].financial_version)).toBe(1);
	} finally {
		await editor.dispose();
	}

	const reportsOnly = await loginAccrualReportsOnly(playwright, baseURL!);
	try {
		const register = await reportsOnly.get('/api/admin/cost-accruals');
		expect(register.status()).toBe(403);
		const captured = await captureAccrual(reportsOnly, {
			description: 'E2E-ACCR reports-only capture must be refused',
			gross_amount: 1,
			service_period_start: '2018-07-01',
			service_period_end: '2018-07-31',
		});
		expect(captured.status).toBe(403);
		const report = await reportsOnly.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${MONTH}`
		);
		expect(report.status()).toBe(403);
		const drill = await reportsOnly.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${MONTH}`
		);
		expect(drill.status()).toBe(403);
	} finally {
		await reportsOnly.dispose();
	}

	// The finance approval path still works for the same shape of request.
	const approved = await accrualCommand(request, seeded.accrualIds.a4, {
		command: 'cancel',
		expected_version: 1,
		reason: 'E2E-ACCR authorization contrast',
	});
	expect(approved.status, JSON.stringify(approved.body)).toBe(200);
	evidence.authorization = { editorCapture: 201, editorRecognize: 403 };
});

test('report and drilldown state the accrual chain once', async ({
	page,
	request,
}) => {
	const july = await reconciliation(request, MONTH);
	expect(july.company.incurred_cost).toBe(80000);
	expect(projectRow(july, ACCRUAL_PROJECTS.alpha.code).incurred_cost).toBe(
		80000
	);
	expect(sourceOf(july, 'cost_accrual').confirmed_amount).toBe(80000);

	const august = await reconciliation(request, PARTIAL_MONTH);
	expect(august.company.incurred_cost).toBe(150000);

	const september = await reconciliation(request, FINAL_MONTH);
	expect(september.company.incurred_cost).toBe(70000);
	const septemberProject = projectRow(september, ACCRUAL_PROJECTS.alpha.code);
	expect(septemberProject.previous_period_cost).toBe(150000);
	expect(septemberProject.change_amount).toBe(-80000);
	// Cost to date counts every authoritative record once: 80000 + 150000 +
	// 70000.
	expect(septemberProject.cost_to_date).toBe(300000);

	// The July drilldown shows the accrual chain with replaced and remaining
	// amounts; a1 and a2 are fully superseded, a5 keeps its remainder.
	const julyDrilldown = await drilldown(request, { month: MONTH });
	const accrualRecords = julyDrilldown.records.filter(
		(record) => record.source === 'cost_accrual'
	);
	const byUid = new Map(
		accrualRecords.map((record) => [record.cost_uid, record])
	);
	const a1 = byUid.get(seededAccrual('a1').costUid);
	expect(a1?.accrual?.replaced_amount).toBe(100000);
	expect(a1?.accrual?.remaining_amount).toBe(0);
	expect(a1?.accrual?.replacement_count).toBe(2);
	// The accrual's Project identity resolves through the projects join.
	expect(a1?.project_code).toBe(ACCRUAL_PROJECTS.alpha.code);
	const a2 = byUid.get(seededAccrual('a2').costUid);
	expect(a2?.accrual?.replaced_amount).toBe(100000);
	expect(a2?.accrual?.remaining_amount).toBe(0);
	const a5 = byUid.get(seededAccrual('a5').costUid);
	expect(a5?.accrual?.replaced_amount).toBe(10000);
	expect(a5?.accrual?.remaining_amount).toBe(30000);
	const a5Row = await rows<Record<string, unknown>>(
		`SELECT recognition_state FROM cost_accruals WHERE id = ?`,
		[seeded.accrualIds.a5]
	);
	expect(a5Row[0].recognition_state).toBe('recognized');

	// The August drilldown holds each replacement invoice once; the cancelled
	// i4 is not recognized cost anywhere.
	const augustDrilldown = await drilldown(request, {
		month: PARTIAL_MONTH,
		state: 'recognized',
	});
	const augustUids = new Set(
		augustDrilldown.records.map((record) => record.cost_uid)
	);
	expect(augustUids.has(seededAccrualInvoice('i1').costUid)).toBe(true);
	expect(augustUids.has(seededAccrualInvoice('i3').costUid)).toBe(true);
	expect(augustUids.has(seededAccrualInvoice('i5').costUid)).toBe(true);
	expect(augustUids.has(seededAccrualInvoice('i4').costUid)).toBe(false);

	// The browser states the same July figure and the accrual row's chain.
	await openExpenditure(page, MONTH);
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(80000);
	const projectRowLocator = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${ACCRUAL_PROJECTS.alpha.code}"]`
	);
	await expect(projectRowLocator).toBeVisible();
	expect(
		Number(await projectRowLocator.getAttribute('data-project-cost'))
	).toBe(80000);
	await projectRowLocator.getByTestId('project-expand').click();
	await expect(page.getByTestId('project-drilldown')).toBeVisible();
	const a5Locator = page.locator(
		`[data-testid="drilldown-record"][data-source="cost_accrual"][data-cost-uid="${seededAccrual('a5').costUid}"]`
	);
	await expect(a5Locator).toBeVisible();
	expect(Number(await a5Locator.getAttribute('data-accrual-remaining'))).toBe(
		30000
	);
	expect(Number(await a5Locator.getAttribute('data-accrual-replaced'))).toBe(
		10000
	);
	await expect(a5Locator).toContainText('Cost accrual');

	evidence.finalTotals = {
		july: 80000,
		august: 150000,
		september: 70000,
		costToDate: 300000,
	};
});

test('the artifact records the accrual evidence', async () => {
	publish();
	const artifact = readArtifact('cost-accruals');
	expect(artifact.flow).toBe('cost-accruals');
	expect(artifact.ok).toBe(true);
	const fixtureScope = artifact.fixtureScope as Record<string, unknown>;
	expect(fixtureScope.months).toEqual([MONTH, PARTIAL_MONTH, FINAL_MONTH]);
	const created = artifact.createdThroughApp as Record<string, unknown>;
	expect((created.accruals as unknown[]).length).toBeGreaterThanOrEqual(2);
	expect((created.replacements as unknown[]).length).toBeGreaterThanOrEqual(5);
	expect(artifact.finalTotals).toBeTruthy();
});
