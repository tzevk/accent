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
	ChevronDownIcon,
	ChevronRightIcon,
} from '@heroicons/react/24/outline';
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

interface VoucherInfo {
	id: number;
	voucher_number: string;
	voucher_date: string;
	voucher_type: string;
	paid_to: string;
	payment_mode: string;
	total_amount: number;
	status: string;
	notes: string;
	created_at: string;
	prepared_by: string;
}

interface VoucherBalance {
	id: number;
	voucher_number: string;
	total_amount: number;
	total_credited: number;
	remaining: number;
}

interface CardEntry {
	voucher: VoucherInfo;
	total_credited: number;
	remaining: number;
	entry_count: number;
	pce_entries: Record<string, unknown>[];
}

interface ApiResponse {
	entries: CardEntry[];
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
	credit_amount: z.coerce.number().min(0),
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
	credit_amount: '' as number | string,
	source_voucher_id: '' as number | string,
	payment_mode: 'cash' as const,
	notes: '',
	status: 'submitted' as const,
};

// ── Inline row input styles ──────────────────────────────────

const CELL_INPUT =
	'w-full px-1.5 py-0.5 text-xs border border-gray-300 rounded focus:border-[#64126D] focus:ring-1 focus:ring-purple-200 focus:outline-none';
const CELL_SELECT =
	'w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:border-[#64126D] focus:ring-1 focus:ring-purple-200 focus:outline-none';

// ── Column definitions ───────────────────────────────────────

