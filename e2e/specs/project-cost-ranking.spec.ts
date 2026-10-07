import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import {
	ALLOCATION_EXPECTED,
	ALLOCATION_MONTH,
	ALLOCATION_PROJECTS,
	cleanupExpenditureAllocationFixtures,
	seedExpenditureAllocationFixtures,
} from '../lib/expenditure-allocation-fixtures';
import { E2E_ENV } from '../lib/env';
import {
	EXPENDITURE_320_AS_OF,
	EXPENDITURE_320_MONTH,
	EXPENDITURE_320_PRIOR_MONTH,
	EXPENDITURE_PROJECTS,
	EXPENDITURE_VENDOR_PREFIX,
	cleanupExpenditureFixtures,
	loginExpenditureReportOnlyReader,
	seedExpenditureFixtures,
	type SeededExpenditure,
} from '../lib/expenditure-fixtures';

/**
 * Ticket #320 — Project ranking, comparable-period comparison, and cost to
 * date.
 *
 * Every number asserted here is hand-computed from the fixture literals in
 * `e2e/lib/expenditure-fixtures.ts` (the `#320` block) and the parent
 * specification's rules, never from the report module's own arithmetic. An
 * elapsed window states only cost whose received-work period is fully dated
 * and wholly inside it; a period crossing the cutoff, a period starting in the
 * prior month, and a bill-date-only period are unproven, so they are left out
 * of the window figures and the change is withheld (never prorated, never
 * counted by a first day):
 *
 *   Project Alpha, June 2022 (measured to the 15th of 30 days)
 *     in the window   120000 (03–09) + 3000 (late) + 2000 (backdated) = 125000
 *     unproven        5000 (bill date) + 21000 (May 10 – Jun 20) = 26000
 *     whole month     120000 + 40000 (20–25) + 5000 + 3000 + 2000 + 21000 = 191000
 *     prior window    100000 (May 02–08) + 7000 (entered 20 May) = 107000
 *     prior month     100000 + 55000 (20–25) + 7000 = 162000
 *     cost to date    100000 + 55000 + 7000 + 125000 = 287000
 *   Project Beta    window 90000   unproven 15000 (Jun 05–25 crosses the cutoff)
 *                   prior 100000   month 90000 + 15000 = 105000   to date 190000
 *   Project Gamma   window 12000   prior 0        month 12000   to date 12000  (new cost)
 *   Project Delta   window  8000   prior unknown  month  8000   to date 12000
 *   Company         window 125000+90000+12000+8000+50000 (overhead) = 285000
 *                   prior window 107000 + 100000 + 0 + 60000 = 267000
 *                   unproven 26000 + 15000 + 20000 (unallocated bill date) = 61000
 *                   whole month 191000+105000+12000+8000+50000+20000 = 386000
 *                   prior month 162000 + 100000 + 0 + 60000 + 4000 = 326000
 *
 * The whole-month comparison counts every one of those rows, and its increase
 * ordering states Alpha +29000, Gamma +12000 (new), Beta +5000, Delta +4000.
 *
 * Day-less monthly cost is a second rule: an approved period charge or
 * recorded employee cost belongs to its month, not to a day, so an elapsed
 * window cannot place it either. April 2022 (measured to its 15th) holds
 * p320g's approved 12000 charge and March holds p320h's 5000 charge: the
 * window figures stay at the dated cost (p320g's prior window is the recorded
 * zero 0), and the change is withheld with both items disclosed (2 / 17000).
 * February 2026 (measured to its 15th) holds the finalized payroll month's
 * recorded 37539 (three employees): the comparison would otherwise read the
 * January window's 2500 as a fall, and it withholds that change instead.
 *
 * The month is measured to an explicit date, so an unfinished month, its
 * equal-period comparison, and its ordering are deterministic on any run date.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity through the proxy's trusted header
	// (ADR-0013), so a combined run cannot share a bucket with another spec
	// (#306 uses .21/.23, #315 .24), and cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.27' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = EXPENDITURE_320_MONTH;
const PRIOR_MONTH = EXPENDITURE_320_PRIOR_MONTH;
const AS_OF = EXPENDITURE_320_AS_OF;
const MONTH_LABEL = 'June 2022';
const PRIOR_LABEL = 'May 2022';
/** June 2022 sits in the April–March financial year that starts April 2022. */
const FY_LABEL = 'FY 2022–23';
const ALPHA = EXPENDITURE_PROJECTS.p320a.code;
const BETA = EXPENDITURE_PROJECTS.p320b.code;
const GAMMA = EXPENDITURE_PROJECTS.p320c.code;
const DELTA = EXPENDITURE_PROJECTS.p320d.code;
const ENTERED = EXPENDITURE_PROJECTS.p320e.code;
/** The Project whose comparison spans currencies (2022-08/2022-09). */
const MULTI = EXPENDITURE_PROJECTS.p320f.code;
/** Carries the day-less period charge in the reported month (April 2022). */
const CHARGE_PROJECT = EXPENDITURE_PROJECTS.p320g.code;
/** Carries the day-less period charge in the prior month (March 2022). */
const PRIOR_CHARGE_PROJECT = EXPENDITURE_PROJECTS.p320h.code;
/** The cost this spec records through the browser form. */
const UI_ENTRY = {
	sourceReference: 'E2E-320-INV-UI-1',
	gross: 6000,
	serviceStart: `${MONTH}-06`,
	serviceEnd: `${MONTH}-07`,
	billDate: `${MONTH}-08`,
};
/** June 2022 has 30 days; May 2022 has 31, so the prior window is clamped. */
const JUNE_DAYS = 30;
const ELAPSED_DAYS = 15;
/** The #320 fixture block: 15 rows in June 2022, 7 in May 2022, and six
 * boundary rows (2022-03/2022-04 charges, January 2026, the 2022-08/09
 * currency pair). */
const FIXTURE_ROWS = 28;

const EXPECTED = {
	alpha: {
		month: 120000 + 40000 + 5000 + 3000 + 2000 + 21000,
		window: 120000 + 3000 + 2000,
		priorWindow: 100000 + 7000,
		priorMonth: 100000 + 55000 + 7000,
		toDate: 100000 + 55000 + 7000 + (120000 + 3000 + 2000),
		toDateFullMonth:
			100000 + 55000 + 7000 + (120000 + 40000 + 5000 + 3000 + 2000 + 21000),
	},
	beta: {
		month: 90000 + 15000,
		window: 90000,
		priorWindow: 100000,
		priorMonth: 100000,
		toDate: 100000 + 90000,
		notConfirmed: 30000,
	},
	gamma: {
		month: 12000,
		window: 12000,
		priorWindow: 0,
		priorMonth: 0,
		toDate: 12000,
	},
	delta: {
		month: 8000,
		window: 8000,
		/** Its only prior cost sits on 31 May: inside the whole prior month. */
		priorMonth: 4000,
		priorMonthChange: 8000 - 4000,
		priorMonthPercent: 100,
		/** The same cost is outside an elapsed 1–15 window, so the prior is unknown there. */
		priorWindow: null,
		toDate: 4000 + 8000,
	},
	company: {
		month: 191000 + 105000 + 12000 + 8000 + 50000 + 20000,
		window: 125000 + 90000 + 12000 + 8000 + 50000,
		priorWindow: 107000 + 100000 + 0 + 60000,
		/** Whole May, including its last day (`p320dPriorLastDay`, 4000). */
		priorMonth: 162000 + 100000 + 0 + 60000 + 4000,
		/** Records the elapsed window cannot place: 26000 + 15000 + 20000. */
		unprovenCount: 4,
		unprovenAmount: 26000 + 15000 + 20000,
	},
} as const;

/** The day-less period-charge case: April 2022 measured to its 15th. */
const CHARGE_CASE = {
	month: '2022-04',
	asOf: '2022-04-15',
	/** p320g's approved charge of April, and p320h's of March. */
	aprilCharge: 12000,
	marchCharge: 5000,
	/** p320g's prior window holds the recorded zero and no other cost. */
	priorWindow: 0,
	daylessCount: 2,
	daylessAmount: 12000 + 5000,
} as const;

/** The day-less payroll case: February 2026 measured to its 15th. */
const PAYROLL_CASE = {
	month: ALLOCATION_MONTH,
	asOf: `${ALLOCATION_MONTH}-15`,
	/** The finalized month's recorded employer cost (three employees). */
	recorded: ALLOCATION_EXPECTED.month.recordedTotal,
	recordedCount: ALLOCATION_EXPECTED.month.recordedCount,
	p1: ALLOCATION_EXPECTED.month.project1,
	p2: ALLOCATION_EXPECTED.month.project2,
	/** E01's 2500 sits inside the prior (January) window. */
	priorWindow: 2500,
} as const;

interface RankingEntry {
	project_id: number;
	project_code: string;
	currency: string;
	rank: number;
	incurred_cost: number;
	comparison_cost: number;
	previous_period_cost: number | null;
	change_amount: number | null;
	change_state: string;
}

