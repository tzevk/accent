import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { trackArtifactOutcome } from '../lib/artifact-outcome';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	EXPENDITURE_CATEGORY,
	EXPENDITURE_MONTH,
	EXPENDITURE_NEXT_MONTH,
	EXPENDITURE_PROJECTS,
	EXPENDITURE_VENDOR_PREFIX,
	cleanupExpenditureFixtures,
	loginExpenditureReportOnlyReader,
	seedExpenditureFixtures,
	seededCost,
	type SeededExpenditure,
} from '../lib/expenditure-fixtures';

/**
 * Ticket #306 — direct expense recognition reconciled to company cost.
 *
 * Everything here is stated from the fixture literals and the business rules,
 * never from the report module's own aggregation: the fixture rows say what
 * they are worth, this file says what the reconciliation must therefore show,
 * and the assertions compare the app's answer with that arithmetic.
 *
 * Two clean months are recorded through the real app (2019-03 through the API
 * and its versioned command, 2019-04 through the browser form and the
 * recognition queue), so the January/February expectations never depend on a
 * later test: a recognized cost appears in its own service month once.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.21' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = EXPENDITURE_MONTH;
const NEXT_MONTH = EXPENDITURE_NEXT_MONTH;
const API_MONTH = '2019-03';
const MONTH_LABEL = 'January 2019';

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

/**
 * The browser flow records cost for the month a real operator would use: the
 * current one, which the report opens on. Its figures are asserted as deltas,
 * so any cost already recorded in that month (a shared dev database) cannot
 * hide a mistake, while the row itself is asserted exactly.
 */
const UI_MONTH = new Date().toISOString().slice(0, 7);
const UI_MONTH_LABEL = labelOf(UI_MONTH);

/**
 * Hand-computed from the seeded January rows (see `EXPENDITURE_COSTS`): the
 * recognized fixtures are 1000 + 2500 + 4720 + 0 for Projects, 3000 + 590 for
 * Company Overhead, and 600 + 1000 for Unallocated Cost.
 */
const JANUARY_PROJECT = 1000 + 2500 + 4720 + 0;
const JANUARY_OVERHEAD = 3000 + 590;
const JANUARY_UNALLOCATED = 600 + 1000;
const JANUARY = {
	project: JANUARY_PROJECT,
	overhead: JANUARY_OVERHEAD,
	unallocated: JANUARY_UNALLOCATED,
	total: JANUARY_PROJECT + JANUARY_OVERHEAD + JANUARY_UNALLOCATED,
	grossLiability: 1180 + 2500 + 4720 + 3000 + 600 + 0 + 1000 + 590,
	recoverableTax: 180,
	unresolvedTaxCount: 2,
	unresolvedTaxGross: 1000 + 590,
	alpha: 1000 + 2500,
	beta: 4720 + 0,
	alphaPending: 900,
	recognizedRecords: 8,
} as const;

/**
 * February: an INR project cost, a USD overhead cost, and a USD project cost.
 * The month holds two currencies on the same Project (alpha) as well as across
 * destinations — exactly the figures that must never be combined.
 */
const FEBRUARY = { inr: 100, usdOverhead: 50, usdProject: 30 } as const;

/** The cost the browser edit test completes through the versioned update. */
const UI_EDITED = { gross: 321 } as const;

/** The partial service period (end only) the API test records. */
const PARTIAL_PERIOD = {
	end: `${API_MONTH}-18`,
	billDate: `${API_MONTH}-25`,
	gross: 400,
} as const;

/** The cost the API test records and recognizes (gross − evidenced tax). */
const API_CREATED = { gross: 1180, tax: 180, recognized: 1000 } as const;
/** The cost the browser test records and recognizes. */
const UI_CREATED = { gross: 649, tax: 0, recognized: 649 } as const;

interface ReconciliationData {
	month: string;
	month_label: string;
	project_id: number | null;
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
		known_zero_count: number;
		record_count: number;
	};
	projects: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
		currency: string;
		incurred_cost: number;
		record_count: number;
		not_confirmed_cost: number | null;
		previous_period_cost: number | null;
		change_amount: number | null;
		change_state: string;
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
		known_zero: { count: number };
	};
	coverage: Array<{
		code: string;
		label: string;
		detail: string;
		severity: string;
	}>;
	project_options: Array<{ project_id: number; project_code: string }>;
	available_months: string[];
}

interface DrilldownRecord {
	id: number;
	cost_uid: string;
	expense_number: string;
	recognition_state: string;
	cost_classification: string | null;
	recognition_period: string | null;
	period_basis: string;
	currency: string;
	gross_amount: number | null;
	recognized_amount: number | null;
	source_reference: string | null;
	evidence_reference: string | null;
	project_code: string | null;
	financial_version: number;
	missing_amount: boolean;
	known_zero: boolean;
	exceptions: string[];
}

interface DrilldownData {
	month: string;
	scope: string;
	total: number;
	limit: number;
	offset: number;
	records: DrilldownRecord[];
	totals: {
		confirmed_amount: number | null;
		currency: string | null;
		records: number;
	};
}

let seeded: SeededExpenditure;
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
/** Ids this spec records through the app, so the run leaves nothing behind. */
const created: Array<{ id: number; cost_uid: string; where: string }> = [];

const outcome = trackArtifactOutcome();

function publish(): void {
	evidence.ok = outcome.ok;
	writeArtifact('expense-reconciliation', {
		...evidence,
		fixtureScope: {
			projects: Object.values(EXPENDITURE_PROJECTS).map((p) => p.code),
			expensePrefix: 'E2E-EXP-',
			months: [MONTH, NEXT_MONTH, API_MONTH, UI_MONTH],
		},
		createdThroughApp: created,
	});
}

