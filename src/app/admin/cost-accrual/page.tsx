'use client';

/**
 * Cost Accrual — evidenced supplier work received but not yet invoiced.
 *
 * The register lists accruals with their evidence basis, received-work
 * period, destination, amounts, remaining estimate, and owner. Capture creates
 * a draft or pending-evidence row; the recognition dialog is where finance
 * submits, recognizes, and replaces an accrual with supplier invoices.
 * Cancelling a replacement invoice releases the matched amount back to its
 * accrual in the cancel command's own transaction.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Pagination from '@/components/admin/Pagination';
import {
	Table,
	TableHeader,
	TableBody,
	TableHead,
	TableRow,
	TableCell,
	TableEmpty,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-fields';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate } from '@/lib/format';
import AccrualRecognitionDialog from './AccrualRecognitionDialog';

interface AccrualRow {
	id: number;
	accrual_number: string;
	cost_uid: string;
	description: string;
	vendor_name: string | null;
	evidence_basis: string;
	cost_classification: string | null;
	recognition_state: string;
	recognition_period: string | null;
	period_basis: string;
	service_period_start: string | null;
	service_period_end: string | null;
	currency: string;
	gross_amount: number | null;
	tax_amount: number | null;
	tax_treatment: string;
	recognized_amount: number | null;
	replaced_amount: number;
	owner_user_id: number | null;
	financial_version: number;
	project_code: string | null;
	project_name: string | null;
}

interface OwnerOption {
	user_id: number;
	full_name: string | null;
	username: string | null;
}

interface ProjectOption {
	project_id: number;
	project_code: string;
	project_name: string;
}

const STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

const STATE_TONES: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	pending_evidence: 'bg-amber-100 text-amber-800',
	recognized: 'bg-emerald-100 text-emerald-800',
	rejected: 'bg-rose-100 text-rose-700',
	cancelled: 'bg-rose-100 text-rose-700',
};

const EVIDENCE_BASIS_LABELS: Record<string, string> = {
	received_work: 'Received work (evidence)',
	supported_estimate: 'Supported estimate',
	purchase_order: 'PO balance (not evidence)',
};

const PAGE_SIZE = 20;

const EMPTY_CAPTURE = {
	description: '',
	vendorName: '',
	evidenceBasis: 'received_work',
	servicePeriodStart: '',
	servicePeriodEnd: '',
	classification: 'project',
	projectId: '',
	grossAmount: '',
	taxAmount: '',
	taxTreatment: 'none',
	taxEvidence: '',
	currency: 'INR',
	sourceReference: '',
	evidenceReference: '',
	ownerUserId: '',
};

export default function CostAccrualPage() {
	const [search, setSearch] = useState('');
	const [stateFilter, setStateFilter] = useState('');
	const [page, setPage] = useState(1);
	const [captureOpen, setCaptureOpen] = useState(false);
	const [capture, setCapture] = useState({ ...EMPTY_CAPTURE });
	const [saving, setSaving] = useState(false);
	const [dialogId, setDialogId] = useState<number | null>(null);

	const listQuery = useQuery({
		queryKey: ['cost-accruals', search, stateFilter, page],
		queryFn: () =>
			apiGet('/api/admin/cost-accruals', {
				search,
				state: stateFilter || undefined,
				page,
				limit: PAGE_SIZE,
			}),
	});

	const optionsQuery = useQuery({
		queryKey: ['cost-accrual-options'],
		queryFn: () => apiGet('/api/admin/cost-accruals/options'),
	});

	const rows = useMemo(
		() => (listQuery.data?.data ?? []) as AccrualRow[],
		[listQuery.data]
	);
	const pagination = listQuery.data?.pagination as
		| { page: number; limit: number; total: number }
		| undefined;
	const projects = (optionsQuery.data?.data?.projects ?? []) as ProjectOption[];
	const owners = (optionsQuery.data?.data?.owners ?? []) as OwnerOption[];

	async function submitCapture(): Promise<void> {
		setSaving(true);
		try {
			const response = await apiPost('/api/admin/cost-accruals', {
				description: capture.description,
				vendor_name: capture.vendorName || null,
				evidence_basis: capture.evidenceBasis,
				service_period_start: capture.servicePeriodStart || null,
				service_period_end: capture.servicePeriodEnd || null,
				cost_classification: capture.classification || null,
				project_id:
					capture.classification === 'project' && capture.projectId
						? Number(capture.projectId)
						: null,
				gross_amount:
					capture.grossAmount === '' ? null : Number(capture.grossAmount),
				tax_amount: capture.taxAmount === '' ? null : Number(capture.taxAmount),
				tax_treatment: capture.taxTreatment,
				tax_evidence_reference: capture.taxEvidence || null,
				currency: capture.currency || null,
				source_reference: capture.sourceReference || null,
				evidence_reference: capture.evidenceReference || null,
				owner_user_id: capture.ownerUserId ? Number(capture.ownerUserId) : null,
			});
			if (!response.success) {
				toast.error(response.error ?? 'Capture failed');
				return;
			}
			toast.success('Cost accrual captured');
			setCaptureOpen(false);
			setCapture({ ...EMPTY_CAPTURE });
			await listQuery.refetch();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Capture failed');
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex min-h-screen">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col pt-2 pb-4 px-2 sm:px-4 overflow-hidden">
				<div className="max-w-full mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5">
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">Cost Accrual</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Recognize evidenced supplier work already received but not yet
								invoiced, then replace it with partial or final invoices
							</p>
						</div>
						<Button
							data-testid="accrual-capture-open"
							onClick={() => setCaptureOpen(true)}
						>
							New Cost Accrual
						</Button>
					</header>

					<div className="flex flex-wrap items-center gap-2">
						<Input
							data-testid="accrual-search"
							placeholder="Search number, description, vendor…"
							value={search}
							onChange={(event) => {
								setSearch(event.target.value);
								setPage(1);
							}}
							className="max-w-xs"
						/>
						<Select
							data-testid="accrual-state-filter"
							value={stateFilter}
							onChange={(event) => {
								setStateFilter(event.target.value);
								setPage(1);
							}}
							className="max-w-[180px]"
						>
							<option value="">All states</option>
							{Object.entries(STATE_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
					</div>

					<div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Number</TableHead>
									<TableHead>Description</TableHead>
									<TableHead>Evidence</TableHead>
									<TableHead>Period</TableHead>
									<TableHead>Destination</TableHead>
									<TableHead>State</TableHead>
									<TableHead className="text-right">Estimate</TableHead>
									<TableHead className="text-right">Remaining</TableHead>
									<TableHead className="text-right">Replaced</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.length === 0 && (
									<TableEmpty colSpan={10}>
										{listQuery.isLoading
											? 'Loading cost accruals…'
											: 'No cost accruals match the filter.'}
									</TableEmpty>
								)}
								{rows.map((row) => (
									<TableRow key={row.id} data-testid="accrual-row">
										<TableCell className="font-medium">
											{row.accrual_number}
										</TableCell>
										<TableCell className="max-w-[280px]">
											<span className="block truncate" title={row.description}>
												{row.description}
											</span>
											{row.vendor_name && (
												<span className="text-xs text-gray-500">
													{row.vendor_name}
												</span>
											)}
										</TableCell>
										<TableCell className="text-xs">
											{EVIDENCE_BASIS_LABELS[row.evidence_basis] ??
												row.evidence_basis}
										</TableCell>
										<TableCell>{formatDate(row.recognition_period)}</TableCell>
										<TableCell>
											{row.project_code
												? `${row.project_code} — ${row.project_name ?? ''}`
												: (row.cost_classification ?? 'Unresolved')}
										</TableCell>
										<TableCell>
											<span
												className={`rounded px-2 py-0.5 text-xs font-medium ${
													STATE_TONES[row.recognition_state] ??
													'bg-slate-100 text-slate-700'
												}`}
											>
												{STATE_LABELS[row.recognition_state] ??
													row.recognition_state}
											</span>
										</TableCell>
										<TableCell className="text-right">
											{formatCurrencyIn(row.gross_amount, row.currency)}
										</TableCell>
										<TableCell className="text-right font-semibold">
											{formatCurrencyIn(row.recognized_amount, row.currency)}
										</TableCell>
										<TableCell className="text-right">
											{formatCurrencyIn(row.replaced_amount, row.currency)}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="outline"
												size="sm"
												data-testid={`accrual-open-${row.accrual_number}`}
												onClick={() => setDialogId(row.id)}
											>
												Open
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						{pagination && pagination.total > pagination.limit && (
							<div className="border-t border-gray-200 px-3 py-2">
								<Pagination
									page={pagination.page}
									totalPages={Math.max(
										Math.ceil(pagination.total / pagination.limit),
										1
									)}
									total={pagination.total}
									onPageChange={setPage}
								/>
							</div>
						)}
					</div>
				</div>
			</div>

			{captureOpen && (
				<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
					<div
						data-testid="accrual-capture-form"
						className="mt-10 w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl"
					>
						<h2 className="text-lg font-semibold text-gray-900">
							New Cost Accrual
						</h2>
						<p className="mt-0.5 text-sm text-gray-500">
							Only received goods/services with evidence, or an explicitly
							identified supported estimate, become cost. An unused PO balance
							is not evidence.
						</p>
						<div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
							<label className="sm:col-span-2 text-sm">
								<span className="text-gray-700">Description</span>
								<Input
									data-testid="accrual-description"
									value={capture.description}
									onChange={(event) =>
										setCapture({ ...capture, description: event.target.value })
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Vendor</span>
								<Input
									data-testid="accrual-vendor"
									value={capture.vendorName}
									onChange={(event) =>
										setCapture({ ...capture, vendorName: event.target.value })
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Evidence basis</span>
								<Select
									data-testid="accrual-evidence-basis"
									value={capture.evidenceBasis}
									onChange={(event) =>
										setCapture({
											...capture,
											evidenceBasis: event.target.value,
										})
									}
								>
									<option value="received_work">
										Received work (evidence)
									</option>
									<option value="supported_estimate">Supported estimate</option>
								</Select>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Service period start</span>
								<Input
									type="date"
									data-testid="accrual-service-start"
									value={capture.servicePeriodStart}
									onChange={(event) =>
										setCapture({
											...capture,
											servicePeriodStart: event.target.value,
										})
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Service period end</span>
								<Input
									type="date"
									data-testid="accrual-service-end"
									value={capture.servicePeriodEnd}
									onChange={(event) =>
										setCapture({
											...capture,
											servicePeriodEnd: event.target.value,
										})
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Classification</span>
								<Select
									data-testid="accrual-classification"
									value={capture.classification}
									onChange={(event) =>
										setCapture({
											...capture,
											classification: event.target.value,
										})
									}
								>
									<option value="project">Project</option>
									<option value="company_overhead">Company Overhead</option>
									<option value="unallocated">Unallocated Cost</option>
									<option value="">Unresolved</option>
								</Select>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Project</span>
								<Select
									data-testid="accrual-project"
									value={capture.projectId}
									disabled={capture.classification !== 'project'}
									onChange={(event) =>
										setCapture({ ...capture, projectId: event.target.value })
									}
								>
									<option value="">Select a Project…</option>
									{projects.map((project) => (
										<option key={project.project_id} value={project.project_id}>
											{project.project_code} — {project.project_name}
										</option>
									))}
								</Select>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Estimated gross</span>
								<Input
									type="number"
									step="0.01"
									data-testid="accrual-gross"
									value={capture.grossAmount}
									onChange={(event) =>
										setCapture({ ...capture, grossAmount: event.target.value })
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Tax amount</span>
								<Input
									type="number"
									step="0.01"
									data-testid="accrual-tax"
									value={capture.taxAmount}
									onChange={(event) =>
										setCapture({ ...capture, taxAmount: event.target.value })
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Tax treatment</span>
								<Select
									data-testid="accrual-tax-treatment"
									value={capture.taxTreatment}
									onChange={(event) =>
										setCapture({ ...capture, taxTreatment: event.target.value })
									}
								>
									<option value="none">None</option>
									<option value="recoverable">Recoverable (evidenced)</option>
									<option value="non_recoverable">Non-recoverable</option>
									<option value="unresolved">Unresolved</option>
								</Select>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Tax evidence reference</span>
								<Input
									data-testid="accrual-tax-evidence"
									value={capture.taxEvidence}
									onChange={(event) =>
										setCapture({ ...capture, taxEvidence: event.target.value })
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Currency</span>
								<Input
									data-testid="accrual-currency"
									value={capture.currency}
									onChange={(event) =>
										setCapture({ ...capture, currency: event.target.value })
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Source reference</span>
								<Input
									data-testid="accrual-source-reference"
									value={capture.sourceReference}
									onChange={(event) =>
										setCapture({
											...capture,
											sourceReference: event.target.value,
										})
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Evidence reference</span>
								<Input
									data-testid="accrual-evidence-reference"
									value={capture.evidenceReference}
									onChange={(event) =>
										setCapture({
											...capture,
											evidenceReference: event.target.value,
										})
									}
								/>
							</label>
							<label className="text-sm">
								<span className="text-gray-700">Owner</span>
								<Select
									data-testid="accrual-owner"
									value={capture.ownerUserId}
									onChange={(event) =>
										setCapture({ ...capture, ownerUserId: event.target.value })
									}
								>
									<option value="">Me (capturing user)</option>
									{owners.map((owner) => (
										<option key={owner.user_id} value={owner.user_id}>
											{owner.full_name ?? owner.username ?? owner.user_id}
										</option>
									))}
								</Select>
							</label>
						</div>
						<div className="mt-5 flex justify-end gap-2">
							<Button
								variant="outline"
								onClick={() => setCaptureOpen(false)}
								disabled={saving}
							>
								Cancel
							</Button>
							<Button
								data-testid="accrual-capture-submit"
								onClick={submitCapture}
								disabled={saving || capture.description.trim().length === 0}
							>
								{saving ? 'Saving…' : 'Capture'}
							</Button>
						</div>
					</div>
				</div>
			)}

			{dialogId !== null && (
				<AccrualRecognitionDialog
					accrualId={dialogId}
					onClose={() => setDialogId(null)}
					onChanged={() => {
						void listQuery.refetch();
					}}
				/>
			)}
		</div>
	);
}