interface ProjectRow {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	currency: string;
	incurred_cost: number;
	record_count: number;
	period_charge_count: number;
	not_confirmed_cost: number | null;
	comparison_cost: number;
	previous_period_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	change_state: string;
	cost_to_date: number | null;
	late_entry: { count: number; amount: number | null } | null;
	employee_cost: number;
	estimated_employee_cost: number;
	logged_hours: number;
	employee_count: number;
	recorded_employee_count: number;
	evidence: {
		state: string;
		findings: string[];
		confirmed_records: number;
		estimated_records: number;
		unknown_amount_records: number;
		unresolved_tax_records: number;
		bill_date_fallback_records: number;
		reconstructed_records: number;
	};
}

interface Disclosure {
	code: string;
	label: string;
	detail: string;
	severity: string;
	period: string | null;
	currency: string | null;
	count: number;
	amount: number | null;
}

interface ReconciliationData {
	month: string;
	month_label: string;
	project_id: number | null;
	current_month: string;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		groups: Array<{ key: string; label: string; amount: number }>;
		record_count: number;
	};
	projects: ProjectRow[];
	comparison: {
		month: string;
		as_of: string;
		prior_month: string;
		prior_month_label: string;
		basis: string;
		unfinished: boolean;
		elapsed_days: number | null;
		current_days: number;
		prior_days: number;
		window_mismatch: boolean;
		currency: string | null;
		current_cost: number | null;
		prior_cost: number | null;
		change_amount: number | null;
		change_percent: number | null;
		change_state: string;
		currency_totals: Array<{
			currency: string;
			current_cost: number;
			prior_cost: number | null;
			change_amount: number | null;
			change_percent: number | null;
			change_state: string;
			unproven_records: number;
			unproven_cost: number | null;
			groups: Array<{
				key: string;
				label: string;
				amount: number;
				record_count: number;
			}>;
			undated_records: number;
			late_records: number;
			late_cost: number;
			prior_late_records: number;
			prior_late_cost: number;
			dayless_records: number;
			dayless_cost: number;
		}>;
		cost_to_date_through: string;
		disclosures: Disclosure[];
	};
	ranking: {
		by_cost: RankingEntry[];
		by_increase: RankingEntry[];
		increase_unranked: Array<{
			project_id: number;
			currency: string;
			reason: string;
			detail: string;
		}>;
		currencies: string[];
	};
	filtered_subtotal: {
		project_id: number;
		currency_totals: Array<{
			currency: string;
			incurred_cost: number;
			comparison_cost: number;
			cost_to_date: number | null;
		}>;
	} | null;
	evidence: {
		recognized: { count: number; amount: number | null };
		pending_evidence: { count: number };
		draft: { count: number };
		missing_amount: { count: number };
		unresolved_classification: { count: number };
	};
	/** #321's budget section, read here for its scope under a filter. */
	budgets: {
		month: string;
		basis: string;
		variance_note: string;
		comparisons: Array<{
			project_id: number;
			project_code: string;
			currency: string;
			incurred_cost: number | null;
			outcome: string;
			variance: number | null;
		}>;
		notices: Array<{
			code: string;
			label: string;
			detail: string;
			severity: string;
		}>;
	};
	coverage: Array<{
		code: string;
		label: string;
		detail: string;
		severity: string;
	}>;
	/** Recorded employee cost and estimates (#307), stated beside the rows. */
	payroll?: {
		currency: string;
		recorded_total: number;
		recorded_count: number;
		estimated_total: number;
	} | null;
	project_options: Array<{ project_id: number; project_code: string }>;
	available_months: string[];
}

let seeded: SeededExpenditure;
const evidence: Record<string, unknown> = {
	ok: true,
	month: MONTH,
	asOf: AS_OF,
};
/** Rows this spec records through the app, so the run leaves nothing behind. */
const createdThroughApp: Array<{
	id: number;
	cost_uid: string;
	where: string;
}> = [];

function publish(): void {
	writeArtifact('project-cost-ranking', {
		...evidence,
		fixtureScope: {
			projects: [
				ALPHA,
				BETA,
				GAMMA,
				DELTA,
				ENTERED,
				MULTI,
				CHARGE_PROJECT,
				PRIOR_CHARGE_PROJECT,
			],
			months: [MONTH, PRIOR_MONTH, CHARGE_CASE.month, '2022-03'],
			boundaryMonths: ['2022-08', '2022-09', '2026-01', PAYROLL_CASE.month],
			asOf: AS_OF,
			expensePrefix: 'E2E-EXP-320-',
		},
		createdThroughApp,
	});
}

async function reconciliation(
	request: APIRequestContext,
	params: { month: string; asOf?: string; projectId?: number }
): Promise<ReconciliationData> {
	const query = new URLSearchParams({
		view: 'expenditure',
		month: params.month,
	});
	if (params.asOf) query.set('as_of', params.asOf);
	if (params.projectId !== undefined) {
		query.set('project_id', String(params.projectId));
	}
	const response = await request.get(
		`/api/reports/employee-project-monthly-cost?${query.toString()}`
	);
	expect(response.status(), await response.text()).toBe(200);
	const body = await response.json();
	expect(body.success).toBe(true);
	expect(body.view).toBe('expenditure');
	return body.data as ReconciliationData;
}

function rowOf(data: ReconciliationData, projectCode: string): ProjectRow {
	const found = data.projects.filter((row) => row.project_code === projectCode);
	expect(found, `row for ${projectCode}`).toHaveLength(1);
	return found[0];
}

function disclosureOf(
	data: ReconciliationData,
	code: string,
	period?: string
): Disclosure {
	const found = data.comparison.disclosures.filter(
		(entry) =>
			entry.code === code && (period === undefined || entry.period === period)
	);
	expect(
		found.length,
		`${code}${period ? ` (${period})` : ''}`
	).toBeGreaterThan(0);
	return found[0];
}

function disclosureCodes(data: ReconciliationData): string[] {
	return data.comparison.disclosures.map((entry) => entry.code);
}

function groupAmount(data: ReconciliationData, key: string): number {
	const found = data.company.groups.find((entry) => entry.key === key);
	expect(found, `group ${key}`).toBeTruthy();
	return found!.amount;
}

/** Open the report's expenditure view for one month from its picker. */
async function openExpenditure(page: Page, monthLabel: string): Promise<void> {
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	await expect(page.getByTestId('expenditure-view')).toBeVisible();
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(monthLabel);
	await page.getByRole('button', { name: monthLabel, exact: true }).click();
}

/** The fixture Project codes the rendered table shows, in its own order. */
async function renderedOrder(page: Page): Promise<string[]> {
	const codes = await page
		.locator('[data-testid="expenditure-project-row"]')
		.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-project-code') ?? '')
		);
	const mine: Record<string, true> = {
		[ALPHA]: true,
		[BETA]: true,
		[GAMMA]: true,
		[DELTA]: true,
		[ENTERED]: true,
	};
	return codes.filter((code) => mine[code]);
}

function betaRow(page: Page) {
	return page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${BETA}"]`
	);
}

function gammaRow(page: Page) {
	return page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${GAMMA}"]`
	);
}

test.beforeAll(async () => {
	// Rerun safety: an interrupted earlier run may have left the cost this spec
	// records through the browser form behind. Remove it (and its journal)
	// before seeding, so every run starts from the fixture's own figures.
	const leftovers = await rows<{ id: number; cost_uid: string | null }>(
		`SELECT id, cost_uid FROM expenses WHERE source_reference = ?`,
		[UI_ENTRY.sourceReference]
	);
	for (const leftover of leftovers) {
		if (leftover.cost_uid) {
			await exec(`DELETE FROM financial_cost_events WHERE cost_uid = ?`, [
				leftover.cost_uid,
			]);
		}
		await exec(`DELETE FROM expenses WHERE id = ?`, [leftover.id]);
	}
	seeded = await seedExpenditureFixtures();
	// The day-less payroll case reads #307's finalized allocation month; its
	// fixtures are seeded here too so this spec proves the rule on its own,
	// and removed again in afterAll.
	await seedExpenditureAllocationFixtures();
	// The fixture months are this spec's own namespace: another slice's cost in
	// any of them would move the figures below, so the run refuses to guess
	// instead of asserting against a month it does not own.
	const persisted = await rows<{ total: number; mine: number }>(
		`SELECT COUNT(*) AS total,
            SUM(CASE WHEN expense_number LIKE 'E2E-EXP-320-%' THEN 1 ELSE 0 END) AS mine
       FROM expenses
      WHERE isDelete = 0
        AND (expense_number LIKE 'E2E-EXP-320-%'
             OR recognition_period BETWEEN '2022-08-01' AND '2022-09-30'
             OR recognition_period BETWEEN '2022-03-01' AND '2022-06-30'
             OR recognition_period BETWEEN '2026-01-01' AND '2026-01-31')`
	);
	expect(persisted[0].total).toBe(FIXTURE_ROWS);
	expect(Number(persisted[0].mine)).toBe(FIXTURE_ROWS);
});

test.afterAll(async () => {
	publish();
	if (createdThroughApp.length) {
		const ids = createdThroughApp.map((entry) => entry.id);
		const placeholders = ids.map(() => '?').join(', ');
		await exec(
			`DELETE FROM financial_cost_events WHERE source_table = 'expenses' AND source_id IN (${placeholders})`,
			ids
		);
		await exec(`DELETE FROM expenses WHERE id IN (${placeholders})`, ids);
	}
	await cleanupExpenditureAllocationFixtures();
	await cleanupExpenditureFixtures();
});

