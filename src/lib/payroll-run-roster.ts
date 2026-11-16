/**
 * Payroll Run roster — monthly employment eligibility, Salary Profile
 * selection at the month's anchor date, and the immutable roster snapshot
 * taken at Finalize.
 *
 * The roster is the complete, validated expected set of a payroll month. It is
 * deliberately wider than the month's already-generated Payroll Slips:
 *
 * - An employee is eligible when any day of their employment window falls in
 *   the month. `joining_date` wins, `hire_date` is the fallback, and an
 *   explicit `exit_date` closes the window inclusively. `created_at` never
 *   determines employment.
 * - Payroll candidates are employees with an active Salary Profile covering
 *   the month, Payroll/Contract employees without one (the missing-profile
 *   gate), and people with the month's Payroll Slip or positive Logged Hours.
 *   Agreement-paid employees are not constrained by Employee Type.
 * - A candidate who cannot be placed in the month is reported under
 *   `excluded` with the date that excluded them. A known start after the month
 *   or a known exit before it is definite even when the other date is missing;
 *   an unknown exit never makes a future hire block an earlier month. Missing
 *   or inverted employment dates on an in-month candidate, and work or slips
 *   outside the known employment window, are named on the member instead of
 *   being silently dropped.
 *
 * Profile selection uses the shared period-effective selector. Exactly one
 * active canonical `employee_salary_profile` agreement must cover the anchor;
 * two or more covering agreements are ambiguous and no row is chosen. Only
 * when no canonical agreement covers the anchor may a period-effective legacy
 * `salary_structures` agreement supply the identity, with legacy fields still
 * available as the read-only field fallback. The monthly CTC is resolved by
 * the shared presence-based resolver, so an explicit canonical zero is a real
 * salary and a missing/invalid CTC is reported without inventing a gross. The
 * anchor is `max(month first day, employment start)`, so a mid-month new hire
 * is priced from their joining date without repricing an established employee
 * for a mid-month rate edit.
 *
 * Finalize snapshots add one append-only version per run. The snapshot keeps
 * only identity and profile provenance — never Salary Profile money, which is
 * mutable and already frozen on the Payroll Slips and allocations. A reopened
 * draft is not finalized, so `loadFrozenPayrollRunRoster` returns null for it;
 * re-finalizing appends the next version instead of overwriting history.
 */

import {
	hoursByDateForMonth,
	sumLoggedHoursForMonth,
} from '@/lib/logged-hours';
import { resolveLoggedHoursEmployeeId } from '@/lib/logged-hours-source';
import { resolveSalaryCtc, type SalaryCtcSource } from '@/lib/salary-ctc';
import {
	resolveSalaryAgreementAt,
	salaryMonthAnchor,
} from '@/lib/salary-profile-timeline';
import { lockSalaryEmployees } from '@/lib/salary-profile-store';
import { normalizeSalaryProfile } from '@/utils/payroll-calculation';

export type PayrollRunProfileSource =
	| 'employee_salary_profile'
	| 'salary_structures';

export type PayrollRunMemberIssue =
	| 'employment_dates_missing'
	| 'employment_dates_invalid'
	| 'work_outside_employment';

/**
 * Salary readiness, deliberately separate from the employment-date `issue`.
 * `salary_profile_missing` is the ordinary no-agreement gap; ambiguity is a
 * review state with no chosen agreement; the CTC issues mean a covering
 * agreement exists but cannot price the month.
 */
export type PayrollRunSalaryIssue =
	| 'salary_profile_missing'
	| 'salary_profile_ambiguous'
	| 'salary_ctc_missing'
	| 'salary_ctc_invalid';

/** One employee in the month's validated payroll roster. */
export interface PayrollRunMember {
	employee_id: number;
	employee_code: string;
	name: string;
	employee_type: string | null;
	employment_start: string | null;
	employment_end: string | null;
	/** `max(month first day, employment start)` — the date the profile is read at. */
	profile_date: string;
	salary_profile: Record<string, unknown> | null;
	profile_source: PayrollRunProfileSource | null;
	profile_id: number | null;
	salary_type: string | null;
	/** Salary readiness; `issue` remains employment-date-only. */
	salary_issue: PayrollRunSalaryIssue | null;
	/** Sorted covering agreement ids behind an ambiguity; empty otherwise. */
	salary_conflict_ids: number[];
	/** CTC source disclosed by the shared resolver; `none` when unresolved. */
	salary_ctc_source: SalaryCtcSource;
	issue: PayrollRunMemberIssue | null;
}

/** A candidate left out of the month, with the date that excluded them. */
export interface PayrollRunExcludedMember {
	employee_id: number;
	employee_code: string;
	name: string;
	reason: string;
}

export interface PayrollRunRoster {
	month: string;
	members: PayrollRunMember[];
	excluded: PayrollRunExcludedMember[];
}

/**
 * The immutable part of a member. Identity and profile provenance are frozen;
 * Salary Profile money is not, because Payroll Slips and allocations own the
 * month's money and the profile can change after Finalize.
 */
export interface FrozenPayrollRunMember {
	employee_id: number;
	employee_code: string;
	name: string;
	employment_start: string | null;
	employment_end: string | null;
	profile_date: string;
	profile_source: PayrollRunProfileSource;
	profile_id: number;
	salary_type: string;
}

export interface FrozenPayrollRunRoster {
	run_id: number;
	month: string;
	version: number;
	frozen_at: string | null;
	members: FrozenPayrollRunMember[];
}

/* ── database boundary ─────────────────────────────────────────────── */

