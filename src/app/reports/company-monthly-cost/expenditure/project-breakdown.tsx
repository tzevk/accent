'use client';

/**
 * The Project breakdown of the company expenditure report.
 *
 * One row per Project, ranked by available monthly cost or confirmed change.
 * Available cost includes salary estimates; budgets, comparable periods, and
 * cost to date keep their confirmed basis. The reporting-currency figure never
 * invents a rate for payroll estimates. Expanding a row opens source records
 * against that Project, the evidence still unresolved, the approved period
 * consumption, and the client orders linked to the Project (commercial
 * context only, never revenue, profit or cost).
 */

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatCurrencyIn, formatDate, formatNumber } from '@/lib/format';
import { div, gt, isZero, mul } from '@/lib/money';
import {
	availableEmployeeCost,
	availableProjectCost,
	availableReportingProjectCost,
} from '@/lib/company-expenditure/available-cost';
import type {
	CostRecordJson,
	PeriodChargeJson,
} from '@/lib/company-expenditure';
import type {
	ClientOrderRow,
	ProjectRow,
	ReconciliationPayload,
} from './types';
import {
	CHARGE_BASIS_LABELS,
	EVIDENCE_FINDING_LABELS,
	EVIDENCE_LABELS,
	NATURE_LABELS,
	PERIOD_BASIS_LABELS,
	STATE_LABELS,
	formatSourceMoney,
	percentLabel,
} from './shared';

const BUDGET_OUTCOME_LABELS: Record<string, string> = {
	compared: 'Compared',
	missing: 'No approved budget',
	unapproved: 'Not approved',
	incompatible_currency: 'Different currency',
	incompatible_scope: 'Not a cost budget',
	incompatible_period: 'Different period',
	ambiguous: 'More than one match',
	unsupported_incurred_cost: 'Cost not confirmed yet',
	no_incurred_cost: 'No incurred cost recorded',
};

/** One Project/currency row's budget comparison, as the payload states it. */
type BudgetComparison = ReconciliationPayload['budgets']['comparisons'][number];

/**
 * Why one Project/currency row is or is not compared with an approved
 * monthly budget, in one compact line beside the row amount (#382). Every
 * branch reads the existing comparison outcome; nothing is inferred.
 */
function comparisonReason(
	comparison: BudgetComparison | undefined,
	monthLabel: string
): string {
	if (comparison === undefined) {
		return `No approved cost budget recorded for this project, currency, and ${monthLabel}.`;
	}
	switch (comparison.outcome) {
		case 'compared':
			return 'Approved monthly budget compared with confirmed cost.';
		case 'missing':
			return `No approved cost budget recorded for this project, currency, and ${monthLabel}.`;
		case 'unapproved':
			return 'A budget covers this month but is not approved.';
		case 'incompatible_currency':
			return 'Approved budgets are stated in another currency; currencies are never converted.';
		case 'incompatible_scope':
			return 'The approved budget declares a commercial value, not a cost budget.';
		case 'incompatible_period':
			return 'The approved budget does not cover exactly this month.';
		case 'ambiguous':
			return 'More than one approved budget covers this month; no single budget is compared.';
		case 'unsupported_incurred_cost':
			return 'No confirmed cost is recorded, so no variance is stated.';
		case 'no_incurred_cost':
			return 'No incurred cost is recorded beside this budget.';
		default:
			return 'Budget comparison unavailable.';
	}
}

export interface ProjectBreakdownProps {
	/** The reconciliation payload of the month under report. */
	data: ReconciliationPayload;
	/** The month under report (`YYYY-MM`). */
	month: string;
	/** Financial operators may open the project-owned budget workflow. */
	canManageBudgets?: boolean;
	canRecordBudget?: boolean;
	/** Client orders by Project, giving each row its commercial context. */
	clientOrdersByProject: Map<number, ClientOrderRow[]>;
	/** Position of each row in the cost ordering. */
	costRanks: Map<string, number>;
	/** Position of each row in the increase ordering. */
	increaseRanks: Map<string, number>;
	/** The Project rows, in the order the selected ranking gives. */
	rankedRows: Array<{ row: ProjectRow; rank: number | null }>;
	/** The ordering the table is ranked by. */
	rankingMode: 'cost' | 'increase';
	/** The Project whose source records are open, if any. */
	expandedProject: number | null;
	/** Opens the source records of a Project, or closes them again. */
	onProjectExpand: (projectId: number | null) => void;
	/** The recognized source records are still loading. */
	drilldownLoading: boolean;
	/** The recognized source records, or undefined before the query answers. */
	drilldownRecords: CostRecordJson[] | undefined;
	/** The approved period consumption, or undefined before the query answers. */
	drilldownPeriodCharges: PeriodChargeJson[] | undefined;
	/** The month the drilldown answers for, or undefined before it answers. */
	drilldownMonth: string | undefined;
	/** The unresolved evidence is still loading. */
	evidenceLoading: boolean;
	/** The unresolved evidence records, or undefined before the query answers. */
	evidenceRecords: CostRecordJson[] | undefined;
}

