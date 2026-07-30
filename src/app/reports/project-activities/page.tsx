'use client';

import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
	MagnifyingGlassIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	BriefcaseIcon,
	ArrowPathIcon,
	ChartBarIcon,
	UserIcon,
	CalendarDaysIcon,
	ClockIcon,
	ClipboardDocumentListIcon,
	FolderIcon,
	XMarkIcon,
	ArrowDownTrayIcon,
	DocumentTextIcon,
	FunnelIcon,
	BeakerIcon,
} from '@heroicons/react/24/outline';
import {
	buildTree,
	computeKpis,
	uniqueDisciplines,
	filterTree,
	statusBadgeClass,
	fmtNum,
	fmtDate,
} from './report-utils';
import type {
	ApiProject,
	Project,
	Discipline,
	Task,
	Member,
	RollupStatus,
} from './report-utils';
import { downloadReport, type ExportFormat } from './client-export';

// ── Permission logic (mirrors the API route) ─────────────────────────

interface FieldPerms {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: { permission?: string };
						project_reports?: { permission?: string };
					};
				};
			};
		};
	};
}

function hasFieldPermission(raw: unknown): boolean {
	if (!raw || typeof raw !== 'object') return false;
	const modules = (raw as FieldPerms).modules;
	const section = modules?.reports?.sections?.report_access;
	if (!section?.enabled) return false;
	const f = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return f === 'view' || f === 'edit' || legacy === 'view' || legacy === 'edit';
}

function parseFieldPerms(raw: unknown): unknown {
	if (raw == null) return null;
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			return null;
		}
	}
	return raw;
}

// ── Component ─────────────────────────────────────────────────────────

// `useSessionRBAC()` comes from a JS SessionContext whose `useState(null)`
// infers `user` as `never`. Re-shape it once at the boundary.
interface SessionLike {
	user: {
		is_super_admin?: boolean | number;
		field_permissions?: unknown;
	} | null;
	loading: boolean;
	can: (resource: string, action: string) => boolean;
	RESOURCES: Record<string, string>;
	PERMISSIONS: Record<string, string>;
}

