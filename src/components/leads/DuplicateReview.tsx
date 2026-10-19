'use client';

import { useState } from 'react';
import type { LeadDetail } from '@/components/leads/types';

interface DuplicateReviewProps {
	lead: Pick<LeadDetail, 'id' | 'duplicate_candidates'>;
}

/**
 * Potential duplicates for the same enquiry. Review only: the UI never
 * merges leads, so every candidate stays a separate navigation link.
 */
export default function DuplicateReview({ lead }: DuplicateReviewProps) {
	const [open, setOpen] = useState<boolean>(false);
	const candidates = Array.isArray(lead.duplicate_candidates)
		? lead.duplicate_candidates
		: [];
	if (candidates.length === 0) return null;
	return (
		<section
			aria-label="Potential duplicate leads"
			className="rounded-lg border border-gray-200 bg-white p-6"
		>
			<div className="flex items-center justify-between">
				<h3 className="text-lg font-medium text-gray-900">
					Potential duplicates ({candidates.length})
				</h3>
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					aria-expanded={open}
					className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
				>
					{open ? 'Hide' : 'Review'}
				</button>
			</div>
			<p className="mt-1 text-sm text-gray-600">
				Same-enquiry candidates stay separate leads. Nothing is merged here.
			</p>
			{open ? (
				<ul className="mt-4 space-y-2">
					{candidates.map((candidate) => (
						<li
							key={candidate.id}
							className="flex items-center justify-between gap-3 border border-gray-100 rounded-md px-3 py-2"
						>
							<div className="min-w-0">
								<p className="text-sm font-medium text-gray-900">
									Lead #{candidate.id}
									{candidate.lead_id ? ` · ${candidate.lead_id}` : ''}
								</p>
								<p className="text-sm text-gray-600 truncate">
									{candidate.project_description || 'No project description'}
								</p>
							</div>
							<a
								href={`/leads/${candidate.id}`}
								className="shrink-0 text-sm text-purple-700 hover:underline"
							>
								Open lead
							</a>
						</li>
					))}
				</ul>
			) : null}
			<p className="mt-3 text-xs text-gray-500">
				View only. Automatic merging is out of scope.
			</p>
		</section>
	);
}
