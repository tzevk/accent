'use client';

import Link from 'next/link';
import {
	ArrowPathIcon,
	ChartBarIcon,
	ClockIcon,
	GlobeAltIcon,
} from '@heroicons/react/24/outline';
import { formatDate } from '@/lib/format';
import { LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS } from '@/server/reports/lead-audit/audit-types';
import type {
	LeadAuditIntakeSection,
	LeadAuditFilterDraft,
	LeadAuditViewTab,
} from './types';

interface ReportHeaderProps {
	report: LeadAuditIntakeSection;
	tabs: ReadonlyArray<LeadAuditViewTab>;
	activeView: string;
	onSelectView: (key: string) => void;
	onRefresh: () => void;
	refreshing: boolean;
	evidenceFilters?: LeadAuditFilterDraft;
}

function calendarDate(value: string): string {
	return value ? formatDate(`${value}T00:00:00`) : '—';
}

export default function ReportHeader({
	report,
	tabs,
	activeView,
	onSelectView,
	onRefresh,
	refreshing,
	evidenceFilters,
}: ReportHeaderProps) {
	const filters = report.scope.effective_filters;
	const chips = [
		`Period: ${calendarDate(report.scope.from_date)} to ${calendarDate(report.scope.to_date)}`,
		`Owner: ${filters.owner.label}`,
		`Source: ${filters.source.label}`,
		`Stage: ${filters.stage.label}`,
		`Priority: ${filters.priority ?? 'All priorities'}`,
		...(filters.search ? [`Search: “${filters.search}”`] : []),
		...(evidenceFilters?.actor
			? [
					`Work/audit actor: ${
						evidenceFilters.actor === 'unknown'
							? 'Unknown actor'
							: (report.filter_options.actors?.find(
									(actor) => String(actor.id) === evidenceFilters.actor
								)?.name ?? `User #${evidenceFilters.actor}`)
					}`,
				]
			: []),
		...(evidenceFilters?.activityType
			? [`Work/audit activity: ${evidenceFilters.activityType}`]
			: []),
		...(evidenceFilters?.outcome
			? [`Work/audit outcome: ${evidenceFilters.outcome}`]
			: []),
		...(evidenceFilters?.eventType
			? [
					`Audit event: ${
						LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.find(
							(event) => event.value === evidenceFilters.eventType
						)?.label ?? evidenceFilters.eventType
					}`,
				]
			: []),
		...(evidenceFilters?.undated ? ['Audit population: undated evidence'] : []),
	];

	return (
		<header className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-r from-[#64126D] to-[#86288F] p-4 text-white shadow-lg sm:p-5">
			<div
				className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl"
				aria-hidden="true"
			/>
			<div className="relative flex flex-col gap-3">
				<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div className="flex min-w-0 items-start gap-3">
						<div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 sm:flex">
							<ChartBarIcon className="h-6 w-6" aria-hidden="true" />
						</div>
						<div className="min-w-0">
							<h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">
								Lead Audit and Performance
							</h1>
							<p className="mt-0.5 text-sm text-white/85">
								Lead intake, completed work, evidenced handoffs, and current
								operational risks.
							</p>
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Link
							href="/reports"
							className="inline-flex h-8 items-center rounded-md bg-white/10 px-3 text-xs font-medium text-white ring-1 ring-white/25 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
						>
							Reports
						</Link>
						<button
							type="button"
							onClick={onRefresh}
							disabled={refreshing}
							className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium text-white ring-1 ring-white/25 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
						>
							<ArrowPathIcon
								className={`h-3.5 w-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
								aria-hidden="true"
							/>
							Refresh
						</button>
					</div>
				</div>

				<dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
					<div className="flex items-start gap-2 rounded-lg bg-white/10 p-2.5 ring-1 ring-white/15">
						<ClockIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
						<div>
							<dt className="font-semibold uppercase tracking-wide text-white/70">
								Generated
							</dt>
							<dd>{report.meta.generated_at}</dd>
						</div>
					</div>
					<div className="flex items-start gap-2 rounded-lg bg-white/10 p-2.5 ring-1 ring-white/15">
						<GlobeAltIcon
							className="mt-0.5 h-4 w-4 shrink-0"
							aria-hidden="true"
						/>
						<div>
							<dt className="font-semibold uppercase tracking-wide text-white/70">
								Reporting time zone
							</dt>
							<dd>{report.meta.time_zone.label}</dd>
						</div>
					</div>
					<div className="rounded-lg bg-white/10 p-2.5 ring-1 ring-white/15 sm:col-span-2">
						<dt className="font-semibold uppercase tracking-wide text-white/70">
							Date basis
						</dt>
						<dd>{report.scope.date_basis}</dd>
					</div>
				</dl>

				<ul
					className="flex flex-wrap gap-1.5 text-[11px]"
					aria-label="Applied filters"
				>
					{chips.map((chip) => (
						<li
							key={chip}
							className="rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20"
						>
							{chip}
						</li>
					))}
				</ul>

				<nav aria-label="Lead Audit views" className="flex flex-wrap gap-1">
					{tabs.map((tab) => {
						const selected = tab.key === activeView;
						return (
							<button
								key={tab.key}
								type="button"
								onClick={() => onSelectView(tab.key)}
								aria-current={selected ? 'page' : undefined}
								className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
									selected
										? 'bg-white text-[#64126D]'
										: 'bg-white/10 text-white hover:bg-white/20'
								}`}
							>
								{tab.label}
							</button>
						);
					})}
				</nav>

				<p className="text-[11px] text-white/75" role="note">
					{report.meta.live_data_warning}
				</p>
			</div>
		</header>
	);
}
