/**
 * Payroll company-sheet pure read model (issues #426 and #427).
 *
 * One display row per input Payroll Slip, in the company's fixed 51-column
 * order. The module reads only what the caller hands it: an explicit month and
 * current date, already-normalized Payroll Slip rows, the month's Attendance
 * Records, Holiday Master rows, and validated employment-date evidence. It
 * performs no database read, network call, clock read, write, or payroll
 * calculation.
 *
 * Money is the Payroll Slip's snapshot. GROSS/TOTAL DED/NET SAL are the
 * stored totals, and BASIC/DA come from `normalizedSlipFigures` once — this
 * module never re-derives the Basic/DA split and never re-prices a slip.
 * Attendance is current evidence and is kept strictly separate from those
 * amounts. (See ADR-0009 and the #426 specification.)
 */

import {
	computeAttendanceSummary,
	PAID_LEAVE_CODES,
	UNPAID_CODES,
	type AttendanceDayInput,
} from '@/lib/attendance-summary';
import { normalizedSlipFigures } from '@/lib/payroll';
import { add, isZero, sub, toNumber } from '@/lib/money';
import {
	normalizePayrollRunMonth,
	resolveEmploymentDates,
	type ResolvedEmploymentDates,
} from '@/lib/payroll-run-roster';
import { isWeeklyOff } from '@/utils/weekly-off';

// ─── Company column catalog ─────────────────────────────────────────

const COLUMN_DEFINITIONS = [
	{ id: 'employee_code', label: 'Employee Code', kind: 'text' },
	{ id: 'full_name', label: 'Full Name', kind: 'text' },
	{ id: 'designation', label: 'Designation', kind: 'text' },
	{ id: 'uan', label: 'UAN', kind: 'text' },
	{ id: 'pf_no', label: 'PF No.', kind: 'text' },
	{ id: 'esic_no', label: 'ESIC No.', kind: 'text' },
	{ id: 'total_days', label: 'Total Days', kind: 'number' },
	{ id: 'days_present', label: 'Days Present', kind: 'number' },
	{ id: 'days_paid', label: 'Days Paid', kind: 'number' },
	{ id: 'lwp_days', label: 'LWP Days', kind: 'number' },
	{ id: 'leave', label: 'Leave', kind: 'number' },
	{ id: 'week_off', label: 'WeekOff', kind: 'number' },
	{ id: 'paid_holiday', label: 'Paid Holiday', kind: 'number' },
	{ id: 'ot_hours', label: 'OT Hours', kind: 'number' },
	{ id: 'basic', label: 'BASIC', kind: 'money' },
	{ id: 'da', label: 'DA', kind: 'money' },
	{ id: 'hra', label: 'HRA', kind: 'money' },
	{ id: 'conveyance_allowance', label: 'CONVEYANCE ALLOWANCE', kind: 'money' },
	{ id: 'call_allowance', label: 'CALL ALLOWANCE', kind: 'money' },
	{ id: 'other_allowance', label: 'OTHER ALLOWANCE', kind: 'money' },
	{
		id: 'paid_holiday_amount',
		label: 'PAID HOLIDAY AMOUNT',
		kind: 'unsupported',
	},
	{ id: 'bonus', label: 'BONUS', kind: 'money' },
	{ id: 'ot_rate', label: 'OT RATE', kind: 'unsupported' },
	{ id: 'incentive', label: 'INCENTIVE', kind: 'money' },
	{ id: 'basic_arrears', label: 'BASIC Arrears', kind: 'unsupported' },
	{ id: 'da_arrears', label: 'DA Arrears', kind: 'unsupported' },
	{ id: 'hra_arrears', label: 'HRA Arrears', kind: 'unsupported' },
	{ id: 'calw_arrears', label: 'CALW Arrears', kind: 'unsupported' },
	{ id: 'calalw_arrears', label: 'CALALW Arrears', kind: 'unsupported' },
	{ id: 'othalw_arrears', label: 'OTHALW Arrears', kind: 'unsupported' },
	{ id: 'pha_arrears', label: 'PHA Arrears', kind: 'unsupported' },
	{ id: 'bonus_arrears', label: 'BONUS Arrears', kind: 'unsupported' },
	{ id: 'ot_arrears', label: 'OT Arrears', kind: 'unsupported' },
	{ id: 'incentive_arrears', label: 'INCENTIVE Arrears', kind: 'unsupported' },
	{ id: 'gross', label: 'GROSS', kind: 'money' },
	{ id: 'ebonus', label: 'EBONUS', kind: 'unsupported' },
	{ id: 'emprpf', label: 'EMPRPF', kind: 'unsupported' },
	{ id: 'pai', label: 'PAI', kind: 'unsupported' },
	{ id: 'rate', label: 'RATE', kind: 'unsupported' },
	{ id: 'ec', label: 'EC', kind: 'unsupported' },
	{ id: 'epfwage', label: 'EPFWAGE', kind: 'unsupported' },
	{ id: 'provident_fund', label: 'PROVIDENT FUND', kind: 'money' },
	{
		id: 'pf_difference_amount',
		label: 'PF DIFFERENCE AMOUNT',
		kind: 'unsupported',
	},
	{ id: 'esic', label: 'ESIC', kind: 'money' },
	{ id: 'professional_tax', label: 'PROFESSIONAL TAX', kind: 'money' },
	{ id: 'loan', label: 'LOAN', kind: 'unsupported' },
	{ id: 'advance', label: 'ADVANCE', kind: 'unsupported' },
	{
		id: 'tax_deducted_at_source',
		label: 'TAX DEDUCTED AT SOURCE',
		kind: 'money',
	},
	{ id: 'retention_amount', label: 'RETENTION AMOUNT', kind: 'money' },
	{ id: 'total_ded', label: 'TOTAL DED', kind: 'money' },
	{ id: 'net_sal', label: 'NET SAL', kind: 'money' },
] as const;

