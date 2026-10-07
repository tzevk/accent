/**
 * Server-side data fetch + pure transforms for the Employee Project Monthly Cost
 * report — company-wide view of monthly cost across all projects and all employees.
 *
 * Shared by:
 *   - GET /api/reports/employee-project-monthly-cost          (JSON, route.ts)
 *   - GET /api/reports/employee-project-monthly-cost/download (Excel, download/route.ts)
 *
 * Two viewing modes:
 * 1. Monthly (YYYY-MM): total cost to company for a single month, broken down
 *    per employee-project, per employee, and per project, with company totals.
 * 2. FY Annual (FY YYYY Apr-Mar): 12-month matrix per employee / project,
 *    with monthly company totals and FY grand totals.
 *
 * Legacy per-employee FY view is retained for backward compatibility:
 *   fetchEmployeeProjectCost(employeeId, fyYear) etc.
 *
 * Calculation (mirrors the Manhours Billing report's conventions):
 * - Hours: `user_activity_assignments.daily_entries` timesheet logs (the same
 *   source behind ProjectActivityAssignments.jsx), bucketed into calendar months.
 * - Employee cost comes from the shared financial interpretation
 *   (`@/lib/company-expenditure`, #307/ADR-0016): recorded employer-cost
 *   allocations frozen at Payroll Finalize where they exist, the corrected
 *   payroll calculation's estimate otherwise. The obsolete Gross-first
 *   billing-derived rate × hours path is no longer used by these views.
 */

import type Decimal from 'decimal.js';
import { query } from '@/utils/database';
import { R, mul, add, div, toNumber } from '@/lib/money';
import {
	FY_MONTHS,
	FY_MONTH_KEYS,
	fyKeyToCalendarMonthMap,
	getFinancialYear,
	formatFyLabel,
	computeRawHourlyRate,
	resolveHourlyRate,
	pickActiveProfile,
	type SalaryProfile,
} from '@/app/reports/manhours-billing/data-source';
import { parseDailyEntries, parseDailyEntryRecords } from '@/lib/logged-hours';
import {
	loadPayrollMonth,
	type CoverageNotice,
	type PayrollEmployeeCost,
	type PayrollExpenditure,
} from '@/lib/company-expenditure';

export { FY_MONTHS, FY_MONTH_KEYS, getFinancialYear, formatFyLabel };

// ─── Public types ───────────────────────────────────────────────────

export interface CostEmployee {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	designation: string | null;
}

export interface FinancialYearOption {
	year: number; // e.g. 2026 for FY 2026–27
	label: string; // e.g. "FY 2026–27"
}

/** Legacy meta: Employees + FY options for the filter bar. */
export interface CostMeta {
	employees: CostEmployee[];
	financial_years: FinancialYearOption[];
	current_fy: number;
}

/** New company-wide meta: months + FY options for the filter bar. */
export interface CompanyCostMeta {
	financial_years: FinancialYearOption[];
	current_fy: number;
	months: string[]; // YYYY-MM sorted desc
	latest_month: string | null;
	current_month: string; // current calendar month YYYY-MM
}

export interface ProjectCostRow {
	sr_no: number;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	/** Display hourly rate (2dp) from the profile active at FY start (Apr). */
	hourly_rate: number;
	/** Hours logged per FY month key (apr…mar). */
	monthly_hours: Record<string, number>;
	/** Cost per FY month key = rate(active profile for that month) × hours. */
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
}

export interface ProjectCostTotals {
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	/** total_cost ÷ total_hours — the employee's blended rate for the FY. */
	blended_rate: number;
}

export interface EmployeeProjectCostData {
	employee: CostEmployee | null;
	fy_label: string;
	fy_year: number;
	months: string[];
	month_keys: string[];
	rows: ProjectCostRow[];
	totals: ProjectCostTotals;
}

// ─── New company-wide types ─────────────────────────────────────────

export interface CompanyProjectCostRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hourly_rate: number; // display rate at FY start for that employee
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
}

export interface CompanyEmployeeFYRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	hourly_rate: number;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	project_count: number;
}

export interface CompanyProjectFYRow {
	sr_no: number;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	employee_count: number;
}

export interface CompanyCostTotals {
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	/** Recorded employer-cost allocation portion, where the month had one. */
	recorded_cost?: number;
	/** Payroll-based estimate portion. */
	estimated_cost?: number;
	blended_rate: number;
}

export interface FYCompanyCostData {
	fy_label: string;
	fy_year: number;
	months: string[]; // Apr..Mar display
	month_keys: string[]; // apr..mar
	rows: CompanyProjectCostRow[]; // detailed per employee-project
	employee_rows: CompanyEmployeeFYRow[];
	project_rows: CompanyProjectFYRow[];
	totals: CompanyCostTotals;
	summary: {
		total_hours: number;
		total_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
}

export interface MonthlyCompanyCostRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	hourly_rate: number;
	hours: number;
	cost: number;
	/** How this row's cost is known (#307): recorded, estimated, or unknown. */
	cost_status: EmployeeCostStatus;
	/** Recorded employer-cost allocation portion. */
	recorded_cost: number;
	/** Payroll-based estimate portion. */
	estimated_cost: number;
}

export interface MonthlyCompanyCostData {
	month: string; // YYYY-MM
	month_label: string;
	fy_label: string;
	fy_year: number;
	rows: MonthlyCompanyCostRow[];
	employee_rows: Array<{
		sr_no: number;
		employee_id: number;
		employee_code: string;
		employee_name: string;
		department: string | null;
		designation: string | null;
		hourly_rate: number;
		hours: number;
		cost: number;
		recorded_cost: number;
		estimated_cost: number;
		project_count: number;
	}>;
	project_rows: Array<{
		sr_no: number;
		project_id: number | null;
		project_code: string;
		project_name: string;
		client_name: string;
		hours: number;
		cost: number;
		recorded_cost: number;
		estimated_cost: number;
		employee_count: number;
	}>;
	totals: {
		total_hours: number;
		total_cost: number;
		recorded_cost: number;
		estimated_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
	/** The month's employee-cost position and its coverage disclosures. */
	payroll: PayrollExpenditure;
	coverage: CoverageNotice[];
}

// ─── Small accessors (mysql2 rows are plain objects) ────────────────

type DbRow = Record<string, unknown>;

function s(row: DbRow, key: string, fallback = ''): string {
	const v = row[key];
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'bigint') return String(v);
	return fallback;
}

