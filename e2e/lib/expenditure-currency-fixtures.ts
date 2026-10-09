import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec, rows } from './db';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Currency-conversion fixtures for the company expenditure reconciliation
 * (ticket #319).
 *
 * The module owns one namespace and nothing else:
 *   projects            `E2E-EXP-319-*`
 *   expenses            `E2E-EXP-319-*` numbers, `E2E Expenditure 319` category,
 *                       `E2E Expenditure 319 Vendor ` vendor prefix
 *   financial_cost_events  the `e2e-319-cost-*` cost UIDs above
 *   users/roles         `e2e_319_expense_editor` / `e2e_319_expense_editor_role`
 *                       (`other_expenses:update` without `:approve`)
 *
 * Months (reserved for #319, published in the currency contract):
 *   2019-10  every confirmed currency has supported conversion evidence
 *   2019-11  a USD cost without conversion evidence: an explicit exception
 *   2019-12  control month for entry, rate authorization, and rounding
 *
 * Every row states its own original amount and conversion inputs, so the spec
 * can assert hand-computed reporting amounts instead of the module's own
 * arithmetic.
 *
 * Intended call order:
 *   1. `seedExpenditureCurrencyFixtures()` once before the spec.
 *   2. Run the spec.
 *   3. `cleanupExpenditureCurrencyFixtures()` in the matching teardown.
 * Both use the shared pool in `e2e/lib/db.ts`.
 */

/** A month whose confirmed currencies all carry supported conversion evidence. */
export const CURRENCY_MONTH = '2019-10';
/** A month with a recognized cost that has no conversion evidence. */
export const CURRENCY_MISSING_MONTH = '2019-11';
/** The entry/authorization/rounding control month. */
export const CURRENCY_CONTROL_MONTH = '2019-12';
export const CURRENCY_EXPENSE_PREFIX = 'E2E-EXP-319-';
export const CURRENCY_COST_UID_PREFIX = 'e2e-319-cost-';
export const CURRENCY_PROJECT_CODE_PREFIX = 'E2E-EXP-319-';
export const CURRENCY_VENDOR_PREFIX = 'E2E Expenditure 319 Vendor ';
export const CURRENCY_CATEGORY = 'E2E Expenditure 319';

/** The requested reporting currency every fixture is stated against. */
export const CURRENCY_REPORTING_CURRENCY = 'INR';

/** The rate evidence the converted fixtures carry. */
export const CURRENCY_RATES = {
	usd: {
		rate: '83.123456789',
		date: '2019-10-31',
		evidence: 'E2E-319-RATE-USD',
	},
	aed: {
		rate: '22.63',
		date: '2019-10-15',
		evidence: 'E2E-319-RATE-AED',
	},
	precise: {
		// Ten decimal places; 195,312.50 × 82.9999974656 = 16,210,937.005
		// exactly, so the stored rate must stay a string through conversion.
		rate: '82.9999974656',
		date: '2019-10-23',
		evidence: 'E2E-319-RATE-PRECISE',
	},
} as const;

/**
 * A real expense editor with `other_expenses:read`/`other_expenses:update` but
 * **no** `other_expenses:approve`. Conversion evidence reprices cost, so this
 * identity may draft and edit operational fields yet must be refused when it
 * tries to set or change a rate (route contract: conversion patches require
 * `other_expenses:approve`).
 */
export const CURRENCY_EDITOR_USER = {
	username: 'e2e_319_expense_editor',
	password: 'E2e#Currency319',
	email: 'e2e.319.expense.editor@accent.test',
	fullName: 'E2E 319 Expense Editor',
} as const;

/** Role row for the editor; deliberately without the approve privilege. */
const CURRENCY_EDITOR_ROLE = {
	roleCode: 'e2e_319_expense_editor_role',
	roleName: 'E2E 319 Expense Editor',
	permissions: ['other_expenses:read', 'other_expenses:update'],
} as const;

/**
 * The editor's own login/API rate-limit identity through the proxy's trusted
 * header (ADR-0013), distinct from the spec requests and the other specs.
 */
const CURRENCY_EDITOR_IP = '198.18.0.24';

export const CURRENCY_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-319-P1',
		title: 'E2E 319 Expenditure Alpha',
		client: 'E2E 319 Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-319-P2',
		title: 'E2E 319 Expenditure Beta',
		client: 'E2E 319 Client Beta',
	},
} as const;

