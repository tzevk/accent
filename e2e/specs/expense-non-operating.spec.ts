import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	EXPENDITURE_AD_HOC_CHARGE_MONTH,
	EXPENDITURE_CATEGORY,
	EXPENDITURE_CHARGE_MONTH,
	EXPENDITURE_CHARGE_LATER_MONTH,
	EXPENDITURE_COSTS,
	EXPENDITURE_SOURCE_MONTH,
	EXPENDITURE_VENDOR_PREFIX,
	cleanupExpenditureFixtures,
	loginExpenditureReportOnlyReader,
	seedExpenditureFixtures,
	seededCharge,
	seededCost,
	type SeededExpenditure,
} from '../lib/expenditure-fixtures';

/**
 * Ticket #317 — advances, deposits, prepayments, and capital items separated
 * from operating cost, with approved period consumption (depreciation,
 * amortization) recognised in its own month.
 *
 * Every number here is stated from the fixture literals and the business
 * rules, never from the module's aggregation: the fixture rows say what the
 * balances and charges are worth, this file says what the reconciliation must
 * therefore show, and the assertions compare the app's answer with that
 * arithmetic.
 *
 * Month map (no other spec's expected totals change):
 *   2019-07  the source balances (advance, deposit, prepayment, capital) are
 *            recognised — none of them is Company Incurred Cost;
 *   2019-08  the first period charges fall (advance consumption, prepayment
 *            consumption, capital depreciation) beside one operating cost;
 *   2019-09  the prepayment's second period charge falls;
 *   2020-01  only ad-hoc charges this spec creates and cancels.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity (ADR-0013), so a combined run cannot
	// exhaust another spec's budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.24' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const SOURCE_MONTH = EXPENDITURE_SOURCE_MONTH;
const CHARGE_MONTH = EXPENDITURE_CHARGE_MONTH;
const LATER_MONTH = EXPENDITURE_CHARGE_LATER_MONTH;
const AD_HOC_MONTH = EXPENDITURE_AD_HOC_CHARGE_MONTH;

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

/** The month a browser operator would use: the current one. */
const UI_MONTH = new Date().toISOString().slice(0, 7);
const UI_MONTH_LABEL = labelOf(UI_MONTH);
const UI_MONTH_IP = '198.18.0.25';

/**
 * Hand-computed from the seeded #317 rows. The source balances recognized in
 * July are never cost; only the approved charges dated in a month are.
 */
const NON_OPERATING = {
	advance: 60000,
	deposit: 30000,
	prepayment: 12000,
	capitalGross: 118000,
	/** Gross 118000 less the 18000 evidenced recoverable tax, once. */
	capitalRecognized: 100000,
	draftAdvance: 4000,
	unresolvedNature: 7000,
} as const;

/** Recognized source balances excluded from July's Company Incurred Cost. */
const JULY_EXCLUDED =
	NON_OPERATING.advance +
	NON_OPERATING.deposit +
	NON_OPERATING.prepayment +
	NON_OPERATING.capitalRecognized;

const AUGUST_CHARGES =
	20000 /* advance consumption */ +
	4000 /* prepayment, first period */ +
	5000; /* capital depreciation */
/** The cancelled 10000 deposit charge must not appear in these figures. */
const AUGUST_OPERATING = 5000;
const AUGUST = {
	/** Every project-classified charge: alpha 20000 + 5000, beta 4000. */
	project: 20000 + 5000 + 4000,
	projectAlpha: 25000,
	projectBeta: 4000,
	overhead: AUGUST_OPERATING,
	unallocated: 0,
	total: 20000 + 5000 + 4000 + AUGUST_OPERATING,
	charges: AUGUST_CHARGES,
	chargeRecords: 3,
	/** Charges to date against the July sources (prepayment's second is September). */
	consumedToDate: 20000 + 12000 + 5000,
} as const;
const SEPTEMBER = {
	beta: 8000,
	total: 8000,
	charges: 8000,
} as const;

const API_CHARGE = {
	period: AD_HOC_MONTH,
	basis: 'amortization' as const,
	amount: 1000,
	evidence: 'E2E-CHG-317-API-OK',
} as const;

const UI_EXPENSE = {
	sourceReference: 'E2E-INV-UI-317',
	nature: 'advance' as const,
	gross: 1500,
	evidence: 'E2E-GRN-UI-317',
} as const;
const UI_CHARGE = {
	period: `${UI_MONTH}-01`,
	basis: 'consumption' as const,
	amount: 500,
	evidence: 'E2E-CHG-UI-317',
} as const;

interface PeriodChargeData {
	charge_uid: string;
	source_cost_uid: string;
	source_expense_id: number;
	source_expense_number: string;
	source_state: string;
	cost_nature: string;
	cost_classification: string | null;
	project_code: string | null;
	period: string;
	basis: string;
	amount: number;
	currency: string;
	evidence_reference: string;
	state: string;
	financial_version: number;
	approved_by: number | null;
	approved_at: string | null;
	cancel_reason: string | null;
	source_recognized_amount: number | null;
}

interface NonOperatingItemData {
	expense_id: number;
	cost_uid: string;
	expense_number: string;
	nature: string;
	source_state: string;
	cost_classification: string | null;
	project_code: string | null;
	currency: string;
	gross_amount: number | null;
	recognized_amount: number | null;
	recognition_period: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	consumed_this_month: number;
	consumed_to_date: number;
	remaining_amount: number | null;
	charges: PeriodChargeData[];
}

interface BudgetComparisonData {
	project_code: string;
	currency: string;
	incurred_cost: number | null;
	confirmed_records: number;
	period_charges: number;
	pending_records: number;
	outcome: string;
	budget: { budget_uid: string; amount: number } | null;
	variance: number | null;
	over_budget: boolean | null;
	detail: string;
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
			period_charge_amount: number;
			period_charge_count: number;
		}>;
		groups: Array<{ key: string; amount: number; record_count: number }>;
		record_count: number;
	};
	projects: Array<{
		project_code: string;
		currency: string;
		incurred_cost: number;
		period_charge_count: number;
	}>;
	evidence: {
		recognized: { count: number; currency: string | null; amount: number | null };
		period_charges: {
			count: number;
			currency: string | null;
			amount: number | null;
		};
		non_operating_recognized: {
			count: number;
			currency: string | null;
			amount: number | null;
		};
		unresolved_nature: {
			count: number;
			currency: string | null;
			amount: number | null;
		};
	};
	non_operating: {
		currency: string | null;
		excluded_source_amount: number | null;
		consumed_this_month: number | null;
		consumed_to_date: number | null;
		remaining_amount: number | null;
		unapproved_count: number;
		unresolved_count: number;
		unresolved_source_amount: number | null;
		items: NonOperatingItemData[];
		charges_from_prior_items: PeriodChargeData[];
	};
	coverage: Array<{ code: string; label: string; detail: string }>;
	/** #321's section: a budget never enters the cost totals above. */
	budgets: {
		comparisons: BudgetComparisonData[];
		notices: Array<{ code: string; label: string; detail: string }>;
	};
}

