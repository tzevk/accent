import bcrypt from 'bcrypt';
import type {
	APIRequestContext,
	Cookie,
	PlaywrightWorkerArgs,
} from '@playwright/test';
import { exec, rows } from './db';
import { ADMIN_USER } from './fixtures';

/** The Playwright fixture object handed to specs (`({ playwright })`). */
type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Direct-expense fixtures for the company expenditure reconciliation
 * (ticket #306).
 *
 * The module owns one namespace and nothing else:
 *   projects            `E2E-EXP-P*`
 *   expenses            `expense_number` LIKE `E2E-EXP-%`
 *   financial_cost_events  the `e2e-cost-*` cost UIDs above
 *   users/roles         `e2e_cost_reports_only` / `e2e_cost_reports_reader`
 *                       (a `reports:read` reader with no expense-source read)
 *
 * Every row states its own recognition inputs (service period or bill date,
 * classification, currency, tax treatment, evidence) and the recognizable
 * outcome those inputs imply, so the spec can assert amounts it computed from
 * these literals rather than from the report's own aggregation.
 *
 * Intended call order:
 *   1. `seedExpenditureFixtures()` once before the spec — from global setup.
 *      It cleans up first, so it is idempotent across runs.
 *   2. Run the spec.
 *   3. `cleanupExpenditureFixtures()` in the matching teardown.
 * Both use the shared pool in `e2e/lib/db.ts`.
 */

/** The reconciled month (`E2E_MONTH`'s calendar month). */
export const EXPENDITURE_MONTH = '2019-01';
/** A second reconciled month, used for currency separation and comparison. */
export const EXPENDITURE_NEXT_MONTH = '2019-02';
/**
 * The month the budget workflow fixtures live in (#321). 2019-05 is taken: the
 * reconciliation spec asserts it is an empty month.
 */
export const BUDGET_MONTH = '2019-06';
export const EXPENDITURE_EXPENSE_PREFIX = 'E2E-EXP-';
export const EXPENDITURE_PROJECT_CODE_PREFIX = 'E2E-EXP-P';
export const EXPENDITURE_COST_UID_PREFIX = 'e2e-cost-';
export const EXPENDITURE_RUN_COST_UID_PREFIX = 'e2e-run-';
/** Period-charge identities (`expense_period_charges.charge_uid`). */
export const EXPENDITURE_CHARGE_UID_PREFIX = 'e2e-charge-';
export const EXPENDITURE_VENDOR_PREFIX = 'E2E Expenditure Vendor ';
/** Category every fixture row carries (`expenses.category`). */
export const EXPENDITURE_CATEGORY = 'E2E Expenditure';

/**
 * Non-operating fixture months (ticket #317). The source balances are
 * recognized in July 2019 and their approved period charges fall in August and
 * September 2019, so no other spec's expected monthly totals change: #306 owns
 * 2019-01/02 (and records through 2019-03/04), #321 owns the 2019-06 budget
 * fixtures, and the months from 2019-10 are reserved by the currency slice.
 * Ad-hoc charges created through the app use a month no other fixture reads.
 */
export const EXPENDITURE_SOURCE_MONTH = '2019-07';
export const EXPENDITURE_CHARGE_MONTH = '2019-08';
export const EXPENDITURE_CHARGE_LATER_MONTH = '2019-09';
/** The month ad-hoc (created, then cancelled) period charges are dated in. */
export const EXPENDITURE_AD_HOC_CHARGE_MONTH = '2020-01';

/**
 * A real report reader with `reports:read` and **no** `other_expenses:read`.
 * The expenditure reconciliation and drilldown read the expense ledger, so
 * this identity must be refused both even though it may open the report's
 * employee-cost views — the source-authorization half of parent spec §149.
 */
export const EXPENDITURE_REPORT_ONLY_USER = {
	username: 'e2e_cost_reports_only',
	password: 'E2e#CostReport1',
	email: 'e2e.cost.reports.only@accent.test',
	fullName: 'E2E Cost Report Only',
} as const;

/** Role row for the report-only reader; owns `reports:read` alone. */
const EXPENDITURE_REPORT_ONLY_ROLE = {
	roleCode: 'e2e_cost_reports_reader',
	roleName: 'E2E Cost Reports Reader',
} as const;

/**
 * The reader's own login/API rate-limit identity through the proxy's trusted
 * header (ADR-0013), distinct from the spec's fixture requests and from the
 * security harness, so neither can exhaust the other's budget.
 */
const EXPENDITURE_REPORT_ONLY_IP = '198.18.0.23';

export const EXPENDITURE_PROJECTS = {
	alpha: {
		code: 'E2E-EXP-P1',
		title: 'E2E Expenditure Alpha',
		client: 'E2E Client Alpha',
	},
	beta: {
		code: 'E2E-EXP-P2',
		title: 'E2E Expenditure Beta',
		client: 'E2E Client Beta',
	},
	/** Budget-only project (#321): cost rows exist only in the budget months. */
	gamma: {
		code: 'E2E-EXP-P3',
		title: 'E2E Expenditure Gamma',
		client: 'E2E Client Gamma',
	},
} as const;

export type ExpenditureProjectKey = keyof typeof EXPENDITURE_PROJECTS;

export type ExpenditureClassification =
	| 'project'
	| 'company_overhead'
	| 'unallocated'
	| null;

export type ExpenditureState =
	| 'draft'
	| 'pending_evidence'
	| 'recognized'
	| 'rejected'
	| 'cancelled';

export type ExpenditureTaxTreatment =
	| 'none'
	| 'recoverable'
	| 'non_recoverable'
	| 'unresolved';

/** What the spend is (ticket #317); omitted means operating cost. */
export type ExpenditureNature =
	| 'operating'
	| 'advance'
	| 'deposit'
	| 'prepayment'
	| 'capital'
	| 'unresolved';

export type ExpenditureChargeBasis =
	| 'consumption'
	| 'depreciation'
	| 'amortization';

export interface SeedCost {
	/** Stable key the spec addresses the row by. */
	key: string;
	expenseNumber: string;
	costUid: string;
	/**
	 * What the spend is (#317). Omitted rows are operating cost, the meaning
	 * every pre-#317 row carried.
	 */
	nature?: ExpenditureNature;
	classification: ExpenditureClassification;
	project: ExpenditureProjectKey | null;
	state: ExpenditureState;
	/** Recognition month (`YYYY-MM`); null while no period is resolvable. */
	recognitionMonth: string | null;
	periodBasis: 'service_period' | 'bill_date_fallback' | 'unresolved';
	serviceStart: string | null;
	serviceEnd: string | null;
	billDate: string | null;
	expenseDate: string;
	currency: string;
	/** Net amount; null means missing, `0.00` means known zero. */
	amount: string | null;
	taxAmount: string | null;
	/** Gross liability; null means missing. */
	grossAmount: string | null;
	taxTreatment: ExpenditureTaxTreatment;
	taxEvidence: string | null;
	/** The cost the rules recognize, or null when the row is not confirmed. */
	recognizedAmount: string | null;
	sourceReference: string;
	evidenceReference: string;
	description: string;
}

/**
 * The seeded rows. The two January statuses that matter for the reconciliation
 * are 'recognized' (confirmed cost) and everything else (review queue).
 */
export const EXPENDITURE_COSTS: SeedCost[] = [
	{
		key: 'projectRecoverable',
		expenseNumber: 'E2E-EXP-0001',
		costUid: 'e2e-cost-0001',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-05',
		serviceEnd: '2019-01-20',
		billDate: '2019-01-22',
		expenseDate: '2019-01-22',
		currency: 'INR',
		amount: '1000.00',
		taxAmount: '180.00',
		grossAmount: '1180.00',
		taxTreatment: 'recoverable',
		taxEvidence: 'GST-EVID-0001',
		recognizedAmount: '1000.00',
		sourceReference: 'E2E-INV-0001',
		evidenceReference: 'E2E-GRN-0001',
		description: 'E2E reimbursable service work',
	},
	{
		key: 'projectBillFallback',
		expenseNumber: 'E2E-EXP-0002',
		costUid: 'e2e-cost-0002',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'bill_date_fallback',
		serviceStart: null,
		serviceEnd: null,
		billDate: '2019-01-28',
		expenseDate: '2019-01-28',
		currency: 'INR',
		amount: '2500.00',
		taxAmount: '0.00',
		grossAmount: '2500.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '2500.00',
		sourceReference: 'E2E-INV-0002',
		evidenceReference: 'E2E-GRN-0002',
		description: 'E2E bill-date fallback cost',
	},
	{
		key: 'projectNonRecoverable',
		expenseNumber: 'E2E-EXP-0003',
		costUid: 'e2e-cost-0003',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-10',
		serviceEnd: '2019-01-10',
		billDate: '2019-01-15',
		expenseDate: '2019-01-15',
		currency: 'INR',
		amount: '4000.00',
		taxAmount: '720.00',
		grossAmount: '4720.00',
		taxTreatment: 'non_recoverable',
		taxEvidence: null,
		recognizedAmount: '4720.00',
		sourceReference: 'E2E-INV-0003',
		evidenceReference: 'E2E-GRN-0003',
		description: 'E2E non-recoverable tax cost',
	},
	{
		key: 'overhead',
		expenseNumber: 'E2E-EXP-0004',
		costUid: 'e2e-cost-0004',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-15',
		serviceEnd: '2019-01-15',
		billDate: '2019-01-16',
		expenseDate: '2019-01-16',
		currency: 'INR',
		amount: '3000.00',
		taxAmount: '0.00',
		grossAmount: '3000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '3000.00',
		sourceReference: 'E2E-INV-0004',
		evidenceReference: 'E2E-GRN-0004',
		description: 'E2E deliberate company overhead',
	},
	{
		key: 'unallocated',
		expenseNumber: 'E2E-EXP-0005',
		costUid: 'e2e-cost-0005',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-20',
		serviceEnd: '2019-01-20',
		billDate: '2019-01-21',
		expenseDate: '2019-01-21',
		currency: 'INR',
		amount: '600.00',
		taxAmount: '0.00',
		grossAmount: '600.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '600.00',
		sourceReference: 'E2E-INV-0005',
		evidenceReference: 'E2E-GRN-0005',
		description: 'E2E recognised cost awaiting a destination',
	},
	{
		key: 'knownZero',
		expenseNumber: 'E2E-EXP-0006',
		costUid: 'e2e-cost-0006',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-08',
		serviceEnd: '2019-01-08',
		billDate: '2019-01-08',
		expenseDate: '2019-01-08',
		currency: 'INR',
		amount: '0.00',
		taxAmount: '0.00',
		grossAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '0.00',
		sourceReference: 'E2E-INV-0006',
		evidenceReference: 'E2E-GRN-0006',
		description: 'E2E known zero cost',
	},
	{
		key: 'pendingEvidence',
		expenseNumber: 'E2E-EXP-0007',
		costUid: 'e2e-cost-0007',
		classification: 'project',
		project: 'alpha',
		state: 'pending_evidence',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-11',
		serviceEnd: '2019-01-11',
		billDate: null,
		expenseDate: '2019-01-12',
		currency: 'INR',
		amount: '900.00',
		taxAmount: '0.00',
		grossAmount: '900.00',
		taxTreatment: 'unresolved',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-0007',
		evidenceReference: 'E2E-GRN-0007',
		description: 'E2E awaiting recognition',
	},
	{
		key: 'draftUnresolved',
		expenseNumber: 'E2E-EXP-0008',
		costUid: 'e2e-cost-0008',
		classification: null,
		project: null,
		state: 'draft',
		recognitionMonth: null,
		periodBasis: 'unresolved',
		serviceStart: null,
		serviceEnd: null,
		billDate: null,
		expenseDate: '2019-01-09',
		currency: 'INR',
		amount: '750.00',
		taxAmount: '0.00',
		grossAmount: '750.00',
		taxTreatment: 'unresolved',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-0008',
		evidenceReference: 'E2E-GRN-0008',
		description: 'E2E draft with no destination yet',
	},
	{
		key: 'missingAmount',
		expenseNumber: 'E2E-EXP-0009',
		costUid: 'e2e-cost-0009',
		classification: 'company_overhead',
		project: null,
		state: 'pending_evidence',
		recognitionMonth: null,
		periodBasis: 'unresolved',
		serviceStart: null,
		serviceEnd: null,
		billDate: null,
		expenseDate: '2019-01-14',
		currency: 'INR',
		amount: null,
		taxAmount: null,
		grossAmount: null,
		taxTreatment: 'unresolved',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-0009',
		evidenceReference: '',
		description: 'E2E amount not yet known',
	},
	{
		key: 'rejected',
		expenseNumber: 'E2E-EXP-0010',
		costUid: 'e2e-cost-0010',
		classification: 'unallocated',
		project: null,
		state: 'rejected',
		recognitionMonth: null,
		periodBasis: 'unresolved',
		serviceStart: null,
		serviceEnd: null,
		billDate: null,
		expenseDate: '2019-01-17',
		currency: 'INR',
		amount: '500.00',
		taxAmount: '0.00',
		grossAmount: '500.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-0010',
		evidenceReference: 'E2E-GRN-0010',
		description: 'E2E refused by finance',
	},
	{
		key: 'cancelled',
		expenseNumber: 'E2E-EXP-0011',
		costUid: 'e2e-cost-0011',
		classification: 'project',
		project: 'alpha',
		state: 'cancelled',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-18',
		serviceEnd: '2019-01-18',
		billDate: null,
		expenseDate: '2019-01-19',
		currency: 'INR',
		amount: '800.00',
		taxAmount: '0.00',
		grossAmount: '800.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-0011',
		evidenceReference: 'E2E-GRN-0011',
		description: 'E2E withdrawn cost',
	},
	{
		key: 'taxUnresolved',
		expenseNumber: 'E2E-EXP-0012',
		costUid: 'e2e-cost-0012',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-22',
		serviceEnd: '2019-01-22',
		billDate: '2019-01-23',
		expenseDate: '2019-01-23',
		currency: 'INR',
		amount: '900.00',
		taxAmount: '100.00',
		grossAmount: '1000.00',
		taxTreatment: 'unresolved',
		taxEvidence: null,
		recognizedAmount: '1000.00',
		sourceReference: 'E2E-INV-0012',
		evidenceReference: 'E2E-GRN-0012',
		description: 'E2E tax treatment still open',
	},
	{
		key: 'recoverableNoEvidence',
		expenseNumber: 'E2E-EXP-0013',
		costUid: 'e2e-cost-0013',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-01-25',
		serviceEnd: '2019-01-25',
		billDate: '2019-01-26',
		expenseDate: '2019-01-26',
		currency: 'INR',
		amount: '500.00',
		taxAmount: '90.00',
		grossAmount: '590.00',
		taxTreatment: 'recoverable',
		taxEvidence: null,
		recognizedAmount: '590.00',
		sourceReference: 'E2E-INV-0013',
		evidenceReference: 'E2E-GRN-0013',
		description: 'E2E recoverable claim without evidence',
	},
	{
		key: 'febInr',
		expenseNumber: 'E2E-EXP-0014',
		costUid: 'e2e-cost-0014',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_NEXT_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-02-06',
		serviceEnd: '2019-02-06',
		billDate: '2019-02-07',
		expenseDate: '2019-02-07',
		currency: 'INR',
		amount: '100.00',
		taxAmount: '0.00',
		grossAmount: '100.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '100.00',
		sourceReference: 'E2E-INV-0014',
		evidenceReference: 'E2E-GRN-0014',
		description: 'E2E February INR cost',
	},
	{
		key: 'febUsd',
		expenseNumber: 'E2E-EXP-0015',
		costUid: 'e2e-cost-0015',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_NEXT_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-02-11',
		serviceEnd: '2019-02-11',
		billDate: '2019-02-12',
		expenseDate: '2019-02-12',
		currency: 'USD',
		amount: '50.00',
		taxAmount: '0.00',
		grossAmount: '50.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '50.00',
		sourceReference: 'E2E-INV-0015',
		evidenceReference: 'E2E-GRN-0015',
		description: 'E2E February foreign-currency cost',
	},
	{
		key: 'febUsdProject',
		expenseNumber: 'E2E-EXP-0016',
		costUid: 'e2e-cost-0016',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_NEXT_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-02-18',
		serviceEnd: '2019-02-18',
		billDate: '2019-02-19',
		expenseDate: '2019-02-19',
		currency: 'USD',
		amount: '30.00',
		taxAmount: '0.00',
		grossAmount: '30.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '30.00',
		sourceReference: 'E2E-INV-0016',
		evidenceReference: 'E2E-GRN-0016',
		description: 'E2E February USD project cost',
	},
	{
		key: 'mayInr',
		expenseNumber: 'E2E-EXP-0017',
		costUid: 'e2e-cost-0017',
		classification: 'project',
		project: 'gamma',
		state: 'recognized',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-06',
		serviceEnd: '2019-06-06',
		billDate: '2019-06-07',
		expenseDate: '2019-06-07',
		currency: 'INR',
		amount: '1200.00',
		taxAmount: '0.00',
		grossAmount: '1200.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '1200.00',
		sourceReference: 'E2E-INV-0017',
		evidenceReference: 'E2E-GRN-0017',
		description: 'E2E June INR project cost awaiting an approved budget',
	},
	{
		key: 'mayUsd',
		expenseNumber: 'E2E-EXP-0018',
		costUid: 'e2e-cost-0018',
		classification: 'project',
		project: 'gamma',
		state: 'recognized',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-11',
		serviceEnd: '2019-06-11',
		billDate: '2019-06-12',
		expenseDate: '2019-06-12',
		currency: 'USD',
		amount: '400.00',
		taxAmount: '0.00',
		grossAmount: '400.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '400.00',
		sourceReference: 'E2E-INV-0018',
		evidenceReference: 'E2E-GRN-0018',
		description: 'E2E June USD cost whose only budget has a commercial scope',
	},
	{
		key: 'mayEurPending',
		expenseNumber: 'E2E-EXP-0019',
		costUid: 'e2e-cost-0019',
		classification: 'project',
		project: 'gamma',
		state: 'pending_evidence',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-16',
		serviceEnd: '2019-06-16',
		billDate: '2019-06-17',
		expenseDate: '2019-06-17',
		currency: 'EUR',
		amount: '700.00',
		taxAmount: '0.00',
		grossAmount: '700.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-0019',
		evidenceReference: 'E2E-GRN-0019',
		description:
			'E2E June EUR cost awaiting recognition under an approved budget',
	},
	{
		key: 'mayGbp',
		expenseNumber: 'E2E-EXP-0020',
		costUid: 'e2e-cost-0020',
		classification: 'project',
		project: 'gamma',
		state: 'recognized',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-21',
		serviceEnd: '2019-06-21',
		billDate: '2019-06-22',
		expenseDate: '2019-06-22',
		currency: 'GBP',
		amount: '800.00',
		taxAmount: '0.00',
		grossAmount: '800.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '800.00',
		sourceReference: 'E2E-INV-0020',
		evidenceReference: 'E2E-GRN-0020',
		description: 'E2E June GBP cost with two approved budgets',
	},
	// ── Non-operating sources (#317) ──────────────────────────────────────
	// Recognized balances, excluded from Company Incurred Cost; only approved
	// period charges (EXPENDITURE_CHARGES below) become cost.
	{
		key: 'advancePractice',
		expenseNumber: 'E2E-EXP-317-A',
		costUid: 'e2e-cost-317-a',
		nature: 'advance',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_SOURCE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_SOURCE_MONTH}-03`,
		serviceEnd: `${EXPENDITURE_SOURCE_MONTH}-03`,
		billDate: `${EXPENDITURE_SOURCE_MONTH}-04`,
		expenseDate: `${EXPENDITURE_SOURCE_MONTH}-04`,
		currency: 'INR',
		amount: '60000.00',
		taxAmount: '0.00',
		grossAmount: '60000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '60000.00',
		sourceReference: 'E2E-INV-317-A',
		evidenceReference: 'E2E-GRN-317-A',
		description: 'E2E advance paid against future project work',
	},
	{
		key: 'depositPractice',
		expenseNumber: 'E2E-EXP-317-B',
		costUid: 'e2e-cost-317-b',
		nature: 'deposit',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_SOURCE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_SOURCE_MONTH}-05`,
		serviceEnd: `${EXPENDITURE_SOURCE_MONTH}-05`,
		billDate: `${EXPENDITURE_SOURCE_MONTH}-06`,
		expenseDate: `${EXPENDITURE_SOURCE_MONTH}-06`,
		currency: 'INR',
		amount: '30000.00',
		taxAmount: '0.00',
		grossAmount: '30000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '30000.00',
		sourceReference: 'E2E-INV-317-B',
		evidenceReference: 'E2E-GRN-317-B',
		description: 'E2E refundable deposit held by a supplier',
	},
	{
		key: 'prepaymentPractice',
		expenseNumber: 'E2E-EXP-317-C',
		costUid: 'e2e-cost-317-c',
		nature: 'prepayment',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_SOURCE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_SOURCE_MONTH}-08`,
		serviceEnd: `${EXPENDITURE_SOURCE_MONTH}-08`,
		billDate: `${EXPENDITURE_SOURCE_MONTH}-09`,
		expenseDate: `${EXPENDITURE_SOURCE_MONTH}-09`,
		currency: 'INR',
		amount: '12000.00',
		taxAmount: '0.00',
		grossAmount: '12000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '12000.00',
		sourceReference: 'E2E-INV-317-C',
		evidenceReference: 'E2E-GRN-317-C',
		description: 'E2E prepaid service consumed across two periods',
	},
	{
		key: 'capitalPractice',
		expenseNumber: 'E2E-EXP-317-D',
		costUid: 'e2e-cost-317-d',
		nature: 'capital',
		classification: 'project',
		project: 'alpha',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_SOURCE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_SOURCE_MONTH}-11`,
		serviceEnd: `${EXPENDITURE_SOURCE_MONTH}-11`,
		billDate: `${EXPENDITURE_SOURCE_MONTH}-12`,
		expenseDate: `${EXPENDITURE_SOURCE_MONTH}-12`,
		currency: 'INR',
		amount: '100000.00',
		taxAmount: '18000.00',
		grossAmount: '118000.00',
		taxTreatment: 'recoverable',
		taxEvidence: 'E2E-GST-317-D',
		// Gross 118000 less the evidenced recoverable 18000: the supported
		// balance is the net cost once, never net minus tax again.
		recognizedAmount: '100000.00',
		sourceReference: 'E2E-INV-317-D',
		evidenceReference: 'E2E-GRN-317-D',
		description: 'E2E capital equipment with evidenced recoverable tax',
	},
	{
		key: 'operatingChargeMonth',
		expenseNumber: 'E2E-EXP-317-E',
		costUid: 'e2e-cost-317-e',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_CHARGE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_CHARGE_MONTH}-04`,
		serviceEnd: `${EXPENDITURE_CHARGE_MONTH}-04`,
		billDate: `${EXPENDITURE_CHARGE_MONTH}-05`,
		expenseDate: `${EXPENDITURE_CHARGE_MONTH}-05`,
		currency: 'INR',
		amount: '5000.00',
		taxAmount: '0.00',
		grossAmount: '5000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '5000.00',
		sourceReference: 'E2E-INV-317-E',
		evidenceReference: 'E2E-GRN-317-E',
		description: 'E2E operating overhead in the first charge month',
	},
	{
		key: 'unresolvedNature',
		expenseNumber: 'E2E-EXP-317-F',
		costUid: 'e2e-cost-317-f',
		nature: 'unresolved',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_CHARGE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_CHARGE_MONTH}-06`,
		serviceEnd: `${EXPENDITURE_CHARGE_MONTH}-06`,
		billDate: `${EXPENDITURE_CHARGE_MONTH}-07`,
		expenseDate: `${EXPENDITURE_CHARGE_MONTH}-07`,
		currency: 'INR',
		amount: '7000.00',
		taxAmount: '0.00',
		grossAmount: '7000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '7000.00',
		sourceReference: 'E2E-INV-317-F',
		evidenceReference: 'E2E-GRN-317-F',
		description: 'E2E treatment still unresolved: operating or advance',
	},
	{
		key: 'draftAdvance',
		expenseNumber: 'E2E-EXP-317-G',
		costUid: 'e2e-cost-317-g',
		nature: 'advance',
		classification: 'project',
		project: 'alpha',
		state: 'draft',
		recognitionMonth: EXPENDITURE_SOURCE_MONTH,
		periodBasis: 'service_period',
		serviceStart: `${EXPENDITURE_SOURCE_MONTH}-15`,
		serviceEnd: `${EXPENDITURE_SOURCE_MONTH}-15`,
		billDate: `${EXPENDITURE_SOURCE_MONTH}-16`,
		expenseDate: `${EXPENDITURE_SOURCE_MONTH}-16`,
		currency: 'INR',
		amount: '4000.00',
		taxAmount: '0.00',
		grossAmount: '4000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-INV-317-G',
		evidenceReference: 'E2E-GRN-317-G',
		description: 'E2E advance not approved yet: no supported balance',
	},
];

