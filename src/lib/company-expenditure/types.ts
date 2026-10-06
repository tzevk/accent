/**
 * Public types of the company expenditure module.
 *
 * The vocabulary follows GLOSSARY.md: Company Incurred Cost, Incurred Project
 * Cost, Company Overhead, Unallocated Cost, Cost Accrual, Cost identity,
 * Recognition Period, Recognition State.
 */

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

/** One direct cost as the financial module sees it. */
export interface CostRecord extends CostFinancialInput {
	id: number;
	costUid: string | null;
	expenseNumber: string;
	expenseDate: string | null;
	/** When the record entered the system: late and backdated disclosure. */
	createdAt: string | null;
	vendorName: string | null;
	description: string | null;
	projectId: number | null;
	projectCode: string | null;
	projectName: string | null;
	clientName: string | null;
	financialVersion: number;
	recognizedAt: string | null;
	recognizedBy: number | null;
	/**
	 * Set by a source adapter whose cost was reconstructed rather than
	 * originally snapshotted (#307 payroll allocations). Absent means no.
	 */
	reconstructed?: boolean;
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

/** One row per (Project, currency): how its month compares with the prior period. */
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
	/** Confirmed cost of the whole reported month, in this row's currency. */
	incurred_cost: number;
	record_count: number;
	/**
	 * Cost recorded against the project but not yet confirmed, in this row's
	 * currency; null when a contributing record has no amount (unknown, not
	 * zero).
	 */
	not_confirmed_cost: number | null;
	/**
	 * Confirmed cost inside the comparable window of the reported month. It
	 * equals `incurred_cost` for a month that has fully elapsed.
	 */
	comparison_cost: number;
	/**
	 * The prior period's comparable cost, in this row's currency. Null when the
	 * Project has no recorded cost in that window: absence of records is not
	 * evidence of zero cost, so the prior amount stays unknown.
	 */
	previous_period_cost: number | null;
	change_amount: number | null;
	/** Percentage of a known non-zero prior amount; null for zero or unknown. */
	change_percent: number | null;
	change_state: ChangeState;
	/** Cumulative confirmed cost through the window's last day. */
	cost_to_date: number | null;
	/** Cost in the window entered into the system after the window closed. */
	late_entry: { count: number; amount: number | null } | null;
	/** What the row's figures rest on: recorded, estimated, reconstructed, incomplete. */
	evidence: ProjectEvidenceState;
}

/** Ordering of one amount against its comparable prior period. */
export type ChangeState =
	| 'no_prior'
	| 'new'
	| 'increase'
	| 'decrease'
	| 'unchanged';

/** How the reported window was bounded. */
export type ComparisonBasis = 'equal_period' | 'full_month';

/** One currency's company figures over the comparable period. */
export interface ComparisonCurrency {
	currency: string;
	/** Company Incurred Cost inside the reported window. */
	current_cost: number;
	/** The prior window's cost; null when that currency has no prior records. */
	prior_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	change_state: ChangeState;
	/** The window's own direct-cost categories, each counted once. */
	groups: ReconciliationGroup[];
	/** Window records counted without day-level service evidence. */
	undated_records: number;
	/** Window records entered after the window closed. */
	late_records: number;
	late_cost: number;
	/** Prior-window records entered after that window closed. */
	prior_late_records: number;
	prior_late_cost: number;
}

/** Something the comparison does or does not cover, stated with its figures. */
export interface ComparisonDisclosure {
	code:
		| 'equal_period_comparison'
		| 'full_month_comparison'
		| 'unequal_window_length'
		| 'late_recorded_cost'
		| 'backdated_recognition'
		| 'undated_period_evidence'
		| 'unequal_evidence_coverage'
		| 'unknown_prior_cost'
		| 'zero_prior_cost'
		| 'no_prior_period_evidence';
	label: string;
	detail: string;
	severity: CoverageSeverity;
	/** Which period the finding belongs to; null when it spans both. */
	period: 'current' | 'prior' | null;
	/** The one currency the finding's amount is stated in, else null. */
	currency: string | null;
	count: number;
	amount: number | null;
}