/**
 * The slice of a connection this module uses. Structural so a request
 * connection, a transaction, or a focused test double all satisfy it.
 */
export interface PayrollRunRosterDb {
	execute(
		sql: string,
		params?: Array<string | number | boolean | null>
	): Promise<[unknown, unknown]>;
}

/* ── loader input rows ─────────────────────────────────────────────── */

export interface PayrollRunEmployeeRow {
	id: number | string;
	employee_id: string;
	name?: string | null;
	first_name?: string | null;
	last_name?: string | null;
	employee_type?: string | null;
	status?: string | null;
	joining_date?: string | null;
	hire_date?: string | null;
	exit_date?: string | null;
	isDelete?: number | string | boolean | null;
}

export interface PayrollRunProfileRow {
	id: number | string;
	employee_id: number | string;
	effective_from?: string | null;
	effective_to?: string | null;
	is_active?: number | string | boolean | null;
	[key: string]: unknown;
}

export interface PayrollRunAssignmentRow {
	employee_id?: number | string | null;
	user_employee_id?: number | string | null;
	daily_entries?: unknown;
}

/** Everything the pure roster builder needs, already loaded from the database. */
export interface PayrollRunRosterInput {
	month: string;
	employees: readonly PayrollRunEmployeeRow[];
	canonical_profiles: readonly PayrollRunProfileRow[];
	legacy_profiles: readonly PayrollRunProfileRow[];
	slip_employee_ids: readonly (number | string)[];
	assignments: readonly PayrollRunAssignmentRow[];
}

/* ── small text/date/identity helpers ──────────────────────────────── */

function daysInMonth(year: number, month: number): number {
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
		month - 1
	];
}

/**
 * Normalise `YYYY-MM` or `YYYY-MM-01` to the first of the month. A payroll
 * month is always a calendar month; anything else is a caller bug, not a
 * reason to guess.
 */
export function normalizePayrollRunMonth(month: string): string {
	const match = /^(\d{4})-(\d{2})(?:-(01))?$/.exec(String(month ?? '').trim());
	const monthNumber = Number(match?.[2]);
	if (!match || monthNumber < 1 || monthNumber > 12) {
		throw new Error(
			`Invalid payroll month "${month}" — expected YYYY-MM or YYYY-MM-01`
		);
	}
	return `${match[1]}-${match[2]}-01`;
}

function monthBounds(month: string): { start: string; end: string } {
	const [year, monthNumber] = month.split('-').map(Number);
	return {
		start: month,
		end: `${month.slice(0, 7)}-${String(
			daysInMonth(year, monthNumber)
		).padStart(2, '0')}`,
	};
}

/**
 * A stored date as a canonical `YYYY-MM-DD` day, or null when it is absent or
 * not a real calendar date. Database columns can hold a datetime string, so
 * the time part is ignored; `2026-02-30` and `0000-00-00` are not dates.
 */
function parseDay(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	if (!text) return null;
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(text);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12) return null;
	if (day < 1 || day > daysInMonth(year, month)) return null;
	return `${match[1]}-${match[2]}-${match[3]}`;
}

function text(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return null;
}

function positiveInteger(value: unknown): number | null {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : null;
}

function firstRow(value: unknown): Record<string, unknown> | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const first = value[0];
	return typeof first === 'object' && first !== null && !Array.isArray(first)
		? (first as Record<string, unknown>)
		: null;
}

/** The object rows of a mysql2 result tuple, ignoring a malformed value. */
function rowsOf(value: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is Record<string, unknown> =>
			typeof row === 'object' && row !== null && !Array.isArray(row)
	);
}

function dateTimeText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date)
		return value.toISOString().slice(0, 19).replace('T', ' ');
	return String(value);
}

/* ── deterministic order ───────────────────────────────────────────── */

const CHAR_0 = 48;
const CHAR_9 = 57;

const isDigitCode = (code: number): boolean => code >= CHAR_0 && code <= CHAR_9;

/**
 * Employee-code order with digit runs compared as numbers, so `EMP-2` comes
 * before `EMP-10`. Pure string work with no locale, so a frozen roster keeps
 * the same order on every host.
 */
function compareEmployeeCode(a: string, b: string): number {
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const digitA = isDigitCode(a.charCodeAt(i));
		const digitB = isDigitCode(b.charCodeAt(j));
		if (digitA && digitB) {
			const startA = i;
			const startB = j;
			while (i < a.length && isDigitCode(a.charCodeAt(i))) i++;
			while (j < b.length && isDigitCode(b.charCodeAt(j))) j++;
			const valueA = Number(a.slice(startA, i));
			const valueB = Number(b.slice(startB, j));
			if (valueA !== valueB) return valueA - valueB;
			continue;
		}
		const charA = a.charCodeAt(i);
		const charB = b.charCodeAt(j);
		if (charA !== charB) return charA - charB;
		i++;
		j++;
	}
	return a.length - i - (b.length - j);
}

function compareText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareMembers(
	a: Pick<PayrollRunMember, 'employee_id' | 'employee_code' | 'name'>,
	b: Pick<PayrollRunMember, 'employee_id' | 'employee_code' | 'name'>
): number {
	return (
		compareEmployeeCode(a.employee_code, b.employee_code) ||
		compareText(a.name, b.name) ||
		a.employee_id - b.employee_id
	);
}

/* ── employment dates ──────────────────────────────────────────────── */

export interface ResolvedEmploymentDates {
	start: string | null;
	end: string | null;
	issue: PayrollRunMemberIssue | null;
	/**
	 * The known dates put every employed day outside the month. Absent
	 * contradictory month evidence the person is excluded; contradictory
	 * evidence keeps them visible for review.
	 */
	outside: boolean;
}