/** One approved (or cancelled) period charge seeded against a source cost. */
export interface SeedCharge {
	/** Stable key the spec addresses the row by. */
	key: string;
	chargeUid: string;
	/** `SeedCost.key` of the non-operating source it consumes. */
	sourceKey: string;
	/** The charge's own month (`YYYY-MM`). */
	period: string;
	basis: ExpenditureChargeBasis;
	amount: string;
	state: 'approved' | 'cancelled';
	evidenceReference: string;
	cancelReason?: string;
	description: string;
}

/**
 * Approved period consumption, depreciation, and amortization. The cancelled
 * deposit charge proves a cancelled charge neither counts as cost nor reduces
 * the remaining balance — and that the balance it freed can be re-entered.
 */
export const EXPENDITURE_CHARGES: SeedCharge[] = [
	{
		key: 'advanceConsumption',
		chargeUid: 'e2e-charge-317-a1',
		sourceKey: 'advancePractice',
		period: EXPENDITURE_CHARGE_MONTH,
		basis: 'consumption',
		amount: '20000.00',
		state: 'approved',
		evidenceReference: 'E2E-CHG-317-A1',
		description: 'E2E advance consumed by project work',
	},
	{
		key: 'depositCancelled',
		chargeUid: 'e2e-charge-317-b1',
		sourceKey: 'depositPractice',
		period: EXPENDITURE_CHARGE_MONTH,
		basis: 'consumption',
		amount: '10000.00',
		state: 'cancelled',
		evidenceReference: 'E2E-CHG-317-B1',
		cancelReason: 'E2E cancelled consumption of a deposit',
		description: 'E2E cancelled deposit consumption',
	},
	{
		key: 'prepaymentFirst',
		chargeUid: 'e2e-charge-317-c1',
		sourceKey: 'prepaymentPractice',
		period: EXPENDITURE_CHARGE_MONTH,
		basis: 'consumption',
		amount: '4000.00',
		state: 'approved',
		evidenceReference: 'E2E-CHG-317-C1',
		description: 'E2E prepaid service consumed in the first period',
	},
	{
		key: 'capitalDepreciation',
		chargeUid: 'e2e-charge-317-d1',
		sourceKey: 'capitalPractice',
		period: EXPENDITURE_CHARGE_MONTH,
		basis: 'depreciation',
		amount: '5000.00',
		state: 'approved',
		evidenceReference: 'E2E-CHG-317-D1',
		description: 'E2E approved depreciation of the capital item',
	},
	{
		key: 'prepaymentSecond',
		chargeUid: 'e2e-charge-317-c2',
		sourceKey: 'prepaymentPractice',
		period: EXPENDITURE_CHARGE_LATER_MONTH,
		basis: 'consumption',
		amount: '8000.00',
		state: 'approved',
		evidenceReference: 'E2E-CHG-317-C2',
		description: 'E2E prepaid service consumed in the second period',
	},
];
/**
 * Approved Project cost budgets (#321).
 *
 * Budgets are their own store, so these rows change no expense and no
 * reconciliation total: January, February, and the empty month 2019-05 keep
 * exactly the expenses the reconciliation spec already asserts. The budget
 * workflow month is 2019-06 (2019-10..12 belong to #319), and the rows cover
 * every comparison outcome the module must state explicitly:
 *
 *   alpha / 2019-01 / INR  approved covering budget            → compared
 *   alpha / 2019-02 / INR  approved USD budget only            → incompatible currency
 *   alpha / 2019-02 / USD  the same USD budget                 → compared
 *   beta  / 2019-01 / INR  no budget at all                    → missing
 *   gamma / 2019-06 / INR  approved, but for an earlier period  → incompatible period
 *   gamma / 2019-06 / USD  approved commercial-value scope     → incompatible scope
 *   gamma / 2019-06 / EUR  approved, cost not recognized yet   → unsupported cost
 *   gamma / 2019-06 / GBP  two approved covering budgets       → ambiguous
 */
