'use client';

import type { ReactNode } from 'react';
import {
	ArrowPathIcon,
	CheckBadgeIcon,
	ExclamationTriangleIcon,
	LinkSlashIcon,
} from '@heroicons/react/24/outline';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatCount, formatRate } from '../figures';
import { HelpTip } from '../help-tip';
import { MethodNote } from '../method-note';
import type {
	LeadAuditConversionDownstream,
	LeadAuditConversionEvidenceFilter,
	LeadAuditConversionEvidenceSection,
	LeadAuditConversionSection,
} from '@/server/reports/lead-audit/conversion-types';

/**
 * The cohort, source conversion, current stage distribution, and downstream
 * context section (#402).
 *
 * `summary` is the Overview slice: cohort progress, source conversion,
 * current stages, and the downstream permission states. `detail` adds the
 * paginated evidence table on Intake and sources. The component owns no
 * applied-filter state: a figure's drill-down is reported through
 * `onSelectEvidence`, and the page keeps the applied query and evidence page.
 */
export interface ConversionViewProps {
	section: LeadAuditConversionSection;
	variant?: 'summary' | 'detail';
	onSelectEvidence?: (evidence: LeadAuditConversionEvidenceFilter) => void;
	selectedEvidence?: LeadAuditConversionEvidenceFilter | null;
	evidence?: LeadAuditConversionEvidenceSection | null;
	evidenceLoading?: boolean;
	evidenceError?: string;
	onEvidencePageChange?: (page: number) => void;
	onRetry?: () => void;
}

const EVIDENCE_LABELS: Record<string, string> = {
	conversion_event: 'Recorded conversion event',
	canonical_link: 'Resolved canonical link (undated)',
	unresolved_link: 'Unresolved link',
	stage_only: 'Converted label only',
	none: 'No handoff evidence',
};

function time(value: string | null, withTime: boolean): string {
	if (!value) return 'Unknown';
	const normalized = value.includes('T') ? value : value.replace(' ', 'T');
	return withTime ? formatDateTime(normalized) : formatDate(normalized);
}

function DownstreamCell({
	downstream,
}: {
	downstream: LeadAuditConversionDownstream;
}) {
	const proposal = downstream.proposal;
	if (downstream.proposal_state === 'restricted') {
		return (
			<span className="text-gray-600">
				<span className="font-semibold">Restricted.</span> Proposal details need
				the proposal read permission.
			</span>
		);
	}
	if (downstream.proposal_state === 'unresolved') {
		return (
			<span className="text-amber-900">
				<span className="font-semibold">Unresolved.</span> No canonical Proposal
				choice yet.
			</span>
		);
	}
	if (downstream.proposal_state === 'none' || !proposal) {
		return <span className="text-gray-600">No Proposal</span>;
	}
	return (
		<div className="space-y-0.5">
			<div>
				<span className="font-semibold">
					{proposal.status ?? 'Unknown status'}
				</span>
				{proposal.progress === null ? (
					<span className="text-gray-600"> · progress unknown</span>
				) : (
					<span className="text-gray-600">
						{' '}
						· {formatRate(proposal.progress)}
					</span>
				)}
			</div>
			{proposal.project_state === 'restricted' ? (
				<div className="text-gray-600">
					Project restricted; needs the project read permission.
				</div>
			) : proposal.project_state === 'available' && proposal.project ? (
				<div className="text-gray-700">
					Project: {proposal.project.title ?? 'Untitled'} ·{' '}
					{proposal.project.status ?? 'Unknown status'}
				</div>
			) : (
				<div className="text-gray-600">No Project</div>
			)}
		</div>
	);
}

function SelectButton({
	onSelect,
	evidence,
}: {
	onSelect?: (evidence: LeadAuditConversionEvidenceFilter) => void;
	evidence: LeadAuditConversionEvidenceFilter;
}) {
	if (!onSelect) return null;
	const label = EVIDENCE_LABELS[evidence] ?? evidence;
	return (
		<button
			type="button"
			onClick={() => onSelect(evidence)}
			aria-label={`View ${label} evidence`}
			className="mt-2 text-left text-xs font-semibold text-[#64126D] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
		>
			Evidence
		</button>
	);
}

