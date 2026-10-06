'use client';

/**
 * Supplier invoice recognition dialog (#311).
 *
 * The one control that changes a supplier invoice's financial fields and moves
 * it through the recognition states: destination (Project, Company Overhead,
 * Unallocated Cost, or explicitly unresolved), received-work service period
 * slices, currency, tax treatment with its evidence, and the command buttons
 * (Save, Submit, Recognize, Reject, Cancel) that carry the version they expect.
 *
 * It also shows the preserved payable mappings: confirmed links to this cost,
 * and text candidates awaiting a document-backed decision (confirm/reject).
 * None of them creates another cost.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { XMarkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface SplitRowState {
	key: string;
	service_period_start: string;
	service_period_end: string;
	amount: string;
	tax_amount: string;
	note: string;
}

interface RecognitionDetail {
	id: number;
	invoice_number: string;
	vendor_name: string | null;
	cost_uid: string | null;
	recognition_state: string;
	financial_version: number;
	cost_classification: string | null;
	project_id: number | null;
	service_period_start: string | null;
	service_period_end: string | null;
	recognition_period: string | null;
	period_basis: string | null;
	currency: string;
	total: number | string | null;
	tax_amount: number | string | null;
	withholding_tax_amount: number | string;
	tax_treatment: string;
	tax_evidence_reference: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	recognized_amount: number | string | null;
	reporting_currency: string | null;
	conversion_rate: string | null;
	conversion_date: string | null;
	conversion_evidence_reference: string | null;
	converted_amount: number | string | null;
	splits: Array<{
		id: number;
		service_period_start: string | null;
		service_period_end: string;
		recognition_period: string;
		amount: number | string;
		tax_amount: number | string;
		recognized_amount: number | string | null;
		note: string | null;
	}>;
	links: Array<{
		cost_uid: string;
		source_table: string;
		source_id: string;
		role: string;
		basis: string;
		review_state: string;
		evidence_reference: string | null;
	}>;
	link_candidates: Array<{
		source_table: string;
		source_id: string;
		reference_number: string;
		vendor_name: string;
		vendor_invoice_number: string | null;
		invoice_amount: number | string | null;
		match_basis: string;
	}>;
}

interface ProjectOption {
	project_id: number;
	project_code: string;
	project_name: string;
}

const STATE_LABEL: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

const STATE_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	pending_evidence: 'bg-amber-100 text-amber-700',
	recognized: 'bg-emerald-100 text-emerald-700',
	rejected: 'bg-rose-100 text-rose-700',
	cancelled: 'bg-gray-100 text-gray-500',
};

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
const CLASSIFICATIONS = [
	{ value: '', label: 'Not yet classified (unresolved)' },
	{ value: 'project', label: 'Project' },
	{ value: 'company_overhead', label: 'Company Overhead' },
	{ value: 'unallocated', label: 'Unallocated Cost' },
];

let splitKeySeed = 0;
function nextSplitKey(): string {
	splitKeySeed += 1;
	return `split-${splitKeySeed}`;
}

export default function SupplierRecognitionDialog({
	invoiceId,
	invoiceNumber,
	onClose,
	onChanged,
}: {
	invoiceId: number;
	invoiceNumber: string;
	onClose: () => void;
	onChanged: () => void;
}) {
	const detailQuery = useQuery<{ success: boolean; data: RecognitionDetail }>({
		queryKey: ['purchase-invoice-recognition', invoiceId],
		queryFn: () => apiGet(`/api/admin/purchase-invoices/${invoiceId}`),
	});
	const optionsQuery = useQuery<{ success: boolean; data: ProjectOption[] }>({
		queryKey: ['purchase-invoice-options'],
		queryFn: () => apiGet('/api/admin/purchase-invoices/options'),
	});
	const detail = detailQuery.data?.data;
	const projects = optionsQuery.data?.data ?? [];

	const [classification, setClassification] = useState('');
	const [projectId, setProjectId] = useState('');
	const [serviceStart, setServiceStart] = useState('');
	const [serviceEnd, setServiceEnd] = useState('');
	const [currency, setCurrency] = useState('INR');
	const [taxTreatment, setTaxTreatment] = useState('unresolved');
	const [taxEvidence, setTaxEvidence] = useState('');
	const [sourceReference, setSourceReference] = useState('');
	const [evidenceReference, setEvidenceReference] = useState('');
	const [withholding, setWithholding] = useState('');
	const [reportingCurrency, setReportingCurrency] = useState('');
	const [conversionRate, setConversionRate] = useState('');
	const [conversionDate, setConversionDate] = useState('');
	const [conversionEvidence, setConversionEvidence] = useState('');
	const [splits, setSplits] = useState<SplitRowState[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [reasonAction, setReasonAction] = useState<
		'reject' | 'cancel' | null
	>(null);
	const [reason, setReason] = useState('');

	useEffect(() => {
		if (!detail) return;
		setClassification(detail.cost_classification ?? '');
		setProjectId(detail.project_id === null ? '' : String(detail.project_id));
		setServiceStart(detail.service_period_start ?? '');
		setServiceEnd(detail.service_period_end ?? '');
		setCurrency(detail.currency || 'INR');
		setTaxTreatment(detail.tax_treatment || 'unresolved');
		setTaxEvidence(detail.tax_evidence_reference ?? '');
		setSourceReference(detail.source_reference ?? '');
		setEvidenceReference(detail.evidence_reference ?? '');
		setWithholding(
			detail.withholding_tax_amount === null ||
				detail.withholding_tax_amount === undefined
				? ''
				: String(detail.withholding_tax_amount)
		);
		setReportingCurrency(detail.reporting_currency ?? '');
		setConversionRate(detail.conversion_rate ?? '');
		setConversionDate(detail.conversion_date ?? '');
		setConversionEvidence(detail.conversion_evidence_reference ?? '');
		setSplits(
			(detail.splits ?? []).map((split) => ({
				key: nextSplitKey(),
				service_period_start: split.service_period_start ?? '',
				service_period_end: split.service_period_end ?? '',
				amount: String(split.amount ?? ''),
				tax_amount: String(split.tax_amount ?? ''),
				note: split.note ?? '',
			}))
		);
	}, [detail]);

	const refresh = async () => {
		await detailQuery.refetch();
		onChanged();
	};

	const commandMutation = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			apiPost(`/api/admin/purchase-invoices/${invoiceId}/commands`, payload),
		onSuccess: async () => {
			setError(null);
			setReasonAction(null);
			setReason('');
			await refresh();
		},
		onError: (err: Error) => setError(err.message),
	});

	const linkMutation = useMutation({
		mutationFn: (payload: Record<string, unknown>) =>
			apiPost(`/api/admin/purchase-invoices/${invoiceId}/links`, payload),
		onSuccess: async () => {
			setError(null);
			toast.success('Supplier link updated');
			await refresh();
		},
		onError: (err: Error) => setError(err.message),
	});

	if (!detail || !detailQuery.data) {
		return (
			<div
				data-testid="supplier-recognition-dialog"
				role="dialog"
				aria-modal="true"
				className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
			>
				<div className="mt-8 w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl">
					Loading…
				</div>
			</div>
		);
	}

	const gross = detail.total === null ? null : Number(detail.total);
	const splitSum = splits.reduce(
		(total, split) => total + (Number(split.amount) || 0),
		0
	);
	const splitMismatch =
		splits.length > 0 && gross !== null && Math.abs(splitSum - gross) > 0.004;

	const patchPayload = () => ({
		patch: {
			cost_classification: classification === '' ? null : classification,
			project_id:
				classification === 'project' && projectId ? Number(projectId) : null,
			service_period_start: serviceStart || null,
			service_period_end: serviceEnd || null,
			currency,
			tax_treatment: taxTreatment,
			tax_evidence_reference: taxEvidence || null,
			source_reference: sourceReference || null,
			evidence_reference: evidenceReference || null,
			withholding_tax_amount: withholding === '' ? 0 : Number(withholding),
			reporting_currency: reportingCurrency === '' ? null : reportingCurrency,
			conversion_rate:
				conversionRate === '' ? null : conversionRate,
			conversion_date: conversionDate === '' ? null : conversionDate,
			conversion_evidence_reference:
				conversionEvidence === '' ? null : conversionEvidence,
			splits: splits.map((split) => ({
				service_period_start: split.service_period_start || null,
				service_period_end: split.service_period_end || null,
				amount: Number(split.amount) || 0,
				tax_amount: Number(split.tax_amount) || 0,
				note: split.note || null,
			})),
		},
	});

	const run = (
		command: 'update' | 'submit' | 'recognize',
		extra: Record<string, unknown> = {}
	) =>
		commandMutation.mutate({
			command,
			expected_version: detail.financial_version,
			...(command === 'update' ? patchPayload() : {}),
			...extra,
		});

	const updateSplit = (key: string, field: keyof SplitRowState, value: string) =>
		setSplits((rows) =>
			rows.map((row) => (row.key === key ? { ...row, [field]: value } : row))
		);

	return (
		<div
			data-testid="supplier-recognition-dialog"
			role="dialog"
			aria-modal="true"
			aria-label={`Supplier invoice recognition ${invoiceNumber}`}
			className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
		>
			<div className="mt-6 w-full max-w-4xl rounded-xl bg-white p-4 shadow-xl">
				<div className="mb-3 flex items-start justify-between gap-3">
					<div>
						<h2 className="text-base font-semibold text-gray-900">
							Supplier cost recognition — {detail.invoice_number}
						</h2>
						<p className="text-xs text-gray-500">
							{detail.vendor_name ?? ''} · cost identity{' '}
							<span className="font-mono">{detail.cost_uid ?? '—'}</span> · v
							{detail.financial_version}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<span
							data-testid="recognition-state"
							className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_BADGE[detail.recognition_state] ?? STATE_BADGE.draft}`}
						>
							{STATE_LABEL[detail.recognition_state] ?? detail.recognition_state}
						</span>
						<button
							type="button"
							onClick={onClose}
							data-testid="recognition-close"
							aria-label="Close"
							className="rounded p-1 text-gray-500 hover:bg-gray-100"
						>
							<XMarkIcon className="h-4 w-4" />
						</button>
					</div>
				</div>

				{error ? (
					<p
						data-testid="recognition-error"
						role="alert"
						className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
					>
						{error}
					</p>
				) : null}

				<div className="mb-3 grid gap-3 md:grid-cols-4">
					<div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
						<div className="text-[11px] font-semibold text-gray-500">
							Invoice gross (liability)
						</div>
						<div className="text-sm font-semibold text-gray-900">
							{gross === null ? 'Unknown' : formatCurrency(gross)}
						</div>
					</div>
					<div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
						<div className="text-[11px] font-semibold text-gray-500">
							Recognized cost
						</div>
						<div
							data-testid="recognition-recognized-amount"
							data-amount={
								detail.recognized_amount === null ||
								detail.recognized_amount === undefined
									? ''
									: String(Number(detail.recognized_amount))
							}
							className="text-sm font-semibold text-gray-900"
						>
							{detail.recognized_amount === null ||
							detail.recognized_amount === undefined
								? 'Not recognized'
								: formatCurrency(Number(detail.recognized_amount))}
						</div>
					</div>
					<div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
						<div className="text-[11px] font-semibold text-gray-500">
							Recognition period
						</div>
						<div className="text-sm text-gray-900">
							{detail.recognition_period
								? `${formatDate(detail.recognition_period)} · ${detail.period_basis ?? ''}`
								: 'Unresolved'}
						</div>
					</div>
					<div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
						<div className="text-[11px] font-semibold text-gray-500">
							Converted amount
						</div>
						<div
							data-testid="recognition-converted-amount"
							data-amount={
								detail.converted_amount === null ||
								detail.converted_amount === undefined
									? ''
									: String(Number(detail.converted_amount))
							}
							className="text-sm font-semibold text-gray-900"
						>
							{detail.converted_amount === null ||
							detail.converted_amount === undefined
								? 'Unsupported'
								: `${detail.reporting_currency ?? 'INR'} ${formatCurrency(Number(detail.converted_amount))}`}
						</div>
					</div>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Destination
						</span>
						<select
							data-testid="recognition-classification"
							value={classification}
							onChange={(event) => setClassification(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{CLASSIFICATIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{classification === 'project' ? (
						<label className="text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Project
							</span>
							<select
								data-testid="recognition-project"
								value={projectId}
								onChange={(event) => setProjectId(event.target.value)}
								className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
							>
								<option value="">Select project…</option>
								{projects.map((project) => (
									<option
										key={project.project_id}
										value={String(project.project_id)}
									>
										{project.project_code} — {project.project_name}
									</option>
								))}
							</select>
						</label>
					) : null}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period start
						</span>
						<input
							data-testid="recognition-service-start"
							type="date"
							value={serviceStart}
							onChange={(event) => setServiceStart(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period end
						</span>
						<input
							data-testid="recognition-service-end"
							type="date"
							value={serviceEnd}
							onChange={(event) => setServiceEnd(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Currency
						</span>
						<select
							data-testid="recognition-currency"
							value={currency}
							onChange={(event) => setCurrency(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax treatment
						</span>
						<select
							data-testid="recognition-tax-treatment"
							value={taxTreatment}
							onChange={(event) => setTaxTreatment(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="none">No tax</option>
							<option value="recoverable">Recoverable</option>
							<option value="non_recoverable">Non-recoverable</option>
							<option value="unresolved">Unresolved</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax evidence reference
						</span>
						<input
							data-testid="recognition-tax-evidence"
							type="text"
							value={taxEvidence}
							onChange={(event) => setTaxEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Supplier document number
						</span>
						<input
							data-testid="recognition-source-reference"
							type="text"
							value={sourceReference}
							onChange={(event) => setSourceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							data-testid="recognition-evidence-reference"
							type="text"
							value={evidenceReference}
							onChange={(event) => setEvidenceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Withholding tax (TDS)
						</span>
						<input
							data-testid="recognition-withholding"
							type="number"
							step="0.01"
							value={withholding}
							onChange={(event) => setWithholding(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Reporting currency
						</span>
						<select
							data-testid="recognition-reporting-currency"
							value={reportingCurrency}
							onChange={(event) => setReportingCurrency(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="">Company default</option>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Conversion rate
						</span>
						<input
							data-testid="recognition-conversion-rate"
							type="number"
							step="0.0000000001"
							value={conversionRate}
							onChange={(event) => setConversionRate(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Conversion rate date
						</span>
						<input
							data-testid="recognition-conversion-date"
							type="date"
							value={conversionDate}
							onChange={(event) => setConversionDate(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Conversion evidence reference
						</span>
						<input
							data-testid="recognition-conversion-evidence"
							type="text"
							value={conversionEvidence}
							onChange={(event) => setConversionEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>

				<div className="mt-4">
					<div className="mb-2 flex items-center justify-between">
						<h3 className="text-sm font-semibold text-gray-800">
							Service-period slices
						</h3>
						<div className="flex items-center gap-3 text-xs text-gray-600">
							<span>
								Sum:{' '}
								<span data-testid="split-sum" data-amount={String(splitSum)}>
									{formatCurrency(splitSum)}
								</span>
							</span>
							<span>
								Invoice:{' '}
								<span data-testid="split-total">
									{gross === null ? 'Unknown' : formatCurrency(gross)}
								</span>
							</span>
							{splitMismatch ? (
								<span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">
									Slices do not total the invoice
								</span>
							) : null}
							<Button
								variant="outline"
								size="sm"
								data-testid="split-add"
								onClick={() =>
									setSplits((rows) => [
										...rows,
										{
											key: nextSplitKey(),
											service_period_start: '',
											service_period_end: '',
											amount: '',
											tax_amount: '',
											note: '',
										},
									])
								}
							>
								<PlusIcon className="h-4 w-4" />
								Add period
							</Button>
						</div>
					</div>
					{splits.length === 0 ? (
						<p className="text-xs text-gray-500">
							Single period: the invoice's own service period applies. Add
							slices when one invoice covers several months.
						</p>
					) : (
						<div className="space-y-2">
							{splits.map((split, index) => (
								<div
									key={split.key}
									data-testid="split-row"
									className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 p-2 md:grid-cols-6"
								>
									<input
										data-testid="split-start"
										type="date"
										aria-label={`Slice ${index + 1} start`}
										value={split.service_period_start}
										onChange={(event) =>
											updateSplit(
												split.key,
												'service_period_start',
												event.target.value
											)
										}
										className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
									/>
									<input
										data-testid="split-end"
										type="date"
										aria-label={`Slice ${index + 1} end`}
										value={split.service_period_end}
										onChange={(event) =>
											updateSplit(
												split.key,
												'service_period_end',
												event.target.value
											)
										}
										className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
									/>
									<input
										data-testid="split-amount"
										type="number"
										step="0.01"
										aria-label={`Slice ${index + 1} amount`}
										value={split.amount}
										onChange={(event) =>
											updateSplit(split.key, 'amount', event.target.value)
										}
										className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
									/>
									<input
										data-testid="split-tax"
										type="number"
										step="0.01"
										aria-label={`Slice ${index + 1} tax`}
										value={split.tax_amount}
										onChange={(event) =>
											updateSplit(split.key, 'tax_amount', event.target.value)
										}
										className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
									/>
									<input
										data-testid="split-note"
										type="text"
										aria-label={`Slice ${index + 1} note`}
										placeholder="Note"
										value={split.note}
										onChange={(event) =>
											updateSplit(split.key, 'note', event.target.value)
										}
										className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
									/>
									<button
										type="button"
										data-testid="split-remove"
										aria-label={`Remove slice ${index + 1}`}
										onClick={() =>
											setSplits((rows) =>
												rows.filter((row) => row.key !== split.key)
											)
										}
										className="justify-self-end rounded p-1 text-gray-500 hover:bg-rose-50 hover:text-rose-600"
									>
										<TrashIcon className="h-4 w-4" />
									</button>
								</div>
							))}
						</div>
					)}
				</div>

				<div className="mt-4">
					<h3 className="text-sm font-semibold text-gray-800">
						Source links
					</h3>
					<p className="mb-2 text-xs text-gray-500">
						Payables and receipts that reference this cost. A link tracks the
						one cost; it never becomes another expense.
					</p>
					<div className="space-y-1">
						{detail.links.filter((link) => link.role !== 'cost').length === 0 ? (
							<p className="text-xs text-gray-400">No linked follow-ups yet.</p>
						) : (
							detail.links
								.filter((link) => link.role !== 'cost')
								.map((link) => (
									<div
										key={`${link.source_table}-${link.source_id}-${link.role}`}
										data-testid="link-row"
										className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-1.5 text-xs"
									>
										<span>
											{link.source_table} #{link.source_id} · {link.role} ·{' '}
											{link.basis} ·{' '}
											<span
												className={
													link.review_state === 'confirmed'
														? 'text-emerald-700'
														: 'text-amber-700'
												}
											>
												{link.review_state}
											</span>
										</span>
									</div>
								))
						)}
						{detail.link_candidates.map((candidate) => (
							<div
								key={`${candidate.source_table}-${candidate.source_id}`}
								data-testid="link-candidate"
								className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs"
							>
								<span>
									{candidate.reference_number} · {candidate.vendor_name} ·{' '}
									{formatCurrency(
										candidate.invoice_amount === null
											? null
											: Number(candidate.invoice_amount)
									)}{' '}
									· references {candidate.vendor_invoice_number} (
									{candidate.match_basis})
								</span>
								<span className="flex items-center gap-2">
									<Button
										size="sm"
										data-testid={`link-confirm-${candidate.source_id}`}
										loading={linkMutation.isPending}
										onClick={() =>
											linkMutation.mutate({
												action: 'confirm',
												source_table: 'payment_payables',
												source_id: Number(candidate.source_id),
												evidence_reference:
													candidate.vendor_invoice_number ?? null,
											})
										}
									>
										Link to this cost
									</Button>
									<Button
										variant="outline"
										size="sm"
										data-testid={`link-reject-${candidate.source_id}`}
										onClick={() =>
											linkMutation.mutate({
												action: 'reject',
												source_table: 'payment_payables',
												source_id: Number(candidate.source_id),
												reason: 'Not the same supplier document',
											})
										}
									>
										Reject
									</Button>
								</span>
							</div>
						))}
					</div>
				</div>

				<div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3">
					<span className="mr-auto text-xs text-gray-500">
						Commands carry version {detail.financial_version}.
					</span>
					<Button
						variant="outline"
						size="sm"
						data-testid="recognition-save"
						loading={commandMutation.isPending}
						onClick={() => run('update')}
					>
						Save
					</Button>
					<Button
						variant="outline"
						size="sm"
						data-testid="recognition-submit"
						loading={commandMutation.isPending}
						onClick={() => run('submit')}
					>
						Submit
					</Button>
					<Button
						size="sm"
						data-testid="recognition-recognize"
						loading={commandMutation.isPending}
						className="border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
						onClick={() => run('recognize')}
					>
						Recognize
					</Button>
					<Button
						variant="outline"
						size="sm"
						data-testid="recognition-reject"
						onClick={() => {
							setReason('');
							setReasonAction('reject');
						}}
					>
						Reject
					</Button>
					<Button
						variant="outline"
						size="sm"
						data-testid="recognition-cancel"
						onClick={() => {
							setReason('');
							setReasonAction('cancel');
						}}
					>
						Cancel cost
					</Button>
				</div>

				{reasonAction ? (
					<div
						role="dialog"
						aria-modal="true"
						data-testid="command-dialog"
						className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
					>
						<label className="text-xs font-semibold text-gray-700">
							Reason for {reasonAction}
							<textarea
								data-testid="command-reason"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								rows={2}
								className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
							/>
						</label>
						<div className="mt-2 flex justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setReasonAction(null)}
							>
								Back
							</Button>
							<Button
								size="sm"
								data-testid="command-confirm"
								loading={commandMutation.isPending}
								onClick={() =>
									commandMutation.mutate({
										command: reasonAction,
										expected_version: detail.financial_version,
										reason,
									})
								}
							>
								{reasonAction === 'reject' ? 'Reject cost' : 'Cancel cost'}
							</Button>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
