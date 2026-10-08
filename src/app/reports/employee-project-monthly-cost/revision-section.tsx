'use client';

/**
 * The isolated financial-revision section of the company expenditure report
 * (#323).
 *
 * It renders the month's revision state — open months state that corrections
 * travel through the ordinary command path, closed months state their frozen
 * prior totals beside the live updated totals — and offers the revision
 * command to operators with revision access: correct a closed cost's amount,
 * period, or classification, or reverse it, with a reason and evidence.
 * Linked order consumptions follow the revised slices in the same
 * transaction; the section only presents the outcome.
 *
 * Unlike the close state (which rides the reconciliation response), the
 * revision history and candidates are their own resource: this section
 * fetches `/api/admin/expenditure-revisions?month=` for the month it
 * renders. The server owns every invariant; this file only presents them
 * and calls the revision route.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	ChevronDownIcon,
	ChevronRightIcon,
	PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn } from '@/lib/format';
import type {
	RevisionCandidate,
	RevisionHistoryEntry,
} from '@/lib/company-expenditure';

export interface RevisionSectionPayload {
	month: string;
	status: 'open' | 'closed';
	close_uid: string | null;
	close_version: number;
	prior: { incurred_cost: number | null; currency: string | null } | null;
	current: { incurred_cost: number | null; currency: string | null };
	candidates: RevisionCandidate[];
	revisions: RevisionHistoryEntry[];
}

export interface RevisionSectionProps {
	month: string;
	/** Financial read gate + `other_expenses:update` — may revise the month. */
	canRevise: boolean;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Something went wrong';
}

function candidateLabel(candidate: RevisionCandidate): string {
	const amount =
		candidate.amount === null
			? 'unknown amount'
			: `${candidate.amount} ${candidate.currency ?? ''}`.trim();
	const classification = candidate.classification ?? candidate.state;
	return `${candidate.number} — ${amount} (${classification})`;
}

function money(value: number | null, currency: string | null): string {
	if (value === null) return 'Unknown';
	return formatCurrencyIn(value, currency ?? 'INR');
}