export const EXPENDITURE_BUDGET_UID_PREFIX = 'e2e-budget-';
/**
 * A commercial figure seeded on the budget-only Project. The report must never
 * read a Project sales value as a cost budget, so the spec asserts this number
 * appears nowhere in the budget section.
 */
export const EXPENDITURE_PROJECT_VALUE = 999999.0;

export type BudgetScope = 'project_incurred_cost' | 'commercial_value';
export type BudgetState =
	| 'draft'
	| 'submitted'
	| 'approved'
	| 'superseded'
	| 'withdrawn';

export interface SeedBudget {
	/** Stable key the spec addresses the row by. */
	key: string;
	budgetUid: string;
	project: ExpenditureProjectKey;
	currency: string;
	/** Approved amount as a literal, so the spec can assert its own arithmetic. */
	amount: string;
	scope: BudgetScope;
	periodStart: string;
	periodEnd: string;
	state: BudgetState;
	/** Approval evidence; every approved fixture row carries one. */
	approvalEvidence: string | null;
	basisNote: string | null;
	/** The version the next command must present. */
	financialVersion: number;
	/** Which journal commands the fixture history holds, oldest first. */
	journal: Array<
		| 'recorded'
		| 'updated'
		| 'submitted'
		| 'approved'
		| 'superseded'
		| 'withdrawn'
	>;
}