export default function ProjectActivitiesReport() {
	const {
		loading: authLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC() as unknown as SessionLike;

	// Data
	const [rawData, setRawData] = useState<ApiProject[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [exporting, setExporting] = useState<ExportFormat | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);

	// Filters
	const [search, setSearch] = useState('');
	const [disciplineFilter, setDisciplineFilter] = useState('all');
	const [startDate, setStartDate] = useState('');
	const [endDate, setEndDate] = useState('');

	// Expansion state
	const [openProjects, setOpenProjects] = useState<Record<string, boolean>>({});
	const [openDisciplines, setOpenDisciplines] = useState<
		Record<string, boolean>
	>({});
	const [openTasks, setOpenTasks] = useState<Record<string, boolean>>({});

	// Permission evaluation
	const isSuperAdmin =
		user?.is_super_admin === true || user?.is_super_admin === 1;
	const hasReportsPermission = !!(
		can && can(RESOURCES.REPORTS, PERMISSIONS.READ)
	);
	const hasFieldPerm = useMemo(
		() => hasFieldPermission(parseFieldPerms(user?.field_permissions)),
		[user]
	);
	const hasAccess = isSuperAdmin || hasReportsPermission || hasFieldPerm;

	// Fetch
	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch('/api/reports/project-activities', {
				cache: 'no-store',
			});
			const data = await res.json();
			if (data.success) {
				setRawData(data.data || []);
			} else {
				setError(data.error || 'Failed to load work logs');
			}
		} catch (err) {
			console.error('Project activities load error:', err);
			setError(err instanceof Error ? err.message : 'Unable to load work logs');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (hasAccess) load();
	}, [hasAccess, load]);

	// Derived data
	const tree = useMemo(
		() => buildTree(rawData, { startDate, endDate }),
		[rawData, startDate, endDate]
	);
	const filteredTree = useMemo(
		() => filterTree(tree, { search, discipline: disciplineFilter }),
		[tree, search, disciplineFilter]
	);
	const kpis = useMemo(() => computeKpis(filteredTree), [filteredTree]);
	const disciplines = useMemo(() => uniqueDisciplines(tree), [tree]);

	// Auto-expand the first discipline of every project on first successful load.
	// Use a sticky state flag (not derived from openProjects) so Collapse all
	// doesn't reset the flag and re-fire this effect.
	const [hasAutoExpanded, setHasAutoExpanded] = useState(false);
	useEffect(() => {
		if (hasAutoExpanded || filteredTree.length === 0) return;
		setHasAutoExpanded(true);
		const p: Record<string, boolean> = {};
		const d: Record<string, boolean> = {};
		filteredTree.forEach((proj) => {
			p[String(proj.project_id)] = true;
			if (proj.disciplines[0]) {
				d[`${proj.project_id}|${proj.disciplines[0].name}`] = true;
			}
		});
		setOpenProjects(p);
		setOpenDisciplines(d);
	}, [filteredTree, hasAutoExpanded]);

	// Open state is opt-in: an item is open only when its key is `true`. This
	// makes collapseAll() (state = {}) actually collapse, and lets newly loaded
	// items default to closed once the user has interacted.
	const isProjectOpen = (id: string) => openProjects[id] === true;
	const isDisciplineOpen = (key: string) => openDisciplines[key] === true;
	const isTaskOpen = (key: string) => openTasks[key] === true;

	// Toggle helpers: invert the current state, treating undefined as closed.
	const toggleProject = (id: string) =>
		setOpenProjects((p) => ({ ...p, [id]: p[id] !== true }));
	const toggleDiscipline = (key: string) =>
		setOpenDisciplines((p) => ({ ...p, [key]: p[key] !== true }));
	const toggleTask = (key: string) =>
		setOpenTasks((p) => ({ ...p, [key]: p[key] !== true }));

	const expandAll = () => {
		const p: Record<string, boolean> = {};
		const d: Record<string, boolean> = {};
		const t: Record<string, boolean> = {};
		filteredTree.forEach((proj) => {
			p[String(proj.project_id)] = true;
			proj.disciplines.forEach((dis) => {
				const dKey = `${proj.project_id}|${dis.name}`;
				d[dKey] = true;
				dis.tasks.forEach((task) => {
					t[`${dKey}|${task.id}`] = true;
				});
			});
		});
		setOpenProjects(p);
		setOpenDisciplines(d);
		setOpenTasks(t);
	};

	const collapseAll = () => {
		setOpenProjects({});
		setOpenDisciplines({});
		setOpenTasks({});
	};

	// Export
	const onExport = async (format: ExportFormat) => {
		setExporting(format);
		setExportError(null);
		try {
			await downloadReport(format, {
				startDate,
				endDate,
				discipline: disciplineFilter,
			});
		} catch (e) {
			setExportError(
				e instanceof Error ? e.message : 'Failed to generate export'
			);
		} finally {
			setExporting(null);
		}
	};

	const clearDateRange = () => {
		setStartDate('');
		setEndDate('');
	};

	const hasDateFilter = !!(startDate || endDate);

	// ── Auth gates ───────────────────────────────────────────────────

	if (authLoading) {
		return (
			<Gate>
				<Navbar />
				<div className="flex items-center justify-center h-[60vh]">
					<div className="animate-pulse text-sm text-gray-400">Loading…</div>
				</div>
			</Gate>
		);
	}

	if (!hasAccess) {
		return (
			<Gate>
				<Navbar />
				<div className="flex items-center justify-center h-[60vh]">
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
			</Gate>
		);
	}

	// ── Render ───────────────────────────────────────────────────────

	return (
		<Gate>
			<Navbar />
			<div className="pt-4 px-3 sm:px-4 lg:px-6 pb-8 max-w-[1920px] mx-auto">
				{/* Header */}
				<div className="mb-5 flex items-start justify-between flex-wrap gap-3">
					<div>
						<p className="text-xs text-gray-400 mb-0.5">
							Home <span className="mx-1 text-gray-300">/</span> Reports{' '}
							<span className="mx-1 text-gray-300">/</span>{' '}
							<span className="text-gray-600">Project Activities</span>
						</p>
						<h1 className="text-2xl font-bold text-gray-900 tracking-tight">
							Project Activities
						</h1>
						<p className="text-xs text-gray-500 mt-1">
							Client reporting view · Project → Discipline → Task → User
						</p>
					</div>
					<div className="flex items-center gap-2 flex-wrap">
						<button
							onClick={expandAll}
							className="text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition"
						>
							Expand all
						</button>
						<button
							onClick={collapseAll}
							className="text-[11px] px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition"
						>
							Collapse all
						</button>
						<button
							onClick={load}
							disabled={loading}
							className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition disabled:opacity-40"
						>
							<ArrowPathIcon
								className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
							/>
							Refresh
						</button>
						<button
							onClick={() => onExport('pdf')}
							disabled={exporting !== null}
							className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition disabled:opacity-40"
						>
							<DocumentTextIcon className="w-3.5 h-3.5 text-red-500" />
							{exporting === 'pdf' ? 'Opening…' : 'PDF'}
						</button>
						<button
							onClick={() => onExport('excel')}
							disabled={exporting !== null}
							className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-white border border-gray-200 rounded-md hover:border-gray-300 transition disabled:opacity-40"
						>
							<ArrowDownTrayIcon className="w-3.5 h-3.5 text-green-600" />
							{exporting === 'excel' ? 'Downloading…' : 'Excel'}
						</button>
					</div>
				</div>

				{/* Export error */}
				{exportError && (
					<div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-sm text-red-700">
						<XMarkIcon className="w-4 h-4" />
						{exportError}
						<button
							className="ml-auto text-xs text-red-700 hover:underline"
							onClick={() => setExportError(null)}
						>
							Dismiss
						</button>
					</div>
				)}

				{/* KPI cards */}
				{!loading && !error && (
					<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-5">
						<KpiCard
							icon={BriefcaseIcon}
							label="Projects"
							value={kpis.projects}
							accent="text-[#7F2487]"
						/>
						<KpiCard
							icon={ClipboardDocumentListIcon}
							label="Tasks"
							value={kpis.tasks}
							accent="text-blue-600"
						/>
						<KpiCard
							icon={UserIcon}
							label="Members"
							value={kpis.members}
							accent="text-emerald-600"
						/>
						<KpiCard
							icon={ChartBarIcon}
							label="Scope"
							value={fmtNum(kpis.total_assigned)}
							accent="text-[#7F2487]"
						/>
						<KpiCard
							icon={ChartBarIcon}
							label="Executed"
							value={fmtNum(kpis.total_done)}
							accent="text-green-600"
						/>
						<KpiCard
							icon={ChartBarIcon}
							label="Pending"
							value={fmtNum(kpis.pending_assigned)}
							accent="text-orange-600"
						/>
						<KpiCard
							icon={ChartBarIcon}
							label={`Completion`}
							value={`${kpis.completion_rate}%`}
							accent="text-blue-700"
						/>
					</div>
				)}

				{/* Filters */}
				<div className="bg-white border border-gray-200 rounded-lg shadow-sm p-3 mb-4">
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative flex-1 min-w-[200px] max-w-sm">
							<MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
							<input
								type="text"
								placeholder="Search project, task, member…"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 placeholder:text-gray-400"
							/>
						</div>

						<div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-sm h-9">
							<CalendarDaysIcon className="w-3.5 h-3.5 text-gray-400" />
							<input
								type="date"
								value={startDate}
								onChange={(e) => setStartDate(e.target.value)}
								className="text-xs border-0 p-0 focus:ring-0"
							/>
							<span className="text-gray-300 text-xs">→</span>
							<input
								type="date"
								value={endDate}
								onChange={(e) => setEndDate(e.target.value)}
								className="text-xs border-0 p-0 focus:ring-0"
							/>
							{hasDateFilter && (
								<button
									onClick={clearDateRange}
									className="text-gray-400 hover:text-gray-600"
									title="Clear date range"
								>
									<XMarkIcon className="w-3.5 h-3.5" />
								</button>
							)}
						</div>

						{!loading && (
							<span className="text-[11px] text-gray-500 ml-auto">
								{filteredTree.length} of {tree.length} project
								{tree.length !== 1 ? 's' : ''}
								{search || disciplineFilter !== 'all' || hasDateFilter
									? ' (filtered)'
									: ''}
							</span>
						)}
					</div>

					{/* Discipline tabs */}
					{disciplines.length > 0 && (
						<div className="mt-3 flex items-center gap-2 flex-wrap">
							<FunnelIcon className="w-3.5 h-3.5 text-gray-400" />
							<DisciplineTab
								active={disciplineFilter === 'all'}
								label="All"
								onClick={() => setDisciplineFilter('all')}
							/>
							{disciplines.map((d) => (
								<DisciplineTab
									key={d.name}
									active={
										disciplineFilter.toLowerCase() === d.name.toLowerCase()
									}
									label={d.name}
									sub={`${d.task_count} task${d.task_count !== 1 ? 's' : ''}`}
									onClick={() => setDisciplineFilter(d.name)}
								/>
							))}
						</div>
					)}
				</div>

				{/* Body */}
				{error ? (
					<ErrorState message={error} onRetry={load} />
				) : loading ? (
					<LoadingState />
				) : filteredTree.length === 0 ? (
					<EmptyState
						hasFilters={!!search || disciplineFilter !== 'all' || hasDateFilter}
					/>
				) : (
					<div className="space-y-4">
						{filteredTree.map((p, pIdx) => (
							<ProjectNode
								key={`${p.project_id}|${p.project_name}|${pIdx}`}
								project={p}
								isOpen={isProjectOpen(String(p.project_id))}
								onToggle={() => toggleProject(String(p.project_id))}
								isDisciplineOpen={isDisciplineOpen}
								isTaskOpen={isTaskOpen}
								onToggleDiscipline={(name) =>
									toggleDiscipline(`${p.project_id}|${name}`)
								}
								onToggleTask={(name, id) =>
									toggleTask(`${p.project_id}|${name}|${id}`)
								}
							/>
						))}
					</div>
				)}
			</div>
		</Gate>
	);
}

