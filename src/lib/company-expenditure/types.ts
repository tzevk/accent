/**
 * Public types of the company expenditure module.
 *
 * The vocabulary follows GLOSSARY.md: Company Incurred Cost, Incurred Project
 * Cost, Company Overhead, Unallocated Cost, Cost Accrual, Cost identity,
 * Recognition Period, Recognition State.
 */

import type Decimal from 'decimal.js';

/** Where a recognized cost belongs. `null` is the explicit unresolved state. */
export type CostClassification = 'project' | 'company_overhead' | 'unallocated';

/** Confirmed cost is `recognized` and nothing else. */
export type RecognitionState =
	| 'draft'
	| 'pending_evidence'
	| 'recognized'
	| 'rejected'
	| 'cancelled';

/** How the Recognition Period was established. */
export type PeriodBasis =
	| 'service_period'
	/**
	 * The received-work period is known to end on `service_period_end` but its
	 * start is not recorded; the cost sits in the end month, disclosed.
	 */
	| 'service_period_end'
	| 'bill_date_fallback'
	| 'unresolved';

export type TaxTreatment =
	| 'none'
	| 'recoverable'
	| 'non_recoverable'
	| 'unresolved';

/** The treatment actually applied to the amount, given the stored evidence. */
export type EffectiveTaxTreatment =
	| 'none'
	| 'recoverable'
	| 'non_recoverable'
	| 'unresolved';

export type CostCommandName =
	| 'update'
	| 'submit'
	| 'recognize'
	| 'reject'
	| 'cancel';

/**
 * The journal's own vocabulary (`financial_cost_events.command`): the command
 * as it happened. The API command names are imperative (`recognize`), the
 * journal is past tense (`recognized`), and `writeJournal` is the one place
 * that translates between the two.
 */
export type CostJournalCommand =
	| 'recorded'
	| 'updated'
	| 'submitted'
	| 'recognized'
	| 'rejected'
	| 'cancelled';

/** Reasons a cost is not a clean confirmed amount. Disclosed, never hidden. */
export type CostExceptionCode =
	| 'missing_amount'
	| 'original_currency_missing'
	| 'conversion_evidence_missing'
	| 'conversion_rate_invalid'
	| 'tax_evidence_missing'
	| 'tax_treatment_missing'
	| 'tax_treatment_unresolved'
	| 'classification_unresolved'
	| 'missing_recognition_period'
	| 'service_period_spans_months'
	| 'service_period_start_missing'
	| 'missing_source_reference'
	| 'missing_evidence_reference';

/** How a cost's amount can be stated in the requested reporting currency. */
export type ConversionStatus = 'reporting' | 'converted' | 'unsupported';

/** Why a cost cannot be stated in the requested reporting currency. */
export type ConversionExceptionCode =
	| 'original_currency_missing'
	| 'conversion_evidence_missing'
	| 'conversion_rate_invalid';

/**
 * The evidence behind a reporting-currency figure: the original currency, the
 * reporting target, and the effective rate/date/reference. The rate stays a
 * decimal string (or Decimal): DECIMAL(20,10) holds more digits than a JS
 * number can state exactly.
 */
export interface ConversionEvidence {
	currency: string | null;
	reportingCurrency?: string | null;
	conversionRate: Decimal.Value | null;
	conversionDate?: string | null;
	conversionEvidenceReference?: string | null;
}

/**
 * The reporting-currency statement of one amount. `reporting` means the
 * amount is already in the requested basis; `converted` means stored evidence
 * supports it; `unsupported` means no amount may be stated in that basis.
 */
export interface ConversionOutcome {
	status: ConversionStatus;
	reportingCurrency: string;
	amount: number | null;
	exception: ConversionExceptionCode | null;
}

/** One currency's report in the requested reporting currency. */
export interface CurrencyReporting {
	currency: string;
	/**
	 * `unsupported` when any confirmed record in the slice lacks matching
	 * evidence; the figures are then null rather than a partial total.
	 */
	status: ConversionStatus;
	unsupported_count: number;
	incurred_project_cost: number | null;
	company_overhead: number | null;
	unallocated_cost: number | null;
	incurred_cost: number | null;
	gross_liability: number | null;
	recoverable_tax: number | null;
	unresolved_tax_gross: number | null;
}

