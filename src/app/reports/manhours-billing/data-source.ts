/**
 * Server-side data fetch + pure transforms for the Manhours Billing report.
 *
 * Shared by:
 *   - GET /api/reports/manhours-billing          (JSON, route.ts)
 *   - GET /api/reports/manhours-billing/download (Excel, download/route.ts)
 *
 * The report bills one client project for one month: every employee who
 * logged manhours on that project appears as a row with their per-hour
 * charges (company rate), the billed amount, TDS + net payable, the Accent
 * rate billed to the client and its amount, and the P&L (profit) columns.
 * Mirrors the company's Excel manhours billing template (Client Name /
 * Project Name-Number / Month-Year header with a
 * Sr. No. | Employee Name | Designation | Total Manhours | Employee
 * Charges | Amount | TDS | Net Payable | Accent Charges | Amount |
 * P&L (After Deductions | TDS) grid).
 *
 * Rates come from `projects.project_manhours_list` (the Project Manhours
 * tab's RT/HR Company + RT/HR Accent columns), falling back to the
 * salary-profile-derived hourly rate for the company rate. TDS uses the
 * profile's `tds_percentage` (default 10%, payroll's convention).
 *
 * Hourly-rate conventions mirror `EditProjectForm`'s salary-profile lookup:
 *   - salary_type 'hourly'  → the profile's stored hourly_rate
 *   - salary_type 'daily'   → the profile's stored daily_rate
 *   - salary_type 'custom'  → hourly_rate parsed from lumpsum_description,
 *                             else the stored hourly_rate
 *   - anything else (monthly) → gross / (std_working_days × std_hours_per_day)
 *
 * Money arithmetic goes through `@/lib/money` (decimal.js) — never raw
 * float operators on currency.
 */

import { query } from '@/utils/database';
import { R, mul, sub, pctOf, toNumber } from '@/lib/money';

// ─── Public types ───────────────────────────────────────────────────

export interface BillingProject {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string;
}

export interface BillingMeta {
	/** Distinct client names, sorted */
	clients: string[];
	/** All projects that carry a client name */
	projects: BillingProject[];
	/** YYYY-MM months that have logged project hours or attendance, newest first */
	months: string[];
	/** Newest month with data, or the current month */
	latest_month: string | null;
}

export interface BillingEmployeeRow {
	sr_no: number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	/** Hourly rate the company charges for the employee (RT/HR Company) in INR */
	employee_charges: number;
	/** Manhours logged on the project during the month */
	total_manhours: number;
	/** employee_charges × total_manhours, 2dp */
	amount: number;
	/** TDS percentage applied to the employee amount (profile tds_percentage, default 10) */
	tds_rate: number;
	/** amount × tds_rate / 100, 2dp */
	tds: number;
	/** amount − tds, 2dp */
	net_payable: number;
	/** Hourly rate Accent bills the client (RT/HR Accent) in INR */
	accent_charges: number;
	/** accent_charges × total_manhours, 2dp */
	accent_amount: number;
	/** accent_amount − net_payable, 2dp — profit after the employee's deductions */
	pnl_after_deductions: number;
	/** accent_amount − amount, 2dp — gross margin before the employee's TDS */
	pnl_tds: number;
}

export interface BillingData {
	client_name: string;
	project: {
		project_id: number;
		project_code: string;
		project_name: string;
	};
	/** YYYY-MM */
	month: string;
	/** e.g. "August 2026" */
	month_label: string;
	year: number;
	rows: BillingEmployeeRow[];
	totals: {
		total_manhours: number;
		total_amount: number;
		total_tds: number;
		total_net_payable: number;
		total_accent_amount: number;
		total_pnl_after_deductions: number;
		total_pnl_tds: number;
	};
}

/** Salary-profile shape used for rate resolution (from employee_salary_profile). */
export interface SalaryProfile {
	employee_id: number;
	gross: number;
	gross_salary: number;
	employer_cost: number;
	hourly_rate: number;
	daily_rate: number;
	std_hours_per_day: number;
	std_working_days: number;
	salary_type: string;
	tds_percentage: number;
	effective_from: string | null;
	effective_to: string | null;
}

