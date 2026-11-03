'use client';

import Link from 'next/link';
import {
	ArrowPathIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { formatDate } from '@/lib/format';
import type {
	LeadAuditMetric,
	LeadAuditRegisterSection,
	LeadAuditSummary,
} from '../types';

interface LeadRegisterProps {
	reportSummary: LeadAuditSummary;
	metric: LeadAuditMetric;
	onMetricChange: (metric: LeadAuditMetric) => void;
	data: LeadAuditRegisterSection | null;
	loading: boolean;
	error: string;
	page: number;
	onPageChange: (page: number) => void;
	onRetry: () => void;
}

const METRIC_LABELS: Array<{
	key: LeadAuditMetric;
	label: string;
	count: (summary: LeadAuditSummary) => number;
}> = [
	{
		key: 'recorded',
		label: 'Leads recorded',
		count: (summary) => summary.leads_recorded,
	},
	{
		key: 'enquired',
		label: 'Enquiries dated',
		count: (summary) => summary.enquiries_dated,
	},
	{
		key: 'missing_enquiry_date',
		label: 'Missing Enquiry Dates',
		count: (summary) => summary.missing_enquiry_date,
	},
];

function calendarDate(value: string | null): string {
	if (!value) return 'Unknown';
	return formatDate(`${value}T00:00:00`);
}

function recordedAt(value: string): string {
	return value ? value : 'Unknown';
}

export default function LeadRegister({
	reportSummary,
	metric,
	onMetricChange,
	data,
	loading,
	error,
	page,
	onPageChange,
	onRetry,
}: LeadRegisterProps) {
	const totalPages = Math.max(1, data?.pagination.total_pages ?? 1);
	const total = data?.pagination.total ?? 0;

	return (
		<section
			aria-labelledby="lead-audit-register-heading"
			className="rounded-xl border border-gray-200 bg-white shadow-sm"
		>
			<div className="border-b border-gray-100 p-4">
				<h2
					id="lead-audit-register-heading"
					className="text-lg font-bold text-gray-900"
				>
					Lead register
				</h2>
				<p className="mt-0.5 text-sm text-gray-600">
					The evidence behind the selected intake figure. Applied filters stay
					active when the figure changes.
				</p>
				<div
					className="mt-3 flex flex-wrap gap-2"
					role="group"
					aria-label="Register evidence metric"
				>
					{METRIC_LABELS.map((option) => {
						const selected = option.key === metric;
						return (
							<button
								key={option.key}
								type="button"
								onClick={() => onMetricChange(option.key)}
								aria-pressed={selected}
								className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-1 ${
									selected
										? 'border-[#64126D] bg-[#64126D] text-white'
										: 'border-gray-300 bg-white text-gray-700 hover:border-[#64126D]'
								}`}
							>
								{option.label}
								<span
									className={
										selected
											? 'rounded-full bg-white/20 px-1.5 tabular-nums'
											: 'rounded-full bg-gray-100 px-1.5 tabular-nums'
									}
								>
									{option.count(reportSummary).toLocaleString('en-IN')}
								</span>
							</button>
						);
					})}
				</div>
				{data ? (
					<p className="mt-2 text-xs text-gray-600" role="note">
						<strong className="font-semibold text-gray-800">
							{data.metric.label}:
						</strong>{' '}
						{data.metric.definition}
					</p>
				) : null}
			</div>

			{loading ? (
				<div
					className="flex items-center justify-center gap-2 p-10 text-sm text-gray-600"
					role="status"
				>
					<ArrowPathIcon
						className="h-5 w-5 animate-spin text-[#64126D]"
						aria-hidden="true"
					/>
					Loading Lead evidence…
				</div>
			) : error ? (
				<div className="p-6" role="alert">
					<div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
						<ExclamationTriangleIcon
							className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
							aria-hidden="true"
						/>
						<div>
							<p className="text-sm font-semibold text-red-900">
								The Lead register could not be loaded.
							</p>
							<p className="mt-0.5 text-sm text-red-800">{error}</p>
							<button
								type="button"
								onClick={onRetry}
								className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
							>
								<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Retry
							</button>
						</div>
					</div>
				</div>
			) : total === 0 ? (
				<div className="p-10 text-center">
					<p className="text-sm font-semibold text-gray-800">
						No Lead evidence for this figure and filter set.
					</p>
					<p className="mt-1 text-sm text-gray-600">
						Widen the period or clear a filter. A zero result is not an error.
					</p>
				</div>
			) : (
				<>
					<div
						className="overflow-x-auto"
						role="region"
						aria-label="Lead register table. Scroll horizontally for more columns."
						tabIndex={0}
					>
						<table className="w-full min-w-[960px] border-collapse text-sm">
							<caption className="sr-only">
								{data?.metric.label ?? 'Lead evidence'} with the applied filters
							</caption>
							<thead>
								<tr className="border-b border-[#64126D]/30 bg-[#64126D]/10">
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Lead
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Contact
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Source
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Priority
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Current stage
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Current owner
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Enquiry Date
									</th>
									<th
										scope="col"
										className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
									>
										Recorded
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{(data?.leads ?? []).map((lead) => (
									<tr key={lead.id} className="hover:bg-purple-50/40">
										<td className="px-3 py-2.5 align-top">
											<Link
												href={`/leads/${lead.id}`}
												className="font-semibold text-[#4A1254] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
											>
												{lead.company_name}
											</Link>
											<span className="mt-0.5 block text-xs text-gray-600">
												{lead.lead_id ?? `Lead #${lead.id}`}
											</span>
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{lead.contact_name ?? 'Unknown'}
										</td>
										<td className="whitespace-pre-wrap px-3 py-2.5 align-top text-gray-800">
											{lead.source.is_unknown ? (
												<span className="italic text-gray-600">
													Unknown source
												</span>
											) : (
												lead.source.label
											)}
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{lead.priority ?? 'Unknown'}
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{lead.stage.label}
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{lead.owner ? lead.owner.name ?? 'Unknown user' : 'Unassigned'}
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{calendarDate(lead.enquiry_date)}
										</td>
										<td className="px-3 py-2.5 align-top tabular-nums text-gray-800">
											{recordedAt(lead.recorded_at)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="flex flex-col gap-2 border-t border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-xs text-gray-600">
							{total.toLocaleString('en-IN')} distinct Lead
							{total === 1 ? '' : 's'} in this evidence set. Page {page} of{' '}
							{totalPages}.
						</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								disabled={page <= 1}
								onClick={() => onPageChange(page - 1)}
								className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] disabled:cursor-not-allowed disabled:opacity-50"
							>
								<ChevronLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Previous
							</button>
							<button
								type="button"
								disabled={page >= totalPages}
								onClick={() => onPageChange(page + 1)}
								className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] disabled:cursor-not-allowed disabled:opacity-50"
							>
								Next
								<ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
							</button>
						</div>
					</div>
				</>
			)}
		</section>
	);
}