async function reconciliation(
	request: APIRequestContext,
	month: string,
	projectId?: number
): Promise<ReconciliationData> {
	const params = new URLSearchParams({ view: 'expenditure', month });
	if (projectId !== undefined) params.set('project_id', String(projectId));
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost?${params.toString()}`
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

test.beforeAll(async () => {
	seeded = await seedExpenditureFixtures();
	evidence.seeded = {
		costs: seeded.costs,
		projects: seeded.projects,
	};
});

test.afterAll(async () => {
	publish();
	if (created.length) {
		const ids = created.map((entry) => entry.id);
		const placeholders = ids.map(() => '?').join(', ');
		await exec(
			`DELETE FROM financial_cost_events WHERE source_table = 'expenses' AND source_id IN (${placeholders})`,
			ids
		);
		await exec(`DELETE FROM expenses WHERE id IN (${placeholders})`, ids);
	}
	await cleanupExpenditureFixtures();
});

test('reconciles every recognized direct expense once into its group', async ({
	request,
}) => {
	const data = await reconciliation(request, MONTH);
	expect(data.month).toBe(MONTH);
	expect(data.month_label).toBe(MONTH_LABEL);
	expect(data.project_id).toBeNull();

	// Company Incurred Cost equals its three groups, and the groups equal the
	// fixture arithmetic.
	expect(group(data, 'incurred_project_cost')).toBe(JANUARY.project);
	expect(group(data, 'company_overhead')).toBe(JANUARY.overhead);
	expect(group(data, 'unallocated_cost')).toBe(JANUARY.unallocated);
	expect(data.company.incurred_cost).toBe(JANUARY.total);

	const inr = data.company.currency_totals.find(
		(row) => row.currency === 'INR'
	);
	expect(inr, 'INR subtotal').toBeTruthy();
	expect(inr!.incurred_project_cost).toBe(JANUARY.project);
	expect(inr!.company_overhead).toBe(JANUARY.overhead);
	expect(inr!.unallocated_cost).toBe(JANUARY.unallocated);
	expect(inr!.incurred_cost).toBe(JANUARY.total);
	expect(data.company.currency_totals).toHaveLength(1);
	expect(data.company.currency).toBe('INR');
	expect(data.company.record_count).toBe(JANUARY.recognizedRecords);

	// Gross liability, evidenced recoverable tax, and the tax still open stay
	// visible next to the adjusted cost.
	expect(data.company.gross_liability).toBe(JANUARY.grossLiability);
	expect(data.company.recoverable_tax).toBe(JANUARY.recoverableTax);
	expect(data.company.unresolved_tax.count).toBe(JANUARY.unresolvedTaxCount);
	expect(data.company.unresolved_tax.gross_amount).toBe(
		JANUARY.unresolvedTaxGross
	);
	expect(data.company.known_zero_count).toBe(1);

	// The database agrees with the response for the same month.
	const persisted = await rows<{ total: string; records: number }>(
		`SELECT COALESCE(SUM(recognized_amount), 0) AS total, COUNT(*) AS records
       FROM expenses
      WHERE isDelete = 0 AND recognition_state = 'recognized'
        AND recognition_period BETWEEN ? AND ?`,
		[`${MONTH}-01`, `${MONTH}-31`]
	);
	expect(Number(persisted[0].total)).toBe(JANUARY.total);
	expect(Number(persisted[0].records)).toBe(JANUARY.recognizedRecords);

	// The project breakdown foots to the project group.
	const alpha = data.projects.find(
		(row) => row.project_code === EXPENDITURE_PROJECTS.alpha.code
	);
	const beta = data.projects.find(
		(row) => row.project_code === EXPENDITURE_PROJECTS.beta.code
	);
	expect(alpha?.incurred_cost).toBe(JANUARY.alpha);
	expect(alpha?.not_confirmed_cost).toBe(JANUARY.alphaPending);
	expect(beta?.incurred_cost).toBe(JANUARY.beta);
	expect(alpha!.incurred_cost + beta!.incurred_cost).toBe(JANUARY.project);
	expect(alpha?.change_state).toBe('no_prior');
	expect(alpha?.previous_period_cost).toBeNull();

	evidence.january = {
		expected: JANUARY,
		observed: {
			groups: data.company.groups,
			currencyTotals: data.company.currency_totals,
			projects: data.projects.map((row) => ({
				code: row.project_code,
				cost: row.incurred_cost,
				notConfirmed: row.not_confirmed_cost,
			})),
		},
	};
});

test('keeps drafts, pending, rejected, cancelled, unresolved and missing out of confirmed cost', async ({
	request,
}) => {
	const data = await reconciliation(request, MONTH);

	expect(data.evidence.recognized.count).toBe(JANUARY.recognizedRecords);
	expect(data.evidence.recognized.amount).toBe(JANUARY.total);
	expect(data.evidence.recognized.currency).toBe('INR');
	expect(data.evidence.pending_evidence.count).toBe(2);
	// One pending record is 900 and one has no amount: the subtotal is not
	// stated at all rather than treating the unknown amount as zero, while the
	// separate missing_amount count still discloses it.
	expect(data.evidence.pending_evidence.currency).toBe('INR');
	expect(data.evidence.pending_evidence.amount).toBeNull();
	expect(data.evidence.draft.count).toBe(1);
	expect(data.evidence.draft.amount).toBe(750);
	expect(data.evidence.rejected.amount).toBe(500);
	expect(data.evidence.cancelled.amount).toBe(800);
	expect(data.evidence.rejected.count).toBe(1);
	expect(data.evidence.cancelled.count).toBe(1);
	expect(data.evidence.missing_amount.count).toBe(1);
	expect(data.evidence.unresolved_classification.count).toBe(1);
	expect(data.evidence.known_zero.count).toBe(1);

	// Unconfirmed rows are excluded from every company figure: the confirmed
	// total has no contribution from 900 + 750 + 500 + 800.
	expect(data.company.incurred_cost).toBe(JANUARY.total);

	// The missing amount is unknown, not zero.
	const missing = await rows<{
		amount: string | null;
		total_amount: string | null;
	}>(`SELECT amount, total_amount FROM expenses WHERE expense_number = ?`, [
		seededCost('missingAmount').expenseNumber,
	]);
	expect(missing[0].total_amount).toBeNull();
	expect(missing[0].amount).toBeNull();

	// The known zero is a recorded zero.
	const zero = await rows<{
		total_amount: string | null;
		recognized_amount: string | null;
	}>(
		`SELECT total_amount, recognized_amount FROM expenses WHERE expense_number = ?`,
		[seededCost('knownZero').expenseNumber]
	);
	expect(Number(zero[0].total_amount)).toBe(0);
	expect(Number(zero[0].recognized_amount)).toBe(0);

	// The review queue reads the same rows back with their evidence state.
	const queue = await drilldown(request, {
		month: MONTH,
		state: 'unconfirmed',
	});
	expect(queue.scope).toBe('month');
	expect(queue.total).toBe(3);
	const numbers = queue.records.map((row) => row.expense_number).sort();
	expect(numbers).toEqual(
		[
			seededCost('pendingEvidence').expenseNumber,
			seededCost('missingAmount').expenseNumber,
			seededCost('draftUnresolved').expenseNumber,
		].sort()
	);
	const pendingRow = queue.records.find(
		(row) => row.expense_number === seededCost('pendingEvidence').expenseNumber
	)!;
	expect(pendingRow.gross_amount).toBe(900);
	expect(pendingRow.recognition_period).toBe(`${MONTH}-01`);
	expect(pendingRow.period_basis).toBe('service_period');
	const missingRow = queue.records.find(
		(row) => row.expense_number === seededCost('missingAmount').expenseNumber
	)!;
	expect(missingRow.missing_amount).toBe(true);
	expect(missingRow.gross_amount).toBeNull();
	expect(missingRow.exceptions).toContain('missing_amount');

	evidence.excluded = {
		evidence: data.evidence,
		queue: numbers,
		coverage: coverageCodes(data),
	};
});

test('refuses to recognize a cost whose amount is unknown', async ({
	request,
}) => {
	const id = seeded.expenseIds.missingAmount;
	const response = await request.post(`/api/admin/expenses/${id}/commands`, {
		data: {
			command: 'recognize',
			expected_version: 1,
			reason: 'E2E attempt without an amount',
		},
	});
	expect(response.status(), await response.text()).toBe(422);
	const body = await response.json();
	expect(body.code).toBe('not_ready_for_recognition');
	expect(body.missing).toContain('gross_amount');

	// Nothing changed: an unknown amount never becomes confirmed cost.
	const stored = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version, recognized_amount
       FROM expenses WHERE id = ?`,
		[id]
	);
	expect(stored[0].recognition_state).toBe('pending_evidence');
	expect(Number(stored[0].financial_version)).toBe(1);
	expect(stored[0].recognized_amount).toBeNull();

	// A rejection without a reason is refused as well, so refusal is reasoned.
	const unreasoned = await request.post(`/api/admin/expenses/${id}/commands`, {
		data: { command: 'reject', expected_version: 1 },
	});
	expect(unreasoned.status()).toBe(422);
	expect((await unreasoned.json()).code).toBe('reason_required');

	evidence.refusals = {
		recognize: { status: response.status(), missing: body.missing },
		rejectWithoutReason: unreasoned.status(),
	};
});

