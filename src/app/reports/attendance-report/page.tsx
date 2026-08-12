'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
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

/** Default range: first day of the current month through today. */
function defaultRange(): { from: string; to: string } {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return { from: `${year}-${month}-01`, to: `${year}-${month}-${day}` };
}

function DirectionBadge({ direction }: { direction: PunchDirection }) {
	if (direction === 'in') {
		return (
			<span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-blue-100 text-blue-700">
				IN
			</span>
		);
	}
	if (direction === 'out') {
		return (
			<span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-100 text-gray-700">
				OUT
			</span>
		);
	}
	return (
		<span
			className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-50 text-gray-500 border border-gray-200"
			title="Device did not report a direction"
		>
			—
		</span>
	);
}

function StatCard({
	value,
	label,
	color,
}: {
	value: number | string;
	label: string;
	color: string;
}) {
	return (
		<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
			<div className={`text-lg font-bold ${color}`}>{value}</div>
			<div className="text-xs text-gray-600">{label}</div>
		</div>
	);
}

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
			<main className="px-1 pb-8 pt-1 sm:px-2">
				<div className="mx-auto mb-1 flex max-w-[1550px] flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap items-center gap-2 text-[11px]">
						<span className="font-bold text-gray-700">Attendance Report</span>
						<span className="text-gray-400">
							Smart Office biometric punches
						</span>
						<input
							type="date"
							value={from}
							onChange={(e) => setFrom(e.target.value)}
							aria-label="From date"
							className="h-7 border border-gray-400 bg-white px-2 text-[11px] text-black"
						/>
						<span className="text-gray-500">to</span>
						<input
							type="date"
							value={to}
							onChange={(e) => setTo(e.target.value)}
							aria-label="To date"
							className="h-7 border border-gray-400 bg-white px-2 text-[11px] text-black"
						/>
						<SearchableSelect
							options={employeeOptions}
							value={employeeId}
							onChange={(val) => setEmployeeId(String(val))}
							placeholder="All employees"
							className="min-w-[200px]"
							buttonClassName="h-7 rounded-none border-gray-400 text-[11px]"
							aria-label="Employee"
						/>
						<select
							value={device}
							onChange={(e) => setDevice(e.target.value)}
							aria-label="Device"
							className="h-7 border border-gray-400 bg-white px-2 text-[11px] text-black"
						>
							{deviceOptions.map((option) => (
								<option key={option.value || 'all'} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						onClick={() => dataQuery.refetch()}
						disabled={isLoading}
						className="inline-flex h-7 items-center gap-1 border border-gray-400 bg-white px-2 text-[11px] text-gray-700 hover:bg-gray-100 disabled:opacity-50"
					>
						<ArrowPathIcon className="h-3 w-3" />
						Refresh
					</button>
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
						Loading attendance…
					</div>
				) : !meta?.has_data ? (
					<div className="mx-auto max-w-[1550px]">
						<div className="bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm">
							<h3 className="text-sm font-semibold text-blue-900 mb-1">
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
					</div>
				) : !data ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1550px] items-center justify-center border border-gray-300 text-sm text-gray-500">
						Select a date range to view attendance punches.
					</div>
				) : stats && stats.total_punches === 0 ? (
					<div className="mx-auto flex min-h-[300px] max-w-[1550px] items-center justify-center border border-gray-300 text-sm text-gray-500">
						No punches in this date range.
					</div>
				) : (
					<div className="mx-auto max-w-[1550px]">
						{/* Stats strip */}
						<div className="mb-3 flex flex-wrap gap-2">
							<StatCard
								value={stats?.total_punches ?? 0}
								label="Total punches"
								color="text-purple-600"
							/>
							<StatCard
								value={stats?.mapped_punches ?? 0}
								label="Mapped to employee"
								color="text-green-600"
							/>
							<StatCard
								value={stats?.unmapped_punches ?? 0}
								label="Unmapped"
								color="text-amber-600"
							/>
							<StatCard
								value={stats?.distinct_days ?? 0}
								label="Days"
								color="text-blue-600"
							/>
							<StatCard
								value={stats?.distinct_devices ?? 0}
								label="Devices"
								color="text-gray-600"
							/>
						</div>

						{unmappedCodes.length > 0 && (
							<div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
								<span className="font-semibold">
									{stats?.unmapped_punches} punches from {unmappedCodes.length}{' '}
									code
									{unmappedCodes.length === 1 ? '' : 's'} not linked to an
									employee:{' '}
								</span>
								{unmappedCodes.slice(0, 10).join(', ')}
								{unmappedCodes.length > 10
									? `, … (${unmappedCodes.length - 10} more)`
									: ''}
							</div>
						)}

						{/* Punch table */}
						<div className="overflow-x-auto border border-gray-200 rounded-xl bg-white shadow-sm">
							<table className="w-full text-left text-[12px]">
								<caption className="sr-only">
									Attendance punches from {data.from} to {data.to}
								</caption>
								<thead>
									<tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
										<th className="px-3 py-2 font-semibold">Date</th>
										<th className="px-3 py-2 font-semibold">Time</th>
										<th className="px-3 py-2 font-semibold">Employee</th>
										<th className="px-3 py-2 font-semibold">
											Smart Office Code
										</th>
										<th className="px-3 py-2 font-semibold">Device</th>
										<th className="px-3 py-2 font-semibold">Direction</th>
									</tr>
								</thead>
								<tbody>
									{punches.map((punch) => (
										<tr
											key={punch.id}
											className="border-b border-gray-100 last:border-0 hover:bg-purple-50/40"
										>
											<td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-gray-800">
												{punch.date}
											</td>
											<td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-gray-800">
												{punch.time}
											</td>
											<td className="px-3 py-1.5">
												{punch.employee_id ? (
													<div>
														<span className="font-medium text-gray-900">
															{punch.employee_name}
														</span>
														{punch.acc_employee_code ? (
															<span className="ml-1 text-[11px] text-gray-500">
																({punch.acc_employee_code})
															</span>
														) : null}
													</div>
												) : (
													<span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-100 text-amber-700">
														Unmapped
													</span>
												)}
											</td>
											<td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-gray-700">
												{punch.employee_code}
											</td>
											<td
												className="px-3 py-1.5 tabular-nums whitespace-nowrap text-gray-700"
												title="Biometric device serial number"
											>
												{punch.serial_number}
											</td>
											<td className="px-3 py-1.5">
												<DirectionBadge direction={punch.direction} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>

						<p className="mt-2 text-[11px] text-gray-500">
							Showing up to 5,000 most recent punches. Direction is inferred
							(first punch of the day = in, next = out) when the device
							doesn&apos;t report one.
						</p>
					</div>
				)}
			</main>
		</div>
	);
}
