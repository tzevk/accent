'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	DocumentArrowDownIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import TimesheetGrid, {
	monthLabel,
	type TimesheetGridData,
	type TsEmployee,
} from './timesheet-grid';

/**
 * The admin Timesheet report: one employee, one month, behind the report
 * permission. The grid itself is `TimesheetGrid`, shared verbatim with the
 * self-service page (`/user/timesheet`) so both surfaces render one
 * implementation of the monthly timesheet matrix.
 */

// ─── Client-safe API types ──────────────────────────────────────────

interface TimesheetMeta {
	employees: TsEmployee[];
	/** YYYY-MM months that have data, newest first */
	months: string[];
	/** Newest month with data, or null when none */
	latest_month: string | null;
}

interface ApiResponse {
	success: boolean;
	data?: TimesheetGridData | null;
	meta?: TimesheetMeta;
	error?: string;
}

// ─── Page ───────────────────────────────────────────────────────────

function TimesheetReportPageInner() {
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

	const searchParams = useSearchParams();
	// Deep-link defaults so sibling reports (e.g. utilization) can drill
	// through with ?employee_id=&month=; validated against metadata below.
	const [employeeId, setEmployeeId] = useState(
		() => searchParams.get('employee_id') ?? ''
	);
	const [month, setMonth] = useState(() => searchParams.get('month') ?? '');
	const [exporting, setExporting] = useState(false);

	const metaQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'timesheet-report', 'meta'],
		queryFn: () => apiGet('/api/reports/timesheet-report'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const employees = useMemo(() => meta?.employees ?? [], [meta]);
	const months = useMemo(() => meta?.months ?? [], [meta]);

	const employeeOptions = useMemo(
		() =>
			employees.map((employee) => ({
				value: String(employee.id),
				label: `${employee.name}${
					employee.employee_id ? ` (${employee.employee_id})` : ''
				}`,
			})),
		[employees]
	);

	const monthOptions = useMemo(
		() => months.map((value) => ({ value, label: monthLabel(value) })),
		[months]
	);

	useEffect(() => {
		if (!meta) return;
		setEmployeeId((previous) =>
			previous && employees.some((e) => String(e.id) === previous)
				? previous
				: String(employees[0]?.id ?? '')
		);
		setMonth((previous) =>
			previous && months.includes(previous) ? previous : meta.latest_month || ''
		);
		// Defaults are intentionally applied once when metadata arrives.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [meta]);

	const dataQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'timesheet-report', 'data', employeeId, month],
		queryFn: () =>
			apiGet(
				`/api/reports/timesheet-report?employee_id=${employeeId}&month=${month}`
			),
		enabled: !!employeeId && !!month,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const data = dataQuery.data?.data ?? null;
	const selectedEmployee =
		employees.find((employee) => String(employee.id) === employeeId) ??
		data?.employee;

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

	const handleExport = async () => {
		if (!employeeId || !month) return;
		setExporting(true);
		try {
			const response = await fetch(
				`/api/reports/timesheet-report/download?employee_id=${employeeId}&month=${month}`,
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
			const filename = match?.[1] || `Timesheet_${month}.xlsx`;
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

	return (
		<div className="min-h-screen bg-white text-black">
			<Navbar />
			<main className="px-1 pb-8 pt-1 sm:px-2">
				{/* Compact controls stay outside the paper, like the workbook controls are outside the sheet. */}
				<div className="mx-auto mb-1 flex max-w-[1550px] flex-wrap items-center justify-between gap-2 print:hidden">
					<div className="flex flex-wrap items-center gap-2 text-[11px]">
						<span className="font-bold text-gray-700">Monthly Time Sheet</span>
						<SearchableSelect
							options={employeeOptions}
							value={employeeId}
							onChange={(val) => setEmployeeId(String(val))}
							placeholder="Select an employee"
							className="min-w-[210px]"
							buttonClassName="h-7 rounded-none border-gray-400 text-[11px]"
							aria-label="Employee"
						/>
						<SearchableSelect
							options={monthOptions}
							value={month}
							onChange={(val) => setMonth(String(val))}
							placeholder="Select a month"
							className="min-w-[130px]"
							buttonClassName="h-7 rounded-none border-gray-400 text-[11px]"
							aria-label="Month"
						/>
					</div>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => dataQuery.refetch()}
							disabled={isLoading}
							className="inline-flex h-7 items-center gap-1 border border-gray-400 bg-white px-2 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-50"
						>
							<ArrowPathIcon className="h-3 w-3" />
							Refresh
						</button>
						<button
							type="button"
							onClick={handleExport}
							disabled={!data || exporting}
							className="inline-flex h-7 items-center gap-1 border border-[#64126D] bg-[#64126D] px-2 text-[11px] text-white hover:bg-[#7F2487] disabled:opacity-50"
						>
							<DocumentArrowDownIcon className="h-3 w-3" />
							{exporting ? 'Exporting…' : 'Export Excel'}
						</button>
					</div>
				</div>

				{error ? (
					<div className="mx-auto max-w-[1550px] border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700">
						<p className="font-semibold">Couldn&apos;t load the report</p>
						<p className="mt-1">{error}</p>
						<button
							type="button"
							onClick={() => dataQuery.refetch()}
							className="mt-3 border border-red-600 bg-red-600 px-3 py-1 text-xs text-white"
						>
							Retry
						</button>
					</div>
				) : isLoading ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1550px] items-center justify-center text-sm text-gray-500">
						Loading timesheet…
					</div>
				) : !data ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1550px] items-center justify-center border border-gray-300 text-sm text-gray-500">
						Select an employee and month to view their timesheet.
					</div>
				) : (
					<div className="mx-auto max-w-[1550px] overflow-x-auto">
						<TimesheetGrid data={data} employee={selectedEmployee} />
					</div>
				)}
			</main>
		</div>
	);
}

export default function TimesheetReportPage() {
	return (
		<Suspense fallback={null}>
			<TimesheetReportPageInner />
		</Suspense>
	);
}
