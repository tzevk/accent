'use client';

import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { formatDate } from '@/lib/format';
import { LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS } from '@/server/reports/lead-audit/audit-types';
import { HelpTip } from './help-tip';
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
		`${calendarDate(report.scope.from_date)} – ${calendarDate(report.scope.to_date)}`,
		...(filters.owner.label !== 'All owners'
			? [`Owner: ${filters.owner.label}`]
			: []),
		...(filters.source.label !== 'All sources'
			? [`Source: ${filters.source.label}`]
			: []),
		...(filters.stage.label !== 'All stages'
			? [`Stage: ${filters.stage.label}`]
			: []),
		...(filters.priority ? [`Priority: ${filters.priority}`] : []),
		...(filters.search ? [`Search: “${filters.search}”`] : []),
		...(evidenceFilters?.actor
			? [
					`Actor: ${
						evidenceFilters.actor === 'unknown'
							? 'Unknown'
							: (report.filter_options.actors?.find(
									(actor) => String(actor.id) === evidenceFilters.actor
								)?.name ?? `User #${evidenceFilters.actor}`)
					}`,
				]
			: []),
		...(evidenceFilters?.activityType
			? [`Activity: ${evidenceFilters.activityType}`]
			: []),
		...(evidenceFilters?.outcome
			? [`Outcome: ${evidenceFilters.outcome}`]
			: []),
		...(evidenceFilters?.eventType
			? [
					`Event: ${
						LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.find(
							(event) => event.value === evidenceFilters.eventType
						)?.label ?? evidenceFilters.eventType
					}`,
				]
			: []),
		...(evidenceFilters?.undated ? ['Undated evidence'] : []),
	];

	return (
		<header className="relative mb-3 overflow-hidden rounded-2xl bg-gradient-to-r from-[#64126D] to-[#86288F] p-4 text-white sm:p-5">
			<div
				className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl"
				aria-hidden="true"
			/>

			<div className="relative flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1 className="break-words text-xl font-bold tracking-tight sm:text-2xl">
						Lead Audit and Performance
					</h1>
					<div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-white/85">
						<span>
							Generated {report.meta.generated_at} ·{' '}
							{report.meta.time_zone.label}
						</span>
						<HelpTip label="About this report" tone="inverse">
							Lead intake, completed work, evidenced handoffs, and current
							operational risks. {report.scope.date_basis}{' '}
							{report.meta.live_data_warning}
						</HelpTip>
					</div>
				</div>
				<button
					type="button"
					onClick={() => {
						if (!refreshing) onRefresh();
					}}
					aria-disabled={refreshing}
					aria-label="Refresh the report"
					title="Refresh the report"
					className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/25 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white aria-disabled:opacity-60"
				>
					<ArrowPathIcon
						className={`h-4 w-4 ${refreshing ? 'motion-safe:animate-spin' : ''}`}
						aria-hidden="true"
					/>
				</button>
			</div>

			<nav
				aria-label="Lead Audit views"
				className="relative mt-3 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0"
			>
				{tabs.map((tab) => {
					const selected = tab.key === activeView;
					return (
						<button
							key={tab.key}
							type="button"
							onClick={() => onSelectView(tab.key)}
							aria-current={selected ? 'page' : undefined}
							className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 ${
								selected
									? 'bg-white text-[#64126D] focus-visible:ring-[#64126D] focus-visible:ring-offset-2'
									: 'bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white'
							}`}
						>
							{tab.label}
						</button>
					);
				})}
			</nav>

			{chips.length > 0 ? (
				<ul
					className="relative mt-2 flex flex-wrap gap-1.5 text-[11px]"
					aria-label="Applied filters"
				>
					{chips.map((chip) => (
						<li
							key={chip}
							className="min-w-0 break-words rounded-full bg-white/15 px-2.5 py-1 ring-1 ring-white/20"
						>
							{chip}
						</li>
					))}
				</ul>
			) : null}
		</header>
	);
}
