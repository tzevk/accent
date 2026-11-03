'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	ClipboardDocumentCheckIcon,
	ExclamationTriangleIcon,
	FunnelIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import { apiGet } from '@/lib/api-client';
import type {
	LeadAuditWorkCoverage,
	LeadAuditWorkEvidenceSection,
	LeadAuditWorkMetric,
	LeadAuditWorkSection,
	LeadAuditWorkSummary,
	LeadAuditWorkTypeCounts,
} from '@/server/reports/lead-audit/work-types';
import WorkEvidence from '../work/work-evidence';

interface WorkViewProps {
	work: LeadAuditWorkSection;
	/** The applied query the report response was built from. */
	appliedQuery: Record<string, string | undefined>;
	/** Optional controlled evidence metric; the view keeps its own otherwise. */
	metric?: LeadAuditWorkMetric;
	onMetricChange?: (metric: LeadAuditWorkMetric) => void;
}

interface EvidenceEnvelope {
	success: boolean;
	data?: LeadAuditWorkEvidenceSection;
	error?: string;
}

const PAGE_SIZE = 25;

const METRIC_LABELS: Array<{ key: LeadAuditWorkMetric; label: string }> = [
	{ key: 'completed', label: 'Completed work' },
	{ key: 'outreach', label: 'Lead Outreach' },
	{ key: 'successful_contact', label: 'Successful contact' },
	{ key: 'call', label: 'Calls' },
	{ key: 'email', label: 'Emails' },
	{ key: 'meeting', label: 'Meetings' },
	{ key: 'note', label: 'Notes' },
	{ key: 'unknown_type', label: 'Unknown type' },
	{ key: 'undated', label: 'Undated work' },
	{ key: 'cancelled', label: 'Cancelled work' },
];

const METRIC_COUNTS: Record<
	LeadAuditWorkMetric,
	(summary: LeadAuditWorkSummary, coverage: LeadAuditWorkCoverage) => number
> = {
	completed: (summary) => summary.completed_total,
	outreach: (summary) => summary.outreach_total,
	successful_contact: (summary) => summary.successful_contact,
	call: (summary) => summary.by_type.call,
	email: (summary) => summary.by_type.email,
	meeting: (summary) => summary.by_type.meeting,
	note: (summary) => summary.by_type.note,
	unknown_type: (summary) => summary.by_type.unknown,
	undated: (_summary, coverage) => coverage.unknown_occurrence_date,
	cancelled: (_summary, coverage) => coverage.cancelled_in_period,
};

const TYPE_ROWS: Array<{
	key: keyof LeadAuditWorkTypeCounts;
	label: string;
	metric: LeadAuditWorkMetric;
}> = [
	{ key: 'call', label: 'Calls', metric: 'call' },
	{ key: 'email', label: 'Emails', metric: 'email' },
	{ key: 'meeting', label: 'Meetings', metric: 'meeting' },
	{ key: 'note', label: 'Notes', metric: 'note' },
	{ key: 'unknown', label: 'Unknown type', metric: 'unknown_type' },
];

const COVERAGE_ROWS: Array<{
	key: keyof LeadAuditWorkCoverage;
	label: string;
	detail: string;
}> = [
	{
		key: 'unknown_occurrence_date',
		label: 'No occurrence time',
		detail: 'Excluded from every dated work figure',
	},
	{
		key: 'unknown_activity_type',
		label: 'Unknown activity type',
		detail: 'Completed work with no canonical stored type',
	},
	{
		key: 'unknown_author',
		label: 'Unknown author',
		detail: 'No recorded author reference was stored',
	},
	{
		key: 'inactive_author',
		label: 'Inactive recorded author',
		detail: 'Account inactive; the recorded reference is preserved',
	},
	{
		key: 'missing_call_outcome',
		label: 'Call outcome not recorded',
		detail: 'Neither connected nor failed; never invented',
	},
	{
		key: 'unrecognized_call_outcome',
		label: 'Unrecognized call outcome',
		detail: 'Stored value outside the canonical call outcomes',
	},
	{
		key: 'missing_email_reply_evidence',
		label: 'No email reply evidence',
		detail: 'No reply was recorded either way',
	},
	{
		key: 'cancelled_in_period',
		label: 'Cancelled work',
		detail: 'Planned work that did not happen',
	},
	{
		key: 'deleted_activity_rows',
		label: 'Deleted activity rows',
		detail: 'Excluded from operational totals',
	},
];

function count(value: number): string {
	return value.toLocaleString('en-IN');
}

