'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	BanknotesIcon,
	ClockIcon,
	CurrencyRupeeIcon,
	DocumentArrowDownIcon,
	PrinterIcon,
	TableCellsIcon,
	UserGroupIcon,
	BuildingOffice2Icon,
	XMarkIcon,
	CalendarDaysIcon,
	DocumentTextIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import ExpenditureView from './expenditure/expenditure-view';
import {
	mockFyResponse,
	mockMetaResponse,
	mockMonthResponse,
} from './employee-cost-mock-data';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatNumber, formatCurrency } from '@/lib/format';
import { cmcPrintStyles } from './print-styles';
import type {
	BreakdownTab,
	FYResponse,
	MetaResponse,
	Metric,
	MonthlyResponse,
	MonthlyRow,
	ProjectWiseMonthlySection,
	ViewMode,
} from './types';
import { expenditureMonths, monthLabel, projectKey } from './views/helpers';
import { MonthlyView } from './views/monthly-view';
import { FyView } from './views/fy-view';

export default function CompanyMonthlyCostPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
					Loading…
				</div>
			}
		>
			<CompanyMonthlyCostInner />
		</Suspense>
	);
}

function CompanyMonthlyCostInner() {
	const {
		user,
		can,
		RESOURCES,
		PERMISSIONS,
		loading: authLoading,
	} = useSessionRBAC() as {
		user: {
			is_super_admin?: boolean | number | null;
			field_permissions?: unknown;
		} | null;
		can: (resource: string, permission: string) => boolean;
		RESOURCES: {
			REPORTS: string;
			OTHER_EXPENSES: string;
			PAYROLL: string;
		};
		PERMISSIONS: { READ: string; UPDATE: string };
		loading: boolean;
	};

	const searchParams = useSearchParams();
	const sampleMode = searchParams?.get('sample') === '1';

	const [viewMode, setViewMode] = useState<ViewMode>(
		sampleMode ? 'monthly' : 'expenditure'
	);
	const [selectedMonth, setSelectedMonth] = useState(() => {
		const requested = searchParams?.get('month') ?? '';
		return /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) ? requested : '';
	});
	const [selectedFy, setSelectedFy] = useState('');
	const [metric, setMetric] = useState<Metric>('cost');
	const [breakdown, setBreakdown] = useState<BreakdownTab>('detailed');
	const [search, setSearch] = useState('');
	const [exporting, setExporting] = useState(false);

	const metaQuery = useQuery<MetaResponse>({
		queryKey: ['reports', 'company-monthly-cost', 'meta'],
		queryFn: () =>
			sampleMode
				? Promise.resolve(mockMetaResponse() as MetaResponse)
				: apiGet('/api/reports/company-monthly-cost'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const months = useMemo(() => meta?.months ?? [], [meta]);
	const financialYears = useMemo(() => meta?.financial_years ?? [], [meta]);

	useEffect(() => {
		if (!meta) return;
		// Company expenditure opens on the current month, so current cost
		// growth is what the reader sees first; the employee-cost views keep
		// opening on the latest month that has data.
		const preferredMonth =
			viewMode === 'expenditure'
				? (meta.current_month ?? meta.latest_month)
				: (meta.latest_month ?? meta.current_month);
		if (!selectedMonth && preferredMonth) setSelectedMonth(preferredMonth);
		if (!selectedFy && meta.current_fy) setSelectedFy(String(meta.current_fy));
	}, [meta, selectedMonth, selectedFy, viewMode]);

	const monthlyQuery = useQuery<MonthlyResponse>({
		queryKey: ['reports', 'company-monthly-cost', 'monthly', selectedMonth],
		queryFn: () =>
			sampleMode
				? Promise.resolve(mockMonthResponse(selectedMonth) as MonthlyResponse)
				: apiGet(
						`/api/reports/company-monthly-cost?view=monthly&month=${selectedMonth}`
					),
		enabled: viewMode === 'monthly' && !!selectedMonth,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const fyQuery = useQuery<FYResponse>({
		queryKey: ['reports', 'company-monthly-cost', 'fy', selectedFy],
		queryFn: () =>
			sampleMode
				? Promise.resolve(mockFyResponse(Number(selectedFy)) as FYResponse)
				: apiGet(`/api/reports/company-monthly-cost?view=fy&fy=${selectedFy}`),
		enabled: viewMode === 'fy' && !!selectedFy,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const monthlyData = monthlyQuery.data?.data ?? null;
	const fyData = fyQuery.data?.data ?? null;
	const activeQuery = viewMode === 'monthly' ? monthlyQuery : fyQuery;
	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	// Financial access is the reporting privilege. Project Activity access alone
	// must not reveal company expenditure, so the field grant is not accepted
	// here (server routes enforce the same rule).
	const hasAccess = isSuperAdmin || hasReportsPermission;
	const canRecordCost =
		isSuperAdmin || (!!can && can('other_expenses', 'create'));
	const canRecognizeCost =
		isSuperAdmin || (!!can && can('other_expenses', 'approve'));
	const canEditCost =
		isSuperAdmin || (!!can && can('other_expenses', 'update'));
	// The Project Cost Allocation Revision (#309) is a versioned financial
	// command: the payroll drilldown's read gate plus the payroll write
	// privilege. The server enforces the same conjunction.
	const canReviseAllocation =
		isSuperAdmin ||
		(!!can &&
			!!RESOURCES &&
			!!PERMISSIONS &&
			can(RESOURCES.REPORTS, PERMISSIONS.READ) &&
			can(RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
			can(RESOURCES.PAYROLL, PERMISSIONS.READ) &&
			can(RESOURCES.PAYROLL, PERMISSIONS.UPDATE));
	// Recording an outward cash settlement (#318) moves money: the financial
	// read gate plus the cost update privilege. The server enforces the same
	// conjunction.
	const canRecordSettlement =
		isSuperAdmin ||
		(!!can &&
			!!RESOURCES &&
			!!PERMISSIONS &&
			can(RESOURCES.REPORTS, PERMISSIONS.READ) &&
			can(RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
			can(RESOURCES.PAYROLL, PERMISSIONS.READ) &&
			can(RESOURCES.OTHER_EXPENSES, PERMISSIONS.UPDATE));
	// Closing a reviewed financial month (#322) freezes it: the financial
	// read gate plus the cost update privilege. The server enforces the same
	// conjunction.
	const canCloseMonth = canRecordSettlement;
	// Revising a closed financial month (#323) corrects it: the same
	// conjunction as closing. The server enforces the update privilege for
	// corrections and the approve privilege for reversals.
	const canReviseClosed = canRecordSettlement;
	// The expenditure view reads the direct-expense ledger, so it needs that
	// source's read privilege as well as reports:read. Without it the tab is
	// not offered and the report opens on the employee-cost views; the server
	// refuses the expenditure endpoints either way. While auth is still
	// loading, assume allowed so the default tab does not flicker.
	const canReadExpenseSource =
		authLoading || isSuperAdmin || (!!can && can('other_expenses', 'read'));
	// Since #307 the reconciliation carries recorded Payroll Slip employer
	// cost, so the payroll source privilege joins the same gate.
	const canReadPayrollSource =
		authLoading || isSuperAdmin || (!!can && can('payroll', 'read'));

	useEffect(() => {
		if (
			!authLoading &&
			(!canReadExpenseSource || !canReadPayrollSource) &&
			viewMode === 'expenditure'
		) {
			setViewMode('monthly');
		}
	}, [authLoading, canReadExpenseSource, canReadPayrollSource, viewMode]);
	const error =
		activeQuery.error?.message ||
		(activeQuery.data as unknown as { error?: string })?.error ||
		metaQuery.data?.error;
	const isLoading =
		activeQuery.isLoading || (activeQuery.isFetching && !activeQuery.data);

	const monthOptions = useMemo(
		() => months.map((m) => ({ value: m, label: monthLabel(m) })),
		[months]
	);

	// Source months plus the current/selected FY calendar months, generated
	// through the current month only; the selection is always kept.
	const expenditureMonthOptions = useMemo(() => {
		return expenditureMonths({
			sourceMonths: meta?.expenditure_months,
			currentMonth: meta?.current_month,
			selectedMonth,
		}).map((m) => ({ value: m, label: monthLabel(m) }));
	}, [meta, selectedMonth]);

	const handlePrint = () => window.print();
	const handleExport = async () => {
		if (sampleMode) {
			alert('Sample data is for preview only — Excel export is disabled.');
			return;
		}
		try {
			const url =
				viewMode === 'expenditure'
					? `/api/reports/company-monthly-cost/download?view=expenditure&month=${selectedMonth}`
					: viewMode === 'monthly'
						? `/api/reports/company-monthly-cost/download?view=monthly&month=${selectedMonth}`
						: `/api/reports/company-monthly-cost/download?view=fy&fy=${selectedFy}`;
			const response = await fetch(url, { credentials: 'include' });
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
				match?.[1] ||
				(viewMode === 'expenditure'
					? `Company_Expenditure_${selectedMonth}.xlsx`
					: viewMode === 'monthly'
						? `Company_Cost_${selectedMonth}.xlsx`
						: `Company_Cost_FY${selectedFy}.xlsx`);
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

	const normalizedSearch = search.trim().toLowerCase();
	const matchesSearch = useMemo(() => {
		const q = normalizedSearch;
		return (...fields: Array<string | null | undefined>) => {
			if (!q) return true;
			return fields.some((f) => f && f.toLowerCase().includes(q));
		};
	}, [normalizedSearch]);

	const filteredMonthlyRows = useMemo(() => {
		if (!monthlyData) return [];
		if (!normalizedSearch) return monthlyData.rows;
		return monthlyData.rows.filter((r) =>
			matchesSearch(
				r.employee_name,
				r.employee_code,
				r.project_name,
				r.project_code,
				r.client_name,
				r.department
			)
		);
	}, [monthlyData, normalizedSearch, matchesSearch]);

	const filteredMonthlyEmployeeRows = useMemo(() => {
		if (!monthlyData) return [];
		if (!normalizedSearch) return monthlyData.employee_rows;
		return monthlyData.employee_rows.filter((r) =>
			matchesSearch(
				r.employee_name,
				r.employee_code,
				r.department,
				r.designation
			)
		);
	}, [monthlyData, normalizedSearch, matchesSearch]);

	const filteredMonthlyProjectRows = useMemo(() => {
		if (!monthlyData) return [];
		if (!normalizedSearch) return monthlyData.project_rows;
		return monthlyData.project_rows.filter((r) =>
			matchesSearch(r.project_name, r.project_code, r.client_name)
		);
	}, [monthlyData, normalizedSearch, matchesSearch]);

	const projectWiseMonthlySections = useMemo<
		ProjectWiseMonthlySection[]
	>(() => {
		if (!monthlyData) return [];

		const rowsByProject = new Map<string, MonthlyRow[]>();
		for (const row of filteredMonthlyRows) {
			const key = projectKey(
				row.project_id,
				row.project_code,
				row.project_name
			);
			const rows = rowsByProject.get(key) ?? [];
			rows.push(row);
			rowsByProject.set(key, rows);
		}

		return monthlyData.project_rows
			.map((project) => ({
				project,
				rows:
					rowsByProject.get(
						projectKey(
							project.project_id,
							project.project_code,
							project.project_name
						)
					) ?? [],
			}))
			.filter((section) => section.rows.length > 0);
	}, [monthlyData, filteredMonthlyRows]);

	const filteredFyRows = useMemo(() => {
		if (!fyData) return [];
		if (!normalizedSearch) return fyData.rows;
		return fyData.rows.filter((r) =>
			matchesSearch(
				r.employee_name,
				r.employee_code,
				r.project_name,
				r.project_code,
				r.client_name
			)
		);
	}, [fyData, normalizedSearch, matchesSearch]);

	const filteredFyEmployeeRows = useMemo(() => {
		if (!fyData) return [];
		if (!normalizedSearch) return fyData.employee_rows;
		return fyData.employee_rows.filter((r) =>
			matchesSearch(r.employee_name, r.employee_code, r.department)
		);
	}, [fyData, normalizedSearch, matchesSearch]);

	const filteredFyProjectRows = useMemo(() => {
		if (!fyData) return [];
		if (!normalizedSearch) return fyData.project_rows;
		return fyData.project_rows.filter((r) =>
			matchesSearch(r.project_name, r.project_code, r.client_name)
		);
	}, [fyData, normalizedSearch, matchesSearch]);

	const monthlyTotals = monthlyData?.totals;
	const fyTotals = fyData?.totals;
	const generatedAt = new Date().toLocaleString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

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
					<div className="text-center" data-testid="access-denied">
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

	const renderContent = () => {
		if (
			viewMode === 'expenditure' &&
			canReadExpenseSource &&
			canReadPayrollSource
		) {
			return (
				<ExpenditureView
					month={selectedMonth}
					monthOptions={expenditureMonthOptions}
					onMonthChange={setSelectedMonth}
					canRecord={canRecordCost}
					canEditCost={canEditCost}
					canRecognize={canRecognizeCost}
					// #308: reaching this view already proves the financial read
					// gate (reports + both source reads, above); the reconstruction
					// controls add the operation privilege the routes enforce.
					canProposeReconstruction={canEditCost}
					canReviewReconstruction={canRecognizeCost}
					canRevise={canReviseAllocation}
					canRecordSettlement={canRecordSettlement}
					canCloseMonth={canCloseMonth}
					canReviseClosed={canReviseClosed}
				/>
			);
		}
		if (error) {
			return (
				<div className="px-4 py-10 text-center text-sm text-red-600">
					{error}
				</div>
			);
		}
		if (isLoading) {
			return (
				<div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-gray-500">
					<ArrowPathIcon className="h-4 w-4 animate-spin" />
					Loading company costs…
				</div>
			);
		}
		if (viewMode === 'monthly') {
			return (
				<MonthlyView
					data={monthlyData}
					totals={monthlyTotals}
					breakdown={breakdown}
					employeeRows={filteredMonthlyEmployeeRows}
					projectRows={filteredMonthlyProjectRows}
					sections={projectWiseMonthlySections}
				/>
			);
		}
		return (
			<FyView
				data={fyData}
				totals={fyTotals}
				breakdown={breakdown}
				metric={metric}
				rows={filteredFyRows}
				employeeRows={filteredFyEmployeeRows}
				projectRows={filteredFyProjectRows}
			/>
		);
	};

	return (
		<div className="cmc-print-page min-h-screen bg-gray-50/50 text-black">
			<style>{cmcPrintStyles}</style>
			<Navbar />
			<main className="px-2 pb-12 pt-2 sm:px-4 md:px-6">
				<div className="mx-auto mb-3 max-w-[1600px] print:hidden">
					<div className="flex flex-col gap-3 border-b border-gray-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#64126D]/10 text-[#64126D]">
									<CurrencyRupeeIcon className="h-4 w-4" />
								</span>
								Company Monthly Cost
							</h1>
							<p className="mt-0.5 text-xs text-gray-500">
								Company Incurred Cost reconciled to Incurred Project Cost,
								Company Overhead, and Unallocated Cost — with the employee-cost
								and financial-year views alongside
							</p>
							{sampleMode && (
								<p
									data-testid="sample-data-banner"
									className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"
								>
									Sample data — preview only, not company figures. Monthly and
									Financial Year views use fixtures; Expenditure stays live.
								</p>
							)}
						</div>
						<div
							role="tablist"
							aria-label="Report view"
							className="inline-flex flex-wrap shrink-0 self-start rounded-xl border border-gray-200/80 bg-gray-100/90 p-1 shadow-inner sm:self-auto"
						>
							{canReadExpenseSource && canReadPayrollSource && (
								<button
									type="button"
									role="tab"
									aria-selected={viewMode === 'expenditure'}
									onClick={() => setViewMode('expenditure')}
									className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'expenditure' ? 'bg-[#64126D] text-white shadow' : 'text-gray-600 hover:text-[#64126D]'}`}
								>
									<BanknotesIcon className="h-3.5 w-3.5" />
									Company Expenditure
								</button>
							)}
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === 'monthly'}
								onClick={() => setViewMode('monthly')}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'monthly' ? 'bg-[#64126D] text-white shadow' : 'text-gray-600 hover:text-[#64126D]'}`}
							>
								<CalendarDaysIcon className="h-3.5 w-3.5" />
								Employee Cost — Month
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === 'fy'}
								onClick={() => setViewMode('fy')}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'fy' ? 'bg-[#64126D] text-white shadow' : 'text-gray-600 hover:text-[#64126D]'}`}
							>
								<DocumentTextIcon className="h-3.5 w-3.5" />
								Employee Cost — FY
							</button>
						</div>
					</div>
					{viewMode !== 'expenditure' && (
						<>
							<div className="mt-3 flex flex-wrap items-center gap-2">
								{viewMode === 'monthly' ? (
									<div className="w-full max-w-[260px]">
										<SearchableSelect
											options={monthOptions}
											value={selectedMonth}
											onChange={(v) => setSelectedMonth(String(v))}
											placeholder={
												months.length ? 'Select month…' : 'No months'
											}
										/>
									</div>
								) : (
									<select
										value={selectedFy}
										onChange={(e) => setSelectedFy(e.target.value)}
										className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-purple-500"
										title="Financial year (Apr–Mar)"
									>
										{financialYears.map((fy) => (
											<option key={fy.year} value={String(fy.year)}>
												{fy.label}
											</option>
										))}
									</select>
								)}
								<div className="relative flex-1 min-w-[180px] max-w-sm">
									<input
										type="text"
										value={search}
										onChange={(e) => setSearch(e.target.value)}
										placeholder="Search employee, project, client…"
										className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-transparent focus:ring-2 focus:ring-purple-500"
									/>
								</div>
								{viewMode === 'fy' && (
									<div
										role="tablist"
										aria-label="Metric"
										className="inline-flex rounded-lg border border-gray-200 bg-gray-100 p-1"
									>
										{(['hours', 'cost'] as Metric[]).map((m) => (
											<button
												key={m}
												type="button"
												role="tab"
												aria-selected={metric === m}
												onClick={() => setMetric(m)}
												className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${metric === m ? 'bg-white shadow text-[#64126D]' : 'text-gray-600'}`}
											>
												{m === 'hours' ? (
													<ClockIcon className="h-3 w-3" />
												) : (
													<BanknotesIcon className="h-3 w-3" />
												)}
												{m === 'hours' ? 'Hours' : 'Cost'}
											</button>
										))}
									</div>
								)}
								<div className="ml-auto flex items-center gap-2">
									<button
										type="button"
										onClick={() => activeQuery.refetch()}
										disabled={isLoading}
										className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
									>
										<ArrowPathIcon
											className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
										/>
										Refresh
									</button>
									<button
										type="button"
										onClick={handleExport}
										disabled={exporting || isLoading || sampleMode}
										title={
											sampleMode
												? 'Excel export is disabled for sample data'
												: undefined
										}
										className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
									>
										{exporting ? (
											<ArrowPathIcon className="h-4 w-4 animate-spin" />
										) : (
											<DocumentArrowDownIcon className="h-4 w-4" />
										)}
										Excel
									</button>
									<button
										type="button"
										onClick={handlePrint}
										className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900"
									>
										<PrinterIcon className="h-4 w-4" />
										Print
									</button>
								</div>
							</div>
							<div className="mt-3 flex items-center gap-1.5 border-b border-gray-200">
								{(
									['detailed', 'byEmployee', 'byProject'] as BreakdownTab[]
								).map((tab) => (
									<button
										key={tab}
										type="button"
										onClick={() => setBreakdown(tab)}
										className={`rounded-t-lg border-b-2 px-3 py-1.5 text-xs font-semibold ${breakdown === tab ? 'border-[#64126D] bg-[#64126D]/5 text-[#64126D]' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
									>
										{tab === 'detailed'
											? viewMode === 'monthly'
												? 'Project Wise'
												: 'Detailed (Emp × Project)'
											: tab === 'byEmployee'
												? 'By Employee'
												: viewMode === 'monthly'
													? 'Project Summary'
													: 'By Project'}
									</button>
								))}
								<span className="ml-auto hidden text-xs text-gray-400 sm:inline">
									Generated {generatedAt}
								</span>
							</div>
						</>
					)}
				</div>
				<div
					className={`mx-auto mb-2 hidden max-w-[1600px] ${viewMode !== 'expenditure' && (viewMode === 'fy' || breakdown !== 'detailed') ? 'print:block' : ''}`}
				>
					<div className="border-b-2 border-[#64126d] pb-1">
						<h2 className="text-base font-bold text-[#4A1254]">
							Employee Cost —{' '}
							{viewMode === 'monthly'
								? monthlyData?.month_label || selectedMonth
								: fyData?.fy_label || `FY ${selectedFy}`}
						</h2>
						<p className="text-[9pt] text-gray-600">
							Total cost to company across all projects &amp; employees ·
							Generated {generatedAt}
						</p>
					</div>
				</div>
				{viewMode === 'monthly' && monthlyTotals && (
					<div
						className={`mx-auto mb-3 grid max-w-[1600px] grid-cols-2 gap-2 md:grid-cols-5 ${breakdown === 'detailed' ? 'print:hidden' : 'print:mb-1 print:grid-cols-5'}`}
					>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Total Hours
								</p>
								<ClockIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{formatNumber(monthlyTotals.total_hours)}
							</p>
							<p className="text-[10px] text-gray-400">
								{monthlyTotals.employee_count} employees
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Avg Rate / Hr
								</p>
								<TableCellsIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{formatCurrency(monthlyTotals.blended_rate)}
							</p>
						</div>
						<div className="rounded-xl border border-purple-200 bg-[#64126D]/5 p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-[#64126D]">
									Total Cost ({monthlyData?.month_label})
								</p>
								<BanknotesIcon className="h-4 w-4 text-[#64126D]" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-[#64126D] print:text-sm">
								{formatCurrency(monthlyTotals.total_cost)}
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Employees
								</p>
								<UserGroupIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{monthlyTotals.employee_count}
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Projects
								</p>
								<BuildingOffice2Icon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{monthlyTotals.project_count}
							</p>
						</div>
					</div>
				)}
				{viewMode === 'fy' && fyData && (
					<div className="mx-auto mb-3 grid max-w-[1600px] grid-cols-2 gap-2 md:grid-cols-5 print:mb-1 print:grid-cols-5">
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									FY Total Hours
								</p>
								<ClockIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{formatNumber(fyData.summary.total_hours)}
							</p>
							<p className="text-[10px] text-gray-400">
								{fyData.summary.employee_count} employees
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Avg Rate / Hr
								</p>
								<TableCellsIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{formatCurrency(fyData.summary.blended_rate)}
							</p>
						</div>
						<div className="rounded-xl border border-purple-200 bg-[#64126D]/5 p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-[#64126D]">
									FY Total Cost ({fyData.fy_label})
								</p>
								<BanknotesIcon className="h-4 w-4 text-[#64126D]" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-[#64126D] print:text-sm">
								{formatCurrency(fyData.summary.total_cost)}
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Employees
								</p>
								<UserGroupIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{fyData.summary.employee_count}
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Projects
								</p>
								<BuildingOffice2Icon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{fyData.summary.project_count}
							</p>
						</div>
					</div>
				)}
				<div className="cmc-sheet mx-auto max-w-[1600px] overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:overflow-visible print:rounded-none print:border-none print:shadow-none">
					{renderContent()}
				</div>
				{viewMode !== 'expenditure' && (
					<p className="mx-auto mt-2 max-w-[1600px] text-[10px] leading-relaxed text-gray-400 print:hidden">
						Hours are summed from daily activity logs per project; cost =
						payroll hourly rate in force that month × hours logged that month
						(hourly/daily rate when set, else gross salary ÷ standard working
						days × hours per day). Monthly view shows total cost to company for
						the selected month; FY view shows Apr–Mar matrix with company
						monthly totals. These employee-cost views are estimates until a
						month&apos;s payroll is finalized; the Expenditure view carries the
						recognized company cost.
					</p>
				)}
			</main>
		</div>
	);
}
