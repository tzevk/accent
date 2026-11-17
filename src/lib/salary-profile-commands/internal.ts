/**
 * Shared, non-public helpers for the salary command/read contract.
 *
 * Money values go through the project Decimal helpers. Calendar helpers are
 * the date-only functions from the timeline foundation, so the same command is
 * deterministic in UTC, Asia/Kolkata and America/Los_Angeles.
 */

import Decimal from 'decimal.js';
import { toNumber } from '@/lib/money';
import {
	classifySalaryAgreement,
	normalizeSalaryDate,
	normalizeSalaryMonth,
	type SalaryAgreementClassification,
	type SalaryAgreementSource,
	type SalaryProfileRow,
} from '@/lib/salary-profile-timeline';
import {
	lockSalaryEmployees,
	readSalaryAgreements,
	readSalaryUseEvidence,
	summarizeSalaryUseEvidence,
	type SalaryEmployeeLock,
	type SalaryUseEvidence,
	type SalaryUseStatus,
} from '@/lib/salary-profile-store';
import {
	SALARY_CTC_MAX,
	validateDailyHours,
	validateSalaryCtc,
} from '@/lib/salary-ctc';
import type {
	SalaryCommandDb,
	SalaryCommandFailure,
	SalaryCommandFailureCode,
} from './types';

export const SALARY_TYPE_LOOKUP: Record<string, true> = {
	monthly: true,
	hourly: true,
	daily: true,
	contract: true,
	lumpsum: true,
	custom: true,
};

/** Fields a CTC-first command must never write or accept as a pay base. */
export const LEGACY_REFERENCE_FIELDS = [
	'gross',
	'gross_salary',
	'contract_amount',
] as const;

/** Attendance-derived live usage; read-only, never part of an agreement write. */
export const LIVE_USAGE_FIELDS = ['pl_used', 'pl_balance'] as const;

type SettingKind =
	| 'money'
	| 'flag'
	| 'int'
	| 'text'
	| 'date'
	| 'time'
	| 'decimal';

export interface SettingSpec {
	column: string;
	kind: SettingKind;
	min?: number;
	max?: number;
	maxLength?: number;
}

/**
 * Writable supported agreement settings. This is the whitelist the command
 * accepts and the field set a revision copies from its predecessor.
 *
 * Deliberately absent: gross/gross_salary/contract_amount (read-only legacy
 * references), pl_used/pl_balance (live attendance usage), and the stored
 * computed totals (total_earnings/total_deductions/net_pay).
 */
