'use client';

import { useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowLeftIcon,
	ArrowPathIcon,
	XMarkIcon,
	BanknotesIcon,
	DocumentTextIcon,
	ScaleIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────────

interface InvoiceDetail {
	invoice_number: string;
	invoice_date: string | null;
	due_date: string | null;
	net_amount: number;
	amount_paid: number;
	balance_due: number;
	status: string;
}

interface PaymentDetail {
	receipt_no: string | null;
	receipt_date: string | null;
	payment_date: string | null;
	amount: number;
	net_amount: number;
	tds_amount: number;
	gst_amount: number;
	payment_type: string | null;
	invoice_no: string | null;
	transaction_id: string | null;
	bank_name: string | null;
}

interface QuotationDetail {
	quotation_number: string | null;
	quotation_date: string | null;
	amount: number;
	status: string;
}

interface ReceivableDetail {
	reference_number: string;
	invoice_number: string | null;
	invoice_date: string | null;
	due_date: string | null;
	invoice_amount: number;
	paid_amount: number;
	balance_due: number;
	status: string;
	received_date: string | null;
	payment_mode: string | null;
}

interface DetailResponse {
	success: boolean;
	client_name: string;
	invoices: InvoiceDetail[];
	payments: PaymentDetail[];
	quotations: QuotationDetail[];
	receivables: ReceivableDetail[];
	error?: string;
}

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: Record<string, { permission?: string } | undefined>;
				};
			};
		};
	};
}

interface SessionUser {
	is_super_admin?: boolean | number | null;
	field_permissions?: FieldPermissionsShape | string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function hasProjectActivitiesFieldPermission(
	user: SessionUser | null | undefined
): boolean {
	if (!user) return false;
	if (user.is_super_admin) return true;
	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms) as FieldPermissionsShape;
		} catch {
			fieldPerms = null;
		}
	}
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	if (!section?.enabled) return false;
	const perm = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return (
		perm === 'view' || perm === 'edit' || legacy === 'view' || legacy === 'edit'
	);
}

function fmtAmount(n: number): string {
	return n.toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

function fmtDate(d: string | null): string {
	if (!d) return '\u2014';
	return new Date(d).toLocaleDateString('en-IN');
}

// ── Status badge helpers ───────────────────────────────────────────────

function invoiceStatusBadge(status: string) {
	const map: Record<string, string> = {
		paid: 'bg-green-100 text-green-700',
		fully_paid: 'bg-green-100 text-green-700',
		partially_paid: 'bg-blue-100 text-blue-700',
		sent: 'bg-amber-100 text-amber-700',
		draft: 'bg-gray-100 text-gray-600',
		overdue: 'bg-red-100 text-red-700',
		cancelled: 'bg-gray-100 text-gray-500',
	};
	const cls = map[status] || 'bg-gray-100 text-gray-600';
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${cls}`}
		>
			{status.replace(/_/g, ' ')}
		</span>
	);
}

function paymentTypeBadge(paymentType: string | null) {
	if (!paymentType) return <span className="text-gray-300">\u2014</span>;
	const map: Record<string, string> = {
		full: 'bg-green-100 text-green-700',
		partial: 'bg-blue-100 text-blue-700',
	};
	const cls = map[paymentType] || 'bg-gray-100 text-gray-600';
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${cls}`}
		>
			{paymentType}
		</span>
	);
}

function quoteStatusBadge(status: string) {
	const map: Record<string, string> = {
		approved: 'bg-green-100 text-green-700',
		sent: 'bg-blue-100 text-blue-700',
		draft: 'bg-gray-100 text-gray-600',
		rejected: 'bg-red-100 text-red-700',
	};
	const cls = map[status] || 'bg-gray-100 text-gray-600';
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${cls}`}
		>
			{status}
		</span>
	);
}

function arStatusBadge(status: string) {
	const map: Record<string, string> = {
		received: 'bg-green-100 text-green-700',
		partial: 'bg-blue-100 text-blue-700',
		pending: 'bg-amber-100 text-amber-700',
		overdue: 'bg-red-100 text-red-700',
		written_off: 'bg-gray-100 text-gray-500',
	};
	const cls = map[status] || 'bg-gray-100 text-gray-600';
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${cls}`}
		>
			{status.replace(/_/g, ' ')}
		</span>
	);
}

