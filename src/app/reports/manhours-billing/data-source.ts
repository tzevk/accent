/**
 * Server-side data fetch + pure transforms for the Manhours Billing report.
 *
 * Architecture:
 * - Pure transform functions at the top (unit-tested in data-source.test.ts).
 * - Server fetchers at the bottom (fetchBillingMeta, fetchBillingData,
 *   fetchAnnualBillingData).
 * - Money math goes through @/lib/money (Decimal.js) — no raw float math.
 *
 * Supports two viewing modes:
 * 1. Monthly Billing Statement: Detailed client invoice breakdown (Sr No,
 *    Employee/Member, Designation, Total Manhours, Employee Charges,
 *    Amount, TDS, Net Payable, Accent Charges, Accent Amount, P&L After
 *    Deductions & TDS).
 * 2. Annual FY Deputation Matrix: 12-month Financial Year (Apr–Mar) grid
 *    matching ProjectManhoursTab.jsx for deputation staff & team tracking.
 *
 * Smart Data Resolution:
 * - Pulls hours from `projects.project_manhours_list` (Project Manhours tab,
 *   including external/vendor members and deputation resources) AND
 *   `user_activity_assignments.daily_entries` (timesheet daily task logs).
 */

import type Decimal from 'decimal.js';
import { query } from '@/utils/database';
import { R, mul, sub, add, pctOf, toNumber, gt } from '@/lib/money';

// ─── Public types ───────────────────────────────────────────────────

export interface BillingProject {
	project_id: number;
	project_code: string;
	project_name: string;
	client_name: string;
}

export interface FinancialYearOption {
	year: number; // e.g. 2026 for FY 2026–27
	label: string; // e.g. "FY 2026–27"
}

export interface BillingMeta {
	clients: string[];
	projects: BillingProject[];
	months: string[];
	latest_month: string | null;
	financial_years: FinancialYearOption[];
	current_fy: number;
}

export interface BillingEmployeeRow {
	sr_no: number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	employee_charges: number;
	total_manhours: number;
	amount: number;
	tds_rate: number;
	tds: number;
	net_payable: number;
	accent_charges: number;
	accent_amount: number;
	pnl_after_deductions: number;
	pnl_tds: number;
}

