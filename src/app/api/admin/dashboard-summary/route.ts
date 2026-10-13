/**
 * GET /api/admin/dashboard-summary?window=month|week
 *
 * The admin dashboard's one payload (ADR-0028): lifetime KPI counts with
 * their week-over-week delta, proposals by status, the Utilization block,
 * the top projects by Logged Hours, and the Logged-versus-Capacity trend.
 * The shapes live in `@/lib/dashboard-summary` — types only, so the route
 * and the client cannot drift apart.
 *
 * Windows:
 * - `month` (the default) is the whole calendar month, read exactly as
 *   `/api/reports/employee-utilization` reads it: the utilization rows, the
 *   project hours and the trend all cover [month-01, month-end], so a
 *   timesheet entry dated later in the month counts, as it does on the
 *   report.
 * - `week` is the rolling last 7 days ending today, on the current month's
 *   Payroll roster — the range lens in the utilization data-source.
 *
 * Access: super admins only. Every hour comes from
 * `user_activity_assignments.daily_entries` and every capacity hour from
 * the payroll capacity calendar; no figure is read from a table nothing
 * writes.
 *
 * Uses pool.execute (via query()) — no long-held connection.
 */

import type Decimal from 'decimal.js';
import { NextResponse } from 'next/server';
import { add, div, isZero, mul, R, toNumber } from '@/lib/money';
import { parseDailyEntries } from '@/lib/logged-hours';
import {
	fetchUtilizationData,
	fetchUtilizationRangeData,
	type UtilizationBucketPoint,
	type UtilizationRow,
	type UtilizationTotals,
} from '@/app/reports/employee-utilization/data-source';
import type { RosterDisclosure } from '@/lib/payroll-roster';
import { projectDisplayName } from '@/app/reports/employee-utilization/project-breakdown';
import {
	dbNum,
	dbStr,
	type DbRow,
} from '@/app/reports/employee-utilization/db-values';
import { getCurrentUser } from '@/utils/api-permissions';
import { query } from '@/utils/database';
import type {
	DashboardKpiCount,
	DashboardKpis,
	DashboardPeriod,
	DashboardProjectRow,
	DashboardSales,
	DashboardSalesBucket,
	DashboardSummary,
	DashboardSummaryResponse,
	DashboardTrendPoint,
	DashboardUtilization,
	DashboardWindow,
	SalesBucketName,
} from '@/lib/dashboard-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The dashboard is polled by one page; 30 s of freshness, a minute of grace. */
const CACHE_CONTROL = 'private, max-age=30, stale-while-revalidate=60';

/** How many projects the list carries. */
const TOP_PROJECTS = 10;

/** The four canonical status buckets, in chart order. */
const SALES_BUCKETS: { status: string; name: SalesBucketName }[] = [
	{ status: 'pending', name: 'Pending' },
	{ status: 'approved', name: 'Approved' },
	{ status: 'draft', name: 'Draft' },
	{ status: 'rejected', name: 'Rejected' },
];

/** The lifetime-count entities, each counted from its own table. */
const KPI_ENTITIES = ['leads', 'proposals', 'companies', 'projects'] as const;

/** Everything both windows' Utilization block needs from the report pipeline. */
interface UtilizationView {
	rows: UtilizationRow[];
	totals: UtilizationTotals;
	disclosure: RosterDisclosure | null;
	trend: UtilizationBucketPoint[];
}

/** A local calendar day as `YYYY-MM-DD` — the server's own day, never the client's. */
function dayString(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

/** Hours at the JSON boundary: 2dp, ROUND_HALF_UP — never a float round. */
function hours2(value: number): number {
	return toNumber(R(value).toDecimalPlaces(2));
}

/** Integer percent of `part` in `whole`, ROUND_HALF_UP; 0 over an empty whole. */
function percentOf(part: Decimal, whole: Decimal): number {
	if (isZero(whole)) return 0;
	return toNumber(div(mul(part, 100), whole).toDecimalPlaces(0));
}

/** A row whose percent is real, so the sort and the map can read it as one. */
function hasPercent(
	row: UtilizationRow
): row is UtilizationRow & { utilization_percent: number } {
	return row.utilization_percent !== null;
}

/** The window's period: the whole calendar month, or the last 7 days. */
function periodFor(dashWindow: DashboardWindow): DashboardPeriod {
	const now = new Date();
	const today = dayString(now);
	if (dashWindow === 'week') {
		const weekStart = new Date(now);
		weekStart.setDate(now.getDate() - 6);
		return { start: dayString(weekStart), end: today, label: 'Last 7 days' };
	}
	const month = today.slice(0, 7);
	// Day 0 of the next month is this month's last day.
	const lastDay = new Date(
		Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)
	).getUTCDate();
	return {
		start: `${month}-01`,
		end: `${month}-${String(lastDay).padStart(2, '0')}`,
		label: 'This month',
	};
}