// ── Component ──────────────────────────────────────────────────────────

export default function ClientBalanceDetailPage() {
	const params = useParams();
	const searchParams = useSearchParams();
	const client = decodeURIComponent(String(params.client));
	const fromDate = searchParams.get('from_date') || '';
	const toDate = searchParams.get('to_date') || '';

	const {
		loading: authLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC() as {
		loading: boolean;
		user: SessionUser | null;
		can: (resource: string, permission: string) => boolean;
		RESOURCES: { REPORTS: string };
		PERMISSIONS: { READ: string };
	};

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	const detailQuery = useQuery<DetailResponse>({
		queryKey: ['client-detail', client, fromDate, toDate],
		queryFn: () =>
			apiGet('/api/reports/client-balance/detail', {
				client_name: client,
				from_date: fromDate || undefined,
				to_date: toDate || undefined,
			}),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		enabled: !authLoading && hasAccess,
	});

	const invoices = detailQuery.data?.invoices ?? [];
	const payments = detailQuery.data?.payments ?? [];
	const quotations = detailQuery.data?.quotations ?? [];
	const receivables = detailQuery.data?.receivables ?? [];

	const isLoading = detailQuery.isLoading || authLoading;
	const error = detailQuery.error?.message || detailQuery.data?.error;

	// ── Summary computations ────────────────────────────────────────
	const summary = useMemo(() => {
		const totalInvoiced = invoices.reduce((s, i) => s + (i.net_amount || 0), 0);
		const totalReceived = payments.reduce((s, p) => s + (p.net_amount || 0), 0);
		const netBalance = totalInvoiced - totalReceived;
		const pipeline = quotations.reduce((s, q) => s + (q.amount || 0), 0);
		return { totalInvoiced, totalReceived, netBalance, pipeline };
	}, [invoices, payments, quotations]);

	const isEmpty =
		invoices.length === 0 &&
		payments.length === 0 &&
		quotations.length === 0 &&
		receivables.length === 0;

	const backHref = `/reports/client-balance${fromDate && toDate ? `?from_date=${fromDate}&to_date=${toDate}` : ''}`;

	// ── Auth guards ─────────────────────────────────────────────────
	if (authLoading) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex items-center justify-center h-[70vh]">
					<div className="animate-pulse text-gray-400 text-sm">Loading...</div>
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex items-center justify-center h-[70vh]">
					<div className="text-center">
						<div className="bg-red-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
							<XMarkIcon className="w-7 h-7 text-red-500" />
						</div>
						<h2 className="text-lg font-bold text-gray-800 mb-1">
							Access Denied
						</h2>
						<p className="text-gray-500 text-sm">
							You don&apos;t have permission to view this report.
						</p>
					</div>
				</div>
			</div>
		);
	}

	// ── Render ──────────────────────────────────────────────────────
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* Header */}
				<div className="mb-5">
					<p className="text-xs text-gray-400 mb-0.5">
						Home <span className="mx-1 text-gray-300">/</span> Reports{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<Link
							href={backHref}
							className="text-gray-500 hover:text-purple-700 transition-colors"
						>
							Client Balance
						</Link>{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<span className="text-gray-600">{client}</span>
					</p>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="flex items-center gap-3">
							<Link
								href={backHref}
								className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 hover:text-purple-700 transition-colors"
							>
								<ArrowLeftIcon className="w-3.5 h-3.5" />
								Back
							</Link>
							<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
								{client}
							</h1>
						</div>
						<div className="flex items-center gap-2">
							<button
								onClick={() => detailQuery.refetch()}
								disabled={isLoading}
								className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition disabled:opacity-40"
							>
								<ArrowPathIcon
									className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
								/>
								Refresh
							</button>
						</div>
					</div>
				</div>

				{/* Loading */}
				{isLoading && (
					<div className="flex items-center justify-center py-20">
						<div className="animate-pulse text-gray-400 text-sm flex items-center gap-2">
							<ArrowPathIcon className="w-4 h-4 animate-spin" />
							Loading...
						</div>
					</div>
				)}

				{/* Error */}
				{!isLoading && error && (
					<div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-5">
						<div className="flex items-start gap-3">
							<XMarkIcon className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
							<div>
								<h3 className="text-sm font-semibold text-red-800 mb-1">
									Failed to load detail
								</h3>
								<p className="text-sm text-red-600">{error}</p>
								<button
									onClick={() => detailQuery.refetch()}
									className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition"
								>
									<ArrowPathIcon className="w-3 h-3" />
									Retry
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Summary cards */}
				{!isLoading && !error && (
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<DocumentTextIcon className="w-3.5 h-3.5 text-blue-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Invoiced
								</span>
							</div>
							<span className="text-xl font-bold text-gray-900">
								₹{fmtAmount(summary.totalInvoiced)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<BanknotesIcon className="w-3.5 h-3.5 text-green-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Received
								</span>
							</div>
							<span className="text-xl font-bold text-gray-900">
								₹{fmtAmount(summary.totalReceived)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<ScaleIcon className="w-3.5 h-3.5 text-orange-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Balance
								</span>
							</div>
							<span
								className={`text-xl font-bold ${
									summary.netBalance < 0
										? 'text-red-600'
										: summary.netBalance > 0
											? 'text-orange-600'
											: 'text-gray-400'
								}`}
							>
								₹{fmtAmount(summary.netBalance)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<DocumentTextIcon className="w-3.5 h-3.5 text-indigo-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Pipeline
								</span>
							</div>
							<span className="text-xl font-bold text-gray-900">
								₹{fmtAmount(summary.pipeline)}
							</span>
						</div>
					</div>
				)}

				{/* Entirely empty client */}
				{!isLoading && !error && isEmpty && (
					<div className="text-center py-16">
						<div className="bg-gray-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
							<DocumentTextIcon className="w-7 h-7 text-gray-400" />
						</div>
						<h2 className="text-lg font-bold text-gray-800 mb-1">
							No transactions
						</h2>
						<p className="text-gray-500 text-sm">
							No transactions found for {client}.
						</p>
					</div>
				)}

				{/* ── Section tables ─────────────────────────────────── */}
				{!isLoading && !error && !isEmpty && (
					<div className="space-y-5">
						{/* 1. Invoices */}
						<SectionCard
							title="Invoices"
							count={invoices.length}
							icon={<DocumentTextIcon className="w-4 h-4 text-blue-500" />}
						>
							{invoices.length === 0 ? (
								<EmptyMessage label="No invoices for this client." />
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<Th center>#</Th>
												<Th>Invoice #</Th>
												<Th>Date</Th>
												<Th>Due Date</Th>
												<Th right>Net Amount</Th>
												<Th right>Paid</Th>
												<Th right>Balance</Th>
												<Th>Status</Th>
											</tr>
										</thead>
										<tbody>
											{invoices.map((inv, i) => (
												<Tr key={inv.invoice_number} i={i}>
													<Td muted center>
														{i + 1}
													</Td>
													<Td strong>{inv.invoice_number}</Td>
													<Td>{fmtDate(inv.invoice_date)}</Td>
													<Td>{fmtDate(inv.due_date)}</Td>
													<Td right amounts>
														₹{fmtAmount(inv.net_amount)}
													</Td>
													<Td right amounts>
														₹{fmtAmount(inv.amount_paid)}
													</Td>
													<Td right amounts bold>
														<span
															className={
																inv.balance_due > 0
																	? 'text-red-600'
																	: 'text-gray-400'
															}
														>
															₹{fmtAmount(inv.balance_due)}
														</span>
													</Td>
													<Td>{invoiceStatusBadge(inv.status)}</Td>
												</Tr>
											))}
										</tbody>
										<tfoot>
											<Tr bold>
												<Td muted center>
													&nbsp;
												</Td>
												<Td strong>TOTAL</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														invoices.reduce(
															(s, i) => s + (i.net_amount || 0),
															0
														)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														invoices.reduce(
															(s, i) => s + (i.amount_paid || 0),
															0
														)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														invoices.reduce(
															(s, i) => s + (i.balance_due || 0),
															0
														)
													)}
												</Td>
												<Td>&nbsp;</Td>
											</Tr>
										</tfoot>
									</table>
								</div>
							)}
						</SectionCard>

						{/* 2. Payments */}
						<SectionCard
							title="Payments"
							count={payments.length}
							icon={<BanknotesIcon className="w-4 h-4 text-green-500" />}
						>
							{payments.length === 0 ? (
								<EmptyMessage label="No payments for this client." />
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<Th center>#</Th>
												<Th>Receipt #</Th>
												<Th>Date</Th>
												<Th right>Gross</Th>
												<Th right>TDS</Th>
												<Th right>GST</Th>
												<Th right>Net</Th>
												<Th>Type</Th>
												<Th>Invoice #</Th>
												<Th>Bank</Th>
												<Th>Txn ID</Th>
											</tr>
										</thead>
										<tbody>
											{payments.map((p, i) => (
												<Tr key={p.receipt_no || `p-${i}`} i={i}>
													<Td muted center>
														{i + 1}
													</Td>
													<Td strong>{p.receipt_no || '\u2014'}</Td>
													<Td>{fmtDate(p.payment_date || p.receipt_date)}</Td>
													<Td right amounts>
														₹{fmtAmount(p.amount)}
													</Td>
													<Td right amounts muted>
														₹{fmtAmount(p.tds_amount)}
													</Td>
													<Td right amounts muted>
														₹{fmtAmount(p.gst_amount)}
													</Td>
													<Td right amounts>
														₹{fmtAmount(p.net_amount)}
													</Td>
													<Td>{paymentTypeBadge(p.payment_type)}</Td>
													<Td>{p.invoice_no || '\u2014'}</Td>
													<Td>{p.bank_name || '\u2014'}</Td>
													<Td>{p.transaction_id || '\u2014'}</Td>
												</Tr>
											))}
										</tbody>
										<tfoot>
											<Tr bold>
												<Td muted center>
													&nbsp;
												</Td>
												<Td strong>TOTAL</Td>
												<Td>&nbsp;</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														payments.reduce((s, p) => s + (p.amount || 0), 0)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														payments.reduce(
															(s, p) => s + (p.tds_amount || 0),
															0
														)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														payments.reduce(
															(s, p) => s + (p.gst_amount || 0),
															0
														)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														payments.reduce(
															(s, p) => s + (p.net_amount || 0),
															0
														)
													)}
												</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
											</Tr>
										</tfoot>
									</table>
								</div>
							)}
						</SectionCard>

						{/* 3. Quotes */}
						<SectionCard
							title="Quotes"
							count={quotations.length}
							icon={<DocumentTextIcon className="w-4 h-4 text-indigo-500" />}
						>
							{quotations.length === 0 ? (
								<EmptyMessage label="No quotations for this client." />
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<Th center>#</Th>
												<Th>Quote #</Th>
												<Th>Date</Th>
												<Th right>Amount</Th>
												<Th>Status</Th>
											</tr>
										</thead>
										<tbody>
											{quotations.map((q, i) => (
												<Tr key={q.quotation_number || `q-${i}`} i={i}>
													<Td muted center>
														{i + 1}
													</Td>
													<Td strong>{q.quotation_number || '\u2014'}</Td>
													<Td>{fmtDate(q.quotation_date)}</Td>
													<Td right amounts>
														₹{fmtAmount(q.amount)}
													</Td>
													<Td>{quoteStatusBadge(q.status)}</Td>
												</Tr>
											))}
										</tbody>
										<tfoot>
											<Tr bold>
												<Td muted center>
													&nbsp;
												</Td>
												<Td strong>TOTAL</Td>
												<Td>&nbsp;</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														quotations.reduce((s, q) => s + (q.amount || 0), 0)
													)}
												</Td>
												<Td>&nbsp;</Td>
											</Tr>
										</tfoot>
									</table>
								</div>
							)}
						</SectionCard>

						{/* 4. AR Entries */}
						<SectionCard
							title="AR Entries"
							count={receivables.length}
							icon={<ScaleIcon className="w-4 h-4 text-orange-500" />}
						>
							{receivables.length === 0 ? (
								<EmptyMessage label="No AR entries for this client." />
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-xs">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<Th center>#</Th>
												<Th>Ref #</Th>
												<Th>Invoice #</Th>
												<Th>Inv Date</Th>
												<Th right>Inv Amount</Th>
												<Th right>Paid</Th>
												<Th right>Balance</Th>
												<Th>Status</Th>
												<Th>Received</Th>
												<Th>Mode</Th>
											</tr>
										</thead>
										<tbody>
											{receivables.map((ar, i) => (
												<Tr key={ar.reference_number} i={i}>
													<Td muted center>
														{i + 1}
													</Td>
													<Td strong>{ar.reference_number}</Td>
													<Td>{ar.invoice_number || '\u2014'}</Td>
													<Td>{fmtDate(ar.invoice_date)}</Td>
													<Td right amounts>
														₹{fmtAmount(ar.invoice_amount)}
													</Td>
													<Td right amounts>
														₹{fmtAmount(ar.paid_amount)}
													</Td>
													<Td right amounts bold>
														<span
															className={
																ar.balance_due > 0
																	? 'text-red-600'
																	: 'text-gray-400'
															}
														>
															₹{fmtAmount(ar.balance_due)}
														</span>
													</Td>
													<Td>{arStatusBadge(ar.status)}</Td>
													<Td>{fmtDate(ar.received_date)}</Td>
													<Td className="capitalize">
														{ar.payment_mode || '\u2014'}
													</Td>
												</Tr>
											))}
										</tbody>
										<tfoot>
											<Tr bold>
												<Td muted center>
													&nbsp;
												</Td>
												<Td strong>TOTAL</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														receivables.reduce(
															(s, a) => s + (a.invoice_amount || 0),
															0
														)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														receivables.reduce(
															(s, a) => s + (a.paid_amount || 0),
															0
														)
													)}
												</Td>
												<Td right amounts strong>
													₹
													{fmtAmount(
														receivables.reduce(
															(s, a) => s + (a.balance_due || 0),
															0
														)
													)}
												</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
												<Td>&nbsp;</Td>
											</Tr>
										</tfoot>
									</table>
								</div>
							)}
						</SectionCard>
					</div>
				)}
			</div>
		</div>
	);
}

