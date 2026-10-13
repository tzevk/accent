'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { fetchJSON } from '@/utils/http';
import { useSession } from '@/context/SessionContext';
import { formatDate, formatNumber } from '@/lib/format.js';
import {
	UserGroupIcon,
	DocumentTextIcon,
	BuildingOfficeIcon,
	FolderIcon,
	MagnifyingGlassIcon,
	ClockIcon,
	CheckCircleIcon,
	ExclamationTriangleIcon,
	PlayIcon,
	EyeIcon,
	ArrowPathIcon,
	ArrowUpIcon,
	ArrowDownIcon,
} from '@heroicons/react/24/outline';
import UpcomingFollowups from '@/components/dashboard/UpcomingFollowups';
import LoggedHoursTrend from '@/components/dashboard/LoggedHoursTrend';
import ProjectsChart from '@/components/dashboard/ProjectsChart';
import SalesAnalytics from '@/components/dashboard/SalesAnalytics';

/**
 * The payload's shape is `DashboardSummary` from `@/lib/dashboard-summary`
 * (ADR-0028) — the same module the route imports, so the client and the
 * server cannot drift. A `.jsx` page carries the type in JSDoc rather than an
 * import the transpiler would have to elide.
 *
 * @typedef {import('@/lib/dashboard-summary').DashboardSummary} DashboardSummary
 * @typedef {import('@/lib/dashboard-summary').DashboardWindow} DashboardWindow
 */

/** Counts are whole numbers; `formatNumber` prints their 2dp tail. */
function groupedCount(value) {
	return formatNumber(value).replace(/\.00$/, '');
}

const WINDOW_OPTIONS = [
	{ value: 'month', label: 'This month' },
	{ value: 'week', label: 'Last 7 days' },
];

const KPI_CARDS = [
	{
		key: 'leads',
		title: 'Total leads',
		hint: 'View leads',
		href: '/leads',
		Icon: UserGroupIcon,
	},
	{
		key: 'proposals',
		title: 'Proposals',
		hint: 'View proposals',
		href: '/proposals',
		Icon: DocumentTextIcon,
	},
	{
		key: 'companies',
		title: 'Companies',
		hint: 'View companies',
		href: '/company',
		Icon: BuildingOfficeIcon,
	},
	{
		key: 'projects',
		title: 'Projects',
		hint: 'View projects',
		href: '/projects',
		Icon: FolderIcon,
	},
];

/**
 * Utilization bands on the same thresholds the Employee Utilization report
 * uses (ADR-0028). The row bands arrive on the payload; the totals carry only
 * a percent, so this derives theirs rather than inventing a second reading.
 */
function bandForPercent(percent) {
	if (percent === null || percent === undefined || !Number.isFinite(percent))
		return null;
	if (percent < 80) return 'under';
	if (percent <= 100) return 'healthy';
	return 'over';
}

const BAND_CHIP = {
	under: {
		label: 'Under',
		className: 'bg-amber-100 text-amber-800',
		Icon: ArrowDownIcon,
	},
	healthy: {
		label: 'Healthy',
		className: 'bg-green-100 text-green-800',
		Icon: CheckCircleIcon,
	},
	over: {
		label: 'Over',
		className: 'bg-red-100 text-red-800',
		Icon: ArrowUpIcon,
	},
};

/**
 * A band reading as a chip: the word and the icon carry the meaning, so the
 * colour is a third cue rather than the only one (ADR-0027).
 */
function BandChip({ band, logged }) {
	if (logged === 0) {
		return (
			<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
				No hours logged
			</span>
		);
	}
	if (!band) {
		return (
			<span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
				No capacity
			</span>
		);
	}
	const { label, className, Icon } = BAND_CHIP[band];
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
		>
			<Icon className="h-3.5 w-3.5" aria-hidden="true" />
			{label}
		</span>
	);
}

/**
 * The week-over-week change on a lifetime count: sign plus arrow plus colour,
 * and a true zero renders as 0 rather than hiding.
 */
