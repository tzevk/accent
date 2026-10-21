'use client';

/**
 * The cost entry and recognition forms of the company expenditure view.
 *
 * Each form is one controlled surface over one cost: record it, correct it,
 * recognize it with an explicit reason, or consume a non-operating balance
 * through a period charge. The forms state what the module records and never
 * decide a financial outcome themselves — the server owns every invariant.
 */

import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import { formatCurrencyIn, formatDate } from '@/lib/format';
import type {
	CostRecordJson,
	PeriodChargeJson,
} from '@/lib/company-expenditure';
import type { NonOperatingItemRow } from './types';
import {
	CHARGE_BASIS_LABELS,
	CURRENCIES,
	NATURE_LABELS,
	NATURE_OPTIONS,
	STATE_LABELS,
	isCostNature,
} from './shared';

interface CostFormProps {
	month: string;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
	}>;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onSubmit: (payload: Record<string, unknown>) => void;
}

/** Entry control for one direct cost. */
export function CostForm({
	month,
	projectOptions,
	submitting,
	error,
	onCancel,
	onSubmit,
}: CostFormProps) {
	const [classification, setClassification] = useState('project');
	const [nature, setNature] = useState('operating');
	const [projectId, setProjectId] = useState('');
	const [sourceReference, setSourceReference] = useState('');
	const [vendor, setVendor] = useState('');
	const [description, setDescription] = useState('');
	const [serviceStart, setServiceStart] = useState('');
	const [serviceEnd, setServiceEnd] = useState('');
	const [billDate, setBillDate] = useState('');
	const [currency, setCurrency] = useState('INR');
	const [reportingCurrencyChoice, setReportingCurrencyChoice] = useState('INR');
	const [conversionRate, setConversionRate] = useState('');
	const [conversionDate, setConversionDate] = useState('');
	const [conversionEvidence, setConversionEvidence] = useState('');
	const [grossAmount, setGrossAmount] = useState('');
	const [taxAmount, setTaxAmount] = useState('');
	const [taxTreatment, setTaxTreatment] = useState('none');
	const [taxEvidence, setTaxEvidence] = useState('');
	const [evidenceReference, setEvidenceReference] = useState('');
	const [submit, setSubmit] = useState(true);

	const projectControlOptions = projectOptions.map((option) => ({
		value: String(option.project_id),
		label: `${option.project_code} — ${option.project_name}`,
	}));

	const buildPayload = (submitForRecognition: boolean) => ({
		category: 'Direct Expense',
		description: description || null,
		vendor_name: vendor || null,
		expense_date: billDate || serviceStart || `${month}-01`,
		cost_classification: classification || null,
		cost_nature: nature,
		project_id:
			classification === 'project' && projectId ? Number(projectId) : null,
		service_period_start: serviceStart || null,
		service_period_end: serviceEnd || serviceStart || null,
		bill_date: billDate || null,
		currency,
		reporting_currency: reportingCurrencyChoice,
		conversion_rate:
			currency === reportingCurrencyChoice ? null : conversionRate || null,
		conversion_date:
			currency === reportingCurrencyChoice ? null : conversionDate || null,
		conversion_evidence_reference:
			currency === reportingCurrencyChoice ? null : conversionEvidence || null,
		gross_amount: grossAmount === '' ? null : Number(grossAmount),
		tax_amount: taxAmount === '' ? 0 : Number(taxAmount),
		tax_treatment: taxTreatment,
		tax_evidence_reference: taxEvidence || null,
		source_reference: sourceReference || null,
		evidence_reference: evidenceReference || null,
		submit: submitForRecognition,
	});

	// Evidence typed for one pair is not evidence for another: clearing it on a
	// pair change keeps the typed rate from being attached to a new currency.
	const changeCurrency = (next: string) => {
		setCurrency(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};
	const changeReportingCurrency = (next: string) => {
		setReportingCurrencyChoice(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<form
				data-testid="cost-form"
				role="dialog"
				aria-modal="true"
				aria-label="Record cost"
				className="mt-8 w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit(buildPayload(submit));
				}}
			>
				<div className="mb-3 flex items-center justify-between">
					<h2 className="text-base font-semibold text-gray-900">Record cost</h2>
					<button
						type="button"
						onClick={onCancel}
						aria-label="Close"
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-4 w-4" />
					</button>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Destination
						</span>
						<select
							aria-label="Classification"
							value={classification}
							onChange={(event) => setClassification(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="project">Project</option>
							<option value="company_overhead">Company Overhead</option>
							<option value="unallocated">Unallocated Cost</option>
							<option value="">Not yet classified</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							What the spend is
						</span>
						<select
							aria-label="Nature"
							value={nature}
							onChange={(event) => setNature(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{NATURE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{classification === 'project' && (
						<div className="text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Project
							</span>
							<SearchableSelect
								options={projectControlOptions}
								value={projectId}
								onChange={(value) => setProjectId(String(value))}
								placeholder="Select project…"
								aria-label="Project"
							/>
						</div>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Source reference
						</span>
						<input
							aria-label="Source reference"
							value={sourceReference}
							onChange={(event) => setSourceReference(event.target.value)}
							placeholder="Invoice or bill number"
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">Vendor</span>
						<input
							aria-label="Vendor"
							value={vendor}
							onChange={(event) => setVendor(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm md:col-span-2">
						<span className="mb-1 block font-medium text-gray-700">
							Description
						</span>
						<input
							aria-label="Description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period start
						</span>
						<input
							type="date"
							aria-label="Service period start"
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
							type="date"
							aria-label="Service period end"
							value={serviceEnd}
							onChange={(event) => setServiceEnd(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Bill date
						</span>
						<input
							type="date"
							aria-label="Bill date"
							value={billDate}
							onChange={(event) => setBillDate(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Currency
						</span>
						<select
							aria-label="Currency"
							value={currency}
							onChange={(event) => changeCurrency(event.target.value)}
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
							Reporting currency
						</span>
						<select
							aria-label="Reporting currency"
							value={reportingCurrencyChoice}
							onChange={(event) => changeReportingCurrency(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					{currency !== reportingCurrencyChoice && (
						<>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion rate
								</span>
								<input
									aria-label="Conversion rate"
									value={conversionRate}
									onChange={(event) => setConversionRate(event.target.value)}
									placeholder={`1 ${currency} in ${reportingCurrencyChoice}`}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion date
								</span>
								<input
									type="date"
									aria-label="Conversion date"
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
									aria-label="Conversion evidence reference"
									value={conversionEvidence}
									onChange={(event) =>
										setConversionEvidence(event.target.value)
									}
									placeholder="Contract, bank advice, or rate source"
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
								/>
							</label>
						</>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Gross amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Gross amount"
							value={grossAmount}
							onChange={(event) => setGrossAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Tax amount"
							value={taxAmount}
							onChange={(event) => setTaxAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax treatment
						</span>
						<select
							aria-label="Tax treatment"
							value={taxTreatment}
							onChange={(event) => setTaxTreatment(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="none">No tax recorded</option>
							<option value="recoverable">Recoverable (with evidence)</option>
							<option value="non_recoverable">Non-recoverable (in cost)</option>
							<option value="unresolved">Unresolved</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax evidence reference
						</span>
						<input
							aria-label="Tax evidence reference"
							value={taxEvidence}
							onChange={(event) => setTaxEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							aria-label="Evidence reference"
							value={evidenceReference}
							onChange={(event) => setEvidenceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>

				<p className="mt-2 text-[11px] text-gray-500">
					Cost is recognized in the month the work or service is received. Leave
					the service period empty only when the bill date is the best available
					evidence — it is recorded as a fallback. An advance, deposit,
					prepayment, or capital item is not expensed by its payment: its
					approved period consumption is captured from the report.
				</p>

				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}

				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						onClick={() => setSubmit(false)}
						disabled={submitting}
						className="rounded-lg border border-[#64126D] px-3 py-2 text-sm font-medium text-[#64126D] hover:bg-[#64126D]/5 disabled:opacity-50"
					>
						Save draft
					</button>
					<button
						type="submit"
						onClick={() => setSubmit(true)}
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Save and submit
					</button>
				</div>
			</form>
		</div>
	);
}

interface CostEditDialogProps {
	record: CostRecordJson;
	projectOptions: Array<{
		project_id: number;
		project_code: string;
		project_name: string;
	}>;
	submitting: boolean;
	error: string | null;
	/** `other_expenses:approve` — the currency pair and its evidence are approval acts. */
	canApprove: boolean;
	onCancel: () => void;
	onSubmit: (patch: Record<string, unknown>) => void;
}

/**
 * Correct an open (draft or pending-evidence) cost through the versioned
 * `update` command: amount, destination, recognition period, tax, and
 * evidence. Without this control a cost recorded with an unknown amount could
 * never be completed — the operator would have to cancel and re-record it.
 * The patch carries the version the queue row was read at, so a concurrent
 * change fails as a version conflict instead of silently overwriting.
 */
export function CostEditDialog({
	record,
	projectOptions,
	submitting,
	error,
	canApprove,
	onCancel,
	onSubmit,
}: CostEditDialogProps) {
	const [classification, setClassification] = useState(
		record.cost_classification ?? ''
	);
	const [nature, setNature] = useState(record.cost_nature ?? 'operating');
	const [projectId, setProjectId] = useState(
		record.project_id === null ? '' : String(record.project_id)
	);
	const [sourceReference, setSourceReference] = useState(
		record.source_reference ?? ''
	);
	const [serviceStart, setServiceStart] = useState(
		record.service_period_start ?? ''
	);
	const [serviceEnd, setServiceEnd] = useState(record.service_period_end ?? '');
	const [billDate, setBillDate] = useState(record.expense_date ?? '');
	// A NULL original currency stays empty: it is unknown, and the operator
	// must choose a real code rather than have INR assumed for them.
	const [currency, setCurrency] = useState(record.currency ?? '');
	const [reportingCurrencyChoice, setReportingCurrencyChoice] = useState(
		record.reporting_currency ?? 'INR'
	);
	const [conversionRate, setConversionRate] = useState(
		record.conversion_rate ?? ''
	);
	const [conversionDate, setConversionDate] = useState(
		record.conversion_date ?? ''
	);
	const [conversionEvidence, setConversionEvidence] = useState(
		record.conversion_evidence_reference ?? ''
	);
	const [grossAmount, setGrossAmount] = useState(
		record.gross_amount === null ? '' : String(record.gross_amount)
	);
	const [taxAmount, setTaxAmount] = useState(
		record.tax_amount === null ? '' : String(record.tax_amount)
	);
	const [taxTreatment, setTaxTreatment] = useState(record.tax_treatment);
	const [taxEvidence, setTaxEvidence] = useState(
		record.tax_evidence_reference ?? ''
	);
	const [evidenceReference, setEvidenceReference] = useState(
		record.evidence_reference ?? ''
	);

	const projectControlOptions = projectOptions.map((option) => ({
		value: String(option.project_id),
		label: `${option.project_code} — ${option.project_name}`,
	}));

	// A stored rate is evidence for the pair it was recorded against. Changing
	// either side clears it here, so the dialog never re-sends an old pair's
	// rate for a new pair; fresh evidence (or none) is the operator's explicit
	// statement, and the server refuses a convertible pair without it.
	const changeCurrency = (next: string) => {
		setCurrency(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};
	const changeReportingCurrency = (next: string) => {
		setReportingCurrencyChoice(next);
		setConversionRate('');
		setConversionDate('');
		setConversionEvidence('');
	};

	const buildPatch = () => ({
		classification: classification || null,
		nature,
		projectId:
			classification === 'project' && projectId ? Number(projectId) : null,
		servicePeriodStart: serviceStart || null,
		servicePeriodEnd: serviceEnd || null,
		billDate: billDate || null,
		currency: currency || null,
		reportingCurrency: reportingCurrencyChoice,
		conversionRate:
			!currency || currency === reportingCurrencyChoice
				? null
				: conversionRate || null,
		conversionDate:
			!currency || currency === reportingCurrencyChoice
				? null
				: conversionDate || null,
		conversionEvidenceReference:
			!currency || currency === reportingCurrencyChoice
				? null
				: conversionEvidence || null,
		grossAmount: grossAmount === '' ? null : Number(grossAmount),
		taxAmount: taxAmount === '' ? null : Number(taxAmount),
		taxTreatment,
		taxEvidenceReference: taxEvidence || null,
		sourceReference: sourceReference || null,
		evidenceReference: evidenceReference || null,
	});

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
			<form
				data-testid="cost-edit-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Correct cost"
				className="mt-8 w-full max-w-3xl rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit(buildPatch());
				}}
			>
				<div className="mb-3 flex items-start justify-between">
					<div>
						<h2 className="text-base font-semibold text-gray-900">
							Correct cost
						</h2>
						<p className="text-xs text-gray-500">
							{record.source_reference ?? record.expense_number} · version{' '}
							{record.financial_version}. Saving applies a versioned `update`
							with its own journal entry.
						</p>
					</div>
					<button
						type="button"
						onClick={onCancel}
						aria-label="Close"
						className="rounded p-1 text-gray-500 hover:bg-gray-100"
					>
						<XMarkIcon className="h-4 w-4" />
					</button>
				</div>

				<div className="grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Destination
						</span>
						<select
							aria-label="Classification"
							value={classification}
							onChange={(event) => setClassification(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="project">Project</option>
							<option value="company_overhead">Company Overhead</option>
							<option value="unallocated">Unallocated Cost</option>
							<option value="">Not yet classified</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							What the spend is
						</span>
						<select
							aria-label="Nature"
							value={nature}
							onChange={(event) => {
								const next = event.target.value;
								if (isCostNature(next)) setNature(next);
							}}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							{NATURE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{classification === 'project' && (
						<div className="text-sm">
							<span className="mb-1 block font-medium text-gray-700">
								Project
							</span>
							<SearchableSelect
								options={projectControlOptions}
								value={projectId}
								onChange={(value) => setProjectId(String(value))}
								placeholder="Select project…"
								aria-label="Project"
							/>
						</div>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Source reference
						</span>
						<input
							aria-label="Source reference"
							value={sourceReference}
							onChange={(event) => setSourceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Currency
						</span>
						<select
							aria-label="Currency"
							value={currency}
							onChange={(event) => changeCurrency(event.target.value)}
							disabled={!canApprove}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
						>
							<option value="">Unknown (not guessed)</option>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Reporting currency
						</span>
						<select
							aria-label="Reporting currency"
							value={reportingCurrencyChoice}
							onChange={(event) => changeReportingCurrency(event.target.value)}
							disabled={!canApprove}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
						>
							{CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</select>
					</label>
					{currency !== '' && currency !== reportingCurrencyChoice && (
						<>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion rate
								</span>
								<input
									aria-label="Conversion rate"
									value={conversionRate}
									onChange={(event) => setConversionRate(event.target.value)}
									disabled={!canApprove}
									placeholder={`1 ${currency} in ${reportingCurrencyChoice}`}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion date
								</span>
								<input
									type="date"
									aria-label="Conversion date"
									value={conversionDate}
									onChange={(event) => setConversionDate(event.target.value)}
									disabled={!canApprove}
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
								/>
							</label>
							<label className="text-sm">
								<span className="mb-1 block font-medium text-gray-700">
									Conversion evidence reference
								</span>
								<input
									aria-label="Conversion evidence reference"
									value={conversionEvidence}
									onChange={(event) =>
										setConversionEvidence(event.target.value)
									}
									disabled={!canApprove}
									placeholder="Contract, bank advice, or rate source"
									className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
								/>
							</label>
						</>
					)}
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Gross amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Gross amount"
							value={grossAmount}
							onChange={(event) => setGrossAmount(event.target.value)}
							placeholder="Leave empty while unknown"
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax amount
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Tax amount"
							value={taxAmount}
							onChange={(event) => setTaxAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Service period start
						</span>
						<input
							type="date"
							aria-label="Service period start"
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
							type="date"
							aria-label="Service period end"
							value={serviceEnd}
							onChange={(event) => setServiceEnd(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Bill date
						</span>
						<input
							type="date"
							aria-label="Bill date"
							value={billDate}
							onChange={(event) => setBillDate(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax treatment
						</span>
						<select
							aria-label="Tax treatment"
							value={taxTreatment}
							onChange={(event) =>
								setTaxTreatment(event.target.value as typeof taxTreatment)
							}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="none">No tax recorded</option>
							<option value="recoverable">Recoverable (with evidence)</option>
							<option value="non_recoverable">Non-recoverable (in cost)</option>
							<option value="unresolved">Unresolved</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Tax evidence reference
						</span>
						<input
							aria-label="Tax evidence reference"
							value={taxEvidence}
							onChange={(event) => setTaxEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							aria-label="Evidence reference"
							value={evidenceReference}
							onChange={(event) => setEvidenceReference(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>

				<p className="mt-2 text-[11px] text-gray-500">
					Saving corrects the cost in place. It cannot change a recognized cost
					— cancel that cost first and record the correction as a new one.
				</p>

				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}

				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Save changes
					</button>
				</div>
			</form>
		</div>
	);
}

interface CommandDialogProps {
	record: CostRecordJson;
	command: 'recognize' | 'reject' | 'cancel';
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}

/** Reasoned confirmation for a recognition command. */
export function CommandDialog({
	record,
	command,
	submitting,
	error,
	onCancel,
	onConfirm,
}: CommandDialogProps) {
	const [reason, setReason] = useState('');
	const label =
		command === 'recognize'
			? 'Recognize expense'
			: command === 'reject'
				? 'Reject expense'
				: 'Cancel expense';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="command-dialog"
				role="dialog"
				aria-modal="true"
				aria-label={label}
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm(reason);
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">{label}</h2>
				<p className="mt-1 text-xs text-gray-600">
					{record.source_reference ?? record.expense_number} ·{' '}
					{STATE_LABELS[record.recognition_state] ?? record.recognition_state} ·
					version {record.financial_version}
				</p>
				<label className="mt-3 block text-sm">
					<span className="mb-1 block font-medium text-gray-700">Reason</span>
					<textarea
						aria-label="Reason"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						rows={3}
						className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						placeholder={
							command === 'recognize'
								? 'Evidence reviewed'
								: 'Why this cost must not be confirmed cost'
						}
					/>
				</label>
				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						{label}
					</button>
				</div>
			</form>
		</div>
	);
}

interface PeriodChargeDialogProps {
	item: NonOperatingItemRow;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onSubmit: (payload: Record<string, unknown>) => void;
}

/**
 * Capture one approved period charge against a non-operating item (#317). The
 * charge's own month decides when it becomes cost, and the item's remaining
 * supported balance is the ceiling the module enforces — the dialog states
 * both so the operator sees why a refusal happens.
 */
export function PeriodChargeDialog({
	item,
	submitting,
	error,
	onCancel,
	onSubmit,
}: PeriodChargeDialogProps) {
	const [period, setPeriod] = useState(
		item.recognition_period?.slice(0, 7) ?? ''
	);
	const [basis, setBasis] = useState('consumption');
	const [amount, setAmount] = useState('');
	const [evidence, setEvidence] = useState('');
	const [note, setNote] = useState('');
	// A missing amount is unknown, never zero.
	const balance =
		item.recognized_amount === null
			? 'unknown'
			: formatCurrencyIn(item.recognized_amount, item.currency);
	const remaining =
		item.remaining_amount === null
			? 'unknown'
			: formatCurrencyIn(item.remaining_amount, item.currency);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="period-charge-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Capture period charge"
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit({
						period,
						basis,
						amount: amount === '' ? null : Number(amount),
						evidence_reference: evidence || null,
						currency: item.currency,
						reason: note || null,
					});
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">
					Capture period charge
				</h2>
				<p className="mt-1 text-xs text-gray-600">
					{item.source_reference ?? item.expense_number} ·{' '}
					{NATURE_LABELS[item.nature] ?? item.nature} · supported balance{' '}
					{balance} · remaining {remaining}
				</p>
				<div className="mt-3 grid gap-3 md:grid-cols-2">
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Charge period
						</span>
						<input
							type="month"
							aria-label="Period"
							value={period}
							onChange={(event) => setPeriod(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">Basis</span>
						<select
							aria-label="Charge basis"
							value={basis}
							onChange={(event) => setBasis(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						>
							<option value="consumption">Consumption</option>
							<option value="depreciation">Depreciation</option>
							<option value="amortization">Amortization</option>
						</select>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Amount ({item.currency})
						</span>
						<input
							type="number"
							step="0.01"
							aria-label="Amount"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm">
						<span className="mb-1 block font-medium text-gray-700">
							Evidence reference
						</span>
						<input
							aria-label="Evidence reference"
							value={evidence}
							onChange={(event) => setEvidence(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
					<label className="text-sm md:col-span-2">
						<span className="mb-1 block font-medium text-gray-700">Note</span>
						<input
							aria-label="Note"
							value={note}
							onChange={(event) => setNote(event.target.value)}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						/>
					</label>
				</div>
				<p className="mt-2 text-[11px] text-gray-500">
					The charge becomes cost in its own month and can never exceed the
					remaining supported balance. A month and basis can hold one approved
					charge; cancel it to correct the entry.
				</p>
				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Save period charge
					</button>
				</div>
			</form>
		</div>
	);
}

interface ChargeCancelDialogProps {
	charge: PeriodChargeJson;
	submitting: boolean;
	error: string | null;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}

/**
 * Cancel an approved period charge. The reason and the version are required:
 * cancellation restores the consumed balance, keeps the charge and its journal
 * as history, and is the supported way to correct a wrong amount or month.
 */
export function ChargeCancelDialog({
	charge,
	submitting,
	error,
	onCancel,
	onConfirm,
}: ChargeCancelDialogProps) {
	const [reason, setReason] = useState('');

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
			<form
				data-testid="charge-cancel-dialog"
				role="dialog"
				aria-modal="true"
				aria-label="Cancel period charge"
				className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl"
				onSubmit={(event) => {
					event.preventDefault();
					onConfirm(reason);
				}}
			>
				<h2 className="text-base font-semibold text-gray-900">
					Cancel period charge
				</h2>
				<p className="mt-1 text-xs text-gray-600">
					{charge.source_expense_number} ·{' '}
					{CHARGE_BASIS_LABELS[charge.basis] ?? charge.basis} ·{' '}
					{formatCurrencyIn(charge.amount, charge.currency)} ·{' '}
					{formatDate(charge.period)} · version {charge.financial_version}
				</p>
				<label className="mt-3 block text-sm">
					<span className="mb-1 block font-medium text-gray-700">Reason</span>
					<textarea
						aria-label="Reason"
						value={reason}
						onChange={(event) => setReason(event.target.value)}
						rows={3}
						className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
						placeholder="Why this consumption must not count"
					/>
				</label>
				{error && (
					<p role="alert" className="mt-2 text-xs text-rose-600">
						{error}
					</p>
				)}
				<div className="mt-3 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
					>
						Close
					</button>
					<button
						type="submit"
						disabled={submitting}
						className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
					>
						Cancel charge
					</button>
				</div>
			</form>
		</div>
	);
}
