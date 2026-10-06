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
export const EXPENDITURE_VENDOR_PREFIX = 'E2E Expenditure Vendor ';
/** Category every fixture row carries (`expenses.category`). */
export const EXPENDITURE_CATEGORY = 'E2E Expenditure';

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

export interface SeedCost {
	/** Stable key the spec addresses the row by. */
	key: string;
	expenseNumber: string;
	costUid: string;
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
		recognitionMonth: '2021-08',
		periodBasis: 'service_period',
		serviceStart: '2021-08-10',
		serviceEnd: '2021-08-12',
		billDate: '2021-08-13',
		expenseDate: '2021-08-13',
		createdAt: '2021-08-14 12:00:00',
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
		recognitionMonth: '2021-09',
		periodBasis: 'service_period',
		serviceStart: '2021-09-05',
		serviceEnd: '2021-09-06',
		billDate: '2021-09-07',
		expenseDate: '2021-09-07',
		createdAt: '2021-09-08 12:00:00',
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
		description: 'E2E June EUR cost awaiting recognition under an approved budget',
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
	journal: Array<'recorded' | 'updated' | 'submitted' | 'approved' | 'superseded' | 'withdrawn'>;
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
			[`${EXPENDITURE_BUDGET_UID_PREFIX}%`, `${EXPENDITURE_PROJECT_CODE_PREFIX}%`]
		)
	).affectedRows;
	removed += (
		await exec(
			`DELETE FROM project_cost_budgets
        WHERE budget_uid LIKE ?
           OR project_id IN (
                SELECT project_id FROM projects WHERE project_code LIKE ?
              )`,
			[`${EXPENDITURE_BUDGET_UID_PREFIX}%`, `${EXPENDITURE_PROJECT_CODE_PREFIX}%`]
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
          cost_uid, cost_classification, recognition_state, recognition_period, period_basis,
          service_period_start, service_period_end, tax_treatment, tax_evidence_reference,
          recognized_amount, source_reference, evidence_reference, financial_version,
          recognized_by, recognized_at, created_at)
       VALUES (?, ?, ?, 'E2E Sub Category', ?, ?, ?, ?, ?, ?, 'bank', ?, NULL, 0, 0, ?, NULL, ?, ?, NULL, 0,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
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
		budgetIds,
	};
}

/** The seeded budget for a key, or a thrown error when it is missing. */
export function seededBudget(key: string): SeedBudget {
	const budget = EXPENDITURE_BUDGETS.find((entry) => entry.key === key);
	if (!budget) throw new Error(`Unknown expenditure budget fixture key: ${key}`);
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
