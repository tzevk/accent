'use client';

import { formatDate, formatDateTime } from '@/lib/format';
import {
	formatCount,
	formatDuration,
	formatRate,
	formatShare,
} from './figures';
import { leadAuditPrintStyles } from './print-styles';
import type { LeadAuditFilterDraft, LeadAuditReport } from './types';

/**
 * The printable management summary (#406).
 *
 * This component is the print surface. It carries the already-authorized
 * report body and the applied filter draft the page holds, and it renders a
 * document-shaped summary only: no navigation, no controls, no evidence
 * tables, and no narrative. The page mounts it once; the print stylesheet in
 * `print-styles.ts` hides every element outside this component's
 * `lead-audit-print-root` wrapper when the browser prints.
 *
 * Downstream Proposal and Project *values* never reach this markup. Only the
 * aggregate permission states (`available`, `restricted`, `unresolved`,
 * `none`) are printed, so a reader without `proposals:read` or `projects:read`
 * sees Restricted rather than a title, status, or progress the server withheld.
 */
export interface PrintSummaryProps {
	/** The same report body the page already loaded and authorized. */
	report: LeadAuditReport;
	/** The applied toolbar draft, including the evidence filters. */
	applied: LeadAuditFilterDraft;
}

interface Disclosure {
	code: string;
	text: string;
}

function calendarDate(value: string): string {
	return value ? formatDate(`${value}T00:00:00`) : 'Not set';
}

function timestamp(value: string): string {
	if (!value) return 'Unknown';
	return formatDateTime(value.replace(' ', 'T'));
}

function pickDisclosures(
	disclosures: ReadonlyArray<Disclosure>,
	codes: ReadonlyArray<string>
): Disclosure[] {
	const selected: Disclosure[] = [];
	for (const code of codes) {
		const found = disclosures.find((entry) => entry.code === code);
		if (found) selected.push(found);
	}
	return selected;
}

const INTAKE_DEFINITION_CODES = [
	'system_entry',
	'enquiry_date',
	'missing_enquiry_date',
	'source_labels',
] as const;

const WORK_DEFINITION_CODES = [
	'completed_work',
	'outreach',
	'successful_contact',
	'unknown_evidence',
	'undated_work',
] as const;

const CONVERSION_DEFINITION_CODES = [
	'cohort_definition',
	'evidence_requirement',
	'period_handoffs',
	'no_period_rate',
	'cohort_maturity',
] as const;

const TIMING_DEFINITION_CODES = [
	'timing_clock',
	'outreach_definition',
	'without_outreach',
	'scope_limits',
] as const;

const CURRENT_STATE_DEFINITION_CODES = [
	'current_state',
	'current_ownership',
	'queue_definitions',
	'current_state_units',
] as const;

