'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import { LEAD_STAGES } from '@/lib/lead-stages';
import { LEGACY_REVIEW_LABELS } from '@/lib/lead-review';
import { formatDateTime } from '@/lib/format';
import { leadKeys } from '@/components/leads/queries';
import type { LeadDetail } from '@/components/leads/types';
import type {
	LegacyReviewResolution,
	OpenLegacyReviewItem,
} from '@/lib/lead-review';

interface OwnerOption {
	id: number;
	full_name: string;
}

interface LegacyReviewPanelProps {
	lead: Pick<LeadDetail, 'id' | 'review'>;
	owners: OwnerOption[];
	canReviewStage: boolean;
	canReviewOwner: boolean;
	canReviewProposal: boolean;
}

/**
 * The review flow for legacy Lead values.
 *
 * The panel shows the preserved source evidence, states the facts the old
 * records never stored as unknown, and lets a permitted reviewer decide one
 * open item with a reason. Nothing is guessed here: the reviewer picks from
 * what the records actually contain.
 */
export default function LegacyReviewPanel({
	lead,
	owners,
	canReviewStage,
	canReviewOwner,
	canReviewProposal,
}: LegacyReviewPanelProps) {
	const queryClient = useQueryClient();
	const review = lead.review;
	const [selected, setSelected] = useState<Record<string, string>>({});
	const [reasons, setReasons] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);

	const resolveMutation = useMutation<
		{ success: boolean },
		Error,
		{ review_type: string; resolution: string | null; reason: string }
	>({
		mutationFn: ({ review_type, resolution, reason }) =>
			apiPost(`/api/leads/${lead.id}/review`, {
				review_type,
				resolution,
				reason,
			}),
		onSuccess: () => {
			setError(null);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
		},
		onError: (mutationError) => {
			setError(mutationError.message);
		},
	});

	if (!review) return null;
	const openItems = review.open_items ?? [];
	const resolutions = review.resolutions ?? [];
	if (openItems.length === 0 && resolutions.length === 0) return null;

	const canReview = (item: OpenLegacyReviewItem): boolean => {
		if (item.type === 'stage') return canReviewStage;
		if (item.type === 'owner') return canReviewOwner;
		return canReviewProposal;
	};

	const submit = (item: OpenLegacyReviewItem): void => {
		const reason = (reasons[item.type] ?? '').trim();
		if (reason === '') {
			setError('A resolution needs a reason.');
			return;
		}
		const raw = selected[item.type] ?? '';
		if (raw === '') {
			setError(`Choose the ${item.label.toLowerCase()} first.`);
			return;
		}
		// "Unassigned intake" is the one choice that carries no value.
		const resolution =
			item.type === 'owner' && raw === 'unassigned' ? null : raw;
		setError(null);
		resolveMutation.mutate({
			review_type: item.type,
			resolution,
			reason,
		});
	};

	const unknown = review.unknown_facts;

	return (
		<section
			aria-label="Legacy review"
			className="rounded-lg border border-amber-300 bg-amber-50 p-4"
		>
			<h3 className="text-sm font-semibold text-amber-900">
				Legacy review — original values kept
			</h3>

			{openItems.length === 0 ? (
				<p className="mt-2 text-sm text-amber-900">
					Every legacy value of this Lead is decided. The original values and
					the decisions stay visible below.
				</p>
			) : (
				<p className="mt-2 text-sm text-amber-900">
					{openItems.length}{' '}
					{openItems.length === 1 ? 'item needs' : 'items need'} a decision:{' '}
					{openItems.map((item) => item.label).join(', ')}. Nothing is merged,
					deleted, or guessed.
				</p>
			)}

			{openItems.map((item) => {
				const permitted = canReview(item);
				const selectId = `legacy-review-${item.type}-resolution`;
				const reasonId = `legacy-review-${item.type}-reason`;
				return (
					<article
						key={item.type}
						aria-label={`${item.label} review item`}
						className="mt-4 rounded-md border border-amber-200 bg-white p-3"
					>
						<h4 className="text-sm font-medium text-gray-900">{item.label}</h4>
						<dl className="mt-2 space-y-1 text-sm text-gray-800">
							{item.type === 'stage' ? (
								<div className="flex gap-2">
									<dt className="font-medium">Original stage:</dt>
									<dd>{item.original_value ?? 'Unknown'}</dd>
								</div>
							) : null}
							{item.type === 'owner' ? (
								<div className="flex gap-2">
									<dt className="font-medium">Original owner (as recorded):</dt>
									<dd>{item.original_value ?? 'Unknown'}</dd>
								</div>
							) : null}
							{item.type === 'proposal_link' ? (
								<div className="flex gap-2">
									<dt className="font-medium">Linked Proposals:</dt>
									<dd>
										{(review.linked_proposals ?? [])
											.map((proposal) => `Proposal #${proposal.id}`)
											.join(', ') || 'Unknown'}
									</dd>
								</div>
							) : null}
							<div className="flex gap-2">
								<dt className="font-medium">Stage entered:</dt>
								<dd>{unknown.stage_entry_date}</dd>
							</div>
							<div className="flex gap-2">
								<dt className="font-medium">Original author:</dt>
								<dd>{unknown.original_author}</dd>
							</div>
							<div className="flex gap-2">
								<dt className="font-medium">Call outcome:</dt>
								<dd>{unknown.original_outcome}</dd>
							</div>
						</dl>

						{item.type === 'proposal_link' ? (
							<ul className="mt-2 space-y-1 text-sm text-gray-800">
								{(review.linked_proposals ?? []).map((proposal) => (
									<li key={proposal.id}>
										Proposal #{proposal.id}
										{proposal.proposal_title
											? ` — ${proposal.proposal_title}`
											: ''}
										{proposal.is_deleted ? ' (deleted)' : ''}
										{proposal.is_canonical ? ' (canonical)' : ''}
									</li>
								))}
							</ul>
						) : null}

						{permitted ? (
							<div className="mt-3 space-y-2">
								<div>
									<label
										htmlFor={selectId}
										className="block text-xs font-medium text-gray-700 mb-1"
									>
										{item.type === 'stage'
											? 'Resolve the stage as'
											: item.type === 'owner'
												? 'Resolve the owner as'
												: 'Canonical Proposal'}
									</label>
									<select
										id={selectId}
										value={selected[item.type] ?? ''}
										onChange={(event) =>
											setSelected((current) => ({
												...current,
												[item.type]: event.target.value,
											}))
										}
										className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-accent-purple"
									>
										<option value="">Choose a value</option>
										{item.type === 'stage'
											? LEAD_STAGES.filter(
													(stage) => stage !== 'Converted'
												).map((stage) => (
													<option key={stage} value={stage}>
														{stage}
													</option>
												))
											: null}
										{item.type === 'owner'
											? owners.map((owner) => (
													<option key={owner.id} value={String(owner.id)}>
														{owner.full_name}
													</option>
												))
											: null}
										{item.type === 'owner' ? (
											<option value="unassigned">Unassigned intake</option>
										) : null}
										{item.type === 'proposal_link'
											? (review.linked_proposals ?? []).map((proposal) => (
													<option key={proposal.id} value={String(proposal.id)}>
														Proposal #{proposal.id}
														{proposal.proposal_title
															? ` — ${proposal.proposal_title}`
															: ''}
													</option>
												))
											: null}
									</select>
								</div>
								<div>
									<label
										htmlFor={reasonId}
										className="block text-xs font-medium text-gray-700 mb-1"
									>
										Reason for the resolution
									</label>
									<textarea
										id={reasonId}
										rows={2}
										value={reasons[item.type] ?? ''}
										onChange={(event) =>
											setReasons((current) => ({
												...current,
												[item.type]: event.target.value,
											}))
										}
										className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple"
									/>
								</div>
								<button
									type="button"
									onClick={() => submit(item)}
									disabled={resolveMutation.isPending}
									className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-[#64126D] text-white hover:bg-[#52105a] disabled:opacity-50"
								>
									{`Resolve ${item.label.toLowerCase()}`}
								</button>
							</div>
						) : (
							<p className="mt-3 text-xs text-gray-600">
								You do not have the permission to resolve this item.
							</p>
						)}
					</article>
				);
			})}

			{error ? (
				<p role="alert" className="mt-3 text-sm font-medium text-red-700">
					{error}
				</p>
			) : null}

			{resolutions.length > 0 ? (
				<div className="mt-4 border-t border-amber-200 pt-3">
					<h4 className="text-sm font-medium text-amber-900">Review history</h4>
					<ul className="mt-2 space-y-2">
						{resolutions.map((resolution: LegacyReviewResolution) => (
							<li
								key={resolution.id}
								className="rounded-md border border-amber-200 bg-white p-2 text-sm text-gray-800"
							>
								<p>
									<span className="font-medium">
										{LEGACY_REVIEW_LABELS[resolution.review_type]}
									</span>
									{': '}
									{resolution.original_value
										? `${resolution.original_value} → `
										: ''}
									{resolution.resolved_value ?? 'Unknown'}
								</p>
								<p className="text-xs text-gray-600">
									{resolution.resolution_source === 'automatic'
										? 'Recorded automatically at the legacy cutover'
										: `Reviewed by ${resolution.reviewer_name ?? 'Unknown reviewer'}`}
									{resolution.resolved_at
										? ` on ${formatDateTime(resolution.resolved_at)}`
										: ''}
								</p>
								<p className="text-xs text-gray-700">
									Reason: {resolution.reason}
								</p>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}