function DeltaChip({ delta }) {
	const tone =
		delta > 0
			? 'bg-green-50 text-green-700'
			: delta < 0
				? 'bg-red-50 text-red-700'
				: 'bg-gray-50 text-gray-600';
	const Arrow = delta > 0 ? ArrowUpIcon : delta < 0 ? ArrowDownIcon : null;
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
		>
			{Arrow && <Arrow className="h-3.5 w-3.5" aria-hidden="true" />}
			<span className="tabular-nums">
				{delta > 0 ? `+${groupedCount(delta)}` : groupedCount(delta)}
			</span>
			this week
		</span>
	);
}

function KpiSkeleton() {
	return (
		<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:gap-6">
			{[...Array(4)].map((_, index) => (
				<div
					key={index}
					className="rounded-xl border border-purple-200 bg-white p-5 xl:p-6"
				>
					<div
						data-motion
						className="mb-3 h-10 w-10 animate-pulse rounded-lg bg-gray-100 xl:h-12 xl:w-12"
					/>
					<div
						data-motion
						className="mb-2 h-4 w-24 animate-pulse rounded bg-gray-100"
					/>
					<div
						data-motion
						className="h-8 w-16 animate-pulse rounded bg-gray-100"
					/>
				</div>
			))}
		</div>
	);
}

function UtilizationSkeleton() {
	return (
		<div className="mb-6 rounded-xl border border-purple-200 bg-white p-6 xl:mb-8">
			<div
				data-motion
				className="mb-4 h-5 w-40 animate-pulse rounded bg-gray-100"
			/>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				{[...Array(3)].map((_, index) => (
					<div
						key={index}
						data-motion
						className="h-24 animate-pulse rounded-lg bg-gray-100"
					/>
				))}
			</div>
			<div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
				{[...Array(2)].map((_, column) => (
					<div key={column} className="space-y-2">
						<div
							data-motion
							className="h-4 w-32 animate-pulse rounded bg-gray-100"
						/>
						{[...Array(5)].map((_, row) => (
							<div
								key={row}
								data-motion
								className="h-8 animate-pulse rounded bg-gray-100"
							/>
						))}
					</div>
				))}
			</div>
		</div>
	);
}

/** Four lifetime CRM counts, each with its week-over-week change. */
function KpiCards({ kpis }) {
	return (
		<div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:mb-8 xl:gap-6">
			{KPI_CARDS.map((card) => {
				const kpi = kpis[card.key];
				return (
					<Link
						key={card.key}
						href={card.href}
						className="group block rounded-xl border border-purple-200 bg-white p-5 transition-all hover:border-purple-400 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] xl:p-6"
					>
						<div className="mb-3 flex items-start justify-between gap-2">
							<span className="flex h-10 w-10 items-center justify-center rounded-lg border border-purple-200 xl:h-12 xl:w-12">
								<card.Icon
									className="h-5 w-5 text-[#64126D] xl:h-6 xl:w-6"
									aria-hidden="true"
								/>
							</span>
							<DeltaChip delta={kpi.delta} />
						</div>
						<div className="mb-1 text-xs font-medium tracking-wider text-gray-500 xl:text-sm">
							{card.title}
						</div>
						<div className="text-2xl font-bold tabular-nums text-gray-900 xl:text-3xl">
							{groupedCount(kpi.total)}
						</div>
						<div className="mt-2 text-xs text-[#64126D] group-hover:underline xl:text-sm">
							{card.hint} <span aria-hidden="true">→</span>
						</div>
					</Link>
				);
			})}
		</div>
	);
}

/** One utilization figure row: the name, its hours, and its band reading. */
function UtilizationRowLine({ row }) {
	return (
		<li className="flex items-center justify-between gap-3 py-2">
			<span className="truncate text-sm font-medium text-gray-700">
				{row.name}
			</span>
			<span className="flex shrink-0 items-center gap-2">
				<span className="text-sm tabular-nums text-gray-700">
					{formatNumber(row.logged)} h
				</span>
				{row.percent === null ? null : (
					<span className="text-sm font-semibold tabular-nums text-gray-900">
						{formatNumber(row.percent)}%
					</span>
				)}
				<BandChip band={row.band} logged={row.logged} />
			</span>
		</li>
	);
}

/**
 * The Utilization block: the window's totals, the five lowest and five highest
 * readings on the roster, and — behind a native `<details>` — the exclusions
 * the roster selector made, so the totals and the lists reconcile.
 */
