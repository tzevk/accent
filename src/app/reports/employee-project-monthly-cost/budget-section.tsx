'use client';

/**
 * The isolated budget section of the company expenditure report (#321).
 *
 * It renders the approved cost budget comparison the module produces and the
 * controls that record, submit, approve, and withdraw a Project cost budget.
 * Everything here is budget-shaped: a budget never contributes to Company
 * Incurred Cost, and the section says so in the reader's words — remaining
 * budget is not profit, recognized revenue, or a forecast.
 *
 * The comparison itself is computed in `@/lib/company-expenditure`; this file
 * only presents it and calls the budget routes.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	BanknotesIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate } from '@/lib/format';

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

/** One stored budget as `GET /api/admin/cost-budgets` returns it. */
interface BudgetRecordRow {
	id: number;
	budget_uid: string;
	project_id: number;
	project_code: string;
	project_name: string;
	currency: string;
	scope: string;
	state: string;
	amount: number;
	period_start: string;
	period_end: string;
	basis_note: string | null;
	approval_evidence_reference: string | null;
	approved_by: number | null;
	approved_at: string | null;
	financial_version: number;
	created_by: number | null;
	created_at: string;
	updated_at: string;
}

interface BudgetJournalRow {
	version: number;
	command: string;
	actor_user_id: number | null;
	reason: string | null;
	evidence_reference: string | null;
	created_at: string;
}

interface BudgetDetailPayload {
	budget: BudgetRecordRow;
	journal: BudgetJournalRow[];
}

export interface BudgetSectionProps {
	month: string;
	section: BudgetSectionPayload;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
	}>;
	/** `other_expenses:update` — may record, edit, submit, withdraw. */
	canManage: boolean;
	/** `other_expenses:approve` — may approve a submitted budget. */
	canApprove: boolean;
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

const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	submitted: 'Submitted',
	approved: 'Approved',
	superseded: 'Superseded',
	withdrawn: 'Withdrawn',
};

const SCOPE_LABELS: Record<string, string> = {
	project_incurred_cost: 'Project cost budget (comparable)',
	commercial_value: 'Commercial value (context only)',
};

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong';
}

function money(value: number | null, currency: string): string {
	return value === null ? '—' : formatCurrencyIn(value, currency);
}

interface BudgetFormProps {
	projectCode: string;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onSubmit: (payload: Record<string, unknown>) => void;
}