test('filters project detail without changing the company reconciliation', async ({
	request,
}) => {
	const unfiltered = await reconciliation(request, MONTH);
	const alphaId = seeded.projects.alpha;
	const filtered = await reconciliation(request, MONTH, alphaId);

	expect(filtered.project_id).toBe(alphaId);
	expect(filtered.projects.map((row) => row.project_code)).toEqual([
		EXPENDITURE_PROJECTS.alpha.code,
	]);
	expect(filtered.projects[0].incurred_cost).toBe(JANUARY.alpha);

	// The company reconciliation ignores the Project filter.
	expect(filtered.company.incurred_cost).toBe(unfiltered.company.incurred_cost);
	expect(filtered.company.groups).toEqual(unfiltered.company.groups);

	evidence.projectFilter = {
		expectedCompanyTotal: JANUARY.total,
		observedFilteredTotal: filtered.company.incurred_cost,
		filteredProjects: filtered.projects.map((row) => row.project_code),
	};
});

test('keeps currencies separate until a supported conversion exists', async ({
	request,
}) => {
	const data = await reconciliation(request, NEXT_MONTH);
	expect(data.company.currency_totals).toHaveLength(2);
	const inr = data.company.currency_totals.find(
		(row) => row.currency === 'INR'
	)!;
	const usd = data.company.currency_totals.find(
		(row) => row.currency === 'USD'
	)!;
	expect(inr.incurred_project_cost).toBe(FEBRUARY.inr);
	expect(inr.incurred_cost).toBe(FEBRUARY.inr);
	expect(usd.incurred_project_cost).toBe(FEBRUARY.usdProject);
	expect(usd.company_overhead).toBe(FEBRUARY.usdOverhead);
	expect(usd.incurred_cost).toBe(FEBRUARY.usdOverhead + FEBRUARY.usdProject);

	// No mixed-currency aggregate is presented as a company total — not the
	// incurred cost, not gross liability, not recoverable or unresolved tax.
	expect(data.company.incurred_cost).toBeNull();
	expect(data.company.currency).toBeNull();
	expect(data.company.gross_liability).toBeNull();
	expect(data.company.recoverable_tax).toBeNull();
	expect(data.company.unresolved_tax.count).toBe(0);
	expect(data.company.unresolved_tax.currency).toBeNull();
	expect(inr.gross_liability).toBe(FEBRUARY.inr);
	expect(usd.gross_liability).toBe(FEBRUARY.usdOverhead + FEBRUARY.usdProject);
	expect(inr.recoverable_tax).toBe(0);
	expect(usd.recoverable_tax).toBe(0);
	// The evidence subtotal spans two currencies and is therefore not stated.
	expect(data.evidence.recognized.count).toBe(3);
	expect(data.evidence.recognized.currency).toBeNull();
	expect(data.evidence.recognized.amount).toBeNull();
	expect(coverageCodes(data)).toContain('currency_conversion_missing');

	// The Project breakdown keeps one row per currency: alpha's INR cost is
	// compared with its INR prior month, and its USD cost has no USD prior.
	const alphaRows = data.projects.filter(
		(row) => row.project_code === EXPENDITURE_PROJECTS.alpha.code
	);
	expect(alphaRows.map((row) => row.currency).sort()).toEqual(['INR', 'USD']);
	const alphaInr = alphaRows.find((row) => row.currency === 'INR')!;
	const alphaUsd = alphaRows.find((row) => row.currency === 'USD')!;
	expect(alphaInr.incurred_cost).toBe(FEBRUARY.inr);
	expect(alphaInr.previous_period_cost).toBe(JANUARY.alpha);
	expect(alphaInr.change_amount).toBe(FEBRUARY.inr - JANUARY.alpha);
	expect(alphaInr.change_state).toBe('decrease');
	expect(alphaUsd.incurred_cost).toBe(FEBRUARY.usdProject);
	expect(alphaUsd.previous_period_cost).toBeNull();
	expect(alphaUsd.change_amount).toBeNull();
	expect(alphaUsd.change_state).toBe('no_prior');

	// The database rows agree: one USD Project cost, one INR Project cost.
	const persisted = await rows<{
		currency: string;
		total: string;
		records: number;
	}>(
		`SELECT currency, SUM(recognized_amount) AS total, COUNT(*) AS records
       FROM expenses
      WHERE isDelete = 0 AND recognition_state = 'recognized'
        AND cost_classification = 'project'
        AND recognition_period BETWEEN ? AND ?
      GROUP BY currency
      ORDER BY currency`,
		[`${NEXT_MONTH}-01`, `${NEXT_MONTH}-28`]
	);
	expect(persisted.map((row) => [row.currency, Number(row.total)])).toEqual([
		['INR', FEBRUARY.inr],
		['USD', FEBRUARY.usdProject],
	]);

	evidence.currency = {
		expected: FEBRUARY,
		observed: data.company.currency_totals,
		incurredCost: data.company.incurred_cost,
		grossLiability: data.company.gross_liability,
		projectRows: alphaRows.map((row) => ({
			code: row.project_code,
			currency: row.currency,
			cost: row.incurred_cost,
			previous: row.previous_period_cost,
		})),
		coverage: coverageCodes(data),
	};
});

