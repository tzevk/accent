'use client';

/**
 * Payment Issued to client — payments issued to clients/vendors against
 * invoices (full or part), with deductions and bank reference.
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
	ExclamationCircleIcon,
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
import { sub } from '@/lib/money';
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
	{ value: 'full', label: 'Full' },
	{ value: 'part', label: 'Part' },
];

const STATUS_BADGE: Record<string, string> = {
	full: 'bg-emerald-100 text-emerald-700',
	part: 'bg-amber-100 text-amber-700',
};

const schema = z.object({
	payee_name: z.string().min(1, 'Client/Vendor name is required'),
	payee_type: z.enum(['company', 'vendor']).optional(),
	invoice_number: z.string().nullable().optional(),
	invoice_date: z.string().nullable().optional(),
	invoice_amount: z.coerce.number().min(0).optional(),
	amount: z.coerce.number().min(0).optional(),
	deduction: z.coerce.number().min(0).optional(),
	net_amount: z.coerce.number().min(0).optional(),
	issue_date: z.string().nullable().optional(),
	transaction_reference: z.string().nullable().optional(),
	bank_name: z.string().nullable().optional(),
	status: z.enum(['full', 'part']).optional(),
	notes: z.string().nullable().optional(),
});

const defaultValues = {
	payee_name: '',
	payee_type: 'company',
	invoice_number: '',
	invoice_date: '',
	invoice_amount: '',
	amount: '',
	deduction: '',
	net_amount: '',
	issue_date: '',
	transaction_reference: '',
	bank_name: '',
	status: 'full',
	notes: '',
};

const invoiceLabelFn = (item: Record<string, unknown>) => {
	const inv = item.invoice_number || '';
	const client = item.client_name || '';
	const net = formatCurrency(item.net_amount as number);
	const gst = formatCurrency(item.tax_amount as number);
	const total = formatCurrency(item.gross_amount as number);
	return `${inv} — ${client} | Net: ${net} | GST: ${gst} | Total: ${total}`;
};

const payeeLabelFn = (item: Record<string, unknown>) => {
	const name = item.name || '';
	const type = item.type === 'vendor' ? '[Vendor]' : '[Company]';
	const city = item.city || '';
	return `${name} ${type}${city ? ` — ${city}` : ''}`;
};

const bankLabelFn = (item: Record<string, unknown>) => {
	const bankName = item.BankName || item.bank_name || '';
	const accountNo = item.AccountNumber || item.account_no || '';
	return accountNo ? `${bankName} (${accountNo})` : String(bankName);
};

const formFields: FormField[] = [
	{
		name: 'payee_name',
		label: 'Client / Vendor Name',
		type: 'searchableSelect',
		searchableEndpoint: '/api/admin/payee-list',
		searchableValueKey: 'name',
		searchableLabelFn: payeeLabelFn,
		searchableFillFields: { name: 'payee_name', type: 'payee_type' },
	},
	{
		name: 'invoice_number',
		label: 'Invoice Number',
		type: 'searchableSelect',
		searchableEndpoint: '/api/admin/invoice-list',
		searchableValueKey: 'invoice_number',
		searchableLabelFn: invoiceLabelFn,
		searchableFillFields: {
			invoice_date: 'invoice_date',
			gross_amount: 'invoice_amount',
		},
		searchableDependency: { field: 'payee_name', itemKey: 'client_name' },
	},
	{
		name: 'invoice_date',
		label: 'Invoice Date',
		type: 'date',
		disabled: true,
	},
	{
		name: 'invoice_amount',
		label: 'Invoice Amount',
		type: 'number',
		step: '0.01',
		disabled: true,
	},
	{
		name: 'amount',
		label: 'Amount (Invoice Amount)',
		type: 'number',
		step: '0.01',
		required: true,
	},
	{
		name: 'deduction',
		label: 'Deduction',
		type: 'number',
		step: '0.01',
	},
	{
		name: 'net_amount',
		label: 'Net Amount (Invoice Amount - Deduction)',
		type: 'number',
		step: '0.01',
		computed: {
			dependsOn: ['amount', 'deduction'],
			calculate: (values) =>
				sub(
					Number(values.amount) || 0,
					Number(values.deduction) || 0
				).toNumber(),
		},
	},
	{ name: 'issue_date', label: 'Issue Date', type: 'date' },
	{ name: 'transaction_reference', label: 'Transaction Ref' },
	{
		name: 'bank_name',
		label: 'Bank Name',
		type: 'searchableSelect',
		searchableEndpoint: '/api/masters/banks',
		searchableValueKey: 'BankName',
		searchableLabelFn: bankLabelFn,
	},
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: [
			{ value: 'full', label: 'Full' },
			{ value: 'part', label: 'Part' },
		],
	},
	{
		name: 'notes',
		label: 'Notes',
		type: 'textarea',
		fullWidth: true,
	},
];

const columns: Column[] = [
	{ key: 'payee_name', label: 'Client / Vendor' },
	{ key: 'invoice_number', label: 'Invoice #', headClassName: 'w-32' },
	{
		key: 'invoice_amount',
		label: 'Invoice Amt',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right',
	},
	{
		key: 'amount',
		label: 'Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'deduction',
		label: 'Deduction',
		money: true,
		headClassName: 'w-28 text-right',
		cellClassName: 'text-right',
	},
	{
		key: 'net_amount',
		label: 'Net Amount',
		money: true,
		headClassName: 'w-32 text-right',
		cellClassName: 'text-right font-medium',
	},
	{
		key: 'issue_date',
		label: 'Issue Date',
		date: true,
		headClassName: 'w-28',
	},
	{
		key: 'transaction_reference',
		label: 'Transaction Ref',
		headClassName: 'w-36',
	},
	{ key: 'bank_name', label: 'Bank', headClassName: 'w-32' },
	{
		key: 'status',
		label: 'Status',
		headClassName: 'w-24',
		render: (row) => (
			<span
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[String(row.status)] || 'bg-slate-100 text-slate-500'}`}
			>
				{row.status === 'full' ? 'Full' : 'Part'}
			</span>
		),
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
		key: 'full',
		label: 'Full',
		tone: 'green',
		icon: CheckCircleIcon,
	},
	{
		key: 'part',
		label: 'Part',
		tone: 'amber',
		icon: ExclamationCircleIcon,
	},
	{
		key: 'totalAmount',
		label: 'Total Amount',
		tone: 'purple',
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

function PaymentIssuePageInner() {
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
		queryKey: ['payment-issues', { search, status: statusFilter, page }],
		queryFn: () =>
			apiGet('/api/admin/payment-issues', {
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
		if (
			!window.confirm('Are you sure you want to delete this payment issue?')
		) {
			return;
		}
		try {
			await apiDelete(`/api/admin/payment-issues/${row.id}`);
			toast.success('Payment issue deleted');
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
								Payment Issued to client
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Payments issued to clients
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
								Add Payment Issued to client
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
									placeholder="Search by payee, invoice, transaction ref, bank…"
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
								className="w-32"
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
					title="Payment Issued to client"
					endpoint="/api/admin/payment-issues"
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

export default function PaymentIssuePage() {
	return (
		<Suspense fallback={null}>
			<PaymentIssuePageInner />
		</Suspense>
	);
}