function n(row: DbRow, key: string, fallback = 0): number {
	const v = row[key];
	if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
	if (typeof v === 'string') {
		const parsed = Number(v);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

/**
 * Cost ÷ hours as a display rate. Derived money uses the shared Decimal rule
 * (ROUND_HALF_UP) like every other amount — `Math.round` mis-rounds values
 * such as 302.25 / 30 (= 10.075) to 10.07 where the money rule gives 10.08.
 */
function rateOf(cost: number, hours: number): number {
	return hours > 0 ? toNumber(div(R(cost), hours).toDecimalPlaces(2)) : 0;
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

/**
 * Sum daily-entry hours per calendar month (YYYY-MM → hours) across every
 * month in the blob. The canonical parser has already dropped the entries
 * with no day or hours ≤ 0, so each remaining `date` is a `YYYY-MM-DD`.
 */
export function sumHoursByMonth(raw: unknown): Record<string, number> {
	const byMonth: Record<string, number> = {};
	for (const { date, hours } of parseDailyEntries(raw)) {
		const month = date.slice(0, 7);
		byMonth[month] = round2((byMonth[month] || 0) + hours);
	}
	return byMonth;
}

export function monthLabel(month: string): string {
	if (!month || !month.includes('-')) return month;
	const [y, m] = month.split('-').map(Number);
	const names = [
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
	if (!y || !m || m < 1 || m > 12) return month;
	return `${names[m - 1]} ${y}`;
}

/**
 * Build one row per project the employee logged hours on, for the given
 * financial year. `assignmentRows` must already be filtered to the employee
 * (the fetcher resolves user_id → employee); rows carry project lookup
 * columns plus `daily_entries`. Assignments of the same project are merged.
 * Projects with no hours in the whole FY are dropped.
 */
export function buildProjectCostRows(
	assignmentRows: DbRow[],
	salaryProfiles: SalaryProfile[],
	fyYear: number = getFinancialYear()
): ProjectCostRow[] {
	const calMap = fyKeyToCalendarMonthMap(fyYear);

	interface Group {
		project_id: number | null;
		project_code: string;
		project_name: string;
		client_name: string;
		hoursByCalMonth: Record<string, number>;
	}

	const groups = new Map<string, Group>();
	for (const row of assignmentRows) {
		const projectId = n(row, 'project_id') || null;
		const code = s(row, 'project_code');
		const name = s(row, 'project_name');
		const key =
			projectId != null ? String(projectId) : code || name || 'unknown';

		let group = groups.get(key);
		if (!group) {
			group = {
				project_id: projectId,
				project_code: code,
				project_name: name,
				client_name: s(row, 'client_name'),
				hoursByCalMonth: {},
			};
			groups.set(key, group);
		}
		for (const [month, hours] of Object.entries(
			sumHoursByMonth(row.daily_entries)
		)) {
			group.hoursByCalMonth[month] = round2(
				(group.hoursByCalMonth[month] || 0) + hours
			);
		}
	}

	const rows: ProjectCostRow[] = [];
	for (const group of groups.values()) {
		const monthlyHours: Record<string, number> = {};
		const monthlyCost: Record<string, number> = {};
		let totalHours = R(0);
		let totalCost = R(0);

		for (const mKey of FY_MONTH_KEYS) {
			const calMonth = calMap[mKey];
			const hours = round2(group.hoursByCalMonth[calMonth] || 0);

			// Payroll rate in force for this specific month (handles raises).
			const profile = pickActiveProfile(salaryProfiles, calMonth);
			const rawRate = profile ? computeRawHourlyRate(profile) : 0;
			const cost =
				hours > 0 && rawRate > 0
					? round2(toNumber(mul(R(rawRate), hours).toDecimalPlaces(2)))
					: 0;

			monthlyHours[mKey] = hours;
			monthlyCost[mKey] = cost;
			if (hours > 0) totalHours = add(totalHours, hours);
			if (cost > 0) totalCost = add(totalCost, cost);
		}

		if (toNumber(totalHours) <= 0) continue;

		rows.push({
			sr_no: 0, // assigned after sorting
			project_id: group.project_id,
			project_code: group.project_code,
			project_name:
				group.project_name ||
				group.project_code ||
				(group.project_id ? `Project #${group.project_id}` : 'Unknown project'),
			client_name: group.client_name,
			hourly_rate: resolveHourlyRateOfFY(salaryProfiles, fyYear),
			monthly_hours: monthlyHours,
			monthly_cost: monthlyCost,
			total_hours: round2(toNumber(totalHours)),
			total_cost: round2(toNumber(totalCost)),
		});
	}

	rows.sort(
		(a, b) =>
			a.project_code.localeCompare(b.project_code) ||
			a.project_name.localeCompare(b.project_name)
	);
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	return rows;
}

/** Display rate from the profile covering FY start (Apr), like the annual billing grid. */
export function resolveHourlyRateOfFY(
	salaryProfiles: SalaryProfile[],
	fyYear: number
): number {
	const profile = pickActiveProfile(salaryProfiles, `${fyYear}-04`);
	return profile ? resolveHourlyRate(profile) : 0;
}

export function buildProjectCostTotals(
	rows: ProjectCostRow[]
): ProjectCostTotals {
	const monthlyHours: Record<string, Decimal> = {};
	const monthlyCost: Record<string, Decimal> = {};
	let totalHours = R(0);
	let totalCost = R(0);

	for (const mKey of FY_MONTH_KEYS) {
		monthlyHours[mKey] = R(0);
		monthlyCost[mKey] = R(0);
	}

	for (const row of rows) {
		for (const mKey of FY_MONTH_KEYS) {
			monthlyHours[mKey] = add(
				monthlyHours[mKey],
				row.monthly_hours?.[mKey] || 0
			);
			monthlyCost[mKey] = add(monthlyCost[mKey], row.monthly_cost?.[mKey] || 0);
		}
		totalHours = add(totalHours, row.total_hours);
		totalCost = add(totalCost, row.total_cost);
	}

	const hoursNum = round2(toNumber(totalHours));
	const costNum = round2(toNumber(totalCost));

	return {
		monthly_hours: Object.fromEntries(
			FY_MONTH_KEYS.map((k) => [k, round2(toNumber(monthlyHours[k]))])
		),
		monthly_cost: Object.fromEntries(
			FY_MONTH_KEYS.map((k) => [k, round2(toNumber(monthlyCost[k]))])
		),
		total_hours: hoursNum,
		total_cost: costNum,
		blended_rate:
			hoursNum > 0
				? round2(toNumber(div(R(costNum), hoursNum).toDecimalPlaces(2)))
				: 0,
	};
}

// ─── New pure helpers for company-wide report ───────────────────────

export interface EmployeeLookup {
	id: number;
	employee_id: string;
	name: string;
	department: string | null;
	designation: string | null;
}

function resolveEmployeeIdForAssignment(
	row: DbRow,
	userToEmployee: Map<number, number>,
	userEmailToEmployee: Map<string, number>
): number | null {
	const direct = n(row, 'employee_id', 0) || null;
	if (direct) return direct;
	const userId = n(row, 'user_id', 0) || null;
	if (userId && userToEmployee.has(userId)) {
		return userToEmployee.get(userId)!;
	}
	const email =
		s(row, 'user_email').toLowerCase() || s(row, 'email').toLowerCase();
	const username =
		s(row, 'user_username').toLowerCase() || s(row, 'username').toLowerCase();
	if (email && userEmailToEmployee.has(email))
		return userEmailToEmployee.get(email)!;
	if (username && userEmailToEmployee.has(username))
		return userEmailToEmployee.get(username)!;
	return null;
}

/**
 * Build company-wide FY rows: one row per employee-project.
 * Groups assignmentRows by employee + project, then computes monthly hours/cost
 * per FY month using that employee's salary profile for that month.
 */
export function buildCompanyCostRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
	userToEmployee: Map<number, number>,
	userEmailToEmployee: Map<string, number>,
	salaryProfilesByEmployee: Map<number, SalaryProfile[]>,
	fyYear: number = getFinancialYear()
): CompanyProjectCostRow[] {
	const calMap = fyKeyToCalendarMonthMap(fyYear);

	interface Group {
		employee_id: number;
		project_id: number | null;
		project_code: string;
		project_name: string;
		client_name: string;
		hoursByCalMonth: Record<string, number>;
	}

	const groups = new Map<string, Group>();

	for (const row of assignmentRows) {
		const empId = resolveEmployeeIdForAssignment(
			row,
			userToEmployee,
			userEmailToEmployee
		);
		if (!empId || !employeeIndex.has(empId)) continue;

		const projectId = n(row, 'project_id') || null;
		const code = s(row, 'project_code');
		const name = s(row, 'project_name');
		const projectKey =
			projectId != null ? String(projectId) : code || name || 'unknown';
		const key = `${empId}::${projectKey}`;

		let group = groups.get(key);
		if (!group) {
			group = {
				employee_id: empId,
				project_id: projectId,
				project_code: code,
				project_name: name,
				client_name: s(row, 'client_name'),
				hoursByCalMonth: {},
			};
			groups.set(key, group);
		}
		for (const [month, hours] of Object.entries(
			sumHoursByMonth(row.daily_entries)
		)) {
			group.hoursByCalMonth[month] = round2(
				(group.hoursByCalMonth[month] || 0) + hours
			);
		}
	}

	const rows: CompanyProjectCostRow[] = [];
	for (const group of groups.values()) {
		const empLookup = employeeIndex.get(group.employee_id)!;
		const profiles = salaryProfilesByEmployee.get(group.employee_id) || [];
		const monthlyHours: Record<string, number> = {};
		const monthlyCost: Record<string, number> = {};
		let totalHours = R(0);
		let totalCost = R(0);

		for (const mKey of FY_MONTH_KEYS) {
			const calMonth = calMap[mKey];
			const hours = round2(group.hoursByCalMonth[calMonth] || 0);
			const profile = pickActiveProfile(profiles, calMonth);
			const rawRate = profile ? computeRawHourlyRate(profile) : 0;
			const cost =
				hours > 0 && rawRate > 0
					? round2(toNumber(mul(R(rawRate), hours).toDecimalPlaces(2)))
					: 0;
			monthlyHours[mKey] = hours;
			monthlyCost[mKey] = cost;
			if (hours > 0) totalHours = add(totalHours, hours);
			if (cost > 0) totalCost = add(totalCost, cost);
		}

		if (toNumber(totalHours) <= 0) continue;

		rows.push({
			sr_no: 0,
			employee_id: group.employee_id,
			employee_code: empLookup.employee_id,
			employee_name: empLookup.name,
			department: empLookup.department,
			designation: empLookup.designation,
			project_id: group.project_id,
			project_code: group.project_code,
			project_name:
				group.project_name ||
				group.project_code ||
				(group.project_id ? `Project #${group.project_id}` : 'Unknown project'),
			client_name: group.client_name,
			hourly_rate: resolveHourlyRateOfFY(profiles, fyYear),
			monthly_hours: monthlyHours,
			monthly_cost: monthlyCost,
			total_hours: round2(toNumber(totalHours)),
			total_cost: round2(toNumber(totalCost)),
		});
	}

	rows.sort(
		(a, b) =>
			a.employee_name.localeCompare(b.employee_name) ||
			a.project_code.localeCompare(b.project_code) ||
			a.project_name.localeCompare(b.project_name)
	);
	rows.forEach((r, i) => (r.sr_no = i + 1));
	return rows;
}

export function buildCompanyEmployeeFYRows(
	companyRows: CompanyProjectCostRow[]
): CompanyEmployeeFYRow[] {
	const grouped = new Map<
		number,
		CompanyEmployeeFYRow & { _projectSet: Set<string> }
	>();

	for (const r of companyRows) {
		let agg = grouped.get(r.employee_id);
		if (!agg) {
			const monthly_hours: Record<string, number> = {};
			const monthly_cost: Record<string, number> = {};
			for (const k of FY_MONTH_KEYS) {
				monthly_hours[k] = 0;
				monthly_cost[k] = 0;
			}
			agg = {
				sr_no: 0,
				employee_id: r.employee_id,
				employee_code: r.employee_code,
				employee_name: r.employee_name,
				department: r.department,
				designation: r.designation,
				hourly_rate: r.hourly_rate,
				monthly_hours,
				monthly_cost,
				total_hours: 0,
				total_cost: 0,
				project_count: 0,
				_projectSet: new Set<string>(),
			} as CompanyEmployeeFYRow & { _projectSet: Set<string> };
			grouped.set(r.employee_id, agg);
		}
		for (const k of FY_MONTH_KEYS) {
			agg.monthly_hours[k] = round2(
				(agg.monthly_hours[k] || 0) + (r.monthly_hours[k] || 0)
			);
			agg.monthly_cost[k] = round2(
				(agg.monthly_cost[k] || 0) + (r.monthly_cost[k] || 0)
			);
		}
		agg.total_hours = round2(agg.total_hours + r.total_hours);
		agg.total_cost = round2(agg.total_cost + r.total_cost);
		const projKey =
			r.project_id != null
				? String(r.project_id)
				: r.project_code || r.project_name;
		agg._projectSet.add(projKey);
	}

	const rows: CompanyEmployeeFYRow[] = Array.from(grouped.values()).map((g) => {
		const { _projectSet, ...rest } = g as unknown as Record<string, unknown> & {
			_projectSet: Set<string>;
		};
		return {
			...(rest as unknown as CompanyEmployeeFYRow),
			project_count: _projectSet.size,
		};
	});

	rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
	rows.forEach((r, i) => (r.sr_no = i + 1));
	return rows;
}

export function buildCompanyProjectFYRows(
	companyRows: CompanyProjectCostRow[]
): CompanyProjectFYRow[] {
	const grouped = new Map<
		string,
		CompanyProjectFYRow & { _empSet: Set<number> }
	>();
	for (const r of companyRows) {
		const key =
			r.project_id != null
				? String(r.project_id)
				: r.project_code || r.project_name || 'unknown';
		let agg = grouped.get(key);
		if (!agg) {
			const monthly_hours: Record<string, number> = {};
			const monthly_cost: Record<string, number> = {};
			for (const k of FY_MONTH_KEYS) {
				monthly_hours[k] = 0;
				monthly_cost[k] = 0;
			}
			agg = {
				sr_no: 0,
				project_id: r.project_id,
				project_code: r.project_code,
				project_name: r.project_name,
				client_name: r.client_name,
				monthly_hours,
				monthly_cost,
				total_hours: 0,
				total_cost: 0,
				employee_count: 0,
				_empSet: new Set<number>(),
			} as CompanyProjectFYRow & { _empSet: Set<number> };
			grouped.set(key, agg);
		}
		for (const k of FY_MONTH_KEYS) {
			agg.monthly_hours[k] = round2(
				(agg.monthly_hours[k] || 0) + (r.monthly_hours[k] || 0)
			);
			agg.monthly_cost[k] = round2(
				(agg.monthly_cost[k] || 0) + (r.monthly_cost[k] || 0)
			);
		}
		agg.total_hours = round2(agg.total_hours + r.total_hours);
		agg.total_cost = round2(agg.total_cost + r.total_cost);
		agg._empSet.add(r.employee_id);
	}
	const rows: CompanyProjectFYRow[] = Array.from(grouped.values()).map((g) => {
		const { _empSet, ...rest } = g as unknown as Record<string, unknown> & {
			_empSet: Set<number>;
		};
		return {
			...(rest as unknown as CompanyProjectFYRow),
			employee_count: _empSet.size,
		};
	});
	rows.sort(
		(a, b) =>
			a.project_code.localeCompare(b.project_code) ||
			a.project_name.localeCompare(b.project_name)
	);
	rows.forEach((r, i) => (r.sr_no = i + 1));
	return rows;
}

export function buildCompanyCostTotals(
	rows: Pick<
		CompanyProjectCostRow,
		'monthly_hours' | 'monthly_cost' | 'total_hours' | 'total_cost'
	>[]
): CompanyCostTotals {
	const monthlyHours: Record<string, Decimal> = {};
	const monthlyCost: Record<string, Decimal> = {};
	let totalHours = R(0);
	let totalCost = R(0);
	for (const k of FY_MONTH_KEYS) {
		monthlyHours[k] = R(0);
		monthlyCost[k] = R(0);
	}
	for (const r of rows) {
		for (const k of FY_MONTH_KEYS) {
			monthlyHours[k] = add(monthlyHours[k], r.monthly_hours?.[k] || 0);
			monthlyCost[k] = add(monthlyCost[k], r.monthly_cost?.[k] || 0);
		}
		totalHours = add(totalHours, r.total_hours);
		totalCost = add(totalCost, r.total_cost);
	}
	const hoursNum = round2(toNumber(totalHours));
	const costNum = round2(toNumber(totalCost));
	return {
		monthly_hours: Object.fromEntries(
			FY_MONTH_KEYS.map((k) => [k, round2(toNumber(monthlyHours[k]))])
		),
		monthly_cost: Object.fromEntries(
			FY_MONTH_KEYS.map((k) => [k, round2(toNumber(monthlyCost[k]))])
		),
		total_hours: hoursNum,
		total_cost: costNum,
		blended_rate:
			hoursNum > 0
				? round2(toNumber(div(R(costNum), hoursNum).toDecimalPlaces(2)))
				: 0,
	};
}

/**
 * Build monthly company rows: one row per employee-project for the given month.
 */
export function buildMonthlyCompanyRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
	userToEmployee: Map<number, number>,
	userEmailToEmployee: Map<string, number>,
	salaryProfilesByEmployee: Map<number, SalaryProfile[]>,
	month: string // YYYY-MM
): MonthlyCompanyCostRow[] {
	interface Group {
		employee_id: number;
		project_id: number | null;
		project_code: string;
		project_name: string;
		client_name: string;
		hours: number;
	}

	const groups = new Map<string, Group>();

	for (const row of assignmentRows) {
		const empId = resolveEmployeeIdForAssignment(
			row,
			userToEmployee,
			userEmailToEmployee
		);
		if (!empId || !employeeIndex.has(empId)) continue;

		const projectId = n(row, 'project_id') || null;
		const code = s(row, 'project_code');
		const name = s(row, 'project_name');
		const projectKey =
			projectId != null ? String(projectId) : code || name || 'unknown';
		const key = `${empId}::${projectKey}`;

		// Sum hours for this specific month from daily_entries. The canonical
		// parser has already dropped the non-positive-hours entries, and each
		// addend is still rounded on the way in so the 2dp total is unchanged.
		let hoursForMonth = 0;
		for (const { date, hours } of parseDailyEntries(row.daily_entries)) {
			if (!date.startsWith(month)) continue;
			hoursForMonth = round2(hoursForMonth + hours);
		}
		if (hoursForMonth <= 0) continue;

		let group = groups.get(key);
		if (!group) {
			group = {
				employee_id: empId,
				project_id: projectId,
				project_code: code,
				project_name: name,
				client_name: s(row, 'client_name'),
				hours: 0,
			};
			groups.set(key, group);
		}
		group.hours = round2(group.hours + hoursForMonth);
	}

	const rows: MonthlyCompanyCostRow[] = [];
	for (const g of groups.values()) {
		const emp = employeeIndex.get(g.employee_id)!;
		const profiles = salaryProfilesByEmployee.get(g.employee_id) || [];
		const profile = pickActiveProfile(profiles, month);
		const rawRate = profile ? computeRawHourlyRate(profile) : 0;
		const hourlyRate = profile ? resolveHourlyRate(profile) : 0;
		const cost =
			g.hours > 0 && rawRate > 0
				? round2(toNumber(mul(R(rawRate), g.hours).toDecimalPlaces(2)))
				: 0;

		rows.push({
			sr_no: 0,
			employee_id: g.employee_id,
			employee_code: emp.employee_id,
			employee_name: emp.name,
			department: emp.department,
			designation: emp.designation,
			project_id: g.project_id,
			project_code: g.project_code,
			project_name:
				g.project_name ||
				g.project_code ||
				(g.project_id ? `Project #${g.project_id}` : 'Unknown project'),
			client_name: g.client_name,
			hourly_rate: hourlyRate,
			hours: g.hours,
			cost,
		});
	}

	rows.sort(
		(a, b) =>
			a.employee_name.localeCompare(b.employee_name) ||
			a.project_code.localeCompare(b.project_code)
	);
	rows.forEach((r, i) => (r.sr_no = i + 1));
	return rows;
}

// ─── Server data fetch ──────────────────────────────────────────────

/** Legacy: Employees + financial years for the filter bar. */
export async function fetchEmployeeCostMeta(): Promise<CostMeta> {
	const [employeeRows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, position, designation
		 FROM employees
		 WHERE isDelete = 0 AND status = 'active'
		 ORDER BY first_name, last_name`
	)) as [DbRow[], unknown];

	const employees: CostEmployee[] = employeeRows.map((r) => ({
		id: n(r, 'id'),
		employee_id: s(r, 'employee_id'),
		name: s(r, 'name') || `Employee ${s(r, 'id')}`,
		department: s(r, 'department', '') || null,
		designation: s(r, 'position', '') || s(r, 'designation', '') || null,
	}));

	// Financial years that actually hold logged hours, plus current & previous.
	const yearsSet = new Set<number>();
	const currentFy = getFinancialYear();
	yearsSet.add(currentFy);
	yearsSet.add(currentFy - 1);
	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		for (const row of asgRows) {
			for (const { date } of parseDailyEntryRecords(row.daily_entries)) {
				const y = Number(date.slice(0, 4));
				const m = Number(date.slice(5, 7));
				if (y) yearsSet.add(m >= 4 ? y : y - 1);
			}
		}
	} catch {
		/* user_activity_assignments may not exist */
	}

	const financial_years: FinancialYearOption[] = Array.from(yearsSet)
		.sort((a, b) => b - a)
		.map((year) => ({ year, label: formatFyLabel(year) }));

	return { employees, financial_years, current_fy: currentFy };
}

/**
 * Full consolidated payload for one employee + financial year: every project
 * they logged manhours on, with monthly hours and monthly employee cost.
 *
 * Cost comes from the shared financial interpretation (#307, ADR-0016):
 * recorded employer-cost allocations where the month was finalized, the
 * corrected payroll calculation's estimate otherwise. The obsolete
 * Gross-first billing-derived rate × hours path is no longer used here.
 */
export async function fetchEmployeeProjectCost(
	employeeId: number,
	fyYear: number = getFinancialYear()
): Promise<EmployeeProjectCostData | null> {
	const [employeeRows] = (await query(
		`SELECT id, employee_id,
		        CONCAT_WS(' ', first_name, last_name) AS name,
		        department, position, designation, email, username
		 FROM employees
		 WHERE id = ? AND isDelete = 0`,
		[employeeId]
	)) as [DbRow[], unknown];
	if (employeeRows.length === 0) return null;

	const emp = employeeRows[0];
	const employee: CostEmployee = {
		id: n(emp, 'id'),
		employee_id: s(emp, 'employee_id'),
		name: s(emp, 'name') || `Employee ${employeeId}`,
		department: s(emp, 'department', '') || null,
		designation: s(emp, 'position', '') || s(emp, 'designation', '') || null,
	};

	const months = fyCalendarMonths(fyYear);
	const payrollByMonth = await loadPayrollMonths(months);
	const rows = buildFYAllocationRows(
		fyYear,
		months,
		payrollByMonth,
		new Map([[employeeId, employee]]),
		employeeId
	).map((row) => ({
		sr_no: row.sr_no,
		project_id: row.project_id,
		project_code: row.project_code,
		project_name: row.project_name,
		client_name: row.client_name,
		hourly_rate: row.blended_rate,
		monthly_hours: row.monthly_hours,
		monthly_cost: row.monthly_cost,
		total_hours: row.total_hours,
		total_cost: row.total_cost,
	}));

	return {
		employee,
		fy_label: formatFyLabel(fyYear),
		fy_year: fyYear,
		months: Array.from(FY_MONTHS),
		month_keys: Array.from(FY_MONTH_KEYS),
		rows,
		totals: buildProjectCostTotals(rows),
	};
}

// ─── Company-wide employee cost from the shared interpretation ──────

/** The pooled connection the financial module reads through. */
const payrollPool = {
	execute: (sql: string, params?: Array<string | number | boolean | null>) =>
		query(sql, params),
};

/** Load the shared employee-cost interpretation for several months. */
async function loadPayrollMonths(
	months: string[]
): Promise<Map<string, PayrollEmployeeCost[]>> {
	const entries = await Promise.all(
		months.map(async (month) => {
			const interpretation = await loadPayrollMonth(payrollPool, month);
			return [month, interpretation.employees] as const;
		})
	);
	return new Map(entries);
}

/** The twelve calendar months of a financial year, April first. */
function fyCalendarMonths(fyYear: number): string[] {
	const calendar = fyKeyToCalendarMonthMap(fyYear);
	return FY_MONTH_KEYS.map((key) => calendar[key]);
}

/** How a row's cost is known. */
export type EmployeeCostStatus =
	| 'recorded'
	| 'estimated'
	| 'known_zero'
	| 'unknown';

export interface EmployeeCostDestination {
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
}

/** Hours without a Project: their share is Unallocated Employee Cost. */
const NO_PROJECT_DESTINATION: EmployeeCostDestination = {
	project_id: null,
	project_code: 'NO-PROJECT',
	project_name: 'No project',
	client_name: '',
};

/** Recorded cost with no Logged Hours: wholly unallocated. */
const NO_LOGGED_HOURS_DESTINATION: EmployeeCostDestination = {
	project_id: null,
	project_code: 'NO-LOGGED-HOURS',
	project_name: 'No logged hours',
	client_name: '',
};

function destinationOf(share: {
	project_id: number | null;
	project_code: string | null;
	project_name: string | null;
	client_name: string | null;
	basis: string;
}): EmployeeCostDestination {
	if (share.project_id !== null) {
		return {
			project_id: share.project_id,
			project_code: share.project_code ?? `#${share.project_id}`,
			project_name:
				share.project_name ??
				share.project_code ??
				`Project #${share.project_id}`,
			client_name: share.client_name ?? '',
		};
	}
	return share.basis === 'no_project'
		? NO_PROJECT_DESTINATION
		: NO_LOGGED_HOURS_DESTINATION;
}

/**
 * One row per Employee and cost destination for one month, with the recorded
 * and estimated amounts stated separately.
 */
export function buildMonthlyAllocationRows(
	employees: PayrollEmployeeCost[],
	employeeIndex: Map<number, EmployeeLookup>
): MonthlyCompanyCostRow[] {
	const rows: MonthlyCompanyCostRow[] = [];
	for (const employee of employees) {
		const lookup = employeeIndex.get(employee.employee_id);
		const recorded = employee.recorded_amount !== null;
		const status: EmployeeCostStatus = recorded
			? employee.recorded_amount === 0
				? 'known_zero'
				: 'recorded'
			: employee.estimated_amount !== null
				? 'estimated'
				: 'unknown';
		for (const share of employee.shares) {
			const destination = destinationOf(share);
			rows.push({
				sr_no: 0,
				employee_id: employee.employee_id,
				employee_code: employee.employee_code,
				employee_name: employee.employee_name,
				department: lookup?.department ?? null,
				designation: lookup?.designation ?? null,
				project_id: destination.project_id,
				project_code: destination.project_code,
				project_name: destination.project_name,
				client_name: destination.client_name,
				hourly_rate: rateOf(share.amount, share.hours),
				hours: share.hours,
				cost: share.amount,
				recorded_cost: recorded ? share.amount : 0,
				estimated_cost: recorded ? 0 : share.amount,
				cost_status: status,
			});
		}
	}
	rows.sort(
		(a, b) =>
			a.employee_name.localeCompare(b.employee_name) ||
			a.project_code.localeCompare(b.project_code)
	);
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
	});
	return rows;
}