test('states which sources are not yet incorporated', async ({ request }) => {
	const data = await reconciliation(request, MONTH);
	const codes = coverageCodes(data);
	// #313 wires Cost Accruals into the same registry, so its coverage notice
	// no longer claims the source is missing; the code is not repinned here.
	// Employee cost is incorporated since #307 (ADR-0016): the reconciliation
	// no longer declares payroll missing, and it discloses the month's payroll
	// coverage instead (this month has no finalized Payroll Run).
	expect(codes).not.toContain('payroll_employee_cost_not_incorporated');
	expect(
		codes.includes('payroll_not_generated') ||
			codes.includes('payroll_not_finalized')
	).toBe(true);
	expect(codes).toContain('supplier_source_not_incorporated');
	expect(codes).toContain('cash_and_payments_not_incorporated');
	// Open evidence in the month is disclosed.
	expect(codes).toContain('records_awaiting_recognition');
	expect(codes).toContain('missing_amount');
	expect(codes).toContain('unresolved_classification');
	expect(codes).toContain('unresolved_tax_treatment');
	expect(codes).toContain('tax_evidence_missing');
	for (const notice of data.coverage) {
		expect(notice.label.length).toBeGreaterThan(0);
		expect(notice.detail.length).toBeGreaterThan(0);
	}
	// An empty month produces a coverage warning, not a zero company cost.
	const empty = await reconciliation(request, '2019-05');
	expect(empty.company.record_count).toBe(0);
	expect(empty.company.incurred_cost).toBeNull();
	expect(coverageCodes(empty)).toContain('no_recognized_cost');

	evidence.coverage = {
		month: MONTH,
		codes,
		emptyMonth: {
			month: '2019-05',
			codes: coverageCodes(empty),
			incurredCost: empty.company.incurred_cost,
		},
	};
});

