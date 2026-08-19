'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	DocumentArrowDownIcon,
	PrinterIcon,
	XMarkIcon,
	DocumentTextIcon,
	CalendarDaysIcon,
	UserGroupIcon,
	BanknotesIcon,
	ClockIcon,
	ArrowTrendingUpIcon,
	ArrowTrendingDownIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatNumber, formatCurrency } from '@/lib/format';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ─── Client-safe API types ──────────────────────────────────────────

interface BillingProject {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string;
}

interface FinancialYearOption {
	year: number;
	label: string;
}

interface BillingMeta {
	clients: string[];
	projects: BillingProject[];
	months: string[];
	latest_month: string | null;
	financial_years: FinancialYearOption[];
	current_fy: number;
}

interface MonthlyBillingRow {
	sr_no: number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	employee_charges: number;
	total_manhours: number;
	amount: number;
	tds_rate: number;
	tds: number;
	net_payable: number;
	accent_charges: number;
	accent_amount: number;
	pnl_after_deductions: number;
	pnl_tds: number;
}

interface MonthlyBillingData {
	client_name: string;
	project: {
		project_id: number;
		project_code: string;
		project_name: string;
	};
	month: string;
	month_label: string;
	year: number;
	rows: MonthlyBillingRow[];
	totals: {
		total_manhours: number;
		total_amount: number;
		total_tds: number;
		total_net_payable: number;
		total_accent_amount: number;
		total_pnl_after_deductions: number;
		total_pnl_tds: number;
	};
}

interface AnnualEmployeeRow {
	sr_no: number;
	id: string | number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	salary_type: string;
	rate_company: number;
	rate_accent: number;
	monthly_hours: Record<string, number>;
	total_hours: number;
	company_cost: number;
	accent_cost: number;
	pnl: number;
}

interface AnnualBillingData {
	client_name: string;
	project: {
		project_id: number;
		project_code: string;
		project_name: string;
	};
	fy_label: string;
	fy_year: number;
	months: string[];
	month_keys: string[];
	rows: AnnualEmployeeRow[];
	totals: {
		monthly_hours: Record<string, number>;
		total_hours: number;
		total_company_cost: number;
		total_accent_cost: number;
		total_pnl: number;
	};
}

interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T | null;
	meta?: BillingMeta;
	view?: 'monthly' | 'annual';
	error?: string;
}

type ViewMode = 'monthly' | 'annual';