/** Record control for one Project cost budget. Recording approves nothing. */
function BudgetForm({
	projectCode,
	submitting,
	error,
	onCancel,
	onSubmit,
}: BudgetFormProps) {
	const [currency, setCurrency] = useState('INR');
	const [amount, setAmount] = useState('');
	const [scope, setScope] = useState('project_incurred_cost');
	const [periodStart, setPeriodStart] = useState('');
	const [periodEnd, setPeriodEnd] = useState('');
	const [basisNote, setBasisNote] = useState('');

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<form
				data-testid="budget-form"
				role="dialog"
				aria-modal="true"
				aria-label="Record cost budget"
				className="mt-8 w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit({
						currency,
						amount: amount === '' ? null : Number(amount),
						scope,
						period_start: periodStart || null,
						period_end: periodEnd || null,
						basis_note: basisNote || null,
					});
				}}
			>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-base font-semibold text-gray-900">
						Record cost budget for {projectCode}
					</h2>
					<button
						type="button"
						onClick={onCancel}
						aria-label="Close"
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-4 w-4" />
					</button>
				</div>
				<p className="mb-3 text-xs text-gray-600">
					A recorded budget is a draft. It becomes an approved cost budget only
					through Submit and Approve, and it is compared with Incurred Project
					Cost only when Project, currency, scope, and period match.
				</p>
				<div className="grid gap-3 md:grid-cols-2">
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
						<span className="mb-1 block font-medium text-gray-700">Amount</span>
						<input
							aria-label="Amount"
							inputMode="decimal"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
							placeholder="5000.00"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">Scope</span>
						<select
							aria-label="Scope"
							value={scope}
							onChange={(event) => setScope(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="project_incurred_cost">
								Project cost budget (compared with Incurred Project Cost)
							</option>
							<option value="commercial_value">
								Commercial value (context only, never compared)
							</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Basis note
						</span>
						<input
							aria-label="Basis note"
							value={basisNote}
							onChange={(event) => setBasisNote(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
							placeholder="What the approval covers"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Period start
						</span>
						<input
							aria-label="Period start"
							type="date"
							value={periodStart}
							onChange={(event) => setPeriodStart(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Period end
						</span>
						<input
							aria-label="Period end"
							type="date"
							value={periodEnd}
							onChange={(event) => setPeriodEnd(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>
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
						data-testid="budget-form-submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Record budget
					</button>
				</div>
			</form>
		</div>
	);
}

interface CommandDialogProps {
	budget: BudgetRecordRow;
	command: 'approve' | 'withdraw';
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: (payload: { reason: string; evidence: string }) => void;
}

/** Reasoned confirmation for approval or withdrawal of a cost budget. */
function CommandDialog({
	budget,
	command,
	submitting,
	error,
	onCancel,
	onConfirm,
}: CommandDialogProps) {
	const [reason, setReason] = useState('');
	const [evidence, setEvidence] = useState('');
	const label = command === 'approve' ? 'Approve budget' : 'Withdraw budget';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="budget-command-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm({ reason, evidence });
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">{label}</h2>
				<p className="mt-1 text-xs text-gray-600">
					{budget.budget_uid} · {money(budget.amount, budget.currency)} ·{' '}
					{budget.period_start} to {budget.period_end} · version{' '}
					{budget.financial_version}
				</p>
				{command === 'approve' && (
					<label className="mt-3 block text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Approval evidence
						</span>
						<input
							aria-label="Approval evidence"
							value={evidence}
							onChange={(event) => setEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
							placeholder="Board minute, signed approval, mail reference"
						/>
						<span className="mt-1 block text-xs text-gray-500">
							An approval without evidence is refused: the comparison cites this
							reference.
						</span>
					</label>
				)}
				<label className="mt-3 block text-sm">
					<span className="mb-1 block font-medium text-gray-700">Reason</span>
					<textarea
						aria-label="Reason"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						rows={3}
						className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						placeholder={
							command === 'approve'
								? 'What the approval rests on'
								: 'Why this budget is withdrawn'
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

export default function BudgetSection({
	month,
	section,
	projectOptions,
	canManage,
	canApprove,
}: BudgetSectionProps) {
	const queryClient = useQueryClient();
	const firstWithBudget =
		section.comparisons.find((row) => row.budget !== null)?.project_id ??
		projectOptions[0]?.project_id ??
		null;
	const [projectId, setProjectId] = useState<number | null>(firstWithBudget);
	const [formOpen, setFormOpen] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [commandTarget, setCommandTarget] = useState<{
		budget: BudgetRecordRow;
		command: 'approve' | 'withdraw';
	} | null>(null);
	const [commandError, setCommandError] = useState<string | null>(null);
	const [expandedBudget, setExpandedBudget] = useState<number | null>(null);

	const budgetsQuery = useQuery<{ data: { budgets: BudgetRecordRow[] } }>({
		queryKey: ['cost-budgets', projectId],
		enabled: projectId !== null,
		queryFn: () => {
			if (projectId === null) {
				throw new Error('Select a Project to read its cost budgets');
			}
			return apiGet('/api/admin/cost-budgets', { project_id: projectId });
		},
	});
	const journalQuery = useQuery<{ data: BudgetDetailPayload }>({
		queryKey: ['cost-budget-detail', expandedBudget],
		enabled: expandedBudget !== null,
		queryFn: () => apiGet(`/api/admin/cost-budgets/${expandedBudget}`),
	});

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		void queryClient.invalidateQueries({ queryKey: ['cost-budgets'] });
		void queryClient.invalidateQueries({ queryKey: ['cost-budget-detail'] });
	};

	const recordMutation = useMutation({
		mutationFn: (payload: Record<string, unknown>) => {
			if (projectId === null) {
				throw new Error('Select a Project before recording a cost budget');
			}
			return apiPost('/api/admin/cost-budgets', {
				...payload,
				project_id: projectId,
			});
		},
		onSuccess: () => {
			setFormOpen(false);
			setFormError(null);
			refresh();
		},
		onError: (error: unknown) => setFormError(errorMessage(error)),
	});
	const commandMutation = useMutation({
		mutationFn: (input: Record<string, unknown>) =>
			apiPost(
				`/api/admin/cost-budgets/${input.id}/commands`,
				input.payload as Record<string, unknown>
			),
		onSuccess: () => {
			setCommandTarget(null);
			setCommandError(null);
			refresh();
		},
		onError: (error: unknown) => setCommandError(errorMessage(error)),
	});

	const selectedProject = projectOptions.find(
		(option) => option.project_id === projectId
	);
	const budgets = budgetsQuery.data?.data.budgets ?? [];
	const journal = journalQuery.data?.data.journal ?? [];

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
				</div>
				{canManage && (
					<button
						type="button"
						data-testid="budget-record-button"
						onClick={() => {
							setFormError(null);
							setFormOpen(true);
						}}
						disabled={projectId === null}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Record cost budget
					</button>
				)}
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
							</tr>
						))}
						{section.comparisons.length === 0 && (
							<tr>
								<td colSpan={6} className="px-2 py-2 text-xs text-gray-500">
									No Project cost or covering budget in this month.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>

			<div className="mt-4 border-t border-gray-100 pt-3">
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-sm font-medium text-gray-700">
						Cost budgets
					</span>
					<div className="w-72">
						<SearchableSelect
							aria-label="Project"
							options={projectOptions.map((option) => ({
								value: String(option.project_id),
								label: `${option.project_code} — ${option.project_name}`,
							}))}
							value={projectId === null ? '' : String(projectId)}
							onChange={(value) => setProjectId(Number(value))}
							placeholder="Select a Project"
						/>
					</div>
					{selectedProject && (
						<span className="text-xs text-gray-500">
							Every version of this Project&apos;s cost budget, with its
							approval evidence and state.
						</span>
					)}
				</div>

				{budgetsQuery.isError && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{errorMessage(budgetsQuery.error)}
					</p>
				)}

				<ul className="mt-2 space-y-1">
					{budgets.map((budget) => (
						<li
							key={budget.budget_uid}
							data-testid="budget-row"
							data-budget-id={budget.id}
							data-budget-uid={budget.budget_uid}
							data-state={budget.state}
							data-version={budget.financial_version}
							className="rounded-lg border border-gray-100 px-3 py-2"
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="text-sm text-gray-800">
									<span className="font-medium">
										{money(budget.amount, budget.currency)}
									</span>{' '}
									<span className="text-xs text-gray-500">
										{STATE_LABELS[budget.state] ?? budget.state} · version{' '}
										{budget.financial_version} · {budget.period_start} to{' '}
										{budget.period_end} ·{' '}
										{SCOPE_LABELS[budget.scope] ?? budget.scope}
										{budget.approval_evidence_reference
											? ` · approval evidence ${budget.approval_evidence_reference}`
											: ''}
										{budget.basis_note ? ` · ${budget.basis_note}` : ''}
									</span>
								</div>
								<div className="flex items-center gap-1">
									<button
										type="button"
										data-testid="budget-history"
										onClick={() =>
											setExpandedBudget(
												expandedBudget === budget.id ? null : budget.id
											)
										}
										className="flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
									>
										{expandedBudget === budget.id ? (
											<ChevronDownIcon className="h-3 w-3" />
										) : (
											<ChevronRightIcon className="h-3 w-3" />
										)}
										History
									</button>
									{canManage && budget.state === 'draft' && (
										<button
											type="button"
											data-testid="budget-submit"
											onClick={() =>
												commandMutation.mutate({
													id: budget.id,
													payload: {
														command: 'submit',
														expected_version: budget.financial_version,
													},
												})
											}
											disabled={commandMutation.isPending}
											className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
										>
											Submit
										</button>
									)}
									{canApprove && budget.state === 'submitted' && (
										<button
											type="button"
											data-testid="budget-approve"
											onClick={() => {
												setCommandError(null);
												setCommandTarget({
													budget,
													command: 'approve',
												});
											}}
											className="rounded-lg bg-[#64126D] px-2 py-1 text-xs font-medium text-white hover:bg-[#52105a]"
										>
											Approve
										</button>
									)}
									{canManage &&
										(budget.state === 'draft' ||
											budget.state === 'submitted' ||
											budget.state === 'approved') && (
											<button
												type="button"
												data-testid="budget-withdraw"
												onClick={() => {
													setCommandError(null);
													setCommandTarget({
														budget,
														command: 'withdraw',
													});
												}}
												className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
											>
												Withdraw
											</button>
										)}
								</div>
							</div>
							{expandedBudget === budget.id && (
								<ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-2">
									{journalQuery.isError && (
										<li role="alert" className="text-xs text-rose-600">
											{errorMessage(journalQuery.error)}
										</li>
									)}
									{journal.map((entry) => (
										<li
											key={entry.version}
											data-testid="budget-history-row"
											data-command={entry.command}
											data-version={entry.version}
											className="text-xs text-gray-600"
										>
											version {entry.version} · {entry.command}
											{entry.evidence_reference
												? ` · evidence ${entry.evidence_reference}`
												: ''}
											{entry.reason ? ` · ${entry.reason}` : ''} ·{' '}
											{formatDate(entry.created_at)}
										</li>
									))}
								</ul>
							)}
						</li>
					))}
					{budgetsQuery.isSuccess && budgets.length === 0 && (
						<li className="text-xs text-gray-500">
							No cost budget recorded for this Project yet.
						</li>
					)}
				</ul>
				<p className="mt-2 text-xs text-gray-500">
					This month is {month}. A budget is compared only inside its approved
					period; a superseded version stays readable for later review.
				</p>
			</div>

			{formOpen && selectedProject && (
				<BudgetForm
					projectCode={selectedProject.project_code}
					submitting={recordMutation.isPending}
					error={formError}
					onCancel={() => setFormOpen(false)}
					onSubmit={(payload) => recordMutation.mutate(payload)}
				/>
			)}
			{commandTarget && (
				<CommandDialog
					budget={commandTarget.budget}
					command={commandTarget.command}
					submitting={commandMutation.isPending}
					error={commandError}
					onCancel={() => setCommandTarget(null)}
					onConfirm={({ reason, evidence }) =>
						commandMutation.mutate({
							id: commandTarget.budget.id,
							payload: {
								command: commandTarget.command,
								expected_version: commandTarget.budget.financial_version,
								reason: reason || null,
								evidence_reference: evidence || undefined,
							},
						})
					}
				/>
			)}
		</section>
	);
}
