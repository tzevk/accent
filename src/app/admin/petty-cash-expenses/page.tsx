'use client';

import { useState, useMemo, useRef, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { z } from 'zod';
import {
	PlusIcon,
	ArrowPathIcon,
	CheckIcon,
	XMarkIcon,
	TrashIcon,
	PencilIcon,
	CheckCircleIcon,
	XCircleIcon,
	BanknotesIcon,
	ArrowDownTrayIcon,
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
	LockClosedIcon,
	ReceiptRefundIcon,
} from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-fields';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
	Table,
	TableHeader,
	TableBody,
	TableHead,
	TableRow,
	TableCell,
	TableEmpty,
} from '@/components/ui/table';

// ── Types ────────────────────────────────────────────────────

interface VoucherBalance {
	id: number;
	voucher_number: string;
	total_amount: number;
	paid_to: string;
	notes: string;
	description: string;
	total_credited: number;
	remaining: number;
}

interface PettyCashCurrencySummary {
	currency: string;
	funding: number;
	funded_spend: number;
	remaining_funding: number;
	recognized_cost: number;
	unconfirmed_spend: number;
}

interface PettyCashSummary {
	currency: string | null;
	funding: number | null;
	spend: number | null;
	remaining_funding: number | null;
	recognized_cost: number | null;
	by_currency: PettyCashCurrencySummary[];
}

interface PettyCashRow {
	id: string;
	entry_kind: 'funding' | 'spend';
	transaction_number: string;
	transaction_date: string;
	description: string | null;
	expense_category: string | null;
	debit_amount: number;
	credit_amount: number;
	running_balance: number;
	payment_mode: string | null;
	status: string;
	recognition_state: 'draft' | 'pending_evidence' | 'recognized' | 'rejected' | 'cancelled';
	financial_version: number;
	cost_classification: 'project' | 'company_overhead' | 'unallocated' | null;
	project_id: number | null;
	recognition_period: string | null;
	service_period_start: string | null;
	service_period_end: string | null;
	bill_date: string | null;
	currency: string | null;
	tax_amount: number | null;
	tax_treatment: string | null;
	tax_evidence_reference: string | null;
	source_reference: string | null;
	evidence_reference: string | null;
	linked_cost_uid: string | null;
	cost_uid: string | null;
	source_voucher_id: number | null;
	source_voucher_number: string | null;
	notes: string | null;
}

interface ApiResponse {
	data: PettyCashRow[];
	stats: Record<string, number | string | null>;
	voucherBalances: VoucherBalance[];
	funding: PettyCashSummary;
}

interface ProjectOption {
	project_id: number;
	project_code: string;
	project_name?: string | null;
	name?: string | null;
}

// ── Constants ────────────────────────────────────────────────

const ENDPOINT = '/api/admin/petty-cash-expenses';

const PAYMENT_MODE_OPTIONS = [
	{ value: 'cash', label: 'Cash' },
	{ value: 'bank', label: 'Bank Transfer' },
	{ value: 'cheque', label: 'Cheque' },
	{ value: 'card', label: 'Card' },
	{ value: 'upi', label: 'UPI' },
	{ value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
	{ value: 'draft', label: 'Draft' },
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
];

const STATUS_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	submitted: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	rejected: 'bg-rose-100 text-rose-700',
};

const CLASSIFICATION_OPTIONS = [
	{ value: '', label: 'Unresolved' },
	{ value: 'project', label: 'Project' },
	{ value: 'company_overhead', label: 'Company Overhead' },
	{ value: 'unallocated', label: 'Unallocated Cost' },
];

const RECOGNITION_STATE_LABELS: Record<string, string> = {
	draft: 'Draft',
	pending_evidence: 'Pending evidence',
	recognized: 'Recognized',
	rejected: 'Rejected',
	cancelled: 'Cancelled',
};

const TAX_TREATMENT_OPTIONS = [
	{ value: 'none', label: 'No tax' },
	{ value: 'recoverable', label: 'Recoverable (with evidence)' },
	{ value: 'non_recoverable', label: 'Non-recoverable' },
	{ value: 'unresolved', label: 'Unresolved' },
];

// ── Schema ───────────────────────────────────────────────────