export default function RevisionSection({
	month,
	canRevise,
}: RevisionSectionProps) {
	const queryClient = useQueryClient();
	const [expanded, setExpanded] = useState(true);
	const [targetUid, setTargetUid] = useState('');
	const [command, setCommand] = useState<'update' | 'cancel'>('update');
	const [amountValue, setAmountValue] = useState('');
	const [classificationValue, setClassificationValue] = useState('');
	const [reasonValue, setReasonValue] = useState('');
	const [evidenceValue, setEvidenceValue] = useState('');
	const [formError, setFormError] = useState<string | null>(null);

	const historyQuery = useQuery<{ data: RevisionSectionPayload }>({
		queryKey: ['expenditure-revisions', month],
		queryFn: () =>
			apiGet('/api/admin/expenditure-revisions', { month }) as Promise<{
				data: RevisionSectionPayload;
			}>,
		enabled: !!month,
		refetchOnWindowFocus: false,
		staleTime: 15_000,
	});

	const data = historyQuery.data?.data ?? null;
	const candidates = data?.candidates ?? [];
	const selected =
		candidates.find((candidate) => candidate.uid === targetUid) ?? null;

	const revisionMutation = useMutation({
		mutationFn: async () => {
			if (!selected || !data) {
				throw new Error('Choose a cost or settlement to revise');
			}
			const patch: Record<string, unknown> = {};
			if (command === 'update') {
				if (amountValue.trim().length > 0) {
					patch.grossAmount = Number(amountValue);
				}
				if (classificationValue.length > 0) {
					patch.costClassification = classificationValue;
					if (classificationValue !== 'project') patch.projectId = null;
				}
			}
			return apiPost('/api/admin/expenditure-revisions', {
				target_kind: selected.kind,
				id: selected.id,
				command,
				expected_version: selected.version,
				target_close_version: data.close_version,
				reason: reasonValue || null,
				evidence_reference: evidenceValue || null,
				patch,
			}) as unknown;
		},
		onSuccess: () => {
			setTargetUid('');
			setAmountValue('');
			setClassificationValue('');
			setReasonValue('');
			setEvidenceValue('');
			setFormError(null);
			void queryClient.invalidateQueries({
				queryKey: ['expenditure-revisions', month],
			});
			void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		},
		onError: (error: unknown) => {
			setFormError(errorMessage(error));
		},
	});

	return (
		<section
			data-testid="financial-revision-section"
			className="mt-6 rounded-lg border border-gray-200 bg-white p-4"
		>
			<button
				type="button"
				data-testid="financial-revision-toggle"
				onClick={() => setExpanded((value) => !value)}
				className="flex w-full items-center gap-2 text-left"
			>
				{expanded ? (
					<ChevronDownIcon className="h-4 w-4" />
				) : (
					<ChevronRightIcon className="h-4 w-4" />
				)}
				<PencilSquareIcon className="h-4 w-4" />
				<h3 className="text-sm font-semibold">Financial revisions</h3>
				<span
					data-testid="financial-revision-status"
					className="ml-auto text-sm font-semibold"
				>
					{!data ? 'Loading…' : data.status === 'closed' ? 'Closed' : 'Open'}
				</span>
			</button>
			<p className="mt-1 text-[11px] text-gray-500">
				A closed month states its frozen prior totals beside the live updated
				totals. Corrections travel through explicit revisions with a reason and
				evidence; the prior figures stay preserved.
			</p>

			{expanded && data && (
				<div className="mt-3 space-y-4">
					<p
						data-testid="financial-revision-totals"
						className="text-xs text-gray-700"
					>
						{data.status === 'closed' ? (
							<>
								Frozen{' '}
								{money(
									data.prior?.incurred_cost ?? null,
									data.prior?.currency ?? null
								)}
								{' → '}current{' '}
								{money(data.current.incurred_cost, data.current.currency)}
								{data.close_uid ? ` (${data.close_uid})` : ''}
							</>
						) : (
							<>
								The month is open: correct its costs through the ordinary
								command path. Current{' '}
								{money(data.current.incurred_cost, data.current.currency)}
							</>
						)}
					</p>

					{data.status === 'closed' && canRevise && (
						<div className="space-y-2">
							<div className="flex flex-col gap-2">
								<label className="block text-xs font-medium text-gray-600">
									<span className="mb-1 block">Target</span>
									<select
										data-testid="financial-revision-target"
										aria-label="Revision target"
										value={targetUid}
										onChange={(event) => setTargetUid(event.target.value)}
										className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
									>
										<option value="">Choose a cost or settlement…</option>
										{candidates.map((candidate) => (
											<option key={candidate.uid} value={candidate.uid}>
												{candidateLabel(candidate)}
											</option>
										))}
									</select>
								</label>
								<label className="block text-xs font-medium text-gray-600">
									<span className="mb-1 block">Command</span>
									<select
										data-testid="financial-revision-command"
										aria-label="Revision command"
										value={command}
										onChange={(event) =>
											setCommand(
												event.target.value === 'cancel' ? 'cancel' : 'update'
											)
										}
										className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
									>
										<option value="update">Correct (update)</option>
										<option value="cancel">Reverse (cancel)</option>
									</select>
								</label>
								{command === 'update' && (
									<>
										<input
											type="number"
											data-testid="financial-revision-amount-input"
											value={amountValue}
											onChange={(event) => setAmountValue(event.target.value)}
											placeholder={`Corrected gross amount (current ${selected?.amount ?? '—'})`}
											className="rounded border border-gray-300 px-2 py-1 text-xs"
										/>
										<select
											data-testid="financial-revision-classification"
											aria-label="Revision classification"
											value={classificationValue}
											onChange={(event) =>
												setClassificationValue(event.target.value)
											}
											className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
										>
											<option value="">Keep classification</option>
											<option value="project">Project</option>
											<option value="company_overhead">Company Overhead</option>
											<option value="unallocated">Unallocated Cost</option>
										</select>
									</>
								)}
								<input
									type="text"
									data-testid="financial-revision-reason-input"
									value={reasonValue}
									onChange={(event) => setReasonValue(event.target.value)}
									placeholder="Reason (required)"
									className="rounded border border-gray-300 px-2 py-1 text-xs"
								/>
								<input
									type="text"
									data-testid="financial-revision-evidence-input"
									value={evidenceValue}
									onChange={(event) => setEvidenceValue(event.target.value)}
									placeholder="Evidence reference (required)"
									className="rounded border border-gray-300 px-2 py-1 text-xs"
								/>
							</div>
							<button
								type="button"
								data-testid="financial-revision-submit"
								disabled={revisionMutation.isPending}
								onClick={() => revisionMutation.mutate()}
								className="rounded bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
							>
								{revisionMutation.isPending
									? 'Revising…'
									: `Revise ${month} (close version ${data.close_version})`}
							</button>
							{(formError || revisionMutation.isError) && (
								<p
									data-testid="financial-revision-error"
									className="text-xs text-rose-700"
								>
									{formError ?? errorMessage(revisionMutation.error)}
								</p>
							)}
						</div>
					)}
					{data.status === 'closed' && !canRevise && (
						<p className="text-xs text-gray-400">
							Revising needs revision access
						</p>
					)}

					<div>
						<h4 className="text-xs font-semibold text-gray-700">
							Revision history — prior and updated figures
						</h4>
						{data.revisions.length === 0 ? (
							<p className="mt-1 text-xs text-gray-500">No revisions yet.</p>
						) : (
							<ul
								data-testid="financial-revision-history"
								className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-700"
							>
								{data.revisions.map((entry) => (
									<li
										key={entry.revision_uid}
										data-testid="financial-revision-entry"
										data-revision={entry.revision_uid}
									>
										<span className="font-medium">
											{entry.target_label ?? entry.target_uid}
										</span>{' '}
										{entry.command === 'cancelled' ? 'reversed' : 'corrected'}{' '}
										{entry.prior_figures.amount ?? '—'}
										{' → '}
										{entry.command === 'cancelled'
											? entry.new_figures.state
											: (entry.new_figures.amount ?? '—')}
										{': '}
										{entry.reason ?? ''}
										{entry.evidence_reference
											? ` [${entry.evidence_reference}]`
											: ''}
									</li>
								))}
							</ul>
						)}
					</div>
				</div>
			)}
		</section>
	);
}
