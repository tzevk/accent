'use client';

/** Read-only approved budget comparisons. Project administration owns writes. */
import Link from 'next/link';
import { BanknotesIcon } from '@heroicons/react/24/outline';
import { formatCurrencyIn } from '@/lib/format';

interface BudgetCandidateRow {
	budget_id: number;
	budget_uid: string;
	state: string;
	currency: string;
	scope: string;
	amount: number;
	period_start: string;
	period_end: string;
	basis_note: string | null;
	financial_version: number;
	approval_evidence_reference: string | null;
	approved_at: string | null;
}

interface BudgetComparisonRow {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string | null;
	currency: string;
	incurred_cost: number | null;
	confirmed_records: number;
	/** Approved period charges (#317) included in `incurred_cost`. */
	period_charges: number;
	pending_records: number;
	outcome: string;
	budget: BudgetCandidateRow | null;
	candidates: BudgetCandidateRow[];
	variance: number | null;
	over_budget: boolean | null;
	detail: string;
}

interface BudgetNoticeRow {
	code: string;
	label: string;
	detail: string;
	severity: string;
}

export interface BudgetSectionPayload {
	month: string;
	basis: string;
	variance_note: string;
	comparisons: BudgetComparisonRow[];
	notices: BudgetNoticeRow[];
}

interface BudgetSectionProps {
	month: string;
	section: BudgetSectionPayload;
	canManageBudgets: boolean;
	canRecordBudget: boolean;
}