function FigureCard({
	title,
	value,
	unit,
	children,
	onClick,
}: {
	title: string;
	value: number;
	unit: string;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
		>
			<span className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
				{title}
			</span>
			<span className="mt-1 block text-3xl font-bold tabular-nums text-gray-900">
				{count(value)}
			</span>
			<span className="text-xs text-gray-600">{unit}</span>
			<span className="mt-2 block text-sm text-gray-700">{children}</span>
		</button>
	);
}

/**
 * The Work and accountability view. Completed work, outreach, and successful
 * contact stay separate; the author breakdown never mixes with current
 * owner; and every figure opens its own filter-retaining evidence.
 */
export default function WorkView({
	work,
	appliedQuery,
	metric: controlledMetric,
	onMetricChange,
}: WorkViewProps) {
	const [localMetric, setLocalMetric] =
		useState<LeadAuditWorkMetric>('completed');
	const [page, setPage] = useState(1);
	const metric = controlledMetric ?? localMetric;

	const queryKey = useMemo(() => JSON.stringify(appliedQuery), [appliedQuery]);
	useEffect(() => {
		setPage(1);
	}, [metric, queryKey]);

	const selectMetric = (next: LeadAuditWorkMetric) => {
		if (onMetricChange) onMetricChange(next);
		else setLocalMetric(next);
	};

	const evidenceParams = useMemo(
		() => ({ ...appliedQuery, metric, page, limit: PAGE_SIZE }),
		[appliedQuery, metric, page]
	);
	const evidenceQuery = useQuery<EvidenceEnvelope>({
		queryKey: ['reports', 'lead-audit', 'work-evidence', evidenceParams],
		queryFn: () =>
			apiGet<EvidenceEnvelope>(
				'/api/reports/lead-audit/work/evidence',
				evidenceParams
			),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		retry: false,
	});

	const evidenceError =
		evidenceQuery.error?.message || evidenceQuery.data?.error || '';
	const evidenceLoading =
		evidenceQuery.isLoading ||
		(evidenceQuery.isFetching && !evidenceQuery.data);

	const { summary, coverage } = work;

	return (
		<div className="space-y-4">
			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div>
						<h2 className="text-lg font-bold text-gray-900">
							Work and accountability
						</h2>
						<p className="mt-0.5 max-w-3xl text-sm text-gray-600">
							{work.scope.from_date} to {work.scope.to_date}. Completed work is
							dated by when the activity occurred, independently of when the Lead
							was recorded or the activity was entered.
						</p>
					</div>
					<p className="text-xs text-gray-600">
						Generated {work.meta.generated_at} · {work.meta.time_zone.label}
					</p>
				</div>
				<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<FigureCard
						title="Completed work"
						value={summary.completed_total}
						unit="activities"
						onClick={() => selectMetric('completed')}
					>
						{count(summary.by_type.call)} calls, {count(summary.by_type.email)}{' '}
						emails, {count(summary.by_type.meeting)} meetings,{' '}
						{count(summary.by_type.note)} notes
					</FigureCard>
					<FigureCard
						title="Lead Outreach"
						value={summary.outreach_total}
						unit="call, email, and meeting activities"
						onClick={() => selectMetric('outreach')}
					>
						{count(summary.distinct_leads_with_outreach)} distinct Lead
						{summary.distinct_leads_with_outreach === 1 ? '' : 's'} reached.
						Notes are not outreach.
					</FigureCard>
					<FigureCard
						title="Successful contact"
						value={summary.successful_contact}
						unit="connected calls and confirmed replies"
						onClick={() => selectMetric('successful_contact')}
					>
						{count(summary.distinct_leads_with_successful_contact)} distinct Lead
						{summary.distinct_leads_with_successful_contact === 1 ? '' : 's'}.
						Failed calls and unconfirmed emails never count.
					</FigureCard>
					<FigureCard
						title="Leads worked"
						value={summary.distinct_leads_worked}
						unit="distinct Leads with completed work"
						onClick={() => selectMetric('completed')}
					>
						Includes work on Leads recorded before this period. Authorship is
						not current ownership.
					</FigureCard>
				</div>
			</section>

			<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<section
					aria-labelledby="lead-audit-work-types-heading"
					className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
				>
					<div className="flex items-start gap-2">
						<ClipboardDocumentCheckIcon
							className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
							aria-hidden="true"
						/>
						<div>
							<h3
								id="lead-audit-work-types-heading"
								className="text-base font-bold text-gray-900"
							>
								Completed work by type
							</h3>
							<p className="text-sm text-gray-600">
								Scheduled and cancelled work is never completed work. An unknown
								stored type stays unknown.
							</p>
						</div>
					</div>
					<table className="mt-3 w-full border-collapse text-sm">
						<caption className="sr-only">
							Completed work by activity type in the selected period
						</caption>
						<thead>
							<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Type
								</th>
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Role
								</th>
								<th scope="col" className="py-1.5 text-right font-semibold">
									Completed
								</th>
							</tr>
						</thead>
						<tbody>
							{TYPE_ROWS.map((row) => (
								<tr key={row.key} className="border-b border-gray-50">
									<th
										scope="row"
										className="py-1.5 pr-2 text-left font-medium text-gray-800"
									>
										<button
											type="button"
											onClick={() => selectMetric(row.metric)}
											className="rounded text-[#4A1254] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
										>
											{row.label}
										</button>
									</th>
									<td className="py-1.5 pr-2 text-gray-600">
										{row.key === 'note'
											? 'Documentation only'
											: row.key === 'unknown'
												? 'Unknown'
												: row.key === 'meeting'
													? 'Outreach, not contact'
													: 'Outreach'}
									</td>
									<td className="py-1.5 text-right tabular-nums text-gray-900">
										{count(summary.by_type[row.key])}
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr className="border-t border-gray-200 text-xs text-gray-600">
								<th scope="row" className="py-1.5 pr-2 text-left font-semibold">
									Total completed
								</th>
								<td className="py-1.5 pr-2" />
								<td className="py-1.5 text-right font-semibold tabular-nums text-gray-900">
									{count(summary.completed_total)}
								</td>
							</tr>
						</tfoot>
					</table>

					<h4 className="mt-4 text-sm font-bold text-gray-900">
						Outcome evidence
					</h4>
					<dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
						{[
							{ label: 'Connected calls', value: summary.calls_connected },
							{ label: 'Failed calls', value: summary.calls_failed },
							{
								label: 'Call outcome unknown',
								value: summary.calls_outcome_unknown,
							},
							{
								label: 'Confirmed email replies',
								value: summary.emails_confirmed_reply,
							},
							{
								label: 'Unconfirmed sent emails',
								value: summary.emails_unconfirmed,
							},
							{
								label: 'Corrected activities',
								value: summary.corrected_activities,
							},
						].map((entry) => (
							<div
								key={entry.label}
								className="flex items-baseline justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
							>
								<dt className="text-sm text-gray-700">{entry.label}</dt>
								<dd className="text-sm font-semibold tabular-nums text-gray-900">
									{count(entry.value)}
								</dd>
							</div>
						))}
					</dl>
					<p className="mt-2 text-xs text-gray-600" role="note">
						A failed call is completed work and outreach without successful
						contact. A meeting is outreach without establishing successful
						contact by itself.
					</p>
				</section>

				<section
					aria-labelledby="lead-audit-work-coverage-heading"
					className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
				>
					<div className="flex items-start gap-2">
						<ExclamationTriangleIcon
							className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
							aria-hidden="true"
						/>
						<div>
							<h3
								id="lead-audit-work-coverage-heading"
								className="text-base font-bold text-gray-900"
							>
								Coverage and exclusions
							</h3>
							<p className="text-sm text-gray-600">
								Facts these figures cannot establish. A zero is measured, not
								missing.
							</p>
						</div>
					</div>
					<table className="mt-3 w-full border-collapse text-sm">
						<caption className="sr-only">
							Work coverage and excluded records for the applied filters
						</caption>
						<thead>
							<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Fact
								</th>
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Meaning
								</th>
								<th scope="col" className="py-1.5 text-right font-semibold">
									Records
								</th>
							</tr>
						</thead>
						<tbody>
							{COVERAGE_ROWS.map((row) => (
								<tr key={row.key} className="border-b border-gray-50">
									<th
										scope="row"
										className="py-1.5 pr-2 text-left font-medium text-gray-800"
									>
										{row.label}
									</th>
									<td className="py-1.5 pr-2 text-gray-600">{row.detail}</td>
									<td className="py-1.5 text-right tabular-nums text-gray-900">
										{count(coverage[row.key])}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</section>
			</div>

			<section
				aria-labelledby="lead-audit-work-authors-heading"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<div className="flex items-start gap-2">
					<UserGroupIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div>
						<h3
							id="lead-audit-work-authors-heading"
							className="text-base font-bold text-gray-900"
						>
							Recorded authors
						</h3>
						<p className="text-sm text-gray-600">
							Work grouped by the author recorded on the activity. This is not
							proof that the person performed the work on someone else&apos;s
							behalf, and there is no ranking or productivity score.
						</p>
					</div>
				</div>
				{work.authors.length === 0 ? (
					<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
						No completed work is recorded in this period for the applied
						filters.
					</p>
				) : (
					<div
						className="mt-3 overflow-x-auto"
						role="region"
						aria-label="Recorded author table. Scroll horizontally for more columns."
						tabIndex={0}
					>
						<table className="w-full min-w-[760px] border-collapse text-sm">
							<caption className="sr-only">
								Completed work by recorded author
							</caption>
							<thead>
								<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
									<th scope="col" className="py-1.5 pr-3 font-semibold">
										Recorded author
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Completed
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Calls
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Emails
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Meetings
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Notes
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Outreach
									</th>
									<th scope="col" className="py-1.5 pr-3 text-right font-semibold">
										Successful contact
									</th>
									<th scope="col" className="py-1.5 text-right font-semibold">
										Leads
									</th>
								</tr>
							</thead>
							<tbody>
								{work.authors.map((row) => (
									<tr
										key={row.author.is_unknown ? 'unknown' : row.author.id ?? 'missing'}
										className="border-b border-gray-50"
									>
										<th
											scope="row"
											className="py-1.5 pr-3 text-left font-medium text-gray-800"
										>
											{row.author.is_unknown
												? 'Unknown author'
												: row.author.name ?? `Unknown user #${row.author.id}`}
											{row.author.is_inactive ? (
												<span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
													Inactive
												</span>
											) : null}
										</th>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-900">
											{count(row.completed_total)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-800">
											{count(row.by_type.call)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-800">
											{count(row.by_type.email)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-800">
											{count(row.by_type.meeting)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-800">
											{count(row.by_type.note)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-800">
											{count(row.outreach_total)}
										</td>
										<td className="py-1.5 pr-3 text-right tabular-nums text-gray-800">
											{count(row.successful_contact)}
										</td>
										<td className="py-1.5 text-right tabular-nums text-gray-800">
											{count(row.distinct_leads)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section
				aria-labelledby="lead-audit-work-filters-heading"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<div className="flex items-start gap-2">
					<FunnelIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div>
						<h3
							id="lead-audit-work-filters-heading"
							className="text-base font-bold text-gray-900"
						>
							Applied filters and scope
						</h3>
						<p className="text-sm text-gray-600">
							Which filters narrow this section, and which do not. Work filters
							never change the intake population.
						</p>
					</div>
				</div>
				<ul className="mt-3 space-y-2">
					{work.work_filters.applied.map((filter) => (
						<li
							key={filter.key}
							className="rounded-lg border border-gray-200 bg-gray-50 p-3"
						>
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-sm font-semibold text-gray-900">
									{filter.label}
								</span>
								<span className="text-sm text-gray-800">{filter.display}</span>
								<span
									className={
										filter.state === 'effective'
											? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900'
											: filter.state === 'ignored'
												? 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900'
												: 'rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700'
									}
								>
									{filter.state === 'effective'
										? 'Effective here'
										: filter.state === 'ignored'
											? 'Ignored here'
											: 'All records'}
								</span>
							</div>
							<p className="mt-1 text-xs text-gray-600">{filter.reason}</p>
						</li>
					))}
				</ul>
				<ul className="mt-3 space-y-1 text-sm text-gray-700">
					{work.disclosures.map((disclosure) => (
						<li key={disclosure.code}>{disclosure.text}</li>
					))}
				</ul>
			</section>

			<div className="flex flex-wrap gap-2" role="group" aria-label="Work evidence metric">
				{METRIC_LABELS.map((option) => {
					const selected = option.key === metric;
					return (
						<button
							key={option.key}
							type="button"
							onClick={() => selectMetric(option.key)}
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
								{count(METRIC_COUNTS[option.key](summary, coverage))}
							</span>
						</button>
					);
				})}
			</div>

			{evidenceQuery.isFetching && evidenceQuery.data ? (
				<p
					className="flex items-center gap-1.5 text-xs text-gray-600"
					role="status"
				>
					<ArrowPathIcon
						className="h-3.5 w-3.5 animate-spin text-[#64126D]"
						aria-hidden="true"
					/>
					Refreshing work evidence…
				</p>
			) : null}

			<WorkEvidence
				data={evidenceQuery.data?.data ?? null}
				loading={evidenceLoading}
				error={evidenceError}
				page={page}
				onPageChange={setPage}
				onRetry={() => evidenceQuery.refetch()}
			/>
		</div>
	);
}