const schema = z.object({
	transaction_number: z.string().nullable().optional(),
	transaction_date: z.string().min(1, 'Date is required'),
	expense_category: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	debit_amount: z.coerce.number().min(0),
	credit_amount: z.coerce.number().min(0).optional(),
	source_voucher_id: z.coerce.number().nullable().optional(),
	payment_mode: z
		.enum(['cash', 'bank', 'cheque', 'card', 'upi', 'other'])
		.optional(),
	payment_reference: z.string().nullable().optional(),
	recipient_name: z.string().nullable().optional(),
	bill_no: z.string().nullable().optional(),
	bill_date: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	status: z.enum(['draft', 'submitted', 'approved', 'rejected']).optional(),
});

const addDefaults = {
	transaction_date: new Date().toISOString().split('T')[0],
	transaction_number: '',
	expense_category: 'Office Supplies',
	description: '',
	debit_amount: '' as number | string,
	payment_mode: 'cash' as const,
	notes: '',
	status: 'submitted' as const,
	cost_classification: '',
	project_id: '',
	source_voucher_id: '',
	service_period_start: '',
	service_period_end: '',
	bill_date: '',
	currency: 'INR',
	tax_amount: '',
	tax_treatment: 'none',
	source_reference: '',
	evidence_reference: '',
	linked_cost_uid: '',
};

// ── Inline row input styles ──────────────────────────────────

const CELL_INPUT =
	'w-full px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:border-[#64126D] focus:ring-1 focus:ring-purple-200 focus:outline-none';
const SELECT_BUTTON =
	'px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:outline-none';

// ── Column definitions ───────────────────────────────────────

const columns = [
	{ key: 'settlement', label: 'Settlement', className: 'w-24 text-center' },
	{
		key: 'transaction_number',
		label: 'Ref. No.',
		className: 'w-28 text-center',
	},
	{ key: 'transaction_date', label: 'Date', className: 'w-24 text-center' },
	{ key: 'description', label: 'Particulars', className: 'text-center' },
	{ key: 'expense_category', label: 'Category', className: 'w-32 text-center' },
	{ key: 'debit', label: 'Debit', className: 'w-24 text-center' },
	{ key: 'credit', label: 'Credit', className: 'w-24 text-center' },
	{ key: 'running_balance', label: 'Balance', className: 'w-24 text-center' },
	{
		key: 'recognition',
		label: 'Recognition',
		className: 'w-32 text-center',
	},
	{ key: 'status', label: 'Status', className: 'w-20 text-center' },
];

// ── Helpers ──────────────────────────────────────────────────

function formatMoney(val: unknown) {
	if (val === null || val === undefined) return '—';
	const n = Number(val);
	if (!n) return '—';
	return formatCurrency(n);
}

// ── Main Component ───────────────────────────────────────────

