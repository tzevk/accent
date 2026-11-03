'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
	ArrowPathIcon,
	ChartBarIcon,
	ClockIcon,
	ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { apiGet } from '@/lib/api-client';
import type {
	LeadAuditTimingEvidenceSection,
	LeadAuditTimingPopulation,
	LeadAuditTimingRow,
	LeadAuditTimingSection,
} from '@/server/reports/lead-audit/timing-types';

const PAGE_SIZE = 25;

interface EvidenceEnvelope {
	success: boolean;
	data?: LeadAuditTimingEvidenceSection;
	error?: string;
}

interface TimingViewProps {
	section: LeadAuditTimingSection;
	/** The applied report query, retained by every evidence read. */
	appliedQuery: Record<string, string | undefined>;
}

const DISCLOSURE_LABELS: Record<string, string> = {
	timing_clock: 'Clock and observation',
	outreach_definition: 'Evidenced outreach',
	without_outreach: 'Without evidenced outreach',
	missing_timestamp: 'Unknown occurrence times',
	incomplete_earlier: 'Incomplete earlier evidence',
	negative_interval: 'Negative intervals',
	no_valid_samples: 'No valid samples',
	empty_cohort: 'Empty cohort',
	scope_limits: 'Scope and limits',
	evidence_population: 'Evidence population',
};

const STATUS_LABELS: Record<LeadAuditTimingRow['status'], string> = {
	sampled: 'Timed sample',
	no_outreach: 'No evidenced outreach',
	missing_timestamp: 'Unknown occurrence time',
	incomplete_earlier: 'Incomplete earlier evidence',
	negative: 'Negative interval (excluded)',
};

const STATUS_STYLES: Record<LeadAuditTimingRow['status'], string> = {
	sampled: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
	no_outreach: 'bg-gray-100 text-gray-800 ring-gray-200',
	missing_timestamp: 'bg-amber-50 text-amber-900 ring-amber-200',
	incomplete_earlier: 'bg-amber-50 text-amber-900 ring-amber-200',
	negative: 'bg-red-50 text-red-800 ring-red-200',
};

function formatCount(value: number): string {
	return value.toLocaleString('en-IN');
}