export interface BillingData {
	client_name: string;
	project: {
		project_id: number;
		project_code: string;
		project_name: string;
	};
	month: string;
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

export interface AnnualEmployeeRow {
	sr_no: number;
	id: string | number;
	employee_id: number | null;
	employee_code: string;
	employee_name: string;
	designation: string;
	salary_type: string;
	rate_company: number;
	rate_accent: number;
	monthly_hours: Record<string, number>;
	total_hours: number;
	company_cost: number;
	accent_cost: number;
	pnl: number;
}

export interface AnnualBillingData {
	client_name: string;
	project: {
		project_id: number;
		project_code: string;
		project_name: string;
	};
	fy_label: string;
	fy_year: number;
	months: string[];
	month_keys: string[];
	rows: AnnualEmployeeRow[];
	totals: {
		monthly_hours: Record<string, number>;
		total_hours: number;
		total_company_cost: number;
		total_accent_cost: number;
		total_pnl: number;
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
	rate_company: number;
	rate_accent: number;
}

/** Raw shape of an item in `projects.project_manhours_list`. */
export interface ProjectManhourTabRow {
	id?: number | string;
	employee_id?: number | string;
	source_employee_id?: number | string;
	employee_name?: string;
	salary_type?: string;
	rate_company?: number | string;
	rate_accent?: number | string;
	monthly_hours?: Record<string, number | string>;
}

// ─── Constants ──────────────────────────────────────────────────────

export const FY_MONTHS = [
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
	'Jan',
	'Feb',
	'Mar',
] as const;

export const FY_MONTH_KEYS = [
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec',
	'jan',
	'feb',
	'mar',
] as const;

export const MONTH_TO_KEY: Record<string, string> = {
	'01': 'jan',
	'02': 'feb',
	'03': 'mar',
	'04': 'apr',
	'05': 'may',
	'06': 'jun',
	'07': 'jul',
	'08': 'aug',
	'09': 'sep',
	'10': 'oct',
	'11': 'nov',
	'12': 'dec',
};

export const MONTH_NAMES = [
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

function toNum(v: unknown, fallback = 0): number {
	if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
	if (typeof v === 'string') {
		const parsed = Number(v);
		return Number.isFinite(parsed) ? parsed : fallback;
	}
	return fallback;
}

export function round2(v: number): number {
	return Math.round(v * 100) / 100;
}

export function monthToKey(monthStr: string): string {
	if (!monthStr) return '';
	const mm = monthStr.includes('-') ? monthStr.split('-')[1] : monthStr;
	return MONTH_TO_KEY[mm] || '';
}
export function getFinancialYear(date: Date = new Date()): number {
	const month = date.getMonth() + 1; // 1-12
	const year = date.getFullYear();
	return month >= 4 ? year : year - 1;
}

export function formatFyLabel(fyStartYear: number): string {
	const nextShort = String(fyStartYear + 1).slice(-2);
	return `FY ${fyStartYear}–${nextShort}`;
}

export function parseProjectManhoursList(raw: unknown): ProjectManhourTabRow[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item) => item && typeof item === 'object');
	} catch {
		return [];
	}
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

interface DailyEntryShape {
	date?: string;
	hours?: number;
	qty_done?: number;
	remarks?: string;
}

export function parseDailyEntries(raw: unknown): DailyEntryShape[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(entry) =>
				entry &&
				typeof entry === 'object' &&
				typeof (entry as DailyEntryShape).date === 'string'
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
	const entries = parseDailyEntries(raw);
	let total = 0;
	let hasEntries = false;
	for (const entry of entries) {
		if (typeof entry.date === 'string' && entry.date.startsWith(month)) {
			const h = toNum(entry.hours);
			if (h > 0) {
				total += h;
				hasEntries = true;
			}
		}
	}
	return { total_hours: round2(total), has_entries: hasEntries };
}

export function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/** Monthly salary CTC for a profile: gross_salary, else gross, else employer_cost. */
export function resolveMonthlySalary(profile: SalaryProfile): number {
	return profile.gross_salary || profile.gross || profile.employer_cost;
}

/**
 * Unrounded hourly rate for a profile — the billing amount is computed from
 * this unrounded value (e.g. 20000 / 208 = 96.1538...) so that multiplying by
 * hours gives the exact salary-apportioned sum matching the Excel template,
 * while the display rate is rounded to 2dp via resolveHourlyRate.
 */
export function computeRawHourlyRate(profile: SalaryProfile): number {
	if (profile.salary_type === 'hourly' && profile.hourly_rate > 0) {
		return profile.hourly_rate;
	}
	if (profile.salary_type === 'daily' && profile.daily_rate > 0) {
		return profile.daily_rate;
	}
	if (profile.salary_type === 'custom' && profile.hourly_rate > 0) {
		return profile.hourly_rate;
	}
	const monthly = resolveMonthlySalary(profile);
	const days = profile.std_working_days > 0 ? profile.std_working_days : 26;
	const hoursPerDay =
		profile.std_hours_per_day > 0 ? profile.std_hours_per_day : 8;
	const totalHours = days * hoursPerDay;
	return totalHours > 0 ? monthly / totalHours : 0;
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
	if (!profiles || profiles.length === 0) return null;
	const [y, m] = month.split('-').map(Number);
	if (!y || !m) return profiles[0];

	// Month date range: YYYY-MM-01 through end of month.
	const monthStart = `${month}-01`;
	const lastDay = new Date(y, m, 0).getDate();
	const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

	const covering = profiles.find((p) => {
		const from = p.effective_from || '1970-01-01';
		const to = p.effective_to || '9999-12-31';
		return from <= monthEnd && to >= monthStart;
	});
	if (covering) return covering;

	return (
		[...profiles].sort((a, b) =>
			(b.effective_from || '').localeCompare(a.effective_from || '')
		)[0] || null
	);
}

export interface EmployeeLookup {
	employee_id: number;
	employee_code: string;
	name: string;
	designation: string;
}

interface PersonBillingAccumulator {
	key: string;
	employeeId: number | null;
	employeeCode: string;
	employeeName: string;
	designation: string;
	hours: number;
	rateCompany: number;
	rateAccent: number;
	tdsRate: number;
}

/**
 * Build billing rows from raw assignment rows and Project Manhours tab data
 * for one project + month.
 */
export function buildBillingRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
	userToEmployee: Map<number, number>,
	userEmailUsernameToEmployee: Map<string, number>,
	salaryProfiles: SalaryProfile[],
	manhoursConfig: Map<number, ProjectManhourConfig>,
	month: string,
	tabEntries: ProjectManhourTabRow[] = []
): BillingEmployeeRow[] {
	const monthKey = monthToKey(month);
	const peopleMap = new Map<string, PersonBillingAccumulator>();

	// 1. Process Project Manhours Tab entries first (direct hours for the month)
	for (const entry of tabEntries) {
		if (!entry) continue;
		const rawEmpId = entry.source_employee_id ?? entry.employee_id;
		const numEmpId = toNum(rawEmpId);
		const isInternal = numEmpId > 0 && employeeIndex.has(numEmpId);
		const internalEmp = isInternal ? employeeIndex.get(numEmpId) : null;

		const key = String(entry.employee_id || entry.id || numEmpId);
		const employeeName =
			entry.employee_name || internalEmp?.name || `Member ${key}`;
		const employeeCode =
			internalEmp?.employee_code ||
			(typeof entry.employee_id === 'string' &&
			!entry.employee_id.startsWith('team:')
				? entry.employee_id
				: '');
		const designation =
			internalEmp?.designation ||
			(entry.salary_type === 'custom'
				? 'External / Deputation'
				: 'Deputation Member');

		const tabHours = entry.monthly_hours
			? toNum(entry.monthly_hours[monthKey])
			: 0;
		const rateCompany = toNum(entry.rate_company);
		const rateAccent = toNum(entry.rate_accent);

		peopleMap.set(key, {
			key,
			employeeId: isInternal ? numEmpId : null,
			employeeCode,
			employeeName,
			designation,
			hours: tabHours,
			rateCompany,
			rateAccent,
			tdsRate: 10,
		});
	}

	// 2. Process assignment rows (timesheet daily task entries)
	const assignmentHoursByEmployee = new Map<number, number>();
	for (const row of assignmentRows) {
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
		if (employeeId == null) continue;

		const { total_hours } = sumMonthlyHours(row.daily_entries, month);
		if (total_hours <= 0) continue;
		assignmentHoursByEmployee.set(
			employeeId,
			round2((assignmentHoursByEmployee.get(employeeId) || 0) + total_hours)
		);
	}

	// Merge assignment hours if tab had 0 hours or if employee was only in assignments
	for (const [employeeId, asgHours] of assignmentHoursByEmployee) {
		const existingKey = String(employeeId);
		const existing = peopleMap.get(existingKey);
		if (existing) {
			if (existing.hours <= 0 && asgHours > 0) {
				existing.hours = asgHours;
			}
		} else {
			const emp = employeeIndex.get(employeeId);
			if (emp) {
				const config = manhoursConfig.get(employeeId);
				peopleMap.set(existingKey, {
					key: existingKey,
					employeeId,
					employeeCode: emp.employee_code,
					employeeName: emp.name,
					designation: emp.designation,
					hours: asgHours,
					rateCompany: config ? config.rate_company : 0,
					rateAccent: config ? config.rate_accent : 0,
					tdsRate: 10,
				});
			}
		}
	}

	// 3. Compute financial amounts for all people with logged hours > 0
	const rows: BillingEmployeeRow[] = [];
	for (const person of peopleMap.values()) {
		if (person.hours <= 0) continue;

		const profile = person.employeeId
			? pickActiveProfile(
					salaryProfiles.filter((p) => p.employee_id === person.employeeId),
					month
				)
			: null;

		const config = person.employeeId
			? manhoursConfig.get(person.employeeId)
			: null;
		const tabRateCompany = person.rateCompany;
		const configRate =
			config && config.rate_company > 0 ? config.rate_company : 0;
		const fallbackRate = profile ? resolveHourlyRate(profile) : 0;
		const rawFallbackRate = profile ? computeRawHourlyRate(profile) : 0;

		const employeeCharges = tabRateCompany || configRate || fallbackRate;
		const billingRate = tabRateCompany || configRate || rawFallbackRate;
		const accentCharges = person.rateAccent || config?.rate_accent || 0;
		const tdsRate = profile?.tds_percentage || person.tdsRate || 10;

		const amount = toNumber(
			mul(R(billingRate), person.hours).toDecimalPlaces(2)
		);
		const tds = toNumber(pctOf(amount, tdsRate));
		const netPayable = toNumber(sub(R(amount), R(tds)).toDecimalPlaces(2));
		const accentAmount = toNumber(
			mul(R(accentCharges), person.hours).toDecimalPlaces(2)
		);
		const pnlAfterDeductions = toNumber(
			sub(R(accentAmount), R(netPayable)).toDecimalPlaces(2)
		);
		const pnlTds = toNumber(sub(R(accentAmount), R(amount)).toDecimalPlaces(2));

		rows.push({
			sr_no: 0, // assigned after sorting
			employee_id: person.employeeId,
			employee_code: person.employeeCode,
			employee_name: person.employeeName,
			designation: person.designation,
			employee_charges: employeeCharges,
			total_manhours: person.hours,
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
	let manhours = R(0);
	let amount = R(0);
	let tds = R(0);
	let netPayable = R(0);
	let accentAmount = R(0);
	let pnlAfterDeductions = R(0);
	let pnlTds = R(0);

	for (const r of rows) {
		manhours = add(manhours, r.total_manhours);
		amount = add(amount, r.amount);
		tds = add(tds, r.tds);
		netPayable = add(netPayable, r.net_payable);
		accentAmount = add(accentAmount, r.accent_amount);
		pnlAfterDeductions = add(pnlAfterDeductions, r.pnl_after_deductions);
		pnlTds = add(pnlTds, r.pnl_tds);
	}

	return {
		total_manhours: round2(toNumber(manhours)),
		total_amount: toNumber(amount.toDecimalPlaces(2)),
		total_tds: toNumber(tds.toDecimalPlaces(2)),
		total_net_payable: toNumber(netPayable.toDecimalPlaces(2)),
		total_accent_amount: toNumber(accentAmount.toDecimalPlaces(2)),
		total_pnl_after_deductions: toNumber(pnlAfterDeductions.toDecimalPlaces(2)),
		total_pnl_tds: toNumber(pnlTds.toDecimalPlaces(2)),
	};
}

/**
 * Build 12-month Financial Year (Apr–Mar) deputation rows.
 */
export function buildAnnualBillingRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
	userToEmployee: Map<number, number>,
	userEmailUsernameToEmployee: Map<string, number>,
	salaryProfiles: SalaryProfile[],
	tabEntries: ProjectManhourTabRow[] = [],
	fyYear: number = getFinancialYear()
): AnnualEmployeeRow[] {
	const rows: AnnualEmployeeRow[] = [];
	const peopleSeen = new Set<string>();

	// FY month key to calendar month mapping
	// Apr-Dec of fyYear, Jan-Mar of fyYear+1
	const fyCalendarMonthMap: Record<string, string> = {
		apr: `${fyYear}-04`,
		may: `${fyYear}-05`,
		jun: `${fyYear}-06`,
		jul: `${fyYear}-07`,
		aug: `${fyYear}-08`,
		sep: `${fyYear}-09`,
		oct: `${fyYear}-10`,
		nov: `${fyYear}-11`,
		dec: `${fyYear}-12`,
		jan: `${fyYear + 1}-01`,
		feb: `${fyYear + 1}-02`,
		mar: `${fyYear + 1}-03`,
	};

	// 1. Process Project Manhours tab rows
	for (const entry of tabEntries) {
		if (!entry) continue;
		const rawEmpId = entry.source_employee_id ?? entry.employee_id;
		const numEmpId = toNum(rawEmpId);
		const isInternal = numEmpId > 0 && employeeIndex.has(numEmpId);
		const internalEmp = isInternal ? employeeIndex.get(numEmpId) : null;
		const key = String(entry.employee_id || entry.id || numEmpId);
		peopleSeen.add(key);

		const profile = isInternal
			? pickActiveProfile(
					salaryProfiles.filter((p) => p.employee_id === numEmpId),
					`${fyYear}-04`
				)
			: null;

		const rateCompany =
			toNum(entry.rate_company) || (profile ? resolveHourlyRate(profile) : 0);
		const rateAccent = toNum(entry.rate_accent);

		const monthlyHours: Record<string, number> = {};
		let totalHrs = R(0);
		for (const mKey of FY_MONTH_KEYS) {
			let h = entry.monthly_hours ? toNum(entry.monthly_hours[mKey]) : 0;
			// If not in tab, check daily assignments for that FY calendar month
			if (h <= 0 && isInternal) {
				const calMonth = fyCalendarMonthMap[mKey];
				for (const asg of assignmentRows) {
					const direct = n(asg, 'employee_id', 0) || null;
					const userId = n(asg, 'user_id', 0) || null;
					const viaUser = userId ? (userToEmployee.get(userId) ?? null) : null;
					const asgEmpId = direct || viaUser;
					if (asgEmpId === numEmpId) {
						const res = sumMonthlyHours(asg.daily_entries, calMonth);
						h += res.total_hours;
					}
				}
			}
			monthlyHours[mKey] = round2(h);
			totalHrs = add(totalHrs, h);
		}

		const totalHours = round2(toNumber(totalHrs));
		const companyCost = toNumber(
			mul(R(rateCompany), totalHours).toDecimalPlaces(2)
		);
		const accentCost = toNumber(
			mul(R(rateAccent), totalHours).toDecimalPlaces(2)
		);
		const pnl = toNumber(sub(R(accentCost), R(companyCost)).toDecimalPlaces(2));

		rows.push({
			sr_no: 0,
			id: entry.id || key,
			employee_id: isInternal ? numEmpId : null,
			employee_code: internalEmp?.employee_code || '',
			employee_name:
				entry.employee_name || internalEmp?.name || `Member ${key}`,
			designation:
				internalEmp?.designation ||
				(entry.salary_type === 'custom'
					? 'External / Deputation'
					: 'Deputation Member'),
			salary_type: entry.salary_type || 'monthly',
			rate_company: rateCompany,
			rate_accent: rateAccent,
			monthly_hours: monthlyHours,
			total_hours: totalHours,
			company_cost: companyCost,
			accent_cost: accentCost,
			pnl,
		});
	}

	// 2. Add any internal employees with logged assignment hours not in tab
	for (const emp of employeeIndex.values()) {
		const key = String(emp.employee_id);
		if (peopleSeen.has(key)) continue;

		const monthlyHours: Record<string, number> = {};
		let totalHrs = R(0);
		for (const mKey of FY_MONTH_KEYS) {
			const calMonth = fyCalendarMonthMap[mKey];
			let h = 0;
			for (const asg of assignmentRows) {
				const direct = n(asg, 'employee_id', 0) || null;
				const userId = n(asg, 'user_id', 0) || null;
				const viaUser = userId ? (userToEmployee.get(userId) ?? null) : null;
				const asgEmpId = direct || viaUser;
				if (asgEmpId === emp.employee_id) {
					const res = sumMonthlyHours(asg.daily_entries, calMonth);
					h += res.total_hours;
				}
			}
			monthlyHours[mKey] = round2(h);
			totalHrs = add(totalHrs, h);
		}

		if (gt(totalHrs, 0)) {
			const profile = pickActiveProfile(
				salaryProfiles.filter((p) => p.employee_id === emp.employee_id),
				`${fyYear}-04`
			);
			const rateCompany = profile ? resolveHourlyRate(profile) : 0;
			const totalHours = round2(toNumber(totalHrs));
			const companyCost = toNumber(
				mul(R(rateCompany), totalHours).toDecimalPlaces(2)
			);
			const accentCost = 0;
			const pnl = toNumber(
				sub(R(accentCost), R(companyCost)).toDecimalPlaces(2)
			);
			rows.push({
				sr_no: 0,
				id: emp.employee_id,
				employee_id: emp.employee_id,
				employee_code: emp.employee_code,
				employee_name: emp.name,
				designation: emp.designation,
				salary_type: profile?.salary_type || 'monthly',
				rate_company: rateCompany,
				rate_accent: 0,
				monthly_hours: monthlyHours,
				total_hours: totalHours,
				company_cost: companyCost,
				accent_cost: accentCost,
				pnl,
			});
		}
	}

	rows.sort((a, b) => a.employee_name.localeCompare(b.employee_name));
	rows.forEach((row, index) => {
		row.sr_no = index + 1;
	});

	return rows;
}

export function buildAnnualTotals(rows: AnnualEmployeeRow[]): {
	monthly_hours: Record<string, number>;
	total_hours: number;
	total_company_cost: number;
	total_accent_cost: number;
	total_pnl: number;
} {
	const monthlyHours: Record<string, Decimal> = {};
	for (const mKey of FY_MONTH_KEYS) {
		monthlyHours[mKey] = R(0);
	}
	let totalHours = R(0);
	let totalCompanyCost = R(0);
	let totalAccentCost = R(0);
	let totalPnl = R(0);

	for (const r of rows) {
		for (const mKey of FY_MONTH_KEYS) {
			monthlyHours[mKey] = add(
				monthlyHours[mKey],
				r.monthly_hours?.[mKey] || 0
			);
		}
		totalHours = add(totalHours, r.total_hours);
		totalCompanyCost = add(totalCompanyCost, r.company_cost);
		totalAccentCost = add(totalAccentCost, r.accent_cost);
		totalPnl = add(totalPnl, r.pnl);
	}

	const roundedMonthlyHours: Record<string, number> = {};
	for (const mKey of FY_MONTH_KEYS) {
		roundedMonthlyHours[mKey] = round2(toNumber(monthlyHours[mKey]));
	}

	return {
		monthly_hours: roundedMonthlyHours,
		total_hours: round2(toNumber(totalHours)),
		total_company_cost: toNumber(totalCompanyCost.toDecimalPlaces(2)),
		total_accent_cost: toNumber(totalAccentCost.toDecimalPlaces(2)),
		total_pnl: toNumber(totalPnl.toDecimalPlaces(2)),
	};
}

// ─── Server data fetch ──────────────────────────────────────────────

/** Clients + projects + months + FYs for the filter bar. */
export async function fetchBillingMeta(): Promise<BillingMeta> {
	const [projectRows] = (await query(
		`SELECT project_id, project_code,
		        COALESCE(NULLIF(project_title, ''), NULLIF(name, ''), '') AS project_name,
		        client_name, project_manhours_list
		 FROM projects
		 WHERE isDelete = 0
		   AND client_name IS NOT NULL AND client_name <> ''
		 ORDER BY client_name, project_code, project_id`
	)) as [DbRow[], unknown];

	const clientsSet = new Set<string>();
	const projects: BillingProject[] = [];
	const yearsSet = new Set<number>();
	const currentFy = getFinancialYear();
	yearsSet.add(currentFy);
	yearsSet.add(currentFy - 1);

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

		const tabList = parseProjectManhoursList(row.project_manhours_list);
		if (tabList.length > 0) {
			yearsSet.add(currentFy);
		}
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
		/* employee_attendance may be empty */
	}

	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM user_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		const monthSet = new Set(months);
		for (const row of asgRows) {
			for (const entry of parseDailyEntries(row.daily_entries)) {
				const date = typeof entry.date === 'string' ? entry.date : '';
				if (date.length >= 7) {
					const m = date.slice(0, 7);
					monthSet.add(m);
					const y = Number(m.slice(0, 4));
					if (y) {
						yearsSet.add(y);
						yearsSet.add(y - 1);
					}
				}
			}
		}
		months = Array.from(monthSet).sort().reverse();
	} catch {
		/* user_activity_assignments may not exist */
	}

	// Always offer the current month and FY
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	if (!months.includes(currentMonth)) months.unshift(currentMonth);

	const financialYears: FinancialYearOption[] = Array.from(yearsSet)
		.sort((a, b) => b - a)
		.map((y) => ({
			year: y,
			label: formatFyLabel(y),
		}));

	return {
		clients: Array.from(clientsSet).sort((a, b) => a.localeCompare(b)),
		projects,
		months,
		latest_month: months[0] ?? currentMonth,
		financial_years: financialYears,
		current_fy: currentFy,
	};
}

