'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	ArrowTopRightOnSquareIcon,
	BanknotesIcon,
	ClockIcon,
	CurrencyRupeeIcon,
	DocumentArrowDownIcon,
	PrinterIcon,
	TableCellsIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatNumber, formatCurrency } from '@/lib/format';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ─── Client-safe API types (mirror data-source.ts) ──────────────────

interface CostEmployee {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	designation: string | null;
}

interface FinancialYearOption {
	year: number;
	label: string;
}

interface CostMeta {
	employees: CostEmployee[];
	financial_years: FinancialYearOption[];
	current_fy: number;
}

interface ProjectCostRow {
	sr_no: number;
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

interface ProjectCostTotals {
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	blended_rate: number;
}

interface EmployeeProjectCostData {
	employee: CostEmployee | null;
	fy_label: string;
	fy_year: number;
	months: string[];
	month_keys: string[];
	rows: ProjectCostRow[];
	totals: ProjectCostTotals;
}

interface MetaResponse {
	success: boolean;
	meta?: CostMeta;
	error?: string;
}

interface DataResponse {
	success: boolean;
	data?: EmployeeProjectCostData;
	error?: string;
}

type Metric = 'hours' | 'cost';

// ─── Print layout (A4 landscape) ────────────────────────────────────

const epcPrintStyles = `
@media print {
	@page {
		size: A4 landscape;
		margin: 10mm 9mm 14mm 9mm;
		@bottom-center {
			content: "Accent CRM — Employee Project Cost Report — Page " counter(page) " of " counter(pages);
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
}`;

function cellValue(row: ProjectCostRow, mKey: string, metric: Metric): number {
	return (
		(metric === 'cost' ? row.monthly_cost : row.monthly_hours)?.[mKey] || 0
	);
}

export default function EmployeeProjectCostPage() {
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

	const [employeeId, setEmployeeId] = useState('');
	const [fyYear, setFyYear] = useState('');
	const [metric, setMetric] = useState<Metric>('hours');
	const [exporting, setExporting] = useState(false);

	const metaQuery = useQuery<MetaResponse>({
		queryKey: ['reports', 'employee-project-cost', 'meta'],
		queryFn: () => apiGet('/api/reports/employee-project-cost'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const employees = useMemo(() => meta?.employees ?? [], [meta]);
	const financialYears = useMemo(() => meta?.financial_years ?? [], [meta]);

	// Derived defaults: first employee / current FY until the user picks one;
	// a stored choice is kept only while it remains a valid option.
	const resolvedEmployeeId = useMemo(() => {
		if (employeeId && employees.some((e) => String(e.id) === employeeId)) {
			return employeeId;
		}
		return String(employees[0]?.id ?? '');
	}, [employeeId, employees]);

	const resolvedFyYear = useMemo(() => {
		if (fyYear && financialYears.some((fy) => String(fy.year) === fyYear)) {
			return fyYear;
		}
		return String(meta?.current_fy || new Date().getFullYear());
	}, [fyYear, financialYears, meta]);

	const dataQuery = useQuery<DataResponse>({
		queryKey: [
			'reports',
			'employee-project-cost',
			'data',
			resolvedEmployeeId,
			resolvedFyYear,
		],
		queryFn: () =>
			apiGet(
				`/api/reports/employee-project-cost?employee_id=${resolvedEmployeeId}&fy=${resolvedFyYear}`
			),
		enabled: !!resolvedEmployeeId && !!resolvedFyYear,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const data = dataQuery.data?.data ?? null;

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
		dataQuery.error?.message || dataQuery.data?.error || metaQuery.data?.error;
	const isLoading =
		dataQuery.isLoading || (dataQuery.isFetching && !dataQuery.data);

	const employeeOptions = useMemo(
		() =>
			employees.map((e) => ({
				value: String(e.id),
				label: [e.name, e.employee_id, e.department]
					.filter(Boolean)
					.join(' — '),
			})),
		[employees]
	);

	const handlePrint = () => window.print();

	const handleExport = async () => {
		if (!resolvedEmployeeId || !resolvedFyYear) return;
		setExporting(true);
		try {
			const response = await fetch(
				`/api/reports/employee-project-cost/download?employee_id=${resolvedEmployeeId}&fy=${resolvedFyYear}`,
				{ credentials: 'include' }
			);
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
				`Employee_Project_Cost_${data?.employee?.name || employeeId}_FY${fyYear}.xlsx`;

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
			alert(
				exportError instanceof Error
					? exportError.message
					: 'Failed to export report'
			);
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

	const selectedEmployee = employees.find(
		(e) => String(e.id) === resolvedEmployeeId
	);
	const totals = data?.totals;

	return (
		<div className="epc-print-page min-h-screen bg-gray-50/50 text-black">
			<style>{epcPrintStyles}</style>
			<Navbar />
			<main className="px-2 pb-12 pt-2 sm:px-4 md:px-6">
				{/* Header + controls */}
				<div className="mx-auto mb-3 max-w-[1600px] print:hidden">
					<div className="flex flex-col gap-3 border-b border-gray-200 pb-3 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<h1 className="flex items-center gap-2 text-lg font-bold text-gray-900">
								<span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#64126D]/10 text-[#64126D]">
									<CurrencyRupeeIcon className="h-4 w-4" />
								</span>
								Employee Project Cost
							</h1>
							<p className="mt-0.5 text-xs text-gray-500">
								Consolidated monthly manhours &amp; payroll cost across every
								project an employee worked on
							</p>
						</div>

						{/* Metric switcher */}
						<div
							role="tablist"
							aria-label="Metric"
							className="inline-flex self-start rounded-xl border border-gray-200/80 bg-gray-100/90 p-1 shadow-inner sm:self-auto"
						>
							{(['hours', 'cost'] as Metric[]).map((m) => (
								<button
									key={m}
									type="button"
									role="tab"
									aria-selected={metric === m}
									onClick={() => setMetric(m)}
									className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
										metric === m
											? 'bg-[#64126D] text-white shadow'
											: 'text-gray-600 hover:text-[#64126D]'
									}`}
								>
									{m === 'hours' ? (
										<ClockIcon className="h-3.5 w-3.5" />
									) : (
										<BanknotesIcon className="h-3.5 w-3.5" />
									)}
									{m === 'hours' ? 'Hours' : 'Cost'}
								</button>
							))}
						</div>
					</div>

					{/* Filter bar */}
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<div className="w-full max-w-sm">
							<SearchableSelect
								options={employeeOptions}
								placeholder={
									employees.length
										? 'Search employee by name, code…'
										: 'No employees found'
								}
								value={resolvedEmployeeId}
								onChange={(val) => setEmployeeId(val)}
							/>
						</div>
						<select
							value={resolvedFyYear}
							onChange={(e) => setFyYear(e.target.value)}
							className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-purple-500"
							title="Financial year (Apr–Mar)"
						>
							{financialYears.map((fy) => (
								<option key={fy.year} value={String(fy.year)}>
									{fy.label}
								</option>
							))}
						</select>
						<div className="ml-auto flex items-center gap-2">
							<button
								type="button"
								onClick={() => dataQuery.refetch()}
								disabled={isLoading || !resolvedEmployeeId}
								className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
								title="Refresh"
							>
								<ArrowPathIcon
									className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
								/>
								Refresh
							</button>
							<button
								type="button"
								onClick={handleExport}
								disabled={exporting || !resolvedEmployeeId}
								className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
								title="Download Excel"
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
								className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-900"
								title="Print"
							>
								<PrinterIcon className="h-4 w-4" />
								Print
							</button>
						</div>
					</div>
				</div>

				{/* Print header */}
				<div className="mx-auto mb-2 hidden max-w-[1600px] print:block">
					<div className="border-b-2 border-[#64126d] pb-1">
						<h2 className="text-base font-bold text-[#4A1254]">
							Employee Project Cost —{' '}
							{selectedEmployee?.name || data?.employee?.name || ''}
						</h2>
						<p className="text-[9pt] text-gray-600">
							{[
								selectedEmployee?.employee_id,
								selectedEmployee?.designation,
								selectedEmployee?.department,
								data?.fy_label,
							]
								.filter(Boolean)
								.join(' · ')}
						</p>
					</div>
				</div>

				{/* Summary cards */}
				{totals && (
					<div className="mx-auto mb-3 grid max-w-[1600px] grid-cols-2 gap-2 md:grid-cols-4 print:mb-1 print:grid-cols-4">
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Total Hours
								</p>
								<ClockIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{formatNumber(totals.total_hours)}
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
								{formatCurrency(totals.blended_rate)}
							</p>
						</div>
						<div className="rounded-xl border border-purple-200 bg-[#64126D]/5 p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-[#64126D]">
									Total Cost ({data?.fy_label})
								</p>
								<BanknotesIcon className="h-4 w-4 text-[#64126D]" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-[#64126D] print:text-sm">
								{formatCurrency(totals.total_cost)}
							</p>
						</div>
						<div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm print:p-1.5">
							<div className="flex items-center justify-between">
								<p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
									Projects Worked
								</p>
								<ArrowTopRightOnSquareIcon className="h-4 w-4 text-purple-400" />
							</div>
							<p className="mt-0.5 text-lg font-bold text-gray-900 print:text-sm">
								{data?.rows.length ?? 0}
							</p>
						</div>
					</div>
				)}

				{/* Grid */}
				<div className="epc-sheet mx-auto max-w-[1600px] overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
					{error ? (
						<div className="px-4 py-10 text-center text-sm text-red-600">
							{error}
						</div>
					) : isLoading ? (
						<div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-gray-500">
							<ArrowPathIcon className="h-4 w-4 animate-spin" />
							Loading project costs…
						</div>
					) : !data ? (
						<div className="px-4 py-12 text-center text-sm text-gray-500">
							Select an employee to view their consolidated project costs.
						</div>
					) : data.rows.length === 0 ? (
						<div className="px-4 py-12 text-center">
							<p className="text-sm font-medium text-gray-700">
								No logged manhours for {data.employee?.name} in {data.fy_label}
							</p>
							<p className="mt-1 text-xs text-gray-500">
								Hours come from daily activity logs (My Project Activities).
							</p>
						</div>
					) : (
						<table className="w-full min-w-[1100px] border-collapse text-xs">
							<thead>
								<tr className="border-b border-[#64126D]/40 bg-[#64126D]/10">
									<th className="px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-[#64126D]">
										Sr
									</th>
									<th className="min-w-[220px] px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-[#64126D]">
										Project
									</th>
									<th className="min-w-[120px] px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-[#64126D]">
										Client
									</th>
									<th className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-[#64126D]">
										Rate/Hr
									</th>
									{data.months.map((m) => (
										<th
											key={m}
											className="px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-[#64126D]"
										>
											{m}
										</th>
									))}
									<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-[#64126D]">
										Total Hrs
									</th>
									<th className="bg-[#64126D]/20 px-2 py-1.5 text-right text-[10px] font-bold uppercase tracking-wide text-[#64126D]">
										Total Cost
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-200">
								{data.rows.map((row) => (
									<tr
										key={`${row.project_id ?? row.project_code}-${row.sr_no}`}
										className="transition-colors hover:bg-purple-50/40"
									>
										<td className="px-2 py-1 text-center text-gray-500">
											{row.sr_no}
										</td>
										<td className="px-2 py-1">
											{row.project_id ? (
												<Link
													href={`/projects/${row.project_id}`}
													className="font-medium text-[#4A1254] underline-offset-2 hover:underline"
													title={`View project details for ${row.project_name}`}
												>
													{row.project_code
														? `${row.project_code} – ${row.project_name}`
														: row.project_name}
												</Link>
											) : (
												<span className="font-medium text-[#4A1254]">
													{row.project_name}
												</span>
											)}
										</td>
										<td
											className="max-w-[160px] truncate px-2 py-1 text-gray-600"
											title={row.client_name}
										>
											{row.client_name || '—'}
										</td>
										<td className="px-2 py-1 text-right font-mono text-gray-700">
											{row.hourly_rate > 0
												? formatCurrency(row.hourly_rate)
												: '—'}
										</td>
										{data.month_keys.map((mKey) => {
											const v = cellValue(row, mKey, metric);
											return (
												<td
													key={mKey}
													className={`px-2 py-1 text-right font-mono ${
														v > 0 ? 'text-gray-900' : 'text-gray-300'
													}`}
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
											{formatNumber(row.total_hours).replace(/\.00$/, '')}
										</td>
										<td className="bg-purple-50/60 px-2 py-1 text-right font-mono font-semibold text-[#64126D]">
											{formatCurrency(row.total_cost)}
										</td>
									</tr>
								))}
							</tbody>
							<tfoot>
								<tr className="border-t-2 border-[#64126D]/40 bg-[#64126D]/10 font-bold">
									<td
										colSpan={4}
										className="px-2 py-1.5 text-right text-[11px] uppercase tracking-wide text-[#4A1254]"
									>
										Grand Total ({metric === 'hours' ? 'hours' : 'cost'})
									</td>
									{data.month_keys.map((mKey) => {
										const v =
											(metric === 'cost'
												? totals?.monthly_cost?.[mKey]
												: totals?.monthly_hours?.[mKey]) || 0;
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
										{formatNumber(totals?.total_hours ?? 0).replace(
											/\.00$/,
											''
										)}
									</td>
									<td className="bg-[#64126D]/20 px-2 py-1.5 text-right font-mono text-[#4A1254]">
										{formatCurrency(totals?.total_cost ?? 0)}
									</td>
								</tr>
							</tfoot>
						</table>
					)}
				</div>

				<p className="mx-auto mt-2 max-w-[1600px] text-[10px] leading-relaxed text-gray-400 print:hidden">
					Hours are summed from daily activity logs per project; cost = payroll
					hourly rate in force that month × hours logged that month
					(hourly/daily rate when set, else gross salary ÷ standard working days
					× hours per day).
				</p>
			</main>
		</div>
	);
}
