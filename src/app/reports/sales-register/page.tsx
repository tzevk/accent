'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	MagnifyingGlassIcon,
	ArrowPathIcon,
	XMarkIcon,
	CalendarDaysIcon,
	DocumentTextIcon,
	BanknotesIcon,
	ExclamationTriangleIcon,
	ClockIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';

// ── Types ──────────────────────────────────────────────────────────

interface SalesRegisterItem {
	invoice_id: number;
	company_id: number | null;
	company_name: string;
	invoice_number: string;
	po_number: string | null;
	po_id: number | null;
	invoice_date: string | null;
	due_date: string | null;
	gross_invoice_amount: number;
	cgst_amount: number;
	sgst_amount: number;
	igst_amount: number;
	total_invoice_amount_with_tax: number;
	payment_received: number;
	tds_deduction: number;
	gst_hold_amount: number;
	net_invoice_amount_receivable: number;
	payment_received_date: string | null;
	receipt_no: string | null;
	thirty_days_credit: 'Yes' | 'No';
	overdue_days: number;
	remark: string | null;
}

interface ReportMeta {
	total_entries: number;
	total_gross: number;
	total_tax: number;
	total_received: number;
	total_receivable: number;
}

interface ReportResponse {
	success: boolean;
	data: SalesRegisterItem[];
	meta?: ReportMeta;
	error?: string;
}

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: {
							permission?: string;
						};
						project_reports?: {
							permission?: string;
						};
					};
				};
			};
		};
	};
}

interface SessionUser {
	id: number;
	is_super_admin?: boolean | number;
	field_permissions?: string | FieldPermissionsShape | null;
}

// ── Helpers ────────────────────────────────────────────────────────

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

type SortKey =
	| 'invoice_date'
	| 'company_name'
	| 'invoice_number'
	| 'gross_invoice_amount'
	| 'total_invoice_amount_with_tax'
	| 'payment_received'
	| 'net_invoice_amount_receivable'
	| 'overdue_days';

// ── Component ──────────────────────────────────────────────────────

