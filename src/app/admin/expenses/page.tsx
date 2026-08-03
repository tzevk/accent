'use client';

/**
 * Expense — company expenses, reimbursements, and approvals.
 * Simple CRUD for expense records (category, vendor, amounts, status).
 */

import { Suspense, useState } from 'react';
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
	ArrowUturnLeftIcon,
	PlusIcon,
	ArrowPathIcon,
	EyeIcon,
	PencilIcon,
	TrashIcon,
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
	{ value: 'reimbursed', label: 'Reimbursed' },
];

const CATEGORY_OPTIONS = [
	{ value: 'Travel', label: 'Travel' },
	{ value: 'Meals', label: 'Meals & Entertainment' },
	{ value: 'Office Supplies', label: 'Office Supplies' },
	{ value: 'Software', label: 'Software / Subscriptions' },
	{ value: 'Hardware', label: 'Hardware / Equipment' },
	{ value: 'Utilities', label: 'Utilities' },
	{ value: 'Marketing', label: 'Marketing' },
	{ value: 'Professional Services', label: 'Professional Services' },
	{ value: 'Rent', label: 'Rent' },
	{ value: 'Salary', label: 'Salary' },
	{ value: 'Other', label: 'Other' },
];

const STATUS_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	submitted: 'bg-amber-100 text-amber-700',
	approved: 'bg-sky-100 text-sky-700',
	rejected: 'bg-rose-100 text-rose-700',
	reimbursed: 'bg-emerald-100 text-emerald-700',
};

const PAYMENT_MODES = [
	{ value: 'cash', label: 'Cash' },
	{ value: 'bank', label: 'Bank Transfer' },
	{ value: 'cheque', label: 'Cheque' },
	{ value: 'card', label: 'Card' },
	{ value: 'upi', label: 'UPI' },
	{ value: 'other', label: 'Other' },
];

const schema = z.object({
	expense_number: z.string().nullable().optional(),
	expense_date: z.string().nullable().optional(),
	category: z.string().min(1, 'Category is required'),
	sub_category: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	vendor_name: z.string().nullable().optional(),
	amount: z.coerce.number().min(0, 'Amount must be ≥ 0'),
	tax_amount: z.coerce.number().min(0).optional(),
	total_amount: z.coerce.number().min(0).optional(),
	currency: z.string().nullable().optional(),
	payment_mode: z
		.enum(['cash', 'bank', 'cheque', 'card', 'upi', 'other'])
		.optional(),
	payment_reference: z.string().nullable().optional(),
	paid_to: z.string().nullable().optional(),
	receipt_url: z.string().nullable().optional(),
	is_billable: z.coerce.boolean().optional(),
	is_reimbursable: z.coerce.boolean().optional(),
	project_id: z.coerce.number().int().optional(),
	department: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	status: z
		.enum(['draft', 'submitted', 'approved', 'rejected', 'reimbursed'])
		.optional(),
});

const defaultValues = {
	expense_number: '',
	expense_date: '',
	category: 'Other',
	sub_category: '',
	description: '',
	vendor_name: '',
	amount: '',
	tax_amount: '',
	total_amount: '',
	currency: 'INR',
	payment_mode: 'bank',
	payment_reference: '',
	paid_to: '',
	receipt_url: '',
	is_billable: false,
	is_reimbursable: false,
	department: '',
	notes: '',
	status: 'submitted',
};