export const SETTING_SPECS: readonly SettingSpec[] = [
	{ column: 'other_allowances', kind: 'money', max: 99_999_999.99 },
	{ column: 'remarks', kind: 'text' },
	{ column: 'is_manual_override', kind: 'flag' },
	{ column: 'da_year', kind: 'int', min: 1900, max: 2100 },
	{ column: 'pf_applicable', kind: 'flag' },
	{ column: 'esic_applicable', kind: 'flag' },
	{ column: 'pt_applicable', kind: 'flag' },
	{ column: 'mlwf_applicable', kind: 'flag' },
	{ column: 'retention_applicable', kind: 'flag' },
	{ column: 'bonus_applicable', kind: 'flag' },
	{ column: 'monthly_bonus', kind: 'flag' },
	{ column: 'incentive_applicable', kind: 'flag' },
	{ column: 'insurance_applicable', kind: 'flag' },
	{ column: 'basic_plus_da', kind: 'money' },
	{ column: 'da', kind: 'money' },
	{ column: 'basic', kind: 'money' },
	{ column: 'hra', kind: 'money' },
	{ column: 'conveyance', kind: 'money' },
	{ column: 'call_allowance', kind: 'money' },
	{ column: 'bonus', kind: 'money' },
	{ column: 'incentive', kind: 'money' },
	{ column: 'pf_employee', kind: 'money' },
	{ column: 'esic_employee', kind: 'money' },
	{ column: 'pf_employer', kind: 'money' },
	{ column: 'esic_employer', kind: 'money' },
	{ column: 'pt', kind: 'money' },
	{ column: 'mlwf', kind: 'money' },
	{ column: 'mlwf_employer', kind: 'money' },
	{ column: 'retention', kind: 'money' },
	{ column: 'insurance', kind: 'money' },
	{ column: 'hourly_rate', kind: 'money' },
	{ column: 'std_in_time', kind: 'time' },
	{ column: 'std_out_time', kind: 'time' },
	{ column: 'ot_multiplier', kind: 'decimal', min: 0.01, max: 99.99 },
	{ column: 'daily_rate', kind: 'money' },
	{ column: 'std_working_days', kind: 'int', min: 1, max: 31 },
	{ column: 'contract_duration', kind: 'text', maxLength: 20 },
	{ column: 'contract_end_date', kind: 'date' },
	{ column: 'lumpsum_amount', kind: 'money' },
	{ column: 'lumpsum_description', kind: 'text' },
	{ column: 'tds_percentage', kind: 'decimal', min: 0, max: 100 },
	{ column: 'pl_total', kind: 'int', min: 0, max: 365 },
	{ column: 'loan_amount', kind: 'money' },
	{ column: 'loan_amount_per_month', kind: 'money' },
	{ column: 'loan_no_of_months', kind: 'int', min: 0, max: 600 },
	{ column: 'loan_total_amount', kind: 'money' },
	{ column: 'loan_active', kind: 'flag' },
	{ column: 'advance_amount', kind: 'money' },
	{ column: 'advance_active', kind: 'flag' },
];

export const SETTING_COLUMNS = SETTING_SPECS.map((spec) => spec.column);

export interface ParsedSettings {
	values: Record<string, string | number | boolean | null>;
	errors: string[];
}

const DECIMAL_MAX = new Decimal(String(SALARY_CTC_MAX));

export function asRows(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is Record<string, unknown> =>
			row !== null && typeof row === 'object' && !Array.isArray(row)
	);
}

export function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number > 0 ? number : null;
	}
	return null;
}

export function nonNegativeInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value >= 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number >= 0 ? number : null;
	}
	return null;
}

export function textValue(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text === '' ? null : text;
}

export function numberValue(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'string') {
		const text = value.trim();
		if (text === '') return null;
		const number = Number(text);
		return Number.isFinite(number) ? number : null;
	}
	return null;
}

export function formatDate(value: unknown): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime())
			? null
			: value.toISOString().slice(0, 10);
	}
	if (typeof value !== 'string') return null;
	return normalizeSalaryDate(value);
}

export function sqlFailure(
	code: SalaryCommandFailureCode,
	status: SalaryCommandFailure['status'],
	message: string,
	details?: Record<string, unknown>
): SalaryCommandFailure {
	return details === undefined
		? { ok: false, code, status, message }
		: { ok: false, code, status, message, details };
}

export function serverPayrollDate(): string {
	return new Date().toISOString().slice(0, 10);
}

/** First day of the server payroll month, timezone-stable. */
export function currentMonthStart(now: string): string {
	return `${normalizeSalaryDate(now)?.slice(0, 7) ?? serverPayrollDate().slice(0, 7)}-01`;
}

export function isEligibleAgreement(row: SalaryProfileRow): boolean {
	return (
		!(
			row.is_active === 0 ||
			row.is_active === '0' ||
			row.is_active === false
		) && textValue(row.cancelled_at) === null
	);
}

export function agreementIdOf(row: SalaryProfileRow): number | null {
	return positiveInteger(row.id);
}

export function agreementStart(row: SalaryProfileRow): string | null {
	return normalizeSalaryDate(row.effective_from);
}

export function agreementEnd(row: SalaryProfileRow): string | null {
	const raw = row.effective_to;
	if (raw === undefined || raw === null || String(raw).trim() === '')
		return null;
	return normalizeSalaryDate(raw);
}

