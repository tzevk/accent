import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readArtifact, writeArtifact } from '../lib/artifacts';
import { exec, rows } from '../lib/db';
import { E2E_ENV } from '../lib/env';
import {
	CURRENCY_CATEGORY,
	CURRENCY_CONTROL_MONTH,
	CURRENCY_EXPENSE_PREFIX,
	CURRENCY_MISSING_MONTH,
	CURRENCY_MONTH,
	CURRENCY_PROJECTS,
	CURRENCY_RATES,
	CURRENCY_REPORTING_CURRENCY,
	CURRENCY_VENDOR_PREFIX,
	cleanupExpenditureCurrencyFixtures,
	loginExpenditureCurrencyEditor,
	seedExpenditureCurrencyFixtures,
	type SeededCurrencyExpenditure,
} from '../lib/expenditure-currency-fixtures';

/**
 * Ticket #319 — conversion evidence and the shared conversion interpretation.
 *
 * Everything here is stated from the fixture literals and hand arithmetic,
 * never from the module's own aggregation: the seeded rows state their
 * original amounts and rates, this file states the reporting amounts those
 * inputs must produce, and the assertions compare the app's answer with that
 * arithmetic. The two rounding-boundary rows prove half-up cent rounding and
 * that the ten-decimal rate survives as a string.
 *
 * The AED rate the command path applies in 2019-12 is the same
 * `0.50 × 22.63 = 11.315 → 11.32` boundary, exercised through the versioned
 * command after an unauthorized attempt is refused.
 */

test.use({
	storageState: 'e2e/.auth/admin-report.json',
	// This spec's own rate-limit identity, set through the proxy's trusted
	// header (ADR-0013), so a combined run cannot exhaust the shared budget.
	extraHTTPHeaders: { 'x-vercel-forwarded-for': '198.18.0.25' },
});
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const MONTH = CURRENCY_MONTH;
const MISSING_MONTH = CURRENCY_MISSING_MONTH;
const CONTROL_MONTH = CURRENCY_CONTROL_MONTH;

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
 * Hand-computed from the seeded 2019-10 rows at their stamped rates:
 *   INR 10,000.00                                    → 10,000.00
 *   USD 1,234.57 × 83.123456789                      → 102,621.73
 *   USD   500.55 × 83.123456789                      →  41,607.45
 *   AED     0.50 × 22.63 = 11.315      half-up cents →      11.32
 *   USD 195,312.50 × 82.9999974656 = 16,210,937.005  → 16,210,937.01
 */
const OCTOBER = {
	inr: 10000,
	usdProject: 102621.73,
	usdOverhead: 41607.45,
	aedUnallocated: 11.32,
	preciseUsdUnallocated: 16210937.01,
} as const;
const OCTOBER_GROUPS = {
	project: OCTOBER.inr + OCTOBER.usdProject,
	overhead: OCTOBER.usdOverhead,
	unallocated: OCTOBER.aedUnallocated + OCTOBER.preciseUsdUnallocated,
} as const;
const OCTOBER_TOTAL =
	OCTOBER_GROUPS.project + OCTOBER_GROUPS.overhead + OCTOBER_GROUPS.unallocated;
const OCTOBER_USD_REPORTING = {
	project: OCTOBER.usdProject,
	overhead: OCTOBER.usdOverhead,
	unallocated: OCTOBER.preciseUsdUnallocated,
} as const;
const OCTOBER_USD_REPORTING_TOTAL =
	OCTOBER_USD_REPORTING.project +
	OCTOBER_USD_REPORTING.overhead +
	OCTOBER_USD_REPORTING.unallocated;

/** 2019-11: known currencies plus a cost whose original currency is unknown. */
const NOVEMBER = {
	inr: 2000,
	usdUnsupported: 100,
	unknownCurrency: 500,
} as const;

/** 2019-12 control flows. */
const CONTROL = {
	inr: 1000,
	aedOriginal: 0.5,
	aedConverted: 11.32,
	eurRate: '90.987654321',
	eurOriginal: 250.25,
	eurConverted: 22769.66,
} as const;
const CONTROL_TOTAL_AFTER_RATE = CONTROL.inr + CONTROL.aedConverted;
const CONTROL_TOTAL_AFTER_ENTRY =
	CONTROL_TOTAL_AFTER_RATE + CONTROL.eurConverted;

interface CurrencyReportingData {
	currency: string;
	status: 'reporting' | 'converted' | 'unsupported';
	unsupported_count: number;
	incurred_project_cost: number | null;
	company_overhead: number | null;
	unallocated_cost: number | null;
	incurred_cost: number | null;
	gross_liability: number | null;
	recoverable_tax: number | null;
	unresolved_tax_gross: number | null;
}

