'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	ChartBarIcon,
	ChevronRightIcon,
	DocumentArrowDownIcon,
	MagnifyingGlassIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import {
	Bar,
	CartesianGrid,
	ComposedChart,
	Legend,
	Line,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import Navbar from '@/components/Navbar';
import RosterDisclosureCard from '@/components/RosterDisclosure';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { RosterDisclosure } from '@/lib/payroll-roster';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import { bandText, NO_TIME_LOGGED_LABEL, partialWindowLabel } from './labels';

// ─── Client-safe API types (mirror the server payload, no server import) ──

type UtilizationBand = 'under' | 'healthy' | 'over';

type CostStatus = 'priced' | 'no-profile';

/** Missing timesheet evidence for the month — the Logged Hours are 0. */
type UtilizationState = 'no_time_logged';

/**
 * One trailing-month cell: the month, whether the employment window covered
 * it, and that month's utilization (`null` when the month had no capacity).
 * A cell whose month is not employed is blank, never an em dash.
 */
interface TrailingMonth {
	month: string;
	employed: boolean;
	utilization_percent: number | null;
}

/** One team-trend point: capacity-weighted utilization and priced Bench Cost. */
interface TrendPoint {
	month: string;
	utilization_percent: number | null;
	bench_cost: number | null;
}

interface UtilizationRow {
	employee_id: number;
	employee_code: string;
	employee_name: string;
	/** Raw `employees.department`; null = unset (rendered as "Unassigned"). */
	department: string | null;
	month: string;
	capacity_hours: number;
	logged_hours: number;
	utilization_percent: number | null;
	utilization_band: UtilizationBand | null;
	/** Set when the month's Logged Hours are 0; never changes band or order. */
	state: UtilizationState | null;
	/** Resolved employment window; null = open bound. */
	employment_start: string | null;
	employment_end: string | null;
	/** The window does not cover the whole month — a chip names the dates. */
	is_partial_window: boolean;
	/** The viewed month and the two before it, oldest first. */
	trailing: TrailingMonth[];
	/** Every employed month of the trailing window is under 80 (min two). */
	chronic_under: boolean;
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
	/**
	 * The viewed month's rows with zero Logged Hours — month-wide even when a
	 * band filter narrows the other counts (the rollup's scope).
	 */
	no_logged_count: number;
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

/** One department's rollup over the viewed month's roster — the summary table. */
interface DepartmentSummary {
	/** Raw `employees.department`; null = the unset bucket ("Unassigned"). */
	department: string | null;
	headcount: number;
	/** Σ logged ÷ Σ capacity × 100; null when the department credits no capacity. */
	capacity_weighted_utilization: number | null;
	logged_hours: number;
	capacity_hours: number;
	/** Sums the department's priced rows; null when none is priced. */
	bench_cost: number | null;
	no_logged_count: number;
}

interface UtilizationData {
	month: string;
	month_label: string;
	flag: UtilizationBand | null;
	rows: UtilizationRow[];
	totals: UtilizationTotals;
	/** The six months ending at the viewed month, oldest first. */
	trend: TrendPoint[];
	/** What the month's roster filter dropped; null when it dropped nobody. */
	disclosure: RosterDisclosure | null;
	/** The month's department rollup, computed before the band filter. */
	departments: DepartmentSummary[];
}

/** One activity/discipline pair inside a bucket: the hours logged under it. */
interface ProjectBreakdownActivity {
	activity_name: string;
	discipline_name: string | null;
	hours: number;
}

/** One bucket: a project, or the No-project bucket whose project fields are null. */
interface ProjectBreakdownBucket {
	project_id: number | null;
	project_code: string | null;
	/** `project_title` → `projects.name` → `project_code` → `Project #<id>`. */
	project_name: string | null;
	client_name: string | null;
	hours: number;
	activities: ProjectBreakdownActivity[];
}

/** One employee's month breakdown — the lazily fetched projects payload. */
interface ProjectBreakdown {
	month: string;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	/** Σ of every bucket — equals the row's Logged Hours for the month. */
	logged_hours: number;
	top_n: number;
	projects: ProjectBreakdownBucket[];
	other: { hours: number; project_count: number };
	no_project: ProjectBreakdownBucket | null;
}

interface BreakdownResponse {
	success: boolean;
	data?: ProjectBreakdown;
	error?: string;
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

/**
 * How an unset `employees.department` is labelled everywhere on screen (the
 * column, the filter options and the summary). The API payload keeps the raw
 * null so callers can tell the bucket from a department actually named this.
 */
const UNASSIGNED_DEPARTMENT = 'Unassigned';

/**
 * The DOM value the department control uses for that unset bucket — a string
 * is required by the select, so the filter state is a string too ('' = all).
 * Real department names never collide with it.
 */
const UNASSIGNED_DEPARTMENT_VALUE = '__unassigned__';

/** The department key one row/summary belongs to, as the filter state holds it. */
function departmentKey(department: string | null): string {
	return department ?? UNASSIGNED_DEPARTMENT_VALUE;
}

/** The on-screen label for a row's or summary's department. */
function departmentLabel(department: string | null): string {
	return department ?? UNASSIGNED_DEPARTMENT;
}

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

function formatPercent(value: number | null): string {
	if (value === null || value === undefined) return '—';
	return `${formatNumber(value)}%`;
}

/** Deep link to the per-employee timesheet detail for the row's month. */
function timesheetHref(row: UtilizationRow): string {
	return `/reports/timesheet-report?employee_id=${row.employee_id}&month=${encodeURIComponent(row.month)}`;
}

/**
 * One bucket's detail rows: the bucket line (its project or "No project")
 * followed by the activity/discipline pairs the hours were logged under.
 * `project-row` carries `data-project` (the project id); `no-project-row` is
 * the explicit project-less bucket and never merges into "Other".
 */
function BreakdownBucketRows({
	bucket,
	testId,
}: {
	bucket: ProjectBreakdownBucket;
	testId: 'project-row' | 'no-project-row';
}) {
	return (
		<>
			<tr
				data-testid={testId}
				data-project={bucket.project_id ?? ''}
				data-hours={bucket.hours}
				className="border-b border-gray-100"
			>
				<td
					data-testid="breakdown-row-name"
					className="px-3 py-2 font-medium text-gray-800"
				>
					{bucket.project_name ?? 'No project'}
				</td>
				<td
					data-testid="breakdown-row-code"
					className="px-3 py-2 text-xs text-gray-500"
				>
					{bucket.project_code ?? '—'}
				</td>
				<td
					data-testid="breakdown-row-client"
					className="px-3 py-2 text-gray-600"
				>
					{bucket.client_name ?? '—'}
				</td>
				<td
					data-testid="breakdown-row-hours"
					className="px-3 py-2 text-right font-medium tabular-nums"
				>
					{formatNumber(bucket.hours)}
				</td>
			</tr>
			{bucket.activities.map((activity) => (
				<tr
					key={`${activity.activity_name}\u0000${activity.discipline_name ?? ''}`}
					data-testid="activity-row"
					data-activity={activity.activity_name}
					data-discipline={activity.discipline_name ?? ''}
					data-hours={activity.hours}
					className="border-b border-gray-50 text-xs text-gray-600"
				>
					<td className="px-3 py-1.5 pl-8">{activity.activity_name}</td>
					<td className="px-3 py-1.5">{activity.discipline_name ?? '—'}</td>
					<td className="px-3 py-1.5" />
					<td
						data-testid="activity-hours"
						className="px-3 py-1.5 text-right tabular-nums"
					>
						{formatNumber(activity.hours)}
					</td>
				</tr>
			))}
		</>
	);
}

/**
 * The lazily fetched per-employee project breakdown, rendered under an
 * expanded grid row: the month's Logged Hours grouped by project with
 * activity/discipline as detail, the top N plus "Other", the explicit
 * "No project" bucket, and the drill-down link to the month's per-employee
 * timesheet. The query runs only while the row is expanded — the base month
 * payload never carries this lens.
 */
function ProjectBreakdownPanel({ row }: { row: UtilizationRow }) {
	const breakdownQuery = useQuery<BreakdownResponse>({
		queryKey: [
			'reports',
			'employee-utilization',
			'projects',
			row.month,
			row.employee_id,
		],
		queryFn: () =>
			apiGet('/api/reports/employee-utilization/projects', {
				month: row.month,
				employee_id: row.employee_id,
			}),
		staleTime: 30_000,
	});
	const breakdown = breakdownQuery.data?.data;

	return (
		<div
			data-testid="project-breakdown"
			data-employee-code={row.employee_code}
			data-logged-hours={breakdown ? String(breakdown.logged_hours) : ''}
			className="space-y-2"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
					Logged Hours by project — {monthLabel(row.month)}
				</p>
				<Link
					data-testid="breakdown-timesheet-link"
					href={timesheetHref(row)}
					className="text-xs font-medium text-[#64126D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
				>
					Open {monthLabel(row.month)} timesheet →
				</Link>
			</div>
			{breakdownQuery.isLoading ? (
				<p data-testid="breakdown-loading" className="text-sm text-gray-500">
					Loading project breakdown…
				</p>
			) : breakdownQuery.isError ? (
				<div
					data-testid="breakdown-error"
					className="flex flex-wrap items-center gap-2 text-sm text-red-700"
				>
					<span>
						{breakdownQuery.error instanceof Error
							? breakdownQuery.error.message
							: 'Failed to load the project breakdown.'}
					</span>
					<button
						type="button"
						onClick={() => breakdownQuery.refetch()}
						className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
					>
						Retry
					</button>
				</div>
			) : breakdown ? (
				<div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
					<table className="w-full min-w-[560px] border-collapse text-sm">
						<caption className="sr-only">
							Logged Hours by project for {row.employee_name},{' '}
							{monthLabel(row.month)}
						</caption>
						<thead>
							<tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
								<th scope="col" className="px-3 py-2">
									Project
								</th>
								<th scope="col" className="px-3 py-2">
									Code
								</th>
								<th scope="col" className="px-3 py-2">
									Client
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Hours
								</th>
							</tr>
						</thead>
						<tbody>
							{breakdown.projects.map((group) => (
								<BreakdownBucketRows
									key={`project-${group.project_id}`}
									bucket={group}
									testId="project-row"
								/>
							))}
							{breakdown.other.project_count > 0 && (
								<tr
									data-testid="other-projects-row"
									data-hours={breakdown.other.hours}
									data-project-count={breakdown.other.project_count}
									className="border-b border-gray-100"
								>
									<td className="px-3 py-2 font-medium text-gray-800">
										Other ({breakdown.other.project_count}{' '}
										{breakdown.other.project_count === 1
											? 'project'
											: 'projects'}
										)
									</td>
									<td className="px-3 py-2 text-xs text-gray-500">—</td>
									<td className="px-3 py-2 text-gray-600">—</td>
									<td
										data-testid="other-hours"
										className="px-3 py-2 text-right font-medium tabular-nums"
									>
										{formatNumber(breakdown.other.hours)}
									</td>
								</tr>
							)}
							{breakdown.no_project && (
								<BreakdownBucketRows
									bucket={breakdown.no_project}
									testId="no-project-row"
								/>
							)}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	);
}

/**
 * Team trend for the six months ending at the viewed month: capacity-weighted
 * Utilization (line, left axis) and the priced rows' Bench Cost (bars, right
 * axis). Both series run over each month's whole roster, so neither changes
 * with the band or search filters.
 *
 * `data-points` is the E2E hook: the series as `month:utilization:bench`
 * triples, oldest first, comma-separated, empty between the colons for a null
 * (`2018-11:72.5:12000,2018-12::9800`). Read it, don't scrape SVG paths.
 */
function TeamTrendChart({ trend }: { trend: TrendPoint[] }) {
	const dataPoints = trend
		.map(
			(point) =>
				`${point.month}:${point.utilization_percent ?? ''}:${point.bench_cost ?? ''}`
		)
		.join(',');

	return (
		<div
			data-testid="team-trend-chart"
			data-points={dataPoints}
			className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="mb-3">
				<h2 className="text-sm font-semibold text-gray-800">
					Team trend — last 6 months
				</h2>
				<p className="text-xs text-gray-500">
					Capacity-weighted Utilization and the priced rows&apos; total Bench
					Cost per month.
				</p>
			</div>
			<div className="h-72">
				<ResponsiveContainer width="100%" height="100%">
					<ComposedChart
						data={trend}
						margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
					>
						<CartesianGrid strokeDasharray="3 3" vertical={false} />
						<XAxis dataKey="month" tick={{ fontSize: 12 }} />
						<YAxis
							yAxisId="percent"
							width={48}
							tick={{ fontSize: 12 }}
							tickFormatter={(value: number) => `${value}%`}
						/>
						<YAxis
							yAxisId="money"
							orientation="right"
							width={72}
							tick={{ fontSize: 12 }}
							tickFormatter={(value: number) => formatNumber(value)}
						/>
						<Tooltip
							labelFormatter={(label) => monthLabel(String(label))}
							formatter={(value, name) => {
								const numeric =
									typeof value === 'number' ? value : Number(value);
								if (!Number.isFinite(numeric)) return '—';
								return name === 'Bench Cost'
									? formatCurrency(numeric)
									: formatPercent(numeric);
							}}
						/>
						<Legend />
						<Bar
							yAxisId="money"
							dataKey="bench_cost"
							name="Bench Cost"
							fill="#7F2487"
							radius={[3, 3, 0, 0]}
						/>
						<Line
							yAxisId="percent"
							type="monotone"
							dataKey="utilization_percent"
							name="Utilization"
							stroke="#64126D"
							strokeWidth={2}
							dot={{ r: 3 }}
							connectNulls
						/>
					</ComposedChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}

/**
 * The month's department rollup, above the grid: one row per department
 * present in the month (unset as "Unassigned") with the figures the server
 * computed over the whole roster — the grid's filters never move them.
 *
 * A row click applies the department filter to the grid; clicking the
 * selected row again clears it. The department button carries the same
 * toggle for keyboard users (its click bubbles to the row, so it fires once).
 *
 * `data-department` carries the raw payload value (`''` for unset) so a test
 * can tell the bucket from a department literally named "Unassigned".
 */
function DepartmentSummaryTable({
	summaries,
	label,
	selected,
	onToggle,
}: {
	summaries: DepartmentSummary[];
	label: string;
	selected: string;
	onToggle: (department: string) => void;
}) {
	return (
		<div
			data-testid="department-summary"
			className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
		>
			<div className="border-b border-gray-200 bg-gray-50 px-4 py-2">
				<h2 className="text-sm font-semibold text-gray-800">
					Department summary — {label}
				</h2>
				<p className="text-xs text-gray-500">
					The month&apos;s roster by department, unset reads Unassigned. Click a
					row to filter the grid; click it again to clear.
				</p>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full min-w-[880px] border-collapse text-sm">
					<caption className="sr-only">
						Headcount, capacity-weighted utilization, logged and capacity hours,
						Bench Cost and no-log count per department for {label}
					</caption>
					<thead>
						<tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
							<th scope="col" className="px-4 py-2.5">
								Department
							</th>
							<th scope="col" className="px-4 py-2.5 text-right">
								Headcount
							</th>
							<th scope="col" className="px-4 py-2.5 text-right">
								Utilization
							</th>
							<th scope="col" className="px-4 py-2.5 text-right">
								Logged (h)
							</th>
							<th scope="col" className="px-4 py-2.5 text-right">
								Capacity (h)
							</th>
							<th scope="col" className="px-4 py-2.5 text-right">
								Bench Cost
							</th>
							<th scope="col" className="px-4 py-2.5 text-right">
								No time logged
							</th>
						</tr>
					</thead>
					<tbody>
						{summaries.map((summary) => {
							const key = departmentKey(summary.department);
							const isSelected = selected === key;
							return (
								<tr
									key={key}
									data-testid="department-summary-row"
									data-department={summary.department ?? ''}
									data-selected={isSelected ? 'true' : 'false'}
									onClick={() => onToggle(key)}
									className={cn(
										'cursor-pointer border-b border-gray-100 transition-colors',
										isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'
									)}
								>
									<th
										scope="row"
										className="px-4 py-2.5 text-left font-medium text-gray-800"
									>
										<button
											type="button"
											aria-pressed={isSelected}
											className="text-left font-medium text-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
										>
											{departmentLabel(summary.department)}
										</button>
									</th>
									<td
										data-testid="cell-dept-headcount"
										className="px-4 py-2.5 text-right tabular-nums"
									>
										{summary.headcount}
									</td>
									<td
										data-testid="cell-dept-utilization"
										className="px-4 py-2.5 text-right tabular-nums"
									>
										{formatPercent(summary.capacity_weighted_utilization)}
									</td>
									<td
										data-testid="cell-dept-logged"
										className="px-4 py-2.5 text-right tabular-nums"
									>
										{formatNumber(summary.logged_hours)}
									</td>
									<td
										data-testid="cell-dept-capacity"
										className="px-4 py-2.5 text-right tabular-nums"
									>
										{formatNumber(summary.capacity_hours)}
									</td>
									<td
										data-testid="cell-dept-bench"
										className="px-4 py-2.5 text-right tabular-nums"
									>
										{formatCurrency(summary.bench_cost)}
									</td>
									<td
										data-testid="cell-dept-no-logged"
										className="px-4 py-2.5 text-right tabular-nums"
									>
										{summary.no_logged_count}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
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
	// The department filter is client-side, like the search box: '' = all.
	const [department, setDepartment] = useState('');
	const [search, setSearch] = useState('');
	const [exporting, setExporting] = useState(false);
	// The project breakdown is fetched lazily: only the expanded row's panel
	// is mounted, and only one row expands at a time.
	const [expandedEmployeeId, setExpandedEmployeeId] = useState<number | null>(
		null
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
	// The team trend: server-computed over each month's whole roster, so the
	// chart ignores the band/search filters by design.
	const trend = useMemo(() => data?.trend ?? [], [data]);
	// The two trailing columns' months, read off the cells they label so the
	// header can never drift from the body.
	const trailingMonths = useMemo(
		() => rows[0]?.trailing.slice(0, 2) ?? [],
		[rows]
	);
	// The month's department rollup, computed server-side before the band
	// filter — it describes the month, so neither the band nor the search nor
	// the department narrowing below changes it.
	const departments = useMemo(() => data?.departments ?? [], [data]);
	// A department the viewed month does not hold (the month changed under the
	// filter) stops narrowing the grid instead of hiding every row.
	const departmentValues = useMemo(
		() =>
			new Set(departments.map((summary) => departmentKey(summary.department))),
		[departments]
	);
	const activeDepartment = departmentValues.has(department) ? department : '';
	const departmentOptions = useMemo(
		() => [
			{ value: '', label: 'All departments' },
			...departments.map((summary) => ({
				value: departmentKey(summary.department),
				label: departmentLabel(summary.department),
			})),
		],
		[departments]
	);

	const filteredRows = useMemo(() => {
		const q = search.trim().toLowerCase();
		return rows.filter((row) => {
			if (
				activeDepartment !== '' &&
				departmentKey(row.department) !== activeDepartment
			) {
				return false;
			}
			if (!q) return true;
			return (
				row.employee_name.toLowerCase().includes(q) ||
				row.employee_code.toLowerCase().includes(q)
			);
		});
	}, [rows, search, activeDepartment]);

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
						<label className="block min-w-[180px]">
							<span className="mb-1 block text-[11px] font-semibold text-gray-700">
								Department
							</span>
							<SearchableSelect
								options={departmentOptions}
								value={activeDepartment}
								onChange={(val) => setDepartment(String(val))}
								placeholder="All departments"
								disabled={!data}
								aria-label="Department"
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
						<span data-testid="payroll-rate-note">
							Costs use Payroll&apos;s rate — CTC ÷ Basis Hours (the
							month&apos;s non-Sunday days minus non-optional holidays, × the
							profile&apos;s hours/day). Capacity counts its own calendar
							(Sundays, 2nd/4th Saturdays, holidays), so the two differ by
							design. Unpriced rows show —.
						</span>
					</div>

					{totals && totals.unpriced_count > 0 && (
						<p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
							{totals.unpriced_count} of {totals.employee_count}{' '}
							{totals.unpriced_count === 1 ? 'employee has' : 'employees have'}{' '}
							no salary profile covering {data?.month_label ?? month} — costs
							show as — and are excluded from cost totals.
						</p>
					)}

					{trend.length > 0 && <TeamTrendChart trend={trend} />}

					{departments.length > 0 && (
						<DepartmentSummaryTable
							summaries={departments}
							label={data?.month_label ?? monthLabel(month)}
							selected={activeDepartment}
							onToggle={(value) =>
								setDepartment((previous) => (previous === value ? '' : value))
							}
						/>
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
									: 'No Payroll employee is on this month’s roster.'}
							</p>
						</div>
					) : filteredRows.length === 0 ? (
						<div className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center">
							<p className="text-sm font-semibold text-gray-800">
								No employees match the current filters.
							</p>
							<p className="mt-1 text-xs text-gray-500">
								Showing 0 of {rows.length} employees for {data.month_label}.
							</p>
							<button
								type="button"
								onClick={() => {
									setSearch('');
									setFlag('');
									setDepartment('');
								}}
								className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
							>
								Clear filters
							</button>
						</div>
					) : (
						<div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
							<p
								data-testid="utilization-summary"
								className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600"
							>
								Showing {filteredRows.length} of {rows.length} employees
								{flag ? ` in the ${FLAG_LABEL[flag]} band` : ''} ·{' '}
								{data.month_label}
								{totals
									? ` · ${totals.priced_count} priced · ${totals.unpriced_count} unpriced`
									: ''}
								{totals && totals.no_logged_count > 0 ? (
									<span data-testid="no-time-logged-count">
										{` · ${totals.no_logged_count} no time logged in the month`}
									</span>
								) : null}
								{searchActive
									? ' · totals below cover the full month view, not just the search'
									: ''}
							</p>
							<div className="overflow-x-auto">
								<table className="w-full min-w-[1320px] border-collapse text-sm">
									<caption className="sr-only">
										Team utilization for {data.month_label}, sorted by flag band
										then bench cost descending
									</caption>
									<thead>
										<tr className="border-b border-gray-200 bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500">
											<th scope="col" className="px-4 py-2.5">
												Employee
											</th>
											<th scope="col" className="px-4 py-2.5">
												Department
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Capacity (h)
											</th>
											<th scope="col" className="px-4 py-2.5 text-right">
												Logged (h)
											</th>
											{trailingMonths.map((cell) => (
												<th
													key={cell.month}
													scope="col"
													data-testid="trailing-header"
													data-month={cell.month}
													className="px-4 py-2.5 text-right"
												>
													{monthLabel(cell.month)}
												</th>
											))}
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
										{filteredRows.map((row, index) => {
											const expanded = expandedEmployeeId === row.employee_id;
											return (
												<Fragment key={row.employee_id}>
													<tr
														data-testid="utilization-row"
														data-employee-code={row.employee_code}
														data-band={row.utilization_band ?? ''}
														data-state={row.state ?? ''}
														className={cn(
															'border-b border-gray-100',
															index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
														)}
													>
														<td className="px-4 py-2.5">
															<button
																type="button"
																data-testid="row-expand"
																data-employee-code={row.employee_code}
																aria-expanded={expanded}
																aria-label={`${expanded ? 'Collapse' : 'Expand'} project breakdown for ${row.employee_name}`}
																onClick={() =>
																	setExpandedEmployeeId(
																		expanded ? null : row.employee_id
																	)
																}
																className="mr-1.5 inline-flex align-middle text-gray-400 hover:text-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
															>
																<ChevronRightIcon
																	className={cn(
																		'h-3.5 w-3.5 transition-transform',
																		expanded && 'rotate-90'
																	)}
																	aria-hidden="true"
																/>
															</button>
															<Link
																href={timesheetHref(row)}
																className="font-medium text-[#64126D] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
															>
																{row.employee_name}
															</Link>
															<span className="block text-xs text-gray-500">
																{row.employee_code}
															</span>
															{row.is_partial_window && (
																<span
																	data-testid="partial-window-chip"
																	className="mt-1 inline-flex items-center rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700 ring-1 ring-purple-200"
																>
																	{partialWindowLabel(row)}
																</span>
															)}
														</td>
														<td
															data-testid="cell-department"
															className="px-4 py-2.5"
														>
															{departmentLabel(row.department)}
														</td>
														<td
															data-testid="cell-capacity"
															className="px-4 py-2.5 text-right tabular-nums"
														>
															{formatNumber(row.capacity_hours)}
														</td>
														<td
															data-testid="cell-logged"
															className="px-4 py-2.5 text-right tabular-nums"
														>
															{formatNumber(row.logged_hours)}
														</td>
														{row.trailing.slice(0, 2).map((cell) => (
															<td
																key={cell.month}
																data-testid="cell-trailing-utilization"
																data-month={cell.month}
																data-employed={cell.employed ? 'true' : 'false'}
																className="px-4 py-2.5 text-right tabular-nums"
															>
																{/* Not employed: blank. Employed with no capacity
														    (percent null): an em dash. */}
																{cell.employed
																	? formatPercent(cell.utilization_percent)
																	: ''}
															</td>
														))}
														<td
															data-testid="cell-utilization"
															className="px-4 py-2.5 text-right tabular-nums"
														>
															{formatPercent(row.utilization_percent)}
														</td>
														<td className="px-4 py-2.5">
															<div className="flex flex-wrap items-center gap-1.5">
																<span
																	data-testid="cell-band"
																	className={cn(
																		'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
																		row.state === 'no_time_logged'
																			? 'bg-slate-200 text-slate-700 ring-slate-300'
																			: bandBadge(row.utilization_band)
																	)}
																>
																	{row.state === 'no_time_logged' ? (
																		/* Missing timesheet data: the state replaces
																   the band reading; the % column stays factual. */
																		<span
																			data-testid="no-time-logged"
																			data-state="no_time_logged"
																		>
																			{NO_TIME_LOGGED_LABEL}
																		</span>
																	) : (
																		bandText(row.utilization_band)
																	)}
																</span>
																{row.chronic_under && (
																	<span
																		data-testid="chronic-marker"
																		title="Every employed month of the trailing window reads below 80%"
																		className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-200"
																	>
																		Chronic under
																	</span>
																)}
															</div>
														</td>
														<td
															data-testid="cell-monthly-cost"
															className="px-4 py-2.5 text-right tabular-nums"
														>
															{formatCurrency(row.monthly_cost)}
															{row.cost_status === 'no-profile' && (
																<span className="ml-1.5 inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200">
																	No profile
																</span>
															)}
														</td>
														<td
															data-testid="cell-bench-cost"
															className="px-4 py-2.5 text-right tabular-nums"
														>
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
													{expanded && (
														<tr
															data-testid="project-breakdown-row"
															className="border-b border-gray-100 bg-gray-50/70"
														>
															<td colSpan={11} className="px-4 py-3">
																<ProjectBreakdownPanel row={row} />
															</td>
														</tr>
													)}
												</Fragment>
											);
										})}
									</tbody>
									{totals && (
										<tfoot>
											<tr
												data-testid="utilization-total-row"
												className="border-t-2 border-gray-200 bg-gray-50 text-sm font-semibold"
											>
												<td className="px-4 py-2.5">
													Total ({totals.employee_count} employees)
												</td>
												<td className="px-4 py-2.5" />
												<td
													data-testid="cell-total-capacity"
													className="px-4 py-2.5 text-right tabular-nums"
												>
													{formatNumber(totals.capacity_hours)}
												</td>
												<td
													data-testid="cell-total-logged"
													className="px-4 py-2.5 text-right tabular-nums"
												>
													{formatNumber(totals.logged_hours)}
												</td>
												<td className="px-4 py-2.5" />
												<td className="px-4 py-2.5" />
												<td
													data-testid="cell-total-utilization"
													className="px-4 py-2.5 text-right tabular-nums"
												>
													{formatPercent(totals.utilization_percent)}
												</td>
												<td className="px-4 py-2.5" />
												<td
													data-testid="cell-total-monthly-cost"
													className="px-4 py-2.5 text-right tabular-nums"
												>
													{formatCurrency(totals.monthly_cost)}
												</td>
												<td
													data-testid="cell-total-bench-cost"
													className="px-4 py-2.5 text-right tabular-nums"
												>
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

					{/* Reference, not headline: what the month's roster filter
					    dropped, and why — kept beneath the grid */}
					<RosterDisclosureCard
						disclosure={data?.disclosure ?? null}
						scope="month"
						className="mt-4"
					/>
				</div>
			</main>
		</div>
	);
}
