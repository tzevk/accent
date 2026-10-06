'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';

/**
 * The review surface of the other-expense register: possible duplicate
 * references waiting for a decision, the copies a reviewer confirmed, and the
 * entries whose classification or evidence is still unresolved.
 *
 * A candidate match is never merged here by similarity alone: confirming it is
 * an explicit, authorized decision (the server requires `other_expenses:approve`
 * and the version the reviewer read), and rejecting it leaves the entry a
 * standalone cost.
 */

interface ReviewTarget {
	cost_uid: string;
	label: string | null;
	source_table: string;
	recognition_state: string | null;
}

interface PendingCopy {
	link_id: number;
	copy_id: string;
	voucher_number: string;
	financial_version: number;
	gross_amount: number | null;
	currency: string | null;
	vendor_name: string | null;
	created_at: string | null;
	target: ReviewTarget;
}

interface LinkedCopy {
	link_id: number;
	copy_id: string;
	voucher_number: string;
	basis: string;
	review_state: string;
	target_cost_uid: string;
}

interface UnresolvedEntry {
	id: string;
	voucher_number: string;
	recognition_state: string;
	financial_version: number;
	gross_amount: number | null;
	cost_classification: string | null;
	missing: string[];
}

interface ReviewQueuePayload {
	pending_copies: PendingCopy[];
	linked_copies: LinkedCopy[];
	unresolved: UnresolvedEntry[];
}

interface OtherExpenseApiRow {
	id: string;
	voucher_number: string;
	cost_uid: string | null;
	linked_cost_uid: string | null;
	project_id: number | null;
	cost_classification: string | null;
	recognition_state: string;
	recognition_period: string | null;
	period_basis: string;
	service_period_start: string | null;
	service_period_end: string | null;
	bill_date: string | null;
	currency: string | null;
	reporting_currency: string | null;
	conversion_rate: string | null;
	conversion_date: string | null;
	conversion_evidence_reference: string | null;
	converted_amount: number | null;
	net_amount: number | null;
	gst_amount: number | null;
	bill_amount: number | null;
	tax_treatment: string;
	tax_evidence_reference: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	recognized_amount: number | null;
	financial_version: number;
}

interface ProjectOptionRow {
	project_id: number;
	project_code: string;
	project_title: string | null;
	name: string | null;
}

const CLASSIFICATION_LABELS: Record<string, string> = {
	project: 'Project',
	company_overhead: 'Company Overhead',
	unallocated: 'Unallocated Cost'
};

const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled'
};

const MISSING_LABELS: Record<string, string> = {
	cost_classification: 'classification',
	recognition_period: 'recognition period',
	source_reference: 'source reference',
	evidence_reference: 'evidence reference'
};

function labelOf(value: string | null, labels: Record<string, string>): string {
	if (!value) return 'Unresolved';
	return labels[value] ?? value;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong';
}

/** One reasoned decision on a possible duplicate reference. */
function CopyDecisionDialog({
	copy,
	action,
	onCancel,
	onDone,
}: {
	copy: PendingCopy;
	action: 'confirm_copy' | 'reject_copy';
	onCancel: () => void;
	onDone: () => void;
}) {
	const [reason, setReason] = useState('');
	const [evidence, setEvidence] = useState('');
	const confirming = action === 'confirm_copy';

	const decision = useMutation({
		mutationFn: () =>
			apiPost(`/api/admin/other-expenses/${copy.copy_id}/review`, {
				action,
				expected_version: copy.financial_version,
				reason,
				evidence_reference: evidence || null
			}),
		onSuccess: () => {
			toast.success(
				confirming
					? 'Copy linked to the recognized cost'
					: 'Possible duplicate rejected; the entry stays its own cost'
			);
			onDone();
		},
		onError: (error: unknown) => toast.error(errorMessage(error))
	});

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="copy-decision-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={confirming ? 'Confirm receipt copy' : 'Reject duplicate'}
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					decision.mutate();
				}}
			>
				<h3 className="text-base font-semibold text-gray-900">
					{confirming ? 'Confirm as receipt copy' : 'Reject the duplicate match'}
				</h3>
				<p className="mt-1 text-xs text-gray-600">
					{copy.voucher_number} ·{' '}
					{copy.gross_amount === null
						? 'amount unknown'
						: formatCurrency(copy.gross_amount)}
					{confirming
						? ` — links to ${copy.target.label ?? copy.target.cost_uid} and adds no cost.`
						: ' — the entry stays a standalone cost.'}
				</p>
				<label
					className="mt-3 block text-xs font-medium text-gray-700"
					htmlFor="copy-decision-reason"
				>
					Reason
				</label>
				<input
					id="copy-decision-reason"
					data-testid="copy-decision-reason"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
				/>
				<label
					className="mt-3 block text-xs font-medium text-gray-700"
					htmlFor="copy-decision-evidence"
				>
					Evidence reference
				</label>
				<input
					id="copy-decision-evidence"
					data-testid="copy-decision-evidence"
					value={evidence}
					onChange={(event) => setEvidence(event.target.value)}
					className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
				/>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="copy-decision-cancel"
						onClick={onCancel}
						className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
					>
						Cancel
					</button>
					<button
						type="submit"
						data-testid="copy-decision-submit"
						disabled={decision.isPending}
						className="rounded bg-[#64126D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
					>
						{confirming ? 'Confirm copy' : 'Reject match'}
					</button>
				</div>
			</form>
		</div>
	);
}