/**
 * One entity's lifetime count plus its 7-day-over-previous-7 delta: the
 * COUNT(*) and the delta SQL ported from the retired `dashboard-stats` route,
 * so the delta costs no second pass over the table.
 */
async function loadKpiCount(
	entity: (typeof KPI_ENTITIES)[number]
): Promise<DashboardKpiCount> {
	const [rows] = (await query(
		`SELECT COUNT(*) AS total,
		        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS last_7,
		        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
		                 AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS previous_7
		 FROM ${entity}`
	)) as [DbRow[], unknown];
	const row = rows[0] || {};
	return {
		total: dbNum(row, 'total'),
		// A true zero is a real answer and stays 0, never hidden.
		delta: dbNum(row, 'last_7') - dbNum(row, 'previous_7'),
	};
}

async function loadKpis(): Promise<DashboardKpis> {
	const [leads, proposals, companies, projects] = await Promise.all(
		KPI_ENTITIES.map((entity) => loadKpiCount(entity))
	);
	return { leads, proposals, companies, projects };
}

/**
 * Proposals created inside the window, grouped by stored status.
 *
 * The four canonical buckets are zero-filled so the chart always shows all
 * four. `total` counts EVERY proposal in the window: a status outside the
 * four (the database holds `converted`) is counted and priced in `unmapped`
 * and named in `statuses`, so the disclosure can say so rather than let the
 * buckets quietly lose rows. Conversion is approved over that whole total.
 */
async function loadSales(period: DashboardPeriod): Promise<DashboardSales> {
	const [rows] = (await query(
		`SELECT LOWER(COALESCE(status, '')) AS status,
		        COUNT(*) AS count,
		        COALESCE(SUM(COALESCE(proposal_value, 0)), 0) AS amount
		 FROM proposals
		 WHERE created_at BETWEEN ? AND ?
		 GROUP BY LOWER(COALESCE(status, ''))`,
		[`${period.start} 00:00:00`, `${period.end} 23:59:59`]
	)) as [DbRow[], unknown];

	const counts: Record<SalesBucketName, number> = {
		Pending: 0,
		Approved: 0,
		Draft: 0,
		Rejected: 0,
	};
	const values: Record<SalesBucketName, Decimal> = {
		Pending: R(0),
		Approved: R(0),
		Draft: R(0),
		Rejected: R(0),
	};
	let unmappedCount = 0;
	let unmappedValue = R(0);
	const unmappedStatuses = new Set<string>();

	for (const row of rows) {
		const status = dbStr(row, 'status').toLowerCase();
		const count = dbNum(row, 'count');
		// Rupees arrive as DECIMAL strings; the money module owns the parse.
		const value = R(dbStr(row, 'amount'));
		const bucket = SALES_BUCKETS.find((entry) => entry.status === status);
		if (!bucket) {
			unmappedCount += count;
			unmappedValue = add(unmappedValue, value);
			if (status) unmappedStatuses.add(status);
			continue;
		}
		counts[bucket.name] += count;
		values[bucket.name] = add(values[bucket.name], value);
	}

	const buckets: DashboardSalesBucket[] = SALES_BUCKETS.map(({ name }) => ({
		name,
		count: counts[name],
		value: toNumber(values[name]),
	}));
	let totalValue = unmappedValue;
	for (const bucket of buckets)
		totalValue = add(totalValue, values[bucket.name]);
	const totalCount =
		buckets.reduce((sum, bucket) => sum + bucket.count, 0) + unmappedCount;

	return {
		buckets,
		total: { count: totalCount, value: toNumber(totalValue) },
		conversion: {
			count: percentOf(R(counts.Approved), R(totalCount)),
			value: percentOf(values.Approved, totalValue),
		},
		unmapped: {
			count: unmappedCount,
			value: toNumber(unmappedValue),
			statuses: [...unmappedStatuses].sort(),
		},
	};
}

/**
 * The top projects by Logged Hours in the window, from the assignments'
 * `daily_entries`. An assignment whose project row no longer resolves, or
 * that carries no project at all, has no id or name to list and is skipped;
 * a project with nothing logged in the window is dropped rather than shown
 * as a zero row.
 */
async function loadProjects(
	period: DashboardPeriod
): Promise<DashboardProjectRow[]> {
	const [rows] = (await query(
		`SELECT uaa.project_id, uaa.daily_entries,
		        p.project_code, p.project_title, p.name AS project_name
		 FROM user_activity_assignments uaa
		 LEFT JOIN projects p ON p.project_id = uaa.project_id AND p.isDelete = 0
		 WHERE uaa.status <> 'Cancelled'
		   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')
		   AND uaa.project_id IS NOT NULL`
	)) as [DbRow[], unknown];

	const hours = new Map<string, Decimal>();
	const names = new Map<string, string>();
	for (const row of rows) {
		const projectId = dbNum(row, 'project_id');
		if (projectId <= 0) continue;
		let total = R(0);
		for (const entry of parseDailyEntries(row.daily_entries)) {
			if (entry.date < period.start || entry.date > period.end) continue;
			total = add(total, entry.hours);
		}
		if (isZero(total)) continue;
		const key = String(projectId);
		hours.set(key, add(hours.get(key) ?? R(0), total));
		names.set(
			key,
			projectDisplayName({
				project_id: projectId,
				project_title: dbStr(row, 'project_title'),
				project_name: dbStr(row, 'project_name'),
				project_code: dbStr(row, 'project_code'),
			})
		);
	}

	return [...hours.entries()]
		.map(([id, total]) => ({
			id,
			name: names.get(id) ?? '',
			logged: toNumber(total.toDecimalPlaces(2)),
		}))
		.sort((a, b) => b.logged - a.logged || a.name.localeCompare(b.name))
		.slice(0, TOP_PROJECTS);
}