export function ProjectBreakdown({
	data,
	month,
	canManageBudgets = false,
	canRecordBudget = false,
	clientOrdersByProject,
	costRanks,
	increaseRanks,
	rankedRows,
	rankingMode,
	expandedProject,
	onProjectExpand,
	drilldownLoading,
	drilldownRecords,
	drilldownPeriodCharges,
	drilldownMonth,
	evidenceLoading,
	evidenceRecords,
}: ProjectBreakdownProps) {
	const reportingCurrencyCode = data.company.reporting_currency;
	const budgetByProjectCurrency = useMemo(() => {
		const map = new Map<string, (typeof data.budgets.comparisons)[number]>();
		for (const comparison of data.budgets.comparisons) {
			map.set(`${comparison.project_id}:${comparison.currency}`, comparison);
		}
		return map;
	}, [data]);
	return (
		<div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
			<p className="border-b border-gray-200 px-3 py-2 text-xs text-gray-600">
				Monthly cost includes salary estimates. Budget variance, period
				comparisons, and cost to date use confirmed cost only. Remaining or
				overspent is the approved budget minus confirmed cost.
			</p>
			<table className="w-full min-w-[1080px] text-sm">
				<caption className="sr-only">
					Monthly cost by Project for {data.month_label}, ordered by{' '}
					{rankingMode === 'increase'
						? 'largest confirmed increase'
						: 'largest monthly cost'}
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
							Monthly cost
						</th>
						<th scope="col" className="px-3 py-2 text-right">
							Approved budget
						</th>
						<th scope="col" className="px-3 py-2 text-right">
							Budget remaining / overspent — confirmed
						</th>
						<th scope="col" className="px-3 py-2 text-right">
							{data.comparison.unfinished
								? `Confirmed: first ${data.comparison.current_days} day(s)`
								: 'Confirmed this month'}
						</th>
						<th scope="col" className="px-3 py-2 text-right">
							Confirmed change
						</th>
						<th scope="col" className="px-3 py-2 text-right">
							Confirmed cost to date
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
							<td colSpan={14} className="px-3 py-4 text-center text-gray-500">
								No Project-attributed cost in this month. Company Overhead and
								Unallocated Cost stay in the reconciliation above.
							</td>
						</tr>
					)}
					{rankedRows.map(({ row: project, rank }) => {
						const expanded = expandedProject === project.project_id;
						const available = availableProjectCost(project);
						const employeeCost = availableEmployeeCost(project);
						const reportingCost = availableReportingProjectCost(
							project,
							reportingCurrencyCode
						);
						const estimatedPayroll =
							project.estimated_employee_cost > 0 ||
							project.employee_count >
								project.recorded_employee_count +
									project.missing_salary_profile_count;
						const evidenceState =
							project.missing_salary_profile_count > 0
								? 'incomplete'
								: estimatedPayroll && project.evidence.state === 'recorded'
									? 'estimated'
									: project.evidence.state;
						return (
							<Fragment key={`${project.project_id}-${project.currency}`}>
								<tr
									data-testid="expenditure-project-row"
									data-project-code={project.project_code}
									data-project-cost={available}
									data-confirmed-project-cost={project.incurred_cost}
									data-currency={project.currency}
									data-comparison-cost={project.comparison_cost}
									data-previous-period-cost={project.previous_period_cost ?? ''}
									data-change-percent={project.change_percent ?? ''}
									data-change-state={project.change_state}
									data-cost-to-date={project.cost_to_date ?? ''}
									data-late-count={project.late_entry?.count ?? 0}
									data-evidence-state={evidenceState}
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
									data-employee-cost={String(employeeCost)}
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
													onProjectExpand(expanded ? null : project.project_id)
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
										{formatCurrencyIn(employeeCost, project.currency)}
										{estimatedPayroll && (
											<span className="mt-1 block text-[10px] font-medium text-amber-800">
												Includes salary estimate
											</span>
										)}
										{project.missing_salary_profile_count > 0 && (
											<span className="mt-1 block text-[11px] font-medium text-amber-800">
												{project.missing_salary_profile_count} missing Salary
												Profile(s) · unpriced
											</span>
										)}
									</td>
									<td className="px-3 py-2 text-right tabular-nums text-gray-600">
										{project.logged_hours === 0
											? '—'
											: formatNumber(project.logged_hours)}
									</td>
									<td
										data-testid="project-available-cost"
										className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900"
									>
										{formatCurrencyIn(available, project.currency)}
										{(estimatedPayroll ||
											project.missing_salary_profile_count > 0) && (
											<span className="mt-1 block text-[10px] font-normal text-gray-600">
												Confirmed{' '}
												{formatCurrencyIn(
													project.incurred_cost,
													project.currency
												)}
											</span>
										)}
									</td>
									{(() => {
										const comparison = budgetByProjectCurrency.get(
											`${project.project_id}:${project.currency}`
										);
										const compared =
											comparison?.outcome === 'compared' &&
											comparison.budget !== null &&
											comparison.variance !== null
												? {
														budgetAmount: comparison.budget.amount,
														variance: comparison.variance,
														overBudget: comparison.over_budget,
													}
												: null;
										const percent =
											compared !== null && gt(compared.budgetAmount, 0)
												? mul(
														div(compared.variance, compared.budgetAmount),
														100
													).toDecimalPlaces(2)
												: null;
										const comparisonState =
											comparison === undefined ? 'missing' : comparison.outcome;
										return (
											<>
												<td
													data-testid="project-budget"
													data-outcome={comparisonState}
													className="px-3 py-2 text-right tabular-nums text-gray-700"
												>
													{compared !== null ? (
														<>
															<p>
																{formatCurrencyIn(
																	compared.budgetAmount,
																	project.currency
																)}
															</p>
															<p className="text-[11px] text-gray-500">
																Approved · Compared
															</p>
															{isZero(compared.budgetAmount) && (
																<p className="text-[11px] text-gray-500">
																	Zero budget: percentage unavailable
																</p>
															)}
														</>
													) : (
														<>
															<p>
																{BUDGET_OUTCOME_LABELS[comparisonState] ??
																	'Unavailable'}
															</p>
															<p className="text-[11px] text-gray-500">
																{comparisonReason(comparison, data.month_label)}
															</p>
															<details className="text-[11px]">
																<summary className="cursor-pointer text-gray-500 underline">
																	Why unavailable
																</summary>
																<p className="mt-0.5 text-gray-500">
																	{comparison === undefined
																		? `No approved cost budget is recorded for ${project.project_code} in ${project.currency} for ${data.month_label}.`
																		: comparison.detail}
																</p>
															</details>
														</>
													)}
													{canManageBudgets && (
														<Link
															href={`/projects/${project.project_id}/cost-budgets?month=${month}&currency=${encodeURIComponent(project.currency)}`}
															aria-label={`${comparisonState === 'missing' && canRecordBudget ? 'Add budget' : 'Manage budgets'} for ${project.project_code}`}
															className="mt-2 inline-block text-xs font-medium text-[#64126D] underline underline-offset-2"
														>
															{comparisonState === 'missing' && canRecordBudget
																? 'Add budget'
																: 'Manage budgets'}
														</Link>
													)}
												</td>
												<td
													data-testid="project-budget-variance"
													data-variance={comparison?.variance ?? ''}
													data-percent={
														percent === null ? '' : percent.toString()
													}
													data-over-budget={
														comparison?.over_budget === null ||
														comparison?.over_budget === undefined
															? ''
															: String(comparison.over_budget)
													}
													className="px-3 py-2 text-right tabular-nums text-gray-700"
												>
													{compared !== null ? (
														<>
															<p>
																{compared.overBudget === true
																	? 'Overspent '
																	: 'Remaining '}
																{formatCurrencyIn(
																	Math.abs(compared.variance),
																	project.currency
																)}
															</p>
															<p className="text-[11px] text-gray-500">
																{percent === null
																	? 'Percentage unavailable'
																	: `${percent.toFixed(2)}%`}
															</p>
														</>
													) : (
														'Unavailable'
													)}
												</td>
											</>
										);
									})()}
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
										{reportingCost === null
											? `No rate to ${reportingCurrencyCode}`
											: formatCurrencyIn(reportingCost, reportingCurrencyCode)}
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
											data-state={evidenceState}
											data-findings={project.evidence.findings.join(',')}
											className="font-medium text-gray-700"
										>
											{EVIDENCE_LABELS[evidenceState] ?? evidenceState}
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
										<td colSpan={14} className="bg-gray-50/70 px-3 py-2">
											<div
												data-testid="project-drilldown"
												data-currency={project.currency}
											>
												<p className="mb-1 text-xs font-semibold text-gray-700">
													Source records recognized against{' '}
													{project.project_code}
												</p>
												{drilldownLoading && (
													<p className="text-xs text-gray-500">
														Loading source records…
													</p>
												)}
												{drilldownRecords?.length === 0 && (
													<p className="text-xs text-gray-500">
														No recognized records for this Project in the month.
													</p>
												)}
												<ul className="space-y-1">
													{drilldownRecords?.map((record) => (
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
																Period {formatDate(record.recognition_period)} (
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
																	data-converted={record.converted_amount ?? ''}
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
												{evidenceLoading && (
													<p className="text-xs text-gray-500">
														Loading unresolved evidence…
													</p>
												)}
												{evidenceRecords?.length === 0 && (
													<p className="text-xs text-gray-500">
														No draft or pending-evidence record for this Project
														in the month.
													</p>
												)}
												<ul className="space-y-1">
													{evidenceRecords?.map((record) => (
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
												{(drilldownPeriodCharges?.length ?? 0) > 0 && (
													<div className="mt-1 border-t border-gray-200 pt-1">
														<p className="text-[11px] font-medium text-gray-700">
															Approved period consumption in{' '}
															{formatDate(drilldownMonth ?? month)}
														</p>
														<ul className="space-y-0.5">
															{drilldownPeriodCharges?.map((charge) => (
																<li
																	key={charge.charge_uid}
																	data-testid="drilldown-charge"
																	data-charge-uid={charge.charge_uid}
																	className="flex flex-wrap items-center gap-x-3 text-[11px] text-gray-600"
																>
																	<span>{charge.source_expense_number}</span>
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
															))}
														</ul>
													</div>
												)}
												{/* Client orders for this project (commercial context only) */}
												<div
													data-testid="project-client-orders-drilldown"
													className="mt-2 border-t border-gray-200 pt-1.5"
												>
													<div className="flex flex-wrap items-center justify-between gap-1">
														<p className="text-[11px] font-semibold text-gray-700">
															Client orders for {project.project_code}{' '}
															(Commercial context only)
														</p>
														<span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-800">
															Not recognized revenue, profit, or cost
														</span>
													</div>
													{(() => {
														const projOrders =
															clientOrdersByProject.get(project.project_id) ??
															[];
														if (projOrders.length === 0) {
															return (
																<p className="mt-0.5 text-[11px] text-gray-500">
																	No client orders linked to this Project.
																</p>
															);
														}
														return (
															<ul className="mt-1 space-y-1">
																{projOrders.map((ord) => {
																	const val =
																		ord.amountBasis === 'gross'
																			? ord.grossAmount
																			: ord.netAmount;
																	return (
																		<li
																			key={ord.orderUid}
																			data-testid="project-client-order-item"
																			data-order-number={ord.orderNumber}
																			data-amount={val ?? ''}
																			data-currency={ord.currency}
																			className="flex flex-wrap items-center gap-x-3 text-[11px] text-gray-700"
																		>
																			<span className="font-medium text-gray-900">
																				{ord.orderNumber}
																			</span>
																			<span>{ord.counterpartyName}</span>
																			<span>
																				Order value:{' '}
																				<strong className="text-gray-900">
																					{val !== null
																						? formatCurrencyIn(
																								val,
																								ord.currency
																							)
																						: '—'}
																				</strong>{' '}
																				({ord.amountBasis})
																			</span>
																			{ord.clientInvoicedValue !== null &&
																				ord.clientInvoicedValue !==
																					undefined && (
																					<span>
																						Invoiced:{' '}
																						{formatCurrencyIn(
																							ord.clientInvoicedValue,
																							ord.currency
																						)}
																					</span>
																				)}
																			{ord.clientRemainingValue !== null &&
																				ord.clientRemainingValue !==
																					undefined && (
																					<span>
																						Remaining:{' '}
																						{formatCurrencyIn(
																							ord.clientRemainingValue,
																							ord.currency
																						)}
																					</span>
																				)}
																			<span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] capitalize">
																				{ord.status}
																			</span>
																		</li>
																	);
																})}
															</ul>
														);
													})()}
												</div>
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
	);
}
