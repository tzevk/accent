'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	MagnifyingGlassIcon,
	ArrowPathIcon,
	UserGroupIcon,
	XMarkIcon,
	FolderIcon,
	CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import EmployeeReportCard, {
	type EmployeeReportItem,
} from '@/components/reports/EmployeeReportCard';
import { apiGet } from '@/lib/api-client';

type ReportResponse = {
	success: boolean;
	data: EmployeeReportItem[];
	meta?: {
		total_employees?: number;
		employees_with_work?: number;
		total_rows?: number;
	};
	error?: string;
};

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: Record<string, { permission?: string } | undefined>;
				};
			};
		};
	};
}

interface SessionUser {
	is_super_admin?: boolean | number | null;
	field_permissions?: FieldPermissionsShape | string | null;
}

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

export default function EmployeeReportPage() {
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
	const [selectedEmployee, setSelectedEmployee] = useState('');
	const [selectedProject, setSelectedProject] = useState('');
	const [dateFrom, setDateFrom] = useState('');
	const [dateTo, setDateTo] = useState('');
	const [showEmpty, setShowEmpty] = useState(false);

	const reportQuery = useQuery<ReportResponse>({
		queryKey: ['reports', 'employee-report'],
		queryFn: () => apiGet('/api/reports/employee-report'),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
	});

	const employees = useMemo(
		() => reportQuery.data?.data ?? [],
		[reportQuery.data]
	);
	const meta = reportQuery.data?.meta;
	const isLoading = reportQuery.isLoading;
	const error = reportQuery.error?.message || reportQuery.data?.error;

	// Unique employee names for the dropdown
	const employeeOptions = useMemo(() => {
		const names = new Set<string>();
		employees.forEach((e) => {
			if (e.user_name) names.add(e.user_name);
		});
		return Array.from(names).sort();
	}, [employees]);

	// Unique project codes for the dropdown
	const projectOptions = useMemo(() => {
		const map = new Map<string, string>();
		employees.forEach((e) =>
			e.rows.forEach((r) => {
				if (r.project_code && !map.has(r.project_code)) {
					map.set(r.project_code, r.project_name || '');
				}
			})
		);
		return Array.from(map.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([code, name]) => ({
				code,
				label: name ? `${code} — ${name}` : code,
			}));
	}, [employees]);

	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	// Filter employees and their rows by search query, employee, project, and date range.
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		const hasDateFilter = !!dateFrom || !!dateTo;
		const hasEmpFilter = !!selectedEmployee;
		const hasProjFilter = !!selectedProject;
		const hasAnyFilter = q || hasDateFilter || hasEmpFilter || hasProjFilter;

		// No filters active and showing all — return as-is.
		if (!hasAnyFilter && showEmpty) return employees;

		return employees
			.map((emp) => {
				// ── employee-level filter ──
				if (hasEmpFilter && emp.user_name !== selectedEmployee) return null;

				// ── search filter ──
				const nameMatch = q
					? emp.user_name?.toLowerCase().includes(q) ||
						emp.email?.toLowerCase().includes(q)
					: true;

				// ── per-row filter (project + search + date range) ──
				const rowMatch = (r: (typeof emp.rows)[number]) => {
					// Project filter
					if (hasProjFilter && r.project_code !== selectedProject) return false;
					// Row-level search filter (only when name didn't match)
					if (q && !nameMatch) {
						if (
							!r.project_code?.toLowerCase().includes(q) &&
							!r.activity_name?.toLowerCase().includes(q) &&
							!r.sub_activity_name?.toLowerCase().includes(q)
						)
							return false;
					}
					// Date range filter
					if (hasDateFilter) {
						if (!r.date) return false;
						if (dateFrom && r.date < dateFrom) return false;
						if (dateTo && r.date > dateTo) return false;
					}
					return true;
				};

				const matchedRows = emp.rows.filter(rowMatch);

				// Hide employee if no rows survived (empty employees are hidden by default).
				if (matchedRows.length === 0) return null;

				return { ...emp, rows: matchedRows } as EmployeeReportItem;
			})
			.filter(Boolean) as EmployeeReportItem[];
	}, [
		employees,
		search,
		selectedEmployee,
		selectedProject,
		dateFrom,
		dateTo,
		showEmpty,
	]);

	/* ── auth guards ─────────────────────────────────────────────────── */
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

	/* ── render ──────────────────────────────────────────────────────── */
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* Header */}
				<div className="mb-5">
					<p className="text-xs text-gray-400 mb-0.5">
						Home <span className="mx-1 text-gray-300">/</span> Reports{' '}
						<span className="mx-1 text-gray-300">/</span>{' '}
						<span className="text-gray-600">Employee Report</span>
					</p>
					<div className="flex items-center justify-between flex-wrap gap-3">
						<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
							Employee Report
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

				{/* Stats */}
				{!isLoading && !error && meta && (
					<div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
						{[
							{
								label: 'Employees',
								value: meta.total_employees ?? employees.length,
							},
							{
								label: 'With Work',
								value: meta.employees_with_work ?? 0,
							},
							{
								label: 'Total Rows',
								value: meta.total_rows ?? 0,
							},
						].map((s) => (
							<div
								key={s.label}
								className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm"
							>
								<div className="flex items-center gap-1.5 mb-0.5">
									<UserGroupIcon className="w-3.5 h-3.5 text-purple-500" />
									<span className="text-[10px] text-gray-400 uppercase tracking-widest font-semibold">
										{s.label}
									</span>
								</div>
								<span className="text-2xl font-bold text-gray-900">
									{s.value}
								</span>
							</div>
						))}
					</div>
				)}

				{/* Search + Filters */}
				<div className="flex flex-wrap items-center gap-2 mb-5">
					<div className="relative flex-1 min-w-[200px] max-w-sm">
						<MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
						<input
							type="text"
							placeholder="Search employee, project, activity…"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 placeholder:text-gray-400"
						/>
					</div>

					{/* Employee filter */}
					<select
						value={selectedEmployee}
						onChange={(e) => setSelectedEmployee(e.target.value)}
						className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
						title="Filter by employee"
					>
						<option value="">All employees</option>
						{employeeOptions.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>

					{/* Project filter */}
					<select
						value={selectedProject}
						onChange={(e) => setSelectedProject(e.target.value)}
						className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
						title="Filter by project"
					>
						<option value="">All projects</option>
						{projectOptions.map((opt) => (
							<option key={opt.code} value={opt.code}>
								{opt.label}
							</option>
						))}
					</select>

					{/* Date range */}
					<div className="flex items-center gap-1.5">
						<CalendarDaysIcon className="w-4 h-4 text-gray-400" />
						<input
							type="date"
							value={dateFrom}
							onChange={(e) => setDateFrom(e.target.value)}
							className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
						/>
						<span className="text-gray-400 text-xs">to</span>
						<input
							type="date"
							value={dateTo}
							onChange={(e) => setDateTo(e.target.value)}
							className="px-2 py-2 text-xs bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400"
						/>
					</div>

					{/* Show empty toggle */}
					<label className="inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded cursor-pointer transition select-none">
						<input
							type="checkbox"
							checked={showEmpty}
							onChange={(e) => setShowEmpty(e.target.checked)}
							className="rounded text-purple-600 focus:ring-purple-500 h-3 w-3 border-gray-300"
						/>
						Show empty
					</label>

					{/* Clear all */}
					{(search ||
						selectedEmployee ||
						selectedProject ||
						dateFrom ||
						dateTo ||
						showEmpty) && (
						<button
							onClick={() => {
								setSearch('');
								setSelectedEmployee('');
								setSelectedProject('');
								setDateFrom('');
								setDateTo('');
								setShowEmpty(false);
							}}
							className="px-2 py-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition"
							title="Clear all filters"
						>
							Clear
						</button>
					)}

					{!isLoading && (
						<span className="text-[11px] text-gray-400">
							{filtered.length} of {employees.length}
							{search ||
							selectedEmployee ||
							selectedProject ||
							dateFrom ||
							dateTo ||
							showEmpty
								? ' (filtered)'
								: ''}
						</span>
					)}
				</div>

				{/* Body */}
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
						Loading…
					</div>
				) : filtered.length === 0 ? (
					<div className="bg-white rounded-xl border border-gray-100 p-14 text-center">
						<FolderIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
						<p className="text-gray-500 font-medium text-sm">
							{search ||
							selectedEmployee ||
							selectedProject ||
							dateFrom ||
							dateTo
								? 'No matching employees.'
								: 'No employees found.'}
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{filtered.map((emp) => (
							<EmployeeReportCard key={emp.user_id} employee={emp} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
