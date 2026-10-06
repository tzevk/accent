import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	BUDGET_MONTH,
	EXPENDITURE_BUDGET_UID_PREFIX,
	EXPENDITURE_COSTS,
	EXPENDITURE_MONTH,
	EXPENDITURE_NEXT_MONTH,
	EXPENDITURE_PROJECTS,
	cleanupExpenditureFixtures,
	loginExpenditureReportOnlyReader,
	seedExpenditureFixtures,
	seededBudget,
	type SeededExpenditure,
} from '../lib/expenditure-fixtures';

/**
 * Ticket #321 — approved Project cost budgets compared with incurred cost.
 *
 * The spec states its own expectations from the fixture literals: a budget row
 * says what was approved, the expense rows say what the Project cost, and the
 * assertions check the report's interpretation against that arithmetic —
 * never against the module's own aggregation.
 *
 * Budgets live in their own store, so nothing here may move a cost total:
 * every test that reads the reconciliation re-derives the company figures from
 * `EXPENDITURE_COSTS` and asserts they are unchanged.
 *
 * One case depends on another slice's fixtures: the charge-only August month
 * (#317) seeds alpha's supported approved period charges in 2019-08 and no
 * operating expense, so that row exists only when the charge source is
 * integrated. `e2e-budget-0011` is the exact August budget it is measured
 * against.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.41' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = EXPENDITURE_MONTH;
const NEXT_MONTH = EXPENDITURE_NEXT_MONTH;
const BUDGET = BUDGET_MONTH;
const BUDGET_LABEL = 'June 2019';
/** #317's charge-only month: no operating direct cost, real period charges. */
const CHARGE_MONTH = '2019-08';

/**
 * Recognized fixture cost for one Project in one currency and month, summed
 * from the seeded literals — the independent expectation the report must meet.
 */
function fixtureCost(
	project: keyof typeof EXPENDITURE_PROJECTS,
	month: string,
	currency: string
): number {
	return EXPENDITURE_COSTS.filter(
		(cost) =>
			cost.project === project &&
			cost.recognitionMonth === month &&
			cost.currency === currency &&
			cost.state === 'recognized' &&
			cost.recognizedAmount !== null
	).reduce((total, cost) => total + Number(cost.recognizedAmount), 0);
}

/** Every recognized fixture cost of a month, whatever its destination. */
function fixtureMonthTotal(month: string): number {
	return EXPENDITURE_COSTS.filter(
		(cost) =>
			cost.recognitionMonth === month &&
			cost.state === 'recognized' &&
			cost.recognizedAmount !== null
	).reduce((total, cost) => total + Number(cost.recognizedAmount), 0);
}

const JANUARY_ALPHA = fixtureCost('alpha', MONTH, 'INR');
const JANUARY_BETA = fixtureCost('beta', MONTH, 'INR');
const JANUARY_TOTAL = fixtureMonthTotal(MONTH);

const APPROVED = seededBudget('alphaApproved');
const FEB_BUDGET = seededBudget('alphaFebUsd');
const PERIOD_BUDGET = seededBudget('gammaPeriod');
const SCOPE_BUDGET = seededBudget('gammaScope');
const PENDING_BUDGET = seededBudget('gammaPending');
const CURRENCY_BUDGET = seededBudget('betaJuneUsd');
const ANNUAL_BUDGET = seededBudget('deltaAnnual');
const PARTIAL_BUDGET = seededBudget('deltaPartialUsd');
const AUGUST_BUDGET = seededBudget('alphaAugust');

/** What the browser workflow records and approves. */
const UI_BUDGET = {
	currency: 'INR',
	scope: 'project_incurred_cost',
	amount: 5000,
	periodStart: `${BUDGET}-01`,
	periodEnd: `${BUDGET}-30`,
	evidence: 'E2E-BUDGET-EVID-UI',
} as const;
/** The API-created superseding budget: an exact June period, like the first. */
const API_BUDGET = {
	currency: 'INR',
	scope: 'project_incurred_cost',
	amount: 6000,
	periodStart: `${BUDGET}-01`,
	periodEnd: `${BUDGET}-30`,
	evidence: 'E2E-BUDGET-EVID-SUPERSEDE',
} as const;

interface BudgetCandidate {
	budget_id: number;
	budget_uid: string;
	state: string;
	currency: string;
	scope: string;
	amount: number;
	period_start: string;
	period_end: string;
	financial_version: number;
	approval_evidence_reference: string | null;
	approved_at: string | null;
}

interface BudgetComparison {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	currency: string;
	incurred_cost: number | null;
	confirmed_records: number;
	pending_records: number;
	period_charges: number;
	outcome: string;
	budget: BudgetCandidate | null;
	candidates: BudgetCandidate[];
	variance: number | null;
	over_budget: boolean | null;
	detail: string;
}

interface BudgetSectionPayload {
	month: string;
	basis: string;
	variance_note: string;
	comparisons: BudgetComparison[];
	notices: Array<{ code: string; label: string; detail: string; severity: string }>;
}

