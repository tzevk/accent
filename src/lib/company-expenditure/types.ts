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

/**
 * What the spend is, independent of where it belongs (#317). `operating` is
 * ordinary cost; `advance`, `deposit`, `prepayment`, and `capital` are
 * balances whose payment is not an expense until supported period consumption,
 * depreciation, or amortization is approved. `unresolved` says the treatment
 * itself is not decided yet, so the amount is deliberately excluded from cost
 * and disclosed rather than guessed into operating cost.
 */
export type CostNature =
	| 'operating'
	| 'advance'
	| 'deposit'
	| 'prepayment'
	| 'capital'
	| 'unresolved';

/** Which approved basis a period charge draws down its source balance under. */
export type PeriodChargeBasis = 'consumption' | 'depreciation' | 'amortization';

export type PeriodChargeState = 'approved' | 'cancelled';

/**
 * Which native store a cost row lives in. IDs come from different stores, so
 * every cost carries its source discriminator; `cost_uid` stays the canonical
 * identity across all of them.
 */
export type CostSource =
	| 'direct_expense'
	| 'supplier_invoice'
	| 'other_expense'
	| 'petty_cash'
	| 'non_operating'
	| 'payroll';
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
	| 'missing_evidence_reference'
	/**
	 * The spend's nature (operating vs advance/deposit/prepayment/capital) is
	 * not decided, so the amount is excluded from cost until it is.
	 */
	| 'nature_unresolved';

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
	/** Approved period charges (#317) stated through their source's evidence. */
	converted_charges: number;
	unsupported_charges: number;
	/** Currencies with at least one confirmed record lacking matching evidence. */
	unsupported_currencies: string[];
	/** Confirmed records whose original currency is unknown. */
	unknown_currency_records: number;
}

