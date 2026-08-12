'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
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
import { capProjectDays } from '@/lib/timesheet-cap';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ─── Client-safe API types ──────────────────────────────────────────

type DayType = 'working' | 'weekly_off' | 'holiday';

interface TsDay {
	date: string;
	day: number;
	weekday: string;
	status: string | null;
	overtime_hours: number;
	is_weekly_off: boolean;
	is_holiday: boolean;
	holiday_name: string | null;
	hours: number;
	day_type: DayType;
}

interface TsEmployee {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	position: string | null;
	designation: string | null;
}

interface TsProject {
	project_id: number | null;
	project_code: string;
	project_name: string;
	activity_name: string;
	discipline_name: string | null;
	status: string | null;
	estimated_hours: number;
	actual_hours: number;
	qty_assigned: number;
	qty_completed: number;
	start_date: string | null;
	due_date: string | null;
	days: Record<string, number>;
	total_hours: number;
}

interface TsMonthlyHours {
	daily: Record<string, number>;
	normal: number;
	overtime_daily: Record<string, number>;
	overtime: number;
	total: number;
	source: 'project' | 'attendance';
}

interface TsSummary {
	present_days: number;
	half_days: number;
	weekly_offs: number;
	holidays: number;
	absent_days: number;
	leave_days: number;
	standard_hours: number;
	overtime_hours: number;
	total_hours: number;
}

interface TimesheetData {
	employee: TsEmployee | null;
	month: string;
	year: number;
	month_label: string;
	days: TsDay[];
	holidays: { name: string; date: string }[];
	projects: TsProject[];
	summary: TsSummary;
	hours: TsMonthlyHours;
	settings: { standard_working_hours: number; half_day_hours: number };
}

interface TimesheetMeta {
	employees: TsEmployee[];
	months: string[];
	latest_month: string | null;
}

interface ApiResponse {
	success: boolean;
	data?: TimesheetData | null;
	meta?: TimesheetMeta;
	error?: string;
}

const LEAVE_CODES = new Set(['PL', 'CL', 'SL', 'ML', 'EL', 'L', 'LWP']);

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

