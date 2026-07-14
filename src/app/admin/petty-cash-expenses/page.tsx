'use client';

import { useState, useMemo, Fragment } from 'react';
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
	DocumentTextIcon,
	CheckCircleIcon,
	XCircleIcon,
	PaperAirplaneIcon,
	BanknotesIcon,
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
	LockClosedIcon,
	ReceiptRefundIcon,
} from '@heroicons/react/24/outline';
import SearchableSelect from '@/components/ui/searchable-select';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Pagination from '@/components/admin/Pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form-fields';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
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

interface ApiResponse {
	data: Record<string, unknown>[];
	pagination: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
	};
	stats: Record<string, number | string | null>;
	voucherBalances: VoucherBalance[];
}

// ── Constants ────────────────────────────────────────────────

const ENDPOINT = '/api/admin/petty-cash-expenses';
const PAGE_SIZE = 20;

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
	{ key: 'expense_category', label: 'Category', className: 'w-36 text-center' },
	{
		key: 'debit',
		label: 'Debit',
		className: 'w-28 text-center',
	},
	{
		key: 'credit',
		label: 'Credit',
		className: 'w-28 text-center',
	},
	{
		key: 'running_balance',
		label: 'Balance',
		className: 'w-28 text-center',
	},
	{ key: 'payment_mode', label: 'Mode', className: 'w-24 text-center' },
	{ key: 'status', label: 'Status', className: 'w-24 text-center' },
];

// ── Helpers ──────────────────────────────────────────────────

function formatMoney(val: unknown) {
	const n = Number(val ?? 0);
	if (!n) return '—';
	return formatCurrency(n);
}

// ── Main Component ───────────────────────────────────────────