interface ReconciliationData {
	month: string;
	month_label: string;
	project_id: number | null;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: Array<{ currency: string; incurred_cost: number }>;
		groups: Array<{ key: string; amount: number }>;
		record_count: number;
	};
	projects: Array<{
		project_id: number;
		project_code: string;
		currency: string;
		incurred_cost: number;
	}>;
	budgets: BudgetSectionPayload;
	project_options: Array<{ project_id: number; project_code: string }>;
	available_months: string[];
}

interface BudgetRow {
	id: number;
	budget_uid: string;
	project_id: number;
	project_code: string;
	currency: string;
	amount: number;
	scope: string;
	state: string;
	period_start: string;
	period_end: string;
	basis_note: string | null;
	approval_evidence_reference: string | null;
	financial_version: number;
	approved_by: number | null;
	approved_at: string | null;
}

interface BudgetJournalEntry {
	version: number;
	command: string;
	actor_user_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
	created_at: string;
}

interface BudgetListData {
	project_id: number;
	budgets: BudgetRow[];
}

interface BudgetDetailData {
	budget: BudgetRow;
	journal: BudgetJournalEntry[];
}

interface CommandResult {
	id: number;
	budget_uid: string;
	state: string;
	financial_version: number;
	component: string;
}

let seeded: SeededExpenditure;
let uiBudgetId = 0;
let uiBudgetUid = '';
let apiBudgetId = 0;
let apiBudgetUid = '';
const evidence: Record<string, unknown> = { ok: true, month: MONTH };
/** Budget ids this spec creates through the app, cleaned up in `afterAll`. */
const created: number[] = [];