/** Classify a raw stored row; malformed dates throw exactly like the foundation. */
export function classificationOfRow(
	row: SalaryProfileRow,
	asOf: string
): SalaryAgreementClassification {
	return classifySalaryAgreement(
		{
			effective_from: agreementStart(row) ?? '',
			effective_to: agreementEnd(row),
			cancelled_at: textValue(row.cancelled_at),
		},
		asOf
	);
}

export function sortAgreements(
	rows: readonly SalaryProfileRow[]
): SalaryProfileRow[] {
	return [...rows].sort((left, right) => {
		const leftStart = agreementStart(left) ?? '';
		const rightStart = agreementStart(right) ?? '';
		return (
			leftStart.localeCompare(rightStart) ||
			(agreementIdOf(left) ?? 0) - (agreementIdOf(right) ?? 0)
		);
	});
}

/** Legacy rows carry `pay_type`/`standard_hours_per_day`; selection needs the canonical names. */
export function legacyTimelineRow(row: SalaryProfileRow): SalaryProfileRow {
	return {
		...row,
		salary_type: textValue(row.salary_type) ?? textValue(row.pay_type) ?? null,
		std_hours_per_day:
			row.std_hours_per_day ?? row.standard_hours_per_day ?? null,
		cancelled_at: null,
	};
}

export interface ParsedEffectiveDate {
	start: string;
	/** true when the caller selected a full date that is not the month's first day */
	midMonth: boolean;
}

export function parseEffectiveFrom(
	value: unknown,
	allowMidMonth: boolean
): ParsedEffectiveDate | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const text = value.trim();
	const monthMatch = /^(\d{4})-(\d{2})$/.exec(text);
	if (monthMatch !== null) {
		try {
			return { start: normalizeSalaryMonth(text), midMonth: false };
		} catch {
			return null;
		}
	}
	const date = normalizeSalaryDate(text);
	if (date === null) return null;
	const midMonth = date.slice(8, 10) !== '01';
	if (midMonth && !allowMidMonth) return null;
	return { start: date, midMonth };
}

export function parseMonth(value: unknown): string | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	try {
		return normalizeSalaryMonth(value);
	} catch {
		return null;
	}
}

function parseSettingValue(
	spec: SettingSpec,
	value: unknown
): { ok: true; value: string | number | boolean | null } | { ok: false } {
	if (spec.kind === 'flag') {
		if (value === null || value === undefined || value === '') {
			return { ok: true, value: 0 };
		}
		if (value === true || value === 1 || value === '1' || value === 'true') {
			return { ok: true, value: 1 };
		}
		if (value === false || value === 0 || value === '0' || value === 'false') {
			return { ok: true, value: 0 };
		}
		return { ok: false };
	}

	if (value === null || value === undefined || value === '') {
		if (
			spec.kind === 'int' ||
			spec.kind === 'decimal' ||
			spec.kind === 'money'
		) {
			return { ok: true, value: null };
		}
		if (spec.kind === 'text' || spec.kind === 'date' || spec.kind === 'time') {
			return { ok: true, value: null };
		}
	}

	if (spec.kind === 'text') {
		if (typeof value !== 'string') return { ok: false };
		if (value.length > (spec.maxLength ?? Number.POSITIVE_INFINITY)) {
			return { ok: false };
		}
		return { ok: true, value: value.trim() === '' ? null : value };
	}

	if (spec.kind === 'date') {
		if (typeof value !== 'string') return { ok: false };
		const date = normalizeSalaryDate(value);
		return date === null ? { ok: false } : { ok: true, value: date };
	}

	if (spec.kind === 'time') {
		if (typeof value !== 'string') return { ok: false };
		const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
		if (match === null) return { ok: false };
		const hours = Number(match[1]);
		const minutes = Number(match[2]);
		const seconds = Number(match[3] ?? 0);
		if (
			hours < 0 ||
			hours > 23 ||
			minutes < 0 ||
			minutes > 59 ||
			seconds < 0 ||
			seconds > 59
		) {
			return { ok: false };
		}
		return { ok: true, value: `${match[1]}:${match[2]}:${match[3] ?? '00'}` };
	}

	if (spec.kind === 'int') {
		const parsed = nonNegativeInteger(value);
		if (parsed === null) return { ok: false };
		if (spec.min !== undefined && parsed < spec.min) return { ok: false };
		if (spec.max !== undefined && parsed > spec.max) return { ok: false };
		return { ok: true, value: parsed };
	}

	let decimal: Decimal;
	try {
		decimal = new Decimal(value as Decimal.Value);
	} catch {
		return { ok: false };
	}
	if (!decimal.isFinite() || decimal.isNegative()) return { ok: false };
	if (decimal.gt(DECIMAL_MAX)) return { ok: false };
	if (
		(spec.kind === 'money' || spec.kind === 'decimal') &&
		decimal.decimalPlaces() > 2
	) {
		return { ok: false };
	}
	if (spec.min !== undefined && decimal.lt(spec.min)) return { ok: false };
	if (spec.max !== undefined && decimal.gt(spec.max)) return { ok: false };
	if (spec.kind === 'decimal') {
		return { ok: true, value: toNumber(decimal) };
	}
	return { ok: true, value: decimal.toFixed(2) };
}

