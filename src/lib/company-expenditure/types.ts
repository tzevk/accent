/**
 * Public types of the company expenditure module.
 *
 * The vocabulary follows GLOSSARY.md: Company Incurred Cost, Incurred Project
 * Cost, Company Overhead, Unallocated Cost, Cost Accrual, Cost identity,
 * Recognition Period, Recognition State.
 */

/** Where a recognized cost belongs. `null` is the explicit unresolved state. */
export type CostClassification = 'project' | 'company_overhead' | 'unallocated';

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
	| 'tax_evidence_missing'
	| 'tax_treatment_missing'
	| 'tax_treatment_unresolved'
	| 'classification_unresolved'
	| 'missing_recognition_period'
	| 'service_period_spans_months'
	| 'service_period_start_missing'
	| 'missing_source_reference'
	| 'missing_evidence_reference';

export interface CostFinancialInput {
	classification: CostClassification | null;
	state: RecognitionState;
	currency: string | null;
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
	record_count: number;
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
	known_zero: { count: number };
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
		/** Reporting currency when one currency covers the month, else null. */
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
	sources: ReconciliationSourceSummary[];
	coverage: CoverageNotice[];
	project_options: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	available_months: string[];
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
	/** Narrow to one cost source; 'all' (default) merges every source. */
	source?: CostSource | 'all';
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
	/** The service-period slice this record represents, or null. */
	split: CostSplitInfo | null;
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
