'use client';

/**
 * The Project cost allocation revisions of the company expenditure view
 * (#309, ADR-0016).
 *
 * It shows a Payroll Slip's allocation history and lets an authorized reader
 * revise a finalized allocation: the recorded employer cost and the hours
 * each Project carries. Every revision is versioned and reasoned, and the
 * panel states what changed and why.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { XMarkIcon } from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate, formatNumber } from '@/lib/format';
import type { PayrollEmployeeRow, PayrollShareRow } from './types';
import { errorMessage } from './shared';

/* ── Project Cost Allocation Revisions (#309, ADR-0016) ───────────── */

interface AllocationHistoryVersion {
	version: number;
	kind: string;
	allocation_uid: string;
	recorded_employer_cost: number;
	total_logged_hours: number;
	project_hours: number;
	no_project_hours: number;
	rounding_adjustment: number;
	frozen_at: string;
	frozen_by: number | null;
	actor_name: string | null;
	command: string | null;
	reason: string | null;
	evidence_reference: string | null;
	journal_at: string | null;
	superseded_by: number | null;
	reconciles: boolean;
	shares: PayrollShareRow[];
}

interface AllocationHistoryPayload {
	payroll_slip_id: number;
	month: string;
	employee_code: string;
	selected_version: number;
	versions: AllocationHistoryVersion[];
}

const ALLOCATION_KIND_LABELS: Record<string, string> = {
	finalization: 'Finalized',
	reconstruction: 'Reconstructed',
	revision: 'Revised',
};

/**
 * The revision history of one frozen allocation plus the authorized
 * correction control: the selected version, every prior version with its
 * actor, reason, evidence, and old/new figures, and the dialog that appends
 * the next immutable version through the versioned command API.
 */