/**
 * Resolve the employment window and name the reason it cannot be trusted.
 *
 * `joining_date` wins and `hire_date` is only a fallback for a missing
 * joining date: a present-but-invalid joining date is corrupt master data, not
 * a licence to ignore it. An inactive employee without an `exit_date` is not
 * given an invented end; a known start inside the month is a review issue.
 *
 * A known start after the month end is a definite future hire: an unknown or
 * irrelevant exit cannot make that person block the earlier month. Likewise, a
 * known exit before the month is definite even when the start is missing. Both
 * are still surfaced when the month carries a slip or Logged Hours.
 */
export function resolveEmploymentDates(
	row: Pick<
		PayrollRunEmployeeRow,
		'status' | 'joining_date' | 'hire_date' | 'exit_date'
	>,
	monthStart: string,
	monthEnd: string
): ResolvedEmploymentDates {
	const joiningRaw = text(row.joining_date);
	const hireRaw = text(row.hire_date);
	const exitRaw = text(row.exit_date);
	const joining = parseDay(joiningRaw);
	const hire = parseDay(hireRaw);
	const exit = parseDay(exitRaw);

	if (joiningRaw !== null && joining === null) {
		return {
			start: null,
			end: exit,
			issue: 'employment_dates_invalid',
			outside: false,
		};
	}
	if (exitRaw !== null && exit === null) {
		return {
			start: joining,
			end: null,
			issue: 'employment_dates_invalid',
			outside: false,
		};
	}
	if (joiningRaw === null && hireRaw !== null && hire === null) {
		return {
			start: null,
			end: exit,
			issue: 'employment_dates_invalid',
			outside: false,
		};
	}

	const start = joining ?? hire;
	if (start !== null && exit !== null && start > exit) {
		return {
			start,
			end: exit,
			issue: 'employment_dates_invalid',
			outside: false,
		};
	}

	if (start !== null) {
		if (start > monthEnd) {
			return { start, end: exit, issue: null, outside: true };
		}
		if (exit !== null && exit < monthStart) {
			return { start, end: exit, issue: null, outside: true };
		}
		if (exit === null) {
			const status = text(row.status);
			const active = status === null || status.toLowerCase() === 'active';
			if (!active) {
				return {
					start,
					end: null,
					issue: 'employment_dates_missing',
					outside: false,
				};
			}
		}
		return { start, end: exit, issue: null, outside: false };
	}

	// The start is unknown. A known exit before the month proves the person
	// cannot have been employed in it; without an exit the window is unresolved.
	if (exit !== null && exit < monthStart) {
		return {
			start: null,
			end: exit,
			issue: 'employment_dates_missing',
			outside: true,
		};
	}
	return {
		start: null,
		end: exit,
		issue: 'employment_dates_missing',
		outside: false,
	};
}

function exclusionReason(
	start: string | null,
	end: string | null,
	month: string
): string {
	if (start !== null && start > month) {
		return `Employment starts ${start} (after ${month})`;
	}
	if (end !== null) {
		return `Employment ended ${end} (before ${month})`;
	}
	return `Not employed in ${month}`;
}

/* ── Salary Profile selection ──────────────────────────────────────── */

function profileIsActive(row: PayrollRunProfileRow): boolean {
	const value = row.is_active;
	if (value === undefined || value === null) return true;
	return value === true || value === 1 || value === '1' || value === 'true';
}

function groupProfiles(
	rows: readonly PayrollRunProfileRow[]
): Map<number, PayrollRunProfileRow[]> {
	const grouped = new Map<number, PayrollRunProfileRow[]>();
	for (const row of rows) {
		if (!profileIsActive(row)) continue;
		const employeeId = positiveInteger(row.employee_id);
		if (employeeId === null) continue;
		const list = grouped.get(employeeId) ?? [];
		list.push(row);
		grouped.set(employeeId, list);
	}
	return grouped;
}

/** Whether an active profile covers at least one day of the month. */
function profileCoversMonth(
	row: PayrollRunProfileRow,
	monthStart: string,
	monthEnd: string
): boolean {
	const from = parseDay(row.effective_from);
	if (from === null || from > monthEnd) return false;
	const toRaw = text(row.effective_to);
	const to = parseDay(toRaw);
	if (toRaw !== null && to === null) return false;
	return to === null || to >= monthStart;
}

interface SelectedProfile {
	salary_profile: Record<string, unknown> | null;
	profile_source: PayrollRunProfileSource | null;
	profile_id: number | null;
	salary_type: string | null;
	salary_issue: PayrollRunSalaryIssue | null;
	salary_conflict_ids: number[];
	salary_ctc_source: SalaryCtcSource;
}

/** The selection when the anchor has no single usable agreement. */
function unresolvedProfile(
	issue: PayrollRunSalaryIssue,
	conflictIds: readonly number[] = []
): SelectedProfile {
	return {
		salary_profile: null,
		profile_source: null,
		profile_id: null,
		salary_type: null,
		salary_issue: issue,
		salary_conflict_ids: [...conflictIds].sort((left, right) => left - right),
		salary_ctc_source: 'none',
	};
}