export type CurrencyProjectKey = keyof typeof CURRENCY_PROJECTS;

export type CurrencyClassification =
	| 'project'
	| 'company_overhead'
	| 'unallocated';

export type CurrencyState = 'recognized' | 'pending_evidence';

export interface SeedCurrencyCost {
	/** Stable key the spec addresses the row by. */
	key: string;
	expenseNumber: string;
	costUid: string;
	classification: CurrencyClassification;
	project: CurrencyProjectKey | null;
	state: CurrencyState;
	recognitionMonth: string;
	serviceStart: string;
	serviceEnd: string;
	billDate: string;
	expenseDate: string;
	/** Original/transaction currency the source amount is stated in; null = unknown. */
	currency: string | null;
	amount: string;
	taxAmount: string;
	grossAmount: string;
	/** The cost rules recognize, or null while the row is not confirmed. */
	recognizedAmount: string | null;
	/** Stored conversion evidence (null means none was captured). */
	reportingCurrency: string | null;
	conversionRate: string | null;
	conversionDate: string | null;
	conversionEvidence: string | null;
	/** Durable reporting-currency snapshot of `recognizedAmount`, when known. */
	convertedAmount: string | null;
	sourceReference: string;
	evidenceReference: string;
	description: string;
}

/**
 * The seeded rows.
 *
 * 2019-10 — hand-computed reporting values at the published rates:
 *   10,000.00 INR                                  → 10,000.00
 *    1,234.57 USD × 83.123456789                   → 102,621.73
 *      500.55 USD × 83.123456789                   →  41,607.45
 *        0.50 AED × 22.63 = 11.315 → half-up cents →      11.32
 *  195,312.50 USD × 82.9999974656 = 16,210,937.005 → 16,210,937.01
 * The AED and precise-rate rows are the rounding boundaries: truncating
 * arithmetic yields 11.31 and 16,210,937.00.
 *
 * 2019-11 — 2,000.00 INR, 100.00 USD with no rate, and a 500.00 row whose
 * original currency is unknown: currency subtotals for the known currencies,
 * two exceptions, and no combined total.
 *
 * 2019-12 — 1,000.00 INR confirmed plus a 0.50 AED pending row whose rate the
 * spec sets through the versioned command (the same 11.32 boundary).
 */