// ── Helpers ──────────────────────────────────────────────────────────

function Gate({ children }: { children: React.ReactNode }) {
	return <div className="min-h-screen bg-gray-50">{children}</div>;
}

function KpiCard({
	icon: Icon,
	label,
	value,
	accent,
}: {
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: string | number;
	accent: string;
}) {
	return (
		<div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
			<div className="flex items-center gap-1.5 mb-1">
				<Icon className={`w-3.5 h-3.5 ${accent}`} />
				<span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
					{label}
				</span>
			</div>
			<span className="text-2xl font-bold text-gray-900 tabular-nums">
				{value}
			</span>
		</div>
	);
}

function DisciplineTab({
	active,
	label,
	sub,
	onClick,
}: {
	active: boolean;
	label: string;
	sub?: string;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium border transition ${
				active
					? 'bg-purple-600 text-white border-purple-600 shadow-sm'
					: 'bg-white text-gray-600 border-gray-200 hover:border-purple-200 hover:text-purple-700'
			}`}
		>
			{label}
			{sub && (
				<span
					className={`text-[10px] ${
						active ? 'text-purple-100' : 'text-gray-400'
					}`}
				>
					{sub}
				</span>
			)}
		</button>
	);
}

function StatusBadge({ status }: { status: RollupStatus | string }) {
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusBadgeClass(status)}`}
		>
			{status}
		</span>
	);
}

