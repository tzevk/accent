'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import Modal from '@/components/ui/modal';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate } from '@/lib/format';

import type {
	CostBudgetDetail,
	CostBudgetRecord,
} from '@/lib/company-expenditure';

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
	return error instanceof Error ? error.message : String(error);
}

interface BudgetFormProps {
	projectCode: string;
	projectName: string;
	month: string;
	initialCurrency: string;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onSubmit: (payload: Record<string, unknown>) => void;
}

/** Record control for one Project cost budget. Recording approves nothing. */
function BudgetForm({
	projectCode,
	projectName,
	month,
	initialCurrency,
	submitting,
	error,
	onCancel,
	onSubmit,
}: BudgetFormProps) {
	const [currency, setCurrency] = useState(initialCurrency);
	const [amount, setAmount] = useState('');
	const [scope, setScope] = useState('project_incurred_cost');
	const [periodStart, setPeriodStart] = useState(`${month}-01`);
	const [periodEnd, setPeriodEnd] = useState(() => {
		const end = new Date(`${month}-01T00:00:00Z`);
		end.setUTCMonth(end.getUTCMonth() + 1);
		end.setUTCDate(0);
		return end.toISOString().slice(0, 10);
	});
	const [basisNote, setBasisNote] = useState('');

	return (
		<Modal
			open
			onClose={onCancel}
			title={`Record cost budget for ${projectCode}`}
			size="lg"
			footer={
				<>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						form="budget-form"
						data-testid="budget-form-submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Record budget
					</button>
				</>
			}
		>
			<form
				id="budget-form"
				data-testid="budget-form"
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
				<p className="mb-3 break-words text-sm font-semibold text-gray-900">
					Project: {projectCode} — {projectName}
				</p>
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
							{!CURRENCIES.includes(initialCurrency) && (
								<option value={initialCurrency}>{initialCurrency}</option>
							)}
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
			</form>
		</Modal>
	);
}

interface CommandDialogProps {
	budget: CostBudgetRecord;
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
		<Modal
			open
			onClose={onCancel}
			title={label}
			size="sm"
			footer={
				<>
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						form="budget-command-dialog"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						{label}
					</button>
				</>
			}
		>
			<form
				id="budget-command-dialog"
				data-testid="budget-command-dialog"
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm({ reason, evidence });
				}}
			>
				<p className="mt-1 text-xs text-gray-600">
					{budget.budget_uid} ·{' '}
					{formatCurrencyIn(budget.amount, budget.currency)} ·{' '}
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
			</form>
		</Modal>
	);
}

interface ProjectCostBudgetsProps {
	projectId: number;
	projectCode: string;
	projectName: string;
	month: string;
	currency: string;
	canManage: boolean;
	canApprove: boolean;
}

export default function ProjectCostBudgets({
	projectId,
	projectCode,
	projectName,
	month,
	currency,
	canManage,
	canApprove,
}: ProjectCostBudgetsProps) {
	const queryClient = useQueryClient();
	const [formOpen, setFormOpen] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [commandTarget, setCommandTarget] = useState<{
		budget: CostBudgetRecord;
		command: 'approve' | 'withdraw';
	} | null>(null);
	const [commandError, setCommandError] = useState<string | null>(null);
	const [expandedBudget, setExpandedBudget] = useState<number | null>(null);
	const budgetsQuery = useQuery<{ data: { budgets: CostBudgetRecord[] } }>({
		queryKey: ['cost-budgets', projectId],
		queryFn: () => apiGet('/api/admin/cost-budgets', { project_id: projectId }),
	});
	const journalQuery = useQuery<{ data: CostBudgetDetail }>({
		queryKey: ['cost-budget-detail', expandedBudget],
		enabled: expandedBudget !== null,
		queryFn: () => apiGet(`/api/admin/cost-budgets/${expandedBudget}`),
	});
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		void queryClient.invalidateQueries({
			queryKey: ['cost-budgets', projectId],
		});
		void queryClient.invalidateQueries({ queryKey: ['cost-budget-detail'] });
	};
	const recordMutation = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			apiPost('/api/admin/cost-budgets', { ...payload, project_id: projectId }),
		onSuccess: () => {
			setFormOpen(false);
			setFormError(null);
			refresh();
		},
		onError: (error: unknown) => setFormError(errorMessage(error)),
	});
	const commandMutation = useMutation({
		mutationFn: (input: { id: number; payload: Record<string, unknown> }) =>
			apiPost(`/api/admin/cost-budgets/${input.id}/commands`, input.payload),
		onSuccess: () => {
			setCommandTarget(null);
			setCommandError(null);
			refresh();
		},
		onError: (error: unknown) => setCommandError(errorMessage(error)),
	});
	const budgets = budgetsQuery.data?.data.budgets ?? [];
	const journal = journalQuery.data?.data.journal ?? [];
	return (
		<section
			aria-label="Project cost budgets"
			className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="text-lg font-semibold text-gray-900">Cost budgets</h2>
					<p className="mt-1 text-sm text-gray-600">
						Record, submit, and approve budgets for this project. Budgets do not
						create incurred cost.
					</p>
					<p className="mt-2 break-words text-sm font-medium text-gray-900">
						{projectCode} — {projectName}
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
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a]"
					>
						Record cost budget
					</button>
				)}
			</div>
			{!canManage && (
				<p className="mt-3 text-sm text-gray-600">
					{canApprove
						? 'You can approve submitted budgets. A budget administrator records and submits drafts.'
						: 'Read-only access. Ask a budget administrator to record or change a budget.'}
				</p>
			)}
			<p className="mt-3 text-sm text-gray-600">
				Draft → Submit → Approve. Approval requires an evidence reference.
				Monthly comparisons require the exact month and currency.
			</p>
			{budgetsQuery.isPending && (
				<p role="status" className="mt-4 text-sm text-gray-600">
					Loading cost budgets…
				</p>
			)}
			{budgetsQuery.isError && (
				<div role="alert" className="mt-4 text-sm text-rose-700">
					<p>{errorMessage(budgetsQuery.error)}</p>
					<button
						type="button"
						onClick={() => void budgetsQuery.refetch()}
						className="mt-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
					>
						Retry loading budgets
					</button>
				</div>
			)}
			{commandError && !commandTarget && (
				<p role="alert" className="mt-3 text-sm text-rose-700">
					{commandError} Refresh budgets, then try again.
				</p>
			)}
			<ul className="mt-4 space-y-3">
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
							<div className="min-w-0 break-words text-sm text-gray-800">
								<span className="font-medium tabular-nums">
									{formatCurrencyIn(budget.amount, budget.currency)}
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
							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									data-testid="budget-history"
									aria-expanded={expandedBudget === budget.id}
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
								{((canManage &&
									(budget.state === 'draft' || budget.state === 'submitted')) ||
									(canApprove && budget.state === 'approved')) && (
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
								{!canApprove && canManage && budget.state === 'approved' && (
									<span className="text-xs text-gray-500">
										Withdrawing an approved budget needs approval access
									</span>
								)}
							</div>
						</div>
						{expandedBudget === budget.id && (
							<ul className="mt-2 space-y-0.5 border-t border-gray-100 pt-2">
								{journalQuery.isError && (
									<li role="alert" className="text-xs text-rose-600">
										{errorMessage(journalQuery.error)} Select Refresh budgets to
										try again.
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

			<button
				type="button"
				onClick={refresh}
				className="mt-4 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
			>
				Refresh budgets
			</button>
			{formOpen && (
				<BudgetForm
					projectCode={projectCode}
					projectName={projectName}
					month={month}
					initialCurrency={currency}
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