export default function SalesRegisterPage() {
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

	const [search, setSearch] = useState('');
	const [fromDate, setFromDate] = useState('');
	const [toDate, setToDate] = useState('');
	const [sortKey, setSortKey] = useState<SortKey>('invoice_date');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
	const [showZero, setShowZero] = useState(false);

	const reportQuery = useQuery<ReportResponse>({
		queryKey: ['reports', 'sales-register', fromDate, toDate, search],
		queryFn: () =>
			apiGet('/api/reports/sales-register', {
				from_date: fromDate || undefined,
				to_date: toDate || undefined,
				search: search || undefined,
			}),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		enabled: !authLoading,
	});

	const data = useMemo(() => reportQuery.data?.data ?? [], [reportQuery.data]);
	const meta = reportQuery.data?.meta;
	const isLoading = reportQuery.isLoading || authLoading;
	const error = reportQuery.error?.message || reportQuery.data?.error;

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	const filtered = useMemo(() => {
		if (!showZero) return data;
		return data.filter(
			(c) =>
				c.gross_invoice_amount > 0 ||
				c.total_invoice_amount_with_tax > 0 ||
				c.payment_received > 0
		);
	}, [data, showZero]);

	const sorted = useMemo(() => {
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			if (sortKey === 'company_name') {
				return dir * a.company_name.localeCompare(b.company_name);
			}
			if (sortKey === 'invoice_number') {
				return dir * a.invoice_number.localeCompare(b.invoice_number);
			}
			if (sortKey === 'invoice_date') {
				const aVal = a.invoice_date ?? '';
				const bVal = b.invoice_date ?? '';
				return dir * aVal.localeCompare(bVal);
			}
			const aVal = a[sortKey] ?? 0;
			const bVal = b[sortKey] ?? 0;
			return dir * (Number(aVal) - Number(bVal));
		});
	}, [filtered, sortKey, sortDir]);

	const totals = useMemo(() => {
		return sorted.reduce(
			(acc, c) => ({
				gross_invoice_amount: acc.gross_invoice_amount + c.gross_invoice_amount,
				cgst_amount: acc.cgst_amount + c.cgst_amount,
				sgst_amount: acc.sgst_amount + c.sgst_amount,
				igst_amount: acc.igst_amount + c.igst_amount,
				total_invoice_amount_with_tax:
					acc.total_invoice_amount_with_tax + c.total_invoice_amount_with_tax,
				payment_received: acc.payment_received + c.payment_received,
				tds_deduction: acc.tds_deduction + c.tds_deduction,
				gst_hold_amount: acc.gst_hold_amount + c.gst_hold_amount,
				net_invoice_amount_receivable:
					acc.net_invoice_amount_receivable + c.net_invoice_amount_receivable,
			}),
			{
				gross_invoice_amount: 0,
				cgst_amount: 0,
				sgst_amount: 0,
				igst_amount: 0,
				total_invoice_amount_with_tax: 0,
				payment_received: 0,
				tds_deduction: 0,
				gst_hold_amount: 0,
				net_invoice_amount_receivable: 0,
			}
		);
	}, [sorted]);

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			setSortKey(key);
			setSortDir(
				key === 'company_name' || key === 'invoice_number' ? 'asc' : 'desc'
			);
		}
	};

	const sortIndicator = (key: SortKey) => {
		if (sortKey !== key) return null;
		return (
			<span className="ml-0.5 text-[9px]">
				{sortDir === 'asc' ? '\u25B2' : '\u25BC'}
			</span>
		);
	};

	/* ── auth guards ─────────────────────────────────────────────── */
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

	/* ── render ──────────────────────────────────────────────────── */
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* Header */}
				<div className="mb-5">
					<p className="text-xs text-gray-400 mb-0.5">
						Home <span className="mx-1 text-gray-300">/</span> Reports{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<span className="text-gray-600">Sales Register</span>
					</p>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
							Sales Register
						</h1>
						<div className="flex items-center gap-2">
							<button
								onClick={() => reportQuery.refetch()}
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

				{/* Stats cards */}
				{!isLoading && !error && meta && (
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<DocumentTextIcon className="w-3.5 h-3.5 text-purple-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Entries
								</span>
							</div>
							<span className="text-2xl font-bold text-gray-900">
								{meta.total_entries}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<BanknotesIcon className="w-3.5 h-3.5 text-blue-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Gross
								</span>
							</div>
							<span className="text-2xl font-bold text-gray-900">
								{formatCurrency(meta.total_gross)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Tax
								</span>
							</div>
							<span className="text-2xl font-bold text-gray-900">
								{formatCurrency(meta.total_tax)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<BanknotesIcon className="w-3.5 h-3.5 text-green-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Received
								</span>
							</div>
							<span className="text-2xl font-bold text-gray-900">
								{formatCurrency(meta.total_received)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<ClockIcon className="w-3.5 h-3.5 text-orange-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Receivable
								</span>
							</div>
							<span
								className={`text-2xl font-bold ${
									meta.total_receivable > 0
										? 'text-orange-600'
										: 'text-gray-900'
								}`}
							>
								{formatCurrency(meta.total_receivable)}
							</span>
						</div>
					</div>
				)}

				{/* Filters */}
				<div className="flex flex-wrap items-center gap-2 mb-5">
					<div className="relative flex-1 min-w-[200px] max-w-sm">
						<MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
						<input
							type="text"
							placeholder="Search company or invoice..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 placeholder:text-gray-400"
						/>
					</div>

					<div className="flex items-center gap-1.5">
						<CalendarDaysIcon className="w-4 h-4 text-gray-400" />
						<input
							type="date"
							value={fromDate}
							onChange={(e) => setFromDate(e.target.value)}
							className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
						/>
						<span className="text-gray-400 text-xs">to</span>
						<input
							type="date"
							value={toDate}
							onChange={(e) => setToDate(e.target.value)}
							className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
						/>
					</div>

					{(search || fromDate || toDate) && (
						<button
							onClick={() => {
								setSearch('');
								setFromDate('');
								setToDate('');
							}}
							className="px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition"
						>
							Clear
						</button>
					)}

					<button
						onClick={() => setShowZero((v) => !v)}
						className="px-2 py-1.5 text-[11px] font-medium text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded transition border border-purple-200"
					>
						{showZero ? 'Hide Zero' : 'Show All'}
					</button>

					{!isLoading && (
						<span className="text-[11px] text-gray-400">
							{filtered.length} of {data.length} entries
							{search ? ' (filtered)' : ''}
							{!showZero &&
								data.length - filtered.length > 0 &&
								` \u00B7 ${data.length - filtered.length} zero-value hidden`}
						</span>
					)}
				</div>

				{/* Body */}
				{error ? (
					<div className="bg-red-50 rounded-xl border border-red-100 p-8 text-center">
						<p className="text-red-700 font-semibold mb-1">
							Error Loading Data
						</p>
						<p className="text-red-500 text-sm mb-4">{error}</p>
						<button
							onClick={() => reportQuery.refetch()}
							className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
						>
							Retry
						</button>
					</div>
				) : isLoading ? (
					<div className="bg-white rounded-xl border border-gray-100 p-14 text-center text-gray-400 text-sm">
						<ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
						Loading...
					</div>
				) : sorted.length === 0 ? (
					<div className="bg-white rounded-xl border border-gray-100 p-14 text-center">
						<DocumentTextIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
						<p className="text-gray-500 font-medium text-sm">
							{search ? 'No matching entries.' : 'No invoice data found.'}
						</p>
					</div>
				) : (
					<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-gray-100 bg-gray-50/50">
									<th className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-10">
										#
									</th>
									<th
										className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('invoice_date')}
									>
										Date{sortIndicator('invoice_date')}
									</th>
									<th
										className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('company_name')}
									>
										Company{sortIndicator('company_name')}
									</th>
									<th
										className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('invoice_number')}
									>
										Invoice #{sortIndicator('invoice_number')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('gross_invoice_amount')}
									>
										Gross
										{sortIndicator('gross_invoice_amount')}
									</th>
									<th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										CGST
									</th>
									<th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										SGST
									</th>
									<th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										IGST
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('total_invoice_amount_with_tax')}
									>
										Total w/ Tax
										{sortIndicator('total_invoice_amount_with_tax')}
									</th>
									<th className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										Rcpt No
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('payment_received')}
									>
										Received
										{sortIndicator('payment_received')}
									</th>
									<th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										TDS
									</th>
									<th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										GST Hold
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('net_invoice_amount_receivable')}
									>
										Net Receivable
										{sortIndicator('net_invoice_amount_receivable')}
									</th>
									<th className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap">
										Pymt Date
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('overdue_days')}
									>
										Overdue
										{sortIndicator('overdue_days')}
									</th>
								</tr>
							</thead>
							<tbody>
								{sorted.map((c, i) => (
									<tr
										key={c.invoice_id}
										className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${
											i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
										}`}
									>
										<td className="px-3 py-2.5 text-gray-400 text-xs">
											{i + 1}
										</td>
										<td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
											{formatDate(c.invoice_date)}
										</td>
										<td className="px-3 py-2.5 font-medium whitespace-nowrap">
											{c.company_name}
										</td>
										<td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
											<Link
												href={`/admin/invoice/edit/${c.invoice_id}`}
												className="text-purple-700 hover:text-purple-900 hover:underline"
											>
												{c.invoice_number}
											</Link>
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
											{formatCurrency(c.gross_invoice_amount)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{c.cgst_amount > 0 ? formatCurrency(c.cgst_amount) : '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{c.sgst_amount > 0 ? formatCurrency(c.sgst_amount) : '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{c.igst_amount > 0 ? formatCurrency(c.igst_amount) : '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900 whitespace-nowrap">
											{formatCurrency(c.total_invoice_amount_with_tax)}
										</td>
										<td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
											{c.receipt_no ? (
												<Link
													href={`/admin/payment-entry?search=${encodeURIComponent(c.receipt_no)}`}
													className="text-purple-700 hover:text-purple-900 hover:underline"
												>
													{c.receipt_no}
												</Link>
											) : (
												'—'
											)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-green-700 whitespace-nowrap">
											{c.payment_received > 0
												? formatCurrency(c.payment_received)
												: '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{c.tds_deduction > 0
												? formatCurrency(c.tds_deduction)
												: '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{c.gst_hold_amount > 0
												? formatCurrency(c.gst_hold_amount)
												: '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
											<span
												className={
													c.net_invoice_amount_receivable > 0
														? 'text-orange-600'
														: 'text-gray-400'
												}
											>
												{formatCurrency(c.net_invoice_amount_receivable)}
											</span>
										</td>
										<td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
											{formatDate(c.payment_received_date)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
											{c.overdue_days > 0 ? (
												<span className="text-red-600 font-medium">
													{c.overdue_days}d
												</span>
											) : (
												<span className="text-gray-300">—</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
							{sorted.length > 0 && (
								<tfoot>
									<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
										<td className="px-3 py-2.5 text-gray-400 text-xs" />
										<td className="px-3 py-2.5 text-gray-800">TOTAL</td>
										<td className="px-3 py-2.5" />
										<td className="px-3 py-2.5" />
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											{formatCurrency(totals.gross_invoice_amount)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{formatCurrency(totals.cgst_amount)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{formatCurrency(totals.sgst_amount)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{formatCurrency(totals.igst_amount)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											{formatCurrency(totals.total_invoice_amount_with_tax)}
										</td>
										<td className="px-3 py-2.5" />
										<td className="px-3 py-2.5 text-right tabular-nums text-green-700 whitespace-nowrap">
											{formatCurrency(totals.payment_received)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{formatCurrency(totals.tds_deduction)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{formatCurrency(totals.gst_hold_amount)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
											<span
												className={
													totals.net_invoice_amount_receivable > 0
														? 'text-orange-600'
														: 'text-gray-900'
												}
											>
												{formatCurrency(totals.net_invoice_amount_receivable)}
											</span>
										</td>
										<td className="px-3 py-2.5" />
										<td className="px-3 py-2.5" />
									</tr>
								</tfoot>
							)}
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
