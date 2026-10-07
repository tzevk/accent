'use client';

/**
 * Cost Accrual recognition and replacement dialog (#313).
 *
 * The finance controls on one accrual: submit it into the recognition queue,
 * recognize it as confirmed cost (only received work with evidence, or a
 * supported estimate, may pass), reject or cancel it with a reason, and
 * supersede it with a recognized supplier invoice — partially, matching only
 * the stated/remaining amount, or finally, releasing the remaining estimate
 * and recording the estimate-versus-actual difference with its period and
 * evidence. Every act states the version it read; a stale one fails visibly.
 * Cancelling the replacement invoice itself (in the purchase-invoice dialog)
 * releases the matched amount back here, atomically.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-fields';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate } from '@/lib/format';

interface AccrualReplacement {
	id: number;
	invoice_id: number;
	invoice_cost_uid: string;
	replaced_amount: number;
	invoice_amount: number | null;
	difference_amount: number;
	difference_period: string | null;
	difference_reason: string | null;
	evidence_reference: string | null;
	replacement_period: string | null;
	is_final: boolean;
	state: string;
	accrual_version: number;
	invoice_version: number;
	released_at: string | null;
	released_by: number | null;
	release_reason: string | null;
	release_evidence_reference: string | null;
}

interface AccrualLink {
	cost_uid: string;
	source_table: string;
	source_id: string;
	role: string;
	basis: string;
	review_state: string;
}

interface ReplacementCandidate {
	invoice_id: number;
	invoice_number: string;
	cost_uid: string;
	recognized_amount: number | null;
	recognition_period: string | null;
	financial_version: number;
	project_code: string | null;
	project_name: string | null;
}

interface AccrualDetail {
	id: number;
	accrual_number: string;
	cost_uid: string;
	description: string;
	vendor_name: string | null;
	order_uid: string | null;
	evidence_basis: string;
	recognition_state: string;
	financial_version: number;
	cost_classification: string | null;
	project_code: string | null;
	project_name: string | null;
	recognition_period: string | null;
	currency: string;
	gross_amount: number | null;
	tax_amount: number | null;
	recognized_amount: number | null;
	replaced_amount: number;
	owner_user_id: number | null;
	evidence_reference: string | null;
	replacements: AccrualReplacement[];
	links: AccrualLink[];
	replacement_candidates: ReplacementCandidate[];
}

const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

const EVIDENCE_BASIS_LABELS: Record<string, string> = {
	received_work: 'Received work (evidence)',
	supported_estimate: 'Supported estimate',
	purchase_order: 'PO balance (not evidence)',
};

export default function AccrualRecognitionDialog({
	accrualId,
	onClose,
	onChanged,
}: {
	accrualId: number;
	onClose: () => void;
	onChanged: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const [reason, setReason] = useState('');
	const [invoiceId, setInvoiceId] = useState('');
	const [final, setFinal] = useState(false);
	const [replacedAmount, setReplacedAmount] = useState('');
	const [differenceReason, setDifferenceReason] = useState('');
	const [differencePeriod, setDifferencePeriod] = useState('');
	const [evidence, setEvidence] = useState('');

	const detailQuery = useQuery({
		queryKey: ['cost-accrual', accrualId],
		queryFn: () => apiGet(`/api/admin/cost-accruals/${accrualId}`),
	});
	const detail = detailQuery.data?.data as AccrualDetail | undefined;
	const candidates = detail?.replacement_candidates ?? [];
	const selected = candidates.find(
		(candidate) => String(candidate.invoice_id) === invoiceId
	);

	async function runCommand(command: string): Promise<void> {
		if (!detail) return;
		setBusy(true);
		try {
			await apiPost(`/api/admin/cost-accruals/${accrualId}/commands`, {
				command,
				expected_version: detail.financial_version,
				reason: reason || null,
			});
			toast.success(`Cost accrual ${command}`);
			await detailQuery.refetch();
			onChanged();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : `${command} failed`);
		} finally {
			setBusy(false);
		}
	}

	async function submitReplacement(): Promise<void> {
		if (!detail || !selected) {
			toast.error('Choose a recognized invoice first');
			return;
		}
		setBusy(true);
		try {
			await apiPost(`/api/admin/cost-accruals/${accrualId}/replacements`, {
				invoice_id: selected.invoice_id,
				final,
				replaced_amount:
					replacedAmount === '' ? null : Number(replacedAmount),
				difference_reason: differenceReason || null,
				difference_period: differencePeriod || null,
				evidence_reference: evidence || null,
				reason: reason || null,
				expected_accrual_version: detail.financial_version,
				expected_invoice_version: selected.financial_version,
			});
			toast.success('Accrual replaced');
			setInvoiceId('');
			setFinal(false);
			setReplacedAmount('');
			setDifferenceReason('');
			setDifferencePeriod('');
			setEvidence('');
			await detailQuery.refetch();
			onChanged();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Replacement failed'
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<div
				data-testid="accrual-recognition-dialog"
				className="mt-10 w-full max-w-3xl rounded-xl bg-white p-5 shadow-xl"
			>
				<div className="flex items-start justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold text-gray-900">
							Cost Accrual {detail?.accrual_number ?? accrualId}
						</h2>
						<p className="text-sm text-gray-500">
							{detail?.description ?? 'Loading…'}
							{detail?.vendor_name ? ` · ${detail.vendor_name}` : ''}
						</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						data-testid="accrual-close"
						onClick={onClose}
					>
						Close
					</Button>
				</div>

				{detail && (
					<>
						<div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
							<div>
								<span className="block text-xs text-gray-500">State</span>
								<span
									data-testid="accrual-state"
									className="font-medium text-gray-900"
								>
									{STATE_LABELS[detail.recognition_state] ??
										detail.recognition_state}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">Version</span>
								<span className="font-medium text-gray-900">
									v{detail.financial_version}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">
									Evidence basis
								</span>
								<span className="font-medium text-gray-900">
									{EVIDENCE_BASIS_LABELS[detail.evidence_basis] ??
										detail.evidence_basis}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">Owner</span>
								<span className="font-medium text-gray-900">
									{detail.owner_user_id ?? '—'}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">
									Recognition period
								</span>
								<span className="font-medium text-gray-900">
									{formatDate(detail.recognition_period)}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">Estimate</span>
								<span className="font-medium text-gray-900">
									{formatCurrencyIn(detail.gross_amount, detail.currency)}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">
									Remaining estimate
								</span>
								<span
									data-testid="accrual-remaining-amount"
									className="font-semibold text-gray-900"
								>
									{formatCurrencyIn(detail.recognized_amount, detail.currency)}
								</span>
							</div>
							<div>
								<span className="block text-xs text-gray-500">Replaced</span>
								<span
									data-testid="accrual-replaced-amount"
									className="font-semibold text-gray-900"
								>
									{formatCurrencyIn(detail.replaced_amount, detail.currency)}
								</span>
							</div>
						</div>

						<div className="mt-4 flex flex-wrap items-end gap-2">
							<label className="text-sm">
								<span className="block text-xs text-gray-500">
									Reason (reject/cancel)
								</span>
								<Input
									data-testid="accrual-reason"
									value={reason}
									onChange={(event) => setReason(event.target.value)}
									className="w-64"
								/>
							</label>
							{detail.recognition_state === 'draft' && (
								<Button
									variant="outline"
									data-testid="accrual-submit"
									disabled={busy}
									onClick={() => runCommand('submit')}
								>
									Submit
								</Button>
							)}
							{(detail.recognition_state === 'draft' ||
								detail.recognition_state === 'pending_evidence') && (
								<Button
									data-testid="accrual-recognize"
									disabled={busy}
									onClick={() => runCommand('recognize')}
								>
									Recognize
								</Button>
							)}
							{(detail.recognition_state === 'draft' ||
								detail.recognition_state === 'pending_evidence') && (
								<Button
									variant="outline"
									data-testid="accrual-reject"
									disabled={busy}
									onClick={() => runCommand('reject')}
								>
									Reject
								</Button>
							)}
							{detail.recognition_state !== 'cancelled' &&
								detail.recognition_state !== 'rejected' && (
									<Button
										variant="destructive"
										data-testid="accrual-cancel"
										disabled={busy}
										onClick={() => runCommand('cancel')}
									>
										Cancel
									</Button>
								)}
						</div>

						<div className="mt-5 border-t border-gray-200 pt-4">
							<h3 className="text-sm font-semibold text-gray-800">
								Replacement invoices
							</h3>
							<p className="mt-0.5 text-xs text-gray-500">
								A partial replacement supersedes only the matched amount and
								leaves the remainder visible; a final replacement supersedes
								the whole remaining estimate and explains the difference with
								its period and evidence.
							</p>
							<ul className="mt-2 space-y-1">
								{detail.replacements.length === 0 && (
									<li className="text-xs text-gray-500">
										No replacement invoice yet.
									</li>
								)}
								{detail.replacements.map((replacement) => (
									<li
										key={replacement.id}
										data-testid="accrual-replacement-row"
										data-state={replacement.state}
										data-replaced-amount={replacement.replaced_amount}
										data-difference-amount={replacement.difference_amount}
										className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-700"
									>
										<span className="font-medium">
											Invoice #{replacement.invoice_id}
										</span>
										<span>
											Replaced{' '}
											{formatCurrencyIn(
												replacement.replaced_amount,
												detail.currency
											)}
										</span>
										<span>
											Invoice{' '}
											{formatCurrencyIn(
												replacement.invoice_amount,
												detail.currency
											)}
										</span>
										{replacement.difference_amount !== 0 && (
											<span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900">
												Difference{' '}
												{formatCurrencyIn(
													replacement.difference_amount,
													detail.currency
												)}{' '}
												({replacement.difference_reason ?? 'no reason'},{' '}
												{formatDate(replacement.difference_period)})
											</span>
										)}
										<span
											className={`rounded px-1.5 py-0.5 ${
												replacement.state === 'active'
													? 'bg-emerald-100 text-emerald-800'
													: 'bg-slate-100 text-slate-700'
											}`}
										>
											{replacement.state === 'active' ? 'Active' : 'Released'}
										</span>
										{replacement.state === 'released' && (
											<span className="text-gray-500">
												{replacement.release_reason ?? 'released'}
											</span>
										)}
									</li>
								))}
							</ul>

							{detail.recognition_state === 'recognized' &&
								(detail.recognized_amount ?? 0) > 0 && (
									<div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
										<label className="text-sm sm:col-span-3">
											<span className="block text-xs text-gray-500">
												Recognized invoice
											</span>
											<Select
												data-testid="accrual-replacement-invoice"
												value={invoiceId}
												onChange={(event) => setInvoiceId(event.target.value)}
											>
												<option value="">Select an invoice…</option>
												{candidates.map((candidate) => (
													<option
														key={candidate.invoice_id}
														value={candidate.invoice_id}
													>
														{candidate.invoice_number} —{' '}
														{formatCurrencyIn(
															candidate.recognized_amount,
															detail.currency
														)}
													</option>
												))}
											</Select>
										</label>
										<label className="flex items-center gap-2 text-sm">
											<input
												type="checkbox"
												data-testid="accrual-replacement-final"
												checked={final}
												onChange={(event) => setFinal(event.target.checked)}
											/>
											<span>Final replacement</span>
										</label>
										<label className="text-sm">
											<span className="block text-xs text-gray-500">
												Matched amount (blank = remaining)
											</span>
											<Input
												type="number"
												step="0.01"
												data-testid="accrual-replacement-amount"
												value={replacedAmount}
												onChange={(event) =>
													setReplacedAmount(event.target.value)
												}
											/>
										</label>
										<label className="text-sm">
											<span className="block text-xs text-gray-500">
												Difference period
											</span>
											<Input
												type="date"
												data-testid="accrual-replacement-difference-period"
												value={differencePeriod}
												onChange={(event) =>
													setDifferencePeriod(event.target.value)
												}
											/>
										</label>
										<label className="text-sm sm:col-span-2">
											<span className="block text-xs text-gray-500">
												Difference reason (required when the actual differs)
											</span>
											<Input
												data-testid="accrual-replacement-difference-reason"
												value={differenceReason}
												onChange={(event) =>
													setDifferenceReason(event.target.value)
												}
											/>
										</label>
										<label className="text-sm sm:col-span-2">
											<span className="block text-xs text-gray-500">
												Evidence reference
											</span>
											<Input
												data-testid="accrual-replacement-evidence"
												value={evidence}
												onChange={(event) => setEvidence(event.target.value)}
											/>
										</label>
										<div className="flex items-end">
											<Button
												data-testid="accrual-replacement-submit"
												disabled={busy || !selected}
												onClick={submitReplacement}
											>
												Replace
											</Button>
										</div>
									</div>
								)}
						</div>

						{detail.links.length > 0 && (
							<div className="mt-4 border-t border-gray-200 pt-3">
								<h3 className="text-sm font-semibold text-gray-800">
									Source links
								</h3>
								<ul className="mt-1 space-y-0.5 text-xs text-gray-600">
									{detail.links.map((link) => (
										<li key={`${link.source_table}-${link.source_id}-${link.role}`}>
											{link.role}: {link.source_table} #{link.source_id} (
											{link.basis}, {link.review_state})
										</li>
									))}
								</ul>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
