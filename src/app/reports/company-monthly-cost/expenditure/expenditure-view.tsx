'use client';

/**
 * The Company Monthly Cost report's company expenditure view.
 *
 * Leads with Company Incurred Cost and reconciles it to Incurred Project Cost,
 * Company Overhead, and Unallocated Cost, each direct cost counted once. It is
 * also the entry and recognition surface for direct cost: record a cost,
 * submit it for recognition, and confirm it with an explicit, reasoned
 * command. Coverage notices state what the total does not include yet, and
 * nothing here invents a figure the sources do not support.
 *
 * Data comes from `/api/reports/company-monthly-cost?view=expenditure`
 * (reconciliation), `.../expenses` (drilldown and review queue),
 * `POST /api/admin/expenses` (entry),
 * `POST /api/admin/expenses/{id}/commands` (versioned recognition commands),
 * and `POST /api/admin/expenses/{id}/charges[/{chargeUid}]` (approved period
 * consumption of a non-operating balance, #317).
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BanknotesIcon } from '@heroicons/react/24/outline';
import { apiGet, apiPost } from '@/lib/api-client';
// The financial-year vocabulary is pure calendar arithmetic, so the view takes
// it from the same module the report uses instead of a second copy here; the
// barrel is avoided because it also opens the database pool (server only).
import { financialYearOf } from '@/lib/company-expenditure/ranking';
import type {
	ClosePayload,
	CostRecordJson,
	PeriodChargeJson,
	RevisionPayload,
} from '@/lib/company-expenditure';
import BudgetSection from './budget-section';
import CashSection from './cash-section';
import CloseSection from './close-section';
import RevisionSection from './revision-section';
import {
	ChargeCancelDialog,
	CommandDialog,
	CostEditDialog,
	CostForm,
	PeriodChargeDialog,
} from './cost-forms';
import type {
	ClientOrderRow,
	ClientOrderTotalRow,
	DrilldownPayload,
	NonOperatingItemRow,
	PayrollDrilldownPayload,
	ReconciliationPayload,
} from './types';
import { errorMessage, rankMap } from './shared';
import { Toolbar } from './toolbar';
import { CompanyReconciliationPanel } from './company-reconciliation';
import { ComparisonPanel } from './comparison-panel';
import { BalancesPanel } from './balances-panel';
import { CommitmentsPanel } from './commitments-panel';
import { ClientOrdersPanel } from './client-orders-panel';
import { ProjectBreakdown } from './project-breakdown';
import { PayrollSummary } from './payroll-summary';
import { RecognitionQueue } from './recognition-queue';

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
	/**
	 * Financial read gate + `other_expenses:update` — may revise a closed
	 * month (#323). The server enforces the same conjunction (and
	 * `other_expenses:approve` for reversals) regardless of what renders.
	 */
	canReviseClosed: boolean;
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
	canReviseClosed,
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
	const [exporting, setExporting] = useState(false);

	const handleExport = async () => {
		setExporting(true);
		try {
			const params = new URLSearchParams({
				view: 'expenditure',
				month,
			});
			if (projectFilter && projectFilter !== 'all') {
				params.set('project_id', projectFilter);
			}
			if (reportingCurrency) {
				params.set('reporting_currency', reportingCurrency);
			}
			const url = `/api/reports/company-monthly-cost/download?${params.toString()}`;
			const response = await fetch(url, { credentials: 'include' });
			if (!response.ok) {
				const msg = await response.text().catch(() => '');
				throw new Error(
					`Export failed (${response.status})${msg ? `: ${msg}` : ''}`
				);
			}
			const blob = await response.blob();
			const disposition = response.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^";]+)"?/i);
			const filename =
				match?.[1] ||
				`Company_Expenditure_${month}${projectFilter && projectFilter !== 'all' ? `_Project_${projectFilter}` : ''}.xlsx`;
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
		} catch (e) {
			console.error(e);
			alert(e instanceof Error ? e.message : 'Failed to export report');
		} finally {
			setExporting(false);
		}
	};

	const reconciliationQuery = useQuery<{
		data: ReconciliationPayload;
		close?: ClosePayload | null;
		revisions?: RevisionPayload | null;
		client_orders?: ClientOrderRow[];
		client_order_totals?: ClientOrderTotalRow[];
	}>({
		queryKey: ['expenditure', month, projectFilter, reportingCurrency],
		queryFn: () =>
			apiGet('/api/reports/company-monthly-cost', {
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
			apiGet('/api/reports/company-monthly-cost/expenses', {
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
			apiGet('/api/reports/company-monthly-cost/expenses', {
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
			apiGet('/api/reports/company-monthly-cost/expenses', {
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
			apiGet('/api/reports/company-monthly-cost/payroll', {
				month,
			}),
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});
	const payrollEmployees = payrollQuery.data?.data.employees ?? [];

	// Client orders (ticket #310, commercial context): fetched alongside the
	// reconciliation or directly from canonical orders if absent.
	const clientOrdersQuery = useQuery<{
		data: {
			orders: ClientOrderRow[];
			totals: ClientOrderTotalRow[];
		};
	}>({
		queryKey: ['expenditure-client-orders', projectFilter],
		queryFn: () =>
			apiGet('/api/admin/orders', {
				direction: 'client',
				...(projectFilter !== 'all' ? { project_id: projectFilter } : {}),
				limit: '200',
			}),
		enabled: !reconciliationQuery.data?.client_orders,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const clientOrders = useMemo<ClientOrderRow[]>(() => {
		if (reconciliationQuery.data?.client_orders) {
			return reconciliationQuery.data.client_orders;
		}
		return clientOrdersQuery.data?.data?.orders ?? [];
	}, [
		reconciliationQuery.data?.client_orders,
		clientOrdersQuery.data?.data?.orders,
	]);

	const clientOrderTotals = useMemo<ClientOrderTotalRow[]>(() => {
		if (reconciliationQuery.data?.client_order_totals) {
			return reconciliationQuery.data.client_order_totals;
		}
		return clientOrdersQuery.data?.data?.totals ?? [];
	}, [
		reconciliationQuery.data?.client_order_totals,
		clientOrdersQuery.data?.data?.totals,
	]);

	const clientOrdersByProject = useMemo(() => {
		const map = new Map<number, ClientOrderRow[]>();
		for (const order of clientOrders) {
			if (order.projectId !== null) {
				const existing = map.get(order.projectId) ?? [];
				existing.push(order);
				map.set(order.projectId, existing);
			}
		}
		return map;
	}, [clientOrders]);

	// #308: reconstruction commands ride the report's own routes. The server
	// enforces the financial read gate + operation privilege; the controls
	// below render only under the same conjunction.
	const proposeReconstruction = useMutation({
		mutationFn: (slipId: number) =>
			apiPost('/api/reports/company-monthly-cost/payroll/reconstruction', {
				month,
				payroll_slip_id: slipId,
			}),
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
				`/api/reports/company-monthly-cost/payroll/reconstruction/${input.proposalUid}`,
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

	return (
		<div
			data-testid="expenditure-view"
			data-month={data.month}
			data-current-month={data.current_month}
			className="p-3 sm:p-4"
		>
			<Toolbar
				month={month}
				monthOptions={monthOptions}
				onMonthChange={onMonthChange}
				canRecord={canRecord}
				projectOptions={projectOptions}
				projectFilter={projectFilter}
				onProjectFilterChange={setProjectFilter}
				onProjectExpand={setExpandedProject}
				rankingMode={rankingMode}
				onRankingModeChange={setRankingMode}
				reportingCurrency={reportingCurrency}
				onReportingCurrencyChange={setReportingCurrency}
				financialYear={financialYear}
				currentFinancialYear={currentFinancialYear}
				onFinancialYearStep={stepFinancialYear}
				exporting={exporting}
				onExport={handleExport}
				refreshing={reconciliationQuery.isFetching}
				onRefresh={() => {
					void reconciliationQuery.refetch();
					void queueQuery.refetch();
				}}
				onRecordCost={() => setFormOpen(true)}
			/>

			<CompanyReconciliationPanel data={data} />

			<ComparisonPanel data={data} clientOrders={clientOrders} />

			<BalancesPanel data={data} />

			<CommitmentsPanel
				data={data}
				canRecognize={canRecognize}
				onChargeTargetChange={setChargeTarget}
				onCancelChargeTargetChange={setCancelChargeTarget}
				onChargeReset={() => chargeMutation.reset()}
				onCancelChargeReset={() => cancelChargeMutation.reset()}
			/>

			{/* Project breakdown */}
			<ClientOrdersPanel
				clientOrders={clientOrders}
				clientOrderTotals={clientOrderTotals}
			/>

			<ProjectBreakdown
				data={data}
				month={month}
				clientOrdersByProject={clientOrdersByProject}
				costRanks={costRanks}
				increaseRanks={increaseRanks}
				rankedRows={rankedRows}
				rankingMode={rankingMode}
				expandedProject={expandedProject}
				onProjectExpand={setExpandedProject}
				drilldownLoading={drilldownQuery.isLoading}
				drilldownRecords={drilldownQuery.data?.data.records}
				drilldownPeriodCharges={drilldownQuery.data?.data.period_charges}
				drilldownMonth={drilldownQuery.data?.data.month}
				evidenceLoading={evidenceQuery.isLoading}
				evidenceRecords={evidenceQuery.data?.data.records}
			/>

			<PayrollSummary
				data={data}
				payrollEmployees={payrollEmployees}
				payrollLoading={payrollQuery.isLoading}
				payrollFailed={payrollQuery.isError}
				payrollError={payrollQuery.error}
				proposeSubmitting={proposeReconstruction.isPending}
				reviewSubmitting={reviewReconstruction.isPending}
				onProposeReconstruction={(slipId) =>
					proposeReconstruction.mutate(slipId)
				}
				onReviewReconstruction={(input) => reviewReconstruction.mutate(input)}
				reconstructionError={reconstructionError}
				expandedEmployee={expandedEmployee}
				onEmployeeExpand={setExpandedEmployee}
				reconstructionReason={reconstructionReason}
				onReconstructionReasonChange={setReconstructionReason}
				canProposeReconstruction={canProposeReconstruction}
				canReviewReconstruction={canReviewReconstruction}
				canRevise={canRevise}
			/>

			<RecognitionQueue
				data={data}
				queue={queue}
				canEditCost={canEditCost}
				canRecognize={canRecognize}
				onCommandReset={() => commandMutation.reset()}
				onEditTargetChange={setEditTarget}
				onCommandTargetChange={setCommandTarget}
			/>

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

			{/* Financial revisions (#323). Its own section: a closed month
			    states its frozen prior totals beside the live updated totals,
			    and the revision command corrects or reverses closed figures
			    with a reason and evidence while preserving both. The revision
			    state rides on the reconciliation response (same pattern as the
			    close section), never a second per-mount request. */}
			<RevisionSection
				month={month}
				canRevise={canReviseClosed}
				initialRevisions={reconciliationQuery.data?.revisions ?? null}
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
