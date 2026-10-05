'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	CalendarDaysIcon,
	ExclamationTriangleIcon,
	FingerPrintIcon,
	InboxArrowDownIcon,
	InformationCircleIcon,
	QuestionMarkCircleIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatMonth, formatNumber } from '@/lib/format';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import type {
	ArCell,
	ArData,
	ArMatrixRow,
	ArMeta,
	ArMonthPunch,
	ArStats,
} from './data-source';
import {
	CELL_TONE_CLASSES,
	resolveAttendanceCell,
	type AttendanceCell,
} from './cell-status';
import { aggregateUnmappedCodes } from './unmapped-codes';
import RosterDisclosureCard from '@/components/RosterDisclosure';
import UnmappedCodesStrip from './UnmappedCodesStrip';
import TimePresentNote from './TimePresentNote';
import CellPunchModal, { CellPunchTrigger } from './CellPunchModal';

// ─── Client-safe API types ──────────────────────────────────────────

/**
 * The route's envelope for both requests a viewer makes: the meta probe and a
 * month's payload. The matrix, stats and Punch shapes themselves live in
 * `./data-source` and are imported type-only, so the page and the server
 * transforms cannot drift apart and no server module reaches the bundle.
 */
interface ApiResponse {
	success: boolean;
	data?: ArData | null;
	meta?: ArMeta;
	error?: string;
}

// ─── Month constants ────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Uncomputable Time Present: shown as an em dash, never as 0. */
const EM_DASH = '—';

/**
 * The two figures, deliberately far apart in weight and hue: Logged Hours is
 * the credited, canonical number (emerald, lighter), Time Present is the
 * measurement (purple, bold). Nothing in the grid lets the reader take one for
 * the other.
 */
const LOGGED_HOURS_CLASS =
	'text-[12px] font-medium tabular-nums text-emerald-700';
const TIME_PRESENT_CLASS = 'text-[12px] font-bold tabular-nums text-purple-800';
const NO_FIGURE_CLASS = 'text-[12px] tabular-nums text-gray-500';

/**
 * A matrix column: the day-of-month number and its weekday, both read off
 * the ISO date the route sent. Built once per month instead of per cell.
 */
interface DayColumn {
	date: string;
	day: string;
	weekday: string;
}

/** One Employee's row, with the day → cell lookup the grid reads. */
interface RosterRow {
	employee: ArMatrixRow;
	cellsByDate: Map<string, ArCell>;
}

interface Drilldown {
	employee: { id: number; code: string; name: string };
	date: string;
}

function employeeInitials(name: string | null): string {
	const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	return parts
		.slice(0, 2)
		.map((part) => part[0])
		.join('')
		.toUpperCase();
}

// ─── Small presentational pieces ────────────────────────────────────

/**
 * One matrix cell: the authored Attendance Record badge — or, on a muted
 * Weekly Off / holiday, the words for it — then Logged Hours and Time Present
 * side by side. Presentation only — `cell` is already resolved by
 * `resolveAttendanceCell`, so no rule is re-derived here.
 *
 * The compact visual is restated once as sr-only prose: both measures are
 * named, an uncomputable span is said to be uncomputable, and a muted day is
 * never left to the grey background alone.
 */
