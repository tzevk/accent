'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatNumber, formatCurrency } from '@/lib/format';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

interface FinancialYearOption {
	year: number;
	label: string;
}

interface CompanyCostMeta {
	financial_years: FinancialYearOption[];
	current_fy: number;
	months: string[];
	latest_month: string | null;
	current_month: string;
	employees?: unknown[];
}

interface MonthlyRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hourly_rate: number;
	hours: number;
	cost: number;
}

interface MonthlyEmployeeRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	hourly_rate: number;
	hours: number;
	cost: number;
	project_count: number;
}

interface MonthlyProjectRow {
	sr_no: number;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hours: number;
	cost: number;
	employee_count: number;
}

interface MonthlyCompanyCostData {
	month: string;
	month_label: string;
	fy_label: string;
	fy_year: number;
	rows: MonthlyRow[];
	employee_rows: MonthlyEmployeeRow[];
	project_rows: MonthlyProjectRow[];
	totals: {
		total_hours: number;
		total_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
}

interface FYCompanyRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hourly_rate: number;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
}

interface FYEmployeeRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	hourly_rate: number;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	project_count: number;
}

interface FYProjectRow {
	sr_no: number;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	employee_count: number;
}

interface FYCompanyCostData {
	fy_label: string;
	fy_year: number;
	months: string[];
	month_keys: string[];
	rows: FYCompanyRow[];
	employee_rows: FYEmployeeRow[];
	project_rows: FYProjectRow[];
	totals: {
		monthly_hours: Record<string, number>;
		monthly_cost: Record<string, number>;
		total_hours: number;
		total_cost: number;
		blended_rate: number;
	};
	summary: {
		total_hours: number;
		total_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
}

interface MetaResponse {
	success: boolean;
	meta?: CompanyCostMeta;
	error?: string;
}

interface MonthlyResponse {
	success: boolean;
	data?: MonthlyCompanyCostData;
	view?: string;
	error?: string;
}

interface FYResponse {
	success: boolean;
	data?: FYCompanyCostData;
	view?: string;
	error?: string;
}

type ViewMode = 'monthly' | 'fy';
type BreakdownTab = 'detailed' | 'byEmployee' | 'byProject';
type Metric = 'hours' | 'cost';

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

function compactMonthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [year, monthNumber] = month.split('-').map(Number);
	const names = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
	];
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${names[monthNumber - 1]}-${String(year).slice(-2)}`;
}

function projectKey(
	projectId: number | null,
	projectCode: string,
	projectName: string
): string {
	return projectId != null
		? String(projectId)
		: projectCode || projectName || 'unknown';
}

function projectLabel(project: {
	project_code: string;
	project_name: string;
}): string {
	return (
		[project.project_code, project.project_name].filter(Boolean).join(' - ') ||
		'Unknown project'
	);
}

interface ProjectWiseMonthlySection {
	project: MonthlyProjectRow;
	rows: MonthlyRow[];
}

interface ProjectWiseMonthlyReportProps {
	sections: ProjectWiseMonthlySection[];
	month: string;
	monthLabel: string;
	totalCost: number;
}

function ProjectWiseMonthlyReport({
	sections,
	month,
	monthLabel: selectedMonthLabel,
	totalCost,
}: ProjectWiseMonthlyReportProps) {
	if (sections.length === 0) {
		return (
			<div className="px-4 py-12 text-center">
				<p className="text-sm font-medium text-gray-700">
					No logged manhours for {selectedMonthLabel}
				</p>
				<p className="mt-1 text-xs text-gray-500">
					Hours come from daily activity logs.
				</p>
			</div>
		);
	}

	const columnWidths = ['12%', '45%', '14%', '14%', '15%'];

	return (
		<div className="epc-project-wise-sheet min-w-[680px] bg-white font-[Arial,sans-serif] text-[13px] leading-tight text-black">
			{sections.map(({ project, rows }) => (
				<section
					key={`${projectKey(project.project_id, project.project_code, project.project_name)}-${project.sr_no}`}
					className="epc-project-section mb-6"
				>
					<div className="epc-project-meta grid grid-cols-[130px_minmax(0,1fr)] border border-black">
						<div className="border-b border-black px-2 py-2 font-bold">
							Project No.:
						</div>
						<div className="border-b border-l border-black px-2 py-2 font-semibold">
							{projectLabel(project)}
						</div>
						<div className="border-b border-black px-2 py-2 font-bold">
							Project Name:
						</div>
						<div className="border-b border-l border-black px-2 py-2 font-semibold">
							{project.project_name || '—'}
						</div>
						<div className="border-b border-black px-2 py-2 font-bold">
							Client Name:
						</div>
						<div className="border-b border-l border-black px-2 py-2 font-semibold">
							{project.client_name || '—'}
						</div>
						<div className="px-2 py-2 font-bold">Month:</div>
						<div className="border-l border-black px-2 py-2 font-semibold">
							{compactMonthLabel(month)}
						</div>
					</div>

					<table className="w-full table-fixed border-collapse border border-black">
						<caption className="sr-only">
							Employee cost for {projectLabel(project)} in {selectedMonthLabel}
						</caption>
						<colgroup>
							{columnWidths.map((width, index) => (
								<col key={`project-column-${index}`} style={{ width }} />
							))}
						</colgroup>
						<thead>
							<tr>
								<th className="border border-black px-2 py-3 text-center font-bold text-[#64126D]">
									Sr. No.
								</th>
								<th className="border border-black px-2 py-3 text-left font-bold text-[#64126D]">
									Employee Name
								</th>
								<th className="border border-black px-2 py-3 text-right font-bold text-[#64126D]">
									Hourly Cost
								</th>
								<th className="border border-black px-2 py-3 text-right font-bold text-[#64126D]">
									Working Hours
								</th>
								<th className="border border-black px-2 py-3 text-right font-bold text-[#64126D]">
									Amount
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, rowIndex) => (
								<tr key={`${row.employee_id}-${row.sr_no}`}>
									<td className="border border-black px-2 py-1.5 text-center tabular-nums">
										{rowIndex + 1}
									</td>
									<td className="border border-black px-2 py-1.5 font-medium text-[#4A1254]">
										{row.employee_name}
									</td>
									<td className="border border-black px-2 py-1.5 text-right tabular-nums">
										{row.hourly_rate > 0 ? formatNumber(row.hourly_rate) : '-'}
									</td>
									<td className="border border-black px-2 py-1.5 text-right tabular-nums">
										{formatNumber(row.hours).replace(/\.00$/, '')}
									</td>
									<td className="border border-black px-2 py-1.5 text-right font-semibold tabular-nums">
										{formatNumber(row.cost)}
									</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr className="bg-[#8FD3ED]">
								<td
									colSpan={3}
									className="border border-black px-2 py-2 text-right text-base font-bold"
								>
									Total &gt;&gt;&gt;
								</td>
								<td className="border border-black px-2 py-2 text-right text-base font-bold tabular-nums">
									{formatNumber(project.hours).replace(/\.00$/, '')}
								</td>
								<td className="border border-black px-2 py-2 text-right text-base font-bold tabular-nums">
									{formatNumber(project.cost)}
								</td>
							</tr>
						</tfoot>
					</table>
				</section>
			))}

			<table className="w-full table-fixed border-collapse border border-black">
				<caption className="sr-only">Total amount for all projects</caption>
				<colgroup>
					{columnWidths.map((width, index) => (
						<col key={`total-column-${index}`} style={{ width }} />
					))}
				</colgroup>
				<tfoot>
					<tr className="bg-[#B5E5A2]">
						<td
							colSpan={4}
							className="border border-black px-2 py-3 text-right text-base font-bold"
						>
							Total Amount for All project &gt;&gt;&gt;
						</td>
						<td className="border border-black px-2 py-3 text-right text-base font-bold tabular-nums">
							{formatNumber(totalCost)}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>
	);
}

const epcPrintStyles = `
@media print {
	@page {
		size: A4 landscape;
		margin: 10mm 9mm 14mm 9mm;
		@bottom-center {
			content: "Accent CRM — Employee Project Monthly Cost — Page " counter(page) " of " counter(pages);
			font-size: 7pt;
			color: #6b7280;
		}
	}
	.epc-print-page {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.epc-print-page nav,
	.epc-print-page .print\\:hidden {
		display: none !important;
	}
	body > aside {
		display: none !important;
	}
	.content-with-sidebar {
		padding-left: 0 !important;
		padding-top: 0 !important;
	}
	.epc-print-page main {
		padding: 0 !important;
	}
	.epc-sheet {
		overflow: visible !important;
		border: 0 !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}
	.epc-sheet table {
		font-size: 7.5pt;
	}
	.epc-sheet th,
	.epc-sheet td {
		padding: 1.5px 3px !important;
	}
	.epc-sheet thead {
		display: table-header-group;
	}
	.epc-sheet tbody tr {
		break-inside: avoid;
	}
	.epc-project-wise-sheet {
		min-width: 0 !important;
		font-size: 9pt;
	}
	.epc-project-wise-sheet table {
		min-width: 0 !important;
		font-size: 8.5pt;
	}
	.epc-project-section {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.epc-project-meta {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.epc-project-wise-sheet th,
	.epc-project-wise-sheet td {
		padding: 2mm 2.5mm !important;
	}
}`;

export default function EmployeeProjectMonthlyCostPage() {
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
		RESOURCES: { REPORTS: string };
		PERMISSIONS: { READ: string };
		loading: boolean;
	};

	const [viewMode, setViewMode] = useState<ViewMode>('monthly');
	const [selectedMonth, setSelectedMonth] = useState('');
	const [selectedFy, setSelectedFy] = useState('');
	const [metric, setMetric] = useState<Metric>('cost');
	const [breakdown, setBreakdown] = useState<BreakdownTab>('detailed');
	const [search, setSearch] = useState('');
	const [exporting, setExporting] = useState(false);

	const metaQuery = useQuery<MetaResponse>({
		queryKey: ['reports', 'employee-project-monthly-cost', 'meta'],
		queryFn: () => apiGet('/api/reports/employee-project-monthly-cost'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const months = useMemo(() => meta?.months ?? [], [meta]);
	const financialYears = useMemo(() => meta?.financial_years ?? [], [meta]);

	useEffect(() => {
		if (!meta) return;
		if (!selectedMonth && meta.latest_month)
			setSelectedMonth(meta.latest_month);
		else if (!selectedMonth && meta.current_month)
			setSelectedMonth(meta.current_month);
		if (!selectedFy && meta.current_fy) setSelectedFy(String(meta.current_fy));
	}, [meta, selectedMonth, selectedFy]);

	const monthlyQuery = useQuery<MonthlyResponse>({
		queryKey: [
			'reports',
			'employee-project-monthly-cost',
			'monthly',
			selectedMonth,
		],
		queryFn: () =>
			apiGet(
				`/api/reports/employee-project-monthly-cost?view=monthly&month=${selectedMonth}`
			),
		enabled: viewMode === 'monthly' && !!selectedMonth,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const fyQuery = useQuery<FYResponse>({
		queryKey: ['reports', 'employee-project-monthly-cost', 'fy', selectedFy],
		queryFn: () =>
			apiGet(
				`/api/reports/employee-project-monthly-cost?view=fy&fy=${selectedFy}`
			),
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
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;
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

	const handlePrint = () => window.print();
	const handleExport = async () => {
		setExporting(true);
		try {
			const url =
				viewMode === 'monthly'
					? `/api/reports/employee-project-monthly-cost/download?view=monthly&month=${selectedMonth}`
					: `/api/reports/employee-project-monthly-cost/download?view=fy&fy=${selectedFy}`;
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
				(viewMode === 'monthly'
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

	const renderContent = () => {
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
			if (!monthlyData) {
				return (
					<div className="px-4 py-12 text-center text-sm text-gray-500">
						Select a month to view company cost.
					</div>
				);
			}
			if (breakdown === 'detailed') {
				return (
					<ProjectWiseMonthlyReport
						sections={projectWiseMonthlySections}
						month={monthlyData.month}
						monthLabel={monthlyData.month_label}
						totalCost={monthlyData.totals.total_cost}
					/>
				);
			}
			if (breakdown === 'byEmployee') {
				if (filteredMonthlyEmployeeRows.length === 0) {
					return (
						<div className="px-4 py-12 text-center text-sm text-gray-500">
							No data for {monthlyData.month_label}
						</div>
					);
				}
				return (
					<table className="w-full min-w-[800px] border-collapse text-xs">
						<thead>
							<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
								<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
									Sr
								</th>
								<th className="min-w-[200px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
									Employee
								</th>
								<th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
									Department
								</th>
								<th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
									Designation
								</th>
								<th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
									Rate/Hr
								</th>
								<th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
									Hours
								</th>
								<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
									Cost
								</th>
								<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
									Projects
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-gray-200">
							{filteredMonthlyEmployeeRows.map((r) => (
								<tr key={r.employee_id} className="hover:bg-purple-50/40">
									<td className="px-2 py-1 text-center text-gray-500">
										{r.sr_no}
									</td>
									<td className="px-2 py-1">
										<div className="font-medium text-[#4A1254]">
											{r.employee_name}
										</div>
										<div className="text-[10px] text-gray-500">
											{r.employee_code}
										</div>
									</td>
									<td className="px-2 py-1 text-gray-600">
										{r.department || '—'}
									</td>
									<td className="px-2 py-1 text-gray-600">
										{r.designation || '—'}
									</td>
									<td className="px-2 py-1 text-right font-mono">
										{r.hourly_rate > 0 ? formatCurrency(r.hourly_rate) : '—'}
									</td>
									<td className="px-2 py-1 text-right font-mono">
										{formatNumber(r.hours).replace(/\.00$/, '')}
									</td>
									<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-[#64126D]">
										{formatCurrency(r.cost)}
									</td>
									<td className="px-2 py-1 text-center">{r.project_count}</td>
								</tr>
							))}
						</tbody>
						<tfoot>
							<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
								<td
									colSpan={5}
									className="px-2 py-1.5 text-right text-[11px] uppercase text-[#4A1254]"
								>
									Grand Total
								</td>
								<td className="px-2 py-1.5 text-right font-mono text-[#4A1254]">
									{formatNumber(monthlyTotals?.total_hours ?? 0).replace(
										/\.00$/,
										''
									)}
								</td>
								<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
									{formatCurrency(monthlyTotals?.total_cost ?? 0)}
								</td>
								<td className="px-2 py-1.5 text-center text-[#4A1254]">
									{monthlyTotals?.project_count ?? 0}
								</td>
							</tr>
						</tfoot>
					</table>
				);
			}
			// byProject
			if (filteredMonthlyProjectRows.length === 0) {
				return (
					<div className="px-4 py-12 text-center text-sm text-gray-500">
						No project data for {monthlyData.month_label}
					</div>
				);
			}
			return (
				<table className="w-full min-w-[700px] border-collapse text-xs">
					<thead>
						<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
							<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
								Sr
							</th>
							<th className="min-w-[220px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Project
							</th>
							<th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Client
							</th>
							<th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Hours
							</th>
							<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Cost
							</th>
							<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
								Employees
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-200">
						{filteredMonthlyProjectRows.map((r) => (
							<tr
								key={`${r.project_id ?? r.project_code}-${r.sr_no}`}
								className="hover:bg-purple-50/40"
							>
								<td className="px-2 py-1 text-center text-gray-500">
									{r.sr_no}
								</td>
								<td className="px-2 py-1">
									{r.project_id ? (
										<Link
											href={`/projects/${r.project_id}`}
											className="font-medium text-[#4A1254] hover:underline"
										>
											{r.project_code
												? `${r.project_code} – ${r.project_name}`
												: r.project_name}
										</Link>
									) : (
										<span className="font-medium text-[#4A1254]">
											{r.project_name}
										</span>
									)}
								</td>
								<td className="px-2 py-1 text-gray-600">
									{r.client_name || '—'}
								</td>
								<td className="px-2 py-1 text-right font-mono">
									{formatNumber(r.hours).replace(/\.00$/, '')}
								</td>
								<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-[#64126D]">
									{formatCurrency(r.cost)}
								</td>
								<td className="px-2 py-1 text-center">{r.employee_count}</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
							<td
								colSpan={3}
								className="px-2 py-1.5 text-right text-[11px] uppercase text-[#4A1254]"
							>
								Grand Total
							</td>
							<td className="px-2 py-1.5 text-right font-mono text-[#4A1254]">
								{formatNumber(monthlyTotals?.total_hours ?? 0).replace(
									/\.00$/,
									''
								)}
							</td>
							<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
								{formatCurrency(monthlyTotals?.total_cost ?? 0)}
							</td>
							<td className="px-2 py-1.5 text-center text-[#4A1254]">
								{monthlyTotals?.employee_count ?? 0}
							</td>
						</tr>
					</tfoot>
				</table>
			);
		}
		// fy view
		if (!fyData) {
			return (
				<div className="px-4 py-12 text-center text-sm text-gray-500">
					Select a financial year to view the company cost matrix.
				</div>
			);
		}
		if (breakdown === 'detailed') {
			if (filteredFyRows.length === 0) {
				return (
					<div className="px-4 py-12 text-center">
						<p className="text-sm font-medium text-gray-700">
							No logged manhours in {fyData.fy_label}
						</p>
					</div>
				);
			}
			return (
				<table className="w-full min-w-[1300px] border-collapse text-xs">
					<thead>
						<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
							<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
								Sr
							</th>
							<th className="min-w-[160px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Employee
							</th>
							<th className="min-w-[180px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Project
							</th>
							<th className="min-w-[100px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Client
							</th>
							<th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Rate/Hr
							</th>
							{fyData.months.map((m) => (
								<th
									key={m}
									className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]"
								>
									{m}
								</th>
							))}
							<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Total Hrs
							</th>
							<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Total Cost
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-200">
						{filteredFyRows.map((r) => (
							<tr
								key={`${r.employee_id}-${r.project_id ?? r.project_code}-${r.sr_no}`}
								className="hover:bg-purple-50/40"
							>
								<td className="px-2 py-1 text-center text-gray-500">
									{r.sr_no}
								</td>
								<td className="px-2 py-1">
									<div className="font-medium text-[#4A1254] leading-tight">
										{r.employee_name}
									</div>
									<div className="text-[10px] text-gray-500">
										{r.employee_code} {r.department ? `· ${r.department}` : ''}
									</div>
								</td>
								<td className="px-2 py-1">
									{r.project_id ? (
										<Link
											href={`/projects/${r.project_id}`}
											className="font-medium text-[#4A1254] hover:underline"
										>
											{r.project_code
												? `${r.project_code} – ${r.project_name}`
												: r.project_name}
										</Link>
									) : (
										<span className="font-medium text-[#4A1254]">
											{r.project_name}
										</span>
									)}
								</td>
								<td
									className="max-w-[120px] truncate px-2 py-1 text-gray-600"
									title={r.client_name}
								>
									{r.client_name || '—'}
								</td>
								<td className="px-2 py-1 text-right font-mono text-gray-700">
									{r.hourly_rate > 0 ? formatCurrency(r.hourly_rate) : '—'}
								</td>
								{fyData.month_keys.map((mKey) => {
									const v =
										(metric === 'cost'
											? r.monthly_cost[mKey]
											: r.monthly_hours[mKey]) || 0;
									return (
										<td
											key={mKey}
											className={`px-2 py-1 text-right font-mono ${v > 0 ? 'text-gray-900' : 'text-gray-300'}`}
										>
											{v > 0
												? metric === 'hours'
													? formatNumber(v).replace(/\.00$/, '')
													: formatCurrency(v)
												: '—'}
										</td>
									);
								})}
								<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-gray-900">
									{formatNumber(r.total_hours).replace(/\.00$/, '')}
								</td>
								<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-[#64126D]">
									{formatCurrency(r.total_cost)}
								</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
							<td
								colSpan={5}
								className="px-2 py-1.5 text-right text-[11px] uppercase text-[#4A1254]"
							>
								Grand Total — Company ({metric === 'hours' ? 'hours' : 'cost'})
							</td>
							{fyData.month_keys.map((mKey) => {
								const v =
									(metric === 'cost'
										? fyTotals?.monthly_cost[mKey]
										: fyTotals?.monthly_hours[mKey]) || 0;
								return (
									<td
										key={mKey}
										className="px-2 py-1.5 text-right font-mono text-[#4A1254]"
									>
										{v > 0
											? metric === 'hours'
												? formatNumber(v).replace(/\.00$/, '')
												: formatCurrency(v)
											: '—'}
									</td>
								);
							})}
							<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
								{formatNumber(fyTotals?.total_hours ?? 0).replace(/\.00$/, '')}
							</td>
							<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
								{formatCurrency(fyTotals?.total_cost ?? 0)}
							</td>
						</tr>
					</tfoot>
				</table>
			);
		}
		if (breakdown === 'byEmployee') {
			if (filteredFyEmployeeRows.length === 0) {
				return (
					<div className="px-4 py-12 text-center text-sm text-gray-500">
						No employee data for {fyData.fy_label}
					</div>
				);
			}
			return (
				<table className="w-full min-w-[1200px] border-collapse text-xs">
					<thead>
						<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
							<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
								Sr
							</th>
							<th className="min-w-[180px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Employee
							</th>
							<th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
								Dept
							</th>
							<th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Rate/Hr
							</th>
							{fyData.months.map((m) => (
								<th
									key={m}
									className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]"
								>
									{m}
								</th>
							))}
							<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Total Hrs
							</th>
							<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
								Total Cost
							</th>
							<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
								Projects
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-200">
						{filteredFyEmployeeRows.map((r) => (
							<tr key={r.employee_id} className="hover:bg-purple-50/40">
								<td className="px-2 py-1 text-center text-gray-500">
									{r.sr_no}
								</td>
								<td className="px-2 py-1">
									<div className="font-medium text-[#4A1254]">
										{r.employee_name}
									</div>
									<div className="text-[10px] text-gray-500">
										{r.employee_code}
									</div>
								</td>
								<td className="px-2 py-1 text-gray-600">
									{r.department || '—'}
								</td>
								<td className="px-2 py-1 text-right font-mono">
									{r.hourly_rate > 0 ? formatCurrency(r.hourly_rate) : '—'}
								</td>
								{fyData.month_keys.map((mKey) => {
									const v =
										(metric === 'cost'
											? r.monthly_cost[mKey]
											: r.monthly_hours[mKey]) || 0;
									return (
										<td
											key={mKey}
											className={`px-2 py-1 text-right font-mono ${v > 0 ? 'text-gray-900' : 'text-gray-300'}`}
										>
											{v > 0
												? metric === 'hours'
													? formatNumber(v).replace(/\.00$/, '')
													: formatCurrency(v)
												: '—'}
										</td>
									);
								})}
								<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold">
									{formatNumber(r.total_hours).replace(/\.00$/, '')}
								</td>
								<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-[#64126D]">
									{formatCurrency(r.total_cost)}
								</td>
								<td className="px-2 py-1 text-center">{r.project_count}</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
							<td
								colSpan={4}
								className="px-2 py-1.5 text-right text-[11px] uppercase text-[#4A1254]"
							>
								Grand Total ({metric})
							</td>
							{fyData.month_keys.map((mKey) => {
								const v =
									(metric === 'cost'
										? fyTotals?.monthly_cost[mKey]
										: fyTotals?.monthly_hours[mKey]) || 0;
								return (
									<td
										key={mKey}
										className="px-2 py-1.5 text-right font-mono text-[#4A1254]"
									>
										{v > 0
											? metric === 'hours'
												? formatNumber(v).replace(/\.00$/, '')
												: formatCurrency(v)
											: '—'}
									</td>
								);
							})}
							<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
								{formatNumber(fyTotals?.total_hours ?? 0).replace(/\.00$/, '')}
							</td>
							<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
								{formatCurrency(fyTotals?.total_cost ?? 0)}
							</td>
							<td className="px-2 py-1.5 text-center text-[#4A1254]">
								{fyData.summary.employee_count}
							</td>
						</tr>
					</tfoot>
				</table>
			);
		}
		// byProject
		if (filteredFyProjectRows.length === 0) {
			return (
				<div className="px-4 py-12 text-center text-sm text-gray-500">
					No project data for {fyData.fy_label}
				</div>
			);
		}
		return (
			<table className="w-full min-w-[1200px] border-collapse text-xs">
				<thead>
					<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
						<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
							Sr
						</th>
						<th className="min-w-[200px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
							Project
						</th>
						<th className="min-w-[120px] px-2 py-1.5 text-left text-[10px] font-bold uppercase text-[#64126D]">
							Client
						</th>
						{fyData.months.map((m) => (
							<th
								key={m}
								className="px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]"
							>
								{m}
							</th>
						))}
						<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
							Total Hrs
						</th>
						<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase text-[#64126D]">
							Total Cost
						</th>
						<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase text-[#64126D]">
							Employees
						</th>
					</tr>
				</thead>
				<tbody className="divide-y divide-gray-200">
					{filteredFyProjectRows.map((r) => (
						<tr
							key={`${r.project_id ?? r.project_code}-${r.sr_no}`}
							className="hover:bg-purple-50/40"
						>
							<td className="px-2 py-1 text-center text-gray-500">{r.sr_no}</td>
							<td className="px-2 py-1">
								{r.project_id ? (
									<Link
										href={`/projects/${r.project_id}`}
										className="font-medium text-[#4A1254] hover:underline"
									>
										{r.project_code
											? `${r.project_code} – ${r.project_name}`
											: r.project_name}
									</Link>
								) : (
									<span className="font-medium text-[#4A1254]">
										{r.project_name}
									</span>
								)}
							</td>
							<td className="px-2 py-1 text-gray-600">
								{r.client_name || '—'}
							</td>
							{fyData.month_keys.map((mKey) => {
								const v =
									(metric === 'cost'
										? r.monthly_cost[mKey]
										: r.monthly_hours[mKey]) || 0;
								return (
									<td
										key={mKey}
										className={`px-2 py-1 text-right font-mono ${v > 0 ? 'text-gray-900' : 'text-gray-300'}`}
									>
										{v > 0
											? metric === 'hours'
												? formatNumber(v).replace(/\.00$/, '')
												: formatCurrency(v)
											: '—'}
									</td>
								);
							})}
							<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold">
								{formatNumber(r.total_hours).replace(/\.00$/, '')}
							</td>
							<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-[#64126D]">
								{formatCurrency(r.total_cost)}
							</td>
							<td className="px-2 py-1 text-center">{r.employee_count}</td>
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
						<td
							colSpan={3}
							className="px-2 py-1.5 text-right text-[11px] uppercase text-[#4A1254]"
						>
							Grand Total ({metric})
						</td>
						{fyData.month_keys.map((mKey) => {
							const v =
								(metric === 'cost'
									? fyTotals?.monthly_cost[mKey]
									: fyTotals?.monthly_hours[mKey]) || 0;
							return (
								<td
									key={mKey}
									className="px-2 py-1.5 text-right font-mono text-[#4A1254]"
								>
									{v > 0
										? metric === 'hours'
											? formatNumber(v).replace(/\.00$/, '')
											: formatCurrency(v)
										: '—'}
								</td>
							);
						})}
						<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
							{formatNumber(fyTotals?.total_hours ?? 0).replace(/\.00$/, '')}
						</td>
						<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
							{formatCurrency(fyTotals?.total_cost ?? 0)}
						</td>
						<td className="px-2 py-1.5 text-center text-[#4A1254]">
							{fyData.summary.employee_count}
						</td>
					</tr>
				</tfoot>
			</table>
		);
	};

	return (
		<div className="epc-print-page min-h-screen bg-gray-50/50 text-black">
			<style>{epcPrintStyles}</style>
			<Navbar />
			<main className="px-2 pb-12 pt-2 sm:px-4 md:px-6">
				<div className="mx-auto mb-3 max-w-[1600px] print:hidden">
					<div className="flex flex-col gap-3 border-b border-gray-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#64126D]/10 text-[#64126D]">
									<CurrencyRupeeIcon className="h-4 w-4" />
								</span>
								Employee Project Monthly Cost
							</h1>
							<p className="mt-0.5 text-xs text-gray-500">
								Total cost to company across all projects &amp; all employees —
								monthly and financial-year views
							</p>
						</div>
						<div
							role="tablist"
							aria-label="Report view"
							className="inline-flex self-start rounded-xl border border-gray-200/80 bg-gray-100/90 p-1 shadow-inner sm:self-auto"
						>
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === 'monthly'}
								onClick={() => setViewMode('monthly')}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'monthly' ? 'bg-[#64126D] text-white shadow' : 'text-gray-600 hover:text-[#64126D]'}`}
							>
								<CalendarDaysIcon className="h-3.5 w-3.5" />
								Monthly
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={viewMode === 'fy'}
								onClick={() => setViewMode('fy')}
								className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${viewMode === 'fy' ? 'bg-[#64126D] text-white shadow' : 'text-gray-600 hover:text-[#64126D]'}`}
							>
								<DocumentTextIcon className="h-3.5 w-3.5" />
								Financial Year
							</button>
						</div>
					</div>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						{viewMode === 'monthly' ? (
							<div className="w-full max-w-[260px]">
								<SearchableSelect
									options={monthOptions}
									value={selectedMonth}
									onChange={(v) => setSelectedMonth(String(v))}
									placeholder={months.length ? 'Select month…' : 'No months'}
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
								disabled={exporting || isLoading}
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
						{(['detailed', 'byEmployee', 'byProject'] as BreakdownTab[]).map(
							(tab) => (
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
							)
						)}
						<span className="ml-auto hidden text-xs text-gray-400 sm:inline">
							Generated {generatedAt}
						</span>
					</div>
				</div>
				<div
					className={`mx-auto mb-2 hidden max-w-[1600px] ${viewMode === 'fy' || breakdown !== 'detailed' ? 'print:block' : ''}`}
				>
					<div className="border-b-2 border-[#64126d] pb-1">
						<h2 className="text-base font-bold text-[#4A1254]">
							Employee Project Monthly Cost —{' '}
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
				<div className="epc-sheet mx-auto max-w-[1600px] overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm print:overflow-visible print:rounded-none print:border-none print:shadow-none">
					{renderContent()}
				</div>
				<p className="mx-auto mt-2 max-w-[1600px] text-[10px] leading-relaxed text-gray-400 print:hidden">
					Hours are summed from daily activity logs per project; cost = payroll
					hourly rate in force that month × hours logged that month
					(hourly/daily rate when set, else gross salary ÷ standard working days
					× hours per day). Monthly view shows total cost to company for the
					selected month; FY view shows Apr–Mar matrix with company monthly
					totals.
				</p>
			</main>
		</div>
	);
}
