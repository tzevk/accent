'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	MagnifyingGlassIcon,
	ArrowPathIcon,
	XMarkIcon,
	BanknotesIcon,
	CalendarDaysIcon,
	BuildingOfficeIcon,
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
	ScaleIcon,
	DocumentTextIcon,
	ClockIcon,
	ExclamationTriangleIcon,
	CheckCircleIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';

// ── Types ──────────────────────────────────────────────────────────

interface ClientBalanceItem {
	client_name: string;
	total_invoiced: number;
	amount_received_via_invoice: number;
	invoice_balance_due: number;
	invoice_count: number;
	unbilled_count: number;
	paid_count: number;
	partial_count: number;
	overdue_inv_count: number;
	total_received: number;
	total_received_gross: number;
	total_tds: number;
	total_gst: number;
	receipt_count: number;
	pipeline_value: number;
	quotation_count: number;
	approved_quote_count: number;
	sent_quote_count: number;
	ar_overdue_amount: number;
	ar_overdue_count: number;
	ar_pending_count: number;
	ar_partial_count: number;
	ar_received_count: number;
	net_balance: number;
	opening_balance?: number;
	period_invoiced?: number;
	period_received?: number;
	closing_balance?: number;
}

interface ReportMeta {
	total_clients: number;
	total_invoiced: number;
	total_received: number;
	total_outstanding: number;
	total_pipeline: number;
	from_date?: string;
	to_date?: string;
}