/** Parse every provided whitelisted setting; omits fields not present. */
export function parseProvidedSettings(
	input: Record<string, unknown>
): ParsedSettings {
	const values: Record<string, string | number | boolean | null> = {};
	const errors: string[] = [];
	for (const spec of SETTING_SPECS) {
		if (!Object.prototype.hasOwnProperty.call(input, spec.column)) continue;
		const raw = input[spec.column];
		if (raw === undefined) continue;
		const parsed = parseSettingValue(spec, raw);
		if (!parsed.ok) {
			errors.push(`${spec.column} is invalid`);
			continue;
		}
		values[spec.column] = parsed.value;
	}
	return { values, errors };
}

/** Copy supported settings from an existing agreement for a revision. */
export function copiedSettings(
	row: SalaryProfileRow,
	overrides: Record<string, string | number | boolean | null>
): Record<string, string | number | boolean | null> {
	const copied: Record<string, string | number | boolean | null> = {};
	for (const spec of SETTING_SPECS) {
		if (Object.prototype.hasOwnProperty.call(overrides, spec.column)) continue;
		const value = row[spec.column];
		if (value === undefined) continue;
		copied[spec.column] = value as string | number | boolean | null;
	}
	return { ...copied, ...overrides };
}

export function validateSalaryType(
	value: unknown
): { ok: true; value: string } | { ok: false } {
	const text = textValue(value);
	if (text === null || text.length > 20 || SALARY_TYPE_LOOKUP[text] !== true) {
		return { ok: false };
	}
	return { ok: true, value: text };
}

export function validateRequiredCtc(
	value: unknown
): { ok: true; text: string } | { ok: false; reason: string } {
	const validation = validateSalaryCtc(value);
	if (!validation.valid) return { ok: false, reason: validation.reason };
	// The column is DECIMAL(12,2); do not silently round an agreed CTC.
	if (validation.amount.decimalPlaces() > 2) {
		return { ok: false, reason: 'precision' };
	}
	return {
		ok: true,
		text: validation.amount.toFixed(2),
	};
}

export function validateRequiredDailyHours(
	value: unknown
): { ok: true; value: number } | { ok: false; reason: string } {
	const validation = validateDailyHours(value);
	if (!validation.valid) return { ok: false, reason: validation.reason };
	// The column is DECIMAL(4,1); reject values it cannot store exactly rather
	// than silently rounding the agreed standard day.
	if (validation.hours.decimalPlaces() > 1) {
		return { ok: false, reason: 'precision' };
	}
	if (validation.hours.gt(new Decimal('999.9'))) {
		return { ok: false, reason: 'out-of-range' };
	}
	return { ok: true, value: toNumber(validation.hours) };
}