export interface CostFinancialInput {
	classification: CostClassification | null;
	nature: CostNature;
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

/**
 * A period slice of a cost that spans several service periods (one supplier
 * invoice billed across months). The slices total the cost's own amount; the
 * slice is never a second cost.
 */
export interface CostSplitInfo {
	/** `supplier_invoice_periods.id`. */
	id: number;
	/** 1-based position within the cost's slices. */
	index: number;
	/** How many slices the cost has in total. */
	count: number;
}

/** One direct cost as the financial module sees it. */
export interface CostRecord extends CostFinancialInput {
	source: CostSource;
	/** The source row's own key as a string (`expenses.id`, a UUID, …). */
	sourceId: string;
	/** The service-period slice this record represents, or null. */
	split: CostSplitInfo | null;
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
	/** Approved period charges of this month counted into `incurred_cost`. */
	period_charge_amount: number;
	/** How many approved period charges that amount is made of. */
	period_charge_count: number;
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
	/** Approved period charges included in `incurred_cost` for this row. */
	period_charge_count: number;
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
	/** Confirmed operating cost records — the ones that carry cost. */
	recognized: EvidenceStateSummary;
	pending_evidence: EvidenceStateSummary;
	draft: EvidenceStateSummary;
	rejected: EvidenceStateSummary;
	cancelled: EvidenceStateSummary;
	/** Approved period charges counted as cost this month. */
	period_charges: EvidenceStateSummary;
	/** Recognized non-operating balances this month, excluded from cost. */
	non_operating_recognized: EvidenceStateSummary;
	/** Recognized records whose nature is unresolved, excluded from cost. */
	unresolved_nature: EvidenceStateSummary;
	unresolved_classification: {
		count: number;
		currency: string | null;
		gross_amount: number | null;
	};
	missing_amount: { count: number };
	missing_currency: { count: number };
	known_zero: { count: number };
}

/**
 * One approved (or cancelled) period charge, in the module's own shape: the
 * source balance it draws down plus the classification, project, and currency
 * the source carries. A charge never changes its source's identity; it is the
 * supported, evidenced consumption of that balance.
 */
export interface PeriodCharge {
	id: number;
	chargeUid: string;
	sourceId: number;
	sourceCostUid: string;
	sourceExpenseNumber: string;
	sourceNature: CostNature;
	sourceState: RecognitionState;
	classification: CostClassification | null;
	projectId: number | null;
	projectCode: string | null;
	projectName: string | null;
	clientName: string | null;
	currency: string;
	/** First day of the charge's month (`charge_period`). */
	period: string;
	basis: PeriodChargeBasis;
	amount: number;
	evidenceReference: string;
	state: PeriodChargeState;
	financialVersion: number;
	sequence: number;
	approvedBy: number | null;
	approvedAt: string | null;
	cancelReason: string | null;
	/** The source's confirmed balance, when it has one. */
	sourceRecognizedAmount: number | null;
	/**
	 * The source's conversion evidence (#319), inherited: a period charge is
	 * never converted independently, it is stated in the reporting basis
	 * through the evidence the cost it consumes carries.
	 */
	reportingCurrency: string | null;
	conversionRate: string | null;
	conversionDate: string | null;
	conversionEvidenceReference: string | null;
}

/** A period charge at the JSON boundary (routes, drilldown, report section). */
export interface PeriodChargeJson {
	charge_uid: string;
	source_cost_uid: string;
	source_expense_id: number;
	source_expense_number: string;
	cost_nature: CostNature;
	source_state: RecognitionState;
	cost_classification: CostClassification | null;
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	period: string;
	basis: PeriodChargeBasis;
	amount: number;
	currency: string;
	evidence_reference: string;
	state: PeriodChargeState;
	financial_version: number;
	sequence: number;
	approved_by: number | null;
	approved_at: string | null;
	cancel_reason: string | null;
	source_recognized_amount: number | null;
	/** The source's conversion evidence (#319), which the charge inherits. */
	source_reporting_currency: string | null;
	source_conversion_rate: string | null;
	source_conversion_date: string | null;
	source_conversion_evidence_reference: string | null;
}

/**
 * One non-operating item in the report: the source document's identity,
 * amount, currency/tax basis, and evidence, plus how much of its supported
 * balance is consumed and what remains.
 */
export interface NonOperatingItemJson {
	expense_id: number;
	cost_uid: string;
	expense_number: string;
	nature: CostNature;
	source_state: RecognitionState;
	cost_classification: CostClassification | null;
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	/**
	 * The item's original currency; null is unknown — never read as INR, so
	 * its figures are stated as unknown rather than attributed to one.
	 */
	currency: string | null;
	/** Gross liability of the source document. */
	gross_amount: number | null;
	/** The supported balance: the source's confirmed amount. */
	recognized_amount: number | null;
	recognition_period: string | null;
	period_basis: PeriodBasis;
	source_reference: string | null;
	evidence_reference: string | null;
	/** Approved charges dated in the reported month. */
	consumed_this_month: number;
	/** Approved charges dated in any period. */
	consumed_to_date: number;
	/** `recognized_amount − consumed_to_date`; null without a supported balance. */
	remaining_amount: number | null;
	/** This month's charges against this item, including cancelled history. */
	charges: PeriodChargeJson[];
}

/**
 * The non-operating half of the reconciliation. Amounts are stated in one
 * currency only; a month whose items span currencies states `currency: null`
 * rather than adding them.
 */
export interface NonOperatingSection {
	currency: string | null;
	/**
	 * Recognized non-operating source amounts of items recognized this month.
	 * None of this is Company Incurred Cost — only the charges are.
	 */
	excluded_source_amount: number | null;
	/** Approved charges dated in this month, counted as Company Incurred Cost. */
	consumed_this_month: number | null;
	/** Approved charges to date against this month's recognized sources. */
	consumed_to_date: number | null;
	/** `excluded_source_amount − consumed_to_date`. */
	remaining_amount: number | null;
	/** Items recorded this month but not approved: no supported balance yet. */
	unapproved_count: number;
	/** Recognized records this month whose treatment is unresolved. */
	unresolved_count: number;
	unresolved_source_amount: number | null;
	items: NonOperatingItemJson[];
	/** Approved charges this month whose source was recognized in another month. */
	charges_from_prior_items: PeriodChargeJson[];
}

/**
 * One cost source's slice of the month: recognized cost, cost awaiting
 * recognition, and records whose evidence is still unresolved. A reader can
 * see what each store contributes to the company total without re-adding it.
 */
export interface ReconciliationSourceSummary {
	source: CostSource;
	label: string;
	confirmed_count: number;
	/** Null when the source's confirmed rows span currencies or miss an amount. */
	confirmed_amount: number | null;
	currency: string | null;
	pending_count: number;
	pending_amount: number | null;
	unresolved_evidence_count: number;
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
	/**
	 * Advance, deposit, prepayment, capital, and unresolved-treatment items,
	 * shown separately from operating cost with their remaining balances.
	 */
	non_operating: NonOperatingSection;
	evidence: EvidenceSummary;
	sources: ReconciliationSourceSummary[];
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
	/** What the spend is (#317); a versioned financial field. */
	nature?: CostNature;
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
	cost_nature: CostNature;
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
	state?: RecognitionState | 'unconfirmed' | 'unresolved' | 'all';
	classification?: CostClassification | 'unresolved' | 'all';
	/**
	 * What the spend is. `non_operating` selects the advance/deposit/
	 * prepayment/capital rows; `unresolved` selects the undecided treatment.
	 */
	nature?: CostNature | 'non_operating' | 'all';
	projectId?: number | null;
	/** Narrow to one cost source; 'all' (default) merges every source. */
	source?: CostSource | 'all';
	/**
	 * The reporting basis the record's conversion status is stated in; absent
	 * means the company reporting currency. Status, label, and figures then
	 * share one basis, so a record's evidence is never mislabelled.
	 */
	reportingCurrency?: string | null;
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
	source: CostSource;
	/** The source row's own key as a string, for source-aware consumers. */
	source_id: string;
	/** The service-period slice this record represents, or null. */
	split: CostSplitInfo | null;
	expense_number: string;
	recognition_state: RecognitionState;
	cost_classification: CostClassification | null;
	cost_nature: CostNature;
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
	/**
	 * This record's evidence stated in the reporting basis the read was made
	 * with (`reporting_currency` on the drilldown query, INR absent):
	 * `reporting` when the record is already in that basis, `converted` when
	 * its stored target matches it with a full rate triple, else
	 * `unsupported`. The stored rate and `converted_amount` are only meaningful
	 * together with this basis — never relabel one basis's rate as another's.
	 */
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
	/**
	 * Every period charge dated in the month whose source matches the filter,
	 * approved or cancelled. Cancelled rows are history: only approved charges
	 * whose source is still confirmed cost are counted in `totals`.
	 */
	period_charges: PeriodChargeJson[];
	totals: {
		/** Operating confirmed cost; null when unknown or spanning currencies. */
		confirmed_amount: number | null;
		/** The confirmed currency when the filtered records share one. */
		currency: string | null;
		records: number;
		/** Recognized non-operating balances in the filtered records. */
		non_operating_amount: number | null;
		/** Recognized records whose nature is unresolved, excluded from cost. */
		nature_unresolved_amount: number | null;
		/** Approved period charges of the month counted as cost. */
		period_charge_amount: number | null;
		period_charge_records: number;
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
 * period does not match the month exactly, several matching budgets (so no
 * single one can be picked), an approved budget whose cost is not confirmed
 * yet, and an approved budget with no Incurred Project Cost recorded beside it.
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
	/** Confirmed operating direct records of this Project and currency. */
	confirmed_records: number;
	/**
	 * Approved period charges included in `incurred_cost` (#317): a row whose
	 * cost is entirely approved consumption is still confirmed cost.
	 */
	period_charges: number;
	/** Draft or pending-evidence operating records that are not confirmed cost. */
	pending_records: number;
	/**
	 * Supported approved period charges the row counts (#317). They are part of
	 * Incurred Project Cost, so a Project whose month is charge-only still
	 * supports a budget comparison.
	 */
	period_charges: number;
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
	/**
	 * Whether the caller holds the approval privilege. Withdrawing an *approved*
	 * budget stops the report comparing it, so it needs the privilege that
	 * approved it; the caller states the fact and the module enforces the rule
	 * under its row lock.
	 */
	actorCanApprove?: boolean;
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
