/**
 * The payload types the company expenditure view reads.
 *
 * Each interface states one block of a response. Where the domain module
 * already publishes the same shape, the type here extends it and keeps only
 * the members the view reads differently, so nothing is stated twice.
 */

import type {
	ComparisonCurrency,
	ComparisonDisclosure,
	CostDrilldown,
	CostRecordJson,
	CoverageNotice,
	CurrencyReporting,
	CurrencyTotal,
	EvidenceSummary,
	FilteredProjectSubtotal,
	NonOperatingItemJson,
	NonOperatingSection,
	OrderRecord,
	OrderValueTotal,
	PayrollDrilldown,
	PayrollEmployeeCost,
	PayrollExpenditure,
	PayrollProjectShare,
	PayrollReconstructionSummary,
	PeriodChargeJson,
	PeriodComparison,
	ProjectEvidenceState,
	ProjectRanking,
	RankingEntry,
	ReconciliationProjectRow,
	SupplierCommitmentSection,
} from '@/lib/company-expenditure';
import type {
	EvidenceStateSummary,
	ReconciliationGroup,
} from '@/lib/company-expenditure/types';
import type { BudgetSectionPayload } from './budget-section';
import type { CashSectionPayload } from './cash-section';

export interface ClientOrderRow extends Omit<
	OrderRecord,
	'direction' | 'status' | 'clientInvoicedValue' | 'clientRemainingValue'
> {
	direction: string;
	status: string;
	clientInvoicedValue?: number | null;
	clientRemainingValue?: number | null;
}

export interface ClientOrderTotalRow extends Omit<
	OrderValueTotal,
	'direction'
> {
	direction: string;
}

export interface GroupRow extends Omit<ReconciliationGroup, 'key'> {
	key: string;
}

export type CurrencyReportingRow = CurrencyReporting;

export interface CurrencyTotalRow extends CurrencyTotal {
	reporting: CurrencyReportingRow;
}

export interface ProjectRow extends Omit<
	ReconciliationProjectRow,
	'change_state' | 'evidence'
> {
	change_state: string;
	evidence: ProjectEvidenceRow;
}

export interface ProjectEvidenceRow extends Omit<
	ProjectEvidenceState,
	'state'
> {
	state: string;
}

export interface ComparisonCurrencyRow extends Omit<
	ComparisonCurrency,
	'groups' | 'change_state'
> {
	groups: GroupRow[];
	change_state: string;
}

export interface ComparisonDisclosureRow extends Omit<
	ComparisonDisclosure,
	'code' | 'severity' | 'period'
> {
	code: string;
	severity: string;
	period: string | null;
}

export interface ComparisonPayload extends Omit<
	PeriodComparison,
	'basis' | 'change_state' | 'currency_totals' | 'disclosures'
> {
	basis: string;
	change_state: string;
	currency_totals: ComparisonCurrencyRow[];
	disclosures: ComparisonDisclosureRow[];
}

export type RankingEntryRow = Pick<
	RankingEntry,
	'project_id' | 'currency' | 'rank'
>;

export interface RankingPayload extends Omit<
	ProjectRanking,
	'by_cost' | 'by_increase' | 'increase_unranked'
> {
	by_cost: RankingEntryRow[];
	by_increase: RankingEntryRow[];
	increase_unranked: Array<{
		project_id: number;
		currency: string;
		reason: string;
		detail: string;
	}>;
}

export interface PayrollShareRow extends Omit<PayrollProjectShare, 'basis'> {
	basis: string;
}

export interface PayrollReconstructionRow extends Omit<
	PayrollReconstructionSummary,
	'status' | 'missing_evidence' | 'shares'
> {
	status: string;
	missing_evidence: Array<{ code: string; detail: string }>;
	shares: PayrollShareRow[];
}

export interface PayrollEmployeeRow extends Omit<
	PayrollEmployeeCost,
	'pay_stream' | 'status' | 'source' | 'shares' | 'reconstruction'
> {
	pay_stream: string;
	status: string;
	source: {
		payroll_slip_id: number | null;
		allocation_id: number | null;
		allocation_version: number | null;
		allocation_kind: string | null;
		month: string;
	};
	shares: PayrollShareRow[];
	/** #308: the slip's latest reconstruction proposal, or null. */
	reconstruction: PayrollReconstructionRow | null;
}

export type PayrollSummaryRow = PayrollExpenditure;

export interface PayrollDrilldownPayload extends Omit<
	PayrollDrilldown,
	'employees' | 'coverage'
> {
	totals: PayrollSummaryRow;
	employees: PayrollEmployeeRow[];
	coverage: CoverageNoticeRow[];
}

export type EvidenceRow = EvidenceStateSummary;

export interface CoverageNoticeRow extends Omit<CoverageNotice, 'severity'> {
	severity: string;
}

/** One non-operating item with its balance, consumption, and charges (#317). */
export interface NonOperatingItemRow extends Omit<
	NonOperatingItemJson,
	'nature' | 'source_state' | 'cost_classification' | 'period_basis'
> {
	nature: string;
	source_state: string;
	cost_classification: string | null;
	period_basis: string;
}

export interface NonOperatingSectionRow extends Omit<
	NonOperatingSection,
	'items'
> {
	items: NonOperatingItemRow[];
}

export interface ReconciliationPayload {
	month: string;
	month_label: string;
	project_id: number | null;
	current_month: string;
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
		currency_totals: CurrencyTotalRow[];
		groups: GroupRow[];
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
	projects: ProjectRow[];
	non_operating: NonOperatingSectionRow;
	/** Outstanding Supplier Commitment (#312), outside incurred cost. */
	supplier_commitment: SupplierCommitmentSection;
	comparison: ComparisonPayload;
	ranking: RankingPayload;
	filtered_subtotal: FilteredProjectSubtotal | null;
	evidence: EvidenceSummary;
	coverage: CoverageNoticeRow[];
	payroll: PayrollSummaryRow;
	petty_cash: {
		month: string | null;
		currency: string | null;
		funding: number | null;
		spend: number | null;
		remaining_funding: number | null;
		recognized_cost: number | null;
		by_currency: Array<{
			currency: string;
			funding: number;
			spend: number;
			funded_spend: number;
			settled_spend: number;
			remaining_funding: number;
			recognized_cost: number;
			unconfirmed_spend: number;
		}>;
		unresolved_settlements: { count: number; amount: number | null };
		unlinked_spend: { count: number; amount: number | null };
		unknown_currency: { count: number };
	};
	budgets: BudgetSectionPayload;
	/** Dated outward cash paid (#318), outside incurred cost. */
	cash: CashSectionPayload;
	project_options: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	available_months: string[];
}

export interface DrilldownPayload extends Omit<CostDrilldown, 'scope'> {
	scope: string;
	records: CostRecordJson[];
	period_charges: PeriodChargeJson[];
}