export function buildMonthlyAllocationEmployeeRows(
	rows: MonthlyCompanyCostRow[]
): MonthlyCompanyCostData['employee_rows'] {
	const grouped = new Map<
		number,
		MonthlyCompanyCostData['employee_rows'][number] & { _projects: Set<string> }
	>();
	for (const row of rows) {
		let aggregate = grouped.get(row.employee_id);
		if (!aggregate) {
			aggregate = {
				sr_no: 0,
				employee_id: row.employee_id,
				employee_code: row.employee_code,
				employee_name: row.employee_name,
				department: row.department,
				designation: row.designation,
				hourly_rate: 0,
				hours: 0,
				cost: 0,
				recorded_cost: 0,
				estimated_cost: 0,
				project_count: 0,
				_projects: new Set<string>(),
			};
			grouped.set(row.employee_id, aggregate);
		}
		aggregate.hours = round2(aggregate.hours + row.hours);
		aggregate.cost = round2(aggregate.cost + row.cost);
		aggregate.recorded_cost = round2(
			aggregate.recorded_cost + row.recorded_cost
		);
		aggregate.estimated_cost = round2(
			aggregate.estimated_cost + row.estimated_cost
		);
		if (row.project_id !== null)
			aggregate._projects.add(String(row.project_id));
	}
	const result = [...grouped.values()].map((aggregate) => {
		const { _projects, ...rest } = aggregate;
		return {
			...rest,
			project_count: _projects.size,
			hourly_rate: rateOf(rest.cost, rest.hours),
		};
	});
	result.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
	result.forEach((row, index) => {
		row.sr_no = index + 1;
	});
	return result;
}