/** Per-employee rates from `projects.project_manhours_list` (annual format). */
export interface ProjectManhourConfig {
	/** RT/HR (Company) — the rate the company charges for the employee */
	rate_company: number;
	/** RT/HR (Accent) — the rate Accent bills the client */
	rate_accent: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const MONTH_NAMES = [
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

// mysql2 rows are plain objects keyed by column name; read them through
// narrow accessors so we never reach for `any`.
type DbRow = Record<string, unknown>;

function s(row: DbRow, key: string, fallback = ''): string {
	const v = row[key];
	if (v == null) return fallback;
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return fallback;
}

function n(row: DbRow, key: string, fallback = 0): number {
	const v = row[key];
	if (v == null || v === '') return fallback;
	const num = typeof v === 'number' ? v : parseFloat(String(v));
	return Number.isFinite(num) ? num : fallback;
}

function toNum(v: unknown, fallback = 0): number {
	if (v == null || v === '') return fallback;
	const num = typeof v === 'number' ? v : parseFloat(String(v));
	return Number.isFinite(num) ? num : fallback;
}

function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

interface DailyEntryShape {
	date?: string | null;
	hours?: number | string | null;
}

export function parseDailyEntries(raw: unknown): DailyEntryShape[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(e): e is DailyEntryShape => !!e && typeof e === 'object' && 'date' in e
		);
	} catch {
		return [];
	}
}

/**
 * Sum the hours logged by one assignment during `month` (YYYY-MM).
 * Entries outside the month are dropped; hours ≤ 0 are ignored.
 */
export function sumMonthlyHours(
	raw: unknown,
	month: string
): { total_hours: number; has_entries: boolean } {
	let total = 0;
	let hasEntries = false;
	for (const entry of parseDailyEntries(raw)) {
		const date = typeof entry.date === 'string' ? entry.date : '';
		if (!date || date < `${month}-01` || date > `${month}-31`) continue;
		const hours = toNum(entry.hours);
		if (hours <= 0) continue;
		total += hours;
		hasEntries = true;
	}
	return { total_hours: round2(total), has_entries: hasEntries };
}

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (!y || !m || m < 1 || m > 12) return month;
	return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** Monthly salary CTC for a profile: gross_salary, else gross, else employer_cost. */
export function resolveMonthlySalary(profile: SalaryProfile): number {
	return profile.gross_salary || profile.gross || profile.employer_cost;
}

/**
 * Unrounded hourly rate for a profile — the billing amount is computed from
 * this so totals stay exact (the template shows 83.33 yet bills
 * 16,666.67 = 83.333… × 200). Mirror of EditProjectForm's lookup:
 * hourly/custom use the stored hourly rate, monthly divides the gross
 * salary by (std_working_days × std_hours_per_day).
 */
export function computeRawHourlyRate(profile: SalaryProfile): number {
	const type = (profile.salary_type || 'monthly').toLowerCase();
	if (type === 'hourly') return profile.hourly_rate;
	if (type === 'daily') return profile.daily_rate;
	if (type === 'custom') return profile.hourly_rate;
	const gross = resolveMonthlySalary(profile);
	if (gross <= 0) return 0;
	const days = profile.std_working_days > 0 ? profile.std_working_days : 26;
	const hoursPerDay =
		profile.std_hours_per_day > 0 ? profile.std_hours_per_day : 8;
	return gross / (days * hoursPerDay);
}

/** Display rate: the raw rate rounded to 2dp. */
export function resolveHourlyRate(profile: SalaryProfile): number {
	return Math.round(computeRawHourlyRate(profile) * 100) / 100;
}

/**
 * Pick the salary profile in force for `month` (YYYY-MM): prefer an active
 * profile whose effective range covers the month, falling back to the
 * latest active profile (payroll's convention).
 */
export function pickActiveProfile(
	profiles: SalaryProfile[],
	month: string
): SalaryProfile | null {
	if (profiles.length === 0) return null;
	const monthStart = `${month}-01`;
	// Month end: last day of the month (31 covers any month; range checks
	// are lexicographic on YYYY-MM-DD).
	const monthEnd = `${month}-31`;
	const covering = profiles.filter((p) => {
		if (p.effective_from && p.effective_from > monthEnd) return false;
		if (p.effective_to && p.effective_to < monthStart) return false;
		return true;
	});
	if (covering.length > 0) {
		return covering.sort((a, b) =>
			(b.effective_from || '').localeCompare(a.effective_from || '')
		)[0];
	}
	return (
		[...profiles].sort((a, b) =>
			(b.effective_from || '').localeCompare(a.effective_from || '')
		)[0] || null
	);
}

