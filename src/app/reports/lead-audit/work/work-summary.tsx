'use client';

import {
	ArrowTrendingUpIcon,
	CheckCircleIcon,
	ClipboardDocumentListIcon,
	PhoneIcon,
} from '@heroicons/react/24/outline';
import type {
	LeadAuditWorkMetric,
	LeadAuditWorkSection,
} from '@/server/reports/lead-audit/work-types';
import { formatCount } from '../figures';
import { HelpTip } from '../help-tip';

interface WorkSummaryProps {
	work: LeadAuditWorkSection;
	/** Open the work evidence behind the selected figure. */
	onSelectMetric: (metric: LeadAuditWorkMetric) => void;
}

/**
 * The compact Overview group for selected-period work. It states the three
 * separate answers — completed work, outreach, successful contact — and
 * never blends authorship with current ownership.
 */
export function WorkSummary({ work, onSelectMetric }: WorkSummaryProps) {
	const { summary } = work;

	return (
		<section
			aria-labelledby="lead-audit-work-summary-heading"
			className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="flex items-start gap-2">
				<ClipboardDocumentListIcon
					className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 items-center gap-1.5">
					<h2
						id="lead-audit-work-summary-heading"
						className="text-base font-bold text-gray-900"
					>
						Period work
					</h2>
					<HelpTip label="About period work">
						Completed work dated by when it happened, including work on Leads
						recorded before the period.
					</HelpTip>
					<HelpTip label="About authorship and unknown work">
						{formatCount(summary.by_type.unknown)} unknown type ·{' '}
						{formatCount(work.coverage.unknown_occurrence_date)} undated ·
						authorship by recorded author
					</HelpTip>
				</div>
			</div>

			<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
				<div className="group relative rounded-lg border border-gray-200 bg-gray-50 p-3 text-left hover:border-[#64126D]">
					<button
						type="button"
						onClick={() => onSelectMetric('completed')}
						aria-label="View completed work evidence"
						className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					/>
					<div className="pointer-events-none relative">
						<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
							<ArrowTrendingUpIcon className="h-4 w-4" aria-hidden="true" />
							Completed work
						</span>
						<span className="mt-1 block text-2xl font-bold tabular-nums text-gray-900">
							{formatCount(summary.completed_total)}
						</span>
						<span className="mt-1 block text-xs leading-normal text-gray-600">
							{formatCount(summary.by_type.call)} calls ·{' '}
							{formatCount(summary.by_type.email)} emails ·{' '}
							{formatCount(summary.by_type.meeting)} meetings ·{' '}
							{formatCount(summary.by_type.note)} notes
						</span>
					</div>
				</div>

				<div className="group relative rounded-lg border border-gray-200 bg-gray-50 p-3 text-left hover:border-[#64126D]">
					<button
						type="button"
						onClick={() => onSelectMetric('outreach')}
						aria-label="View Lead Outreach evidence"
						className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					/>
					<div className="pointer-events-none relative">
						<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
							<PhoneIcon className="h-4 w-4" aria-hidden="true" />
							<span className="flex min-w-0 items-center gap-1.5">
								Lead Outreach
								<HelpTip
									className="pointer-events-auto normal-case tracking-normal"
									label="About Lead Outreach"
								>
									On {formatCount(summary.distinct_leads_with_outreach)}{' '}
									distinct Lead
									{summary.distinct_leads_with_outreach === 1 ? '' : 's'}. Notes
									are not outreach.
								</HelpTip>
							</span>
						</span>
						<span className="mt-1 block text-2xl font-bold tabular-nums text-gray-900">
							{formatCount(summary.outreach_total)}
						</span>
					</div>
				</div>

				<div className="group relative rounded-lg border border-gray-200 bg-gray-50 p-3 text-left hover:border-[#64126D]">
					<button
						type="button"
						onClick={() => onSelectMetric('successful_contact')}
						aria-label="View Successful contact evidence"
						className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					/>
					<div className="pointer-events-none relative">
						<span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600">
							<CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
							<span className="flex min-w-0 items-center gap-1.5">
								Successful contact
								<HelpTip
									className="pointer-events-auto normal-case tracking-normal"
									label="About Successful contact"
								>
									Connected calls and confirmed replies on{' '}
									{formatCount(summary.distinct_leads_with_successful_contact)}{' '}
									distinct Lead
									{summary.distinct_leads_with_successful_contact === 1
										? ''
										: 's'}
									.
								</HelpTip>
							</span>
						</span>
						<span className="mt-1 block text-2xl font-bold tabular-nums text-gray-900">
							{formatCount(summary.successful_contact)}
						</span>
					</div>
				</div>
			</div>
		</section>
	);
}

export default WorkSummary;