export function buildMonthlyAllocationProjectRows(
	rows: MonthlyCompanyCostRow[]
): MonthlyCompanyCostData['project_rows'] {
	const grouped = new Map<
		string,
		MonthlyCompanyCostData['project_rows'][number] & { _employees: Set<number> }
	>();
	for (const row of rows) {
		const key =
			row.project_id !== null ? String(row.project_id) : row.project_code;
		let aggregate = grouped.get(key);
		if (!aggregate) {
			aggregate = {
				sr_no: 0,
				project_id: row.project_id,
				project_code: row.project_code,
				project_name: row.project_name,
				client_name: row.client_name,
				hours: 0,
				cost: 0,
				recorded_cost: 0,
				estimated_cost: 0,
				employee_count: 0,
				_employees: new Set<number>(),
			};
			grouped.set(key, aggregate);
		}
		aggregate.hours = round2(aggregate.hours + row.hours);
		aggregate.cost = round2(aggregate.cost + row.cost);
		aggregate.recorded_cost = round2(
			aggregate.recorded_cost + row.recorded_cost
		);
		aggregate.estimated_cost = round2(
			aggregate.estimated_cost + row.estimated_cost
		);
		aggregate._employees.add(row.employee_id);
	}
	const result = [...grouped.values()].map((aggregate) => {
		const { _employees, ...rest } = aggregate;
		return { ...rest, employee_count: _employees.size };
	});
	result.sort(
		(a, b) =>
			a.project_code.localeCompare(b.project_code) ||
			a.project_name.localeCompare(b.project_name)
	);
	result.forEach((row, index) => {
		row.sr_no = index + 1;
	});
	return result;
}