const formFields: FormField[] = [
	{
		name: 'expense_number',
		label: 'Expense #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'expense_date', label: 'Expense Date', type: 'date' },
	{
		name: 'category',
		label: 'Category',
		type: 'select',
		required: true,
		options: CATEGORY_OPTIONS,
	},
	{ name: 'sub_category', label: 'Sub-category' },
	{ name: 'vendor_name', label: 'Vendor / Merchant' },
	{ name: 'paid_to', label: 'Paid To' },
	{ name: 'department', label: 'Department' },
	{
		name: 'description',
		label: 'Description',
		type: 'textarea',
		fullWidth: true,
	},
	{
		name: 'amount',
		label: 'Amount',
		type: 'number',
		step: '0.01',
		required: true,
	},
	{ name: 'tax_amount', label: 'Tax', type: 'number', step: '0.01' },
	{ name: 'total_amount', label: 'Total', type: 'number', step: '0.01' },
	{ name: 'currency', label: 'Currency' },
	{
		name: 'payment_mode',
		label: 'Payment Mode',
		type: 'select',
		options: PAYMENT_MODES,
	},
	{ name: 'payment_reference', label: 'Payment Reference' },
	{ name: 'receipt_url', label: 'Receipt URL', fullWidth: true },
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS.filter((o) => o.value !== 'all'),
	},
	{ name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
];

const columns: Column[] = [
	{ key: 'expense_number', label: 'Expense #', headClassName: 'w-32' },
	{ key: 'expense_date', label: 'Date', date: true, headClassName: 'w-28' },
	{ key: 'category', label: 'Category', headClassName: 'w-40' },
	{ key: 'vendor_name', label: 'Vendor' },
	{ key: 'paid_to', label: 'Paid To' },
	{
		key: 'payment_mode',
		label: 'Mode',
		headClassName: 'w-24',
	},
	{
		key: 'total_amount',
		label: 'Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-28',
		render: (row) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[String(row.status)] || STATUS_BADGE.submitted}`}
			>
				{(row.status as string) || 'submitted'}
			</span>
		),
	},
];

const statsConfig: StatsConfig[] = [
	{ key: 'total', label: 'Total', tone: 'purple', icon: DocumentTextIcon },
	{
		key: 'submitted',
		label: 'Submitted',
		tone: 'amber',
		icon: PaperAirplaneIcon,
	},
	{ key: 'approved', label: 'Approved', tone: 'sky', icon: CheckCircleIcon },
	{
		key: 'reimbursed',
		label: 'Reimbursed',
		tone: 'green',
		icon: ArrowUturnLeftIcon,
	},
	{ key: 'rejected', label: 'Rejected', tone: 'rose', icon: XCircleIcon },
	{ key: 'totalAmount', label: 'Total Amount', tone: 'purple', money: true },
	{ key: 'approvedAmount', label: 'Approved', tone: 'sky', money: true },
	{ key: 'reimbursedAmount', label: 'Reimbursed', tone: 'green', money: true },
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

function ExpensesPageInner() {
	const urlSearchParams = useSearchParams();
	const initialSearch = urlSearchParams?.get('search') ?? '';
	const [search, setSearch] = useState(initialSearch);
	const [statusFilter, setStatusFilter] = useState('all');
	const [page, setPage] = useState(1);
	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });

	const listQuery = useQuery<ApiListResponse>({
		queryKey: ['expenses', { search, status: statusFilter, page }],
		queryFn: () =>
			apiGet('/api/admin/expenses', {
				search,
				status: statusFilter,
				page,
				limit: PAGE_SIZE,
			}),
	});

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
		if (!window.confirm('Are you sure you want to delete this expense?')) {
			return;
		}
		try {
			await apiDelete(`/api/admin/expenses/${row.id}`);
			toast.success('Expense deleted');
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
							<h1 className="text-2xl font-bold text-gray-900">Expense</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Track company expenses, reimbursements, and approvals
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
							<Button size="sm" onClick={openCreate}>
								<PlusIcon className="h-4 w-4" />
								Add Expense
							</Button>
						</div>
					</header>

					{statsConfig.length > 0 ? (
						<div className="flex gap-4 mb-6">
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
									placeholder="Search by expense #, vendor, paid to…"
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
														<TableCell key={c.key} className={c.cellClassName}>
															{display ?? '—'}
														</TableCell>
													);
												})}
												<TableCell className="text-center">
													<div className="inline-flex items-center gap-1">
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
				</div>
			</div>

			{modalState.mode ? (
				<ResourceFormModal
					mode={modalState.mode}
					row={modalState.row}
					title="Expense"
					endpoint="/api/admin/expenses"
					defaultValues={defaultValues}
					zodSchema={schema}
					formFields={formFields}
					onClose={closeModal}
					onSaved={() => {
						closeModal();
						listQuery.refetch();
					}}
				/>
			) : null}
		</div>
	);
}

export default function ExpensesPage() {
	return (
		<Suspense fallback={null}>
			<ExpensesPageInner />
		</Suspense>
	);
}