/** Whether the month as a whole can be stated in the requested basis. */
export interface CompanyConversion {
	status: ConversionStatus;
	converted_records: number;
	unsupported_records: number;
	/** Currencies with at least one confirmed record lacking matching evidence. */
	unsupported_currencies: string[];
	/** Confirmed records whose original currency is unknown. */
	unknown_currency_records: number;
}

export interface CostFinancialInput {
	classification: CostClassification | null;
	state: RecognitionState;
	/**
	 * Original/transaction currency. Null is unknown: it is never guessed from
	 * a Project default or read as INR, and it blocks recognition until
	 * captured.
	 */
	currency: string | null;
	/**
	 * The currency this cost is reported in. Null means the company reporting
	 * currency — a reporting-target default, not a statement about the
	 * original transaction currency.
	 */
	reportingCurrency: string | null;
	/** Effective original → reporting rate. Kept as the recorded string. */
	conversionRate: string | null;
	conversionDate: string | null;
	conversionEvidenceReference: string | null;
	/** Reporting-currency value of `recognizedAmount` at the recorded rate. */
	convertedAmount: number | null;
	/** Gross liability (`expenses.total_amount`). */
	grossAmount: number | null;
	/** Tax amount (`expenses.tax_amount`). */
	taxAmount: number | null;
	taxTreatment: TaxTreatment;
	taxEvidenceReference: string | null;
	servicePeriodStart: string | null;
	servicePeriodEnd: string | null;
	/** Bill/invoice date; only a disclosed fallback for the period. */
	billDate: string | null;
	sourceReference: string | null;
	evidenceReference: string | null;
	recognitionPeriod: string | null;
	periodBasis: PeriodBasis;
	recognizedAmount: number | null;
}

export interface CostEvaluation {
	/** The cost to recognize, or null when no amount is known. */
	recognizedAmount: number | null;
	effectiveTaxTreatment: EffectiveTaxTreatment;
	exceptions: CostExceptionCode[];
}

/** One direct cost as the financial module sees it. */
export interface CostRecord extends CostFinancialInput {
	id: number;
	costUid: string | null;
	expenseNumber: string;
	expenseDate: string | null;
	vendorName: string | null;
	description: string | null;
	projectId: number | null;
	projectCode: string | null;
	projectName: string | null;
	clientName: string | null;
	financialVersion: number;
	recognizedAt: string | null;
	recognizedBy: number | null;
	evaluation: CostEvaluation;
}

export type CoverageSeverity = 'warning' | 'info';

export interface CoverageNotice {
	code: string;
	label: string;
	detail: string;
	severity: CoverageSeverity;
}

/** One currency's slice of the company reconciliation. */
export interface CurrencyTotal {
	currency: string;
	incurred_project_cost: number;
	company_overhead: number;
	unallocated_cost: number;
	/** Sum of the three groups, in this currency only. */
	incurred_cost: number;
	/** Gross liability of this currency's confirmed records (`total_amount`). */
	gross_liability: number;
	/** Evidenced recoverable tax this currency's cost excludes. */
	recoverable_tax: number;
	/** Gross liability of this currency's confirmed records with unresolved tax. */
	unresolved_tax_gross: number;
	record_count: number;
	/** The same slice in the requested reporting currency. */
	reporting: CurrencyReporting;
}

export interface ReconciliationGroup {
	key: 'incurred_project_cost' | 'company_overhead' | 'unallocated_cost';
	label: string;
	amount: number;
	record_count: number;
}