/**
 * One entry's review dialog: the financial fields the versioned commands own,
 * and the recognition commands themselves. The server refuses a receipt copy
 * here, because a copy is evidence, not a cost.
 */
export function OtherExpenseReviewDialog({
	id,
	voucher,
	onClose,
	onSaved,
}: {
	id: string;
	voucher: string;
	onClose: () => void;
	onSaved: () => void;
}) {
	const queryClient = useQueryClient();
	const rowQuery = useQuery<{ data: OtherExpenseApiRow }>({
		queryKey: ['other-expense', id],
		queryFn: () => apiGet(`/api/admin/other-expenses/${id}`)
	});
	const projectsQuery = useQuery<{ data: ProjectOptionRow[] }>({
		queryKey: ['projects-for-expenditure'],
		queryFn: () => apiGet('/api/projects'),
		staleTime: 60_000
	});

	const row = rowQuery.data?.data;
	const [draft, setDraft] = useState<Record<string, string> | null>(null);
	const [reason, setReason] = useState('');
	const [evidence, setEvidence] = useState('');
	const values: Record<string, string> = draft ?? {
		classification: row?.cost_classification ?? '',
		project_id: row?.project_id ? String(row.project_id) : '',
		service_period_start: row?.service_period_start?.slice(0, 10) ?? '',
		service_period_end: row?.service_period_end?.slice(0, 10) ?? '',
		bill_date: row?.bill_date?.slice(0, 10) ?? '',
		// A stored currency is shown as it is; an unknown one stays blank so the
		// operator states it rather than inheriting INR silently.
		currency: row?.currency ?? '',
		reporting_currency: row?.reporting_currency ?? '',
		conversion_rate:
			row?.conversion_rate === null || row?.conversion_rate === undefined
				? ''
				: String(row.conversion_rate),
		conversion_date: row?.conversion_date?.slice(0, 10) ?? '',
		conversion_evidence_reference: row?.conversion_evidence_reference ?? '',
		gross_amount: row?.net_amount === null || row?.net_amount === undefined
			? ''
			: String(row.net_amount),
		tax_amount: row?.gst_amount === null || row?.gst_amount === undefined
			? ''
			: String(row.gst_amount),
		tax_treatment: row?.tax_treatment ?? 'unresolved',
		tax_evidence_reference: row?.tax_evidence_reference ?? '',
		source_reference: row?.source_reference ?? '',
		evidence_reference: row?.evidence_reference ?? '',
		link_target: row?.linked_cost_uid ?? ''
	};
	const set = (key: string, value: string) =>
		setDraft({ ...values, [key]: value });

	const conversionTouched =
		values.reporting_currency !== '' ||
		values.conversion_rate !== '' ||
		values.conversion_date !== '' ||
		values.conversion_evidence_reference !== '';
	const hadConversionEvidence = Boolean(
		row?.reporting_currency ||
			row?.conversion_rate ||
			row?.conversion_date ||
			row?.conversion_evidence_reference
	);
	const patch = {
		classification: values.classification || null,
		project_id: values.project_id || null,
		service_period_start: values.service_period_start || null,
		service_period_end: values.service_period_end || null,
		bill_date: values.bill_date || null,
		currency: values.currency || null,
		gross_amount: values.gross_amount === '' ? null : values.gross_amount,
		tax_amount: values.tax_amount === '' ? null : values.tax_amount,
		tax_treatment: values.tax_treatment || null,
		tax_evidence_reference: values.tax_evidence_reference || null,
		source_reference: values.source_reference || null,
		evidence_reference: values.evidence_reference || null,
		// Conversion evidence moves as a whole and is approval-gated: the keys
		// are sent only when the entry states or already carries evidence, so a
		// plain edit never needs the approval permission.
		...(conversionTouched || hadConversionEvidence
			? {
					reporting_currency: values.reporting_currency || null,
					conversion_rate: values.conversion_rate || null,
					conversion_date: values.conversion_date || null,
					conversion_evidence_reference:
						values.conversion_evidence_reference || null
				}
			: {})
	};

	const runCommand = useMutation({
		mutationFn: (command: string) =>
			apiPost(`/api/admin/other-expenses/${id}/commands`, {
				command,
				expected_version: row?.financial_version,
				reason: reason || null,
				evidence_reference: evidence || null,
				patch: command === 'update' ? patch : undefined
			}),
		onSuccess: () => {
			toast.success('Entry updated');
			void queryClient.invalidateQueries({ queryKey: ['other-expenses'] });
			void queryClient.invalidateQueries({ queryKey: ['other-expense-review'] });
			onSaved();
			onClose();
		},
		onError: (error: unknown) => toast.error(errorMessage(error))
	});

	const runReview = useMutation({
		mutationFn: (action: 'confirm_copy' | 'unlink_copy') =>
			apiPost(`/api/admin/other-expenses/${id}/review`, {
				action,
				expected_version: row?.financial_version,
				reason: reason || null,
				evidence_reference: evidence || null,
				target_cost_uid: values.link_target || null
			}),
		onSuccess: () => {
			toast.success('Reference decision recorded');
			void queryClient.invalidateQueries({ queryKey: ['other-expenses'] });
			void queryClient.invalidateQueries({ queryKey: ['other-expense-review'] });
			onSaved();
			onClose();
		},
		onError: (error: unknown) => toast.error(errorMessage(error))
	});

	if (!row) {
		return (
			<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
				<div
					data-testid="oe-review-dialog"
					data-voucher={voucher}
					role="dialog"
					aria-modal="true"
					className="w-full max-w-lg rounded-xl bg-white p-4 text-sm text-gray-600 shadow-xl"
				>
					Loading…
				</div>
			</div>
		);
	}

	const isCopy = Boolean(row.linked_cost_uid);
	const projectOptions = projectsQuery.data?.data ?? [];
	const fieldClass =
		'mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm';
	const labelClass = 'block text-xs font-medium text-gray-700';

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<form
				data-testid="oe-review-dialog"
				data-voucher={voucher}
				data-version={String(row.financial_version)}
				data-state={row.recognition_state}
				role="dialog"
				aria-modal="true"
				aria-label={`Review ${voucher}`}
				className="mt-8 w-full max-w-2xl rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					runCommand.mutate('update');
				}}
			>
				<div className="flex items-start justify-between gap-3">
					<div>
						<h3 className="text-base font-semibold text-gray-900">
							{voucher} · {labelOf(row.recognition_state, STATE_LABELS)}
						</h3>
						<p className="mt-0.5 text-xs text-gray-500">
							{row.linked_cost_uid
								? `Receipt copy of ${row.linked_cost_uid} — evidence, not a second cost.`
								: row.cost_uid
									? `Cost ${row.cost_uid} · version ${row.financial_version}`
									: 'Draft entry'}
							{row.recognition_period
								? ` · period ${String(row.recognition_period).slice(0, 10)} (${row.period_basis})`
								: ' · no recognition period'}
						</p>
					</div>
					<button
						type="button"
						data-testid="oe-close"
						onClick={onClose}
						className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600"
					>
						Close
					</button>
				</div>

				<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
					<label className={labelClass} htmlFor="oe-classification">
						Classification
						<select
							id="oe-classification"
							value={values.classification}
							onChange={(event) => set('classification', event.target.value)}
							className={fieldClass}
						>
							<option value="">Unresolved</option>
							<option value="project">Project</option>
							<option value="company_overhead">Company Overhead</option>
							<option value="unallocated">Unallocated Cost</option>
						</select>
					</label>
					<label className={labelClass} htmlFor="oe-project-id">
						Project
						<select
							id="oe-project-id"
							value={values.project_id}
							onChange={(event) => set('project_id', event.target.value)}
							className={fieldClass}
						>
							<option value="">No project</option>
							{projectOptions.map((project) => (
								<option
									key={project.project_id}
									value={String(project.project_id)}
								>
									{project.project_code} —{' '}
									{project.project_title ?? project.name ?? ''}
								</option>
							))}
						</select>
					</label>
					<label className={labelClass} htmlFor="oe-service-period-start">
						Service period start
						<input
							id="oe-service-period-start"
							type="date"
							value={values.service_period_start}
							onChange={(event) =>
								set('service_period_start', event.target.value)
							}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-service-period-end">
						Service period end
						<input
							id="oe-service-period-end"
							type="date"
							value={values.service_period_end}
							onChange={(event) => set('service_period_end', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-currency">
						Currency
						<input
							id="oe-currency"
							value={values.currency}
							onChange={(event) => set('currency', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-gross">
						Gross amount
						<input
							id="oe-gross"
							type="number"
							step="0.01"
							value={values.gross_amount}
							onChange={(event) => set('gross_amount', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-tax">
						Tax amount
						<input
							id="oe-tax"
							type="number"
							step="0.01"
							value={values.tax_amount}
							onChange={(event) => set('tax_amount', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-tax-treatment">
						Tax treatment
						<select
							id="oe-tax-treatment"
							value={values.tax_treatment}
							onChange={(event) => set('tax_treatment', event.target.value)}
							className={fieldClass}
						>
							<option value="unresolved">Unresolved</option>
							<option value="none">None</option>
							<option value="recoverable">Recoverable</option>
							<option value="non_recoverable">Non-recoverable</option>
						</select>
					</label>
					<label className={labelClass} htmlFor="oe-tax-evidence">
						Tax evidence reference
						<input
							id="oe-tax-evidence"
							value={values.tax_evidence_reference}
							onChange={(event) =>
								set('tax_evidence_reference', event.target.value)
							}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-source-reference">
						Source reference
						<input
							id="oe-source-reference"
							value={values.source_reference}
							onChange={(event) => set('source_reference', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-evidence-reference">
						Evidence reference
						<input
							id="oe-evidence-reference"
							value={values.evidence_reference}
							onChange={(event) =>
								set('evidence_reference', event.target.value)
							}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-reason">
						Reason
						<input
							id="oe-reason"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-reporting-currency">
						Reporting currency
						<input
							id="oe-reporting-currency"
							value={values.reporting_currency}
							onChange={(event) =>
								set('reporting_currency', event.target.value)
							}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-conversion-rate">
						Conversion rate
						<input
							id="oe-conversion-rate"
							value={values.conversion_rate}
							onChange={(event) => set('conversion_rate', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-conversion-date">
						Conversion date
						<input
							id="oe-conversion-date"
							type="date"
							value={values.conversion_date}
							onChange={(event) => set('conversion_date', event.target.value)}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-conversion-evidence">
						Conversion evidence reference
						<input
							id="oe-conversion-evidence"
							value={values.conversion_evidence_reference}
							onChange={(event) =>
								set('conversion_evidence_reference', event.target.value)
							}
							className={fieldClass}
						/>
					</label>
					<label className={labelClass} htmlFor="oe-evidence">
						Decision evidence reference
						<input
							id="oe-evidence"
							value={evidence}
							onChange={(event) => setEvidence(event.target.value)}
							className={fieldClass}
						/>
					</label>
				</div>

				{row.converted_amount !== null ? (
					<p className="mt-3 text-xs text-gray-600">
						Reporting figure: {formatCurrency(row.converted_amount)} at{' '}
						{row.conversion_rate ?? '—'} ({row.reporting_currency ?? '—'})
					</p>
				) : null}

				<div className="mt-4 flex flex-wrap items-center gap-2">
					<button
						type="submit"
						data-testid="oe-save"
						disabled={runCommand.isPending}
						className="rounded border border-[#64126D]/40 bg-[#64126D]/5 px-3 py-1.5 text-sm font-medium text-[#64126D] disabled:opacity-50"
					>
						Save changes
					</button>
					<button
						type="button"
						data-testid="oe-recognize"
						disabled={isCopy || runCommand.isPending}
						onClick={() => runCommand.mutate('recognize')}
						className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 disabled:opacity-50"
					>
						Recognize
					</button>
					<button
						type="button"
						data-testid="oe-reject"
						disabled={isCopy || runCommand.isPending}
						onClick={() => runCommand.mutate('reject')}
						className="rounded border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-800 disabled:opacity-50"
					>
						Reject
					</button>
					<button
						type="button"
						data-testid="oe-cancel-entry"
						disabled={isCopy || runCommand.isPending}
						onClick={() => runCommand.mutate('cancel')}
						className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
					>
						Cancel entry
					</button>
				</div>

				{isCopy ? (
					<div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2">
						<p className="text-xs text-gray-600">
							This row is a receipt copy of {row.linked_cost_uid}; it is not a
							cost and cannot be recognized.
						</p>
						<button
							type="button"
							data-testid="oe-unlink"
							disabled={runReview.isPending}
							onClick={() => runReview.mutate('unlink_copy')}
							className="mt-2 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
						>
							Undo the copy link
						</button>
					</div>
				) : (
					<div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2">
						<label className={labelClass} htmlFor="oe-link-target">
							Receipt copy of an already recognized cost (cost id)
						</label>
						<input
							id="oe-link-target"
							value={values.link_target}
							onChange={(event) => set('link_target', event.target.value)}
							placeholder="cost-…"
							className={fieldClass}
						/>
						<button
							type="button"
							data-testid="oe-confirm-link"
							disabled={runReview.isPending}
							onClick={() => runReview.mutate('confirm_copy')}
							className="mt-2 rounded border border-[#64126D]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#64126D] disabled:opacity-50"
						>
							Confirm as receipt copy
						</button>
					</div>
				)}
			</form>
		</div>
	);
}

/** The register's review tab. */
export default function OtherExpenseReviewPanel({
	onOpenEntry,
}: {
	onOpenEntry: (id: string, voucher: string) => void;
}) {
	const queryClient = useQueryClient();
	const queueQuery = useQuery<{ data: ReviewQueuePayload }>({
		queryKey: ['other-expense-review'],
		queryFn: () => apiGet('/api/admin/other-expenses/review')
	});
	const [decision, setDecision] = useState<{
		copy: PendingCopy;
		action: 'confirm_copy' | 'reject_copy';
	} | null>(null);

	const queue = queueQuery.data?.data ?? {
		pending_copies: [],
		linked_copies: [],
		unresolved: []
	};
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: ['other-expense-review'] });
		void queryClient.invalidateQueries({ queryKey: ['other-expenses'] });
	};

	return (
		<div
			data-testid="other-expense-review"
			className="rounded-xl border border-gray-200 bg-white shadow-sm"
		>
			<div className="border-b border-gray-100 px-4 py-3">
				<h2 className="text-sm font-semibold text-gray-900">
					Possible duplicate references
				</h2>
				<p className="mt-0.5 text-xs text-gray-500">
					A similar vendor and amount is preserved as a candidate. It never
					merges cost by itself: confirming links the entry as a receipt copy of
					an already recognized cost, rejecting keeps it a standalone cost.
				</p>
			</div>
			{queue.pending_copies.length === 0 ? (
				<p className="px-4 py-3 text-xs text-gray-500">
					No duplicate reference is waiting for review.
				</p>
			) : (
				<ul className="divide-y divide-gray-100">
					{queue.pending_copies.map((copy) => (
						<li
							key={copy.link_id}
							data-testid="copy-review-row"
							data-voucher={copy.voucher_number}
							data-copy-id={copy.copy_id}
							data-target={copy.target.cost_uid}
							className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
						>
							<div className="text-xs text-gray-700">
								<div className="text-sm font-medium text-gray-900">
									{copy.voucher_number} ·{' '}
									{copy.gross_amount === null
										? 'amount unknown'
										: formatCurrency(copy.gross_amount)}
								</div>
								<div>
									Possible copy of{' '}
									{copy.target.label ?? copy.target.cost_uid}
									{copy.vendor_name ? ` · ${copy.vendor_name}` : ''}
									{copy.created_at ? ` · ${formatDate(copy.created_at)}` : ''}
								</div>
							</div>
							<div className="flex items-center gap-2">
								<button
									type="button"
									data-testid="confirm-copy"
									onClick={() =>
										setDecision({ copy, action: 'confirm_copy' })
									}
									className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800"
								>
									Confirm as copy
								</button>
								<button
									type="button"
									data-testid="reject-copy"
									onClick={() => setDecision({ copy, action: 'reject_copy' })}
									className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800"
								>
									Reject duplicate
								</button>
							</div>
						</li>
					))}
				</ul>
			)}

			{queue.linked_copies.length > 0 ? (
				<>
					<div className="border-y border-gray-100 bg-gray-50 px-4 py-2">
						<h2 className="text-sm font-semibold text-gray-900">
							Confirmed receipt copies
						</h2>
						<p className="mt-0.5 text-xs text-gray-500">
							Evidence linked to a recognized cost; each one adds no cost of its
							own.
						</p>
					</div>
					<ul className="divide-y divide-gray-100">
						{queue.linked_copies.map((copy) => (
							<li
								key={copy.link_id}
								data-testid="linked-copy-row"
								data-voucher={copy.voucher_number}
								className="flex items-center justify-between px-4 py-2 text-xs text-gray-700"
							>
								<span>
									{copy.voucher_number} → {copy.target_cost_uid}
								</span>
								<span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">
									{copy.basis}
								</span>
							</li>
						))}
					</ul>
				</>
			) : null}

			<div className="border-y border-gray-100 bg-gray-50 px-4 py-2">
				<h2 className="text-sm font-semibold text-gray-900">
					Entries needing classification or evidence
				</h2>
				<p className="mt-0.5 text-xs text-gray-500">
					Unresolved classification is disclosed, never guessed into a group.
				</p>
			</div>
			{queue.unresolved.length === 0 ? (
				<p className="px-4 py-3 text-xs text-gray-500">
					Every open entry is classified and evidenced.
				</p>
			) : (
				<ul className="divide-y divide-gray-100">
					{queue.unresolved.map((entry) => (
						<li
							key={entry.id}
							data-testid="unresolved-row"
							data-voucher={entry.voucher_number}
							data-missing={entry.missing.join(',')}
							data-state={entry.recognition_state}
							className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
						>
							<div className="text-xs text-gray-700">
								<div className="text-sm font-medium text-gray-900">
									{entry.voucher_number} ·{' '}
									{entry.gross_amount === null
										? 'amount unknown'
										: formatCurrency(entry.gross_amount)}
								</div>
								<div>
									{labelOf(entry.cost_classification, CLASSIFICATION_LABELS)} ·{' '}
									{labelOf(entry.recognition_state, STATE_LABELS)}
									{entry.missing.length > 0
										? ` · missing ${entry.missing
												.map(
													(field) => MISSING_LABELS[field] ?? field
												)
												.join(', ')}`
										: ''}
								</div>
							</div>
							<button
								type="button"
								data-testid="open-entry-review"
								onClick={() => onOpenEntry(entry.id, entry.voucher_number)}
								className="rounded border border-[#64126D]/40 bg-[#64126D]/5 px-2 py-1 text-xs font-medium text-[#64126D]"
							>
								Review entry
							</button>
						</li>
					))}
				</ul>
			)}

			{decision ? (
				<CopyDecisionDialog
					copy={decision.copy}
					action={decision.action}
					onCancel={() => setDecision(null)}
					onDone={() => {
						setDecision(null);
						refresh();
					}}
				/>
			) : null}
		</div>
	);
}