export function buildMonthlyAllocationTotals(
	rows: MonthlyCompanyCostRow[]
): MonthlyCompanyCostData['totals'] {
	let hours = R(0);
	let cost = R(0);
	let recorded = R(0);
	let estimated = R(0);
	const employees = new Set<number>();
	const projects = new Set<string>();
	for (const row of rows) {
		hours = add(hours, row.hours);
		cost = add(cost, row.cost);
		recorded = add(recorded, row.recorded_cost);
		estimated = add(estimated, row.estimated_cost);
		employees.add(row.employee_id);
		if (row.project_id !== null) projects.add(String(row.project_id));
	}
	const hoursNumber = round2(toNumber(hours));
	const costNumber = round2(toNumber(cost));
	return {
		total_hours: hoursNumber,
		total_cost: costNumber,
		recorded_cost: round2(toNumber(recorded)),
		estimated_cost: round2(toNumber(estimated)),
		blended_rate:
			hoursNumber > 0
				? round2(toNumber(div(R(costNumber), hoursNumber).toDecimalPlaces(2)))
				: 0,
		employee_count: employees.size,
		project_count: projects.size,
	};
}

/** One Employee/Project row of a financial year, monthly cost included. */
export interface FYAllocationRow {
	sr_no: number;
	employee_id: number;
	employee_code: string;
	employee_name: string;
	department: string | null;
	designation: string | null;
	project_id: number | null;
	project_code: string;
	project_name: string;
	client_name: string;
	monthly_hours: Record<string, number>;
	monthly_cost: Record<string, number>;
	total_hours: number;
	total_cost: number;
	recorded_cost: number;
	estimated_cost: number;
	/** Display rate the FY table and workbook read (`blended` for the row). */
	hourly_rate: number;
}