function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
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
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${names[monthNumber - 1]} ${year}`;
}

function fmtHours(hours: number): string {
	return String(Number(hours.toFixed(2)));
}

// ─── Print layout (A4 landscape letterhead) ─────────────────────────

const mhbPrintStyles = `
@media print {
	@page {
		size: A4 landscape;
		margin: 10mm 9mm 14mm 9mm;
		@bottom-center {
			content: "Accent CRM — Manhours & Deputation Billing Report — Page " counter(page) " of " counter(pages);
			font-size: 7pt;
			color: #6b7280;
		}
	}
	.mhb-print-page {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.mhb-print-page nav {
		display: none !important;
	}
	body > aside {
		display: none !important;
	}
	.content-with-sidebar {
		padding-left: 0 !important;
		padding-top: 0 !important;
	}
	.mhb-print-page main {
		padding: 0 !important;
	}
	.mhb-print-page .mhb-scroll {
		overflow: visible !important;
		max-width: none !important;
		margin: 0 !important;
	}
	.mhb-sheet {
		min-width: 0 !important;
		font-size: 8pt;
	}
	.mhb-sheet table {
		font-size: 7.5pt;
	}
	.mhb-sheet th,
	.mhb-sheet td {
		padding: 1.5px 3px !important;
	}
	.mhb-sheet thead {
		display: table-header-group;
	}
	.mhb-sheet tbody tr {
		break-inside: avoid;
	}

	.mhb-print-header {
		border-bottom: 2px solid #64126d;
		padding-bottom: 3mm;
		margin-bottom: 3mm;
	}
	.mhb-print-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6mm;
	}
	.mhb-print-brand {
		min-width: 52mm;
	}
	.mhb-print-title {
		flex: 1;
		text-align: center;
		font-size: 12pt;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #111827;
	}
	.mhb-print-period {
		min-width: 52mm;
		text-align: right;
		font-size: 8pt;
		color: #374151;
	}
	.mhb-print-period b {
		color: #111827;
	}
	.mhb-print-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 3mm 8mm;
		font-size: 8pt;
		color: #374151;
		margin-top: 2mm;
	}
	.mhb-print-meta b {
		color: #111827;
	}
	.mhb-print-meta .mhb-print-generated {
		margin-left: auto;
		color: #6b7280;
	}

	.mhb-print-footer {
		position: fixed;
		bottom: 0;
		left: 9mm;
		right: 9mm;
		display: flex;
		justify-content: space-between;
		font-size: 7pt;
		color: #6b7280;
		border-top: 1px solid #64126d;
		padding-top: 1.5mm;
	}
}
`;

// ─── Page ───────────────────────────────────────────────────────────

export default function ManhoursBillingReportPage() {
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

	const [viewMode, setViewMode] = useState<ViewMode>('monthly');
	const [client, setClient] = useState('');
	const [projectId, setProjectId] = useState('');
	const [month, setMonth] = useState('');
	const [fyYear, setFyYear] = useState('');
	const [exporting, setExporting] = useState(false);

	const metaQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'manhours-billing', 'meta'],
		queryFn: () => apiGet('/api/reports/manhours-billing'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const clients = useMemo(() => meta?.clients ?? [], [meta]);
	const projects = useMemo(() => meta?.projects ?? [], [meta]);
	const months = useMemo(() => meta?.months ?? [], [meta]);
	const financialYears = useMemo(() => meta?.financial_years ?? [], [meta]);

	useEffect(() => {
		if (!meta) return;
		const initialClient = clients.find((c) => c === client) ?? clients[0] ?? '';
		const clientProjects = projects.filter(
			(p) => p.client_name === initialClient
		);
		setClient(initialClient);
		setProjectId((previous) => {
			if (
				previous &&
				clientProjects.some((p) => String(p.project_id) === previous)
			) {
				return previous;
			}
			return String(clientProjects[0]?.project_id ?? '');
		});
		setMonth((previous) => previous || meta.latest_month || '');
		setFyYear((previous) => previous || String(meta.current_fy || 2026));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [meta]);

	// Monthly query
	const monthlyQuery = useQuery<ApiResponse<MonthlyBillingData>>({
		queryKey: ['reports', 'manhours-billing', 'monthly', projectId, month],
		queryFn: () =>
			apiGet(
				`/api/reports/manhours-billing?project_id=${projectId}&month=${month}&view=monthly`
			),
		enabled: viewMode === 'monthly' && !!projectId && !!month,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	// Annual query
	const annualQuery = useQuery<ApiResponse<AnnualBillingData>>({
		queryKey: ['reports', 'manhours-billing', 'annual', projectId, fyYear],
		queryFn: () =>
			apiGet(
				`/api/reports/manhours-billing?project_id=${projectId}&fy=${fyYear}&view=annual`
			),
		enabled: viewMode === 'annual' && !!projectId && !!fyYear,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const activeQuery = viewMode === 'monthly' ? monthlyQuery : annualQuery;
	const monthlyData = monthlyQuery.data?.data ?? null;
	const annualData = annualQuery.data?.data ?? null;

	const generatedAt = new Date().toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	const error =
		activeQuery.error?.message ||
		activeQuery.data?.error ||
		metaQuery.data?.error;
	const isLoading =
		activeQuery.isLoading || (activeQuery.isFetching && !activeQuery.data);

	const clientOptions = useMemo(
		() => clients.map((c) => ({ value: c, label: c })),
		[clients]
	);
	const projectOptions = useMemo(
		() =>
			projects
				.filter((p) => p.client_name === client)
				.map((p) => ({
					value: String(p.project_id),
					label: [p.project_code, p.project_name].filter(Boolean).join(' - '),
				})),
		[projects, client]
	);
	const monthOptions = useMemo(
		() => months.map((m) => ({ value: m, label: monthLabel(m) })),
		[months]
	);
	const fyOptions = useMemo(
		() =>
			financialYears.map((fy) => ({
				value: String(fy.year),
				label: fy.label,
			})),
		[financialYears]
	);

	const handleClientChange = (value: string) => {
		setClient(value);
		const firstProject = projects.find((p) => p.client_name === value);
		setProjectId(String(firstProject?.project_id ?? ''));
	};

	const handlePrint = () => {
		window.print();
	};

	const handleExport = async () => {
		if (!projectId) return;
		if (viewMode === 'monthly' && !month) return;
		if (viewMode === 'annual' && !fyYear) return;

		setExporting(true);
		try {
			const downloadUrl =
				viewMode === 'monthly'
					? `/api/reports/manhours-billing/download?project_id=${projectId}&month=${month}&view=monthly`
					: `/api/reports/manhours-billing/download?project_id=${projectId}&fy=${fyYear}&view=annual`;

			const response = await fetch(downloadUrl, { credentials: 'include' });
			if (!response.ok) {
				const message = await response.text().catch(() => '');
				throw new Error(
					`Export failed (${response.status})${message ? `: ${message}` : ''}`
				);
			}
			const blob = await response.blob();
			const disposition = response.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^";]+)"?/i);
			const filename =
				match?.[1] ||
				(viewMode === 'monthly'
					? `Manhours_Billing_${client}_${month}.xlsx`
					: `Deputation_Summary_${client}_FY${fyYear}.xlsx`);

			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = filename;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
		} catch (exportError) {
			console.error('Export failed:', exportError);
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

	const hasCurrentData = viewMode === 'monthly' ? !!monthlyData : !!annualData;

	return (
		<div className="mhb-print-page min-h-screen bg-gray-50/50 text-black">
			<style>{mhbPrintStyles}</style>
			<Navbar />
			<main className="px-2 pb-12 pt-2 sm:px-4 md:px-6">
				{/* Top Bar Header + View Switcher */}
				<div className="mx-auto mb-3 max-w-[1600px] print:hidden">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-gray-200 pb-3">
						<div>
							<h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#64126D]/10 text-[#64126D]">
									<BanknotesIcon className="h-4 w-4" />
								</span>
								Manhours &amp; Deputation Billing Report
							</h1>
							<p className="text-xs text-gray-500 mt-0.5">
								Monthly client invoicing statements and annual financial year
								deputation tracking
							</p>
						</div>

						{/* Segmented View Switcher Pill */}
						<div
							role="tablist"
							aria-label="Report views"
							className="inline-flex rounded-xl bg-gray-100/90 p-1 border border-gray-200/80 shadow-inner self-start sm:self-auto"
						>
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === 'monthly'}
								onClick={() => setViewMode('monthly')}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
									viewMode === 'monthly'
										? 'bg-[#64126D] text-white shadow-sm shadow-[#64126D]/20'
										: 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
								}`}
							>
								<DocumentTextIcon className="h-3.5 w-3.5" />
								Monthly Statement
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === 'annual'}
								onClick={() => setViewMode('annual')}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
									viewMode === 'annual'
										? 'bg-[#64126D] text-white shadow-sm shadow-[#64126D]/20'
										: 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
								}`}
							>
								<CalendarDaysIcon className="h-3.5 w-3.5" />
								Annual FY Matrix
							</button>
						</div>
					</div>
				</div>

				{/* Filter bar — print:hidden */}
				<form
					onSubmit={(e) => {
						e.preventDefault();
						activeQuery.refetch();
					}}
					aria-label="Manhours billing filters"
					className="mx-auto mb-4 flex max-w-[1600px] flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm print:hidden"
				>
					<label className="block min-w-[200px] flex-1">
						<span className="mb-1 block text-[11px] font-semibold text-gray-700">
							Client Name
						</span>
						<SearchableSelect
							options={clientOptions}
							value={client}
							onChange={handleClientChange}
							placeholder="Select a client…"
							disabled={metaQuery.isLoading}
						/>
					</label>

					<label className="block min-w-[240px] flex-[2]">
						<span className="mb-1 block text-[11px] font-semibold text-gray-700">
							Project Name/Number
						</span>
						<SearchableSelect
							options={projectOptions}
							value={projectId}
							onChange={(val) => setProjectId(String(val))}
							placeholder="Select a project…"
							disabled={!client || metaQuery.isLoading}
						/>
					</label>

					{viewMode === 'monthly' ? (
						<label className="block min-w-[160px] flex-1">
							<span className="mb-1 block text-[11px] font-semibold text-gray-700">
								Month / Year
							</span>
							<SearchableSelect
								options={monthOptions}
								value={month}
								onChange={(val) => setMonth(String(val))}
								placeholder="Select month…"
								disabled={metaQuery.isLoading}
							/>
						</label>
					) : (
						<label className="block min-w-[160px] flex-1">
							<span className="mb-1 block text-[11px] font-semibold text-gray-700">
								Financial Year (Apr–Mar)
							</span>
							<SearchableSelect
								options={fyOptions}
								value={fyYear}
								onChange={(val) => setFyYear(String(val))}
								placeholder="Select FY…"
								disabled={metaQuery.isLoading}
							/>
						</label>
					)}

					<div className="flex items-center gap-1.5 pt-1">
						<button
							type="button"
							onClick={() => activeQuery.refetch()}
							disabled={
								!projectId ||
								(viewMode === 'monthly' ? !month : !fyYear) ||
								isLoading
							}
							className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] disabled:cursor-not-allowed disabled:opacity-40"
						>
							<ArrowPathIcon
								className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
							/>
							Refresh
						</button>
						<button
							type="button"
							onClick={handlePrint}
							disabled={!hasCurrentData}
							className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] disabled:cursor-not-allowed disabled:opacity-40"
						>
							<PrinterIcon className="h-3.5 w-3.5" />
							Print
						</button>
						<button
							type="button"
							onClick={handleExport}
							disabled={!hasCurrentData || exporting}
							className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#64126D] bg-[#64126D] px-3.5 text-xs font-semibold text-white hover:bg-[#52105a] shadow-sm shadow-[#64126D]/20 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] disabled:cursor-not-allowed disabled:opacity-50"
						>
							<DocumentArrowDownIcon className="h-3.5 w-3.5" />
							{exporting ? 'Exporting…' : 'Export Excel'}
						</button>
					</div>
				</form>

				{/* KPI Summary Cards (screen-only) */}
				{viewMode === 'monthly' &&
					monthlyData &&
					monthlyData.rows.length > 0 && (
						<div className="mx-auto mb-4 grid max-w-[1600px] grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
							<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
								<div className="flex items-center justify-between">
									<span className="text-[11px] font-medium text-gray-500">
										Total Manhours
									</span>
									<ClockIcon className="h-4 w-4 text-blue-600" />
								</div>
								<p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
									{fmtHours(monthlyData.totals.total_manhours)}
									<span className="text-xs font-normal text-gray-500 ml-1">
										hrs
									</span>
								</p>
								<span className="text-[10px] text-gray-400">
									{monthlyData.rows.length} resources billed
								</span>
							</div>

							<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
								<div className="flex items-center justify-between">
									<span className="text-[11px] font-medium text-gray-500">
										Billed to Client
									</span>
									<BanknotesIcon className="h-4 w-4 text-emerald-600" />
								</div>
								<p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
									{formatCurrency(monthlyData.totals.total_accent_amount)}
								</p>
								<span className="text-[10px] text-emerald-600">
									Gross invoice value
								</span>
							</div>

							<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
								<div className="flex items-center justify-between">
									<span className="text-[11px] font-medium text-gray-500">
										Net Payable (Salary/Cost)
									</span>
									<UserGroupIcon className="h-4 w-4 text-indigo-600" />
								</div>
								<p className="mt-1 text-lg font-bold text-gray-800 tabular-nums">
									{formatCurrency(monthlyData.totals.total_net_payable)}
								</p>
								<span className="text-[10px] text-gray-400">
									After TDS: {formatCurrency(monthlyData.totals.total_tds)}
								</span>
							</div>

							<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
								<div className="flex items-center justify-between">
									<span className="text-[11px] font-medium text-gray-500">
										Net Margin (P&amp;L)
									</span>
									{monthlyData.totals.total_pnl_after_deductions >= 0 ? (
										<ArrowTrendingUpIcon className="h-4 w-4 text-green-600" />
									) : (
										<ArrowTrendingDownIcon className="h-4 w-4 text-red-600" />
									)}
								</div>
								<p
									className={`mt-1 text-lg font-bold tabular-nums ${
										monthlyData.totals.total_pnl_after_deductions >= 0
											? 'text-green-700'
											: 'text-red-600'
									}`}
								>
									{formatCurrency(
										monthlyData.totals.total_pnl_after_deductions
									)}
								</p>
								<span className="text-[10px] text-gray-400">
									P&amp;L before TDS:{' '}
									{formatCurrency(monthlyData.totals.total_pnl_tds)}
								</span>
							</div>
						</div>
					)}

				{viewMode === 'annual' && annualData && annualData.rows.length > 0 && (
					<div className="mx-auto mb-4 grid max-w-[1600px] grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
						<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-medium text-gray-500">
									FY Total Manhours
								</span>
								<ClockIcon className="h-4 w-4 text-blue-600" />
							</div>
							<p className="mt-1 text-lg font-bold text-gray-900 tabular-nums">
								{fmtHours(annualData.totals.total_hours)}
								<span className="text-xs font-normal text-gray-500 ml-1">
									hrs
								</span>
							</p>
							<span className="text-[10px] text-gray-400">
								{annualData.rows.length} resources on deputation
							</span>
						</div>

						<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-medium text-gray-500">
									Total Client Billing
								</span>
								<BanknotesIcon className="h-4 w-4 text-emerald-600" />
							</div>
							<p className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
								{formatCurrency(annualData.totals.total_accent_cost)}
							</p>
							<span className="text-[10px] text-emerald-600">
								Accent revenue in {annualData.fy_label}
							</span>
						</div>

						<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-medium text-gray-500">
									Total Company Cost
								</span>
								<UserGroupIcon className="h-4 w-4 text-indigo-600" />
							</div>
							<p className="mt-1 text-lg font-bold text-gray-800 tabular-nums">
								{formatCurrency(annualData.totals.total_company_cost)}
							</p>
							<span className="text-[10px] text-gray-400">
								Resource payout cost
							</span>
						</div>

						<div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
							<div className="flex items-center justify-between">
								<span className="text-[11px] font-medium text-gray-500">
									Annual Net P&amp;L
								</span>
								{annualData.totals.total_pnl >= 0 ? (
									<ArrowTrendingUpIcon className="h-4 w-4 text-green-600" />
								) : (
									<ArrowTrendingDownIcon className="h-4 w-4 text-red-600" />
								)}
							</div>
							<p
								className={`mt-1 text-lg font-bold tabular-nums ${
									annualData.totals.total_pnl >= 0
										? 'text-green-700'
										: 'text-red-600'
								}`}
							>
								{formatCurrency(annualData.totals.total_pnl)}
							</p>
							<span className="text-[10px] text-gray-400">
								{annualData.totals.total_accent_cost > 0
									? `${((annualData.totals.total_pnl / annualData.totals.total_accent_cost) * 100).toFixed(1)}% margin`
									: '—'}
							</span>
						</div>
					</div>
				)}

				{/* Error / Loading / Content States */}
				{error ? (
					<div className="mx-auto max-w-[1600px] rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700 shadow-sm">
						<p className="font-semibold text-base">
							Couldn&apos;t load the report
						</p>
						<p className="mt-1 text-xs text-red-600">{error}</p>
						<button
							type="button"
							onClick={() => activeQuery.refetch()}
							className="mt-3 rounded-lg border border-red-600 bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 shadow-sm"
						>
							Retry
						</button>
					</div>
				) : isLoading ? (
					<div className="mx-auto flex min-h-[350px] max-w-[1600px] items-center justify-center rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500 shadow-sm">
						<div className="flex flex-col items-center gap-2">
							<ArrowPathIcon className="h-6 w-6 animate-spin text-[#64126D]" />
							<p className="text-xs text-gray-600">
								Loading{' '}
								{viewMode === 'monthly'
									? 'monthly billing'
									: 'annual deputation'}{' '}
								report…
							</p>
						</div>
					</div>
				) : viewMode === 'monthly' ? (
					/* ─── 1. Monthly Billing Sheet ────────────────────────── */
					!monthlyData ? (
						<div className="mx-auto flex min-h-[300px] max-w-[1600px] items-center justify-center rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500 shadow-sm">
							Select a client, project, and month to view the billing report.
						</div>
					) : (
						<div className="mhb-scroll mx-auto max-w-[1600px] overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:rounded-none print:border-none print:p-0 print:shadow-none">
							<section
								className="mhb-sheet min-w-[950px] bg-white font-[Arial,sans-serif] text-[10px] leading-none text-black"
								style={{
									WebkitPrintColorAdjust: 'exact',
									printColorAdjust: 'exact',
								}}
							>
								{/* Print-only letterhead header */}
								<header className="mhb-print-header hidden print:block">
									<div className="mhb-print-header-row">
										<div className="mhb-print-brand">
											<Image
												src="/accent-logo.png"
												alt="Accent Techno Solutions"
												width={186}
												height={116}
												priority
												className="h-[13mm] w-auto object-contain"
											/>
										</div>
										<h1 className="mhb-print-title">
											Manhours Billing Statement
										</h1>
										<div className="mhb-print-period">
											<b>Period:</b> {monthlyData.month_label}
										</div>
									</div>
									<div className="mhb-print-meta">
										<span>
											<b>Client:</b> {monthlyData.client_name}
										</span>
										<span>
											<b>Project:</b>{' '}
											{[
												monthlyData.project.project_code,
												monthlyData.project.project_name,
											]
												.filter(Boolean)
												.join(' - ')}
										</span>
										<span>
											<b>Month/Year:</b> {monthlyData.month_label}
										</span>
										<span className="mhb-print-generated">
											<b>Generated:</b> {generatedAt}
										</span>
									</div>
								</header>

								{/* Header block mirroring Excel template */}
								<div className="grid grid-cols-[150px_minmax(0,1fr)] border border-black print:hidden">
									<div className="border-b border-black px-2 py-1.5 font-semibold bg-gray-50">
										Client Name :
									</div>
									<div className="border-b border-black border-l border-l-black px-2 py-1.5 font-medium">
										{monthlyData.client_name}
									</div>
									<div className="border-b border-black px-2 py-1.5 font-semibold bg-gray-50">
										Project Name/Number :
									</div>
									<div className="border-b border-black border-l border-l-black px-2 py-1.5 font-medium">
										{[
											monthlyData.project.project_code,
											monthlyData.project.project_name,
										]
											.filter(Boolean)
											.join(' - ')}
									</div>
									<div className="px-2 py-1.5 font-semibold bg-gray-50">
										Month/Year :
									</div>
									<div className="border-l border-l-black px-2 py-1.5 font-medium">
										{monthlyData.month_label}
									</div>
								</div>

								<table className="mt-0 w-full table-fixed border-collapse border border-black">
									<caption className="sr-only">
										Manhours billing for {monthlyData.client_name} on{' '}
										{monthlyData.project.project_name} in{' '}
										{monthlyData.month_label}
									</caption>
									<colgroup>
										<col style={{ width: '4%' }} />
										<col style={{ width: '15%' }} />
										<col style={{ width: '9%' }} />
										<col style={{ width: '8%' }} />
										<col style={{ width: '8%' }} />
										<col style={{ width: '9%' }} />
										<col style={{ width: '7%' }} />
										<col style={{ width: '8%' }} />
										<col style={{ width: '8%' }} />
										<col style={{ width: '8%' }} />
										<col style={{ width: '8%' }} />
										<col style={{ width: '8%' }} />
									</colgroup>
									<thead>
										<tr>
											<th
												rowSpan={2}
												className="border border-black bg-yellow-100 px-1 py-1 text-center font-semibold"
											>
												Sr. No.
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-yellow-100 px-1 py-1 text-left font-semibold"
											>
												Employee Name
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-yellow-100 px-1 py-1 text-left font-semibold"
											>
												Designation
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
											>
												Total Manhours
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
											>
												Employee Charges
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
											>
												Amount
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
											>
												TDS
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold"
											>
												Net Payable
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-green-100 px-1 py-1 text-right font-semibold"
											>
												Accent Charges
											</th>
											<th
												rowSpan={2}
												className="border border-black bg-green-100 px-1 py-1 text-right font-semibold"
											>
												Amount
											</th>
											<th
												colSpan={2}
												className="border border-black bg-yellow-300 px-1 py-1 text-center font-semibold"
											>
												P&amp;L
											</th>
										</tr>
										<tr>
											<th className="border border-black bg-orange-200 px-1 py-1 text-right font-semibold">
												After Deductions
											</th>
											<th className="border border-black bg-yellow-300 px-1 py-1 text-right font-semibold">
												TDS
											</th>
										</tr>
									</thead>
									<tbody>
										{monthlyData.rows.length === 0 ? (
											<tr style={{ height: '36px' }}>
												<td
													colSpan={12}
													className="border border-black px-2 py-3 text-center text-gray-500"
												>
													No manhours logged on this project in{' '}
													{monthlyData.month_label}.
												</td>
											</tr>
										) : (
											monthlyData.rows.map((row) => (
												<tr
													key={row.employee_id ?? row.sr_no}
													style={{ height: '22px' }}
												>
													<td className="border border-black bg-yellow-100 px-1 py-1 text-center tabular-nums">
														{row.sr_no}
													</td>
													<td className="border border-black bg-yellow-100 px-1 py-1 font-medium">
														{row.employee_name}
													</td>
													<td className="border border-black bg-yellow-100 px-1 py-1">
														{row.designation || '—'}
													</td>
													<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums font-semibold">
														{fmtHours(row.total_manhours)}
													</td>
													<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
														{formatNumber(row.employee_charges)}
													</td>
													<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
														{formatNumber(row.amount)}
													</td>
													<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
														{formatNumber(row.tds)}
													</td>
													<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
														{formatNumber(row.net_payable)}
													</td>
													<td className="border border-black bg-green-100 px-1 py-1 text-right tabular-nums">
														{formatNumber(row.accent_charges)}
													</td>
													<td className="border border-black bg-green-100 px-1 py-1 text-right font-semibold tabular-nums">
														{formatNumber(row.accent_amount)}
													</td>
													<td className="border border-black bg-orange-200 px-1 py-1 text-right font-semibold tabular-nums">
														{formatNumber(row.pnl_after_deductions)}
													</td>
													<td className="border border-black bg-yellow-300 px-1 py-1 text-right font-semibold tabular-nums">
														{formatNumber(row.pnl_tds)}
													</td>
												</tr>
											))
										)}
										<tr style={{ height: '24px' }}>
											<td
												colSpan={3}
												className="border border-black bg-yellow-100 px-2 py-1 text-right font-semibold"
											>
												Total
											</td>
											<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
												{fmtHours(monthlyData.totals.total_manhours)}
											</td>
											<td className="border border-black bg-blue-100 px-1 py-1" />
											<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
												{formatNumber(monthlyData.totals.total_amount)}
											</td>
											<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
												{formatNumber(monthlyData.totals.total_tds)}
											</td>
											<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums">
												{formatNumber(monthlyData.totals.total_net_payable)}
											</td>
											<td className="border border-black bg-green-100 px-1 py-1" />
											<td className="border border-black bg-green-100 px-1 py-1 text-right font-semibold tabular-nums">
												{formatNumber(monthlyData.totals.total_accent_amount)}
											</td>
											<td className="border border-black bg-orange-200 px-1 py-1 text-right font-semibold tabular-nums">
												{formatNumber(
													monthlyData.totals.total_pnl_after_deductions
												)}
											</td>
											<td className="border border-black bg-yellow-300 px-1 py-1 text-right font-semibold tabular-nums">
												{formatNumber(monthlyData.totals.total_pnl_tds)}
											</td>
										</tr>
									</tbody>
								</table>

								<footer className="mhb-print-footer hidden print:flex">
									<span>
										Accent CRM — Manhours Billing Statement —{' '}
										{monthlyData.client_name}
									</span>
									<span>Generated {generatedAt}</span>
								</footer>
							</section>
						</div>
					)
				) : /* ─── 2. Annual FY Deputation Matrix View ─────────────── */
				!annualData ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1600px] items-center justify-center rounded-xl border border-gray-200 bg-white p-8 text-sm text-gray-500 shadow-sm">
						Select a client, project, and financial year to view the deputation
						matrix.
					</div>
				) : (
					<div className="mhb-scroll mx-auto max-w-[1600px] overflow-x-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:rounded-none print:border-none print:p-0 print:shadow-none">
						<section
							className="mhb-sheet min-w-[1100px] bg-white font-[Arial,sans-serif] text-[10px] leading-none text-black"
							style={{
								WebkitPrintColorAdjust: 'exact',
								printColorAdjust: 'exact',
							}}
						>
							{/* Print-only letterhead header */}
							<header className="mhb-print-header hidden print:block">
								<div className="mhb-print-header-row">
									<div className="mhb-print-brand">
										<Image
											src="/accent-logo.png"
											alt="Accent Techno Solutions"
											width={186}
											height={116}
											priority
											className="h-[13mm] w-auto object-contain"
										/>
									</div>
									<h1 className="mhb-print-title">
										Annual Deputation Manhours Summary
									</h1>
									<div className="mhb-print-period">
										<b>Period:</b> {annualData.fy_label}
									</div>
								</div>
								<div className="mhb-print-meta">
									<span>
										<b>Client:</b> {annualData.client_name}
									</span>
									<span>
										<b>Project:</b>{' '}
										{[
											annualData.project.project_code,
											annualData.project.project_name,
										]
											.filter(Boolean)
											.join(' - ')}
									</span>
									<span>
										<b>Financial Year:</b> {annualData.fy_label}
									</span>
									<span className="mhb-print-generated">
										<b>Generated:</b> {generatedAt}
									</span>
								</div>
							</header>

							{/* Header block mirroring template */}
							<div className="grid grid-cols-[150px_minmax(0,1fr)] border border-black print:hidden">
								<div className="border-b border-black px-2 py-1.5 font-semibold bg-gray-50">
									Client Name :
								</div>
								<div className="border-b border-black border-l border-l-black px-2 py-1.5 font-medium">
									{annualData.client_name}
								</div>
								<div className="border-b border-black px-2 py-1.5 font-semibold bg-gray-50">
									Project Name/Number :
								</div>
								<div className="border-b border-black border-l border-l-black px-2 py-1.5 font-medium">
									{[
										annualData.project.project_code,
										annualData.project.project_name,
									]
										.filter(Boolean)
										.join(' - ')}
								</div>
								<div className="px-2 py-1.5 font-semibold bg-gray-50">
									Period / Financial Year :
								</div>
								<div className="border-l border-l-black px-2 py-1.5 font-medium">
									{annualData.fy_label} (April {annualData.fy_year} – March{' '}
									{annualData.fy_year + 1})
								</div>
							</div>

							<table className="mt-0 w-full table-fixed border-collapse border border-black">
								<caption className="sr-only">
									Annual deputation summary for {annualData.client_name} on{' '}
									{annualData.project.project_name} in {annualData.fy_label}
								</caption>
								<colgroup>
									<col style={{ width: '3%' }} />
									<col style={{ width: '13%' }} />
									<col style={{ width: '6%' }} />
									<col style={{ width: '6%' }} />
									<col style={{ width: '6%' }} />
									{/* 12 Months: 12 * 4.2% = ~50.4% */}
									{annualData.month_keys.map((m) => (
										<col key={m} style={{ width: '4.2%' }} />
									))}
									<col style={{ width: '5.5%' }} />
									<col style={{ width: '7%' }} />
									<col style={{ width: '7%' }} />
									<col style={{ width: '7%' }} />
								</colgroup>
								<thead>
									<tr>
										<th className="border border-black bg-yellow-100 px-1 py-1.5 text-center font-semibold">
											Sr.
										</th>
										<th className="border border-black bg-yellow-100 px-1.5 py-1.5 text-left font-semibold">
											Team Member
										</th>
										<th className="border border-black bg-yellow-100 px-1 py-1.5 text-center font-semibold">
											Salary Type
										</th>
										<th className="border border-black bg-blue-100 px-1 py-1.5 text-right font-semibold">
											RT/HR (Co)
										</th>
										<th className="border border-black bg-blue-100 px-1 py-1.5 text-right font-semibold">
											RT/HR (Acc)
										</th>
										{annualData.months.map((m) => (
											<th
												key={m}
												className="border border-black bg-amber-100/70 px-0.5 py-1.5 text-right font-semibold"
											>
												{m}
											</th>
										))}
										<th className="border border-black bg-purple-100 px-1 py-1.5 text-right font-semibold">
											Total Hrs
										</th>
										<th className="border border-black bg-green-100 px-1 py-1.5 text-right font-semibold">
											Company Cost
										</th>
										<th className="border border-black bg-blue-100 px-1 py-1.5 text-right font-semibold">
											Accent Cost
										</th>
										<th className="border border-black bg-yellow-300 px-1 py-1.5 text-right font-semibold">
											P&amp;L
										</th>
									</tr>
								</thead>
								<tbody>
									{annualData.rows.length === 0 ? (
										<tr style={{ height: '36px' }}>
											<td
												colSpan={21}
												className="border border-black px-2 py-3 text-center text-gray-500"
											>
												No deputation manhours recorded for this project in{' '}
												{annualData.fy_label}.
											</td>
										</tr>
									) : (
										annualData.rows.map((row) => (
											<tr key={row.id || row.sr_no} style={{ height: '22px' }}>
												<td className="border border-black bg-yellow-100 px-1 py-1 text-center tabular-nums">
													{row.sr_no}
												</td>
												<td className="border border-black bg-yellow-100 px-1.5 py-1 font-medium truncate">
													{row.employee_name}
												</td>
												<td className="border border-black bg-yellow-100 px-1 py-1 text-center">
													<span className="capitalize text-[9px] text-gray-700">
														{row.salary_type || 'monthly'}
													</span>
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.rate_company)}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.rate_accent)}
												</td>
												{annualData.month_keys.map((mKey) => {
													const hrs = row.monthly_hours?.[mKey] || 0;
													return (
														<td
															key={mKey}
															className="border border-black bg-amber-50/50 px-0.5 py-1 text-right tabular-nums text-[9.5px]"
														>
															{hrs > 0 ? fmtHours(hrs) : '–'}
														</td>
													);
												})}
												<td className="border border-black bg-purple-100 px-1 py-1 text-right font-semibold tabular-nums text-purple-900">
													{fmtHours(row.total_hours)}
												</td>
												<td className="border border-black bg-green-100 px-1 py-1 text-right tabular-nums">
													{formatNumber(row.company_cost)}
												</td>
												<td className="border border-black bg-blue-100 px-1 py-1 text-right font-semibold tabular-nums text-blue-900">
													{formatNumber(row.accent_cost)}
												</td>
												<td
													className={`border border-black px-1 py-1 text-right font-semibold tabular-nums ${
														row.pnl >= 0
															? 'bg-yellow-300 text-green-950'
															: 'bg-red-200 text-red-900'
													}`}
												>
													{formatNumber(row.pnl)}
												</td>
											</tr>
										))
									)}
									{/* Grand Totals Row */}
									<tr style={{ height: '24px' }}>
										<td
											colSpan={5}
											className="border border-black bg-yellow-100 px-2 py-1 text-right font-semibold"
										>
											Grand Total
										</td>
										{annualData.month_keys.map((mKey) => {
											const mTotal =
												annualData.totals.monthly_hours?.[mKey] || 0;
											return (
												<td
													key={mKey}
													className="border border-black bg-amber-100 px-0.5 py-1 text-right font-semibold tabular-nums text-[9.5px]"
												>
													{mTotal > 0 ? fmtHours(mTotal) : '–'}
												</td>
											);
										})}
										<td className="border border-black bg-purple-200 px-1 py-1 text-right font-bold tabular-nums text-purple-950">
											{fmtHours(annualData.totals.total_hours)}
										</td>
										<td className="border border-black bg-green-200 px-1 py-1 text-right font-bold tabular-nums text-green-950">
											{formatNumber(annualData.totals.total_company_cost)}
										</td>
										<td className="border border-black bg-blue-200 px-1 py-1 text-right font-bold tabular-nums text-blue-950">
											{formatNumber(annualData.totals.total_accent_cost)}
										</td>
										<td
											className={`border border-black px-1 py-1 text-right font-bold tabular-nums ${
												annualData.totals.total_pnl >= 0
													? 'bg-yellow-300 text-green-950'
													: 'bg-red-200 text-red-950'
											}`}
										>
											{formatNumber(annualData.totals.total_pnl)}
										</td>
									</tr>
								</tbody>
							</table>

							<footer className="mhb-print-footer hidden print:flex">
								<span>
									Accent CRM — Annual Deputation Summary —{' '}
									{annualData.client_name}
								</span>
								<span>Generated {generatedAt}</span>
							</footer>
						</section>
					</div>
				)}
			</main>
		</div>
	);
}
