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
 *   `logged_activity_assignments.daily_entries` (effective legacy + Work
 *   Period logs).
 */

import type Decimal from 'decimal.js';
import { query } from '@/utils/database';
import { R, mul, sub, add, pctOf, toNumber, gt } from '@/lib/money';
import {
	parseDailyEntries,
	parseDailyEntryRecords,
	sumLoggedHoursForMonth,
} from '@/lib/logged-hours';

import {
	resolveLoggedHoursEmployeeId,
	type AssignmentResolutionRow,
} from '@/lib/logged-hours-source';
import {
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
	type SalaryProfileRow,
} from '@/lib/salary-profile-timeline';
import { resolveSalaryCtc, type SalaryCtcSource } from '@/lib/salary-ctc';

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
	/** Where `employee_charges` came from; `unavailable` is not a confirmed zero. */
	pricing_source: 'project' | 'salary' | 'unavailable';
	/** Period-effective salary evidence; null when the row has no Employee. */
	salary: ReportSalaryEvidence | null;
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
		salary: ReportSalarySummary;
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
	/** Effective row rate: configured project rate or hours-weighted salary rate. */
	rate_employee: number;
	rate_client: number;
	monthly_hours: Record<string, number>;
	total_hours: number;
	/**
	 * Salary-derived rate per FY month key (apr…mar), only for months whose
	 * rate came from salary. A configured project rate never appears here.
	 */
	monthly_rates: Record<string, number>;
	/** Company cost per FY month key; null when hours exist but no rate did. */
	monthly_company_cost: Record<string, number | null>;
	/** Salary evidence per salary-priced FY month key. */
	salary_months: Record<string, ReportSalaryEvidence>;
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
		salary: ReportSalarySummary;
	};
}

/** One `employee_salary_profile` row as the report reads it. */
export type SalaryProfile = SalaryProfileRow & {
	id: number;
	employee_id: number;
	/** Absent (null) is not zero: only the shared CTC resolver may interpret it. */
	gross: number | null;
	gross_salary: number | null;
	employer_cost: number | null;
	hourly_rate: number;
	daily_rate: number;
	std_hours_per_day: number;
	std_working_days: number;
	salary_type: string;
	tds_percentage: number;
	effective_from: string;
	effective_to: string | null;
};

/** Why a report row's month has, or has not, a usable salary agreement. */
export type ReportSalaryAvailability =
	| 'available'
	| 'missing'
	| 'ambiguous'
	| 'ctc-missing'
	| 'ctc-invalid';

/**
 * The period-effective salary evidence behind one report month. `available`
 * includes an explicit canonical zero; every other state is unavailable money.
 */
export interface ReportSalaryEvidence {
	availability: ReportSalaryAvailability;
	/** Calendar date selection used: month start or a verified joining date. */
	anchor: string;
	profile_id: number | null;
	profile_source: 'employee_salary_profile' | null;
	salary_type: string | null;
	ctc_source: SalaryCtcSource;
	/** True only when the amount came from legacy `gross_salary`/`gross`. */
	legacy_fallback: boolean;
	/** Sorted competing agreement ids when `ambiguous`. */
	conflict_ids: number[];
}

/** The salary population behind a report total, for partial-total disclosure. */
export interface ReportSalarySummary {
	available_count: number;
	missing_count: number;
	ambiguous_count: number;
	ctc_missing_count: number;
	ctc_invalid_count: number;
	legacy_fallback_count: number;
	/** Rows/months that money could not price because salary was unavailable. */
	unpriced_count: number;
	/** No salary-dependent row/month is unpriced. */
	complete: boolean;
}

/** The one period-effective salary selection a report month reads. */
export interface ReportSalarySelection {
	evidence: ReportSalaryEvidence;
	/** The selected agreement row; null when missing/ambiguous. */
	profile: SalaryProfile | null;
	/** Resolved monthly CTC as a number; null when missing/invalid. */
	ctc: number | null;
}

/** Per-employee rates from `projects.project_manhours_list` (annual format). */
export interface ProjectManhourConfig {
	rate_employee: number;
	rate_client: number;
}