export const CURRENCY_COSTS: SeedCurrencyCost[] = [
	{
		key: 'convertedInr',
		expenseNumber: 'E2E-EXP-319-0001',
		costUid: 'e2e-319-cost-0001',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: CURRENCY_MONTH,
		serviceStart: '2019-10-05',
		serviceEnd: '2019-10-05',
		billDate: '2019-10-06',
		expenseDate: '2019-10-06',
		currency: 'INR',
		amount: '10000.00',
		taxAmount: '0.00',
		grossAmount: '10000.00',
		recognizedAmount: '10000.00',
		reportingCurrency: null,
		conversionRate: null,
		conversionDate: null,
		conversionEvidence: null,
		convertedAmount: '10000.00',
		sourceReference: 'E2E-319-INV-01',
		evidenceReference: 'E2E-319-GRN-01',
		description: 'E2E 319 INR project cost already in reporting currency',
	},
	{
		key: 'convertedUsdProject',
		expenseNumber: 'E2E-EXP-319-0002',
		costUid: 'e2e-319-cost-0002',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: CURRENCY_MONTH,
		serviceStart: '2019-10-10',
		serviceEnd: '2019-10-10',
		billDate: '2019-10-12',
		expenseDate: '2019-10-12',
		currency: 'USD',
		amount: '1234.57',
		taxAmount: '0.00',
		grossAmount: '1234.57',
		recognizedAmount: '1234.57',
		reportingCurrency: CURRENCY_REPORTING_CURRENCY,
		conversionRate: CURRENCY_RATES.usd.rate,
		conversionDate: CURRENCY_RATES.usd.date,
		conversionEvidence: CURRENCY_RATES.usd.evidence,
		convertedAmount: '102621.73',
		sourceReference: 'E2E-319-INV-02',
		evidenceReference: 'E2E-319-GRN-02',
		description: 'E2E 319 USD project cost with a supported rate',
	},
	{
		key: 'convertedUsdOverhead',
		expenseNumber: 'E2E-EXP-319-0003',
		costUid: 'e2e-319-cost-0003',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: CURRENCY_MONTH,
		serviceStart: '2019-10-14',
		serviceEnd: '2019-10-14',
		billDate: '2019-10-15',
		expenseDate: '2019-10-15',
		currency: 'USD',
		amount: '500.55',
		taxAmount: '0.00',
		grossAmount: '500.55',
		recognizedAmount: '500.55',
		reportingCurrency: CURRENCY_REPORTING_CURRENCY,
		conversionRate: CURRENCY_RATES.usd.rate,
		conversionDate: CURRENCY_RATES.usd.date,
		conversionEvidence: CURRENCY_RATES.usd.evidence,
		convertedAmount: '41607.45',
		sourceReference: 'E2E-319-INV-03',
		evidenceReference: 'E2E-319-GRN-03',
		description: 'E2E 319 USD overhead cost with a supported rate',
	},
	{
		key: 'convertedAedUnallocated',
		expenseNumber: 'E2E-EXP-319-0004',
		costUid: 'e2e-319-cost-0004',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: CURRENCY_MONTH,
		serviceStart: '2019-10-20',
		serviceEnd: '2019-10-20',
		billDate: '2019-10-21',
		expenseDate: '2019-10-21',
		currency: 'AED',
		amount: '0.50',
		taxAmount: '0.00',
		grossAmount: '0.50',
		recognizedAmount: '0.50',
		reportingCurrency: CURRENCY_REPORTING_CURRENCY,
		conversionRate: CURRENCY_RATES.aed.rate,
		conversionDate: CURRENCY_RATES.aed.date,
		conversionEvidence: CURRENCY_RATES.aed.evidence,
		convertedAmount: '11.32',
		sourceReference: 'E2E-319-INV-04',
		evidenceReference: 'E2E-319-GRN-04',
		description: 'E2E 319 AED rounding-boundary cost',
	},
	{
		key: 'convertedPreciseRateUsd',
		expenseNumber: 'E2E-EXP-319-0009',
		costUid: 'e2e-319-cost-0009',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: CURRENCY_MONTH,
		serviceStart: '2019-10-22',
		serviceEnd: '2019-10-22',
		billDate: '2019-10-23',
		expenseDate: '2019-10-23',
		currency: 'USD',
		amount: '195312.50',
		taxAmount: '0.00',
		grossAmount: '195312.50',
		recognizedAmount: '195312.50',
		reportingCurrency: CURRENCY_REPORTING_CURRENCY,
		conversionRate: CURRENCY_RATES.precise.rate,
		conversionDate: CURRENCY_RATES.precise.date,
		conversionEvidence: CURRENCY_RATES.precise.evidence,
		convertedAmount: '16210937.01',
		sourceReference: 'E2E-319-INV-09',
		evidenceReference: 'E2E-319-GRN-09',
		description: 'E2E 319 ten-decimal rate on the half-cent boundary',
	},
	{
		key: 'missingRateInr',
		expenseNumber: 'E2E-EXP-319-0005',
		costUid: 'e2e-319-cost-0005',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: CURRENCY_MISSING_MONTH,
		serviceStart: '2019-11-06',
		serviceEnd: '2019-11-06',
		billDate: '2019-11-07',
		expenseDate: '2019-11-07',
		currency: 'INR',
		amount: '2000.00',
		taxAmount: '0.00',
		grossAmount: '2000.00',
		recognizedAmount: '2000.00',
		reportingCurrency: null,
		conversionRate: null,
		conversionDate: null,
		conversionEvidence: null,
		convertedAmount: '2000.00',
		sourceReference: 'E2E-319-INV-05',
		evidenceReference: 'E2E-319-GRN-05',
		description: 'E2E 319 INR cost in the missing-rate month',
	},
	{
		key: 'missingRateUsd',
		expenseNumber: 'E2E-EXP-319-0006',
		costUid: 'e2e-319-cost-0006',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: CURRENCY_MISSING_MONTH,
		serviceStart: '2019-11-11',
		serviceEnd: '2019-11-11',
		billDate: '2019-11-12',
		expenseDate: '2019-11-12',
		currency: 'USD',
		amount: '100.00',
		taxAmount: '0.00',
		grossAmount: '100.00',
		recognizedAmount: '100.00',
		reportingCurrency: null,
		conversionRate: null,
		conversionDate: null,
		conversionEvidence: null,
		convertedAmount: null,
		sourceReference: 'E2E-319-INV-06',
		evidenceReference: 'E2E-319-GRN-06',
		description: 'E2E 319 USD cost with no conversion evidence',
	},
	{
		key: 'missingCurrency',
		expenseNumber: 'E2E-EXP-319-0010',
		costUid: 'e2e-319-cost-0010',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: CURRENCY_MISSING_MONTH,
		serviceStart: '2019-11-18',
		serviceEnd: '2019-11-18',
		billDate: '2019-11-19',
		expenseDate: '2019-11-19',
		currency: null,
		amount: '500.00',
		taxAmount: '0.00',
		grossAmount: '500.00',
		recognizedAmount: '500.00',
		reportingCurrency: null,
		conversionRate: null,
		conversionDate: null,
		conversionEvidence: null,
		convertedAmount: null,
		sourceReference: 'E2E-319-INV-10',
		evidenceReference: 'E2E-319-GRN-10',
		description: 'E2E 319 cost whose original currency is unknown',
	},
	{
		key: 'controlInr',
		expenseNumber: 'E2E-EXP-319-0007',
		costUid: 'e2e-319-cost-0007',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: CURRENCY_CONTROL_MONTH,
		serviceStart: '2019-12-04',
		serviceEnd: '2019-12-04',
		billDate: '2019-12-05',
		expenseDate: '2019-12-05',
		currency: 'INR',
		amount: '1000.00',
		taxAmount: '0.00',
		grossAmount: '1000.00',
		recognizedAmount: '1000.00',
		reportingCurrency: null,
		conversionRate: null,
		conversionDate: null,
		conversionEvidence: null,
		convertedAmount: '1000.00',
		sourceReference: 'E2E-319-INV-07',
		evidenceReference: 'E2E-319-GRN-07',
		description: 'E2E 319 control-month INR cost',
	},
	{
		key: 'controlAedPending',
		expenseNumber: 'E2E-EXP-319-0008',
		costUid: 'e2e-319-cost-0008',
		classification: 'project',
		project: 'beta',
		state: 'pending_evidence',
		recognitionMonth: CURRENCY_CONTROL_MONTH,
		serviceStart: '2019-12-09',
		serviceEnd: '2019-12-09',
		billDate: '2019-12-10',
		expenseDate: '2019-12-10',
		currency: 'AED',
		amount: '0.50',
		taxAmount: '0.00',
		grossAmount: '0.50',
		recognizedAmount: null,
		reportingCurrency: null,
		conversionRate: null,
		conversionDate: null,
		conversionEvidence: null,
		convertedAmount: null,
		sourceReference: 'E2E-319-INV-08',
		evidenceReference: 'E2E-319-GRN-08',
		description: 'E2E 319 AED cost completed through the command path',
	},
];