export interface SalaryCommandState {
	lock: SalaryEmployeeLock;
	employeeStart: string | null;
	canonical: SalaryProfileRow[];
	legacy: SalaryProfileRow[];
	legacyTimeline: SalaryProfileRow[];
	evidence: SalaryUseEvidence[];
	use: SalaryUseStatus;
}

/**
 * The one write-path read sequence. Always called after the Employee lock is
 * held; every agreement/use read is a current read (`FOR UPDATE`).
 */
export async function readCommandState(
	db: SalaryCommandDb,
	employeeId: number
): Promise<
	| { ok: true; state: SalaryCommandState }
	| { ok: false; failure: SalaryCommandFailure }
> {
	const locked = await lockSalaryEmployees(db, [employeeId]);
	const lock = locked.locks[0];
	if (lock === undefined) {
		return {
			ok: false,
			failure: sqlFailure(
				'employee_not_found',
				404,
				`Employee ${employeeId} does not exist`
			),
		};
	}
	if (lock.is_delete) {
		return {
			ok: false,
			failure: sqlFailure(
				'employee_deleted',
				409,
				`Employee ${employeeId} is deleted`
			),
		};
	}
	const canonical = await readSalaryAgreements(db, employeeId, {
		forUpdate: true,
	});
	const legacy = await readSalaryAgreements(db, employeeId, {
		source: 'salary_structures',
		forUpdate: true,
	});
	const evidence = await readSalaryUseEvidence(db, employeeId, {
		forUpdate: true,
	});
	return {
		ok: true,
		state: {
			lock,
			employeeStart: lock.joining_date ?? lock.hire_date,
			canonical,
			legacy,
			legacyTimeline: legacy.map(legacyTimelineRow),
			evidence,
			use: summarizeSalaryUseEvidence(evidence),
		},
	};
}

/** Evidence candidate identities for a known-month ambiguity row. */
export function ambiguousCandidates(
	row: SalaryUseEvidence
): Array<{ agreement_id: number; agreement_source: SalaryAgreementSource }> {
	const candidates: Array<{
		agreement_id: number;
		agreement_source: SalaryAgreementSource;
	}> = [];
	const seen = new Set<string>();
	const add = (source: unknown, id: unknown) => {
		const agreementId = positiveInteger(id);
		if (
			(source !== 'employee_salary_profile' &&
				source !== 'salary_structures') ||
			agreementId === null
		) {
			return;
		}
		const key = `${source}:${agreementId}`;
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push({
			agreement_id: agreementId,
			agreement_source: source as SalaryAgreementSource,
		});
	};
	add(row.agreement_source, row.agreement_id);
	const contextRows = row.evidence_context?.candidate_agreements;
	if (Array.isArray(contextRows)) {
		for (const candidate of contextRows) {
			if (
				candidate === null ||
				typeof candidate !== 'object' ||
				Array.isArray(candidate)
			) {
				continue;
			}
			add(
				(candidate as Record<string, unknown>).agreement_source,
				(candidate as Record<string, unknown>).agreement_id
			);
		}
	}
	return candidates;
}

export function agreementCovers(
	row: SalaryProfileRow,
	anchor: string
): boolean {
	if (!isEligibleAgreement(row)) return false;
	const start = agreementStart(row);
	if (start === null || start > anchor) return false;
	const end = agreementEnd(row);
	return end === null || end >= anchor;
}

export function selectingIds(
	rows: readonly SalaryProfileRow[],
	anchor: string
): number[] {
	return rows
		.filter((row) => agreementCovers(row, anchor))
		.map((row) => agreementIdOf(row))
		.filter((id): id is number => id !== null)
		.sort((left, right) => left - right);
}

export function monthOf(date: string): string {
	return `${date.slice(0, 7)}-01`;
}
