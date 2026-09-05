'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	ArrowPathIcon,
	CalendarDaysIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useSessionRBAC } from '@/utils/client-rbac';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	buildMonthGrid,
	type MonthGrid,
	type OverlapApplication,
} from './data-source';

const PAGE_LIMIT = 200;
const MONTH_NAMES = [
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

interface LeavesResponse {
	success: boolean;
	data?: OverlapApplication[];
	error?: string;
}

async function fetchYear(
	year: number
): Promise<{ applications: OverlapApplication[]; capped: boolean }> {
	const safeYear = Math.min(
		2100,
		Math.max(2000, Math.trunc(year) || new Date().getFullYear())
	);
	const from = `${safeYear}-01-01`;
	const to = `${safeYear}-12-31`;
	const applications: OverlapApplication[] = [];
	let capped = false;
	// ponytail: page-loop until short page, capped; dedicated overlaps endpoint if yearly volume ever hurts
	for (let page = 1; page <= 10; page += 1) {
		const res = (await apiGet('/api/leaves', {
			from,
			to,
			page,
			limit: PAGE_LIMIT,
		})) as LeavesResponse;
		const rows = res.data ?? [];
		applications.push(...rows);
		if (rows.length < PAGE_LIMIT) break;
		if (page === 10) capped = true;
	}
	return { applications, capped };
}

function MonthSection({ grid }: { grid: MonthGrid }) {
	const label = MONTH_NAMES[grid.month] ?? '';
	const overlapDays = grid.days.filter((d) => d.overlapping).length;
	return (
		<div
			id={`leave-month-${grid.month}`}
			className="scroll-mt-20 rounded-2xl border border-gray-200 bg-white shadow-sm"
		>
			<div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
				<h2 className="text-base font-bold text-gray-900">
					{label} {grid.year}
				</h2>
				<span className="text-xs text-gray-500">
					{grid.rows.length} on leave
				</span>
				{overlapDays > 0 && (
					<span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
						{overlapDays} overlap day{overlapDays === 1 ? '' : 's'}
					</span>
				)}
			</div>
			{grid.rows.length === 0 ? (
				<p className="px-4 py-5 text-sm text-gray-400">
					No leave applications this month.
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full border-collapse text-xs">
						<thead>
							<tr className="bg-[#eef6d8]">
								<th className="sticky left-0 z-10 border border-gray-200 bg-[#eef6d8] px-2 py-1.5 text-left font-semibold text-gray-700">
									Sr.
								</th>
								<th className="sticky left-10 z-10 border border-gray-200 bg-[#eef6d8] px-2 py-1.5 text-left font-semibold text-gray-700">
									Employee Name
								</th>
								{grid.days.map((d) => (
									<th
										key={d.iso}
										title={
											d.overlapping
												? `${d.overlapCount} employees on leave on ${d.iso}`
												: d.iso
										}
										className={cn(
											'min-w-7 border border-gray-200 px-1 py-1 text-center font-medium text-gray-600',
											d.isWeekend && 'bg-yellow-50',
											d.overlapping && 'bg-red-50 text-red-700'
										)}
									>
										<span className="block text-[10px] leading-tight">
											{d.weekday}
										</span>
										<span className="block font-bold leading-tight">
											{d.day}
											{d.overlapping && (
												<span className="ml-0.5 rounded bg-red-600 px-1 text-[9px] font-bold text-white">
													×{d.overlapCount}
												</span>
											)}
										</span>
									</th>
								))}
								<th className="border border-gray-200 bg-[#eef6d8] px-2 py-1.5 text-center font-semibold text-gray-700">
									Total Leaves
								</th>
								<th className="min-w-44 border border-gray-200 bg-[#eef6d8] px-2 py-1.5 text-left font-semibold text-gray-700">
									Leave Reason
								</th>
							</tr>
						</thead>
						<tbody>
							{grid.rows.map((row, i) => (
								<tr key={row.userId}>
									<td className="sticky left-0 border border-gray-200 bg-white px-2 py-1.5 text-center tabular-nums">
										{i + 1}
									</td>
									<td
										className="sticky left-10 max-w-40 truncate border border-gray-200 bg-white px-2 py-1.5 font-medium text-gray-900"
										title={row.name}
									>
										{row.name}
									</td>
									{row.cells.map((cell, ci) => {
										const day = grid.days[ci];
										if (!day) return null;
										return (
											<td
												key={day.iso}
												title={
													cell.status
														? `${row.name} — ${cell.status} on ${day.iso}${day.overlapping ? ` (${day.overlapCount} overlapping)` : ''}`
														: day.iso
												}
												className={cn(
													'h-7 border border-gray-200 text-center',
													day.isWeekend &&
														cell.status === null &&
														'bg-gray-50/60',
													cell.status === 'approved' && 'bg-[#f5b971]',
													cell.status === 'pending' &&
														'border-dashed border-amber-500 bg-amber-100',
													cell.status !== null &&
														day.overlapping &&
														'outline outline-2 -outline-offset-2 outline-red-600'
												)}
											/>
										);
									})}
									<td className="border border-gray-200 px-2 py-1.5 text-center font-semibold tabular-nums">
										{row.total}
									</td>
									<td
										className="max-w-56 truncate border border-gray-200 px-2 py-1.5 text-gray-600"
										title={row.reasons || '—'}
									>
										{row.reasons || '—'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

export default function LeaveOverlapsPage() {
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
		RESOURCES: { REPORTS: string; LEAVES: string };
		PERMISSIONS: { READ: string };
	};
	const currentYear = new Date().getFullYear();
	const [year, setYear] = useState(currentYear);

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportAccess =
		isSuperAdmin ||
		(can &&
			RESOURCES &&
			PERMISSIONS &&
			can(RESOURCES.REPORTS, PERMISSIONS.READ)) ||
		hasProjectActivitiesFieldPermission(user);
	const canReadLeaves =
		isSuperAdmin ||
		(can &&
			RESOURCES &&
			PERMISSIONS &&
			can(RESOURCES.LEAVES, PERMISSIONS.READ));
	const hasAccess = Boolean(hasReportAccess && canReadLeaves);

	const leavesQuery = useQuery<{
		applications: OverlapApplication[];
		capped: boolean;
	}>({
		queryKey: ['reports', 'leave-overlaps', year],
		queryFn: () => fetchYear(year),
		enabled: !authLoading && hasAccess,
		staleTime: 30_000,
		refetchOnWindowFocus: false,
	});

	const grids = useMemo<MonthGrid[]>(
		() =>
			Array.from({ length: 12 }, (_, m) =>
				buildMonthGrid(year, m, leavesQuery.data?.applications ?? [])
			),
		[year, leavesQuery.data]
	);

	useEffect(() => {
		if (year !== currentYear || leavesQuery.isLoading) return;
		document
			.getElementById(`leave-month-${new Date().getMonth()}`)
			?.scrollIntoView({ block: 'start' });
	}, [year, currentYear, leavesQuery.isLoading]);

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
									<CalendarDaysIcon className="h-6 w-6" aria-hidden="true" />
								</div>
								<div>
									<h1 className="text-2xl font-bold tracking-tight">
										Leave Overlaps
									</h1>
									<p className="text-sm text-purple-200">
										Employees on leave on the same dates — pending and approved
									</p>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-1.5">
								<label
									htmlFor="overlap-year"
									className="text-xs font-medium text-purple-200"
								>
									Year
								</label>
								<input
									id="overlap-year"
									type="number"
									value={year}
									min={2000}
									max={2100}
									onChange={(e) =>
										setYear(Number(e.target.value) || currentYear)
									}
									className="h-9 w-24 rounded-md border border-white/30 bg-white px-3 text-sm text-black"
								/>
								<button
									type="button"
									onClick={() => leavesQuery.refetch()}
									disabled={leavesQuery.isFetching}
									className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/15 px-3 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-50"
								>
									<ArrowPathIcon
										className={cn(
											'h-4 w-4',
											leavesQuery.isFetching && 'animate-spin'
										)}
									/>
									Refresh
								</button>
							</div>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-600">
						<span className="inline-flex items-center gap-1.5">
							<span className="inline-block h-3 w-3 rounded-sm bg-[#f5b971]" />{' '}
							Approved
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="inline-block h-3 w-3 rounded-sm border border-dashed border-amber-500 bg-amber-100" />{' '}
							Pending
						</span>
						<span className="inline-flex items-center gap-1.5">
							<span className="inline-block h-3 w-3 rounded-sm outline outline-2 outline-red-600" />{' '}
							Overlap day
						</span>
						<span>Rejected leaves never count.</span>
					</div>
					{leavesQuery.data?.capped && (
						<p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
							Year has over 2000 leave applications — showing the first 2000, so
							some overlaps may be missing.
						</p>
					)}

					{leavesQuery.isLoading ? (
						<p className="py-10 text-center text-sm text-gray-400">
							Loading leave applications…
						</p>
					) : leavesQuery.isError ? (
						<p className="py-10 text-center text-sm text-red-600">
							{leavesQuery.error instanceof Error
								? leavesQuery.error.message
								: 'Failed to load leaves.'}
						</p>
					) : (
						grids.map((grid) => (
							<MonthSection key={`${grid.year}-${grid.month}`} grid={grid} />
						))
					)}
				</div>
			</main>
		</div>
	);
}