// ── Sub-components ─────────────────────────────────────────────────────

function SectionCard({
	title,
	count,
	icon,
	children,
}: {
	title: string;
	count: number;
	icon: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
			<div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
				{icon}
				<h3 className="text-sm font-semibold text-gray-800">{title}</h3>
				<span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
					{count}
				</span>
			</div>
			<div className="p-0">{children}</div>
		</div>
	);
}

function EmptyMessage({ label }: { label: string }) {
	return (
		<p className="text-sm text-gray-400 italic px-4 py-8 text-center">
			{label}
		</p>
	);
}

// ── Table primitives ───────────────────────────────────────────────────

function Th({
	children,
	right,
	center,
}: {
	children: React.ReactNode;
	right?: boolean;
	center?: boolean;
}) {
	return (
		<th
			className={`px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap ${
				right ? 'text-right' : center ? 'text-center' : 'text-left'
			}`}
		>
			{children}
		</th>
	);
}

function Tr({
	children,
	i,
	bold,
}: {
	children: React.ReactNode;
	i?: number;
	bold?: boolean;
}) {
	return (
		<tr
			className={`border-b border-gray-50 ${
				bold
					? 'border-t-2 border-gray-200 bg-gray-50 font-semibold'
					: `hover:bg-purple-50/30 transition-colors ${i !== undefined && i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`
			}`}
		>
			{children}
		</tr>
	);
}

function Td({
	children,
	right,
	center,
	muted,
	amounts,
	strong,
	bold,
	className,
}: {
	children: React.ReactNode;
	right?: boolean;
	center?: boolean;
	muted?: boolean;
	amounts?: boolean;
	strong?: boolean;
	bold?: boolean;
	className?: string;
}) {
	return (
		<td
			className={`px-3 py-2.5 whitespace-nowrap ${
				muted ? 'text-gray-400 text-xs' : ''
			} ${right ? 'text-right tabular-nums' : ''} ${
				center ? 'text-center' : ''
			} ${amounts ? 'text-gray-700' : ''} ${
				strong || bold ? 'font-semibold text-gray-800' : ''
			} ${className || ''}`}
		>
			{children}
		</td>
	);
}
