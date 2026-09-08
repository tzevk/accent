'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	ChartBarIcon,
	DocumentArrowDownIcon,
	MagnifyingGlassIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ─── Client-safe API types (mirror the server payload, no server import) ──

type UtilizationBand = 'under' | 'healthy' | 'over';

type CostStatus = 'priced' | 'no-profile';

interface UtilizationRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	month: string;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	utilization_band: UtilizationBand | null;
	/** Null when no salary profile covers the month — blank, never zero. */
	monthly_cost: number | null;
	fractional_cost: number | null;
	bench_cost: number | null;
	cost_status: CostStatus;
}

interface UtilizationTotals {
	employee_count: number;
	priced_count: number;
	unpriced_count: number;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	monthly_cost: number | null;
	fractional_cost: number | null;
	bench_cost: number | null;
}

interface UtilizationMeta {
	months: string[];
	latest_month: string | null;
	current_month: string;
	flags: { value: UtilizationBand; label: string }[];
}

interface UtilizationData {
	month: string;
	month_label: string;
	flag: UtilizationBand | null;
	rows: UtilizationRow[];
	totals: UtilizationTotals;
}

interface MetaResponse {
	success: boolean;
	meta?: UtilizationMeta;
	error?: string;
}

interface DataResponse {
	success: boolean;
	data?: UtilizationData;
	error?: string;
}

const FLAG_FILTERS: { value: '' | UtilizationBand; label: string }[] = [
	{ value: '', label: 'All flags' },
	{ value: 'under', label: 'Under (< 80%)' },
	{ value: 'healthy', label: 'Healthy (80–100%)' },
	{ value: 'over', label: 'Over (> 100%)' },
];

const FLAG_LABEL: Record<UtilizationBand, string> = {
	under: 'Under (< 80%)',
	healthy: 'Healthy (80–100%)',
	over: 'Over (> 100%)',
};

function monthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [y, m] = month.split('-').map(Number);
	const names = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December',
	];
	if (!y || !m || m < 1 || m > 12) return month;
	return `${names[m - 1]} ${y}`;
}

function bandBadge(band: UtilizationBand | null): string {
	if (band === 'under') return 'bg-amber-100 text-amber-800 ring-amber-200';
	if (band === 'healthy') return 'bg-green-100 text-green-800 ring-green-200';
	if (band === 'over') return 'bg-red-100 text-red-800 ring-red-200';
	return 'bg-slate-100 text-slate-600 ring-slate-200';
}

function bandText(band: UtilizationBand | null): string {
	if (band === 'under') return 'Under';
	if (band === 'healthy') return 'Healthy';
	if (band === 'over') return 'Over';
	return 'No capacity';
}

function formatPercent(value: number | null): string {
	if (value === null || value === undefined) return '—';
	return `${formatNumber(value)}%`;
}
/** Deep link to the per-employee timesheet detail for the row's month. */
function timesheetHref(row: UtilizationRow): string {
	return `/reports/timesheet-report?employee_id=${row.employee_id}&month=${encodeURIComponent(row.month)}`;
}

