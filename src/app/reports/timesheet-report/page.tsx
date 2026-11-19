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
			<div className="min-h-[calc(100dvh-4rem)] bg-gray-50">
				<Navbar />
				<div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
					Loading…
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-[calc(100dvh-4rem)] bg-gray-50 px-4">
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
		<div className="flex h-[calc(100dvh-4rem)] flex-col bg-gray-50 print:block print:h-auto print:bg-white">
			<Navbar />
			<div className="mx-auto w-full max-w-[1920px] shrink-0 px-4 pt-6 pb-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16 print:hidden">
				<h1 className="text-3xl font-bold text-gray-900 xl:text-4xl">
					Monthly Time Sheet
				</h1>
			</div>
			<div className="mx-auto min-h-0 w-full max-w-[1920px] flex-1 px-4 sm:px-6 lg:px-8 xl:px-12 2xl:px-16 print:max-w-none print:px-0">
				<div className="@container/report h-full overflow-y-auto rounded-lg bg-white print:h-auto print:overflow-visible">
					<div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4 print:hidden">
						<SearchableSelect
							options={employeeOptions}
							value={employeeId}
							onChange={(val) => setEmployeeId(String(val))}
							placeholder="Select an employee"
							className="min-w-0 grow basis-52"
							aria-label="Employee"
						/>
						<SearchableSelect
							options={monthOptions}
							value={month}
							onChange={(val) => setMonth(String(val))}
							placeholder="Select a month"
							className="min-w-0 grow basis-40"
							aria-label="Month"
						/>
						<div className="flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={() => dataQuery.refetch()}
								disabled={isLoading}
								className="inline-flex min-h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
							>
								<ArrowPathIcon className="size-4" />
								Refresh
							</button>
							<button
								type="button"
								onClick={handleExport}
								disabled={!data || exporting}
								className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[#64126D] px-3 py-1.5 text-sm text-white hover:bg-[#52105a] disabled:opacity-50"
							>
								<DocumentArrowDownIcon className="size-4" />
								{exporting ? 'Exporting…' : 'Export Excel'}
							</button>
						</div>
					</div>
					<div className="p-4 @lg/report:p-6 print:p-0">
						{error ? (
							<div className="rounded-lg border border-red-300 bg-red-50 p-4 text-center text-sm text-red-700 wrap-anywhere">
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
							<div className="flex min-h-[300px] items-center justify-center p-4 text-center text-sm text-gray-500">
								Loading timesheet…
							</div>
						) : !data ? (
							<div className="flex min-h-[300px] items-center justify-center rounded-lg border border-gray-200 p-4 text-center text-sm text-gray-500">
								Select an employee and month to view their timesheet.
							</div>
						) : (
							<div
								className="overflow-x-auto print:overflow-visible"
								role="region"
								aria-label="Monthly timesheet grid"
								tabIndex={0}
							>
								<TimesheetGrid data={data} employee={selectedEmployee} />
							</div>
						)}
					</div>
				</div>
			</div>
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