/**
 * The reported month against its comparable period. An unfinished month is
 * compared over equivalent elapsed service periods; a month that has fully
 * elapsed is compared in full.
 */
export interface PeriodComparison {
	month: string;
	/** The date the month is measured to: today, or a requested as-of date. */
	as_of: string;
	prior_month: string;
	prior_month_label: string;
	basis: ComparisonBasis;
	unfinished: boolean;
	/** Days the reported month has elapsed; null when the whole month is in. */
	elapsed_days: number | null;
	current_days: number;
	prior_days: number;
	/** True when the prior month is shorter than the reported window. */
	window_mismatch: boolean;
	/** The one currency both totals are stated in, else null. */
	currency: string | null;
	current_cost: number | null;
	prior_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	/**
	 * `no_prior` also covers a scope whose comparison cannot be stated at all
	 * (more than one currency without a supported conversion); the per-currency
	 * figures carry the real states.
	 */
	change_state: ChangeState;
	currency_totals: ComparisonCurrency[];
	/** Date Cost to date is cumulative through (the window's last day). */
	cost_to_date_through: string;
	disclosures: ComparisonDisclosure[];
}

/** What one Project's figures rest on, from the evidence its records carry. */
export interface ProjectEvidenceState {
	state: 'recorded' | 'estimated' | 'reconstructed' | 'incomplete';
	/** Every finding behind the state, disclosed. */
	findings: string[];
	confirmed_records: number;
	/** Records recorded against the Project but not yet confirmed. */
	estimated_records: number;
	/** Open or confirmed records with no amount: unknown, not zero. */
	unknown_amount_records: number;
	/** Confirmed records whose tax treatment is not settled. */
	unresolved_tax_records: number;
	/** Confirmed records counted from the disclosed bill-date fallback. */
	bill_date_fallback_records: number;
	/**
	 * Records a source module marked as reconstructed rather than originally
	 * snapshotted. Zero until a source (#307 payroll allocations) says otherwise.
	 */
	reconstructed_records: number;
}

/** One Project's position in an ordering. */
export interface RankingEntry {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	currency: string;
	/** Position inside the entry's currency; ties share a position. */
	rank: number;
	incurred_cost: number;
	comparison_cost: number;
	previous_period_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	change_state: ChangeState;
}

/** Largest-cost and largest-increase orderings, never mixing currencies. */
export interface ProjectRanking {
	by_cost: RankingEntry[];
	by_increase: RankingEntry[];
	/** Rows the increase ordering cannot place, with the reason why. */
	increase_unranked: Array<{
		project_id: number;
		currency: string;
		reason: 'unknown_prior';
		detail: string;
	}>;
	currencies: string[];
}

/** The filtered Project detail's own subtotal — never the company figure. */
export interface FilteredProjectSubtotal {
	project_id: number;
	currency_totals: Array<{
		currency: string;
		incurred_cost: number;
		comparison_cost: number;
		cost_to_date: number | null;
	}>;
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

export interface CompanyReconciliation {
	month: string;
	month_label: string;
	project_id: number | null;
	/** The server's current calendar month: the month the report opens on. */
	current_month: string;
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
	/** The reported month against its comparable prior period. */
	comparison: PeriodComparison;
	/** Largest-cost and largest-increase orderings of `projects`. */
	ranking: ProjectRanking;
	/**
	 * The filtered Project detail's subtotal, present only when a filter is
	 * applied; the company reconciliation above is never narrowed by it.
	 */
	filtered_subtotal: FilteredProjectSubtotal | null;
	evidence: EvidenceSummary;
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
	/** When the record entered the system; late and backdated disclosure. */
	created_at: string | null;
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
	/** True when a source module reconstructed this cost rather than snapshotting it. */
	reconstructed: boolean;
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