interface ReconciliationData {
	month: string;
	month_label: string;
	project_id: number | null;
	company: {
		reporting_currency: string;
		conversion: {
			status: 'reporting' | 'converted' | 'unsupported';
			converted_records: number;
			unsupported_records: number;
			unsupported_currencies: string[];
			unknown_currency_records: number;
		};
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
			reporting: CurrencyReportingData;
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
		conversion_status: 'reporting' | 'converted' | 'unsupported';
		converted_incurred_cost: number | null;
		incurred_cost: number;
		record_count: number;
		not_confirmed_cost: number | null;
		previous_period_cost: number | null;
		change_amount: number | null;
		change_state: string;
	}>;
	evidence: {
		recognized: {
			count: number;
			currency: string | null;
			amount: number | null;
		};
		missing_currency: { count: number };
		missing_amount: { count: number };
		known_zero: { count: number };
		unresolved_classification: {
			count: number;
			currency: string | null;
			gross_amount: number | null;
		};
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
	currency: string | null;
	gross_amount: number | null;
	recognized_amount: number | null;
	reporting_currency: string | null;
	conversion_rate: string | null;
	conversion_date: string | null;
	conversion_evidence_reference: string | null;
	converted_amount: number | null;
	conversion_status: string;
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

let seeded: SeededCurrencyExpenditure;
const evidence: Record<string, unknown> = { ok: true, months: [] };
/** Ids this spec records through the app, so the run leaves nothing behind. */
const created: Array<{ id: number; cost_uid: string; where: string }> = [];
/** The pending row the unknown-currency test records, for the edit refusal. */
let unknownCurrencyRowId = 0;

function publish(): void {
	writeArtifact('expenditure-currency', {
		...evidence,
		months: [MONTH, MISSING_MONTH, CONTROL_MONTH],
		fixtureScope: {
			projects: Object.values(CURRENCY_PROJECTS).map((p) => p.code),
			prefix: CURRENCY_EXPENSE_PREFIX,
		},
		createdThroughApp: created,
	});
}

async function reconciliation(
	request: APIRequestContext,
	month: string,
	options: { projectId?: number; reportingCurrency?: string } = {}
): Promise<ReconciliationData> {
	const params = new URLSearchParams({ view: 'expenditure', month });
	if (options.projectId !== undefined) {
		params.set('project_id', String(options.projectId));
	}
	if (options.reportingCurrency !== undefined) {
		params.set('reporting_currency', options.reportingCurrency);
	}
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

function slice(data: ReconciliationData, currency: string) {
	const found = data.company.currency_totals.find(
		(entry) => entry.currency === currency
	);
	expect(found, `currency slice ${currency}`).toBeTruthy();
	return found!;
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
	seeded = await seedExpenditureCurrencyFixtures();
	evidence.seeded = { costs: seeded.costs, projects: seeded.projects };
});

test.afterAll(async () => {
	publish();
	if (created.length) {
		const ids = created.map((entry) => entry.id);
		const uids = created.map((entry) => entry.cost_uid);
		const idPlaceholders = ids.map(() => '?').join(', ');
		const uidPlaceholders = uids.map(() => '?').join(', ');
		// Journal rows are keyed by cost UID and must be removed first.
		await exec(
			`DELETE FROM financial_cost_events WHERE cost_uid IN (${uidPlaceholders})`,
			uids
		);
		await exec(`DELETE FROM expenses WHERE id IN (${idPlaceholders})`, ids);
	}
	await cleanupExpenditureCurrencyFixtures();
});

test('converts supported currencies into reporting totals that reconcile to their groups', async ({
	request,
}) => {
	const data = await reconciliation(request, MONTH);

	expect(data.company.reporting_currency).toBe(CURRENCY_REPORTING_CURRENCY);
	expect(data.company.conversion.status).toBe('converted');
	// Four records are converted (three USD, one AED); the INR record is
	// already in the requested basis.
	expect(data.company.conversion.converted_records).toBe(4);
	expect(data.company.conversion.unsupported_records).toBe(0);
	expect(data.company.conversion.unknown_currency_records).toBe(0);
	expect(data.company.currency).toBe('INR');
	expect(data.company.incurred_cost).toBe(OCTOBER_TOTAL);
	expect(data.company.gross_liability).toBe(OCTOBER_TOTAL);
	expect(data.company.recoverable_tax).toBe(0);
	expect(coverageCodes(data)).not.toContain('currency_conversion_missing');

	// The converted company amount reconciles to its groups, exactly.
	expect(group(data, 'incurred_project_cost')).toBe(OCTOBER_GROUPS.project);
	expect(group(data, 'company_overhead')).toBe(OCTOBER_GROUPS.overhead);
	expect(group(data, 'unallocated_cost')).toBe(OCTOBER_GROUPS.unallocated);
	expect(
		group(data, 'incurred_project_cost') +
			group(data, 'company_overhead') +
			group(data, 'unallocated_cost')
	).toBe(data.company.incurred_cost);

	// Per-currency slices keep their original amounts and state the converted
	// reporting figures: INR is already the basis, USD and AED were converted.
	const inr = slice(data, 'INR');
	expect(inr.reporting.status).toBe('reporting');
	expect(inr.incurred_cost).toBe(OCTOBER.inr);
	expect(inr.reporting.incurred_cost).toBe(OCTOBER.inr);
	const usd = slice(data, 'USD');
	expect(usd.reporting.status).toBe('converted');
	expect(usd.reporting.unsupported_count).toBe(0);
	expect(usd.incurred_project_cost).toBe(1234.57);
	expect(usd.company_overhead).toBe(500.55);
	expect(usd.unallocated_cost).toBe(195312.5);
	expect(usd.reporting.incurred_project_cost).toBe(
		OCTOBER_USD_REPORTING.project
	);
	expect(usd.reporting.company_overhead).toBe(OCTOBER_USD_REPORTING.overhead);
	expect(usd.reporting.unallocated_cost).toBe(
		OCTOBER_USD_REPORTING.unallocated
	);
	expect(usd.reporting.incurred_cost).toBe(OCTOBER_USD_REPORTING_TOTAL);
	const aed = slice(data, 'AED');
	expect(aed.reporting.status).toBe('converted');
	expect(aed.reporting.unallocated_cost).toBe(OCTOBER.aedUnallocated);

	// The half-cent boundaries round half-up, not by truncation.
	expect(aed.reporting.unallocated_cost).toBe(11.32);
	expect(usd.reporting.unallocated_cost).toBe(16210937.01);

	// Project rows carry the requested reporting amount beside the original.
	const alpha = data.projects.find(
		(row) => row.project_code === CURRENCY_PROJECTS.alpha.code
	)!;
	const beta = data.projects.find(
		(row) => row.project_code === CURRENCY_PROJECTS.beta.code
	)!;
	expect(alpha.currency).toBe('INR');
	expect(alpha.conversion_status).toBe('reporting');
	expect(alpha.converted_incurred_cost).toBe(OCTOBER.inr);
	expect(beta.currency).toBe('USD');
	expect(beta.conversion_status).toBe('converted');
	expect(beta.converted_incurred_cost).toBe(OCTOBER.usdProject);

	// Filtering narrows Project detail without changing the company figure.
	const filtered = await reconciliation(request, MONTH, {
		projectId: seeded.projects.beta,
	});
	expect(filtered.projects.map((row) => row.project_code)).toEqual([
		CURRENCY_PROJECTS.beta.code,
	]);
	expect(filtered.projects[0].converted_incurred_cost).toBe(OCTOBER.usdProject);
	expect(filtered.company.incurred_cost).toBe(OCTOBER_TOTAL);

	// The database keeps every original amount and stores the evidence; the
	// ten-decimal rate is preserved as the string it was recorded with.
	const stored = await rows<Record<string, unknown>>(
		`SELECT expense_number, currency, amount, total_amount, recognized_amount,
            reporting_currency, conversion_rate, conversion_date,
            conversion_evidence_reference, converted_amount
       FROM expenses
      WHERE isDelete = 0 AND expense_number IN
            ('E2E-EXP-319-0001','E2E-EXP-319-0002','E2E-EXP-319-0003',
             'E2E-EXP-319-0004','E2E-EXP-319-0009')
      ORDER BY expense_number`
	);
	const storedByNumber = new Map(
		stored.map((row) => [String(row.expense_number), row])
	);
	const expectStored = (
		number: string,
		currency: string,
		amount: number,
		rate: string | null,
		converted: number
	) => {
		const row = storedByNumber.get(number)!;
		expect(row, number).toBeTruthy();
		// Original amounts are unchanged by conversion.
		expect(Number(row.amount)).toBe(amount);
		expect(Number(row.total_amount)).toBe(amount);
		expect(Number(row.recognized_amount)).toBe(amount);
		expect(row.currency).toBe(currency);
		expect(
			row.conversion_rate === null ? null : String(row.conversion_rate)
		).toBe(rate);
		expect(Number(row.converted_amount)).toBe(converted);
	};
	expectStored('E2E-EXP-319-0001', 'INR', 10000, null, 10000);
	expectStored('E2E-EXP-319-0002', 'USD', 1234.57, '83.123456789', 102621.73);
	expectStored('E2E-EXP-319-0003', 'USD', 500.55, '83.123456789', 41607.45);
	expectStored('E2E-EXP-319-0004', 'AED', 0.5, '22.63', 11.32);
	expectStored(
		'E2E-EXP-319-0009',
		'USD',
		195312.5,
		'82.9999974656',
		16210937.01
	);
	// The stored rate kept every decimal of the recorded string.
	const precise = storedByNumber.get('E2E-EXP-319-0009')!;
	expect(String(precise.conversion_rate)).toBe(CURRENCY_RATES.precise.rate);
	expect(precise.reporting_currency).toBe(CURRENCY_REPORTING_CURRENCY);
	expect(String(precise.conversion_date).slice(0, 10)).toBe(
		CURRENCY_RATES.precise.date
	);
	expect(String(precise.conversion_evidence_reference)).toBe(
		CURRENCY_RATES.precise.evidence
	);

	// A requested basis with no matching stored evidence derives nothing: the
	// INR and AED figures were stored against INR, so a USD request cannot
	// state them and there is no combined USD total. The USD records are
	// natively in the requested basis and stay stated in it.
	const usdBasis = await reconciliation(request, MONTH, {
		reportingCurrency: 'USD',
	});
	expect(usdBasis.company.reporting_currency).toBe('USD');
	expect(usdBasis.company.conversion.status).toBe('unsupported');
	expect(usdBasis.company.currency).toBeNull();
	expect(usdBasis.company.incurred_cost).toBeNull();
	expect(slice(usdBasis, 'INR').reporting.status).toBe('unsupported');
	expect(slice(usdBasis, 'AED').reporting.status).toBe('unsupported');
	expect(slice(usdBasis, 'USD').reporting.status).toBe('reporting');
	// Native basis: the USD slice states its original 1,234.57 + 500.55 +
	// 195,312.50 without any rate.
	expect(slice(usdBasis, 'USD').reporting.incurred_cost).toBe(197047.62);
	expect(coverageCodes(usdBasis)).toContain('currency_conversion_missing');

	// The drilldown states each record's status in the same selected basis.
	const usdDrill = await drilldown(request, {
		month: MONTH,
		state: 'recognized',
		reporting_currency: 'USD',
	});
	expect(
		usdDrill.records.find(
			(record) => record.expense_number === 'E2E-EXP-319-0001'
		)!.conversion_status
	).toBe('unsupported');
	expect(
		usdDrill.records.find(
			(record) => record.expense_number === 'E2E-EXP-319-0002'
		)!.conversion_status
	).toBe('reporting');
	const inrDrill = await drilldown(request, {
		month: MONTH,
		state: 'recognized',
	});
	expect(
		inrDrill.records.find(
			(record) => record.expense_number === 'E2E-EXP-319-0001'
		)!.conversion_status
	).toBe('reporting');
	expect(
		inrDrill.records.find(
			(record) => record.expense_number === 'E2E-EXP-319-0002'
		)!.conversion_status
	).toBe('converted');

	evidence.converted = {
		expected: {
			groups: OCTOBER_GROUPS,
			total: OCTOBER_TOTAL,
			usdReporting: OCTOBER_USD_REPORTING_TOTAL,
		},
		observed: {
			currency: data.company.currency,
			total: data.company.incurred_cost,
			groups: data.company.groups,
			slices: data.company.currency_totals.map((row) => ({
				currency: row.currency,
				status: row.reporting.status,
				original: row.incurred_cost,
				reporting: row.reporting.incurred_cost,
			})),
		},
		usdBasisStatus: usdBasis.company.conversion.status,
	};
});

test('keeps missing rates and unknown original currencies in explicit exceptions', async ({
	request,
}) => {
	const data = await reconciliation(request, MISSING_MONTH);

	// Known currencies stay in their own subtotals; no mixed grand total.
	expect(data.company.currency_totals.map((row) => row.currency)).toEqual([
		'INR',
		'USD',
	]);
	expect(slice(data, 'INR').reporting.incurred_cost).toBe(NOVEMBER.inr);
	expect(slice(data, 'USD').incurred_cost).toBe(NOVEMBER.usdUnsupported);
	expect(slice(data, 'USD').reporting.status).toBe('unsupported');
	expect(slice(data, 'USD').reporting.unsupported_count).toBe(1);
	expect(slice(data, 'USD').reporting.incurred_cost).toBeNull();
	expect(data.company.currency).toBeNull();
	expect(data.company.incurred_cost).toBeNull();
	expect(data.company.gross_liability).toBeNull();
	expect(data.company.groups).toEqual([]);

	// One confirmed record has no rate, one has no original currency at all.
	expect(data.company.conversion.status).toBe('unsupported');
	expect(data.company.conversion.unsupported_records).toBe(2);
	expect(data.company.conversion.unsupported_currencies).toEqual(['USD']);
	expect(data.company.conversion.unknown_currency_records).toBe(1);
	expect(data.evidence.missing_currency.count).toBe(1);
	expect(coverageCodes(data)).toContain('currency_conversion_missing');
	expect(coverageCodes(data)).toContain('original_currency_missing');

	// The drilldown states each record's own exception.
	const usdRecord = await drilldown(request, {
		month: MISSING_MONTH,
		state: 'recognized',
	});
	const missingRate = usdRecord.records.find(
		(record) => record.expense_number === 'E2E-EXP-319-0006'
	)!;
	expect(missingRate.currency).toBe('USD');
	expect(missingRate.conversion_rate).toBeNull();
	expect(missingRate.converted_amount).toBeNull();
	expect(missingRate.exceptions).toContain('conversion_evidence_missing');
	const unknown = usdRecord.records.find(
		(record) => record.expense_number === 'E2E-EXP-319-0010'
	)!;
	expect(unknown.currency).toBeNull();
	expect(unknown.exceptions).toContain('original_currency_missing');
	expect(unknown.converted_amount).toBeNull();

	// Persisted evidence agrees: the unknown row stays NULL, never INR.
	const stored = await rows<Record<string, unknown>>(
		`SELECT currency, total_amount, converted_amount, conversion_rate
       FROM expenses WHERE expense_number IN
            ('E2E-EXP-319-0006','E2E-EXP-319-0010')
      ORDER BY expense_number`
	);
	expect(stored.map((row) => [row.currency, Number(row.total_amount)])).toEqual(
		[
			['USD', NOVEMBER.usdUnsupported],
			[null, NOVEMBER.unknownCurrency],
		]
	);
	expect(stored.every((row) => row.converted_amount === null)).toBe(true);
	expect(stored.every((row) => row.conversion_rate === null)).toBe(true);

	evidence.missing = {
		expected: NOVEMBER,
		observed: {
			currencyTotals: data.company.currency_totals.map((row) => ({
				currency: row.currency,
				status: row.reporting.status,
				original: row.incurred_cost,
				reporting: row.reporting.incurred_cost,
			})),
			companyIncurredCost: data.company.incurred_cost,
			conversion: data.company.conversion,
			coverage: coverageCodes(data),
		},
	};
});

test('refuses an unauthorized rate change and leaves stored evidence untouched', async ({
	playwright,
	request,
}) => {
	const editor = await loginExpenditureCurrencyEditor(
		playwright,
		E2E_ENV.baseURL
	);
	try {
		// The editor may open the ledger but not approve; conversion evidence
		// reprices cost, so the command route refuses the patch outright.
		const attempt = await editor.post(
			`/api/admin/expenses/${seeded.expenseIds.controlAedPending}/commands`,
			{
				data: {
					command: 'update',
					expected_version: 1,
					patch: {
						conversionRate: '99',
						conversionDate: '2019-12-31',
						conversionEvidenceReference: 'E2E-319-UNSAFE',
					},
				},
			}
		);
		expect(attempt.status()).toBe(403);

		// Recognition is an approval act too.
		const recognize = await editor.post(
			`/api/admin/expenses/${seeded.expenseIds.controlAedPending}/commands`,
			{ data: { command: 'recognize', expected_version: 1 } }
		);
		expect(recognize.status()).toBe(403);

		const untouched = await rows<Record<string, unknown>>(
			`SELECT recognition_state, financial_version, reporting_currency,
              conversion_rate, conversion_date, conversion_evidence_reference,
              converted_amount
         FROM expenses WHERE id = ?`,
			[seeded.expenseIds.controlAedPending]
		);
		expect(untouched[0].recognition_state).toBe('pending_evidence');
		expect(Number(untouched[0].financial_version)).toBe(1);
		expect(untouched[0].reporting_currency).toBeNull();
		expect(untouched[0].conversion_rate).toBeNull();
		expect(untouched[0].conversion_date).toBeNull();
		expect(untouched[0].conversion_evidence_reference).toBeNull();
		expect(untouched[0].converted_amount).toBeNull();

		evidence.authorization = {
			updateStatus: attempt.status(),
			recognizeStatus: recognize.status(),
			unchanged: untouched[0],
		};
	} finally {
		await editor.dispose();
	}
	// The admin's own authenticated read still shows the row open.
	const before = await reconciliation(request, CONTROL_MONTH);
	expect(
		before.company.currency_totals.find((row) => row.currency === 'AED')
	).toBeUndefined();
});

test('applies a supported rate through the versioned command on the rounding boundary', async ({
	request,
}) => {
	const update = await request.post(
		`/api/admin/expenses/${seeded.expenseIds.controlAedPending}/commands`,
		{
			data: {
				command: 'update',
				expected_version: 1,
				patch: {
					conversionRate: CURRENCY_RATES.aed.rate,
					conversionDate: '2019-12-31',
					conversionEvidenceReference: 'E2E-319-RATE-CONTROL',
				},
			},
		}
	);
	expect(update.status(), await update.text()).toBe(200);
	expect((await update.json()).data.financial_version).toBe(2);

	// The pending row's original currency was captured at entry; only now does
	// it get a supported rate, through an approval-authorized command.
	const recognize = await request.post(
		`/api/admin/expenses/${seeded.expenseIds.controlAedPending}/commands`,
		{
			data: {
				command: 'recognize',
				expected_version: 2,
				reason: 'E2E 319 rate evidence reviewed',
			},
		}
	);
	expect(recognize.status(), await recognize.text()).toBe(200);
	const recognized = (await recognize.json()).data as {
		financial_version: number;
		recognized_amount: number;
	};
	expect(recognized.financial_version).toBe(3);
	expect(recognized.recognized_amount).toBe(CONTROL.aedOriginal);

	const stored = await rows<Record<string, unknown>>(
		`SELECT amount, total_amount, recognized_amount, currency, reporting_currency,
            conversion_rate, conversion_date, conversion_evidence_reference,
            converted_amount, financial_version
       FROM expenses WHERE id = ?`,
		[seeded.expenseIds.controlAedPending]
	);
	// Original amounts are untouched; the converted figure is the half-up cent.
	expect(Number(stored[0].amount)).toBe(CONTROL.aedOriginal);
	expect(Number(stored[0].total_amount)).toBe(CONTROL.aedOriginal);
	expect(Number(stored[0].recognized_amount)).toBe(CONTROL.aedOriginal);
	expect(stored[0].currency).toBe('AED');
	expect(stored[0].reporting_currency).toBe(CURRENCY_REPORTING_CURRENCY);
	expect(String(stored[0].conversion_rate)).toBe(CURRENCY_RATES.aed.rate);
	expect(Number(stored[0].converted_amount)).toBe(CONTROL.aedConverted);
	expect(Number(stored[0].financial_version)).toBe(3);

	// The append-only journal preserved the rate and the converted figure.
	const journal = await rows<{
		version: number;
		command: string;
		snapshot: unknown;
	}>(
		`SELECT version, command, snapshot FROM financial_cost_events
      WHERE cost_uid = ? ORDER BY version`,
		['e2e-319-cost-0008']
	);
	const snapshotOf = (raw: unknown): Record<string, unknown> =>
		typeof raw === 'string'
			? (JSON.parse(raw) as Record<string, unknown>)
			: ((raw ?? {}) as Record<string, unknown>);
	expect(journal.map((row) => row.command)).toEqual([
		'recorded',
		'updated',
		'recognized',
	]);
	const updateSnapshot = snapshotOf(journal[1].snapshot);
	expect(updateSnapshot.conversion_rate).toBe(CURRENCY_RATES.aed.rate);
	expect(updateSnapshot.conversion_date).toBe('2019-12-31');
	expect(updateSnapshot.conversion_evidence_reference).toBe(
		'E2E-319-RATE-CONTROL'
	);
	const recognizeSnapshot = snapshotOf(journal[2].snapshot);
	expect(Number(recognizeSnapshot.converted_amount)).toBe(CONTROL.aedConverted);

	const data = await reconciliation(request, CONTROL_MONTH);
	const aed = slice(data, 'AED');
	expect(aed.reporting.status).toBe('converted');
	expect(aed.reporting.unallocated_cost).toBe(CONTROL.aedConverted);
	expect(data.company.currency).toBe('INR');
	expect(data.company.incurred_cost).toBe(CONTROL_TOTAL_AFTER_RATE);

	evidence.boundary = {
		expected: {
			converted: CONTROL.aedConverted,
			total: CONTROL_TOTAL_AFTER_RATE,
		},
		observed: {
			converted: Number(stored[0].converted_amount),
			companyTotal: data.company.incurred_cost,
			journal: journal.map((row) => ({
				version: row.version,
				command: row.command,
			})),
		},
	};
});

test('records conversion evidence through the real report controls', async ({
	page,
	request,
}) => {
	await openExpenditure(page, labelOf(CONTROL_MONTH));
	await expect(page.getByTestId('expenditure-view')).toContainText(
		labelOf(CONTROL_MONTH)
	);

	// The reporting basis is a real control: a basis with no matching stored
	// evidence is disclosed instead of derived.
	await page
		.getByLabel('Reporting currency', { exact: true })
		.selectOption('USD');
	await expect(page.getByTestId('conversion-warning')).toBeVisible();
	await expect(page.getByTestId('conversion-warning')).toContainText('USD');
	// The drilldown is stated in the same selected basis: the INR cost has no
	// rate to USD, and the badge says that instead of relabelling evidence.
	const alphaExpand = page.locator(
		`[data-testid="expenditure-project-row"][data-project-code="${CURRENCY_PROJECTS.alpha.code}"] [data-testid="project-expand"]`
	);
	await alphaExpand.click();
	const inrDrillRow = page.locator(
		'[data-testid="drilldown-record"][data-source-reference="E2E-319-INV-07"]'
	);
	await expect(inrDrillRow).toBeVisible();
	const usdBadge = inrDrillRow.getByTestId('record-conversion');
	await expect(usdBadge).toHaveAttribute('data-status', 'unsupported');
	await expect(usdBadge).toContainText('No rate to USD');
	await alphaExpand.click();
	await page
		.getByLabel('Reporting currency', { exact: true })
		.selectOption('INR');
	const before = await kpi(page, 'kpi-incurred-cost');
	expect(before).toBe(CONTROL_TOTAL_AFTER_RATE);

	await page.getByRole('button', { name: 'Record cost', exact: true }).click();
	const form = page.getByTestId('cost-form');
	await expect(form).toBeVisible();
	await form
		.getByLabel('Classification', { exact: true })
		.selectOption('unallocated');
	await form
		.getByLabel('Source reference', { exact: true })
		.fill('E2E-319-INV-UI');
	await form
		.getByLabel('Vendor', { exact: true })
		.fill(`${CURRENCY_VENDOR_PREFIX}browser`);
	await form
		.getByLabel('Description', { exact: true })
		.fill('E2E 319 EUR cost entered in the browser');
	await form
		.getByLabel('Service period start', { exact: true })
		.fill(`${CONTROL_MONTH}-16`);
	await form
		.getByLabel('Service period end', { exact: true })
		.fill(`${CONTROL_MONTH}-16`);
	await form
		.getByLabel('Bill date', { exact: true })
		.fill(`${CONTROL_MONTH}-17`);
	await form.getByLabel('Currency', { exact: true }).selectOption('EUR');
	await form
		.getByLabel('Reporting currency', { exact: true })
		.selectOption('INR');
	await form
		.getByLabel('Conversion rate', { exact: true })
		.fill(CONTROL.eurRate);
	await form
		.getByLabel('Conversion date', { exact: true })
		.fill(`${CONTROL_MONTH}-16`);
	await form
		.getByLabel('Conversion evidence reference', { exact: true })
		.fill('E2E-319-RATE-EUR');
	await form
		.getByLabel('Gross amount', { exact: true })
		.fill(String(CONTROL.eurOriginal));
	await form.getByLabel('Tax treatment', { exact: true }).selectOption('none');
	await form
		.getByLabel('Evidence reference', { exact: true })
		.fill('E2E-319-GRN-UI');
	await form
		.getByRole('button', { name: 'Save and submit', exact: true })
		.click();
	await expect(form).toBeHidden();

	// The entry landed in the queue with its evidence; the company total still
	// excludes it until it is recognized.
	const queue = page.getByTestId('recognition-queue');
	const row = queue.locator(
		'[data-testid="queue-row"][data-source-reference="E2E-319-INV-UI"]'
	);
	await expect(row).toBeVisible();
	expect(await kpi(page, 'kpi-incurred-cost')).toBe(before);

	const queued = await rows<Record<string, unknown>>(
		`SELECT id, cost_uid, financial_version, recognition_state, currency,
            reporting_currency, conversion_rate, converted_amount, total_amount
       FROM expenses WHERE source_reference = ? AND isDelete = 0`,
		['E2E-319-INV-UI']
	);
	expect(queued).toHaveLength(1);
	expect(queued[0].recognition_state).toBe('pending_evidence');
	expect(Number(queued[0].financial_version)).toBe(1);
	expect(queued[0].currency).toBe('EUR');
	expect(queued[0].reporting_currency).toBe(CURRENCY_REPORTING_CURRENCY);
	expect(String(queued[0].conversion_rate)).toBe(CONTROL.eurRate);
	expect(Number(queued[0].total_amount)).toBe(CONTROL.eurOriginal);
	expect(queued[0].converted_amount).toBeNull();
	const createdId = Number(queued[0].id);
	created.push({
		id: createdId,
		cost_uid: String(queued[0].cost_uid),
		where: 'ui-currency',
	});

	await row.getByRole('button', { name: 'Recognize', exact: true }).click();
	const dialog = page.getByTestId('command-dialog');
	await expect(dialog).toBeVisible();
	await dialog
		.getByLabel('Reason', { exact: true })
		.fill('E2E 319 rate evidence reviewed');
	await dialog
		.getByRole('button', { name: 'Recognize expense', exact: true })
		.click();
	await expect(dialog).toBeHidden();

	// The converted cost counts once in the requested reporting basis.
	await expect
		.poll(async () => kpi(page, 'kpi-incurred-cost'), { timeout: 10_000 })
		.toBe(CONTROL_TOTAL_AFTER_ENTRY);
	await expect(page.getByTestId('conversion-status')).toHaveAttribute(
		'data-status',
		'converted'
	);

	const data = await reconciliation(request, CONTROL_MONTH);
	expect(data.company.conversion.status).toBe('converted');
	expect(data.company.currency).toBe('INR');
	expect(data.company.incurred_cost).toBe(CONTROL_TOTAL_AFTER_ENTRY);
	const eur = slice(data, 'EUR');
	expect(eur.reporting.status).toBe('converted');
	expect(eur.reporting.incurred_cost).toBe(CONTROL.eurConverted);
	expect(eur.incurred_cost).toBe(CONTROL.eurOriginal);

	const recognized = await rows<Record<string, unknown>>(
		`SELECT recognition_state, financial_version, recognized_amount, converted_amount,
            total_amount, conversion_rate, conversion_date,
            conversion_evidence_reference, reporting_currency
       FROM expenses WHERE id = ?`,
		[createdId]
	);
	expect(recognized[0].recognition_state).toBe('recognized');
	expect(Number(recognized[0].financial_version)).toBe(2);
	expect(Number(recognized[0].recognized_amount)).toBe(CONTROL.eurOriginal);
	expect(Number(recognized[0].total_amount)).toBe(CONTROL.eurOriginal);
	expect(Number(recognized[0].converted_amount)).toBe(CONTROL.eurConverted);
	expect(String(recognized[0].conversion_rate)).toBe(CONTROL.eurRate);
	expect(String(recognized[0].conversion_date).slice(0, 10)).toBe(
		`${CONTROL_MONTH}-16`
	);
	expect(String(recognized[0].conversion_evidence_reference)).toBe(
		'E2E-319-RATE-EUR'
	);
	expect(recognized[0].reporting_currency).toBe(CURRENCY_REPORTING_CURRENCY);

	evidence.uiRecorded = {
		expected: {
			original: CONTROL.eurOriginal,
			converted: CONTROL.eurConverted,
			total: CONTROL_TOTAL_AFTER_ENTRY,
		},
		observed: {
			state: recognized[0].recognition_state,
			version: Number(recognized[0].financial_version),
			original: Number(recognized[0].total_amount),
			converted: Number(recognized[0].converted_amount),
			companyTotal: data.company.incurred_cost,
		},
		usdBasisWarning: true,
	};
});

test('records a cost with no original currency without guessing INR', async ({
	request,
}) => {
	const createdResponse = await request.post('/api/admin/expenses', {
		data: {
			category: CURRENCY_CATEGORY,
			description: 'E2E 319 cost with no original currency',
			vendor_name: `${CURRENCY_VENDOR_PREFIX}unknown`,
			expense_date: `${CONTROL_MONTH}-20`,
			cost_classification: 'unallocated',
			gross_amount: 500,
			source_reference: 'E2E-319-INV-NULLCUR',
			submit: true,
		},
	});
	expect(createdResponse.status(), await createdResponse.text()).toBe(200);
	const record = (await createdResponse.json()).data as {
		id: number;
		cost_uid: string;
		recognition_state: string;
	};
	created.push({
		id: record.id,
		cost_uid: record.cost_uid,
		where: 'unknown-currency',
	});
	unknownCurrencyRowId = record.id;
	expect(record.recognition_state).toBe('pending_evidence');

	// No currency was inferred: the column stays NULL and recognition refuses
	// until a real original currency is captured.
	const stored = await rows<Record<string, unknown>>(
		`SELECT currency, total_amount, converted_amount FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(stored[0].currency).toBeNull();
	expect(Number(stored[0].total_amount)).toBe(500);
	expect(stored[0].converted_amount).toBeNull();

	const recognize = await request.post(
		`/api/admin/expenses/${record.id}/commands`,
		{ data: { command: 'recognize', expected_version: 1 } }
	);
	expect(recognize.status()).toBe(422);
	const failure = (await recognize.json()) as {
		code: string;
		missing: string[];
	};
	expect(failure.code).toBe('not_ready_for_recognition');
	expect(failure.missing).toContain('currency');

	evidence.unknownCurrency = {
		currency: stored[0].currency,
		recognizeStatus: recognize.status(),
		missing: failure.missing,
	};
});

test('refuses partial conversion evidence and register-side rate edits', async ({
	request,
}) => {
	// A half-stated triple is a contradiction, not a half-supported conversion.
	const partial = await request.post('/api/admin/expenses', {
		data: {
			category: CURRENCY_CATEGORY,
			vendor_name: `${CURRENCY_VENDOR_PREFIX}partial`,
			expense_date: `${CONTROL_MONTH}-21`,
			currency: 'USD',
			reporting_currency: 'INR',
			conversion_rate: '83.1',
			source_reference: 'E2E-319-INV-PARTIAL',
			submit: true,
		},
	});
	expect(partial.status()).toBe(422);
	const partialFailure = (await partial.json()) as {
		code: string;
		missing: string[];
	};
	expect(partialFailure.code).toBe('conversion_evidence_incomplete');
	expect(partialFailure.missing).toEqual([
		'conversion_date',
		'conversion_evidence_reference',
	]);

	// An invalid rate is refused with its own code, full triple or not.
	const invalid = await request.post('/api/admin/expenses', {
		data: {
			category: CURRENCY_CATEGORY,
			vendor_name: `${CURRENCY_VENDOR_PREFIX}invalid-rate`,
			expense_date: `${CONTROL_MONTH}-21`,
			currency: 'USD',
			reporting_currency: 'INR',
			conversion_rate: '0',
			conversion_date: `${CONTROL_MONTH}-21`,
			conversion_evidence_reference: 'E2E-319-RATE-BAD',
			source_reference: 'E2E-319-INV-BADRATE',
			submit: true,
		},
	});
	expect(invalid.status()).toBe(422);
	const invalidBody = (await invalid.json()) as { code: string };
	expect(invalidBody.code).toBe('invalid_conversion_rate');

	// Neither refused attempt left a row behind.
	const leftovers = await rows<Record<string, unknown>>(
		`SELECT id FROM expenses
      WHERE source_reference IN ('E2E-319-INV-PARTIAL','E2E-319-INV-BADRATE')`
	);
	expect(leftovers).toHaveLength(0);

	// The register edit path refuses conversion evidence: it belongs to the
	// versioned command, with its version and journal.
	const edit = await request.put(
		`/api/admin/expenses/${unknownCurrencyRowId}`,
		{ data: { conversion_rate: '99', description: 'E2E 319 sneaky edit' } }
	);
	expect(edit.status()).toBe(422);
	const editFailure = (await edit.json()) as { code: string; fields: string[] };
	expect(editFailure.code).toBe('financial_fields_versioned');
	expect(editFailure.fields).toContain('conversion_rate');
	const stillOpen = await rows<Record<string, unknown>>(
		`SELECT conversion_rate, description FROM expenses WHERE id = ?`,
		[unknownCurrencyRowId]
	);
	expect(stillOpen[0].conversion_rate).toBeNull();

	evidence.refusals = {
		partial: partialFailure,
		invalidRate: invalid.status(),
		registerEdit: editFailure,
	};
});

test('refuses a stale rate on a currency-pair change and honors fresh evidence', async ({
	request,
	playwright,
}) => {
	// A pending cost holding a full USD → INR triple.
	const created = await request.post('/api/admin/expenses', {
		data: {
			category: CURRENCY_CATEGORY,
			description: 'E2E 319 pair-change cost',
			vendor_name: `${CURRENCY_VENDOR_PREFIX}pair`,
			expense_date: `${CONTROL_MONTH}-22`,
			currency: 'USD',
			reporting_currency: 'INR',
			conversion_rate: '83.5',
			conversion_date: `${CONTROL_MONTH}-01`,
			conversion_evidence_reference: 'E2E-319-RATE-PAIR',
			gross_amount: 100,
			cost_classification: 'unallocated',
			source_reference: 'E2E-319-INV-PAIR',
			submit: true,
		},
	});
	expect(created.status(), await created.text()).toBe(200);
	const record = (await created.json()).data as {
		id: number;
		cost_uid: string;
		financial_version: number;
	};
	created.push({
		id: record.id,
		cost_uid: record.cost_uid,
		where: 'pair-change',
	});
	const expectedVersion = record.financial_version;

	// The pair is an approval act: an editor without :approve cannot touch it,
	// so a currency-only patch cannot bypass the conversion gate.
	const editor = await loginExpenditureCurrencyEditor(
		playwright,
		E2E_ENV.baseURL
	);
	let unauthorizedStatus = 0;
	try {
		const unauthorized = await editor.post(
			`/api/admin/expenses/${record.id}/commands`,
			{
				data: {
					command: 'update',
					expected_version: expectedVersion,
					patch: { currency: 'EUR' },
				},
			}
		);
		unauthorizedStatus = unauthorized.status();
		expect(unauthorized.status()).toBe(403);
	} finally {
		await editor.dispose();
	}

	// Even an approver cannot carry the USD rate onto EUR: the pair change
	// needs fresh evidence, and the refusal persists nothing.
	const stale = await request.post(
		`/api/admin/expenses/${record.id}/commands`,
		{
			data: {
				command: 'update',
				expected_version: expectedVersion,
				patch: { currency: 'EUR' },
			},
		}
	);
	expect(stale.status()).toBe(422);
	const staleBody = (await stale.json()) as { code: string; fields: string[] };
	expect(staleBody.code).toBe('conversion_evidence_required');
	expect(staleBody.fields).toContain('conversion_rate');
	const untouched = await rows<Record<string, unknown>>(
		`SELECT currency, reporting_currency, conversion_rate, conversion_date,
            conversion_evidence_reference, converted_amount, financial_version
       FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(untouched[0].currency).toBe('USD');
	expect(String(untouched[0].conversion_rate)).toBe('83.5');
	expect(String(untouched[0].conversion_evidence_reference)).toBe(
		'E2E-319-RATE-PAIR'
	);
	expect(untouched[0].converted_amount).toBeNull();
	expect(Number(untouched[0].financial_version)).toBe(1);

	// The full fresh triple for the new pair is accepted, and it is the rate
	// that prices the cost when it is recognized.
	const fresh = await request.post(
		`/api/admin/expenses/${record.id}/commands`,
		{
			data: {
				command: 'update',
				expected_version: expectedVersion,
				patch: {
					currency: 'EUR',
					conversion_rate: '90.25',
					conversion_date: `${CONTROL_MONTH}-02`,
					conversion_evidence_reference: 'E2E-319-RATE-PAIR-EUR',
				},
			},
		}
	);
	expect(fresh.status(), await fresh.text()).toBe(200);
	expect((await fresh.json()).data.financial_version).toBe(2);
	const repriced = await rows<Record<string, unknown>>(
		`SELECT currency, conversion_rate, converted_amount FROM expenses WHERE id = ?`,
		[record.id]
	);
	expect(repriced[0].currency).toBe('EUR');
	expect(String(repriced[0].conversion_rate)).toBe('90.25');
	expect(repriced[0].converted_amount).toBeNull();

	const recognize = await request.post(
		`/api/admin/expenses/${record.id}/commands`,
		{
			data: {
				command: 'recognize',
				expected_version: 2,
				reason: 'E2E 319 fresh pair evidence reviewed',
			},
		}
	);
	expect(recognize.status(), await recognize.text()).toBe(200);
	const priced = await rows<Record<string, unknown>>(
		`SELECT recognized_amount, converted_amount FROM expenses WHERE id = ?`,
		[record.id]
	);
	// 100 EUR × 90.25, never × the old 83.5.
	expect(Number(priced[0].recognized_amount)).toBe(100);
	expect(Number(priced[0].converted_amount)).toBe(9025);

	const data = await reconciliation(request, CONTROL_MONTH);
	const eur = slice(data, 'EUR');
	expect(eur.reporting.status).toBe('converted');
	expect(eur.reporting.incurred_cost).toBe(CONTROL.eurConverted + 9025);
	expect(eur.incurred_cost).toBe(CONTROL.eurOriginal + 100);

	evidence.pairChange = {
		unauthorizedStatus,
		staleRefusal: staleBody,
		originalRatePreserved: String(untouched[0].conversion_rate),
		freshRate: String(repriced[0].conversion_rate),
		converted: Number(priced[0].converted_amount),
		eurReporting: eur.reporting.incurred_cost,
	};
});

test('regenerates the JSON evidence artifact', async () => {
	publish();
	const artifact = readArtifact('expenditure-currency');
	expect(artifact).toMatchObject({
		ok: true,
		months: [MONTH, MISSING_MONTH, CONTROL_MONTH],
	});
	expect(artifact.converted).toBeTruthy();
	expect(artifact.missing).toBeTruthy();
	expect(artifact.authorization).toBeTruthy();
	expect(artifact.boundary).toBeTruthy();
	expect(artifact.uiRecorded).toBeTruthy();
	expect(artifact.unknownCurrency).toBeTruthy();
	expect(artifact.refusals).toBeTruthy();
	expect(artifact.pairChange).toBeTruthy();
});