export default function PettyCashExpensesPage() {
	const queryClient = useQueryClient();

	// ── UI state ──
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState('');

	// ── Inline form state ──
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [addForm, setAddForm] = useState<Record<string, unknown>>({
		...addDefaults,
	});
	const [editForm, setEditForm] = useState<Record<string, unknown>>({});

	// ── Data query ──
	const queryParams = useMemo(
		() => ({
			page,
			limit: PAGE_SIZE,
			search: search || undefined,
		}),
		[page, search]
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

	const rows = listQuery.data?.data ?? [];
	const pagination = listQuery.data?.pagination ?? {
		page: 1,
		limit: PAGE_SIZE,
		total: 0,
		totalPages: 0,
	};
	const stats: Record<string, number | string | null> =
		listQuery.data?.stats ?? {};

	// ── Mutations ──

	// ── Mutations ──
	const createMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) => apiPost(ENDPOINT, data),
		onSuccess: () => {
			toast.success('Expense created');
			setIsAdding(false);
			setAddForm({ ...addDefaults });
			setPage(1);
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

	const openEdit = (entry: Record<string, unknown>) => {
		setIsAdding(false);
		setEditingId(entry.id as string);
		setEditForm({
			transaction_date: (entry.transaction_date as string) || '',
			transaction_number: (entry.transaction_number as string) || '',
			expense_category: entry.expense_category || '',
			description: entry.description || '',
			debit_amount: Number(entry.debit_amount ?? 0) || '',
			payment_mode: entry.payment_mode || 'cash',
			notes: entry.notes || '',
			status: entry.status || 'submitted',
			approved_by_name: entry.approved_by_name,
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

	const buildPayload = (form: Record<string, unknown>) => {
		return {
			transaction_date: form.transaction_date,
			transaction_number: form.transaction_number || undefined,
			expense_category: form.expense_category || null,
			description: form.description || null,
			debit_amount: Math.abs(Number(form.debit_amount || 0)),
			payment_mode: form.payment_mode || 'cash',
			notes: form.notes || null,
			status: form.status || 'submitted',
		};
	};

	const handleSaveAdd = () => {
		const payload = buildPayload(addForm);
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
		const payload = buildPayload(editForm);

		const parsed = schema.safeParse(payload);
		if (!parsed.success) {
			toast.error(parsed.error.issues[0].message);
			return;
		}

		updateMutation.mutate({ id: editingId!, data: payload });
	};

	const updateField = (
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		key: string,
		value: unknown
	) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	// ── Render inline add/edit form row ──
	const renderInlineFormRow = (
		form: Record<string, unknown>,
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		isAdd: boolean
	) => {
		return (
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
						value={String(form.transaction_date || '')}
						onChange={(e) =>
							updateField(setForm, 'transaction_date', e.target.value)
						}
						className={CELL_INPUT}
					/>
				</TableCell>

				{/* Particulars */}
				<TableCell>
					<SearchableSelect
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
						value={String(form.debit_amount ?? '')}
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

				{/* Mode */}
				<TableCell>
					<SearchableSelect
						options={PAYMENT_MODE_OPTIONS}
						value={String(form.payment_mode || 'cash')}
						onChange={(val) => updateField(setForm, 'payment_mode', val)}
						placeholder="Mode"
						className="w-full"
						buttonClassName={SELECT_BUTTON}
					/>
				</TableCell>

				{/* Status */}
				<TableCell>
					<SearchableSelect
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
		);
	};

	// ── Render data row ──
	const renderDataRow = (row: Record<string, unknown>) => {
		const status = (row.status as string) || 'submitted';
		const mode = (row.payment_mode as string) || 'cash';
		const debitAmt = Number(row.debit_amount ?? 0);
		const creditAmt = Number(row.credit_amount ?? 0);
		const isFundingRow = creditAmt > 0 && debitAmt === 0;
		const voucherNumber = (row.source_voucher_number as string) || '';
		const isSettled = !isFundingRow && voucherNumber;

		return (
			<TableRow key={row.id as string} className="divide-x divide-gray-200">
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
					{(row.transaction_number as string) || '—'}
				</TableCell>

				{/* Date */}
				<TableCell className="text-xs">
					{formatDate(row.transaction_date as string)}
				</TableCell>

				{/* Particulars */}
				<TableCell
					className="text-xs truncate max-w-[12rem]"
					title={row.description as string}
				>
					{(row.description as string) || '—'}
				</TableCell>

				{/* Category */}
				<TableCell className="text-xs">
					{(row.expense_category as string) || '—'}
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

				{/* Mode */}
				<TableCell>
					<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-700">
						{mode}
					</span>
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
					{isFundingRow ? (
						<span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
							<LockClosedIcon className="w-3 h-3" />
							Auto
						</span>
					) : (
						<div className="inline-flex items-center gap-0.5">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => openEdit(row)}
								disabled={isAdding || editingId !== null}
								title="Edit"
							>
								<PencilIcon className="w-3.5 h-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => handleDelete(row.id as string)}
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
			key: 'total',
			label: 'Total',
			tone: 'purple' as const,
			icon: DocumentTextIcon,
		},
		{
			key: 'submitted',
			label: 'Submitted',
			tone: 'amber' as const,
			icon: PaperAirplaneIcon,
		},
		{
			key: 'approved',
			label: 'Approved',
			tone: 'sky' as const,
			icon: CheckCircleIcon,
		},
		{
			key: 'rejected',
			label: 'Rejected',
			tone: 'rose' as const,
			icon: XCircleIcon,
		},
		{
			key: 'totalPaid',
			label: 'Expenses',
			tone: 'green' as const,
			money: true,
			icon: ArrowUpCircleIcon,
		},
		{
			key: 'totalReceived',
			label: 'Funding',
			tone: 'rose' as const,
			money: true,
			icon: ArrowDownCircleIcon,
		},
		{
			key: 'currentBalance',
			label: 'Balance',
			tone: 'purple' as const,
			money: true,
			icon: BanknotesIcon,
			hint: 'Current balance',
		},
		{
			key: 'approvedAmount',
			label: 'Approved Net',
			tone: 'sky' as const,
			money: true,
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
								Track petty cash receipts and payments with running balance
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

					{/* ── Stats ── */}
					<div className="flex gap-4 mb-6">
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
								: (stats[s.key] ?? 0).toLocaleString('en-IN');
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
										setPage(1);
									}}
								/>
							</div>
						</div>

						{/* Table */}
						<div className="flex-1 min-h-0 overflow-auto">
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
											{rows.map((row: Record<string, unknown>) => (
												<Fragment key={row.id as string}>
													{editingId === row.id
														? renderInlineFormRow(editForm, setEditForm, false)
														: renderDataRow(row)}
												</Fragment>
											))}
										</>
									)}
								</TableBody>
							</Table>
						</div>

						{/* ── Pagination ── */}
						{pagination.totalPages > 1 && (
							<div className="border-t border-gray-100 px-4">
								<Pagination
									page={pagination.page}
									totalPages={pagination.totalPages}
									total={pagination.total}
									onPageChange={setPage}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
