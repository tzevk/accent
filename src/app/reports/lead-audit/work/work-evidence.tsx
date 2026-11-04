'use client';

import Link from 'next/link';
import {
	ArrowPathIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import type {
	LeadAuditWorkEvidenceRow,
	LeadAuditWorkEvidenceSection,
} from '@/server/reports/lead-audit/work-types';

interface WorkEvidenceProps {
	data: LeadAuditWorkEvidenceSection | null;
	loading: boolean;
	error: string;
	page: number;
	onPageChange: (page: number) => void;
	onRetry: () => void;
}

function stamp(value: string | null): string {
	return value ?? 'Unknown';
}

function authorLabel(author: LeadAuditWorkEvidenceRow['author']): string {
	if (author.is_unknown) return 'Unknown author';
	if (author.name) return author.name;
	return author.id === null ? 'Unknown author' : `Unknown user #${author.id}`;
}

function outcomeLabel(row: LeadAuditWorkEvidenceRow): string {
	if (row.activity_type.value === 'Call') {
		return row.call_outcome ?? 'Outcome unknown';
	}
	if (row.activity_type.value === 'Email') {
		if (row.reply_confirmed === true) return 'Reply confirmed';
		if (row.reply_confirmed === false) return 'Sent — reply declined';
		return 'Sent — no reply evidence';
	}
	return 'No outcome for this type';
}

/**
 * The paginated activity evidence behind one work figure. Rows keep the
 * recorded author and the current owner apart, and state unknown facts
 * instead of filling them in.
 */
export default function WorkEvidence({
	data,
	loading,
	error,
	page,
	onPageChange,
	onRetry,
}: WorkEvidenceProps) {
	const totalPages = Math.max(1, data?.pagination.total_pages ?? 1);
	const total = data?.pagination.total ?? 0;

	return (
		<section
			aria-labelledby="lead-audit-work-evidence-heading"
			className="rounded-xl border border-gray-200 bg-white shadow-sm"
		>
			<div className="border-b border-gray-100 p-4">
				<h2
					id="lead-audit-work-evidence-heading"
					className="text-lg font-bold text-gray-900"
				>
					Work evidence
				</h2>
				<p className="mt-0.5 text-sm text-gray-600">
					The recorded activities behind the selected work figure. Applied
					filters stay active while the figure and page change.
				</p>
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
						className="h-5 w-5 motion-safe:animate-spin text-[#64126D]"
						aria-hidden="true"
					/>
					Loading work evidence…
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
								The work evidence could not be loaded.
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
						No activity evidence for this figure and filter set.
					</p>
					<p className="mt-1 text-sm text-gray-600">
						Widen the period or clear a filter. A zero result is not an error.
					</p>
				</div>
			) : (
				<>
					<div
						className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
						role="region"
						aria-label="Work evidence table. Scroll horizontally for more columns."
						tabIndex={0}
					>
						<table className="w-full min-w-[1120px] border-collapse text-sm">
							<caption className="sr-only">
								{data?.metric.label ?? 'Work evidence'} with the applied filters
							</caption>
							<thead>
								<tr className="border-b border-[#64126D]/30 bg-[#64126D]/10">
									{[
										'Lead',
										'Activity',
										'Recorded author',
										'Current owner (context)',
										'Outcome',
										'Occurred',
										'Recorded',
										'Evidence',
									].map((heading) => (
										<th
											key={heading}
											scope="col"
											className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wide text-[#64126D]"
										>
											{heading}
										</th>
									))}
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{(data?.activities ?? []).map((row) => (
									<tr key={row.id} className="hover:bg-purple-50/40">
										<td className="px-3 py-2.5 align-top">
											<Link
												href={`/leads/${row.lead.id}`}
												className="font-semibold text-[#4A1254] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
											>
												{row.lead.company_name}
											</Link>
											<span className="mt-0.5 block text-xs text-gray-600">
												{row.lead.lead_id ?? `Lead #${row.lead.id}`}
											</span>
										</td>
										<td className="px-3 py-2.5 align-top">
											<span className="font-medium text-gray-900">
												{row.activity_type.label}
											</span>
											<span className="mt-0.5 block text-xs text-gray-600">
												{row.status}
												{row.activity_type.is_unknown && row.activity_type.value
													? ` · stored “${row.activity_type.value}”`
													: ''}
											</span>
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{authorLabel(row.author)}
											{row.author.is_inactive ? (
												<span className="mt-0.5 block text-xs font-semibold text-amber-700">
													Inactive account — reference retained
												</span>
											) : null}
											{row.author.is_unknown ? (
												<span className="mt-0.5 block text-xs text-gray-600">
													No author was stored
												</span>
											) : null}
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{row.lead.current_owner
												? (row.lead.current_owner.name ??
													`Unknown user #${row.lead.current_owner.id}`)
												: 'Unassigned'}
										</td>
										<td className="px-3 py-2.5 align-top text-gray-800">
											{outcomeLabel(row)}
										</td>
										<td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-gray-800">
											{row.occurred_at ? (
												<time dateTime={row.occurred_at.replace(' ', 'T')}>
													{stamp(row.occurred_at)}
												</time>
											) : (
												<span className="italic text-gray-600">Unknown</span>
											)}
										</td>
										<td className="whitespace-nowrap px-3 py-2.5 align-top tabular-nums text-gray-800">
											{stamp(row.recorded_at)}
										</td>
										<td className="px-3 py-2.5 align-top">
											<span className="flex flex-wrap gap-1">
												{row.is_outreach ? (
													<span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-[#4A1254]">
														Outreach
													</span>
												) : null}
												{row.is_successful_contact ? (
													<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
														Successful contact
													</span>
												) : null}
												{row.corrected ? (
													<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
														Corrected activity
													</span>
												) : null}
												{!row.is_outreach && !row.is_successful_contact ? (
													<span className="text-xs text-gray-600">
														Documentation
													</span>
												) : null}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="flex flex-col gap-2 border-t border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-xs text-gray-600">
							{total.toLocaleString('en-IN')} activit
							{total === 1 ? 'y' : 'ies'} in this evidence set. Page {page} of{' '}
							{totalPages}.
						</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								aria-disabled={page <= 1}
								onClick={() => {
									if (page <= 1) return;
									onPageChange(page - 1);
								}}
								className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
							>
								<ChevronLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Previous
							</button>
							<button
								type="button"
								aria-disabled={page >= totalPages}
								onClick={() => {
									if (page >= totalPages) return;
									onPageChange(page + 1);
								}}
								className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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