/**
 * Build one row per Employee and destination across a financial year's months.
 * `employeeId` narrows to one Employee (the legacy per-employee view).
 */
export function buildFYAllocationRows(
	fyYear: number,
	months: string[],
	payrollByMonth: Map<string, PayrollEmployeeCost[]>,
	employeeIndex: Map<number, EmployeeLookup>,
	employeeId: number | null = null
): FYAllocationRow[] {
	const calendar = fyKeyToCalendarMonthMap(fyYear);
	const monthKeys = new Map<string, string>();
	for (const [key, month] of Object.entries(calendar)) {
		monthKeys.set(month, key);
	}
	const grouped = new Map<string, FYAllocationRow>();
	for (const month of months) {
		const key = monthKeys.get(month) ?? month;
		for (const employee of payrollByMonth.get(month) ?? []) {
			if (employeeId !== null && employee.employee_id !== employeeId) continue;
			const lookup = employeeIndex.get(employee.employee_id);
			for (const share of employee.shares) {
				const destination = destinationOf(share);
				const groupKey = `${employee.employee_id}::${destination.project_code}`;
				let row = grouped.get(groupKey);
				if (!row) {
					row = {
						sr_no: 0,
						employee_id: employee.employee_id,
						employee_code: employee.employee_code,
						employee_name: employee.employee_name,
						department: lookup?.department ?? null,
						designation: lookup?.designation ?? null,
						project_id: destination.project_id,
						project_code: destination.project_code,
						project_name: destination.project_name,
						client_name: destination.client_name,
						monthly_hours: {},
						monthly_cost: {},
						total_hours: 0,
						total_cost: 0,
						recorded_cost: 0,
						estimated_cost: 0,
						hourly_rate: 0,
					};
					grouped.set(groupKey, row);
				}
				row.monthly_hours[key] = round2(
					(row.monthly_hours[key] ?? 0) + share.hours
				);
				row.monthly_cost[key] = round2(
					(row.monthly_cost[key] ?? 0) + share.amount
				);
				row.total_hours = round2(row.total_hours + share.hours);
				row.total_cost = round2(row.total_cost + share.amount);
				if (employee.recorded_amount !== null) {
					row.recorded_cost = round2(row.recorded_cost + share.amount);
				} else {
					row.estimated_cost = round2(row.estimated_cost + share.amount);
				}
			}
		}
	}
	const rows = [...grouped.values()].filter(
		(row) => row.total_hours > 0 || row.total_cost > 0
	);
	rows.sort(
		(a, b) =>
			a.employee_name.localeCompare(b.employee_name) ||
			a.project_code.localeCompare(b.project_code)
	);
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
		row.hourly_rate = rateOf(row.total_cost, row.total_hours);
	});
	return rows;
}

