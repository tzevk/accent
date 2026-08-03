'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
	MagnifyingGlassIcon,
	ArrowPathIcon,
	XMarkIcon,
	PrinterIcon,
	DocumentTextIcon,
	CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import { useSessionRBAC } from '@/utils/client-rbac';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import SearchableSelect from '@/components/ui/searchable-select';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import ActivityStatusMatrix, {
	type ActivityStatusReport,
} from '@/components/reports/ActivityStatusMatrix';

// ── Types ─────────────────────────────────────────────────────────

interface ProjectOption {
	project_id: number;
	project_name: string;
	project_code: string;
	client_name: string;
}

interface RosterMember {
	user_id: string;
	user_name: string;
}

interface ProjectDetailResponse {
	success: boolean;
	data?: {
		project: {
			project_id: number;
			project_name: string;
			project_code: string;
			client_name: string;
			start_date: string | null;
			end_date: string | null;
		};
		roster?: RosterMember[];
	};
	error?: string;
}

interface MatrixResponse {
	success: boolean;
	data?: ActivityStatusReport;
	error?: string;
}

interface ProjectListResponse {
	success: boolean;
	data?: ProjectOption[];
	meta?: { total_projects: number };
	error?: string;
}

interface SessionUser {
	is_super_admin?: boolean | number | null;
	field_permissions?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────

function isoToday(): string {
	return new Date().toISOString().slice(0, 10);
}

function isoFirstOfMonth(): string {
	const d = new Date();
	d.setUTCDate(1);
	return d.toISOString().slice(0, 10);
}

function rangeDays(from: string, to: string): number {
	if (!from || !to) return 0;
	const a = new Date(`${from}T00:00:00Z`).getTime();
	const b = new Date(`${to}T00:00:00Z`).getTime();
	if (Number.isNaN(a) || Number.isNaN(b) || a > b) return 0;
	return Math.round((b - a) / 86_400_000) + 1;
}

// ── Component ─────────────────────────────────────────────────────

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

	// ── Filters ─────────────────────────────────────────────────
	const [projectId, setProjectId] = useState<string>('');
	const [employeeId, setEmployeeId] = useState<string>('');
	const [from, setFrom] = useState<string>(isoFirstOfMonth());
	const [to, setTo] = useState<string>(isoToday());
	const [applied, setApplied] = useState<{
		projectId: string;
		employeeId: string;
		from: string;
		to: string;
	} | null>(null);

	// ── Auth ────────────────────────────────────────────────────
	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission =
		!!can &&
		!!RESOURCES &&
		!!PERMISSIONS &&
		can(RESOURCES.REPORTS, PERMISSIONS.READ);
	const hasFieldPermission = hasProjectActivitiesFieldPermission(user);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPermission;

	// ── Project list ───────────────────────────────────────────
	const projectsQuery = useQuery<ProjectListResponse>({
		queryKey: ['reports', 'project-status', 'projects'],
		queryFn: () => apiGet('/api/reports/project-status'),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		enabled: !authLoading && hasAccess,
	});

	const projects = useMemo<ProjectOption[]>(
		() => (projectsQuery.data?.data ?? []).slice(),
		[projectsQuery.data]
	);

	// Auto-pick first project once the list loads so the user can move
	// straight to picking a date range.
	useEffect(() => {
		if (!projectId && projects.length > 0) {
			setProjectId(String(projects[0].project_id));
		}
	}, [projects, projectId]);

	// ── Project roster (employee filter) ────────────────────────
	const projectQuery = useQuery<ProjectDetailResponse>({
		queryKey: ['reports', 'project-status', 'project', projectId || 'none'],
		queryFn: () => apiGet(`/api/reports/project-status/${projectId}`),
		refetchOnWindowFocus: false,
		staleTime: 30_000,
		enabled: !!projectId && hasAccess,
	});

	const roster = useMemo<RosterMember[]>(
		() => projectQuery.data?.data?.roster ?? [],
		[projectQuery.data]
	);

	const employeeOptions = useMemo(
		() => roster.map((m) => ({ value: m.user_id, label: m.user_name })),
		[roster]
	);

	// Reset the employee filter when the project changes.
	useEffect(() => {
		setEmployeeId('');
	}, [projectId]);

	const projectOptions = useMemo(
		() =>
			projects.map((p) => ({
				value: String(p.project_id),
				label: p.project_code
					? `${p.project_code} — ${p.project_name}`
					: p.project_name,
			})),
		[projects]
	);

