'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import type {
	ComponentType,
	ReactNode,
	RefAttributes,
	SelectHTMLAttributes,
} from 'react';
import {
	DocumentTextIcon,
	CheckCircleIcon,
	XCircleIcon,
	PaperAirplaneIcon,
	BanknotesIcon,
	PlusIcon,
	ArrowPathIcon,
	EyeIcon,
	PencilIcon,
	TrashIcon,
	ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
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
import { Input, Select as _Select } from '@/components/ui/form-fields';
import { apiGet, apiDelete } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
import ResourceFormModal from '@/components/admin/ResourceFormModal';
import type {
	ModalMode,
	ApiListResponse,
	FormField,
	StatsConfig,
	StatTone,
	Column,
	Pagination as PaginationType,
} from '@/types/admin';
import OtherExpenseReviewPanel, {
	OtherExpenseReviewDialog,
} from './other-expense-review';

const Select: ComponentType<
	SelectHTMLAttributes<HTMLSelectElement> & RefAttributes<HTMLSelectElement>
> = _Select as unknown as ComponentType<
	SelectHTMLAttributes<HTMLSelectElement> & RefAttributes<HTMLSelectElement>
>;

const PAGE_SIZE = 20;

const STATUS_OPTIONS = [
	{ value: 'all', label: 'All statuses' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
];

const RECOGNITION_OPTIONS = [
	{ value: 'all', label: 'All recognition' },
	{ value: 'draft', label: 'Draft' },
	{ value: 'pending_evidence', label: 'Pending evidence' },
	{ value: 'recognized', label: 'Recognized' },
	{ value: 'rejected', label: 'Rejected cost' },
	{ value: 'cancelled', label: 'Cancelled cost' },
	{ value: 'linked', label: 'Receipt copies' },
];

const CATEGORY_OPTIONS = [
	{ value: 'Office Supplies', label: 'Office Supplies' },
	{ value: 'Repairs & Maintenance', label: 'Repairs & Maintenance' },
	{ value: 'Bank Charges', label: 'Bank Charges' },
	{ value: 'Conveyance', label: 'Conveyance' },
	{ value: 'Printing & Stationery', label: 'Printing & Stationery' },
	{ value: 'Postage & Courier', label: 'Postage & Courier' },
	{ value: 'Telephone / Internet', label: 'Telephone / Internet' },
	{ value: 'Subscription', label: 'Subscription' },
	{ value: 'Training', label: 'Training' },
	{ value: 'Miscellaneous', label: 'Miscellaneous' },
];

const PAYEE_TYPE_OPTIONS = [
	{ value: 'vendor', label: 'Vendor' },
	{ value: 'employee', label: 'Employee' },
];

const CLASSIFICATION_OPTIONS = [
	{ value: '', label: 'Unresolved (needs review)' },
	{ value: 'project', label: 'Project' },
	{ value: 'company_overhead', label: 'Company Overhead' },
	{ value: 'unallocated', label: 'Unallocated Cost' },
];

const TAX_TREATMENT_OPTIONS = [
	{ value: 'unresolved', label: 'Unresolved' },
	{ value: 'none', label: 'None' },
	{ value: 'recoverable', label: 'Recoverable (needs evidence)' },
	{ value: 'non_recoverable', label: 'Non-recoverable' },
];

const RECOGNITION_QUEUE_OPTIONS = [
	{ value: '', label: 'Keep as draft' },
	{ value: 'submitted', label: 'Submit for recognition' },
];

const STATUS_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	submitted: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	rejected: 'bg-rose-100 text-rose-700',
};

const RECOGNITION_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	pending_evidence: 'bg-amber-100 text-amber-800',
	recognized: 'bg-emerald-100 text-emerald-800',
	rejected: 'bg-rose-100 text-rose-700',
	cancelled: 'bg-gray-200 text-gray-700',
	linked: 'bg-violet-100 text-violet-800',
};

const RECOGNITION_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
	linked: 'Receipt copy',
};

const PAYEE_BADGE: Record<string, string> = {
	vendor: 'bg-violet-100 text-violet-700',
	employee: 'bg-cyan-100 text-cyan-700',
};

const STATUS_OPTIONS_FOR_FORM = STATUS_OPTIONS.filter((o) => o.value !== 'all');