test('records and recognizes a cost through authenticated requests, once', async ({
	request,
}, testInfo) => {
	const sourceReference = `E2E-INV-API-${testInfo.retry}`;
	const createdResponse = await request.post('/api/admin/expenses', {
		data: {
			category: EXPENDITURE_CATEGORY,
			description: 'E2E cost recorded through the API',
			vendor_name: `${EXPENDITURE_VENDOR_PREFIX}api`,
			expense_date: '2019-03-05',
			cost_classification: 'project',
			project_id: seeded.projects.alpha,
			service_period_start: '2019-03-04',
			service_period_end: '2019-03-04',
			bill_date: '2019-03-05',
			currency: 'INR',
			gross_amount: API_CREATED.gross,
			tax_amount: API_CREATED.tax,
			tax_treatment: 'recoverable',
			tax_evidence_reference: 'GST-EVID-API',
			source_reference: sourceReference,
			evidence_reference: 'E2E-GRN-API',
			submit: true,
		},
	});
	expect(createdResponse.status(), await createdResponse.text()).toBe(200);
	const createdBody = await createdResponse.json();
	const record = createdBody.data as {
		id: number;
		expense_number: string;
		cost_uid: string;
		recognition_state: string;
		financial_version: number;
		recognition_period: string;
		period_basis: string;
		recognized_amount: number | null;
	};
	created.push({ id: record.id, cost_uid: record.cost_uid, where: 'api' });

	expect(record.expense_number).toMatch(/^EXP-\d+$/);
	expect(record.cost_uid).toBeTruthy();
	expect(record.recognition_state).toBe('pending_evidence');
	expect(record.financial_version).toBe(1);
	// The received-work period decides the month, not the bill date and never
	// the payment.
	expect(record.recognition_period).toBe(`${API_MONTH}-01`);
	expect(record.period_basis).toBe('service_period');
	expect(record.recognized_amount).toBeNull();

	// Unrecognized cost does not reach the reconciliation.
	const before = await reconciliation(request, API_MONTH);
	expect(before.company.record_count).toBe(0);

	const recognizeResponse = await request.post(
		`/api/admin/expenses/${record.id}/commands`,
		{
			data: {
				command: 'recognize',
				expected_version: record.financial_version,
				reason: 'E2E evidence reviewed',
			},
		}
	);
	expect(recognizeResponse.status(), await recognizeResponse.text()).toBe(200);
	const recognized = (await recognizeResponse.json()).data as {
		recognition_state: string;
		financial_version: number;
		recognized_amount: number;
	};
	expect(recognized.recognition_state).toBe('recognized');
	expect(recognized.financial_version).toBe(2);
	// Gross 1180 with 180 evidenced recoverable tax recognizes 1000 of cost.
	expect(recognized.recognized_amount).toBe(API_CREATED.recognized);

	// Durable evidence: state, version, adjustment, actor, and journal.
	const stored = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version, recognized_amount,
              recognition_period, period_basis, recognized_by, recognized_at,
              tax_treatment, tax_evidence_reference
         FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(stored[0].recognition_state).toBe('recognized');
	expect(Number(stored[0].financial_version)).toBe(2);
	expect(Number(stored[0].recognized_amount)).toBe(API_CREATED.recognized);
	expect(String(stored[0].recognition_period).slice(0, 10)).toBe(
		`${API_MONTH}-01`
	);
	expect(stored[0].period_basis).toBe('service_period');
	expect(Number(stored[0].recognized_by)).toBeGreaterThan(0);
	expect(stored[0].recognized_at).toBeTruthy();
	expect(stored[0].tax_treatment).toBe('recoverable');
	expect(stored[0].tax_evidence_reference).toBe('GST-EVID-API');

	const events = await rows<{
		version: number;
		command: string;
		reason: string | null;
	}>(
		`SELECT version, command, reason FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[record.cost_uid]
	);
	expect(events.map((row) => row.version)).toEqual([1, 2]);
	expect(events[0].command).toBe('recorded');
	expect(events[1].command).toBe('recognized');
	expect(events[1].reason).toBe('E2E evidence reviewed');

	// The cost appears once, in its own service month.
	const after = await reconciliation(request, API_MONTH);
	expect(after.company.incurred_cost).toBe(API_CREATED.recognized);
	expect(group(after, 'incurred_project_cost')).toBe(API_CREATED.recognized);
	expect(group(after, 'company_overhead')).toBe(0);
	expect(group(after, 'unallocated_cost')).toBe(0);
	expect(after.projects).toHaveLength(1);
	expect(after.projects[0].incurred_cost).toBe(API_CREATED.recognized);

	// A stale version is refused and changes nothing.
	const replay = await request.post(
		`/api/admin/expenses/${record.id}/commands`,
		{ data: { command: 'recognize', expected_version: 1 } }
	);
	expect(replay.status()).toBe(409);
	const replayBody = await replay.json();
	expect(replayBody.code ?? replayBody.error_code).toBeTruthy();
	const afterReplay = await reconciliation(request, API_MONTH);
	expect(afterReplay.company.incurred_cost).toBe(API_CREATED.recognized);

	evidence.apiRecorded = {
		expenseNumber: record.expense_number,
		costUid: record.cost_uid,
		expected: API_CREATED,
		observedState: recognized,
		events: events.map((row) => ({
			version: row.version,
			command: row.command,
		})),
		monthTotal: after.company.incurred_cost,
		staleVersionStatus: replay.status(),
	};
});

test('uses a service period end even when its start is not recorded', async ({
	request,
}, testInfo) => {
	const sourceReference = `E2E-INV-PARTIAL-${testInfo.retry}`;
	const response = await request.post('/api/admin/expenses', {
		data: {
			category: EXPENDITURE_CATEGORY,
			description: 'E2E service period end without start',
			vendor_name: `${EXPENDITURE_VENDOR_PREFIX}partial`,
			expense_date: PARTIAL_PERIOD.billDate,
			cost_classification: 'unallocated',
			service_period_end: PARTIAL_PERIOD.end,
			bill_date: PARTIAL_PERIOD.billDate,
			currency: 'INR',
			gross_amount: PARTIAL_PERIOD.gross,
			tax_treatment: 'none',
			source_reference: sourceReference,
			evidence_reference: 'E2E-GRN-PARTIAL',
			submit: true,
		},
	});
	expect(response.status(), await response.text()).toBe(200);
	const record = (await response.json()).data as {
		id: number;
		cost_uid: string;
		recognition_period: string;
		period_basis: string;
	};
	created.push({
		id: record.id,
		cost_uid: record.cost_uid,
		where: 'partial-period',
	});

	// The end of the received-work period decides the month — not the later bill
	// date — and the basis discloses that the start is not recorded.
	expect(record.recognition_period).toBe(`${API_MONTH}-01`);
	expect(record.period_basis).toBe('service_period_end');

	const stored = await rows<Record<string, unknown>>(
		`SELECT service_period_start, service_period_end, recognition_period,
              period_basis, total_amount
         FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(stored[0].service_period_start).toBeNull();
	expect(String(stored[0].service_period_end).slice(0, 10)).toBe(
		PARTIAL_PERIOD.end
	);
	expect(String(stored[0].recognition_period).slice(0, 10)).toBe(
		`${API_MONTH}-01`
	);
	expect(stored[0].period_basis).toBe('service_period_end');
	expect(Number(stored[0].total_amount)).toBe(PARTIAL_PERIOD.gross);

	// The drilldown and the coverage notice disclose the partial period; the
	// cost is not silently attributed to the bill date's month.
	const queue = await drilldown(request, {
		month: API_MONTH,
		state: 'pending_evidence',
	});
	const row = queue.records.find(
		(entry) => entry.source_reference === sourceReference
	)!;
	expect(row.period_basis).toBe('service_period_end');
	expect(row.exceptions).toContain('service_period_start_missing');
	expect(coverageCodes(await reconciliation(request, API_MONTH))).toContain(
		'service_period_start_missing'
	);

	evidence.partialPeriod = {
		expectedEnd: PARTIAL_PERIOD.end,
		billDate: PARTIAL_PERIOD.billDate,
		recognitionPeriod: record.recognition_period,
		periodBasis: record.period_basis,
		exceptions: row.exceptions,
	};
});

test('recognizes a cost through the real report controls', async ({ page }) => {
	await openExpenditure(page, UI_MONTH_LABEL);
	await expect(page.getByTestId('expenditure-view')).toContainText(
		UI_MONTH_LABEL
	);

	// Any cost already in this month stays visible as a delta, so the run is
	// safe on a shared database without weakening the exact row assertions.
	const companyBefore = await kpi(page, 'kpi-incurred-cost');
	const overheadBefore = await kpi(page, 'kpi-overhead');

	await page.getByRole('button', { name: 'Record cost', exact: true }).click();
	const form = page.getByTestId('cost-form');
	await expect(form).toBeVisible();
	await form
		.getByLabel('Classification', { exact: true })
		.selectOption('company_overhead');
	await form
		.getByLabel('Source reference', { exact: true })
		.fill('E2E-INV-UI-1');
	await form
		.getByLabel('Vendor', { exact: true })
		.fill(`${EXPENDITURE_VENDOR_PREFIX}ui`);
	await form
		.getByLabel('Description', { exact: true })
		.fill('E2E cost entered in the browser');
	await form
		.getByLabel('Service period start', { exact: true })
		.fill(`${UI_MONTH}-03`);
	await form
		.getByLabel('Service period end', { exact: true })
		.fill(`${UI_MONTH}-03`);
	await form.getByLabel('Bill date', { exact: true }).fill(`${UI_MONTH}-05`);
	await form
		.getByLabel('Gross amount', { exact: true })
		.fill(String(UI_CREATED.gross));
	await form.getByLabel('Tax treatment', { exact: true }).selectOption('none');
	await form
		.getByLabel('Evidence reference', { exact: true })
		.fill('E2E-GRN-UI-1');
	await form
		.getByRole('button', { name: 'Save and submit', exact: true })
		.click();
	await expect(form).toBeHidden();

	// The entry lands in the review queue with its period and amount, and the
	// company total still excludes it.
	const queue = page.getByTestId('recognition-queue');
	const row = queue.locator(
		'[data-testid="queue-row"][data-source-reference="E2E-INV-UI-1"]'
	);
	await expect(row).toBeVisible();
	await expect(row).toContainText('E2E-INV-UI-1');
	await expect(row).toHaveAttribute('data-state', 'pending_evidence');
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(companyBefore);

	const queued = await rows<Record<string, unknown>>(
		`SELECT id, cost_uid, financial_version, recognition_state, recognition_period,
              period_basis, total_amount
       FROM expenses WHERE source_reference = ? AND isDelete = 0`,
		['E2E-INV-UI-1']
	);
	expect(queued).toHaveLength(1);
	expect(queued[0].recognition_state).toBe('pending_evidence');
	expect(Number(queued[0].financial_version)).toBe(1);
	expect(Number(queued[0].total_amount)).toBe(UI_CREATED.gross);
	expect(String(queued[0].recognition_period).slice(0, 10)).toBe(
		`${UI_MONTH}-01`
	);
	expect(queued[0].period_basis).toBe('service_period');
	const createdId = Number(queued[0].id);
	created.push({
		id: createdId,
		cost_uid: String(queued[0].cost_uid),
		where: 'ui',
	});

	await row.getByRole('button', { name: 'Recognize', exact: true }).click();
	const dialog = page.getByTestId('command-dialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E evidence reviewed');
	await dialog
		.getByRole('button', { name: 'Recognize expense', exact: true })
		.click();
	await expect(dialog).toBeHidden();

	// The recognized cost now counts once in Company Overhead.
	await expect
		.poll(async () => kpi(page, 'kpi-overhead'), { timeout: 10_000 })
		.toBe(overheadBefore + UI_CREATED.recognized);
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(
		companyBefore + UI_CREATED.recognized
	);

	const stored = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version, recognized_amount, recognized_by,
              recognition_period, period_basis
       FROM expenses WHERE id = ?`,
		[createdId]
	);
	expect(stored[0].recognition_state).toBe('recognized');
	expect(Number(stored[0].financial_version)).toBe(2);
	expect(Number(stored[0].recognized_amount)).toBe(UI_CREATED.recognized);
	expect(Number(stored[0].recognized_by)).toBeGreaterThan(0);
	expect(String(stored[0].recognition_period).slice(0, 10)).toBe(
		`${UI_MONTH}-01`
	);

	const events = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM financial_cost_events
      WHERE source_table = 'expenses' AND source_id = ? ORDER BY version`,
		[createdId]
	);
	expect(events.map((event) => event.version)).toEqual([1, 2]);
	expect(events[1].command).toBe('recognized');

	evidence.uiRecorded = {
		month: UI_MONTH,
		expected: UI_CREATED,
		observedOverheadDelta: UI_CREATED.recognized,
		state: stored[0].recognition_state,
		version: Number(stored[0].financial_version),
		events: events.map((event) => ({
			version: event.version,
			command: event.command,
		})),
	};
});

