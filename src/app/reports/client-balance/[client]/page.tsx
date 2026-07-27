'use client';

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
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────

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
	is_super_admin?: boolean | number;
	field_permissions?: FieldPermissionsShape | string | null;
}

function hasProjectActivitiesFieldPermission(
	user: SessionUser | null | undefined
): boolean {
	if (!user) return false;
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

interface IssueDetail {
	payee_name: string;
	invoice_number: string | null;
	invoice_date: string | null;
	invoice_amount: number;
	amount: number;
	deduction: number;
	net_amount: number;
	issue_date: string | null;
	transaction_reference: string | null;
	bank_name: string | null;
	status: string;
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

interface ClientDetailResponse {
	success: true;
	client_name: string;
	invoices: InvoiceDetail[];
	payments: PaymentDetail[];
	issued: IssueDetail[];
	quotations: QuotationDetail[];
	receivables: ReceivableDetail[];
}

// ── Helpers ────────────────────────────────────────────────────────

function n(v: unknown): number {
	return Number(v ?? 0);
}

function fmtAmount(value: number): string {
	return value.toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

function fmtDate(d: string | null): string {
	if (!d) return '—';
	const date = new Date(d);
	if (isNaN(date.getTime())) return '—';
	const dd = String(date.getDate()).padStart(2, '0');
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const yyyy = date.getFullYear();
	return `${dd}/${mm}/${yyyy}`;
}

function statusColor(status: string): string {
	switch (status.toLowerCase()) {
		case 'paid':
		case 'fully_paid':
		case 'received':
			return 'bg-green-100 text-green-700';
		case 'partially_paid':
		case 'partial':
			return 'bg-blue-100 text-blue-700';
		case 'sent':
			return 'bg-amber-100 text-amber-700';
		case 'draft':
			return 'bg-gray-100 text-gray-600';
		case 'overdue':
			return 'bg-red-100 text-red-700';
		case 'approved':
			return 'bg-green-100 text-green-700';
		case 'rejected':
			return 'bg-red-100 text-red-700';
		case 'pending':
			return 'bg-amber-100 text-amber-700';
		case 'written_off':
			return 'bg-gray-100 text-gray-500';
		default:
			return 'bg-gray-100 text-gray-600';
	}
}

// ── Component ──────────────────────────────────────────────────────

export default function ClientDetailPage() {
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

	const detailQuery = useQuery<ClientDetailResponse>({
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

	const data = detailQuery.data;
	const isLoading = detailQuery.isLoading || authLoading;
	const error =
		detailQuery.error?.message ||
		(detailQuery.data as { error?: string } | undefined)?.error;

	const totalInvoiced =
		data?.invoices.reduce((s, i) => s + n(i.net_amount), 0) ?? 0;
	const totalReceived =
		data?.payments.reduce((s, p) => s + n(p.net_amount), 0) ?? 0;
	const totalIssued =
		data?.issued.reduce((s, p) => s + n(p.net_amount), 0) ?? 0;
	const netBalance = totalInvoiced - totalReceived + totalIssued;
	const pipelineValue =
		data?.quotations.reduce((s, q) => s + n(q.amount), 0) ?? 0;
	const hasDateRange = !!(fromDate && toDate);

	// ── Auth guards ───────────────────────────────────────────────
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

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* Header bar */}
				<div className="mb-5">
					<p className="text-xs text-gray-400 mb-0.5">
						<Link
							href={`/reports/client-balance${fromDate && toDate ? `?from_date=${fromDate}&to_date=${toDate}` : ''}`}
							className="hover:text-purple-600 transition"
						>
							Home
						</Link>{' '}
						<span className="mx-1 text-gray-300">/</span> Reports{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<Link
							href={`/reports/client-balance${fromDate && toDate ? `?from_date=${fromDate}&to_date=${toDate}` : ''}`}
							className="hover:text-purple-600 transition"
						>
							Client Balance
						</Link>{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<span className="text-gray-600">{client}</span>
					</p>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="flex items-center gap-3">
							<Link
								href={`/reports/client-balance${fromDate && toDate ? `?from_date=${fromDate}&to_date=${toDate}` : ''}`}
								className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition"
							>
								<ArrowLeftIcon className="w-3.5 h-3.5" />
								Back
							</Link>
							<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
								{client}
							</h1>
						</div>
						<div className="flex items-center gap-2">
							{hasDateRange && (
								<span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-1 rounded">
									{fromDate} &ndash; {toDate}
								</span>
							)}
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

				{/* Error */}
				{error && !data && (
					<div className="bg-red-50 rounded-xl border border-red-100 p-8 text-center mb-5">
						<p className="text-red-700 font-semibold mb-1">
							Error Loading Data
						</p>
						<p className="text-red-500 text-sm mb-4">{String(error)}</p>
						<button
							onClick={() => detailQuery.refetch()}
							className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
						>
							Retry
						</button>
					</div>
				)}

				{/* Loading */}
				{isLoading && (
					<div className="bg-white rounded-xl border border-gray-100 p-14 text-center text-gray-400 text-sm mb-5">
						<ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
						Loading...
					</div>
				)}

				{/* Empty state */}
				{!isLoading &&
					!error &&
					data &&
					!data.invoices.length &&
					!data.payments.length &&
					!data.issued.length &&
					!data.quotations.length &&
					!data.receivables.length && (
						<div className="bg-white rounded-xl border border-gray-100 p-14 text-center mb-5">
							<BanknotesIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
							<p className="text-gray-500 font-medium text-sm">
								No transactions found for {client}.
							</p>
						</div>
					)}

				{/* Content */}
				{!isLoading && !error && data && (
					<div>
						{/* Summary cards */}
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
							<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
								<div className="flex items-center gap-1.5 mb-0.5">
									<ArrowDownCircleIcon className="w-3.5 h-3.5 text-blue-500" />
									<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
										Invoiced
									</span>
								</div>
								<span className="text-2xl font-bold text-gray-900">
									₹{fmtAmount(totalInvoiced)}
								</span>
							</div>
							<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
								<div className="flex items-center gap-1.5 mb-0.5">
									<ArrowUpCircleIcon className="w-3.5 h-3.5 text-green-500" />
									<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
										Received
									</span>
								</div>
								<span className="text-2xl font-bold text-gray-900">
									₹{fmtAmount(totalReceived)}
								</span>
							</div>
							{totalIssued > 0 && (
								<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
									<div className="flex items-center gap-1.5 mb-0.5">
										<ArrowUpCircleIcon className="w-3.5 h-3.5 text-red-500" />
										<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
											Issued
										</span>
									</div>
									<span className="text-2xl font-bold text-red-600">
										₹{fmtAmount(totalIssued)}
									</span>
								</div>
							)}
							<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
								<div className="flex items-center gap-1.5 mb-0.5">
									<ScaleIcon className="w-3.5 h-3.5 text-purple-500" />
									<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
										Net Balance
									</span>
								</div>
								<span
									className={`text-2xl font-bold ${netBalance < 0 ? 'text-red-600' : netBalance > 0 ? 'text-orange-600' : 'text-gray-400'}`}
								>
									₹{fmtAmount(netBalance)}
								</span>
							</div>
							<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
								<div className="flex items-center gap-1.5 mb-0.5">
									<DocumentTextIcon className="w-3.5 h-3.5 text-indigo-500" />
									<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
										Pipeline
									</span>
								</div>
								<span className="text-2xl font-bold text-gray-900">
									₹{fmtAmount(pipelineValue)}
								</span>
							</div>
						</div>

						{/* Invoices */}
						<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-5">
							<div className="px-4 py-3 border-b border-gray-100">
								<h2 className="text-sm font-semibold text-gray-800">
									Invoices ({data.invoices.length})
								</h2>
							</div>
							{data.invoices.length === 0 ? (
								<p className="px-4 py-6 text-sm text-gray-400 italic">
									No invoices for this client.
								</p>
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">
													#
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Invoice #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Date
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Due Date
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Net Amount
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Paid
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Balance
												</th>
												<th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Status
												</th>
											</tr>
										</thead>
										<tbody>
											{data.invoices.map((inv, idx) => (
												<tr
													key={inv.invoice_number || idx}
													className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
												>
													<td className="px-3 py-2.5 text-gray-400 text-xs">
														{idx + 1}
													</td>
													<td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
														{inv.invoice_number || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(inv.invoice_date)}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(inv.due_date)}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(inv.net_amount))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(inv.amount_paid))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
														<span
															className={
																n(inv.balance_due) > 0
																	? 'text-red-600'
																	: 'text-gray-400'
															}
														>
															₹{fmtAmount(n(inv.balance_due))}
														</span>
													</td>
													<td className="px-3 py-2.5 text-center">
														<span
															className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor(inv.status)}`}
														>
															{inv.status.replace(/_/g, ' ')}
														</span>
													</td>
												</tr>
											))}
										</tbody>
										<tfoot>
											<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
												<td className="px-3 py-2.5" colSpan={4} />
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹{fmtAmount(totalInvoiced)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.invoices.reduce(
															(s, i) => s + n(i.amount_paid),
															0
														)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.invoices.reduce(
															(s, i) => s + n(i.balance_due),
															0
														)
													)}
												</td>
												<td />
											</tr>
										</tfoot>
									</table>
								</div>
							)}
						</div>

						{/* Payments Received */}
						<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-5">
							<div className="px-4 py-3 border-b border-gray-100">
								<h2 className="text-sm font-semibold text-gray-800">
									Payments Received ({data.payments.length})
								</h2>
							</div>
							{data.payments.length === 0 ? (
								<p className="px-4 py-6 text-sm text-gray-400 italic">
									No payments received from this client.
								</p>
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">
													#
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Receipt #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Date
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Gross
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													TDS
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													GST
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Net
												</th>
												<th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Type
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Invoice #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Bank
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Txn ID
												</th>
											</tr>
										</thead>
										<tbody>
											{data.payments.map((p, idx) => (
												<tr
													key={p.receipt_no || idx}
													className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
												>
													<td className="px-3 py-2.5 text-gray-400 text-xs">
														{idx + 1}
													</td>
													<td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
														{p.receipt_no || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(p.receipt_date)}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(p.amount))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
														{n(p.tds_amount) > 0
															? `₹${fmtAmount(n(p.tds_amount))}`
															: '—'}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
														{n(p.gst_amount) > 0
															? `₹${fmtAmount(n(p.gst_amount))}`
															: '—'}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">
														₹{fmtAmount(n(p.net_amount))}
													</td>
													<td className="px-3 py-2.5 text-center">
														{p.payment_type ? (
															<span
																className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${p.payment_type.toLowerCase() === 'full' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}
															>
																{p.payment_type}
															</span>
														) : (
															'—'
														)}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{p.invoice_no || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{p.bank_name || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap max-w-[120px] truncate">
														{p.transaction_id || '—'}
													</td>
												</tr>
											))}
										</tbody>
										<tfoot>
											<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
												<td className="px-3 py-2.5" colSpan={3} />
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.payments.reduce((s, p) => s + n(p.amount), 0)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.payments.reduce(
															(s, p) => s + n(p.tds_amount),
															0
														)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.payments.reduce(
															(s, p) => s + n(p.gst_amount),
															0
														)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹{fmtAmount(totalReceived)}
												</td>
												<td colSpan={4} />
											</tr>
										</tfoot>
									</table>
								</div>
							)}
						</div>

						{/* Payments Issued */}
						<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-5">
							<div className="px-4 py-3 border-b border-gray-100">
								<h2 className="text-sm font-semibold text-gray-800">
									Payments Issued ({data.issued.length})
								</h2>
							</div>
							{data.issued.length === 0 ? (
								<p className="px-4 py-6 text-sm text-gray-400 italic">
									No payments issued to this client.
								</p>
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">
													#
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Invoice #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Inv Date
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Inv Amount
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Amount
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Deduction
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Net
												</th>
												<th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Status
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Issue Date
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Bank
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Txn Ref
												</th>
											</tr>
										</thead>
										<tbody>
											{data.issued.map((iss, idx) => (
												<tr
													key={`${iss.invoice_number || ''}-${idx}`}
													className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
												>
													<td className="px-3 py-2.5 text-gray-400 text-xs">
														{idx + 1}
													</td>
													<td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
														{iss.invoice_number || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(iss.invoice_date)}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(iss.invoice_amount))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(iss.amount))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
														{n(iss.deduction) > 0
															? `₹${fmtAmount(n(iss.deduction))}`
															: '—'}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums font-semibold text-red-600 whitespace-nowrap">
														₹{fmtAmount(n(iss.net_amount))}
													</td>
													<td className="px-3 py-2.5 text-center">
														<span
															className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor(iss.status)}`}
														>
															{iss.status.replace(/_/g, ' ')}
														</span>
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(iss.issue_date)}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{iss.bank_name || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap max-w-[120px] truncate">
														{iss.transaction_reference || '—'}
													</td>
												</tr>
											))}
										</tbody>
										<tfoot>
											<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
												<td className="px-3 py-2.5" colSpan={3} />
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.issued.reduce(
															(s, p) => s + n(p.invoice_amount),
															0
														)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.issued.reduce((s, p) => s + n(p.amount), 0)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.issued.reduce((s, p) => s + n(p.deduction), 0)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-red-600 whitespace-nowrap">
													₹{fmtAmount(totalIssued)}
												</td>
												<td colSpan={4} />
											</tr>
										</tfoot>
									</table>
								</div>
							)}
						</div>

						{/* Quotations */}
						<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-5">
							<div className="px-4 py-3 border-b border-gray-100">
								<h2 className="text-sm font-semibold text-gray-800">
									Quotes ({data.quotations.length})
								</h2>
							</div>
							{data.quotations.length === 0 ? (
								<p className="px-4 py-6 text-sm text-gray-400 italic">
									No quotations for this client.
								</p>
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">
													#
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Quote #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Date
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Amount
												</th>
												<th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Status
												</th>
											</tr>
										</thead>
										<tbody>
											{data.quotations.map((q, idx) => (
												<tr
													key={q.quotation_number || idx}
													className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
												>
													<td className="px-3 py-2.5 text-gray-400 text-xs">
														{idx + 1}
													</td>
													<td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
														{q.quotation_number || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(q.quotation_date)}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(q.amount))}
													</td>
													<td className="px-3 py-2.5 text-center">
														<span
															className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor(q.status)}`}
														>
															{q.status.replace(/_/g, ' ')}
														</span>
													</td>
												</tr>
											))}
										</tbody>
										<tfoot>
											<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
												<td className="px-3 py-2.5" colSpan={3} />
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹{fmtAmount(pipelineValue)}
												</td>
												<td />
											</tr>
										</tfoot>
									</table>
								</div>
							)}
						</div>

						{/* AR Entries */}
						<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden mb-5">
							<div className="px-4 py-3 border-b border-gray-100">
								<h2 className="text-sm font-semibold text-gray-800">
									AR Entries ({data.receivables.length})
								</h2>
							</div>
							{data.receivables.length === 0 ? (
								<p className="px-4 py-6 text-sm text-gray-400 italic">
									No AR entries for this client.
								</p>
							) : (
								<div className="overflow-x-auto">
									<table className="w-full text-sm">
										<thead>
											<tr className="border-b border-gray-100 bg-gray-50/50">
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-8">
													#
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Ref #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Invoice #
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Inv Date
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Inv Amount
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Paid
												</th>
												<th className="text-right px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Balance
												</th>
												<th className="text-center px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Status
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Rcvd Date
												</th>
												<th className="text-left px-3 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
													Mode
												</th>
											</tr>
										</thead>
										<tbody>
											{data.receivables.map((ar, idx) => (
												<tr
													key={ar.reference_number || idx}
													className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
												>
													<td className="px-3 py-2.5 text-gray-400 text-xs">
														{idx + 1}
													</td>
													<td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
														{ar.reference_number}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{ar.invoice_number || '—'}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(ar.invoice_date)}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(ar.invoice_amount))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
														₹{fmtAmount(n(ar.paid_amount))}
													</td>
													<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
														<span
															className={
																n(ar.balance_due) > 0
																	? 'text-red-600'
																	: 'text-gray-400'
															}
														>
															₹{fmtAmount(n(ar.balance_due))}
														</span>
													</td>
													<td className="px-3 py-2.5 text-center">
														<span
															className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor(ar.status)}`}
														>
															{ar.status.replace(/_/g, ' ')}
														</span>
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{fmtDate(ar.received_date)}
													</td>
													<td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
														{ar.payment_mode || '—'}
													</td>
												</tr>
											))}
										</tbody>
										<tfoot>
											<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
												<td className="px-3 py-2.5" colSpan={4} />
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.receivables.reduce(
															(s, a) => s + n(a.invoice_amount),
															0
														)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.receivables.reduce(
															(s, a) => s + n(a.paid_amount),
															0
														)
													)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹
													{fmtAmount(
														data.receivables.reduce(
															(s, a) => s + n(a.balance_due),
															0
														)
													)}
												</td>
												<td colSpan={3} />
											</tr>
										</tfoot>
									</table>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