interface DrilldownData {
	month: string;
	total: number;
	records: Array<{
		expense_number: string;
		source_reference: string | null;
		cost_nature: string;
		recognized_amount: number | null;
		gross_amount: number | null;
	}>;
	period_charges: PeriodChargeData[];
	totals: {
		confirmed_amount: number | null;
		currency: string | null;
		records: number;
		non_operating_amount: number | null;
		nature_unresolved_amount: number | null;
		period_charge_amount: number | null;
		period_charge_records: number;
	};
}

let seeded: SeededExpenditure;
const artifact: Record<string, unknown> = { ok: true };
const created: Array<{ id: number; cost_uid: string; where: string }> = [];
const createdCharges: Array<{ charge_uid: string; where: string }> = [];

function publish(): void {
	writeArtifact('expense-non-operating', {
		...artifact,
		fixtureScope: {
			sourceMonth: SOURCE_MONTH,
			chargeMonths: [CHARGE_MONTH, LATER_MONTH],
			adHocChargeMonth: AD_HOC_MONTH,
			expenseNumbers: EXPENDITURE_COSTS.filter((cost) =>
				String(cost.expenseNumber).includes('317')
			).map((cost) => cost.expenseNumber),
		},
		createdThroughApp: { expenses: created, charges: createdCharges },
	});
}

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
	return (await response.json()).data as DrilldownData;
}

function group(data: ReconciliationData, key: string): number {
	const found = data.company.groups.find((entry) => entry.key === key);
	expect(found, `group ${key}`).toBeTruthy();
	return found!.amount;
}

function codes(data: ReconciliationData): string[] {
	return data.coverage.map((entry) => entry.code);
}

function item(
	data: ReconciliationData,
	costUid: string
): NonOperatingItemData | undefined {
	return data.non_operating.items.find((entry) => entry.cost_uid === costUid);
}

async function captureCharge(
	request: APIRequestContext,
	sourceId: number,
	data: Record<string, unknown>
) {
	return request.post(`/api/admin/expenses/${sourceId}/charges`, { data });
}

