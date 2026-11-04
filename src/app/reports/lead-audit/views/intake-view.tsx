'use client';

import {
	ArrowTrendingUpIcon,
	CalendarDaysIcon,
	TagIcon,
} from '@heroicons/react/24/outline';
import { formatDate } from '@/lib/format';
import { HelpTip } from '../help-tip';
import LeadRegister from '../intake/lead-register';
import type {
	LeadAuditIntakeSection,
	LeadAuditMetric,
	LeadAuditRegisterSection,
	LeadAuditTrendPoint,
} from '../types';

interface IntakeViewProps {
	report: LeadAuditIntakeSection;
	metric: LeadAuditMetric;
	register: LeadAuditRegisterSection | null;
	registerLoading: boolean;
	registerError: string;
	page: number;
	onMetricChange: (metric: LeadAuditMetric) => void;
	onPageChange: (page: number) => void;
	onRetry: () => void;
}

function calendarDate(value: string): string {
	return value ? formatDate(`${value}T00:00:00`) : 'Unknown';
}

function TrendCard({
	title,
	description,
	points,
	tone,
	emptyText,
}: {
	title: string;
	description: string;
	points: LeadAuditTrendPoint[];
	tone: 'intake' | 'enquiry';
	emptyText: string;
}) {
	const max = Math.max(1, ...points.map((point) => point.count));
	const barClass = tone === 'intake' ? 'bg-[#64126D]' : 'bg-[#86288F]';

	return (
		<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
			<div className="flex items-start gap-2">
				{tone === 'intake' ? (
					<ArrowTrendingUpIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
				) : (
					<CalendarDaysIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#86288F]"
						aria-hidden="true"
					/>
				)}
				<div className="flex min-w-0 items-center gap-1.5">
					<h3 className="text-base font-bold text-gray-900">{title}</h3>
					<HelpTip label={`About ${title}`}>{description}</HelpTip>
				</div>
			</div>
			{points.length === 0 ? (
				<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
					{emptyText}
				</p>
			) : (
				<table className="mt-3 w-full border-collapse text-sm">
					<caption className="sr-only">{title}</caption>
					<thead>
						<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
							<th scope="col" className="py-1.5 pr-2 font-semibold">
								Day
							</th>
							<th scope="col" className="py-1.5 pr-2 font-semibold">
								Trend
							</th>
							<th scope="col" className="py-1.5 text-right font-semibold">
								Count
							</th>
						</tr>
					</thead>
					<tbody>
						{points.map((point) => (
							<tr key={point.date} className="border-b border-gray-50">
								<th
									scope="row"
									className="whitespace-nowrap py-1.5 pr-2 text-left font-medium text-gray-800"
								>
									{calendarDate(point.date)}
								</th>
								<td className="w-full py-1.5 pr-2">
									<span className="block h-2 w-full rounded-full bg-gray-100">
										<span
											className={`block h-2 rounded-full ${barClass}`}
											style={{
												width: `${Math.max(4, Math.round((point.count / max) * 100))}%`,
											}}
											aria-hidden="true"
										/>
									</span>
								</td>
								<td className="py-1.5 text-right tabular-nums text-gray-900">
									{point.count.toLocaleString('en-IN')}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
}

export default function IntakeView({
	report,
	metric,
	register,
	registerLoading,
	registerError,
	page,
	onMetricChange,
	onPageChange,
	onRetry,
}: IntakeViewProps) {
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<TrendCard
					title="Intake trend"
					description="Leads recorded by creation time, including imports. System entry is not verified arrival."
					points={report.trends.intake}
					tone="intake"
					emptyText="No Leads were recorded in this period for the applied filters."
				/>
				<TrendCard
					title="Enquiry-date trend"
					description="Leads by their stated Enquiry Date. This is a separate population; system entry never fills a missing date."
					points={report.trends.enquiry_date}
					tone="enquiry"
					emptyText="No stated Enquiry Dates fall in this period for the applied filters."
				/>
			</div>

			<section
				aria-labelledby="lead-audit-sources-heading"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<div className="flex items-start gap-2">
					<TagIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div className="flex min-w-0 items-center gap-1.5">
						<h2
							id="lead-audit-sources-heading"
							className="text-base font-bold text-gray-900"
						>
							Source volumes
						</h2>
						<HelpTip label="About sources">
							Stored source labels are preserved exactly; missing labels appear
							as Unknown source. These volumes count Leads recorded in the
							period. They are not advertising efficiency or return, because the
							report has no spend data.
						</HelpTip>
					</div>
				</div>
				{report.sources.length === 0 ? (
					<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
						No source labels are represented because no Leads were recorded in
						this period for the applied filters.
					</p>
				) : (
					<div
						className="mt-3 overflow-x-auto"
						role="region"
						aria-label="Source volume table. Scroll horizontally for more columns."
						tabIndex={0}
					>
						<table className="w-full min-w-[420px] border-collapse text-sm">
							<caption className="sr-only">
								Source volumes for Leads recorded in the selected period
							</caption>
							<thead>
								<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
									<th scope="col" className="py-1.5 pr-3 font-semibold">
										Source label
									</th>
									<th scope="col" className="py-1.5 text-right font-semibold">
										Leads recorded
									</th>
								</tr>
							</thead>
							<tbody>
								{report.sources.map((source) => (
									<tr
										key={
											source.is_unknown ? '__unknown__' : (source.label ?? '')
										}
										className="border-b border-gray-50"
									>
										<th
											scope="row"
											className="whitespace-pre-wrap py-1.5 pr-3 text-left font-medium text-gray-800"
										>
											{source.is_unknown ? (
												<span className="italic text-gray-600">
													Unknown source
												</span>
											) : (
												source.label
											)}
										</th>
										<td className="py-1.5 text-right tabular-nums text-gray-900">
											{source.count.toLocaleString('en-IN')}
										</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr className="border-t border-gray-200 text-xs text-gray-600">
									<th
										scope="row"
										className="py-1.5 pr-3 text-left font-semibold"
									>
										Distinct labels
									</th>
									<td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">
										{report.summary.distinct_sources.toLocaleString('en-IN')}
									</td>
								</tr>
							</tfoot>
						</table>
					</div>
				)}
			</section>

			<LeadRegister
				reportSummary={report.summary}
				metric={metric}
				onMetricChange={onMetricChange}
				data={register}
				loading={registerLoading}
				error={registerError}
				page={page}
				onPageChange={onPageChange}
				onRetry={onRetry}
			/>
		</div>
	);
}