export const EXPENDITURE_BUDGETS: SeedBudget[] = [
	{
		key: 'alphaApproved',
		budgetUid: 'e2e-budget-0001',
		project: 'alpha',
		currency: 'INR',
		amount: '5000.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-01-01',
		periodEnd: '2019-12-31',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0001',
		basisNote: 'E2E approved annual cost budget for Alpha',
		financialVersion: 2,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'alphaFebUsd',
		budgetUid: 'e2e-budget-0002',
		project: 'alpha',
		currency: 'USD',
		amount: '200.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-02-01',
		periodEnd: '2019-02-28',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0002',
		basisNote: 'E2E approved February cost budget, stated in USD',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'gammaPeriod',
		budgetUid: 'e2e-budget-0003',
		project: 'gamma',
		currency: 'INR',
		amount: '1100.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-01-01',
		periodEnd: '2019-05-31',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0003',
		basisNote: 'E2E approved cost budget for January to May',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'gammaScope',
		budgetUid: 'e2e-budget-0004',
		project: 'gamma',
		currency: 'USD',
		amount: '900.00',
		scope: 'commercial_value',
		periodStart: '2019-06-01',
		periodEnd: '2019-06-30',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0004',
		basisNote: 'E2E approved commercial value, not a cost budget',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'gammaPending',
		budgetUid: 'e2e-budget-0005',
		project: 'gamma',
		currency: 'EUR',
		amount: '3000.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-06-01',
		periodEnd: '2019-06-30',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0005',
		basisNote: 'E2E approved June cost budget whose cost is not recognized yet',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'gammaAmbiguousA',
		budgetUid: 'e2e-budget-0006',
		project: 'gamma',
		currency: 'GBP',
		amount: '3000.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-06-01',
		periodEnd: '2019-06-30',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0006',
		basisNote: 'E2E approved June cost budget (first of two)',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'gammaAmbiguousB',
		budgetUid: 'e2e-budget-0007',
		project: 'gamma',
		currency: 'GBP',
		amount: '3500.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-06-01',
		periodEnd: '2019-06-30',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0007',
		basisNote: 'E2E approved June cost budget (second of two)',
		financialVersion: 3,
		journal: ['recorded', 'updated', 'approved'],
	},
];

