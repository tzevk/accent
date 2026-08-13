'use client';

import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowDownLeftIcon,
	ArrowPathIcon,
	ArrowUpRightIcon,
	CalendarDaysIcon,
	CheckBadgeIcon,
	CircleStackIcon,
	DevicePhoneMobileIcon,
	ExclamationTriangleIcon,
	FingerPrintIcon,
	InformationCircleIcon,
	InboxArrowDownIcon,
	QuestionMarkCircleIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import SearchableSelect from '@/components/ui/searchable-select';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ─── Client-safe API types ──────────────────────────────────────────

type PunchDirection = 'in' | 'out' | 'unknown';

interface ArEmployee {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	smartoffice_code: string | null;
}

interface ArPunch {
	id: number;
	employee_code: string;
	log_date: string;
	date: string;
	time: string;
	serial_number: string;
	raw_direction: string;
	direction: PunchDirection;
	employee_id: number | null;
	employee_name: string | null;
	acc_employee_code: string | null;
}

interface ArStats {
	total_punches: number;
	mapped_punches: number;
	unmapped_punches: number;
	distinct_days: number;
	distinct_employees: number;
	distinct_devices: number;
}

interface ArDevice {
	serial_number: string;
	punch_count: number;
}

interface ArMeta {
	employees: ArEmployee[];
	months: string[];
	latest_month: string | null;
	devices: ArDevice[];
	has_data: boolean;
}

interface ArData {
	from: string;
	to: string;
	punches: ArPunch[];
	stats: ArStats;
}

interface ApiResponse {
	success: boolean;
	data?: ArData | null;
	meta?: ArMeta;
	error?: string;
}

// ─── Date helpers ───────────────────────────────────────────────────

function isoDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
		date.getDate()
	).padStart(2, '0')}`;
}

/** Default range: first day of the current month through today. */
function defaultRange(): { from: string; to: string } {
	const now = new Date();
	return {
		from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
		to: isoDate(now),
	};
}

interface RangePreset {
	key: string;
	label: string;
	from: string;
	to: string;
}

function rangePresets(): RangePreset[] {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth();
	const today = isoDate(now);

	const last7 = new Date(now);
	last7.setDate(now.getDate() - 6);
	const lastMonthStart = new Date(year, month - 1, 1);
	const lastMonthEnd = new Date(year, month, 0);

	return [
		{
			key: 'last-7-days',
			label: 'Last 7 days',
			from: isoDate(last7),
			to: today,
		},
		{
			key: 'this-month',
			label: 'This month',
			from: isoDate(new Date(year, month, 1)),
			to: today,
		},
		{
			key: 'last-month',
			label: 'Last month',
			from: isoDate(lastMonthStart),
			to: isoDate(lastMonthEnd),
		},
		{
			key: 'this-year',
			label: 'This year',
			from: isoDate(new Date(year, 0, 1)),
			to: today,
		},
	];
}

/** 2026-08-13 → "Thu, 13 Aug 2026"; falls back to the raw ISO string. */
function formatPunchDate(iso: string): string {
	const date = new Date(`${iso}T00:00:00`);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleDateString('en-IN', {
		weekday: 'short',
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
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

function DirectionBadge({ direction }: { direction: PunchDirection }) {
	if (direction === 'in') {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
				<ArrowDownLeftIcon className="h-3 w-3" aria-hidden="true" />
				IN
			</span>
		);
	}
	if (direction === 'out') {
		return (
			<span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-700">
				<ArrowUpRightIcon className="h-3 w-3" aria-hidden="true" />
				OUT
			</span>
		);
	}
	return (
		<span
			className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500"
			title="Device did not report a direction"
		>
			—
		</span>
	);
}

function StatCard({
	value,
	label,
	icon: Icon,
	tileClassName,
	valueClassName,
	footer,
	delay = 0,
}: {
	value: number | string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	tileClassName: string;
	valueClassName: string;
	footer?: ReactNode;
	delay?: number;
}) {
	return (
		<div
			className="anim-slide-up flex min-w-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"
			style={{ animationDelay: `${delay}ms` }}
		>
			<div
				className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tileClassName}`}
			>
				<Icon className="h-5 w-5" aria-hidden="true" />
			</div>
			<div className="min-w-0">
				<div
					className={`text-xl font-bold leading-tight tabular-nums ${valueClassName}`}
				>
					{value}
				</div>
				<div className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-wide text-gray-500">
					{label}
				</div>
				{footer}
			</div>
		</div>
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

	const [from, setFrom] = useState(() => defaultRange().from);
	const [to, setTo] = useState(() => defaultRange().to);
	const [employeeId, setEmployeeId] = useState('');
	const [device, setDevice] = useState('');

	const metaQuery = useQuery<ApiResponse>({
		queryKey: ['reports', 'attendance-report', 'meta'],
		queryFn: () => apiGet('/api/reports/attendance-report'),
		refetchOnWindowFocus: false,
		staleTime: 5 * 60_000,
	});

	const meta = metaQuery.data?.meta;
	const employees = useMemo(() => meta?.employees ?? [], [meta]);
	const devices = useMemo(() => meta?.devices ?? [], [meta]);

	const employeeOptions = useMemo(
		() => [
			{ value: '', label: 'All employees' },
			...employees.map((employee) => ({
				value: String(employee.id),
				label: `${employee.name}${
					employee.employee_id ? ` (${employee.employee_id})` : ''
				}`,
			})),
		],
		[employees]
	);

	const deviceOptions = useMemo(
		() => [
			{ value: '', label: 'All devices' },
			...devices.map((d) => ({
				value: d.serial_number,
				label: `${d.serial_number} (${d.punch_count} punches)`,
			})),
		],
		[devices]
	);

	const rangeValid = from && to && from <= to;

	const dataQuery = useQuery<ApiResponse>({
		queryKey: [
			'reports',
			'attendance-report',
			'data',
			from,
			to,
			employeeId,
			device,
		],
		queryFn: () => {
			const params = new URLSearchParams({ from, to });
			if (employeeId) params.append('employee_id', employeeId);
			if (device) params.append('device', device);
			return apiGet(`/api/reports/attendance-report?${params.toString()}`);
		},
		enabled: !!rangeValid,
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const data = dataQuery.data?.data ?? null;
	const punches = useMemo(() => data?.punches ?? [], [data]);
	const stats = data?.stats ?? null;

	const unmappedCodes = useMemo(() => {
		const codes = new Set<string>();
		for (const punch of punches) {
			if (!punch.employee_id) codes.add(punch.employee_code);
		}
		return Array.from(codes);
	}, [punches]);

	const mappedPercent = stats?.total_punches
		? Math.round((stats.mapped_punches / stats.total_punches) * 100)
		: 0;

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
		dataQuery.error?.message ||
		dataQuery.data?.error ||
		metaQuery.data?.error ||
		(!rangeValid ? 'From date must be on or before To date.' : '');
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
										Smart Office biometric punches
									</p>
								</div>
							</div>
							<div
								className="anim-fade-in flex flex-wrap items-center gap-1.5"
								style={{ animationDelay: '80ms' }}
							>
								{rangePresets().map((preset) => {
									const isActive = preset.from === from && preset.to === to;
									return (
										<button
											key={preset.key}
											type="button"
											onClick={() => {
												setFrom(preset.from);
												setTo(preset.to);
											}}
											className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-[scale,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.96] ${
												isActive
													? 'bg-white text-[#64126D] shadow-sm'
													: 'bg-white/10 text-white hover:bg-white/20'
											}`}
										>
											{preset.label}
										</button>
									);
								})}
							</div>
						</div>
					</div>

					{/* Filter bar */}
					<div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
						<div className="flex flex-wrap items-end gap-3">
							<label className="flex flex-col gap-1">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
									From
								</span>
								<div className="relative">
									<CalendarDaysIcon
										className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
										aria-hidden="true"
									/>
									<input
										type="date"
										value={from}
										onChange={(e) => setFrom(e.target.value)}
										aria-label="From date"
										className={`${controlClass} w-[152px] pl-8`}
									/>
								</div>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
									To
								</span>
								<div className="relative">
									<CalendarDaysIcon
										className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
										aria-hidden="true"
									/>
									<input
										type="date"
										value={to}
										onChange={(e) => setTo(e.target.value)}
										aria-label="To date"
										className={`${controlClass} w-[152px] pl-8`}
									/>
								</div>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
									Employee
								</span>
								<SearchableSelect
									options={employeeOptions}
									value={employeeId}
									onChange={(val) => setEmployeeId(String(val))}
									placeholder="All employees"
									className="w-[240px]"
									buttonClassName="h-9 border-gray-300"
									aria-label="Employee"
								/>
							</label>
							<label className="flex flex-col gap-1">
								<span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
									Device
								</span>
								<select
									value={device}
									onChange={(e) => setDevice(e.target.value)}
									aria-label="Device"
									className={`${controlClass} w-[220px]`}
								>
									{deviceOptions.map((option) => (
										<option key={option.value || 'all'} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</label>
							<button
								type="button"
								onClick={() => dataQuery.refetch()}
								disabled={isRefreshing}
								className="inline-flex h-9 items-center gap-2 rounded-lg bg-purple-600 px-4 text-sm font-semibold text-white shadow-sm transition-[scale,background-color,box-shadow] hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
							>
								<ArrowPathIcon
									className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
									aria-hidden="true"
								/>
								Refresh
							</button>
						</div>
					</div>

					{error ? (
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
								className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-[scale,background-color] hover:bg-red-700 active:scale-[0.96]"
							>
								<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
								Retry
							</button>
						</div>
					) : isLoading ? (
						<div className="flex min-h-[260px] items-center justify-center gap-2 text-sm text-gray-500">
							<ArrowPathIcon
								className="h-4 w-4 animate-spin"
								aria-hidden="true"
							/>
							Loading attendance…
						</div>
					) : !meta?.has_data ? (
						<div className="rounded-2xl bg-blue-50 p-5 shadow-sm ring-1 ring-blue-200">
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
					) : !data ? (
						<div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 text-center">
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100">
								<CalendarDaysIcon
									className="h-6 w-6 text-purple-600"
									aria-hidden="true"
								/>
							</div>
							<p className="text-sm font-medium text-gray-700">
								Pick a date range to view attendance punches
							</p>
						</div>
					) : stats && stats.total_punches === 0 ? (
						<div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-white/60 px-6 text-center">
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
								<InboxArrowDownIcon
									className="h-6 w-6 text-gray-400"
									aria-hidden="true"
								/>
							</div>
							<p className="text-sm font-medium text-gray-700">
								No punches in this date range
							</p>
							<p className="text-xs text-gray-500">
								Try widening the range or clearing the filters.
							</p>
						</div>
					) : (
						<div>
							{/* Stats strip */}
							<div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
								<StatCard
									value={stats?.total_punches ?? 0}
									label="Total punches"
									icon={CircleStackIcon}
									tileClassName="bg-purple-100 text-purple-700"
									valueClassName="text-purple-600"
									delay={0}
								/>
								<StatCard
									value={stats?.mapped_punches ?? 0}
									label="Mapped to employee"
									icon={CheckBadgeIcon}
									tileClassName="bg-green-100 text-green-700"
									valueClassName="text-green-600"
									delay={60}
									footer={
										<div
											className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-green-100"
											title={`${mappedPercent}% of punches mapped to an employee`}
										>
											<div
												className="h-full rounded-full bg-green-500 transition-[width] duration-500 ease-out"
												style={{ width: `${mappedPercent}%` }}
											/>
										</div>
									}
								/>
								<StatCard
									value={stats?.unmapped_punches ?? 0}
									label="Unmapped"
									icon={QuestionMarkCircleIcon}
									tileClassName="bg-amber-100 text-amber-700"
									valueClassName="text-amber-600"
									delay={120}
								/>
								<StatCard
									value={stats?.distinct_days ?? 0}
									label="Days"
									icon={CalendarDaysIcon}
									tileClassName="bg-blue-100 text-blue-700"
									valueClassName="text-blue-600"
									delay={180}
								/>
								<StatCard
									value={stats?.distinct_devices ?? 0}
									label="Devices"
									icon={DevicePhoneMobileIcon}
									tileClassName="bg-gray-100 text-gray-600"
									valueClassName="text-gray-600"
									delay={240}
								/>
							</div>

							{unmappedCodes.length > 0 && (
								<div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
									<ExclamationTriangleIcon
										className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
										aria-hidden="true"
									/>
									<p className="text-sm text-amber-800">
										<span className="font-semibold">
											{stats?.unmapped_punches} punches from{' '}
											{unmappedCodes.length} code
											{unmappedCodes.length === 1 ? '' : 's'} not linked to an
											employee:{' '}
										</span>
										<span className="font-medium">
											{unmappedCodes.slice(0, 10).join(', ')}
											{unmappedCodes.length > 10
												? `, … (${unmappedCodes.length - 10} more)`
												: ''}
										</span>
									</p>
								</div>
							)}

							{/* Punch table */}
							<div className="anim-fade-in overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
								<div className="overflow-x-auto">
									<table className="w-full text-left text-[13px]">
										<caption className="sr-only">
											Attendance punches from {data.from} to {data.to}
										</caption>
										<thead>
											<tr className="border-b border-gray-200 bg-gray-50/80 text-[11px] uppercase tracking-wider text-gray-500">
												<th className="px-4 py-2.5 font-semibold">Date</th>
												<th className="px-4 py-2.5 font-semibold">Time</th>
												<th className="px-4 py-2.5 font-semibold">Employee</th>
												<th className="px-4 py-2.5 font-semibold">
													Smart Office Code
												</th>
												<th className="px-4 py-2.5 font-semibold">Device</th>
												<th className="px-4 py-2.5 font-semibold">Direction</th>
											</tr>
										</thead>
										<tbody>
											{punches.map((punch) => (
												<tr
													key={punch.id}
													className="border-b border-gray-100 transition-colors last:border-0 even:bg-gray-50/50 hover:bg-purple-50/40"
												>
													<td
														className="whitespace-nowrap px-4 py-2.5 text-gray-800"
														title={punch.date}
													>
														{formatPunchDate(punch.date)}
													</td>
													<td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-800">
														{punch.time}
													</td>
													<td className="px-4 py-2.5">
														{punch.employee_id ? (
															<div className="flex items-center gap-2.5">
																<span
																	className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#64126D] to-[#86288F] text-[10px] font-bold text-white"
																	aria-hidden="true"
																>
																	{employeeInitials(punch.employee_name)}
																</span>
																<div className="min-w-0">
																	<span className="block truncate font-medium text-gray-900">
																		{punch.employee_name}
																	</span>
																	{punch.acc_employee_code ? (
																		<span className="block text-[11px] text-gray-500">
																			{punch.acc_employee_code}
																		</span>
																	) : null}
																</div>
															</div>
														) : (
															<span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
																<QuestionMarkCircleIcon
																	className="h-3 w-3"
																	aria-hidden="true"
																/>
																Unmapped
															</span>
														)}
													</td>
													<td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-700">
														{punch.employee_code}
													</td>
													<td
														className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-700"
														title="Biometric device serial number"
													>
														<span className="inline-flex items-center gap-1.5">
															<DevicePhoneMobileIcon
																className="h-3.5 w-3.5 text-gray-400"
																aria-hidden="true"
															/>
															{punch.serial_number}
														</span>
													</td>
													<td className="px-4 py-2.5">
														<DirectionBadge direction={punch.direction} />
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>

							<p className="mt-3 flex items-start gap-1.5 text-[11px] text-gray-500">
								<InformationCircleIcon
									className="mt-px h-3.5 w-3.5 shrink-0"
									aria-hidden="true"
								/>
								Showing up to 5,000 most recent punches. Direction is inferred
								(first punch of the day = in, next = out) when the device
								doesn&apos;t report one.
							</p>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