export interface SeededCurrencyExpenditure {
	months: readonly string[];
	projects: Record<CurrencyProjectKey, number>;
	costs: number;
	/** `expenses.id` per `SeedCurrencyCost.key`, for direct assertions. */
	expenseIds: Record<string, number>;
}

/** The month bounds of the #319 fixture months, for the safety gate. */
const FIXTURE_MONTHS = [
	CURRENCY_MONTH,
	CURRENCY_MISSING_MONTH,
	CURRENCY_CONTROL_MONTH,
] as const;

/** Last calendar day of a `YYYY-MM` month. */
function monthEnd(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return `${month}-${String(days).padStart(2, '0')}`;
}

/**
 * Refuse to seed when the reserved months already hold cost this fixture does
 * not own: the exact reporting totals would silently change. Mirrors the
 * payroll-run gate in `global-setup.ts`.
 */
async function assertFixtureMonthsAreClean(): Promise<void> {
	const notNamespaced =
		"NOT (e.expense_number LIKE 'E2E-EXP-319-%' OR e.vendor_name LIKE 'E2E Expenditure 319%' OR e.category = 'E2E Expenditure 319')";
	for (const month of FIXTURE_MONTHS) {
		const found = await rows<{ total: number }>(
			`SELECT COUNT(*) AS total
         FROM expenses e
        WHERE e.isDelete = 0
          AND (e.recognition_period BETWEEN ? AND ?
               OR (e.recognition_period IS NULL AND e.expense_date BETWEEN ? AND ?))
          AND ${notNamespaced}`,
			[`${month}-01`, monthEnd(month), `${month}-01`, monthEnd(month)]
		);
		if (Number(found[0]?.total ?? 0) > 0) {
			throw new Error(
				`E2E month ${month} already holds non-#319 expenditure ` +
					`(${found[0].total} row(s)). Point the harness at another month ` +
					'instead of changing another feature\'s expected totals.'
			);
		}
	}
}

