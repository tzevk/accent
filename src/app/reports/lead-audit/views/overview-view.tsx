'use client';

import {
	CalendarDaysIcon,
	ExclamationTriangleIcon,
	FunnelIcon,
	InboxArrowDownIcon,
	TagIcon,
} from '@heroicons/react/24/outline';
import { HelpTip } from '../help-tip';
import { MethodNote } from '../method-note';
import type { LeadAuditIntakeSection, LeadAuditMetric } from '../types';

interface OverviewViewProps {
	report: LeadAuditIntakeSection;
	onSelectMetric: (metric: LeadAuditMetric) => void;
}

const DISCLOSURE_LABELS: Record<string, string> = {
	system_entry: 'System entry',
	enquiry_date: 'Stated Enquiry Date',
	missing_enquiry_date: 'Missing Enquiry Dates',
	deleted_leads: 'Soft-deleted Leads',
	source_labels: 'Source labels',
	distinct_leads: 'Distinct Lead totals',
	live_data: 'Live facts',
};

function count(value: number): string {
	return value.toLocaleString('en-IN');
}

export default function OverviewView({
	report,
	onSelectMetric,
}: OverviewViewProps) {
	const summary = report.summary;

	return (
		<div className="space-y-4">
			<section aria-labelledby="lead-audit-overview-heading">
				<div className="mb-2 flex min-w-0 items-center gap-1.5">
					<h2
						id="lead-audit-overview-heading"
						className="text-lg font-bold text-gray-900"
					>
						Selected-period intake
					</h2>
					<HelpTip label="About selected-period intake">
						What entered the system. Select a figure to see its Leads.
					</HelpTip>
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<div className="group relative rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D]">
						<button
							type="button"
							onClick={() => onSelectMetric('recorded')}
							aria-label="View Leads recorded evidence"
							className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
						/>
						<div className="pointer-events-none relative">
							<div className="flex items-center justify-between gap-2">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
										Leads recorded
									</span>
									<HelpTip
										className="pointer-events-auto"
										label="About Leads recorded"
									>
										Creation time, including imports — not verified arrival.
									</HelpTip>
								</span>
								<InboxArrowDownIcon
									className="h-5 w-5 text-[#64126D]"
									aria-hidden="true"
								/>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
								{count(summary.leads_recorded)}
							</p>
							<span className="mt-2 inline-block text-xs font-semibold text-[#64126D] group-hover:underline">
								View Leads recorded evidence
							</span>
						</div>
					</div>

					<div className="group relative rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D]">
						<button
							type="button"
							onClick={() => onSelectMetric('enquired')}
							aria-label="View Enquiry Date evidence"
							className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
						/>
						<div className="pointer-events-none relative">
							<div className="flex items-center justify-between gap-2">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
										Enquiries dated in period
									</span>
									<HelpTip
										className="pointer-events-auto"
										label="About Enquiries dated"
									>
										Stated Enquiry Date inside the period.
									</HelpTip>
								</span>
								<CalendarDaysIcon
									className="h-5 w-5 text-[#64126D]"
									aria-hidden="true"
								/>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
								{count(summary.enquiries_dated)}
							</p>
							<span className="mt-2 inline-block text-xs font-semibold text-[#64126D] group-hover:underline">
								View Enquiry Date evidence
							</span>
						</div>
					</div>

					<div className="group relative rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-left shadow-sm transition-colors hover:border-amber-500">
						<button
							type="button"
							onClick={() => onSelectMetric('missing_enquiry_date')}
							aria-label="View missing Enquiry Date evidence"
							className="absolute inset-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
						/>
						<div className="pointer-events-none relative">
							<div className="flex items-center justify-between gap-2">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="text-xs font-semibold uppercase tracking-wide text-amber-900">
										Missing Enquiry Dates
									</span>
									<HelpTip
										className="pointer-events-auto"
										label="About Missing Enquiry Dates"
									>
										Recorded Leads with no Enquiry Date. They stay in Leads
										recorded and are excluded from Enquiries dated in period.
									</HelpTip>
								</span>
								<ExclamationTriangleIcon
									className="h-5 w-5 text-amber-700"
									aria-hidden="true"
								/>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-amber-950">
								{count(summary.missing_enquiry_date)}
							</p>
							<span className="mt-2 inline-block text-xs font-semibold text-amber-900 group-hover:underline">
								View missing-date evidence
							</span>
						</div>
					</div>

					<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
						<div className="relative">
							<div className="flex items-center justify-between gap-2">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
										Source labels in evidence
									</span>
									<HelpTip
										className="pointer-events-auto"
										label="About source labels"
									>
										Distinct stored labels; missing labels stay Unknown source.
									</HelpTip>
								</span>
								<TagIcon
									className="h-5 w-5 text-[#64126D]"
									aria-hidden="true"
								/>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
								{count(summary.distinct_sources)}
							</p>
							<span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-600">
								<FunnelIcon className="h-3.5 w-3.5" aria-hidden="true" />
								See the source breakdown in Intake and sources.
							</span>
						</div>
					</div>
				</div>
			</section>

			<MethodNote
				title="How to read these figures"
				summary="Definitions, live-data limits, and source labels"
			>
				<p className="text-xs text-gray-600">
					Live corrected facts. System entry and enquiry arrival are separate
					populations.
				</p>
				<dl className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
					{report.disclosures.map((disclosure) => (
						<div
							key={disclosure.code}
							className="rounded-lg border border-gray-100 bg-gray-50 p-3"
						>
							<dt className="text-xs font-bold uppercase tracking-wide text-gray-700">
								{DISCLOSURE_LABELS[disclosure.code] ?? disclosure.code}
							</dt>
							<dd className="mt-1 text-sm text-gray-700">{disclosure.text}</dd>
						</div>
					))}
				</dl>
			</MethodNote>
		</div>
	);
}
