/**
 * Admin dashboard summary — the one payload contract between
 * `GET /api/admin/dashboard-summary` and `src/app/admin/dashboard/page.jsx`
 * (ADR-0028).
 *
 * Types only: no runtime code, no DB, so both the route and the client import
 * the same shapes and the contract cannot drift.
 */

/** The dashboard's only time scope: the current calendar month or the last 7 days. */
export type DashboardWindow = 'month' | 'week';

/** `YYYY-MM-DD`, both inclusive. `end` is always today. */
export interface DashboardPeriod {
	start: string;
	end: string;
	/** 'This month' | 'Last 7 days'. */
	label: string;
}

/** Lifetime count plus its week-over-week change (last 7 days minus previous 7). A true zero renders as 0, never hidden. */
export interface DashboardKpiCount {
	total: number;
	delta: number;
}

export interface DashboardKpis {
	leads: DashboardKpiCount;
	proposals: DashboardKpiCount;
	companies: DashboardKpiCount;
	projects: DashboardKpiCount;
}

/** Proposal status buckets. `Rejected` is always present so the total is every proposal in the window. */
export type SalesBucketName = 'Pending' | 'Approved' | 'Draft' | 'Rejected';

export interface DashboardSalesBucket {
	name: SalesBucketName;
	count: number;
	/** Rupees, from `proposals.proposal_value`. */
	value: number;
}

export interface DashboardSales {
	buckets: DashboardSalesBucket[];
	total: { count: number; value: number };
	/** Approved ÷ all proposals in the window, integer percent, per metric. */
	conversion: { count: number; value: number };
	/**
	 * Proposals whose status matches no canonical bucket (for example
	 * `converted`). `total` still counts them, so the four buckets alone do
	 * not foot to the total; `statuses` names them for the disclosure.
	 */
	unmapped: { count: number; value: number; statuses: string[] };
}

export type UtilizationBand = 'under' | 'healthy' | 'over';

export interface DashboardUtilizationRow {
	employeeId: number;
	name: string;
	/** Hours, 2dp. 0 = no timesheet evidence (not a 0% verdict). */
	logged: number;
	/** Hours, 2dp, on the report's capacity calendar. */
	capacity: number;
	/** null = no capacity basis (carried in totals.noCapacity, absent from rows). */
	percent: number | null;
	band: UtilizationBand | null;
}

export interface DashboardUtilizationTotals {
	logged: number;
	capacity: number;
	percent: number | null;
	/** Payroll Roster size for the window. */
	headcount: number;
	/** Employees the roster selector excluded, with reasons disclosed. */
	excluded: number;
	/** Roster rows with no capacity basis (percent null). */
	noCapacity: number;
	/** Roster rows with zero Logged Hours. */
	noLogged: number;
}

export interface DashboardUtilization {
	totals: DashboardUtilizationTotals;
	/** Percent non-null, sorted ascending by percent — the page slices the head and tail for the lowest/highest lists. */
	rows: DashboardUtilizationRow[];
}

/** Top projects by Logged Hours, descending. */
export interface DashboardProjectRow {
	id: string;
	name: string;
	logged: number;
}

export interface DashboardTrendPoint {
	/** Bucket start, `YYYY-MM-DD`. */
	label: string;
	logged: number;
	capacity: number;
	/**
	 * The bucket has not finished: it contains today or crosses the month end.
	 * The chart marks it in progress rather than as a full bar.
	 */
	partial: boolean;
}

export interface DashboardSummary {
	window: DashboardWindow;
	period: DashboardPeriod;
	kpis: DashboardKpis;
	sales: DashboardSales;
	utilization: DashboardUtilization;
	projects: DashboardProjectRow[];
	trend: DashboardTrendPoint[];
}

export interface DashboardSummaryResponse {
	success: true;
	data: DashboardSummary;
	_meta: { queryTimeMs: number };
}

/** Error body shape for non-2xx responses. */
export interface DashboardSummaryError {
	success: false;
	error: string;
}