/** Create the editor's role and user rows from scratch. */
async function seedCurrencyEditor(): Promise<void> {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
		[
			CURRENCY_EDITOR_ROLE.roleCode,
			CURRENCY_EDITOR_ROLE.roleName,
			JSON.stringify(CURRENCY_EDITOR_ROLE.permissions),
			'E2E currency fixture editor (e2e/lib/expenditure-currency-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(CURRENCY_EDITOR_USER.password, 10);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			CURRENCY_EDITOR_USER.username,
			passwordHash,
			CURRENCY_EDITOR_USER.email,
			CURRENCY_EDITOR_USER.fullName,
			role.insertId,
		]
	);
}

/** Remove the editor's rows; safe to run repeatedly. */
async function cleanupCurrencyEditor(): Promise<void> {
	const username = CURRENCY_EDITOR_USER.username;
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username = ?)`,
	]) {
		try {
			await exec(sql, [username]);
		} catch {
			// Optional table — keep purging.
		}
	}
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[username]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [username]);
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [
		CURRENCY_EDITOR_ROLE.roleCode,
	]);
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureCurrencyFixtures(): Promise<number> {
	await cleanupCurrencyEditor();
	let removed = 0;
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid LIKE ?
           OR source_id IN (
                SELECT id FROM expenses
                 WHERE expense_number LIKE ?
                    OR category = ?
                    OR vendor_name LIKE ?
              )`,
			[
				`${CURRENCY_COST_UID_PREFIX}%`,
				`${CURRENCY_EXPENSE_PREFIX}%`,
				CURRENCY_CATEGORY,
				`${CURRENCY_VENDOR_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM expenses
        WHERE expense_number LIKE ?
           OR category = ?
           OR vendor_name LIKE ?`,
			[
				`${CURRENCY_EXPENSE_PREFIX}%`,
				CURRENCY_CATEGORY,
				`${CURRENCY_VENDOR_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [
			`${CURRENCY_PROJECT_CODE_PREFIX}%`,
		])
	).affectedRows;
	return removed;
}

function statusFor(state: CurrencyState): string {
	return state === 'recognized' ? 'approved' : 'submitted';
}

/** Purge leftovers, then create the projects and the direct-cost rows. */
export async function seedExpenditureCurrencyFixtures(): Promise<SeededCurrencyExpenditure> {
	await cleanupExpenditureCurrencyFixtures();
	await assertFixtureMonthsAreClean();
	await seedCurrencyEditor();

	const projects = {} as Record<CurrencyProjectKey, number>;
	for (const key of Object.keys(CURRENCY_PROJECTS) as CurrencyProjectKey[]) {
		const project = CURRENCY_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, status, isDelete)
       VALUES (?, ?, NULL, ?, 'ONGOING', 0)`,
			[project.code, project.title, project.client]
		);
		projects[key] = inserted.insertId;
	}

	const expenseIds: Record<string, number> = {};
	for (const cost of CURRENCY_COSTS) {
		const projectId = cost.project ? projects[cost.project] : null;
		const inserted = await exec(
			`INSERT INTO expenses
         (expense_number, expense_date, category, sub_category, description, vendor_name,
          amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
          is_billable, is_reimbursable, project_id, department, notes, status,
          created_by, isDelete,
          cost_uid, cost_classification, recognition_state, recognition_period, period_basis,
          service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
          recognized_amount, source_reference, evidence_reference, financial_version,
          recognized_by, recognized_at,
          reporting_currency, conversion_rate, conversion_date,
          conversion_evidence_reference, converted_amount)
       VALUES (?, ?, ?, 'E2E Sub Category', ?, ?, ?, ?, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, ?, NULL, 0,
               ?, ?, ?, ?, 'service_period', ?, ?, 'none', NULL,
               ?, ?, ?, 1, ?, ?,
               ?, ?, ?, ?, ?)`,
			[
				cost.expenseNumber,
				cost.expenseDate,
				CURRENCY_CATEGORY,
				cost.description,
				`${CURRENCY_VENDOR_PREFIX}${cost.key}`,
				cost.amount,
				cost.taxAmount,
				cost.grossAmount,
				cost.currency,
				`${CURRENCY_VENDOR_PREFIX}${cost.key}`,
				projectId,
				`E2E note ${cost.key}`,
				statusFor(cost.state),
				cost.costUid,
				cost.classification,
				cost.state,
				`${cost.recognitionMonth}-01`,
				cost.serviceStart,
				cost.serviceEnd,
				cost.recognizedAmount,
				cost.sourceReference,
				cost.evidenceReference,
				cost.state === 'recognized' ? 1 : null,
				cost.state === 'recognized' ? '2019-12-31 09:00:00' : null,
				cost.reportingCurrency,
				cost.conversionRate,
				cost.conversionDate,
				cost.conversionEvidence,
				cost.convertedAmount,
			]
		);
		expenseIds[cost.key] = inserted.insertId;

		// Every seeded cost gets its version-1 journal row, including the
		// conversion evidence as it was captured.
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'expenses', ?, 1, 'recorded', NULL, ?, ?, ?)`,
			[
				cost.costUid,
				inserted.insertId,
				`E2E currency fixture ${cost.key}`,
				cost.evidenceReference || null,
				JSON.stringify({
					classification: cost.classification,
					recognition_period: `${cost.recognitionMonth}-01`,
					currency: cost.currency,
					gross_amount: cost.grossAmount,
					recognized_amount: cost.recognizedAmount,
					state: cost.state,
					reporting_currency: cost.reportingCurrency,
					conversion_rate: cost.conversionRate,
					conversion_date: cost.conversionDate,
					conversion_evidence_reference: cost.conversionEvidence,
					converted_amount: cost.convertedAmount,
				}),
			]
		);
	}

	return {
		months: FIXTURE_MONTHS,
		projects,
		costs: CURRENCY_COSTS.length,
		expenseIds,
	};
}

/** The seeded row for a key, or a thrown error when the fixture is missing. */
export function seededCurrencyCost(key: string): SeedCurrencyCost {
	const cost = CURRENCY_COSTS.find((entry) => entry.key === key);
	if (!cost) throw new Error(`Unknown currency fixture key: ${key}`);
	return cost;
}

/**
 * Sign in the expense editor through the real API and return a context
 * carrying that session. Mirrors the report-only reader login: the `auth`
 * bucket for this identity is cleared first (rerun safety) and its own
 * trusted-header identity isolates the following API calls.
 */
export async function loginExpenditureCurrencyEditor(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	const user = CURRENCY_EDITOR_USER;
	const ip = CURRENCY_EDITOR_IP;
	const probe = await playwright.request.newContext({ baseURL });
	try {
		try {
			await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
				`${ip}:%:auth`,
			]);
		} catch {
			// Pre-migration schema — the limiter is in-memory there.
		}
		const response = await probe.post('/api/login', {
			headers: { 'x-vercel-forwarded-for': ip },
			data: { username: user.username, password: user.password },
		});
		if (!response.ok()) {
			const retryAfter = response.headers()['retry-after'];
			throw new Error(
				`[e2e] loginExpenditureCurrencyEditor failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginExpenditureCurrencyEditor: login succeeded but no session cookie was set'
			);
		}
		const storageState: { cookies: Cookie[]; origins: [] } = {
			cookies: [
				{
					name: 'session',
					value: match[1],
					domain: new URL(baseURL).hostname,
					path: '/',
					expires: -1,
					httpOnly: true,
					secure: false,
					sameSite: 'Lax',
				},
			],
			origins: [],
		};
		return await playwright.request.newContext({
			baseURL,
			extraHTTPHeaders: { 'x-vercel-forwarded-for': ip },
			storageState,
		});
	} finally {
		await probe.dispose();
	}
}