	// ── Matrix (only when filters applied) ─────────────────────
	const matrixQuery = useQuery<MatrixResponse>({
		queryKey: [
			'reports',
			'project-status',
			'matrix',
			applied?.projectId,
			applied?.employeeId,
			applied?.from,
			applied?.to,
		],
		queryFn: () => {
			const params = new URLSearchParams();
			if (applied) {
				if (applied.employeeId) params.set('user_id', applied.employeeId);
				params.set('from', applied.from);
				params.set('to', applied.to);
			}
			return apiGet(
				`/api/reports/project-status/${applied?.projectId}?${params.toString()}`
			);
		},
		refetchOnWindowFocus: false,
		staleTime: 0,
		enabled: !!applied && !!applied.projectId && !!applied.from && !!applied.to,
	});

	const matrixReport = useMemo<ActivityStatusReport | null>(
		() => matrixQuery.data?.data ?? null,
		[matrixQuery.data]
	);

	// ── Filter helpers ─────────────────────────────────────────
	const days = rangeDays(from, to);
	const dateRangeInvalid = !!from && !!to && from > to;
	const canApply = !!projectId && !!from && !!to && !dateRangeInvalid;

	function handleApply() {
		if (!canApply) return;
		setApplied({
			projectId,
			employeeId,
			from,
			to,
		});
	}

	function handleReset() {
		setEmployeeId('');
		setFrom(isoFirstOfMonth());
		setTo(isoToday());
		setApplied(null);
	}

	function handlePrint() {
		if (typeof window !== 'undefined') window.print();
	}

	const selectedProject = projects.find(
		(p) => String(p.project_id) === projectId
	);