export function AllocationRevisionPanel({
	slipId,
	employee,
	projectOptions,
	currency,
	canRevise,
}: {
	slipId: number;
	employee: PayrollEmployeeRow;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	currency: string;
	canRevise: boolean;
}) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const historyQuery = useQuery<{ data: AllocationHistoryPayload }>({
		queryKey: ['payroll-allocation-history', slipId],
		queryFn: () =>
			apiGet('/api/reports/company-monthly-cost/payroll/revisions', {
				payroll_slip_id: slipId,
			}),
		refetchOnWindowFocus: false,
		staleTime: 0,
	});
	const history = historyQuery.data?.data;
	const versions = history?.versions ?? [];
	const selected = versions.find(
		(version) => version.version === history?.selected_version
	);

	const destinationRows = (selected?.shares ?? [])
		.filter((share) => share.basis !== 'no_logged_hours')
		.map((share) => ({
			projectId: share.project_id === null ? '' : String(share.project_id),
			hours: String(share.hours),
		}))
		.sort((a, b) => {
			if (a.projectId === b.projectId) return 0;
			if (a.projectId === '') return 1;
			if (b.projectId === '') return -1;
			return Number(a.projectId) - Number(b.projectId);
		});

	return (
		<div
			data-testid="payroll-allocation-history"
			className="mt-2 rounded border border-gray-200 bg-white"
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-2 py-1.5">
				<p className="text-xs font-semibold text-gray-700">
					Allocation history — Slip #{slipId}
					{history ? ` · selected v${history.selected_version}` : ''}
				</p>
				{canRevise && selected && (
					<button
						type="button"
						data-testid="payroll-revise-open"
						onClick={() => setDialogOpen(true)}
						className="rounded bg-[#64126D] px-2 py-1 text-xs font-medium text-white hover:bg-[#52105a]"
					>
						Revise allocation
					</button>
				)}
			</div>
			{historyQuery.isLoading && (
				<p className="px-2 py-2 text-xs text-gray-500">
					Loading allocation history…
				</p>
			)}
			{historyQuery.isError && (
				<p className="px-2 py-2 text-xs text-rose-600">
					{errorMessage(historyQuery.error)}
				</p>
			)}
			{!historyQuery.isLoading && !historyQuery.isError && (
				<div className="overflow-x-auto">
					<table className="w-full text-xs">
						<thead>
							<tr className="text-left text-gray-500">
								<th className="py-1 pl-2 pr-3 font-medium">Version</th>
								<th className="py-1 pr-3 font-medium">Kind</th>
								<th className="py-1 pr-3 font-medium">Actor</th>
								<th className="py-1 pr-3 font-medium">Frozen</th>
								<th className="py-1 pr-3 font-medium">Reason</th>
								<th className="py-1 pr-3 font-medium">Evidence</th>
								<th className="py-1 pr-3 font-medium">Destinations</th>
								<th className="py-1 pr-2 font-medium">State</th>
							</tr>
						</thead>
						<tbody>
							{versions.map((version) => (
								<tr
									key={version.version}
									data-testid="payroll-history-version"
									data-version={String(version.version)}
									data-kind={version.kind}
									data-selected={
										version.version === history?.selected_version
											? 'true'
											: 'false'
									}
									className="border-t border-gray-100 align-top"
								>
									<td className="py-1 pl-2 pr-3 tabular-nums text-gray-800">
										v{version.version}
									</td>
									<td className="py-1 pr-3 text-gray-700">
										{ALLOCATION_KIND_LABELS[version.kind] ?? version.kind}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{version.actor_name ?? '—'}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{formatDate(version.frozen_at)}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{version.reason ?? '—'}
									</td>
									<td className="py-1 pr-3 text-gray-600">
										{version.evidence_reference ?? '—'}
									</td>
									<td className="py-1 pr-3 text-gray-700">
										{version.shares
											.map(
												(share) =>
													`${
														share.project_id === null
															? share.basis === 'no_project'
																? 'No project'
																: 'No logged hours'
															: share.project_code
													} ${formatNumber(share.hours)}h → ${formatCurrencyIn(
														share.amount,
														currency
													)}`
											)
											.join(' · ')}
									</td>
									<td className="py-1 pr-2">
										{version.version === history?.selected_version ? (
											<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">
												Selected
											</span>
										) : (
											<span className="text-gray-500">
												Superseded by v{version.superseded_by}
											</span>
										)}
										{!version.reconciles && (
											<span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-rose-900">
												Unreconciled
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{dialogOpen && selected && history && (
				<ReviseAllocationDialog
					slipId={slipId}
					employeeCode={employee.employee_code}
					projectOptions={projectOptions}
					currency={currency}
					expectedVersion={history.selected_version}
					recordedEmployerCost={selected.recorded_employer_cost}
					destinations={destinationRows}
					onClose={() => setDialogOpen(false)}
				/>
			)}
		</div>
	);
}

/**
 * The authorized correction: corrected monthly Logged Hours per destination
 * plus the required reason and evidence, submitted with the version the
 * operator saw. A stale version or a refused command surfaces inline and
 * changes nothing.
 */
export function ReviseAllocationDialog({
	slipId,
	employeeCode,
	projectOptions,
	currency,
	expectedVersion,
	recordedEmployerCost,
	destinations,
	onClose,
}: {
	slipId: number;
	employeeCode: string;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
		client_name: string | null;
	}>;
	currency: string;
	expectedVersion: number;
	recordedEmployerCost: number;
	destinations: Array<{ projectId: string; hours: string }>;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const [rows, setRows] = useState(destinations);
	const [reason, setReason] = useState('');
	const [evidence, setEvidence] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	const used = new Set(rows.map((row) => row.projectId));
	const addable = projectOptions.filter(
		(option) => !used.has(String(option.project_id))
	);

	const submit = async () => {
		setError(null);
		if (!reason.trim()) {
			setError('A reason is required for an allocation revision');
			return;
		}
		if (!evidence.trim()) {
			setError('An evidence reference is required for an allocation revision');
			return;
		}
		const lines: Array<{ project_id: number | null; hours: number }> = [];
		for (const row of rows) {
			if (row.hours.trim() === '') continue;
			const hours = Number(row.hours);
			if (!Number.isFinite(hours) || hours <= 0) {
				setError(
					'Every destination states positive hours; remove destinations that have none'
				);
				return;
			}
			lines.push({
				project_id: row.projectId === '' ? null : Number(row.projectId),
				hours,
			});
		}
		setSubmitting(true);
		try {
			await apiPost('/api/reports/company-monthly-cost/payroll/revisions', {
				payroll_slip_id: slipId,
				expected_version: expectedVersion,
				reason,
				evidence_reference: evidence,
				lines,
			});
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ['payroll-allocation-history', slipId],
				}),
				queryClient.invalidateQueries({ queryKey: ['expenditure-payroll'] }),
				queryClient.invalidateQueries({ queryKey: ['expenditure'] }),
			]);
			onClose();
		} catch (submitError) {
			setError(errorMessage(submitError));
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			data-testid="payroll-revise-dialog"
			data-expected-version={String(expectedVersion)}
			className="border-t border-gray-200 bg-gray-50/70 px-2 py-2"
		>
			<p className="mb-1 text-xs font-semibold text-gray-700">
				Revise allocation for {employeeCode} — recorded employer cost{' '}
				{formatCurrencyIn(recordedEmployerCost, currency)}, expected version v
				{expectedVersion}
			</p>
			<p className="mb-2 text-[11px] text-gray-500">
				State the corrected monthly hours per destination. The recorded employer
				cost does not change; the corrected shares are appended as the next
				version.
			</p>
			{rows.map((row, index) => (
				<div
					key={`${row.projectId}-${index}`}
					className="mb-1 flex items-center gap-2"
				>
					<SearchableSelect
						options={[
							{ value: '', label: 'No project' },
							...projectOptions.map((option) => ({
								value: String(option.project_id),
								label: `${option.project_code} — ${option.project_name}`,
							})),
						]}
						value={row.projectId}
						onChange={(value) =>
							setRows((prev) =>
								prev.map((entry, entryIndex) =>
									entryIndex === index ? { ...entry, projectId: value } : entry
								)
							)
						}
						placeholder="Destination"
					/>
					<input
						data-testid="payroll-revise-hours"
						aria-label={`Hours for destination ${index + 1}`}
						type="number"
						min="0"
						step="0.01"
						value={row.hours}
						onChange={(event) =>
							setRows((prev) =>
								prev.map((entry, entryIndex) =>
									entryIndex === index
										? { ...entry, hours: event.target.value }
										: entry
								)
							)
						}
						className="w-28 rounded border border-gray-300 px-2 py-1 text-xs"
					/>
					<button
						type="button"
						aria-label={`Remove destination ${index + 1}`}
						onClick={() =>
							setRows((prev) =>
								prev.filter((_, entryIndex) => entryIndex !== index)
							)
						}
						className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-3.5 w-3.5" />
					</button>
				</div>
			))}
			<div className="mb-2 flex items-center gap-2">
				<SearchableSelect
					options={[
						{ value: '', label: 'Add destination…' },
						...addable.map((option) => ({
							value: String(option.project_id),
							label: `${option.project_code} — ${option.project_name}`,
						})),
					]}
					value=""
					onChange={(value) => {
						if (value === '') return;
						setRows((prev) => {
							const next = [...prev, { projectId: value, hours: '' }];
							next.sort((a, b) => {
								if (a.projectId === b.projectId) return 0;
								if (a.projectId === '') return 1;
								if (b.projectId === '') return -1;
								return Number(a.projectId) - Number(b.projectId);
							});
							return next;
						});
					}}
					placeholder="Add destination"
				/>
			</div>
			<div className="mb-1 flex flex-wrap items-center gap-2">
				<input
					data-testid="payroll-revise-reason"
					aria-label="Revision reason"
					type="text"
					value={reason}
					onChange={(event) => setReason(event.target.value)}
					placeholder="Reason (required)"
					className="w-72 rounded border border-gray-300 px-2 py-1 text-xs"
				/>
				<input
					data-testid="payroll-revise-evidence"
					aria-label="Revision evidence"
					type="text"
					value={evidence}
					onChange={(event) => setEvidence(event.target.value)}
					placeholder="Evidence reference (required)"
					className="w-72 rounded border border-gray-300 px-2 py-1 text-xs"
				/>
			</div>
			{error && (
				<p
					data-testid="payroll-revise-error"
					className="mb-1 text-xs text-rose-600"
				>
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onClose}
					className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
				>
					Close
				</button>
				<button
					type="button"
					data-testid="payroll-revise-submit"
					disabled={submitting}
					onClick={submit}
					className="rounded-lg bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
				>
					{submitting ? 'Revising…' : 'Apply revision'}
				</button>
			</div>
		</div>
	);
}