async function cancelCharge(
	request: APIRequestContext,
	sourceId: number,
	chargeUid: string,
	data: Record<string, unknown>
) {
	return request.post(
		`/api/admin/expenses/${sourceId}/charges/${chargeUid}`,
		{ data: { command: 'cancel', ...data } }
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
	return Number(await page.getByTestId(testId).getAttribute('data-amount'));
}

function itemRow(page: Page, costUid: string) {
	return page.locator(
		`[data-testid="non-operating-item"][data-cost-uid="${costUid}"]`
	);
}

test.beforeAll(async () => {
	seeded = await seedExpenditureFixtures();
	artifact.seeded = {
		costs: seeded.costs,
		projects: seeded.projects,
		chargeIds: seeded.chargeIds,
	};
});

test.afterAll(async () => {
	publish();
	if (createdCharges.length) {
		const uids = createdCharges.map((entry) => entry.charge_uid);
		const placeholders = uids.map(() => '?').join(', ');
		await exec(
			`DELETE FROM expense_period_charge_events WHERE charge_uid IN (${placeholders})`,
			uids
		);
		await exec(
			`DELETE FROM expense_period_charges WHERE charge_uid IN (${placeholders})`,
			uids
		);
	}
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

test('excludes non-operating balances from Company Incurred Cost and shows them separately', async ({
	request,
}) => {
	const data = await reconciliation(request, SOURCE_MONTH);

	// July holds four recognized non-operating balances and no operating cost:
	// the payment is not expensed, and the month states no company cost at all
	// rather than claiming a zero it cannot prove.
	expect(data.month).toBe(SOURCE_MONTH);
	expect(data.company.incurred_cost).toBeNull();
	expect(data.company.currency_totals).toEqual([]);
	expect(data.company.groups).toEqual([]);
	expect(data.company.record_count).toBe(0);
	expect(data.evidence.recognized.count).toBe(0);
	expect(codes(data)).toContain('no_recognized_cost');
	expect(codes(data)).toContain('non_operating_items_separate');

	// The excluded balances are stated separately, per item, with their
	// original identity, amount, currency/tax basis, and evidence.
	expect(data.non_operating.currency).toBe('INR');
	expect(data.non_operating.excluded_source_amount).toBe(JULY_EXCLUDED);
	expect(data.non_operating.consumed_this_month).toBe(0);
	expect(data.non_operating.consumed_to_date).toBe(AUGUST.consumedToDate);
	expect(data.non_operating.remaining_amount).toBe(
		JULY_EXCLUDED - AUGUST.consumedToDate
	);
	expect(data.evidence.non_operating_recognized).toEqual({
		count: 4,
		currency: 'INR',
		amount: JULY_EXCLUDED,
	});
	// The unapproved advance has no supported balance yet.
	expect(data.non_operating.unapproved_count).toBe(1);
	expect(data.non_operating.unresolved_count).toBe(0);
	expect(codes(data)).toContain('non_operating_item_not_approved');

	const advance = item(data, seededCost('advancePractice').costUid)!;
	expect(advance).toBeTruthy();
	expect(advance.nature).toBe('advance');
	expect(advance.source_state).toBe('recognized');
	expect(advance.cost_classification).toBe('project');
	expect(advance.project_code).toBe('E2E-EXP-P1');
	expect(advance.gross_amount).toBe(NON_OPERATING.advance);
	expect(advance.recognized_amount).toBe(NON_OPERATING.advance);
	expect(advance.consumed_this_month).toBe(0);
	expect(advance.consumed_to_date).toBe(20000);
	expect(advance.remaining_amount).toBe(40000);
	expect(advance.source_reference).toBe('E2E-INV-317-A');
	expect(advance.evidence_reference).toBe('E2E-GRN-317-A');
	expect(advance.charges).toEqual([]);

	const deposit = item(data, seededCost('depositPractice').costUid)!;
	expect(deposit.nature).toBe('deposit');
	// The cancelled deposit charge neither counts nor reduces the balance.
	expect(deposit.consumed_to_date).toBe(0);
	expect(deposit.remaining_amount).toBe(NON_OPERATING.deposit);

	const prepayment = item(data, seededCost('prepaymentPractice').costUid)!;
	expect(prepayment.nature).toBe('prepayment');
	expect(prepayment.consumed_to_date).toBe(12000);
	expect(prepayment.remaining_amount).toBe(0);

	const capital = item(data, seededCost('capitalPractice').costUid)!;
	expect(capital.nature).toBe('capital');
	// The supported balance is net of evidenced recoverable tax.
	expect(capital.gross_amount).toBe(NON_OPERATING.capitalGross);
	expect(capital.recognized_amount).toBe(NON_OPERATING.capitalRecognized);
	expect(capital.consumed_to_date).toBe(5000);
	expect(capital.remaining_amount).toBe(
		NON_OPERATING.capitalRecognized - 5000
	);

	const draft = item(data, seededCost('draftAdvance').costUid)!;
	expect(draft.source_state).toBe('draft');
	expect(draft.recognized_amount).toBeNull();
	expect(draft.remaining_amount).toBeNull();

	// Source detail separates the same way: the nature filter returns only the
	// non-operating rows, whose amounts are not confirmed operating cost.
	const nonOperating = await drilldown(request, {
		month: SOURCE_MONTH,
		nature: 'non_operating',
	});
	expect(nonOperating.total).toBe(5);
	expect(
		nonOperating.records.every((record) =>
			['advance', 'deposit', 'prepayment', 'capital'].includes(
				record.cost_nature
			)
		)
	).toBe(true);
	expect(nonOperating.totals.confirmed_amount).toBe(0);
	expect(nonOperating.totals.non_operating_amount).toBe(JULY_EXCLUDED);
	expect(nonOperating.totals.period_charge_records).toBe(0);

	// The database agrees: the recognized non-operating rows carry their own
	// nature and are excluded from recognized operating cost.
	const stored = await rows<{ nature: string; total: string; records: number }>(
		`SELECT cost_nature AS nature, SUM(recognized_amount) AS total, COUNT(*) AS records
       FROM expenses
      WHERE isDelete = 0 AND recognition_state = 'recognized'
        AND cost_nature <> 'operating'
        AND recognition_period BETWEEN ? AND ?
      GROUP BY cost_nature
      ORDER BY cost_nature`,
		[`${SOURCE_MONTH}-01`, `${SOURCE_MONTH}-31`]
	);
	expect(
		stored.map((row) => [row.nature, Number(row.total)])
	).toEqual([
		['advance', NON_OPERATING.advance],
		['capital', NON_OPERATING.capitalRecognized],
		['deposit', NON_OPERATING.deposit],
		['prepayment', NON_OPERATING.prepayment],
	]);

	artifact.july = {
		incurredCost: data.company.incurred_cost,
		excluded: data.non_operating.excluded_source_amount,
		remaining: data.non_operating.remaining_amount,
		items: data.non_operating.items.map((entry) => ({
			uid: entry.cost_uid,
			nature: entry.nature,
			state: entry.source_state,
			recognized: entry.recognized_amount,
			consumed: entry.consumed_to_date,
			remaining: entry.remaining_amount,
		})),
	};
});

test('counts approved period consumption in its own month, never the balance month', async ({
	request,
}) => {
	// The July balances are still excluded after the charges exist: the month
	// still states no operating cost of its own.
	const july = await reconciliation(request, SOURCE_MONTH);
	expect(july.company.incurred_cost).toBeNull();
	expect(july.non_operating.consumed_this_month).toBe(0);

	const august = await reconciliation(request, CHARGE_MONTH);
	expect(august.company.currency).toBe('INR');
	expect(group(august, 'incurred_project_cost')).toBe(AUGUST.project);
	expect(group(august, 'company_overhead')).toBe(AUGUST.overhead);
	expect(group(august, 'unallocated_cost')).toBe(AUGUST.unallocated);
	expect(august.company.incurred_cost).toBe(AUGUST.total);
	expect(august.evidence.recognized).toEqual({
		count: 1,
		currency: 'INR',
		amount: AUGUST_OPERATING,
	});
	expect(august.evidence.period_charges).toEqual({
		count: AUGUST.chargeRecords,
		currency: 'INR',
		amount: AUGUST.charges,
	});

	// Only the three approved charges are cost; the cancelled deposit charge
	// is not, and the unresolved-nature record is not.
	const inr = august.company.currency_totals.find(
		(row) => row.currency === 'INR'
	)!;
	expect(inr.period_charge_amount).toBe(AUGUST.charges);
	expect(inr.period_charge_count).toBe(AUGUST.chargeRecords);
	expect(august.company.incurred_cost).toBe(
		AUGUST.charges + AUGUST_OPERATING
	);

	const alpha = august.projects.find((row) => row.project_code === 'E2E-EXP-P1')!;
	const beta = august.projects.find((row) => row.project_code === 'E2E-EXP-P2')!;
	expect(alpha.incurred_cost).toBe(AUGUST.projectAlpha);
	expect(alpha.period_charge_count).toBe(2);
	expect(beta.incurred_cost).toBe(AUGUST.projectBeta);
	expect(beta.period_charge_count).toBe(1);

	// A charge-only Project row is confirmed cost for the budget comparison
	// (#317): alpha's August cost of 25000 — two approved period charges and no
	// operating record — is compared rather than reported as unsupported cost,
	// and the comparison publishes the charges it counted.
	const alphaBudget = august.budgets.comparisons.find(
		(row) => row.project_code === 'E2E-EXP-P1' && row.currency === 'INR'
	)!;
	expect(alphaBudget).toBeTruthy();
	expect(alphaBudget.period_charges).toBe(2);
	expect(alphaBudget.incurred_cost).toBe(AUGUST.projectAlpha);
	expect(alphaBudget.outcome).not.toBe('unsupported_incurred_cost');
	expect(august.budgets.notices.map((notice) => notice.code)).not.toContain(
		'budget_unsupported_incurred_cost'
	);

	// Each item states its own consumption for the month and what remains.
	const advance = item(august, seededCost('advancePractice').costUid)!;
	expect(advance.consumed_this_month).toBe(20000);
	expect(advance.consumed_to_date).toBe(20000);
	expect(advance.remaining_amount).toBe(40000);
	expect(advance.charges.map((charge) => charge.charge_uid)).toEqual([
		seededCharge('advanceConsumption').chargeUid,
	]);
	expect(advance.charges[0].basis).toBe('consumption');
	expect(advance.charges[0].evidence_reference).toBe('E2E-CHG-317-A1');

	const deposit = item(august, seededCost('depositPractice').costUid)!;
	expect(deposit.consumed_this_month).toBe(0);
	expect(deposit.consumed_to_date).toBe(0);
	expect(deposit.remaining_amount).toBe(NON_OPERATING.deposit);
	expect(deposit.charges.map((charge) => charge.state)).toEqual(['cancelled']);
	expect(deposit.charges[0].cancel_reason).toBe(
		seededCharge('depositCancelled').cancelReason
	);

	const capital = item(august, seededCost('capitalPractice').costUid)!;
	expect(capital.charges[0].basis).toBe('depreciation');
	expect(capital.consumed_this_month).toBe(5000);
	expect(capital.remaining_amount).toBe(
		NON_OPERATING.capitalRecognized - 5000
	);

	// The items in this month are the July sources carrying a charge here plus
	// the unresolved-nature record; no July balance is recognised in August.
	expect(august.non_operating.excluded_source_amount).toBe(0);
	expect(august.non_operating.consumed_this_month).toBe(AUGUST.charges);
	expect(august.non_operating.unapproved_count).toBe(0);
	expect(august.non_operating.unresolved_count).toBe(1);
	expect(august.non_operating.unresolved_source_amount).toBe(
		NON_OPERATING.unresolvedNature
	);
	expect(august.non_operating.charges_from_prior_items).toHaveLength(4);
	expect(codes(august)).toContain('period_charges_counted');
	expect(codes(august)).toContain('nature_unresolved_treatment');

	// The prepayment is consumed across periods: its final charge lands in
	// September, and its remaining balance reaches zero there.
	const september = await reconciliation(request, LATER_MONTH);
	expect(september.company.incurred_cost).toBe(SEPTEMBER.total);
	expect(group(september, 'incurred_project_cost')).toBe(SEPTEMBER.beta);
	const prepayment = item(september, seededCost('prepaymentPractice').costUid)!;
	expect(prepayment.consumed_this_month).toBe(SEPTEMBER.charges);
	expect(prepayment.consumed_to_date).toBe(12000);
	expect(prepayment.remaining_amount).toBe(0);
	expect(prepayment.charges.map((charge) => charge.charge_uid)).toEqual([
		seededCharge('prepaymentSecond').chargeUid,
	]);

	// The source drilldown shows the charges of the month and the split totals.
	const chargeDrilldown = await drilldown(request, {
		month: CHARGE_MONTH,
	});
	expect(chargeDrilldown.totals.period_charge_amount).toBe(AUGUST.charges);
	expect(chargeDrilldown.totals.period_charge_records).toBe(
		AUGUST.chargeRecords
	);
	expect(chargeDrilldown.period_charges).toHaveLength(4);
	expect(
		chargeDrilldown.period_charges.map((charge) => charge.charge_uid).sort()
	).toEqual(
		[
			seededCharge('advanceConsumption').chargeUid,
			seededCharge('depositCancelled').chargeUid,
			seededCharge('capitalDepreciation').chargeUid,
			seededCharge('prepaymentFirst').chargeUid,
		].sort()
	);
	const approvedCharge = chargeDrilldown.period_charges.find(
		(charge) => charge.charge_uid === seededCharge('advanceConsumption').chargeUid
	)!;
	expect(approvedCharge.source_cost_uid).toBe(
		seededCost('advancePractice').costUid
	);
	expect(approvedCharge.cost_nature).toBe('advance');
	expect(approvedCharge.cost_classification).toBe('project');
	expect(approvedCharge.project_code).toBe('E2E-EXP-P1');
	expect(approvedCharge.period).toBe(`${CHARGE_MONTH}-01`);
	expect(approvedCharge.amount).toBe(20000);
	expect(approvedCharge.currency).toBe('INR');
	expect(approvedCharge.state).toBe('approved');
	expect(approvedCharge.financial_version).toBe(1);
	expect(approvedCharge.approved_at).toBeTruthy();
	expect(approvedCharge.source_recognized_amount).toBe(60000);

	artifact.charges = {
		august: {
			incurredCost: august.company.incurred_cost,
			groups: august.company.groups,
			chargeAmount: inr.period_charge_amount,
			chargeRecords: inr.period_charge_count,
			evidence: august.evidence,
		},
		september: {
			incurredCost: september.company.incurred_cost,
			project: group(september, 'incurred_project_cost'),
		},
		budgetSupport: {
			project: alphaBudget.project_code,
			outcome: alphaBudget.outcome,
			incurredCost: alphaBudget.incurred_cost,
			periodCharges: alphaBudget.period_charges,
			unsupportedNotice: august.budgets.notices.some(
				(notice) => notice.code === 'budget_unsupported_incurred_cost'
			),
		},
		items: august.non_operating.items.map((entry) => ({
			uid: entry.cost_uid,
			nature: entry.nature,
			consumedThisMonth: entry.consumed_this_month,
			consumedToDate: entry.consumed_to_date,
			remaining: entry.remaining_amount,
		})),
	};
});

test('refuses a duplicate or oversized period charge and preserves the balance', async ({
	request,
}) => {
	const advanceId = seeded.expenseIds.advancePractice;
	const advanceUid = seededCost('advancePractice').costUid;

	const before = await rows<{ records: number }>(
		`SELECT COUNT(*) AS records FROM expense_period_charges WHERE source_cost_uid = ?`,
		[advanceUid]
	);

	// The same month, basis, and source already has an approved charge: the
	// consumption cannot be entered twice.
	const duplicate = await captureCharge(request, advanceId, {
		period: CHARGE_MONTH,
		basis: 'consumption',
		amount: 20000,
		evidence_reference: 'E2E-CHG-317-DUP',
		reason: 'E2E duplicate attempt',
	});
	expect(duplicate.status(), await duplicate.text()).toBe(409);
	const duplicateBody = await duplicate.json();
	expect(duplicateBody.code).toBe('duplicate_period_charge');

	// Consumption cannot exceed the supported source balance (60000 − 20000).
	const oversized = await captureCharge(request, advanceId, {
		period: AD_HOC_MONTH,
		basis: 'consumption',
		amount: 999999,
		evidence_reference: 'E2E-CHG-317-BIG',
	});
	expect(oversized.status()).toBe(422);
	const oversizedBody = await oversized.json();
	expect(oversizedBody.code).toBe('exceeds_source_balance');
	expect(oversizedBody.remaining_amount).toBe(40000);

	// An operating cost is not a balance to consume.
	const operating = await captureCharge(
		request,
		seeded.expenseIds.operatingChargeMonth,
		{
			period: AD_HOC_MONTH,
			basis: 'consumption',
			amount: 100,
			evidence_reference: 'E2E-CHG-317-OP',
		}
	);
	expect(operating.status()).toBe(422);
	expect((await operating.json()).code).toBe('nature_not_non_operating');

	// An unapproved item has no supported balance yet.
	const unapproved = await captureCharge(
		request,
		seeded.expenseIds.draftAdvance,
		{
			period: AD_HOC_MONTH,
			basis: 'consumption',
			amount: 100,
			evidence_reference: 'E2E-CHG-317-DRAFT',
		}
	);
	expect(unapproved.status()).toBe(409);
	expect((await unapproved.json()).code).toBe('source_not_recognized');

	// Evidence, amount, and currency are required and must agree with the
	// source; every refusal leaves the ledger untouched.
	const noEvidence = await captureCharge(request, advanceId, {
		period: AD_HOC_MONTH,
		basis: 'consumption',
		amount: 100,
	});
	expect(noEvidence.status()).toBe(422);
	expect((await noEvidence.json()).code).toBe('charge_evidence_required');
	const noAmount = await captureCharge(request, advanceId, {
		period: AD_HOC_MONTH,
		basis: 'consumption',
		evidence_reference: 'E2E-CHG-317-NOAMOUNT',
	});
	expect(noAmount.status()).toBe(422);
	expect((await noAmount.json()).code).toBe('invalid_charge_amount');
	const wrongCurrency = await captureCharge(request, advanceId, {
		period: AD_HOC_MONTH,
		basis: 'consumption',
		amount: 100,
		currency: 'USD',
		evidence_reference: 'E2E-CHG-317-USD',
	});
	expect(wrongCurrency.status()).toBe(422);
	expect((await wrongCurrency.json()).code).toBe('charge_currency_mismatch');
	const badPeriod = await captureCharge(request, advanceId, {
		period: '2019-13',
		basis: 'consumption',
		amount: 100,
		evidence_reference: 'E2E-CHG-317-PERIOD',
	});
	expect(badPeriod.status()).toBe(422);
	expect((await badPeriod.json()).code).toBe('invalid_charge_period');
	const afterRefusals = await rows<{ records: number }>(
		`SELECT COUNT(*) AS records FROM expense_period_charges WHERE source_cost_uid = ?`,
		[advanceUid]
	);
	expect(Number(afterRefusals[0].records)).toBe(Number(before[0].records));

	// An approved charge is real cost in its own month and reduces the balance.
	const createdResponse = await captureCharge(request, advanceId, {
		period: API_CHARGE.period,
		basis: API_CHARGE.basis,
		amount: API_CHARGE.amount,
		evidence_reference: API_CHARGE.evidence,
		reason: 'E2E approved amortization',
	});
	expect(createdResponse.status(), await createdResponse.text()).toBe(200);
	const charged = (await createdResponse.json()).data as PeriodChargeData;
	createdCharges.push({
		charge_uid: charged.charge_uid,
		where: 'api',
	});
	expect(charged.charge_uid).toMatch(/^charge-/);
	expect(charged.state).toBe('approved');
	expect(charged.financial_version).toBe(1);
	expect(charged.approved_by).toBeGreaterThan(0);
	expect(charged.amount).toBe(API_CHARGE.amount);
	expect(charged.basis).toBe(API_CHARGE.basis);

	const withCharge = await reconciliation(request, API_CHARGE.period);
	expect(withCharge.company.incurred_cost).toBe(API_CHARGE.amount);
	expect(item(withCharge, advanceUid)!.remaining_amount).toBe(39000);

	// A stale version cannot cancel, and the charge's journal is append-only.
	const stale = await cancelCharge(request, advanceId, charged.charge_uid, {
		expected_version: 99,
		reason: 'E2E stale cancel',
	});
	expect(stale.status()).toBe(409);
	expect((await stale.json()).code).toBe('version_conflict');

	const cancelled = await cancelCharge(request, advanceId, charged.charge_uid, {
		expected_version: 1,
		reason: 'E2E wrong period',
	});
	expect(cancelled.status(), await cancelled.text()).toBe(200);
	const cancelledBody = (await cancelled.json()).data as PeriodChargeData;
	expect(cancelledBody.state).toBe('cancelled');
	expect(cancelledBody.financial_version).toBe(2);
	expect(cancelledBody.cancel_reason).toBe('E2E wrong period');

	// Cancelling restores the balance: the cancelled charge is not cost, and the
	// ad-hoc month has no operating cost of its own again.
	const afterCancel = await reconciliation(request, API_CHARGE.period);
	expect(afterCancel.company.incurred_cost).toBeNull();
	expect(item(afterCancel, advanceUid)!.remaining_amount).toBe(40000);
	expect(item(afterCancel, advanceUid)!.consumed_to_date).toBe(20000);

	// The freed period and basis can be re-entered (a cancelled charge does
	// not block the month forever); both rows stay in the journal.
	const recaptured = await captureCharge(request, advanceId, {
		period: API_CHARGE.period,
		basis: API_CHARGE.basis,
		amount: API_CHARGE.amount,
		evidence_reference: API_CHARGE.evidence,
	});
	expect(recaptured.status(), await recaptured.text()).toBe(200);
	const recapturedBody = (await recaptured.json()).data as PeriodChargeData;
	expect(recapturedBody.charge_uid).not.toBe(charged.charge_uid);
	expect(recapturedBody.state).toBe('approved');
	expect(
		item(await reconciliation(request, API_CHARGE.period), advanceUid)!
			.remaining_amount
	).toBe(39000);

	const cleanup = await cancelCharge(
		request,
		advanceId,
		recapturedBody.charge_uid,
		{ expected_version: 1, reason: 'E2E fixture cleanup' }
	);
	expect(cleanup.status(), await cleanup.text()).toBe(200);

	const ledger = await rows<{
		state: string;
		financial_version: number;
		sequence: number;
	}>(
		`SELECT state, financial_version, sequence FROM expense_period_charges
      WHERE charge_uid IN (?, ?) ORDER BY sequence`,
		[charged.charge_uid, recapturedBody.charge_uid]
	);
	expect(ledger.map((row) => [row.state, Number(row.sequence)])).toEqual([
		['cancelled', 1],
		['cancelled', 2],
	]);
	const events = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM expense_period_charge_events
      WHERE charge_uid = ? ORDER BY version`,
		[charged.charge_uid]
	);
	expect(events.map((row) => [Number(row.version), row.command])).toEqual([
		[1, 'approved'],
		[2, 'cancelled'],
	]);

	artifact.refusals = {
		duplicate: { status: duplicate.status(), code: duplicateBody.code },
		oversized: {
			status: oversized.status(),
			code: oversizedBody.code,
			remaining: oversizedBody.remaining_amount,
		},
		operating: operating.status(),
		unapproved: unapproved.status(),
		noEvidence: noEvidence.status(),
		noAmount: noAmount.status(),
		wrongCurrency: wrongCurrency.status(),
		badPeriod: badPeriod.status(),
		staleCancel: stale.status(),
	};
	artifact.apiCharge = {
		period: API_CHARGE.period,
		amount: API_CHARGE.amount,
		state: cancelledBody.state,
		version: cancelledBody.financial_version,
		events: events.map((row) => [Number(row.version), row.command]),
	};
});

test('captures and cancels a period charge through the report controls', async ({
	page,
	request,
}) => {
	await openExpenditure(page, labelOf(CHARGE_MONTH));
	const section = page.getByTestId('non-operating-section');
	await expect(section).toBeVisible();

	const advance = itemRow(page, seededCost('advancePractice').costUid);
	await expect(advance).toBeVisible();
	await expect(advance).toHaveAttribute('data-nature', 'advance');
	await expect(advance).toHaveAttribute('data-remaining', '40000');

	// Capture through the real control: the charge's own month is what makes it
	// cost, not the month of the balance it consumes.
	await advance.getByTestId('capture-charge').click();
	const dialog = page.getByTestId('period-charge-dialog');
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Period', { exact: true }).fill(AD_HOC_MONTH);
	await dialog
		.getByLabel('Charge basis', { exact: true })
		.selectOption('consumption');
	await dialog.getByLabel('Amount', { exact: true }).fill('5000');
	await dialog
		.getByLabel('Evidence reference', { exact: true })
		.fill('E2E-CHG-317-UI');
	await dialog.getByLabel('Note', { exact: true }).fill('E2E UI capture');
	await dialog
		.getByRole('button', { name: 'Save period charge', exact: true })
		.click();
	await expect(dialog).toBeHidden();

	await expect(advance).toHaveAttribute('data-remaining', '35000', {
		timeout: 10_000,
	});
	const stored = await rows<Record<string, unknown>>(
		`SELECT id, charge_uid, state, financial_version, amount, charge_period,
            currency, evidence_reference, approved_by, approved_at
       FROM expense_period_charges
      WHERE source_cost_uid = ? AND evidence_reference = ? AND state = 'approved'`,
		[seededCost('advancePractice').costUid, 'E2E-CHG-317-UI']
	);
	expect(stored).toHaveLength(1);
	const uiChargeUid = String(stored[0].charge_uid);
	createdCharges.push({
		charge_uid: uiChargeUid,
		where: 'ui',
	});
	expect(Number(stored[0].amount)).toBe(5000);
	expect(String(stored[0].charge_period).slice(0, 7)).toBe(AD_HOC_MONTH);
	expect(stored[0].currency).toBe('INR');
	expect(Number(stored[0].approved_by)).toBeGreaterThan(0);
	expect(stored[0].approved_at).toBeTruthy();

	// The charge's own month sees the cost; the balance's month does not.
	const chargedMonth = await reconciliation(request, AD_HOC_MONTH);
	expect(chargedMonth.company.incurred_cost).toBe(5000);
	const balanceMonth = await reconciliation(request, CHARGE_MONTH);
	expect(balanceMonth.company.incurred_cost).toBe(AUGUST.total);
	expect(item(balanceMonth, seededCost('advancePractice').costUid)!.remaining_amount).toBe(
		35000
	);

	// A duplicate through the same control surfaces the refusal and writes
	// nothing.
	await advance.getByTestId('capture-charge').click();
	await expect(dialog).toBeVisible();
	await dialog.getByLabel('Period', { exact: true }).fill(CHARGE_MONTH);
	await dialog
		.getByLabel('Charge basis', { exact: true })
		.selectOption('consumption');
	await dialog.getByLabel('Amount', { exact: true }).fill('20000');
	await dialog
		.getByLabel('Evidence reference', { exact: true })
		.fill('E2E-CHG-317-UI-DUP');
	await dialog
		.getByRole('button', { name: 'Save period charge', exact: true })
		.click();
	await expect(dialog.getByRole('alert')).toContainText('already');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	const duplicates = await rows<{ records: number }>(
		`SELECT COUNT(*) AS records FROM expense_period_charges
      WHERE evidence_reference = 'E2E-CHG-317-UI-DUP'`
	);
	expect(Number(duplicates[0].records)).toBe(0);

	// Cancel through the control: the balance comes back and the journal keeps
	// both entries.
	const chargeRow = advance.locator(
		`[data-testid="period-charge"][data-charge-uid="${uiChargeUid}"]`
	);
	await expect(chargeRow).toBeVisible();
	await chargeRow.getByRole('button', { name: 'Cancel charge' }).click();
	const cancelDialog = page.getByTestId('charge-cancel-dialog');
	await expect(cancelDialog).toBeVisible();
	await cancelDialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E UI cancellation');
	await cancelDialog
		.getByRole('button', { name: 'Cancel charge', exact: true })
		.click();
	await expect(cancelDialog).toBeHidden();
	await expect(advance).toHaveAttribute('data-remaining', '40000', {
		timeout: 10_000,
	});

	const afterCancel = await rows<Record<string, unknown>>(
		`SELECT state, financial_version, cancel_reason FROM expense_period_charges
      WHERE charge_uid = ?`,
		[uiChargeUid]
	);
	expect(afterCancel[0].state).toBe('cancelled');
	expect(Number(afterCancel[0].financial_version)).toBe(2);
	expect(afterCancel[0].cancel_reason).toBe('E2E UI cancellation');
	const events = await rows<{ version: number; command: string }>(
		`SELECT version, command FROM expense_period_charge_events
      WHERE charge_uid = ? ORDER BY version`,
		[uiChargeUid]
	);
	expect(events.map((row) => [Number(row.version), row.command])).toEqual([
		[1, 'approved'],
		[2, 'cancelled'],
	]);
	expect(
		(await reconciliation(request, AD_HOC_MONTH)).company.incurred_cost
	).toBeNull();

	artifact.uiCharge = {
		chargeUid: uiChargeUid,
		amount: 5000,
		state: afterCancel[0].state,
		version: Number(afterCancel[0].financial_version),
		events: events.map((row) => [Number(row.version), row.command]),
		duplicateAttempt: 'refused in dialog; no row written',
	};
});

test('records a non-operating item through the report and excludes it until consumed', async ({
	page,
	request,
}) => {
	await openExpenditure(page, UI_MONTH_LABEL);
	const companyBefore = await kpi(page, 'kpi-incurred-cost');

	await page.getByRole('button', { name: 'Record cost', exact: true }).click();
	const form = page.getByTestId('cost-form');
	await expect(form).toBeVisible();
	await form.getByLabel('Nature', { exact: true }).selectOption(UI_EXPENSE.nature);
	await form
		.getByLabel('Classification', { exact: true })
		.selectOption('company_overhead');
	await form
		.getByLabel('Source reference', { exact: true })
		.fill(UI_EXPENSE.sourceReference);
	await form
		.getByLabel('Vendor', { exact: true })
		.fill(`${EXPENDITURE_VENDOR_PREFIX}ui-317`);
	await form
		.getByLabel('Description', { exact: true })
		.fill('E2E UI advance recorded through the report');
	await form
		.getByLabel('Service period start', { exact: true })
		.fill(`${UI_MONTH}-03`);
	await form
		.getByLabel('Service period end', { exact: true })
		.fill(`${UI_MONTH}-03`);
	await form.getByLabel('Bill date', { exact: true }).fill(`${UI_MONTH}-05`);
	await form
		.getByLabel('Gross amount', { exact: true })
		.fill(String(UI_EXPENSE.gross));
	await form.getByLabel('Tax treatment', { exact: true }).selectOption('none');
	await form
		.getByLabel('Evidence reference', { exact: true })
		.fill(UI_EXPENSE.evidence);
	await form.getByRole('button', { name: 'Save and submit', exact: true }).click();
	await expect(form).toBeHidden();

	const queued = await rows<Record<string, unknown>>(
		`SELECT id, cost_uid, cost_nature, recognition_state, financial_version
       FROM expenses WHERE source_reference = ? AND isDelete = 0`,
		[UI_EXPENSE.sourceReference]
	);
	expect(queued).toHaveLength(1);
	expect(queued[0].cost_nature).toBe(UI_EXPENSE.nature);
	const createdId = Number(queued[0].id);
	const createdUid = String(queued[0].cost_uid);
	created.push({ id: createdId, cost_uid: createdUid, where: 'ui-317' });

	const row = page.locator(
		`[data-testid="queue-row"][data-source-reference="${UI_EXPENSE.sourceReference}"]`
	);
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Recognize', exact: true }).click();
	const dialog = page.getByTestId('command-dialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E advance approved');
	await dialog
		.getByRole('button', { name: 'Recognize expense', exact: true })
		.click();
	await expect(dialog).toBeHidden();

	// The recognized advance is a supported balance, not cost.
	const itemSection = page.getByTestId('non-operating-section');
	await expect(itemSection).toBeVisible();
	const advance = itemRow(page, createdUid);
	await expect(advance).toBeVisible({ timeout: 10_000 });
	await expect(advance).toHaveAttribute('data-nature', 'advance');
	await expect(advance).toHaveAttribute('data-recognized', '1500');
	await expect(advance).toHaveAttribute('data-remaining', '1500');
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(companyBefore);

	// Consuming it adds exactly the charge to this month's cost.
	await advance.getByTestId('capture-charge').click();
	const chargeDialog = page.getByTestId('period-charge-dialog');
	await expect(chargeDialog).toBeVisible();
	await chargeDialog
		.getByLabel('Period', { exact: true })
		.fill(UI_CHARGE.period.slice(0, 7));
	await chargeDialog
		.getByLabel('Charge basis', { exact: true })
		.selectOption(UI_CHARGE.basis);
	await chargeDialog
		.getByLabel('Amount', { exact: true })
		.fill(String(UI_CHARGE.amount));
	await chargeDialog
		.getByLabel('Evidence reference', { exact: true })
		.fill(UI_CHARGE.evidence);
	await chargeDialog
		.getByRole('button', { name: 'Save period charge', exact: true })
		.click();
	await expect(chargeDialog).toBeHidden();

	await expect(advance).toHaveAttribute('data-remaining', '1000', {
		timeout: 10_000,
	});
	await expect
		.poll(async () => kpi(page, 'kpi-incurred-cost'), { timeout: 10_000 })
		.toBe(companyBefore + UI_CHARGE.amount);

	const uiCharges = await rows<Record<string, unknown>>(
		`SELECT id, charge_uid, amount, basis, state, financial_version
       FROM expense_period_charges
      WHERE source_id = ? AND evidence_reference = ?`,
		[createdId, UI_CHARGE.evidence]
	);
	expect(uiCharges).toHaveLength(1);
	createdCharges.push({
		charge_uid: String(uiCharges[0].charge_uid),
		where: 'ui-317',
	});
	expect(Number(uiCharges[0].amount)).toBe(UI_CHARGE.amount);
	expect(uiCharges[0].basis).toBe(UI_CHARGE.basis);

	// A register edit cannot reclassify the item: nature is a versioned
	// financial field, changed only through the command path.
	const registerEdit = await request.put(
		`/api/admin/expenses/${createdId}`,
		{ data: { cost_nature: 'capital' } }
	);
	expect(registerEdit.status()).toBe(422);
	const refusal = await registerEdit.json();
	expect(refusal.code).toBe('financial_fields_versioned');
	expect(refusal.fields).toContain('cost_nature');
	const unchanged = await rows<{ cost_nature: string; notes: string | null }>(
		`SELECT cost_nature, notes FROM expenses WHERE id = ?`,
		[createdId]
	);
	expect(unchanged[0].cost_nature).toBe('advance');

	artifact.uiItem = {
		month: UI_MONTH,
		sourceReference: UI_EXPENSE.sourceReference,
		nature: UI_EXPENSE.nature,
		recognized: UI_EXPENSE.gross,
		charge: UI_CHARGE,
		registerRefusal: { status: registerEdit.status(), fields: refusal.fields },
	};
});

test('keeps unresolved treatment and source identity visible in the record', async ({
	request,
}) => {
	const august = await reconciliation(request, CHARGE_MONTH);
	const unresolved = item(august, seededCost('unresolvedNature').costUid)!;
	expect(unresolved.nature).toBe('unresolved');
	expect(unresolved.source_state).toBe('recognized');
	expect(unresolved.recognized_amount).toBe(NON_OPERATING.unresolvedNature);
	expect(unresolved.consumed_to_date).toBe(0);
	expect(unresolved.remaining_amount).toBeNull();
	expect(august.evidence.unresolved_nature).toEqual({
		count: 1,
		currency: 'INR',
		amount: NON_OPERATING.unresolvedNature,
	});
	expect(codes(august)).toContain('nature_unresolved_treatment');
	// The unresolved record is excluded from cost: unallocated stays zero.
	expect(group(august, 'unallocated_cost')).toBe(0);

	// The drilldown answers in the same terms.
	const drilled = await drilldown(request, {
		month: CHARGE_MONTH,
		nature: 'unresolved',
	});
	expect(drilled.total).toBe(1);
	expect(drilled.records[0].expense_number).toBe(
		seededCost('unresolvedNature').expenseNumber
	);
	expect(drilled.totals.nature_unresolved_amount).toBe(
		NON_OPERATING.unresolvedNature
	);
	expect(drilled.totals.confirmed_amount).toBe(0);

	// The July draft advance is visible as an unapproved item with no balance.
	const july = await reconciliation(request, SOURCE_MONTH);
	const draft = item(july, seededCost('draftAdvance').costUid)!;
	expect(draft.source_state).toBe('draft');
	expect(draft.remaining_amount).toBeNull();
	expect(july.non_operating.unapproved_count).toBe(1);
	expect(codes(july)).toContain('non_operating_item_not_approved');

	artifact.visibility = {
		unresolved: {
			count: august.evidence.unresolved_nature.count,
			amount: august.evidence.unresolved_nature.amount,
			unallocated: group(august, 'unallocated_cost'),
		},
		unapproved: july.non_operating.unapproved_count,
		codes: { august: codes(august), july: codes(july) },
	};
});

test('refuses unauthorized charge writes and reads without changing data', async ({
	playwright,
	request,
}) => {
	const advanceId = seeded.expenseIds.advancePractice;
	const advanceUid = seededCost('advancePractice').costUid;
	const before = await rows<{ records: number }>(
		`SELECT COUNT(*) AS records FROM expense_period_charges WHERE source_cost_uid = ?`,
		[advanceUid]
	);
	const chargeUid = seededCharge('advanceConsumption').chargeUid;

	const employee = await playwright.request.newContext({
		baseURL: E2E_ENV.baseURL,
		storageState: 'e2e/.auth/employee.json',
		extraHTTPHeaders: { 'x-vercel-forwarded-for': UI_MONTH_IP },
	});
	let reader: APIRequestContext | null = null;
	try {
		const write = await employee.post(
			`/api/admin/expenses/${advanceId}/charges`,
			{
				data: {
					period: AD_HOC_MONTH,
					basis: 'amortization',
					amount: 100,
					evidence_reference: 'E2E-CHG-317-UNAUTH',
				},
			}
		);
		expect(write.status()).toBe(403);
		const cancel = await employee.post(
			`/api/admin/expenses/${advanceId}/charges/${chargeUid}`,
			{ data: { command: 'cancel', expected_version: 1, reason: 'E2E' } }
		);
		expect(cancel.status()).toBe(403);
		const read = await employee.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${SOURCE_MONTH}`
		);
		expect(read.status()).toBe(403);
		const drill = await employee.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${SOURCE_MONTH}&nature=non_operating`
		);
		expect(drill.status()).toBe(403);

		// A report reader with `reports:read` but no expense-ledger privilege
		// receives neither the balances nor a way to consume them.
		reader = await loginExpenditureReportOnlyReader(
			playwright,
			E2E_ENV.baseURL
		);
		const readerReport = await reader.get(
			`/api/reports/employee-project-monthly-cost?view=expenditure&month=${SOURCE_MONTH}`
		);
		expect(readerReport.status()).toBe(403);
		expect(JSON.stringify(await readerReport.json())).not.toContain('E2E-INV-317');
		const readerDrill = await reader.get(
			`/api/reports/employee-project-monthly-cost/expenses?month=${SOURCE_MONTH}`
		);
		expect(readerDrill.status()).toBe(403);
		const readerWrite = await reader.post(
			`/api/admin/expenses/${advanceId}/charges`,
			{
				data: {
					period: AD_HOC_MONTH,
					basis: 'amortization',
					amount: 100,
					evidence_reference: 'E2E-CHG-317-READER',
				},
			}
		);
		expect(readerWrite.status()).toBe(403);

		const after = await rows<{ records: number }>(
			`SELECT COUNT(*) AS records FROM expense_period_charges WHERE source_cost_uid = ?`,
			[advanceUid]
		);
		expect(Number(after[0].records)).toBe(Number(before[0].records));
		const untouched = await rows<{ state: string; financial_version: number }>(
			`SELECT state, financial_version FROM expense_period_charges WHERE charge_uid = ?`,
			[chargeUid]
		);
		expect(untouched[0].state).toBe('approved');
		expect(Number(untouched[0].financial_version)).toBe(1);

		artifact.authorization = {
			employee: {
				write: write.status(),
				cancel: cancel.status(),
				read: read.status(),
				drilldown: drill.status(),
			},
			reportOnlyReader: {
				reconciliation: readerReport.status(),
				drilldown: readerDrill.status(),
				write: readerWrite.status(),
			},
			unchanged: untouched[0],
		};
	} finally {
		await employee.dispose();
		if (reader) await reader.dispose();
	}
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	const artifactFile = readArtifact('expense-non-operating');
	expect(artifactFile).toMatchObject({ ok: true });
	for (const key of ['july', 'charges', 'refusals', 'apiCharge', 'uiCharge']) {
		expect(artifactFile[key], key).toBeTruthy();
	}
});