/** Full monthly billing payload for one project + month. */
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
	const tabEntries = parseProjectManhoursList(project.project_manhours_list);

	const manhoursConfig = new Map<number, ProjectManhourConfig>();
	for (const entry of tabEntries) {
		const empId = toNum(entry.source_employee_id) || toNum(entry.employee_id);
		if (empId > 0) {
			manhoursConfig.set(empId, {
				rate_company: toNum(entry.rate_company),
				rate_accent: toNum(entry.rate_accent),
			});
		}
	}

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
		month,
		tabEntries
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

/** Full annual FY billing payload for one project + financial year. */
export async function fetchAnnualBillingData(
	projectId: number,
	fyYear: number = getFinancialYear()
): Promise<AnnualBillingData | null> {
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
	const tabEntries = parseProjectManhoursList(project.project_manhours_list);

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

	const rows = buildAnnualBillingRows(
		assignmentRows,
		employeeIndex,
		userToEmployee,
		userEmailUsernameToEmployee,
		salaryProfiles,
		tabEntries,
		fyYear
	);

	return {
		client_name: s(project, 'client_name'),
		project: {
			project_id: n(project, 'project_id'),
			project_code: s(project, 'project_code'),
			project_name:
				s(project, 'project_name') || `Project #${s(project, 'project_id')}`,
		},
		fy_label: formatFyLabel(fyYear),
		fy_year: fyYear,
		months: Array.from(FY_MONTHS),
		month_keys: Array.from(FY_MONTH_KEYS),
		rows,
		totals: buildAnnualTotals(rows),
	};
}
