'use client';

/**
 * Company expenditure view of the Employee Project Monthly Cost report.
 *
 * Leads with Company Incurred Cost and reconciles it to Incurred Project Cost,
 * Company Overhead, and Unallocated Cost, each direct cost counted once. It is
 * also the entry and recognition surface for direct cost: record a cost,
 * submit it for recognition, and confirm it with an explicit, reasoned
 * command. Coverage notices state what the total does not include yet, and
 * nothing here invents a figure the sources do not support.
 *
 * Data comes from `/api/reports/employee-project-monthly-cost?view=expenditure`
 * (reconciliation), `.../expenses` (drilldown and review queue),
 * `POST /api/admin/expenses` (entry),
 * `POST /api/admin/expenses/{id}/commands` (versioned recognition commands),
 * and `POST /api/admin/expenses/{id}/charges[/{chargeUid}]` (approved period
 * consumption of a non-operating balance, #317).
 */

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	BanknotesIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ExclamationTriangleIcon,
	InformationCircleIcon,
	PlusIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate, formatNumber } from '@/lib/format';
// The financial-year vocabulary is pure calendar arithmetic, so the view takes
// it from the same module the report uses instead of a second copy here; the
// barrel is avoided because it also opens the database pool (server only).
import {
	financialYearLabel,
	financialYearOf,
} from '@/lib/company-expenditure/ranking';
import type {
	ClosePayload,
	CostNature,
	CostRecordJson,
	PeriodChargeJson,
	SupplierCommitmentSection,
} from '@/lib/company-expenditure';
import BudgetSection, { type BudgetSectionPayload } from './budget-section';
import CashSection, { type CashSectionPayload } from './cash-section';
import CloseSection from './close-section';

interface GroupRow {
	key: string;
	label: string;
	amount: number;
	record_count: number;
}

