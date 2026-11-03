'use client';

import {
	ExclamationTriangleIcon,
	InformationCircleIcon,
} from '@heroicons/react/24/outline';
import type { LeadAuditCoverageSection } from '@/server/reports/lead-audit/audit-types';

interface CoverageViewProps {
	report: LeadAuditCoverageSection;
}

function CountValue({ count }: { count: number | null }) {
	if (count === null) {
		return <span className="text-sm text-gray-600">Not counted</span>;
	}
	return (
		<span className="text-lg font-bold tabular-nums text-gray-900">
			{count.toLocaleString('en-IN')}
		</span>
	);
}

export default function CoverageView({ report }: CoverageViewProps) {
	return (
		<div className="space-y-4">
			<section aria-labelledby="lead-audit-coverage-heading">
				<div>
					<h2
						id="lead-audit-coverage-heading"
						className="text-lg font-bold text-gray-900"
					>
						Data coverage
					</h2>
					<p className="text-sm text-gray-600">
						What the stored evidence can establish, what stays unknown, and
						which metric exclusions follow. A missing fact is never shown as a
						measured zero.
					</p>
				</div>
				<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{report.stats.map((entry) => (
						<div
							key={entry.code}
							className={`rounded-xl border p-4 shadow-sm ${
								entry.is_exclusion
									? 'border-amber-200 bg-amber-50/70'
									: 'border-gray-200 bg-white'
							}`}
						>
							<div className="flex items-start justify-between gap-2">
								<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
									{entry.label}
								</span>
								{entry.is_exclusion ? (
									<ExclamationTriangleIcon
										className="h-4 w-4 shrink-0 text-amber-700"
										aria-hidden="true"
									/>
								) : null}
							</div>
							<p className="mt-1">
								<CountValue count={entry.count} />
							</p>
							<p className="mt-1 text-xs text-gray-600">{entry.population}</p>
							<p className="mt-1 text-sm text-gray-800">{entry.detail}</p>
						</div>
					))}
				</div>
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<h3 className="text-base font-bold text-gray-900">
					Evidence coverage by type
				</h3>
				<p className="text-sm text-gray-600">
					Evidence recorded in the selected period under the applied Lead
					filters, counted by its recording time.
				</p>
				<div className="mt-2 overflow-x-auto">
					<table className="min-w-[28rem] w-full border-collapse text-sm">
						<caption className="sr-only">
							Audit evidence recorded in the selected period by type
						</caption>
						<thead>
							<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Evidence type
								</th>
								<th scope="col" className="py-1.5 text-right font-semibold">
									Rows
								</th>
							</tr>
						</thead>
						<tbody>
							{report.evidence_by_type.map((type) => (
								<tr key={type.value} className="border-b border-gray-50">
									<th
										scope="row"
										className="py-1.5 pr-2 text-left font-medium text-gray-800"
									>
										{type.label}
									</th>
									<td className="py-1.5 text-right tabular-nums text-gray-900">
										{type.count.toLocaleString('en-IN')}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
				<h3 className="text-base font-bold text-amber-950">
					Metric exclusions
				</h3>
				<p className="text-sm text-amber-900">
					These rows are excluded from the named metrics by design. They stay
					inspectable elsewhere in the report; they are not silent zeroes.
				</p>
				<div className="mt-2 overflow-x-auto">
					<table className="min-w-[42rem] w-full border-collapse text-sm">
						<caption className="sr-only">
							Metric exclusions and their reasons
						</caption>
						<thead>
							<tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-amber-900">
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Metric
								</th>
								<th scope="col" className="py-1.5 pr-2 text-right font-semibold">
									Excluded
								</th>
								<th scope="col" className="py-1.5 font-semibold">
									Reason
								</th>
							</tr>
						</thead>
						<tbody>
							{report.exclusions.map((exclusion) => (
								<tr key={exclusion.metric} className="border-b border-amber-100 align-top">
									<th scope="row" className="py-1.5 pr-2 text-left font-medium text-amber-950">
										{exclusion.label}
									</th>
									<td className="py-1.5 pr-2 text-right tabular-nums text-amber-950">
										{exclusion.excluded === null
											? '—'
											: exclusion.excluded.toLocaleString('en-IN')}
									</td>
									<td className="py-1.5 text-amber-900">{exclusion.reason}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<div className="flex items-start gap-2">
					<InformationCircleIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div>
						<h3 className="text-base font-bold text-gray-900">
							History limits
						</h3>
						<p className="text-sm text-gray-600">
							The report describes available evidence. It is not an immutable
							issued version or a complete compliance-grade change log.
						</p>
					</div>
				</div>
				<ul className="mt-2 space-y-2 text-sm text-gray-800">
					{report.history_limits.map((limit) => (
						<li key={limit.code}>
							<span className="font-semibold">{limit.label}:</span>{' '}
							{limit.detail}
						</li>
					))}
				</ul>
			</section>

			<section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
				<h3 className="text-base font-bold text-amber-950">
					Retained deleted evidence
				</h3>
				<p className="mt-1 text-sm text-amber-900">
					{report.deleted_evidence.deleted_leads.toLocaleString('en-IN')}{' '}
					deleted Lead(s) and{' '}
					{report.deleted_evidence.deleted_activities.toLocaleString('en-IN')}{' '}
					deleted activity row(s) are retained separately. {report.deleted_evidence.note}
				</p>
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<h3 className="text-base font-bold text-gray-900">
					Coverage disclosures
				</h3>
				<ul className="mt-2 space-y-1 text-sm text-gray-700">
					{report.disclosures.map((disclosure) => (
						<li key={disclosure.code}>{disclosure.text}</li>
					))}
				</ul>
			</section>
		</div>
	);
}