interface ReportResponse {
	success: boolean;
	data: ClientBalanceItem[];
	meta?: ReportMeta;
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

function getFirstDayOfMonth(): string {
	const d = new Date();
	d.setDate(1);
	return d.toISOString().slice(0, 10);
}

function getToday(): string {
	return new Date().toISOString().slice(0, 10);
}

function fmtAmount(n: number): string {
	return n.toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

type SortKey =
	| 'client_name'
	| 'total_invoiced'
	| 'total_received'
	| 'net_balance'
	| 'pipeline_value'
	| 'invoice_count'
	| 'receipt_count'
	| 'ar_overdue_amount'
	| 'opening_balance'
	| 'period_invoiced'
	| 'period_received'
	| 'closing_balance';

// ── Component ──────────────────────────────────────────────────────

export default function ClientBalancePage() {
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
	const [fromDate, setFromDate] = useState(getFirstDayOfMonth());
	const [toDate, setToDate] = useState(getToday());
	const [sortKey, setSortKey] = useState<SortKey>('net_balance');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

	const hasDateRange = !!(fromDate && toDate);

	const reportQuery = useQuery<ReportResponse>({
		queryKey: ['reports', 'client-balance', fromDate, toDate],
		queryFn: () =>
			apiGet('/api/reports/client-balance', {
				from_date: fromDate || undefined,
				to_date: toDate || undefined,
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
		const q = search.trim().toLowerCase();
		if (!q) return data;
		return data.filter((c) => c.client_name.toLowerCase().includes(q));
	}, [data, search]);

	const sorted = useMemo(() => {
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			if (sortKey === 'client_name') {
				return dir * a.client_name.localeCompare(b.client_name);
			}
			const aVal = a[sortKey] ?? 0;
			const bVal = b[sortKey] ?? 0;
			return dir * (Number(aVal) - Number(bVal));
		});
	}, [filtered, sortKey, sortDir]);

	const totals = useMemo(() => {
		return sorted.reduce(
			(acc, c) => ({
				total_invoiced: acc.total_invoiced + c.total_invoiced,
				total_received: acc.total_received + c.total_received,
				net_balance: acc.net_balance + c.net_balance,
				pipeline_value: acc.pipeline_value + c.pipeline_value,
				invoice_count: acc.invoice_count + c.invoice_count,
				receipt_count: acc.receipt_count + c.receipt_count,
				paid_count: acc.paid_count + c.paid_count,
				partial_count: acc.partial_count + c.partial_count,
				unbilled_count: acc.unbilled_count + c.unbilled_count,
				overdue_inv_count: acc.overdue_inv_count + c.overdue_inv_count,
				ar_overdue_amount: acc.ar_overdue_amount + c.ar_overdue_amount,
				ar_overdue_count: acc.ar_overdue_count + c.ar_overdue_count,
				ar_pending_count: acc.ar_pending_count + c.ar_pending_count,
				ar_partial_count: acc.ar_partial_count + c.ar_partial_count,
				ar_received_count: acc.ar_received_count + c.ar_received_count,
				opening_balance: acc.opening_balance + (c.opening_balance ?? 0),
				period_invoiced: acc.period_invoiced + (c.period_invoiced ?? 0),
				period_received: acc.period_received + (c.period_received ?? 0),
				closing_balance: acc.closing_balance + (c.closing_balance ?? 0),
			}),
			{
				total_invoiced: 0,
				total_received: 0,
				net_balance: 0,
				pipeline_value: 0,
				invoice_count: 0,
				receipt_count: 0,
				paid_count: 0,
				partial_count: 0,
				unbilled_count: 0,
				overdue_inv_count: 0,
				ar_overdue_amount: 0,
				ar_overdue_count: 0,
				ar_pending_count: 0,
				ar_partial_count: 0,
				ar_received_count: 0,
				opening_balance: 0,
				period_invoiced: 0,
				period_received: 0,
				closing_balance: 0,
			}
		);
	}, [sorted]);

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			setSortKey(key);
			setSortDir(key === 'client_name' ? 'asc' : 'desc');
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
						<span className="text-gray-600">Client Balance</span>
					</p>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
							Client Balance Sheet
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
								<BuildingOfficeIcon className="w-3.5 h-3.5 text-purple-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Clients
								</span>
							</div>
							<span className="text-2xl font-bold text-gray-900">
								{meta.total_clients}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<ArrowDownCircleIcon className="w-3.5 h-3.5 text-blue-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Invoiced
								</span>
							</div>
							<span className="text-2xl font-bold text-gray-900">
								₹{fmtAmount(meta.total_invoiced)}
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
								₹{fmtAmount(meta.total_received)}
							</span>
						</div>
						<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
							<div className="flex items-center gap-1.5 mb-0.5">
								<BanknotesIcon className="w-3.5 h-3.5 text-orange-500" />
								<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
									Outstanding
								</span>
							</div>
							<span
								className={`text-2xl font-bold ${
									meta.total_outstanding < 0 ? 'text-red-600' : 'text-gray-900'
								}`}
							>
								₹{fmtAmount(meta.total_outstanding)}
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
								₹{fmtAmount(meta.total_pipeline)}
							</span>
						</div>
						{hasDateRange && (
							<>
								<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
									<div className="flex items-center gap-1.5 mb-0.5">
										<ClockIcon className="w-3.5 h-3.5 text-slate-500" />
										<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
											Opening
										</span>
									</div>
									<span
										className={`text-2xl font-bold ${
											totals.opening_balance < 0
												? 'text-red-600'
												: 'text-gray-900'
										}`}
									>
										₹{fmtAmount(totals.opening_balance)}
									</span>
								</div>
								<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
									<div className="flex items-center gap-1.5 mb-0.5">
										<ArrowDownCircleIcon className="w-3.5 h-3.5 text-blue-500" />
										<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
											Period Inv
										</span>
									</div>
									<span className="text-2xl font-bold text-gray-900">
										₹{fmtAmount(totals.period_invoiced)}
									</span>
								</div>
								<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
									<div className="flex items-center gap-1.5 mb-0.5">
										<ArrowUpCircleIcon className="w-3.5 h-3.5 text-green-500" />
										<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
											Period Recv
										</span>
									</div>
									<span className="text-2xl font-bold text-gray-900">
										₹{fmtAmount(totals.period_received)}
									</span>
								</div>
								<div className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
									<div className="flex items-center gap-1.5 mb-0.5">
										<ScaleIcon className="w-3.5 h-3.5 text-purple-500" />
										<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
											Closing
										</span>
									</div>
									<span
										className={`text-2xl font-bold ${
											totals.closing_balance < 0
												? 'text-red-600'
												: 'text-gray-900'
										}`}
									>
										₹{fmtAmount(totals.closing_balance)}
									</span>
								</div>
							</>
						)}
					</div>
				)}