test('corrects a pending cost through the report and refuses register edits', async ({
	page,
	request,
}) => {
	// A cost with no amount, no destination, and no period: the pending-evidence
	// state the workflow must let an operator complete in place, not cancel and
	// re-record.
	const createResponse = await request.post('/api/admin/expenses', {
		data: {
			category: EXPENDITURE_CATEGORY,
			description: 'E2E cost completed through the report',
			vendor_name: `${EXPENDITURE_VENDOR_PREFIX}edit`,
			expense_date: `${UI_MONTH}-08`,
			currency: 'INR',
			submit: true,
			source_reference: 'E2E-INV-UI-EDIT',
		},
	});
	expect(createResponse.status(), await createResponse.text()).toBe(200);
	const record = (await createResponse.json()).data as {
		id: number;
		cost_uid: string;
		recognition_state: string;
		financial_version: number;
	};
	created.push({ id: record.id, cost_uid: record.cost_uid, where: 'ui-edit' });
	expect(record.recognition_state).toBe('pending_evidence');
	expect(record.financial_version).toBe(1);

	// The register edit path refuses the versioned financial fields and writes
	// nothing, so an edit cannot slip behind a later command's version check;
	// operational fields still edit there.
	const registerEdit = await request.put(`/api/admin/expenses/${record.id}`, {
		data: { amount: 50, total_amount: 50, status: 'approved' },
	});
	expect(registerEdit.status()).toBe(422);
	const refusal = await registerEdit.json();
	expect(refusal.code).toBe('financial_fields_versioned');
	expect([...refusal.fields].sort()).toEqual(['amount', 'total_amount']);
	const untouched = await rows<Record<string, unknown>>(
		`SELECT financial_version, total_amount FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(Number(untouched[0].financial_version)).toBe(1);
	expect(untouched[0].total_amount).toBeNull();
	const operationalEdit = await request.put(
		`/api/admin/expenses/${record.id}`,
		{ data: { notes: 'E2E operational edit' } }
	);
	expect(operationalEdit.status(), await operationalEdit.text()).toBe(200);

	// The operator completes it through the report's edit control, which saves
	// the versioned `update` command with its own journal entry.
	await openExpenditure(page, UI_MONTH_LABEL);
	const queueRow = page.locator(
		'[data-testid="queue-row"][data-source-reference="E2E-INV-UI-EDIT"]'
	);
	await expect(queueRow).toBeVisible();
	await queueRow.getByTestId('queue-edit').click();
	const dialog = page.getByTestId('cost-edit-dialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByLabel('Classification', { exact: true })
		.selectOption('company_overhead');
	await dialog
		.getByLabel('Gross amount', { exact: true })
		.fill(String(UI_EDITED.gross));
	await dialog
		.getByLabel('Service period start', { exact: true })
		.fill(`${UI_MONTH}-06`);
	await dialog
		.getByLabel('Service period end', { exact: true })
		.fill(`${UI_MONTH}-06`);
	await dialog
		.getByLabel('Tax treatment', { exact: true })
		.selectOption('none');
	await dialog
		.getByLabel('Evidence reference', { exact: true })
		.fill('E2E-GRN-UI-EDIT');
	await dialog
		.getByRole('button', { name: 'Save changes', exact: true })
		.click();
	await expect(dialog).toBeHidden();

	const edited = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version, total_amount, amount,
              recognition_period, period_basis, cost_classification
         FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(Number(edited[0].financial_version)).toBe(2);
	expect(Number(edited[0].total_amount)).toBe(UI_EDITED.gross);
	expect(Number(edited[0].amount)).toBe(UI_EDITED.gross);
	expect(edited[0].recognition_state).toBe('pending_evidence');
	expect(String(edited[0].recognition_period).slice(0, 10)).toBe(
		`${UI_MONTH}-01`
	);
	expect(edited[0].period_basis).toBe('service_period');
	expect(edited[0].cost_classification).toBe('company_overhead');
	const events = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM financial_cost_events
      WHERE source_table = 'expenses' AND source_id = ? ORDER BY version`,
		[record.id]
	);
	expect(events.map((event) => event.version)).toEqual([1, 2]);
	expect(events[1].command).toBe('updated');

	// The completed row now recognizes from the queue, once.
	await queueRow
		.getByRole('button', { name: 'Recognize', exact: true })
		.click();
	const commandDialog = page.getByTestId('command-dialog');
	await expect(commandDialog).toBeVisible();
	await commandDialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E evidence completed');
	await commandDialog
		.getByRole('button', { name: 'Recognize expense', exact: true })
		.click();
	await expect(commandDialog).toBeHidden();
	const finalized = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version, recognized_amount
       FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(finalized[0].recognition_state).toBe('recognized');
	expect(Number(finalized[0].financial_version)).toBe(3);
	expect(Number(finalized[0].recognized_amount)).toBe(UI_EDITED.gross);
	await expect(queueRow).toHaveCount(0);

	evidence.editedCost = {
		expected: UI_EDITED,
		registerRefusal: {
			status: registerEdit.status(),
			code: refusal.code,
			fields: refusal.fields,
		},
		events: events.map((event) => ({
			version: event.version,
			command: event.command,
		})),
		state: finalized[0].recognition_state,
	};
});