export type CompanySheetColumnId = (typeof COLUMN_DEFINITIONS)[number]['id'];

export type CompanySheetColumnKind =
	| 'text'
	| 'number'
	| 'money'
	| 'unsupported';

export interface CompanySheetColumn {
	readonly id: CompanySheetColumnId;
	readonly label: string;
	readonly kind: CompanySheetColumnKind;
}

/** The approved company captions, verbatim and in their fixed order. */
export const COMPANY_SHEET_COLUMNS: readonly CompanySheetColumn[] =
	COLUMN_DEFINITIONS;

// ─── Inputs ─────────────────────────────────────────────────────────

export interface CompanySheetSlipInput {
	readonly id: number;
	readonly month?: string | Date | null;
	readonly employee_id: number;
	readonly employee_name?: string | null;
	readonly employee_code?: string | null;
	/** `employees.position`; never the grade-based listing alias. */
	readonly position?: string | null;
	readonly uan?: string | null;
	readonly pf_no?: string | null;
	readonly esi_no?: string | null;
	/** Already-normalized BASIC from the Payroll Slip listing. */
	readonly basic?: number | string | null;
	/** Already-normalized DA from the Payroll Slip listing. */
	readonly da?: number | string | null;
	readonly hra?: number | string | null;
	readonly conveyance?: number | string | null;
	readonly call_allowance?: number | string | null;
	readonly other_allowances?: number | string | null;
	readonly bonus?: number | string | null;
	readonly incentive?: number | string | null;
	readonly total_earnings?: number | string | null;
	readonly total_deductions?: number | string | null;
	readonly net_pay?: number | string | null;
	readonly pf_employee?: number | string | null;
	readonly esic_employee?: number | string | null;
	readonly pt?: number | string | null;
	readonly tds?: number | string | null;
	readonly retention?: number | string | null;
	readonly mlwf?: number | string | null;
	readonly lwf?: number | string | null;
	readonly other_deductions?: number | string | null;
	readonly lop_deduction?: number | string | null;
}

export interface CompanySheetEmploymentInput {
	readonly employee_id: number;
	readonly status?: string | null;
	readonly joining_date?: string | Date | null;
	readonly hire_date?: string | Date | null;
	readonly exit_date?: string | Date | null;
}

export interface CompanySheetAttendanceRecord {
	readonly employee_id: number;
	readonly attendance_date: string | Date;
	readonly status?: string | null;
	readonly overtime_hours?: number | string | null;
	/**
	 * Historical Boolean cues. The read model deliberately ignores them: an
	 * explicit recognized status, then the shared calendar rule, decides the
	 * day. They are accepted only so a raw `employee_attendance` row can be
	 * handed over unchanged.
	 */
	readonly is_weekly_off?: boolean | number | string | null;
	readonly is_holiday?: boolean | number | string | null;
}

export interface CompanySheetHolidayInput {
	readonly date: string | Date;
	readonly is_active?: boolean | number | string | null;
	/** Optional holidays are working days unless an explicit H status says otherwise. */
	readonly is_optional?: boolean | number | string | null;
}

export type CompanySheetAttendanceSource =
	| {
			readonly state: 'loaded';
			readonly records: readonly CompanySheetAttendanceRecord[];
	  }
	| { readonly state: 'error'; readonly message?: string | null };

export type CompanySheetHolidaySource =
	| {
			readonly state: 'loaded';
			readonly holidays: readonly CompanySheetHolidayInput[];
	  }
	| { readonly state: 'error'; readonly message?: string | null };

export interface CompanySheetInput {
	/** `YYYY-MM` or `YYYY-MM-01`. */
	readonly month: string;
	/** `YYYY-MM-DD`; supplied by the caller, never read from the clock. */
	readonly current_date: string;
	readonly slips: readonly CompanySheetSlipInput[];
	readonly attendance: CompanySheetAttendanceSource;
	readonly holidays: CompanySheetHolidaySource;
	readonly employment: readonly CompanySheetEmploymentInput[];
}

// ─── Output values ──────────────────────────────────────────────────

export type CompanySheetUnavailableReason =
	| 'not_recorded'
	| 'invalid_value'
	| 'unsupported_mapping'
	| 'attendance_source_error'
	| 'holiday_source_error'
	| 'employment_unavailable';

export type CompanySheetCell =
	| { readonly state: 'text'; readonly value: string }
	| { readonly state: 'number'; readonly value: number }
	| {
			readonly state: 'not_available';
			readonly reason: CompanySheetUnavailableReason;
	  };

export type CompanySheetPaidLeaveCode = 'PL' | 'CL' | 'SL' | 'EL';
export type CompanySheetUnpaidLeaveCode = 'LWP' | 'UL';

export interface CompanySheetAttendanceBuckets {
	readonly total_days: number;
	/** P + OT + HD × 0.5. */
	readonly present: number;
	/** A + HD × 0.5. */
	readonly absent: number;
	readonly half_days: number;
	readonly paid_leave: number;
	readonly paid_leave_by_code: Readonly<
		Record<CompanySheetPaidLeaveCode, number>
	>;
	readonly unpaid_leave: number;
	readonly unpaid_leave_by_code: Readonly<
		Record<CompanySheetUnpaidLeaveCode, number>
	>;
	readonly holidays: number;
	readonly weekly_off: number;
	/** Includes malformed statuses; see `invalid_status`. */
	readonly unrecorded: number;
	/** The subset of Unrecorded dates after the explicit current date. */
	readonly upcoming_unrecorded: number;
	readonly outside_employment: number;
	readonly invalid_status: number;
	readonly recorded_days: number;
	/** Present + Paid Leave + Holidays + Weekly Off. */
	readonly days_paid: number;
	/** Unpaid Leave + Absent. */
	readonly lwp_days: number;
	readonly ot_hours: number;
	readonly reconciliation: {
		readonly calendar_balanced: boolean;
		readonly paid_balanced: boolean;
	};
}

