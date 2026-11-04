'use client';

import { HelpTip } from '../help-tip';
import { formatCount } from '../figures';
import type { LeadAuditIntakeSection, LeadAuditMetric } from '../types';

interface OverviewViewProps {
	report: LeadAuditIntakeSection;
	onSelectMetric: (metric: LeadAuditMetric) => void;
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
							className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
						/>
						<div className="pointer-events-none relative">
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
									Leads recorded
								</span>
								<HelpTip
									className="pointer-events-auto"
									label="About Leads recorded"
								>
									Creation time, including imports — not verified arrival.
								</HelpTip>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
								{formatCount(summary.leads_recorded)}
							</p>
						</div>
					</div>

					<div className="group relative rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D]">
						<button
							type="button"
							onClick={() => onSelectMetric('enquired')}
							aria-label="View Enquiry Date evidence"
							className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
						/>
						<div className="pointer-events-none relative">
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
									Enquiries dated in period
								</span>
								<HelpTip
									className="pointer-events-auto"
									label="About Enquiries dated"
								>
									Stated Enquiry Date inside the period.
								</HelpTip>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
								{formatCount(summary.enquiries_dated)}
							</p>
						</div>
					</div>

					<div className="group relative rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-left shadow-sm transition-colors hover:border-amber-500">
						<button
							type="button"
							onClick={() => onSelectMetric('missing_enquiry_date')}
							aria-label="View missing Enquiry Date evidence"
							className="absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
						/>
						<div className="pointer-events-none relative">
							<div className="flex min-w-0 items-center gap-1.5">
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
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-amber-950">
								{formatCount(summary.missing_enquiry_date)}
							</p>
						</div>
					</div>

					<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
						<div className="relative">
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
									Source labels in evidence
								</span>
								<HelpTip label="About source labels">
									Distinct stored labels; missing labels stay Unknown source.
								</HelpTip>
							</div>
							<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
								{formatCount(summary.distinct_sources)}
							</p>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}
