'use client';

import { Suspense, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
	PlusIcon,
	ArrowPathIcon,
	EyeIcon,
	PencilIcon,
	TrashIcon,
	PrinterIcon,
	DocumentTextIcon,
	CurrencyDollarIcon,
	CheckCircleIcon,
	AdjustmentsHorizontalIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
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
import { Input } from '@/components/ui/form-fields';
import { apiGet, apiDelete } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';
import { add } from '@/lib/money';
import ResourceFormModal from '@/components/admin/ResourceFormModal';
import type {
	ModalMode,
	ApiListResponse,
	FormField,
	StatsConfig,
	StatTone,
} from '@/types/admin';

const schema = z.object({
	company_name: z.string().min(1, 'Company name is required'),
	city: z.string().optional(),
	receipt_no: z.string().optional(),
	receipt_date: z.string().nullable().optional(),
	amount: z.coerce.number().min(0).optional(),
	payment_date: z.string().nullable().optional(),
	transaction_id: z.string().optional(),
	invoice_no: z.string().optional(),
	invoice_date: z.string().nullable().optional(),
	invoice_amount: z.coerce.number().min(0).optional(),
	payment_type: z.enum(['full', 'partial']).or(z.literal('')).optional(),
	tds_amount: z.coerce.number().min(0).optional(),
	gst_amount: z.coerce.number().min(0).optional(),
	net_amount: z.coerce.number().min(0).optional(),
});

const defaultValues = {
	company_name: '',
	city: '',
	receipt_no: '',
	receipt_date: '',
	amount: '',
	payment_date: '',
	transaction_id: '',
	invoice_no: '',
	invoice_date: '',
	invoice_amount: '',
	payment_type: '',
	tds_amount: '',
	gst_amount: '',
	net_amount: '',
};

const invoiceLabelFn = (item: Record<string, unknown>) => {
	const inv = item.invoice_number || '';
	const client = item.client_name || '';
	const net = formatCurrency(item.net_amount as number);
	const gst = formatCurrency(item.tax_amount as number);
	const total = formatCurrency(item.gross_amount as number);
	return `${inv} — ${client} | Net: ${net} | GST: ${gst} | Total: ${total}`;
};

const formFields: FormField[] = [
	{
		name: 'company_name',
		label: 'Company Name',
		required: true,
		type: 'searchableSelect',
		companyAutofill: true,
	},
	{ name: 'city', label: 'City' },
	{
		name: 'receipt_no',
		label: 'Receipt No',
		hint: 'Auto-generated if blank',
	},
	{ name: 'receipt_date', label: 'Receipt Date', type: 'date' },
	{
		name: 'invoice_no',
		label: 'Invoice No',
		type: 'searchableSelect',
		searchableEndpoint: '/api/admin/invoices?limit=500',
		searchableValueKey: 'invoice_number',
		searchableLabelFn: invoiceLabelFn,
		searchableFillFields: {
			invoice_date: 'invoice_date',
			gross_amount: 'invoice_amount',
		},
		searchableDependency: { field: 'company_name', itemKey: 'client_name' },
	},
	{ name: 'invoice_date', label: 'Invoice Date', type: 'date' },
	{
		name: 'invoice_amount',
		label: 'Invoice Amount',
		type: 'number',
		step: '0.01',
		disabled: true,
		fullWidth: true,
	},
	{
		name: 'amount',
		label: 'Amount',
		type: 'number',
		step: '0.01',
		required: true,
	},
	{
		name: 'tds_amount',
		label: 'TDS',
		type: 'number',
		step: '0.01',
	},
	{
		name: 'gst_amount',
		label: 'GST',
		type: 'number',
		step: '0.01',
	},
	{
		name: 'net_amount',
		label: 'Net Amount',
		type: 'number',
		step: '0.01',
		computed: {
			dependsOn: ['amount', 'gst_amount', 'tds_amount'],
			calculate: (values: Record<string, unknown>) =>
				add(
					Number(values.amount) || 0,
					Number(values.gst_amount) || 0,
					Number(values.tds_amount) || 0
				).toNumber(),
		},
	},
	{ name: 'payment_date', label: 'Payment Date', type: 'date' },
	{ name: 'transaction_id', label: 'Transaction ID' },
	{
		name: 'payment_type',
		label: 'Payment Type',
		type: 'select',
		options: [
			{ value: 'full', label: 'Full Payment' },
			{ value: 'partial', label: 'Part Payment' },
		],
	},
];

const statsConfig: StatsConfig[] = [
	{
		key: 'total',
		label: 'Total Entries',
		tone: 'slate',
		icon: DocumentTextIcon,
	},
	{
		key: 'totalAmount',
		label: 'Total Amount',
		tone: 'purple',
		icon: CurrencyDollarIcon,
		money: true,
	},
	{
		key: 'full',
		label: 'Full Payments',
		tone: 'green',
		icon: CheckCircleIcon,
	},
	{
		key: 'partial',
		label: 'Partial Payments',
		tone: 'amber',
		icon: AdjustmentsHorizontalIcon,
	},
	{
		key: 'tdsAmount',
		label: 'TDS Amount',
		tone: 'rose',
		money: true,
	},
	{
		key: 'netAmount',
		label: 'Net Amount',
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

function PaymentEntryPageInner() {
	const urlSearchParams = useSearchParams();
	const initialSearch = urlSearchParams?.get('search') ?? '';
	const [search, setSearch] = useState(initialSearch);
	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });
	const [printingId, setPrintingId] = useState<string | null>(null);

	const listQuery = useQuery<ApiListResponse>({
		queryKey: ['payment-entries', { search }],
		queryFn: () => apiGet('/api/admin/payment-entries', { search }),
	});

	const rows = listQuery.data?.data ?? [];
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
			!window.confirm(`Are you sure you want to delete this payment entry?`)
		) {
			return;
		}
		try {
			await apiDelete(`/api/admin/payment-entries/${row.id}`);
			toast.success('Payment entry deleted');
			listQuery.refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Delete failed');
		}
	};

	const handlePrint = useCallback(async (row: Record<string, unknown>) => {
		setPrintingId(row.id as string);
		try {
			const res = await fetch('/api/admin/payment-entries/get-receipt-pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					receipt_no: row.receipt_no || '-',
					receipt_date: row.receipt_date || '-',
					company_name: row.company_name || '-',
					amount: Number(row.amount) || 0,
					transaction_id: row.transaction_id || '-',
					payment_date: row.payment_date || '-',
					bank_name: '',
					remark: '',
					invoice_no: row.invoice_no || '-',
					invoice_date: row.invoice_date || '-',
					payment_type: row.payment_type || '',
				}),
			});

			if (!res.ok) throw new Error('Failed to generate PDF');

			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Receipt_${row.receipt_no || 'Draft'}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);
		} catch {
			toast.error('Failed to download receipt');
		} finally {
			setPrintingId(null);
		}
	}, []);

	const printAction = useCallback(
		(row: Record<string, unknown>) => {
			const isPrinting = printingId === (row.id as string);
			return (
				<button
					onClick={() => handlePrint(row)}
					disabled={isPrinting}
					className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
					title="Print Receipt"
				>
					{isPrinting ? (
						<ArrowPathIcon className="h-4 w-4 animate-spin" />
					) : (
						<PrinterIcon className="h-4 w-4" />
					)}
				</button>
			);
		},
		[handlePrint, printingId]
	);

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col pt-2 pb-4 px-2 sm:px-4 overflow-hidden">
				<div className="max-w-full mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5">
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Payment Received from client
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								Payments received from client
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
								Add Payment Received from client
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
									placeholder="Search company, receipt, transaction…"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
								/>
							</div>
						</div>

						<div className="flex-1 min-h-0 overflow-auto">
							<Table>
								<TableHeader>
									<TableRow className="sticky top-0 z-10 bg-white">
										<TableHead className="w-auto">Company Name</TableHead>
										<TableHead className="w-32">Receipt No</TableHead>
										<TableHead className="w-32 text-right">Amount</TableHead>
										<TableHead className="w-24">Type</TableHead>
										<TableHead className="w-40">Transaction ID</TableHead>
										<TableHead className="w-28">Date</TableHead>
										<TableHead className="text-center">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{listQuery.isLoading ? (
										<TableEmpty>Loading…</TableEmpty>
									) : rows.length === 0 ? (
										<TableEmpty>No records found.</TableEmpty>
									) : (
										rows.map((row) => {
											const amount = row.amount as number;
											const paymentType = row.payment_type as string;
											const receiptDate = row.receipt_date as string;
											return (
												<TableRow key={row.id as string}>
													<TableCell>
														{(row.company_name as string) ?? '—'}
													</TableCell>
													<TableCell>
														{(row.receipt_no as string) ?? '—'}
													</TableCell>
													<TableCell className="text-right font-medium">
														{formatCurrency(amount)}
													</TableCell>
													<TableCell>
														{paymentType === 'full'
															? 'Full'
															: paymentType === 'partial'
																? 'Partial'
																: '—'}
													</TableCell>
													<TableCell>
														{(row.transaction_id as string) ?? '—'}
													</TableCell>
													<TableCell>{formatDate(receiptDate)}</TableCell>
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
															{printAction(row)}
														</div>
													</TableCell>
												</TableRow>
											);
										})
									)}
								</TableBody>
							</Table>
						</div>
					</div>
				</div>
			</div>

			{modalState.mode ? (
				<ResourceFormModal
					mode={modalState.mode}
					row={modalState.row}
					title="Payment Received from client"
					endpoint="/api/admin/payment-entries"
					defaultValues={defaultValues}
					zodSchema={schema}
					formFields={formFields}
					companyListEndpoint="/api/companies"
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

export default function PaymentEntryPage() {
	return (
		<Suspense fallback={null}>
			<PaymentEntryPageInner />
		</Suspense>
	);
}