/** Resolve the displayed terms of one selected agreement and its CTC. */
function selectedProfile(
	row: Record<string, unknown>,
	source: PayrollRunProfileSource,
	legacyFallback: Record<string, unknown> | null
): SelectedProfile {
	const normalized = normalizeSalaryProfile(
		source === 'employee_salary_profile' ? row : null,
		source === 'salary_structures' ? row : legacyFallback
	) as Record<string, unknown>;
	const ctc = resolveSalaryCtc(normalized);
	return {
		salary_profile: normalized,
		profile_source: source,
		profile_id: positiveInteger(row.id),
		// The schema's default stream is monthly; a blank type must not make a
		// valid profile impossible to freeze.
		salary_type: text(normalized.salary_type) ?? 'monthly',
		salary_issue:
			ctc.status === 'missing'
				? 'salary_ctc_missing'
				: ctc.status === 'invalid'
					? 'salary_ctc_invalid'
					: null,
		salary_conflict_ids: [],
		salary_ctc_source: ctc.status === 'resolved' ? ctc.source : 'none',
	};
}

/**
 * Select the month's pay terms at `anchor` with the shared covering resolver.
 *
 * Canonical ambiguity is decisive: a legacy agreement is never allowed to hide
 * competing canonical rows. Only an unavailable canonical range falls back to
 * the period-effective legacy agreement, which then owns the identity while
 * its fields remain the read-only legacy fallback.
 */
function selectProfile(
	canonicalRows: readonly PayrollRunProfileRow[] | undefined,
	legacyRows: readonly PayrollRunProfileRow[] | undefined,
	anchor: string,
	employeeId: number
): SelectedProfile {
	const canonical = resolveSalaryAgreementAt(canonicalRows ?? [], anchor, {
		source: 'employee_salary_profile',
		employeeId,
	});
	if (canonical.state === 'ambiguous') {
		return unresolvedProfile(
			'salary_profile_ambiguous',
			canonical.conflict_ids
		);
	}

	const legacy = resolveSalaryAgreementAt(legacyRows ?? [], anchor, {
		source: 'salary_structures',
		employeeId,
	});

	if (canonical.state === 'selected' && canonical.profile !== null) {
		return selectedProfile(
			canonical.profile,
			'employee_salary_profile',
			legacy.state === 'selected' ? legacy.profile : null
		);
	}
	if (legacy.state === 'ambiguous') {
		return unresolvedProfile('salary_profile_ambiguous', legacy.conflict_ids);
	}
	if (legacy.state === 'selected' && legacy.profile !== null) {
		return selectedProfile(legacy.profile, 'salary_structures', null);
	}
	return unresolvedProfile('salary_profile_missing');
}

/* ── logged-hours evidence ─────────────────────────────────────────── */

interface MonthEvidence {
	hours: number;
	payloads: unknown[];
}

function collectMonthEvidence(
	assignments: readonly PayrollRunAssignmentRow[],
	monthKey: string
): Map<number, MonthEvidence> {
	const byEmployee = new Map<number, MonthEvidence>();
	for (const row of assignments) {
		const employeeId = resolveLoggedHoursEmployeeId(row);
		if (!employeeId) continue;
		const hours = sumLoggedHoursForMonth([row.daily_entries], monthKey);
		if (!(hours > 0)) continue;
		const current = byEmployee.get(employeeId) ?? {
			hours: 0,
			payloads: [],
		};
		current.hours = Math.round((current.hours + hours) * 100) / 100;
		current.payloads.push(row.daily_entries);
		byEmployee.set(employeeId, current);
	}
	return byEmployee;
}

function hasWorkOutsideEmployment(
	evidence: MonthEvidence | undefined,
	monthKey: string,
	start: string | null,
	end: string | null
): boolean {
	if (!evidence || start === null) return false;
	const byDate = hoursByDateForMonth(evidence.payloads, monthKey);
	for (const [day, hours] of Object.entries(byDate)) {
		if (hours <= 0) continue;
		if (day < start) return true;
		if (end !== null && day > end) return true;
	}
	return false;
}

/* ── pure builder ──────────────────────────────────────────────────── */

function memberName(row: PayrollRunEmployeeRow, employeeId: number): string {
	const explicit = text(row.name);
	if (explicit !== null) return explicit;
	const combined = [text(row.first_name), text(row.last_name)]
		.filter((part): part is string => part !== null)
		.join(' ')
		.trim();
	return combined || `Employee #${employeeId}`;
}

/**
 * Build the month's roster from already-loaded rows. Pure: no database, clock,
 * or framework reads, so every eligibility edge is testable in isolation.
 */