export interface ReconciliationProjectRow {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	/**
	 * The one currency this row is stated in. A Project whose month holds more
	 * than one currency gets one row per currency; amounts are never combined.
	 */
	currency: string;
	/** Whether this row can be stated in the requested reporting currency. */
	conversion_status: ConversionStatus;
	/** Reporting-currency cost; null unless every confirmed record is supported. */
	converted_incurred_cost: number | null;
	incurred_cost: number;
	record_count: number;
	/**
	 * Cost recorded against the project but not yet confirmed, in this row's
	 * currency; null when a contributing record has no amount (unknown, not
	 * zero).
	 */
	not_confirmed_cost: number | null;
	previous_month_cost: number | null;
	change_amount: number | null;
	change_state: 'no_prior' | 'new' | 'increase' | 'decrease' | 'unchanged';
	/** Recorded employee cost allocated to this Project (ADR-0016), INR. */
	employee_cost: number;
	/** Payroll-based estimate for this Project, never part of `incurred_cost`. */
	estimated_employee_cost: number;
	/** Logged Hours this month on the Project, across the report's population. */
	logged_hours: number;
	/** Employees with Logged Hours on the Project this month. */
	employee_count: number;
}

export interface EvidenceStateSummary {
	count: number;
	/**
	 * The state's single currency, or null when its records span more than one.
	 */
	currency: string | null;
	/**
	 * Gross liability, or recognized cost for the recognized state. Null when a
	 * contributing amount is unknown or the records span currencies: an unknown
	 * amount is not zero, and currencies are never combined.
	 */
	amount: number | null;
}

export interface EvidenceSummary {
	recognized: EvidenceStateSummary;
	pending_evidence: EvidenceStateSummary;
	draft: EvidenceStateSummary;
	rejected: EvidenceStateSummary;
	cancelled: EvidenceStateSummary;
	unresolved_classification: {
		count: number;
		currency: string | null;
		gross_amount: number | null;
	};
	missing_amount: { count: number };
	missing_currency: { count: number };
	known_zero: { count: number };
}