const OUTCOME_LABELS: Record<string, string> = {
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

const SCOPE_LABELS: Record<string, string> = {
	project_incurred_cost: 'Project cost budget (comparable)',
	commercial_value: 'Commercial value (context only)',
};

// Deliberately not ./shared's money: '—' for an absent amount, not 'Unknown'.
function money(value: number | null, currency: string): string {
	return value === null ? '—' : formatCurrencyIn(value, currency);
}

export default function BudgetSection({
	month,
	section,
	canManageBudgets,
	canRecordBudget,
}: BudgetSectionProps) {
	return (
		<section
			data-testid="budget-section"
			className="mt-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
						<BanknotesIcon className="h-5 w-5 text-[#64126D]" />
						Approved cost budget
					</h2>
					<p className="mt-1 max-w-3xl text-xs text-gray-600">
						{section.basis}
					</p>
					<p className="mt-1 max-w-3xl text-xs text-gray-500">
						{section.variance_note}
					</p>
					<p className="mt-2 text-xs text-gray-600">
						Budgets are managed from each project&apos;s admin view.
					</p>
				</div>
				<Link
					href="/projects"
					className="text-sm font-medium text-[#64126D] underline underline-offset-2"
				>
					{canManageBudgets
						? 'Open projects to manage budgets'
						: 'Open projects to view budgets'}
				</Link>
			</div>

			{section.notices.length > 0 && (
				<ul className="mt-3 space-y-1">
					{section.notices.map((notice) => (
						<li
							key={notice.code}
							data-testid="budget-notice"
							data-code={notice.code}
							className={`text-xs ${notice.severity === 'warning' ? 'text-amber-700' : 'text-gray-600'}`}
						>
							<span className="font-medium">{notice.label}:</span>{' '}
							{notice.detail}
						</li>
					))}
				</ul>
			)}

			<div className="mt-3 overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead>
						<tr className="text-left text-xs uppercase tracking-wide text-gray-500">
							<th className="px-2 py-1">Project</th>
							<th className="px-2 py-1">Currency</th>
							<th className="px-2 py-1 text-right">Incurred cost</th>
							<th className="px-2 py-1 text-right">Approved budget</th>
							<th className="px-2 py-1 text-right">Variance</th>
							<th className="px-2 py-1">Basis</th>
							<th className="px-2 py-1">Budgets</th>
						</tr>
					</thead>
					<tbody>
						{section.comparisons.map((row) => (
							<tr
								key={`${row.project_id}-${row.currency}`}
								data-testid="budget-comparison-row"
								data-project-code={row.project_code}
								data-currency={row.currency}
								data-outcome={row.outcome}
								data-incurred={
									row.incurred_cost === null ? '' : String(row.incurred_cost)
								}
								data-charges={String(row.period_charges)}
								data-budget={row.budget ? String(row.budget.amount) : ''}
								data-variance={
									row.variance === null ? '' : String(row.variance)
								}
								className="border-t border-gray-100 align-top"
							>
								<td className="px-2 py-2">
									<span className="font-medium text-gray-900">
										{row.project_code}
									</span>
									<span className="block text-xs text-gray-500">
										{row.project_name}
									</span>
								</td>
								<td className="px-2 py-2 text-gray-700">{row.currency}</td>
								<td className="px-2 py-2 text-right text-gray-900">
									{money(row.incurred_cost, row.currency)}
								</td>
								<td className="px-2 py-2 text-right text-gray-900">
									{row.budget ? money(row.budget.amount, row.currency) : '—'}
								</td>
								<td
									className={`px-2 py-2 text-right font-medium ${
										row.variance === null
											? 'text-gray-500'
											: row.over_budget
												? 'text-rose-600'
												: 'text-emerald-700'
									}`}
								>
									{row.variance === null
										? '—'
										: money(row.variance, row.currency)}
								</td>
								<td className="px-2 py-2">
									<span
										className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
											row.outcome === 'compared'
												? 'bg-emerald-50 text-emerald-700'
												: row.outcome === 'missing' ||
													  row.outcome === 'no_incurred_cost'
													? 'bg-gray-100 text-gray-600'
													: 'bg-amber-50 text-amber-700'
										}`}
									>
										{OUTCOME_LABELS[row.outcome] ?? row.outcome}
									</span>
									<span
										data-testid="budget-outcome-detail"
										className="mt-1 block max-w-xl text-xs text-gray-600"
									>
										{row.detail}
									</span>
									{row.period_charges > 0 && (
										<span className="mt-1 block text-xs text-gray-500">
											{row.period_charges} supported period charge(s) are part
											of this month&apos;s incurred cost.
										</span>
									)}
									{row.candidates.length > 0 && (
										<ul className="mt-1 space-y-0.5">
											{row.candidates.map((candidate) => (
												<li
													key={candidate.budget_uid}
													data-testid="budget-candidate"
													data-budget-uid={candidate.budget_uid}
													data-state={candidate.state}
													className="text-xs text-gray-500"
												>
													{candidate.budget_uid} · {candidate.state} ·{' '}
													{money(candidate.amount, candidate.currency)} ·{' '}
													{candidate.period_start} to {candidate.period_end} ·{' '}
													{SCOPE_LABELS[candidate.scope] ?? candidate.scope}
													{candidate.approval_evidence_reference
														? ` · evidence ${candidate.approval_evidence_reference}`
														: ''}
													{candidate.basis_note
														? ` · ${candidate.basis_note}`
														: ''}
												</li>
											))}
										</ul>
									)}
								</td>
								<td className="px-2 py-2">
									<Link
										href={`/projects/${row.project_id}/cost-budgets?month=${month}&currency=${encodeURIComponent(row.currency)}`}
										aria-label={`${row.outcome === 'missing' && canRecordBudget ? 'Add budget' : canManageBudgets ? 'Manage budgets' : 'View budgets'} for ${row.project_code}`}
										className="font-medium text-[#64126D] underline underline-offset-2"
									>
										{row.outcome === 'missing' && canRecordBudget
											? 'Add budget'
											: canManageBudgets
												? 'Manage budgets'
												: 'View budgets'}
									</Link>
								</td>
							</tr>
						))}
						{section.comparisons.length === 0 && (
							<tr>
								<td colSpan={7} className="px-2 py-2 text-xs text-gray-500">
									No Project cost or covering budget in this month.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
