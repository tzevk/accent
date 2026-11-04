'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	ExclamationTriangleIcon,
	LockClosedIcon,
	ShieldCheckIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import { leadAuditGet } from '../api';
import { formatDateTime } from '@/lib/format';
import type {
	LeadAuditDeletedEvidenceRow,
	LeadAuditDeletedEvidenceSection,
	LeadAuditEvidenceNarrative,
	LeadAuditEvidenceRow,
	LeadAuditEvidenceSection,
	LeadAuditEvidenceType,
} from '@/server/reports/lead-audit/audit-types';

/** The camelCase evidence filters the shared report toolbar owns. */
export interface AuditEvidenceDrillDownPatch {
	actor?: string;
	activityType?: string;
	outcome?: string;
	eventType?: string;
	undated?: boolean;
}

interface AuditViewProps {
	report: LeadAuditEvidenceSection;
	/** The applied report query, so a paged evidence read retains filters. */
	appliedQuery?: Record<string, string | undefined>;
	/** Optional drill-down into the global filter draft. */
	onDrillDown?: (patch: AuditEvidenceDrillDownPatch) => void;
}

interface AuditEnvelope {
	success: boolean;
	data?: LeadAuditEvidenceSection;
	error?: string;
}

interface DeletedEnvelope {
	success: boolean;
	data?: LeadAuditDeletedEvidenceSection;
	error?: string;
}

interface NarrativeEnvelope {
	success: boolean;
	data?: LeadAuditEvidenceNarrative;
	error?: string;
}

function displayTime(value: string | null): string {
	if (!value) return 'Unknown';
	return formatDateTime(value);
}

function displayOccurrence(row: LeadAuditEvidenceRow): string {
	return row.occurred_at
		? displayTime(row.occurred_at)
		: 'Undated — occurrence unknown';
}

function actorText(row: LeadAuditEvidenceRow): string {
	if (row.actor.is_unknown) {
		return row.actor.name
			? `${row.actor.name} (no account reference)`
			: 'Unknown actor';
	}
	return row.actor.name ?? `User #${row.actor.id}`;
}