/** Raw shape of an item in `projects.project_manhours_list`. */
export interface ProjectManhourTabRow {
	id?: number | string;
	employee_id?: number | string;
	source_employee_id?: number | string;
	employee_name?: string;
	salary_type?: string;
	rate_employee?: number | string;
	rate_client?: number | string;
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

type DbRow = Record<string, unknown> & AssignmentResolutionRow;

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

/** A nullable DECIMAL cell: absent stays null so zero is never manufactured. */
function nullableNum(row: DbRow, key: string): number | null {
	const value = row[key];
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
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

/** Accept pre-rename storage keys (`rate_company`/`rate_accent` were semantically inverted). */
function normalizeManhourEntry(
	entry: Record<string, unknown>
): ProjectManhourTabRow {
	if (!('rate_company' in entry || 'rate_accent' in entry)) {
		return entry as unknown as ProjectManhourTabRow;
	}
	const out: Record<string, unknown> = { ...entry };
	if (out.rate_employee === undefined) out.rate_employee = out.rate_company;
	if (out.rate_client === undefined) out.rate_client = out.rate_accent;
	delete out.rate_company;
	delete out.rate_accent;
	return out as unknown as ProjectManhourTabRow;
}

export function parseProjectManhoursList(raw: unknown): ProjectManhourTabRow[] {
	if (!raw) return [];
	try {
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((item) => item && typeof item === 'object')
			.map((item) => normalizeManhourEntry(item as Record<string, unknown>));
	} catch {
		return [];
	}
}

/** Map FY month keys (apr…mar) to calendar YYYY-MM months for a financial year. */
export function fyKeyToCalendarMonthMap(
	fyStartYear: number
): Record<string, string> {
	return {
		apr: `${fyStartYear}-04`,
		may: `${fyStartYear}-05`,
		jun: `${fyStartYear}-06`,
		jul: `${fyStartYear}-07`,
		aug: `${fyStartYear}-08`,
		sep: `${fyStartYear}-09`,
		oct: `${fyStartYear}-10`,
		nov: `${fyStartYear}-11`,
		dec: `${fyStartYear}-12`,
		jan: `${fyStartYear + 1}-01`,
		feb: `${fyStartYear + 1}-02`,
		mar: `${fyStartYear + 1}-03`,
	};
}

/**
 * Calendar months (YYYY-MM) that have Project Manhours tab hours.
 * Tab month keys are year-less FY keys — mapped onto the given financial
 * year (Apr–Dec of fyStartYear, Jan–Mar of fyStartYear + 1). Keys with no
 * positive hours and unrecognized keys are ignored.
 */
export function collectManhoursTabMonths(
	entries: ProjectManhourTabRow[],
	fyStartYear: number
): string[] {
	const calMap = fyKeyToCalendarMonthMap(fyStartYear);
	const months = new Set<string>();
	for (const entry of entries) {
		if (!entry || !entry.monthly_hours) continue;
		for (const [rawKey, hours] of Object.entries(entry.monthly_hours)) {
			if (toNum(hours) <= 0) continue;
			const key = String(rawKey).trim().toLowerCase();
			const cal = calMap[key];
			if (cal) months.add(cal);
		}
	}
	return Array.from(months).sort();
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────

/**
 * Sum the hours logged by one assignment during `month` (YYYY-MM).
 * Entries outside the month are dropped; hours ≤ 0 are ignored.
 */
export function sumMonthlyHours(
	raw: unknown,
	month: string
): { total_hours: number; has_entries: boolean } {
	return {
		total_hours: sumLoggedHoursForMonth([raw], month),
		// Deliberately not `total_hours > 0`: sub-cent hours round the total to
		// 0 and are still a logged entry. The canonical parser has already
		// dropped the month-mismatched and non-positive-hours entries, so any
		// survivor in the month means hours were logged.
		has_entries: parseDailyEntries(raw).some((entry) =>
			entry.date.startsWith(month)
		),
	};
}

export function monthLabel(month: string): string {
	const [year, monthNumber] = month.split('-').map(Number);
	if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) {
		return month;
	}
	return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/**
 * Select the one agreement covering a report month. The anchor is the month
 * start, or the verified joining date for a mid-month joiner; there is no
 * latest/future fallback. Ambiguity and missing/invalid CTC are explicit.
 */
export function selectReportSalary(
	profiles: readonly SalaryProfile[],
	month: string,
	employmentStart?: string | null
): ReportSalarySelection {
	let anchor: string;
	try {
		anchor = salaryMonthAnchor(month, employmentStart);
	} catch {
		return {
			profile: null,
			ctc: null,
			evidence: {
				availability: 'missing',
				anchor: month,
				profile_id: null,
				profile_source: null,
				salary_type: null,
				ctc_source: 'none',
				legacy_fallback: false,
				conflict_ids: [],
			},
		};
	}

	const resolution = resolveSalaryAgreementAt(profiles, anchor);
	if (resolution.state !== 'selected' || resolution.agreement_id === null) {
		return {
			profile: null,
			ctc: null,
			evidence: {
				availability:
					resolution.state === 'ambiguous' ? 'ambiguous' : 'missing',
				anchor,
				profile_id: null,
				profile_source: null,
				salary_type: null,
				ctc_source: 'none',
				legacy_fallback: false,
				conflict_ids: [...resolution.conflict_ids],
			},
		};
	}

	const profile =
		profiles.find((row) => Number(row.id) === resolution.agreement_id) ?? null;
	if (profile === null) {
		return {
			profile: null,
			ctc: null,
			evidence: {
				availability: 'missing',
				anchor,
				profile_id: null,
				profile_source: null,
				salary_type: null,
				ctc_source: 'none',
				legacy_fallback: false,
				conflict_ids: [],
			},
		};
	}

	const resolved = resolveSalaryCtc(profile);
	const base = {
		anchor,
		profile_id: resolution.agreement_id,
		profile_source: 'employee_salary_profile' as const,
		salary_type: resolution.salary_type,
		conflict_ids: [] as number[],
	};

	if (resolved.status === 'resolved') {
		return {
			profile,
			ctc: resolved.amount.toNumber(),
			evidence: {
				...base,
				availability: 'available',
				ctc_source: resolved.source,
				legacy_fallback: resolved.legacyFallback,
			},
		};
	}

	return {
		profile,
		ctc: null,
		evidence: {
			...base,
			availability:
				resolved.status === 'invalid' ? 'ctc-invalid' : 'ctc-missing',
			ctc_source: resolved.status === 'invalid' ? resolved.source : 'none',
			legacy_fallback: false,
		},
	};
}

/** Tally salary availability for a report's totals without hiding gaps. */
export function summarizeReportSalary(
	entries: ReadonlyArray<{
		evidence: ReportSalaryEvidence | null;
		/** True when money could not be priced from this month's salary. */
		unpriced: boolean;
	}>
): ReportSalarySummary {
	const summary: ReportSalarySummary = {
		available_count: 0,
		missing_count: 0,
		ambiguous_count: 0,
		ctc_missing_count: 0,
		ctc_invalid_count: 0,
		legacy_fallback_count: 0,
		unpriced_count: 0,
		complete: true,
	};
	for (const entry of entries) {
		if (entry.unpriced) summary.unpriced_count++;
		const evidence = entry.evidence;
		if (evidence === null) continue;
		if (evidence.legacy_fallback) summary.legacy_fallback_count++;
		switch (evidence.availability) {
			case 'available':
				summary.available_count++;
				break;
			case 'missing':
				summary.missing_count++;
				break;
			case 'ambiguous':
				summary.ambiguous_count++;
				break;
			case 'ctc-missing':
				summary.ctc_missing_count++;
				break;
			case 'ctc-invalid':
				summary.ctc_invalid_count++;
				break;
		}
	}
	summary.complete = summary.unpriced_count === 0;
	return summary;
}

/**
 * Unrounded hourly rate for a selected agreement — the billing amount is
 * computed from this unrounded value (e.g. 20000 / 208 = 96.1538...) so that
 * multiplying by hours gives the exact salary-apportioned sum matching the
 * Excel template, while the display rate is rounded to 2dp via
 * resolveHourlyRate. Null means the agreement cannot price the row.
 */
export function computeRawHourlyRate(profile: SalaryProfile): number | null {
	if (profile.salary_type === 'hourly' && profile.hourly_rate > 0) {
		return profile.hourly_rate;
	}
	if (profile.salary_type === 'daily' && profile.daily_rate > 0) {
		return profile.daily_rate;
	}
	if (profile.salary_type === 'custom' && profile.hourly_rate > 0) {
		return profile.hourly_rate;
	}
	const monthly = resolveSalaryCtc(profile);
	if (monthly.status !== 'resolved') return null;
	const days = profile.std_working_days > 0 ? profile.std_working_days : 26;
	const hoursPerDay =
		profile.std_hours_per_day > 0 ? profile.std_hours_per_day : 8;
	const totalHours = days * hoursPerDay;
	if (!(totalHours > 0)) return null;
	return monthly.amount.toNumber() / totalHours;
}

/** Display rate: the raw rate rounded to 2dp; null when unavailable. */
export function resolveHourlyRate(profile: SalaryProfile): number | null {
	const raw = computeRawHourlyRate(profile);
	return raw === null ? null : Math.round(raw * 100) / 100;
}

export interface EmployeeLookup {
	employee_id: number;
	employee_code: string;
	name: string;
	designation: string;
	/** Verified joining date; a mid-month joiner is read at this day. */
	employment_start?: string | null;
}

interface PersonBillingAccumulator {
	key: string;
	employeeId: number | null;
	employeeCode: string;
	employeeName: string;
	designation: string;
	hours: number;
	rateEmployee: number;
	rateClient: number;
	tdsRate: number;
}

/**
 * Build billing rows from raw assignment rows and Project Manhours tab data
 * for one project + month.
 */
export function buildBillingRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
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
		const rateEmployee = toNum(entry.rate_employee);
		const rateClient = toNum(entry.rate_client);

		peopleMap.set(key, {
			key,
			employeeId: isInternal ? numEmpId : null,
			employeeCode,
			employeeName,
			designation,
			hours: tabHours,
			rateEmployee,
			rateClient,
			tdsRate: 10,
		});
	}

	// 2. Process assignment rows (timesheet daily task entries)
	const assignmentHoursByEmployee = new Map<number, number>();
	for (const row of assignmentRows) {
		const employeeId = resolveLoggedHoursEmployeeId(row);
		if (!employeeId) continue;

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
					rateEmployee: config ? config.rate_employee : 0,
					rateClient: config ? config.rate_client : 0,
					tdsRate: 10,
				});
			}
		}
	}

	// 3. Compute financial amounts for all people with logged hours > 0
	const rows: BillingEmployeeRow[] = [];
	for (const person of peopleMap.values()) {
		if (person.hours <= 0) continue;

		const employee = person.employeeId
			? employeeIndex.get(person.employeeId)
			: undefined;
		const selection = person.employeeId
			? selectReportSalary(
					salaryProfiles.filter((p) => p.employee_id === person.employeeId),
					month,
					employee?.employment_start ?? null
				)
			: null;
		const profile = selection?.profile ?? null;

		const config = person.employeeId
			? manhoursConfig.get(person.employeeId)
			: null;
		const tabRateEmployee = person.rateEmployee;
		const configRate =
			config && config.rate_employee > 0 ? config.rate_employee : 0;
		const fallbackRate = profile ? resolveHourlyRate(profile) : null;
		const rawFallbackRate = profile ? computeRawHourlyRate(profile) : null;

		const employeeCharges = tabRateEmployee || configRate || fallbackRate || 0;
		const billingRate = tabRateEmployee || configRate || rawFallbackRate || 0;
		const pricingSource: BillingEmployeeRow['pricing_source'] =
			tabRateEmployee || configRate
				? 'project'
				: fallbackRate !== null
					? 'salary'
					: 'unavailable';
		const clientCharges = person.rateClient || config?.rate_client || 0;
		const tdsRate = profile?.tds_percentage || person.tdsRate || 10;

		const amount = toNumber(
			mul(R(billingRate), person.hours).toDecimalPlaces(2)
		);
		const tds = toNumber(pctOf(amount, tdsRate));
		const netPayable = toNumber(sub(R(amount), R(tds)).toDecimalPlaces(2));
		const accentAmount = toNumber(
			mul(R(clientCharges), person.hours).toDecimalPlaces(2)
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
			accent_charges: clientCharges,
			accent_amount: accentAmount,
			pnl_after_deductions: pnlAfterDeductions,
			pnl_tds: pnlTds,
			pricing_source: pricingSource,
			salary: selection?.evidence ?? null,
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
	salary: ReportSalarySummary;
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
		salary: summarizeReportSalary(
			rows.map((row) => ({
				evidence: row.salary,
				unpriced: row.pricing_source === 'unavailable',
			}))
		),
	};
}

