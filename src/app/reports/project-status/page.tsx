'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
	MagnifyingGlassIcon,
	ArrowPathIcon,
	XMarkIcon,
	DocumentTextIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';

// ── Types ──────────────────────────────────────────────────────────

interface ProjectStatusItem {
	project_id: number;
	project_name: string;
	project_code: string;
	client_name: string;
	people_assigned: number;
	target_qty: number;
	actual_qty: number;
	balance: number;
}

interface ReportMeta {
	total_projects: number;
}

interface ReportResponse {
	success: boolean;
	data: ProjectStatusItem[];
	meta?: ReportMeta;
	error?: string;
}

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: {
							permission?: string;
						};
						project_reports?: {
							permission?: string;
						};
					};
				};
			};
		};
	};
}

interface SessionUser {
	id: number;
	is_super_admin?: boolean | number;
	field_permissions?: string | FieldPermissionsShape | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function hasProjectActivitiesFieldPermission(
	user: SessionUser | null | undefined
): boolean {
	if (!user) return false;
	if (user.is_super_admin) return true;
	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms) as FieldPermissionsShape;
		} catch {
			fieldPerms = null;
		}
	}
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	if (!section?.enabled) return false;
	const perm = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return (
		perm === 'view' || perm === 'edit' || legacy === 'view' || legacy === 'edit'
	);
}

type SortKey =
	| 'project_name'
	| 'project_code'
	| 'client_name'
	| 'people_assigned'
	| 'target_qty'
	| 'actual_qty'
	| 'balance';

function formatCell(n: number): string {
	if (!n) return '—';
	return formatNumber(n);
}

function balanceClass(b: number): string {
	if (b > 0) return 'text-amber-600';
	if (b < 0) return 'text-red-600';
	return 'text-gray-400';
}

// ── Component ──────────────────────────────────────────────────────