				{/* Filters */}
				<div className="flex flex-wrap items-center gap-2 mb-5">
					<div className="relative flex-1 min-w-[200px] max-w-sm">
						<MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
						<input
							type="text"
							placeholder="Search client..."
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

					{(search ||
						fromDate !== getFirstDayOfMonth() ||
						toDate !== getToday()) && (
						<button
							onClick={() => {
								setSearch('');
								setFromDate(getFirstDayOfMonth());
								setToDate(getToday());
							}}
							className="px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition"
						>
							Clear
						</button>
					)}

					{!isLoading && (
						<span className="text-[11px] text-gray-400">
							{filtered.length} of {data.length} clients
							{search ? ' (filtered)' : ''}
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
						<BuildingOfficeIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
						<p className="text-gray-500 font-medium text-sm">
							{search ? 'No matching clients.' : 'No client data found.'}
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
										onClick={() => toggleSort('client_name')}
									>
										Client{sortIndicator('client_name')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('total_invoiced')}
									>
										Invoiced{sortIndicator('total_invoiced')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('total_received')}
									>
										Received{sortIndicator('total_received')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('net_balance')}
									>
										Balance{sortIndicator('net_balance')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('pipeline_value')}
									>
										Pipeline{sortIndicator('pipeline_value')}
									</th>
									{hasDateRange && (
										<>
											<th
												className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
												onClick={() => toggleSort('opening_balance')}
											>
												Opening
												{sortIndicator('opening_balance')}
											</th>
											<th
												className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
												onClick={() => toggleSort('period_invoiced')}
											>
												Per Inv
												{sortIndicator('period_invoiced')}
											</th>
											<th
												className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
												onClick={() => toggleSort('period_received')}
											>
												Per Recv
												{sortIndicator('period_received')}
											</th>
											<th
												className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
												onClick={() => toggleSort('closing_balance')}
											>
												Closing
												{sortIndicator('closing_balance')}
											</th>
										</>
									)}
									<th
										className="text-center px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap"
										colSpan={4}
									>
										Invoice Status
									</th>
									<th
										className="text-center px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('ar_overdue_amount')}
									>
										Overdue AR{sortIndicator('ar_overdue_amount')}
									</th>
								</tr>
								<tr className="border-b border-gray-100 bg-gray-50/50">
									<th colSpan={6 + (hasDateRange ? 4 : 0)} />
									<th className="text-center px-2 py-1.5 text-[10px] font-medium text-green-600 whitespace-nowrap">
										Paid
									</th>
									<th className="text-center px-2 py-1.5 text-[10px] font-medium text-blue-600 whitespace-nowrap">
										Partial
									</th>
									<th className="text-center px-2 py-1.5 text-[10px] font-medium text-gray-500 whitespace-nowrap">
										Unbilled
									</th>
									<th className="text-center px-2 py-1.5 text-[10px] font-medium text-red-600 whitespace-nowrap">
										Overdue
									</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{sorted.map((c, i) => (
									<tr
										key={c.client_name}
										className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${
											i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
										}`}
									>
										<td className="px-3 py-2.5 text-gray-400 text-xs">
											{i + 1}
										</td>
										<td className="px-3 py-2.5 font-medium text-gray-800 whitespace-nowrap">
											{c.client_name}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
											₹{fmtAmount(c.total_invoiced)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
											₹{fmtAmount(c.total_received)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
											<span
												className={
													c.net_balance < 0
														? 'text-red-600'
														: c.net_balance > 0
															? 'text-orange-600'
															: 'text-gray-400'
												}
											>
												₹{fmtAmount(c.net_balance)}
											</span>
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											{c.pipeline_value > 0
												? `₹${fmtAmount(c.pipeline_value)}`
												: '—'}
										</td>
										{hasDateRange && (
											<>
												<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
													<span
														className={
															(c.opening_balance ?? 0) < 0
																? 'text-red-600'
																: 'text-gray-700'
														}
													>
														₹{fmtAmount(c.opening_balance ?? 0)}
													</span>
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
													₹{fmtAmount(c.period_invoiced ?? 0)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
													₹{fmtAmount(c.period_received ?? 0)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
													<span
														className={
															(c.closing_balance ?? 0) < 0
																? 'text-red-600'
																: 'text-gray-900'
														}
													>
														₹{fmtAmount(c.closing_balance ?? 0)}
													</span>
												</td>
											</>
										)}
										<td className="px-2 py-2.5 text-center">
											{c.paid_count > 0 ? (
												<span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-green-100 text-green-700">
													{c.paid_count}
												</span>
											) : (
												<span className="text-gray-300">—</span>
											)}
										</td>
										<td className="px-2 py-2.5 text-center">
											{c.partial_count > 0 ? (
												<span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700">
													{c.partial_count}
												</span>
											) : (
												<span className="text-gray-300">—</span>
											)}
										</td>
										<td className="px-2 py-2.5 text-center">
											{c.unbilled_count > 0 ? (
												<span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-600">
													{c.unbilled_count}
												</span>
											) : (
												<span className="text-gray-300">—</span>
											)}
										</td>
										<td className="px-2 py-2.5 text-center">
											{c.overdue_inv_count > 0 ? (
												<span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-red-100 text-red-700">
													{c.overdue_inv_count}
												</span>
											) : (
												<span className="text-gray-300">—</span>
											)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
											{c.ar_overdue_amount > 0 ? (
												<span className="text-red-600 font-medium">
													₹{fmtAmount(c.ar_overdue_amount)}
												</span>
											) : (
												<span className="text-gray-300">—</span>
											)}
										</td>
									</tr>
								))}
							</tbody>
							{totals.invoice_count > 0 && (
								<tfoot>
									<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
										<td className="px-3 py-2.5 text-gray-400 text-xs" />
										<td className="px-3 py-2.5 text-gray-800">TOTAL</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											₹{fmtAmount(totals.total_invoiced)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											₹{fmtAmount(totals.total_received)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
											<span
												className={
													totals.net_balance < 0
														? 'text-red-600'
														: 'text-gray-900'
												}
											>
												₹{fmtAmount(totals.net_balance)}
											</span>
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-500 whitespace-nowrap">
											₹{fmtAmount(totals.pipeline_value)}
										</td>
										{hasDateRange && (
											<>
												<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
													<span
														className={
															totals.opening_balance < 0
																? 'text-red-600'
																: 'text-gray-900'
														}
													>
														₹{fmtAmount(totals.opening_balance)}
													</span>
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹{fmtAmount(totals.period_invoiced)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
													₹{fmtAmount(totals.period_received)}
												</td>
												<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
													<span
														className={
															totals.closing_balance < 0
																? 'text-red-600'
																: 'text-gray-900'
														}
													>
														₹{fmtAmount(totals.closing_balance)}
													</span>
												</td>
											</>
										)}
										<td className="px-2 py-2.5 text-center tabular-nums text-gray-900">
											{totals.paid_count}
										</td>
										<td className="px-2 py-2.5 text-center tabular-nums text-gray-900">
											{totals.partial_count}
										</td>
										<td className="px-2 py-2.5 text-center tabular-nums text-gray-900">
											{totals.unbilled_count}
										</td>
										<td className="px-2 py-2.5 text-center tabular-nums text-gray-900">
											{totals.overdue_inv_count}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-red-600 font-semibold whitespace-nowrap">
											₹{fmtAmount(totals.ar_overdue_amount)}
										</td>
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
