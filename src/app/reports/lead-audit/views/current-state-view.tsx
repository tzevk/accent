'use client';

import {
	ClockIcon,
	ExclamationTriangleIcon,
	UserGroupIcon,
} from '@heroicons/react/24/outline';
import { MethodNote } from '../method-note';
import type {
	CurrentStateEvidenceSelection,
	CurrentStateOwner,
	CurrentStateRisk,
	CurrentStateWorkloadGroup,
	LeadAuditCurrentStateSection,
} from '@/server/reports/lead-audit/current-state-types';

interface CurrentStateViewProps {
	section: LeadAuditCurrentStateSection;
	/** Overview keeps the risks first; Work leads with owner workload. */
	variant?: 'overview' | 'work';
	/** The page owns the evidence request and its applied query. */
	onSelectGroup?: (selection: CurrentStateEvidenceSelection) => void;
}

const DISCLOSURE_LABELS: Record<string, string> = {
	current_state: 'Current state',
	current_state_units: 'Counter units',
	current_ownership: 'Current ownership',
	queue_definitions: 'Queue definitions',
	current_state_deleted: 'Deleted records',
	current_state_calendar: 'Database calendar day',
};

function formatCount(value: number): string {
	return value.toLocaleString('en-IN');
}

function ownerLabel(owner: CurrentStateOwner): string {
	return owner.id === null ? 'Unassigned' : owner.name;
}

function OwnerBadges({ owner }: { owner: CurrentStateOwner }) {
	if (!owner.is_inactive && !owner.is_unknown) return null;
	return (
		<span className="ml-1 inline-flex gap-1 align-middle">
			{owner.is_inactive ? (
				<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
					Inactive
				</span>
			) : null}
			{owner.is_unknown ? (
				<span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
					Unknown user
				</span>
			) : null}
		</span>
	);
}

function RiskCard({
	risk,
	onSelectGroup,
}: {
	risk: CurrentStateRisk;
	onSelectGroup?: (selection: CurrentStateEvidenceSelection) => void;
}) {
	const select = (selection: CurrentStateEvidenceSelection) =>
		onSelectGroup?.(selection);
	const body = (
		<>
			<div className="flex items-start justify-between gap-2">
				<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
					{risk.label}
				</span>
				<ExclamationTriangleIcon
					className={`h-5 w-5 shrink-0 ${
						risk.count > 0 ? 'text-amber-700' : 'text-gray-400'
					}`}
					aria-hidden="true"
				/>
			</div>
			<p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
				{formatCount(risk.count)}
			</p>
			<p className="mt-1 text-xs font-medium text-gray-700">
				{risk.count === 1 ? 'distinct Lead' : 'distinct Leads'}
			</p>
			<p className="mt-2 text-xs text-gray-600">{risk.definition}</p>
			<p className="mt-2 text-[11px] text-gray-500">
				As of {risk.as_of}. Evidence lists{' '}
				{risk.evidence_unit === 'scheduled_work_item'
					? 'individual scheduled work items'
					: 'the matching Leads'}
				.
			</p>
			{onSelectGroup ? (
				<span className="mt-2 inline-block text-xs font-semibold text-[#64126D] group-hover:underline">
					View {risk.label} evidence
				</span>
			) : null}
		</>
	);

	if (!onSelectGroup) {
		return (
			<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				{body}
			</div>
		);
	}
	return (
		<button
			type="button"
			onClick={() => select({ group: 'risk', risk: risk.key })}
			aria-label={`View ${risk.label} evidence, ${formatCount(risk.count)} distinct Leads`}
			className="group rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
		>
			{body}
		</button>
	);
}

function WorkloadTable({
	section,
	onSelectGroup,
}: {
	section: LeadAuditCurrentStateSection;
	onSelectGroup?: (selection: CurrentStateEvidenceSelection) => void;
}) {
	const groups = section.workload.owners;
	const select = (selection: CurrentStateEvidenceSelection) =>
		onSelectGroup?.(selection);
	return (
		<div
			className="mt-3 overflow-x-auto"
			role="region"
			aria-label="Current-owner workload table. Scroll horizontally for more columns."
			tabIndex={0}
		>
			<table className="w-full min-w-[420px] border-collapse text-sm">
				<caption className="sr-only">
					Current-owner workload as of the report generation time, counting
					distinct Leads per present owner
				</caption>
				<thead>
					<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
						<th scope="col" className="py-1.5 pr-3 font-semibold">
							Current owner
						</th>
						<th scope="col" className="py-1.5 text-right font-semibold">
							Distinct Leads
						</th>
					</tr>
				</thead>
				<tbody>
					{groups.length === 0 ? (
						<tr>
							<td colSpan={2} className="py-3 text-sm text-gray-600">
								No Leads match the applied current-state filters.
							</td>
						</tr>
					) : (
						groups.map((group: CurrentStateWorkloadGroup) => {
							const ownerValue =
								group.owner.id === null ? 'unassigned' : group.owner.id;
							return (
								<tr
									key={group.owner.id ?? 'unassigned'}
									className="border-b border-gray-50"
								>
									<th
										scope="row"
										className="whitespace-pre-wrap py-2 pr-3 text-left font-medium text-gray-800"
									>
										{ownerLabel(group.owner)}
										<OwnerBadges owner={group.owner} />
									</th>
									<td className="py-2 text-right tabular-nums text-gray-900">
										{onSelectGroup ? (
											<button
												type="button"
												onClick={() =>
													select({
														group: 'workload',
														risk: null,
														owner: ownerValue,
													})
												}
												aria-label={`View ${ownerLabel(group.owner)} workload evidence, ${formatCount(group.count)} distinct Leads`}
												className="font-semibold text-[#4A1254] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
											>
												{formatCount(group.count)}
											</button>
										) : (
											formatCount(group.count)
										)}
									</td>
								</tr>
							);
						})
					)}
				</tbody>
				<tfoot>
					<tr className="border-t border-gray-200 text-xs text-gray-700">
						<th scope="row" className="py-2 pr-3 text-left font-semibold">
							All current owners
						</th>
						<td className="py-2 text-right font-semibold tabular-nums text-gray-900">
							{formatCount(section.workload.total)}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	);
}