function ProgressBar({ pct }: { pct: number }) {
	const p = Math.min(100, Math.max(0, pct));
	return (
		<div className="flex items-center gap-2">
			<div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
				<div
					className="h-full bg-purple-600 transition-all"
					style={{ width: `${p}%` }}
				/>
			</div>
			<span className="text-[10px] text-gray-500 tabular-nums w-8 text-right">
				{p}%
			</span>
		</div>
	);
}

// ── Tree nodes ───────────────────────────────────────────────────────

function ProjectNode({
	project,
	isOpen,
	onToggle,
	isDisciplineOpen,
	isTaskOpen,
	onToggleDiscipline,
	onToggleTask,
}: {
	project: Project;
	isOpen: boolean;
	onToggle: () => void;
	isDisciplineOpen: (key: string) => boolean;
	isTaskOpen: (key: string) => boolean;
	onToggleDiscipline: (name: string) => void;
	onToggleTask: (name: string, id: string | number) => void;
}) {
	return (
		<div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
			<button
				onClick={onToggle}
				className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-purple-50/50 to-white border-b border-gray-200 hover:from-purple-50 transition-colors text-left"
			>
				{isOpen ? (
					<ChevronDownIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
				) : (
					<ChevronRightIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
				)}
				<div className="w-8 h-8 bg-[#7F2487]/10 rounded-lg flex items-center justify-center flex-shrink-0">
					<BriefcaseIcon className="w-4 h-4 text-[#7F2487]" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						{project.project_code && (
							<span className="text-[10px] font-mono text-[#7F2487] bg-purple-50 px-1.5 py-0.5 rounded">
								{project.project_code}
							</span>
						)}
						<h3 className="text-sm font-semibold text-gray-900">
							{project.project_name}
						</h3>
						<StatusBadge status={project.status} />
					</div>
					<p className="text-[11px] text-gray-500 mt-0.5">
						{project.client_name && <>Client: {project.client_name} · </>}
						{project.task_count} task
						{project.task_count !== 1 ? 's' : ''} · {project.member_count}{' '}
						member
						{project.member_count !== 1 ? 's' : ''}
						{(project.start_date || project.end_date) && (
							<>
								{' '}
								·{' '}
								<span className="text-gray-400">
									{fmtDate(project.start_date)} → {fmtDate(project.end_date)}
								</span>
							</>
						)}
					</p>
				</div>
				<div className="flex flex-col items-end gap-1 flex-shrink-0">
					<div className="flex items-center gap-3 text-[11px]">
						<span className="text-gray-500">Qty</span>
						<span className="font-semibold text-gray-900 tabular-nums">
							{fmtNum(project.total_done)} / {fmtNum(project.total_assigned)}
						</span>
					</div>
					<ProgressBar pct={project.progress} />
				</div>
			</button>

			{isOpen && (
				<div className="divide-y divide-gray-100">
					{project.disciplines.map((d) => (
						<DisciplineNode
							key={d.name}
							discipline={d}
							isOpen={isDisciplineOpen(`${project.project_id}|${d.name}`)}
							onToggle={() => onToggleDiscipline(d.name)}
							isTaskOpen={isTaskOpen}
							onToggleTask={onToggleTask}
							disciplineKey={`${project.project_id}|${d.name}`}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function DisciplineNode({
	discipline,
	isOpen,
	onToggle,
	isTaskOpen,
	onToggleTask,
	disciplineKey,
}: {
	discipline: Discipline;
	isOpen: boolean;
	onToggle: () => void;
	isTaskOpen: (key: string) => boolean;
	onToggleTask: (name: string, id: string | number) => void;
	disciplineKey: string;
}) {
	const memberCount = discipline.tasks.reduce(
		(s, t) => s + t.members.length,
		0
	);
	return (
		<div>
			<button
				onClick={onToggle}
				className="w-full flex items-center gap-3 px-5 py-2.5 hover:bg-purple-50/40 transition-colors text-left"
			>
				{isOpen ? (
					<ChevronDownIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
				) : (
					<ChevronRightIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
				)}
				<div className="w-6 h-6 bg-purple-100 rounded flex items-center justify-center flex-shrink-0">
					<BeakerIcon className="w-3.5 h-3.5 text-[#7F2487]" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-xs font-semibold text-[#7F2487] uppercase tracking-wider">
							{discipline.name}
						</span>
						<StatusBadge status={discipline.status} />
					</div>
					<p className="text-[10px] text-gray-500">
						{discipline.tasks.length} task
						{discipline.tasks.length !== 1 ? 's' : ''} · {memberCount} member
						{memberCount !== 1 ? 's' : ''}
					</p>
				</div>
				<div className="flex items-center gap-2 text-[11px] flex-shrink-0">
					<span className="text-gray-500 tabular-nums">
						{fmtNum(discipline.total_done)} /{' '}
						{fmtNum(discipline.total_assigned)}
					</span>
					<ProgressBar pct={discipline.progress} />
				</div>
			</button>

			{isOpen && (
				<div className="bg-gray-50/50 border-t border-gray-100 divide-y divide-gray-100">
					{discipline.tasks.map((t, tIdx) => (
						<TaskNode
							key={`${disciplineKey}|${t.id}|${t.name}|${tIdx}`}
							task={t}
							isOpen={isTaskOpen(`${disciplineKey}|${t.id}`)}
							onToggle={() => onToggleTask(discipline.name, t.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function TaskNode({
	task,
	isOpen,
	onToggle,
}: {
	task: Task;
	isOpen: boolean;
	onToggle: () => void;
}) {
	return (
		<div>
			<button
				onClick={onToggle}
				className="w-full flex items-center gap-3 pl-12 pr-5 py-2 hover:bg-white transition-colors text-left"
			>
				{isOpen ? (
					<ChevronDownIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
				) : (
					<ChevronRightIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
				)}
				<ClipboardDocumentListIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium text-gray-800">
							{task.name}
						</span>
						<StatusBadge status={task.status} />
					</div>
					{task.description && (
						<p className="text-[10px] text-gray-500 line-clamp-1">
							{task.description}
						</p>
					)}
				</div>
				<div className="flex items-center gap-2 text-[11px] flex-shrink-0">
					<span className="text-gray-500 tabular-nums">
						{fmtNum(task.total_done)} / {fmtNum(task.total_assigned)}
					</span>
					<ProgressBar pct={task.progress} />
				</div>
			</button>

			{isOpen && task.members.length > 0 && (
				<div className="pl-16 pr-5 pb-3 space-y-1.5">
					{task.members.map((m, mIdx) => (
						<MemberRow
							key={`${m.user_id}|${m.user_name || ''}|${mIdx}`}
							member={m}
						/>
					))}
				</div>
			)}

			{isOpen && task.members.length === 0 && (
				<div className="pl-16 pr-5 pb-3 text-[10px] text-gray-400 italic">
					No member assignments.
				</div>
			)}
		</div>
	);
}

function MemberRow({ member }: { member: Member }) {
	const qa = Number(member.qty_assigned) || 0;
	const qd = Number(member.qty_completed) || 0;
	const pct = qa > 0 ? Math.min(100, Math.round((qd / qa) * 100)) : 0;
	const ph = Number(member.planned_hours) || 0;
	const ah = Number(member.actual_hours) || 0;
	return (
		<div className="flex items-center gap-3 bg-white border border-gray-100 rounded-md px-3 py-2 shadow-sm">
			<div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
				<UserIcon className="w-3 h-3 text-gray-500" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-gray-800">
						{member.user_name || `User ${member.user_id}`}
					</span>
					<StatusBadge status={member.status || 'Not Started'} />
				</div>
				{member.remarks && (
					<p className="text-[10px] text-gray-500 line-clamp-1">
						{member.remarks}
					</p>
				)}
			</div>
			<div className="flex items-center gap-4 text-[11px] flex-shrink-0">
				<div className="flex items-center gap-1.5">
					<span className="text-gray-500">Qty</span>
					<span className="font-semibold text-gray-900 tabular-nums">
						{fmtNum(qd)} / {fmtNum(qa)}
					</span>
				</div>
				{(ph > 0 || ah > 0) && (
					<div className="flex items-center gap-1.5">
						<ClockIcon className="w-3 h-3 text-gray-400" />
						<span className="text-gray-700 tabular-nums">
							{fmtMinsHrs(ah)} / {fmtMinsHrs(ph)}
						</span>
					</div>
				)}
				<ProgressBar pct={pct} />
			</div>
		</div>
	);
}

function fmtMinsHrs(m: number): string {
	if (!m) return '0h';
	const h = Math.floor(m / 60);
	const mins = m % 60;
	return mins > 0 ? `${h}h ${mins}m` : `${h}h`;
}

// ── States ───────────────────────────────────────────────────────────

function LoadingState() {
	return (
		<div className="bg-white rounded-xl border border-gray-200 p-14 text-center text-sm text-gray-400">
			<ArrowPathIcon className="w-5 h-5 mx-auto mb-2 animate-spin" />
			Loading project activities…
		</div>
	);
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
	return (
		<div className="bg-white rounded-xl border border-gray-200 p-14 text-center">
			<FolderIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
			<p className="text-sm text-gray-500 font-medium">
				{hasFilters
					? 'No projects match the current filters.'
					: 'No projects with activities yet.'}
			</p>
		</div>
	);
}

function ErrorState({
	message,
	onRetry,
}: {
	message: string;
	onRetry: () => void;
}) {
	return (
		<div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
			<XMarkIcon className="w-10 h-10 mx-auto mb-2 text-red-400" />
			<p className="text-sm font-semibold text-red-700 mb-1">
				Error loading report
			</p>
			<p className="text-sm text-red-500 mb-4">{message}</p>
			<button
				onClick={onRetry}
				className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
			>
				Retry
			</button>
		</div>
	);
}