const schema = z.object({
	voucher_number: z.string().nullable().optional(),
	voucher_date: z.string().min(1, 'Voucher date is required'),
	expense_category: z.string().min(1, 'Category is required'),
	payee_type: z.enum(['vendor', 'employee']),
	vendor_id: z.coerce.number().int().optional(),
	vendor_name: z.string().nullable().optional(),
	employee_id: z.coerce.number().int().optional(),
	employee_name: z.string().nullable().optional(),
	bill_no: z.string().nullable().optional(),
	bill_date: z.string().nullable().optional(),
	bill_amount: z.coerce.number().min(0, 'Bill amount must be ≥ 0'),
	gst_amount: z.coerce.number().min(0).optional(),
	description: z.string().nullable().optional(),
	status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(),
	// Module fields: where the cost belongs, when it was received, in what
	// currency and with what tax evidence.
	cost_classification: z.string().nullable().optional(),
	project_id: z.coerce.number().int().optional(),
	service_period_start: z.string().nullable().optional(),
	service_period_end: z.string().nullable().optional(),
	currency: z.string().nullable().optional(),
	tax_treatment: z.string().nullable().optional(),
	tax_evidence_reference: z.string().nullable().optional(),
	source_reference: z.string().nullable().optional(),
	evidence_reference: z.string().nullable().optional(),
	receipt_url: z.string().nullable().optional(),
	reporting_currency: z.string().nullable().optional(),
	conversion_rate: z.string().nullable().optional(),
	conversion_date: z.string().nullable().optional(),
	conversion_evidence_reference: z.string().nullable().optional(),
	linked_cost_uid: z.string().nullable().optional(),
	submit: z.string().nullable().optional(),
});

const defaultValues = {
	voucher_number: '',
	voucher_date: new Date().toISOString().split('T')[0],
	expense_category: 'Office Supplies',
	payee_type: 'vendor',
	vendor_name: '',
	vendor_id: undefined,
	employee_name: '',
	employee_id: undefined,
	bill_no: '',
	bill_date: '',
	bill_amount: '',
	gst_amount: '',
	description: '',
	status: 'submitted',
	cost_classification: '',
	project_id: '',
	service_period_start: '',
	service_period_end: '',
	currency: 'INR',
	tax_treatment: 'unresolved',
	tax_evidence_reference: '',
	source_reference: '',
	evidence_reference: '',
	receipt_url: '',
	reporting_currency: '',
	conversion_rate: '',
	conversion_date: '',
	conversion_evidence_reference: '',
	linked_cost_uid: '',
	submit: '',
};

/**
 * Financial fields the versioned cost commands own. The register edit form
 * shows them read-only and never posts them: the PUT route refuses them, so a
 * register edit cannot change cost without a version, a reason, and a journal
 * entry. Recording a new entry through this page still sends them.
 */
const FINANCIAL_FIELDS: Record<string, true> = {
	bill_date: true,
	bill_amount: true,
	gst_amount: true,
	currency: true,
	project_id: true,
	cost_classification: true,
	service_period_start: true,
	service_period_end: true,
	tax_treatment: true,
	tax_evidence_reference: true,
	source_reference: true,
	evidence_reference: true,
	receipt_url: true,
	linked_cost_uid: true,
	submit: true,
};

/** Drop the command-owned fields from an edit payload (create keeps them). */
function stripFinancialFields(
	values: Record<string, unknown>
): Record<string, unknown> {
	const payload: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		if (FINANCIAL_FIELDS[key] || key === 'sr_no') continue;
		if (value === '') continue;
		payload[key] = value;
	}
	return payload;
}

/**
 * The create payload: the whole register plus the module's financial fields,
 * with blank optionals absent rather than sent as empty strings (a missing
 * amount stays unknown, it never becomes a recorded zero).
 */
function toCreatePayload(
	values: Record<string, unknown>
): Record<string, unknown> {
	const payload: Record<string, unknown> = { ...values };
	delete payload.sr_no;
	if (payload.payee_type === 'vendor') {
		delete payload.employee_name;
		delete payload.employee_id;
	}
	if (payload.payee_type === 'employee') {
		delete payload.vendor_name;
		delete payload.vendor_id;
	}
	payload.submit = values.submit === 'submitted';
	for (const [key, value] of Object.entries(payload)) {
		if (value === '') payload[key] = null;
	}
	return payload;
}

