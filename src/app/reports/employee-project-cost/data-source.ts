/**
 * Server-side data fetch + pure transforms for the Employee Project Cost
 * report — a consolidated per-employee view of monthly cost across every
 * project they have worked on.
 *
 * Shared by:
 *   - GET /api/reports/employee-project-cost          (JSON, route.ts)
 *   - GET /api/reports/employee-project-cost/download (Excel, download/route.ts)
 *
 * Calculation (mirrors the Manhours Billing report's conventions):
 * - Hours: `user_activity_assignments.daily_entries` timesheet logs (the same
 *   source behind ProjectActivityAssignments.jsx), bucketed into the twelve
 *   financial-year months (Apr–Mar).
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

/** Employees + FY options for the filter bar. */
export interface CostMeta {
	employees: CostEmployee[];
	financial_years: FinancialYearOption[];
	current_fy: number;
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

// ─── Server data fetch ──────────────────────────────────────────────

/** Employees + financial years for the filter bar. */
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