function Observation({ section }: { section: LeadAuditCurrentStateSection }) {
	const filters = section.scope.effective_filters;
	const chips = [
		`Current owner: ${filters.owner.label}`,
		`Source: ${filters.source.label}`,
		`Current stage: ${filters.stage.label}`,
		`Priority: ${filters.priority ?? 'All priorities'}`,
		...(filters.search ? [`Search: “${filters.search}”`] : []),
	];
	return (
		<div className="space-y-2">
			<div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
				<ClockIcon
					className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
					aria-hidden="true"
				/>
				<div>
					<p className="text-sm font-semibold text-gray-900">
						As of generation time: {section.as_of.generated_at}
					</p>
					<p className="mt-0.5 text-xs text-gray-600">
						{section.as_of.time_zone.label}. {section.as_of.date_basis}
					</p>
					<p className="mt-1 text-xs font-medium text-amber-900" role="note">
						These figures never represent the selected reporting period&apos;s
						end. Selecting a historical period does not show a historical
						backlog.
					</p>
				</div>
			</div>
			<ul
				className="flex flex-wrap gap-1.5 text-[11px]"
				aria-label="Effective current-state filters"
			>
				{chips.map((chip) => (
					<li
						key={chip}
						className="rounded-full bg-white px-2.5 py-1 text-gray-800 ring-1 ring-gray-300"
					>
						{chip}
					</li>
				))}
			</ul>
			{section.scope.ignored_filters.length > 0 ? (
				<details className="group rounded-lg border border-amber-200 bg-amber-50 p-3">
					<summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wide text-amber-900 [&::-webkit-details-marker]:hidden">
						Filters not applied to current state
					</summary>
					<ul className="mt-1 space-y-1 text-xs text-amber-950">
						{section.scope.ignored_filters.map((filter) => (
							<li key={filter.key}>
								<strong className="font-semibold">{filter.label}:</strong>{' '}
								{filter.value ?? 'not supplied'} — {filter.reason}
							</li>
						))}
					</ul>
				</details>
			) : null}
		</div>
	);
}

export default function CurrentStateView({
	section,
	variant = 'overview',
	onSelectGroup,
}: CurrentStateViewProps) {
	const risks = (
		<section aria-labelledby={`lead-audit-current-risks-${variant}`}>
			<div className="mb-2">
				<h2
					id={`lead-audit-current-risks-${variant}`}
					className="text-lg font-bold text-gray-900"
				>
					Current operational risks
				</h2>
				<p className="text-sm text-gray-600">
					Five Lead queues at the observation time; counters are distinct Leads.
				</p>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
				{section.risks.map((risk) => (
					<RiskCard key={risk.key} risk={risk} onSelectGroup={onSelectGroup} />
				))}
			</div>
		</section>
	);

	const workload = (
		<section
			aria-labelledby={`lead-audit-current-workload-${variant}`}
			className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="flex items-start gap-2">
				<UserGroupIcon
					className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
					aria-hidden="true"
				/>
				<div>
					<h2
						id={`lead-audit-current-workload-${variant}`}
						className="text-lg font-bold text-gray-900"
					>
						Current-owner workload
					</h2>
					<p className="text-sm text-gray-600">
						Present responsibility by owner; unassigned and inactive owners stay
						visible.
					</p>
				</div>
			</div>
			<WorkloadTable section={section} onSelectGroup={onSelectGroup} />
		</section>
	);

	const disclosures = (
		<MethodNote
			title="How to read these figures"
			summary="Current-state limits and definitions"
		>
			<dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
				{section.disclosures.map((disclosure) => (
					<div
						key={disclosure.code}
						className="rounded-lg border border-gray-100 bg-gray-50 p-3"
					>
						<dt className="text-xs font-bold uppercase tracking-wide text-gray-700">
							{DISCLOSURE_LABELS[disclosure.code] ?? disclosure.code}
						</dt>
						<dd className="mt-1 text-sm text-gray-700">{disclosure.text}</dd>
					</div>
				))}
			</dl>
		</MethodNote>
	);

	return (
		<div className="space-y-4">
			<Observation section={section} />
			{variant === 'work' ? (
				<>
					{workload}
					{risks}
				</>
			) : (
				<>
					{risks}
					{workload}
				</>
			)}
			{disclosures}
		</div>
	);
}
