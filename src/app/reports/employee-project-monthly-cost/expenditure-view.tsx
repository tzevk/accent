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
 * `POST /api/admin/expenses` (entry), and
 * `POST /api/admin/expenses/{id}/commands` (versioned recognition commands).
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
import { formatCurrency, formatCurrencyIn, formatDate } from '@/lib/format';
import type { CostRecordJson } from '@/lib/company-expenditure/types';

interface GroupRow {
	key: string;
	label: string;
	amount: number;
	record_count: number;
}

interface CurrencyTotalRow {
	currency: string;
	incurred_project_cost: number;
	company_overhead: number;
	unallocated_cost: number;
	incurred_cost: number;
	record_count: number;
}

interface ProjectRow {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	incurred_cost: number;
	record_count: number;
	not_confirmed_cost: number;
	previous_month_cost: number | null;
	change_amount: number | null;
	change_state: string;
}

interface EvidenceRow {
	count: number;
	amount: number | null;
}

interface CoverageNoticeRow {
	code: string;
	label: string;
	detail: string;
	severity: string;
}

interface ReconciliationPayload {
	month: string;
	month_label: string;
	project_id: number | null;
	company: {
		currency: string | null;
		incurred_cost: number | null;
		currency_totals: CurrencyTotalRow[];
		groups: GroupRow[];
		gross_liability: number | null;
		recoverable_tax: number | null;
		unresolved_tax: { count: number; gross_amount: number };
		known_zero_count: number;
		record_count: number;
	};
	projects: ProjectRow[];
	evidence: {
		recognized: EvidenceRow;
		pending_evidence: EvidenceRow;
		draft: EvidenceRow;
		rejected: EvidenceRow;
		cancelled: EvidenceRow;
		unresolved_classification: { count: number; gross_amount: number };
		missing_amount: { count: number };
		known_zero: { count: number };
	};
	coverage: CoverageNoticeRow[];
	project_options: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	available_months: string[];
}

interface DrilldownPayload {
	total: number;
	records: CostRecordJson[];
	totals: { confirmed_amount: number; records: number };
}

export interface ExpenditureViewProps {
	month: string;
	monthOptions: Array<{ value: string; label: string }>;
	onMonthChange: (month: string) => void;
	/** `other_expenses:create` — may record and submit a cost. */
	canRecord: boolean;
	/** `other_expenses:approve` — may recognize, reject, or cancel a cost. */
	canRecognize: boolean;
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
	project: 'Project',
	company_overhead: 'Company Overhead',
	unallocated: 'Unallocated Cost',
};

const CHANGE_LABELS: Record<string, string> = {
	no_prior: 'No prior month',
	new: 'New cost',
	increase: 'Increase',
	decrease: 'Decrease',
	unchanged: 'No change',
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong';
}