export function buildPayrollRunRoster(
	input: PayrollRunRosterInput
): PayrollRunRoster {
	const month = normalizePayrollRunMonth(input.month);
	const { start: monthStart, end: monthEnd } = monthBounds(month);
	const monthKey = month.slice(0, 7);

	const employees = new Map<number, PayrollRunEmployeeRow>();
	for (const row of input.employees) {
		if (
			row.isDelete === true ||
			row.isDelete === 1 ||
			row.isDelete === '1' ||
			row.isDelete === 'true'
		)
			continue;
		const employeeId = positiveInteger(row.id);
		if (employeeId === null) continue;
		employees.set(employeeId, row);
	}

	const canonicalProfiles = groupProfiles(input.canonical_profiles);
	const legacyProfiles = groupProfiles(input.legacy_profiles);
	const slips = new Set<number>();
	for (const value of input.slip_employee_ids) {
		const employeeId = positiveInteger(value);
		if (employeeId !== null) slips.add(employeeId);
	}
	const evidence = collectMonthEvidence(input.assignments, monthKey);

	const candidates = new Set<number>();
	for (const [employeeId, rows] of canonicalProfiles) {
		if (rows.some((row) => profileCoversMonth(row, monthStart, monthEnd)))
			candidates.add(employeeId);
	}
	for (const [employeeId, rows] of legacyProfiles) {
		if (rows.some((row) => profileCoversMonth(row, monthStart, monthEnd)))
			candidates.add(employeeId);
	}
	for (const [employeeId, row] of employees) {
		const employeeType = text(row.employee_type)?.toLowerCase();
		if (employeeType === 'payroll' || employeeType === 'contract')
			candidates.add(employeeId);
	}
	for (const employeeId of slips) candidates.add(employeeId);
	for (const [employeeId, row] of evidence) {
		if (row.hours > 0) candidates.add(employeeId);
	}

	const members: PayrollRunMember[] = [];
	const excluded: PayrollRunExcludedMember[] = [];

	for (const employeeId of candidates) {
		const employee = employees.get(employeeId);
		if (!employee) continue;

		const dates = resolveEmploymentDates(employee, monthStart, monthEnd);
		const monthEvidence = evidence.get(employeeId);
		const hasEvidence = slips.has(employeeId) || !!monthEvidence;
		let issue = dates.issue;

		if (dates.outside) {
			if (!hasEvidence) {
				excluded.push({
					employee_id: employeeId,
					employee_code: text(employee.employee_id) ?? `#${employeeId}`,
					name: memberName(employee, employeeId),
					reason: exclusionReason(dates.start, dates.end, month),
				});
				continue;
			}
			// A slip or real work is never silently dropped just because the
			// master-data window puts the person outside the month.
			if (issue === null) issue = 'work_outside_employment';
		} else if (
			issue === null &&
			hasWorkOutsideEmployment(monthEvidence, monthKey, dates.start, dates.end)
		) {
			issue = 'work_outside_employment';
		}

		const anchor = salaryMonthAnchor(month, dates.start);
		const profile = selectProfile(
			canonicalProfiles.get(employeeId),
			legacyProfiles.get(employeeId),
			anchor,
			employeeId
		);

		members.push({
			employee_id: employeeId,
			employee_code: text(employee.employee_id) ?? `#${employeeId}`,
			name: memberName(employee, employeeId),
			employee_type: text(employee.employee_type),
			employment_start: dates.start,
			employment_end: dates.end,
			profile_date: anchor,
			salary_profile: profile.salary_profile,
			profile_source: profile.profile_source,
			profile_id: profile.profile_id,
			salary_type: profile.salary_type,
			salary_issue: profile.salary_issue,
			salary_conflict_ids: profile.salary_conflict_ids,
			salary_ctc_source: profile.salary_ctc_source,
			issue,
		});
	}

	members.sort(compareMembers);
	excluded.sort(
		(a, b) =>
			compareEmployeeCode(a.employee_code, b.employee_code) ||
			compareText(a.name, b.name) ||
			a.employee_id - b.employee_id
	);

	return { month, members, excluded };
}

/* ── loader ────────────────────────────────────────────────────────── */

/**
 * Optional read context for generation/finalization write paths.
 *
 * Read-only callers pass nothing and keep the existing plain reads. A write
 * caller holds the Payroll Run row lock first, then asks the loader to take the
 * cross-feature Employee mutex before its current reads.
 */
export interface PayrollRunRosterReadOptions {
	/**
	 * Restrict the Employee population and every per-Employee read to these
	 * ids. Deduped and sorted ascending; invalid ids throw. Absent means every
	 * non-deleted Employee.
	 */
	employeeIds?: readonly (number | string)[];
	/**
	 * Establish sorted Employee locks and read the Employee/profile rows
	 * `FOR UPDATE` on this connection. Only for the transaction that owns the
	 * Payroll Run lock.
	 */
	forUpdate?: boolean;
}

function employeeIdScope(values: readonly (number | string)[]): number[] {
	const ids = new Set<number>();
	for (const value of values) {
		const id = positiveInteger(value);
		if (id === null) {
			throw new RangeError(`Invalid Employee id "${String(value)}"`);
		}
		ids.add(id);
	}
	return [...ids].sort((left, right) => left - right);
}

function placeholders(ids: readonly number[]): string {
	return ids.map(() => '?').join(', ');
}

/** ` AND column IN (...)` for a scoped read, nothing for an unscoped one. */
function scopeClause(
	column: string,
	ids: readonly number[] | null
): { sql: string; params: number[] } {
	if (ids === null) return { sql: '', params: [] };
	if (ids.length === 0) return { sql: ' AND 1 = 0', params: [] };
	return {
		sql: ` AND ${column} IN (${placeholders(ids)})`,
		params: [...ids],
	};
}

function emptyRoster(month: string): PayrollRunRoster {
	return buildPayrollRunRoster({
		month,
		employees: [],
		canonical_profiles: [],
		legacy_profiles: [],
		slip_employee_ids: [],
		assignments: [],
	});
}

/**
 * Load the month's candidates, their active canonical/legacy profiles and the
 * month's slip/Logged Hours evidence, then build the roster.
 *
 * Every read honours its lifecycle boundary: employees are soft-deleted with
 * `isDelete = 0`; profiles are `is_active = 1`; the assignment's linked account
 * join filters `users.isDelete = 0`; Logged Hours ownership is the assignment's
 * recorded employee id, then the linked account's canonical `employee_id` — an
 * email or display name never establishes ownership. A missing roster table is
 * not read here: Finalize owns that deployment prerequisite.
 *
 * With `forUpdate`, the Employee population is established first and locked
 * ascending (employees, then salary timelines) before any current terms read,
 * so a salary command either commits before this transaction prices the
 * month or waits for the use evidence it writes. The all-population candidate
 * read is a plain snapshot; only the ids it returned are locked, re-read
 * `FOR UPDATE` and priced, so a concurrent salary setup cannot smuggle an
 * unlocked Employee into the roster. Never append `FOR UPDATE` to a
 * whole-company read from a caller that holds one Employee lock.
 */