const formFields: FormField[] = [
	{
		name: 'voucher_number',
		label: 'Voucher #',
		hint: 'Auto-generated if blank',
	},
	{
		name: 'voucher_date',
		label: 'Voucher Date',
		type: 'date',
		required: true,
	},
	{
		name: 'expense_category',
		label: 'Expense Category',
		type: 'select',
		required: true,
		options: CATEGORY_OPTIONS,
	},
	{
		name: 'payee_type',
		label: 'Payee Type',
		type: 'select',
		required: true,
		options: PAYEE_TYPE_OPTIONS,
	},
	{
		name: 'vendor_name',
		label: 'Vendor',
		vendorAutofill: true,
		dependentOn: {
			field: 'payee_type',
			values: ['vendor'],
			clearFields: ['vendor_id'],
		},
	},
	{
		name: 'employee_name',
		label: 'Employee',
		employeeAutofill: true,
		dependentOn: {
			field: 'payee_type',
			values: ['employee'],
			clearFields: ['employee_id'],
		},
	},
	{ name: 'bill_no', label: 'Bill No.' },
	{ name: 'bill_date', label: 'Bill Date', type: 'date' },
	{
		name: 'bill_amount',
		label: 'Bill Amount',
		type: 'number',
		step: '0.01',
		required: true,
	},
	{
		name: 'gst_amount',
		label: 'GST / IGST',
		type: 'number',
		step: '0.01',
	},
	{
		name: 'cost_classification',
		label: 'Classification',
		type: 'select',
		options: CLASSIFICATION_OPTIONS,
		hint: 'Project, Company Overhead, or deliberately unresolved',
	},
	{
		name: 'project_id',
		label: 'Project',
		type: 'select',
		options: [],
		hint: 'Required for a Project classification',
	},
	{
		name: 'service_period_start',
		label: 'Service period start',
		type: 'date',
		hint: 'When the goods, work, or services were received',
	},
	{ name: 'service_period_end', label: 'Service period end', type: 'date' },
	{ name: 'currency', label: 'Currency' },
	{
		name: 'tax_treatment',
		label: 'Tax treatment',
		type: 'select',
		options: TAX_TREATMENT_OPTIONS,
	},
	{ name: 'tax_evidence_reference', label: 'Tax evidence reference' },
	{ name: 'source_reference', label: 'Source reference' },
	{ name: 'evidence_reference', label: 'Evidence reference' },
	{ name: 'receipt_url', label: 'Receipt / document link', fullWidth: true },
	{
		name: 'reporting_currency',
		label: 'Reporting currency',
		hint: 'Required with the rate below; the company basis is INR',
	},
	{
		name: 'conversion_rate',
		label: 'Conversion rate',
		hint: 'Original → reporting rate, effective on the conversion date',
	},
	{ name: 'conversion_date', label: 'Conversion date', type: 'date' },
	{
		name: 'conversion_evidence_reference',
		label: 'Conversion evidence reference',
		hint: 'Where the rate is evidenced; the module never invents a rate',
	},
	{
		name: 'linked_cost_uid',
		label: 'Receipt copy of cost id',
		hint: 'Links evidence to an already recognized cost instead of a second expense',
		fullWidth: true,
	},
	{
		name: 'submit',
		label: 'Recognition queue',
		type: 'select',
		options: RECOGNITION_QUEUE_OPTIONS,
	},
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS_FOR_FORM,
	},
	{
		name: 'description',
		label: 'Description',
		type: 'textarea',
		fullWidth: true,
	},
];