export type CompanySheetAttendanceUnavailableReason =
	| 'attendance_source_error'
	| 'holiday_source_error'
	| 'employment_unavailable';

export type CompanySheetRowAttendance =
	| {
			readonly state: 'available';
			readonly buckets: CompanySheetAttendanceBuckets;
	  }
	| {
			readonly state: 'unavailable';
			readonly reason: CompanySheetAttendanceUnavailableReason;
	  };

export type CompanySheetDeductionDetailId =
	| 'pf_employee'
	| 'esic_employee'
	| 'professional_tax'
	| 'tax_deducted_at_source'
	| 'retention_amount'
	| 'mlwf'
	| 'lwf'
	| 'other_deductions'
	| 'lop_deduction';

export interface CompanySheetDeductionDetail {
	readonly id: CompanySheetDeductionDetailId;
	readonly label: string;
	readonly amount: number | null;
	readonly state: 'recorded' | 'not_recorded';
	readonly in_company_columns: boolean;
	readonly note?: string;
}

export type CompanySheetIssueCode =
	| 'attendance_source_error'
	| 'attendance_record_invalid'
	| 'attendance_outside_employment'
	| 'attendance_duplicate_date'
	| 'invalid_attendance_status'
	| 'attendance_reconciliation_gap'
	| 'holiday_source_error'
	| 'holiday_date_invalid'
	| 'optional_holidays_ignored'
	| 'employment_dates_missing'
	| 'employment_dates_invalid'
	| 'employment_outside_month'
	| 'slip_month_mismatch'
	| 'loan_advance_split_unavailable'
	| 'earnings_total_not_recorded'
	| 'deductions_total_not_recorded'
	| 'net_total_not_recorded'
	| 'earnings_components_not_recorded'
	| 'deductions_components_not_recorded'
	| 'earnings_reconciliation_gap'
	| 'deductions_reconciliation_gap'
	| 'net_reconciliation_gap';

export type CompanySheetIssueSeverity = 'info' | 'warning' | 'unavailable';

export type CompanySheetIssueScope =
	| 'source'
	| 'employment'
	| 'attendance'
	| 'financial'
	| 'slip';

export interface CompanySheetIssue {
	readonly code: CompanySheetIssueCode;
	readonly severity: CompanySheetIssueSeverity;
	readonly scope: CompanySheetIssueScope;
	readonly message: string;
	readonly dates?: readonly string[];
	readonly fields?: readonly string[];
	readonly count?: number;
	readonly difference?: number;
}

export interface CompanySheetSourceStatus {
	readonly state: 'loaded' | 'error';
	readonly message: string | null;
}

export interface CompanySheetRow {
	readonly slip_id: number;
	readonly employee_id: number;
	/** Every catalog id is present; unsupported ids are `not_available`. */
	readonly cells: Readonly<Record<CompanySheetColumnId, CompanySheetCell>>;
	readonly attendance: CompanySheetRowAttendance;
	readonly deduction_details: readonly CompanySheetDeductionDetail[];
	readonly issues: readonly CompanySheetIssue[];
}

export interface CompanySheetResult {
	/** Normalized first day of month, `YYYY-MM-01`. */
	readonly month: string;
	/** `YYYY-MM`, useful for labels and query identity. */
	readonly month_key: string;
	readonly current_date: string;
	readonly total_days: number;
	readonly rows: readonly CompanySheetRow[];
	readonly sources: {
		readonly attendance: CompanySheetSourceStatus;
		readonly holidays: CompanySheetSourceStatus;
	};
	/** Month-level issues. Row issues live on each row. */
	readonly issues: readonly CompanySheetIssue[];
}

// ─── Date and value helpers ─────────────────────────────────────────

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

function daysInMonth(year: number, monthNumber: number): number {
	return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

/** A stored date/date-time (or Date) as `YYYY-MM-DD`, or null when invalid. */
function parseDay(value: unknown): string | null {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return null;
		return value.toISOString().slice(0, 10);
	}
	if (typeof value !== 'string') return null;
	const match = DAY_RE.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > daysInMonth(year, month)) return null;
	return `${match[1]}-${match[2]}-${match[3]}`;
}

function monthKeyOf(value: unknown): string | null {
	const day = parseDay(value);
	if (day) return day.slice(0, 7);
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
	if (!match) return null;
	const month = Number(match[2]);
	return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

function flagValue(value: unknown): boolean | null {
	if (value === true || value === 1) return true;
	if (value === false || value === 0) return false;
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase();
		if (normalized === '1' || normalized === 'true') return true;
		if (normalized === '0' || normalized === 'false' || normalized === '') {
			return false;
		}
	}
	return null;
}