export default function PrintSummary({ report, applied }: PrintSummaryProps) {
	const { scope, meta, summary, work, conversion, timing, current_state } =
		report;
	const cohort = conversion.cohort;
	const period = conversion.period;
	const timingExclusions = timing.exclusions;
	const workCoverage = work.coverage;
	const filters = scope.effective_filters;
	const evidenceFilters: Array<{ label: string; value: string }> = [];
	if (applied.actor) {
		evidenceFilters.push({ label: 'Activity author', value: applied.actor });
	}
	if (applied.activityType) {
		evidenceFilters.push({
			label: 'Activity type',
			value: applied.activityType,
		});
	}
	if (applied.outcome) {
		evidenceFilters.push({ label: 'Work outcome', value: applied.outcome });
	}
	if (applied.eventType) {
		evidenceFilters.push({ label: 'Audit event type', value: applied.eventType });
	}
	if (applied.undated) {
		evidenceFilters.push({
			label: 'Audit population',
			value: 'Undated evidence only',
		});
	}

	const definitions = [
		...pickDisclosures(report.disclosures, INTAKE_DEFINITION_CODES),
		...pickDisclosures(work.disclosures, WORK_DEFINITION_CODES),
		...pickDisclosures(conversion.disclosures, CONVERSION_DEFINITION_CODES),
		...pickDisclosures(timing.disclosures, TIMING_DEFINITION_CODES),
		...pickDisclosures(
			current_state.disclosures,
			CURRENT_STATE_DEFINITION_CODES
		),
	];
	const cohortMaturity = conversion.disclosures.find(
		(entry) => entry.code === 'cohort_maturity'
	);
	const emptyCohort = cohort.cohort_size === 0;
	const periodIgnored = current_state.scope.ignored_filters.find(
		(entry) => entry.key === 'period'
	);

	return (
		<>
			<style>{leadAuditPrintStyles}</style>
			<div className="lead-audit-print-root mx-auto w-full min-w-0 max-w-4xl space-y-6 break-words bg-white p-4 text-gray-900 sm:p-6">
				<header className="lead-audit-print-header border-b border-gray-300 pb-3">
					<h1 className="text-xl font-bold leading-tight">
						Lead Audit and Performance — Management summary
					</h1>
					<p className="mt-1 text-sm">
						Generated {timestamp(meta.generated_at)} · Reporting time zone:{' '}
						{meta.time_zone.label} (UTC{meta.time_zone.utc_offset})
					</p>
					<p className="mt-1 text-xs leading-relaxed">
						{meta.live_data_warning}
					</p>
				</header>

				<section aria-labelledby="lead-audit-print-scope-heading">
					<h2
						id="lead-audit-print-scope-heading"
						className="text-base font-bold"
					>
						Scope and applied filters
					</h2>
					<dl className="lead-audit-print-meta mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
						<dt className="font-semibold">Reporting period</dt>
						<dd>
							{calendarDate(scope.from_date)} to {calendarDate(scope.to_date)}{' '}
							(preset: {scope.preset})
						</dd>
						<dt className="font-semibold">Date basis</dt>
						<dd>{scope.date_basis}</dd>
						<dt className="font-semibold">Current owner</dt>
						<dd>{filters.owner.label}</dd>
						<dt className="font-semibold">Source label</dt>
						<dd>
							{filters.source.label}
							{filters.source.is_unknown
								? ' (missing label grouped as Unknown source)'
								: ''}
						</dd>
						<dt className="font-semibold">Current stage</dt>
						<dd>{filters.stage.label}</dd>
						<dt className="font-semibold">Priority</dt>
						<dd>{filters.priority ?? 'All priorities'}</dd>
						<dt className="font-semibold">Search</dt>
						<dd>{filters.search ? `“${filters.search}”` : 'No search term'}</dd>
						{evidenceFilters.map((entry) => (
							<div key={entry.label} className="contents">
								<dt className="font-semibold">{entry.label}</dt>
								<dd>{entry.value}</dd>
							</div>
						))}
					</dl>
					<p className="lead-audit-print-note mt-2 text-xs">
						Owner and stage are present-state filters. They do not describe
						historical assignment or historical stage entry.
					</p>
				</section>

				<section aria-labelledby="lead-audit-print-intake-heading">
					<h2
						id="lead-audit-print-intake-heading"
						className="text-base font-bold"
					>
						Intake
					</h2>
					<p className="mt-1 text-sm">
						System entry and stated Enquiry Dates are different populations.
						Recording a Lead never proves when the enquiry arrived.
					</p>
					<div className="lead-audit-print-scroll mt-2">
						<table className="w-full border-collapse text-sm">
							<caption className="lead-audit-print-note text-left text-xs">
								Applied intake figures and their own date bases.
							</caption>
							<thead>
								<tr>
									<th scope="col">Measure</th>
									<th scope="col" className="text-right">
										Count
									</th>
									<th scope="col">Date basis</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<th scope="row" className="text-left font-medium">
										Leads recorded (system entry)
									</th>
									<td className="lead-audit-print-numeric text-right tabular-nums">
										{formatCount(summary.leads_recorded)}
									</td>
									<td>
										Lead creation time inside the period, including imports
										counted when recorded.
									</td>
								</tr>
								<tr>
									<th scope="row" className="text-left font-medium">
										Enquiries dated in period
									</th>
									<td className="lead-audit-print-numeric text-right tabular-nums">
										{formatCount(summary.enquiries_dated)}
									</td>
									<td>
										The editable Enquiry Date falls inside the period,
										regardless of when the Lead was recorded.
									</td>
								</tr>
								<tr>
									<th scope="row" className="text-left font-medium">
										Recorded Leads with no Enquiry Date
									</th>
									<td className="lead-audit-print-numeric text-right tabular-nums">
										{formatCount(summary.missing_enquiry_date)}
									</td>
									<td>
										Recorded Leads whose Enquiry Date is missing. They stay in
										system entry and stay out of Enquiry Date figures.
									</td>
								</tr>
								<tr>
									<th scope="row" className="text-left font-medium">
										Distinct stored source labels
									</th>
									<td className="lead-audit-print-numeric text-right tabular-nums">
										{formatCount(summary.distinct_sources)}
									</td>
									<td>
										Exact stored labels among recorded Leads; missing labels
										group as Unknown source.
									</td>
								</tr>
							</tbody>
						</table>
					</div>
				</section>

				<section aria-labelledby="lead-audit-print-work-heading">
					<h2
						id="lead-audit-print-work-heading"
						className="text-base font-bold"
					>
						Completed work and outreach
					</h2>
					<p className="mt-1 text-sm">
						Completed calls, emails, meetings, and notes are work. Outreach is
						only completed calls, emails, and meetings. Successful contact needs
						a connected call or a confirmed email reply.
					</p>
					<p className="lead-audit-print-note mt-1 text-xs">
						Date basis: {work.work_date_basis}
					</p>
					<table className="mt-2 w-full border-collapse text-sm">
						<caption className="lead-audit-print-note text-left text-xs">
							Period work, separated by activity type and contact evidence.
						</caption>
						<thead>
							<tr>
								<th scope="col">Figure</th>
								<th scope="col" className="text-right">
									Count
								</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row" className="text-left font-medium">
									Completed activities (total)
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.completed_total)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Calls
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.by_type.call)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Emails
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.by_type.email)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Meetings
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.by_type.meeting)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Notes
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.by_type.note)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Unknown activity type
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.by_type.unknown)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Lead Outreach (Call, Email, Meeting)
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.outreach_total)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Distinct Leads with outreach
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.distinct_leads_with_outreach)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Successful contact activities
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.successful_contact)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Distinct Leads with successful contact
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(
										work.summary.distinct_leads_with_successful_contact
									)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Calls connected
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.calls_connected)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Calls failed (no answer or other recorded failure)
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.calls_failed)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Calls with no usable outcome
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.calls_outcome_unknown)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Emails with a confirmed reply
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.emails_confirmed_reply)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="pl-4 text-left">
									Emails without a confirmed reply
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.emails_unconfirmed)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Corrected activities counted once
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(work.summary.corrected_activities)}
								</td>
							</tr>
						</tbody>
					</table>
					<h3 className="text-sm font-bold">Work coverage and exclusions</h3>
					<table className="mt-1 w-full border-collapse text-sm">
						<caption className="lead-audit-print-note text-left text-xs">
							Facts the period work figures cannot establish.
						</caption>
						<thead>
							<tr>
								<th scope="col">Coverage fact</th>
								<th scope="col" className="text-right">
									Count
								</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row" className="text-left font-medium">
									Completed activities with an unknown occurrence date
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.unknown_occurrence_date)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Unknown activity type
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.unknown_activity_type)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Unknown author
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.unknown_author)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Inactive author reference preserved
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.inactive_author)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Calls with no recorded outcome
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.missing_call_outcome)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Calls with an unrecognized outcome
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.unrecognized_call_outcome)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Emails with no reply evidence
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.missing_email_reply_evidence)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Cancelled work in the period (not completed work)
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.cancelled_in_period)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Soft-deleted activity rows excluded
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(workCoverage.deleted_activity_rows)}
								</td>
							</tr>
						</tbody>
					</table>
				</section>

				<section aria-labelledby="lead-audit-print-cohort-heading">
					<h2
						id="lead-audit-print-cohort-heading"
						className="text-base font-bold"
					>
						Cohort outcomes and handoffs
					</h2>
					<p className="mt-1 text-sm">
						The Lead Cohort Conversion Rate uses the whole intake cohort as its
						denominator and the displayed observation time. A Converted stage
						label alone is not handoff evidence, and conversion is not a sale.
					</p>
					<table className="mt-2 w-full border-collapse text-sm">
						<caption className="lead-audit-print-note text-left text-xs">
							Cohort outcomes with the full denominator beside the evidence gaps.
						</caption>
						<thead>
							<tr>
								<th scope="col">Figure</th>
								<th scope="col" className="text-right">
									Value
								</th>
								<th scope="col">Basis</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row" className="text-left font-medium">
									Cohort Leads (denominator)
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.cohort_size)}
								</td>
								<td>Distinct non-deleted Leads first recorded in the period.</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Evidenced handoffs
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.handoffs_evidenced)}
								</td>
								<td>
									A recorded conversion event or a resolved canonical Proposal
									link.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Lead Cohort Conversion Rate
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatRate(cohort.conversion_rate)}
								</td>
								<td>
									{emptyCohort
										? 'The cohort is empty, so the rate is Not applicable.'
										: `${formatCount(cohort.handoffs_evidenced)} of ${formatCount(cohort.cohort_size)} cohort Leads, observed through ${timestamp(cohort.observed_through)}.`}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Dated period handoffs
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(period.handoffs)}
								</td>
								<td>{period.date_basis}</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Cohort conversion events
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.conversion_events)}
								</td>
								<td>Recorded events among the cohort.</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Undated canonical links
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.undated_links)}
								</td>
								<td>
									Supports cohort evidence only; never a dated period handoff.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Unresolved links
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.unresolved_evidence)}
								</td>
								<td>
									An evidence gap, not a confirmed failure and not a guessed
									handoff.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Converted labels without evidence
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.stage_only_claims)}
								</td>
								<td>Stage labels outside the handoff count.</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									No handoff evidence
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(cohort.no_handoff_evidence)}
								</td>
								<td>Remaining cohort Leads; this is not presented as failure.</td>
							</tr>
						</tbody>
					</table>
					<p className="lead-audit-print-note mt-1 text-xs">
						{formatCount(period.undated_canonical_links)} undated canonical
						link(s) in the filtered Lead population stay outside the dated
						period handoff count.
						{cohortMaturity ? ` ${cohortMaturity.text}` : ''}
					</p>
					<h3 className="text-sm font-bold">Downstream context (permission states)</h3>
					<p className="mt-1 text-xs">
						Proposal and Project values are not printed. Restricted means the
						reader lacks that downstream read grant; it never means no Proposal
						or no Project.
					</p>
					<table className="mt-1 w-full border-collapse text-sm">
						<caption className="lead-audit-print-note text-left text-xs">
							Aggregate downstream states only; no title, status, or progress.
						</caption>
						<thead>
							<tr>
								<th scope="col">Downstream state</th>
								<th scope="col" className="text-right">
									Proposal context
								</th>
								<th scope="col" className="text-right">
									Project context
								</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row" className="text-left font-medium">
									Available to this reader
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.proposal_states.available)}
								</td>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.project_states.available)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Restricted
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.proposal_states.restricted)}
								</td>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.project_states.restricted)}
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Unresolved canonical choice
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.proposal_states.unresolved)}
								</td>
								<td className="text-right">—</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									No downstream record
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.proposal_states.none)}
								</td>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(conversion.downstream.project_states.none)}
								</td>
							</tr>
						</tbody>
					</table>
				</section>

				<section aria-labelledby="lead-audit-print-timing-heading">
					<h2
						id="lead-audit-print-timing-heading"
						className="text-base font-bold"
					>
						Time to first outreach
					</h2>
					<p className="mt-1 text-sm">
						Elapsed time from system entry to the earliest evidenced completed
						Call, Email, or Meeting for each cohort Lead. This is not client
						response time, and no service target applies.
					</p>
					<p className="lead-audit-print-note mt-1 text-xs">
						Clock: {timing.metric.clock} Observation: {timing.metric.observation}
					</p>
					{!timing.available ? (
						<p className="mt-1 rounded border border-gray-400 p-2 text-sm">
							Not available for this cohort: no valid timing sample exists, so
							the duration is unavailable rather than zero.
						</p>
					) : null}
					<table className="mt-2 w-full border-collapse text-sm">
						<caption className="lead-audit-print-note text-left text-xs">
							Timing figures with their sample coverage and exclusions.
						</caption>
						<thead>
							<tr>
								<th scope="col">Figure</th>
								<th scope="col" className="text-right">
									Value
								</th>
								<th scope="col">Meaning</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<th scope="row" className="text-left font-medium">
									Median time to first outreach
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatDuration(timing.median_seconds)}
								</td>
								<td>
									Middle observed duration; an even sample averages the two
									middle durations.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									90th percentile (nearest rank)
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatDuration(timing.p90_seconds)}
								</td>
								<td>The ordered sample at the rounded-up 90th-percent rank.</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Valid timing samples
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(timing.valid_samples)}
								</td>
								<td>
									Cohort Leads with a known, non-negative interval. Coverage
									denominator: {formatCount(timing.cohort_leads)} cohort Leads.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Without evidenced outreach
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(timing.without_outreach)} (
									{formatShare(timing.without_outreach_share)})
								</td>
								<td>
									Cohort Leads with no completed Call, Email, or Meeting.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Excluded: unknown occurrence time
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(timingExclusions.missing_timestamp)}
								</td>
								<td>Outreach exists, but no timestamp is substituted.</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Excluded: incomplete earlier evidence
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(timingExclusions.incomplete_earlier)}
								</td>
								<td>
									A known outreach time beside unknown earlier evidence.
								</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									Excluded: negative interval
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(timingExclusions.negative)}
								</td>
								<td>Measured, disclosed, and never clamped to zero.</td>
							</tr>
							<tr>
								<th scope="row" className="text-left font-medium">
									All timing exclusions
								</th>
								<td className="lead-audit-print-numeric text-right tabular-nums">
									{formatCount(timingExclusions.total)}
								</td>
								<td>Excluded from the durations above.</td>
							</tr>
						</tbody>
					</table>
				</section>

				<section aria-labelledby="lead-audit-print-workload-heading">
					<h2
						id="lead-audit-print-workload-heading"
						className="text-base font-bold"
					>
						Current-owner workload
					</h2>
					<p className="mt-1 text-sm">
						Present responsibility, not historical activity authorship. Observed
						at {timestamp(current_state.as_of.generated_at)}.
					</p>
					{current_state.workload.owners.length === 0 ? (
						<p className="mt-1 text-sm">
							No Lead matches the applied current-state filters, so there is no
							owner workload to show.
						</p>
					) : (
						<table className="mt-2 w-full border-collapse text-sm">
							<caption className="lead-audit-print-note text-left text-xs">
								Distinct non-deleted Leads currently owned by each person.
							</caption>
							<thead>
								<tr>
									<th scope="col">Current owner</th>
									<th scope="col" className="text-right">
										Distinct Leads
									</th>
								</tr>
							</thead>
							<tbody>
								{current_state.workload.owners.map((group) => (
									<tr key={`${group.owner.id ?? 'unassigned'}-${group.owner.name}`}>
										<th scope="row" className="text-left font-medium">
											{`${group.owner.id === null ? 'Unassigned' : group.owner.name}${
												group.owner.is_inactive ? ' (inactive account)' : ''
											}${
												group.owner.is_unknown
													? ' (unknown user reference)'
													: ''
											}`}
										</th>
										<td className="lead-audit-print-numeric text-right tabular-nums">
											{formatCount(group.count)}
										</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr>
									<th scope="row" className="text-left font-semibold">
										Total
									</th>
									<td className="lead-audit-print-numeric text-right font-semibold tabular-nums">
										{formatCount(current_state.workload.total)}
									</td>
								</tr>
							</tfoot>
						</table>
					)}
				</section>

				<section aria-labelledby="lead-audit-print-risks-heading">
					<h2
						id="lead-audit-print-risks-heading"
						className="text-base font-bold"
					>
						Current operational risks
					</h2>
					<p className="mt-1 text-sm">
						These are current-state figures at observation time —{' '}
						{timestamp(current_state.as_of.generated_at)} — not a historical
						period-end backlog. The selected reporting period is not applied.
					</p>
					<p className="lead-audit-print-note mt-1 text-xs">
						Date basis: {current_state.as_of.date_basis}
						{periodIgnored ? ` Selected period: ${periodIgnored.value}.` : ''}
					</p>
					<table className="mt-2 w-full border-collapse text-sm">
						<caption className="lead-audit-print-note text-left text-xs">
							Live queue counters under the applied current-state filters.
						</caption>
						<thead>
							<tr>
								<th scope="col">Queue</th>
								<th scope="col" className="text-right">
									Count
								</th>
								<th scope="col">Counter unit</th>
								<th scope="col">Evidence unit</th>
								<th scope="col">As of</th>
							</tr>
						</thead>
						<tbody>
							{current_state.risks.map((risk) => (
								<tr key={risk.key}>
									<th scope="row" className="text-left font-medium">
										{risk.label}
									</th>
									<td className="lead-audit-print-numeric text-right tabular-nums">
										{formatCount(risk.count)}
									</td>
									<td>
										{risk.counter_unit === 'distinct_leads'
											? 'Distinct Leads'
											: risk.counter_unit}
									</td>
									<td>
										{risk.evidence_unit === 'scheduled_work_item'
											? 'Scheduled work items'
											: 'Distinct Leads'}
									</td>
									<td>{timestamp(risk.as_of)}</td>
								</tr>
							))}
						</tbody>
					</table>
					<dl className="mt-2 text-xs">
						{current_state.risks.map((risk) => (
							<div key={`${risk.key}-definition`} className="contents">
								<dt className="font-semibold">{risk.label}</dt>
								<dd>{risk.definition}</dd>
							</div>
						))}
					</dl>
				</section>

				<section aria-labelledby="lead-audit-print-definitions-heading">
					<h2
						id="lead-audit-print-definitions-heading"
						className="text-base font-bold"
					>
						Essential definitions
					</h2>
					<dl className="mt-1 text-xs">
						{definitions.map((definition) => (
							<div key={definition.code} className="contents">
								<dt className="font-semibold">{definition.code}</dt>
								<dd>{definition.text}</dd>
							</div>
						))}
					</dl>
				</section>

				<section aria-labelledby="lead-audit-print-coverage-heading">
					<h2
						id="lead-audit-print-coverage-heading"
						className="text-base font-bold"
					>
						Coverage, exclusions, and retained deleted evidence
					</h2>
					{report.coverage.exclusions.length === 0 ? (
						<p className="mt-1 text-sm">
							This scope reports no material metric exclusions beyond the
							coverage facts printed above.
						</p>
					) : (
						<table className="mt-2 w-full border-collapse text-sm">
							<caption className="lead-audit-print-note text-left text-xs">
								Material exclusions that change what these figures can
								establish.
							</caption>
							<thead>
								<tr>
									<th scope="col">Metric</th>
									<th scope="col" className="text-right">
										Excluded
									</th>
									<th scope="col">Reason</th>
								</tr>
							</thead>
							<tbody>
								{report.coverage.exclusions.map((exclusion) => (
									<tr key={`${exclusion.metric}-${exclusion.label}`}>
										<th scope="row" className="text-left font-medium">
											{exclusion.label}
										</th>
										<td className="lead-audit-print-numeric text-right tabular-nums">
											{exclusion.excluded === null
												? 'Statement'
												: formatCount(exclusion.excluded)}
										</td>
										<td>{exclusion.reason}</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					<p className="lead-audit-print-note mt-2 text-xs">
						Retained deleted evidence stays outside operational totals:{' '}
						{formatCount(report.coverage.deleted_evidence.deleted_leads)}{' '}
						deleted Lead(s) and{' '}
						{formatCount(report.coverage.deleted_evidence.deleted_activities)}{' '}
						deleted activity row(s) retained for audit. Deletion flags are not
						deletion events; missing deletion actors and times stay unknown.
					</p>
					{report.coverage.history_limits.length > 0 ? (
						<>
							<h3 className="text-sm font-bold">History limits</h3>
							<ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
								{report.coverage.history_limits.map((limit) => (
									<li key={limit.code}>
										<span className="font-semibold">{limit.label}:</span>{' '}
										{limit.detail}
									</li>
								))}
							</ul>
						</>
					) : null}
				</section>

				<section
					aria-labelledby="lead-audit-print-limits-heading"
					className="lead-audit-print-note border-t border-gray-300 pt-2 text-xs"
				>
					<h2
						id="lead-audit-print-limits-heading"
						className="text-sm font-bold"
					>
						Printing and interpretation
					</h2>
					<p className="mt-1">
						This printed summary is one observation at{' '}
						{timestamp(meta.generated_at)} ({meta.time_zone.label}). It is live
						corrected data, not a frozen issued report: a later read can
						legitimately differ, and this page cannot promise equality with the
						screen or with an Excel copy.
					</p>
					<p className="mt-1">
						Printing needs only the report read grants; it does not require
						`reports:export`. Browser printing and browser PDF saving cannot
						prevent copying, screenshots, or re-sharing of visible figures.
					</p>
					<p className="mt-1">
						The printed summary excludes navigation, controls, evidence tables,
						narratives, and Proposal or Project values. Restricted downstream
						context stays labelled Restricted.
					</p>
				</section>
			</div>
		</>
	);
}