function CohortCard({
	label,
	value,
	hint,
	tone,
	children,
}: {
	label: string;
	value: string;
	hint: string;
	tone?: 'warn' | 'plain';
	children?: ReactNode;
}) {
	return (
		<div
			className={
				tone === 'warn'
					? 'rounded-xl border border-amber-200 bg-amber-50/70 p-4 shadow-sm'
					: 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm'
			}
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<p
					className={
						tone === 'warn'
							? 'text-xs font-semibold uppercase tracking-wide text-amber-900'
							: 'text-xs font-semibold uppercase tracking-wide text-gray-600'
					}
				>
					{label}
				</p>
				<HelpTip label={`About ${label}`}>{hint}</HelpTip>
			</div>
			<p
				className={
					tone === 'warn'
						? 'mt-2 text-3xl font-bold tabular-nums text-amber-950'
						: 'mt-2 text-3xl font-bold tabular-nums text-gray-900'
				}
			>
				{value}
			</p>
			{children}
		</div>
	);
}

function EvidenceTable({
	evidence,
}: {
	evidence: LeadAuditConversionEvidenceSection;
}) {
	if (evidence.rows.length === 0) {
		return (
			<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
				No Leads match this evidence population for the applied filters. This is
				a measured empty result, not a failed request.
			</p>
		);
	}
	return (
		<div
			className="mt-3 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
			role="region"
			aria-label="Conversion evidence table. Scroll horizontally for more columns."
			tabIndex={0}
		>
			<table className="w-full min-w-[860px] border-collapse text-sm">
				<caption className="sr-only">
					{evidence.evidence.label} under the applied filters
				</caption>
				<thead>
					<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Lead
						</th>
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Source
						</th>
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Stage
						</th>
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Recorded
						</th>
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Evidence
						</th>
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Conversion date
						</th>
						<th scope="col" className="py-1.5 font-semibold">
							Downstream context
						</th>
					</tr>
				</thead>
				<tbody>
					{evidence.rows.map((row) => (
						<tr key={row.id} className="border-b border-gray-50 align-top">
							<th
								scope="row"
								className="py-2 pr-3 text-left font-medium text-gray-900"
							>
								<span className="block">{row.company_name}</span>
								<span className="block text-xs font-normal text-gray-600">
									{row.lead_id ? `Lead ${row.lead_id}` : `Lead #${row.id}`}
									{row.owner
										? ` · ${row.owner.name ?? 'Unknown owner'}`
										: ' · Unassigned'}
								</span>
							</th>
							<td className="whitespace-pre-wrap py-2 pr-3 text-gray-700">
								{row.source.is_unknown ? (
									<span className="italic text-gray-600">Unknown source</span>
								) : (
									row.source.label
								)}
							</td>
							<td className="py-2 pr-3 text-gray-700">{row.stage.label}</td>
							<td className="whitespace-nowrap py-2 pr-3 text-gray-700">
								{time(row.recorded_at, false)}
							</td>
							<td className="py-2 pr-3 text-gray-700">
								{EVIDENCE_LABELS[row.evidence] ?? row.evidence}
							</td>
							<td className="whitespace-nowrap py-2 pr-3 text-gray-700">
								{row.conversion_at ? time(row.conversion_at, false) : 'Undated'}
							</td>
							<td className="py-2">
								<DownstreamCell downstream={row.downstream} />
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default function ConversionView({
	section,
	variant = 'summary',
	onSelectEvidence,
	selectedEvidence = null,
	evidence = null,
	evidenceLoading = false,
	evidenceError = '',
	onEvidencePageChange,
	onRetry,
}: ConversionViewProps) {
	const cohort = section.cohort;
	const period = section.period;
	const downstream = section.downstream;
	const canPage =
		!!evidence &&
		evidence.pagination.total_pages > 1 &&
		typeof onEvidencePageChange === 'function';

	return (
		<div className="space-y-4">
			<section aria-labelledby="lead-audit-cohort-heading">
				<div className="mb-2 flex items-start gap-2">
					<CheckBadgeIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div className="flex min-w-0 items-center gap-1.5">
						<h2
							id="lead-audit-cohort-heading"
							className="text-lg font-bold text-gray-900"
						>
							Cohort progress and handoffs
						</h2>
						<HelpTip label="About cohort progress">
							Lead Cohort Conversion Rate uses the whole intake cohort observed
							at the generation time. Handoffs after the intake period count; a
							Converted label alone does not. Period handoffs are a separate
							population and are never divided by period intake. Recent cohorts
							have had less time to progress.
						</HelpTip>
					</div>
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<CohortCard
						label="Cohort Leads"
						value={formatCount(cohort.cohort_size)}
						hint="Distinct non-deleted Leads first recorded in the selected period, under the applied filters."
					/>
					<CohortCard
						label="Evidenced handoffs"
						value={formatCount(cohort.handoffs_evidenced)}
						hint="Cohort Leads with a recorded conversion event or a resolved canonical Proposal link."
					>
						<SelectButton onSelect={onSelectEvidence} evidence="handoff" />
					</CohortCard>
					<CohortCard
						label="Lead Cohort Conversion Rate"
						value={formatRate(cohort.conversion_rate)}
						hint={
							cohort.conversion_rate === null
								? 'The cohort is empty, so the rate is Not applicable rather than zero percent.'
								: `${formatCount(cohort.handoffs_evidenced)} of ${formatCount(cohort.cohort_size)} cohort Leads. Observed through ${time(cohort.observed_through, true)}.`
						}
					/>
					<CohortCard
						label="Dated period handoffs"
						value={formatCount(period.handoffs)}
						hint="Distinct Leads with an authoritative recorded conversion time inside the period, including Leads recorded earlier."
					>
						<SelectButton onSelect={onSelectEvidence} evidence="period" />
					</CohortCard>
					<CohortCard
						label="Unresolved links"
						value={formatCount(cohort.unresolved_evidence)}
						hint="Linked Proposals without one canonical choice. An evidence gap, not a confirmed failure."
						tone={cohort.unresolved_evidence > 0 ? 'warn' : 'plain'}
					>
						<SelectButton onSelect={onSelectEvidence} evidence="unresolved" />
					</CohortCard>
					<CohortCard
						label="Undated canonical links"
						value={formatCount(cohort.undated_links)}
						hint={`A resolved canonical link supports cohort evidence but never a dated period handoff. ${formatCount(period.undated_canonical_links)} undated link(s) in the filtered Lead population stay out of the period count.`}
					>
						<SelectButton onSelect={onSelectEvidence} evidence="undated" />
					</CohortCard>
					<CohortCard
						label="Converted labels without evidence"
						value={formatCount(cohort.stage_only_claims)}
						hint="Stage labels that claim Converted with no conversion event and no resolved canonical link."
						tone={cohort.stage_only_claims > 0 ? 'warn' : 'plain'}
					>
						<SelectButton onSelect={onSelectEvidence} evidence="stage_only" />
					</CohortCard>
					<CohortCard
						label="No handoff evidence"
						value={formatCount(cohort.no_handoff_evidence)}
						hint="Remaining cohort Leads with no recorded handoff evidence. This is not presented as failure."
					/>
				</div>
				<p className="mt-2 text-xs text-gray-600">
					Observed through {time(cohort.observed_through, true)}.
				</p>
			</section>

			{variant === 'detail' ? (
				<>
					<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
						<section
							aria-labelledby="lead-audit-source-conversion-heading"
							className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
						>
							<div className="flex min-w-0 items-center gap-1.5">
								<h2
									id="lead-audit-source-conversion-heading"
									className="text-base font-bold text-gray-900"
								>
									Source conversion
								</h2>
								<HelpTip label="About source conversion">
									Stored source labels are shown exactly as recorded. Labels are
									not merged by case or spacing, and missing labels appear as
									Unknown source.
								</HelpTip>
							</div>
							{section.source_conversion.length === 0 ? (
								<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
									No cohort Leads were recorded for the applied filters, so no
									source conversion is shown.
								</p>
							) : (
								<div
									className="mt-3 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
									role="region"
									aria-label="Source conversion table. Scroll horizontally for more columns."
									tabIndex={0}
								>
									<table className="w-full min-w-[440px] border-collapse text-sm">
										<caption className="sr-only">
											Cohort intake and evidenced conversion by stored source
											label
										</caption>
										<thead>
											<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
												<th scope="col" className="py-1.5 pr-3 font-semibold">
													Source label
												</th>
												<th
													scope="col"
													className="py-1.5 pr-3 text-right font-semibold"
												>
													Cohort
												</th>
												<th
													scope="col"
													className="py-1.5 pr-3 text-right font-semibold"
												>
													Handoffs
												</th>
												<th
													scope="col"
													className="py-1.5 text-right font-semibold"
												>
													Rate
												</th>
											</tr>
										</thead>
										<tbody>
											{section.source_conversion.map((source) => (
												<tr
													key={
														source.is_unknown
															? '__unknown__'
															: (source.label ?? '')
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
													<td className="py-1.5 pr-3 text-right tabular-nums text-gray-900">
														{formatCount(source.cohort_size)}
													</td>
													<td className="py-1.5 pr-3 text-right tabular-nums text-gray-900">
														{formatCount(source.handoffs_evidenced)}
													</td>
													<td className="py-1.5 text-right tabular-nums text-gray-900">
														{formatRate(source.conversion_rate)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
							<p className="mt-2 text-xs text-gray-600">
								The rate is cohort handoffs divided by that label&apos;s cohort
								size. A label with no handoffs can be a measured zero; an empty
								cohort is Not applicable.
							</p>
						</section>

						<section
							aria-labelledby="lead-audit-current-stage-heading"
							className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
						>
							<div className="flex min-w-0 items-center gap-1.5">
								<h2
									id="lead-audit-current-stage-heading"
									className="text-base font-bold text-gray-900"
								>
									Current stage distribution
								</h2>
								<HelpTip label="About current stage distribution">
									Present state of the cohort at the generation time. This is
									not a sequential funnel and does not prove historical stage
									transitions.
								</HelpTip>
							</div>
							{section.stage_distribution.length === 0 ? (
								<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
									The cohort is empty for the applied filters, so there is no
									current stage distribution.
								</p>
							) : (
								<table className="mt-3 w-full border-collapse text-sm">
									<caption className="sr-only">
										Current Lead stage counts for the intake cohort
									</caption>
									<thead>
										<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
											<th scope="col" className="py-1.5 pr-3 font-semibold">
												Current stage
											</th>
											<th
												scope="col"
												className="py-1.5 text-right font-semibold"
											>
												Cohort Leads
											</th>
										</tr>
									</thead>
									<tbody>
										{section.stage_distribution.map((row) => (
											<tr
												key={row.stage.value ?? '__unresolved__'}
												className="border-b border-gray-50"
											>
												<th
													scope="row"
													className="py-1.5 pr-3 text-left font-medium text-gray-800"
												>
													{row.stage.label}
												</th>
												<td className="py-1.5 text-right tabular-nums text-gray-900">
													{formatCount(row.count)}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</section>
					</div>

					<section
						aria-labelledby="lead-audit-downstream-heading"
						className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					>
						<div className="flex min-w-0 items-center gap-1.5">
							<h2
								id="lead-audit-downstream-heading"
								className="text-base font-bold text-gray-900"
							>
								Downstream context of evidenced handoffs
							</h2>
							<HelpTip label="About downstream context">
								Canonical Proposal status and progress need the proposal read
								permission; Project details need the project read permission.
								Restricted is not the same as no downstream record, and denied
								fields are removed on the server.
							</HelpTip>
						</div>
						<div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
							<div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
								<h3 className="text-xs font-bold uppercase tracking-wide text-gray-700">
									Proposal context
								</h3>
								<dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
									<dt className="text-gray-600">Available</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.proposal_states.available)}
									</dd>
									<dt className="text-gray-600">Restricted</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.proposal_states.restricted)}
									</dd>
									<dt className="text-gray-600">Unresolved</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.proposal_states.unresolved)}
									</dd>
									<dt className="text-gray-600">No Proposal</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.proposal_states.none)}
									</dd>
								</dl>
							</div>
							<div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
								<h3 className="text-xs font-bold uppercase tracking-wide text-gray-700">
									Project context
								</h3>
								<dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
									<dt className="text-gray-600">Available</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.project_states.available)}
									</dd>
									<dt className="text-gray-600">Restricted</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.project_states.restricted)}
									</dd>
									<dt className="text-gray-600">No Project</dt>
									<dd className="text-right tabular-nums text-gray-900">
										{formatCount(downstream.project_states.none)}
									</dd>
								</dl>
								<p className="mt-2 text-xs text-gray-600">
									Project states are counted only where the Proposal details are
									available.
								</p>
							</div>
						</div>
					</section>
				</>
			) : null}

			{variant === 'detail' ? (
				<section
					aria-labelledby="lead-audit-conversion-evidence-heading"
					className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
				>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div className="flex min-w-0 items-center gap-1.5">
							<h2
								id="lead-audit-conversion-evidence-heading"
								className="text-base font-bold text-gray-900"
							>
								{evidence?.evidence.label ?? 'Conversion evidence'}
							</h2>
							<HelpTip label="About conversion evidence">
								{evidence?.evidence.definition ??
									'Select a cohort figure to open its matching Lead evidence with the same filters.'}
							</HelpTip>
						</div>
						{selectedEvidence ? (
							<span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
								{selectedEvidence.replace('_', ' ')}
							</span>
						) : null}
					</div>

					{evidenceError !== '' ? (
						<div
							className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
							role="alert"
						>
							<div className="flex items-start gap-2">
								<ExclamationTriangleIcon
									className="mt-0.5 h-4 w-4 shrink-0"
									aria-hidden="true"
								/>
								<div>
									<p className="font-semibold">
										The conversion evidence could not be loaded.
									</p>
									<p className="mt-1">{evidenceError}</p>
									{onRetry ? (
										<button
											type="button"
											onClick={onRetry}
											className="mt-2 inline-flex items-center gap-1 font-semibold text-red-900 underline"
										>
											<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
											Retry
										</button>
									) : null}
								</div>
							</div>
						</div>
					) : evidenceLoading ? (
						<div
							className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 p-4 text-sm text-gray-700"
							role="status"
						>
							<ArrowPathIcon
								className="h-4 w-4 motion-safe:animate-spin"
								aria-hidden="true"
							/>
							Loading conversion evidence…
						</div>
					) : evidence ? (
						<>
							<EvidenceTable evidence={evidence} />
							{canPage ? (
								<div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
									<p className="text-gray-600">
										Page {evidence.pagination.page} of{' '}
										{evidence.pagination.total_pages} ·{' '}
										{formatCount(evidence.pagination.total)} Lead(s)
									</p>
									<div className="flex gap-2">
										<button
											type="button"
											onClick={() => {
												if (evidence.pagination.page <= 1) return;
												onEvidencePageChange?.(evidence.pagination.page - 1);
											}}
											aria-disabled={evidence.pagination.page <= 1}
											className="rounded-lg border border-gray-300 px-3 py-1 font-medium text-gray-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
										>
											Previous
										</button>
										<button
											type="button"
											onClick={() => {
												if (
													evidence.pagination.page >=
													evidence.pagination.total_pages
												)
													return;
												onEvidencePageChange?.(evidence.pagination.page + 1);
											}}
											aria-disabled={
												evidence.pagination.page >=
												evidence.pagination.total_pages
											}
											className="rounded-lg border border-gray-300 px-3 py-1 font-medium text-gray-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
										>
											Next
										</button>
									</div>
								</div>
							) : null}
						</>
					) : (
						<p className="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
							No evidence population is selected. Choose a cohort figure above
							to load its matching Leads.
						</p>
					)}
				</section>
			) : null}

			{variant === 'detail' ? (
				<MethodNote
					title="How to read these figures"
					summary="Definitions, cohort limits, and filters not applied"
				>
					<dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
						{section.disclosures.map((disclosure) => (
							<div
								key={disclosure.code}
								className="rounded-lg border border-gray-100 bg-gray-50 p-3"
							>
								<dt className="text-xs font-bold uppercase tracking-wide text-gray-700">
									{disclosure.code.replace(/_/g, ' ')}
								</dt>
								<dd className="mt-1 text-sm text-gray-700">
									{disclosure.text}
								</dd>
							</div>
						))}
					</dl>
					{section.evidence_filters.ignored.length > 0 ? (
						<div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
							<h3 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-gray-700">
								<LinkSlashIcon className="h-4 w-4" aria-hidden="true" />
								Filters not applied to this section
							</h3>
							<ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
								{section.evidence_filters.ignored.map((filter) => (
									<li key={filter.key}>
										<span className="font-semibold">{filter.key}</span>:{' '}
										{filter.reason}
									</li>
								))}
							</ul>
						</div>
					) : null}
				</MethodNote>
			) : null}
		</div>
	);
}