function NarrativeDetail({
	narrative,
	loading,
	error,
	onClose,
}: {
	narrative: LeadAuditEvidenceNarrative | null;
	loading: boolean;
	error: string;
	onClose: () => void;
}) {
	if (loading) {
		return (
			<div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
				<ArrowPathIcon
					className="h-4 w-4 motion-safe:animate-spin text-[#64126D]"
					aria-hidden="true"
				/>
				Loading narrative evidence…
			</div>
		);
	}
	if (error !== '') {
		return (
			<div
				className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
				role="alert"
			>
				<p className="text-sm font-semibold text-red-900">
					Narrative evidence could not be loaded.
				</p>
				<p className="mt-0.5 text-sm text-red-800">{error}</p>
			</div>
		);
	}
	if (!narrative) return null;

	return (
		<div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
			<div className="flex items-start justify-between gap-2">
				<div>
					<h4 className="text-sm font-bold text-gray-900">
						{narrative.summary}
					</h4>
					<p className="text-xs text-gray-600">
						Reference {narrative.reference} · Lead{' '}
						{narrative.lead.lead_id ?? `#${narrative.lead.id}`} ·{' '}
						{narrative.lead.company_name}
					</p>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					aria-label="Close narrative evidence"
				>
					<XMarkIcon className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>
			<dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
				<div>
					<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
						Actor
					</dt>
					<dd className="text-gray-900">
						{narrative.actor.is_unknown
							? (narrative.actor.name ?? 'Unknown actor')
							: (narrative.actor.name ?? 'Unknown name')}
					</dd>
				</div>
				<div>
					<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
						Recorded
					</dt>
					<dd className="text-gray-900">
						{displayTime(narrative.recorded_at)}
					</dd>
				</div>
				<div>
					<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
						Occurred
					</dt>
					<dd className="text-gray-900">
						{narrative.occurred_at
							? displayTime(narrative.occurred_at)
							: 'Undated — occurrence unknown'}
					</dd>
				</div>
			</dl>
			{narrative.fields.length > 0 ? (
				<dl className="mt-3 divide-y divide-gray-100 rounded-md border border-gray-100">
					{narrative.fields.map((field) => (
						<div
							key={field.key}
							className="grid grid-cols-1 gap-1 px-2 py-1.5 sm:grid-cols-3"
						>
							<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
								{field.label}
							</dt>
							<dd className="whitespace-pre-wrap break-words text-sm text-gray-900 sm:col-span-2">
								{field.value === null ? 'Not recorded' : field.value}
							</dd>
						</div>
					))}
				</dl>
			) : null}
			{narrative.changes.length > 0 ? (
				<div
					className="mt-3 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					role="region"
					tabIndex={0}
					aria-label="Correction changes. Scroll horizontally for more columns."
				>
					<table className="min-w-[32rem] w-full border-collapse text-sm">
						<caption className="pb-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
							Correction changes
						</caption>
						<thead>
							<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Field
								</th>
								<th scope="col" className="py-1.5 pr-2 font-semibold">
									Before
								</th>
								<th scope="col" className="py-1.5 font-semibold">
									After
								</th>
							</tr>
						</thead>
						<tbody>
							{narrative.changes.map((change) => (
								<tr
									key={change.field}
									className="border-b border-gray-50 align-top"
								>
									<th
										scope="row"
										className="py-1.5 pr-2 text-left font-medium text-gray-800"
									>
										{change.label}
									</th>
									<td className="whitespace-pre-wrap break-words py-1.5 pr-2 text-gray-700">
										{change.from}
									</td>
									<td className="whitespace-pre-wrap break-words py-1.5 text-gray-900">
										{change.to}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
			{narrative.deletion ? (
				<div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
					<p className="font-semibold">Retained deleted evidence</p>
					<p>{narrative.deletion.note}</p>
				</div>
			) : null}
			<ul className="mt-2 space-y-1 text-xs text-gray-600">
				{narrative.disclosures.map((disclosure) => (
					<li key={disclosure.code}>{disclosure.text}</li>
				))}
			</ul>
		</div>
	);
}

function EvidenceTable({
	rows,
	onInspect,
	inspected,
	narrative,
	narrativeLoading,
	narrativeError,
	onCloseNarrative,
	emptyText,
	loading,
}: {
	rows: LeadAuditEvidenceRow[];
	onInspect: (row: LeadAuditEvidenceRow, trigger: HTMLButtonElement) => void;
	inspected: string;
	narrative: LeadAuditEvidenceNarrative | null;
	narrativeLoading: boolean;
	narrativeError: string;
	onCloseNarrative: () => void;
	emptyText: string;
	loading: boolean;
}) {
	if (rows.length === 0) {
		if (loading) {
			return (
				<p
					className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600"
					role="status"
				>
					Loading evidence page…
				</p>
			);
		}
		return (
			<p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
				{emptyText}
			</p>
		);
	}
	return (
		<div
			className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
			role="region"
			tabIndex={0}
			aria-label="Audit evidence table. Scroll horizontally for more columns."
		>
			<table className="min-w-[64rem] w-full border-collapse text-sm">
				<caption className="pb-2 text-left text-xs text-gray-600">
					Mixed evidence in recording-time order. Ties are ordered by evidence
					type and id.
				</caption>
				<thead>
					<tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-600">
						<th scope="col" className="py-2 pr-3 font-semibold">
							Evidence
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Lead
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Actor
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Recorded
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Occurred
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Evidence detail
						</th>
						<th scope="col" className="py-2 font-semibold">
							Narrative
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.reference}
							className="border-b border-gray-100 align-top"
						>
							<th scope="row" className="py-2 pr-3 text-left">
								<span className="block font-semibold text-gray-900">
									{row.evidence_type}
								</span>
								<span className="block text-xs text-gray-600">
									{row.reference}
								</span>
								{row.legacy ? (
									<span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
										Legacy or unknown evidence
									</span>
								) : null}
							</th>
							<td className="py-2 pr-3">
								<span className="block font-medium text-gray-900">
									{row.lead.company_name}
								</span>
								<span className="block text-xs text-gray-600">
									{row.lead.lead_id ?? `Lead #${row.lead.id}`}
								</span>
							</td>
							<td className="py-2 pr-3 text-gray-800">{actorText(row)}</td>
							<td className="whitespace-nowrap py-2 pr-3 tabular-nums text-gray-800">
								{displayTime(row.recorded_at)}
							</td>
							<td className="py-2 pr-3 text-gray-800">
								{displayOccurrence(row)}
							</td>
							<td className="py-2 pr-3 text-gray-800">
								<span className="block">{row.summary}</span>
								{row.change_fields.length > 0 ? (
									<span className="block text-xs text-gray-600">
										Changed:{' '}
										{row.change_fields.map((field) => field.label).join(', ')}
									</span>
								) : null}
								{row.downstream ? (
									<span className="mt-1 flex items-center gap-1 text-xs text-gray-600">
										<LockClosedIcon
											className="h-3.5 w-3.5"
											aria-hidden="true"
										/>
										{row.downstream.proposal_state === 'restricted'
											? 'Proposal details restricted'
											: row.downstream.proposal_state === 'available'
												? 'Proposal details available'
												: row.downstream.proposal_state === 'unresolved'
													? 'Canonical Proposal unresolved'
													: 'No Proposal recorded'}
									</span>
								) : null}
								<button
									type="button"
									onClick={(event) => onInspect(row, event.currentTarget)}
									className="mt-1 inline-flex h-7 items-center rounded-md border border-gray-300 bg-white px-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
								>
									Inspect evidence
								</button>
								{inspected === row.reference ? (
									<NarrativeDetail
										narrative={narrative}
										loading={narrativeLoading}
										error={narrativeError}
										onClose={onCloseNarrative}
									/>
								) : null}
							</td>
							<td className="py-2 text-gray-700">
								{row.has_narrative
									? 'Notes or reason recorded'
									: 'Structured only'}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function DeletedTable({
	rows,
	onInspect,
	inspected,
	narrative,
	narrativeLoading,
	narrativeError,
	onCloseNarrative,
	loading,
}: {
	rows: LeadAuditDeletedEvidenceRow[];
	onInspect: (
		row: LeadAuditDeletedEvidenceRow,
		trigger: HTMLButtonElement
	) => void;
	inspected: string;
	narrative: LeadAuditEvidenceNarrative | null;
	narrativeLoading: boolean;
	narrativeError: string;
	onCloseNarrative: () => void;
	loading: boolean;
}) {
	if (rows.length === 0) {
		if (loading) {
			return (
				<p
					className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600"
					role="status"
				>
					Loading deleted evidence page…
				</p>
			);
		}
		return (
			<p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
				No retained deleted evidence matches the applied Lead filters.
			</p>
		);
	}
	return (
		<div
			className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
			role="region"
			tabIndex={0}
			aria-label="Retained deleted evidence table. Scroll horizontally for more columns."
		>
			<table className="min-w-[62rem] w-full border-collapse text-sm">
				<caption className="pb-2 text-left text-xs text-gray-600">
					Separate retained deleted-record evidence. It never enters an
					operational total, and the deletion actor and time are unknown.
				</caption>
				<thead>
					<tr className="border-b border-amber-200 text-left text-xs uppercase tracking-wide text-amber-900">
						<th scope="col" className="py-2 pr-3 font-semibold">
							Deleted evidence
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Lead
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Actor
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Recorded
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Occurred
						</th>
						<th scope="col" className="py-2 pr-3 font-semibold">
							Evidence detail
						</th>
						<th scope="col" className="py-2 font-semibold">
							Deleted record
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={`deleted:${row.reference}`}
							className="border-b border-amber-100 align-top"
						>
							<th scope="row" className="py-2 pr-3 text-left">
								<span className="block font-semibold text-gray-900">
									{row.evidence_type}
								</span>
								<span className="block text-xs text-gray-600">
									{row.reference}
								</span>
							</th>
							<td className="py-2 pr-3">
								<span className="block font-medium text-gray-900">
									{row.lead.company_name}
								</span>
								<span className="block text-xs text-gray-600">
									{row.lead.lead_id ?? `Lead #${row.lead.id}`}
								</span>
							</td>
							<td className="py-2 pr-3 text-gray-800">{actorText(row)}</td>
							<td className="whitespace-nowrap py-2 pr-3 tabular-nums text-gray-800">
								{displayTime(row.recorded_at)}
							</td>
							<td className="py-2 pr-3 text-gray-800">
								{displayOccurrence(row)}
							</td>
							<td className="py-2 pr-3 text-gray-800">
								<span className="block">{row.summary}</span>
								<button
									type="button"
									onClick={(event) => onInspect(row, event.currentTarget)}
									className="mt-1 inline-flex h-7 items-center rounded-md border border-amber-300 bg-white px-2 text-xs font-semibold text-amber-900 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
								>
									Inspect deleted evidence
								</button>
								{inspected === row.reference ? (
									<NarrativeDetail
										narrative={narrative}
										loading={narrativeLoading}
										error={narrativeError}
										onClose={onCloseNarrative}
									/>
								) : null}
							</td>
							<td className="py-2 text-amber-900">
								<span className="block text-xs font-semibold">
									{row.deleted_record === 'lead'
										? 'Deleted Lead'
										: 'Deleted activity row'}
								</span>
								<span className="block text-xs">Actor and time unknown</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export default function AuditView({
	report,
	appliedQuery = {},
	onDrillDown,
}: AuditViewProps) {
	const [page, setPage] = useState(1);
	const [deletedPage, setDeletedPage] = useState(1);
	const [inspected, setInspected] = useState('');
	const [narrative, setNarrative] = useState<LeadAuditEvidenceNarrative | null>(
		null
	);
	const [narrativeLoading, setNarrativeLoading] = useState(false);
	const [narrativeError, setNarrativeError] = useState('');
	const narrativeTriggerRef = useRef<HTMLButtonElement | null>(null);

	const appliedKey = JSON.stringify(appliedQuery);

	useEffect(() => {
		setPage(1);
		setDeletedPage(1);
		setInspected('');
		setNarrative(null);
		setNarrativeError('');
	}, [report.scope.from_date, report.scope.to_date, appliedKey]);

	const evidenceQuery = useQuery<AuditEnvelope>({
		queryKey: ['reports', 'lead-audit', 'audit', appliedQuery, page],
		queryFn: () =>
			leadAuditGet('/api/reports/lead-audit/audit', { ...appliedQuery, page }),
		enabled: page > 1,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		retry: false,
	});

	const deletedQuery = useQuery<DeletedEnvelope>({
		queryKey: [
			'reports',
			'lead-audit',
			'audit',
			'deleted',
			appliedQuery,
			deletedPage,
		],
		queryFn: () =>
			leadAuditGet('/api/reports/lead-audit/audit/deleted', {
				...appliedQuery,
				page: deletedPage,
			}),
		enabled: deletedPage > 1,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		retry: false,
	});

	async function inspectEvidence(
		row: LeadAuditEvidenceRow,
		trigger: HTMLButtonElement
	) {
		narrativeTriggerRef.current = trigger;
		setInspected(row.reference);
		setNarrative(null);
		setNarrativeError('');
		setNarrativeLoading(true);
		try {
			const response = await leadAuditGet<NarrativeEnvelope>(
				'/api/reports/lead-audit/audit/narrative',
				{ type: row.evidence_type, id: row.evidence_id }
			);
			if (!response.data) {
				throw new Error('Narrative evidence was not returned.');
			}
			setNarrative(response.data);
		} catch (error) {
			setNarrativeError(
				error instanceof Error
					? error.message
					: 'Narrative evidence could not be loaded.'
			);
		} finally {
			setNarrativeLoading(false);
		}
	}

	function closeNarrative() {
		setInspected('');
		setNarrative(null);
		setNarrativeError('');
		narrativeTriggerRef.current?.focus();
	}

	const currentEvidence =
		page === 1 ? report.evidence : (evidenceQuery.data?.data?.evidence ?? []);
	const currentPagination =
		page === 1
			? report.pagination
			: (evidenceQuery.data?.data?.pagination ?? report.pagination);
	const currentDeleted =
		deletedPage === 1
			? report.deleted
			: (deletedQuery.data?.data ?? report.deleted);
	const filtersActive =
		report.evidence_filters.actor.value !== null ||
		report.evidence_filters.activity_type.value !== null ||
		report.evidence_filters.outcome.value !== null ||
		report.evidence_filters.event_type.value !== null ||
		report.evidence_filters.undated.value;
	const evidencePageLoading = page > 1 && evidenceQuery.isFetching;
	const deletedPageLoading = deletedPage > 1 && deletedQuery.isFetching;

	return (
		<div className="space-y-4">
			<span className="sr-only" role="status">
				{narrativeLoading
					? 'Loading narrative evidence…'
					: narrative
						? 'Narrative evidence loaded.'
						: ''}
			</span>
			<section
				aria-labelledby="lead-audit-audit-summary-heading"
				className="space-y-2"
			>
				<div>
					<h2
						id="lead-audit-audit-summary-heading"
						className="text-lg font-bold text-gray-900"
					>
						Audit evidence
					</h2>
					<p className="text-sm text-gray-600">
						Available activity, stage, ownership, correction, legacy-review, and
						conversion evidence selected by its recording time. This is not a
						complete compliance-grade change log.
					</p>
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					<div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
						<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
							Evidence recorded
						</span>
						<p className="mt-1 text-3xl font-bold tabular-nums text-gray-900">
							{report.summary.evidence_in_period.toLocaleString('en-IN')}
						</p>
						<p className="mt-1 text-xs text-gray-600">
							Recording-time basis; occurrence is shown separately.
						</p>
					</div>
					{report.summary.by_type.map((type) => (
						<button
							key={type.value}
							type="button"
							onClick={() =>
								onDrillDown?.({
									eventType: type.value as LeadAuditEvidenceType,
								})
							}
							className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2"
						>
							<span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
								{type.label}
							</span>
							<p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">
								{type.count.toLocaleString('en-IN')}
							</p>
							<span className="mt-1 inline-block text-xs font-semibold text-[#64126D]">
								Filter this evidence type
							</span>
						</button>
					))}
				</div>
				<div className="flex flex-wrap gap-2 text-sm">
					<button
						type="button"
						onClick={() =>
							onDrillDown?.({ undated: true, eventType: 'activity' })
						}
						className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-amber-950 hover:border-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
					>
						<span className="block text-xs font-semibold uppercase tracking-wide">
							Undated evidence
						</span>
						<span className="block text-lg font-bold tabular-nums">
							{report.summary.undated_evidence.toLocaleString('en-IN')}
						</span>
						<span className="block text-xs">
							Inspect without adding it to dated totals
						</span>
					</button>
					<div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
						<span className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
							Unknown actor
						</span>
						<span className="block text-lg font-bold tabular-nums text-gray-900">
							{report.summary.unknown_actor.toLocaleString('en-IN')}
						</span>
					</div>
				</div>
			</section>

			<section
				aria-labelledby="lead-audit-audit-scope-heading"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<div className="flex items-start gap-2">
					<ShieldCheckIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-[#64126D]"
						aria-hidden="true"
					/>
					<div>
						<h3
							id="lead-audit-audit-scope-heading"
							className="text-base font-bold text-gray-900"
						>
							Applied evidence scope
						</h3>
						<p className="text-sm text-gray-600">
							{report.evidence_filters.date_basis}
						</p>
					</div>
				</div>
				<dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
							Actor
						</dt>
						<dd className="text-gray-900">
							{report.evidence_filters.actor.label}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
							Activity type
						</dt>
						<dd className="text-gray-900">
							{report.evidence_filters.activity_type.label}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
							Outcome
						</dt>
						<dd className="text-gray-900">
							{report.evidence_filters.outcome.label}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
							Event type
						</dt>
						<dd className="text-gray-900">
							{report.evidence_filters.event_type.label}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-gray-600">
							Undated
						</dt>
						<dd className="text-gray-900">
							{report.evidence_filters.undated.label}
						</dd>
					</div>
				</dl>
				{filtersActive ? (
					<p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
						Evidence filters are active. Clearing actor, activity type, outcome,
						event type, and undated restores all available evidence.
					</p>
				) : null}
				<ul className="mt-2 space-y-1 text-xs text-gray-600">
					{report.evidence_filters.ignored.map((entry) => (
						<li key={entry.filter}>
							<span className="font-semibold">{entry.filter}:</span>{' '}
							{entry.reason}
						</li>
					))}
				</ul>
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<div className="flex flex-wrap items-end justify-between gap-2">
					<div>
						<h3 className="text-base font-bold text-gray-900">Evidence rows</h3>
						<p className="text-sm text-gray-600">
							Ordered by recording time, then evidence type and id. Totals cover
							the full filtered result, not just this page.
						</p>
					</div>
					<p className="text-sm tabular-nums text-gray-700">
						{currentPagination.total.toLocaleString('en-IN')} row(s) · page{' '}
						{currentPagination.page} of{' '}
						{Math.max(1, currentPagination.total_pages)}
					</p>
				</div>
				{evidenceQuery.isError ? (
					<div
						className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
						role="alert"
					>
						<div className="flex items-start gap-2">
							<ExclamationTriangleIcon
								className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
								aria-hidden="true"
							/>
							<p className="text-sm text-red-900">
								{evidenceQuery.error instanceof Error
									? evidenceQuery.error.message
									: 'The evidence page could not be loaded.'}
							</p>
						</div>
					</div>
				) : null}
				<EvidenceTable
					rows={currentEvidence}
					onInspect={inspectEvidence}
					inspected={inspected}
					narrative={narrative}
					narrativeLoading={narrativeLoading}
					narrativeError={narrativeError}
					onCloseNarrative={closeNarrative}
					emptyText="No evidence matched the applied filters for this recording period."
					loading={evidencePageLoading}
				/>
				<div className="mt-3 flex items-center justify-between gap-2">
					<button
						type="button"
						onClick={() => {
							if (page <= 1) return;
							setPage((current) => Math.max(1, current - 1));
						}}
						aria-disabled={page <= 1}
						className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					>
						Previous evidence page
					</button>
					<button
						type="button"
						onClick={() => {
							if (
								currentPagination.total_pages === 0 ||
								page >= currentPagination.total_pages
							) {
								return;
							}
							setPage((current) => current + 1);
						}}
						aria-disabled={
							currentPagination.total_pages === 0 ||
							page >= currentPagination.total_pages
						}
						className="inline-flex h-8 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
					>
						Next evidence page
					</button>
				</div>
			</section>

			<section
				aria-labelledby="lead-audit-deleted-heading"
				className="rounded-xl border border-amber-300 bg-amber-50/60 p-4 shadow-sm"
			>
				<div className="flex items-start gap-2">
					<ExclamationTriangleIcon
						className="mt-0.5 h-5 w-5 shrink-0 text-amber-700"
						aria-hidden="true"
					/>
					<div>
						<h3
							id="lead-audit-deleted-heading"
							className="text-base font-bold text-amber-950"
						>
							Retained deleted-record evidence
						</h3>
						<p className="text-sm text-amber-900">
							Separate evidence for soft-deleted Leads and deleted activity
							rows. It stays outside intake, work, cohort, risk, and owner
							totals, and remains readable here because an operational detail
							page may no longer exist.
						</p>
					</div>
				</div>
				<dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-amber-900">
							Deleted Leads
						</dt>
						<dd className="text-lg font-bold tabular-nums text-amber-950">
							{currentDeleted.summary.deleted_leads.toLocaleString('en-IN')}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-amber-900">
							Deleted activity rows
						</dt>
						<dd className="text-lg font-bold tabular-nums text-amber-950">
							{currentDeleted.summary.deleted_activities.toLocaleString(
								'en-IN'
							)}
						</dd>
					</div>
					<div>
						<dt className="text-xs font-semibold uppercase tracking-wide text-amber-900">
							Evidence in view
						</dt>
						<dd className="text-lg font-bold tabular-nums text-amber-950">
							{currentDeleted.summary.evidence_in_view.toLocaleString('en-IN')}
						</dd>
					</div>
				</dl>
				<p className="mt-2 rounded-md border border-amber-200 bg-white p-2 text-sm text-amber-950">
					{currentDeleted.deletion_facts.note}
				</p>
				{deletedQuery.isError ? (
					<div
						className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3"
						role="alert"
					>
						<p className="text-sm text-red-900">
							{deletedQuery.error instanceof Error
								? deletedQuery.error.message
								: 'The retained deleted evidence page could not be loaded.'}
						</p>
					</div>
				) : null}
				<DeletedTable
					rows={currentDeleted.evidence}
					onInspect={inspectEvidence}
					inspected={inspected}
					narrative={narrative}
					narrativeLoading={narrativeLoading}
					narrativeError={narrativeError}
					onCloseNarrative={closeNarrative}
					loading={deletedPageLoading}
				/>
				<div className="mt-3 flex items-center justify-between gap-2">
					<button
						type="button"
						onClick={() => {
							if (deletedPage <= 1) return;
							setDeletedPage((current) => Math.max(1, current - 1));
						}}
						aria-disabled={deletedPage <= 1}
						className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
					>
						Previous deleted page
					</button>
					<p className="text-xs tabular-nums text-amber-900">
						Page {currentDeleted.pagination.page} of{' '}
						{Math.max(1, currentDeleted.pagination.total_pages)} ·{' '}
						{currentDeleted.pagination.total.toLocaleString('en-IN')} row(s)
					</p>
					<button
						type="button"
						onClick={() => {
							if (
								currentDeleted.pagination.total_pages === 0 ||
								deletedPage >= currentDeleted.pagination.total_pages
							) {
								return;
							}
							setDeletedPage((current) => current + 1);
						}}
						aria-disabled={
							currentDeleted.pagination.total_pages === 0 ||
							deletedPage >= currentDeleted.pagination.total_pages
						}
						className="inline-flex h-8 items-center rounded-md border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
					>
						Next deleted page
					</button>
				</div>
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<h3 className="text-base font-bold text-gray-900">
					Audit evidence limits
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