	// ── Render guards ──────────────────────────────────────────
	if (authLoading) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex items-center justify-center h-[70vh]">
					<div className="animate-pulse text-gray-400 text-sm" role="status">
						Loading…
					</div>
				</div>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<div className="flex items-center justify-center h-[70vh]">
					<div className="text-center max-w-sm">
						<div className="bg-red-100 w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3">
							<XMarkIcon className="w-7 h-7 text-red-500" />
						</div>
						<h2 className="text-lg font-bold text-gray-800 mb-1">
							Access denied
						</h2>
						<p className="text-gray-500 text-sm">
							You don&apos;t have permission to view this report.
						</p>
					</div>
				</div>
			</div>
		);
	}

	// ── Render ─────────────────────────────────────────────────
	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* ── Page header (hidden in print) ─────────────── */}
				<header className="mb-5 print:hidden">
					<nav aria-label="Breadcrumb" className="text-xs text-gray-400 mb-0.5">
						<ol className="flex flex-wrap items-center gap-1">
							<li>
								<a href="/dashboard" className="hover:text-gray-600">
									Home
								</a>
							</li>
							<li aria-hidden="true">
								<span className="mx-1 text-gray-300">/</span>
							</li>
							<li>
								<a href="/reports" className="hover:text-gray-600">
									Reports
								</a>
							</li>
							<li aria-hidden="true">
								<span className="mx-1 text-gray-300">/</span>
							</li>
							<li className="text-gray-600" aria-current="page">
								Project status
							</li>
						</ol>
					</nav>

					<div className="flex items-center justify-between flex-wrap gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
								Project status
							</h1>
							<p className="text-xs text-gray-500 mt-0.5">
								Print a per-day breakdown of hours and quantity for any project
								and date range.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => projectsQuery.refetch()}
								disabled={projectsQuery.isLoading}
								className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 disabled:opacity-40"
							>
								<ArrowPathIcon
									className={cn(
										'w-3.5 h-3.5',
										projectsQuery.isLoading && 'animate-spin'
									)}
								/>
								Refresh
							</button>
							<button
								type="button"
								onClick={handlePrint}
								disabled={!matrixReport}
								className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-purple-600 text-white border border-purple-600 rounded-md hover:bg-purple-700 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<PrinterIcon className="w-3.5 h-3.5" />
								Print
							</button>
						</div>
					</div>
				</header>

				{/* ── Control bar (hidden in print) ──────────────── */}
				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleApply();
					}}
					className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-4 print:hidden"
					aria-label="Report filters"
				>
					<fieldset
						disabled={projectsQuery.isLoading}
						className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-3 items-end"
					>
						<legend className="sr-only">Filter the activity report</legend>
						<label className="block lg:col-span-4">
							<span className="block text-[11px] font-semibold text-gray-600 mb-1">
								Project
							</span>
							<SearchableSelect
								options={projectOptions}
								value={projectId}
								onChange={(val) => setProjectId(String(val))}
								placeholder="Select a project…"
							/>
						</label>

						<label className="block lg:col-span-4">
							<span className="block text-[11px] font-semibold text-gray-600 mb-1">
								Employee
							</span>
							<SearchableSelect
								options={employeeOptions}
								value={employeeId}
								onChange={(val) => setEmployeeId(String(val))}
								placeholder={
									projectQuery.isLoading
										? 'Loading employees…'
										: 'All employees'
								}
								disabled={!projectId || projectQuery.isLoading}
							/>
						</label>

						<div className="lg:col-span-2">
							<label
								htmlFor="from-date"
								className="block text-[11px] font-semibold text-gray-600 mb-1"
							>
								From
							</label>
							<div className="relative">
								<CalendarDaysIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
								<input
									id="from-date"
									type="date"
									value={from}
									max={to || undefined}
									onChange={(e) => setFrom(e.target.value)}
									className="w-full pl-7 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:border-purple-400 focus-visible:ring-2 focus-visible:ring-purple-500"
								/>
							</div>
						</div>

						<div className="lg:col-span-2">
							<label
								htmlFor="to-date"
								className="block text-[11px] font-semibold text-gray-600 mb-1"
							>
								To
							</label>
							<div className="relative">
								<CalendarDaysIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
								<input
									id="to-date"
									type="date"
									value={to}
									min={from || undefined}
									onChange={(e) => setTo(e.target.value)}
									className="w-full pl-7 pr-2 py-1.5 text-sm bg-white border border-gray-200 rounded-md focus:outline-none focus:border-purple-400 focus-visible:ring-2 focus-visible:ring-purple-500"
								/>
							</div>
						</div>

						<div className="lg:col-span-12 flex flex-wrap items-center gap-2">
							<button
								type="submit"
								disabled={!canApply}
								className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold bg-purple-600 text-white rounded-md hover:bg-purple-700 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								<MagnifyingGlassIcon className="w-3.5 h-3.5" />
								Generate report
							</button>
							<button
								type="button"
								onClick={handleReset}
								className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-white border border-gray-200 text-gray-700 rounded-md hover:border-gray-300 active:scale-[0.96] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-1"
							>
								<ArrowPathIcon className="w-3.5 h-3.5" />
								Reset
							</button>

							{selectedProject &&
								from &&
								to &&
								!dateRangeInvalid &&
								days > 0 && (
									<span
										className="text-[11px] text-gray-500 ml-auto"
										role="status"
										aria-live="polite"
									>
										{roster.length} employee{roster.length === 1 ? '' : 's'} ·{' '}
										{days} day{days === 1 ? '' : 's'}
									</span>
								)}

							{dateRangeInvalid && (
								<span className="text-[11px] text-red-600" role="alert">
									&quot;From&quot; must be on or before &quot;To&quot;.
								</span>
							)}
						</div>
					</fieldset>
				</form>

				{/* ── Report output ──────────────────────────────── */}
				<main aria-label="Activity status report">
					{!applied ? (
						<EmptyState />
					) : matrixQuery.isLoading ? (
						<div className="bg-white rounded-xl border border-gray-100 p-14 text-center text-gray-400 text-sm">
							<ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
							Building the report…
						</div>
					) : matrixQuery.isError ? (
						<ErrorPanel
							message={
								(matrixQuery.error as Error | undefined)?.message ||
								matrixQuery.data?.error ||
								'Could not load the report.'
							}
							onRetry={() => matrixQuery.refetch()}
						/>
					) : matrixQuery.data?.error ? (
						<ErrorPanel
							message={matrixQuery.data.error}
							onRetry={() => matrixQuery.refetch()}
						/>
					) : !matrixReport ? (
						<EmptyState
							title="No data for this range"
							description="Try widening the date range."
						/>
					) : (
						<ActivityStatusMatrix report={matrixReport} />
					)}
				</main>
			</div>
		</div>
	);
}

// ── Subcomponents ─────────────────────────────────────────────────

function EmptyState({
	title = 'No report yet',
	description = 'Pick a project and date range above, then choose Generate report.',
}: {
	title?: string;
	description?: string;
}) {
	return (
		<div className="bg-white rounded-xl border border-gray-100 p-14 text-center print:hidden">
			<DocumentTextIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
			<p className="text-gray-700 font-semibold text-sm">{title}</p>
			<p className="text-gray-500 text-xs mt-1 max-w-sm mx-auto">
				{description}
			</p>
		</div>
	);
}

function ErrorPanel({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<div className="bg-red-50 rounded-xl border border-red-100 p-8 text-center print:hidden">
			<p className="text-red-700 font-semibold mb-1">
				Couldn&apos;t load the report
			</p>
			<p className="text-red-500 text-sm mb-4">{message}</p>
			<button
				type="button"
				onClick={onRetry}
				className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1"
			>
				Retry
			</button>
		</div>
	);
}