export interface SeededExpenditure {
	month: string;
	nextMonth: string;
	budgetMonth: string;
	projects: Record<ExpenditureProjectKey, number>;
	costs: number;
	budgets: number;
	/** `expenses.id` per `SeedCost.key`, for direct database assertions. */
	expenseIds: Record<string, number>;
	/** `expense_period_charges.id` per `SeedCharge.key`. */
	chargeIds: Record<string, number>;
	/** `project_cost_budgets.id` per `SeedBudget.key`. */
	budgetIds: Record<string, number>;
}

/** Create the report-only reader's role and user rows from scratch. */
async function seedExpenditureReportOnlyReader(): Promise<void> {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
		[
			EXPENDITURE_REPORT_ONLY_ROLE.roleCode,
			EXPENDITURE_REPORT_ONLY_ROLE.roleName,
			JSON.stringify(['reports:read']),
			'E2E expenditure fixture reader (e2e/lib/expenditure-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(
		EXPENDITURE_REPORT_ONLY_USER.password,
		10
	);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			EXPENDITURE_REPORT_ONLY_USER.username,
			passwordHash,
			EXPENDITURE_REPORT_ONLY_USER.email,
			EXPENDITURE_REPORT_ONLY_USER.fullName,
			role.insertId,
		]
	);
}