function publish(): void {
	writeArtifact('project-cost-budgets', {
		...evidence,
		fixtureScope: {
			projects: Object.values(EXPENDITURE_PROJECTS).map((p) => p.code),
			months: [MONTH, NEXT_MONTH, BUDGET],
			budgetPrefix: EXPENDITURE_BUDGET_UID_PREFIX,
			seededBudgetUids: [
				'alphaApproved',
				'alphaFebUsd',
				'gammaPeriod',
				'gammaScope',
				'gammaPending',
				'gammaAmbiguousA',
				'gammaAmbiguousB',
				'betaJuneUsd',
				'deltaAnnual',
				'deltaPartialUsd',
				'alphaAugust',
			].map((key) => seededBudget(key).budgetUid),
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

function comparison(
	data: ReconciliationData,
	projectCode: string,
	currency: string
): BudgetComparison {
	const found = data.budgets.comparisons.find(
		(row) => row.project_code === projectCode && row.currency === currency
	);
	expect(
		found,
		`budget comparison ${projectCode}/${currency} in ${data.month}`
	).toBeTruthy();
	return found!;
}

function noticeCodes(data: ReconciliationData): string[] {
	return data.budgets.notices.map((notice) => notice.code);
}

/** January's company figures must keep footing to the fixture literals. */
function expectJanuaryUnchanged(data: ReconciliationData): void {
	expect(data.company.incurred_cost).toBe(JANUARY_TOTAL);
	expect(
		data.company.groups.find((group) => group.key === 'incurred_project_cost')
			?.amount
	).toBe(JANUARY_ALPHA + JANUARY_BETA);
}

async function budgetList(
	request: APIRequestContext,
	projectId: number
): Promise<BudgetListData> {
	const response = await request.get(
		`/api/admin/cost-budgets?project_id=${projectId}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as BudgetListData;
}

async function budgetDetail(
	request: APIRequestContext,
	id: number
): Promise<BudgetDetailData> {
	const response = await request.get(`/api/admin/cost-budgets/${id}`);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as BudgetDetailData;
}

async function budgetCommand(
	request: APIRequestContext,
	id: number,
	command: string,
	expectedVersion: number,
	extra: Record<string, unknown> = {}
): Promise<CommandResult> {
	const response = await request.post(`/api/admin/cost-budgets/${id}/commands`, {
		data: { command, expected_version: expectedVersion, ...extra },
	});
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	return body.data as CommandResult;
}

/** Open the report on the expenditure view for one month. */
async function openExpenditure(page: Page, monthLabel: string): Promise<void> {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(monthLabel);
	await page.getByRole('button', { name: monthLabel, exact: true }).click();
	await expect(page.getByTestId('budget-section')).toBeVisible();
}

/** Select one Project in the budget management panel. */
async function selectBudgetProject(page: Page, code: string): Promise<void> {
	await page.getByLabel('Project', { exact: true }).last().click();
	await page.getByPlaceholder('Search...').fill(code);
	await page
		.getByRole('button', { name: new RegExp(`^${code}`), exact: false })
		.click();
}

test.beforeAll(async () => {
	seeded = await seedExpenditureFixtures();
	evidence.seeded = {
		costs: seeded.costs,
		budgets: seeded.budgets,
		projects: seeded.projects,
		budgetIds: seeded.budgetIds,
	};
});

test.afterAll(async () => {
	publish();
	if (created.length) {
		const placeholders = created.map(() => '?').join(', ');
		await exec(
			`DELETE FROM project_cost_budget_events
        WHERE source_table = 'project_cost_budgets' AND source_id IN (${placeholders})`,
			created
		);
		await exec(
			`DELETE FROM project_cost_budgets WHERE id IN (${placeholders})`,
			created
		);
	}
	await cleanupExpenditureFixtures();
});

test('compares only an approved budget of matching scope and currency', async ({
	request,
}) => {
	// The fixture literals the assertions rest on, restated so a silent fixture
	// edit fails loudly here instead of weakening the checks.
	expect(JANUARY_ALPHA).toBe(3500);
	expect(JANUARY_BETA).toBe(4720);
	expect(JANUARY_TOTAL).toBe(13410);

	const january = await reconciliation(request, MONTH);
	expect(january.budgets.month).toBe(MONTH);
	expect(january.budgets.basis).toContain('approved cost budget');
	expect(january.budgets.variance_note).toContain('not profit');

	// alpha: the approved INR budget covers January and matches the row.
	const alpha = comparison(january, EXPENDITURE_PROJECTS.alpha.code, 'INR');
	expect(alpha.incurred_cost).toBe(JANUARY_ALPHA);
	expect(alpha.incurred_cost).toBe(fixtureCost('alpha', MONTH, 'INR'));
	expect(alpha.outcome).toBe('compared');
	expect(alpha.budget?.budget_uid).toBe(APPROVED.budgetUid);
	expect(alpha.budget?.amount).toBe(Number(APPROVED.amount));
	expect(alpha.budget?.state).toBe('approved');
	expect(alpha.budget?.approval_evidence_reference).toBe(
		APPROVED.approvalEvidence
	);
	expect(alpha.budget?.financial_version).toBe(APPROVED.financialVersion);
	expect(alpha.variance).toBe(Number(APPROVED.amount) - JANUARY_ALPHA);
	expect(alpha.variance).toBe(1500);
	expect(alpha.over_budget).toBe(false);
	expect(alpha.detail).toContain(APPROVED.approvalEvidence as string);

	// beta: nothing was ever approved, so the report says so instead of
	// inventing a budget from the Project's commercial fields.
	const beta = comparison(january, EXPENDITURE_PROJECTS.beta.code, 'INR');
	expect(beta.incurred_cost).toBe(JANUARY_BETA);
	expect(beta.outcome).toBe('missing');
	expect(beta.budget).toBeNull();
	expect(beta.variance).toBeNull();
	expect(beta.over_budget).toBeNull();
	expect(beta.detail).toContain('No approved cost budget');

	expect(noticeCodes(january)).toContain('budget_missing');
	expect(noticeCodes(january)).toContain('budget_variance_not_profit');
	// The Project's commercial value is not a cost budget: it appears nowhere
	// in the section, for any Project.
	expect(JSON.stringify(january.budgets)).not.toContain('999999');
	expectJanuaryUnchanged(january);

	// Budgets never move a cost figure: the January company total is the
	// expense fixtures' own arithmetic, and the persists agree.
	const persisted = await rows<{ total: string }>(
		`SELECT COALESCE(SUM(recognized_amount), 0) AS total FROM expenses
      WHERE isDelete = 0 AND recognition_state = 'recognized'
        AND recognition_period BETWEEN ? AND ?`,
		[`${MONTH}-01`, `${MONTH}-31`]
	);
	expect(Number(persisted[0].total)).toBe(JANUARY_TOTAL);

	evidence.january = {
		expected: {
			alpha: JANUARY_ALPHA,
			beta: JANUARY_BETA,
			total: JANUARY_TOTAL,
			budget: Number(APPROVED.amount),
			variance: Number(APPROVED.amount) - JANUARY_ALPHA,
		},
		observed: { alpha, beta, notices: january.budgets.notices },
	};
});

test('states currency, scope, period, ambiguity, and unsupported cost explicitly', async ({
	request,
}) => {
	const february = await reconciliation(request, NEXT_MONTH);
	const febInr = comparison(february, EXPENDITURE_PROJECTS.alpha.code, 'INR');
	const febUsd = comparison(february, EXPENDITURE_PROJECTS.alpha.code, 'USD');
	const usdBudget = Number(FEB_BUDGET.amount);
	// The USD row compares with the USD budget: same Project, same currency, and
	// the budget's period is exactly February.
	expect(febUsd.incurred_cost).toBe(fixtureCost('alpha', NEXT_MONTH, 'USD'));
	expect(febUsd.outcome).toBe('compared');
	expect(febUsd.budget?.budget_uid).toBe(FEB_BUDGET.budgetUid);
	expect(febUsd.variance).toBe(usdBudget - fixtureCost('alpha', NEXT_MONTH, 'USD'));
	expect(febUsd.variance).toBe(170);
	// The INR row has no February INR budget: January's budget states January's
	// cost, and it is disclosed rather than stretched over another month.
	expect(febInr.incurred_cost).toBe(fixtureCost('alpha', NEXT_MONTH, 'INR'));
	expect(febInr.outcome).toBe('incompatible_period');
	expect(febInr.budget).toBeNull();
	expect(febInr.variance).toBeNull();
	expect(febInr.over_budget).toBeNull();
	expect(febInr.detail).toContain(APPROVED.periodEnd);
	const febCandidateUids = febInr.candidates.map(
		(candidate) => candidate.budget_uid
	);
	expect(febCandidateUids).toContain(APPROVED.budgetUid);
	expect(febCandidateUids).toContain(FEB_BUDGET.budgetUid);
	// Both rows are stated, and neither invents a conversion or a proportional
	// share of a budget that covers other months.
	expect(noticeCodes(february)).not.toContain('budget_incompatible_currency');
	expect(noticeCodes(february)).toContain('budget_incompatible_period');
	expect(noticeCodes(february)).toContain('budget_variance_not_profit');

	const budgetMonth = await reconciliation(request, BUDGET);
	// gamma INR: the only approved INR budget covers January–May.
	const gammaInr = comparison(budgetMonth, EXPENDITURE_PROJECTS.gamma.code, 'INR');
	expect(gammaInr.incurred_cost).toBe(fixtureCost('gamma', BUDGET, 'INR'));
	expect(gammaInr.outcome).toBe('incompatible_period');
	expect(gammaInr.budget).toBeNull();
	expect(gammaInr.variance).toBeNull();
	expect(gammaInr.detail).toContain(PERIOD_BUDGET.periodEnd);
	expect(gammaInr.candidates.map((c) => c.budget_uid)).toContain(
		PERIOD_BUDGET.budgetUid
	);

	// gamma USD: the approved budget declares a commercial value, not a cost.
	const gammaUsd = comparison(budgetMonth, EXPENDITURE_PROJECTS.gamma.code, 'USD');
	expect(gammaUsd.incurred_cost).toBe(fixtureCost('gamma', BUDGET, 'USD'));
	expect(gammaUsd.outcome).toBe('incompatible_scope');
	expect(gammaUsd.budget).toBeNull();
	expect(gammaUsd.variance).toBeNull();
	expect(gammaUsd.detail).toContain('commercial');
	const scopeCandidate = gammaUsd.candidates.find(
		(candidate) => candidate.budget_uid === SCOPE_BUDGET.budgetUid
	);
	expect(scopeCandidate?.scope).toBe('commercial_value');
	expect(scopeCandidate?.state).toBe('approved');

	// gamma EUR: an approved budget exists, but its cost is not recognized
	// yet, so nothing is compared against a guessed zero.
	const gammaEur = comparison(budgetMonth, EXPENDITURE_PROJECTS.gamma.code, 'EUR');
	expect(gammaEur.incurred_cost).toBe(0);
	expect(gammaEur.pending_records).toBe(1);
	expect(gammaEur.outcome).toBe('unsupported_incurred_cost');
	expect(gammaEur.budget?.budget_uid).toBe(PENDING_BUDGET.budgetUid);
	expect(gammaEur.variance).toBeNull();

	// gamma GBP: two approved budgets cover the same month and currency; the
	// report refuses to pick one.
	const gammaGbp = comparison(budgetMonth, EXPENDITURE_PROJECTS.gamma.code, 'GBP');
	expect(gammaGbp.incurred_cost).toBe(fixtureCost('gamma', BUDGET, 'GBP'));
	expect(gammaGbp.outcome).toBe('ambiguous');
	expect(gammaGbp.budget).toBeNull();
	expect(gammaGbp.candidates).toHaveLength(2);
	expect(gammaGbp.variance).toBeNull();

	// beta INR: the only budget approved for this Project is stated in USD, and
	// the report refuses to convert one into the other to force a comparison.
	const betaInr = comparison(budgetMonth, EXPENDITURE_PROJECTS.beta.code, 'INR');
	expect(betaInr.incurred_cost).toBe(fixtureCost('beta', BUDGET, 'INR'));
	expect(betaInr.outcome).toBe('incompatible_currency');
	expect(betaInr.budget).toBeNull();
	expect(betaInr.variance).toBeNull();
	expect(betaInr.over_budget).toBeNull();
	expect(betaInr.detail).toContain(CURRENCY_BUDGET.currency);
	const currencyCandidate = betaInr.candidates.find(
		(candidate) => candidate.budget_uid === CURRENCY_BUDGET.budgetUid
	);
	expect(currencyCandidate?.state).toBe('approved');
	expect(currencyCandidate?.currency).toBe(CURRENCY_BUDGET.currency);
	// The row's own currency exists nowhere in beta's budgets, so the mismatch
	// is the statement — with no converted comparison invented.
	expect(betaInr.candidates).toHaveLength(1);

	// delta INR: the only approved INR budget is annual. It stays visible with
	// its period, and June's cost is never treated as a share of it.
	const deltaInr = comparison(budgetMonth, EXPENDITURE_PROJECTS.delta.code, 'INR');
	expect(deltaInr.incurred_cost).toBe(fixtureCost('delta', BUDGET, 'INR'));
	expect(deltaInr.outcome).toBe('incompatible_period');
	expect(deltaInr.budget).toBeNull();
	expect(deltaInr.variance).toBeNull();
	expect(deltaInr.over_budget).toBeNull();
	expect(deltaInr.detail).toContain(ANNUAL_BUDGET.periodEnd);
	expect(deltaInr.detail).toContain('no proportional allocation');
	expect(deltaInr.candidates.map((c) => c.budget_uid)).toContain(
		ANNUAL_BUDGET.budgetUid
	);

	// delta USD: the only approved USD budget runs from mid-May to mid-June, so
	// it states two months' cost and is disclosed the same way.
	const deltaUsd = comparison(budgetMonth, EXPENDITURE_PROJECTS.delta.code, 'USD');
	expect(deltaUsd.incurred_cost).toBe(fixtureCost('delta', BUDGET, 'USD'));
	expect(deltaUsd.outcome).toBe('incompatible_period');
	expect(deltaUsd.budget).toBeNull();
	expect(deltaUsd.variance).toBeNull();
	expect(deltaUsd.detail).toContain(PARTIAL_BUDGET.periodStart);
	expect(deltaUsd.detail).toContain(PARTIAL_BUDGET.periodEnd);
	expect(deltaUsd.detail).toContain('no proportional allocation');
	expect(deltaUsd.candidates.map((c) => c.budget_uid)).toContain(
		PARTIAL_BUDGET.budgetUid
	);

	// The rule the whole section rests on: a variance exists exactly where a
	// budget's period is this month; everything else states null.
	for (const row of budgetMonth.budgets.comparisons) {
		if (row.outcome === 'compared') {
			expect(row.variance, `${row.project_code}/${row.currency}`).not.toBeNull();
		} else {
			expect(row.variance, `${row.project_code}/${row.currency}`).toBeNull();
			expect(row.over_budget, `${row.project_code}/${row.currency}`).toBeNull();
		}
	}

	const codes = noticeCodes(budgetMonth);
	expect(codes).toContain('budget_incompatible_period');
	expect(codes).toContain('budget_incompatible_scope');
	expect(codes).toContain('budget_incompatible_currency');
	expect(codes).toContain('budget_unsupported_incurred_cost');
	expect(codes).toContain('budget_ambiguous');
	// gamma carries a 999,999 commercial Project value; the approved budgets
	// below are the only figures the section states.
	expect(JSON.stringify(budgetMonth.budgets)).not.toContain('999999');

	evidence.outcomes = {
		february: { inr: febInr, usd: febUsd },
		budgetMonth: {
			inr: gammaInr,
			usd: gammaUsd,
			eur: gammaEur,
			gbp: gammaGbp,
			notices: budgetMonth.budgets.notices,
		},
	};
});

test('compares an approved budget with a charge-only month', async ({
	request,
}) => {
	// alpha's August cost comes entirely from supported period charges (#317):
	// this spec seeds no operating expense in August, so the row exists only
	// because approved period charges are part of Incurred Project Cost. The
	// comparison must therefore be supported, not withheld as an unconfirmed
	// zero, and the budget is an exact August period.
	const august = await reconciliation(request, CHARGE_MONTH);
	const alphaInr = comparison(august, EXPENDITURE_PROJECTS.alpha.code, 'INR');
	expect(alphaInr.period_charges).toBeGreaterThan(0);
	expect(alphaInr.incurred_cost).not.toBeNull();
	expect(alphaInr.incurred_cost!).toBeGreaterThan(0);
	expect(alphaInr.outcome).toBe('compared');
	expect(alphaInr.budget?.budget_uid).toBe(AUGUST_BUDGET.budgetUid);
	expect(alphaInr.budget?.period_start).toBe(AUGUST_BUDGET.periodStart);
	expect(alphaInr.budget?.period_end).toBe(AUGUST_BUDGET.periodEnd);
	const augustBudget = Number(AUGUST_BUDGET.amount);
	const augustIncurred = alphaInr.incurred_cost!;
	expect(alphaInr.variance).toBe(augustBudget - augustIncurred);
	expect(alphaInr.over_budget).toBe(augustIncurred > augustBudget);
	expect(alphaInr.over_budget).toBe(true);

	// Charges are real cost, so the over-budget figure is published (not
	// suppressed) and names the approved August budget it is measured against.
	expect(alphaInr.detail).toContain(AUGUST_BUDGET.approvalEvidence as string);
	expect(noticeCodes(august)).toContain('budget_variance_not_profit');

	// Nothing in the August section claims a share of an annual budget: every
	// published variance belongs to a row whose budget is that month exactly.
	const comparedRows = august.budgets.comparisons.filter(
		(row) => row.outcome === 'compared'
	);
	expect(comparedRows.length).toBeGreaterThan(0);
	expect(comparedRows.every((row) => row.variance !== null)).toBe(true);
	expect(
		august.budgets.comparisons
			.filter((row) => row.outcome !== 'compared')
			.every((row) => row.variance === null)
	).toBe(true);

	evidence.chargeOnly = {
		month: CHARGE_MONTH,
		project: EXPENDITURE_PROJECTS.alpha.code,
		budget: AUGUST_BUDGET.budgetUid,
		period: [AUGUST_BUDGET.periodStart, AUGUST_BUDGET.periodEnd],
		periodCharges: alphaInr.period_charges,
		confirmedRecords: alphaInr.confirmed_records,
		incurred: augustIncurred,
		variance: alphaInr.variance,
		overBudget: alphaInr.over_budget,
		outcome: alphaInr.outcome,
	};
	// The compared-row controls themselves are exercised in the browser for
	// June; August is read through the same response surface the page renders.
});

test('records, submits, and approves a budget through the report controls', async ({
	page,
}) => {
	await openExpenditure(page, BUDGET_LABEL);
	await selectBudgetProject(page, EXPENDITURE_PROJECTS.gamma.code);

	const row = page.locator(
		`[data-testid="budget-comparison-row"]` +
			`[data-project-code="${EXPENDITURE_PROJECTS.gamma.code}"][data-currency="INR"]`
	);
	await expect(row).toHaveAttribute('data-outcome', 'incompatible_period');

	// Record: the form carries Project, amount, currency, scope/period, and the
	// basis note; nothing is approved by recording.
	await page.getByTestId('budget-record-button').click();
	const form = page.getByTestId('budget-form');
	await expect(form).toBeVisible();
	await form.getByLabel('Amount', { exact: true }).fill(String(UI_BUDGET.amount));
	await form
		.getByLabel('Currency', { exact: true })
		.selectOption(UI_BUDGET.currency);
	await form
		.getByLabel('Scope', { exact: true })
		.selectOption(UI_BUDGET.scope);
	await form
		.getByLabel('Period start', { exact: true })
		.fill(UI_BUDGET.periodStart);
	await form
		.getByLabel('Period end', { exact: true })
		.fill(UI_BUDGET.periodEnd);
	await form
		.getByLabel('Basis note', { exact: true })
		.fill('E2E browser workflow cost budget');
	await form.getByTestId('budget-form-submit').click();
	await expect(form).toBeHidden();

	const draftRow = page.locator(
		'[data-testid="budget-row"][data-state="draft"]'
	);
	await expect(draftRow).toHaveCount(1);
	uiBudgetId = Number(await draftRow.getAttribute('data-budget-id'));
	uiBudgetUid = String(await draftRow.getAttribute('data-budget-uid'));
	expect(uiBudgetUid.startsWith(EXPENDITURE_BUDGET_UID_PREFIX)).toBe(true);
	created.push(uiBudgetId);
	// Address the row by its identity from here on: its state changes, and a
	// state-qualified locator would stop matching the moment it does.
	const managedRow = page.locator(
		`[data-testid="budget-row"][data-budget-id="${uiBudgetId}"]`
	);

	// The unapproved budget is visible in the comparison but not compared.
	await expect(row).toHaveAttribute('data-outcome', 'unapproved');
	await expect(row).toHaveAttribute('data-variance', '');
	await expect(row).toContainText('E2E browser workflow cost budget');

	// Submit, then approve with the approval evidence the control requires.
	await managedRow.getByTestId('budget-submit').click();
	await expect(managedRow).toHaveAttribute('data-state', 'submitted');
	await managedRow.getByTestId('budget-approve').click();
	const dialog = page.getByTestId('budget-command-dialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByLabel('Approval evidence', { exact: true })
		.fill(UI_BUDGET.evidence);
	await dialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E finance approval');
	await dialog.getByRole('button', { name: 'Approve budget', exact: true }).click();
	await expect(dialog).toBeHidden();

	await expect(managedRow).toHaveAttribute('data-state', 'approved');
	await expect(managedRow).toHaveAttribute('data-version', '3');

	// The report now compares the approved budget with the recognized cost.
	await expect(row).toHaveAttribute('data-outcome', 'compared');
	await expect(row).toHaveAttribute(
		'data-variance',
		String(UI_BUDGET.amount - fixtureCost('gamma', BUDGET, 'INR'))
	);

	// Persisted state and history, read independently of the response.
	const persisted = await rows<Record<string, unknown>>(
		`SELECT budget_uid, state, financial_version, amount, currency, scope,
            period_start, period_end, approval_evidence_reference, approved_by,
            approved_at
       FROM project_cost_budgets WHERE id = ?`,
		[uiBudgetId]
	);
	expect(persisted[0].budget_uid).toBe(uiBudgetUid);
	expect(persisted[0].state).toBe('approved');
	expect(Number(persisted[0].financial_version)).toBe(3);
	expect(Number(persisted[0].amount)).toBe(UI_BUDGET.amount);
	expect(persisted[0].currency).toBe(UI_BUDGET.currency);
	expect(persisted[0].scope).toBe(UI_BUDGET.scope);
	expect(String(persisted[0].period_start).slice(0, 10)).toBe(
		UI_BUDGET.periodStart
	);
	expect(String(persisted[0].period_end).slice(0, 10)).toBe(UI_BUDGET.periodEnd);
	expect(persisted[0].approval_evidence_reference).toBe(UI_BUDGET.evidence);
	expect(persisted[0].approved_by).toBeTruthy();
	expect(persisted[0].approved_at).toBeTruthy();

	const events = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM project_cost_budget_events
      WHERE source_table = 'project_cost_budgets' AND source_id = ?
      ORDER BY version`,
		[uiBudgetId]
	);
	expect(events.map((event) => event.version)).toEqual([1, 2, 3]);
	expect(events.map((event) => event.command)).toEqual([
		'recorded',
		'submitted',
		'approved',
	]);

	evidence.browserWorkflow = {
		budgetId: uiBudgetId,
		budgetUid: uiBudgetUid,
		expected: UI_BUDGET,
		persisted: persisted[0],
		events,
		comparison: {
			outcome: 'compared',
			variance: UI_BUDGET.amount - fixtureCost('gamma', BUDGET, 'INR'),
		},
	};
});

test('supersedes an earlier approval without erasing its history', async ({
	request,
}) => {
	// A stale command is refused and changes nothing.
	const stale = await request.post(
		`/api/admin/cost-budgets/${uiBudgetId}/commands`,
		{ data: { command: 'approve', expected_version: 1 } }
	);
	expect(stale.status()).toBe(409);
	expect((await stale.json()).code).toBe('stale_version');
	const unchanged = await rows<Record<string, unknown>>(
		`SELECT state, financial_version FROM project_cost_budgets WHERE id = ?`,
		[uiBudgetId]
	);
	expect(unchanged[0].state).toBe('approved');
	expect(Number(unchanged[0].financial_version)).toBe(3);

	// Approving a new version of the same Project/currency/scope supersedes the
	// earlier approved budget that covers the same period.
	const record = await request.post('/api/admin/cost-budgets', {
		data: {
			project_id: seeded.projects.gamma,
			currency: API_BUDGET.currency,
			amount: API_BUDGET.amount,
			scope: API_BUDGET.scope,
			period_start: API_BUDGET.periodStart,
			period_end: API_BUDGET.periodEnd,
			basis_note: 'E2E superseding cost budget',
		},
	});
	expect(record.status(), await record.text()).toBe(201);
	const recordedBudget = (await record.json()).data as BudgetRow;
	apiBudgetId = recordedBudget.id;
	apiBudgetUid = recordedBudget.budget_uid;
	created.push(apiBudgetId);
	expect(recordedBudget.state).toBe('draft');
	expect(recordedBudget.financial_version).toBe(1);
	expect(recordedBudget.amount).toBe(API_BUDGET.amount);

	await budgetCommand(request, apiBudgetId, 'submit', 1);
	await budgetCommand(request, apiBudgetId, 'approve', 2, {
		evidence_reference: API_BUDGET.evidence,
		reason: 'E2E replacement approval',
	});

	const superseded = await rows<Record<string, unknown>>(
		`SELECT state, financial_version, approval_evidence_reference
       FROM project_cost_budgets WHERE id = ?`,
		[uiBudgetId]
	);
	expect(superseded[0].state).toBe('superseded');
	expect(Number(superseded[0].financial_version)).toBe(4);
	expect(superseded[0].approval_evidence_reference).toBe(UI_BUDGET.evidence);

	const history = await budgetDetail(request, uiBudgetId);
	expect(history.budget.state).toBe('superseded');
	expect(history.journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'submitted',
		'approved',
		'superseded',
	]);
	const approvedEntry = history.journal[2];
	expect(approvedEntry.evidence_reference).toBe(UI_BUDGET.evidence);
	expect(history.journal[3].reason).toContain(apiBudgetUid);

	// Both versions remain readable for a later closed-version review.
	const list = await budgetList(request, seeded.projects.gamma);
	const states = Object.fromEntries(
		list.budgets
			.filter((row) => row.budget_uid === uiBudgetUid || row.budget_uid === apiBudgetUid)
			.map((row) => [row.budget_uid, row])
	);
	expect(states[uiBudgetUid]?.state).toBe('superseded');
	expect(states[uiBudgetUid]?.approval_evidence_reference).toBe(
		UI_BUDGET.evidence
	);
	expect(states[apiBudgetUid]?.state).toBe('approved');
	expect(states[apiBudgetUid]?.approval_evidence_reference).toBe(
		API_BUDGET.evidence
	);

	// The report compares the new approved version only.
	const budgetMonth = await reconciliation(request, BUDGET);
	const gammaInr = comparison(budgetMonth, EXPENDITURE_PROJECTS.gamma.code, 'INR');
	expect(gammaInr.outcome).toBe('compared');
	expect(gammaInr.budget?.budget_uid).toBe(apiBudgetUid);
	expect(gammaInr.variance).toBe(
		API_BUDGET.amount - fixtureCost('gamma', BUDGET, 'INR')
	);
	expect(gammaInr.variance).toBe(4800);
	// The superseded version is still disclosed as a candidate.
	expect(
		gammaInr.candidates.map((candidate) => candidate.budget_uid)
	).toContain(uiBudgetUid);

	// Budget activity has not moved any cost figure: January still reconciles
	// to the expense fixtures' own arithmetic.
	const january = await reconciliation(request, MONTH);
	expectJanuaryUnchanged(january);
	expect(comparison(january, EXPENDITURE_PROJECTS.alpha.code, 'INR').variance).toBe(
		Number(APPROVED.amount) - JANUARY_ALPHA
	);

	evidence.supersede = {
		stale: { status: stale.status(), code: 'stale_version', unchanged: unchanged[0] },
		supersededRow: superseded[0],
		journal: history.journal,
		comparison: { budgetUid: apiBudgetUid, variance: gammaInr.variance },
		januaryUnchanged: {
			total: january.company.incurred_cost,
			expected: JANUARY_TOTAL,
		},
	};
});

test('refuses unauthorized budget reads and writes without changing data', async ({
	playwright,
	request,
}) => {
	const before = await rows<{ count: number; version: number }>(
		`SELECT COUNT(*) AS count,
            COALESCE(MAX(financial_version), 0) AS version
       FROM project_cost_budgets WHERE project_id = ?`,
		[seeded.projects.gamma]
	);

	const employee = await playwright.request.newContext({
		baseURL: E2E_ENV.baseURL,
		storageState: 'e2e/.auth/employee.json',
	});
	try {
		const list = await employee.get(
			`/api/admin/cost-budgets?project_id=${seeded.projects.gamma}`
		);
		expect(list.status()).toBe(403);
		const write = await employee.post('/api/admin/cost-budgets', {
			data: {
				project_id: seeded.projects.gamma,
				currency: 'INR',
				amount: 1,
				scope: 'project_incurred_cost',
				period_start: `${BUDGET}-01`,
				period_end: `${BUDGET}-30`,
			},
		});
		expect(write.status()).toBe(403);
		const approve = await employee.post(
			`/api/admin/cost-budgets/${apiBudgetId}/commands`,
			{ data: { command: 'withdraw', expected_version: 3, reason: 'E2E' } }
		);
		expect(approve.status()).toBe(403);
		const detail = await employee.get(`/api/admin/cost-budgets/${apiBudgetId}`);
		expect(detail.status()).toBe(403);

		const after = await rows<{ count: number; version: number }>(
			`SELECT COUNT(*) AS count,
              COALESCE(MAX(financial_version), 0) AS version
         FROM project_cost_budgets WHERE project_id = ?`,
			[seeded.projects.gamma]
		);
		expect(Number(after[0].count)).toBe(Number(before[0].count));
		expect(Number(after[0].version)).toBe(Number(before[0].version));

		// A report reader without the expense ledger's read privilege gets
		// neither the reconciliation nor any budget row behind it.
		const reader = await loginExpenditureReportOnlyReader(
			playwright,
			E2E_ENV.baseURL
		);
		try {
			const report = await reader.get(
				`/api/reports/employee-project-monthly-cost?view=expenditure&month=${BUDGET}`
			);
			expect(report.status()).toBe(403);
			const body = JSON.stringify(await report.json());
			expect(body).not.toContain(apiBudgetUid);
			expect(body).not.toContain('commercial');
			const readerList = await reader.get(
				`/api/admin/cost-budgets?project_id=${seeded.projects.gamma}`
			);
			expect(readerList.status()).toBe(403);

			evidence.authorization = {
				employee: {
					list: list.status(),
					record: write.status(),
					command: approve.status(),
					detail: detail.status(),
					unchanged: after[0],
				},
				reportOnlyReader: {
					reconciliation: report.status(),
					list: readerList.status(),
				},
			};
		} finally {
			await reader.dispose();
		}
	} finally {
		await employee.dispose();
	}

	// The admin session still reads the same rows after the refusals.
	const adminList = await budgetList(request, seeded.projects.gamma);
	expect(adminList.budgets.length).toBeGreaterThanOrEqual(2);
});

test('shows the budget section to an authorized reader only', async ({
	browser,
}) => {
	const context = await browser.newContext({
		storageState: 'e2e/.auth/employee.json',
		extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.42' },
	});
	const page = await context.newPage();
	try {
		await page.goto('/reports/employee-project-monthly-cost');
		await expect(page.getByTestId('access-denied')).toBeVisible();
		await expect(page.getByTestId('budget-section')).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	const artifact = readArtifact('project-cost-budgets');
	expect(artifact).toMatchObject({ ok: true, month: MONTH });
	expect(artifact.january).toBeTruthy();
	expect(artifact.outcomes).toBeTruthy();
	expect(artifact.chargeOnly).toBeTruthy();
	expect(artifact.browserWorkflow).toBeTruthy();
	expect(artifact.supersede).toBeTruthy();
	expect(artifact.authorization).toBeTruthy();
});