test('ranks Projects over an equal elapsed period and states what it cannot rank', async ({
	request,
}) => {
	const data = await reconciliation(request, { month: MONTH, asOf: AS_OF });

	// The reported month and the window it is measured to: June 2022 to the
	// 15th of its 30 days, against the first 15 days of May 2022.
	expect(data.month).toBe(MONTH);
	expect(data.month_label).toBe(MONTH_LABEL);
	expect(data.current_month).toBe(new Date().toISOString().slice(0, 7));
	expect(data.comparison.month).toBe(MONTH);
	expect(data.comparison.as_of).toBe(AS_OF);
	expect(data.comparison.prior_month).toBe(PRIOR_MONTH);
	expect(data.comparison.prior_month_label).toBe(PRIOR_LABEL);
	expect(data.comparison.basis).toBe('equal_period');
	expect(data.comparison.unfinished).toBe(true);
	expect(data.comparison.elapsed_days).toBe(ELAPSED_DAYS);
	expect(data.comparison.current_days).toBe(ELAPSED_DAYS);
	expect(data.comparison.prior_days).toBe(ELAPSED_DAYS);
	expect(data.comparison.window_mismatch).toBe(false);
	expect(data.comparison.cost_to_date_through).toBe(AS_OF);

	// Company Incurred Cost stays the whole month; the comparison is the
	// elapsed window, and both are stated in the one currency present.
	expect(data.company.currency).toBe('INR');
	expect(data.company.incurred_cost).toBe(EXPECTED.company.month);
	expect(groupAmount(data, 'incurred_project_cost')).toBe(
		EXPECTED.alpha.month +
			EXPECTED.beta.month +
			EXPECTED.gamma.month +
			EXPECTED.delta.month
	);
	expect(groupAmount(data, 'company_overhead')).toBe(50000);
	expect(groupAmount(data, 'unallocated_cost')).toBe(20000);
	expect(data.comparison.currency).toBe('INR');
	expect(data.comparison.current_cost).toBe(EXPECTED.company.window);
	expect(data.comparison.prior_cost).toBe(EXPECTED.company.priorWindow);
	// The window cannot prove where four of the month's records sit (a
	// bill-date period, the cross-month span, the crossing span, and the
	// unallocated bill-date period), so no change is stated for the company:
	// never a fabricated increase, never a prior read as zero.
	expect(data.comparison.change_amount).toBeNull();
	expect(data.comparison.change_percent).toBeNull();
	expect(data.comparison.change_state).toBe('unproven');
	expect(data.comparison.currency_totals).toHaveLength(1);
	const companyWindow = data.comparison.currency_totals[0];
	expect(companyWindow.current_cost).toBe(EXPECTED.company.window);
	expect(companyWindow.prior_cost).toBe(EXPECTED.company.priorWindow);
	expect(companyWindow.unproven_records).toBe(EXPECTED.company.unprovenCount);
	expect(companyWindow.unproven_cost).toBe(EXPECTED.company.unprovenAmount);
	// No charge or recorded employee cost exists in either compared month, so
	// nothing day-less is withheld beyond the unproven records.
	expect(companyWindow.dayless_records).toBe(0);
	expect(companyWindow.dayless_cost).toBe(0);
	// The window's own categories, each underlying cost counted once, and they
	// sum to the window's company figure.
	const windowCategories = companyWindow.groups;
	expect(windowCategories.map((group) => [group.key, group.amount])).toEqual([
		[
			'incurred_project_cost',
			EXPECTED.alpha.window +
				EXPECTED.beta.window +
				EXPECTED.gamma.window +
				EXPECTED.delta.window,
		],
		['company_overhead', 50000],
		['unallocated_cost', 0],
	]);
	expect(
		windowCategories.reduce((total, group) => total + group.amount, 0)
	).toBe(EXPECTED.company.window);

	// Every Project row states its month, its comparable window, the absolute
	// change, the supported percentage, cost to date, and its evidence. Alpha's
	// window holds the two records whose days prove they sit inside it; the
	// bill-date row and the May-starting span are unproven, so Alpha's change
	// is withheld rather than read as an increase.
	const alpha = rowOf(data, ALPHA);
	expect(alpha.client_name).toBe(EXPENDITURE_PROJECTS.p320a.client);
	expect(alpha.currency).toBe('INR');
	expect(alpha.incurred_cost).toBe(EXPECTED.alpha.month);
	expect(alpha.comparison_cost).toBe(EXPECTED.alpha.window);
	expect(alpha.previous_period_cost).toBe(EXPECTED.alpha.priorWindow);
	expect(alpha.change_amount).toBeNull();
	expect(alpha.change_percent).toBeNull();
	expect(alpha.change_state).toBe('unproven');
	expect(alpha.cost_to_date).toBe(EXPECTED.alpha.toDate);
	expect(alpha.record_count).toBe(6);
	expect(alpha.not_confirmed_cost).toBe(0);
	expect(alpha.late_entry).toEqual({ count: 2, amount: 5000 });
	expect(alpha.evidence.state).toBe('estimated');
	expect(alpha.evidence.findings).toContain('bill_date_fallback');
	expect(alpha.evidence.confirmed_records).toBe(6);
	expect(alpha.evidence.unknown_amount_records).toBe(0);
	expect(alpha.evidence.reconstructed_records).toBe(0);

	const beta = rowOf(data, BETA);
	expect(beta.incurred_cost).toBe(EXPECTED.beta.month);
	expect(beta.comparison_cost).toBe(EXPECTED.beta.window);
	expect(beta.previous_period_cost).toBe(EXPECTED.beta.priorWindow);
	expect(beta.change_amount).toBeNull();
	expect(beta.change_percent).toBeNull();
	expect(beta.change_state).toBe('unproven');
	expect(beta.cost_to_date).toBe(EXPECTED.beta.toDate);
	expect(beta.not_confirmed_cost).toBe(EXPECTED.beta.notConfirmed);
	expect(beta.late_entry).toBeNull();
	// A draft is an estimate, not confirmed cost.
	expect(beta.evidence.state).toBe('estimated');
	expect(beta.evidence.findings).toContain('open_records');
	expect(beta.evidence.estimated_records).toBe(1);
	expect(beta.evidence.reconstructed_records).toBe(0);

	// Two independent boundary cases prove themselves unproven rather than
	// counted by their first day: Beta's June span crosses the 15th cutoff
	// (05–25), and Alpha's June record spans from the prior month (10 May –
	// 20 Jun). The database states the periods the window rule read, and the
	// window figures above hold neither amount (Beta 90000, Alpha 125000).
	const crossing = await rows<{
		expense_number: string;
		service_period_start: string;
		service_period_end: string;
		recognized_amount: string;
	}>(
		`SELECT expense_number, service_period_start, service_period_end, recognized_amount
       FROM expenses
      WHERE isDelete = 0 AND expense_number IN ('E2E-EXP-320-A06', 'E2E-EXP-320-B03')
      ORDER BY expense_number`
	);
	expect(
		crossing.map((entry) => [
			entry.expense_number,
			String(entry.service_period_start).slice(0, 10),
			String(entry.service_period_end).slice(0, 10),
			Number(entry.recognized_amount),
		])
	).toEqual([
		['E2E-EXP-320-A06', '2022-05-10', '2022-06-20', 21000],
		['E2E-EXP-320-B03', '2022-06-05', '2022-06-25', 15000],
	]);
	// Both are inside their month's whole cost and outside its window figures.
	expect(alpha.incurred_cost).toBe(EXPECTED.alpha.month);
	expect(beta.incurred_cost).toBe(EXPECTED.beta.month);

	// A recorded zero prior amount is a new cost with an absolute change: no
	// percentage is invented for it.
	const gamma = rowOf(data, GAMMA);
	expect(gamma.incurred_cost).toBe(EXPECTED.gamma.month);
	expect(gamma.comparison_cost).toBe(EXPECTED.gamma.window);
	expect(gamma.previous_period_cost).toBe(EXPECTED.gamma.priorWindow);
	expect(gamma.change_amount).toBe(EXPECTED.gamma.window);
	expect(gamma.change_percent).toBeNull();
	expect(gamma.change_state).toBe('new');
	expect(gamma.cost_to_date).toBe(EXPECTED.gamma.toDate);
	expect(gamma.evidence.state).toBe('recorded');

	// No prior-window record at all keeps the comparison unknown: absence is
	// not evidence of zero cost, and a pending record without an amount is
	// incomplete evidence rather than a zero. Delta's only prior cost sits on
	// 31 May — inside the whole prior month, outside an elapsed 1–15 window —
	// so the window comparison is unknown here and the company prior window
	// above (267000) excludes that 4000.
	const delta = rowOf(data, DELTA);
	expect(delta.incurred_cost).toBe(EXPECTED.delta.month);
	expect(delta.comparison_cost).toBe(EXPECTED.delta.window);
	expect(delta.previous_period_cost).toBeNull();
	expect(delta.change_amount).toBeNull();
	expect(delta.change_percent).toBeNull();
	expect(delta.change_state).toBe('no_prior');
	expect(delta.cost_to_date).toBe(EXPECTED.delta.toDate);
	expect(delta.not_confirmed_cost).toBeNull();
	expect(delta.evidence.state).toBe('incomplete');
	expect(delta.evidence.findings).toContain('open_records');
	expect(delta.evidence.findings).toContain('unknown_amount');
	expect(delta.evidence.unknown_amount_records).toBe(1);
	expect(delta.evidence.reconstructed_records).toBe(0);
	// The recognition period names the month; the received-work day (31 May)
	// is carried by the service period, which is what the day rule reads.
	const lastDay = await rows<{
		recognized_amount: string;
		recognition_month: string;
		service_period_start: string;
		service_period_end: string;
	}>(
		`SELECT recognized_amount,
              DATE_FORMAT(recognition_period, '%Y-%m') AS recognition_month,
              service_period_start, service_period_end
         FROM expenses
        WHERE isDelete = 0 AND expense_number = 'E2E-EXP-320-D11'`
	);
	expect(lastDay).toHaveLength(1);
	expect(Number(lastDay[0].recognized_amount)).toBe(EXPECTED.delta.priorMonth);
	expect(lastDay[0].recognition_month).toBe(PRIOR_MONTH);
	expect(String(lastDay[0].service_period_start).slice(0, 10)).toBe(
		`${PRIOR_MONTH}-31`
	);
	expect(String(lastDay[0].service_period_end).slice(0, 10)).toBe(
		`${PRIOR_MONTH}-31`
	);

	// Largest-cost ordering: Alpha 191000, Beta 105000, Gamma 12000, Delta 8000.
	expect(data.ranking.currencies).toEqual(['INR']);
	expect(data.ranking.by_cost.map((entry) => entry.project_code)).toEqual([
		ALPHA,
		BETA,
		GAMMA,
		DELTA,
	]);
	expect(data.ranking.by_cost.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
	expect(data.ranking.by_cost[0].incurred_cost).toBe(EXPECTED.alpha.month);
	expect(data.ranking.by_cost[0].comparison_cost).toBe(EXPECTED.alpha.window);

	// Largest-increase ordering: only Gamma's change is stated (+12000, a new
	// cost against a recorded zero). Alpha and Beta cannot be placed because
	// their window membership is unproven, and Delta because its prior amount
	// is unknown — each with its own reason.
	expect(data.ranking.by_increase.map((entry) => entry.project_code)).toEqual([
		GAMMA,
	]);
	expect(data.ranking.by_increase.map((entry) => entry.rank)).toEqual([1]);
	expect(data.ranking.by_increase.map((entry) => entry.change_amount)).toEqual([
		12000,
	]);
	expect(
		data.ranking.increase_unranked.map((entry) => [
			entry.project_id,
			entry.reason,
		])
	).toEqual([
		[alpha.project_id, 'unproven_partial_window'],
		[beta.project_id, 'unproven_partial_window'],
		[delta.project_id, 'unknown_prior'],
	]);
	expect(
		data.ranking.increase_unranked.every((entry) => entry.currency === 'INR')
	).toBe(true);

	// The comparison says what it covers: an equal window, late and backdated
	// entries on both sides, day-less period evidence, and the row-level states
	// that keep these figures from reading as complete.
	expect(disclosureOf(data, 'equal_period_comparison').count).toBe(
		ELAPSED_DAYS
	);
	const lateCurrent = disclosureOf(data, 'late_recorded_cost', 'current');
	expect(lateCurrent.count).toBe(2);
	expect(lateCurrent.amount).toBe(5000);
	const latePrior = disclosureOf(data, 'late_recorded_cost', 'prior');
	expect(latePrior.count).toBe(1);
	expect(latePrior.amount).toBe(7000);
	expect(disclosureOf(data, 'backdated_recognition').count).toBe(1);
	const unproven = disclosureOf(data, 'window_evidence_unproven');
	expect(unproven.count).toBe(EXPECTED.company.unprovenCount);
	expect(unproven.amount).toBe(EXPECTED.company.unprovenAmount);
	const unequal = disclosureOf(data, 'unequal_evidence_coverage');
	expect(unequal.count).toBe(1);
	expect(unequal.amount).toBe(7000);
	expect(disclosureOf(data, 'zero_prior_cost').count).toBe(1);
	expect(disclosureOf(data, 'unknown_prior_cost').count).toBe(1);
	expect(disclosureCodes(data)).not.toContain('no_prior_period_evidence');
	expect(disclosureCodes(data)).not.toContain('unequal_window_length');
	// Neither compared month holds a day-less monthly item, so the day-less
	// rule has nothing to withhold here.
	expect(disclosureCodes(data)).not.toContain('dayless_monthly_cost_unproven');
	for (const entry of data.comparison.disclosures) {
		expect(entry.severity === 'warning' || entry.severity === 'info').toBe(
			true
		);
		expect(entry.label.length).toBeGreaterThan(0);
		expect(entry.detail.length).toBeGreaterThan(0);
	}

	// Missing coverage is stated, not swallowed: one pending record carries no
	// amount, and one record has no destination at all.
	expect(data.evidence.recognized.count).toBe(12);
	expect(data.evidence.recognized.amount).toBe(EXPECTED.company.month);
	expect(data.evidence.draft.count).toBe(1);
	expect(data.evidence.pending_evidence.count).toBe(2);
	expect(data.evidence.missing_amount.count).toBe(1);
	expect(data.evidence.unresolved_classification.count).toBe(1);

	// The database agrees, row by row: amounts and entry times.
	const persisted = await rows<{
		project_code: string;
		total: string;
		records: number;
	}>(
		`SELECT p.project_code, SUM(e.recognized_amount) AS total, COUNT(*) AS records
       FROM expenses e
       JOIN projects p ON p.project_id = e.project_id
      WHERE e.isDelete = 0 AND e.recognition_state = 'recognized'
        AND e.cost_classification = 'project'
        AND e.recognition_period BETWEEN ? AND ?
        AND p.project_code IN (?, ?, ?, ?)
      GROUP BY p.project_code
      ORDER BY p.project_code`,
		[`${MONTH}-01`, `${MONTH}-${JUNE_DAYS}`, ALPHA, BETA, GAMMA, DELTA]
	);
	expect(
		persisted.map((entry) => [
			entry.project_code,
			Number(entry.total),
			Number(entry.records),
		])
	).toEqual([
		[ALPHA, EXPECTED.alpha.month, 6],
		[BETA, EXPECTED.beta.month, 2],
		[GAMMA, EXPECTED.gamma.month, 1],
		[DELTA, EXPECTED.delta.month, 1],
	]);
	const lateStored = await rows<{ expense_number: string; created_at: string }>(
		`SELECT expense_number, created_at FROM expenses
      WHERE isDelete = 0 AND expense_number IN (?, ?, ?)
      ORDER BY expense_number`,
		['E2E-EXP-320-A04', 'E2E-EXP-320-A05', 'E2E-EXP-320-A13']
	);
	expect(lateStored.map((entry) => entry.expense_number)).toEqual([
		'E2E-EXP-320-A04',
		'E2E-EXP-320-A05',
		'E2E-EXP-320-A13',
	]);
	// A04 entered inside June but after the window closed, A05 after June
	// ended, A13 inside May but after the May window closed.
	expect(String(lateStored[0].created_at).slice(0, 10)).toBe('2022-06-25');
	expect(String(lateStored[1].created_at).slice(0, 10)).toBe('2022-07-03');
	expect(String(lateStored[2].created_at).slice(0, 10)).toBe('2022-05-20');

	// No row ever claims a reconstructed label nothing produced for it.
	expect(
		data.projects.every((row) => row.evidence.reconstructed_records === 0)
	).toBe(true);

	evidence.seeded = { costs: seeded.costs, projects: seeded.projects };
	evidence.equalPeriod = {
		expected: EXPECTED,
		comparison: data.comparison,
		ranking: data.ranking,
		rows: data.projects.map((row) => ({
			code: row.project_code,
			month: row.incurred_cost,
			window: row.comparison_cost,
			prior: row.previous_period_cost,
			change: row.change_amount,
			percent: row.change_percent,
			state: row.change_state,
			toDate: row.cost_to_date,
			evidence: row.evidence.state,
		})),
		persisted: persisted.map((entry) => ({
			code: entry.project_code,
			total: Number(entry.total),
			records: Number(entry.records),
		})),
		disclosures: data.comparison.disclosures,
	};
});

test('compares a month that has elapsed against the whole prior month', async ({
	request,
}) => {
	// Without an as-of date the server measures a past month in full, which is
	// what the browser sees when it opens June 2022 today.
	const data = await reconciliation(request, { month: MONTH });
	expect(data.comparison.basis).toBe('full_month');
	expect(data.comparison.unfinished).toBe(false);
	expect(data.comparison.elapsed_days).toBeNull();
	expect(data.comparison.current_days).toBe(JUNE_DAYS);
	// A month that has fully elapsed is compared whole: May holds 31 days and
	// its last day counts, so the prior window is not clamped to June's 30.
	expect(data.comparison.prior_days).toBe(31);
	expect(data.comparison.window_mismatch).toBe(false);
	expect(data.comparison.current_cost).toBe(EXPECTED.company.month);
	expect(data.comparison.prior_cost).toBe(EXPECTED.company.priorMonth);
	expect(data.comparison.change_amount).toBe(
		EXPECTED.company.month - EXPECTED.company.priorMonth
	);
	// 60000 / 326000 = 18.4049…%, stated to two decimals.
	expect(data.comparison.change_percent).toBe(18.4);
	expect(data.comparison.change_state).toBe('increase');
	expect(data.comparison.cost_to_date_through).toBe(`${MONTH}-${JUNE_DAYS}`);
	expect(disclosureCodes(data)).toContain('full_month_comparison');
	expect(disclosureCodes(data)).not.toContain('equal_period_comparison');

	// The whole month is in the window, so the row figures move with it: the
	// crossing span and the May-starting span are counted here, not withheld.
	const alpha = rowOf(data, ALPHA);
	expect(alpha.comparison_cost).toBe(EXPECTED.alpha.month);
	expect(alpha.previous_period_cost).toBe(EXPECTED.alpha.priorMonth);
	expect(alpha.change_amount).toBe(
		EXPECTED.alpha.month - EXPECTED.alpha.priorMonth
	);
	// 29000 / 162000 = 17.9012…%, stated to two decimals.
	expect(alpha.change_percent).toBe(17.9);
	expect(alpha.change_state).toBe('increase');
	expect(alpha.cost_to_date).toBe(EXPECTED.alpha.toDateFullMonth);
	expect(data.comparison.cost_to_date_through).toBe(`${MONTH}-${JUNE_DAYS}`);

	// Only the backdated record is late once the whole month has elapsed, and
	// no prior-window cost arrived late.
	expect(disclosureOf(data, 'late_recorded_cost', 'current').count).toBe(1);
	expect(disclosureOf(data, 'backdated_recognition').count).toBe(1);
	expect(disclosureCodes(data)).not.toContain('unequal_evidence_coverage');
	expect(disclosureCodes(data)).not.toContain('unequal_window_length');
	expect(disclosureCodes(data)).not.toContain('window_evidence_unproven');

	// Delta's prior cost is its 31 May record, which the whole prior month now
	// includes: a known increase rather than an unknown prior, and it takes its
	// place in the increase ordering instead of being left out.
	const delta = rowOf(data, DELTA);
	expect(delta.previous_period_cost).toBe(EXPECTED.delta.priorMonth);
	expect(delta.change_amount).toBe(EXPECTED.delta.priorMonthChange);
	expect(delta.change_percent).toBe(EXPECTED.delta.priorMonthPercent);
	expect(delta.change_state).toBe('increase');
	expect(delta.cost_to_date).toBe(EXPECTED.delta.toDate);

	// The increase ordering follows the same figures: Alpha +29000,
	// Gamma +12000 (new), Beta +5000, Delta +4000, with no Project left
	// unranked because every prior amount is now known.
	expect(data.ranking.by_increase.map((entry) => entry.project_code)).toEqual([
		ALPHA,
		GAMMA,
		BETA,
		DELTA,
	]);
	expect(data.ranking.by_increase.map((entry) => entry.change_amount)).toEqual([
		29000, 12000, 5000, 4000,
	]);
	expect(data.ranking.increase_unranked).toHaveLength(0);
	expect(disclosureCodes(data)).not.toContain('unknown_prior_cost');

	evidence.fullMonth = {
		comparison: data.comparison,
		alpha: {
			window: alpha.comparison_cost,
			prior: alpha.previous_period_cost,
			percent: alpha.change_percent,
			toDate: alpha.cost_to_date,
		},
		delta: {
			prior: delta.previous_period_cost,
			change: delta.change_amount,
			percent: delta.change_percent,
			state: delta.change_state,
		},
		increases: data.ranking.by_increase.map((entry) => ({
			code: entry.project_code,
			change: entry.change_amount,
		})),
		unranked: data.ranking.increase_unranked.length,
	};
});

test('keeps the company reconciliation unfiltered behind a Project filter', async ({
	request,
}) => {
	const unfiltered = await reconciliation(request, {
		month: MONTH,
		asOf: AS_OF,
	});
	const alphaId = unfiltered.project_options.find(
		(option) => option.project_code === ALPHA
	)!.project_id;
	const filtered = await reconciliation(request, {
		month: MONTH,
		asOf: AS_OF,
		projectId: alphaId,
	});

	// The Project filter narrows the detail, never the company position.
	expect(filtered.project_id).toBe(alphaId);
	expect(filtered.company.incurred_cost).toBe(EXPECTED.company.month);
	expect(filtered.comparison.current_cost).toBe(EXPECTED.company.window);
	expect(filtered.comparison.prior_cost).toBe(EXPECTED.company.priorWindow);
	expect(filtered.projects.map((row) => row.project_code)).toEqual([ALPHA]);
	expect(filtered.filtered_subtotal).toEqual({
		project_id: alphaId,
		currency_totals: [
			{
				currency: 'INR',
				incurred_cost: EXPECTED.alpha.month,
				comparison_cost: EXPECTED.alpha.window,
				cost_to_date: EXPECTED.alpha.toDate,
			},
		],
	});
	expect(unfiltered.filtered_subtotal).toBeNull();

	// The filtered row carries the same figures as the unfiltered one.
	expect(rowOf(filtered, ALPHA)).toMatchObject({
		incurred_cost: rowOf(unfiltered, ALPHA).incurred_cost,
		comparison_cost: rowOf(unfiltered, ALPHA).comparison_cost,
		previous_period_cost: rowOf(unfiltered, ALPHA).previous_period_cost,
		cost_to_date: rowOf(unfiltered, ALPHA).cost_to_date,
	});

	evidence.filter = {
		projectId: alphaId,
		company: filtered.company.incurred_cost,
		comparison: filtered.comparison.current_cost,
		subtotal: filtered.filtered_subtotal,
		rows: filtered.projects.length,
	};

	// The budget section reads exactly the rows the response publishes, so a
	// Project filter cannot leave another Project's approved budget looking
	// missing: the filtered section states the filtered Project only, and the
	// unfiltered one still states every Project with a row.
	const filteredSection = filtered.budgets;
	const unfilteredSection = unfiltered.budgets;
	expect(filteredSection.comparisons.map((row) => row.project_code)).toEqual([
		ALPHA,
	]);
	expect(unfilteredSection.comparisons.map((row) => row.project_code)).toEqual([
		ALPHA,
		BETA,
		GAMMA,
		DELTA,
	]);
	expect(unfilteredSection.comparisons.map((row) => row.outcome)).not.toContain(
		'missing'
	);
	evidence.budgets = {
		filtered: filteredSection.comparisons.map((row) => [
			row.project_code,
			row.outcome,
		]),
		unfiltered: unfilteredSection.comparisons.map((row) => [
			row.project_code,
			row.outcome,
		]),
	};
});

test('refuses a comparable-period date it cannot support, and keeps source data behind its privilege', async ({
	playwright,
	request,
}) => {
	const base = `view=expenditure&month=${MONTH}`;
	for (const [query, code] of [
		['as_of=2022-06-31', 'invalid_as_of'],
		['as_of=2022-6-15', 'invalid_as_of'],
		['as_of=2022-07-01', 'as_of_outside_month'],
		['as_of=2022-05-31', 'as_of_outside_month'],
	] as const) {
		const response = await request.get(
			`/api/reports/employee-project-monthly-cost?${base}&${query}`
		);
		expect(response.status(), `${query}: ${await response.text()}`).toBe(400);
		const body = await response.json();
		expect(body.success).toBe(false);
		expect(body.code).toBe(code);
	}
	const badProject = await request.get(
		`/api/reports/employee-project-monthly-cost?${base}&project_id=abc`
	);
	expect(badProject.status()).toBe(400);

	// A report reader without the expense ledger's read privilege gets neither
	// the reconciliation nor its drilldown, and not even the months that carry
	// direct cost — while the report's own meta stays open to them.
	const reader = await loginExpenditureReportOnlyReader(
		playwright,
		E2E_ENV.baseURL
	);
	try {
		const refused = await reader.get(
			`/api/reports/employee-project-monthly-cost?${base}&as_of=${AS_OF}`
		);
		expect(refused.status()).toBe(403);
		expect(JSON.stringify(await refused.json())).not.toContain('120000');
		const refusedDrilldown = await reader.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${MONTH}`
		);
		expect(refusedDrilldown.status()).toBe(403);
		expect(JSON.stringify(await refusedDrilldown.json())).not.toContain(
			'E2E-320-INV'
		);
		const meta = await reader.get('/api/reports/employee-project-monthly-cost');
		expect(meta.status()).toBe(200);
		const metaBody = await meta.json();
		expect(metaBody.meta.expenditure_months).toEqual([]);
		evidence.refusals = {
			invalidAsOf: 400,
			outsideMonth: 400,
			badProject: 400,
			readerExpenditure: refused.status(),
			readerDrilldown: refusedDrilldown.status(),
			readerExpenditureMonths: metaBody.meta.expenditure_months,
		};
	} finally {
		await reader.dispose();
	}
});

test('ranks, compares, and drills down through the real report controls', async ({
	page,
}) => {
	// Opening the report lands on the current month, in its financial year.
	const currentMonth = new Date().toISOString().slice(0, 7);
	const currentFy =
		Number(currentMonth.slice(5, 7)) >= 4
			? Number(currentMonth.slice(0, 4))
			: Number(currentMonth.slice(0, 4)) - 1;
	await page.goto('/reports/employee-project-monthly-cost');
	await page.getByRole('tab', { name: 'Expenditure', exact: true }).click();
	const view = page.getByTestId('expenditure-view');
	await expect(view).toBeVisible();
	await expect(view).toHaveAttribute('data-month', currentMonth);
	await expect(view).toHaveAttribute('data-current-month', currentMonth);
	await expect(page.getByTestId('fy-label')).toHaveAttribute(
		'data-fy',
		String(currentFy)
	);

	await openExpenditure(page, MONTH_LABEL);
	const panel = page.getByTestId('comparison-panel');
	await expect(view).toHaveAttribute('data-month', MONTH);
	await expect(panel).toHaveAttribute('data-basis', 'full_month');
	await expect(panel).toHaveAttribute(
		'data-as-of',
		new Date().toISOString().slice(0, 10)
	);
	await expect(page.getByTestId('comparison-current')).toHaveAttribute(
		'data-value',
		String(EXPECTED.company.month)
	);
	await expect(page.getByTestId('comparison-prior')).toHaveAttribute(
		'data-value',
		String(EXPECTED.company.priorMonth)
	);
	await expect(page.getByTestId('comparison-change')).toHaveAttribute(
		'data-value',
		String(EXPECTED.company.month - EXPECTED.company.priorMonth)
	);
	await expect(page.getByTestId('comparison-percent')).toContainText('18.4%');
	await expect(page.getByTestId('fy-label')).toContainText(FY_LABEL);
	// The panel states the window's direct-cost categories as well, per
	// currency, from the same records the comparison counts.
	const categoryRow = page.getByTestId('comparison-currency-row');
	await expect(categoryRow).toHaveAttribute(
		'data-current',
		String(EXPECTED.company.month)
	);
	for (const [category, amount] of [
		[
			'incurred_project_cost',
			EXPECTED.alpha.month +
				EXPECTED.beta.month +
				EXPECTED.gamma.month +
				EXPECTED.delta.month,
		],
		['company_overhead', 50000],
		['unallocated_cost', 20000],
	] as const) {
		await expect(
			categoryRow.locator(
				`[data-testid="comparison-category"][data-category="${category}"]`
			)
		).toHaveAttribute('data-amount', String(amount));
	}

	// Largest cost first is the default ordering, straight from the payload.
	expect(await renderedOrder(page)).toEqual([ALPHA, BETA, GAMMA, DELTA]);
	const alphaRow = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${ALPHA}"]`
	);
	const deltaRow = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${DELTA}"]`
	);
	await expect(alphaRow).toHaveAttribute('data-rank', '1');
	await expect(alphaRow).toHaveAttribute(
		'data-comparison-cost',
		String(EXPECTED.alpha.month)
	);
	await expect(alphaRow).toHaveAttribute(
		'data-previous-period-cost',
		String(EXPECTED.alpha.priorMonth)
	);
	await expect(alphaRow).toHaveAttribute('data-change-percent', '17.9');
	await expect(alphaRow).toHaveAttribute(
		'data-cost-to-date',
		String(EXPECTED.alpha.toDateFullMonth)
	);
	await expect(alphaRow).toHaveAttribute('data-evidence-state', 'estimated');
	await expect(alphaRow).toHaveAttribute('data-late-count', '1');
	await expect(
		alphaRow.locator('[data-testid="project-cost-to-date"]')
	).toHaveAttribute('data-value', String(EXPECTED.alpha.toDateFullMonth));
	await expect(deltaRow).toHaveAttribute('data-evidence-state', 'incomplete');
	await expect(deltaRow).toHaveAttribute('data-rank-increase', '4');
	await expect(deltaRow).toHaveAttribute(
		'data-previous-period-cost',
		String(EXPECTED.delta.priorMonth)
	);
	await expect(deltaRow).toHaveAttribute(
		'data-change-percent',
		String(EXPECTED.delta.priorMonthPercent)
	);
	await expect(
		deltaRow.locator('[data-testid="project-change"]')
	).toContainText('100.00%');
	// Every prior amount is known once the whole prior month is in, so no row
	// is left out of the increase ordering.
	await expect(
		page.locator(
			'[data-testid="comparison-disclosure"][data-code="unknown_prior_cost"]'
		)
	).toHaveCount(0);

	// Largest increase first reorders the same figures: Alpha's increase, then
	// Gamma's new cost, Beta's and Delta's changes.
	await page.getByTestId('ranking-select').selectOption('increase');
	expect(await renderedOrder(page)).toEqual([ALPHA, GAMMA, BETA, DELTA]);
	await expect(alphaRow, 'ranked first by increase').toHaveAttribute(
		'data-rank',
		'1'
	);
	await expect(gammaRow(page)).toHaveAttribute('data-rank', '2');
	await expect(deltaRow).toHaveAttribute('data-rank', '4');
	await page.getByTestId('ranking-select').selectOption('cost');
	expect(await renderedOrder(page)).toEqual([ALPHA, BETA, GAMMA, DELTA]);

	// Drilldown: the Project's recognized costs and its unresolved evidence are
	// both reachable, with the entry date that says what arrived late.
	await betaRow(page).locator('[data-testid="project-expand"]').click();
	const betaDrilldown = betaRow(page).locator('xpath=following-sibling::tr[1]');
	await expect(
		betaDrilldown.locator('[data-testid="project-drilldown"]')
	).toBeVisible();
	const betaRecord = betaDrilldown.locator(
		'[data-testid="drilldown-record"][data-source-reference="E2E-320-INV-B01"]'
	);
	await expect(betaRecord).toBeVisible();
	await expect(betaRecord).toHaveAttribute('data-created-at', /2022-06-04/);
	await expect(
		betaDrilldown.locator(
			'[data-testid="drilldown-unconfirmed-record"][data-state="draft"]'
		)
	).toHaveAttribute('data-gross-amount', '30000');

	await deltaRow.locator('[data-testid="project-expand"]').click();
	const deltaDrilldown = deltaRow.locator('xpath=following-sibling::tr[1]');
	const deltaPending = deltaDrilldown.locator(
		'[data-testid="drilldown-unconfirmed-record"][data-state="pending_evidence"]'
	);
	await expect(deltaPending).toHaveAttribute('data-gross-amount', '');
	await expect(
		deltaDrilldown.locator('[data-testid="drilldown-exception"]')
	).toContainText('missing_amount');
	await deltaRow.locator('[data-testid="project-expand"]').click();

	// Financial-year navigation moves a year at a time and never into the
	// future: June 2023 has no cost at all, which is a coverage warning rather
	// than proof of zero expenditure.
	await page.getByTestId('fy-next').click();
	await expect(view).toHaveAttribute('data-month', '2023-06');
	await expect(page.getByTestId('fy-label')).toContainText('FY 2023–24');
	await expect(
		page.locator(
			'[data-testid="coverage-notice"][data-code="no_recognized_cost"]'
		)
	).toBeVisible();
	await expect(
		page.locator(
			'[data-testid="comparison-disclosure"][data-code="no_prior_period_evidence"]'
		)
	).toBeVisible();
	await expect(page.getByTestId('comparison-current')).toContainText(
		'No cost recorded'
	);
	await expect(page.getByTestId('comparison-prior')).toContainText('Unknown');
	await page.getByTestId('fy-prev').click();
	await expect(view).toHaveAttribute('data-month', MONTH);
	await expect(page.getByTestId('fy-label')).toContainText(FY_LABEL);

	// The filtered Project subtotal never replaces the company position.
	await page.getByLabel('Project filter', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(ALPHA);
	await page.getByRole('button', { name: new RegExp(ALPHA) }).click();
	const subtotal = page.getByTestId('filtered-subtotal');
	await expect(subtotal).toBeVisible();
	await expect(
		subtotal.locator('[data-testid="filtered-subtotal-currency"]')
	).toHaveAttribute('data-incurred', String(EXPECTED.alpha.month));
	await expect(page.getByTestId('comparison-current')).toHaveAttribute(
		'data-value',
		String(EXPECTED.company.month)
	);
	await expect(alphaRow).toHaveAttribute('data-rank', '1');
	await page.getByLabel('Project filter', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill('All');
	await page.getByRole('button', { name: 'All projects', exact: true }).click();
	await expect(page.getByTestId('filtered-subtotal')).toBeHidden();

	// A January–March month composes its financial-year candidate in the
	// following calendar year, so the step is capped against the current month
	// itself: no step may open a future month.
	await page.getByLabel('Month', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill('January 2026');
	await page.getByRole('button', { name: 'January 2026', exact: true }).click();
	await expect(view).toHaveAttribute('data-month', '2026-01');
	await expect(page.getByTestId('fy-label')).toHaveAttribute('data-fy', '2025');
	await page.getByTestId('fy-next').click();
	const stepped = (await view.getAttribute('data-month')) ?? '';
	const currentMonthNow = new Date().toISOString().slice(0, 7);
	expect(stepped <= currentMonthNow, `${stepped} vs ${currentMonthNow}`).toBe(
		true
	);
	expect(stepped).toBe('2027-01' <= currentMonthNow ? '2027-01' : '2026-01');
	await openExpenditure(page, MONTH_LABEL);
	await expect(view).toHaveAttribute('data-month', MONTH);

	evidence.browserReport = {
		currentMonth,
		financialYear: FY_LABEL,
		fullMonth: {
			basis: 'full_month',
			current: EXPECTED.company.month,
			prior: EXPECTED.company.priorMonth,
			percent: '18.4%',
		},
		orders: {
			byCost: [ALPHA, BETA, GAMMA, DELTA],
			byIncrease: [ALPHA, GAMMA, BETA, DELTA],
		},
		steppedTo: '2023-06',
		futureStep: { from: '2026-01', visited: stepped, currentMonthNow },
	};
});

test('records, recognizes, and re-ranks a cost through the report controls', async ({
	page,
	request,
}) => {
	await openExpenditure(page, MONTH_LABEL);
	const view = page.getByTestId('expenditure-view');
	const companyBefore = Number(
		await page.getByTestId('comparison-current').getAttribute('data-value')
	);
	expect(companyBefore).toBe(EXPECTED.company.month);

	await page.getByRole('button', { name: 'Record cost', exact: true }).click();
	const form = page.getByTestId('cost-form');
	await expect(form).toBeVisible();
	await form
		.getByLabel('Classification', { exact: true })
		.selectOption('project');
	await form.getByLabel('Project', { exact: true }).click();
	await page.getByPlaceholder('Search...').fill(ENTERED);
	await page.getByRole('button', { name: new RegExp(ENTERED) }).click();
	await form
		.getByLabel('Source reference', { exact: true })
		.fill(UI_ENTRY.sourceReference);
	await form
		.getByLabel('Vendor', { exact: true })
		.fill(`${EXPENDITURE_VENDOR_PREFIX}320-ui`);
	await form
		.getByLabel('Description', { exact: true })
		.fill('E2E 320 cost entered in the browser');
	await form
		.getByLabel('Service period start', { exact: true })
		.fill(UI_ENTRY.serviceStart);
	await form
		.getByLabel('Service period end', { exact: true })
		.fill(UI_ENTRY.serviceEnd);
	await form.getByLabel('Bill date', { exact: true }).fill(UI_ENTRY.billDate);
	await form
		.getByLabel('Gross amount', { exact: true })
		.fill(String(UI_ENTRY.gross));
	await form.getByLabel('Tax treatment', { exact: true }).selectOption('none');
	await form
		.getByLabel('Evidence reference', { exact: true })
		.fill('E2E-320-GRN-UI-1');
	await form
		.getByRole('button', { name: 'Save and submit', exact: true })
		.click();
	await expect(form).toBeHidden();

	// The entry waits in the review queue and changes no confirmed figure.
	const queueRow = page.locator(
		`[data-testid="queue-row"][data-source-reference="${UI_ENTRY.sourceReference}"]`
	);
	await expect(queueRow).toBeVisible();
	await expect(queueRow).toHaveAttribute('data-state', 'pending_evidence');
	await expect(page.getByTestId('comparison-current')).toHaveAttribute(
		'data-value',
		String(companyBefore)
	);
	const queued = await rows<{
		id: number;
		cost_uid: string;
		financial_version: number;
		recognition_state: string;
		recognition_period: string;
		period_basis: string;
		total_amount: string;
	}>(
		`SELECT id, cost_uid, financial_version, recognition_state, recognition_period,
            period_basis, total_amount
       FROM expenses WHERE source_reference = ? AND isDelete = 0`,
		[UI_ENTRY.sourceReference]
	);
	expect(queued).toHaveLength(1);
	expect(queued[0].recognition_state).toBe('pending_evidence');
	expect(Number(queued[0].financial_version)).toBe(1);
	expect(Number(queued[0].total_amount)).toBe(UI_ENTRY.gross);
	expect(String(queued[0].recognition_period).slice(0, 10)).toBe(`${MONTH}-01`);
	expect(queued[0].period_basis).toBe('service_period');
	const createdId = Number(queued[0].id);
	createdThroughApp.push({
		id: createdId,
		cost_uid: String(queued[0].cost_uid),
		where: 'ui',
	});

	await queueRow
		.getByRole('button', { name: 'Recognize', exact: true })
		.click();
	const dialog = page.getByTestId('command-dialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E 320 evidence reviewed');
	await dialog
		.getByRole('button', { name: 'Recognize expense', exact: true })
		.click();
	await expect(dialog).toBeHidden();

	// The new Project enters both orderings: last by cost, unranked by increase
	// because it has no comparable prior-period cost. Its cost arrives in the
	// window through the service period it was recognized with.
	await expect
		.poll(
			async () =>
				Number(
					await page
						.getByTestId('comparison-current')
						.getAttribute('data-value')
				),
			{ timeout: 10_000 }
		)
		.toBe(companyBefore + UI_ENTRY.gross);
	const enteredRow = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${ENTERED}"]`
	);
	await expect(enteredRow).toHaveAttribute('data-rank', '5');
	await expect(enteredRow).toHaveAttribute('data-rank-increase', '');
	await expect(enteredRow).toHaveAttribute('data-evidence-state', 'recorded');
	await expect(enteredRow).toHaveAttribute(
		'data-comparison-cost',
		String(UI_ENTRY.gross)
	);
	await expect(
		page.locator(
			'[data-testid="comparison-disclosure"][data-code="unknown_prior_cost"]'
		)
	).toHaveAttribute('data-count', '1');
	await expect(view).toHaveAttribute('data-month', MONTH);
	await expect(
		page
			.getByTestId('recognition-queue')
			.locator(
				`[data-testid="queue-row"][data-source-reference="${UI_ENTRY.sourceReference}"]`
			)
	).toBeHidden();

	// The cost is durable, versioned, and counted once.
	const recognized = await rows<{
		recognition_state: string;
		financial_version: number;
		recognized_amount: string;
		recognized_by: number | null;
		recognized_at: string | null;
	}>(
		`SELECT recognition_state, financial_version, recognized_amount,
            recognized_by, recognized_at
       FROM expenses WHERE id = ?`,
		[createdId]
	);
	expect(recognized[0].recognition_state).toBe('recognized');
	expect(Number(recognized[0].financial_version)).toBe(2);
	expect(Number(recognized[0].recognized_amount)).toBe(UI_ENTRY.gross);
	expect(Number(recognized[0].recognized_by)).toBeGreaterThan(0);
	expect(recognized[0].recognized_at).toBeTruthy();
	const journal = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		[String(queued[0].cost_uid)]
	);
	expect(journal.map((entry) => entry.version)).toEqual([1, 2]);
	expect(journal.map((entry) => entry.command)).toEqual([
		'recorded',
		'recognized',
	]);

	// The same figure is what the API reports for the month, and the new row
	// carries its own unknown prior amount rather than a zero.
	const after = await reconciliation(request, { month: MONTH });
	expect(after.company.incurred_cost).toBe(companyBefore + UI_ENTRY.gross);
	const entered = rowOf(after, ENTERED);
	expect(entered.comparison_cost).toBe(UI_ENTRY.gross);
	expect(entered.previous_period_cost).toBeNull();
	expect(entered.change_percent).toBeNull();
	expect(entered.change_state).toBe('no_prior');
	expect(entered.cost_to_date).toBe(UI_ENTRY.gross);
	expect(
		after.ranking.increase_unranked.map((entry) => entry.project_id)
	).toContain(entered.project_id);

	evidence.browserEntry = {
		sourceReference: UI_ENTRY.sourceReference,
		expenseId: createdId,
		costUid: queued[0].cost_uid,
		expected: UI_ENTRY.gross,
		companyBefore,
		companyAfter: companyBefore + UI_ENTRY.gross,
		row: {
			comparison: entered.comparison_cost,
			prior: entered.previous_period_cost,
			state: entered.change_state,
			toDate: entered.cost_to_date,
		},
		journal: journal.map((entry) => `${entry.version}:${entry.command}`),
	};
});

test('states a currency-split comparison per currency, not as unknown', async ({
	page,
	request,
}) => {
	// September 2021's comparison spans currencies: INR this month, USD in the
	// prior month. No single prior or change figure exists, yet each currency's
	// own amount is known and stated.
	const data = await reconciliation(request, { month: '2022-09' });
	expect(data.comparison.currency).toBeNull();
	expect(data.comparison.prior_cost).toBeNull();
	expect(data.comparison.change_amount).toBeNull();
	expect(data.comparison.change_percent).toBeNull();
	const split = data.comparison.currency_totals.map((row) => row.currency);
	expect(split).toEqual(['INR', 'USD']);
	const inr = data.comparison.currency_totals.find(
		(row) => row.currency === 'INR'
	)!;
	const usd = data.comparison.currency_totals.find(
		(row) => row.currency === 'USD'
	)!;
	expect(inr.current_cost).toBe(10000);
	expect(inr.prior_cost).toBeNull();
	expect(usd.current_cost).toBe(0);
	expect(usd.prior_cost).toBe(200);
	expect(usd.change_amount).toBe(-200);

	await openExpenditure(page, 'September 2021');
	const view = page.getByTestId('expenditure-view');
	await expect(view).toHaveAttribute('data-month', '2022-09');
	await expect(page.getByTestId('comparison-prior')).toContainText(
		'See currencies'
	);
	await expect(page.getByTestId('comparison-change')).toContainText(
		'See currencies'
	);
	await expect(page.getByTestId('comparison-percent')).toContainText(
		'See currencies'
	);
	const usdRow = page.locator(
		'[data-testid="comparison-currency-row"][data-currency="USD"]'
	);
	await expect(usdRow).toHaveAttribute('data-current', '0');
	await expect(usdRow).toHaveAttribute('data-prior', '200');
	const inrRow = page.locator(
		'[data-testid="comparison-currency-row"][data-currency="INR"]'
	);
	await expect(inrRow).toHaveAttribute('data-current', '10000');
	// The INR prior is genuinely unknown — nothing in the prior month is in
	// rupees — so that cell keeps saying so rather than borrowing the dollar.
	await expect(inrRow).toHaveAttribute('data-prior', '');
	await expect(inrRow).toContainText('Unknown');

	evidence.currencySplit = {
		month: '2022-09',
		currencies: split,
		inr: { current: inr.current_cost, prior: inr.prior_cost },
		usd: {
			current: usd.current_cost,
			prior: usd.prior_cost,
			change: usd.change_amount,
		},
		panel: {
			prior: 'See currencies',
			change: 'See currencies',
			percent: 'See currencies',
		},
	};
});

test('withholds an elapsed-window change for day-less monthly cost', async ({
	request,
}) => {
	// April 2022 measured to its 15th: p320g's approved 12000 charge is dated
	// in the reported month and p320h's approved 5000 charge in the prior one.
	// A charge belongs to its month, not to a day, so neither can be placed
	// inside the window: the window figures stay at the dated cost (p320g's
	// prior window is its recorded zero) and the change is withheld — never a
	// fabricated new cost, never an increase.
	const charges = await reconciliation(request, {
		month: CHARGE_CASE.month,
		asOf: CHARGE_CASE.asOf,
	});
	expect(charges.comparison.basis).toBe('equal_period');
	expect(charges.comparison.currency).toBe('INR');
	expect(charges.comparison.current_cost).toBe(0);
	expect(charges.comparison.prior_cost).toBe(CHARGE_CASE.priorWindow);
	expect(charges.comparison.change_amount).toBeNull();
	expect(charges.comparison.change_percent).toBeNull();
	expect(charges.comparison.change_state).toBe('unproven');
	const chargeWindow = charges.comparison.currency_totals[0];
	expect(chargeWindow.dayless_records).toBe(CHARGE_CASE.daylessCount);
	expect(chargeWindow.dayless_cost).toBe(CHARGE_CASE.daylessAmount);
	// The prior window's 0 is p320g's recorded zero row, not the two
	// non-operating sources in March: those are balances, never cost, so they
	// never enter the window figures.
	const chargeRow = rowOf(charges, CHARGE_PROJECT);
	expect(chargeRow.incurred_cost).toBe(CHARGE_CASE.aprilCharge);
	expect(chargeRow.period_charge_count).toBe(1);
	expect(chargeRow.comparison_cost).toBe(0);
	expect(chargeRow.previous_period_cost).toBe(CHARGE_CASE.priorWindow);
	expect(chargeRow.change_amount).toBeNull();
	expect(chargeRow.change_percent).toBeNull();
	expect(chargeRow.change_state).toBe('unproven');
	expect(chargeRow.change_state).not.toBe('new');
	expect(chargeRow.change_state).not.toBe('increase');
	expect(chargeRow.cost_to_date).toBe(0);
	// The month states the charge as its own cost, and the window withholds
	// only the comparison.
	expect(charges.company.incurred_cost).toBe(CHARGE_CASE.aprilCharge);
	const dayless = disclosureOf(charges, 'dayless_monthly_cost_unproven');
	expect(dayless.count).toBe(CHARGE_CASE.daylessCount);
	expect(dayless.amount).toBe(CHARGE_CASE.daylessAmount);
	expect(disclosureCodes(charges)).not.toContain('window_evidence_unproven');
	// The withheld change keeps the Project out of the increase ordering with
	// its own reason, and the recorded zero is not announced as a new cost.
	expect(charges.ranking.by_increase).toHaveLength(0);
	expect(
		charges.ranking.increase_unranked.map((entry) => [
			entry.project_id,
			entry.reason,
		])
	).toEqual([[chargeRow.project_id, 'unproven_partial_window']]);
	expect(disclosureCodes(charges)).not.toContain('zero_prior_cost');
	// The charges are durable evidence, one approved row per month.
	const storedCharges = await rows<{
		charge_uid: string;
		charge_period: string;
		amount: string;
		state: string;
	}>(
		`SELECT charge_uid, charge_period, amount, state FROM expense_period_charges
      WHERE charge_uid IN ('e2e-charge-320-g1', 'e2e-charge-320-h1')
      ORDER BY charge_uid`
	);
	expect(
		storedCharges.map((entry) => [
			entry.charge_uid,
			String(entry.charge_period).slice(0, 10),
			Number(entry.amount),
			entry.state,
		])
	).toEqual([
		['e2e-charge-320-g1', '2022-04-01', 12000, 'approved'],
		['e2e-charge-320-h1', '2022-03-01', 5000, 'approved'],
	]);

	// February 2026 measured to its 15th: the finalized payroll month's
	// recorded 37539 is day-less monthly cost too. Without the rule the
	// comparison would state a fall against January's 2500 while the month's
	// real cost sat outside the window; with it the change is withheld, and
	// the two costed Projects cannot be ranked by increase either.
	const payroll = await reconciliation(request, {
		month: PAYROLL_CASE.month,
		asOf: PAYROLL_CASE.asOf,
	});
	expect(payroll.payroll?.recorded_total).toBe(PAYROLL_CASE.recorded);
	expect(payroll.company.incurred_cost).toBe(PAYROLL_CASE.recorded);
	expect(payroll.comparison.currency).toBe('INR');
	expect(payroll.comparison.current_cost).toBe(0);
	expect(payroll.comparison.prior_cost).toBe(PAYROLL_CASE.priorWindow);
	expect(payroll.comparison.change_amount).toBeNull();
	expect(payroll.comparison.change_state).toBe('unproven');
	expect(payroll.comparison.change_state).not.toBe('decrease');
	expect(payroll.comparison.change_state).not.toBe('increase');
	const payrollWindow = payroll.comparison.currency_totals[0];
	expect(payrollWindow.dayless_records).toBe(PAYROLL_CASE.recordedCount);
	expect(payrollWindow.dayless_cost).toBe(PAYROLL_CASE.recorded);
	const payrollDayless = disclosureOf(payroll, 'dayless_monthly_cost_unproven');
	expect(payrollDayless.count).toBe(PAYROLL_CASE.recordedCount);
	expect(payrollDayless.amount).toBe(PAYROLL_CASE.recorded);
	for (const [code, amount] of [
		[ALLOCATION_PROJECTS.p1.code, PAYROLL_CASE.p1],
		[ALLOCATION_PROJECTS.p2.code, PAYROLL_CASE.p2],
	] as const) {
		const row = rowOf(payroll, code);
		expect(row.employee_cost).toBe(amount);
		expect(row.incurred_cost).toBe(amount);
		expect(row.comparison_cost).toBe(0);
		expect(row.change_amount).toBeNull();
		expect(row.change_state).toBe('unproven');
	}
	const payrollUnranked = payroll.ranking.increase_unranked
		.filter((entry) => entry.reason === 'unproven_partial_window')
		.map((entry) => entry.project_id);
	expect(payrollUnranked).toEqual(
		expect.arrayContaining([
			rowOf(payroll, ALLOCATION_PROJECTS.p1.code).project_id,
			rowOf(payroll, ALLOCATION_PROJECTS.p2.code).project_id,
		])
	);
	// The database states the finalized month's recorded cost the comparison
	// refused to prorate.
	const storedAllocation = await rows<{ amount: string }>(
		`SELECT SUM(s.amount) AS amount
       FROM payroll_employee_allocation_shares s
       JOIN payroll_employee_allocations a ON a.id = s.allocation_id
      WHERE a.month = ?`,
		[`${PAYROLL_CASE.month}-01`]
	);
	expect(Number(storedAllocation[0].amount)).toBe(PAYROLL_CASE.recorded);

	evidence.dayless = {
		charges: {
			month: CHARGE_CASE.month,
			asOf: CHARGE_CASE.asOf,
			window: {
				current: charges.comparison.current_cost,
				prior: charges.comparison.prior_cost,
				state: charges.comparison.change_state,
			},
			dayless: {
				count: chargeWindow.dayless_records,
				amount: chargeWindow.dayless_cost,
			},
			row: {
				code: chargeRow.project_code,
				incurred: chargeRow.incurred_cost,
				state: chargeRow.change_state,
			},
			stored: storedCharges.map((entry) => [
				entry.charge_uid,
				String(entry.charge_period).slice(0, 10),
				Number(entry.amount),
			]),
		},
		payroll: {
			month: PAYROLL_CASE.month,
			asOf: PAYROLL_CASE.asOf,
			window: {
				current: payroll.comparison.current_cost,
				prior: payroll.comparison.prior_cost,
				state: payroll.comparison.change_state,
			},
			dayless: {
				count: payrollWindow.dayless_records,
				amount: payrollWindow.dayless_cost,
			},
			unranked: payrollUnranked.length,
			stored: Number(storedAllocation[0].amount),
		},
	};
});