interface CurrencyReportingRow {
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

interface CurrencyTotalRow {
	currency: string;
	incurred_project_cost: number;
	company_overhead: number;
	unallocated_cost: number;
	incurred_cost: number;
	gross_liability: number;
	recoverable_tax: number;
	unresolved_tax_gross: number;
	period_charge_amount: number;
	period_charge_count: number;
	record_count: number;
	reporting: CurrencyReportingRow;
}

interface ProjectRow {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	currency: string;
	conversion_status: 'reporting' | 'converted' | 'unsupported';
	converted_incurred_cost: number | null;
	incurred_cost: number;
	record_count: number;
	period_charge_count: number;
	not_confirmed_cost: number | null;
	comparison_cost: number;
	previous_period_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	change_state: string;
	cost_to_date: number | null;
	late_entry: { count: number; amount: number | null } | null;
	evidence: ProjectEvidenceRow;
	/** Recorded employee cost allocated to this Project (#307, ADR-0016). */
	employee_cost: number;
	estimated_employee_cost: number;
	logged_hours: number;
	employee_count: number;
}

interface ProjectEvidenceRow {
	state: string;
	findings: string[];
	confirmed_records: number;
	estimated_records: number;
	unknown_amount_records: number;
	unresolved_tax_records: number;
	bill_date_fallback_records: number;
	reconstructed_records: number;
}

interface ComparisonCurrencyRow {
	currency: string;
	current_cost: number;
	prior_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	change_state: string;
	groups: Array<{
		key: string;
		label: string;
		amount: number;
		record_count: number;
	}>;
	undated_records: number;
	late_records: number;
	late_cost: number;
	prior_late_records: number;
	prior_late_cost: number;
	/** Day-less monthly cost the elapsed window cannot place. */
	dayless_records: number;
	dayless_cost: number;
}

interface ComparisonDisclosureRow {
	code: string;
	label: string;
	detail: string;
	severity: string;
	period: string | null;
	currency: string | null;
	count: number;
	amount: number | null;
}

interface ComparisonPayload {
	month: string;
	as_of: string;
	prior_month: string;
	prior_month_label: string;
	basis: string;
	unfinished: boolean;
	elapsed_days: number | null;
	current_days: number;
	prior_days: number;
	window_mismatch: boolean;
	currency: string | null;
	current_cost: number | null;
	prior_cost: number | null;
	change_amount: number | null;
	change_percent: number | null;
	change_state: string;
	currency_totals: ComparisonCurrencyRow[];
	cost_to_date_through: string;
	disclosures: ComparisonDisclosureRow[];
}

interface RankingEntryRow {
	project_id: number;
	currency: string;
	rank: number;
}

interface RankingPayload {
	by_cost: RankingEntryRow[];
	by_increase: RankingEntryRow[];
	increase_unranked: Array<{
		project_id: number;
		currency: string;
		reason: string;
		detail: string;
	}>;
	currencies: string[];
}

interface PayrollShareRow {
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	hours: number;
	amount: number;
	rounding_adjustment: number;
	basis: string;
}

interface PayrollReconstructionRow {
	proposal_uid: string;
	financial_version: number;
	status: string;
	recorded_employer_cost: number;
	currency: string;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	missing_evidence: Array<{ code: string; detail: string }>;
	proposed_by_name: string | null;
	proposed_at: string | null;
	reviewed_by_name: string | null;
	reviewed_at: string | null;
	review_reason: string | null;
	evidence_reference: string | null;
	shares: PayrollShareRow[];
}

interface PayrollEmployeeRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	pay_stream: string;
	status: string;
	recorded_amount: number | null;
	estimated_amount: number | null;
	logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	no_logged_hours: boolean;
	missing_slip: boolean;
	missing_pricing: boolean;
	allocation_missing: boolean;
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

interface PayrollSummaryRow {
	currency: string;
	recorded_total: number;
	estimated_total: number;
	allocated_total: number;
	unallocated_total: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	recorded_count: number;
	known_zero_count: number;
	estimated_count: number;
	missing_slip_count: number;
	missing_pricing_count: number;
	allocation_missing_count: number;
}

interface PayrollDrilldownPayload {
	month: string;
	month_label: string;
	currency: string;
	totals: PayrollSummaryRow;
	employees: PayrollEmployeeRow[];
	coverage: CoverageNoticeRow[];
}

interface EvidenceRow {
	count: number;
	currency: string | null;
	amount: number | null;
}

interface CoverageNoticeRow {
	code: string;
	label: string;
	detail: string;
	severity: string;
}

/** One non-operating item with its balance, consumption, and charges (#317). */
interface NonOperatingItemRow {
	expense_id: number;
	cost_uid: string;
	expense_number: string;
	nature: string;
	source_state: string;
	cost_classification: string | null;
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	currency: string | null;
	gross_amount: number | null;
	recognized_amount: number | null;
	recognition_period: string | null;
	period_basis: string;
	source_reference: string | null;
	evidence_reference: string | null;
	consumed_this_month: number;
	consumed_to_date: number;
	remaining_amount: number | null;
	charges: PeriodChargeJson[];
}

interface NonOperatingSectionRow {
	currency: string | null;
	excluded_source_amount: number | null;
	consumed_this_month: number | null;
	consumed_to_date: number | null;
	remaining_amount: number | null;
	unapproved_count: number;
	unresolved_count: number;
	unresolved_source_amount: number | null;
	items: NonOperatingItemRow[];
	charges_from_prior_items: PeriodChargeJson[];
}

interface ReconciliationPayload {
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
	filtered_subtotal: {
		project_id: number;
		currency_totals: Array<{
			currency: string;
			incurred_cost: number;
			comparison_cost: number;
			cost_to_date: number | null;
		}>;
	} | null;
	evidence: {
		recognized: EvidenceRow;
		pending_evidence: EvidenceRow;
		draft: EvidenceRow;
		rejected: EvidenceRow;
		cancelled: EvidenceRow;
		period_charges: EvidenceRow;
		non_operating_recognized: EvidenceRow;
		unresolved_nature: EvidenceRow;
		unresolved_classification: {
			count: number;
			currency: string | null;
			gross_amount: number | null;
		};
		missing_amount: { count: number };
		missing_currency: { count: number };
		known_zero: { count: number };
	};
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

interface DrilldownPayload {
	month: string;
	scope: string;
	total: number;
	records: CostRecordJson[];
	period_charges: PeriodChargeJson[];
	totals: {
		confirmed_amount: number | null;
		currency: string | null;
		records: number;
		non_operating_amount: number | null;
		nature_unresolved_amount: number | null;
		period_charge_amount: number | null;
		period_charge_records: number;
	};
}

export interface ExpenditureViewProps {
	month: string;
	monthOptions: Array<{ value: string; label: string }>;
	onMonthChange: (month: string) => void;
	/** `other_expenses:create` — may record and submit a cost. */
	canRecord: boolean;
	/** `other_expenses:update` — may correct an open cost through `update`. */
	canEditCost: boolean;
	/** `other_expenses:approve` — may recognize, reject, or cancel a cost. */
	canRecognize: boolean;
	/**
	 * #308: the financial read gate (`reports:read` + `other_expenses:read` +
	 * `payroll:read`, or super admin) **and** `other_expenses:update` — may
	 * propose a historical allocation reconstruction.
	 */
	canProposeReconstruction: boolean;
	/**
	 * #308: the financial read gate **and** `other_expenses:approve` — may
	 * approve or reject a reconstruction proposal.
	 */
	canReviewReconstruction: boolean;
	/**
	 * Financial read gate + `payroll:update` — may revise a finalized Payroll
	 * Slip's Project cost allocation (#309). The server enforces the same
	 * conjunction regardless of what renders.
	 */
	canRevise: boolean;
	/**
	 * Financial read gate + `other_expenses:update` — may record an outward
	 * cash settlement (#318). The server enforces the same conjunction
	 * regardless of what renders.
	 */
	canRecordSettlement: boolean;
	/** Financial read gate + `other_expenses:update` — may close the month. */
	canCloseMonth: boolean;
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

/** How the Recognition Period was established, in the reader's words. */
const PERIOD_BASIS_LABELS: Record<string, string> = {
	service_period: 'service period',
	service_period_end: 'service period end (start not recorded)',
	bill_date_fallback: 'bill date fallback',
	unresolved: 'unresolved',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
	project: 'Project',
	company_overhead: 'Company Overhead',
	unallocated: 'Unallocated Cost',
};

/**
 * Where a cost from another source register is reviewed. Its approval lives in
 * that register's own controls (a versioned `financial_version` + journal like
 * this one), so the report must not send its row-level commands to the direct
 * expense path.
 */
const SOURCE_REGISTER_LABELS: Record<string, string> = {
	other_expense: 'Recognized in the Other Expense register',
	supplier_invoice: 'Recognized in the Purchase Invoice register',
	petty_cash: 'Recognized in the Petty Cash register',
	non_operating: 'Recognized in the period-charge workflow',
	payroll: 'Finalized with payroll',
};

const SOURCE_REGISTER_LINKS: Record<string, string> = {
	other_expense: '/admin/other-expenses',
};

/** What the spend is (#317), in the reader's words. */
const NATURE_LABELS: Record<string, string> = {
	operating: 'Operating cost',
	advance: 'Advance',
	deposit: 'Deposit',
	prepayment: 'Prepayment',
	capital: 'Capital item',
	unresolved: 'Treatment unresolved',
};

const CHARGE_BASIS_LABELS: Record<string, string> = {
	consumption: 'Consumption',
	depreciation: 'Depreciation',
	amortization: 'Amortization',
};

/** Natures whose balance is consumed by approved period charges. */
const CONSUMABLE_NATURES = ['advance', 'deposit', 'prepayment', 'capital'];

const NATURE_OPTIONS: ReadonlyArray<{ value: CostNature; label: string }> = [
	{ value: 'operating', label: 'Operating cost' },
	{ value: 'advance', label: 'Advance (balance, not cost)' },
	{ value: 'deposit', label: 'Deposit (balance, not cost)' },
	{ value: 'prepayment', label: 'Prepayment (balance, not cost)' },
	{ value: 'capital', label: 'Capital item (balance, not cost)' },
	{ value: 'unresolved', label: 'Treatment unresolved (excluded)' },
];

/** The select's exact vocabulary, for narrowing a DOM string to `CostNature`. */
const NATURE_VALUES: readonly string[] = NATURE_OPTIONS.map(
	(option) => option.value
);

function isCostNature(value: string): value is CostNature {
	return NATURE_VALUES.includes(value);
}

const CHANGE_LABELS: Record<string, string> = {
	no_prior: 'No prior month',
	new: 'New cost',
	increase: 'Increase',
	decrease: 'Decrease',
	unchanged: 'No change',
	unproven: 'Window membership unproven',
};

/** What the row's figures rest on, in the reader's words. */
const EVIDENCE_LABELS: Record<string, string> = {
	recorded: 'Recorded',
	estimated: 'Estimated',
	reconstructed: 'Reconstructed',
	incomplete: 'Incomplete evidence',
};

/** The findings behind an evidence state, in the reader's words. */
const EVIDENCE_FINDING_LABELS: Record<string, string> = {
	open_records: 'not yet confirmed',
	unknown_amount: 'amount unknown',
	bill_date_fallback: 'bill-date period',
	partial_service_period: 'period end only',
	unresolved_tax: 'tax unresolved',
	reconstructed: 'reconstructed',
};

/**
 * A change stated as a percentage only when one is supported: a known zero
 * prior is a new cost, and an unknown prior amount stays unknown. No figure is
 * invented for either.
 */
function percentLabel(percent: number | null, state: string): string {
	if (percent !== null) return `${percent.toFixed(2)}%`;
	if (state === 'new') return 'New cost, no percentage';
	if (state === 'no_prior') return 'Prior amount unknown';
	return CHANGE_LABELS[state] ?? state;
}

/** Position of each row in an ordering, keyed by Project and currency. */
function rankMap(
	entries: Array<{ project_id: number; currency: string; rank: number }>
): Map<string, number> {
	return new Map(
		entries.map((entry) => [
			`${entry.project_id}:${entry.currency}`,
			entry.rank,
		])
	);
}

/** How an employee's cost is known (#307). */
const PAYROLL_STATUS_LABELS: Record<string, string> = {
	recorded: 'Recorded',
	estimated: 'Estimated',
	known_zero: 'Known zero',
	unknown: 'Unknown pricing',
};
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong';
}

/** Money whose original currency is unknown is never labelled as INR. */
function formatSourceMoney(
	value: number | null,
	currency: string | null
): string {
	if (value === null) return '—';
	return currency === null
		? `${formatNumber(value)} (currency unknown)`
		: formatCurrencyIn(value, currency);
}

export default function ExpenditureView({
	month,
	monthOptions,
	onMonthChange,
	canRecord,
	canEditCost,
	canRecognize,
	canProposeReconstruction,
	canReviewReconstruction,
	canRevise,
	canRecordSettlement,
	canCloseMonth,
}: ExpenditureViewProps) {
	const queryClient = useQueryClient();
	const [projectFilter, setProjectFilter] = useState('all');
	const [reportingCurrency, setReportingCurrency] = useState('INR');
	const [expandedProject, setExpandedProject] = useState<number | null>(null);
	const [formOpen, setFormOpen] = useState(false);
	const [rankingMode, setRankingMode] = useState<'cost' | 'increase'>('cost');
	const [editTarget, setEditTarget] = useState<CostRecordJson | null>(null);
	const [commandTarget, setCommandTarget] = useState<{
		record: CostRecordJson;
		command: 'recognize' | 'reject' | 'cancel';
	} | null>(null);
	const [expandedEmployee, setExpandedEmployee] = useState<number | null>(null);
	const [reconstructionReason, setReconstructionReason] = useState('');
	const [chargeTarget, setChargeTarget] = useState<NonOperatingItemRow | null>(
		null
	);
	const [cancelChargeTarget, setCancelChargeTarget] =
		useState<PeriodChargeJson | null>(null);

	const reconciliationQuery = useQuery<{
		data: ReconciliationPayload;
		close?: ClosePayload | null;
	}>({
		queryKey: ['expenditure', month, projectFilter, reportingCurrency],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost', {
				view: 'expenditure',
				month,
				project_id: projectFilter === 'all' ? undefined : projectFilter,
				reporting_currency: reportingCurrency,
			}),
		enabled: !!month,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const queueQuery = useQuery<{ data: DrilldownPayload }>({
		queryKey: ['expenditure-queue', month, reportingCurrency],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/expenses', {
				month,
				state: 'unconfirmed',
				reporting_currency: reportingCurrency,
			}),
		enabled: !!month,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const drilldownQuery = useQuery<{ data: DrilldownPayload }>({
		queryKey: [
			'expenditure-drilldown',
			month,
			expandedProject,
			reportingCurrency,
		],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/expenses', {
				month,
				state: 'recognized',
				project_id: expandedProject ?? undefined,
				reporting_currency: reportingCurrency,
			}),
		enabled: expandedProject !== null,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	// The same Project's unresolved evidence: what is recorded but not yet
	// confirmed, with the reason it is not in the figures above.
	const evidenceQuery = useQuery<{ data: DrilldownPayload }>({
		queryKey: ['expenditure-unconfirmed', month, expandedProject],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/expenses', {
				month,
				state: 'unconfirmed',
				project_id: expandedProject ?? undefined,
			}),
		enabled: expandedProject !== null,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});
	// The employee-cost drilldown loads with the payroll section; the summary
	// itself already rides the reconciliation payload.
	const payrollQuery = useQuery<{ data: PayrollDrilldownPayload }>({
		queryKey: ['expenditure-payroll', month],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/payroll', {
				month,
			}),
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});
	const payrollEmployees = payrollQuery.data?.data.employees ?? [];

	// #308: reconstruction commands ride the report's own routes. The server
	// enforces the financial read gate + operation privilege; the controls
	// below render only under the same conjunction.
	const proposeReconstruction = useMutation({
		mutationFn: (slipId: number) =>
			apiPost(
				'/api/reports/employee-project-monthly-cost/payroll/reconstruction',
				{ month, payroll_slip_id: slipId }
			),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-payroll', month],
			});
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		},
	});
	const reviewReconstruction = useMutation({
		mutationFn: (input: {
			proposalUid: string;
			command: 'approve' | 'reject';
			expectedVersion: number;
			reason?: string;
		}) =>
			apiPost(
				`/api/reports/employee-project-monthly-cost/payroll/reconstruction/${input.proposalUid}`,
				{
					command: input.command,
					expected_version: input.expectedVersion,
					reason: input.reason || undefined,
				}
			),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-payroll', month],
			});
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		},
	});
	const reconstructionError =
		proposeReconstruction.error ?? reviewReconstruction.error;

	const data = reconciliationQuery.data?.data ?? null;
	const queue = queueQuery.data?.data?.records ?? [];

	// The command dialog opens from a queue-row snapshot, but the row can
	// move under it: saving the pending-cost correction (update) bumps
	// financial_version and the queue refetch lands after the dialog opens.
	// Confirming with the snapshot version then fails with a stale
	// version_conflict even though the operator just made that edit. Resolve
	// the record the queue holds now, so the command states the version the
	// operator sees; a genuine concurrent change still refuses with 409, stays
	// open, and surfaces the refusal inline.
	const liveCommandRecord = commandTarget
		? (queue.find(
				(record) =>
					record.id === commandTarget.record.id &&
					record.source === commandTarget.record.source &&
					(record.split?.id ?? 0) === (commandTarget.record.split?.id ?? 0)
			) ?? commandTarget.record)
		: null;

	const commandMutation = useMutation({
		mutationFn: (input: {
			id: number;
			command: string;
			expectedVersion: number;
			reason?: string;
			patch?: Record<string, unknown>;
		}) =>
			apiPost(`/api/admin/expenses/${input.id}/commands`, {
				command: input.command,
				expected_version: input.expectedVersion,
				reason: input.reason,
				patch: input.patch,
			}),
		onSuccess: () => {
			setCommandTarget(null);
			setEditTarget(null);
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
			void queryClient.invalidateQueries({ queryKey: ['expenditure-queue'] });
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-drilldown'],
			});
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-unconfirmed'],
			});
		},
	});

	const createMutation = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			apiPost('/api/admin/expenses', payload),
		onSuccess: () => {
			setFormOpen(false);
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
			void queryClient.invalidateQueries({ queryKey: ['expenditure-queue'] });
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-unconfirmed'],
			});
		},
	});

	// Period consumption is an approval (#317): it joins the same
	// invalidation path as the recognition commands, so the reconciliation,
	// the queue, and the drilldown all read the post-charge truth.
	const chargeMutation = useMutation({
		mutationFn: (input: {
			sourceId: number;
			payload: Record<string, unknown>;
		}) =>
			apiPost(`/api/admin/expenses/${input.sourceId}/charges`, input.payload),
		onSuccess: () => {
			setChargeTarget(null);
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
			void queryClient.invalidateQueries({ queryKey: ['expenditure-queue'] });
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-drilldown'],
			});
		},
	});

	const cancelChargeMutation = useMutation({
		mutationFn: (input: {
			sourceId: number;
			chargeUid: string;
			expectedVersion: number;
			reason: string;
		}) =>
			apiPost(
				`/api/admin/expenses/${input.sourceId}/charges/${input.chargeUid}`,
				{
					command: 'cancel',
					expected_version: input.expectedVersion,
					reason: input.reason,
				}
			),
		onSuccess: () => {
			setCancelChargeTarget(null);
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
			void queryClient.invalidateQueries({ queryKey: ['expenditure-queue'] });
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-drilldown'],
			});
		},
	});

	const projectOptions = useMemo(() => {
		const options = (data?.project_options ?? []).map((option) => ({
			value: String(option.project_id),
			label: `${option.project_code} — ${option.project_name}`,
		}));
		return [{ value: 'all', label: 'All projects' }, ...options];
	}, [data]);

	// The orderings come from the payload, not from re-sorting here: the report
	// and its drilldown must rank the same figures the same way.
	const costRanks = useMemo(() => rankMap(data?.ranking.by_cost ?? []), [data]);
	const increaseRanks = useMemo(
		() => rankMap(data?.ranking.by_increase ?? []),
		[data]
	);
	const rankedRows = useMemo(() => {
		if (!data) return [];
		const ranking =
			rankingMode === 'increase'
				? data.ranking.by_increase
				: data.ranking.by_cost;
		const position = new Map(
			ranking.map((entry) => [
				`${entry.project_id}:${entry.currency}`,
				entry.rank,
			])
		);
		return [...data.projects]
			.sort(
				(a, b) =>
					a.currency.localeCompare(b.currency) ||
					(position.get(`${a.project_id}:${a.currency}`) ??
						Number.MAX_SAFE_INTEGER) -
						(position.get(`${b.project_id}:${b.currency}`) ??
							Number.MAX_SAFE_INTEGER) ||
					a.project_code.localeCompare(b.project_code)
			)
			.map((row) => ({
				row,
				rank: position.get(`${row.project_id}:${row.currency}`) ?? null,
			}));
	}, [data, rankingMode]);

	// Financial-year navigation: April–March, stepping a whole year to the
	// same month at a time and never past the current month, so the picker
	// cannot show a future month as if its cost had happened. The composed
	// candidate is checked against `current_month` itself: a month in
	// January–March composes its candidate in the following calendar year,
	// which a financial-year-only guard would let through. The step always
	// lands on the same month one year over (#320): landing on the target
	// year's latest month with cost instead would break the round trip (June
	// 2022 → June 2023 → back must return to June 2022, not September 2022),
	// and an empty target month reports its coverage warning rather than an
	// invented zero.
	const financialYear = data ? financialYearOf(data.month) : null;
	const currentFinancialYear = data
		? financialYearOf(data.current_month)
		: null;
	const stepFinancialYear = (step: number) => {
		if (!data || financialYear === null || currentFinancialYear === null)
			return;
		const target = financialYear + step;
		if (target > currentFinancialYear) return;
		const monthNumber = data.month.slice(5, 7);
		const year = Number(monthNumber) >= 4 ? target : target + 1;
		const candidate = `${year}-${monthNumber}`;
		if (candidate > data.current_month) return;
		onMonthChange(candidate);
	};

	if (!month) {
		return (
			<div data-testid="expenditure-view" className="p-6 text-sm text-gray-500">
				Select a month to see the company expenditure reconciliation.
			</div>
		);
	}

	if (reconciliationQuery.isLoading) {
		return (
			<div data-testid="expenditure-view" className="p-6 text-sm text-gray-500">
				Loading company expenditure…
			</div>
		);
	}

	if (reconciliationQuery.isError || !data) {
		return (
			<div data-testid="expenditure-view" className="p-6 text-sm text-rose-600">
				{errorMessage(reconciliationQuery.error)}
			</div>
		);
	}

	const groupAmount = (key: string) =>
		data.company.groups.find((group) => group.key === key)?.amount ?? null;
	// A month is stated in the requested reporting currency only when every
	// confirmed record is supported; otherwise its own currency subtotals are
	// the whole answer and the warning below says so.
	const conversion = data.company.conversion;
	const companyStated = conversion.status !== 'unsupported';
	const reportingCurrencyCode = data.company.reporting_currency;
	// A month whose cost spans currencies has no single comparison figure; the
	// per-currency table below states each one, so the headline says so instead
	// of calling a known, currency-split amount unknown.
	const currencySplitScope =
		data.comparison.currency === null &&
		data.comparison.currency_totals.length > 1;
	// A multi-currency month states tax figures per currency, from the same
	// slices the report already publishes; they are never combined.
	const currencyBreakdown = (
		key: 'gross_liability' | 'recoverable_tax' | 'unresolved_tax_gross'
	) =>
		data.company.currency_totals
			.map((row) => formatCurrencyIn(row[key], row.currency))
			.join(' · ');
	// A missing amount is unknown, never zero, and a multi-currency figure is
	// not stated at all; both read as "Unknown" here rather than as a number.
	const money = (value: number | null, currency: string | null) =>
		value === null ? 'Unknown' : formatCurrencyIn(value, currency ?? 'INR');

	return (
		<div
			data-testid="expenditure-view"
			data-month={data.month}
			data-current-month={data.current_month}
			className="p-3 sm:p-4"
		>
			{/* Controls */}
			<div className="mb-3 flex flex-wrap items-end gap-2">
				<div className="w-full max-w-[240px]">
					<SearchableSelect
						options={monthOptions}
						value={month}
						onChange={(value) => onMonthChange(String(value))}
						placeholder="Select month…"
						aria-label="Month"
					/>
				</div>
				<div className="flex items-end gap-1">
					<button
						type="button"
						data-testid="fy-prev"
						onClick={() => stepFinancialYear(-1)}
						className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						aria-label="Previous financial year"
					>
						‹
					</button>
					<span
						data-testid="fy-label"
						data-fy={financialYear ?? ''}
						className="px-1 py-2 text-xs font-semibold text-gray-700"
					>
						{financialYear === null ? '—' : financialYearLabel(financialYear)}
					</span>
					<button
						type="button"
						data-testid="fy-next"
						onClick={() => stepFinancialYear(1)}
						disabled={
							financialYear === null ||
							currentFinancialYear === null ||
							financialYear >= currentFinancialYear
						}
						className="rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
						aria-label="Next financial year"
					>
						›
					</button>
				</div>
				<div className="w-full max-w-[280px]">
					<SearchableSelect
						options={projectOptions}
						value={projectFilter}
						onChange={(value) => {
							setProjectFilter(String(value));
							setExpandedProject(null);
						}}
						placeholder="All projects"
						aria-label="Project filter"
					/>
				</div>
				<label className="block text-sm">
					<span className="sr-only">Ranking</span>
					<select
						data-testid="ranking-select"
						aria-label="Ranking"
						value={rankingMode}
						onChange={(event) =>
							setRankingMode(
								event.target.value === 'increase' ? 'increase' : 'cost'
							)
						}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
					>
						<option value="cost">Largest cost first</option>
						<option value="increase">Largest increase first</option>
					</select>
				</label>
				<label className="text-xs font-medium text-gray-600">
					<span className="mb-1 block">Reporting currency</span>
					<select
						aria-label="Reporting currency"
						value={reportingCurrency}
						onChange={(event) => setReportingCurrency(event.target.value)}
						className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
					>
						{CURRENCIES.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</select>
				</label>
				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						onClick={() => {
							void reconciliationQuery.refetch();
							void queueQuery.refetch();
						}}
						className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						<ArrowPathIcon
							className={`h-4 w-4 ${reconciliationQuery.isFetching ? 'animate-spin' : ''}`}
						/>
						Refresh
					</button>
					{canRecord && (
						<button
							type="button"
							onClick={() => setFormOpen(true)}
							className="inline-flex items-center gap-1.5 rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a]"
						>
							<PlusIcon className="h-4 w-4" />
							Record cost
						</button>
					)}
				</div>
			</div>

			<p className="mb-1 text-xs text-gray-500">
				Company Incurred Cost for {data.month_label}
				{data.company.currency !== null
					? `, stated in ${data.company.currency}`
					: ', shown per currency'}
				. Each recognized direct cost is counted once; Project filters narrow
				the detail only.
			</p>
			<p
				data-testid="conversion-status"
				data-status={conversion.status}
				data-reporting-currency={reportingCurrencyCode}
				className="mb-3 text-xs text-gray-600"
			>
				{conversion.status === 'reporting'
					? `All recognized cost is already in ${reportingCurrencyCode}.`
					: conversion.status === 'converted'
						? `${conversion.converted_records} recognized record(s) converted into ${reportingCurrencyCode} at their recorded rates.`
						: `${conversion.unsupported_records} recognized record(s) cannot be stated in ${reportingCurrencyCode} yet.`}
			</p>
			{!companyStated && data.company.record_count > 0 && (
				<p
					data-testid="conversion-warning"
					className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
				>
					No complete company total in {reportingCurrencyCode}: some recognized
					cost has no supported conversion evidence for that basis, so only the
					currency subtotals below are stated.
				</p>
			)}

			{/* Company reconciliation */}
			<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
				<div className="rounded-xl border border-purple-200 bg-[#64126D]/5 p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-[#64126D]">
						Company Incurred Cost
					</p>
					<p
						data-testid="kpi-incurred-cost"
						data-amount={
							data.company.incurred_cost === null
								? ''
								: String(data.company.incurred_cost)
						}
						className="mt-0.5 text-lg font-bold text-[#64126D]"
					>
						{data.company.incurred_cost === null
							? 'Not combinable'
							: formatCurrencyIn(
									data.company.incurred_cost,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-500">
						{data.company.record_count} recognized record(s)
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Incurred Project Cost
					</p>
					<p
						data-testid="kpi-project-cost"
						data-amount={groupAmount('incurred_project_cost') ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{groupAmount('incurred_project_cost') === null && !companyStated
							? 'See currencies'
							: formatCurrencyIn(
									groupAmount('incurred_project_cost') ?? 0,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-400">
						{data.projects.length} project(s) with cost
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Company Overhead
					</p>
					<p
						data-testid="kpi-overhead"
						data-amount={groupAmount('company_overhead') ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{groupAmount('company_overhead') === null && !companyStated
							? 'See currencies'
							: formatCurrencyIn(
									groupAmount('company_overhead') ?? 0,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-400">
						Deliberately not attributable to one Project
					</p>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
					<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
						Unallocated Cost
					</p>
					<p
						data-testid="kpi-unallocated"
						data-amount={groupAmount('unallocated_cost') ?? ''}
						className="mt-0.5 text-lg font-bold text-gray-900"
					>
						{groupAmount('unallocated_cost') === null && !companyStated
							? 'See currencies'
							: formatCurrencyIn(
									groupAmount('unallocated_cost') ?? 0,
									data.company.currency
								)}
					</p>
					<p className="text-[10px] text-gray-400">
						Awaiting a Project or Overhead destination
					</p>
				</div>
			</div>

			{/* Comparable period: the same month measured against its prior period */}
			<div
				data-testid="comparison-panel"
				data-basis={data.comparison.basis}
				data-as-of={data.comparison.as_of}
				data-current-days={data.comparison.current_days}
				data-prior-days={data.comparison.prior_days}
				className="mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
			>
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<p className="text-xs font-semibold text-gray-700">
						Comparable period — {data.month_label} against{' '}
						{data.comparison.prior_month_label}
					</p>
					<p className="text-[11px] text-gray-500">
						{data.comparison.unfinished
							? `Measured to ${data.comparison.as_of}: both periods cover their first ${data.comparison.current_days} day(s).`
							: `Full month compared with the full prior month (measured to ${data.comparison.as_of}).`}
					</p>
				</div>
				<div className="mt-2 grid gap-3 sm:grid-cols-4">
					<div>
						<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
							This period
						</p>
						<p
							data-testid="comparison-current"
							data-value={data.comparison.current_cost ?? ''}
							data-currency={data.comparison.currency ?? ''}
							className="text-base font-bold text-gray-900"
						>
							{data.comparison.currency !== null
								? formatCurrencyIn(
										data.comparison.current_cost ?? 0,
										data.comparison.currency
									)
								: data.comparison.currency_totals.length === 0
									? 'No cost recorded'
									: 'See currencies'}
						</p>
					</div>
					<div>
						<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
							Prior period
						</p>
						<p
							data-testid="comparison-prior"
							data-value={data.comparison.prior_cost ?? ''}
							className="text-base font-bold text-gray-900"
						>
							{data.comparison.prior_cost === null
								? currencySplitScope
									? 'See currencies'
									: 'Unknown'
								: formatCurrencyIn(
										data.comparison.prior_cost,
										data.comparison.currency
									)}
						</p>
					</div>
					<div>
						<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
							Absolute change
						</p>
						<p
							data-testid="comparison-change"
							data-value={data.comparison.change_amount ?? ''}
							className="text-base font-bold text-gray-900"
						>
							{data.comparison.change_amount === null
								? currencySplitScope
									? 'See currencies'
									: 'Unknown'
								: formatCurrencyIn(
										data.comparison.change_amount,
										data.comparison.currency
									)}
						</p>
					</div>
					<div>
						<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
							Percentage change
						</p>
						<p
							data-testid="comparison-percent"
							data-value={data.comparison.change_percent ?? ''}
							data-state={data.comparison.change_state}
							className="text-base font-bold text-gray-900"
						>
							{currencySplitScope
								? 'See currencies'
								: percentLabel(
										data.comparison.change_percent,
										data.comparison.change_state
									)}
						</p>
					</div>
				</div>
				{data.comparison.currency_totals.length > 0 && (
					<table className="mt-2 w-full text-xs">
						<caption className="sr-only">
							Comparable window by currency and direct-cost category
						</caption>
						<thead className="text-left text-[10px] uppercase tracking-wide text-gray-500">
							<tr>
								<th scope="col">Currency</th>
								<th scope="col" className="text-right">
									This period
								</th>
								<th scope="col" className="text-right">
									Prior period
								</th>
								<th scope="col" className="text-right">
									Change
								</th>
								<th scope="col" className="text-right">
									Incurred Project Cost
								</th>
								<th scope="col" className="text-right">
									Company Overhead
								</th>
								<th scope="col" className="text-right">
									Unallocated Cost
								</th>
							</tr>
						</thead>
						<tbody>
							{data.comparison.currency_totals.map((row) => (
								<tr
									key={row.currency}
									data-testid="comparison-currency-row"
									data-currency={row.currency}
									data-current={row.current_cost}
									data-prior={row.prior_cost ?? ''}
									data-dayless={row.dayless_cost}
									data-dayless-count={row.dayless_records}
								>
									<td>{row.currency}</td>
									<td className="text-right">
										{formatCurrencyIn(row.current_cost, row.currency)}
									</td>
									<td className="text-right">
										{row.prior_cost === null
											? 'Unknown'
											: formatCurrencyIn(row.prior_cost, row.currency)}
									</td>
									<td className="text-right">
										{percentLabel(row.change_percent, row.change_state)}
									</td>
									{row.groups.map((group) => (
										<td
											key={group.key}
											data-testid="comparison-category"
											data-category={group.key}
											data-amount={group.amount}
											className="text-right"
										>
											{formatCurrencyIn(group.amount, row.currency)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				)}
				<ul className="mt-2 space-y-1">
					{data.comparison.disclosures.map((entry, index) => (
						<li
							key={`${entry.code}-${entry.period ?? 'both'}-${index}`}
							data-testid="comparison-disclosure"
							data-code={entry.code}
							data-period={entry.period ?? ''}
							data-count={entry.count}
							data-amount={entry.amount ?? ''}
							data-severity={entry.severity}
							className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
								entry.severity === 'warning'
									? 'text-amber-800'
									: 'text-gray-500'
							}`}
						>
							{entry.severity === 'warning' ? (
								<ExclamationTriangleIcon className="mt-0.5 h-3 w-3 shrink-0" />
							) : (
								<InformationCircleIcon className="mt-0.5 h-3 w-3 shrink-0" />
							)}
							<span>
								<span className="font-semibold">{entry.label}.</span>{' '}
								{entry.detail}
							</span>
						</li>
					))}
				</ul>
				<p className="mt-2 text-[11px] text-gray-500">
					Cost to date is cumulative recognized cost through{' '}
					{formatDate(data.comparison.cost_to_date_through)}, the window&apos;s
					last day.
				</p>
			</div>

			{/* The filtered Project subtotal is never the company reconciliation */}
			{data.filtered_subtotal && (
				<div
					data-testid="filtered-subtotal"
					data-project-id={data.filtered_subtotal.project_id}
					className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3"
				>
					<p className="text-xs font-semibold text-indigo-900">
						Filtered Project subtotal —{' '}
						{data.filtered_subtotal.currency_totals.map((row) => (
							<span key={row.currency} className="mr-2">
								<span
									data-testid="filtered-subtotal-currency"
									data-currency={row.currency}
									data-incurred={row.incurred_cost}
									data-comparison={row.comparison_cost}
									data-cost-to-date={row.cost_to_date ?? ''}
								>
									Incurred {formatCurrencyIn(row.incurred_cost, row.currency)} ·{' '}
									this period{' '}
									{formatCurrencyIn(row.comparison_cost, row.currency)} · to
									date{' '}
									{row.cost_to_date === null
										? 'unknown'
										: formatCurrencyIn(row.cost_to_date, row.currency)}
								</span>
							</span>
						))}
					</p>
					<p className="mt-1 text-[11px] text-indigo-800">
						The company reconciliation above is not narrowed by the Project
						filter; it stays the unfiltered company position.
					</p>
				</div>
			)}

			{/* Currency subtotals: never combined without a supported conversion */}
			{data.company.currency_totals.some(
				(row) => row.reporting.status !== 'reporting'
			) && (
				<div
					className={`mt-3 overflow-x-auto rounded-xl border p-3 ${
						companyStated
							? 'border-gray-200 bg-white'
							: 'border-amber-200 bg-amber-50'
					}`}
				>
					<p
						className={`text-xs font-semibold ${companyStated ? 'text-gray-700' : 'text-amber-900'}`}
					>
						{companyStated
							? `Each currency is converted into ${reportingCurrencyCode} at the rate recorded with its cost.`
							: `Some currencies have no supported conversion to ${reportingCurrencyCode} yet. Their amounts stay in their own currency and no combined total is shown.`}
					</p>
					<table className="mt-2 w-full text-xs">
						<thead>
							<tr className="text-left text-gray-600">
								<th className="py-1 pr-3 font-medium">Currency</th>
								<th className="py-1 pr-3 font-medium">Incurred Project Cost</th>
								<th className="py-1 pr-3 font-medium">Company Overhead</th>
								<th className="py-1 pr-3 font-medium">Unallocated Cost</th>
								<th className="py-1 pr-3 font-medium">Total</th>
								<th className="py-1 pr-3 font-medium">
									Reporting ({reportingCurrencyCode})
								</th>
							</tr>
						</thead>
						<tbody>
							{data.company.currency_totals.map((row) => (
								<tr
									key={row.currency}
									data-testid="currency-total-row"
									data-conversion-status={row.reporting.status}
								>
									<td className="py-1 pr-3 font-semibold">{row.currency}</td>
									<td className="py-1 pr-3">
										{formatCurrencyIn(row.incurred_project_cost, row.currency)}
									</td>
									<td className="py-1 pr-3">
										{formatCurrencyIn(row.company_overhead, row.currency)}
									</td>
									<td className="py-1 pr-3">
										{formatCurrencyIn(row.unallocated_cost, row.currency)}
									</td>
									<td className="py-1 pr-3 font-semibold">
										{formatCurrencyIn(row.incurred_cost, row.currency)}
									</td>
									<td
										data-testid="currency-reporting-row"
										data-currency={row.currency}
										data-status={row.reporting.status}
										className="py-1 pr-3 font-semibold"
									>
										{row.reporting.incurred_cost === null
											? `No rate to ${reportingCurrencyCode}`
											: formatCurrencyIn(
													row.reporting.incurred_cost,
													reportingCurrencyCode
												)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Petty cash: funding, spending, remaining funding, recognized cost */}
			<div
				data-testid="petty-cash-section"
				className="mt-3 rounded-xl border border-purple-200 bg-purple-50/40 p-3"
			>
				<p className="text-xs font-semibold text-purple-900">
					Petty cash — funding and spending stay separate from incurred cost
				</p>
				<div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
					{(
						[
							[
								'petty-funding-amount',
								'Funding',
								data.petty_cash.funding,
								'Vouchers and their mirrored credits; cash into the float, never expense',
							],
							[
								'petty-spend-amount',
								'Spend',
								data.petty_cash.spend,
								'Actual petty-cash spending recorded this month',
							],
							[
								'petty-remaining-amount',
								'Remaining funded',
								data.petty_cash.remaining_funding,
								'Funding less the spending drawn from vouchers',
							],
							[
								'petty-recognized-amount',
								'Recognized cost',
								data.petty_cash.recognized_cost,
								'Approved spending, already counted once above',
							],
						] as const
					).map(([testId, label, value, hint]) => (
						<div
							key={testId}
							className="rounded-lg border border-purple-100 bg-white p-2"
						>
							<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
								{label}
							</p>
							<p
								data-testid={testId}
								data-amount={value === null ? '' : String(value)}
								className="text-base font-bold text-purple-900"
							>
								{value === null
									? '—'
									: formatCurrencyIn(value, data.petty_cash.currency ?? 'INR')}
							</p>
							<p className="text-[10px] text-gray-500">{hint}</p>
						</div>
					))}
				</div>
				{data.petty_cash.by_currency.length > 1 && (
					<ul className="mt-2 space-y-0.5 text-[11px] text-purple-900">
						{data.petty_cash.by_currency.map((row) => (
							<li key={row.currency} data-testid="petty-currency-row">
								{row.currency}: funding{' '}
								{formatCurrencyIn(row.funding, row.currency)} · spend{' '}
								{formatCurrencyIn(row.spend, row.currency)} · remaining{' '}
								{formatCurrencyIn(row.remaining_funding, row.currency)} ·
								recognized {formatCurrencyIn(row.recognized_cost, row.currency)}
							</li>
						))}
					</ul>
				)}
				<ul className="mt-2 space-y-0.5 text-[11px] text-purple-900/90">
					<li data-testid="petty-unlinked-spend">
						Spending without voucher linkage:{' '}
						{data.petty_cash.unlinked_spend.count}
						{data.petty_cash.unlinked_spend.amount === null
							? ''
							: ` (${formatCurrencyIn(
									data.petty_cash.unlinked_spend.amount,
									data.petty_cash.currency ?? 'INR'
								)})`}
					</li>
					<li data-testid="petty-unresolved-settlements">
						Receipts settling an unrecognized cost:{' '}
						{data.petty_cash.unresolved_settlements.count}
						{data.petty_cash.unresolved_settlements.amount === null
							? ''
							: ` (${formatCurrencyIn(
									data.petty_cash.unresolved_settlements.amount,
									data.petty_cash.currency ?? 'INR'
								)})`}
					</li>
					{data.petty_cash.unknown_currency &&
						data.petty_cash.unknown_currency.count > 0 && (
							<li data-testid="petty-unknown-currency">
								Records whose original currency is unknown:{' '}
								{data.petty_cash.unknown_currency.count} — stated in no currency
								subtotal
							</li>
						)}
				</ul>
			</div>

			{/* Tax and evidence */}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<div className="rounded-xl border border-gray-200 bg-white p-3">
					<p className="text-xs font-semibold text-gray-700">
						Tax on recognized cost
					</p>
					<ul className="mt-1 space-y-0.5 text-xs text-gray-600">
						<li data-testid="tax-gross">
							Gross liability:{' '}
							{data.company.gross_liability !== null
								? formatCurrencyIn(
										data.company.gross_liability,
										data.company.currency
									)
								: currencyBreakdown('gross_liability')}
						</li>
						<li data-testid="tax-recoverable">
							Confirmed recoverable tax excluded:{' '}
							{data.company.recoverable_tax !== null
								? formatCurrencyIn(
										data.company.recoverable_tax,
										data.company.currency
									)
								: currencyBreakdown('recoverable_tax')}
						</li>
						<li data-testid="tax-unresolved">
							Unresolved tax kept at gross: {data.company.unresolved_tax.count}{' '}
							record(s),{' '}
							{data.company.unresolved_tax.gross_amount !== null
								? formatCurrencyIn(
										data.company.unresolved_tax.gross_amount,
										data.company.currency
									)
								: currencyBreakdown('unresolved_tax_gross')}
						</li>
					</ul>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3">
					<p className="text-xs font-semibold text-gray-700">
						Evidence state (this month)
					</p>
					<ul className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-gray-600">
						{(
							[
								['recognized', 'Recognized'],
								['pending_evidence', 'Pending evidence'],
								['draft', 'Draft'],
								['rejected', 'Rejected'],
								['cancelled', 'Cancelled'],
							] as const
						).map(([key, label]) => (
							<li key={key} data-testid="evidence-row" data-state={key}>
								{label}: {data.evidence[key].count}
							</li>
						))}
						<li data-testid="evidence-row" data-state="unresolved">
							Unclassified: {data.evidence.unresolved_classification.count}
						</li>
						<li data-testid="evidence-row" data-state="missing_amount">
							Missing amount: {data.evidence.missing_amount.count}
						</li>
						<li data-testid="evidence-row" data-state="missing_currency">
							Missing original currency: {data.evidence.missing_currency.count}
						</li>
						<li data-testid="evidence-row" data-state="known_zero">
							Known zero: {data.evidence.known_zero.count}
						</li>
					</ul>
				</div>
			</div>

			{/* Coverage */}
			<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
				<p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
					<ExclamationTriangleIcon className="h-4 w-4" />
					Coverage: what this total does and does not include
				</p>
				<ul className="mt-1 space-y-1 text-xs text-amber-900/90">
					{data.coverage.map((notice) => (
						<li
							key={notice.code}
							data-testid="coverage-notice"
							data-code={notice.code}
							data-severity={notice.severity}
							className="flex items-start gap-1.5"
						>
							<InformationCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>
								<span className="font-medium">{notice.label}.</span>{' '}
								{notice.detail}
							</span>
						</li>
					))}
				</ul>
			</div>

			{/* Outstanding Supplier Commitment (#312) */}
			<div
				data-testid="commitment-section"
				className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3"
			>
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<p className="text-xs font-semibold text-gray-800">
						Outstanding Supplier Commitment
					</p>
					<p className="text-[11px] text-gray-600">
						Supplier order value not yet consumed by recognized cost — never
						incurred cost. Reconstructed as of this month from the recorded
						eligibility, consumption, and cancellation acts.
					</p>
				</div>
				<div className="mt-2 space-y-2">
					{data.supplier_commitment.totals.map((total) => (
						<div
							key={`${total.currency}-${total.basis}`}
							data-testid="commitment-row"
							data-currency={total.currency}
							data-basis={total.basis}
							data-closing={total.closingCommitment}
							data-consumption={total.consumptionInMonth}
							className="rounded-lg border border-sky-100 bg-white/70 p-2"
						>
							<div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-gray-800">
								<span className="font-medium">
									{total.currency} ·{' '}
									{total.basis === 'gross' ? 'including tax' : 'net of tax'} ·{' '}
									{total.unconsumedOrderCount} order
									{total.unconsumedOrderCount === 1 ? '' : 's'} open
								</span>
								<span>
									Closing commitment:{' '}
									<strong>
										{money(total.closingCommitment, total.currency)}
									</strong>{' '}
									· consumed this month:{' '}
									{money(total.consumptionInMonth, total.currency)}
								</span>
							</div>
							<table className="mt-1 min-w-full text-[11px] text-gray-700">
								<thead>
									<tr className="text-left text-gray-500">
										<th className="pr-2">Month</th>
										<th className="pr-2">Opening</th>
										<th className="pr-2">New</th>
										<th className="pr-2">Consumption</th>
										<th className="pr-2">Cancellation</th>
										<th>Closing</th>
									</tr>
								</thead>
								<tbody>
									{total.months.map((row) => (
										<tr key={row.month} data-testid="commitment-month">
											<td className="pr-2">{row.month}</td>
											<td className="pr-2">
												{money(row.opening, total.currency)}
											</td>
											<td className="pr-2">
												{money(row.newCommitment, total.currency)}
											</td>
											<td className="pr-2">
												{money(row.consumption, total.currency)}
											</td>
											<td className="pr-2">
												{money(row.cancellation, total.currency)}
											</td>
											<td>{money(row.closing, total.currency)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					))}
					{data.supplier_commitment.totals.length === 0 && (
						<p className="text-xs text-gray-500">
							No supported supplier commitment this month.
						</p>
					)}
					{data.supplier_commitment.orders.length > 0 && (
						<div className="overflow-x-auto">
							<table className="min-w-full text-[11px] text-gray-700">
								<thead>
									<tr className="text-left text-gray-500">
										<th className="pr-2">Order</th>
										<th className="pr-2">Counterparty</th>
										<th className="pr-2">Project</th>
										<th className="pr-2">Value</th>
										<th className="pr-2">Consumed</th>
										<th className="pr-2">Remaining</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>
									{data.supplier_commitment.orders.map((order) => (
										<tr
											key={order.orderUid}
											data-testid="commitment-order"
											data-order-number={order.orderNumber}
											data-remaining={order.remaining}
										>
											<td className="pr-2">{order.orderNumber}</td>
											<td className="pr-2">{order.counterpartyName}</td>
											<td className="pr-2">{order.projectCode || '—'}</td>
											<td className="pr-2">
												{money(order.value, order.currency)}
											</td>
											<td className="pr-2">
												{money(order.consumption, order.currency)}
											</td>
											<td className="pr-2">
												{money(order.remaining, order.currency)}
											</td>
											<td>{order.status}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{data.supplier_commitment.exceptions.length > 0 && (
						<ul className="space-y-1 text-[11px] text-amber-900">
							{data.supplier_commitment.exceptions.map((exception) => (
								<li
									key={`${exception.code}-${exception.currency ?? ''}-${exception.basis ?? ''}`}
									data-testid="commitment-exception"
									data-code={exception.code}
									data-count={exception.orderCount}
								>
									<span className="font-medium">{exception.code}</span>:{' '}
									{exception.detail} ({exception.orderCount}
									{exception.value === null
										? ', value unknown'
										: `, ${formatCurrencyIn(exception.value, exception.currency ?? 'INR')}`}
									)
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* Non-operating balances and their approved consumption (#317) */}
			{(data.non_operating.items.length > 0 ||
				data.non_operating.charges_from_prior_items.length > 0) && (
				<div
					data-testid="non-operating-section"
					className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3"
				>
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<p className="text-xs font-semibold text-gray-800">
							Non-operating items — advances, deposits, prepayments, capital
						</p>
						<p className="text-[11px] text-gray-600">
							Shown separately from operating cost: a payment or invoice here is
							a balance, and only approved period consumption is counted.
						</p>
					</div>
					<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-700">
						<span data-testid="non-operating-excluded">
							Excluded source amount{' '}
							{money(
								data.non_operating.excluded_source_amount,
								data.non_operating.currency
							)}
						</span>
						<span data-testid="non-operating-consumed">
							Consumed this month{' '}
							{money(
								data.non_operating.consumed_this_month,
								data.non_operating.currency
							)}
						</span>
						<span>
							Consumed to date{' '}
							{money(
								data.non_operating.consumed_to_date,
								data.non_operating.currency
							)}
						</span>
						<span data-testid="non-operating-remaining">
							Remaining{' '}
							{money(
								data.non_operating.remaining_amount,
								data.non_operating.currency
							)}
						</span>
						{data.non_operating.unapproved_count > 0 && (
							<span data-testid="non-operating-unapproved">
								{data.non_operating.unapproved_count} item(s) not approved yet —
								no supported balance to consume
							</span>
						)}
						{data.non_operating.unresolved_count > 0 && (
							<span data-testid="non-operating-unresolved">
								Treatment unresolved: {data.non_operating.unresolved_count}{' '}
								record(s),{' '}
								{money(
									data.non_operating.unresolved_source_amount,
									data.non_operating.currency
								)}{' '}
								excluded
							</span>
						)}
					</div>
					<ul className="mt-2 space-y-1.5">
						{data.non_operating.items.map((entry) => (
							<li
								key={entry.cost_uid}
								data-testid="non-operating-item"
								data-cost-uid={entry.cost_uid}
								data-nature={entry.nature}
								data-recognized={entry.recognized_amount ?? ''}
								data-remaining={entry.remaining_amount ?? ''}
								className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
							>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span className="font-medium text-gray-900">
										{entry.source_reference ?? entry.expense_number}
									</span>
									<span
										data-testid="item-nature"
										className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
									>
										{NATURE_LABELS[entry.nature] ?? entry.nature}
									</span>
									<span>
										{entry.cost_classification
											? CLASSIFICATION_LABELS[entry.cost_classification]
											: 'Destination unresolved'}
										{entry.project_code ? ` · ${entry.project_code}` : ''}
									</span>
									<span>
										Supported balance{' '}
										{money(entry.recognized_amount, entry.currency)}
									</span>
									<span>
										Consumed to date{' '}
										{money(entry.consumed_to_date, entry.currency)}
									</span>
									<span className="font-semibold text-gray-900">
										Remaining {money(entry.remaining_amount, entry.currency)}
									</span>
									<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
										{STATE_LABELS[entry.source_state] ?? entry.source_state}
									</span>
									<span className="text-[10px] text-gray-500">
										{entry.evidence_reference ?? 'No evidence reference'}
									</span>
									{canRecognize &&
										entry.source_state === 'recognized' &&
										CONSUMABLE_NATURES.includes(entry.nature) && (
											<button
												type="button"
												data-testid="capture-charge"
												onClick={() => {
													chargeMutation.reset();
													setChargeTarget(entry);
												}}
												className="rounded border border-[#64126D]/40 bg-[#64126D]/5 px-2 py-0.5 text-[11px] font-medium text-[#64126D] hover:bg-[#64126D]/10"
											>
												Capture period charge
											</button>
										)}
								</div>
								{entry.charges.length > 0 && (
									<ul className="mt-1 space-y-0.5 border-t border-gray-100 pt-1">
										{entry.charges.map((charge) => (
											<li
												key={charge.charge_uid}
												data-testid="period-charge"
												data-charge-uid={charge.charge_uid}
												data-state={charge.state}
												className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-600"
											>
												<span>
													{CHARGE_BASIS_LABELS[charge.basis] ?? charge.basis}
												</span>
												<span className="font-medium text-gray-800">
													{formatCurrencyIn(charge.amount, charge.currency)}
												</span>
												<span>{formatDate(charge.period)}</span>
												<span>{charge.evidence_reference}</span>
												<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
													{charge.state === 'approved'
														? 'Approved'
														: 'Cancelled'}
												</span>
												{charge.state === 'approved' && canRecognize && (
													<button
														type="button"
														onClick={() => {
															cancelChargeMutation.reset();
															setCancelChargeTarget(charge);
														}}
														className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
													>
														Cancel charge
													</button>
												)}
											</li>
										))}
									</ul>
								)}
							</li>
						))}
					</ul>
					{data.non_operating.charges_from_prior_items.length > 0 && (
						<div
							data-testid="prior-item-charges"
							className="mt-2 border-t border-amber-200/70 pt-1.5 text-[11px] text-gray-600"
						>
							<p className="font-medium text-gray-700">
								Charges on balances recognised in an earlier month
							</p>
							<ul className="mt-0.5 space-y-0.5">
								{data.non_operating.charges_from_prior_items.map((charge) => (
									<li key={charge.charge_uid}>
										{charge.source_expense_number} ·{' '}
										{CHARGE_BASIS_LABELS[charge.basis] ?? charge.basis} ·{' '}
										{formatCurrencyIn(charge.amount, charge.currency)} ·{' '}
										{formatDate(charge.period)} ·{' '}
										{charge.state === 'approved' ? 'Approved' : 'Cancelled'}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}

			{/* Project breakdown */}
			<div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
				<table className="w-full min-w-[1080px] text-sm">
					<caption className="sr-only">
						Incurred Project Cost by Project for {data.month_label}, ordered by{' '}
						{rankingMode === 'increase' ? 'largest increase' : 'largest cost'}
					</caption>
					<thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
						<tr>
							<th scope="col" className="px-3 py-2">
								#
							</th>
							<th scope="col" className="px-3 py-2">
								Project
							</th>
							<th scope="col" className="px-3 py-2">
								Client
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Employee cost
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Logged Hours
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Incurred cost
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								{data.comparison.unfinished
									? `First ${data.comparison.current_days} day(s)`
									: 'This month'}
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Change
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Cost to date
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Reporting ({reportingCurrencyCode})
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Not confirmed
							</th>
							<th scope="col" className="px-3 py-2">
								Evidence
							</th>
						</tr>
					</thead>
					<tbody>
						{data.projects.length === 0 && (
							<tr>
								<td
									colSpan={12}
									className="px-3 py-4 text-center text-gray-500"
								>
									No Project-attributed cost in this month. Company Overhead and
									Unallocated Cost stay in the reconciliation above.
								</td>
							</tr>
						)}
						{rankedRows.map(({ row: project, rank }) => {
							const expanded = expandedProject === project.project_id;
							return (
								<Fragment key={`${project.project_id}-${project.currency}`}>
									<tr
										data-testid="expenditure-project-row"
										data-project-code={project.project_code}
										data-project-cost={project.incurred_cost}
										data-currency={project.currency}
										data-comparison-cost={project.comparison_cost}
										data-previous-period-cost={
											project.previous_period_cost ?? ''
										}
										data-change-percent={project.change_percent ?? ''}
										data-change-state={project.change_state}
										data-cost-to-date={project.cost_to_date ?? ''}
										data-late-count={project.late_entry?.count ?? 0}
										data-evidence-state={project.evidence.state}
										data-rank-cost={
											costRanks.get(
												`${project.project_id}:${project.currency}`
											) ?? ''
										}
										data-rank-increase={
											increaseRanks.get(
												`${project.project_id}:${project.currency}`
											) ?? ''
										}
										data-rank={rank ?? ''}
										data-employee-cost={String(project.employee_cost)}
										data-logged-hours={String(project.logged_hours)}
										className="border-t border-gray-100"
									>
										<td className="px-3 py-2 text-xs font-semibold text-gray-500">
											{rank ?? '—'}
										</td>
										<td className="px-3 py-2">
											<div className="flex items-center gap-1.5">
												<button
													type="button"
													data-testid="project-expand"
													aria-expanded={expanded}
													onClick={() =>
														setExpandedProject(
															expanded ? null : project.project_id
														)
													}
													className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
													aria-label={`${expanded ? 'Hide' : 'Show'} source records for ${project.project_code}`}
												>
													{expanded ? (
														<ChevronDownIcon className="h-4 w-4" />
													) : (
														<ChevronRightIcon className="h-4 w-4" />
													)}
												</button>
												<span className="font-medium text-gray-900">
													{project.project_code}
												</span>
												<span className="text-gray-500">
													{project.project_name}
												</span>
												{project.currency !== reportingCurrencyCode && (
													<span
														data-testid="project-currency"
														className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
													>
														{project.currency}
													</span>
												)}
											</div>
										</td>
										<td className="px-3 py-2 text-gray-600">
											{project.client_name ?? '—'}
										</td>
										<td className="px-3 py-2 text-right text-gray-700">
											{project.employee_cost === 0
												? '—'
												: formatCurrencyIn(
														project.employee_cost,
														project.currency
													)}
											{project.estimated_employee_cost > 0 && (
												<span className="ml-1 text-[10px] text-amber-700">
													+
													{formatCurrencyIn(
														project.estimated_employee_cost,
														project.currency
													)}{' '}
													est.
												</span>
											)}
										</td>
										<td className="px-3 py-2 text-right tabular-nums text-gray-600">
											{project.logged_hours === 0
												? '—'
												: formatNumber(project.logged_hours)}
										</td>
										<td className="px-3 py-2 text-right font-semibold text-gray-900">
											{formatCurrencyIn(
												project.incurred_cost,
												project.currency
											)}
										</td>
										<td className="px-3 py-2 text-right text-gray-600">
											{formatCurrencyIn(
												project.comparison_cost,
												project.currency
											)}
										</td>
										<td className="px-3 py-2 text-right text-gray-600">
											<p
												data-testid="project-change"
												data-value={project.change_amount ?? ''}
												data-percent={project.change_percent ?? ''}
											>
												{project.change_amount === null
													? 'Unknown'
													: formatCurrencyIn(
															project.change_amount,
															project.currency
														)}
											</p>
											<p className="text-[11px] text-gray-500">
												{percentLabel(
													project.change_percent,
													project.change_state
												)}
											</p>
										</td>
										<td
											data-testid="project-cost-to-date"
											data-value={project.cost_to_date ?? ''}
											className="px-3 py-2 text-right text-gray-600"
										>
											{project.cost_to_date === null
												? 'Unknown'
												: formatCurrencyIn(
														project.cost_to_date,
														project.currency
													)}
										</td>
										<td
											data-testid="project-reporting-cost"
											data-conversion-status={project.conversion_status}
											className="px-3 py-2 text-right font-semibold text-gray-900"
										>
											{project.converted_incurred_cost === null
												? `No rate to ${reportingCurrencyCode}`
												: formatCurrencyIn(
														project.converted_incurred_cost,
														reportingCurrencyCode
													)}
										</td>
										<td className="px-3 py-2 text-right text-gray-600">
											{project.not_confirmed_cost === null
												? 'Amount unknown'
												: project.not_confirmed_cost > 0
													? formatCurrencyIn(
															project.not_confirmed_cost,
															project.currency
														)
													: '—'}
										</td>
										<td className="px-3 py-2 text-xs text-gray-600">
											<p
												data-testid="project-evidence"
												data-state={project.evidence.state}
												data-findings={project.evidence.findings.join(',')}
												className="font-medium text-gray-700"
											>
												{EVIDENCE_LABELS[project.evidence.state] ??
													project.evidence.state}
											</p>
											{project.evidence.findings.length > 0 && (
												<p className="text-[10px] text-gray-500">
													{EVIDENCE_FINDING_LABELS[
														project.evidence.findings[0]
													] ?? project.evidence.findings[0]}
													{project.evidence.findings.length > 1
														? ` +${project.evidence.findings.length - 1}`
														: ''}
												</p>
											)}
											{project.late_entry && (
												<p
													data-testid="project-late-entry"
													data-count={project.late_entry.count}
													data-amount={project.late_entry.amount ?? ''}
													className="text-[10px] text-amber-700"
												>
													{project.late_entry.count} late entr
													{project.late_entry.count === 1 ? 'y' : 'ies'}
												</p>
											)}
										</td>
									</tr>
									{expanded && (
										<tr
											key={`${project.project_id}-${project.currency}-drilldown`}
										>
											<td colSpan={12} className="bg-gray-50/70 px-3 py-2">
												<div
													data-testid="project-drilldown"
													data-currency={project.currency}
												>
													<p className="mb-1 text-xs font-semibold text-gray-700">
														Source records recognized against{' '}
														{project.project_code}
													</p>
													{drilldownQuery.isLoading && (
														<p className="text-xs text-gray-500">
															Loading source records…
														</p>
													)}
													{drilldownQuery.data?.data.records.length === 0 && (
														<p className="text-xs text-gray-500">
															No recognized records for this Project in the
															month.
														</p>
													)}
													<ul className="space-y-1">
														{drilldownQuery.data?.data.records.map((record) => (
															<li
																key={`${record.source}-${record.id}-${record.split?.id ?? 0}`}
																data-testid="drilldown-record"
																data-source={record.source}
																data-cost-uid={record.cost_uid ?? ''}
																data-source-reference={
																	record.source_reference ?? ''
																}
																data-created-at={record.created_at ?? ''}
																data-accrual-remaining={
																	record.accrual
																		? (record.accrual.remaining_amount ?? '')
																		: undefined
																}
																data-accrual-replaced={
																	record.accrual
																		? record.accrual.replaced_amount
																		: undefined
																}
																className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-700"
															>
																<span className="font-medium">
																	{record.source_reference ??
																		record.expense_number}
																</span>
																<span>{record.vendor_name ?? '—'}</span>
																<span>
																	Period {formatDate(record.recognition_period)}{' '}
																	(
																	{PERIOD_BASIS_LABELS[record.period_basis] ??
																		record.period_basis}
																	)
																</span>
																<span>
																	Gross{' '}
																	{formatSourceMoney(
																		record.gross_amount,
																		record.currency
																	)}
																</span>
																<span className="font-semibold">
																	Recognized{' '}
																	{formatSourceMoney(
																		record.recognized_amount,
																		record.currency
																	)}
																</span>
																{record.accrual && (
																	<span
																		data-testid="record-accrual"
																		className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-900"
																	>
																		Cost accrual · accrued{' '}
																		{formatSourceMoney(
																			record.accrual.remaining_amount,
																			record.currency
																		)}{' '}
																		· replaced{' '}
																		{formatSourceMoney(
																			record.accrual.replaced_amount,
																			record.currency
																		)}
																		{record.accrual.replacement_count > 0
																			? ` · ${record.accrual.replacement_count} replacement${
																					record.accrual.replacement_count === 1
																						? ''
																						: 's'
																				}`
																			: ''}
																	</span>
																)}
																{record.conversion_status !== 'reporting' && (
																	<span
																		data-testid="record-conversion"
																		data-status={record.conversion_status}
																		data-rate={record.conversion_rate ?? ''}
																		data-converted={
																			record.converted_amount ?? ''
																		}
																		className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900"
																	>
																		{record.conversion_status === 'unsupported'
																			? `No rate to ${reportingCurrencyCode}`
																			: `${record.currency} → ${reportingCurrencyCode} @ ${record.conversion_rate} on ${formatDate(record.conversion_date)} (${record.conversion_evidence_reference})`}
																	</span>
																)}
																{record.cost_nature !== 'operating' && (
																	<span
																		data-testid="record-nature"
																		className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
																	>
																		{NATURE_LABELS[record.cost_nature] ??
																			record.cost_nature}
																	</span>
																)}
																<span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-600">
																	v{record.financial_version}
																</span>
															</li>
														))}
													</ul>
													<p className="mb-1 mt-2 text-xs font-semibold text-gray-700">
														Unresolved evidence against {project.project_code}
													</p>
													{evidenceQuery.isLoading && (
														<p className="text-xs text-gray-500">
															Loading unresolved evidence…
														</p>
													)}
													{evidenceQuery.data?.data.records.length === 0 && (
														<p className="text-xs text-gray-500">
															No draft or pending-evidence record for this
															Project in the month.
														</p>
													)}
													<ul className="space-y-1">
														{evidenceQuery.data?.data.records.map((record) => (
															<li
																key={record.id}
																data-testid="drilldown-unconfirmed-record"
																data-state={record.recognition_state}
																data-gross-amount={record.gross_amount ?? ''}
																className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-700"
															>
																<span className="font-medium">
																	{record.source_reference ??
																		record.expense_number}
																</span>
																<span>
																	{STATE_LABELS[record.recognition_state] ??
																		record.recognition_state}
																</span>
																<span>
																	Gross{' '}
																	{record.gross_amount === null
																		? 'amount unknown'
																		: formatCurrencyIn(
																				record.gross_amount,
																				record.currency
																			)}
																</span>
																{record.exceptions.length > 0 && (
																	<span data-testid="drilldown-exception">
																		{record.exceptions.join(', ')}
																	</span>
																)}
															</li>
														))}
													</ul>
													{(drilldownQuery.data?.data.period_charges.length ??
														0) > 0 && (
														<div className="mt-1 border-t border-gray-200 pt-1">
															<p className="text-[11px] font-medium text-gray-700">
																Approved period consumption in{' '}
																{formatDate(
																	drilldownQuery.data?.data.month ?? month
																)}
															</p>
															<ul className="space-y-0.5">
																{drilldownQuery.data?.data.period_charges.map(
																	(charge) => (
																		<li
																			key={charge.charge_uid}
																			data-testid="drilldown-charge"
																			data-charge-uid={charge.charge_uid}
																			className="flex flex-wrap items-center gap-x-3 text-[11px] text-gray-600"
																		>
																			<span>
																				{charge.source_expense_number}
																			</span>
																			<span>
																				{CHARGE_BASIS_LABELS[charge.basis] ??
																					charge.basis}
																			</span>
																			<span className="font-medium text-gray-800">
																				{formatCurrencyIn(
																					charge.amount,
																					charge.currency
																				)}
																			</span>
																			<span>
																				{charge.state === 'approved'
																					? 'Approved'
																					: 'Cancelled'}
																			</span>
																		</li>
																	)
																)}
															</ul>
														</div>
													)}
												</div>
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>

			{/* Recorded employee cost (#307, ADR-0016) */}
			<div
				data-testid="payroll-summary"
				data-recorded-total={String(data.payroll.recorded_total)}
				data-estimated-total={String(data.payroll.estimated_total)}
				data-unallocated-total={String(data.payroll.unallocated_total)}
				className="mt-3 rounded-xl border border-gray-200 bg-white"
			>
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
					<p className="text-xs font-semibold text-gray-700">
						Employee cost — recorded Payroll Slip allocation
					</p>
					<p className="text-[11px] text-gray-500">
						Recorded{' '}
						{formatCurrencyIn(
							data.payroll.recorded_total,
							data.payroll.currency
						)}{' '}
						· Estimated{' '}
						{formatCurrencyIn(
							data.payroll.estimated_total,
							data.payroll.currency
						)}{' '}
						· Unallocated{' '}
						{formatCurrencyIn(
							data.payroll.unallocated_total,
							data.payroll.currency
						)}{' '}
						(No project + No logged hours)
					</p>
				</div>
				<div className="grid gap-x-4 gap-y-1 px-3 py-2 text-[11px] text-gray-600 sm:grid-cols-4">
					<span>
						Logged Hours: {formatNumber(data.payroll.total_logged_hours)}
					</span>
					<span>Project Hours: {formatNumber(data.payroll.project_hours)}</span>
					<span>
						No project Hours: {formatNumber(data.payroll.no_project_hours)}
					</span>
					<span>
						Rounding adjustment:{' '}
						{formatCurrencyIn(
							data.payroll.rounding_adjustment,
							data.payroll.currency
						)}
					</span>
				</div>
				<div className="overflow-x-auto border-t border-gray-100">
					<table className="w-full min-w-[900px] text-sm">
						<thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
							<tr>
								<th scope="col" className="px-3 py-2">
									Employee
								</th>
								<th scope="col" className="px-3 py-2">
									Stream
								</th>
								<th scope="col" className="px-3 py-2">
									Status
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Logged Hours
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Recorded
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Estimated
								</th>
								<th scope="col" className="px-3 py-2">
									Source Payroll Slip
								</th>
							</tr>
						</thead>
						<tbody>
							{payrollQuery.isLoading && (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-4 text-center text-xs text-gray-500"
									>
										Loading employee cost…
									</td>
								</tr>
							)}
							{payrollQuery.isError && (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-4 text-center text-xs text-rose-600"
									>
										{errorMessage(payrollQuery.error)}
									</td>
								</tr>
							)}
							{!payrollQuery.isLoading &&
								!payrollQuery.isError &&
								payrollEmployees.length === 0 && (
									<tr>
										<td
											colSpan={7}
											className="px-3 py-4 text-center text-xs text-gray-500"
										>
											No employee cost for {data.month_label}.
										</td>
									</tr>
								)}
							{payrollEmployees.map((employee) => {
								const expanded = expandedEmployee === employee.employee_id;
								const reconstruction = employee.reconstruction;
								return (
									<Fragment key={employee.employee_id}>
										<tr
											data-testid="payroll-employee-row"
											data-employee-code={employee.employee_code}
											data-status={employee.status}
											data-recorded={employee.recorded_amount ?? ''}
											data-estimated={employee.estimated_amount ?? ''}
											data-hours={String(employee.logged_hours)}
											className="border-t border-gray-100"
										>
											<td className="px-3 py-2">
												<div className="flex items-center gap-1.5">
													<button
														type="button"
														data-testid="payroll-employee-expand"
														aria-expanded={expanded}
														onClick={() =>
															setExpandedEmployee(
																expanded ? null : employee.employee_id
															)
														}
														className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
														aria-label={`${expanded ? 'Hide' : 'Show'} Project shares for ${employee.employee_code}`}
													>
														{expanded ? (
															<ChevronDownIcon className="h-4 w-4" />
														) : (
															<ChevronRightIcon className="h-4 w-4" />
														)}
													</button>
													<div>
														<div className="font-medium text-gray-900">
															{employee.employee_name}
														</div>
														<div className="text-[10px] text-gray-500">
															{employee.employee_code}
															{employee.no_logged_hours && ' · No logged hours'}
															{employee.missing_slip && ' · Missing slip'}
															{employee.missing_pricing && ' · Missing pricing'}
															{employee.allocation_missing &&
																' · Allocation missing'}
														</div>
													</div>
												</div>
												{/* #308: reconstruction state and its review controls. Pending
												    and rejected proposals are shown as proposals, never as
												    recorded cost; the controls render only under the same
												    read-gate + operation-privilege conjunction the routes
												    enforce. */}
												{(reconstruction ||
													(employee.allocation_missing &&
														canProposeReconstruction)) && (
													<div className="mt-1 flex flex-wrap items-center gap-1.5">
														{reconstruction && (
															<span
																data-testid={
																	reconstruction.status === 'approved'
																		? 'payroll-reconstruction-badge'
																		: reconstruction.status === 'pending'
																			? 'payroll-reconstruction-pending'
																			: 'payroll-reconstruction-rejected'
																}
																data-status={reconstruction.status}
																data-financial-version={String(
																	reconstruction.financial_version
																)}
																className={
																	reconstruction.status === 'approved'
																		? 'rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-900'
																		: reconstruction.status === 'pending'
																			? 'rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900'
																			: 'rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-900'
																}
															>
																{reconstruction.status === 'approved'
																	? 'Reconstructed'
																	: reconstruction.status === 'pending'
																		? `Reconstruction v${reconstruction.financial_version} · Awaiting review`
																		: `Reconstruction v${reconstruction.financial_version} · Rejected`}
															</span>
														)}
														{reconstruction?.status === 'pending' &&
															canReviewReconstruction && (
																<>
																	<input
																		data-testid="payroll-reconstruction-reason"
																		value={reconstructionReason}
																		onChange={(event) =>
																			setReconstructionReason(
																				event.target.value
																			)
																		}
																		placeholder="Review reason (optional)"
																		className="w-44 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-700"
																	/>
																	<button
																		type="button"
																		data-testid="payroll-reconstruction-approve"
																		disabled={reviewReconstruction.isPending}
																		onClick={() =>
																			reviewReconstruction.mutate({
																				proposalUid:
																					reconstruction.proposal_uid,
																				command: 'approve',
																				expectedVersion:
																					reconstruction.financial_version,
																				reason: reconstructionReason,
																			})
																		}
																		className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
																	>
																		Approve
																	</button>
																	<button
																		type="button"
																		data-testid="payroll-reconstruction-reject"
																		disabled={reviewReconstruction.isPending}
																		onClick={() =>
																			reviewReconstruction.mutate({
																				proposalUid:
																					reconstruction.proposal_uid,
																				command: 'reject',
																				expectedVersion:
																					reconstruction.financial_version,
																				reason: reconstructionReason,
																			})
																		}
																		className="rounded border border-rose-300 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
																	>
																		Reject
																	</button>
																</>
															)}
														{!reconstruction &&
															employee.allocation_missing &&
															canProposeReconstruction && (
																<button
																	type="button"
																	data-testid="payroll-reconstruction-propose"
																	disabled={
																		proposeReconstruction.isPending ||
																		employee.source.payroll_slip_id === null
																	}
																	onClick={() => {
																		if (
																			employee.source.payroll_slip_id !== null
																		) {
																			proposeReconstruction.mutate(
																				employee.source.payroll_slip_id
																			);
																		}
																	}}
																	className="rounded border border-[#64126D] px-1.5 py-0.5 text-[10px] font-medium text-[#64126D] hover:bg-[#64126D]/5 disabled:opacity-60"
																>
																	Propose reconstruction
																</button>
															)}
													</div>
												)}
												{reconstructionError && (
													<div className="mt-0.5 text-[10px] text-rose-600">
														{errorMessage(reconstructionError)}
													</div>
												)}
											</td>
											<td className="px-3 py-2 text-xs capitalize text-gray-600">
												{employee.pay_stream}
											</td>
											<td className="px-3 py-2 text-xs">
												<span
													className={
														employee.status === 'recorded'
															? 'rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900'
															: employee.status === 'estimated'
																? 'rounded bg-amber-100 px-1.5 py-0.5 text-amber-900'
																: 'rounded bg-gray-100 px-1.5 py-0.5 text-gray-700'
													}
												>
													{PAYROLL_STATUS_LABELS[employee.status] ??
														employee.status}
												</span>
											</td>
											<td className="px-3 py-2 text-right tabular-nums text-gray-700">
												{formatNumber(employee.logged_hours)}
											</td>
											<td className="px-3 py-2 text-right font-semibold text-gray-900">
												{employee.recorded_amount === null
													? '—'
													: formatCurrencyIn(
															employee.recorded_amount,
															data.payroll.currency
														)}
											</td>
											<td className="px-3 py-2 text-right text-gray-600">
												{employee.estimated_amount === null
													? '—'
													: formatCurrencyIn(
															employee.estimated_amount,
															data.payroll.currency
														)}
											</td>
											<td className="px-3 py-2 text-xs text-gray-600">
												{employee.source.payroll_slip_id === null
													? 'No Payroll Slip'
													: `Slip #${employee.source.payroll_slip_id}${
															employee.source.allocation_version
																? ` · allocation v${employee.source.allocation_version}`
																: ''
														}${
															employee.source.allocation_kind ===
															'reconstruction'
																? ' · reconstructed'
																: employee.source.allocation_kind === 'revision'
																	? ' · revised'
																	: ''
														}`}
											</td>
										</tr>
										{expanded && (
											<tr key={`${employee.employee_id}-shares`}>
												<td colSpan={7} className="bg-gray-50/70 px-3 py-2">
													<p className="mb-1 text-xs font-semibold text-gray-700">
														Project shares for {employee.employee_code}
													</p>
													<table className="w-full text-xs">
														<thead>
															<tr className="text-left text-gray-500">
																<th className="py-1 pr-3 font-medium">
																	Destination
																</th>
																<th className="py-1 pr-3 text-right font-medium">
																	Hours
																</th>
																<th className="py-1 pr-3 text-right font-medium">
																	Amount
																</th>
																<th className="py-1 pr-3 text-right font-medium">
																	Rounding
																</th>
																<th className="py-1 font-medium">Basis</th>
															</tr>
														</thead>
														<tbody>
															{employee.shares.map((share, index) => (
																<tr
																	key={`${share.project_id ?? share.basis}-${index}`}
																	data-testid="payroll-share-row"
																	data-project-code={share.project_code ?? ''}
																	data-hours={String(share.hours)}
																	data-amount={String(share.amount)}
																	data-adjustment={String(
																		share.rounding_adjustment
																	)}
																	data-basis={share.basis}
																>
																	<td className="py-1 pr-3 text-gray-800">
																		{share.project_id === null
																			? share.basis === 'no_project'
																				? 'No project'
																				: 'No logged hours'
																			: `${share.project_code} — ${share.project_name ?? ''}`}
																	</td>
																	<td className="py-1 pr-3 text-right tabular-nums">
																		{formatNumber(share.hours)}
																	</td>
																	<td className="py-1 pr-3 text-right tabular-nums font-medium">
																		{formatCurrencyIn(
																			share.amount,
																			data.payroll.currency
																		)}
																	</td>
																	<td className="py-1 pr-3 text-right tabular-nums text-gray-500">
																		{share.rounding_adjustment === 0
																			? '—'
																			: formatCurrencyIn(
																					share.rounding_adjustment,
																					data.payroll.currency
																				)}
																	</td>
																	<td className="py-1 text-gray-500">
																		{share.basis === 'project'
																			? 'Logged Hours'
																			: share.basis === 'no_project'
																				? 'Unallocated · No project'
																				: 'Unallocated · No logged hours'}
																	</td>
																</tr>
															))}
														</tbody>
													</table>
													{/* #308: reconstruction evidence, distinct from an original
													    finalization-time snapshot: what was reconstructed,
													    from which evidence, when, by whom, and what stays
													    limited. A pending proposal states its proposed shares
													    and never claims they are recorded cost. */}
													{reconstruction && (
														<div
															data-testid="payroll-reconstruction-evidence"
															data-status={reconstruction.status}
															data-financial-version={String(
																reconstruction.financial_version
															)}
															data-reconstructed-at={
																reconstruction.proposed_at ?? ''
															}
															data-proposed-by={
																reconstruction.proposed_by_name ?? ''
															}
															data-reviewed-at={
																reconstruction.reviewed_at ?? ''
															}
															data-reviewed-by={
																reconstruction.reviewed_by_name ?? ''
															}
															data-missing-evidence={reconstruction.missing_evidence
																.map((entry) => entry.code)
																.join(',')}
															className="mt-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5"
														>
															<p className="text-[11px] font-semibold text-amber-900">
																Reconstruction evidence — reconstructed, not the
																original finalization-time attribution
															</p>
															<p className="text-[11px] text-amber-900/80">
																Proposed {reconstruction.proposed_at ?? '—'} by{' '}
																{reconstruction.proposed_by_name ?? 'unknown'} ·{' '}
																{reconstruction.status === 'pending'
																	? 'awaiting review'
																	: `${reconstruction.status} on ${
																			reconstruction.reviewed_at ?? '—'
																		} by ${
																			reconstruction.reviewed_by_name ??
																			'unknown'
																		}`}
																{reconstruction.review_reason
																	? ` · ${reconstruction.review_reason}`
																	: ''}
															</p>
															<p className="text-[11px] text-amber-900/80">
																Recorded employer cost{' '}
																{formatCurrencyIn(
																	reconstruction.recorded_employer_cost,
																	data.payroll.currency
																)}{' '}
																against{' '}
																{formatNumber(
																	reconstruction.total_logged_hours
																)}{' '}
																Logged Hours; this evidence was not stored at
																the slip&apos;s original finalization.
															</p>
															{reconstruction.missing_evidence.length > 0 && (
																<ul className="mt-1 list-disc pl-4 text-[11px] text-amber-900">
																	{reconstruction.missing_evidence.map(
																		(entry) => (
																			<li key={entry.code}>{entry.detail}</li>
																		)
																	)}
																</ul>
															)}
															{reconstruction.status === 'pending' &&
																reconstruction.shares.length > 0 && (
																	<div className="mt-1">
																		<p className="text-[11px] font-medium text-amber-900">
																			Proposed shares (not recorded until
																			approved)
																		</p>
																		<table className="w-full text-xs">
																			<tbody>
																				{reconstruction.shares.map(
																					(share, index) => (
																						<tr
																							key={`${share.project_id ?? share.basis}-${index}`}
																							data-testid="payroll-reconstruction-share-row"
																							data-project-code={
																								share.project_code ?? ''
																							}
																							data-hours={String(share.hours)}
																							data-amount={String(share.amount)}
																							data-adjustment={String(
																								share.rounding_adjustment
																							)}
																							data-basis={share.basis}
																							className="text-amber-900"
																						>
																							<td className="py-0.5 pr-3">
																								{share.project_id === null
																									? share.basis === 'no_project'
																										? 'No project'
																										: 'No logged hours'
																									: `${share.project_code} — ${
																											share.project_name ?? ''
																										}`}
																							</td>
																							<td className="py-0.5 pr-3 text-right tabular-nums">
																								{formatNumber(share.hours)} h
																							</td>
																							<td className="py-0.5 text-right tabular-nums font-medium">
																								{formatCurrencyIn(
																									share.amount,
																									data.payroll.currency
																								)}
																							</td>
																						</tr>
																					)
																				)}
																			</tbody>
																		</table>
																	</div>
																)}
														</div>
													)}
													{employee.source.allocation_id !== null &&
														employee.source.payroll_slip_id !== null && (
															<AllocationRevisionPanel
																slipId={employee.source.payroll_slip_id}
																employee={employee}
																projectOptions={data.project_options}
																currency={data.payroll.currency}
																canRevise={canRevise}
															/>
														)}
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>

			{/* Recognition queue */}
			<div
				data-testid="recognition-queue"
				className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white"
			>
				<div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
					<p className="text-xs font-semibold text-gray-700">
						Not yet confirmed cost ({queue.length})
					</p>
					<p className="text-[11px] text-gray-500">
						Drafts and pending evidence are excluded from the totals above.
					</p>
				</div>
				{queue.length === 0 ? (
					<p className="px-3 py-4 text-center text-xs text-gray-500">
						Nothing awaiting recognition for {data.month_label}.
					</p>
				) : (
					<table className="w-full min-w-[720px] text-sm">
						<thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
							<tr>
								<th scope="col" className="px-3 py-2">
									Source
								</th>
								<th scope="col" className="px-3 py-2">
									Destination
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Gross
								</th>
								<th scope="col" className="px-3 py-2">
									Period
								</th>
								<th scope="col" className="px-3 py-2">
									State
								</th>
								<th scope="col" className="px-3 py-2">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{queue.map((record) => (
								<tr
									key={`${record.source}-${record.id}-${record.split?.id ?? 0}`}
									data-testid="queue-row"
									data-state={record.recognition_state}
									data-source-reference={record.source_reference ?? ''}
									className="border-t border-gray-100"
								>
									<td className="px-3 py-2">
										<div className="font-medium text-gray-900">
											{record.source_reference ?? record.expense_number}
										</div>
										<div className="text-xs text-gray-500">
											{record.vendor_name ?? '—'}
										</div>
									</td>
									<td className="px-3 py-2 text-xs text-gray-600">
										{record.cost_classification
											? CLASSIFICATION_LABELS[record.cost_classification]
											: 'Unresolved'}
										{record.project_code ? ` · ${record.project_code}` : ''}
									</td>
									<td className="px-3 py-2 text-right text-gray-900">
										{record.gross_amount === null
											? 'Amount unknown'
											: formatSourceMoney(record.gross_amount, record.currency)}
									</td>
									<td className="px-3 py-2 text-xs text-gray-600">
										{record.recognition_period
											? `${formatDate(record.recognition_period)} (${
													PERIOD_BASIS_LABELS[record.period_basis] ??
													record.period_basis
												})`
											: 'No recognition period'}
									</td>
									<td className="px-3 py-2 text-xs">
										<span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
											{STATE_LABELS[record.recognition_state] ??
												record.recognition_state}
										</span>
									</td>
									<td className="px-3 py-2">
										<div className="flex flex-wrap items-center gap-1.5">
											{record.source !== 'direct_expense' ? (
												// IDs come from different stores: another source's
												// row is never commanded through this register's
												// command path. Its recognition workflow lives in
												// its own register.
												<a
													href={SOURCE_REGISTER_LINKS[record.source]}
													data-testid="queue-source-link"
													className="text-xs font-medium text-[#64126D] underline"
												>
													{SOURCE_REGISTER_LABELS[record.source] ??
														`Source: ${record.source}`}
												</a>
											) : (
												<>
													{canEditCost && (
														<button
															type="button"
															data-testid="queue-edit"
															onClick={() => {
																commandMutation.reset();
																setEditTarget(record);
															}}
															className="rounded border border-[#64126D]/40 bg-[#64126D]/5 px-2 py-1 text-xs font-medium text-[#64126D] hover:bg-[#64126D]/10"
														>
															Edit
														</button>
													)}
													{canRecognize ? (
														<>
															<button
																type="button"
																onClick={() => {
																	commandMutation.reset();
																	setCommandTarget({
																		record,
																		command: 'recognize',
																	});
																}}
																className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
															>
																Recognize
															</button>
															<button
																type="button"
																onClick={() => {
																	commandMutation.reset();
																	setCommandTarget({
																		record,
																		command: 'reject',
																	});
																}}
																className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
															>
																Reject
															</button>
															<button
																type="button"
																onClick={() => {
																	commandMutation.reset();
																	setCommandTarget({
																		record,
																		command: 'cancel',
																	});
																}}
																className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
															>
																Cancel cost
															</button>
														</>
													) : (
														<span className="text-xs text-gray-400">
															Recognition needs approval access
														</span>
													)}
												</>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			{/* Approved cost budget (#321). Its own section: a budget never
			    enters the cost totals above, and the comparison states its own
			    basis, exclusions, and version history. */}
			<BudgetSection
				month={month}
				section={data.budgets}
				projectOptions={data.project_options}
				canManage={canEditCost}
				canApprove={canRecognize}
			/>

			{/* Dated outward cash paid (#318). Its own section: a payment never
			    enters the cost totals above, funding sits outside paid, and
			    legacy gaps are disclosed, never counted. */}
			<CashSection
				month={month}
				section={data.cash}
				canRecord={canRecordSettlement}
			/>

			{/* Financial close (#322). Its own section: an open month states
			    its review, a closed month states its frozen totals, and the
			    close command freezes the month against ordinary writes. The
			    close state rides on the reconciliation response (same pattern
			    as the cash section), never a second per-mount request. */}
			<CloseSection
				month={month}
				canClose={canCloseMonth}
				initialClose={reconciliationQuery.data?.close ?? null}
			/>

			<p className="mt-2 flex items-center gap-1.5 text-[10px] leading-relaxed text-gray-500">
				<BanknotesIcon className="h-3 w-3" />
				Company Incurred Cost = Incurred Project Cost + Company Overhead +
				Unallocated Cost. Recognition uses the received-work or service period;
				a bill date is a disclosed fallback and a payment date never creates
				cost.
			</p>

			{formOpen && (
				<CostForm
					projectOptions={data.project_options}
					month={month}
					submitting={createMutation.isPending}
					error={
						createMutation.isError ? errorMessage(createMutation.error) : null
					}
					onCancel={() => {
						createMutation.reset();
						setFormOpen(false);
					}}
					onSubmit={(payload) => createMutation.mutate(payload)}
				/>
			)}

			{editTarget && (
				<CostEditDialog
					record={editTarget}
					projectOptions={data.project_options}
					submitting={commandMutation.isPending}
					canApprove={canRecognize}
					error={
						commandMutation.isError ? errorMessage(commandMutation.error) : null
					}
					onCancel={() => {
						commandMutation.reset();
						setEditTarget(null);
					}}
					onSubmit={(patch) =>
						commandMutation.mutate({
							id: editTarget.id,
							command: 'update',
							expectedVersion: editTarget.financial_version,
							patch,
						})
					}
				/>
			)}

			{commandTarget && liveCommandRecord && (
				<CommandDialog
					record={liveCommandRecord}
					command={commandTarget.command}
					submitting={commandMutation.isPending}
					error={
						commandMutation.isError ? errorMessage(commandMutation.error) : null
					}
					onCancel={() => {
						commandMutation.reset();
						setCommandTarget(null);
					}}
					onConfirm={(reason) => {
						void (async () => {
							// The queue refetch triggered by the pending-cost correction
							// can still be in flight when the operator confirms: the
							// 961c137 trace shows the recognize POST starting before
							// the queue GET finishes, so the cached live record is
							// still the pre-edit version and the command fails with a
							// spurious version_conflict the operator did not cause.
							// Re-read the queue before stating the version. A genuine
							// concurrent change after this read still returns 409,
							// stays open, and surfaces the refusal inline.
							try {
								const fresh = await queueQuery.refetch();
								const records = fresh.data?.data.records ?? queue;
								const current =
									records.find(
										(record) =>
											record.id === commandTarget.record.id &&
											record.source === commandTarget.record.source &&
											(record.split?.id ?? 0) ===
												(commandTarget.record.split?.id ?? 0)
									) ?? liveCommandRecord;
								commandMutation.mutate({
									id: current.id,
									command: commandTarget.command,
									expectedVersion: current.financial_version,
									reason,
								});
							} catch {
								commandMutation.mutate({
									id: liveCommandRecord.id,
									command: commandTarget.command,
									expectedVersion: liveCommandRecord.financial_version,
									reason,
								});
							}
						})();
					}}
				/>
			)}

			{chargeTarget && (
				<PeriodChargeDialog
					item={chargeTarget}
					submitting={chargeMutation.isPending}
					error={
						chargeMutation.isError ? errorMessage(chargeMutation.error) : null
					}
					onCancel={() => {
						chargeMutation.reset();
						setChargeTarget(null);
					}}
					onSubmit={(payload) =>
						chargeMutation.mutate({
							sourceId: chargeTarget.expense_id,
							payload,
						})
					}
				/>
			)}

			{cancelChargeTarget && (
				<ChargeCancelDialog
					charge={cancelChargeTarget}
					submitting={cancelChargeMutation.isPending}
					error={
						cancelChargeMutation.isError
							? errorMessage(cancelChargeMutation.error)
							: null
					}
					onCancel={() => {
						cancelChargeMutation.reset();
						setCancelChargeTarget(null);
					}}
					onConfirm={(reason) =>
						cancelChargeMutation.mutate({
							sourceId: cancelChargeTarget.source_expense_id,
							chargeUid: cancelChargeTarget.charge_uid,
							expectedVersion: cancelChargeTarget.financial_version,
							reason,
						})
					}
				/>
			)}
		</div>
	);
}

interface CostFormProps {
	month: string;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
	}>;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onSubmit: (payload: Record<string, unknown>) => void;
}

/** Entry control for one direct cost. */
function CostForm({
	month,
	projectOptions,
	submitting,
	error,
	onCancel,
	onSubmit,
}: CostFormProps) {
	const [classification, setClassification] = useState('project');
	const [nature, setNature] = useState('operating');
	const [projectId, setProjectId] = useState('');
	const [sourceReference, setSourceReference] = useState('');
	const [vendor, setVendor] = useState('');
	const [description, setDescription] = useState('');
	const [serviceStart, setServiceStart] = useState('');
	const [serviceEnd, setServiceEnd] = useState('');
	const [billDate, setBillDate] = useState('');
	const [currency, setCurrency] = useState('INR');
	const [reportingCurrencyChoice, setReportingCurrencyChoice] = useState('INR');
	const [conversionRate, setConversionRate] = useState('');
	const [conversionDate, setConversionDate] = useState('');
	const [conversionEvidence, setConversionEvidence] = useState('');
	const [grossAmount, setGrossAmount] = useState('');
	const [taxAmount, setTaxAmount] = useState('');
	const [taxTreatment, setTaxTreatment] = useState('none');
	const [taxEvidence, setTaxEvidence] = useState('');
	const [evidenceReference, setEvidenceReference] = useState('');
	const [submit, setSubmit] = useState(true);

	const projectControlOptions = projectOptions.map((option) => ({
		value: String(option.project_id),
		label: `${option.project_code} — ${option.project_name}`,
	}));

	const buildPayload = (submitForRecognition: boolean) => ({
		category: 'Direct Expense',
		description: description || null,
		vendor_name: vendor || null,
		expense_date: billDate || serviceStart || `${month}-01`,
		cost_classification: classification || null,
		cost_nature: nature,
		project_id:
			classification === 'project' && projectId ? Number(projectId) : null,
		service_period_start: serviceStart || null,
		service_period_end: serviceEnd || serviceStart || null,
		bill_date: billDate || null,
		currency,
		reporting_currency: reportingCurrencyChoice,
		conversion_rate:
			currency === reportingCurrencyChoice ? null : conversionRate || null,
		conversion_date:
			currency === reportingCurrencyChoice ? null : conversionDate || null,
		conversion_evidence_reference:
			currency === reportingCurrencyChoice ? null : conversionEvidence || null,
		gross_amount: grossAmount === '' ? null : Number(grossAmount),
		tax_amount: taxAmount === '' ? 0 : Number(taxAmount),
		tax_treatment: taxTreatment,
		tax_evidence_reference: taxEvidence || null,
		source_reference: sourceReference || null,
		evidence_reference: evidenceReference || null,
		submit: submitForRecognition,
	});

	// Evidence typed for one pair is not evidence for another: clearing it on a
	// pair change keeps the typed rate from being attached to a new currency.
	const changeCurrency = (next: string) => {
		setCurrency(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};
	const changeReportingCurrency = (next: string) => {
		setReportingCurrencyChoice(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<form
				data-testid="cost-form"
				role="dialog"
				aria-modal="true"
				aria-label="Record cost"
				className="mt-8 w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit(buildPayload(submit));
				}}
			>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-base font-semibold text-gray-900">Record cost</h2>
					<button
						type="button"
						onClick={onCancel}
						aria-label="Close"
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-4 w-4" />
					</button>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Destination
						</span>
						<select
							aria-label="Classification"
							value={classification}
							onChange={(event) => setClassification(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="project">Project</option>
							<option value="company_overhead">Company Overhead</option>
							<option value="unallocated">Unallocated Cost</option>
							<option value="">Not yet classified</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							What the spend is
						</span>
						<select
							aria-label="Nature"
							value={nature}
							onChange={(event) => setNature(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{NATURE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{classification === 'project' && (
						<div className="text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Project
							</span>
							<SearchableSelect
								options={projectControlOptions}
								value={projectId}
								onChange={(value) => setProjectId(String(value))}
								placeholder="Select project…"
								aria-label="Project"
							/>
						</div>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Source reference
						</span>
						<input
							aria-label="Source reference"
							value={sourceReference}
							onChange={(event) => setSourceReference(event.target.value)}
							placeholder="Invoice or bill number"
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">Vendor</span>
						<input
							aria-label="Vendor"
							value={vendor}
							onChange={(event) => setVendor(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm md:col-span-2">
						<span className="mb-1 block font-medium text-gray-700">
							Description
						</span>
						<input
							aria-label="Description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period start
						</span>
						<input
							type="date"
							aria-label="Service period start"
							value={serviceStart}
							onChange={(event) => setServiceStart(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period end
						</span>
						<input
							type="date"
							aria-label="Service period end"
							value={serviceEnd}
							onChange={(event) => setServiceEnd(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Bill date
						</span>
						<input
							type="date"
							aria-label="Bill date"
							value={billDate}
							onChange={(event) => setBillDate(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Currency
						</span>
						<select
							aria-label="Currency"
							value={currency}
							onChange={(event) => changeCurrency(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Reporting currency
						</span>
						<select
							aria-label="Reporting currency"
							value={reportingCurrencyChoice}
							onChange={(event) => changeReportingCurrency(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					{currency !== reportingCurrencyChoice && (
						<>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion rate
								</span>
								<input
									aria-label="Conversion rate"
									value={conversionRate}
									onChange={(event) => setConversionRate(event.target.value)}
									placeholder={`1 ${currency} in ${reportingCurrencyChoice}`}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion date
								</span>
								<input
									type="date"
									aria-label="Conversion date"
									value={conversionDate}
									onChange={(event) => setConversionDate(event.target.value)}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion evidence reference
								</span>
								<input
									aria-label="Conversion evidence reference"
									value={conversionEvidence}
									onChange={(event) =>
										setConversionEvidence(event.target.value)
									}
									placeholder="Contract, bank advice, or rate source"
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
								/>
							</label>
						</>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Gross amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Gross amount"
							value={grossAmount}
							onChange={(event) => setGrossAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Tax amount"
							value={taxAmount}
							onChange={(event) => setTaxAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax treatment
						</span>
						<select
							aria-label="Tax treatment"
							value={taxTreatment}
							onChange={(event) => setTaxTreatment(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="none">No tax recorded</option>
							<option value="recoverable">Recoverable (with evidence)</option>
							<option value="non_recoverable">Non-recoverable (in cost)</option>
							<option value="unresolved">Unresolved</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax evidence reference
						</span>
						<input
							aria-label="Tax evidence reference"
							value={taxEvidence}
							onChange={(event) => setTaxEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							aria-label="Evidence reference"
							value={evidenceReference}
							onChange={(event) => setEvidenceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>

				<p className="mt-2 text-[11px] text-gray-500">
					Cost is recognized in the month the work or service is received. Leave
					the service period empty only when the bill date is the best available
					evidence — it is recorded as a fallback. An advance, deposit,
					prepayment, or capital item is not expensed by its payment: its
					approved period consumption is captured from the report.
				</p>

				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}

				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						onClick={() => setSubmit(false)}
						disabled={submitting}
						className="rounded-lg border border-[#64126D] px-3 py-2 text-sm font-medium text-[#64126D] hover:bg-[#64126D]/5 disabled:opacity-50"
					>
						Save draft
					</button>
					<button
						type="submit"
						onClick={() => setSubmit(true)}
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Save and submit
					</button>
				</div>
			</form>
		</div>
	);
}

interface CostEditDialogProps {
	record: CostRecordJson;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
	}>;
	submitting: boolean;
	error: string | null;
	/** `other_expenses:approve` — the currency pair and its evidence are approval acts. */
	canApprove: boolean;
	onCancel: () => void;
	onSubmit: (patch: Record<string, unknown>) => void;
}

/**
 * Correct an open (draft or pending-evidence) cost through the versioned
 * `update` command: amount, destination, recognition period, tax, and
 * evidence. Without this control a cost recorded with an unknown amount could
 * never be completed — the operator would have to cancel and re-record it.
 * The patch carries the version the queue row was read at, so a concurrent
 * change fails as a version conflict instead of silently overwriting.
 */
function CostEditDialog({
	record,
	projectOptions,
	submitting,
	error,
	canApprove,
	onCancel,
	onSubmit,
}: CostEditDialogProps) {
	const [classification, setClassification] = useState(
		record.cost_classification ?? ''
	);
	const [nature, setNature] = useState(record.cost_nature ?? 'operating');
	const [projectId, setProjectId] = useState(
		record.project_id === null ? '' : String(record.project_id)
	);
	const [sourceReference, setSourceReference] = useState(
		record.source_reference ?? ''
	);
	const [serviceStart, setServiceStart] = useState(
		record.service_period_start ?? ''
	);
	const [serviceEnd, setServiceEnd] = useState(record.service_period_end ?? '');
	const [billDate, setBillDate] = useState(record.expense_date ?? '');
	// A NULL original currency stays empty: it is unknown, and the operator
	// must choose a real code rather than have INR assumed for them.
	const [currency, setCurrency] = useState(record.currency ?? '');
	const [reportingCurrencyChoice, setReportingCurrencyChoice] = useState(
		record.reporting_currency ?? 'INR'
	);
	const [conversionRate, setConversionRate] = useState(
		record.conversion_rate ?? ''
	);
	const [conversionDate, setConversionDate] = useState(
		record.conversion_date ?? ''
	);
	const [conversionEvidence, setConversionEvidence] = useState(
		record.conversion_evidence_reference ?? ''
	);
	const [grossAmount, setGrossAmount] = useState(
		record.gross_amount === null ? '' : String(record.gross_amount)
	);
	const [taxAmount, setTaxAmount] = useState(
		record.tax_amount === null ? '' : String(record.tax_amount)
	);
	const [taxTreatment, setTaxTreatment] = useState(record.tax_treatment);
	const [taxEvidence, setTaxEvidence] = useState(
		record.tax_evidence_reference ?? ''
	);
	const [evidenceReference, setEvidenceReference] = useState(
		record.evidence_reference ?? ''
	);

	const projectControlOptions = projectOptions.map((option) => ({
		value: String(option.project_id),
		label: `${option.project_code} — ${option.project_name}`,
	}));

	// A stored rate is evidence for the pair it was recorded against. Changing
	// either side clears it here, so the dialog never re-sends an old pair's
	// rate for a new pair; fresh evidence (or none) is the operator's explicit
	// statement, and the server refuses a convertible pair without it.
	const changeCurrency = (next: string) => {
		setCurrency(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};
	const changeReportingCurrency = (next: string) => {
		setReportingCurrencyChoice(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};

	const buildPatch = () => ({
		classification: classification || null,
		nature,
		projectId:
			classification === 'project' && projectId ? Number(projectId) : null,
		servicePeriodStart: serviceStart || null,
		servicePeriodEnd: serviceEnd || null,
		billDate: billDate || null,
		currency: currency || null,
		reportingCurrency: reportingCurrencyChoice,
		conversionRate:
			!currency || currency === reportingCurrencyChoice
				? null
				: conversionRate || null,
		conversionDate:
			!currency || currency === reportingCurrencyChoice
				? null
				: conversionDate || null,
		conversionEvidenceReference:
			!currency || currency === reportingCurrencyChoice
				? null
				: conversionEvidence || null,
		grossAmount: grossAmount === '' ? null : Number(grossAmount),
		taxAmount: taxAmount === '' ? null : Number(taxAmount),
		taxTreatment,
		taxEvidenceReference: taxEvidence || null,
		sourceReference: sourceReference || null,
		evidenceReference: evidenceReference || null,
	});

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<form
				data-testid="cost-edit-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Correct cost"
				className="mt-8 w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit(buildPatch());
				}}
			>
				<div className="mb-3 flex items-start justify-between">
					<div>
						<h2 className="text-base font-semibold text-gray-900">
							Correct cost
						</h2>
						<p className="text-xs text-gray-500">
							{record.source_reference ?? record.expense_number} · version{' '}
							{record.financial_version}. Saving applies a versioned `update`
							with its own journal entry.
						</p>
					</div>
					<button
						type="button"
						onClick={onCancel}
						aria-label="Close"
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-4 w-4" />
					</button>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Destination
						</span>
						<select
							aria-label="Classification"
							value={classification}
							onChange={(event) => setClassification(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="project">Project</option>
							<option value="company_overhead">Company Overhead</option>
							<option value="unallocated">Unallocated Cost</option>
							<option value="">Not yet classified</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							What the spend is
						</span>
						<select
							aria-label="Nature"
							value={nature}
							onChange={(event) => {
								const next = event.target.value;
								if (isCostNature(next)) setNature(next);
							}}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{NATURE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{classification === 'project' && (
						<div className="text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Project
							</span>
							<SearchableSelect
								options={projectControlOptions}
								value={projectId}
								onChange={(value) => setProjectId(String(value))}
								placeholder="Select project…"
								aria-label="Project"
							/>
						</div>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Source reference
						</span>
						<input
							aria-label="Source reference"
							value={sourceReference}
							onChange={(event) => setSourceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Currency
						</span>
						<select
							aria-label="Currency"
							value={currency}
							onChange={(event) => changeCurrency(event.target.value)}
							disabled={!canApprove}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
						>
							<option value="">Unknown (not guessed)</option>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Reporting currency
						</span>
						<select
							aria-label="Reporting currency"
							value={reportingCurrencyChoice}
							onChange={(event) => changeReportingCurrency(event.target.value)}
							disabled={!canApprove}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					{currency !== '' && currency !== reportingCurrencyChoice && (
						<>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion rate
								</span>
								<input
									aria-label="Conversion rate"
									value={conversionRate}
									onChange={(event) => setConversionRate(event.target.value)}
									disabled={!canApprove}
									placeholder={`1 ${currency} in ${reportingCurrencyChoice}`}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion date
								</span>
								<input
									type="date"
									aria-label="Conversion date"
									value={conversionDate}
									onChange={(event) => setConversionDate(event.target.value)}
									disabled={!canApprove}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion evidence reference
								</span>
								<input
									aria-label="Conversion evidence reference"
									value={conversionEvidence}
									onChange={(event) =>
										setConversionEvidence(event.target.value)
									}
									disabled={!canApprove}
									placeholder="Contract, bank advice, or rate source"
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
								/>
							</label>
						</>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Gross amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Gross amount"
							value={grossAmount}
							onChange={(event) => setGrossAmount(event.target.value)}
							placeholder="Leave empty while unknown"
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Tax amount"
							value={taxAmount}
							onChange={(event) => setTaxAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period start
						</span>
						<input
							type="date"
							aria-label="Service period start"
							value={serviceStart}
							onChange={(event) => setServiceStart(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period end
						</span>
						<input
							type="date"
							aria-label="Service period end"
							value={serviceEnd}
							onChange={(event) => setServiceEnd(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Bill date
						</span>
						<input
							type="date"
							aria-label="Bill date"
							value={billDate}
							onChange={(event) => setBillDate(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax treatment
						</span>
						<select
							aria-label="Tax treatment"
							value={taxTreatment}
							onChange={(event) =>
								setTaxTreatment(event.target.value as typeof taxTreatment)
							}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="none">No tax recorded</option>
							<option value="recoverable">Recoverable (with evidence)</option>
							<option value="non_recoverable">Non-recoverable (in cost)</option>
							<option value="unresolved">Unresolved</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax evidence reference
						</span>
						<input
							aria-label="Tax evidence reference"
							value={taxEvidence}
							onChange={(event) => setTaxEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							aria-label="Evidence reference"
							value={evidenceReference}
							onChange={(event) => setEvidenceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>

				<p className="mt-2 text-[11px] text-gray-500">
					Saving corrects the cost in place. It cannot change a recognized cost
					— cancel that cost first and record the correction as a new one.
				</p>

				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}

				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Save changes
					</button>
				</div>
			</form>
		</div>
	);
}

interface CommandDialogProps {
	record: CostRecordJson;
	command: 'recognize' | 'reject' | 'cancel';
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}

/** Reasoned confirmation for a recognition command. */
function CommandDialog({
	record,
	command,
	submitting,
	error,
	onCancel,
	onConfirm,
}: CommandDialogProps) {
	const [reason, setReason] = useState('');
	const label =
		command === 'recognize'
			? 'Recognize expense'
			: command === 'reject'
				? 'Reject expense'
				: 'Cancel expense';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="command-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm(reason);
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">{label}</h2>
				<p className="mt-1 text-xs text-gray-600">
					{record.source_reference ?? record.expense_number} ·{' '}
					{STATE_LABELS[record.recognition_state] ?? record.recognition_state} ·
					version {record.financial_version}
				</p>
				<label className="mt-3 block text-sm">
					<span className="mb-1 block font-medium text-gray-700">Reason</span>
					<textarea
						aria-label="Reason"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						rows={3}
						className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						placeholder={
							command === 'recognize'
								? 'Evidence reviewed'
								: 'Why this cost must not be confirmed cost'
						}
					/>
				</label>
				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						{label}
					</button>
				</div>
			</form>
		</div>
	);
}

interface PeriodChargeDialogProps {
	item: NonOperatingItemRow;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onSubmit: (payload: Record<string, unknown>) => void;
}

/**
 * Capture one approved period charge against a non-operating item (#317). The
 * charge's own month decides when it becomes cost, and the item's remaining
 * supported balance is the ceiling the module enforces — the dialog states
 * both so the operator sees why a refusal happens.
 */
function PeriodChargeDialog({
	item,
	submitting,
	error,
	onCancel,
	onSubmit,
}: PeriodChargeDialogProps) {
	const [period, setPeriod] = useState(
		item.recognition_period?.slice(0, 7) ?? ''
	);
	const [basis, setBasis] = useState('consumption');
	const [amount, setAmount] = useState('');
	const [evidence, setEvidence] = useState('');
	const [note, setNote] = useState('');
	// A missing amount is unknown, never zero.
	const balance =
		item.recognized_amount === null
			? 'unknown'
			: formatCurrencyIn(item.recognized_amount, item.currency);
	const remaining =
		item.remaining_amount === null
			? 'unknown'
			: formatCurrencyIn(item.remaining_amount, item.currency);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="period-charge-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Capture period charge"
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit({
						period,
						basis,
						amount: amount === '' ? null : Number(amount),
						evidence_reference: evidence || null,
						currency: item.currency,
						reason: note || null,
					});
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">
					Capture period charge
				</h2>
				<p className="mt-1 text-xs text-gray-600">
					{item.source_reference ?? item.expense_number} ·{' '}
					{NATURE_LABELS[item.nature] ?? item.nature} · supported balance{' '}
					{balance} · remaining {remaining}
				</p>
				<div className="mt-3 grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Charge period
						</span>
						<input
							type="month"
							aria-label="Period"
							value={period}
							onChange={(event) => setPeriod(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">Basis</span>
						<select
							aria-label="Charge basis"
							value={basis}
							onChange={(event) => setBasis(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="consumption">Consumption</option>
							<option value="depreciation">Depreciation</option>
							<option value="amortization">Amortization</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Amount ({item.currency})
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Amount"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							aria-label="Evidence reference"
							value={evidence}
							onChange={(event) => setEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm md:col-span-2">
						<span className="mb-1 block font-medium text-gray-700">Note</span>
						<input
							aria-label="Note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>
				<p className="mt-2 text-[11px] text-gray-500">
					The charge becomes cost in its own month and can never exceed the
					remaining supported balance. A month and basis can hold one approved
					charge; cancel it to correct the entry.
				</p>
				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Save period charge
					</button>
				</div>
			</form>
		</div>
	);
}

interface ChargeCancelDialogProps {
	charge: PeriodChargeJson;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}

/**
 * Cancel an approved period charge. The reason and the version are required:
 * cancellation restores the consumed balance, keeps the charge and its journal
 * as history, and is the supported way to correct a wrong amount or month.
 */
function ChargeCancelDialog({
	charge,
	submitting,
	error,
	onCancel,
	onConfirm,
}: ChargeCancelDialogProps) {
	const [reason, setReason] = useState('');

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="charge-cancel-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Cancel period charge"
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm(reason);
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">
					Cancel period charge
				</h2>
				<p className="mt-1 text-xs text-gray-600">
					{charge.source_expense_number} ·{' '}
					{CHARGE_BASIS_LABELS[charge.basis] ?? charge.basis} ·{' '}
					{formatCurrencyIn(charge.amount, charge.currency)} ·{' '}
					{formatDate(charge.period)} · version {charge.financial_version}
				</p>
				<label className="mt-3 block text-sm">
					<span className="mb-1 block font-medium text-gray-700">Reason</span>
					<textarea
						aria-label="Reason"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						rows={3}
						className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						placeholder="Why this consumption must not count"
					/>
				</label>
				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
					>
						Cancel charge
					</button>
				</div>
			</form>
		</div>
	);
}

/* ── Project Cost Allocation Revisions (#309, ADR-0016) ───────────── */

interface AllocationHistoryVersion {
	version: number;
	kind: string;
	allocation_uid: string;
	recorded_employer_cost: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	frozen_at: string;
	frozen_by: number | null;
	actor_name: string | null;
	command: string | null;
	reason: string | null;
	evidence_reference: string | null;
	journal_at: string | null;
	superseded_by: number | null;
	reconciles: boolean;
	shares: PayrollShareRow[];
}

interface AllocationHistoryPayload {
	payroll_slip_id: number;
	month: string;
	employee_code: string;
	selected_version: number;
	versions: AllocationHistoryVersion[];
}

const ALLOCATION_KIND_LABELS: Record<string, string> = {
	finalization: 'Finalized',
	reconstruction: 'Reconstructed',
	revision: 'Revised',
};

/**
 * The revision history of one frozen allocation plus the authorized
 * correction control: the selected version, every prior version with its
 * actor, reason, evidence, and old/new figures, and the dialog that appends
 * the next immutable version through the versioned command API.
 */
function AllocationRevisionPanel({
	slipId,
	employee,
	projectOptions,
	currency,
	canRevise,
}: {
	slipId: number;
	employee: PayrollEmployeeRow;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	currency: string;
	canRevise: boolean;
}) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const historyQuery = useQuery<{ data: AllocationHistoryPayload }>({
		queryKey: ['payroll-allocation-history', slipId],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/payroll/revisions', {
				payroll_slip_id: slipId,
			}),
		refetchOnWindowFocus: false,
		staleTime: 0,
	});
	const history = historyQuery.data?.data;
	const versions = history?.versions ?? [];
	const selected = versions.find(
		(version) => version.version === history?.selected_version
	);

	const destinationRows = (selected?.shares ?? [])
		.filter((share) => share.basis !== 'no_logged_hours')
		.map((share) => ({
			projectId: share.project_id === null ? '' : String(share.project_id),
			hours: String(share.hours),
		}))
		.sort((a, b) => {
			if (a.projectId === b.projectId) return 0;
			if (a.projectId === '') return 1;
			if (b.projectId === '') return -1;
			return Number(a.projectId) - Number(b.projectId);
		});

	return (
		<div
			data-testid="payroll-allocation-history"
			className="mt-2 rounded border border-gray-200 bg-white"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-2 py-1.5">
				<p className="text-xs font-semibold text-gray-700">
					Allocation history — Slip #{slipId}
					{history ? ` · selected v${history.selected_version}` : ''}
				</p>
				{canRevise && selected && (
					<button
						type="button"
						data-testid="payroll-revise-open"
						onClick={() => setDialogOpen(true)}
						className="rounded bg-[#64126D] px-2 py-1 text-xs font-medium text-white hover:bg-[#52105a]"
					>
						Revise allocation
					</button>
				)}
			</div>
			{historyQuery.isLoading && (
				<p className="px-2 py-2 text-xs text-gray-500">
					Loading allocation history…
				</p>
			)}
			{historyQuery.isError && (
				<p className="px-2 py-2 text-xs text-rose-600">
					{errorMessage(historyQuery.error)}
				</p>
			)}
			{!historyQuery.isLoading && !historyQuery.isError && (
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="text-left text-gray-500">
								<th className="py-1 pl-2 pr-3 font-medium">Version</th>
								<th className="py-1 pr-3 font-medium">Kind</th>
								<th className="py-1 pr-3 font-medium">Actor</th>
								<th className="py-1 pr-3 font-medium">Frozen</th>
								<th className="py-1 pr-3 font-medium">Reason</th>
								<th className="py-1 pr-3 font-medium">Evidence</th>
								<th className="py-1 pr-3 font-medium">Destinations</th>
								<th className="py-1 pr-2 font-medium">State</th>
							</tr>
						</thead>
						<tbody>
							{versions.map((version) => (
								<tr
									key={version.version}
									data-testid="payroll-history-version"
									data-version={String(version.version)}
									data-kind={version.kind}
									data-selected={
										version.version === history?.selected_version
											? 'true'
											: 'false'
									}
									className="border-t border-gray-100 align-top"
								>
									<td className="py-1 pl-2 pr-3 tabular-nums text-gray-800">
										v{version.version}
									</td>
									<td className="py-1 pr-3 text-gray-700">
										{ALLOCATION_KIND_LABELS[version.kind] ?? version.kind}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{version.actor_name ?? '—'}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{formatDate(version.frozen_at)}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{version.reason ?? '—'}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{version.evidence_reference ?? '—'}
									</td>
									<td className="py-1 pr-3 text-gray-700">
										{version.shares
											.map(
												(share) =>
													`${
														share.project_id === null
															? share.basis === 'no_project'
																? 'No project'
																: 'No logged hours'
															: share.project_code
													} ${formatNumber(share.hours)}h → ${formatCurrencyIn(
														share.amount,
														currency
													)}`
											)
											.join(' · ')}
									</td>
									<td className="py-1 pr-2">
										{version.version === history?.selected_version ? (
											<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
												Selected
											</span>
										) : (
											<span className="text-gray-500">
												Superseded by v{version.superseded_by}
											</span>
										)}
										{!version.reconciles && (
											<span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-rose-900">
												Unreconciled
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{dialogOpen && selected && history && (
				<ReviseAllocationDialog
					slipId={slipId}
					employeeCode={employee.employee_code}
					projectOptions={projectOptions}
					currency={currency}
					expectedVersion={history.selected_version}
					recordedEmployerCost={selected.recorded_employer_cost}
					destinations={destinationRows}
					onClose={() => setDialogOpen(false)}
				/>
			)}
		</div>
	);
}

/**
 * The authorized correction: corrected monthly Logged Hours per destination
 * plus the required reason and evidence, submitted with the version the
 * operator saw. A stale version or a refused command surfaces inline and
 * changes nothing.
 */
function ReviseAllocationDialog({
	slipId,
	employeeCode,
	projectOptions,
	currency,
	expectedVersion,
	recordedEmployerCost,
	destinations,
	onClose,
}: {
	slipId: number;
	employeeCode: string;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	currency: string;
	expectedVersion: number;
	recordedEmployerCost: number;
	destinations: Array<{ projectId: string; hours: string }>;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [rows, setRows] = useState(destinations);
	const [reason, setReason] = useState('');
	const [evidence, setEvidence] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const used = new Set(rows.map((row) => row.projectId));
	const addable = projectOptions.filter(
		(option) => !used.has(String(option.project_id))
	);

	const submit = async () => {
		setError(null);
		if (!reason.trim()) {
			setError('A reason is required for an allocation revision');
			return;
		}
		if (!evidence.trim()) {
			setError('An evidence reference is required for an allocation revision');
			return;
		}
		const lines: Array<{ project_id: number | null; hours: number }> = [];
		for (const row of rows) {
			if (row.hours.trim() === '') continue;
			const hours = Number(row.hours);
			if (!Number.isFinite(hours) || hours <= 0) {
				setError(
					'Every destination states positive hours; remove destinations that have none'
				);
				return;
			}
			lines.push({
				project_id: row.projectId === '' ? null : Number(row.projectId),
				hours,
			});
		}
		setSubmitting(true);
		try {
			await apiPost(
				'/api/reports/employee-project-monthly-cost/payroll/revisions',
				{
					payroll_slip_id: slipId,
					expected_version: expectedVersion,
					reason,
					evidence_reference: evidence,
					lines,
				}
			);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['payroll-allocation-history', slipId],
				}),
				queryClient.invalidateQueries({ queryKey: ['expenditure-payroll'] }),
				queryClient.invalidateQueries({ queryKey: ['expenditure'] }),
			]);
			onClose();
		} catch (submitError) {
			setError(errorMessage(submitError));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			data-testid="payroll-revise-dialog"
			data-expected-version={String(expectedVersion)}
			className="border-t border-gray-200 bg-gray-50/70 px-2 py-2"
		>
			<p className="mb-1 text-xs font-semibold text-gray-700">
				Revise allocation for {employeeCode} — recorded employer cost{' '}
				{formatCurrencyIn(recordedEmployerCost, currency)}, expected version v
				{expectedVersion}
			</p>
			<p className="mb-2 text-[11px] text-gray-500">
				State the corrected monthly hours per destination. The recorded employer
				cost does not change; the corrected shares are appended as the next
				version.
			</p>
			{rows.map((row, index) => (
				<div
					key={`${row.projectId}-${index}`}
					className="mb-1 flex items-center gap-2"
				>
					<SearchableSelect
						options={[
							{ value: '', label: 'No project' },
							...projectOptions.map((option) => ({
								value: String(option.project_id),
								label: `${option.project_code} — ${option.project_name}`,
							})),
						]}
						value={row.projectId}
						onChange={(value) =>
							setRows((prev) =>
								prev.map((entry, entryIndex) =>
									entryIndex === index ? { ...entry, projectId: value } : entry
								)
							)
						}
						placeholder="Destination"
					/>
					<input
						data-testid="payroll-revise-hours"
						aria-label={`Hours for destination ${index + 1}`}
						type="number"
						min="0"
						step="0.01"
						value={row.hours}
						onChange={(event) =>
							setRows((prev) =>
								prev.map((entry, entryIndex) =>
									entryIndex === index
										? { ...entry, hours: event.target.value }
										: entry
								)
							)
						}
						className="w-28 rounded border border-gray-300 px-2 py-1 text-xs"
					/>
					<button
						type="button"
						aria-label={`Remove destination ${index + 1}`}
						onClick={() =>
							setRows((prev) =>
								prev.filter((_, entryIndex) => entryIndex !== index)
							)
						}
						className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-3.5 w-3.5" />
					</button>
				</div>
			))}
			<div className="mb-2 flex items-center gap-2">
				<SearchableSelect
					options={[
						{ value: '', label: 'Add destination…' },
						...addable.map((option) => ({
							value: String(option.project_id),
							label: `${option.project_code} — ${option.project_name}`,
						})),
					]}
					value=""
					onChange={(value) => {
						if (value === '') return;
						setRows((prev) => {
							const next = [...prev, { projectId: value, hours: '' }];
							next.sort((a, b) => {
								if (a.projectId === b.projectId) return 0;
								if (a.projectId === '') return 1;
								if (b.projectId === '') return -1;
								return Number(a.projectId) - Number(b.projectId);
							});
							return next;
						});
					}}
					placeholder="Add destination"
				/>
			</div>
			<div className="mb-1 flex flex-wrap items-center gap-2">
				<input
					data-testid="payroll-revise-reason"
					aria-label="Revision reason"
					type="text"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					placeholder="Reason (required)"
					className="w-72 rounded border border-gray-300 px-2 py-1 text-xs"
				/>
				<input
					data-testid="payroll-revise-evidence"
					aria-label="Revision evidence"
					type="text"
					value={evidence}
					onChange={(event) => setEvidence(event.target.value)}
					placeholder="Evidence reference (required)"
					className="w-72 rounded border border-gray-300 px-2 py-1 text-xs"
				/>
			</div>
			{error && (
				<p
					data-testid="payroll-revise-error"
					className="mb-1 text-xs text-rose-600"
				>
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
				>
					Close
				</button>
				<button
					type="button"
					data-testid="payroll-revise-submit"
					disabled={submitting}
					onClick={submit}
					className="rounded-lg bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
				>
					{submitting ? 'Revising…' : 'Apply revision'}
				</button>
			</div>
		</div>
	);
}