/** Day cells: 9.3 hours becomes 09:18. */
function formatClock(hours: number): string {
	const minutes = Math.round(hours * 60);
	const hh = Math.floor(minutes / 60);
	const mm = minutes % 60;
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Total cells: 174.5 hours becomes 174:30:00. */
function formatElapsed(hours: number): string {
	const seconds = Math.round(hours * 3600);
	const hh = Math.floor(seconds / 3600);
	const mm = Math.floor((seconds % 3600) / 60);
	const ss = seconds % 60;
	return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function isBlueDay(day: TsDay): boolean {
	return day.day_type !== 'working';
}

/**
 * The reference template spells non-working day labels down blue columns.
 * Keep the full weekday/holiday wording instead of a short status code.
 */
function fullDayLabel(day: TsDay): string {
	if (day.status && LEAVE_CODES.has(day.status.toUpperCase())) {
		return 'LEAVE';
	}
	if (day.day_type === 'holiday') {
		return (day.holiday_name || 'HOLIDAY').toUpperCase();
	}
	if (day.weekday === 'Sat') return 'SATURDAY';
	if (day.weekday === 'Sun') return 'SUNDAY';
	return day.weekday.toUpperCase();
}

function compactDayLabel(day: TsDay): string {
	return day.weekday;
}

function projectCode(project: TsProject | null): string {
	return project?.project_code || '';
}

function projectActivity(project: TsProject | null): string {
	return project?.activity_name || '';
}

function projectRowsForMonth(
	projects: TsProject[],
	month: string
): TsProject[] {
	return projects.filter((project) => {
		if (project.total_hours > 0) return true;
		if (project.start_date?.startsWith(month)) return true;
		if (project.due_date?.startsWith(month)) return true;
		return false;
	});
}

// ─── Page ───────────────────────────────────────────────────────────

export default function TimesheetReportPage() {
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

	const [employeeId, setEmployeeId] = useState('');
	const [month, setMonth] = useState('');
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
		setEmployeeId((previous) => previous || String(employees[0]?.id ?? ''));
		setMonth((previous) => previous || meta.latest_month || '');
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
	const days = data?.days ?? [];
	const selectedEmployee =
		employees.find((employee) => String(employee.id) === employeeId) ??
		data?.employee;
	const projectRows = useMemo(
		() => (data ? projectRowsForMonth(data.projects, data.month) : []),
		[data]
	);
	// The grid credits at most the standard working day per day in the top
	// section — per-project cells are capped so the section sums to ≤ 8h,
	// and the daily excess is already surfaced in the overtime row
	// (data.hours.overtime_daily). The cap splits an over-8h day across its
	// projects proportionally so every project stays visible.
	const displayedProjectRows = useMemo(
		() =>
			data
				? capProjectDays(projectRows, data.settings.standard_working_hours)
				: [],
		[data, projectRows]
	);

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
						<section className="min-w-[1950px] bg-white font-[Arial,sans-serif] text-[10px] leading-none text-black">
							{/* Workbook header: logo, title, employee details, month/year. */}
							<div className="grid min-h-[58px] grid-cols-[260px_310px_minmax(0,1fr)_145px] border-x border-t border-black">
								<div className="flex items-center justify-center border-r border-black">
									<Image
										src="/accent-logo.png"
										alt="Accent"
										width={120}
										height={58}
										className="h-[52px] w-[112px] object-contain"
									/>
								</div>
								<div className="flex items-center justify-center border-r border-black text-[15px] font-bold">
									Monthly Time Sheet
								</div>
								<div className="grid grid-cols-[140px_minmax(0,1fr)] grid-rows-4 border-r border-black">
									<div className="border-b border-black px-1 py-1">
										Employee Code
									</div>
									<div className="border-b border-black px-1 py-1 font-semibold">
										{selectedEmployee?.employee_id ??
											data.employee?.employee_id ??
											''}
									</div>
									<div className="border-b border-black px-1 py-1">
										Employee Name
									</div>
									<div className="border-b border-black px-1 py-1 font-semibold">
										{selectedEmployee?.name ?? data.employee?.name ?? ''}
									</div>
									<div className="border-b border-black px-1 py-1">
										Designation
									</div>
									<div className="border-b border-black px-1 py-1 font-semibold">
										{selectedEmployee?.position ||
											selectedEmployee?.designation ||
											''}
									</div>
									<div className="px-1 py-1">Department</div>
									<div className="px-1 py-1 font-semibold">
										{selectedEmployee?.department ?? ''}
									</div>
								</div>
								<div className="grid grid-rows-2">
									<div className="grid grid-cols-[1fr_1fr] border-b border-black">
										<span className="border-r border-black px-1 py-1">
											Month
										</span>
										<span className="px-1 py-1 text-right font-semibold">
											{monthLabel(data.month).split(' ')[0]}
										</span>
									</div>
									<div className="grid grid-cols-[1fr_1fr]">
										<span className="border-r border-black px-1 py-1">
											Year
										</span>
										<span className="px-1 py-1 text-right font-semibold">
											{data.year}
										</span>
									</div>
								</div>
							</div>

							<div className="border-x border-t border-b border-black py-1 text-center text-[11px] font-bold">
								Daily Man Hours
							</div>

							<table className="w-full table-fixed border-collapse border border-black">
								<caption className="sr-only">
									Monthly time sheet for{' '}
									{selectedEmployee?.name ?? data.employee?.name ?? 'employee'}{' '}
									in {data.month_label}
								</caption>
								<colgroup>
									{Array.from({ length: 4 }, (_, index) => (
										<col key={`code-col-${index}`} style={{ width: '65px' }} />
									))}
									{Array.from({ length: 4 }, (_, index) => (
										<col
											key={`activity-col-${index}`}
											style={{ width: '20.5px' }}
										/>
									))}
									<col style={{ width: '48px' }} />
									{days.map((day) => (
										<col key={day.date} style={{ width: '48px' }} />
									))}
									<col style={{ width: '72px' }} />
								</colgroup>
								<thead>
									<tr className="h-[25px]">
										<th
											colSpan={4}
											className="border border-black px-1 py-1 text-center font-normal"
										>
											Days
										</th>
										<th
											colSpan={4}
											rowSpan={2}
											className="border border-black bg-gray-100 px-1 py-1 text-center font-normal"
										>
											Activity
										</th>
										<th
											rowSpan={2}
											className="border border-black bg-gray-100 px-1 py-1 text-center font-normal"
										>
											Count
										</th>
										{days.map((day) => (
											<th
												key={day.date}
												className={`border border-black px-0 py-1 text-center font-normal ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white'}`}
											>
												{compactDayLabel(day)}
											</th>
										))}
										<th
											rowSpan={2}
											className="border border-black px-1 py-1 text-center font-normal"
										>
											Monthly Man
											<br />
											Hours
										</th>
									</tr>
									<tr className="h-[18px]">
										<th
											colSpan={4}
											className="border border-black px-1 py-1 text-center font-normal"
										>
											Project Code
										</th>
										{days.map((day) => (
											<th
												key={day.date}
												className={`border border-black px-0 py-1 text-center font-normal tabular-nums ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white'}`}
											>
												{String(day.day).padStart(2, '0')}
											</th>
										))}
									</tr>
								</thead>

								<tbody>
									{/* Fixed-height normal section: empty rows preserve the Excel layout and hold vertical labels. */}
									{Array.from({ length: 20 }, (_, rowIndex) => {
										const project = displayedProjectRows[rowIndex] ?? null;
										return (
											<tr key={`normal-${rowIndex}`} style={{ height: '15px' }}>
												<td
													colSpan={4}
													className="border border-black px-1 py-0 text-left align-middle"
												>
													{projectCode(project)}
												</td>
												<td
													colSpan={4}
													className="border border-black px-1 py-0 text-center align-middle whitespace-nowrap overflow-hidden text-ellipsis"
													title={projectActivity(project)}
												>
													{projectActivity(project)}
												</td>
												<td
													className="border border-black px-1 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis"
													title={
														project?.qty_completed
															? String(project.qty_completed)
															: undefined
													}
												>
													{project?.qty_completed ? project.qty_completed : ''}
												</td>
												{days.map((day) => {
													const hours = project?.days[day.date] ?? 0;
													const isLeave =
														!!day.status &&
														LEAVE_CODES.has(day.status.toUpperCase());
													const showLabel = isBlueDay(day) || isLeave;
													const label = showLabel ? fullDayLabel(day) : '';
													const letter = label[rowIndex] ?? '';
													return (
														<td
															key={day.date}
															title={
																hours > 0
																	? `${projectActivity(project)} — ${formatClock(hours)}`
																	: undefined
															}
															className={`border border-black px-0 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : isLeave ? 'bg-white text-red-600' : 'bg-white text-black'}`}
														>
															{hours > 0
																? formatClock(hours)
																: letter === ' '
																	? ''
																	: letter}
														</td>
													);
												})}
												<td className="border border-black px-1 py-0 text-right align-middle tabular-nums">
													{project
														? formatElapsed(project.total_hours)
														: '0:00:00'}
												</td>
											</tr>
										);
									})}
									<tr style={{ height: '18px' }}>
										<td colSpan={9} className="border border-black px-1 py-0" />
										<td
											colSpan={20}
											className="border border-black px-1 py-0 text-center font-semibold text-blue-700"
										>
											Over Time Hours
										</td>
										<td
											colSpan={11}
											className="border border-black px-1 py-0 text-right font-normal"
										>
											Sub-Total Of Normal Hours
										</td>
										<td className="border border-black px-1 py-0 text-right tabular-nums">
											{formatElapsed(data.hours.normal)}
										</td>
									</tr>

									{Array.from({ length: 6 }, (_, rowIndex) => {
										const project = displayedProjectRows[rowIndex] ?? null;
										return (
											<tr
												key={`overtime-${rowIndex}`}
												style={{ height: '15px' }}
											>
												<td
													colSpan={4}
													className="border border-black px-1 py-0 align-middle whitespace-nowrap overflow-hidden text-ellipsis"
													title={
														rowIndex === 0 ? projectCode(project) : undefined
													}
												>
													{rowIndex === 0 ? projectCode(project) : ''}
												</td>
												<td
													colSpan={4}
													className="border border-black px-1 py-0 text-center align-middle whitespace-nowrap overflow-hidden text-ellipsis"
													title={
														rowIndex === 0
															? projectActivity(project)
															: undefined
													}
												>
													{rowIndex === 0 ? projectActivity(project) : ''}
												</td>
												<td className="border border-black px-1 py-0 text-center align-middle" />
												{days.map((day) => {
													const otValue = data.hours.overtime_daily[day.date];
													return (
														<td
															key={day.date}
															title={otValue ? formatClock(otValue) : undefined}
															className={`border border-black px-0 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white text-blue-700'}`}
														>
															{rowIndex === 0 && otValue
																? formatClock(otValue)
																: ''}
														</td>
													);
												})}
												<td className="border border-black px-1 py-0 text-right tabular-nums text-blue-700 font-semibold">
													{rowIndex === 0
														? formatElapsed(data.hours.overtime)
														: '0:00:00'}
												</td>
											</tr>
										);
									})}

									<tr style={{ height: '18px' }}>
										<td
											colSpan={9}
											className="border border-black px-1 py-0 font-normal"
										>
											Daily Man Hours
										</td>
										{days.map((day) => {
											const dailyValue = data.hours.daily[day.date];
											return (
												<td
													key={day.date}
													title={
														dailyValue ? formatClock(dailyValue) : undefined
													}
													className={`border border-black px-0 py-0 text-center align-middle tabular-nums whitespace-nowrap overflow-hidden text-ellipsis ${isBlueDay(day) ? 'bg-[#0070C0] text-white' : 'bg-white'}`}
												>
													{dailyValue ? formatClock(dailyValue) : ''}
												</td>
											);
										})}
										<td className="border border-black px-1 py-0 text-right tabular-nums">
											{formatElapsed(data.hours.normal)}
										</td>
									</tr>

									<tr style={{ height: '18px' }}>
										<td
											colSpan={40}
											className="border border-black px-1 py-0 text-right font-normal"
										>
											Sub-Total Of Over Time Hours
										</td>
										<td className="border border-black px-1 py-0 text-right tabular-nums">
											{formatElapsed(data.hours.overtime)}
										</td>
									</tr>
									<tr style={{ height: '18px' }}>
										<td
											colSpan={40}
											className="border border-black px-1 py-0 text-right font-normal"
										>
											Total Monthly Hours
										</td>
										<td className="border border-black px-1 py-0 text-right font-bold tabular-nums">
											{formatElapsed(data.hours.total)}
										</td>
									</tr>
								</tbody>

								<tfoot>
									<tr style={{ height: '58px' }}>
										<td
											colSpan={14}
											className="border border-black px-2 py-1 text-center align-bottom"
										>
											<span className="block border-b border-black pb-1">
												{selectedEmployee?.name ?? data.employee?.name ?? ''}
											</span>
											Prepared By
										</td>
										<td
											colSpan={13}
											className="border border-black px-2 py-1 text-center align-bottom"
										>
											<span className="block border-b border-black pb-1">
												&nbsp;
											</span>
											Checked By
										</td>
										<td
											colSpan={14}
											className="border border-black px-2 py-1 text-center align-bottom"
										>
											<span className="block border-b border-black pb-1">
												&nbsp;
											</span>
											Approved By
										</td>
									</tr>
								</tfoot>
							</table>
						</section>
					</div>
				)}
			</main>
		</div>
	);
}