function formatShare(share: number | null): string {
	if (share === null) return 'Not applicable';
	const percent = share * 100;
	return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function formatDuration(seconds: number | null): string {
	if (seconds === null) return 'Not available';
	const negative = seconds < 0;
	const absolute = Math.abs(seconds);
	const days = Math.floor(absolute / 86400);
	const hours = Math.floor((absolute % 86400) / 3600);
	const minutes = Math.floor((absolute % 3600) / 60);
	const remainder = absolute % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days} d`);
	if (hours > 0) parts.push(`${hours} h`);
	if (days === 0 && minutes > 0) parts.push(`${minutes} m`);
	if (parts.length === 0 || (days === 0 && minutes === 0 && remainder > 0)) {
		parts.push(
			`${Number.isInteger(remainder) ? remainder : remainder.toFixed(1)} s`
		);
	}
	return `${negative ? '−' : ''}${parts.slice(0, 2).join(' ')}`;
}

function MetricCard({
	label,
	value,
	detail,
	icon,
	onClick,
	disabled = false,
	tone = 'default',
}: {
	label: string;
	value: string;
	detail: string;
	icon: ReactNode;
	onClick: () => void;
	disabled?: boolean;
	tone?: 'default' | 'warning';
}) {
	const colour =
		tone === 'warning'
			? 'border-amber-200 bg-amber-50/70 text-amber-950'
			: 'border-gray-200 bg-white text-gray-900';
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={`group rounded-xl border p-4 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2 ${colour} ${
				disabled
					? 'cursor-default opacity-80'
					: 'hover:border-[#64126D]'
			}`}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
					{label}
				</span>
				{icon}
			</div>
			<p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
			<p className="mt-1 text-xs text-gray-600">{detail}</p>
			<span className="mt-2 inline-block text-xs font-semibold text-[#64126D] group-hover:underline">
				{disabled ? 'No matching evidence' : 'View evidence'}
			</span>
		</button>
	);
}

export default function TimingView({ section, appliedQuery }: TimingViewProps) {
	const [population, setPopulation] = useState<LeadAuditTimingPopulation | null>(
		null
	);
	const [page, setPage] = useState(1);

	const evidenceQuery = useQuery<EvidenceEnvelope>({
		queryKey: [
			'reports',
			'lead-audit',
			'timing-evidence',
			population,
			page,
			appliedQuery,
		],
		queryFn: () =>
			apiGet('/api/reports/lead-audit/timing/evidence', {
				...appliedQuery,
				metric: population ?? 'all',
				page,
				limit: PAGE_SIZE,
			}),
		enabled: population !== null,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		retry: false,
	});

	const evidence = evidenceQuery.data?.data ?? null;
	const evidenceError =
		evidenceQuery.error?.message || evidenceQuery.data?.error || '';
	const evidenceLoading =
		population !== null &&
		(evidenceQuery.isLoading ||
			(evidenceQuery.isFetching && evidence === null));

	const selectPopulation = (next: LeadAuditTimingPopulation) => {
		setPopulation(next);
		setPage(1);
	};

	const exclusions = section.exclusions;
	const hasSamples = section.available;

	return (
		<div className="space-y-4">
			<section aria-labelledby="lead-audit-timing-heading">
				<div className="mb-2">
					<h2
						id="lead-audit-timing-heading"
						className="text-lg font-bold text-gray-900"
					>
						Time to first outreach
					</h2>
					<p className="text-sm text-gray-600">
						Elapsed database time from system entry to the earliest evidenced
						completed Call, Email, or Meeting for each Lead in the selected
						Lead Intake Cohort. Notes and scheduled work are not outreach. This
						is evidenced outreach, not client response time.
					</p>
					<p className="mt-1 text-xs text-gray-600">
						Clock: {section.metric.clock} Observation:{' '}
						{section.metric.observation} Generated{' '}
						{section.meta.generated_at} ({section.meta.time_zone.label}).
					</p>
				</div>

				{!hasSamples ? (
					<div
						className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
						role="status"
					>
						<div className="flex items-start gap-2">
							<ExclamationTriangleIcon
								className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
								aria-hidden="true"
							/>
							<div>
								<h3 className="text-sm font-semibold text-amber-950">
									Time to first outreach is not available
								</h3>
								<p className="mt-0.5 text-sm text-amber-900">
									No valid timing sample exists for this cohort, so the metric
									is unavailable rather than zero. Coverage: {formatCount(section.cohort_leads)}{' '}
									cohort Lead(s), {formatCount(section.without_outreach)} without
									evidenced outreach, and {formatCount(exclusions.total)}{' '}
									excluded for unknown or negative timing evidence.
								</p>
							</div>
						</div>
					</div>
				) : null}

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<MetricCard
						label="Median time"
						value={formatDuration(section.median_seconds)}
						detail={
							hasSamples
								? `Middle observed duration across ${formatCount(section.valid_samples)} valid sample(s); an even sample averages the two middle durations.`
								: 'Unavailable without a valid sample.'
						}
						icon={
							<ClockIcon
								className="h-5 w-5 text-[#64126D]"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('sampled')}
						disabled={!hasSamples}
					/>
					<MetricCard
						label="90th percentile"
						value={formatDuration(section.p90_seconds)}
						detail={
							hasSamples
								? 'Nearest-rank 90th: the ordered sample at the rounded-up rank among the valid samples.'
								: 'Unavailable without a valid sample.'
						}
						icon={
							<ChartBarIcon
								className="h-5 w-5 text-[#64126D]"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('sampled')}
						disabled={!hasSamples}
					/>
					<MetricCard
						label="Valid samples"
						value={formatCount(section.valid_samples)}
						detail={`${formatCount(section.cohort_leads)} Lead(s) in the selected intake cohort.`}
						icon={
							<ChartBarIcon
								className="h-5 w-5 text-[#64126D]"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('sampled')}
						disabled={!hasSamples}
					/>
					<MetricCard
						label="Without evidenced outreach"
						value={`${formatCount(section.without_outreach)} (${formatShare(section.without_outreach_share)})`}
						detail="Cohort Leads with no completed Call, Email, or Meeting. They are not hidden by the timing samples."
						icon={
							<ExclamationTriangleIcon
								className="h-5 w-5 text-amber-700"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('no_outreach')}
						disabled={section.without_outreach === 0}
						tone="warning"
					/>
				</div>

				<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
					<MetricCard
						label="Unknown occurrence times"
						value={formatCount(exclusions.missing_timestamp)}
						detail="Completed outreach exists, but no occurrence time is recorded. Excluded from durations; no timestamp is substituted."
						icon={
							<ClockIcon
								className="h-5 w-5 text-amber-700"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('missing_timestamp')}
						disabled={exclusions.missing_timestamp === 0}
						tone="warning"
					/>
					<MetricCard
						label="Incomplete earlier evidence"
						value={formatCount(exclusions.incomplete_earlier)}
						detail="A known outreach time sits beside an unknown earlier row, so the earliest outreach cannot be established. Excluded rather than overstated."
						icon={
							<ExclamationTriangleIcon
								className="h-5 w-5 text-amber-700"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('incomplete_earlier')}
						disabled={exclusions.incomplete_earlier === 0}
						tone="warning"
					/>
					<MetricCard
						label="Negative intervals"
						value={formatCount(exclusions.negative)}
						detail="Outreach evidenced before system entry, usually imported prehistory. Disclosed and excluded, never clamped to zero."
						icon={
							<ExclamationTriangleIcon
								className="h-5 w-5 text-red-700"
								aria-hidden="true"
							/>
						}
						onClick={() => selectPopulation('negative')}
						disabled={exclusions.negative === 0}
						tone="warning"
					/>
				</div>
			</section>

			<section
				aria-labelledby="lead-audit-timing-disclosures-heading"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<h2
					id="lead-audit-timing-disclosures-heading"
					className="text-lg font-bold text-gray-900"
				>
					What this timing figure can establish
				</h2>
				<dl className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
					{section.disclosures.map((disclosure) => (
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
				{section.filter_scope.ignored.length > 0 ? (
					<div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
						<h3 className="text-xs font-bold uppercase tracking-wide text-amber-900">
							Filters that do not narrow this metric
						</h3>
						<ul className="mt-1 space-y-1 text-sm text-amber-900">
							{section.filter_scope.ignored.map((entry) => (
								<li key={entry.filter}>
									<span className="font-semibold">{entry.label}</span>{' '}
									({entry.value}): {entry.reason}
								</li>
							))}
						</ul>
					</div>
				) : null}
			</section>

			{population !== null ? (
				<section
					aria-labelledby="lead-audit-timing-evidence-heading"
					className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
				>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div>
							<h2
								id="lead-audit-timing-evidence-heading"
								className="text-lg font-bold text-gray-900"
							>
								{evidence?.metric.label ??
									DISCLOSURE_LABELS[population] ??
									'Timing evidence'}
							</h2>
							<p className="text-sm text-gray-600">
								{evidence?.metric.definition ??
									'Loading the cohort evidence behind the selected timing figure.'}
							</p>
						</div>
						<button
							type="button"
							onClick={() => setPopulation(null)}
							className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
						>
							Close evidence
						</button>
					</div>

					{evidenceLoading ? (
						<div
							className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-gray-200 p-8 text-sm text-gray-600"
							role="status"
						>
							<ArrowPathIcon
								className="h-5 w-5 animate-spin text-[#64126D]"
								aria-hidden="true"
							/>
							Loading the timing evidence…
						</div>
					) : evidenceError !== '' ? (
						<div
							className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4"
							role="alert"
						>
							<p className="text-sm font-semibold text-red-900">
								The timing evidence could not be loaded.
							</p>
							<p className="mt-0.5 text-sm text-red-800">{evidenceError}</p>
							<button
								type="button"
								onClick={() => evidenceQuery.refetch()}
								className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 text-xs font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
							>
								<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Retry
							</button>
						</div>
					) : evidence === null || evidence.rows.length === 0 ? (
						<p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
							No cohort Lead matches this population under the applied
							filters.
						</p>
					) : (
						<>
							<div
								className="mt-3 overflow-x-auto"
								role="region"
								aria-label="Timing cohort evidence"
								tabIndex={0}
							>
								<table className="min-w-[860px] w-full border-collapse text-sm">
									<caption className="sr-only">
										Timing cohort evidence for the selected population
									</caption>
									<thead>
										<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
											<th scope="col" className="px-2 py-2 font-semibold">
												Lead
											</th>
											<th scope="col" className="px-2 py-2 font-semibold">
												System entry
											</th>
											<th scope="col" className="px-2 py-2 font-semibold">
												First outreach
											</th>
											<th scope="col" className="px-2 py-2 font-semibold">
												Outreach evidence
											</th>
											<th scope="col" className="px-2 py-2 font-semibold">
												Elapsed
											</th>
											<th scope="col" className="px-2 py-2 font-semibold">
												Status
											</th>
										</tr>
									</thead>
									<tbody>
										{evidence.rows.map((row) => (
											<tr
												key={row.lead_id}
												className="border-b border-gray-100 align-top"
											>
												<td className="px-2 py-2">
													<Link
														href={`/leads/${row.lead_id}`}
														className="font-semibold text-[#64126D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
													>
														{row.company_name}
													</Link>
													<div className="text-xs text-gray-600">
														{row.lead_reference ?? `Lead #${row.lead_id}`}
													</div>
												</td>
												<td className="px-2 py-2 tabular-nums text-gray-700">
													{row.recorded_at}
												</td>
												<td className="px-2 py-2 text-gray-700">
													{row.first_outreach_at ?? 'Unknown'}
													<div className="text-xs text-gray-600">
														{row.first_outreach_type ?? 'No outreach type'}
													</div>
												</td>
												<td className="px-2 py-2 text-gray-700">
													{formatCount(row.completed_outreach_count)} completed
													{row.unknown_occurrence_count > 0
														? ` · ${formatCount(row.unknown_occurrence_count)} unknown time`
														: ''}
												</td>
												<td className="px-2 py-2 font-semibold tabular-nums text-gray-900">
													{formatDuration(row.duration_seconds)}
												</td>
												<td className="px-2 py-2">
													<span
														className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLES[row.status]}`}
													>
														{STATUS_LABELS[row.status]}
													</span>
													{row.exclusion_reason ? (
														<p className="mt-1 text-xs text-gray-600">
															{row.exclusion_reason}
														</p>
													) : null}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{evidence.pagination.total_pages > 1 ? (
								<nav
									className="mt-3 flex flex-wrap items-center justify-between gap-2"
									aria-label="Timing evidence pages"
								>
									<p className="text-xs text-gray-600">
										{formatCount(evidence.pagination.total)} Lead(s) · page{' '}
										{evidence.pagination.page} of{' '}
										{formatCount(evidence.pagination.total_pages)}
									</p>
									<div className="flex gap-2">
										<button
											type="button"
											onClick={() => setPage((current) => Math.max(1, current - 1))}
											disabled={evidence.pagination.page <= 1}
											className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
										>
											Previous
										</button>
										<button
											type="button"
											onClick={() =>
												setPage((current) =>
													Math.min(evidence.pagination.total_pages, current + 1)
												)
											}
											disabled={
												evidence.pagination.page >=
												evidence.pagination.total_pages
											}
											className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
										>
											Next
										</button>
									</div>
								</nav>
							) : null}
						</>
					)}
				</section>
			) : null}
		</div>
	);
}