function CellContent({ cell }: { cell: AttendanceCell }) {
	// Blank, not zero: a day with neither figure says nothing at all.
	const showFigures = cell.hasLoggedHours || cell.hasPunches;
	// Muted = a Weekly Off or holiday with no logged hours and no punches.
	const mutedLabel = cell.holiday ? 'Holiday' : 'Weekly Off';

	const description = [
		`${cell.date}.`,
		cell.hasLoggedHours
			? `Logged Hours ${formatNumber(cell.loggedHours)}.`
			: 'Logged Hours: none.',
		cell.mergeRefused
			? 'Time Present uncomputable: the cross-midnight merge was refused.'
			: cell.timePresentComputable
				? `Time Present ${formatNumber(cell.timePresentHours)} hours.`
				: 'Time Present uncomputable.',
		cell.statusLabel ? `Authored status: ${cell.statusLabel}.` : '',
		`${cell.punchCount} ${cell.punchCount === 1 ? 'punch' : 'punches'}.`,
		cell.muted ? `${mutedLabel} with no hours and no punches.` : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<span
			title={description}
			className={`flex flex-col items-center gap-0.5 px-0.5 py-1${
				cell.muted ? ' text-gray-500' : ''
			}`}
		>
			<span className="sr-only">{description}</span>
			{cell.statusLabel ? (
				<span
					data-status-code={cell.statusCode ?? undefined}
					aria-hidden="true"
					className={`max-w-full rounded px-1 py-px text-[10px] font-semibold leading-[1.2] ${CELL_TONE_CLASSES[cell.statusTone ?? 'slate']}`}
				>
					{cell.statusLabel}
				</span>
			) : cell.muted ? (
				<span
					aria-hidden="true"
					className="text-[10px] font-medium leading-tight text-gray-500"
				>
					{mutedLabel}
				</span>
			) : null}
			{showFigures ? (
				<span className="flex items-baseline gap-1" aria-hidden="true">
					<span
						data-testid="cell-logged-hours"
						className={
							cell.hasLoggedHours ? LOGGED_HOURS_CLASS : NO_FIGURE_CLASS
						}
					>
						{cell.hasLoggedHours ? formatNumber(cell.loggedHours) : ' '}
					</span>
					<span
						data-testid="cell-time-present"
						className={
							cell.timePresentComputable ? TIME_PRESENT_CLASS : NO_FIGURE_CLASS
						}
					>
						{cell.timePresentComputable
							? formatNumber(cell.timePresentHours)
							: EM_DASH}
					</span>
				</span>
			) : null}
		</span>
	);
}

const controlClass =
	'h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500';

// ─── Page ───────────────────────────────────────────────────────────