interface AnnualMonthPricing {
	/** Null when the month has hours but no usable rate (never a guessed zero). */
	cost: Decimal | null;
	/** Salary-derived display rate; null for configured project rates. */
	rate: number | null;
	evidence: ReportSalaryEvidence | null;
}

/**
 * Price one FY month. A configured project rate is a recorded allocation and
 * wins for every month; otherwise the month's own covering agreement prices
 * it. A future/absent agreement leaves the month unpriceable, never zero.
 */
function priceAnnualMonth(
	hours: number,
	configuredRate: number,
	employee: EmployeeLookup | null,
	salaryProfiles: readonly SalaryProfile[],
	calendarMonth: string
): AnnualMonthPricing {
	if (configuredRate > 0) {
		return {
			cost: mul(R(configuredRate), hours),
			rate: null,
			evidence: null,
		};
	}
	if (employee === null) {
		return { cost: hours > 0 ? null : R(0), rate: null, evidence: null };
	}
	const selection = selectReportSalary(
		salaryProfiles.filter((p) => p.employee_id === employee.employee_id),
		calendarMonth,
		employee.employment_start ?? null
	);
	const rate = selection.profile ? resolveHourlyRate(selection.profile) : null;
	return {
		cost: hours > 0 ? (rate === null ? null : mul(R(rate), hours)) : R(0),
		rate,
		evidence: selection.evidence,
	};
}