function readAmount(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function notAvailable(reason: CompanySheetUnavailableReason): CompanySheetCell {
	return { state: 'not_available', reason };
}

function textCell(value: unknown): CompanySheetCell {
	if (value === null || value === undefined)
		return notAvailable('not_recorded');
	const text = typeof value === 'string' ? value.trim() : String(value).trim();
	return text ? { state: 'text', value: text } : notAvailable('not_recorded');
}

function numberCell(value: number): CompanySheetCell {
	return Number.isFinite(value)
		? { state: 'number', value }
		: notAvailable('invalid_value');
}

function amountCell(value: unknown, normalized?: number): CompanySheetCell {
	const amount = readAmount(value);
	if (amount === null) {
		const blank =
			value === null ||
			value === undefined ||
			(typeof value === 'string' && value.trim() === '');
		return notAvailable(blank ? 'not_recorded' : 'invalid_value');
	}
	return numberCell(normalized ?? amount);
}

function makeIssue(
	code: CompanySheetIssueCode,
	severity: CompanySheetIssueSeverity,
	scope: CompanySheetIssueScope,
	message: string,
	extra: Omit<CompanySheetIssue, 'code' | 'severity' | 'scope' | 'message'> = {}
): CompanySheetIssue {
	return { code, severity, scope, message, ...extra };
}

function normalizeStatus(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const status = value.trim().toUpperCase();
	return status || null;
}

function employmentDateForResolver(
	value: string | Date | null | undefined
): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string' && value.trim() === '') return null;
	const day = parseDay(value);
	if (day !== null) return day;
	// Keep malformed evidence visible to the shared resolver, which reports an
	// invalid date instead of silently treating it as absent.
	return typeof value === 'string' ? value : 'invalid-date';
}

const PAID_LEAVE_SET = new Set(PAID_LEAVE_CODES);
const UNPAID_LEAVE_SET = new Set(UNPAID_CODES);

// ─── Context and attendance index ───────────────────────────────────

interface AttendanceIndex {
	readonly byEmployee: ReadonlyMap<
		number,
		ReadonlyMap<string, CompanySheetAttendanceRecord>
	>;
	readonly duplicateDatesByEmployee: ReadonlyMap<number, ReadonlySet<string>>;
}

interface HolidayIndex {
	readonly dates: ReadonlySet<string>;
	readonly optionalDates: readonly string[];
	readonly invalidDates: readonly string[];
}

interface BuildContext {
	readonly monthKey: string;
	readonly monthStart: string;
	readonly monthEnd: string;
	readonly totalDays: number;
	readonly monthDays: readonly string[];
	readonly currentDate: string;
	readonly attendanceLoaded: boolean;
	readonly holidayLoaded: boolean;
	readonly attendance: AttendanceIndex;
	readonly holidays: HolidayIndex;
	readonly employmentByEmployee: ReadonlyMap<
		number,
		CompanySheetEmploymentInput
	>;
}

function indexAttendance(
	source: CompanySheetAttendanceSource,
	monthKey: string,
	globalIssues: CompanySheetIssue[]
): AttendanceIndex {
	const byEmployee = new Map<
		number,
		Map<string, CompanySheetAttendanceRecord>
	>();
	const duplicateDatesByEmployee = new Map<number, Set<string>>();
	const invalidDates: string[] = [];

	if (source.state === 'loaded') {
		for (const record of source.records ?? []) {
			const employeeId = Number(record.employee_id);
			const day = parseDay(record.attendance_date);
			if (!Number.isInteger(employeeId) || employeeId <= 0 || day === null) {
				invalidDates.push(String(record.attendance_date ?? ''));
				continue;
			}
			if (day.slice(0, 7) !== monthKey) continue;

			let records = byEmployee.get(employeeId);
			if (!records) {
				records = new Map();
				byEmployee.set(employeeId, records);
			}
			if (records.has(day)) {
				let duplicates = duplicateDatesByEmployee.get(employeeId);
				if (!duplicates) {
					duplicates = new Set();
					duplicateDatesByEmployee.set(employeeId, duplicates);
				}
				duplicates.add(day);
			}
			records.set(day, record);
		}
	}

	if (invalidDates.length > 0) {
		globalIssues.push(
			makeIssue(
				'attendance_record_invalid',
				'warning',
				'attendance',
				'Attendance records with a missing Employee or invalid date were ignored.',
				{ dates: invalidDates }
			)
		);
	}

	return { byEmployee, duplicateDatesByEmployee };
}

function indexHolidays(
	source: CompanySheetHolidaySource,
	monthKey: string,
	globalIssues: CompanySheetIssue[]
): HolidayIndex {
	const dates = new Set<string>();
	const optionalDates: string[] = [];
	const invalidDates: string[] = [];

	if (source.state === 'loaded') {
		for (const holiday of source.holidays ?? []) {
			const day = parseDay(holiday.date);
			if (day === null) {
				invalidDates.push(String(holiday.date ?? ''));
				continue;
			}
			if (day.slice(0, 7) !== monthKey) continue;
			if (flagValue(holiday.is_active) === false) continue;
			if (flagValue(holiday.is_optional) === true) {
				optionalDates.push(day);
				continue;
			}
			dates.add(day);
		}
	}

	if (invalidDates.length > 0) {
		globalIssues.push(
			makeIssue(
				'holiday_date_invalid',
				'warning',
				'source',
				'Holiday Master rows with an invalid date were ignored.',
				{ dates: invalidDates }
			)
		);
	}
	if (optionalDates.length > 0) {
		globalIssues.push(
			makeIssue(
				'optional_holidays_ignored',
				'info',
				'source',
				'Optional holidays are working days; only an explicit H status makes them a paid holiday.',
				{ dates: optionalDates }
			)
		);
	}

	return { dates, optionalDates, invalidDates };
}

// ─── Attendance classification ──────────────────────────────────────

interface AttendanceCounts {
	present: number;
	absent: number;
	halfDays: number;
	paidLeave: number;
	unpaidLeave: number;
	holidays: number;
	weeklyOff: number;
	unrecorded: number;
	upcomingUnrecorded: number;
	outsideEmployment: number;
	invalidStatus: number;
	recordedDays: number;
}

interface ClassifiedAttendance {
	readonly buckets: CompanySheetAttendanceBuckets;
	readonly invalidDates: readonly string[];
	readonly outsideRecordDates: readonly string[];
}