export default function AttendanceReportPage() {
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

	// Empty until the viewer picks a month; the latest month with logs is
	// then the default. Deriving rather than syncing through an effect keeps
	// the picker honest — it always shows the month actually rendered.
	const [pickedMonth, setPickedMonth] = useState('');
	const [drilldown, setDrilldown] = useState<Drilldown | null>(null);

	// The gate for everything below it: no month is known until this settles.
	// A failed probe is surfaced at once with its own Retry rather than sitting
	// behind the query client's retry ladder, so the page never looks alive
	// while the report is unreachable.
	const metaQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'attendance-report', 'meta'],
		queryFn: () => apiGet('/api/reports/attendance-report'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
		retry: false,
	});

	const meta = metaQuery.data?.meta ?? null;
	const month = pickedMonth || meta?.latest_month || '';

	const monthValid = MONTH_RE.test(month);

	const dataQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'attendance-report', 'data', month],
		queryFn: () =>
			apiGet(
				`/api/reports/attendance-report?month=${encodeURIComponent(month)}`
			),
		enabled: monthValid,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		// Same failure contract as the meta probe: the error card is the surface,
		// and its Retry (or the hero's Refresh) is the only retry.
		retry: false,
	});

	const data = dataQuery.data?.data ?? null;
	const stats: ArStats | null = data?.stats ?? null;

	// The month arrives already split into cells; a date → cell lookup per row
	// keeps a cell a single map read.
	const rows = useMemo<RosterRow[]>(
		() =>
			(data?.employees ?? []).map((employee) => {
				const cellsByDate = new Map<string, ArCell>();
				for (const cell of employee.cells) {
					cellsByDate.set(cell.date, cell);
				}
				return { employee, cellsByDate };
			}),
		[data]
	);

	// The month's raw punches, keyed by the Employee they are attributed to and
	// the date they carry — the server buckets cells the same way, so a cell and
	// its drill-down can never disagree. Unmapped punches carry no employee id
	// and so key nothing; they reach the page only for the amber strip.
	const punchesByCell = useMemo(() => {
		const map = new Map<string, ArMonthPunch[]>();
		for (const punch of data?.punches ?? []) {
			if (punch.employee_id == null) continue;
			const key = `${punch.employee_id}|${punch.date}`;
			const bucket = map.get(key);
			if (bucket) bucket.push(punch);
			else map.set(key, [punch]);
		}
		return map;
	}, [data]);

	const unmapped = useMemo(
		() => aggregateUnmappedCodes(data?.punches ?? [], { month }),
		[data, month]
	);

	const nonOptionalHolidays = useMemo(
		() => new Set(data?.holidays.non_optional ?? []),
		[data]
	);
	const optionalHolidays = useMemo(
		() => new Set(data?.holidays.optional ?? []),
		[data]
	);

	// UTC parse keeps the weekday off the server's timezone; a malformed date
	// indexes WEEKDAYS with NaN and falls back to a blank header.
	const columns = useMemo<DayColumn[]>(
		() =>
			(data?.days ?? []).map((date) => ({
				date,
				day: date.slice(8, 10),
				weekday: WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '',
			})),
		[data]
	);

	// The open cell's punches: the whole employee-day bucket, every device. The
	// modal owns its own device filter; the page never narrows what it hands over.
	const drilldownPunches = useMemo(() => {
		if (!drilldown) return [];
		return (
			punchesByCell.get(`${drilldown.employee.id}|${drilldown.date}`) ?? []
		);
	}, [punchesByCell, drilldown]);

	// 'August 2026' for the hero, caption and empty states; '' when unset.
	// Anchored to day 1 in local time — parsing a bare 'YYYY-MM' would read as
	// UTC midnight and slip a month in any timezone west of Greenwich.
	const monthHeading = MONTH_RE.test(month)
		? formatMonth(`${month}-01T00:00:00`)
		: '';

	const totalPunches = stats?.total_punches ?? 0;
	const mappedPunches = stats?.mapped_punches ?? 0;
	const unmappedPunches = stats?.unmapped_punches ?? 0;
	const deviceCount = stats?.distinct_devices ?? 0;
	const mappedPercent =
		totalPunches > 0 ? Math.round((mappedPunches / totalPunches) * 100) : 0;

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	// Contract of the gate: `meta-error` the moment the probe fails (an error
	// or a 200 that reports success: false); the webhook card only after a
	// successful probe that says there are no logs yet.
	const metaFailed = metaQuery.isError || metaQuery.data?.success === false;
	const metaErrorText =
		metaQuery.error?.message ||
		metaQuery.data?.error ||
		'The report metadata request failed.';

	const error = dataQuery.error?.message || dataQuery.data?.error || '';
	const isRefreshing = dataQuery.isFetching;
	const isLoading =
		dataQuery.isLoading || (dataQuery.isFetching && !dataQuery.data);

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
				<div className="mx-auto max-w-[1550px]">
					{/* Hero header */}
					<div className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-r from-[#64126D] to-[#86288F] p-5 text-white shadow-lg">
						<div
							className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl"
							aria-hidden="true"
						/>
						<div
							className="pointer-events-none absolute -bottom-24 right-32 h-40 w-40 rounded-full bg-white/5 blur-xl"
							aria-hidden="true"
						/>
						<div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
							<div className="anim-fade-in flex items-center gap-3">
								<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
									<FingerPrintIcon className="h-6 w-6" aria-hidden="true" />
								</div>
								<div>
									<h1 className="text-2xl font-bold tracking-tight">
										Attendance Report
									</h1>
									<p className="text-sm text-purple-200">
										Logged hours and time present per employee
										{monthHeading ? ` · ${monthHeading}` : ''}
									</p>
								</div>
							</div>
							<div className="anim-fade-in" style={{ animationDelay: '80ms' }}>
								<button
									type="button"
									onClick={() => dataQuery.refetch()}
									disabled={isRefreshing || !monthValid}
									className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-[#64126D] shadow-sm transition-[scale,background-color,box-shadow] hover:bg-purple-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
								>
									<ArrowPathIcon
										className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
										aria-hidden="true"
									/>
									Refresh
								</button>
							</div>
						</div>
					</div>

					{/* Month filter — the report's one control */}
					<div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
						<label className="block min-w-[200px]">
							<span className="mb-1 block text-[11px] font-semibold text-gray-700">
								Month
							</span>
							<div className="relative">
								<CalendarDaysIcon
									className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
									aria-hidden="true"
								/>
								<input
									type="month"
									value={month}
									onChange={(e) => setPickedMonth(e.target.value)}
									aria-label="Month"
									className={`${controlClass} w-[168px] pl-8`}
								/>
							</div>
						</label>
					</div>

					{metaFailed ? (
						<div
							data-testid="meta-error"
							role="alert"
							className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm"
						>
							<ExclamationTriangleIcon
								className="mx-auto mb-2 h-7 w-7 text-red-500"
								aria-hidden="true"
							/>
							<p className="font-semibold text-red-800">
								Couldn&apos;t load the report
							</p>
							<p className="mt-1 text-sm text-red-700">{metaErrorText}</p>
							<button
								data-testid="meta-retry"
								type="button"
								onClick={() => metaQuery.refetch()}
								className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-[scale,background-color] hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 active:scale-[0.96]"
							>
								<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Retry
							</button>
						</div>
					) : !metaQuery.data ? (
						<div
							data-testid="report-loading"
							role="status"
							className="flex min-h-[260px] items-center justify-center gap-2 text-sm text-gray-500"
						>
							<ArrowPathIcon
								className="h-4 w-4 animate-spin"
								aria-hidden="true"
							/>
							Loading attendance…
						</div>
					) : meta?.has_data === false ? (
						<div
							data-testid="no-logs"
							className="rounded-2xl bg-blue-50 p-5 shadow-sm ring-1 ring-blue-200"
						>
							<h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-blue-900">
								<InformationCircleIcon
									className="h-4 w-4 text-blue-600"
									aria-hidden="true"
								/>
								No attendance logs yet
							</h3>
							<p className="text-sm text-blue-800">
								Smart Office hasn&apos;t pushed any punches. Once the Attendance
								Export webhook (Utilities &gt; Data Collector Service) is
								configured to POST to /api/attendance/webhook, records will
								appear here — including any records whose employee mapping is
								still pending.
							</p>
						</div>
					) : !monthValid ? (
						<div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 text-center">
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
								<CalendarDaysIcon
									className="h-6 w-6 text-purple-600"
									aria-hidden="true"
								/>
							</div>
							<p className="text-sm font-medium text-gray-700">
								Pick a month to view attendance
							</p>
						</div>
					) : error ? (
						<div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center shadow-sm">
							<ExclamationTriangleIcon
								className="mx-auto mb-2 h-7 w-7 text-red-500"
								aria-hidden="true"
							/>
							<p className="font-semibold text-red-800">
								Couldn&apos;t load the report
							</p>
							<p className="mt-1 text-sm text-red-700">{error}</p>
							<button
								type="button"
								onClick={() => dataQuery.refetch()}
								className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-[scale,background-color] hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 active:scale-[0.96]"
							>
								<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Retry
							</button>
						</div>
					) : isLoading ? (
						<div
							role="status"
							className="flex min-h-[260px] items-center justify-center gap-2 text-sm text-gray-500"
						>
							<ArrowPathIcon
								className="h-4 w-4 animate-spin"
								aria-hidden="true"
							/>
							Loading attendance…
						</div>
					) : (
						<div>
							{/* Punches that reached no employee */}
							<UnmappedCodesStrip
								codes={unmapped.codes}
								totalPunches={unmapped.total_punches}
								className="mb-3"
							/>

							{!data || totalPunches === 0 ? (
								<div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 text-center">
									<div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
										<InboxArrowDownIcon
											className="h-6 w-6 text-gray-400"
											aria-hidden="true"
										/>
									</div>
									<p className="text-sm font-medium text-gray-700">
										No punches in this month
									</p>
									<p className="text-xs text-gray-500">
										{monthHeading
											? `Nothing was recorded in ${monthHeading}.`
											: null}
									</p>
								</div>
							) : rows.length === 0 ? (
								<div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 text-center">
									<div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
										<QuestionMarkCircleIcon
											className="h-6 w-6 text-amber-500"
											aria-hidden="true"
										/>
									</div>
									<p className="text-sm font-medium text-gray-700">
										No payroll employees on the roster
									</p>
									<p className="text-xs text-gray-500">
										{unmapped.total_punches}{' '}
										{unmapped.total_punches === 1 ? 'punch' : 'punches'} in this
										month could not be matched to an employee, and no active
										payroll employee is on the roster.
									</p>
								</div>
							) : (
								<div>
									{/* What the month holds, and how to read it, in two lines */}
									<div className="mb-3 flex flex-col gap-1.5">
										<p
											data-testid="month-summary"
											data-total={totalPunches}
											data-mapped={mappedPunches}
											data-unmapped={unmappedPunches}
											data-devices={deviceCount}
											className="text-xs tabular-nums text-gray-600"
										>
											{`${totalPunches} punches · ${mappedPunches} mapped (${mappedPercent}%) · ${unmappedPunches} unmapped · ${deviceCount} devices`}
										</p>
										<div
											data-testid="figures-legend"
											className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600"
										>
											<span className="inline-flex items-center gap-1.5">
												<span
													className="h-2.5 w-2.5 rounded-sm bg-emerald-500"
													aria-hidden="true"
												/>
												<span className={LOGGED_HOURS_CLASS}>Logged Hours</span>
												<span>
													— billed effort: the canonical numerator payroll
													prices
												</span>
											</span>
											<span className="inline-flex items-center gap-1.5">
												<span
													className="h-2.5 w-2.5 rounded-sm bg-purple-700"
													aria-hidden="true"
												/>
												<span className={TIME_PRESENT_CLASS}>Time Present</span>
												<span>
													— the measured first-to-last span of the day&apos;s
													punches; never credited
												</span>
											</span>
											<span>
												{`An em dash (${EM_DASH}) marks an uncomputable span — never 0. Click a cell for its punches.`}
											</span>
										</div>
									</div>

									{/* Month matrix: employees down, days across */}
									<div className="anim-fade-in overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
										<p className="border-b border-gray-100 bg-gray-50/60 px-4 py-2 text-[11px] text-gray-600 sm:hidden">
											Scroll sideways for the rest of the month →
										</p>
										<div
											role="region"
											aria-label={`Attendance matrix for ${monthHeading || month}`}
											tabIndex={0}
											className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500"
										>
											<table className="w-full text-[12px]">
												<caption className="sr-only">
													Logged hours and time present hours per employee for{' '}
													{monthHeading}
												</caption>
												<thead>
													<tr className="border-b border-gray-200 bg-gray-50/80 text-[10px] uppercase tracking-wider text-gray-600">
														<th
															scope="col"
															className="sticky left-0 z-10 bg-gray-50/95 px-4 py-2 text-left font-semibold"
														>
															Employee
														</th>
														{columns.map((column) => (
															<th
																key={column.date}
																scope="col"
																title={column.date}
																className="min-w-[56px] px-1 py-1.5 text-center font-semibold"
															>
																<span className="block text-[11px] leading-tight text-gray-700">
																	{column.day}
																</span>
																<span className="block text-[9px] font-medium leading-tight text-gray-500">
																	{column.weekday}
																</span>
															</th>
														))}
													</tr>
												</thead>
												<tbody>
													{rows.map(({ employee, cellsByDate }) => (
														<tr
															key={employee.id}
															className="border-b border-gray-100 last:border-0 hover:bg-purple-50/40"
														>
															<th
																scope="row"
																className="sticky left-0 z-10 max-w-[240px] bg-white px-4 py-2 text-left font-normal"
															>
																<span className="flex items-center gap-2.5">
																	<span
																		className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#64126D] to-[#86288F] text-[10px] font-bold text-white"
																		aria-hidden="true"
																	>
																		{employeeInitials(employee.name)}
																	</span>
																	<span className="min-w-0">
																		<span className="block truncate font-medium text-gray-900">
																			{employee.name}
																		</span>
																		<span className="block text-[10px] text-gray-500">
																			{employee.employee_id
																				? `${employee.employee_id} · `
																				: ''}
																			{employee.punch_count} punches
																			{employee.smartoffice_code
																				? ''
																				: ' · no device code'}
																		</span>
																	</span>
																</span>
															</th>
															{columns.map((column) => {
																const cell = cellsByDate.get(column.date);
																const resolved = resolveAttendanceCell({
																	date: column.date,
																	status: cell?.status ?? null,
																	loggedHours: cell?.logged_hours ?? null,
																	punchCount: cell?.punch_count ?? 0,
																	timePresentHours: cell?.hours ?? null,
																	mergeRefused: cell?.merge_refused ?? false,
																	nonOptionalHolidays,
																	optionalHolidays,
																});
																// Every punch this employee-day carries, whatever
																// device sent it — the same bucket the server counted.
																const bucket =
																	punchesByCell.get(
																		`${employee.id}|${column.date}`
																	) ?? [];
																return (
																	<td
																		key={column.date}
																		data-testid="attendance-cell"
																		data-date={column.date}
																		data-muted={
																			resolved.muted ? 'true' : 'false'
																		}
																		data-time-present-state={
																			resolved.timePresentComputable
																				? 'computable'
																				: 'uncomputable'
																		}
																		data-logged-hours-state={
																			resolved.hasLoggedHours
																				? 'present'
																				: 'none'
																		}
																		data-punch-count={resolved.punchCount}
																		className={`px-1 py-1 text-center align-top${
																			resolved.muted ? ' bg-gray-50' : ''
																		}`}
																	>
																		<CellPunchTrigger
																			employee={{
																				code: employee.employee_id,
																				name: employee.name,
																			}}
																			date={column.date}
																			punchCount={bucket.length}
																			onOpen={() =>
																				setDrilldown({
																					employee: {
																						id: employee.id,
																						code: employee.employee_id,
																						name: employee.name,
																					},
																					date: column.date,
																				})
																			}
																		>
																			<CellContent cell={resolved} />
																		</CellPunchTrigger>
																	</td>
																);
															})}
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</div>

									{/* The two facts the grid cannot show: the merge rule, and
									    what a half day does to Time Present */}
									<TimePresentNote className="mt-3" />
								</div>
							)}

							{/* Reference, not headline: what the roster filter dropped,
							    and why — kept at the foot of the page */}
							<RosterDisclosureCard
								disclosure={data?.disclosure ?? null}
								className="mt-4"
							/>
						</div>
					)}
				</div>
			</main>

			{drilldown ? (
				<CellPunchModal
					open
					onClose={() => setDrilldown(null)}
					employee={drilldown.employee}
					date={drilldown.date}
					month={month}
					punches={drilldownPunches.map((punch) => ({
						id: punch.id,
						time: punch.time,
						serialNumber: punch.serial_number,
						employeeCode: punch.employee_code,
						direction: punch.direction,
					}))}
				/>
			) : null}
		</div>
	);
}