/**
 * Build 12-month Financial Year (Apr–Mar) deputation rows.
 */
export function buildAnnualBillingRows(
	assignmentRows: DbRow[],
	employeeIndex: Map<number, EmployeeLookup>,
	salaryProfiles: SalaryProfile[],
	tabEntries: ProjectManhourTabRow[] = [],
	fyYear: number = getFinancialYear()
): AnnualEmployeeRow[] {
	const rows: AnnualEmployeeRow[] = [];
	const peopleSeen = new Set<string>();

	// FY month key to calendar month mapping
	// Apr-Dec of fyYear, Jan-Mar of fyYear+1
	const fyCalendarMonthMap = fyKeyToCalendarMonthMap(fyYear);

	// 1. Process Project Manhours tab rows
	for (const entry of tabEntries) {
		if (!entry) continue;
		const rawEmpId = entry.source_employee_id ?? entry.employee_id;
		const numEmpId = toNum(rawEmpId);
		const isInternal = numEmpId > 0 && employeeIndex.has(numEmpId);
		const internalEmp = isInternal
			? (employeeIndex.get(numEmpId) ?? null)
			: null;
		const key = String(entry.employee_id || entry.id || numEmpId);
		peopleSeen.add(key);

		const configuredRate = toNum(entry.rate_employee);
		const rateClient = toNum(entry.rate_client);

		const monthlyHours: Record<string, number> = {};
		const monthlyRates: Record<string, number> = {};
		const monthlyCompanyCost: Record<string, number | null> = {};
		const salaryMonths: Record<string, ReportSalaryEvidence> = {};
		let totalHrs = R(0);
		let companyCost = R(0);
		let pricedHrs = R(0);
		let displaySalaryType = entry.salary_type || '';

		for (const mKey of FY_MONTH_KEYS) {
			let h = entry.monthly_hours ? toNum(entry.monthly_hours[mKey]) : 0;
			// If not in tab, check daily assignments for that FY calendar month
			if (h <= 0 && isInternal) {
				const calMonth = fyCalendarMonthMap[mKey];
				for (const asg of assignmentRows) {
					if (resolveLoggedHoursEmployeeId(asg) === numEmpId) {
						const res = sumMonthlyHours(asg.daily_entries, calMonth);
						h += res.total_hours;
					}
				}
			}
			monthlyHours[mKey] = round2(h);
			totalHrs = add(totalHrs, h);

			const pricing = priceAnnualMonth(
				h,
				configuredRate,
				isInternal ? internalEmp : null,
				salaryProfiles,
				fyCalendarMonthMap[mKey]
			);
			monthlyCompanyCost[mKey] =
				pricing.cost === null
					? null
					: toNumber(pricing.cost.toDecimalPlaces(2));
			if (pricing.cost !== null) {
				companyCost = add(companyCost, pricing.cost);
				if (h > 0) pricedHrs = add(pricedHrs, h);
			}
			if (pricing.rate !== null && h > 0) {
				monthlyRates[mKey] = pricing.rate;
			}
			if (pricing.evidence !== null && h > 0) {
				salaryMonths[mKey] = pricing.evidence;
				if (!displaySalaryType && pricing.evidence.salary_type) {
					displaySalaryType = pricing.evidence.salary_type;
				}
			}
		}

		const totalHours = round2(toNumber(totalHrs));
		const companyCostNum = toNumber(companyCost.toDecimalPlaces(2));
		const pricedHoursNum = toNumber(pricedHrs);
		const rateEmployee =
			configuredRate > 0
				? configuredRate
				: pricedHoursNum > 0
					? round2(companyCostNum / pricedHoursNum)
					: 0;
		const accentCost = toNumber(
			mul(R(rateClient), totalHours).toDecimalPlaces(2)
		);
		const pnl = toNumber(
			sub(R(accentCost), R(companyCostNum)).toDecimalPlaces(2)
		);

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
			salary_type: displaySalaryType || 'monthly',
			rate_employee: rateEmployee,
			rate_client: rateClient,
			monthly_hours: monthlyHours,
			total_hours: totalHours,
			monthly_rates: monthlyRates,
			monthly_company_cost: monthlyCompanyCost,
			salary_months: salaryMonths,
			company_cost: companyCostNum,
			accent_cost: accentCost,
			pnl,
		});
	}

	// 2. Add any internal employees with logged assignment hours not in tab
	for (const emp of employeeIndex.values()) {
		const key = String(emp.employee_id);
		if (peopleSeen.has(key)) continue;

		const monthlyHours: Record<string, number> = {};
		const monthlyRates: Record<string, number> = {};
		const monthlyCompanyCost: Record<string, number | null> = {};
		const salaryMonths: Record<string, ReportSalaryEvidence> = {};
		let totalHrs = R(0);
		let companyCost = R(0);
		let pricedHrs = R(0);
		let displaySalaryType = '';

		for (const mKey of FY_MONTH_KEYS) {
			const calMonth = fyCalendarMonthMap[mKey];
			let h = 0;
			for (const asg of assignmentRows) {
				if (resolveLoggedHoursEmployeeId(asg) === emp.employee_id) {
					const res = sumMonthlyHours(asg.daily_entries, calMonth);
					h += res.total_hours;
				}
			}
			monthlyHours[mKey] = round2(h);
			totalHrs = add(totalHrs, h);

			const pricing = priceAnnualMonth(h, 0, emp, salaryProfiles, calMonth);
			monthlyCompanyCost[mKey] =
				pricing.cost === null
					? null
					: toNumber(pricing.cost.toDecimalPlaces(2));
			if (pricing.cost !== null) {
				companyCost = add(companyCost, pricing.cost);
				if (h > 0) pricedHrs = add(pricedHrs, h);
			}
			if (pricing.rate !== null && h > 0) {
				monthlyRates[mKey] = pricing.rate;
			}
			if (pricing.evidence !== null && h > 0) {
				salaryMonths[mKey] = pricing.evidence;
				if (!displaySalaryType && pricing.evidence.salary_type) {
					displaySalaryType = pricing.evidence.salary_type;
				}
			}
		}

		if (gt(totalHrs, 0)) {
			const totalHours = round2(toNumber(totalHrs));
			const companyCostNum = toNumber(companyCost.toDecimalPlaces(2));
			const pricedHoursNum = toNumber(pricedHrs);
			const rateEmployee =
				pricedHoursNum > 0 ? round2(companyCostNum / pricedHoursNum) : 0;
			const accentCost = 0;
			const pnl = toNumber(
				sub(R(accentCost), R(companyCostNum)).toDecimalPlaces(2)
			);
			rows.push({
				sr_no: 0,
				id: emp.employee_id,
				employee_id: emp.employee_id,
				employee_code: emp.employee_code,
				employee_name: emp.name,
				designation: emp.designation,
				salary_type: displaySalaryType || 'monthly',
				rate_employee: rateEmployee,
				rate_client: 0,
				monthly_hours: monthlyHours,
				total_hours: totalHours,
				monthly_rates: monthlyRates,
				monthly_company_cost: monthlyCompanyCost,
				salary_months: salaryMonths,
				company_cost: companyCostNum,
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
	salary: ReportSalarySummary;
} {
	const monthlyHours: Record<string, Decimal> = {};
	for (const mKey of FY_MONTH_KEYS) {
		monthlyHours[mKey] = R(0);
	}
	let totalHours = R(0);
	let totalCompanyCost = R(0);
	let totalAccentCost = R(0);
	let totalPnl = R(0);
	const salaryEntries: Array<{
		evidence: ReportSalaryEvidence | null;
		unpriced: boolean;
	}> = [];

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
		for (const [mKey, evidence] of Object.entries(r.salary_months)) {
			salaryEntries.push({
				evidence,
				unpriced: r.monthly_company_cost[mKey] === null,
			});
		}
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
		salary: summarizeReportSalary(salaryEntries),
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
	const manhoursMonths = new Set<string>();

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
			for (const m of collectManhoursTabMonths(tabList, currentFy)) {
				manhoursMonths.add(m);
			}
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

	// Months that only have Project Manhours tab data (no attendance /
	// assignment entries yet) must still be selectable in the filter bar.
	const monthSet = new Set<string>([...months, ...manhoursMonths]);

	try {
		const [asgRows] = (await query(
			`SELECT daily_entries FROM logged_activity_assignments
			 WHERE daily_entries IS NOT NULL AND daily_entries NOT IN ('', '[]')`
		)) as [DbRow[], unknown];
		for (const row of asgRows) {
			for (const { date } of parseDailyEntryRecords(row.daily_entries)) {
				if (date.length < 7) continue;
				const m = date.slice(0, 7);
				monthSet.add(m);
				const y = Number(m.slice(0, 4));
				if (y) {
					yearsSet.add(y);
					yearsSet.add(y - 1);
				}
			}
		}
	} catch {
		/* logged_activity_assignments may not exist */
	}

	months = Array.from(monthSet).sort().reverse();

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
				rate_employee: toNum(entry.rate_employee),
				rate_client: toNum(entry.rate_client),
			});
		}
	}

	const employeeIndex = new Map<number, EmployeeLookup>();
	try {
		const [empRows] = (await query(
			`SELECT id, employee_id,
			        CONCAT_WS(' ', first_name, last_name) AS name,
			        position, designation,
			        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
			        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date
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
				employment_start: s(emp, 'joining_date') || s(emp, 'hire_date') || null,
			});
		}
	} catch {
		/* employees table unavailable */
	}

	const salaryProfiles: SalaryProfile[] = [];
	try {
		const [profileRows] = (await query(
			`SELECT id, employee_id, gross, gross_salary, employer_cost,
			        hourly_rate, daily_rate, std_hours_per_day, std_working_days,
			        salary_type, tds_percentage,
			        DATE_FORMAT(cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelled_at,
			        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
			        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
			 FROM employee_salary_profile
			 WHERE is_active = 1`
		)) as [DbRow[], unknown];
		for (const p of profileRows) {
			const employeeId = n(p, 'employee_id');
			const agreementId = n(p, 'id');
			const effectiveFrom = s(p, 'effective_from');
			if (!employeeId || !agreementId || !effectiveFrom) continue;
			salaryProfiles.push({
				id: agreementId,
				employee_id: employeeId,
				gross: nullableNum(p, 'gross'),
				gross_salary: nullableNum(p, 'gross_salary'),
				employer_cost: nullableNum(p, 'employer_cost'),
				hourly_rate: n(p, 'hourly_rate'),
				daily_rate: n(p, 'daily_rate'),
				std_hours_per_day: n(p, 'std_hours_per_day', 8),
				std_working_days: n(p, 'std_working_days', 26),
				salary_type: s(p, 'salary_type', 'monthly'),
				tds_percentage: n(p, 'tds_percentage', 0),
				effective_from: effectiveFrom,
				effective_to: s(p, 'effective_to', '') || null,
				cancelled_at: s(p, 'cancelled_at', '') || null,
			});
		}
	} catch {
		/* table may not exist */
	}

	let assignmentRows: DbRow[] = [];
	try {
		const [rows] = (await query(
			`SELECT uaa.id, uaa.user_id, uaa.employee_id, uaa.daily_entries,
			        u.employee_id AS user_employee_id
			 FROM logged_activity_assignments uaa
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
	try {
		const [empRows] = (await query(
			`SELECT id, employee_id,
			        CONCAT_WS(' ', first_name, last_name) AS name,
			        position, designation,
			        DATE_FORMAT(joining_date, '%Y-%m-%d') AS joining_date,
			        DATE_FORMAT(hire_date, '%Y-%m-%d') AS hire_date
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
				employment_start: s(emp, 'joining_date') || s(emp, 'hire_date') || null,
			});
		}
	} catch {
		/* employees table unavailable */
	}

	const salaryProfiles: SalaryProfile[] = [];
	try {
		const [profileRows] = (await query(
			`SELECT id, employee_id, gross, gross_salary, employer_cost,
			        hourly_rate, daily_rate, std_hours_per_day, std_working_days,
			        salary_type, tds_percentage,
			        DATE_FORMAT(cancelled_at, '%Y-%m-%d %H:%i:%s') AS cancelled_at,
			        DATE_FORMAT(effective_from, '%Y-%m-%d') AS effective_from,
			        DATE_FORMAT(effective_to, '%Y-%m-%d') AS effective_to
			 FROM employee_salary_profile
			 WHERE is_active = 1`
		)) as [DbRow[], unknown];
		for (const p of profileRows) {
			const employeeId = n(p, 'employee_id');
			const agreementId = n(p, 'id');
			const effectiveFrom = s(p, 'effective_from');
			if (!employeeId || !agreementId || !effectiveFrom) continue;
			salaryProfiles.push({
				id: agreementId,
				employee_id: employeeId,
				gross: nullableNum(p, 'gross'),
				gross_salary: nullableNum(p, 'gross_salary'),
				employer_cost: nullableNum(p, 'employer_cost'),
				hourly_rate: n(p, 'hourly_rate'),
				daily_rate: n(p, 'daily_rate'),
				std_hours_per_day: n(p, 'std_hours_per_day', 8),
				std_working_days: n(p, 'std_working_days', 26),
				salary_type: s(p, 'salary_type', 'monthly'),
				tds_percentage: n(p, 'tds_percentage', 0),
				effective_from: effectiveFrom,
				effective_to: s(p, 'effective_to', '') || null,
				cancelled_at: s(p, 'cancelled_at', '') || null,
			});
		}
	} catch {
		/* table may not exist */
	}

	let assignmentRows: DbRow[] = [];
	try {
		const [rows] = (await query(
			`SELECT uaa.id, uaa.user_id, uaa.employee_id, uaa.daily_entries,
			        u.employee_id AS user_employee_id
			 FROM logged_activity_assignments uaa
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