export interface CompanyReconciliation {
	month: string;
	month_label: string;
	project_id: number | null;
	company: {
		/** The reporting currency this read was stated in (default INR). */
		reporting_currency: string;
		/** Whether every confirmed record could be stated in that basis. */
		conversion: CompanyConversion;
		/**
		 * The currency of `incurred_cost`, when one complete total is stated:
		 * the reporting currency once every confirmed record is supported, or
		 * the single original currency when those records share one but lack
		 * conversion evidence. Null when currencies cannot be combined.
		 */
		currency: string | null;
		/** Company Incurred Cost; null when currencies cannot be combined. */
		incurred_cost: number | null;
		currency_totals: CurrencyTotal[];
		groups: ReconciliationGroup[];
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
	projects: ReconciliationProjectRow[];
	evidence: EvidenceSummary;
	coverage: CoverageNotice[];
	/**
	/**
	 * Recorded employee cost from Payroll Slips (ADR-0016): frozen allocations
	 * plus current-month payroll-based estimates, always stated separately.
	 */
	payroll: PayrollExpenditure;
	/**
	 * The approved cost budgets behind this month's Project detail. Its own
	 * section: a budget never enters `company`, `projects`, or `evidence`.
	 */
	budgets: BudgetSection;
	project_options: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	available_months: string[];
}

export type PayrollPayStream = 'payroll' | 'contract';

/** How an employee's cost is known this month. */
export type PayrollCostStatus =
	/** Frozen recorded allocation from a finalized Payroll Slip. */
	| 'recorded'
	/** Payroll-based estimate (no finalized allocation yet). */
	| 'estimated'
	/** A finalized slip whose recorded employer cost is a known zero. */
	| 'known_zero'
	/** Cost cannot be stated: no Salary Profile covers the month. */
	| 'unknown';

export type PayrollShareBasis = 'project' | 'no_project' | 'no_logged_hours';

/** One destination's share of an employee's recorded or estimated cost. */
export interface PayrollProjectShare {
	/** null = No project (logged hours without one) or No logged hours. */
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	hours: number;
	amount: number;
	/** The cent the largest-remainder step applied to this share. */
	rounding_adjustment: number;
	basis: PayrollShareBasis;
}

/** Logged Hours on one Project, whether or not its cost is known. */
export interface PayrollHourLine {
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	hours: number;
}

/** One Employee's employee-cost position for a month. */
export interface PayrollEmployeeCost {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	pay_stream: PayrollPayStream | 'unknown';
	status: PayrollCostStatus;
	/** Recorded employer cost from the frozen Payroll Slip allocation. */
	recorded_amount: number | null;
	/** Payroll-based estimate; never added to recorded cost. */
	estimated_amount: number | null;
	logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	/** Recorded cost exists and there are no Logged Hours: fully unallocated. */
	no_logged_hours: boolean;
	/** A covering Salary Profile exists but the month has no Payroll Slip. */
	missing_slip: boolean;
	/** Logged Hours exist but no Salary Profile covers the month. */
	missing_pricing: boolean;
	/** The month is finalized but this slip has no frozen allocation. */
	allocation_missing: boolean;
	source: {
		payroll_slip_id: number | null;
		allocation_id: number | null;
		allocation_version: number | null;
		allocation_kind: 'finalization' | 'reconstruction' | null;
		month: string;
	};
	/** The money destinations: recorded shares when recorded, else estimated. */
	shares: PayrollProjectShare[];
	/** Every Logged Hour of the month, by Project, independent of pricing. */
	hours_by_project: PayrollHourLine[];
}

/** The month's employee-cost position, stated in the reporting currency. */
export interface PayrollExpenditure {
	currency: string;
	recorded_total: number;
	estimated_total: number;
	/** Recorded cost allocated to Projects. */
	allocated_total: number;
	/** Recorded cost left unallocated: No project + No logged hours. */
	unallocated_total: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	/** Total cent applied by the largest-remainder step across the month. */
	rounding_adjustment: number;
	recorded_count: number;
	known_zero_count: number;
	estimated_count: number;
	missing_slip_count: number;
	missing_pricing_count: number;
	allocation_missing_count: number;
}

/** The employee-cost drilldown: the same interpretation, per Employee. */
export interface PayrollDrilldown {
	month: string;
	month_label: string;
	currency: string;
	totals: PayrollExpenditure;
	employees: PayrollEmployeeCost[];
	coverage: CoverageNotice[];
}

/** The command contract: every change carries the version it expects. */
export interface CostCommandInput {
	/** `expenses.id` of the target cost. */
	id: number;
	command: CostCommandName;
	expectedVersion: number;
	reason?: string | null;
	evidenceReference?: string | null;
	/** Field changes for `update` (financial fields only). */
	patch?: CostPatch;
}

export interface CostPatch {
	classification?: CostClassification | null;
	projectId?: number | null;
	servicePeriodStart?: string | null;
	servicePeriodEnd?: string | null;
	billDate?: string | null;
	currency?: string | null;
	/** Reporting target; null means the company reporting currency. */
	reportingCurrency?: string | null;
	/** The full conversion triple must move together. */
	conversionRate?: Decimal.Value | null;
	conversionDate?: string | null;
	conversionEvidenceReference?: string | null;
	grossAmount?: number | null;
	taxAmount?: number | null;
	taxTreatment?: TaxTreatment;
	taxEvidenceReference?: string | null;
	sourceReference?: string | null;
	evidenceReference?: string | null;
}

export interface RecordCostInput extends CostPatch {
	expenseDate?: string | null;
	category?: string | null;
	subCategory?: string | null;
	description?: string | null;
	vendorName?: string | null;
	/** Submit straight into the recognition queue instead of staying a draft. */
	submit?: boolean;
	/** Free-text note stored on the expense row. */
	notes?: string | null;
	/** Actor-supplied number; the module mints one when absent. */
	expenseNumber?: string | null;
	/** The register's own net amount, when the caller does not speak gross+tax. */
	amount?: number | null;
	/** Register fields the existing expense workflow already collects. */
	paymentMode?: string | null;
	paymentReference?: string | null;
	paidTo?: string | null;
	paidBy?: number | null;
	receiptUrl?: string | null;
	isBillable?: number | boolean | null;
	isReimbursable?: number | boolean | null;
	department?: string | null;
	/** The register's operational status; unrelated to recognition state. */
	operationalStatus?: string | null;
}

export interface RecordedCost {
	id: number;
	expense_number: string;
	cost_uid: string;
	recognition_state: RecognitionState;
	financial_version: number;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	recognized_amount: number | null;
	cost_classification: CostClassification | null;
}

export interface CostCommandResult {
	id: number;
	cost_uid: string | null;
	recognition_state: RecognitionState;
	financial_version: number;
	recognized_amount: number | null;
	recognition_period: string | null;
	component: CostCommandName;
}

export interface CostJournalEntry {
	version: number;
	command: CostJournalCommand;
	actor_user_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
	created_at: string;
	snapshot: Record<string, unknown> | null;
}

export interface CostDrilldownQuery {
	month: string;
	state?:
		| RecognitionState
		| 'unconfirmed'
		| 'unresolved'
		| 'all';
	classification?: CostClassification | 'unresolved' | 'all';
	projectId?: number | null;
	limit?: number;
	offset?: number;
}

/**
 * A direct cost at the JSON boundary — the shape the report routes and the
 * later export publish. Snake case matches the other report payloads, and the
 * evidence state is flattened so a reader does not have to interpret an
 * evaluation object to see why a figure is what it is.
 */
export interface CostRecordJson {
	id: number;
	cost_uid: string | null;
	expense_number: string;
	recognition_state: RecognitionState;
	cost_classification: CostClassification | null;
	recognized_amount: number | null;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	service_period_start: string | null;
	service_period_end: string | null;
	expense_date: string | null;
	currency: string | null;
	reporting_currency: string | null;
	conversion_rate: string | null;
	conversion_date: string | null;
	conversion_evidence_reference: string | null;
	converted_amount: number | null;
	conversion_status: ConversionStatus;
	gross_amount: number | null;
	tax_amount: number | null;
	tax_treatment: TaxTreatment;
	effective_tax_treatment: EffectiveTaxTreatment;
	tax_evidence_reference: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	vendor_name: string | null;
	description: string | null;
	financial_version: number;
	recognized_at: string | null;
	recognized_by: number | null;
	missing_amount: boolean;
	known_zero: boolean;
	exceptions: CostExceptionCode[];
}

export interface CostDrilldown {
	month: string;
	scope: 'month';
	total: number;
	limit: number;
	offset: number;
	records: CostRecordJson[];
	totals: {
		/** Null when confirmed amounts are unknown or span currencies. */
		confirmed_amount: number | null;
		/** The confirmed currency when the filtered records share one. */
		currency: string | null;
		records: number;
	};
}

/* ------------------------------------------------------------------------- *
 * Approved Project cost budgets
 *
 * A cost budget is its own record with its own identity and version history.
 * `projects.project_value`, `projects.cost_to_company`, `projects.budget`,
 * quotations, and purchase orders are commercial fields; none of them is read
 * as a cost budget. A budget is compared with Incurred Project Cost only when
 * Project, currency, scope, and period all match.
 * ------------------------------------------------------------------------- */

/**
 * What an approved budget is a budget *of*.
 *
 * `project_incurred_cost` is the comparable scope: the approved cost budget for
 * a Project's Incurred Project Cost. `commercial_value` records a commercial
 * figure for context; it is never compared as a cost budget and never enters a
 * cost total, so a sales value cannot masquerade as an approved cost budget.
 */
export type CostBudgetScope = 'project_incurred_cost' | 'commercial_value';

/** The scopes a budget can declare; anything else is refused. */
export const COST_BUDGET_SCOPES = [
	'project_incurred_cost',
	'commercial_value',
] as const;

export function isCostBudgetScope(value: unknown): value is CostBudgetScope {
	return (
		typeof value === 'string' &&
		(COST_BUDGET_SCOPES as readonly string[]).includes(value)
	);
}

/**
 * The budget lifecycle. Only `approved` is an approved cost budget; approving
 * a later overlapping budget marks the earlier row `superseded`, which keeps
 * its approval evidence, version, and journal.
 */
export type CostBudgetState =
	| 'draft'
	| 'submitted'
	| 'approved'
	| 'superseded'
	| 'withdrawn';

export type CostBudgetCommandName =
	| 'update'
	| 'submit'
	| 'approve'
	| 'withdraw';

/** The journal's vocabulary (`project_cost_budget_events.command`). */
export type CostBudgetJournalCommand =
	| 'recorded'
	| 'updated'
	| 'submitted'
	| 'approved'
	| 'withdrawn'
	| 'superseded';

/** One cost budget row as the module and its callers read it. */
export interface CostBudgetRecord {
	id: number;
	budget_uid: string;
	project_id: number;
	project_code: string;
	project_name: string;
	currency: string;
	amount: number;
	scope: CostBudgetScope;
	state: CostBudgetState;
	period_start: string;
	period_end: string;
	basis_note: string | null;
	/** The approval evidence; an approved row always carries one. */
	approval_evidence_reference: string | null;
	approved_by: number | null;
	approved_at: string | null;
	financial_version: number;
	created_by: number | null;
	created_at: string;
	updated_at: string;
}

/** The budget facts a comparison states, without the Project naming. */
export interface CostBudgetCandidate {
	budget_id: number;
	budget_uid: string;
	state: CostBudgetState;
	currency: string;
	scope: CostBudgetScope;
	amount: number;
	period_start: string;
	period_end: string;
	/** What the recorded basis says the approval covers. */
	basis_note: string | null;
	financial_version: number;
	approval_evidence_reference: string | null;
	approved_at: string | null;
}

/**
 * Why a Project row is or is not compared with a budget.
 *
 * `compared` is the only state that publishes a variance. Everything else is
 * explicit: a missing or unapproved budget, a budget whose currency, scope, or
 * period does not match, several matching budgets (so no single one can be
 * picked), an approved budget whose cost is not recognized yet, and an approved
 * budget with no Incurred Project Cost recorded beside it.
 */
export type BudgetOutcome =
	| 'compared'
	| 'missing'
	| 'unapproved'
	| 'incompatible_currency'
	| 'incompatible_scope'
	| 'incompatible_period'
	| 'ambiguous'
	| 'unsupported_incurred_cost'
	| 'no_incurred_cost';

/** One Project row (or one approved budget with no row) and its budget basis. */
export interface ProjectBudgetComparison {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	/** The row's currency. A comparison never crosses currencies. */
	currency: string;
	/**
	 * Confirmed Incurred Project Cost of this Project and currency, or null when
	 * no such row exists for the month (`no_incurred_cost`).
	 */
	incurred_cost: number | null;
	confirmed_records: number;
	/** Draft or pending-evidence records that are not confirmed cost. */
	pending_records: number;
	outcome: BudgetOutcome;
	/**
	 * The comparison basis: the approved budget the variance is stated from
	 * (`compared`), or the one a confirmed cost would be compared with
	 * (`unsupported_incurred_cost`). Null for every other outcome, whose
	 * detail names its `candidates` instead of implying an approved basis.
	 */
	budget: CostBudgetCandidate | null;
	/** Every budget of the Project that this month's reading considered. */
	candidates: CostBudgetCandidate[];
	/** Approved budget minus Incurred Project Cost; only when `compared`. */
	variance: number | null;
	over_budget: boolean | null;
	detail: string;
}

export interface BudgetSection {
	month: string;
	/** What a comparison is, and what it deliberately is not. */
	basis: string;
	/** Why a variance is not profit, revenue, or a forecast. */
	variance_note: string;
	comparisons: ProjectBudgetComparison[];
	notices: CoverageNotice[];
}

export interface CostBudgetPatch {
	currency?: string;
	amount?: number;
	scope?: CostBudgetScope;
	periodStart?: string;
	periodEnd?: string;
	basisNote?: string | null;
}

export interface RecordCostBudgetInput extends CostBudgetPatch {
	/** The Project the approved cost budget belongs to. */
	projectId: number;
}

export interface CostBudgetCommandInput {
	/** `project_cost_budgets.id` of the target budget. */
	id: number;
	command: CostBudgetCommandName;
	expectedVersion: number;
	reason?: string | null;
	/** Required for `approve`: the evidence the approval rests on. */
	evidenceReference?: string | null;
	/** Field changes for `update`. */
	patch?: CostBudgetPatch;
}

export interface CostBudgetCommandResult {
	id: number;
	budget_uid: string;
	state: CostBudgetState;
	financial_version: number;
	currency: string;
	amount: number;
	scope: CostBudgetScope;
	period_start: string;
	period_end: string;
	component: CostBudgetCommandName;
}

export interface CostBudgetJournalEntry {
	version: number;
	command: CostBudgetJournalCommand;
	actor_user_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
	created_at: string;
	snapshot: Record<string, unknown> | null;
}