export default function ProjectStatusPage() {
	const {
		loading: authLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC() as {
		loading: boolean;
		user: SessionUser | null;
		can: (resource: string, permission: string) => boolean;
		RESOURCES: { REPORTS: string };
		PERMISSIONS: { READ: string };
	};

	const [search, setSearch] = useState('');
	const [sortKey, setSortKey] = useState<SortKey>('project_name');
	const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

	const reportQuery = useQuery<ReportResponse>({
		queryKey: ['reports', 'project-status'],
		queryFn: () => apiGet('/api/reports/project-status'),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		enabled: !authLoading,
	});

	const data = useMemo(() => reportQuery.data?.data ?? [], [reportQuery.data]);
	const meta = reportQuery.data?.meta;
	const isLoading = reportQuery.isLoading || authLoading;
	const error = reportQuery.error?.message || reportQuery.data?.error;

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return data;
		return data.filter(
			(r) =>
				r.project_name.toLowerCase().includes(q) ||
				r.project_code.toLowerCase().includes(q) ||
				r.client_name.toLowerCase().includes(q)
		);
	}, [data, search]);

	const sorted = useMemo(() => {
		const dir = sortDir === 'asc' ? 1 : -1;
		return [...filtered].sort((a, b) => {
			if (sortKey === 'project_name') {
				return dir * a.project_name.localeCompare(b.project_name);
			}
			if (sortKey === 'project_code') {
				return dir * a.project_code.localeCompare(b.project_code);
			}
			if (sortKey === 'client_name') {
				return dir * a.client_name.localeCompare(b.client_name);
			}
			const aVal = a[sortKey] ?? 0;
			const bVal = b[sortKey] ?? 0;
			return dir * (Number(aVal) - Number(bVal));
		});
	}, [filtered, sortKey, sortDir]);

	const totals = useMemo(() => {
		return sorted.reduce(
			(acc, r) => ({
				people_assigned: acc.people_assigned + r.people_assigned,
				target_qty: acc.target_qty + r.target_qty,
				actual_qty: acc.actual_qty + r.actual_qty,
				balance: acc.balance + r.balance,
			}),
			{
				people_assigned: 0,
				target_qty: 0,
				actual_qty: 0,
				balance: 0,
			}
		);
	}, [sorted]);

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
		} else {
			setSortKey(key);
			setSortDir(
				key === 'project_name' ||
					key === 'project_code' ||
					key === 'client_name'
					? 'asc'
					: 'desc'
			);
		}
	};

	const sortIndicator = (key: SortKey) => {
		if (sortKey !== key) return null;
		return (
			<span className="ml-0.5 text-[9px]">
				{sortDir === 'asc' ? '\u25B2' : '\u25BC'}
			</span>
		);
	};

	/* ── auth guards ─────────────────────────────────────────────── */
	if (authLoading) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex items-center justify-center h-[70vh]">
					<div className="animate-pulse text-gray-400 text-sm">Loading...</div>
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex items-center justify-center h-[70vh]">
					<div className="text-center">
						<div className="bg-red-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
							<XMarkIcon className="w-7 h-7 text-red-500" />
						</div>
						<h2 className="text-lg font-bold text-gray-800 mb-1">
							Access Denied
						</h2>
						<p className="text-gray-500 text-sm">
							You don&apos;t have permission to view this report.
						</p>
					</div>
				</div>
			</div>
		);
	}

	/* ── render ──────────────────────────────────────────────────── */
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* Header */}
				<div className="mb-5">
					<p className="text-xs text-gray-400 mb-0.5">
						Home <span className="mx-1 text-gray-300">/</span> Reports{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<span className="text-gray-600">Project Status</span>
					</p>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
							Project Status
						</h1>
						<div className="flex items-center gap-2">
							<button
								onClick={() => reportQuery.refetch()}
								disabled={isLoading}
								className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition disabled:opacity-40"
							>
								<ArrowPathIcon
									className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
								/>
								Refresh
							</button>
						</div>
					</div>
				</div>

				{/* Search */}
				<div className="mb-4 flex items-center gap-2">
					<div className="relative flex-1 max-w-md">
						<MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search by project, code, or client..."
							className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:border-purple-400"
						/>
					</div>
					{meta && !isLoading && !error && (
						<span className="text-[11px] text-gray-400">
							{meta.total_projects} project
							{meta.total_projects === 1 ? '' : 's'}
						</span>
					)}
				</div>

				{error ? (
					<div className="bg-red-50 rounded-xl border border-red-100 p-8 text-center">
						<p className="text-red-700 font-semibold mb-1">
							Error Loading Data
						</p>
						<p className="text-red-500 text-sm mb-4">{error}</p>
						<button
							onClick={() => reportQuery.refetch()}
							className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
						>
							Retry
						</button>
					</div>
				) : isLoading ? (
					<div className="bg-white rounded-xl border border-gray-100 p-14 text-center text-gray-400 text-sm">
						<ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
						Loading...
					</div>
				) : sorted.length === 0 ? (
					<div className="bg-white rounded-xl border border-gray-100 p-14 text-center">
						<DocumentTextIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
						<p className="text-gray-500 font-medium text-sm">
							{search ? 'No matching projects.' : 'No project data found.'}
						</p>
					</div>
				) : (
					<div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-gray-100 bg-gray-50/50">
									<th className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider w-10">
										#
									</th>
									<th
										className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('project_name')}
									>
										Project{sortIndicator('project_name')}
									</th>
									<th
										className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('project_code')}
									>
										Code{sortIndicator('project_code')}
									</th>
									<th
										className="text-left px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('client_name')}
									>
										Client{sortIndicator('client_name')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('people_assigned')}
									>
										People{sortIndicator('people_assigned')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('target_qty')}
									>
										Target{sortIndicator('target_qty')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('actual_qty')}
									>
										Actual{sortIndicator('actual_qty')}
									</th>
									<th
										className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-600 whitespace-nowrap"
										onClick={() => toggleSort('balance')}
									>
										Balance{sortIndicator('balance')}
									</th>
								</tr>
							</thead>
							<tbody>
								{sorted.map((r, i) => (
									<tr
										key={r.project_id}
										className={`border-b border-gray-50 hover:bg-purple-50/30 transition-colors ${
											i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
										}`}
									>
										<td className="px-3 py-2.5 text-gray-400 text-xs">
											{i + 1}
										</td>
										<td className="px-3 py-2.5 font-medium text-gray-900">
											<Link
												href={`/projects/${r.project_id}/edit`}
												className="text-purple-700 hover:text-purple-900 hover:underline"
											>
												{r.project_name}
											</Link>
										</td>
										<td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
											{r.project_code || '—'}
										</td>
										<td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">
											{r.client_name || '—'}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
											{formatCell(r.people_assigned)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
											{formatCell(r.target_qty)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-700 whitespace-nowrap">
											{formatCell(r.actual_qty)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums font-semibold whitespace-nowrap">
											<span className={balanceClass(r.balance)}>
												{formatCell(r.balance)}
											</span>
										</td>
									</tr>
								))}
							</tbody>
							{sorted.length > 0 && (
								<tfoot>
									<tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
										<td className="px-3 py-2.5 text-gray-400 text-xs" />
										<td className="px-3 py-2.5 text-gray-800">TOTAL</td>
										<td className="px-3 py-2.5" />
										<td className="px-3 py-2.5" />
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											{formatCell(totals.people_assigned)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											{formatCell(totals.target_qty)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums text-gray-900 whitespace-nowrap">
											{formatCell(totals.actual_qty)}
										</td>
										<td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
											<span className={balanceClass(totals.balance)}>
												{formatCell(totals.balance)}
											</span>
										</td>
									</tr>
								</tfoot>
							)}
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