/**
 * Build billing rows from raw assignment rows for one project + month.
 *
 * `employeeIndex` maps employee id → { employee_id, employee_code, name,
 * designation }. Assignments are resolved to an employee via the explicit
 * `employee_id` column, else the linked login account's `employee_id`
 * (user_id → users.employee_id), else an email/username match against the
 * employee table (legacy data). Employees with no logged hours in the
 * month are dropped — a billing report only charges worked time.
 *
 * Rates: `manhoursConfig` carries the Project Manhours tab's per-employee
 * RT/HR Company + RT/HR Accent rates (keyed by employees.id). The company
 * rate falls back to the salary-profile-derived hourly rate; TDS uses the
 * profile's `tds_percentage` (10 when unset, matching payroll).
 */
export function buildBillingRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
	userToEmployee: Map<number, number>,
	userEmailUsernameToEmployee: Map<string, number>,
	salaryProfiles: SalaryProfile[],
	manhoursConfig: Map<number, ProjectManhourConfig>,
	month: string
): BillingEmployeeRow[] {
	const hoursByEmployee = new Map<number, number>();
	const idByAssignment = new Map<string, number | null>();

	for (const row of assignmentRows) {
		const assignmentId = s(row, 'id');
		const direct = n(row, 'employee_id', 0) || null;
		const userId = n(row, 'user_id', 0) || null;
		const viaUser = userId ? (userToEmployee.get(userId) ?? null) : null;
		const email = s(row, 'user_email').toLowerCase();
		const username = s(row, 'user_username').toLowerCase();
		const viaContact =
			userEmailUsernameToEmployee.get(email) ??
			userEmailUsernameToEmployee.get(username) ??
			null;
		const employeeId = direct || viaUser || viaContact;
		idByAssignment.set(assignmentId, employeeId);
	}

	// Sum hours per employee across every assignment on the project.
	for (const row of assignmentRows) {
		const assignmentId = s(row, 'id');
		const employeeId = idByAssignment.get(assignmentId);
		if (employeeId == null) continue;
		const { total_hours } = sumMonthlyHours(row.daily_entries, month);
		if (total_hours <= 0) continue;
		hoursByEmployee.set(
			employeeId,
			round2((hoursByEmployee.get(employeeId) || 0) + total_hours)
		);
	}

	const rows: BillingEmployeeRow[] = [];
	for (const [employeeId, manhours] of hoursByEmployee) {
		const employee = employeeIndex.get(employeeId);
		if (!employee) continue;
		const profile = pickActiveProfile(
			salaryProfiles.filter((p) => p.employee_id === employeeId),
			month
		);
		// Project-config rates win; the company rate falls back to the
		// salary-derived hourly rate (RT/HR Company auto-fills from it).
		const config = manhoursConfig.get(employeeId);
		const configRate =
			config && config.rate_company > 0 ? config.rate_company : 0;
		const fallbackRate = profile ? resolveHourlyRate(profile) : 0;
		const rawFallbackRate = profile ? computeRawHourlyRate(profile) : 0;
		const employeeCharges = configRate || fallbackRate;
		// Bill from the unrounded rate so totals stay exact (the grid shows
		// the rounded rate) — same convention as the old template.
		const billingRate = configRate || rawFallbackRate;
		const accentCharges = config?.rate_accent ?? 0;
		const tdsRate = profile?.tds_percentage || 10;

		const amount = toNumber(mul(R(billingRate), manhours).toDecimalPlaces(2));
		const tds = toNumber(pctOf(amount, tdsRate));
		const netPayable = toNumber(sub(R(amount), R(tds)).toDecimalPlaces(2));
		const accentAmount = toNumber(
			mul(R(accentCharges), manhours).toDecimalPlaces(2)
		);
		const pnlAfterDeductions = toNumber(
			sub(R(accentAmount), R(netPayable)).toDecimalPlaces(2)
		);
		const pnlTds = toNumber(sub(R(accentAmount), R(amount)).toDecimalPlaces(2));

		rows.push({
			sr_no: 0, // assigned after sorting
			employee_id: employeeId,
			employee_code: employee.employee_code,
			employee_name: employee.name,
			designation: employee.designation,
			employee_charges: employeeCharges,
			total_manhours: manhours,
			amount,
			tds_rate: tdsRate,
			tds,
			net_payable: netPayable,
			accent_charges: accentCharges,
			accent_amount: accentAmount,
			pnl_after_deductions: pnlAfterDeductions,
			pnl_tds: pnlTds,
		});
	}

	rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	return rows;
}