export async function loadPayrollRunRoster(
	db: PayrollRunRosterDb,
	month: string,
	options: PayrollRunRosterReadOptions = {}
): Promise<PayrollRunRoster> {
	const normalized = normalizePayrollRunMonth(month);
	const scoped =
		options.employeeIds === undefined
			? null
			: employeeIdScope(options.employeeIds);
	if (scoped !== null && scoped.length === 0) return emptyRoster(normalized);

	let readIds = scoped;
	if (options.forUpdate) {
		let population = scoped;
		if (population === null) {
			const [idRows] = await db.execute(
				`SELECT id
           FROM employees
          WHERE isDelete = 0
          ORDER BY id`
			);
			const ids: number[] = [];
			for (const row of rowsOf(idRows)) {
				const id = positiveInteger(row.id);
				if (id !== null) ids.push(id);
			}
			population = ids;
		}
		if (population.length === 0) return emptyRoster(normalized);

		const locked = await lockSalaryEmployees(db, population);
		if (locked.missing_employee_ids.length > 0) {
			throw new Error(
				`Payroll roster Employee(s) ${locked.missing_employee_ids.join(
					', '
				)} do not exist`
			);
		}
		readIds = locked.locks
			.map((lock) => lock.employee_id)
			.sort((left, right) => left - right);
		if (readIds.length === 0) return emptyRoster(normalized);
	}

	const employeeScope = scopeClause('e.id', readIds);
	const profileScope = scopeClause('employee_id', readIds);
	const slipScope = scopeClause('employee_id', readIds);
	const assignmentScope =
		readIds === null
			? { sql: '', params: [] as number[] }
			: {
					sql: ` AND (uaa.employee_id IN (${placeholders(
						readIds
					)}) OR u.employee_id IN (${placeholders(readIds)}))`,
					params: [...readIds, ...readIds],
				};
	const lockSuffix = options.forUpdate ? ' FOR UPDATE' : '';

	// Each `execute` resolves to mysql2's `[rows, fields]` tuple; unwrap the
	// rows exactly once before `rowsOf` inspects them.
	const [
		[employeeRows],
		[canonicalRows],
		[legacyRows],
		[slipRows],
		[assignmentRows],
	] = await Promise.all([
		db.execute(
			`SELECT e.id, e.employee_id,
              CONCAT_WS(' ', e.first_name, e.last_name) AS name,
              e.employee_type, e.status,
              e.joining_date, e.hire_date, e.exit_date, e.isDelete
         FROM employees e
        WHERE e.isDelete = 0${employeeScope.sql}${lockSuffix}`,
			employeeScope.params
		),
		db.execute(
			`SELECT *
         FROM employee_salary_profile
        WHERE is_active = 1${profileScope.sql}${lockSuffix}`,
			profileScope.params
		),
		db.execute(
			`SELECT *
         FROM salary_structures
        WHERE is_active = 1${profileScope.sql}${lockSuffix}`,
			profileScope.params
		),
		db.execute(
			`SELECT employee_id FROM payroll_slips WHERE month = ?${slipScope.sql}`,
			[normalized, ...slipScope.params]
		),
		db.execute(
			`SELECT uaa.employee_id, uaa.daily_entries,
              u.employee_id AS user_employee_id
         FROM user_activity_assignments uaa
         LEFT JOIN users u ON u.id = uaa.user_id AND u.isDelete = 0
        WHERE uaa.status <> 'Cancelled'
          AND uaa.daily_entries IS NOT NULL
          AND uaa.daily_entries NOT IN ('', '[]')${assignmentScope.sql}`,
			assignmentScope.params
		),
	]);

	return buildPayrollRunRoster({
		month: normalized,
		employees: rowsOf(employeeRows) as unknown as PayrollRunEmployeeRow[],
		canonical_profiles: rowsOf(
			canonicalRows
		) as unknown as PayrollRunProfileRow[],
		legacy_profiles: rowsOf(legacyRows) as unknown as PayrollRunProfileRow[],
		slip_employee_ids: rowsOf(slipRows).flatMap((row) => {
			const value = row.employee_id;
			return typeof value === 'number' || typeof value === 'string'
				? [value]
				: [];
		}),
		assignments: rowsOf(assignmentRows) as unknown as PayrollRunAssignmentRow[],
	});
}

/* ── freezing ──────────────────────────────────────────────────────── */

function memberLabel(member: PayrollRunMember): string {
	const name = text(member.name) ?? `Employee #${member.employee_id}`;
	const code = text(member.employee_code) ?? `#${member.employee_id}`;
	return `${name} (${code})`;
}