/**
 * The Utilization block, plus the window's trend buckets, from the report
 * pipeline. The month window reads the report month as-is; the week window
 * reads the range lens over the same calendar, so a week can never disagree
 * with the month it reaches into.
 */
async function loadUtilization(
	dashWindow: DashboardWindow,
	period: DashboardPeriod
): Promise<UtilizationView> {
	if (dashWindow === 'week') {
		const range = await fetchUtilizationRangeData(
			period.start,
			period.end,
			period.start,
			period.end
		);
		// The period is always a pair of real days in order, so the range lens
		// cannot reject it; a null here is a contract break, not an empty
		// window.
		if (!range) {
			throw new Error('Utilization range lens rejected the week window');
		}
		return {
			rows: range.rows,
			totals: range.totals,
			disclosure: range.disclosure,
			trend: range.hours_trend,
		};
	}
	const month = period.start.slice(0, 7);
	const data = await fetchUtilizationData(month);
	if (!data) {
		throw new Error(`Utilization report returned no data for ${month}`);
	}
	return {
		rows: data.rows,
		totals: data.totals,
		disclosure: data.disclosure,
		trend: data.hours_trend,
	};
}

/**
 * Map the report's rows onto the contract. A roster row with no capacity
 * basis has no percent to rank, so it is counted in `noCapacity` and kept
 * off `rows`; `rows` then reads ascending by percent, which is what the
 * page's lowest and highest lists slice.
 */
function toDashboardUtilization(view: UtilizationView): DashboardUtilization {
	const rated = view.rows.filter(hasPercent);
	return {
		totals: {
			logged: hours2(view.totals.logged_hours),
			capacity: hours2(view.totals.capacity_hours),
			percent: view.totals.utilization_percent,
			headcount: view.totals.employee_count,
			excluded: view.disclosure?.excluded_count ?? 0,
			noCapacity: view.rows.length - rated.length,
			noLogged: view.totals.no_logged_count,
		},
		rows: rated
			.sort(
				(a, b) =>
					a.utilization_percent - b.utilization_percent ||
					a.employee_name.localeCompare(b.employee_name) ||
					a.employee_id - b.employee_id
			)
			.map((row) => ({
				employeeId: row.employee_id,
				name: row.employee_name,
				logged: hours2(row.logged_hours),
				capacity: hours2(row.capacity_hours),
				percent: row.utilization_percent,
				band: row.utilization_band,
			})),
	};
}

function toDashboardTrend(
	points: UtilizationBucketPoint[]
): DashboardTrendPoint[] {
	return points.map((point) => ({
		label: point.label,
		logged: hours2(point.logged),
		capacity: hours2(point.capacity),
		partial: point.partial,
	}));
}

export async function GET(request: Request) {
	const startedAt = Date.now();

	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}
	// The dashboard is the cross-domain view, so it stays super-admin only.
	if (user.is_super_admin !== true && user.is_super_admin !== 1) {
		return NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
	}

	const requested = new URL(request.url).searchParams.get('window');
	const dashWindow = requested === null ? 'month' : requested;
	if (dashWindow !== 'month' && dashWindow !== 'week') {
		return NextResponse.json(
			{
				success: false,
				error: `Unknown window '${dashWindow}' (expected month or week)`,
			},
			{ status: 400 }
		);
	}

	const period = periodFor(dashWindow);
	try {
		const [kpis, sales, projects, utilization] = await Promise.all([
			loadKpis(),
			loadSales(period),
			loadProjects(period),
			loadUtilization(dashWindow, period),
		]);
		const data: DashboardSummary = {
			window: dashWindow,
			period,
			kpis,
			sales,
			utilization: toDashboardUtilization(utilization),
			projects,
			trend: toDashboardTrend(utilization.trend),
		};
		const body: DashboardSummaryResponse = {
			success: true,
			data,
			_meta: { queryTimeMs: Date.now() - startedAt },
		};
		return NextResponse.json(body, {
			headers: { 'Cache-Control': CACHE_CONTROL },
		});
	} catch (error: unknown) {
		// A failed fetch must not look like an empty database (ADR-0028), so
		// the error is a 500 the page shows, never a payload of zeroes.
		console.error('Dashboard summary error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to load the dashboard summary' },
			{ status: 500 }
		);
	}
}