function allocationTotalsFromFYRows(
	rows: FYAllocationRow[]
): CompanyCostTotals {
	const monthlyHours: Record<string, Decimal> = {};
	const monthlyCost: Record<string, Decimal> = {};
	for (const key of FY_MONTH_KEYS) {
		monthlyHours[key] = R(0);
		monthlyCost[key] = R(0);
	}
	let totalHours = R(0);
	let totalCost = R(0);
	for (const row of rows) {
		for (const key of FY_MONTH_KEYS) {
			monthlyHours[key] = add(monthlyHours[key], row.monthly_hours[key] ?? 0);
			monthlyCost[key] = add(monthlyCost[key], row.monthly_cost[key] ?? 0);
		}
		totalHours = add(totalHours, row.total_hours);
		totalCost = add(totalCost, row.total_cost);
	}
	const hours = round2(toNumber(totalHours));
	const cost = round2(toNumber(totalCost));
	return {
		monthly_hours: Object.fromEntries(
			FY_MONTH_KEYS.map((key) => [key, round2(toNumber(monthlyHours[key]))])
		),
		monthly_cost: Object.fromEntries(
			FY_MONTH_KEYS.map((key) => [key, round2(toNumber(monthlyCost[key]))])
		),
		total_hours: hours,
		total_cost: cost,
		recorded_cost: round2(
			rows.reduce((sum, row) => add(sum, row.recorded_cost), R(0)).toNumber()
		),
		estimated_cost: round2(
			rows.reduce((sum, row) => add(sum, row.estimated_cost), R(0)).toNumber()
		),
		blended_rate:
			hours > 0 ? round2(toNumber(div(R(cost), hours).toDecimalPlaces(2))) : 0,
	};
}

// ─── New company-wide fetchers ──────────────────────────────────────

async function loadEmployeeIndex(): Promise<Map<number, EmployeeLookup>> {
	const map = new Map<number, EmployeeLookup>();
	try {
		const [rows] = (await query(
			`SELECT id, employee_id,
			        CONCAT_WS(' ', first_name, last_name) AS name,
			        department, position, designation, email, username
			 FROM employees
			 WHERE isDelete = 0`
		)) as [DbRow[], unknown];
		for (const r of rows) {
			const id = n(r, 'id');
			if (!id) continue;
			map.set(id, {
				id,
				employee_id: s(r, 'employee_id'),
				name: s(r, 'name') || `Employee ${id}`,
				department: s(r, 'department', '') || null,
				designation: s(r, 'position', '') || s(r, 'designation', '') || null,
			});
		}
	} catch {
		/* employees table may not exist */
	}
	return map;
}

/** Company-wide meta: months + FY options */
export async function fetchCompanyCostMeta(): Promise<CompanyCostMeta> {
	const yearsSet = new Set<number>();
	const currentFy = getFinancialYear();
	yearsSet.add(currentFy);
	yearsSet.add(currentFy - 1);

	const monthSet = new Set<string>();

	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		for (const row of asgRows) {
			for (const { date } of parseDailyEntryRecords(row.daily_entries)) {
				if (date.length < 7) continue;
				const m = date.slice(0, 7);
				monthSet.add(m);
				const y = Number(m.slice(0, 4));
				const mon = Number(m.slice(5, 7));
				if (y) yearsSet.add(mon >= 4 ? y : y - 1);
			}
		}
	} catch {
		/* table may not exist */
	}

	// Also include project_manhours_list months? Not needed for cost, but keep for completeness
	// Ensure current month is present
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	if (!monthSet.has(currentMonth)) monthSet.add(currentMonth);

	const months = Array.from(monthSet).sort().reverse();
	const financial_years: FinancialYearOption[] = Array.from(yearsSet)
		.sort((a, b) => b - a)
		.map((year) => ({ year, label: formatFyLabel(year) }));

	return {
		financial_years,
		current_fy: currentFy,
		months,
		latest_month: months[0] ?? currentMonth,
		current_month: currentMonth,
	};
}