function freezeBlockers(roster: PayrollRunRoster): string[] {
	const blockers: string[] = [];
	const seen = new Set<number>();
	for (const member of roster.members) {
		const label = memberLabel(member);
		const employeeId = positiveInteger(member.employee_id);
		if (employeeId === null) {
			blockers.push(`${label} has an invalid employee id`);
		} else if (seen.has(employeeId)) {
			blockers.push(`${label} appears twice in the roster`);
		} else {
			seen.add(employeeId);
		}
		if (text(member.employee_code) === null)
			blockers.push(`${label} has no employee code`);
		if (text(member.name) === null) blockers.push(`${label} has no name`);
		if (member.issue !== null) {
			blockers.push(
				`${label} has an unresolved employment issue (${member.issue})`
			);
		}
		// Older hand-built rosters do not carry `salary_issue`; a null profile is
		// still the ordinary missing-agreement gap. Salary problems never become
		// employment-date messages.
		const salaryIssue =
			member.salary_issue ??
			(member.salary_profile === null ? 'salary_profile_missing' : null);
		if (salaryIssue === 'salary_profile_missing') {
			blockers.push(`${label} has no Salary Profile for the month`);
		} else if (salaryIssue === 'salary_profile_ambiguous') {
			const ids = (member.salary_conflict_ids ?? []).join(', ');
			blockers.push(
				`${label} has overlapping Salary Profiles${
					ids ? ` (ids ${ids})` : ''
				} — review the salary timeline`
			);
		} else if (salaryIssue === 'salary_ctc_missing') {
			blockers.push(`${label} has a Salary Profile with no monthly CTC`);
		} else if (salaryIssue === 'salary_ctc_invalid') {
			blockers.push(
				`${label} has an invalid monthly CTC on Salary Profile ${
					member.profile_id ?? 'unknown'
				}`
			);
		}
		if (salaryIssue === null) {
			if (member.salary_profile === null) {
				blockers.push(`${label} has no Salary Profile`);
			}
			if (member.profile_source === null) {
				blockers.push(`${label} has no Salary Profile source`);
			}
			if (positiveInteger(member.profile_id) === null) {
				blockers.push(`${label} has no Salary Profile id`);
			}
			if (text(member.salary_type) === null) {
				blockers.push(`${label} has no salary type`);
			}
		}
		if (parseDay(member.profile_date) === null) {
			blockers.push(`${label} has an invalid profile date`);
		}
		if (
			member.employment_start !== null &&
			parseDay(member.employment_start) === null
		) {
			blockers.push(`${label} has an invalid employment start`);
		}
		if (
			member.employment_end !== null &&
			parseDay(member.employment_end) === null
		) {
			blockers.push(`${label} has an invalid employment end`);
		}
		const start = parseDay(member.employment_start);
		const end = parseDay(member.employment_end);
		if (start !== null && end !== null && start > end) {
			blockers.push(
				`${label} has employment dates out of order (${start} to ${end})`
			);
		}
	}
	return blockers;
}

/**
 * The immutable members of a roster. Throws, naming every blocker, when the
 * set is not safe to freeze: an unresolved employment issue, a missing Salary
 * Profile/provenance, malformed dates, or a duplicate member. The returned
 * members contain identity and provenance only — never mutable profile money.
 */
export function freezePayrollRunMembers(
	roster: PayrollRunRoster
): FrozenPayrollRunMember[] {
	const month = normalizePayrollRunMonth(roster.month);
	const blockers = freezeBlockers(roster);
	if (blockers.length > 0) {
		throw new Error(
			`Cannot freeze the ${month} payroll roster: ${blockers.join('; ')}`
		);
	}
	return roster.members.map((member) => ({
		employee_id: member.employee_id,
		employee_code: member.employee_code,
		name: member.name,
		employment_start: parseDay(member.employment_start),
		employment_end: parseDay(member.employment_end),
		profile_date: parseDay(member.profile_date) as string,
		profile_source: member.profile_source as PayrollRunProfileSource,
		profile_id: member.profile_id as number,
		salary_type: member.salary_type as string,
	}));
}

function runMonthFromRow(row: Record<string, unknown>): string | null {
	const year = Number(row.year);
	const monthNumber = Number(row.month);
	if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return null;
	if (monthNumber < 1 || monthNumber > 12) return null;
	return `${String(year).padStart(4, '0')}-${String(monthNumber).padStart(
		2,
		'0'
	)}-01`;
}

/**
 * Append a validated roster snapshot to the run and return it.
 *
 * The caller owns the transaction and the Payroll Run row lock; this function
 * only appends. Every save is a new version, so a re-finalization after
 * Reopen preserves the earlier snapshot. Nothing mutable is copied: the
 * snapshot is identity, employment dates, and the profile/provenance date the
 * live roster selected.
 */
export async function savePayrollRunRoster(
	db: PayrollRunRosterDb,
	runId: number,
	roster: PayrollRunRoster,
	actorId: number | null
): Promise<FrozenPayrollRunRoster> {
	if (positiveInteger(runId) === null) {
		throw new Error(`Invalid Payroll Run id "${runId}"`);
	}
	const members = freezePayrollRunMembers(roster);
	const month = normalizePayrollRunMonth(roster.month);

	const [runRows] = await db.execute(
		`SELECT id, month, year
       FROM payroll_runs
      WHERE id = ?
      LIMIT 1`,
		[runId]
	);
	const run = firstRow(runRows);
	if (run === null) throw new Error(`Payroll Run ${runId} does not exist`);
	const runMonth = runMonthFromRow(run);
	if (runMonth === null) {
		throw new Error(`Payroll Run ${runId} has an invalid period`);
	}
	if (runMonth !== month) {
		throw new Error(`Payroll Run ${runId} covers ${runMonth}, not ${month}`);
	}

	const [versionRows] = await db.execute(
		`SELECT COALESCE(MAX(version), 0) AS version
       FROM payroll_run_rosters
      WHERE run_id = ?`,
		[runId]
	);
	const currentVersion = Number(firstRow(versionRows)?.version ?? 0);
	const version =
		(Number.isFinite(currentVersion) ? Math.trunc(currentVersion) : 0) + 1;

	const [insertResult] = await db.execute(
		`INSERT INTO payroll_run_rosters
        (run_id, month, version, members, frozen_by, isDelete)
       VALUES (?, ?, ?, ?, ?, 0)`,
		[runId, month, version, JSON.stringify(members), actorId]
	);
	const header = insertResult as { affectedRows?: number } | null | undefined;
	if (header?.affectedRows !== undefined && header.affectedRows !== 1) {
		throw new Error(
			`Payroll roster snapshot ${runId} v${version} was not stored`
		);
	}

	const [storedRows] = await db.execute(
		`SELECT month, version, frozen_at
       FROM payroll_run_rosters
      WHERE run_id = ? AND version = ? AND isDelete = 0
      LIMIT 1`,
		[runId, version]
	);
	const stored = firstRow(storedRows);
	if (stored === null) {
		throw new Error(
			`Payroll roster snapshot ${runId} v${version} was not stored`
		);
	}

	return {
		run_id: runId,
		month: parseDay(stored.month) ?? month,
		version: Number(stored.version),
		frozen_at: dateTimeText(stored.frozen_at),
		members,
	};
}