export function buildTotals(rows: BillingEmployeeRow[]): {
	total_manhours: number;
	total_amount: number;
	total_tds: number;
	total_net_payable: number;
	total_accent_amount: number;
	total_pnl_after_deductions: number;
	total_pnl_tds: number;
} {
	let manhours = 0;
	let amount = 0;
	let tds = 0;
	let netPayable = 0;
	let accentAmount = 0;
	let pnlAfterDeductions = 0;
	let pnlTds = 0;
	for (const row of rows) {
		manhours += row.total_manhours;
		amount += row.amount;
		tds += row.tds;
		netPayable += row.net_payable;
		accentAmount += row.accent_amount;
		pnlAfterDeductions += row.pnl_after_deductions;
		pnlTds += row.pnl_tds;
	}
	return {
		total_manhours: round2(manhours),
		total_amount: round2(amount),
		total_tds: round2(tds),
		total_net_payable: round2(netPayable),
		total_accent_amount: round2(accentAmount),
		total_pnl_after_deductions: round2(pnlAfterDeductions),
		total_pnl_tds: round2(pnlTds),
	};
}

// ─── Server data fetch ──────────────────────────────────────────────

interface EmployeeLookup {
	employee_id: number;
	employee_code: string;
	name: string;
	designation: string;
}

/** Clients + projects + months for the filter bar. */
export async function fetchBillingMeta(): Promise<BillingMeta> {
	const [projectRows] = (await query(
		`SELECT project_id, project_code,
		        COALESCE(NULLIF(project_title, ''), NULLIF(name, ''), '') AS project_name,
		        client_name
		 FROM projects
		 WHERE isDelete = 0
		   AND client_name IS NOT NULL AND client_name <> ''
		 ORDER BY client_name, project_code, project_id`
	)) as [DbRow[], unknown];

	const clientsSet = new Set<string>();
	const projects: BillingProject[] = [];
	for (const row of projectRows) {
		const clientName = s(row, 'client_name');
		if (!clientName) continue;
		clientsSet.add(clientName);
		projects.push({
			project_id: n(row, 'project_id'),
			project_code: s(row, 'project_code'),
			project_name:
				s(row, 'project_name') || `Project #${s(row, 'project_id')}`,
			client_name: clientName,
		});
	}

	let months: string[] = [];
	try {
		const [monthRows] = (await query(
			`SELECT DATE_FORMAT(attendance_date, '%Y-%m') AS month
			 FROM employee_attendance
			 GROUP BY month
			 ORDER BY month DESC`
		)) as [DbRow[], unknown];
		months = monthRows.map((r) => s(r, 'month')).filter(Boolean);
	} catch {
		/* employee_attendance may be empty — treat as no months */
	}

	// Union in months with logged project hours so a billing month is
	// reachable even when no attendance was entered for it.
	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		const monthSet = new Set(months);
		for (const row of asgRows) {
			for (const entry of parseDailyEntries(row.daily_entries)) {
				const date = typeof entry.date === 'string' ? entry.date : '';
				if (date.length >= 7) monthSet.add(date.slice(0, 7));
			}
		}
		// YYYY-MM sorts lexically, so reverse() = newest first.
		months = Array.from(monthSet).sort().reverse();
	} catch {
		/* user_activity_assignments may not exist */
	}

	// Always offer the current month.
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	if (!months.includes(currentMonth)) months.push(currentMonth);

	return {
		clients: Array.from(clientsSet).sort((a, b) => a.localeCompare(b)),
		projects,
		months,
		latest_month: months[0] ?? currentMonth,
	};
}

