'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
	ArrowPathIcon,
	CalendarDaysIcon,
	ChevronRightIcon,
	MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { LEAD_ACTIVITY_TYPES, LEAD_CALL_OUTCOMES } from '@/lib/lead-activities';
import { LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS } from '@/server/reports/lead-audit/audit-types';
import { PRESET_OPTIONS } from './filters';
import type { LeadAuditFilterDraft, LeadAuditFilterOptions } from './types';

interface FilterToolbarProps {
	draft: LeadAuditFilterDraft;
	options: LeadAuditFilterOptions | undefined;
	onChange: (patch: Partial<LeadAuditFilterDraft>) => void;
	onApply: () => void;
	onReset: () => void;
	busy: boolean;
	invalidMessage: string;
	/** Export and Print sit beside Reset without owning the filter form. */
	actions?: ReactNode;
}

const controlClass =
	'h-9 w-full rounded-md border border-gray-400 bg-white px-2 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#64126D] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-600';

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor: string;
	children: ReactNode;
}) {
	return (
		<div className="min-w-0">
			<label
				htmlFor={htmlFor}
				className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-700"
			>
				{label}
			</label>
			{children}
		</div>
	);
}

export default function FilterToolbar({
	draft,
	options,
	onChange,
	onApply,
	onReset,
	busy,
	invalidMessage,
	actions,
}: FilterToolbarProps) {
	const custom = draft.preset === 'custom';
	const owners = options?.owners ?? [];
	const sources = options?.sources ?? [];
	const stages = options?.stages ?? [];
	const priorities = options?.priorities ?? ['Low', 'Medium', 'High'];
	const actors = options?.actors ?? [];
	const advancedFilterCount = [
		draft.actor,
		draft.activityType,
		draft.outcome,
		draft.eventType,
		draft.undated ? 'undated' : '',
	].filter(Boolean).length;

	useEffect(() => {
		if (invalidMessage === '') return;
		document.getElementById('lead-audit-from')?.focus();
	}, [invalidMessage]);

	return (
		<form
			className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4"
			onSubmit={(event) => {
				event.preventDefault();
				if (busy) return;
				onApply();
			}}
			aria-label="Lead Audit filters"
		>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<Field label="Period" htmlFor="lead-audit-preset">
					<select
						id="lead-audit-preset"
						value={draft.preset}
						onChange={(event) => onChange({ preset: event.target.value })}
						className={controlClass}
					>
						{PRESET_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</Field>

				<Field label="From" htmlFor="lead-audit-from">
					<div className="relative">
						<CalendarDaysIcon
							className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
							aria-hidden="true"
						/>
						<input
							id="lead-audit-from"
							type="date"
							value={draft.from}
							disabled={!custom}
							aria-invalid={invalidMessage !== '' ? true : undefined}
							aria-describedby={
								invalidMessage !== '' ? 'lead-audit-filter-error' : undefined
							}
							onChange={(event) => onChange({ from: event.target.value })}
							className={`${controlClass} pl-8`}
						/>
					</div>
				</Field>

				<Field label="To" htmlFor="lead-audit-to">
					<div className="relative">
						<CalendarDaysIcon
							className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
							aria-hidden="true"
						/>
						<input
							id="lead-audit-to"
							type="date"
							value={draft.to}
							disabled={!custom}
							aria-invalid={invalidMessage !== '' ? true : undefined}
							aria-describedby={
								invalidMessage !== '' ? 'lead-audit-filter-error' : undefined
							}
							onChange={(event) => onChange({ to: event.target.value })}
							className={`${controlClass} pl-8`}
						/>
					</div>
				</Field>

				<Field label="Current owner" htmlFor="lead-audit-owner">
					<select
						id="lead-audit-owner"
						value={draft.owner}
						onChange={(event) => onChange({ owner: event.target.value })}
						className={controlClass}
					>
						<option value="">All owners</option>
						<option value="unassigned">Unassigned</option>
						{owners.map((owner) => (
							<option key={owner.id} value={String(owner.id)}>
								{owner.full_name}
								{owner.is_active ? '' : ' (inactive)'}
							</option>
						))}
					</select>
				</Field>

				<Field label="Source" htmlFor="lead-audit-source">
					<select
						id="lead-audit-source"
						value={
							draft.sourceMissing
								? '__missing__'
								: draft.source === ''
									? ''
									: `source:${draft.source}`
						}
						onChange={(event) => {
							const value = event.target.value;
							if (value === '__missing__') {
								onChange({ source: '', sourceMissing: true });
							} else {
								onChange({
									source: value.slice('source:'.length),
									sourceMissing: false,
								});
							}
						}}
						className={controlClass}
					>
						<option value="">All sources</option>
						<option value="__missing__">Unknown source</option>
						{sources
							.filter((source) => !source.is_unknown)
							.map((source) => (
								<option
									key={source.label ?? ''}
									value={`source:${source.label ?? ''}`}
								>
									{source.label?.trim() === source.label
										? source.label
										: JSON.stringify(source.label)}
								</option>
							))}
					</select>
				</Field>

				<Field label="Current stage" htmlFor="lead-audit-stage">
					<select
						id="lead-audit-stage"
						value={draft.stage}
						onChange={(event) => onChange({ stage: event.target.value })}
						className={controlClass}
					>
						<option value="">All stages</option>
						{stages.map((stage) => (
							<option key={stage.value} value={stage.value}>
								{stage.label}
							</option>
						))}
					</select>
				</Field>

				<Field label="Priority" htmlFor="lead-audit-priority">
					<select
						id="lead-audit-priority"
						value={draft.priority}
						onChange={(event) => onChange({ priority: event.target.value })}
						className={controlClass}
					>
						<option value="">All priorities</option>
						{priorities.map((priority) => (
							<option key={priority} value={priority}>
								{priority}
							</option>
						))}
					</select>
				</Field>

				<Field label="Search" htmlFor="lead-audit-search">
					<div className="relative">
						<MagnifyingGlassIcon
							className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
							aria-hidden="true"
						/>
						<input
							id="lead-audit-search"
							type="search"
							value={draft.search}
							onChange={(event) => onChange({ search: event.target.value })}
							placeholder="Lead, company, contact, need"
							className={`${controlClass} pl-8`}
						/>
					</div>
				</Field>
			</div>

			<div className="mt-4 min-w-0 border-t border-gray-200 pt-3">
				<div className="flex items-center gap-1.5">
					<details className="group min-w-0 flex-1">
						<summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-gray-800 [&::-webkit-details-marker]:hidden">
							<ChevronRightIcon
								className="h-4 w-4 text-gray-500 group-open:rotate-90"
								aria-hidden="true"
							/>
							More filters
							{advancedFilterCount > 0 ? (
								<span className="rounded-full bg-[#64126D]/10 px-2 py-0.5 text-[11px] font-semibold text-[#64126D]">
									{advancedFilterCount}
								</span>
							) : null}
						</summary>
						<p className="mt-2 max-w-prose text-xs text-gray-600">
							Actor, activity type, and outcome narrow work and audit evidence;
							the other filters narrow Lead figures.
						</p>
						<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
							<Field label="Recorded actor" htmlFor="lead-audit-actor">
								<select
									id="lead-audit-actor"
									value={draft.actor}
									onChange={(event) => onChange({ actor: event.target.value })}
									className={controlClass}
								>
									<option value="">All actors</option>
									<option value="unknown">Unknown actor</option>
									{actors.map((actor) => (
										<option key={actor.id} value={String(actor.id)}>
											{actor.name ?? `Unknown user #${actor.id}`}
											{actor.is_active ? '' : ' (inactive)'}
										</option>
									))}
								</select>
							</Field>
							<Field label="Activity type" htmlFor="lead-audit-activity-type">
								<select
									id="lead-audit-activity-type"
									value={draft.activityType}
									onChange={(event) =>
										onChange({ activityType: event.target.value })
									}
									className={controlClass}
								>
									<option value="">All activity types</option>
									{LEAD_ACTIVITY_TYPES.map((type) => (
										<option key={type} value={type}>
											{type}
										</option>
									))}
									<option value="unknown">Unknown type</option>
								</select>
							</Field>
							<Field label="Outreach outcome" htmlFor="lead-audit-outcome">
								<select
									id="lead-audit-outcome"
									value={draft.outcome}
									onChange={(event) =>
										onChange({ outcome: event.target.value })
									}
									className={controlClass}
								>
									<option value="">All outcomes</option>
									{LEAD_CALL_OUTCOMES.map((outcome) => (
										<option key={outcome} value={outcome}>
											Call: {outcome}
										</option>
									))}
									<option value="email_replied">Email: confirmed reply</option>
									<option value="email_sent">
										Email: sent without confirmed reply
									</option>
									<option value="unknown">Unknown outcome</option>
								</select>
							</Field>
							<Field label="Audit event type" htmlFor="lead-audit-event-type">
								<select
									id="lead-audit-event-type"
									value={draft.eventType}
									onChange={(event) =>
										onChange({ eventType: event.target.value })
									}
									className={controlClass}
								>
									<option value="">All event types</option>
									{LEAD_AUDIT_EVIDENCE_TYPE_OPTIONS.map((event) => (
										<option key={event.value} value={event.value}>
											{event.label}
										</option>
									))}
								</select>
							</Field>
						</div>
						<label className="mt-3 flex items-center gap-2 text-sm text-gray-800">
							<input
								type="checkbox"
								checked={draft.undated}
								onChange={(event) =>
									onChange({ undated: event.target.checked })
								}
							/>
							Inspect undated audit evidence separately
						</label>
					</details>
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center gap-2">
				<button
					type="submit"
					aria-disabled={busy || invalidMessage !== ''}
					className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#64126D] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#52105a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
				>
					<MagnifyingGlassIcon className="h-4 w-4" aria-hidden="true" />
					Apply
				</button>
				<button
					type="button"
					onClick={() => {
						if (!busy) onReset();
					}}
					aria-disabled={busy}
					className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
				>
					<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
					Reset
				</button>
				{actions}
				{busy ? (
					<span className="text-xs text-gray-600" role="status">
						Updating report…
					</span>
				) : null}
				{invalidMessage !== '' ? (
					<span
						id="lead-audit-filter-error"
						className="text-xs font-medium text-red-700"
						role="alert"
					>
						{invalidMessage}
					</span>
				) : null}
			</div>
		</form>
	);
}
