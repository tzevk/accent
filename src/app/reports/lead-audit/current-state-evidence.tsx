'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { leadAuditGet } from './api';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import type {
	CurrentStateEvidenceSelection,
	LeadAuditCurrentStateEvidenceSection,
} from '@/server/reports/lead-audit/current-state-types';

interface Props {
	selection: CurrentStateEvidenceSelection;
	appliedQuery: Record<string, string | undefined>;
	onClose: () => void;
}

interface Envelope {
	success: boolean;
	data?: LeadAuditCurrentStateEvidenceSection;
	error?: string;
}

const buttonClass =
	'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-[#64126D] disabled:opacity-50';

export default function CurrentStateEvidence({
	selection,
	appliedQuery,
	onClose,
}: Props) {
	const [page, setPage] = useState(1);
	const heading = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		heading.current?.focus();
	}, []);
	const params = {
		...appliedQuery,
		group: selection.group,
		risk: selection.risk ?? undefined,
		owner:
			selection.owner === undefined
				? appliedQuery.owner
				: String(selection.owner),
		page,
		limit: 25,
	};
	const query = useQuery<Envelope>({
		queryKey: ['reports', 'lead-audit', 'current-state-evidence', params],
		queryFn: () =>
			leadAuditGet('/api/reports/lead-audit/current-state/evidence', params),
	});
	const data = query.data?.data;
	const error =
		query.error?.message ||
		(query.data?.success === false ? query.data.error : '');

	return (
		<section
			className="min-w-0 rounded-xl border border-gray-200 bg-white p-4"
			aria-labelledby="current-state-evidence-heading"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<h2
					ref={heading}
					tabIndex={-1}
					id="current-state-evidence-heading"
					className="text-lg font-semibold text-gray-900"
				>
					{data?.group.label ?? 'Current-state evidence'}
				</h2>
				<button type="button" onClick={onClose} className={buttonClass}>
					Close current-state evidence
				</button>
			</div>
			{query.isLoading ? (
				<p role="status" className="mt-3 text-sm">
					Loading current-state evidence…
				</p>
			) : error ? (
				<div role="alert" className="mt-3 text-sm text-red-800">
					<p>Current-state evidence could not be loaded. {error}</p>
					<button
						type="button"
						onClick={() => query.refetch()}
						className={`${buttonClass} mt-2`}
					>
						Retry current-state evidence
					</button>
				</div>
			) : data ? (
				<>
					<p className="mt-2 max-w-prose text-sm text-gray-700">
						{data.group.definition}
					</p>
					<p className="mt-2 text-xs text-gray-600">
						As of {data.as_of.generated_at} ({data.as_of.time_zone.label}).{' '}
						{data.as_of.date_basis}
					</p>
					<p className="mt-2 text-xs text-gray-600">
						Current owner: {data.scope.effective_filters.owner.label}; source:{' '}
						{data.scope.effective_filters.source.label}; current stage:{' '}
						{data.scope.effective_filters.stage.label}; priority:{' '}
						{data.scope.effective_filters.priority ?? 'All priorities'}; search:{' '}
						{data.scope.effective_filters.search || 'All Leads'}.
					</p>
					{data.scope.ignored_filters.length > 0 ? (
						<ul className="mt-2 list-inside list-disc text-xs text-gray-600">
							{data.scope.ignored_filters.map((filter) => (
								<li key={filter.key}>
									{filter.label}: {filter.value ?? 'not applied'}.{' '}
									{filter.reason}
								</li>
							))}
						</ul>
					) : null}
					<p className="mt-3 text-sm tabular-nums">
						{formatNumber(data.distinct_leads_total)} distinct Leads;{' '}
						{formatNumber(data.pagination.total)}{' '}
						{data.group.evidence_unit === 'scheduled_work_item'
							? 'scheduled work items'
							: 'Lead rows'}
						.
					</p>
					{data.rows.length === 0 ? (
						<p className="mt-3 text-sm text-gray-600">
							No current evidence matches this selection. Clear a filter or
							choose another risk.
						</p>
					) : (
						<div
							role="region"
							tabIndex={0}
							aria-label="Current-state evidence table. Scroll horizontally for more columns."
							className="mt-3 overflow-x-auto rounded-lg border border-gray-200 focus-visible:ring-2 focus-visible:ring-[#64126D]"
						>
							<table className="w-full min-w-[850px] text-left text-sm">
								<thead className="bg-gray-50 text-xs text-gray-700">
									<tr>
										{[
											'Lead',
											'Current owner',
											'Current stage',
											'Source',
											'Scheduled work',
											'Due date',
										].map((label) => (
											<th key={label} scope="col" className="px-3 py-2">
												{label}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{data.rows.map((row) => (
										<tr
											key={`${row.lead.id}:${row.work_item?.id ?? 'lead'}`}
											className="border-t border-gray-100 align-top"
										>
											<td className="max-w-64 break-words px-3 py-3">
												<Link
													href={`/leads/${row.lead.id}`}
													className="font-medium text-[#64126D] underline"
												>
													{row.lead.company_name}
												</Link>
												<div className="mt-1 text-xs text-gray-600">
													{row.lead.lead_id ?? `Lead #${row.lead.id}`}
												</div>
												<div className="mt-1 text-xs text-gray-600">
													Recorded {formatDateTime(row.recorded_at)}
												</div>
											</td>
											<td className="px-3 py-3">
												{row.owner.name}
												{row.owner.is_inactive ? ' (inactive)' : ''}
											</td>
											<td className="px-3 py-3">{row.stage.label}</td>
											<td className="whitespace-pre-wrap px-3 py-3">
												{row.source.label ?? 'Unknown source'}
											</td>
											<td className="max-w-64 break-words px-3 py-3">
												{row.work_item ? (
													<>
														{row.work_item.activity_type ?? 'Unknown type'}:{' '}
														{row.work_item.next_action ?? 'Unknown next action'}
														<span className="block text-xs text-gray-600">
															Work item #{row.work_item.id}
														</span>
													</>
												) : (
													'Not applicable'
												)}
											</td>
											<td className="px-3 py-3">
												{row.work_item
													? formatDate(row.work_item.scheduled_for)
													: 'Not applicable'}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<div className="mt-3 flex flex-wrap items-center gap-3">
						<button
							type="button"
							disabled={page <= 1}
							onClick={() => setPage(page - 1)}
							className={buttonClass}
						>
							Previous evidence page
						</button>
						<span className="text-sm tabular-nums">
							Page {page} of {Math.max(1, data.pagination.total_pages)}
						</span>
						<button
							type="button"
							disabled={page >= data.pagination.total_pages}
							onClick={() => setPage(page + 1)}
							className={buttonClass}
						>
							Next evidence page
						</button>
					</div>
				</>
			) : null}
		</section>
	);
}