function UtilizationSection({ utilization, period, window }) {
	const { totals, rows } = utilization;
	const lowest = rows.slice(0, 5);
	const highest = rows.length > 5 ? rows.slice(-5) : [];
	const band = bandForPercent(totals.percent);

	return (
		<div className="mb-6 rounded-xl border border-purple-200 bg-white p-6 xl:mb-8">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-lg font-semibold text-gray-900">Utilization</h2>
					<p className="mt-0.5 text-sm text-gray-500">
						{period.label} · {formatDate(period.start)} –{' '}
						{formatDate(period.end)}
					</p>
				</div>
				<Link
					href="/reports/employee-utilization"
					className="inline-flex items-center rounded text-sm font-medium text-[#64126D] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]"
				>
					View full Utilization report <span aria-hidden="true">→</span>
				</Link>
			</div>

			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<div className="rounded-lg border border-gray-200 p-4">
					<div className="mb-1 flex items-center gap-2">
						<ClockIcon className="h-4 w-4 text-[#64126D]" aria-hidden="true" />
						<span className="text-xs font-medium text-gray-500">
							Logged Hours
						</span>
					</div>
					<p className="text-2xl font-bold tabular-nums text-gray-900">
						{formatNumber(totals.logged)}
					</p>
					{totals.logged === 0 && (
						<p className="mt-1 text-xs text-gray-500">No hours logged</p>
					)}
				</div>
				<div className="rounded-lg border border-gray-200 p-4">
					<div className="mb-1 flex items-center gap-2">
						<ClockIcon className="h-4 w-4 text-[#64126D]" aria-hidden="true" />
						<span className="text-xs font-medium text-gray-500">Capacity</span>
					</div>
					<p className="text-2xl font-bold tabular-nums text-gray-900">
						{formatNumber(totals.capacity)}
					</p>
					<p className="mt-1 text-xs text-gray-500">
						{groupedCount(totals.headcount)} on the roster
					</p>
				</div>
				<div className="rounded-lg border border-gray-200 p-4">
					<div className="mb-1 flex items-center justify-between gap-2">
						<span className="text-xs font-medium text-gray-500">
							Utilization
						</span>
						<BandChip band={band} logged={totals.logged} />
					</div>
					<p className="text-2xl font-bold tabular-nums text-gray-900">
						{totals.percent === null ? '—' : `${formatNumber(totals.percent)}%`}
					</p>
					{totals.logged === 0 && (
						<p className="mt-1 text-xs text-gray-500">No hours logged</p>
					)}
				</div>
			</div>

			{window === 'month' && (
				<p className="mt-3 text-xs text-gray-500">
					Figures cover the full calendar month, including timesheet entries
					dated later in the month — the same reading as the Utilization report.
				</p>
			)}

			<div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
				<div>
					<h3 className="mb-1 text-sm font-semibold text-gray-700">
						Lowest utilization
					</h3>
					<ul className="divide-y divide-gray-100">
						{lowest.map((row) => (
							<UtilizationRowLine key={row.employeeId} row={row} />
						))}
					</ul>
				</div>
				<div>
					<h3 className="mb-1 text-sm font-semibold text-gray-700">
						Highest utilization
					</h3>
					{highest.length > 0 ? (
						<ul className="divide-y divide-gray-100">
							{highest.map((row) => (
								<UtilizationRowLine key={row.employeeId} row={row} />
							))}
						</ul>
					) : (
						<p className="py-2 text-sm text-gray-500">
							The roster&rsquo;s whole reading is the lowest list —{' '}
							{groupedCount(rows.length)} employees have a utilization reading.
						</p>
					)}
				</div>
			</div>

			<details className="mt-5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
				<summary className="cursor-pointer text-sm font-medium text-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D]">
					Roster exclusions and coverage
				</summary>
				<dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
					<div className="flex justify-between gap-3 text-sm">
						<dt className="text-gray-600">On the roster</dt>
						<dd className="font-medium tabular-nums text-gray-900">
							{groupedCount(totals.headcount)}
						</dd>
					</div>
					<div className="flex justify-between gap-3 text-sm">
						<dt className="text-gray-600">Excluded by the roster selector</dt>
						<dd className="font-medium tabular-nums text-gray-900">
							{groupedCount(totals.excluded)}
						</dd>
					</div>
					<div className="flex justify-between gap-3 text-sm">
						<dt className="text-gray-600">No capacity basis</dt>
						<dd className="font-medium tabular-nums text-gray-900">
							{groupedCount(totals.noCapacity)}
						</dd>
					</div>
					<div className="flex justify-between gap-3 text-sm">
						<dt className="text-gray-600">Logged no hours</dt>
						<dd className="font-medium tabular-nums text-gray-900">
							{groupedCount(totals.noLogged)}
						</dd>
					</div>
				</dl>
			</details>
		</div>
	);
}