/** Remove the report-only reader's rows; safe to run repeatedly. */
async function cleanupExpenditureReportOnlyReader(): Promise<void> {
	const username = EXPENDITURE_REPORT_ONLY_USER.username;
	// Log tables have drifted across schemas (see e2e/lib/fixtures.ts); purging
	// the fixture user must never be blocked by them.
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
		EXPENDITURE_REPORT_ONLY_ROLE.roleCode,
	]);
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureFixtures(): Promise<number> {
	await cleanupExpenditureReportOnlyReader();
	let removed = 0;
	// Period-charge history is keyed by the owning cost's identity, so it
	// survives its expense row and must be purged first — in both its own
	// tables: the append-only events, then the charge rows. A database that has
	// not run the #317 migration yet has neither table, and cleanup must still
	// succeed (the seed that follows is the loud failure in that case).
	for (const table of [
		'expense_period_charge_events',
		'expense_period_charges',
	]) {
		try {
			removed += (
				await exec(
					`DELETE FROM ${table}
          WHERE charge_uid LIKE ?
             OR source_cost_uid LIKE ?
             OR source_id IN (
                  SELECT id FROM expenses
                   WHERE expense_number LIKE ?
                      OR category = ?
                      OR vendor_name LIKE ?
                )`,
					[
						`${EXPENDITURE_CHARGE_UID_PREFIX}%`,
						`${EXPENDITURE_COST_UID_PREFIX}%`,
						`${EXPENDITURE_EXPENSE_PREFIX}%`,
						EXPENDITURE_CATEGORY,
						`${EXPENDITURE_VENDOR_PREFIX}%`,
					]
				)
			).affectedRows;
		} catch {
			// Pre-migration schema — nothing to purge yet.
		}
	}
	// Events are keyed by the namespaced cost UID, so they survive their
	// expense row and must be purged in their own right. The predicate also
	// catches costs the spec records through the app: those get a minted
	// `EXP-#####` number, so they are namespaced by the fixture category and
	// vendor prefix instead.
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid LIKE ?
           OR cost_uid LIKE ?
           OR source_id IN (
                SELECT id FROM expenses
                 WHERE expense_number LIKE ?
                    OR category = ?
                    OR vendor_name LIKE ?
              )`,
			[
				`${EXPENDITURE_COST_UID_PREFIX}%`,
				`${EXPENDITURE_RUN_COST_UID_PREFIX}%`,
				`${EXPENDITURE_EXPENSE_PREFIX}%`,
				EXPENDITURE_CATEGORY,
				`${EXPENDITURE_VENDOR_PREFIX}%`,
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
				`${EXPENDITURE_EXPENSE_PREFIX}%`,
				EXPENDITURE_CATEGORY,
				`${EXPENDITURE_VENDOR_PREFIX}%`,
			]
		)
	).affectedRows;
	// Budgets (#321) are owned by this module through their Project: the spec
	// also records budgets through the app, and every one of those targets an
	// E2E-EXP-P* Project.
	removed += (
		await exec(
			`DELETE FROM project_cost_budget_events
        WHERE budget_uid LIKE ?
           OR source_id IN (
                SELECT id FROM project_cost_budgets
                 WHERE project_id IN (
                      SELECT project_id FROM projects WHERE project_code LIKE ?
                 )
              )`,
			[
				`${EXPENDITURE_BUDGET_UID_PREFIX}%`,
				`${EXPENDITURE_PROJECT_CODE_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM project_cost_budgets
        WHERE budget_uid LIKE ?
           OR project_id IN (
                SELECT project_id FROM projects WHERE project_code LIKE ?
              )`,
			[
				`${EXPENDITURE_BUDGET_UID_PREFIX}%`,
				`${EXPENDITURE_PROJECT_CODE_PREFIX}%`,
			]
		)
	).affectedRows;
	removed += (
		await exec(`DELETE FROM projects WHERE project_code LIKE ?`, [
			`${EXPENDITURE_PROJECT_CODE_PREFIX}%`,
		])
	).affectedRows;
	return removed;
}

function statusFor(state: ExpenditureState): string {
	if (state === 'recognized') return 'approved';
	if (state === 'draft') return 'draft';
	if (state === 'rejected') return 'rejected';
	return 'submitted';
}

/** Purge leftovers, then create the projects and the direct-cost rows. */
export async function seedExpenditureFixtures(): Promise<SeededExpenditure> {
	await cleanupExpenditureFixtures();
	await seedExpenditureReportOnlyReader();

	const projects = {} as Record<ExpenditureProjectKey, number>;
	const projectKeys = Object.keys(
		EXPENDITURE_PROJECTS
	) as ExpenditureProjectKey[];
	for (const key of projectKeys) {
		const project = EXPENDITURE_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects (project_code, project_title, name, client_name, project_value, status, isDelete)
       VALUES (?, ?, NULL, ?, ?, 'ONGOING', 0)`,
			[
				project.code,
				project.title,
				project.client,
				// A commercial Project value: cost budgets must never read it.
				key === 'gamma' ? EXPENDITURE_PROJECT_VALUE : null,
			]
		);
		projects[key] = inserted.insertId;
	}

	const expenseIds: Record<string, number> = {};
	for (const cost of EXPENDITURE_COSTS) {
		const projectId = cost.project ? projects[cost.project] : null;
		const inserted = await exec(
			`INSERT INTO expenses
         (expense_number, expense_date, category, sub_category, description, vendor_name,
          amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
          is_billable, is_reimbursable, project_id, department, notes, status,
          created_by, isDelete,
          cost_uid, cost_classification, cost_nature, recognition_state, recognition_period, period_basis,
          service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
          recognized_amount, source_reference, evidence_reference, financial_version,
          recognized_by, recognized_at)
       VALUES (?, ?, ?, 'E2E Sub Category', ?, ?, ?, ?, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, ?, NULL, 0,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
			[
				cost.expenseNumber,
				cost.expenseDate,
				EXPENDITURE_CATEGORY,
				cost.description,
				`${EXPENDITURE_VENDOR_PREFIX}${cost.key}`,
				cost.amount,
				cost.taxAmount,
				cost.grossAmount,
				cost.currency,
				`${EXPENDITURE_VENDOR_PREFIX}${cost.key}`,
				projectId,
				`E2E note ${cost.key}`,
				statusFor(cost.state),
				cost.costUid,
				cost.classification,
				cost.nature ?? 'operating',
				cost.state,
				cost.recognitionMonth ? `${cost.recognitionMonth}-01` : null,
				cost.periodBasis,
				cost.serviceStart,
				cost.serviceEnd,
				cost.taxTreatment,
				cost.taxEvidence,
				cost.recognizedAmount,
				cost.sourceReference,
				cost.evidenceReference,
				cost.state === 'recognized' ? 1 : null,
				cost.state === 'recognized' ? '2019-02-01 09:00:00' : null,
			]
		);
		expenseIds[cost.key] = inserted.insertId;

		// Every seeded cost gets its version-1 journal row, so the drilldown has
		// the same history a cost recorded through the app would have.
		await exec(
			`INSERT INTO financial_cost_events
         (cost_uid, source_table, source_id, version, command, actor_user_id, reason,
          evidence_reference, snapshot)
       VALUES (?, 'expenses', ?, 1, ?, NULL, ?, ?, ?)`,
			[
				cost.costUid,
				inserted.insertId,
				cost.state === 'recognized' ? 'recorded' : 'recorded',
				`E2E fixture ${cost.key}`,
				cost.evidenceReference || null,
				JSON.stringify({
					classification: cost.classification,
					recognition_period: cost.recognitionMonth
						? `${cost.recognitionMonth}-01`
						: null,
					currency: cost.currency,
					gross_amount: cost.grossAmount,
					recognized_amount: cost.recognizedAmount,
					state: cost.state,
				}),
			]
		);
	}

	const chargeIds: Record<string, number> = {};
	for (const charge of EXPENDITURE_CHARGES) {
		const sourceId = expenseIds[charge.sourceKey];
		if (!sourceId) {
			throw new Error(
				`[e2e] charge fixture ${charge.key} references unknown source ${charge.sourceKey}`
			);
		}
		const cost = seededCost(charge.sourceKey);
		const cancelled = charge.state === 'cancelled';
		const inserted = await exec(
			`INSERT INTO expense_period_charges
         (charge_uid, source_table, source_id, source_cost_uid, charge_period, basis,
          amount, currency, evidence_reference, state, financial_version, sequence,
          approved_by, approved_at, cancelled_by, cancelled_at, cancel_reason,
          created_at, updated_at)
       VALUES (?, 'expenses', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
               (SELECT id FROM users WHERE is_super_admin = 1 ORDER BY id LIMIT 1),
               '2019-07-05 10:00:00', NULL, ?, ?, NOW(), NOW())`,
			[
				charge.chargeUid,
				sourceId,
				cost.costUid,
				`${charge.period}-01`,
				charge.basis,
				charge.amount,
				cost.currency,
				charge.evidenceReference,
				charge.state,
				cancelled ? 2 : 1,
				cancelled ? '2019-07-06 10:00:00' : null,
				cancelled ? (charge.cancelReason ?? 'E2E cancellation') : null,
			]
		);
		if (cancelled) {
			await exec(
				`UPDATE expense_period_charges
            SET cancelled_by = (SELECT id FROM users WHERE is_super_admin = 1 ORDER BY id LIMIT 1)
          WHERE id = ?`,
				[inserted.insertId]
			);
		}
		chargeIds[charge.key] = inserted.insertId;

		// The append-only approval history a charge created through the app
		// would carry: `approved`, then `cancelled` when it was withdrawn.
		await exec(
			`INSERT INTO expense_period_charge_events
         (charge_uid, version, command, actor_user_id, reason, evidence_reference,
          snapshot, created_at)
       VALUES (?, 1, 'approved', NULL, ?, ?, ?, '2019-07-05 10:00:00')`,
			[
				charge.chargeUid,
				`E2E fixture ${charge.key}`,
				charge.evidenceReference,
				JSON.stringify({
					period: `${charge.period}-01`,
					basis: charge.basis,
					amount: charge.amount,
					currency: cost.currency,
					state: 'approved',
				}),
			]
		);
		if (cancelled) {
			await exec(
				`INSERT INTO expense_period_charge_events
           (charge_uid, version, command, actor_user_id, reason, evidence_reference,
            snapshot, created_at)
         VALUES (?, 2, 'cancelled', NULL, ?, NULL, ?, '2019-07-06 10:00:00')`,
				[
					charge.chargeUid,
					charge.cancelReason ?? 'E2E cancellation',
					JSON.stringify({ state: 'cancelled' }),
				]
			);
		}
	}

	// Budgets (#321): each fixture row carries the state, approval evidence,
	// version, and journal history the module must read back.
	const admin = await rows<{ id: number }>(
		`SELECT id FROM users WHERE username = ? LIMIT 1`,
		[ADMIN_USER.username]
	);
	const adminId = admin.length > 0 ? admin[0].id : null;
	const budgetIds: Record<string, number> = {};
	for (const budget of EXPENDITURE_BUDGETS) {
		const approved = budget.state === 'approved';
		const inserted = await exec(
			`INSERT INTO project_cost_budgets
         (budget_uid, project_id, currency, amount, scope, period_start, period_end,
          basis_note, state, approval_evidence_reference, approved_by, approved_at,
          financial_version, created_by, isDelete)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
			[
				budget.budgetUid,
				projects[budget.project],
				budget.currency,
				budget.amount,
				budget.scope,
				budget.periodStart,
				budget.periodEnd,
				budget.basisNote,
				budget.state,
				budget.approvalEvidence,
				approved ? adminId : null,
				approved ? '2019-01-02 10:00:00' : null,
				budget.financialVersion,
				adminId,
			]
		);
		budgetIds[budget.key] = inserted.insertId;

		let version = 0;
		for (const command of budget.journal) {
			version += 1;
			await exec(
				`INSERT INTO project_cost_budget_events
           (budget_uid, source_table, source_id, version, command, actor_user_id, reason,
            evidence_reference, snapshot)
         VALUES (?, 'project_cost_budgets', ?, ?, ?, ?, ?, ?, ?)`,
				[
					budget.budgetUid,
					inserted.insertId,
					version,
					command,
					adminId,
					`E2E fixture ${budget.key}`,
					command === 'approved' ? budget.approvalEvidence : null,
					JSON.stringify({
						state: command === 'approved' ? 'approved' : 'draft',
						currency: budget.currency,
						amount: budget.amount,
						scope: budget.scope,
						period_start: budget.periodStart,
						period_end: budget.periodEnd,
						financial_version: version,
					}),
				]
			);
		}
	}

	return {
		month: EXPENDITURE_MONTH,
		nextMonth: EXPENDITURE_NEXT_MONTH,
		budgetMonth: BUDGET_MONTH,
		projects,
		costs: EXPENDITURE_COSTS.length,
		budgets: EXPENDITURE_BUDGETS.length,
		expenseIds,
		chargeIds,
		budgetIds,
	};
}