function classifyAttendance(
	context: BuildContext,
	employeeId: number,
	employment: ResolvedEmploymentDates
): ClassifiedAttendance {
	const records =
		context.attendance.byEmployee.get(employeeId) ??
		new Map<string, CompanySheetAttendanceRecord>();
	const counts: AttendanceCounts = {
		present: 0,
		absent: 0,
		halfDays: 0,
		paidLeave: 0,
		unpaidLeave: 0,
		holidays: 0,
		weeklyOff: 0,
		unrecorded: 0,
		upcomingUnrecorded: 0,
		outsideEmployment: 0,
		invalidStatus: 0,
		recordedDays: 0,
	};
	const paidLeaveByCode: Record<CompanySheetPaidLeaveCode, number> = {
		PL: 0,
		CL: 0,
		SL: 0,
		EL: 0,
	};
	const unpaidLeaveByCode: Record<CompanySheetUnpaidLeaveCode, number> = {
		LWP: 0,
		UL: 0,
	};
	const invalidDates: string[] = [];
	const outsideRecordDates: string[] = [];
	const otDays: Record<string, AttendanceDayInput> = {};

	for (const date of context.monthDays) {
		const outside =
			(employment.start !== null && date < employment.start) ||
			(employment.end !== null && date > employment.end);
		const record = records.get(date);

		if (outside) {
			counts.outsideEmployment += 1;
			if (record) outsideRecordDates.push(date);
			continue;
		}

		if (record) {
			otDays[date] = {
				status: record.status,
				overtime_hours: record.overtime_hours,
			};
		}

		const status = normalizeStatus(record?.status);
		if (status !== null) {
			counts.recordedDays += 1;
			switch (status) {
				case 'P':
				case 'OT':
					counts.present += 1;
					break;
				case 'HD':
					counts.present += 0.5;
					counts.absent += 0.5;
					counts.halfDays += 1;
					break;
				case 'A':
					counts.absent += 1;
					break;
				case 'H':
					counts.holidays += 1;
					break;
				case 'WO':
					counts.weeklyOff += 1;
					break;
				default:
					if (PAID_LEAVE_SET.has(status)) {
						const code = status as CompanySheetPaidLeaveCode;
						counts.paidLeave += 1;
						paidLeaveByCode[code] += 1;
					} else if (UNPAID_LEAVE_SET.has(status)) {
						const code = status as CompanySheetUnpaidLeaveCode;
						counts.unpaidLeave += 1;
						unpaidLeaveByCode[code] += 1;
					} else {
						// Malformed evidence is not Present, Absent, paid, or unpaid.
						// It stays reviewable and falls into Unrecorded for the
						// calendar identity.
						counts.invalidStatus += 1;
						counts.unrecorded += 1;
						invalidDates.push(date);
					}
					break;
			}
			continue;
		}

		// No recorded status: calendar defaults, Holiday before Weekly Off.
		if (context.holidays.dates.has(date)) {
			counts.holidays += 1;
		} else if (isWeeklyOff(date)) {
			counts.weeklyOff += 1;
		} else {
			counts.unrecorded += 1;
			if (date > context.currentDate) counts.upcomingUnrecorded += 1;
		}
	}

	const otHours = computeAttendanceSummary(otDays).totalOTHours;
	const daysPaid =
		counts.present + counts.paidLeave + counts.holidays + counts.weeklyOff;
	const lwpDays = counts.unpaidLeave + counts.absent;
	const calendarAccounted =
		counts.present +
		counts.absent +
		counts.paidLeave +
		counts.unpaidLeave +
		counts.holidays +
		counts.weeklyOff +
		counts.unrecorded +
		counts.outsideEmployment;
	const paidAccounted =
		daysPaid + lwpDays + counts.unrecorded + counts.outsideEmployment;
	const calendarBalanced =
		Math.abs(calendarAccounted - context.totalDays) < 1e-9;
	const paidBalanced = Math.abs(paidAccounted - context.totalDays) < 1e-9;

	return {
		buckets: {
			total_days: context.totalDays,
			present: counts.present,
			absent: counts.absent,
			half_days: counts.halfDays,
			paid_leave: counts.paidLeave,
			paid_leave_by_code: paidLeaveByCode,
			unpaid_leave: counts.unpaidLeave,
			unpaid_leave_by_code: unpaidLeaveByCode,
			holidays: counts.holidays,
			weekly_off: counts.weeklyOff,
			unrecorded: counts.unrecorded,
			upcoming_unrecorded: counts.upcomingUnrecorded,
			outside_employment: counts.outsideEmployment,
			invalid_status: counts.invalidStatus,
			recorded_days: counts.recordedDays,
			days_paid: daysPaid,
			lwp_days: lwpDays,
			ot_hours: otHours,
			reconciliation: {
				calendar_balanced: calendarBalanced,
				paid_balanced: paidBalanced,
			},
		},
		invalidDates,
		outsideRecordDates,
	};
}

type AttendanceOutcome =
	| {
			readonly state: 'available';
			readonly buckets: CompanySheetAttendanceBuckets;
			readonly issues: readonly CompanySheetIssue[];
	  }
	| {
			readonly state: 'unavailable';
			readonly reason: CompanySheetAttendanceUnavailableReason;
			readonly issues: readonly CompanySheetIssue[];
	  };

