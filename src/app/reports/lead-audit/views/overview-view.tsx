'use client';

import {
	ArrowPathRoundedSquareIcon,
	CalendarDaysIcon,
	ExclamationTriangleIcon,
	FunnelIcon,
	InboxArrowDownIcon,
	TagIcon,
} from '@heroicons/react/24/outline';
import type {
	LeadAuditIntakeSection,
	LeadAuditMetric,
} from '../types';

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
				<div className="mb-2">
					<h2
						id="lead-audit-overview-heading"
						className="text-lg font-bold text-gray-900"
					>
						Selected-period intake
					</h2>
					<p className="text-sm text-gray-600">
						Review what entered the system, separately from the Enquiry Dates
						recorded on those Leads. Select any intake figure to open its
						matching Lead evidence with the same filters.
					</p>
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<button
						type="button"
						onClick={() => onSelectMetric('recorded')}
						className="group rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
								Leads recorded
							</span>
							<InboxArrowDownIcon
								className="h-5 w-5 text-[#64126D]"
								aria-hidden="true"
							/>
						</div>
						<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
							{count(summary.leads_recorded)}
						</p>
						<p className="mt-2 text-xs text-gray-600">
							System entry by creation time, including imports. This is not
							verified enquiry arrival.
						</p>
						<span className="mt-2 inline-block text-xs font-semibold text-[#64126D] group-hover:underline">
							View Leads recorded evidence
						</span>
					</button>

					<button
						type="button"
						onClick={() => onSelectMetric('enquired')}
						className="group rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
								Enquiries dated in period
							</span>
							<CalendarDaysIcon
								className="h-5 w-5 text-[#64126D]"
								aria-hidden="true"
							/>
						</div>
						<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
							{count(summary.enquiries_dated)}
						</p>
						<p className="mt-2 text-xs text-gray-600">
							Leads whose stated, editable Enquiry Date falls inside the period.
							A separate population from system entry.
						</p>
						<span className="mt-2 inline-block text-xs font-semibold text-[#64126D] group-hover:underline">
							View Enquiry Date evidence
						</span>
					</button>

					<button
						type="button"
						onClick={() => onSelectMetric('missing_enquiry_date')}
						className="group rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-left shadow-sm transition-colors hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
					>
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-semibold uppercase tracking-wide text-amber-900">
								Missing Enquiry Dates
							</span>
							<ExclamationTriangleIcon
								className="h-5 w-5 text-amber-700"
								aria-hidden="true"
							/>
						</div>
						<p className="mt-2 text-3xl font-bold tabular-nums text-amber-950">
							{count(summary.missing_enquiry_date)}
						</p>
						<p className="mt-2 text-xs text-amber-900">
							Recorded Leads in this period with no Enquiry Date. They stay in
							system entry and are excluded from Enquiry Date figures.
						</p>
						<span className="mt-2 inline-block text-xs font-semibold text-amber-900 group-hover:underline">
							View missing-date evidence
						</span>
					</button>

					<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
						<div className="flex items-center justify-between gap-2">
							<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
								Source labels in evidence
							</span>
							<TagIcon className="h-5 w-5 text-[#64126D]" aria-hidden="true" />
						</div>
						<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
							{count(summary.distinct_sources)}
						</p>
						<p className="mt-2 text-xs text-gray-600">
							Distinct stored labels among Leads recorded in this period.
							Missing labels are grouped as Unknown source, never merged into
							another label.
						</p>
						<span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-gray-600">
							<FunnelIcon className="h-3.5 w-3.5" aria-hidden="true" />
							See the source breakdown in Intake and sources.
						</span>
					</div>
				</div>
			</section>

			<section
				aria-labelledby="lead-audit-coverage-heading"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<div className="flex items-start gap-2">
					<ArrowPathRoundedSquareIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div>
						<h2
							id="lead-audit-coverage-heading"
							className="text-lg font-bold text-gray-900"
						>
							What these figures can establish
						</h2>
						<p className="text-sm text-gray-600">
							The report uses live corrected facts. Read each disclosure before
							comparing system entry with enquiry arrival.
						</p>
					</div>
				</div>
				<dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
					{report.disclosures.map((disclosure) => (
						<div
							key={disclosure.code}
							className="rounded-lg border border-gray-100 bg-gray-50 p-3"
						>
							<dt className="text-xs font-bold uppercase tracking-wide text-gray-700">
								{DISCLOSURE_LABELS[disclosure.code] ?? disclosure.code}
							</dt>
							<dd className="mt-1 text-sm text-gray-700">
								{disclosure.text}
							</dd>
						</div>
					))}
				</dl>
			</section>
		</div>
	);
}