export default function ExpenditureView({
	month,
	monthOptions,
	onMonthChange,
	canRecord,
	canRecognize,
}: ExpenditureViewProps) {
	const queryClient = useQueryClient();
	const [projectFilter, setProjectFilter] = useState('all');
	const [expandedProject, setExpandedProject] = useState<number | null>(null);
	const [formOpen, setFormOpen] = useState(false);
	const [commandTarget, setCommandTarget] = useState<{
		record: CostRecordJson;
		command: 'recognize' | 'reject' | 'cancel';
	} | null>(null);

	const reconciliationQuery = useQuery<{ data: ReconciliationPayload }>({
		queryKey: ['expenditure', month, projectFilter],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost', {
				view: 'expenditure',
				month,
				project_id: projectFilter === 'all' ? undefined : projectFilter,
			}),
		enabled: !!month,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const queueQuery = useQuery<{ data: DrilldownPayload }>({
		queryKey: ['expenditure-queue', month],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/expenses', {
				month,
				state: 'unconfirmed',
			}),
		enabled: !!month,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const drilldownQuery = useQuery<{ data: DrilldownPayload }>({
		queryKey: ['expenditure-drilldown', month, expandedProject],
		queryFn: () =>
			apiGet('/api/reports/employee-project-monthly-cost/expenses', {
				month,
				state: 'recognized',
				project_id: expandedProject ?? undefined,
			}),
		enabled: expandedProject !== null,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const data = reconciliationQuery.data?.data ?? null;
	const queue = queueQuery.data?.data?.records ?? [];

	const commandMutation = useMutation({
		mutationFn: (input: {
			id: number;
			command: string;
			expectedVersion: number;
			reason?: string;
		}) =>
			apiPost(`/api/admin/expenses/${input.id}/commands`, {
				command: input.command,
				expected_version: input.expectedVersion,
				reason: input.reason,
			}),
		onSuccess: () => {
			setCommandTarget(null);
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
			void queryClient.invalidateQueries({ queryKey: ['expenditure-queue'] });
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-drilldown'],
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
		},
	});

	const projectOptions = useMemo(() => {
		const options = (data?.project_options ?? []).map((option) => ({
			value: String(option.project_id),
			label: `${option.project_code} — ${option.project_name}`,
		}));
		return [{ value: 'all', label: 'All projects' }, ...options];
	}, [data]);

	if (!month) {
		return (
			<div
				data-testid="expenditure-view"
				className="p-6 text-sm text-gray-500"
			>
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
	const multiCurrency = data.company.currency_totals.length > 1;

	return (
		<div data-testid="expenditure-view" className="p-3 sm:p-4">
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

			<p className="mb-3 text-xs text-gray-500">
				Company Incurred Cost for {data.month_label}. Each recognized direct
				cost is counted once; Project filters narrow the detail only.
			</p>

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
							: formatCurrencyIn(data.company.incurred_cost, data.company.currency)}
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
						{multiCurrency
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
						{multiCurrency
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
						{multiCurrency
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

			{/* Currency subtotals: never combined without a supported conversion */}
			{multiCurrency && (
				<div className="mt-3 overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 p-3">
					<p className="text-xs font-semibold text-amber-900">
						This month holds more than one currency. Amounts stay in their own
						currency; no company total is shown until a conversion is supported.
					</p>
					<table className="mt-2 w-full text-xs">
						<thead>
							<tr className="text-left text-gray-600">
								<th className="py-1 pr-3 font-medium">Currency</th>
								<th className="py-1 pr-3 font-medium">Incurred Project Cost</th>
								<th className="py-1 pr-3 font-medium">Company Overhead</th>
								<th className="py-1 pr-3 font-medium">Unallocated Cost</th>
								<th className="py-1 pr-3 font-medium">Total</th>
							</tr>
						</thead>
						<tbody>
							{data.company.currency_totals.map((row) => (
								<tr key={row.currency} data-testid="currency-total-row">
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
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{/* Tax and evidence */}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<div className="rounded-xl border border-gray-200 bg-white p-3">
					<p className="text-xs font-semibold text-gray-700">
						Tax on recognized cost
					</p>
					<ul className="mt-1 space-y-0.5 text-xs text-gray-600">
						<li data-testid="tax-gross">
							Gross liability: {formatCurrency(data.company.gross_liability)}
						</li>
						<li data-testid="tax-recoverable">
							Confirmed recoverable tax excluded:{' '}
							{formatCurrency(data.company.recoverable_tax)}
						</li>
						<li data-testid="tax-unresolved">
							Unresolved tax kept at gross:{' '}
							{data.company.unresolved_tax.count} record(s),{' '}
							{formatCurrency(data.company.unresolved_tax.gross_amount)}
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

			{/* Project breakdown */}
			<div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
				<table className="w-full min-w-[720px] text-sm">
					<caption className="sr-only">
						Incurred Project Cost by Project for {data.month_label}
					</caption>
					<thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
						<tr>
							<th scope="col" className="px-3 py-2">
								Project
							</th>
							<th scope="col" className="px-3 py-2">
								Client
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Incurred cost
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Not confirmed
							</th>
							<th scope="col" className="px-3 py-2 text-right">
								Change vs prior month
							</th>
							<th scope="col" className="px-3 py-2">
								State
							</th>
						</tr>
					</thead>
					<tbody>
						{data.projects.length === 0 && (
							<tr>
								<td colSpan={6} className="px-3 py-4 text-center text-gray-500">
									No Project-attributed cost in this month. Company Overhead and
									Unallocated Cost stay in the reconciliation above.
								</td>
							</tr>
						)}
						{data.projects.map((project) => {
							const expanded = expandedProject === project.project_id;
							return (
								<Fragment key={project.project_id}>
									<tr
										data-testid="expenditure-project-row"
										data-project-code={project.project_code}
										data-project-cost={project.incurred_cost}
										className="border-t border-gray-100"
									>
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
											</div>
										</td>
										<td className="px-3 py-2 text-gray-600">
											{project.client_name ?? '—'}
										</td>
										<td className="px-3 py-2 text-right font-semibold text-gray-900">
											{formatCurrencyIn(
												project.incurred_cost,
												data.company.currency
											)}
										</td>
										<td className="px-3 py-2 text-right text-gray-600">
											{project.not_confirmed_cost > 0
												? formatCurrency(project.not_confirmed_cost)
												: '—'}
										</td>
										<td className="px-3 py-2 text-right text-gray-600">
											{project.change_amount === null
												? '—'
												: formatCurrency(project.change_amount)}
										</td>
										<td className="px-3 py-2 text-xs text-gray-600">
											{CHANGE_LABELS[project.change_state] ??
												project.change_state}
										</td>
									</tr>
									{expanded && (
										<tr key={`${project.project_id}-drilldown`}>
											<td colSpan={6} className="bg-gray-50/70 px-3 py-2">
												<div data-testid="project-drilldown">
													<p className="mb-1 text-xs font-semibold text-gray-700">
														Source records recognized against{' '}
														{project.project_code}
													</p>
													{drilldownQuery.isLoading && (
														<p className="text-xs text-gray-500">
															Loading source records…
														</p>
													)}
													{drilldownQuery.data?.data.records.length ===
														0 && (
														<p className="text-xs text-gray-500">
															No recognized records for this Project in the
															month.
														</p>
													)}
													<ul className="space-y-1">
														{drilldownQuery.data?.data.records.map(
															(record) => (
																<li
																	key={record.id}
																	data-testid="drilldown-record"
																	data-source-reference={
																		record.source_reference ?? ''
																	}
																	className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-700"
																>
																	<span className="font-medium">
																		{record.source_reference ?? record.expense_number}
																	</span>
																	<span>{record.vendor_name ?? '—'}</span>
																	<span>
																		Period{' '}
																		{formatDate(record.recognition_period)} (
																		{record.period_basis})
																	</span>
																	<span>
																		Gross{' '}
																		{formatCurrencyIn(
																			record.gross_amount,
																			record.currency
																		)}
																	</span>
																	<span className="font-semibold">
																		Recognized{' '}
																		{formatCurrencyIn(
																			record.recognized_amount,
																			record.currency
																		)}
																	</span>
																	<span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-gray-600">
																		v{record.financial_version}
																	</span>
																</li>
															)
														)}
													</ul>
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
									key={record.id}
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
											: formatCurrencyIn(
													record.gross_amount,
													record.currency
												)}
									</td>
									<td className="px-3 py-2 text-xs text-gray-600">
										{record.recognition_period
											? `${formatDate(record.recognition_period)} (${record.period_basis})`
											: 'No recognition period'}
									</td>
									<td className="px-3 py-2 text-xs">
										<span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
											{STATE_LABELS[record.recognition_state] ??
												record.recognition_state}
										</span>
									</td>
									<td className="px-3 py-2">
										{canRecognize ? (
											<div className="flex gap-1.5">
												<button
													type="button"
													onClick={() =>
														setCommandTarget({ record, command: 'recognize' })
													}
													className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
												>
													Recognize
												</button>
												<button
													type="button"
													onClick={() =>
														setCommandTarget({ record, command: 'reject' })
													}
													className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
												>
													Reject
												</button>
												<button
													type="button"
													onClick={() =>
														setCommandTarget({ record, command: 'cancel' })
													}
													className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
												>
													Cancel cost
												</button>
											</div>
										) : (
											<span className="text-xs text-gray-400">
												Recognition needs approval access
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

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

			{commandTarget && (
				<CommandDialog
					record={commandTarget.record}
					command={commandTarget.command}
					submitting={commandMutation.isPending}
					error={
						commandMutation.isError ? errorMessage(commandMutation.error) : null
					}
					onCancel={() => {
						commandMutation.reset();
						setCommandTarget(null);
					}}
					onConfirm={(reason) =>
						commandMutation.mutate({
							id: commandTarget.record.id,
							command: commandTarget.command,
							expectedVersion: commandTarget.record.financial_version,
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
	const [projectId, setProjectId] = useState('');
	const [sourceReference, setSourceReference] = useState('');
	const [vendor, setVendor] = useState('');
	const [description, setDescription] = useState('');
	const [serviceStart, setServiceStart] = useState('');
	const [serviceEnd, setServiceEnd] = useState('');
	const [billDate, setBillDate] = useState('');
	const [currency, setCurrency] = useState('INR');
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
		project_id:
			classification === 'project' && projectId ? Number(projectId) : null,
		service_period_start: serviceStart || null,
		service_period_end: serviceEnd || serviceStart || null,
		bill_date: billDate || null,
		currency,
		gross_amount: grossAmount === '' ? null : Number(grossAmount),
		tax_amount: taxAmount === '' ? 0 : Number(taxAmount),
		tax_treatment: taxTreatment,
		tax_evidence_reference: taxEvidence || null,
		source_reference: sourceReference || null,
		evidence_reference: evidenceReference || null,
		submit: submitForRecognition,
	});

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
							onChange={(event) => setCurrency(event.target.value)}
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
					evidence — it is recorded as a fallback.
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