/**
 * Admin Dashboard - Protected route
 *
 * Uses SessionContext for consistent auth state.
 * Redirects non-super-admins to user dashboard.
 */
export default function AdminDashboard() {
	const router = useRouter();
	const { user, loading: sessionLoading, authenticated } = useSession();

	// Protection state
	const [isAuthorized, setIsAuthorized] = useState(false);

	// Dashboard data states — one payload, one fetch (ADR-0028).
	/** @type {[DashboardWindow, (value: DashboardWindow) => void]} */
	const [activeWindow, setActiveWindow] = useState('month');
	/** @type {[DashboardSummary | null, (value: DashboardSummary | null) => void]} */
	const [summary, setSummary] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);

	const loadSummary = useCallback(async (activeWindow, refresh = false) => {
		setLoading(true);
		setError(null);
		try {
			const url = `/api/admin/dashboard-summary?window=${activeWindow}${refresh ? '&nocache=1' : ''}`;
			const res = refresh
				? await fetchJSON(url, { cache: 'no-store' })
				: await fetchJSON(url);
			setSummary(res.data);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: 'Unable to load the dashboard summary.'
			);
		} finally {
			setLoading(false);
		}
	}, []);

	// Authorize once the session answers, then read the summary for the
	// active window — a window change is a new read of the same route.
	useEffect(() => {
		if (sessionLoading) return;
		if (!authenticated || !user) return;

		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		if (!isSuperAdmin) {
			router.replace('/user/dashboard');
			return;
		}

		setIsAuthorized(true);
		loadSummary(activeWindow);
	}, [sessionLoading, authenticated, user, router, activeWindow, loadSummary]);

	// PROTECTION: While checking, show ONLY loader - no admin UI
	if (sessionLoading || !isAuthorized) {
		return (
			<LoadingSpinner
				message="Loading Admin Dashboard"
				subMessage="Verifying permissions..."
			/>
		);
	}

	// Only render admin dashboard UI after authorization is confirmed
	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
			<Navbar />

			<main
				className="px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 xl:py-8 max-w-full mx-auto"
				aria-busy={loading}
			>
				{/* A stable live region so each read is announced once. */}
				<p role="status" className="sr-only">
					{loading ? 'Loading dashboard summary' : ''}
				</p>

				{/* Header */}
				<div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between xl:mb-8">
					<div>
						<nav
							className="mb-1 text-xs text-gray-500 xl:text-sm"
							aria-label="Breadcrumb"
						>
							<ol className="inline-flex items-center gap-2">
								<li>Home</li>
								<li className="text-gray-300">/</li>
								<li className="text-gray-700">Admin Dashboard</li>
							</ol>
						</nav>
						<h1 className="text-3xl font-bold text-gray-900 xl:text-4xl">
							Admin Dashboard
						</h1>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<div
							role="group"
							aria-label="Dashboard window"
							className="inline-flex rounded-lg border border-purple-200 bg-white p-1"
						>
							{WINDOW_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									aria-pressed={activeWindow === option.value}
									onClick={() => setActiveWindow(option.value)}
									className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] ${
										activeWindow === option.value
											? 'bg-[#64126D] text-white'
											: 'text-gray-700 hover:bg-purple-50'
									}`}
								>
									{option.label}
								</button>
							))}
						</div>
						<button
							type="button"
							onClick={() => loadSummary(activeWindow, true)}
							disabled={loading}
							className="inline-flex items-center gap-2 rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm font-medium text-[#64126D] transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#64126D] disabled:cursor-not-allowed disabled:opacity-60"
						>
							<ArrowPathIcon
								data-motion
								className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
								aria-hidden="true"
							/>
							Refresh
						</button>
					</div>
				</div>

				{error && (
					<div
						role="alert"
						className="mb-6 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
					>
						<div className="flex items-start gap-2">
							<ExclamationTriangleIcon
								className="mt-0.5 h-5 w-5 shrink-0 text-red-700"
								aria-hidden="true"
							/>
							<div>
								<p className="text-sm font-semibold text-red-900">
									Unable to load the dashboard summary
								</p>
								<p className="mt-0.5 text-sm text-red-800">{error}</p>
							</div>
						</div>
						<button
							type="button"
							onClick={() => loadSummary(activeWindow, true)}
							className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-800 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
						>
							Try again
						</button>
					</div>
				)}

				{/* CRM counts */}
				{summary ? <KpiCards kpis={summary.kpis} /> : <KpiSkeleton />}

				{/* Utilization */}
				{summary ? (
					<UtilizationSection
						utilization={summary.utilization}
						period={summary.period}
						window={activeWindow}
					/>
				) : (
					<UtilizationSkeleton />
				)}

				{/* Charts: trend, projects, sales */}
				<div className="mb-6 grid grid-cols-1 gap-6 xl:mb-8 xl:gap-8 lg:grid-cols-3">
					<LoggedHoursTrend
						points={summary ? summary.trend : []}
						window={activeWindow}
						loading={!summary}
					/>
					<ProjectsChart
						projects={summary ? summary.projects : []}
						loading={!summary}
					/>
					<SalesAnalytics
						sales={summary ? summary.sales : null}
						loading={!summary}
					/>
				</div>

				{/* Follow-ups Section */}
				<div className="mb-6">
					<UpcomingFollowups limit={8} />
				</div>

				{/* Projects Overview */}
				<AdminProjectsOverview />
			</main>
		</div>
	);
}

// Admin Projects Overview Component
function AdminProjectsOverview() {
	const [projects, setProjects] = useState([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState('');
	const [statusFilter, setStatusFilter] = useState('all');

	useEffect(() => {
		const fetchProjects = async () => {
			try {
				const res = await fetch('/api/projects?limit=100');
				const data = await res.json();
				if (data.success) {
					setProjects(data.data || []);
				}
			} catch (error) {
				console.error('Error fetching projects:', error);
			} finally {
				setLoading(false);
			}
		};
		fetchProjects();
	}, []);

	const getStatusInfo = (status) => {
		const s = String(status || '').toLowerCase();
		if (s.includes('completed') || s.includes('done'))
			return {
				label: 'Completed',
				color: 'bg-green-100 text-green-700 border-green-200',
				icon: CheckCircleIcon,
			};
		if (s.includes('progress') || s.includes('active') || s.includes('ongoing'))
			return {
				label: 'In Progress',
				color: 'bg-blue-100 text-blue-700 border-blue-200',
				icon: PlayIcon,
			};
		if (s.includes('hold') || s.includes('paused'))
			return {
				label: 'On Hold',
				color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
				icon: ExclamationTriangleIcon,
			};
		if (s.includes('planning') || s.includes('pending') || s.includes('new'))
			return {
				label: 'Planning',
				color: 'bg-purple-100 text-purple-700 border-purple-200',
				icon: ClockIcon,
			};
		return {
			label: status || 'Unknown',
			color: 'bg-gray-100 text-gray-700 border-gray-200',
			icon: FolderIcon,
		};
	};

	const formatDate = (d) => {
		if (!d) return '-';
		const dt = new Date(d);
		if (isNaN(dt.getTime())) return '-';
		return dt.toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
		});
	};

	const filteredProjects = projects.filter((p) => {
		const matchesSearch =
			!searchQuery ||
			(p.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
			(p.client_name || '').toLowerCase().includes(searchQuery.toLowerCase());
		const matchesStatus =
			statusFilter === 'all' ||
			String(p.status || '')
				.toLowerCase()
				.includes(statusFilter.toLowerCase());
		return matchesSearch && matchesStatus;
	});

	const stats = {
		total: projects.length,
		inProgress: projects.filter((p) =>
			String(p.status || '')
				.toLowerCase()
				.includes('progress')
		).length,
		completed: projects.filter((p) =>
			String(p.status || '')
				.toLowerCase()
				.includes('completed')
		).length,
		onHold: projects.filter((p) =>
			String(p.status || '')
				.toLowerCase()
				.includes('hold')
		).length,
	};

	if (loading) {
		return (
			<div className="bg-white rounded-xl border border-purple-200 overflow-hidden mb-6">
				<div className="px-6 py-4 border-b border-purple-200">
					<div className="h-6 w-48 bg-gray-200 rounded animate-pulse"></div>
				</div>
				<div className="p-6">
					<div className="space-y-3">
						{[...Array(5)].map((_, i) => (
							<div
								key={i}
								className="h-16 bg-gray-100 rounded animate-pulse"
							></div>
						))}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="bg-white rounded-xl border border-purple-200 overflow-hidden mb-6">
			<div className="px-6 py-4 border-b border-purple-200">
				<div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
					<div>
						<h3 className="text-lg font-semibold text-gray-900">
							All Projects
						</h3>
						<p className="text-sm text-gray-500 mt-0.5">
							{stats.total} total • {stats.inProgress} active •{' '}
							{stats.completed} completed • {stats.onHold} on hold
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<div className="relative">
							<MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
							<input
								type="text"
								placeholder="Search projects..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400 w-48"
							/>
						</div>
						<select
							value={statusFilter}
							onChange={(e) => setStatusFilter(e.target.value)}
							className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-300 focus:border-purple-400"
						>
							<option value="all">All Status</option>
							<option value="progress">In Progress</option>
							<option value="completed">Completed</option>
							<option value="hold">On Hold</option>
						</select>
					</div>
				</div>
			</div>

			<div className="overflow-x-auto">
				<table className="min-w-full text-sm">
					<thead className="bg-gray-50 border-b border-gray-200">
						<tr>
							<th className="px-4 py-3 text-left font-semibold text-gray-600 w-10">
								#
							</th>
							<th className="px-4 py-3 text-left font-semibold text-gray-600">
								Project
							</th>
							<th className="px-4 py-3 text-left font-semibold text-gray-600">
								Client
							</th>
							<th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">
								Status
							</th>
							<th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">
								Start Date
							</th>
							<th className="px-4 py-3 text-left font-semibold text-gray-600 w-28">
								Deadline
							</th>
							<th className="px-4 py-3 text-center font-semibold text-gray-600 w-20">
								Action
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-gray-100">
						{filteredProjects.length === 0 ? (
							<tr>
								<td
									colSpan={7}
									className="px-4 py-12 text-center text-gray-500"
								>
									<FolderIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
									<p className="font-medium">No projects found</p>
								</td>
							</tr>
						) : (
							filteredProjects.slice(0, 20).map((project, index) => {
								const statusInfo = getStatusInfo(project.status);
								const StatusIcon = statusInfo.icon;

								return (
									<tr
										key={project.project_id}
										className="hover:bg-purple-50/40 transition-colors"
									>
										<td className="px-4 py-3 text-gray-500 font-medium">
											{index + 1}
										</td>
										<td className="px-4 py-3">
											<Link
												href={`/projects/${project.project_id}/edit`}
												className="font-medium text-gray-900 hover:text-[#64126D] hover:underline"
											>
												{project.name || 'Untitled Project'}
											</Link>
										</td>
										<td className="px-4 py-3 text-gray-700">
											{project.client_name || '-'}
										</td>
										<td className="px-4 py-3">
											<span
												className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`}
											>
												<StatusIcon className="h-3.5 w-3.5" />
												{statusInfo.label}
											</span>
										</td>
										<td className="px-4 py-3 text-gray-600 text-sm">
											{formatDate(project.start_date)}
										</td>
										<td className="px-4 py-3 text-gray-600 text-sm">
											{formatDate(project.end_date)}
										</td>
										<td className="px-4 py-3 text-center">
											<Link
												href={`/projects/${project.project_id}/edit`}
												className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-[#64126D] hover:bg-purple-100 transition-colors"
											>
												<EyeIcon className="h-4 w-4" />
											</Link>
										</td>
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>

			{filteredProjects.length > 20 && (
				<div className="px-6 py-3 border-t border-gray-200 bg-gray-50 text-sm text-gray-600 flex items-center justify-between">
					<span>Showing 20 of {filteredProjects.length} projects</span>
					<Link
						href="/projects"
						className="text-[#64126D] font-medium hover:underline"
					>
						View all projects →
					</Link>
				</div>
			)}
		</div>
	);
}