/** The seeded period charge for a key, or a thrown error when missing. */
export function seededCharge(key: string): SeedCharge {
	const charge = EXPENDITURE_CHARGES.find((entry) => entry.key === key);
	if (!charge)
		throw new Error(`Unknown expenditure charge fixture key: ${key}`);
	return charge;
}

/** The seeded budget for a key, or a thrown error when it is missing. */
export function seededBudget(key: string): SeedBudget {
	const budget = EXPENDITURE_BUDGETS.find((entry) => entry.key === key);
	if (!budget)
		throw new Error(`Unknown expenditure budget fixture key: ${key}`);
	return budget;
}

/** The seeded row for a key, or a thrown error when the fixture is missing. */
export function seededCost(key: string): SeedCost {
	const cost = EXPENDITURE_COSTS.find((entry) => entry.key === key);
	if (!cost) throw new Error(`Unknown expenditure fixture key: ${key}`);
	return cost;
}

/**
 * Sign in the report-only reader through the real API and return a context
 * carrying that session. Mirrors the security harness's login so the identity
 * is exercised exactly as a browser would be, without sharing its fixtures:
 * the `auth` bucket for this identity is cleared first (rerun safety) and its
 * own trusted-header identity isolates the following API calls.
 */
export async function loginExpenditureReportOnlyReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	const user = EXPENDITURE_REPORT_ONLY_USER;
	const ip = EXPENDITURE_REPORT_ONLY_IP;
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
				`[e2e] loginExpenditureReportOnlyReader failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				'[e2e] loginExpenditureReportOnlyReader: login succeeded but no session cookie was set'
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
