'use client';

/**
 * The isolated financial-close section of the company expenditure report
 * (#322).
 *
 * It renders the month's close status — open with its review (blockers and
 * warnings), or closed with its frozen totals and closure review — and offers
 * the close command to operators with close access. Closing freezes the
 * month: every ordinary write to its costs, accruals, settlements,
 * allocations, and classifications is refused with `409 month_closed`, and
 * only explicit revisions can change closed figures. The server owns those
 * invariants; this file only presents them and calls the close route.
 *
 * The close state arrives on the reconciliation response (the same pattern
 * as the cash section's `section` prop): the report route attaches it, so
 * this section never fires a second per-mount request for what the page
 * already holds.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
	BanknotesIcon,
	ChevronDownIcon,
	ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { apiPost } from '@/lib/api-client';
import { formatCurrencyIn } from '@/lib/format';
import type { ClosePayload } from '@/lib/company-expenditure';

export interface CloseSectionProps {
	month: string;
	/** Financial read gate + `other_expenses:update` — may close the month. */
	canClose: boolean;
	/**
	 * The close state from the reconciliation response. Null while the
	 * parent's reconciliation is still loading; the section never fetches
	 * on its own.
	 */
	initialClose: ClosePayload | null;
}

export default function CloseSection({
	month,
	canClose,
	initialClose,
}: CloseSectionProps) {
	const queryClient = useQueryClient();
	const [expanded, setExpanded] = useState(true);
	const [reasonValue, setReasonValue] = useState('');
	const [evidenceValue, setEvidenceValue] = useState('');
	const [formError, setFormError] = useState<string | null>(null);

	const data = initialClose;

	const closeMutation = useMutation({
		mutationFn: async () =>
			(await apiPost('/api/admin/expenditure-close', {
				month,
				expected_version: data?.financial_version ?? 0,
				reason: reasonValue || null,
				evidence_reference: evidenceValue || null,
			})) as unknown,
		onSuccess: () => {
			setReasonValue('');
			setEvidenceValue('');
			setFormError(null);
			// The close state rides on the reconciliation response, so
			// refetching it brings the fresh status, version, and snapshot.
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		},
		onError: (error: unknown) => {
			setFormError(
				error instanceof Error ? error.message : 'Failed to close the month'
			);
		},
	});

	const frozen = data?.snapshot?.company.incurred_cost ?? null;
	const frozenDisplay =
		frozen === null
			? '—'
			: formatCurrencyIn(frozen, data?.snapshot?.company.currency ?? 'INR');

	return (
		<section
			data-testid="financial-close-section"
			className="mt-6 rounded-lg border border-gray-200 bg-white p-4"
		>
			<button
				type="button"
				data-testid="financial-close-toggle"
				onClick={() => setExpanded((value) => !value)}
				className="flex w-full items-center gap-2 text-left"
			>
				{expanded ? (
					<ChevronDownIcon className="h-4 w-4" />
				) : (
					<ChevronRightIcon className="h-4 w-4" />
				)}
				<BanknotesIcon className="h-4 w-4" />
				<h3 className="text-sm font-semibold">Financial close</h3>
				<span
					data-testid="financial-close-status"
					className="ml-auto text-sm font-semibold"
				>
					{!data ? 'Loading…' : data.status === 'closed' ? 'Closed' : 'Open'}
				</span>
			</button>
			<p className="mt-1 text-[11px] text-gray-500">
				An open month states its review; a closed month states its frozen
				totals. Closed figures are immutable: ordinary writes are refused and
				only explicit revisions can change them.
			</p>

			{expanded && data && (
				<div className="mt-3 space-y-4">
					{data.status === 'closed' ? (
						<div>
							<p
								data-testid="financial-close-totals"
								className="text-xs text-gray-700"
							>
								Frozen Company Incurred Cost {frozenDisplay}
								{data.snapshot?.company.currency_totals.map((row) => (
									<span key={row.currency} className="ml-2 text-gray-500">
										{row.currency}{' '}
										{formatCurrencyIn(row.incurred_cost, row.currency)}
									</span>
								))}
							</p>
							<p
								data-testid="financial-close-history"
								className="mt-1 text-[11px] text-gray-500"
							>
								Closed as {data.close_uid} (version {data.financial_version})
								{data.reviewed_at ? ` on ${data.reviewed_at}` : ''}
								{data.reviewed_by !== null
									? ` by user #${data.reviewed_by}`
									: ''}
								{data.review_reason ? `: ${data.review_reason}` : ''}
								{data.evidence_reference ? ` [${data.evidence_reference}]` : ''}
							</p>
						</div>
					) : (
						<div>
							{data.review.blockers.length === 0 ? (
								<p className="text-xs text-emerald-700">
									Review complete: every source is wired and every recognized
									cost carries its evidence. The month can close.
								</p>
							) : (
								<div>
									<h4 className="text-xs font-semibold text-rose-800">
										Blockers — the month cannot close yet
									</h4>
									<ul
										data-testid="financial-close-blockers"
										className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-700"
									>
										{data.review.blockers.map((entry) => (
											<li key={entry.code}>
												<span className="font-medium">{entry.code}</span>
												{': '}
												{entry.detail}
											</li>
										))}
									</ul>
								</div>
							)}
							{data.review.warnings.length > 0 && (
								<div className="mt-2">
									<h4 className="text-xs font-semibold text-amber-800">
										Warnings — disclosed, not blocking
									</h4>
									<ul
										data-testid="financial-close-warnings"
										className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-700"
									>
										{data.review.warnings.map((entry) => (
											<li key={entry.code}>
												<span className="font-medium">{entry.code}</span>
												{': '}
												{entry.detail}
											</li>
										))}
									</ul>
								</div>
							)}
							{canClose ? (
								<div className="mt-3 space-y-2">
									<div className="flex flex-col gap-2">
										<input
											type="text"
											data-testid="financial-close-reason-input"
											value={reasonValue}
											onChange={(event) => setReasonValue(event.target.value)}
											placeholder="Closure review note (optional)"
											className="rounded border border-gray-300 px-2 py-1 text-xs"
										/>
										<input
											type="text"
											data-testid="financial-close-evidence-input"
											value={evidenceValue}
											onChange={(event) => setEvidenceValue(event.target.value)}
											placeholder="Evidence reference (optional)"
											className="rounded border border-gray-300 px-2 py-1 text-xs"
										/>
									</div>
									<button
										type="button"
										data-testid="financial-close-button"
										disabled={closeMutation.isPending}
										onClick={() => closeMutation.mutate()}
										className="rounded bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
									>
										{closeMutation.isPending
											? 'Closing…'
											: `Close ${month} (version ${data.financial_version})`}
									</button>
									{formError && (
										<p
											data-testid="financial-close-error"
											className="text-xs text-rose-700"
										>
											{formError}
										</p>
									)}
								</div>
							) : (
								<p className="mt-2 text-xs text-gray-400">
									Closing needs close access
								</p>
							)}
						</div>
					)}
				</div>
			)}
		</section>
	);
}