test('drills from a project into its source records', async ({
	page,
	request,
}) => {
	await openExpenditure(page, MONTH_LABEL);
	const row = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${EXPENDITURE_PROJECTS.alpha.code}"]`
	);
	await expect(row).toBeVisible();
	expect(Number(await row.getAttribute('data-project-cost'))).toBe(
		JANUARY.alpha
	);

	await row.getByTestId('project-expand').click();
	const panel = page.getByTestId('project-drilldown');
	await expect(panel).toBeVisible();
	const records = panel.locator('[data-testid="drilldown-record"]');
	await expect(records).toHaveCount(2);
	const sources = await records.evaluateAll((elements) =>
		elements.map((element) => element.getAttribute('data-source-reference'))
	);
	expect(sources.sort()).toEqual(['E2E-INV-0001', 'E2E-INV-0002']);

	// The API drilldown returns the same two records with their evidence.
	const data = await drilldown(request, {
		month: MONTH,
		project_id: String(seeded.projects.alpha),
		state: 'recognized',
	});
	const invoices = data.records.map((record) => record.source_reference).sort();
	expect(invoices).toEqual(['E2E-INV-0001', 'E2E-INV-0002']);
	expect(data.totals.confirmed_amount).toBe(JANUARY.alpha);
	const recoverable = data.records.find(
		(record) => record.source_reference === 'E2E-INV-0001'
	)!;
	expect(recoverable.gross_amount).toBe(1180);
	expect(recoverable.recognized_amount).toBe(1000);
	expect(recoverable.evidence_reference).toBe('E2E-GRN-0001');
	expect(recoverable.cost_uid).toBe(seededCost('projectRecoverable').costUid);

	evidence.drilldown = {
		project: EXPENDITURE_PROJECTS.alpha.code,
		sources,
		confirmed: data.totals.confirmed_amount,
		recoverable: {
			gross: recoverable.gross_amount,
			recognized: recoverable.recognized_amount,
		},
	};
});