function computeRowAttendance(
	context: BuildContext,
	employeeId: number
): AttendanceOutcome {
	const issues: CompanySheetIssue[] = [];
	const evidence = context.employmentByEmployee.get(employeeId);
	const employment = resolveEmploymentDates(
		{
			status: evidence?.status ?? null,
			joining_date: employmentDateForResolver(evidence?.joining_date),
			hire_date: employmentDateForResolver(evidence?.hire_date),
			exit_date: employmentDateForResolver(evidence?.exit_date),
		},
		context.monthStart,
		context.monthEnd
	);

	if (employment.issue === 'employment_dates_missing') {
		issues.push(
			makeIssue(
				'employment_dates_missing',
				'warning',
				'employment',
				'Employment dates are incomplete, so dependant attendance counts are unavailable.',
				{ fields: ['joining_date', 'hire_date', 'exit_date'] }
			)
		);
	} else if (employment.issue === 'employment_dates_invalid') {
		issues.push(
			makeIssue(
				'employment_dates_invalid',
				'warning',
				'employment',
				'Employment dates are invalid or inconsistent, so dependant attendance counts are unavailable.',
				{ fields: ['joining_date', 'hire_date', 'exit_date'] }
			)
		);
	}
	if (employment.outside) {
		issues.push(
			makeIssue(
				'employment_outside_month',
				'info',
				'employment',
				'The known employment window puts every date of this month outside employment.'
			)
		);
	}

	const employmentUnavailable =
		employment.issue !== null && !employment.outside;
	let reason: CompanySheetAttendanceUnavailableReason | null = null;
	if (!context.attendanceLoaded) {
		reason = 'attendance_source_error';
	} else if (!context.holidayLoaded) {
		reason = 'holiday_source_error';
	} else if (employmentUnavailable) {
		reason = 'employment_unavailable';
	}

	if (reason !== null) {
		return { state: 'unavailable', reason, issues };
	}

	const classified = classifyAttendance(context, employeeId, employment);
	const duplicateDates =
		context.attendance.duplicateDatesByEmployee.get(employeeId);
	if (duplicateDates && duplicateDates.size > 0) {
		issues.push(
			makeIssue(
				'attendance_duplicate_date',
				'warning',
				'attendance',
				'More than one Attendance Record was supplied for the same date; the last one was used.',
				{ dates: [...duplicateDates] }
			)
		);
	}
	if (classified.invalidDates.length > 0) {
		issues.push(
			makeIssue(
				'invalid_attendance_status',
				'warning',
				'attendance',
				'An unrecognised Attendance Record status is shown as Unrecorded for review.',
				{ dates: classified.invalidDates }
			)
		);
	}
	if (classified.outsideRecordDates.length > 0) {
		issues.push(
			makeIssue(
				'attendance_outside_employment',
				'warning',
				'attendance',
				'Attendance evidence outside the validated employment window is counted as Outside Employment.',
				{ dates: classified.outsideRecordDates }
			)
		);
	}
	if (
		!classified.buckets.reconciliation.calendar_balanced ||
		!classified.buckets.reconciliation.paid_balanced
	) {
		issues.push(
			makeIssue(
				'attendance_reconciliation_gap',
				'warning',
				'attendance',
				'The attendance categories do not reconcile to the calendar month.'
			)
		);
	}

	return { state: 'available', buckets: classified.buckets, issues };
}

function attendanceCells(
	outcome: AttendanceOutcome,
	totalDays: number
): Pick<
	Record<CompanySheetColumnId, CompanySheetCell>,
	| 'total_days'
	| 'days_present'
	| 'days_paid'
	| 'lwp_days'
	| 'leave'
	| 'week_off'
	| 'paid_holiday'
	| 'ot_hours'
> {
	if (outcome.state === 'unavailable') {
		const unavailable = notAvailable(outcome.reason);
		return {
			total_days: numberCell(totalDays),
			days_present: unavailable,
			days_paid: unavailable,
			lwp_days: unavailable,
			leave: unavailable,
			week_off: unavailable,
			paid_holiday: unavailable,
			ot_hours: unavailable,
		};
	}
	const buckets = outcome.buckets;
	return {
		total_days: numberCell(totalDays),
		days_present: numberCell(buckets.present),
		days_paid: numberCell(buckets.days_paid),
		lwp_days: numberCell(buckets.lwp_days),
		leave: numberCell(buckets.paid_leave),
		week_off: numberCell(buckets.weekly_off),
		paid_holiday: numberCell(buckets.holidays),
		ot_hours: numberCell(buckets.ot_hours),
	};
}

// ─── Financial mapping ──────────────────────────────────────────────

const UNSUPPORTED_MONEY_IDS = [
	'paid_holiday_amount',
	'ot_rate',
	'basic_arrears',
	'da_arrears',
	'hra_arrears',
	'calw_arrears',
	'calalw_arrears',
	'othalw_arrears',
	'pha_arrears',
	'bonus_arrears',
	'ot_arrears',
	'incentive_arrears',
	'ebonus',
	'emprpf',
	'pai',
	'rate',
	'ec',
	'epfwage',
	'pf_difference_amount',
	'loan',
	'advance',
] as const satisfies readonly CompanySheetColumnId[];

function deductionDetail(
	id: CompanySheetDeductionDetailId,
	label: string,
	value: unknown,
	inCompanyColumns: boolean,
	note?: string
): CompanySheetDeductionDetail {
	const amount = readAmount(value);
	return {
		id,
		label,
		amount,
		state: amount === null ? 'not_recorded' : 'recorded',
		in_company_columns: inCompanyColumns,
		...(note ? { note } : {}),
	};
}