export default function PettyCashExpensesPage() {
	const queryClient = useQueryClient();
	const { user, can, loading: authLoading } = useSessionRBAC();

	// ── UI state ──
	const [search, setSearch] = useState('');
	const tableBodyRef = useRef<HTMLDivElement>(null);

	// ── Inline form state ──
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [addForm, setAddForm] = useState<Record<string, unknown>>({
		...addDefaults,
	});
	const [editForm, setEditForm] = useState<Record<string, unknown>>({});

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const canUpdate =
		!!isSuperAdmin || (!!can && can('petty_cash_expenses', 'update'));
	const canApprove =
		!!isSuperAdmin || (!!can && can('petty_cash_expenses', 'approve'));

	// ── Data query ──
	const queryParams = useMemo(
		() => ({
			search: search || undefined,
		}),
		[search]
	);

	const listQuery = useQuery<ApiResponse>({
		queryKey: ['petty-cash-expenses', queryParams],
		queryFn: () => apiGet(ENDPOINT, queryParams),
	});

	const categoriesQuery = useQuery<{ data: Record<string, unknown>[] }>({
		queryKey: ['categories-all'],
		queryFn: () => apiGet('/api/masters/categories'),
	});

	const descriptionsQuery = useQuery<{ data: Record<string, unknown>[] }>({
		queryKey: ['descriptions-all'],
		queryFn: () => apiGet('/api/masters/descriptions'),
	});

	const projectsQuery = useQuery<{ data: ProjectOption[] }>({
		queryKey: ['projects-all'],
		queryFn: () => apiGet('/api/projects'),
	});

	const rows = listQuery.data?.data ?? [];
	const stats: Record<string, number | string | null> =
		listQuery.data?.stats ?? {};
	const funding = listQuery.data?.funding;
	const voucherBalances = listQuery.data?.voucherBalances ?? [];
	const projectOptions = projectsQuery.data?.data ?? [];

	// ── Mutations ──

	const createMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) => apiPost(ENDPOINT, data),
		onSuccess: () => {
			toast.success('Expense created');
			setIsAdding(false);
			setAddForm({ ...addDefaults });
			queryClient.invalidateQueries({ queryKey: ['petty-cash-expenses'] });
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
			apiPut(`${ENDPOINT}/${id}`, data),
		onSuccess: () => {
			toast.success('Entry updated');
			setEditingId(null);
			setEditForm({});
			queryClient.invalidateQueries({ queryKey: ['petty-cash-expenses'] });
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => apiDelete(`${ENDPOINT}/${id}`),
		onSuccess: () => {
			toast.success('Entry deleted');
			queryClient.invalidateQueries({ queryKey: ['petty-cash-expenses'] });
		},
		onError: (err: Error) => toast.error(err.message),
	});

	const commandMutation = useMutation({
		mutationFn: (input: {
			id: string;
			command: string;
			expected_version: number;
			reason?: string;
		}) => apiPost(`${ENDPOINT}/${input.id}/commands`, input),
		onSuccess: (_data, variables) => {
			toast.success(
				`${variables.command === 'recognize' ? 'Recognized' : variables.command === 'submit' ? 'Submitted' : variables.command === 'reject' ? 'Rejected' : 'Cancelled'}`
			);
			queryClient.invalidateQueries({ queryKey: ['petty-cash-expenses'] });
		},
		onError: (err: Error) => toast.error(err.message),
	});

	// ── Handlers ──

	const openAdd = () => {
		setEditingId(null);
		setIsAdding(true);
		setAddForm({
			...addDefaults,
		});
	};

	const cancelAdd = () => {
		setIsAdding(false);
		setAddForm({ ...addDefaults });
	};

	const openEdit = (entry: PettyCashRow) => {
		setIsAdding(false);
		setEditingId(entry.id);
		setEditForm({
			transaction_date: entry.transaction_date || '',
			transaction_number: entry.transaction_number || '',
			expense_category: entry.expense_category || '',
			description: entry.description || '',
			debit_amount: Number(entry.debit_amount ?? 0) || '',
			payment_mode: entry.payment_mode || 'cash',
			notes: entry.notes || '',
			status: entry.status || 'submitted',
			cost_classification: entry.cost_classification || '',
			project_id: entry.project_id ? String(entry.project_id) : '',
			source_voucher_id: entry.source_voucher_id
				? String(entry.source_voucher_id)
				: '',
			service_period_start: entry.service_period_start || '',
			service_period_end: entry.service_period_end || '',
			bill_date: entry.bill_date || '',
			currency: entry.currency || 'INR',
			tax_amount: entry.tax_amount ?? '',
			tax_treatment: entry.tax_treatment || 'none',
			source_reference: entry.source_reference || '',
			evidence_reference: entry.evidence_reference || '',
			linked_cost_uid: entry.linked_cost_uid || '',
		});
	};

	const cancelEdit = () => {
		setEditingId(null);
		setEditForm({});
	};

	const handleDelete = (id: string) => {
		if (!window.confirm('Delete this entry?')) return;
		deleteMutation.mutate(id);
	};

	const buildPayload = (form: Record<string, unknown>, isAdd: boolean) => {
		const payload: Record<string, unknown> = {
			transaction_date: form.transaction_date,
			transaction_number: form.transaction_number || undefined,
			expense_category: form.expense_category || null,
			description: form.description || null,
			payment_mode: form.payment_mode || 'cash',
			notes: form.notes || null,
			status: form.status || 'submitted',
		};
		if (isAdd) {
			// The financial fields are captured once, through the create path;
			// later changes are versioned commands, not register edits.
			payload.debit_amount = Math.abs(Number(form.debit_amount || 0));
			payload.source_voucher_id = form.source_voucher_id
				? Number(form.source_voucher_id)
				: null;
			payload.cost_classification = form.cost_classification || null;
			payload.project_id = form.project_id ? Number(form.project_id) : null;
			payload.service_period_start = form.service_period_start || null;
			payload.service_period_end = form.service_period_end || null;
			payload.bill_date = form.bill_date || null;
			payload.currency = form.currency || 'INR';
			payload.tax_amount = form.tax_amount === '' ? null : Number(form.tax_amount);
			payload.tax_treatment = form.tax_treatment || 'none';
			payload.source_reference = form.source_reference || null;
			payload.evidence_reference = form.evidence_reference || null;
			payload.linked_cost_uid = form.linked_cost_uid || null;
		}
		return payload;
	};

	const handleSaveAdd = () => {
		const payload = buildPayload(addForm, true);
		const parsed = schema.safeParse(payload);
		if (!parsed.success) {
			toast.error(parsed.error.issues[0].message);
			return;
		}

		const debitAmount = Math.abs(Number(addForm.debit_amount || 0));
		if (debitAmount === 0) {
			toast.error('Amount is required');
			return;
		}

		createMutation.mutate(payload);
	};

	const handleSaveEdit = () => {
		const payload = buildPayload(editForm, false);

		const parsed = schema.safeParse(payload);
		if (!parsed.success) {
			toast.error(parsed.error.issues[0].message);
			return;
		}

		updateMutation.mutate({ id: editingId!, data: payload });
	};

	const runCommand = (row: PettyCashRow, command: string, reason?: string) => {
		commandMutation.mutate({
			id: row.id,
			command,
			expected_version: row.financial_version,
			reason,
		});
	};

	const requestReason = (row: PettyCashRow, command: 'reject' | 'cancel') => {
		const reason = window.prompt(
			command === 'reject' ? 'Reason for rejection?' : 'Reason for cancellation?'
		);
		if (reason === null) return;
		if (!reason.trim()) {
			toast.error('A reason is required');
			return;
		}
		runCommand(row, command, reason);
	};

	const updateField = (
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		key: string,
		value: unknown
	) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	/** The financial controls shared by the add and edit rows. */
	const renderFinancialControls = (
		form: Record<string, unknown>,
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		disabled: boolean
	) => {
		const classification = String(form.cost_classification || '');
		return (
			<div
				className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
				data-testid="petty-cash-financial-controls"
			>
				<div>
					<label className="text-[10px] text-gray-500">Voucher</label>
					<SearchableSelect
						aria-label="Voucher"
						options={voucherBalances.map((voucher) => ({
							value: String(voucher.id),
							label: `${voucher.voucher_number} — remaining ${formatCurrency(voucher.remaining)}`,
						}))}
						value={String(form.source_voucher_id || '')}
						onChange={(value) =>
							updateField(setForm, 'source_voucher_id', value)
						}
						placeholder="No voucher"
						buttonClassName={SELECT_BUTTON}
						disabled={disabled}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Classification</label>
					<SearchableSelect
						aria-label="Classification"
						options={CLASSIFICATION_OPTIONS}
						value={classification}
						onChange={(value) =>
							updateField(setForm, 'cost_classification', value)
						}
						placeholder="Unresolved"
						buttonClassName={SELECT_BUTTON}
						disabled={disabled}
					/>
				</div>
				{classification === 'project' && (
					<div>
						<label className="text-[10px] text-gray-500">Project</label>
						<SearchableSelect
							aria-label="Project"
							options={projectOptions.map((project) => ({
								value: String(project.project_id),
								label: `${project.project_code} — ${project.project_title ?? project.name ?? ''}`,
							}))}
							value={String(form.project_id || '')}
							onChange={(value) => updateField(setForm, 'project_id', value)}
							placeholder="Select project"
							buttonClassName={SELECT_BUTTON}
							disabled={disabled}
						/>
					</div>
				)}
				<div>
					<label className="text-[10px] text-gray-500">Service start</label>
					<input
						type="date"
						aria-label="Service period start"
						value={String(form.service_period_start || '')}
						disabled={disabled}
						onChange={(e) =>
							updateField(setForm, 'service_period_start', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Service end</label>
					<input
						type="date"
						aria-label="Service period end"
						value={String(form.service_period_end || '')}
						disabled={disabled}
						onChange={(e) =>
							updateField(setForm, 'service_period_end', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Bill date</label>
					<input
						type="date"
						aria-label="Bill date"
						value={String(form.bill_date || '')}
						disabled={disabled}
						onChange={(e) =>
							updateField(setForm, 'bill_date', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Tax</label>
					<input
						type="number"
						min="0"
						step="0.01"
						aria-label="Tax amount"
						placeholder="0.00"
						value={String(form.tax_amount ?? '')}
						disabled={disabled}
						onChange={(e) => updateField(setForm, 'tax_amount', e.target.value)}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Tax treatment</label>
					<SearchableSelect
						aria-label="Tax treatment"
						options={TAX_TREATMENT_OPTIONS}
						value={String(form.tax_treatment || 'none')}
						onChange={(value) => updateField(setForm, 'tax_treatment', value)}
						placeholder="No tax"
						buttonClassName={SELECT_BUTTON}
						disabled={disabled}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Receipt evidence</label>
					<input
						type="text"
						aria-label="Receipt evidence"
						placeholder="Receipt / GRN reference"
						value={String(form.evidence_reference || '')}
						disabled={disabled}
						onChange={(e) =>
							updateField(setForm, 'evidence_reference', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Source reference</label>
					<input
						type="text"
						aria-label="Source reference"
						placeholder="Document number"
						value={String(form.source_reference || '')}
						disabled={disabled}
						onChange={(e) =>
							updateField(setForm, 'source_reference', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Linked cost</label>
					<input
						type="text"
						aria-label="Linked cost"
						placeholder="cost-… (settles that cost)"
						value={String(form.linked_cost_uid || '')}
						disabled={disabled}
						onChange={(e) =>
							updateField(setForm, 'linked_cost_uid', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</div>
				<div>
					<label className="text-[10px] text-gray-500">Notes</label>
					<input
						type="text"
						aria-label="Notes"
						value={String(form.notes || '')}
						onChange={(e) => updateField(setForm, 'notes', e.target.value)}
						className={CELL_INPUT}
					/>
				</div>
			</div>
		);
	};

	// ── Render inline add/edit form row ──
	const renderInlineFormRow = (
		form: Record<string, unknown>,
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		isAdd: boolean
	) => {
		return (
			<>
				<TableRow className="bg-purple-50/50 divide-x divide-gray-200">
					{/* Settlement */}
					<TableCell className="text-center">
						{isAdd ? (
							<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">
								<ReceiptRefundIcon className="w-3 h-3 mr-0.5" />
								New
							</span>
						) : (
							<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-500 whitespace-nowrap">
								Editing
							</span>
						)}
					</TableCell>

					{/* Ref. No. */}
					<TableCell className="text-center text-xs text-gray-400 font-mono">
						{isAdd ? 'Auto' : String(form.transaction_number || '—')}
					</TableCell>

					{/* Date */}
					<TableCell>
						<input
							type="date"
							aria-label="Transaction date"
							value={String(form.transaction_date || '')}
							disabled={!isAdd}
							onChange={(e) =>
								updateField(setForm, 'transaction_date', e.target.value)
							}
							className={CELL_INPUT}
						/>
					</TableCell>

					{/* Particulars */}
					<TableCell>
						<SearchableSelect
							aria-label="Particulars"
							options={(descriptionsQuery.data?.data || [])
								.filter(
									(d: Record<string, unknown>) =>
										d.is_active === true ||
										d.is_active === 1 ||
										d.is_active === '1'
								)
								.map((d: Record<string, unknown>) => ({
									value: d.description_name as string,
									label: d.description_name as string,
								}))}
							value={String(form.description || '')}
							onChange={(val) => updateField(setForm, 'description', val)}
							placeholder="Select description"
							buttonClassName={SELECT_BUTTON}
						/>
					</TableCell>

					{/* Category */}
					<TableCell>
						<SearchableSelect
							aria-label="Category"
							options={(categoriesQuery.data?.data || [])
								.filter(
									(c: Record<string, unknown>) =>
										c.is_active === true ||
										c.is_active === 1 ||
										c.is_active === '1'
								)
								.map((c: Record<string, unknown>) => ({
									value: c.category_name as string,
									label: c.category_name as string,
								}))}
							value={String(form.expense_category || '')}
							onChange={(val) => updateField(setForm, 'expense_category', val)}
							placeholder="—"
							className="w-full"
							buttonClassName={SELECT_BUTTON}
						/>
					</TableCell>

					{/* Debit (Amount) */}
					<TableCell>
						<input
							type="number"
							min="0"
							step="0.01"
							aria-label="Amount"
							value={String(form.debit_amount ?? '')}
							disabled={!isAdd}
							onChange={(e) =>
								updateField(setForm, 'debit_amount', e.target.value)
							}
							placeholder="0.00"
							className={`${CELL_INPUT} text-right`}
						/>
					</TableCell>

					{/* Credit */}
					<TableCell className="text-center text-xs text-gray-400">—</TableCell>

					{/* Balance */}
					<TableCell className="text-center text-xs text-gray-400">—</TableCell>

					{/* Recognition state: a new entry starts as a draft unless it is
					    submitted for recognition. */}
					<TableCell className="text-center text-[10px] text-gray-400">
						{isAdd ? 'Draft' : '—'}
					</TableCell>

					{/* Status */}
					<TableCell>
						<SearchableSelect
							aria-label="Status"
							options={STATUS_OPTIONS}
							value={String(form.status || 'submitted')}
							onChange={(val) => updateField(setForm, 'status', val)}
							placeholder="Status"
							className="w-full"
							buttonClassName={SELECT_BUTTON}
						/>
					</TableCell>

					{/* Actions */}
					<TableCell className="text-right">
						<div className="inline-flex items-center gap-1">
							<button
								onClick={isAdd ? handleSaveAdd : handleSaveEdit}
								disabled={createMutation.isPending || updateMutation.isPending}
								className="p-1 rounded bg-[#64126D] text-white hover:bg-[#7F2487] transition-colors disabled:opacity-50"
								title="Save"
							>
								<CheckIcon className="w-4 h-4" />
							</button>
							<button
								onClick={isAdd ? cancelAdd : cancelEdit}
								disabled={createMutation.isPending || updateMutation.isPending}
								className="p-1 rounded bg-white text-[#4A1254] border border-gray-300 hover:bg-gray-50 transition-colors disabled:opacity-50"
								title="Cancel"
							>
								<XMarkIcon className="w-4 h-4" />
							</button>
						</div>
					</TableCell>
				</TableRow>
				<TableRow className="bg-purple-50/50">
					<TableCell colSpan={columns.length + 1} className="px-2 py-2">
						{renderFinancialControls(form, setForm, !isAdd)}
						{!isAdd && (
							<p className="mt-1 text-[10px] text-gray-500">
								Amounts, dates, references, classification, period, tax, and the
								linked cost are versioned: change them through a command with the
								current version, not this register edit.
							</p>
						)}
					</TableCell>
				</TableRow>
			</>
		);
	};

	// ── Render data row ──
	const renderDataRow = (row: PettyCashRow) => {
		const status = row.status || 'submitted';
		const debitAmt = Number(row.debit_amount ?? 0);
		const creditAmt = Number(row.credit_amount ?? 0);
		const isFundingRow = row.entry_kind === 'funding';
		const voucherNumber = row.source_voucher_number || '';
		const isSettled = !isFundingRow && voucherNumber;
		const state = row.recognition_state || 'draft';
		const isRecognized = state === 'recognized';
		const isLinked = !isFundingRow && !!row.linked_cost_uid;

		return (
			<TableRow
				key={row.id}
				data-testid={`petty-row-${row.transaction_number}`}
				data-amount={debitAmt ? String(debitAmt) : String(creditAmt)}
				className="divide-x divide-gray-200"
			>
				{/* Settlement */}
				<TableCell className="text-center">
					{isFundingRow ? (
						<span
							className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 whitespace-nowrap"
							title={
								voucherNumber ? `Voucher: ${voucherNumber}` : 'Funding entry'
							}
						>
							<BanknotesIcon className="w-3 h-3 mr-0.5" />
							Funding
						</span>
					) : isSettled ? (
						<span
							className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700 whitespace-nowrap"
							title={`Settled by: ${voucherNumber}`}
						>
							<CheckCircleIcon className="w-3 h-3 mr-0.5" />
							Settled
						</span>
					) : (
						<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">
							<XCircleIcon className="w-3 h-3 mr-0.5" />
							Unsettled
						</span>
					)}
				</TableCell>

				{/* Ref. No. */}
				<TableCell className="text-xs font-mono">
					{row.transaction_number || '—'}
				</TableCell>

				{/* Date */}
				<TableCell className="text-xs">
					{formatDate(row.transaction_date)}
				</TableCell>

				{/* Particulars */}
				<TableCell
					className="text-xs truncate max-w-[12rem]"
					title={row.description || ''}
				>
					{row.description || '—'}
					{isLinked && (
						<span
							className="ml-1 rounded bg-sky-100 px-1 py-0.5 text-[9px] font-semibold text-sky-700"
							title={`Settles existing cost ${row.linked_cost_uid}`}
						>
							Settlement
						</span>
					)}
				</TableCell>

				{/* Category */}
				<TableCell className="text-xs">
					{row.expense_category || '—'}
				</TableCell>

				{/* Debit */}
				<TableCell className="text-xs text-right tabular-nums text-emerald-700">
					{formatMoney(debitAmt)}
				</TableCell>

				{/* Credit */}
				<TableCell className="text-xs text-right tabular-nums text-red-600">
					{formatMoney(creditAmt)}
				</TableCell>

				{/* Balance */}
				<TableCell className="text-xs text-right font-semibold tabular-nums">
					{formatMoney(row.running_balance)}
				</TableCell>

				{/* Recognition state */}
				<TableCell className="text-center">
					<span
						data-testid={`petty-state-${row.transaction_number}`}
						className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
							isRecognized
								? 'bg-emerald-100 text-emerald-700'
								: state === 'rejected'
									? 'bg-rose-100 text-rose-700'
									: state === 'cancelled'
										? 'bg-gray-100 text-gray-600'
										: 'bg-amber-100 text-amber-700'
						}`}
					>
						{RECOGNITION_STATE_LABELS[state] || state}
					</span>
					{!isFundingRow && (
						<div className="mt-1 flex flex-wrap items-center justify-center gap-0.5">
							{(state === 'draft' || state === 'pending_evidence') &&
								canUpdate && (
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Submit ${row.transaction_number}`}
										onClick={() => runCommand(row, 'submit')}
									>
										Submit
									</Button>
								)}
							{(state === 'draft' || state === 'pending_evidence') &&
								canApprove && (
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Recognize ${row.transaction_number}`}
										onClick={() => runCommand(row, 'recognize')}
									>
										Recognize
									</Button>
								)}
							{(state === 'draft' || state === 'pending_evidence') &&
								canApprove && (
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Reject ${row.transaction_number}`}
										onClick={() => requestReason(row, 'reject')}
									>
										Reject
									</Button>
								)}
							{isRecognized && canApprove && (
								<Button
									variant="ghost"
									size="sm"
									aria-label={`Cancel ${row.transaction_number}`}
									onClick={() => requestReason(row, 'cancel')}
								>
									Cancel
								</Button>
							)}
						</div>
					)}
				</TableCell>

				{/* Status */}
				<TableCell>
					<span
						className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[status] || STATUS_BADGE.submitted}`}
					>
						{status}
					</span>
				</TableCell>

				{/* Actions */}
				<TableCell className="text-center">
					{isFundingRow || isRecognized ? (
						<span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
							<LockClosedIcon className="w-3 h-3" />
							{isFundingRow ? 'Auto' : 'Locked'}
						</span>
					) : (
						<div className="inline-flex items-center gap-0.5">
							<Button
								variant="ghost"
								size="sm"
								aria-label={`Edit ${row.transaction_number}`}
								onClick={() => openEdit(row)}
								disabled={isAdding || editingId !== null}
								title="Edit"
							>
								<PencilIcon className="w-3.5 h-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								aria-label={`Delete ${row.transaction_number}`}
								onClick={() => handleDelete(row.id)}
								className="text-rose-600 hover:bg-rose-50"
								title="Delete"
							>
								<TrashIcon className="w-3.5 h-3.5" />
							</Button>
						</div>
					)}
				</TableCell>
			</TableRow>
		);
	};

	// ── Stats cards ──
	const statsConfig = [
		{
			key: 'totalDebits',
			label: 'Total Debits',
			tone: 'rose' as const,
			money: true,
			icon: ArrowUpCircleIcon,
		},
		{
			key: 'totalCredits',
			label: 'Total Credits',
			tone: 'green' as const,
			money: true,
			icon: ArrowDownCircleIcon,
		},
		{
			key: 'balance',
			label: 'Balance',
			tone: 'purple' as const,
			money: true,
			icon: BanknotesIcon,
		},
	];

	// Funding, spending, remaining supported funding, and recognized cost are
	// stated separately from the running balance: funding is cash movement, not
	// expense, and recognized cost is only the spending that creates cost.
	const fundingCards = [
		{
			testId: 'petty-funding-amount',
			label: 'Funding',
			value: funding?.funding ?? null,
			hint: 'Vouchers and their mirrored credits',
		},
		{
			testId: 'petty-spend-amount',
			label: 'Spend',
			value: funding?.spend ?? null,
			hint: 'Actual petty-cash spending',
		},
		{
			testId: 'petty-remaining-amount',
			label: 'Remaining Funding',
			value: funding?.remaining_funding ?? null,
			hint: 'Funding less spending drawn from vouchers',
		},
		{
			testId: 'petty-recognized-amount',
			label: 'Recognized Cost',
			value: funding?.recognized_cost ?? null,
			hint: 'Approved spending, counted once',
		},
	];

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col sm:px-4 overflow-hidden">
				<div className="max-w-full mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5">
					{/* ── Header ── */}
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Petty Cash Expenses
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Track petty cash funding, spending, and recognized cost
							</p>
						</div>
						<div className="flex items-center gap-2">
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
							<Button
								size="sm"
								onClick={openAdd}
								disabled={isAdding || editingId !== null}
							>
								<PlusIcon className="h-4 w-4" />
								Add Expense
							</Button>
						</div>
					</header>

					{/* ── Funding / spending / recognized cost ── */}
					<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
						{fundingCards.map((card) => (
							<div
								key={card.testId}
								className="bg-white rounded-xl shadow-sm border border-gray-200 px-3 py-2"
							>
								<div
									data-testid={card.testId}
									data-amount={card.value === null ? '' : String(card.value)}
									className="text-lg font-bold text-gray-900"
								>
									{card.value === null
										? '—'
										: formatCurrency(card.value)}
								</div>
								<div className="text-xs text-gray-600">{card.label}</div>
								<div className="text-[10px] text-gray-400">{card.hint}</div>
							</div>
						))}
					</div>

					{/* ── Ledger stats ── */}
					<div className="flex gap-4">
						{statsConfig.map((s) => {
							const toneColorMap: Record<string, string> = {
								purple: 'text-purple-600',
								green: 'text-green-600',
								amber: 'text-amber-600',
								rose: 'text-rose-600',
								sky: 'text-sky-600',
								slate: 'text-slate-600',
							};
							const displayValue = s.money
								? formatCurrency(stats[s.key] ?? 0)
								: String(stats[s.key] ?? 0);
							return (
								<div
									key={s.key}
									className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2"
								>
									<div
										className={`text-lg font-bold ${toneColorMap[s.tone] || 'text-gray-900'}`}
									>
										{displayValue}
									</div>
									<div className="text-xs text-gray-600">{s.label}</div>
								</div>
							);
						})}
					</div>

					{/* ── Table ── */}
					<div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-1 min-h-0 flex flex-col">
						{/* Search + Controls */}
						<div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
							<div className="relative flex-1 min-w-[200px] max-w-md">
								<Input
									placeholder="Search by voucher #, particulars, recipient, bill #…"
									value={search}
									onChange={(e) => {
										setSearch(e.target.value);
									}}
								/>
							</div>
							{!authLoading && !canUpdate && (
								<span className="text-xs text-gray-500">
									Read-only: your role cannot record petty-cash spending.
								</span>
							)}
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									tableBodyRef.current?.scrollTo({
										top: tableBodyRef.current.scrollHeight,
										behavior: 'smooth',
									});
								}}
								title="Scroll to oldest entries (bottom)"
							>
								<ArrowDownTrayIcon className="h-4 w-4" />
								Bottom
							</Button>
						</div>

						{/* Table */}
						<div className="flex-1 min-h-0 overflow-auto" ref={tableBodyRef}>
							<Table>
								<TableHeader>
									<TableRow className="sticky top-0 z-10 bg-white">
										{columns.map((c) => (
											<TableHead key={c.key} className={c.className}>
												{c.label}
											</TableHead>
										))}
										<TableHead className="text-center">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{listQuery.isLoading ? (
										<TableEmpty>Loading…</TableEmpty>
									) : rows.length === 0 && !isAdding ? (
										<TableEmpty>No records found.</TableEmpty>
									) : (
										<>
											{/* ── Inline Add Row ── */}
											{isAdding &&
												renderInlineFormRow(addForm, setAddForm, true)}

											{/* ── Data Rows ── */}
											{rows.map((row: PettyCashRow) => (
												<Fragment key={row.id}>
													{editingId === row.id
														? renderInlineFormRow(
																editForm,
																setEditForm,
																false
															)
														: renderDataRow(row)}
												</Fragment>
											))}
										</>
									)}
								</TableBody>
							</Table>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
