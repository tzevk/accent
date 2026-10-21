'use client';

import { useRouter } from 'next/navigation';
import {
	LEAD_PROGRESS_MESSAGES,
	type LeadProposalProgress,
} from '@/lib/lead-progress';
import { formatCurrencyIn, formatDate } from '@/lib/format';
import { DocumentTextIcon } from '@heroicons/react/24/outline';

interface LeadProposalProgressProps {
	/**
	 * The downstream block of the Lead detail read. A Lead without one has
	 * no downstream details to show.
	 */
	progress: LeadProposalProgress | null;
}

/**
 * The downstream panel of a Lead: the canonical Proposal, its current
 * status and progress, and the Project the Proposal later links to.
 *
 * The panel never guesses and never overstates:
 * - An enquiry without a Proposal says so.
 * - An enquiry whose canonical Proposal is unresolved says so, and points
 *   at the review panel that resolves it.
 * - A reader who may not read the Proposals gets the restricted marker
 *   only: no title, no status, no value, no navigation.
 * - A reader who may not read the Projects gets the Proposal and the
 *   restricted Project marker.
 *
 * Converted is a handoff, never a sale won: the panel states the Proposal's
 * own status and progress and renames nothing.
 */
export default function LeadProposalProgressPanel({
	progress,
}: LeadProposalProgressProps) {
	const router = useRouter();

	if (!progress || progress.state === 'none') {
		return (
			<section
				aria-label="Proposal progress"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900 flex items-center">
					<DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
					Proposal progress
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					{LEAD_PROGRESS_MESSAGES.none}
				</p>
			</section>
		);
	}

	if (progress.state === 'unresolved') {
		return (
			<section
				aria-label="Proposal progress"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900 flex items-center">
					<DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
					Proposal progress
				</h3>
				<p className="mt-2 text-sm text-gray-600">
					{LEAD_PROGRESS_MESSAGES.unresolved}
				</p>
			</section>
		);
	}

	if (progress.state === 'restricted') {
		return (
			<section
				aria-label="Proposal progress"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900 flex items-center">
					<DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
					Proposal progress
				</h3>
				<p className="mt-2 text-sm text-gray-600" role="status">
					{LEAD_PROGRESS_MESSAGES.restricted}
				</p>
			</section>
		);
	}

	const proposal = progress.proposal;
	if (!proposal) {
		return (
			<section
				aria-label="Proposal progress"
				className="bg-white rounded-lg border border-gray-200 p-6"
			>
				<h3 className="text-lg font-medium text-gray-900 flex items-center">
					<DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
					Proposal progress
				</h3>
				<p className="mt-2 text-sm text-gray-600" role="status">
					{LEAD_PROGRESS_MESSAGES.restricted}
				</p>
			</section>
		);
	}

	const nextAction = proposal.next_action;

	return (
		<section
			aria-label="Proposal progress"
			className="bg-white rounded-lg border border-gray-200 p-6"
		>
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-lg font-medium text-gray-900 flex items-center">
					<DocumentTextIcon className="h-5 w-5 mr-2 text-gray-500" />
					Proposal progress
				</h3>
				<button
					type="button"
					onClick={() => router.push(`/proposals/${proposal.id}`)}
					className="text-sm font-medium text-[#64126D] underline"
				>
					{`Open Proposal #${proposal.id}`}
				</button>
			</div>

			<dl className="space-y-3">
				<div>
					<dt className="text-sm font-medium text-gray-700">Proposal</dt>
					<dd className="text-sm text-gray-900">
						{proposal.title ?? `Proposal #${proposal.id}`}
					</dd>
				</div>
				<div>
					<dt className="text-sm font-medium text-gray-700">Proposal status</dt>
					<dd className="text-sm text-gray-900">
						{proposal.status ?? 'Not stated'}
					</dd>
				</div>
				<div>
					<dt className="text-sm font-medium text-gray-700">
						Proposal progress
					</dt>
					<dd className="text-sm text-gray-900">
						{proposal.progress === null
							? 'Not stated'
							: `${proposal.progress}%`}
					</dd>
				</div>
				<div>
					<dt className="text-sm font-medium text-gray-700">Value</dt>
					<dd className="text-sm text-gray-900">
						{proposal.value === null
							? 'Not stated'
							: formatCurrencyIn(proposal.value, proposal.currency)}
					</dd>
				</div>
				<div>
					<dt className="text-sm font-medium text-gray-700">
						Next action on the Proposal
					</dt>
					<dd className="text-sm text-gray-900">
						{nextAction
							? [
									nextAction.date ? formatDate(nextAction.date) : 'No date',
									nextAction.type,
									nextAction.description,
								]
									.filter(
										(part): part is string =>
											typeof part === 'string' && part !== ''
									)
									.join(' · ')
							: LEAD_PROGRESS_MESSAGES.no_next_action}
					</dd>
					<p className="text-xs text-gray-500 mt-0.5">
						The sales work of a converted enquiry continues on the Proposal.
						Price changes stay in the Proposal revision controls.
					</p>
				</div>
				<div>
					<dt className="text-sm font-medium text-gray-700">Project</dt>
					<dd className="text-sm text-gray-900">
						{proposal.project_state === 'restricted' ? (
							<span role="status">
								{LEAD_PROGRESS_MESSAGES.project_restricted}
							</span>
						) : proposal.project ? (
							<span className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={() =>
										router.push(`/projects/${proposal.project?.id}`)
									}
									className="text-sm font-medium text-[#64126D] underline"
								>
									{`Open Project #${proposal.project.id}`}
								</button>
								<span className="text-gray-600">
									{proposal.project.title ?? ''}
								</span>
								{proposal.project.status ? (
									<span className="text-gray-600">
										{`Status: ${proposal.project.status}`}
									</span>
								) : null}
								{proposal.project.progress === null ? null : (
									<span className="text-gray-600">
										{`Progress: ${proposal.project.progress}%`}
									</span>
								)}
							</span>
						) : (
							LEAD_PROGRESS_MESSAGES.no_project
						)}
					</dd>
				</div>
			</dl>
		</section>
	);
}