export default function EmployeeUtilizationPage() {
	const {
		loading: authLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC() as {
		loading: boolean;
		user: {
			is_super_admin?: boolean | number | null;
			field_permissions?: unknown;
		} | null;
		can: (resource: string, permission: string) => boolean;
		RESOURCES: { REPORTS: string };
		PERMISSIONS: { READ: string };
	};

	const [month, setMonth] = useState('');
	const [flag, setFlag] = useState<'' | UtilizationBand>('');
	const [search, setSearch] = useState('');
	const [exporting, setExporting] = useState(false);

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	const metaQuery = useQuery<MetaResponse>({
		queryKey: ['reports', 'employee-utilization', 'meta'],
		queryFn: () => apiGet('/api/reports/employee-utilization'),
		enabled: !authLoading && hasAccess,
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const months = useMemo(() => meta?.months ?? [], [meta]);
	const monthOptions = useMemo(
		() => months.map((value) => ({ value, label: monthLabel(value) })),
		[months]
	);

	useEffect(() => {
		if (!meta) return;
		setMonth(
			(previous) => previous || meta.latest_month || meta.current_month || ''
		);
		// Default month is applied once when metadata arrives.
	}, [meta]);

	const dataQuery = useQuery<DataResponse>({
		queryKey: ['reports', 'employee-utilization', 'data', month, flag],
		queryFn: () => {
			const params = new URLSearchParams({ month });
			if (flag) params.append('flag', flag);
			return apiGet(`/api/reports/employee-utilization?${params.toString()}`);
		},
		enabled: !authLoading && hasAccess && !!month,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const data = dataQuery.data?.data ?? null;
	// Server returns rows in the documented default sort (flag band, then
	// bench cost descending) — the search filter preserves that order.
	const rows = useMemo(() => data?.rows ?? [], [data]);
	const totals = data?.totals ?? null;

	const filteredRows = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter(
			(row) =>
				row.employee_name.toLowerCase().includes(q) ||
				row.employee_code.toLowerCase().includes(q)
		);
	}, [rows, search]);

	const error =
		dataQuery.error?.message || dataQuery.data?.error || metaQuery.data?.error;
	const isLoading =
		dataQuery.isLoading || (dataQuery.isFetching && !dataQuery.data);
	const searchActive = search.trim().length > 0;

	// Export mirrors the current month view (month + flag). Search stays
	// client-side: totals cover the full month view, so the workbook does too.
	const handleExport = async () => {
		if (!month || exporting) return;
		setExporting(true);
		try {
			const params = new URLSearchParams({ month });
			if (flag) params.append('flag', flag);
			const response = await fetch(
				`/api/reports/employee-utilization/download?${params.toString()}`,
				{ credentials: 'include' }
			);
			if (!response.ok) {
				const msg = await response.text().catch(() => '');
				throw new Error(
					`Export failed (${response.status})${msg ? `: ${msg}` : ''}`
				);
			}
			const blob = await response.blob();
			const disposition = response.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^";]+)"?/i);
			const filename =
				match?.[1] ?? `Utilization_${month}${flag ? `_${flag}` : ''}.xlsx`;
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = objectUrl;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
		} catch (e) {
			console.error(e);
			alert(e instanceof Error ? e.message : 'Failed to export');
		} finally {
			setExporting(false);
		}
	};

	if (authLoading) {
		return (
			<div className="min-h-screen bg-white">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
					Loading…
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-screen bg-white">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center">
					<div className="text-center">
						<XMarkIcon className="mx-auto mb-2 h-8 w-8 text-red-500" />
						<h2 className="text-lg font-bold text-gray-800">Access Denied</h2>
						<p className="text-sm text-gray-500">
							You don&apos;t have permission to view this report.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-white text-black">
			<Navbar />
			<main className="px-2 pb-10 pt-2 sm:px-4">
				<div className="mx-auto max-w-[1550px] space-y-4">
					<div className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-r from-[#64126D] to-[#86288F] p-5 text-white shadow-lg">
						<div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
							<div className="flex items-center gap-3">
								<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
									<ChartBarIcon className="h-6 w-6" aria-hidden="true" />
								</div>
								<div>
									<h1 className="text-2xl font-bold tracking-tight">
										Employee Utilization
									</h1>
									<p className="text-sm text-purple-200">
										Team capacity vs logged hours — sorted by flag band, then
										bench cost descending
									</p>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={() => dataQuery.refetch()}
									disabled={isLoading || !month}
									className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/15 px-3 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50"
								>
									<ArrowPathIcon
										className={cn('h-4 w-4', isLoading && 'animate-spin')}
									/>
									Refresh
								</button>
								<button
									type="button"
									onClick={handleExport}
									disabled={exporting || isLoading || !month || !rows.length}
									className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/15 px-3 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50"
								>
									<DocumentArrowDownIcon
										className={cn('h-4 w-4', exporting && 'animate-pulse')}
									/>
									{exporting ? 'Exporting…' : 'Export Excel'}
								</button>
							</div>
						</div>
					</div>

					<div
						aria-label="Utilization filters"
						className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
					>
						<label className="block min-w-[180px]">
							<span className="mb-1 block text-[11px] font-semibold text-gray-700">
								Month
							</span>
							<SearchableSelect
								options={monthOptions}
								value={month}
								onChange={(val) => setMonth(String(val))}
								placeholder="Select month…"
								disabled={metaQuery.isLoading}
								aria-label="Month"
							/>
						</label>
						<fieldset>
							<legend className="mb-1 text-[11px] font-semibold text-gray-700">
								Flag
							</legend>
							<div
								className="flex flex-wrap gap-1.5"
								role="group"
								aria-label="Utilization flag"
							>
								{FLAG_FILTERS.map((option) => {
									const isActive = flag === option.value;
									return (
										<button
											key={option.value || 'all'}
											type="button"
											onClick={() => setFlag(option.value)}
											aria-pressed={isActive}
											className={cn(
												'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]',
												isActive
													? 'bg-[#64126D] text-white shadow-sm'
													: 'bg-gray-100 text-gray-700 hover:bg-gray-200'
											)}
										>
											{option.label}
										</button>
									);
								})}
							</div>
						</fieldset>
						<label className="block min-w-[220px] flex-1">
							<span className="mb-1 block text-[11px] font-semibold text-gray-700">
								Employee search
							</span>
							<div className="relative">
								<MagnifyingGlassIcon
									className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
									aria-hidden="true"
								/>
								<input
									type="search"
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Name or employee code…"
									aria-label="Search by employee name or code"
									className="h-9 w-full rounded-md border border-gray-300 bg-white pl-8 pr-8 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500"
								/>
								{searchActive && (
									<button
										type="button"
										onClick={() => setSearch('')}
										aria-label="Clear search"
										className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
									>
										<XMarkIcon className="h-4 w-4" />
									</button>
								)}
							</div>
						</label>
					</div>

					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
						<span className="inline-flex items-center gap-1.5">
							<span className="inline-block h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-200" />{' '}
							Under (&lt; 80%)
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="inline-block h-3 w-3 rounded-sm bg-green-100 ring-1 ring-green-200" />{' '}
							Healthy (80–100%)
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="inline-block h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-200" />{' '}
							Over (&gt; 100%, overtime counts)
						</span>
						<span>Costs are CTC-based; unpriced rows show —.</span>
					</div>

					{totals && totals.unpriced_count > 0 && (
						<p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
							{totals.unpriced_count} of {totals.employee_count}{' '}
							{totals.unpriced_count === 1 ? 'employee has' : 'employees have'}{' '}
							no salary profile covering {data?.month_label ?? month} — costs
							show as — and are excluded from cost totals.
						</p>
					)}

					{error ? (
						<div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700">
							<p className="font-semibold">Couldn&apos;t load the report</p>
							<p className="mt-1">{error}</p>
							<button
								type="button"
								onClick={() => dataQuery.refetch()}
								className="mt-3 rounded-md border border-red-600 bg-red-600 px-3 py-1 text-xs text-white"
							>
								Retry
							</button>
						</div>
					) : isLoading ? (
						<p className="py-10 text-center text-sm text-gray-400">
							Loading utilization…
						</p>
					) : !data ? (
						<p className="py-10 text-center text-sm text-gray-400">
							Select a month to view team utilization.
						</p>
					) : rows.length === 0 ? (
						<div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center">
							<p className="text-sm font-semibold text-gray-800">
								{flag
									? `No employees in the ${FLAG_LABEL[flag]} band for ${data.month_label}.`
									: `No employees found for ${data.month_label}.`}
							</p>
							<p className="mt-1 text-xs text-gray-500">
								{flag
									? 'Try a different flag filter or month.'
									: 'There are no active employees to report on for this month.'}
							</p>
						</div>
					) : filteredRows.length === 0 ? (
						<div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center">
							<p className="text-sm font-semibold text-gray-800">
								No employees match the current search.
							</p>
							<p className="mt-1 text-xs text-gray-500">
								Showing 0 of {rows.length} employees for {data.month_label}.
							</p>
							<button
								type="button"
								onClick={() => {
									setSearch('');
									setFlag('');
								}}
								className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
							>
								Clear search and flag filter
							</button>
						</div>
					) : (
						<div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
							<p className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
								Showing {filteredRows.length} of {rows.length} employees
								{flag ? ` in the ${FLAG_LABEL[flag]} band` : ''} ·{' '}
								{data.month_label}
								{totals
									? ` · ${totals.priced_count} priced · ${totals.unpriced_count} unpriced`
									: ''}
								{searchActive
									? ' · totals below cover the full month view, not just the search'
									: ''}
							</p>
							<div className="overflow-x-auto">
								<table className="w-full min-w-[960px] border-collapse text-sm">
									<caption className="sr-only">
										Team utilization for {data.month_label}, sorted by flag band
										then bench cost descending
									</caption>
									<thead>
										<tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
											<th scope="col" className="px-4 py-2.5">
												Employee
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Capacity (h)
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Logged (h)
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Utilization
											</th>
											<th scope="col" className="px-4 py-2.5">
												Flag
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Monthly Cost
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Bench Cost
											</th>
											<th scope="col" className="px-4 py-2.5">
												<span className="sr-only">Timesheet detail</span>
											</th>
										</tr>
									</thead>
									<tbody>
										{filteredRows.map((row, index) => (
											<tr
												key={row.employee_id}
												className={cn(
													'border-b border-gray-100',
													index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
												)}
											>
												<td className="px-4 py-2.5">
													<Link
														href={timesheetHref(row)}
														className="font-medium text-[#64126D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
													>
														{row.employee_name}
													</Link>
													<span className="block text-xs text-gray-500">
														{row.employee_code}
													</span>
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatNumber(row.capacity_hours)}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatNumber(row.logged_hours)}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatPercent(row.utilization_percent)}
												</td>
												<td className="px-4 py-2.5">
													<span
														className={cn(
															'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
															bandBadge(row.utilization_band)
														)}
													>
														{bandText(row.utilization_band)}
													</span>
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatCurrency(row.monthly_cost)}
													{row.cost_status === 'no-profile' && (
														<span className="ml-1.5 inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
															No profile
														</span>
													)}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatCurrency(row.bench_cost)}
												</td>
												<td className="px-4 py-2.5">
													<Link
														href={timesheetHref(row)}
														aria-label={`View timesheet for ${row.employee_name}`}
														className="text-xs font-medium text-[#64126D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
													>
														Timesheet →
													</Link>
												</td>
											</tr>
										))}
									</tbody>
									{totals && (
										<tfoot>
											<tr className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold">
												<td className="px-4 py-2.5">
													Total ({totals.employee_count} employees)
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatNumber(totals.capacity_hours)}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatNumber(totals.logged_hours)}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatPercent(totals.utilization_percent)}
												</td>
												<td className="px-4 py-2.5" />
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatCurrency(totals.monthly_cost)}
												</td>
												<td className="px-4 py-2.5 text-right tabular-nums">
													{formatCurrency(totals.bench_cost)}
												</td>
												<td className="px-4 py-2.5" />
											</tr>
										</tfoot>
									)}
								</table>
							</div>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