test('rejects malformed pagination instead of failing in SQL', async ({
	request,
}) => {
	const rejected = ['limit=abc', 'limit=0', 'limit=9999', 'offset=-1'];
	for (const query of rejected) {
		const response = await request.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${MONTH}&${query}`
		);
		expect(response.status(), query).toBe(400);
		expect((await response.json()).success, query).toBe(false);
	}
	// A valid page still reads and states the page it returned.
	const data = await drilldown(request, {
		month: MONTH,
		limit: '2',
		offset: '1',
	});
	expect(data.limit).toBe(2);
	expect(data.offset).toBe(1);
	expect(data.records.length).toBeLessThanOrEqual(2);

	evidence.pagination = {
		rejected,
		page: {
			limit: data.limit,
			offset: data.offset,
			records: data.records.length,
		},
	};
});

test('refuses unauthorized reads and writes without changing data', async ({
	playwright,
}) => {
	const employee = await playwright.request.newContext({
		baseURL: E2E_ENV.baseURL,
		storageState: 'e2e/.auth/employee.json',
	});
	try {
		const read = await employee.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${MONTH}`
		);
		expect(read.status()).toBe(403);
		const drill = await employee.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${MONTH}`
		);
		expect(drill.status()).toBe(403);
		const write = await employee.post('/api/admin/expenses', {
			data: {
				category: EXPENDITURE_CATEGORY,
				vendor_name: `${EXPENDITURE_VENDOR_PREFIX}unauthorized`,
				expense_date: '2019-01-30',
				cost_classification: 'unallocated',
				gross_amount: 1,
				source_reference: 'E2E-INV-UNSAFE',
			},
		});
		expect(write.status()).toBe(403);
		const command = await employee.post(
			`/api/admin/expenses/${seeded.expenseIds.pendingEvidence}/commands`,
			{ data: { command: 'recognize', expected_version: 1 } }
		);
		expect(command.status()).toBe(403);

		const untouched = await rows<Record<string, unknown>>(
			`SELECT recognition_state, financial_version FROM expenses WHERE id = ?`,
			[seeded.expenseIds.pendingEvidence]
		);
		expect(untouched[0].recognition_state).toBe('pending_evidence');
		expect(Number(untouched[0].financial_version)).toBe(1);

		// A report reader without the expense ledger's source privilege may open
		// the report's employee-cost views, but must receive neither the
		// reconciliation nor the drilldown — not even the months that carry
		// direct cost (parent spec §149: source authorization and financial
		// privileges, not report access alone).
		const reader = await loginExpenditureReportOnlyReader(
			playwright,
			E2E_ENV.baseURL
		);
		try {
			const report = await reader.get(
				`/api/reports/employee-project-monthly-cost?view=expenditure&month=${MONTH}`
			);
			expect(report.status()).toBe(403);
			const reportBody = JSON.stringify(await report.json());
			expect(reportBody).not.toContain(String(JANUARY.total));
			expect(reportBody).not.toContain('E2E-INV');

			const readerDrill = await reader.get(
				`/api/reports/employee-project-monthly-cost/expenses?month=${MONTH}`
			);
			expect(readerDrill.status()).toBe(403);
			const drillBody = JSON.stringify(await readerDrill.json());
			expect(drillBody).not.toContain('E2E-INV');

			const meta = await reader.get(
				'/api/reports/employee-project-monthly-cost'
			);
			expect(meta.status()).toBe(200);
			expect((await meta.json()).meta.expenditure_months).toEqual([]);

			const monthly = await reader.get(
				`/api/reports/employee-project-monthly-cost?view=monthly&month=${MONTH}`
			);
			expect(monthly.status()).toBe(200);

			evidence.authorization = {
				read: read.status(),
				drilldown: drill.status(),
				write: write.status(),
				command: command.status(),
				unchanged: untouched[0],
				reportOnlyReader: {
					reconciliation: report.status(),
					drilldown: readerDrill.status(),
					metaExpenditureMonths: [],
					monthlyView: monthly.status(),
				},
			};
		} finally {
			await reader.dispose();
		}
	} finally {
		await employee.dispose();
	}
});

test('shows the access panel instead of financial cost to an employee session', async ({
	browser,
}) => {
	const context = await browser.newContext({
		storageState: 'e2e/.auth/employee.json',
		extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.22' },
	});
	const page = await context.newPage();
	try {
		await page.goto('/reports/employee-project-monthly-cost');
		await expect(page.getByTestId('access-denied')).toBeVisible();
		await expect(page.getByText('13,410')).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	const artifact = readArtifact('expense-reconciliation');
	expect(artifact).toMatchObject({
		ok: true,
		month: MONTH,
	});
	expect(artifact.january).toBeTruthy();
	expect(artifact.apiRecorded).toBeTruthy();
	expect(artifact.uiRecorded).toBeTruthy();
	expect(artifact.coverage).toBeTruthy();
});
