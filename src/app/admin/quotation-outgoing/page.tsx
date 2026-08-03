'use client';

/**
 * Quotation (Incoming) — quotations received from vendors.
 * Simple CRUD for vendor quotations (vendor name, amount, status).
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
	PaperAirplaneIcon,
	CheckCircleIcon,
	XCircleIcon,
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
import { R, pctOf, toNumber } from '@/lib/money';
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
	{ value: 'sent', label: 'Sent' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'rejected', label: 'Rejected' },
	{ value: 'expired', label: 'Expired' },
];

const STATUS_BADGE: Record<string, string> = {
	draft: 'bg-slate-100 text-slate-700',
	sent: 'bg-sky-100 text-sky-700',
	approved: 'bg-emerald-100 text-emerald-700',
	rejected: 'bg-rose-100 text-rose-700',
	expired: 'bg-amber-100 text-amber-700',
};

const schema = z.object({
	quotation_number: z.string().nullable().optional(),
	quotation_date: z.string().nullable().optional(),
	vendor_name: z.string().min(1, 'Vendor name is required'),
	vendor_email: z
		.string()
		.email('Invalid email')
		.nullable()
		.optional()
		.or(z.literal('')),
	vendor_phone: z.string().nullable().optional(),
	vendor_address: z.string().nullable().optional(),
	subject: z.string().nullable().optional(),
	subtotal: z.coerce.number().min(0).optional(),
	tax_rate: z.coerce.number().min(0).optional(),
	tax_amount: z.coerce.number().min(0).optional(),
	discount: z.coerce.number().min(0).optional(),
	total: z.coerce.number().min(0).optional(),
	valid_until: z.string().nullable().optional(),
	notes: z.string().nullable().optional(),
	terms: z.string().nullable().optional(),
	status: z
		.enum(['draft', 'sent', 'approved', 'rejected', 'expired'])
		.optional(),
});

const defaultValues = {
	quotation_number: '',
	quotation_date: '',
	vendor_name: '',
	vendor_email: '',
	vendor_phone: '',
	vendor_address: '',
	subject: '',
	subtotal: '',
	tax_rate: 18,
	tax_amount: '',
	discount: '',
	total: '',
	valid_until: '',
	notes: '',
	terms: '',
	status: 'draft',
};

const formFields: FormField[] = [
	{
		name: 'quotation_number',
		label: 'Quotation #',
		hint: 'Auto-generated if blank',
	},
	{ name: 'quotation_date', label: 'Quotation Date', type: 'date' },
	{ name: 'vendor_name', label: 'Vendor Name', required: true },
	{ name: 'vendor_email', label: 'Vendor Email', type: 'email' },
	{ name: 'vendor_phone', label: 'Vendor Phone' },
	{
		name: 'vendor_address',
		label: 'Vendor Address',
		type: 'textarea',
		fullWidth: true,
	},
	{ name: 'subject', label: 'Subject', fullWidth: true },
	{ name: 'subtotal', label: 'Subtotal', type: 'number', step: '0.01' },
	{ name: 'tax_rate', label: 'Tax Rate (%)', type: 'number', step: '0.01' },
	{
		name: 'tax_amount',
		label: 'Tax Amount',
		type: 'number',
		step: '0.01',
		computed: {
			dependsOn: ['subtotal', 'tax_rate'],
			calculate: (values) =>
				toNumber(
					pctOf(
						(values.subtotal as number) || 0,
						(values.tax_rate as number) || 0
					)
				),
		},
	},
	{ name: 'discount', label: 'Discount', type: 'number', step: '0.01' },
	{
		name: 'total',
		label: 'Total',
		type: 'number',
		step: '0.01',
		computed: {
			dependsOn: ['subtotal', 'tax_rate', 'discount'],
			calculate: (values) => {
				const sub = R((values.subtotal as number) || 0);
				const tax = pctOf(sub, (values.tax_rate as number) || 0);
				return toNumber(sub.add(tax).minus((values.discount as number) || 0));
			},
		},
	},
	{ name: 'valid_until', label: 'Valid Until', type: 'date' },
	{
		name: 'status',
		label: 'Status',
		type: 'select',
		options: STATUS_OPTIONS.filter((o) => o.value !== 'all'),
	},
	{ name: 'notes', label: 'Notes', type: 'textarea', fullWidth: true },
	{
		name: 'terms',
		label: 'Terms & Conditions',
		type: 'textarea',
		fullWidth: true,
	},
];

const columns: Column[] = [
	{ key: 'quotation_number', label: 'Quotation #', headClassName: 'w-32' },
	{ key: 'quotation_date', label: 'Date', date: true, headClassName: 'w-28' },
	{ key: 'vendor_name', label: 'Vendor' },
	{ key: 'subject', label: 'Subject' },
	{
		key: 'total',
		label: 'Total',
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
				className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[String(row.status)] || STATUS_BADGE.draft}`}
			>
				{(row.status as string) || 'draft'}
			</span>
		),
	},
];

const statsConfig: StatsConfig[] = [
	{ key: 'total', label: 'Total', tone: 'purple', icon: DocumentTextIcon },
	{ key: 'draft', label: 'Draft', tone: 'slate', icon: DocumentTextIcon },
	{ key: 'sent', label: 'Sent', tone: 'sky', icon: PaperAirplaneIcon },
	{ key: 'approved', label: 'Approved', tone: 'green', icon: CheckCircleIcon },
	{ key: 'rejected', label: 'Rejected', tone: 'rose', icon: XCircleIcon },
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

function OutgoingQuotationPageInner() {
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
		queryKey: ['outgoing-quotations', { search, status: statusFilter, page }],
		queryFn: () =>
			apiGet('/api/admin/outgoing-quotations', {
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
		if (!window.confirm('Are you sure you want to delete this quotation?')) {
			return;
		}
		try {
			await apiDelete(`/api/admin/outgoing-quotations/${row.id}`);
			toast.success('Quotation deleted');
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
								Quotation (Incoming)
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Quotations received from vendors
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
								Add Quotation (Incoming)
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
									placeholder="Search by number, vendor, subject…"
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
					title="Quotation (Incoming)"
					endpoint="/api/admin/outgoing-quotations"
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

export default function OutgoingQuotationPage() {
	return (
		<Suspense fallback={null}>
			<OutgoingQuotationPageInner />
		</Suspense>
	);
}
