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
 * - Hourly cost: `employee_salary_profile` via payroll's formula — hourly_rate
 *   (hourly/custom) or daily_rate when set, else gross_salary ÷
 *   (std_working_days × std_hours_per_day). `pickActiveProfile` honours each
 *   month's effective_from/to range so mid-year raises are reflected.
 * - Monthly cost = hourly rate for that month × hours logged that month.
 *
 * Rate helpers are imported from the manhours-billing data-source so both
 * reports can never diverge on salary→rate math.
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
	parseDailyEntries,
	computeRawHourlyRate,
	resolveHourlyRate,
	pickActiveProfile,
	type SalaryProfile,
} from '@/app/reports/manhours-billing/data-source';

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
		employee_count: number;
	}>;
	totals: {
		total_hours: number;
		total_cost: number;
		blended_rate: number;
		employee_count: number;
		project_count: number;
	};
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

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

function entryHours(v: unknown): number {
	if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
	if (typeof v === 'string') {
		const parsed = Number(v);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

/**
 * Sum daily-entry hours per calendar month (YYYY-MM → hours).
 * Entries with no date or hours ≤ 0 are ignored.
 */
export function sumHoursByMonth(raw: unknown): Record<string, number> {
	const byMonth: Record<string, number> = {};
	for (const entry of parseDailyEntries(raw)) {
		const date = typeof entry.date === 'string' ? entry.date : '';
		if (date.length < 7) continue;
		const hours = entryHours(entry.hours);
		if (hours <= 0) continue;
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

		// Sum hours for this specific month from daily_entries
		let hoursForMonth = 0;
		for (const entry of parseDailyEntries(row.daily_entries)) {
			const date = typeof entry.date === 'string' ? entry.date : '';
			if (!date.startsWith(month)) continue;
			const h = entryHours(entry.hours);
			if (h <= 0) continue;
			hoursForMonth = round2(hoursForMonth + h);
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
			for (const entry of parseDailyEntries(row.daily_entries)) {
				const dateStr = typeof entry.date === 'string' ? entry.date : '';
				const y = Number(dateStr.slice(0, 4));
				const m = Number(dateStr.slice(5, 7));
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
 * they logged manhours on, with monthly hours and monthly payroll cost.
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

	// Salary profiles for rate resolution (payroll's effective-dated history).
	const salaryProfiles: SalaryProfile[] = [];
	try {
		const [profileRows] = (await query(
			`SELECT employee_id, gross, gross_salary, employer_cost,
			        hourly_rate, daily_rate, std_hours_per_day, std_working_days,
			        salary_type, tds_percentage,
			        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
			        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
			 FROM employee_salary_profile
			 WHERE is_active = 1 AND employee_id = ?`,
			[employeeId]
		)) as [DbRow[], unknown];
		for (const p of profileRows) {
			const pid = n(p, 'employee_id');
			if (!pid) continue;
			salaryProfiles.push({
				employee_id: pid,
				gross: n(p, 'gross'),
				gross_salary: n(p, 'gross_salary'),
				employer_cost: n(p, 'employer_cost'),
				hourly_rate: n(p, 'hourly_rate'),
				daily_rate: n(p, 'daily_rate'),
				std_hours_per_day: n(p, 'std_hours_per_day', 8),
				std_working_days: n(p, 'std_working_days', 26),
				salary_type: s(p, 'salary_type', 'monthly'),
				tds_percentage: n(p, 'tds_percentage', 0),
				effective_from: s(p, 'effective_from', '') || null,
				effective_to: s(p, 'effective_to', '') || null,
			});
		}
	} catch {
		/* table may not exist */
	}

	// Activity assignments across ALL projects (ProjectActivityAssignments
	// source). Keyed by user_id, so widen the match through the login account:
	// explicit employee_id column, users.employee_id link, or email/username
	// (login emails routinely differ from the employee record's).
	let assignmentRows: DbRow[] = [];
	try {
		[assignmentRows] = (await query(
			`SELECT uaa.project_id, uaa.daily_entries,
			        p.project_code, p.client_name,
			        COALESCE(NULLIF(p.project_title, ''), NULLIF(p.name, ''), '') AS project_name
			 FROM user_activity_assignments uaa
			 LEFT JOIN projects p ON p.project_id = uaa.project_id
			 WHERE uaa.status <> 'Cancelled'
			   AND (
			     uaa.employee_id = ?
			     OR uaa.user_id IN (
			       SELECT u.id FROM users u
			       WHERE (u.email <> '' AND u.email = ?)
			          OR (u.username <> '' AND u.username = ?)
			          OR (u.employee_id IS NOT NULL AND u.employee_id = ?)
			     )
			   )`,
			[employeeId, s(emp, 'email'), s(emp, 'username'), employeeId]
		)) as [DbRow[], unknown];
	} catch {
		/* table may not exist */
	}

	const rows = buildProjectCostRows(assignmentRows, salaryProfiles, fyYear);

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

async function loadUserMaps(): Promise<{
	userToEmployee: Map<number, number>;
	userEmailToEmployee: Map<string, number>;
}> {
	const userToEmployee = new Map<number, number>();
	const userEmailToEmployee = new Map<string, number>();
	try {
		const [empRows] = (await query(
			`SELECT id, employee_id, email, username FROM employees WHERE isDelete = 0`
		)) as [DbRow[], unknown];
		for (const r of empRows) {
			const id = n(r, 'id');
			if (!id) continue;
			const email = s(r, 'email').toLowerCase();
			const username = s(r, 'username').toLowerCase();
			if (email) userEmailToEmployee.set(email, id);
			if (username) userEmailToEmployee.set(username, id);
		}
	} catch {}
	try {
		const [userRows] = (await query(
			`SELECT id, employee_id, email, username FROM users`
		)) as [DbRow[], unknown];
		for (const u of userRows) {
			const userId = n(u, 'id');
			const empId = n(u, 'employee_id', 0);
			if (userId && empId) userToEmployee.set(userId, empId);
			const email = s(u, 'email').toLowerCase();
			const username = s(u, 'username').toLowerCase();
			if (email && empId) userEmailToEmployee.set(email, empId);
			if (username && empId) userEmailToEmployee.set(username, empId);
			// Also allow lookup of user email -> employee even if not directly linked? already handled
		}
	} catch {}
	return { userToEmployee, userEmailToEmployee };
}

async function loadSalaryProfilesGrouped(): Promise<
	Map<number, SalaryProfile[]>
> {
	const grouped = new Map<number, SalaryProfile[]>();
	try {
		const [rows] = (await query(
			`SELECT employee_id, gross, gross_salary, employer_cost,
			        hourly_rate, daily_rate, std_hours_per_day, std_working_days,
			        salary_type, tds_percentage,
			        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
			        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
			 FROM employee_salary_profile
			 WHERE is_active = 1`
		)) as [DbRow[], unknown];
		for (const p of rows) {
			const employeeId = n(p, 'employee_id');
			if (!employeeId) continue;
			const profile: SalaryProfile = {
				employee_id: employeeId,
				gross: n(p, 'gross'),
				gross_salary: n(p, 'gross_salary'),
				employer_cost: n(p, 'employer_cost'),
				hourly_rate: n(p, 'hourly_rate'),
				daily_rate: n(p, 'daily_rate'),
				std_hours_per_day: n(p, 'std_hours_per_day', 8),
				std_working_days: n(p, 'std_working_days', 26),
				salary_type: s(p, 'salary_type', 'monthly'),
				tds_percentage: n(p, 'tds_percentage', 0),
				effective_from: s(p, 'effective_from', '') || null,
				effective_to: s(p, 'effective_to', '') || null,
			};
			const arr = grouped.get(employeeId) || [];
			arr.push(profile);
			grouped.set(employeeId, arr);
		}
	} catch {}
	return grouped;
}

async function loadAllAssignmentRows(): Promise<DbRow[]> {
	try {
		const [rows] = (await query(
			`SELECT uaa.project_id, uaa.employee_id, uaa.user_id, uaa.daily_entries,
			        p.project_code, p.client_name,
			        COALESCE(NULLIF(p.project_title, ''), NULLIF(p.name, ''), '') AS project_name,
			        u.email AS user_email, u.username AS user_username
			 FROM user_activity_assignments uaa
			 LEFT JOIN projects p ON p.project_id = uaa.project_id
			 LEFT JOIN users u ON u.id = uaa.user_id
			 WHERE uaa.status <> 'Cancelled'
			   AND uaa.daily_entries IS NOT NULL AND uaa.daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		return rows;
	} catch {
		return [];
	}
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
			for (const entry of parseDailyEntries(row.daily_entries)) {
				const dateStr = typeof entry.date === 'string' ? entry.date : '';
				if (dateStr.length >= 7) {
					const m = dateStr.slice(0, 7);
					monthSet.add(m);
					const y = Number(m.slice(0, 4));
					const mon = Number(m.slice(5, 7));
					if (y) yearsSet.add(mon >= 4 ? y : y - 1);
				}
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
	const [employeeIndex, userMaps, salaryGrouped, assignmentRows] =
		await Promise.all([
			loadEmployeeIndex(),
			loadUserMaps(),
			loadSalaryProfilesGrouped(),
			loadAllAssignmentRows(),
		]);

	const rows = buildCompanyCostRows(
		assignmentRows,
		employeeIndex,
		userMaps.userToEmployee,
		userMaps.userEmailToEmployee,
		salaryGrouped,
		fyYear
	);

	const employee_rows = buildCompanyEmployeeFYRows(rows);
	const project_rows = buildCompanyProjectFYRows(rows);
	const totals = buildCompanyCostTotals(rows);

	const projectSet = new Set<string>();
	const employeeSet = new Set<number>();
	for (const r of rows) {
		employeeSet.add(r.employee_id);
		const pk =
			r.project_id != null
				? String(r.project_id)
				: r.project_code || r.project_name;
		projectSet.add(pk);
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

/** Fetch company-wide monthly data for a single YYYY-MM */
export async function fetchMonthlyCompanyCost(
	month: string
): Promise<MonthlyCompanyCostData | null> {
	if (!/^\d{4}-\d{2}$/.test(month)) return null;
	const y = Number(month.slice(0, 4));
	const m = Number(month.slice(5, 7));
	if (!y || m < 1 || m > 12) return null;

	const [employeeIndex, userMaps, salaryGrouped, assignmentRows] =
		await Promise.all([
			loadEmployeeIndex(),
			loadUserMaps(),
			loadSalaryProfilesGrouped(),
			loadAllAssignmentRows(),
		]);

	const rows = buildMonthlyCompanyRows(
		assignmentRows,
		employeeIndex,
		userMaps.userToEmployee,
		userMaps.userEmailToEmployee,
		salaryGrouped,
		month
	);

	// Build aggregated employee and project rows for the month
	const empGrouped = new Map<
		number,
		(typeof rows)[number] & { project_count: number } & {
			_projSet: Set<string>;
		}
	>();
	const projGrouped = new Map<
		string,
		{
			hours: number;
			cost: number;
			project_id: number | null;
			project_code: string;
			project_name: string;
			client_name: string;
			_empSet: Set<number>;
		}
	>();

	let totalHours = R(0);
	let totalCost = R(0);
	const empSet = new Set<number>();
	const projSet = new Set<string>();

	for (const r of rows) {
		totalHours = add(totalHours, r.hours);
		totalCost = add(totalCost, r.cost);
		empSet.add(r.employee_id);
		const pk =
			r.project_id != null
				? String(r.project_id)
				: r.project_code || r.project_name;
		projSet.add(pk);

		// employee aggregation
		let eg = empGrouped.get(r.employee_id) as unknown as {
			hours: number;
			cost: number;
			_projSet: Set<string>;
			employee_id: number;
			employee_code: string;
			employee_name: string;
			department: string | null;
			designation: string | null;
			hourly_rate: number;
		} & Record<string, unknown>;
		if (!eg) {
			eg = {
				employee_id: r.employee_id,
				employee_code: r.employee_code,
				employee_name: r.employee_name,
				department: r.department,
				designation: r.designation,
				hourly_rate: r.hourly_rate,
				hours: 0,
				cost: 0,
				_projSet: new Set<string>(),
			} as unknown as typeof eg;
			empGrouped.set(
				r.employee_id,
				eg as unknown as typeof empGrouped extends Map<number, infer V>
					? V
					: never
			);
		}
		eg.hours = round2(eg.hours + r.hours);
		eg.cost = round2(eg.cost + r.cost);
		eg._projSet.add(pk);
		// keep blended? For monthly we keep first rate, but could compute weighted avg
		// hourly_rate stays as profile rate, not blended across projects (same employee same rate)

		// project aggregation
		let pg = projGrouped.get(pk);
		if (!pg) {
			pg = {
				project_id: r.project_id,
				project_code: r.project_code,
				project_name: r.project_name,
				client_name: r.client_name,
				hours: 0,
				cost: 0,
				_empSet: new Set<number>(),
			};
			projGrouped.set(pk, pg);
		}
		pg.hours = round2(pg.hours + r.hours);
		pg.cost = round2(pg.cost + r.cost);
		pg._empSet.add(r.employee_id);
	}

	const totalHoursNum = round2(toNumber(totalHours));
	const totalCostNum = round2(toNumber(totalCost));

	const employee_rows = Array.from(empGrouped.values())
		.map((g) => ({
			sr_no: 0,
			employee_id: (g as unknown as { employee_id: number }).employee_id,
			employee_code: (g as unknown as { employee_code: string }).employee_code,
			employee_name: (g as unknown as { employee_name: string }).employee_name,
			department: (g as unknown as { department: string | null }).department,
			designation: (g as unknown as { designation: string | null }).designation,
			hourly_rate: (g as unknown as { hourly_rate: number }).hourly_rate,
			hours: (g as unknown as { hours: number }).hours,
			cost: (g as unknown as { cost: number }).cost,
			project_count: (g as unknown as { _projSet: Set<string> })._projSet.size,
		}))
		.sort((a, b) => a.employee_name.localeCompare(b.employee_name))
		.map((r, i) => ({ ...r, sr_no: i + 1 }));

	const project_rows = Array.from(projGrouped.values())
		.map((g) => ({
			sr_no: 0,
			project_id: g.project_id,
			project_code: g.project_code,
			project_name: g.project_name,
			client_name: g.client_name,
			hours: g.hours,
			cost: g.cost,
			employee_count: g._empSet.size,
		}))
		.sort(
			(a, b) =>
				a.project_code.localeCompare(b.project_code) ||
				a.project_name.localeCompare(b.project_name)
		)
		.map((r, i) => ({ ...r, sr_no: i + 1 }));

	rows.forEach((r, i) => (r.sr_no = i + 1)); // ensure sr_no already, but reaffirm

	const fyYear = m >= 4 ? y : y - 1;

	return {
		month,
		month_label: monthLabel(month),
		fy_label: formatFyLabel(fyYear),
		fy_year: fyYear,
		rows,
		employee_rows,
		project_rows,
		totals: {
			total_hours: totalHoursNum,
			total_cost: totalCostNum,
			blended_rate:
				totalHoursNum > 0
					? round2(
							toNumber(div(R(totalCostNum), totalHoursNum).toDecimalPlaces(2))
						)
					: 0,
			employee_count: empSet.size,
			project_count: projSet.size,
		},
	};
}