function deductionDetails(slip: CompanySheetSlipInput): {
	readonly details: readonly CompanySheetDeductionDetail[];
	readonly hasCombinedOther: boolean;
} {
	const otherDeductions = readAmount(slip.other_deductions);
	const details = [
		deductionDetail(
			'pf_employee',
			'Provident Fund (employee)',
			slip.pf_employee,
			true
		),
		deductionDetail(
			'esic_employee',
			'ESIC (employee)',
			slip.esic_employee,
			true
		),
		deductionDetail('professional_tax', 'Professional Tax', slip.pt, true),
		deductionDetail(
			'tax_deducted_at_source',
			'Tax Deducted at Source',
			slip.tds,
			true
		),
		deductionDetail(
			'retention_amount',
			'Retention Amount',
			slip.retention,
			true
		),
		deductionDetail('mlwf', 'MLWF (labour welfare)', slip.mlwf, false),
		deductionDetail('lwf', 'LWF (labour welfare)', slip.lwf, false),
		deductionDetail(
			'other_deductions',
			'Other deductions (combined)',
			slip.other_deductions,
			false,
			'Stored as one combined amount; Loan and Advance are not separately recorded on the Payroll Slip.'
		),
		deductionDetail(
			'lop_deduction',
			'LOP deduction',
			slip.lop_deduction,
			false
		),
	];

	return {
		details,
		hasCombinedOther: otherDeductions !== null && otherDeductions > 0,
	};
}

interface VisibleBasicDa {
	readonly basic: number | null;
	readonly da: number | null;
}

function reconcileFinancials(
	slip: CompanySheetSlipInput,
	visible: VisibleBasicDa,
	details: readonly CompanySheetDeductionDetail[],
	issues: CompanySheetIssue[]
): void {
	const totalEarnings = readAmount(slip.total_earnings);
	const earningComponents = [
		{ id: 'basic', value: visible.basic },
		{ id: 'da', value: visible.da },
		{ id: 'hra', value: readAmount(slip.hra) },
		{ id: 'conveyance_allowance', value: readAmount(slip.conveyance) },
		{ id: 'call_allowance', value: readAmount(slip.call_allowance) },
		{ id: 'other_allowance', value: readAmount(slip.other_allowances) },
		{ id: 'bonus', value: readAmount(slip.bonus) },
		{ id: 'incentive', value: readAmount(slip.incentive) },
	];
	const earningSum = toNumber(
		add(...earningComponents.map((component) => component.value ?? 0))
	);

	if (totalEarnings === null) {
		issues.push(
			makeIssue(
				'earnings_total_not_recorded',
				'warning',
				'financial',
				'The Payroll Slip has no recorded earnings total.'
			)
		);
	} else {
		const missingEarnings = earningComponents
			.filter((component) => component.value === null)
			.map((component) => component.id);
		if (missingEarnings.length > 0) {
			issues.push(
				makeIssue(
					'earnings_components_not_recorded',
					'warning',
					'financial',
					'Some visible earnings components are not recorded on the Payroll Slip.',
					{ fields: missingEarnings }
				)
			);
		}
		const difference = toNumber(sub(totalEarnings, earningSum));
		if (!isZero(sub(totalEarnings, earningSum))) {
			issues.push(
				makeIssue(
					'earnings_reconciliation_gap',
					'warning',
					'financial',
					'The recorded earnings total is not fully explained by the visible company columns.',
					{ difference }
				)
			);
		}
	}

	const totalDeductions = readAmount(slip.total_deductions);
	const deductionValues = details.map((detail) => ({
		id: detail.id,
		value: detail.amount,
	}));
	const deductionSum = toNumber(
		add(...deductionValues.map((component) => component.value ?? 0))
	);

	if (totalDeductions === null) {
		issues.push(
			makeIssue(
				'deductions_total_not_recorded',
				'warning',
				'financial',
				'The Payroll Slip has no recorded deductions total.'
			)
		);
	} else {
		const missingDeductions = deductionValues
			.filter((component) => component.value === null)
			.map((component) => component.id);
		if (missingDeductions.length > 0) {
			issues.push(
				makeIssue(
					'deductions_components_not_recorded',
					'warning',
					'financial',
					'Some recorded deduction components are missing from the Payroll Slip.',
					{ fields: missingDeductions }
				)
			);
		}
		const difference = toNumber(sub(totalDeductions, deductionSum));
		if (!isZero(sub(totalDeductions, deductionSum))) {
			issues.push(
				makeIssue(
					'deductions_reconciliation_gap',
					'warning',
					'financial',
					'The recorded deductions total is not fully explained by the recorded deduction components.',
					{ difference }
				)
			);
		}
	}

	const netPay = readAmount(slip.net_pay);
	if (netPay === null) {
		issues.push(
			makeIssue(
				'net_total_not_recorded',
				'warning',
				'financial',
				'The Payroll Slip has no recorded net amount.'
			)
		);
		return;
	}
	if (totalEarnings !== null && totalDeductions !== null) {
		const expectedNet = toNumber(sub(totalEarnings, totalDeductions));
		const difference = toNumber(sub(netPay, expectedNet));
		if (!isZero(sub(netPay, expectedNet))) {
			issues.push(
				makeIssue(
					'net_reconciliation_gap',
					'warning',
					'financial',
					'The recorded net amount does not equal the recorded earnings less deductions.',
					{ difference }
				)
			);
		}
	}
}

// ─── Row builder ────────────────────────────────────────────────────