const columns = [
	{ key: 'type', label: 'Type', className: 'w-20 text-center' },
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
	const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

	// ── Inline form state (per-card add / per-entry edit) ──
	const [addingVoucherId, setAddingVoucherId] = useState<number | null>(null);
	const [editingPceId, setEditingPceId] = useState<string | null>(null);
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

	const entries = listQuery.data?.entries ?? [];
	const pagination = listQuery.data?.pagination ?? {
		page: 1,
		limit: PAGE_SIZE,
		total: 0,
		totalPages: 0,
	};
	const stats: Record<string, number | string | null> =
		listQuery.data?.stats ?? {};

	// ── Expand/collapse ──
	const toggleCard = (voucherId: number) => {
		setExpandedCards((prev) => {
			const next = new Set(prev);
			if (next.has(voucherId)) {
				next.delete(voucherId);
			} else {
				next.add(voucherId);
			}
			return next;
		});
	};

	const expandAll = () => {
		const allIds = new Set(entries.map((e) => e.voucher.id));
		setExpandedCards(allIds);
	};

	const collapseAll = () => {
		setExpandedCards(new Set());
	};

	// ── Mutations ──
	const createMutation = useMutation({
		mutationFn: (data: Record<string, unknown>) => apiPost(ENDPOINT, data),
		onSuccess: () => {
			toast.success('Expense created');
			setAddingVoucherId(null);
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
			setEditingPceId(null);
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

	const openAdd = (voucherId: number) => {
		setEditingPceId(null);
		setAddingVoucherId(voucherId);
		setAddForm({
			...addDefaults,
			source_voucher_id: voucherId,
		});
		// auto-expand the card
		setExpandedCards((prev) => new Set(prev).add(voucherId));
	};

	const cancelAdd = () => {
		setAddingVoucherId(null);
		setAddForm({ ...addDefaults });
	};

	const openEdit = (entry: Record<string, unknown>, voucherId: number) => {
		setAddingVoucherId(null);
		const isVoucherDebit =
			entry.source_voucher_id != null &&
			Number(entry.debit_amount ?? 0) > 0 &&
			Number(entry.credit_amount ?? 0) === 0;
		setEditingPceId(entry.id as string);
		setEditForm({
			transaction_date: (entry.transaction_date as string) || '',
			transaction_number: (entry.transaction_number as string) || '',
			expense_category: entry.expense_category || '',
			description: entry.description || '',
			debit_amount: Number(entry.debit_amount ?? 0) || '',
			credit_amount: Number(entry.credit_amount ?? 0) || '',
			source_voucher_id: entry.source_voucher_id || voucherId,
			source_voucher_number: entry.source_voucher_number || '',
			is_voucher_debit: isVoucherDebit,
			payment_mode: entry.payment_mode || 'cash',
			notes: entry.notes || '',
			status: entry.status || 'submitted',
			approved_by_name: entry.approved_by_name,
		});
		setExpandedCards((prev) => new Set(prev).add(voucherId));
	};

	const cancelEdit = () => {
		setEditingPceId(null);
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
			credit_amount: Math.abs(Number(form.credit_amount || 0)),
			source_voucher_id: form.source_voucher_id
				? Number(form.source_voucher_id)
				: null,
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

		const creditAmount = Math.abs(Number(addForm.credit_amount || 0));
		const selectedVoucherId = addForm.source_voucher_id
			? Number(addForm.source_voucher_id)
			: null;

		if (!selectedVoucherId && creditAmount > 0) {
			const ok = window.confirm('No source voucher selected. Continue?');
			if (!ok) return;
		}

		createMutation.mutate(payload);
	};

	const handleSaveEdit = () => {
		const payload = buildPayload(editForm);

		const isVoucherDebit =
			editForm.is_voucher_debit === true &&
			Number(editForm.debit_amount ?? 0) > 0 &&
			Number(editForm.credit_amount ?? 0) === 0;

		const updateData: Record<string, unknown> = {
			transaction_date: payload.transaction_date,
			expense_category: payload.expense_category,
			description: payload.description,
			credit_amount: payload.credit_amount,
			source_voucher_id: payload.source_voucher_id,
			payment_mode: payload.payment_mode,
			notes: payload.notes,
			status: payload.status,
		};

		if (!isVoucherDebit) {
			updateData.debit_amount = payload.debit_amount;
		}

		const parsed = schema.safeParse({
			...payload,
			debit_amount: isVoucherDebit ? 0 : payload.debit_amount,
		});
		if (!parsed.success) {
			toast.error(parsed.error.issues[0].message);
			return;
		}

		updateMutation.mutate({ id: editingPceId!, data: updateData });
	};

	const updateField = (
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		key: string,
		value: unknown
	) => {
		setForm((prev) => ({ ...prev, [key]: value }));
	};

	// ── Render a single PCE entry row within a card ──
	const renderEntryRow = (
		entry: Record<string, unknown>,
		voucherId: number,
		runningBalance: number
	) => {
		const status = (entry.status as string) || 'submitted';
		const mode = (entry.payment_mode as string) || 'cash';
		const debitAmt = Number(entry.debit_amount ?? 0);
		const creditAmt = Number(entry.credit_amount ?? 0);
		const isVoucherDebit =
			entry.source_voucher_id != null && debitAmt > 0 && creditAmt === 0;

		return (
			<TableRow key={entry.id as string} className="divide-x divide-gray-200">
				{/* Type */}
				<TableCell className="text-center">
					{isVoucherDebit ? (
						<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 whitespace-nowrap">
							<BanknotesIcon className="w-3 h-3 mr-0.5" />
							Top-up
						</span>
					) : (
						<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">
							<ReceiptRefundIcon className="w-3 h-3 mr-0.5" />
							Expense
						</span>
					)}
				</TableCell>

				{/* Ref. No. */}
				<TableCell className="text-xs font-mono text-center">
					{(entry.transaction_number as string) || '—'}
				</TableCell>

				{/* Date */}
				<TableCell className="text-xs">
					{formatDate(entry.transaction_date as string)}
				</TableCell>

				{/* Particulars */}
				<TableCell
					className="text-xs truncate max-w-[12rem]"
					title={entry.description as string}
				>
					{(entry.description as string) || '—'}
				</TableCell>

				{/* Category */}
				<TableCell className="text-xs">
					{(entry.expense_category as string) || '—'}
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
					{formatCurrency(runningBalance)}
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
					<div className="inline-flex items-center gap-0.5">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => openEdit(entry, voucherId)}
							disabled={addingVoucherId !== null || editingPceId !== null}
							title="Edit"
						>
							<PencilIcon className="w-3.5 h-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => handleDelete(entry.id as string)}
							className="text-rose-600 hover:bg-rose-50"
							title="Delete"
						>
							<TrashIcon className="w-3.5 h-3.5" />
						</Button>
					</div>
				</TableCell>
			</TableRow>
		);
	};

	// ── Render inline add/edit form row within a card ──
	const renderInlineFormRow = (
		form: Record<string, unknown>,
		setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>,
		isAdd: boolean
	) => {
		const isVoucherDebit =
			form.is_voucher_debit === true &&
			Number(form.debit_amount ?? 0) > 0 &&
			Number(form.credit_amount ?? 0) === 0;

		return (
			<TableRow className="bg-purple-50/50 divide-x divide-gray-200">
				{/* Type */}
				<TableCell className="text-center">
					{isAdd || !isVoucherDebit ? (
						<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 whitespace-nowrap">
							<ReceiptRefundIcon className="w-3 h-3 mr-0.5" />
							Expense
						</span>
					) : (
						<span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 whitespace-nowrap">
							<BanknotesIcon className="w-3 h-3 mr-0.5" />
							Top-up
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
					<input
						type="text"
						value={String(form.description || '')}
						onChange={(e) =>
							updateField(setForm, 'description', e.target.value)
						}
						placeholder="Description"
						className={CELL_INPUT}
					/>
				</TableCell>

				{/* Category */}
				<TableCell>
					<select
						value={String(form.expense_category || '')}
						onChange={(e) =>
							updateField(setForm, 'expense_category', e.target.value)
						}
						className={CELL_SELECT}
					>
						<option value="">—</option>
						{(categoriesQuery.data?.data || [])
							.filter(
								(c: Record<string, unknown>) =>
									c.is_active === true ||
									c.is_active === 1 ||
									c.is_active === '1'
							)
							.map((c: Record<string, unknown>) => (
								<option key={c.id as number} value={c.category_name as string}>
									{c.category_name as string}
								</option>
							))}
					</select>
				</TableCell>

				{/* Debit */}
				<TableCell>
					{isVoucherDebit ? (
						<div className="flex items-center gap-1">
							<input
								type="number"
								min="0"
								step="0.01"
								value={String(form.debit_amount ?? '')}
								disabled
								className={`${CELL_INPUT} text-right bg-gray-100 text-gray-500 cursor-not-allowed`}
							/>
							<LockClosedIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
						</div>
					) : isAdd ? (
						<span className="text-xs text-gray-400 text-right block pr-1">
							—
						</span>
					) : (
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
					)}
				</TableCell>

				{/* Credit */}
				<TableCell>
					<input
						type="number"
						min="0"
						step="0.01"
						value={String(form.credit_amount ?? '')}
						onChange={(e) =>
							updateField(setForm, 'credit_amount', e.target.value)
						}
						placeholder={isVoucherDebit ? '—' : '0.00'}
						disabled={isVoucherDebit}
						className={`${CELL_INPUT} text-right ${isVoucherDebit ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
					/>
				</TableCell>

				{/* Balance */}
				<TableCell className="text-center text-xs text-gray-400">—</TableCell>

				{/* Mode */}
				<TableCell>
					<select
						value={String(form.payment_mode || 'cash')}
						onChange={(e) =>
							updateField(setForm, 'payment_mode', e.target.value)
						}
						className={CELL_SELECT}
					>
						{PAYMENT_MODE_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
				</TableCell>

				{/* Status */}
				<TableCell>
					<select
						value={String(form.status || 'submitted')}
						onChange={(e) => updateField(setForm, 'status', e.target.value)}
						className={CELL_SELECT}
					>
						{STATUS_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</select>
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

	// ── Render a single voucher card ──
	const renderVoucherCard = (cardEntry: CardEntry) => {
		const { voucher, pce_entries, remaining, entry_count } = cardEntry;
		const voucherId = voucher.id;
		const isExpanded = expandedCards.has(voucherId);
		const isAddingHere = addingVoucherId === voucherId;

		// Compute per-entry running balance
		const hasDebitEntry = pce_entries.some(
			(e) => Number(e.debit_amount ?? 0) > 0
		);
		let cumulativeBalance = hasDebitEntry ? 0 : Number(voucher.total_amount);
		const entriesWithBalance = pce_entries.map((e) => {
			cumulativeBalance =
				cumulativeBalance +
				Number(e.debit_amount ?? 0) -
				Number(e.credit_amount ?? 0);
			return { ...e, _balance: cumulativeBalance };
		});

		return (
			<div
				key={voucherId}
				className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
			>
				{/* Card Header — clickable to expand/collapse */}
				<button
					onClick={() => toggleCard(voucherId)}
					className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
				>
					{isExpanded ? (
						<ChevronDownIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
					) : (
						<ChevronRightIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
					)}
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-3">
							<span className="text-base font-bold text-gray-900 font-mono">
								{voucher.voucher_number}
							</span>
							<span
								className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[voucher.status] || STATUS_BADGE.pending}`}
							>
								{voucher.status}
							</span>
							<span className="text-xs text-gray-500">
								{voucher.voucher_type} · {formatDate(voucher.voucher_date)}
							</span>
						</div>
						{voucher.paid_to && (
							<div className="text-xs text-gray-500 mt-0.5">
								Paid to: {voucher.paid_to}
								{voucher.prepared_by &&
									` · Prepared by: ${voucher.prepared_by}`}
							</div>
						)}
					</div>
					<div className="text-right flex-shrink-0">
						<div className="text-base font-bold text-gray-900">
							{formatCurrency(voucher.total_amount)}
						</div>
						<div className="text-xs text-gray-500">
							Remaining:{' '}
							<span
								className={`font-semibold ${Number(remaining) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}
							>
								{formatCurrency(remaining)}
							</span>
						</div>
						{!isExpanded && entry_count > 0 && (
							<div className="text-[11px] text-gray-400 mt-0.5">
								{entry_count} expense{entry_count !== 1 ? 's' : ''}
							</div>
						)}
					</div>
				</button>

				{/* Card Body — expanded */}
				{isExpanded && (
					<div className="border-t border-gray-100">
						{/* Action bar */}
						<div className="flex items-center justify-between px-5 py-2 bg-gray-50/50">
							<span className="text-xs text-gray-500">
								{entry_count > 0
									? `${entry_count} entr${entry_count === 1 ? 'y' : 'ies'}`
									: 'No expenses yet'}
							</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() => openAdd(voucherId)}
								disabled={isAddingHere || editingPceId !== null}
							>
								<PlusIcon className="w-3.5 h-3.5" />
								Add Expense
							</Button>
						</div>

						{/* Entries table */}
						<div className="overflow-auto">
							<Table>
								<TableHeader>
									<TableRow className="bg-gray-50">
										{columns.map((c) => (
											<TableHead key={c.key} className={c.className}>
												{c.label}
											</TableHead>
										))}
										<TableHead className="text-center">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{/* Inline Add Row */}
									{isAddingHere &&
										renderInlineFormRow(addForm, setAddForm, true)}

									{/* PCE Entries */}
									{entriesWithBalance.map((entry: Record<string, unknown>) => (
										<Fragment key={entry.id as string}>
											{editingPceId === entry.id
												? renderInlineFormRow(editForm, setEditForm, false)
												: renderEntryRow(
														entry,
														voucherId,
														entry._balance as number
													)}
										</Fragment>
									))}

									{/* Empty state */}
									{entriesWithBalance.length === 0 && !isAddingHere && (
										<TableEmpty>
											No expenses recorded for this voucher.
										</TableEmpty>
									)}
								</TableBody>
							</Table>
						</div>
					</div>
				)}
			</div>
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
			label: 'Debit',
			tone: 'green' as const,
			money: true,
			icon: ArrowUpCircleIcon,
		},
		{
			key: 'totalReceived',
			label: 'Credit',
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

					{/* ── Cards ── */}
					<div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-1 min-h-0 flex flex-col">
						{/* Search + Controls */}
						<div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
							<div className="relative flex-1 min-w-[200px] max-w-md">
								<Input
									placeholder="Search by voucher #, paid to…"
									value={search}
									onChange={(e) => {
										setSearch(e.target.value);
										setPage(1);
									}}
								/>
							</div>
							<div className="flex items-center gap-1 ml-auto">
								<Button variant="ghost" size="sm" onClick={expandAll}>
									Expand All
								</Button>
								<Button variant="ghost" size="sm" onClick={collapseAll}>
									Collapse All
								</Button>
							</div>
						</div>

						{/* Card Area */}
						<div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
							{listQuery.isLoading ? (
								<div className="flex items-center justify-center py-12">
									<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
									<span className="ml-3 text-gray-600">Loading…</span>
								</div>
							) : entries.length === 0 ? (
								<div className="text-center py-12">
									<BanknotesIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
									<p className="text-gray-600">No vouchers found</p>
								</div>
							) : (
								entries.map(renderVoucherCard)
							)}
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