/** Fetch company-wide FY data (Apr–Mar) with monthly breakdowns */
export async function fetchFYCompanyCost(
	fyYear: number = getFinancialYear()
): Promise<FYCompanyCostData> {
	const months = fyCalendarMonths(fyYear);
	const [employeeIndex, payrollByMonth] = await Promise.all([
		loadEmployeeIndex(),
		loadPayrollMonths(months),
	]);

	const rows = buildFYAllocationRows(
		fyYear,
		months,
		payrollByMonth,
		employeeIndex
	);
	const employee_rows = buildFYAllocationEmployeeRows(rows);
	const project_rows = buildFYAllocationProjectRows(rows);
	const totals = allocationTotalsFromFYRows(rows);

	const projectSet = new Set<string>();
	const employeeSet = new Set<number>();
	for (const r of rows) {
		employeeSet.add(r.employee_id);
		projectSet.add(
			r.project_id != null ? String(r.project_id) : r.project_code
		);
	}

	return {
		fy_label: formatFyLabel(fyYear),
		fy_year: fyYear,
		months: Array.from(FY_MONTHS),
		month_keys: Array.from(FY_MONTH_KEYS),
		rows,
		employee_rows,
		project_rows,
		totals,
		summary: {
			total_hours: totals.total_hours,
			total_cost: totals.total_cost,
			blended_rate: totals.blended_rate,
			employee_count: employeeSet.size,
			project_count: projectSet.size,
		},
	};
}

/** Aggregate FY allocation rows per Employee. */
export function buildFYAllocationEmployeeRows(
	rows: FYAllocationRow[]
): CompanyEmployeeFYRow[] {
	const grouped = new Map<
		number,
		CompanyEmployeeFYRow & { _projects: Set<string> }
	>();
	for (const row of rows) {
		let aggregate = grouped.get(row.employee_id);
		if (!aggregate) {
			const monthly_hours: Record<string, number> = {};
			const monthly_cost: Record<string, number> = {};
			for (const key of FY_MONTH_KEYS) {
				monthly_hours[key] = 0;
				monthly_cost[key] = 0;
			}
			aggregate = {
				sr_no: 0,
				employee_id: row.employee_id,
				employee_code: row.employee_code,
				employee_name: row.employee_name,
				department: row.department,
				designation: row.designation,
				hourly_rate: 0,
				monthly_hours,
				monthly_cost,
				total_hours: 0,
				total_cost: 0,
				project_count: 0,
				_projects: new Set<string>(),
			};
			grouped.set(row.employee_id, aggregate);
		}
		for (const key of FY_MONTH_KEYS) {
			aggregate.monthly_hours[key] = round2(
				(aggregate.monthly_hours[key] ?? 0) + (row.monthly_hours[key] ?? 0)
			);
			aggregate.monthly_cost[key] = round2(
				(aggregate.monthly_cost[key] ?? 0) + (row.monthly_cost[key] ?? 0)
			);
		}
		aggregate.total_hours = round2(aggregate.total_hours + row.total_hours);
		aggregate.total_cost = round2(aggregate.total_cost + row.total_cost);
		aggregate._projects.add(
			row.project_id != null ? String(row.project_id) : row.project_code
		);
	}
	const result = [...grouped.values()].map((aggregate) => {
		const { _projects, ...rest } = aggregate;
		return {
			...rest,
			project_count: _projects.size,
			hourly_rate: rateOf(rest.total_cost, rest.total_hours),
		};
	});
	result.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
	result.forEach((row, index) => {
		row.sr_no = index + 1;
	});
	return result;
}

/** Aggregate FY allocation rows per Project (and the unallocated buckets). */
export function buildFYAllocationProjectRows(
	rows: FYAllocationRow[]
): CompanyProjectFYRow[] {
	const grouped = new Map<
		string,
		CompanyProjectFYRow & { _employees: Set<number> }
	>();
	for (const row of rows) {
		const key =
			row.project_id != null ? String(row.project_id) : row.project_code;
		let aggregate = grouped.get(key);
		if (!aggregate) {
			const monthly_hours: Record<string, number> = {};
			const monthly_cost: Record<string, number> = {};
			for (const monthKey of FY_MONTH_KEYS) {
				monthly_hours[monthKey] = 0;
				monthly_cost[monthKey] = 0;
			}
			aggregate = {
				sr_no: 0,
				project_id: row.project_id,
				project_code: row.project_code,
				project_name: row.project_name,
				client_name: row.client_name,
				monthly_hours,
				monthly_cost,
				total_hours: 0,
				total_cost: 0,
				employee_count: 0,
				_employees: new Set<number>(),
			};
			grouped.set(key, aggregate);
		}
		for (const monthKey of FY_MONTH_KEYS) {
			aggregate.monthly_hours[monthKey] = round2(
				(aggregate.monthly_hours[monthKey] ?? 0) +
					(row.monthly_hours[monthKey] ?? 0)
			);
			aggregate.monthly_cost[monthKey] = round2(
				(aggregate.monthly_cost[monthKey] ?? 0) +
					(row.monthly_cost[monthKey] ?? 0)
			);
		}
		aggregate.total_hours = round2(aggregate.total_hours + row.total_hours);
		aggregate.total_cost = round2(aggregate.total_cost + row.total_cost);
		aggregate._employees.add(row.employee_id);
	}
	const result = [...grouped.values()].map((aggregate) => {
		const { _employees, ...rest } = aggregate;
		return { ...rest, employee_count: _employees.size };
	});
	result.sort(
		(a, b) =>
			a.project_code.localeCompare(b.project_code) ||
			a.project_name.localeCompare(b.project_name)
	);
	result.forEach((row, index) => {
		row.sr_no = index + 1;
	});
	return result;
}

/** Fetch company-wide monthly data for a single YYYY-MM */
export async function fetchMonthlyCompanyCost(
	month: string
): Promise<MonthlyCompanyCostData | null> {
	if (!/^\d{4}-\d{2}$/.test(month)) return null;
	const y = Number(month.slice(0, 4));
	const m = Number(month.slice(5, 7));
	if (!y || m < 1 || m > 12) return null;

	const [employeeIndex, interpretation] = await Promise.all([
		loadEmployeeIndex(),
		loadPayrollMonth(payrollPool, month),
	]);

	const rows = buildMonthlyAllocationRows(
		interpretation.employees,
		employeeIndex
	);
	const employee_rows = buildMonthlyAllocationEmployeeRows(rows);
	const project_rows = buildMonthlyAllocationProjectRows(rows);
	const totals = buildMonthlyAllocationTotals(rows);
	const fyYear = m >= 4 ? y : y - 1;

	return {
		month,
		month_label: monthLabel(month),
		fy_label: formatFyLabel(fyYear),
		fy_year: fyYear,
		rows,
		employee_rows,
		project_rows,
		totals,
		payroll: interpretation.totals,
		coverage: interpretation.coverage,
	};
}