/** Full billing payload for one project + month. */
export async function fetchBillingData(
	projectId: number,
	month: string
): Promise<BillingData | null> {
	const [projectRows] = (await query(
		`SELECT project_id, project_code,
		        COALESCE(NULLIF(project_title, ''), NULLIF(name, ''), '') AS project_name,
		        client_name, project_manhours_list
		 FROM projects
		 WHERE project_id = ? AND isDelete = 0`,
		[projectId]
	)) as [DbRow[], unknown];
	if (projectRows.length === 0) return null;

	const project = projectRows[0];

	// ── Per-employee rates from the Project Manhours tab ────────────
	// project_manhours_list is a JSON array of annual rows like
	// { employee_id, source_employee_id, rate_company, rate_accent, ... }.
	// Keyed by employees.id via source_employee_id (internal members) with
	// a fallback to employee_id (the tab stores String(employees.id)).
	const manhoursConfig = new Map<number, ProjectManhourConfig>();
	try {
		const raw = project.project_manhours_list;
		if (raw) {
			const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
			if (Array.isArray(parsed)) {
				for (const entry of parsed) {
					if (!entry || typeof entry !== 'object') continue;
					const employeeId =
						toNum(entry.source_employee_id) || toNum(entry.employee_id);
					if (!employeeId) continue;
					manhoursConfig.set(employeeId, {
						rate_company: toNum(entry.rate_company),
						rate_accent: toNum(entry.rate_accent),
					});
				}
			}
		}
	} catch {
		/* malformed JSON — treat as no rates configured */
	}

	// ── Employees + login-account links (for resolving assignments) ──
	const employeeIndex = new Map<number, EmployeeLookup>();
	const userToEmployee = new Map<number, number>();
	const userEmailUsernameToEmployee = new Map<string, number>();
	try {
		const [empRows] = (await query(
			`SELECT id, employee_id,
			        CONCAT_WS(' ', first_name, last_name) AS name,
			        email, username, position, designation
			 FROM employees
			 WHERE isDelete = 0`
		)) as [DbRow[], unknown];
		for (const emp of empRows) {
			const id = n(emp, 'id');
			if (!id) continue;
			employeeIndex.set(id, {
				employee_id: id,
				employee_code: s(emp, 'employee_id'),
				name: s(emp, 'name') || `Employee ${id}`,
				designation: s(emp, 'position') || s(emp, 'designation') || '',
			});
			const email = s(emp, 'email').toLowerCase();
			const username = s(emp, 'username').toLowerCase();
			if (email) userEmailUsernameToEmployee.set(email, id);
			if (username) userEmailUsernameToEmployee.set(username, id);
		}
	} catch {
		/* employees table unavailable */
	}
	try {
		const [userRows] = (await query(
			`SELECT id, employee_id, email, username FROM users`
		)) as [DbRow[], unknown];
		for (const u of userRows) {
			const userId = n(u, 'id');
			const empId = n(u, 'employee_id', 0);
			if (userId && empId) userToEmployee.set(userId, empId);
		}
	} catch {
		/* users table unavailable */
	}

	// ── Salary profiles (active only) ────────────────────────────────
	const salaryProfiles: SalaryProfile[] = [];
	try {
		const [profileRows] = (await query(
			`SELECT employee_id, gross, gross_salary, employer_cost,
			        hourly_rate, daily_rate, std_hours_per_day, std_working_days,
			        salary_type, tds_percentage,
			        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
			        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
			 FROM employee_salary_profile
			 WHERE is_active = 1`
		)) as [DbRow[], unknown];
		for (const p of profileRows) {
			const employeeId = n(p, 'employee_id');
			if (!employeeId) continue;
			salaryProfiles.push({
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
			});
		}
	} catch {
		/* table may not exist */
	}

	// ── Assignments for the project (carry the manhours) ─────────────
	let assignmentRows: DbRow[] = [];
	try {
		const [rows] = (await query(
			`SELECT uaa.id, uaa.user_id, uaa.employee_id, uaa.daily_entries,
			        u.email AS user_email, u.username AS user_username
			 FROM user_activity_assignments uaa
			 LEFT JOIN users u ON u.id = uaa.user_id
			 WHERE uaa.project_id = ?
			   AND uaa.status <> 'Cancelled'
			 ORDER BY uaa.updated_at DESC`,
			[projectId]
		)) as [DbRow[], unknown];
		assignmentRows = rows;
	} catch {
		/* table may not exist */
	}

	const rows = buildBillingRows(
		assignmentRows,
		employeeIndex,
		userToEmployee,
		userEmailUsernameToEmployee,
		salaryProfiles,
		manhoursConfig,
		month
	);

	const y = Number(month.split('-')[0]);
	return {
		client_name: s(project, 'client_name'),
		project: {
			project_id: n(project, 'project_id'),
			project_code: s(project, 'project_code'),
			project_name:
				s(project, 'project_name') || `Project #${s(project, 'project_id')}`,
		},
		month,
		month_label: monthLabel(month),
		year: y || 0,
		rows,
		totals: buildTotals(rows),
	};
}