function buildRow(
	slip: CompanySheetSlipInput,
	context: BuildContext
): CompanySheetRow {
	const issues: CompanySheetIssue[] = [];
	const attendance = computeRowAttendance(context, slip.employee_id);
	issues.push(...attendance.issues);

	// Read the normalized figures exactly once per row. Basic/DA are display
	// values already derived by the listing; the totals below are read raw so
	// null stays missing instead of collapsing to a fabricated zero.
	const figures = normalizedSlipFigures(slip);
	const basicInstalled = readAmount(slip.basic);
	const daInstalled = readAmount(slip.da);
	const basic = basicInstalled === null ? null : figures.basic;
	const da = daInstalled === null ? null : figures.da;
	const { details, hasCombinedOther } = deductionDetails(slip);

	if (hasCombinedOther) {
		issues.push(
			makeIssue(
				'loan_advance_split_unavailable',
				'info',
				'financial',
				'Other deductions are recorded as one combined amount; the Loan/Advance split is unavailable.'
			)
		);
	}

	const slipMonth = monthKeyOf(slip.month);
	if (slipMonth !== null && slipMonth !== context.monthKey) {
		issues.push(
			makeIssue(
				'slip_month_mismatch',
				'warning',
				'slip',
				'The Payroll Slip month does not match the selected company-sheet month.'
			)
		);
	}

	reconcileFinancials(slip, { basic, da }, details, issues);

	const cells: Record<CompanySheetColumnId, CompanySheetCell> = {
		...attendanceCells(attendance, context.totalDays),
		employee_code: textCell(slip.employee_code),
		full_name: textCell(slip.employee_name),
		designation: textCell(slip.position),
		uan: textCell(slip.uan),
		pf_no: textCell(slip.pf_no),
		esic_no: textCell(slip.esi_no),
		basic: basic === null ? notAvailable('not_recorded') : numberCell(basic),
		da: da === null ? notAvailable('not_recorded') : numberCell(da),
		hra: amountCell(slip.hra),
		conveyance_allowance: amountCell(slip.conveyance),
		call_allowance: amountCell(slip.call_allowance),
		other_allowance: amountCell(slip.other_allowances),
		bonus: amountCell(slip.bonus),
		incentive: amountCell(slip.incentive),
		gross: amountCell(slip.total_earnings),
		provident_fund: amountCell(slip.pf_employee),
		esic: amountCell(slip.esic_employee),
		professional_tax: amountCell(slip.pt),
		tax_deducted_at_source: amountCell(slip.tds),
		retention_amount: amountCell(slip.retention),
		total_ded: amountCell(slip.total_deductions),
		net_sal: amountCell(slip.net_pay),
	} as Record<CompanySheetColumnId, CompanySheetCell>;

	for (const id of UNSUPPORTED_MONEY_IDS) {
		cells[id] = notAvailable('unsupported_mapping');
	}

	return {
		slip_id: slip.id,
		employee_id: slip.employee_id,
		cells,
		attendance:
			attendance.state === 'available'
				? { state: 'available', buckets: attendance.buckets }
				: { state: 'unavailable', reason: attendance.reason },
		deduction_details: details,
		issues,
	};
}

// ─── Public read model ──────────────────────────────────────────────

export function buildCompanySheet(
	input: CompanySheetInput
): CompanySheetResult {
	const month = normalizePayrollRunMonth(input.month);
	const monthKey = month.slice(0, 7);
	const currentDate = parseDay(input.current_date);
	if (currentDate === null) {
		throw new Error(
			`Invalid company-sheet current date "${input.current_date}" — expected YYYY-MM-DD`
		);
	}

	const [year, monthNumber] = monthKey.split('-').map(Number);
	const totalDays = daysInMonth(year, monthNumber);
	const monthStart = month;
	const monthEnd = `${monthKey}-${String(totalDays).padStart(2, '0')}`;
	const monthDays = Array.from(
		{ length: totalDays },
		(_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`
	);

	const globalIssues: CompanySheetIssue[] = [];
	const attendanceSource: CompanySheetAttendanceSource = input.attendance ?? {
		state: 'error',
		message: 'Attendance evidence was not supplied.',
	};
	const holidaySource: CompanySheetHolidaySource = input.holidays ?? {
		state: 'error',
		message: 'Holiday evidence was not supplied.',
	};
	const attendanceLoaded = attendanceSource.state === 'loaded';
	const holidayLoaded = holidaySource.state === 'loaded';

	if (!attendanceLoaded) {
		globalIssues.push(
			makeIssue(
				'attendance_source_error',
				'unavailable',
				'source',
				attendanceSource.message ||
					'Attendance evidence could not be read; attendance counts are unavailable.',
				{}
			)
		);
	}
	if (!holidayLoaded) {
		globalIssues.push(
			makeIssue(
				'holiday_source_error',
				'unavailable',
				'source',
				holidaySource.message ||
					'Holiday evidence could not be read; attendance counts are unavailable.',
				{}
			)
		);
	}

	const attendance = indexAttendance(attendanceSource, monthKey, globalIssues);
	const holidays = indexHolidays(holidaySource, monthKey, globalIssues);
	const employmentByEmployee = new Map<number, CompanySheetEmploymentInput>();
	for (const evidence of input.employment ?? []) {
		if (Number.isInteger(evidence.employee_id)) {
			employmentByEmployee.set(evidence.employee_id, evidence);
		}
	}

	const context: BuildContext = {
		monthKey,
		monthStart,
		monthEnd,
		totalDays,
		monthDays,
		currentDate,
		attendanceLoaded,
		holidayLoaded,
		attendance,
		holidays,
		employmentByEmployee,
	};

	return {
		month,
		month_key: monthKey,
		current_date: currentDate,
		total_days: totalDays,
		rows: (input.slips ?? []).map((slip) => buildRow(slip, context)),
		sources: {
			attendance: {
				state: attendanceLoaded ? 'loaded' : 'error',
				message: attendanceLoaded
					? null
					: (attendanceSource.message ?? 'Attendance evidence unavailable.'),
			},
			holidays: {
				state: holidayLoaded ? 'loaded' : 'error',
				message: holidayLoaded
					? null
					: (holidaySource.message ?? 'Holiday evidence unavailable.'),
			},
		},
		issues: globalIssues,
	};
}