const columns: Column[] = [
	{ key: 'sr_no', label: 'Sr. No', headClassName: 'w-16 text-center' },
	{
		key: 'voucher_date',
		label: 'Voucher Date',
		date: true,
		headClassName: 'w-28 text-center',
	},
	{
		key: 'expense_category',
		label: 'Expense Category',
		headClassName: 'w-44 text-center',
	},
	{
		key: 'payee_type',
		label: 'Vendor / Employee',
		headClassName: 'text-center',
		render: (row) => {
			const name: string = String(row.vendor_name || row.employee_name || '');
			const displayName = name || '—';
			const type = (row.payee_type as string) || 'vendor';
			return (
				<span className="inline-flex items-center gap-1.5">
					{displayName}
					<span
						className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${PAYEE_BADGE[type] || PAYEE_BADGE.vendor}`}
					>
						{type === 'employee' ? 'EMP' : 'VND'}
					</span>
				</span>
			);
		},
	},
	{ key: 'bill_no', label: 'Bill No.', headClassName: 'text-center' },
	{
		key: 'net_amount',
		label: 'Net Bill Amount',
		headClassName: 'w-36 text-center',
		cellClassName: 'text-right font-semibold tabular-nums',
		render: (row) =>
			row.net_amount === null || row.net_amount === undefined
				? 'Unknown'
				: formatCurrency(Number(row.net_amount)),
	},
	{
		key: 'recognition_state',
		label: 'Cost state',
		headClassName: 'w-36 text-center',
		render: (row) => {
			const linked = Boolean(row.linked_cost_uid);
			const state = linked ? 'linked' : String(row.recognition_state ?? 'draft');
			return (
				<span
					data-testid="oe-state"
					data-voucher={String(row.voucher_number ?? '')}
					data-state={state}
					className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${RECOGNITION_BADGE[state] ?? RECOGNITION_BADGE.draft}`}
				>
					{RECOGNITION_LABELS[state] ?? state}
				</span>
			);
		},
	},
	{
		key: 'cost_uid',
		label: 'Cost / link',
		headClassName: 'w-48 text-center',
		render: (row) => {
			if (row.linked_cost_uid) {
				return (
					<span className="text-[11px] text-violet-700">
						copy of {String(row.linked_cost_uid)}
					</span>
				);
			}
			return (
				<span className="text-[11px] text-gray-500">
					{row.cost_uid ? String(row.cost_uid) : '—'}
				</span>
			);
		},
	},
	{
		key: 'converted_amount',
		label: 'Reporting amount',
		headClassName: 'w-32 text-center',
		cellClassName: 'text-right tabular-nums',
		render: (row) =>
			row.converted_amount === null || row.converted_amount === undefined
				? '—'
				: formatCurrency(Number(row.converted_amount)),
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-28 text-center',
		render: (row) => {
			const status = (row.status as string) || 'submitted';
			return (
				<span
					className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[status] || STATUS_BADGE.submitted}`}
				>
					{status}
				</span>
			);
		},
	},
];

const statsConfig: StatsConfig[] = [
	{
		key: 'total',
		label: 'Total',
		tone: 'purple',
		icon: DocumentTextIcon,
	},
	{
		key: 'submitted',
		label: 'Submitted',
		tone: 'amber',
		icon: PaperAirplaneIcon,
	},
	{
		key: 'approved',
		label: 'Approved',
		tone: 'sky',
		icon: CheckCircleIcon,
	},
	{
		key: 'rejected',
		label: 'Rejected',
		tone: 'rose',
		icon: XCircleIcon,
	},
	{
		key: 'totalAmount',
		label: 'Total Amount',
		tone: 'purple',
		money: true,
		icon: BanknotesIcon,
	},
	{
		key: 'approvedAmount',
		label: 'Approved',
		tone: 'sky',
		money: true,
	},
];

const TONE_COLOR_MAP: Record<StatTone, string> = {
	purple: 'text-purple-600',
	green: 'text-green-600',
	amber: 'text-amber-600',
	rose: 'text-rose-600',
	sky: 'text-sky-600',
	slate: 'text-slate-600',
	violet: 'text-violet-600',
};

function getNested(
	obj: Record<string, unknown>,
	path: string,
	fallback: unknown
): unknown {
	return (
		path
			?.split('.')
			.reduce(
				(acc: unknown, key: string) =>
					acc == null ? acc : (acc as Record<string, unknown>)[key],
				obj
			) ?? fallback
	);
}

interface ProjectOptionRow {
	project_id: number;
	project_code: string;
	project_title: string | null;
	name: string | null;
}

function OtherExpensesPageInner() {
	const urlSearchParams = useSearchParams();
	const initialSearch = urlSearchParams?.get('search') ?? '';
	const [search, setSearch] = useState(initialSearch);
	const [statusFilter, setStatusFilter] = useState('all');
	const [recognitionFilter, setRecognitionFilter] = useState('all');
	const [page, setPage] = useState(1);
	const [tab, setTab] = useState<'register' | 'review'>('register');
	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });
	const [reviewTarget, setReviewTarget] = useState<{
		id: string;
		voucher: string;
	} | null>(null);

	const listQuery = useQuery<ApiListResponse>({
		queryKey: ['other-expenses', { search, status: statusFilter, recognitionFilter, page }],
		queryFn: () =>
			apiGet('/api/admin/other-expenses', {
				search,
				status: statusFilter,
				recognition_state: recognitionFilter,
				page,
				limit: PAGE_SIZE,
			}),
	});

	const projectsQuery = useQuery<{ data: ProjectOptionRow[] }>({
		queryKey: ['projects-for-expenditure'],
		queryFn: () => apiGet('/api/projects'),
		staleTime: 60_000,
	});
	const projectOptions = (projectsQuery.data?.data ?? []).map((project) => ({
		value: String(project.project_id),
		label: `${project.project_code} — ${project.project_title ?? project.name ?? ''}`,
	}));

	const createFormFields = useMemo(
		() =>
			formFields.map((field) =>
				field.name === 'project_id' ? { ...field, options: projectOptions } : field
			),
		[projectOptions]
	);
	const editFormFields = useMemo(
		() =>
			createFormFields.map((field) =>
				FINANCIAL_FIELDS[field.name]
					? {
							...field,
							disabled: true,
							hint: 'Versioned cost field — change it through Review',
						}
					: field
			),
		[createFormFields]
	);

	const rows = listQuery.data?.data ?? [];
	const pagination: PaginationType = listQuery.data?.pagination ?? {
		page: 1,
		limit: PAGE_SIZE,
		total: 0,
		totalPages: 0,
	};
	const stats: Record<string, number | string | null> =
		listQuery.data?.stats ?? {};

	const openCreate = () => setModalState({ mode: 'create', row: null });
	const openEdit = (row: Record<string, unknown>) =>
		setModalState({ mode: 'edit', row });
	const openView = (row: Record<string, unknown>) =>
		setModalState({ mode: 'view', row });
	const closeModal = () => setModalState({ mode: null, row: null });

	const onDelete = async (row: Record<string, unknown>) => {
		if (
			!window.confirm('Are you sure you want to delete this other expense?')
		) {
			return;
		}
		try {
			await apiDelete(`/api/admin/other-expenses/${row.id}`);
			toast.success('Other expense deleted');
			listQuery.refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Delete failed');
		}
	};

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col pt-2 pb-4 px-2 sm:px-4 overflow-hidden">
				<div className="max-w-full mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5">
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Other Expenses
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Record operating cost against Projects, Company Overhead, or as
								deliberately unresolved, and review receipt copies
							</p>
						</div>
						<div className="flex items-center gap-2">
							<div
								data-testid="other-expense-tabs"
								className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5"
							>
								<button
									type="button"
									data-testid="tab-register"
									onClick={() => setTab('register')}
									className={`rounded-md px-3 py-1 text-sm font-medium ${
										tab === 'register'
											? 'bg-[#64126D] text-white'
											: 'text-gray-600'
									}`}
								>
									Register
								</button>
								<button
									type="button"
									data-testid="tab-review"
									onClick={() => setTab('review')}
									className={`rounded-md px-3 py-1 text-sm font-medium ${
										tab === 'review'
											? 'bg-[#64126D] text-white'
											: 'text-gray-600'
									}`}
								>
									Review
								</button>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => listQuery.refetch()}
								disabled={listQuery.isFetching}
							>
								<ArrowPathIcon
									className={`h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`}
								/>
								Refresh
							</Button>
							<Button size="sm" onClick={openCreate}>
								<PlusIcon className="h-4 w-4" />
								Add Other Expenses
							</Button>
						</div>
					</header>

					{tab === 'review' ? (
						<OtherExpenseReviewPanel
							onOpenEntry={(id, voucher) => setReviewTarget({ id, voucher })}
						/>
					) : (
						<>
							{statsConfig.length > 0 ? (
								<div className="flex gap-4 mb-2 flex-wrap">
									{statsConfig.map((s) => {
										const displayValue = s.money
											? formatCurrency(stats[s.key] ?? 0)
											: (stats[s.key] ?? 0).toLocaleString('en-IN');
										return (
											<div
												key={s.key}
												className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2"
											>
												<div
													className={`text-lg font-bold ${TONE_COLOR_MAP[s.tone] || 'text-gray-900'}`}
												>
													{displayValue}
												</div>
												<div className="text-xs text-gray-600">{s.label}</div>
											</div>
										);
									})}
								</div>
							) : null}

							<div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
								<div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
									<div className="relative flex-1 min-w-[200px] max-w-md">
										<Input
											placeholder="Search by voucher #, bill #, vendor, employee…"
											value={search}
											onChange={(e) => {
												setSearch(e.target.value);
												setPage(1);
											}}
										/>
									</div>
									<Select
										value={statusFilter}
										onChange={(e) => {
											setStatusFilter(e.target.value);
											setPage(1);
										}}
										className="w-40"
									>
										{STATUS_OPTIONS.map((o) => (
											<option key={o.value} value={o.value}>
												{o.label}
											</option>
										))}
									</Select>
									<Select
										value={recognitionFilter}
										onChange={(e) => {
											setRecognitionFilter(e.target.value);
											setPage(1);
										}}
										className="w-48"
									>
										{RECOGNITION_OPTIONS.map((o) => (
											<option key={o.value} value={o.value}>
												{o.label}
											</option>
										))}
									</Select>
								</div>

								<div className="flex-1 min-h-0 overflow-auto">
									<Table>
										<TableHeader>
											<TableRow className="sticky top-0 z-10 bg-white">
												{columns.map((c) => (
													<TableHead key={c.key} className={c.headClassName}>
														{c.label}
													</TableHead>
												))}
												<TableHead className="text-center">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{listQuery.isLoading ? (
												<TableEmpty>Loading…</TableEmpty>
											) : rows.length === 0 ? (
												<TableEmpty>No records found.</TableEmpty>
											) : (
												rows.map((row) => (
													<TableRow key={row.id as string}>
														{columns.map((c) => {
															const value = getNested(row, c.key, '');
															let display: ReactNode = value as ReactNode;
															if (c.money)
																display = formatCurrency(value as number);
															else if (c.date)
																display = formatDate(value as string);
															else if (c.render) display = c.render(row);
															return (
																<TableCell
																	key={c.key}
																	className={c.cellClassName}
																>
																	{display ?? '—'}
																</TableCell>
															);
														})}
														<TableCell className="text-center">
															<div
																data-testid="oe-row"
																data-voucher={String(row.voucher_number ?? '')}
																className="inline-flex items-center gap-1"
															>
																<button
																	onClick={() => openView(row)}
																	className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
																	title="View"
																>
																	<EyeIcon className="h-4 w-4" />
																</button>
																<button
																	onClick={() => openEdit(row)}
																	className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
																	title="Edit"
																>
																	<PencilIcon className="h-4 w-4" />
																</button>
																<button
																	data-testid="oe-row-review"
																	onClick={() =>
																		setReviewTarget({
																			id: String(row.id),
																			voucher: String(row.voucher_number ?? ''),
																		})
																	}
																	className="p-1.5 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
																	title="Review"
																>
																	<ClipboardDocumentCheckIcon className="h-4 w-4" />
																</button>
																<button
																	onClick={() => onDelete(row)}
																	className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
																	title="Delete"
																>
																	<TrashIcon className="h-4 w-4" />
																</button>
															</div>
														</TableCell>
													</TableRow>
												))
											)}
										</TableBody>
									</Table>
								</div>
								<div className="border-t border-gray-100 px-4">
									<Pagination
										page={pagination.page}
										totalPages={pagination.totalPages}
										total={pagination.total}
										onPageChange={setPage}
									/>
								</div>
							</div>
						</>
					)}
				</div>
			</div>

			{modalState.mode ? (
				<ResourceFormModal
					mode={modalState.mode}
					row={modalState.row}
					title="Other Expenses"
					endpoint="/api/admin/other-expenses"
					defaultValues={defaultValues}
					zodSchema={schema}
					formFields={
						modalState.mode === 'edit' ? editFormFields : createFormFields
					}
					transformSubmit={
						modalState.mode === 'edit' ? stripFinancialFields : toCreatePayload
					}
					vendorListEndpoint="/api/vendors"
					employeeListEndpoint="/api/employees/list"
					onClose={closeModal}
					onSaved={() => {
						closeModal();
						listQuery.refetch();
					}}
				/>
			) : null}

			{reviewTarget ? (
				<OtherExpenseReviewDialog
					id={reviewTarget.id}
					voucher={reviewTarget.voucher}
					onClose={() => setReviewTarget(null)}
					onSaved={() => listQuery.refetch()}
				/>
			) : null}
		</div>
	);
}

export default function OtherExpensesPage() {
	return (
		<Suspense fallback={null}>
			<OtherExpensesPageInner />
		</Suspense>
	);
}
