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
 * (tickets #306, #317, #320, #321).
 *
 * Ownership is the declared fixture arrays plus this module's own category and
 * vendor namespace — never a bare `E2E-EXP-` prefix:
 *   projects            `EXPENDITURE_PROJECTS` (base, budget, and ranking codes)
 *   expenses            `EXPENDITURE_COSTS` numbers, or the app-recorded
 *                       namespace (`EXPENDITURE_CATEGORY` / vendor prefix)
 *   financial_cost_events  the declared cost UIDs above, or a cost whose source
 *                       row is one of this module's expenses
 *   period charges      `EXPENDITURE_CHARGES` UIDs, or a charge whose source is
 *                       one of this module's expenses
 *   budgets             `EXPENDITURE_BUDGETS` UIDs, or a budget of a declared Project
 *   users/roles         `e2e_cost_reports_only` / `e2e_cost_reports_reader`
 *                       (a `reports:read` reader with no expense-source read)
 *
 * `EXPENDITURE_EXPENSE_PREFIX`, `EXPENDITURE_PROJECT_CODE_PREFIX`, and the
 * cost-UID prefixes are shared namespace markers only: #316, #319, and #320
 * declare their own rows under `E2E-EXP-`/`e2e-cost-`, so no cleanup predicate
 * may match on those prefixes.
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
 * #320's comparable-period namespace (#304 slice 16). Its own months, Projects,
 * and expense numbers: June 2022 is measured to the 15th, so the unfinished
 * month, its equal-period comparison, and its ranking are deterministic on any
 * run date, and no other slice's expected totals move.
 */
export const EXPENDITURE_320_MONTH = '2022-06';
export const EXPENDITURE_320_PRIOR_MONTH = '2022-05';
/** The date the ranked month is measured to: 15 of its 30 days. */
export const EXPENDITURE_320_AS_OF = '2022-06-15';
export const EXPENDITURE_320_EXPENSE_PREFIX = 'E2E-EXP-320-';
export const EXPENDITURE_320_COST_UID_PREFIX = 'e2e-cost-320-';

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
 * A real budget editor: `other_expenses:read` and `other_expenses:update`, with
 * no approval privilege. It may draft, submit, and withdraw a draft cost
 * budget, and must be refused approving one — and refused withdrawing an
 * already approved one, which removes the basis the report compares with.
 */
export const EXPENDITURE_EDITOR_USER = {
	username: 'e2e_cost_editor',
	password: 'E2e#CostEdit1',
	email: 'e2e.cost.editor@accent.test',
	fullName: 'E2E Cost Editor',
} as const;

const EXPENDITURE_EDITOR_ROLE = {
	roleCode: 'e2e_cost_editor',
	roleName: 'E2E Cost Editor',
} as const;

/** The editor's own trusted-header identity, distinct from every other. */
const EXPENDITURE_EDITOR_IP = '198.18.0.24';

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
	// #320's ranked Projects: one with a clean increase, one that fell, one
	// whose prior amount is a recorded zero, one with no prior period at all,
	// and one the browser flow records cost against.
	p320a: {
		code: 'E2E-EXP-P320A',
		title: 'E2E Expenditure 320 Alpha',
		client: 'E2E Client 320 Alpha',
	},
	p320b: {
		code: 'E2E-EXP-P320B',
		title: 'E2E Expenditure 320 Beta',
		client: 'E2E Client 320 Beta',
	},
	p320c: {
		code: 'E2E-EXP-P320C',
		title: 'E2E Expenditure 320 Gamma',
		client: 'E2E Client 320 Gamma',
	},
	p320d: {
		code: 'E2E-EXP-P320D',
		title: 'E2E Expenditure 320 Delta',
		client: 'E2E Client 320 Delta',
	},
	p320e: {
		code: 'E2E-EXP-P320E',
		title: 'E2E Expenditure 320 Entered',
		client: 'E2E Client 320 Entered',
	},
	/** A Project whose comparison spans currencies (#320's panel proof). */
	p320f: {
		code: 'E2E-EXP-P320F',
		title: 'E2E Expenditure 320 Multi',
		client: 'E2E Client 320 Multi',
	},
	/** Budget-only project (#321): cost rows exist only in the budget months. */
	gamma: {
		code: 'E2E-EXP-P3',
		title: 'E2E Expenditure Gamma',
		client: 'E2E Client Gamma',
	},
	/** Carries the annual and partial budget periods (#321). */
	delta: {
		code: 'E2E-EXP-P4',
		title: 'E2E Expenditure Delta',
		client: 'E2E Client Delta',
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
	/**
	 * When the row entered the system, for late and backdated disclosure;
	 * omitted means the database's own insert time.
	 */
	createdAt?: string | null;
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
	// #320: June 2022 is the ranked month (measured to the 15th), May 2022 its
	// comparable prior month. Amounts are stated here so the spec's expected
	// ranking, changes, and cost-to-date figures are hand-computed literals.
	{
		key: 'p320aEarlyService',
		expenseNumber: 'E2E-EXP-320-A01',
		costUid: 'e2e-cost-320-a01',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-03',
		serviceEnd: '2022-06-09',
		billDate: '2022-06-10',
		expenseDate: '2022-06-10',
		createdAt: '2022-06-12 12:00:00',
		currency: 'INR',
		amount: '120000.00',
		taxAmount: '0.00',
		grossAmount: '120000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '120000.00',
		sourceReference: 'E2E-320-INV-A01',
		evidenceReference: 'E2E-320-GRN-A01',
		description: 'E2E 320 A service inside the elapsed window',
	},
	{
		key: 'p320aLaterService',
		expenseNumber: 'E2E-EXP-320-A02',
		costUid: 'e2e-cost-320-a02',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-20',
		serviceEnd: '2022-06-25',
		billDate: '2022-06-26',
		expenseDate: '2022-06-26',
		createdAt: '2022-06-27 12:00:00',
		currency: 'INR',
		amount: '40000.00',
		taxAmount: '0.00',
		grossAmount: '40000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '40000.00',
		sourceReference: 'E2E-320-INV-A02',
		evidenceReference: 'E2E-320-GRN-A02',
		description: 'E2E 320 A service after the elapsed window',
	},
	{
		key: 'p320aBillDate',
		expenseNumber: 'E2E-EXP-320-A03',
		costUid: 'e2e-cost-320-a03',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'bill_date_fallback',
		serviceStart: null,
		serviceEnd: null,
		billDate: '2022-06-10',
		expenseDate: '2022-06-10',
		createdAt: '2022-06-12 12:00:00',
		currency: 'INR',
		amount: '5000.00',
		taxAmount: '0.00',
		grossAmount: '5000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '5000.00',
		sourceReference: 'E2E-320-INV-A03',
		evidenceReference: 'E2E-320-GRN-A03',
		description: 'E2E 320 A cost whose period is only its bill date',
	},
	{
		key: 'p320aLateInWindow',
		expenseNumber: 'E2E-EXP-320-A04',
		costUid: 'e2e-cost-320-a04',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-07',
		serviceEnd: '2022-06-08',
		billDate: '2022-06-25',
		expenseDate: '2022-06-25',
		createdAt: '2022-06-25 12:00:00',
		currency: 'INR',
		amount: '3000.00',
		taxAmount: '0.00',
		grossAmount: '3000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '3000.00',
		sourceReference: 'E2E-320-INV-A04',
		evidenceReference: 'E2E-320-GRN-A04',
		description: 'E2E 320 A cost entered after the window closed',
	},
	{
		key: 'p320aBackdated',
		expenseNumber: 'E2E-EXP-320-A05',
		costUid: 'e2e-cost-320-a05',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-09',
		serviceEnd: '2022-06-10',
		billDate: '2022-07-04',
		expenseDate: '2022-07-04',
		createdAt: '2022-07-03 12:00:00',
		currency: 'INR',
		amount: '2000.00',
		taxAmount: '0.00',
		grossAmount: '2000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '2000.00',
		sourceReference: 'E2E-320-INV-A05',
		evidenceReference: 'E2E-320-GRN-A05',
		description: 'E2E 320 A cost recognized back into June',
	},
	{
		key: 'p320bService',
		expenseNumber: 'E2E-EXP-320-B01',
		costUid: 'e2e-cost-320-b01',
		classification: 'project',
		project: 'p320b',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-01',
		serviceEnd: '2022-06-02',
		billDate: '2022-06-03',
		expenseDate: '2022-06-03',
		createdAt: '2022-06-04 12:00:00',
		currency: 'INR',
		amount: '90000.00',
		taxAmount: '0.00',
		grossAmount: '90000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '90000.00',
		sourceReference: 'E2E-320-INV-B01',
		evidenceReference: 'E2E-320-GRN-B01',
		description: 'E2E 320 B recognized service cost',
	},
	{
		key: 'p320bDraft',
		expenseNumber: 'E2E-EXP-320-B02',
		costUid: 'e2e-cost-320-b02',
		classification: 'project',
		project: 'p320b',
		state: 'draft',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-05',
		serviceEnd: '2022-06-06',
		billDate: '2022-06-07',
		expenseDate: '2022-06-07',
		createdAt: '2022-06-08 12:00:00',
		currency: 'INR',
		amount: '30000.00',
		taxAmount: '0.00',
		grossAmount: '30000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-320-INV-B02',
		evidenceReference: 'E2E-320-GRN-B02',
		description: 'E2E 320 B cost still awaiting recognition',
	},
	{
		key: 'p320cService',
		expenseNumber: 'E2E-EXP-320-C01',
		costUid: 'e2e-cost-320-c01',
		classification: 'project',
		project: 'p320c',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-12',
		serviceEnd: '2022-06-14',
		billDate: '2022-06-15',
		expenseDate: '2022-06-15',
		createdAt: '2022-06-14 12:00:00',
		currency: 'INR',
		amount: '12000.00',
		taxAmount: '0.00',
		grossAmount: '12000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '12000.00',
		sourceReference: 'E2E-320-INV-C01',
		evidenceReference: 'E2E-320-GRN-C01',
		description: 'E2E 320 C cost with a recorded zero prior period',
	},
	{
		key: 'p320cZeroPrior',
		expenseNumber: 'E2E-EXP-320-C00',
		costUid: 'e2e-cost-320-c00',
		classification: 'project',
		project: 'p320c',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-05',
		serviceEnd: '2022-05-07',
		billDate: '2022-05-08',
		expenseDate: '2022-05-08',
		createdAt: '2022-05-09 12:00:00',
		currency: 'INR',
		amount: '0.00',
		taxAmount: '0.00',
		grossAmount: '0.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '0.00',
		sourceReference: 'E2E-320-INV-C00',
		evidenceReference: 'E2E-320-GRN-C00',
		description: 'E2E 320 C recorded zero cost in the prior window',
	},
	{
		key: 'p320dService',
		expenseNumber: 'E2E-EXP-320-D01',
		costUid: 'e2e-cost-320-d01',
		classification: 'project',
		project: 'p320d',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-04',
		serviceEnd: '2022-06-06',
		billDate: '2022-06-07',
		expenseDate: '2022-06-07',
		createdAt: '2022-06-08 12:00:00',
		currency: 'INR',
		amount: '8000.00',
		taxAmount: '0.00',
		grossAmount: '8000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '8000.00',
		sourceReference: 'E2E-320-INV-D01',
		evidenceReference: 'E2E-320-GRN-D01',
		description: 'E2E 320 D cost with no prior period at all',
	},
	{
		key: 'p320dPendingNoAmount',
		expenseNumber: 'E2E-EXP-320-D02',
		costUid: 'e2e-cost-320-d02',
		classification: 'project',
		project: 'p320d',
		state: 'pending_evidence',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-09',
		serviceEnd: '2022-06-10',
		billDate: '2022-06-11',
		expenseDate: '2022-06-11',
		createdAt: '2022-06-12 12:00:00',
		currency: 'INR',
		amount: null,
		taxAmount: null,
		grossAmount: null,
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-320-INV-D02',
		evidenceReference: 'E2E-320-GRN-D02',
		description: 'E2E 320 D pending evidence with an unknown amount',
	},
	{
		key: 'p320Overhead',
		expenseNumber: 'E2E-EXP-320-O01',
		costUid: 'e2e-cost-320-o01',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-05',
		serviceEnd: '2022-06-06',
		billDate: '2022-06-07',
		expenseDate: '2022-06-07',
		createdAt: '2022-06-08 12:00:00',
		currency: 'INR',
		amount: '50000.00',
		taxAmount: '0.00',
		grossAmount: '50000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '50000.00',
		sourceReference: 'E2E-320-INV-O01',
		evidenceReference: 'E2E-320-GRN-O01',
		description: 'E2E 320 Company Overhead cost',
	},
	{
		key: 'p320Unallocated',
		expenseNumber: 'E2E-EXP-320-U01',
		costUid: 'e2e-cost-320-u01',
		classification: 'unallocated',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'bill_date_fallback',
		serviceStart: null,
		serviceEnd: null,
		billDate: '2022-06-08',
		expenseDate: '2022-06-08',
		createdAt: '2022-06-09 12:00:00',
		currency: 'INR',
		amount: '20000.00',
		taxAmount: '0.00',
		grossAmount: '20000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '20000.00',
		sourceReference: 'E2E-320-INV-U01',
		evidenceReference: 'E2E-320-GRN-U01',
		description: 'E2E 320 Unallocated Cost with a bill-date period',
	},
	{
		key: 'p320Unclassified',
		expenseNumber: 'E2E-EXP-320-X01',
		costUid: 'e2e-cost-320-x01',
		classification: null,
		project: null,
		state: 'pending_evidence',
		recognitionMonth: EXPENDITURE_320_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-06-02',
		serviceEnd: '2022-06-03',
		billDate: '2022-06-04',
		expenseDate: '2022-06-04',
		createdAt: '2022-06-05 12:00:00',
		currency: 'INR',
		amount: '4000.00',
		taxAmount: '0.00',
		grossAmount: '4000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: null,
		sourceReference: 'E2E-320-INV-X01',
		evidenceReference: 'E2E-320-GRN-X01',
		description: 'E2E 320 cost with no destination yet',
	},
	{
		key: 'p320aPriorEarly',
		expenseNumber: 'E2E-EXP-320-A11',
		costUid: 'e2e-cost-320-a11',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-02',
		serviceEnd: '2022-05-08',
		billDate: '2022-05-09',
		expenseDate: '2022-05-09',
		createdAt: '2022-05-10 12:00:00',
		currency: 'INR',
		amount: '100000.00',
		taxAmount: '0.00',
		grossAmount: '100000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '100000.00',
		sourceReference: 'E2E-320-INV-A11',
		evidenceReference: 'E2E-320-GRN-A11',
		description: 'E2E 320 A prior-window service cost',
	},
	{
		key: 'p320aPriorLater',
		expenseNumber: 'E2E-EXP-320-A12',
		costUid: 'e2e-cost-320-a12',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-20',
		serviceEnd: '2022-05-25',
		billDate: '2022-05-26',
		expenseDate: '2022-05-26',
		createdAt: '2022-05-27 12:00:00',
		currency: 'INR',
		amount: '55000.00',
		taxAmount: '0.00',
		grossAmount: '55000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '55000.00',
		sourceReference: 'E2E-320-INV-A12',
		evidenceReference: 'E2E-320-GRN-A12',
		description: 'E2E 320 A prior-month cost after the window',
	},
	{
		key: 'p320aPriorLate',
		expenseNumber: 'E2E-EXP-320-A13',
		costUid: 'e2e-cost-320-a13',
		classification: 'project',
		project: 'p320a',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-04',
		serviceEnd: '2022-05-06',
		billDate: '2022-05-20',
		expenseDate: '2022-05-20',
		createdAt: '2022-05-20 12:00:00',
		currency: 'INR',
		amount: '7000.00',
		taxAmount: '0.00',
		grossAmount: '7000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '7000.00',
		sourceReference: 'E2E-320-INV-A13',
		evidenceReference: 'E2E-320-GRN-A13',
		description: 'E2E 320 A prior-window cost entered after it closed',
	},
	{
		key: 'p320bPrior',
		expenseNumber: 'E2E-EXP-320-B11',
		costUid: 'e2e-cost-320-b11',
		classification: 'project',
		project: 'p320b',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-05',
		serviceEnd: '2022-05-10',
		billDate: '2022-05-11',
		expenseDate: '2022-05-11',
		createdAt: '2022-05-12 12:00:00',
		currency: 'INR',
		amount: '100000.00',
		taxAmount: '0.00',
		grossAmount: '100000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '100000.00',
		sourceReference: 'E2E-320-INV-B11',
		evidenceReference: 'E2E-320-GRN-B11',
		description: 'E2E 320 B prior-window service cost',
	},
	{
		key: 'p320OverheadPrior',
		expenseNumber: 'E2E-EXP-320-O11',
		costUid: 'e2e-cost-320-o11',
		classification: 'company_overhead',
		project: null,
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-03',
		serviceEnd: '2022-05-04',
		billDate: '2022-05-05',
		expenseDate: '2022-05-05',
		createdAt: '2022-05-06 12:00:00',
		currency: 'INR',
		amount: '60000.00',
		taxAmount: '0.00',
		grossAmount: '60000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '60000.00',
		sourceReference: 'E2E-320-INV-O11',
		evidenceReference: 'E2E-320-GRN-O11',
		description: 'E2E 320 Company Overhead in the prior window',
	},
	// #320 boundary fixtures: the last day of a longer prior month must count
	// when the reported month has fully elapsed but not inside an elapsed-day
	// window, January 2026 gives financial-year stepping a January month to try
	// to step out of, and the 2021 pair makes one comparison span currencies.
	{
		key: 'p320dPriorLastDay',
		expenseNumber: 'E2E-EXP-320-D11',
		costUid: 'e2e-cost-320-d11',
		classification: 'project',
		project: 'p320d',
		state: 'recognized',
		recognitionMonth: EXPENDITURE_320_PRIOR_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2022-05-31',
		serviceEnd: '2022-05-31',
		billDate: '2022-05-31',
		expenseDate: '2022-05-31',
		createdAt: '2022-05-31 12:00:00',
		currency: 'INR',
		amount: '4000.00',
		taxAmount: '0.00',
		grossAmount: '4000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '4000.00',
		sourceReference: 'E2E-320-INV-D11',
		evidenceReference: 'E2E-320-GRN-D11',
		description: 'E2E 320 D cost on the last day of the prior month',
	},
	{
		key: 'p320eJanuary',
		expenseNumber: 'E2E-EXP-320-E01',
		costUid: 'e2e-cost-320-e01',
		classification: 'project',
		project: 'p320e',
		state: 'recognized',
		recognitionMonth: '2026-01',
		periodBasis: 'service_period',
		serviceStart: '2026-01-12',
		serviceEnd: '2026-01-13',
		billDate: '2026-01-14',
		expenseDate: '2026-01-14',
		createdAt: '2026-01-15 12:00:00',
		currency: 'INR',
		amount: '2500.00',
		taxAmount: '0.00',
		grossAmount: '2500.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '2500.00',
		sourceReference: 'E2E-320-INV-E01',
		evidenceReference: 'E2E-320-GRN-E01',
		description: 'E2E 320 E cost in January 2026 for stepping',
	},
	{
		key: 'p320fPriorUsd',
		expenseNumber: 'E2E-EXP-320-F01',
		costUid: 'e2e-cost-320-f01',
		classification: 'project',
		project: 'p320f',
		state: 'recognized',
		recognitionMonth: '2022-08',
		periodBasis: 'service_period',
		serviceStart: '2022-08-10',
		serviceEnd: '2022-08-12',
		billDate: '2022-08-13',
		expenseDate: '2022-08-13',
		createdAt: '2022-08-14 12:00:00',
		currency: 'USD',
		amount: '200.00',
		taxAmount: '0.00',
		grossAmount: '200.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '200.00',
		sourceReference: 'E2E-320-INV-F01',
		evidenceReference: 'E2E-320-GRN-F01',
		description: 'E2E 320 USD cost in the prior month',
	},
	{
		key: 'p320fCurrentInr',
		expenseNumber: 'E2E-EXP-320-F02',
		costUid: 'e2e-cost-320-f02',
		classification: 'project',
		project: 'p320f',
		state: 'recognized',
		recognitionMonth: '2022-09',
		periodBasis: 'service_period',
		serviceStart: '2022-09-05',
		serviceEnd: '2022-09-06',
		billDate: '2022-09-07',
		expenseDate: '2022-09-07',
		createdAt: '2022-09-08 12:00:00',
		currency: 'INR',
		amount: '10000.00',
		taxAmount: '0.00',
		grossAmount: '10000.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '10000.00',
		sourceReference: 'E2E-320-INV-F02',
		evidenceReference: 'E2E-320-GRN-F02',
		description: 'E2E 320 INR cost in the reported month',
	},
	{
		key: 'juneInr',
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
		key: 'juneUsd',
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
		key: 'juneEurPending',
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
		key: 'juneGbp',
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
	{
		key: 'juneBetaInr',
		expenseNumber: 'E2E-EXP-0021',
		costUid: 'e2e-cost-0021',
		classification: 'project',
		project: 'beta',
		state: 'recognized',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-11',
		serviceEnd: '2019-06-11',
		billDate: '2019-06-12',
		expenseDate: '2019-06-12',
		currency: 'INR',
		amount: '300.00',
		taxAmount: '0.00',
		grossAmount: '300.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '300.00',
		sourceReference: 'E2E-INV-0021',
		evidenceReference: 'E2E-GRN-0021',
		description:
			'E2E June INR cost whose only approved budget is stated in USD',
	},
	{
		key: 'deltaInr',
		expenseNumber: 'E2E-EXP-0022',
		costUid: 'e2e-cost-0022',
		classification: 'project',
		project: 'delta',
		state: 'recognized',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-03',
		serviceEnd: '2019-06-03',
		billDate: '2019-06-04',
		expenseDate: '2019-06-04',
		currency: 'INR',
		amount: '250.00',
		taxAmount: '0.00',
		grossAmount: '250.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '250.00',
		sourceReference: 'E2E-INV-0022',
		evidenceReference: 'E2E-GRN-0022',
		description: 'E2E June INR cost under an annual cost budget only',
	},
	{
		key: 'deltaUsd',
		expenseNumber: 'E2E-EXP-0023',
		costUid: 'e2e-cost-0023',
		classification: 'project',
		project: 'delta',
		state: 'recognized',
		recognitionMonth: BUDGET_MONTH,
		periodBasis: 'service_period',
		serviceStart: '2019-06-05',
		serviceEnd: '2019-06-05',
		billDate: '2019-06-06',
		expenseDate: '2019-06-06',
		currency: 'USD',
		amount: '120.00',
		taxAmount: '0.00',
		grossAmount: '120.00',
		taxTreatment: 'none',
		taxEvidence: null,
		recognizedAmount: '120.00',
		sourceReference: 'E2E-INV-0023',
		evidenceReference: 'E2E-GRN-0023',
		description: 'E2E June USD cost under a mid-month partial cost budget only',
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
 * every comparison outcome the module must state explicitly. A variance is
 * published only when the budget's period is exactly the selected month, so
 * annual and partial budgets show as incompatible periods:
 *
 *   alpha / 2019-01 / INR  approved for January exactly            → compared
 *   alpha / 2019-02 / INR  the January budget, not February        → incompatible period
 *   alpha / 2019-02 / USD  the February USD budget                 → compared
 *   beta  / 2019-01 / INR  no budget at all                        → missing
 *   beta  / 2019-06 / INR  an approved USD budget only             → incompatible currency
 *   gamma / 2019-06 / INR  approved, but for an earlier period     → incompatible period
 *   gamma / 2019-06 / USD  approved commercial-value scope         → incompatible scope
 *   gamma / 2019-06 / EUR  approved, cost not recognized yet       → unsupported cost
 *   gamma / 2019-06 / GBP  two approved covering budgets           → ambiguous
 *   delta / 2019-06 / INR  an annual budget only                   → incompatible period
 *   delta / 2019-06 / USD  a mid-month budget spanning two months  → incompatible period
 *   alpha / 2019-08 / INR  charge-only month, August budget        → compared (#317 charges)
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
		periodEnd: '2019-01-31',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0001',
		basisNote: 'E2E approved January cost budget for Alpha',
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
	{
		key: 'betaJuneUsd',
		budgetUid: 'e2e-budget-0008',
		project: 'beta',
		currency: 'USD',
		amount: '700.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-06-01',
		periodEnd: '2019-06-30',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0008',
		basisNote: 'E2E approved June cost budget stated in USD',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'deltaAnnual',
		budgetUid: 'e2e-budget-0009',
		project: 'delta',
		currency: 'INR',
		amount: '40000.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-01-01',
		periodEnd: '2019-12-31',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0009',
		basisNote: 'E2E approved annual cost budget, never allocated to one month',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'deltaPartialUsd',
		budgetUid: 'e2e-budget-0010',
		project: 'delta',
		currency: 'USD',
		amount: '500.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-05-15',
		periodEnd: '2019-06-15',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0010',
		basisNote: 'E2E approved mid-month cost budget spanning two months',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
	},
	{
		key: 'alphaAugust',
		budgetUid: 'e2e-budget-0011',
		project: 'alpha',
		currency: 'INR',
		amount: '20000.00',
		scope: 'project_incurred_cost',
		periodStart: '2019-08-01',
		periodEnd: '2019-08-31',
		state: 'approved',
		approvalEvidence: 'E2E-BUDGET-EVID-0011',
		basisNote: 'E2E approved August cost budget for a charge-only month',
		financialVersion: 1,
		journal: ['recorded', 'approved'],
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

/** Create the budget editor's role and user rows from scratch. */
async function seedExpenditureEditor(): Promise<void> {
	const role = await exec(
		`INSERT INTO roles_master
       (role_code, role_name, role_hierarchy, department, permissions, description, status)
     VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
		[
			EXPENDITURE_EDITOR_ROLE.roleCode,
			EXPENDITURE_EDITOR_ROLE.roleName,
			JSON.stringify([
				'reports:read',
				'other_expenses:read',
				'other_expenses:update',
			]),
			'E2E expenditure fixture editor (e2e/lib/expenditure-fixtures.ts)',
		]
	);
	const passwordHash = await bcrypt.hash(EXPENDITURE_EDITOR_USER.password, 10);
	await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
		[
			EXPENDITURE_EDITOR_USER.username,
			passwordHash,
			EXPENDITURE_EDITOR_USER.email,
			EXPENDITURE_EDITOR_USER.fullName,
			role.insertId,
		]
	);
}

/** Remove one fixture identity's rows; safe to run repeatedly. */
async function cleanupExpenditureFixtureUser(
	username: string,
	roleCode: string
): Promise<void> {
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
	await exec(`DELETE FROM roles_master WHERE role_code = ?`, [roleCode]);
}

/** The identities this helper declares: nothing outside them is its to delete. */
interface OwnedFixtureIdentities {
	expenseNumbers: string[];
	costUids: string[];
	chargeUids: string[];
	budgetUids: string[];
	projectCodes: string[];
}

/**
 * Every identity the declared fixture arrays own. Cleanup works from these
 * arrays and from this module's own category/vendor namespace — never from the
 * shared `E2E-EXP-` prefixes: #316, #319, and #320 declare their own rows
 * under those prefixes, so deleting by prefix would wipe a sibling's fixtures.
 */
function ownedFixtureIdentities(): OwnedFixtureIdentities {
	return {
		expenseNumbers: EXPENDITURE_COSTS.map((cost) => cost.expenseNumber),
		costUids: EXPENDITURE_COSTS.map((cost) => cost.costUid),
		chargeUids: EXPENDITURE_CHARGES.map((charge) => charge.chargeUid),
		budgetUids: EXPENDITURE_BUDGETS.map((budget) => budget.budgetUid),
		projectCodes: Object.values(EXPENDITURE_PROJECTS).map(
			(project) => project.code
		),
	};
}

function placeholders(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * This helper's own expense rows: the declared fixture numbers plus the
 * namespace every row a spec records through the app carries (this module's
 * own category and vendor prefix). Sibling families declare their own category
 * and vendor constants, so neither clause reaches their rows.
 */
function ownedExpenseFilter(): { sql: string; params: Array<string | number> } {
	const { expenseNumbers } = ownedFixtureIdentities();
	return {
		sql: `(expense_number IN (${placeholders(expenseNumbers.length)}) OR category = ? OR vendor_name LIKE ?)`,
		params: [
			...expenseNumbers,
			EXPENDITURE_CATEGORY,
			`${EXPENDITURE_VENDOR_PREFIX}%`,
		],
	};
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureFixtures(): Promise<number> {
	await cleanupExpenditureFixtureUser(
		EXPENDITURE_REPORT_ONLY_USER.username,
		EXPENDITURE_REPORT_ONLY_ROLE.roleCode
	);
	await cleanupExpenditureFixtureUser(
		EXPENDITURE_EDITOR_USER.username,
		EXPENDITURE_EDITOR_ROLE.roleCode
	);
	let removed = 0;
	const owned = ownedFixtureIdentities();
	const expenseFilter = ownedExpenseFilter();
	const ownedExpenseIds = `SELECT id FROM expenses WHERE ${expenseFilter.sql}`;

	// Period charges and their append-only events are keyed by the owning
	// cost's identity, so they are purged before the expenses they belong to.
	// A database without the #317 migration has neither table; cleanup still
	// has to succeed there (the seed that follows fails loudly instead).
	const chargeOwnership = [
		`charge_uid IN (${placeholders(owned.chargeUids.length)})`,
		`source_cost_uid IN (${placeholders(owned.costUids.length)})`,
		`source_id IN (${ownedExpenseIds})`,
	].join(' OR ');
	const chargeParams = [
		...owned.chargeUids,
		...owned.costUids,
		...expenseFilter.params,
	];
	try {
		removed += (
			await exec(
				`DELETE FROM expense_period_charge_events
          WHERE charge_uid IN (${placeholders(owned.chargeUids.length)})
             OR charge_uid IN (
                  SELECT charge_uid FROM expense_period_charges
                   WHERE ${chargeOwnership}
                )`,
				[...owned.chargeUids, ...chargeParams]
			)
		).affectedRows;
		removed += (
			await exec(
				`DELETE FROM expense_period_charges WHERE ${chargeOwnership}`,
				chargeParams
			)
		).affectedRows;
	} catch {
		// Pre-migration schema — nothing to purge yet.
	}

	// The cost journal is keyed by the cost's identity: the declared cost UIDs
	// and any cost whose source row is one of this helper's expenses — which
	// covers the rows a spec records through the app, with minted identities.
	removed += (
		await exec(
			`DELETE FROM financial_cost_events
        WHERE cost_uid IN (${placeholders(owned.costUids.length)})
           OR source_id IN (${ownedExpenseIds})`,
			[...owned.costUids, ...expenseFilter.params]
		)
	).affectedRows;

	removed += (
		await exec(
			`DELETE FROM expenses WHERE ${expenseFilter.sql}`,
			expenseFilter.params
		)
	).affectedRows;

	// Budgets (#321) are owned through their declared UIDs and their Project:
	// the spec also records budgets through the app, and every one of those
	// targets a declared Project.
	const budgetOwnership = [
		`budget_uid IN (${placeholders(owned.budgetUids.length)})`,
		`project_id IN (SELECT project_id FROM projects WHERE project_code IN (${placeholders(owned.projectCodes.length)}))`,
	].join(' OR ');
	const budgetParams = [...owned.budgetUids, ...owned.projectCodes];
	removed += (
		await exec(
			`DELETE FROM project_cost_budget_events
        WHERE budget_uid IN (${placeholders(owned.budgetUids.length)})
           OR budget_uid IN (
                SELECT budget_uid FROM project_cost_budgets
                 WHERE ${budgetOwnership}
              )`,
			[...owned.budgetUids, ...budgetParams]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM project_cost_budgets WHERE ${budgetOwnership}`,
			budgetParams
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM projects WHERE project_code IN (${placeholders(owned.projectCodes.length)})`,
			owned.projectCodes
		)
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
	await seedExpenditureEditor();

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
          recognized_by, recognized_at, created_at)
       VALUES (?, ?, ?, 'E2E Sub Category', ?, ?, ?, ?, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, ?, NULL, 0,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
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
				// A fixture that states when it entered the system keeps that
				// time, so late and backdated disclosure is deterministic; the
				// rest take the database's insert time.
				cost.createdAt ?? null,
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
 * Sign one fixture identity in through the real API and return its cookie jar.
 * Mirrors the security harness's login so the identity is exercised exactly as
 * a browser would be, without sharing its fixtures: the `auth` bucket for this
 * identity is cleared first (rerun safety), and its own trusted-header identity
 * isolates its API calls. The jar can drive a browser context as well.
 */
async function expenditureStorageState(
	playwright: PlaywrightApi,
	baseURL: string,
	user: { username: string; password: string },
	ip: string
): Promise<{ cookies: Cookie[]; origins: [] }> {
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
				`[e2e] login for ${user.username} failed: POST /api/login -> ` +
					`${response.status()}${retryAfter ? ` (retry-after: ${retryAfter})` : ''}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] login for ${user.username} succeeded but no session cookie was set`
			);
		}
		return {
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
	} finally {
		await probe.dispose();
	}
}

/** One fixture identity's authenticated request context, with its own IP. */
async function loginExpenditureUser(
	playwright: PlaywrightApi,
	baseURL: string,
	user: { username: string; password: string },
	ip: string
): Promise<APIRequestContext> {
	const storageState = await expenditureStorageState(
		playwright,
		baseURL,
		user,
		ip
	);
	return playwright.request.newContext({
		baseURL,
		extraHTTPHeaders: { 'x-vercel-forwarded-for': ip },
		storageState,
	});
}

/** The editor's cookie jar, so a browser context can act as that identity. */
export async function expenditureEditorStorageState(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<{ cookies: Cookie[]; origins: [] }> {
	return expenditureStorageState(
		playwright,
		baseURL,
		EXPENDITURE_EDITOR_USER,
		EXPENDITURE_EDITOR_IP
	);
}

/** Headers carrying the editor's own rate-limit identity. */
export const EXPENDITURE_EDITOR_HEADERS = {
	'x-vercel-forwarded-for': EXPENDITURE_EDITOR_IP,
} as const;

/** The report-only reader's context (`reports:read` and nothing else). */
export async function loginExpenditureReportOnlyReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginExpenditureUser(
		playwright,
		baseURL,
		EXPENDITURE_REPORT_ONLY_USER,
		EXPENDITURE_REPORT_ONLY_IP
	);
}

/** The budget editor's context (`other_expenses:read`/`:update`, no approve). */
export async function loginExpenditureEditor(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginExpenditureUser(
		playwright,
		baseURL,
		EXPENDITURE_EDITOR_USER,
		EXPENDITURE_EDITOR_IP
	);
}