/* ── frozen loader ─────────────────────────────────────────────────── */

function frozenMember(
	value: unknown,
	runId: number,
	version: number
): FrozenPayrollRunMember {
	const where = `Payroll roster snapshot ${runId} v${version}`;
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${where} contains a malformed member`);
	}
	const row = value as Record<string, unknown>;
	const employeeId = positiveInteger(row.employee_id);
	const profileId = positiveInteger(row.profile_id);
	const profileSource = row.profile_source;
	const profileDate = parseDay(row.profile_date);
	const salaryType = text(row.salary_type);
	const employeeCode = text(row.employee_code);
	const name = text(row.name);
	const startRaw = row.employment_start;
	const endRaw = row.employment_end;
	const start =
		startRaw === null || startRaw === undefined ? null : parseDay(startRaw);
	const end = endRaw === null || endRaw === undefined ? null : parseDay(endRaw);

	if (
		employeeId === null ||
		profileId === null ||
		(profileSource !== 'employee_salary_profile' &&
			profileSource !== 'salary_structures') ||
		profileDate === null ||
		salaryType === null ||
		employeeCode === null ||
		name === null ||
		(startRaw !== null && startRaw !== undefined && start === null) ||
		(endRaw !== null && endRaw !== undefined && end === null) ||
		(start !== null && end !== null && start > end)
	) {
		throw new Error(`${where} contains a malformed member`);
	}

	return {
		employee_id: employeeId,
		employee_code: employeeCode as string,
		name: name as string,
		employment_start: start,
		employment_end: end,
		profile_date: profileDate as string,
		profile_source: profileSource as PayrollRunProfileSource,
		profile_id: profileId,
		salary_type: salaryType as string,
	};
}

/**
 * The latest roster snapshot of the month's currently finalized or paid run.
 *
 * Returns null when the month has no locked run (a draft must ignore any
 * snapshot left by an earlier finalization) and when a locked run predates
 * snapshots (an explicit legacy run). A missing `payroll_run_rosters` table is
 * a deployment error and propagates; it is never reported as legacy.
 */
export async function loadFrozenPayrollRunRoster(
	db: PayrollRunRosterDb,
	month: string
): Promise<FrozenPayrollRunRoster | null> {
	const normalized = normalizePayrollRunMonth(month);
	const [yearText, monthText] = normalized.split('-');
	const year = Number(yearText);
	const monthNumber = Number(monthText);

	const [runRows] = await db.execute(
		`SELECT id, month, year
       FROM payroll_runs
      WHERE month = ? AND year = ? AND status IN ('finalized', 'paid')
      ORDER BY run_number DESC, id DESC
      LIMIT 1`,
		[monthNumber, year]
	);
	const run = firstRow(runRows);
	if (run === null) return null;
	const runId = positiveInteger(run.id);
	if (runId === null) {
		throw new Error(`Finalized Payroll Run for ${normalized} has no id`);
	}

	const [rosterRows] = await db.execute(
		`SELECT month, version, frozen_at, members
       FROM payroll_run_rosters
      WHERE run_id = ? AND isDelete = 0
      ORDER BY version DESC
      LIMIT 1`,
		[runId]
	);
	const stored = firstRow(rosterRows);
	if (stored === null) return null;

	const version = Math.trunc(Number(stored.version));
	if (!Number.isFinite(version) || version <= 0) {
		throw new Error(`Payroll roster snapshot for ${normalized} has no version`);
	}
	const storedMonth = parseDay(stored.month);
	if (storedMonth === null || storedMonth !== normalized) {
		throw new Error(
			`Payroll roster snapshot ${runId} v${version} does not belong to ${normalized}`
		);
	}
	let parsed: unknown = stored.members;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			throw new Error(
				`Payroll roster snapshot ${runId} v${version} is not valid JSON`
			);
		}
	}
	if (!Array.isArray(parsed)) {
		throw new Error(
			`Payroll roster snapshot ${runId} v${version} has no member list`
		);
	}

	const members = parsed.map((member) => frozenMember(member, runId, version));
	const seen = new Set<number>();
	for (const member of members) {
		if (seen.has(member.employee_id)) {
			throw new Error(
				`Payroll roster snapshot ${runId} v${version} repeats employee ${member.employee_id}`
			);
		}
		seen.add(member.employee_id);
	}

	return {
		run_id: runId,
		month: storedMonth,
		version,
		frozen_at: dateTimeText(stored.frozen_at),
		members,
	};
}
