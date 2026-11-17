/**
 * Pure Salary Profile timeline rules — no database, framework, clock or CTC
 * arithmetic.
 *
 * A Salary Profile row is a dated agreement. Historical readers may only use a
 * row whose effective range covers the requested anchor: a later agreement
 * never fills an earlier gap, and two covering agreements are reported as
 * ambiguous rather than resolved by row order or latest-start preference.
 *
 * Cancelled (`cancelled_at` set) and inactive (`is_active = 0`) rows are never
 * eligible to price a period. They remain in the timeline projection so
 * operators and auditors can still inspect the retained history.
 *
 * Calendar helpers use UTC arithmetic. They never depend on the host timezone
 * or the current time, so the same anchor is produced in UTC, Asia/Kolkata and
 * America/Los_Angeles.
 */

export type SalaryAgreementSource =
	| 'employee_salary_profile'
	| 'salary_structures';

export type SalaryAgreementState = 'selected' | 'unavailable' | 'ambiguous';

export type SalaryAgreementClassification =
	| 'current'
	| 'scheduled'
	| 'previous'
	| 'cancelled';

/**
 * The columns selection needs from `employee_salary_profile` or
 * `salary_structures`. The index signature keeps every other stored pay field
 * available to consumers without this module understanding CTC or money.
 */
export interface SalaryProfileRow {
	id?: number | string | null;
	employee_id?: number | string | null;
	effective_from?: string | null;
	effective_to?: string | null;
	is_active?: number | boolean | string | null;
	cancelled_at?: string | null;
	salary_type?: string | null;
	employer_cost?: number | string | null;
	gross_salary?: number | string | null;
	gross?: number | string | null;
	[column: string]: unknown;
}

/** One retained dated agreement, normalized for selection/timeline readers. */
export interface SalaryAgreement {
	agreement_id: number;
	employee_id: number;
	source: SalaryAgreementSource;
	effective_from: string;
	effective_to: string | null;
	salary_type: string | null;
	cancelled_at: string | null;
	is_active: boolean;
	/** The raw stored row, including fields this module does not interpret. */
	profile: SalaryProfileRow;
}

export interface SalaryAgreementResolution {
	state: SalaryAgreementState;
	source: SalaryAgreementSource | null;
	agreement_id: number | null;
	profile: SalaryProfileRow | null;
	effective_from: string | null;
	effective_to: string | null;
	salary_type: string | null;
	classification: SalaryAgreementClassification | null;
	/** Covering identities when `state === 'ambiguous'`; otherwise empty. */
	conflict_ids: number[];
}

export interface SalaryAgreementTimelineEntry {
	agreement: SalaryAgreement;
	classification: SalaryAgreementClassification;
}

export interface SalaryAgreementTimeline {
	employee_id: number | null;
	as_of: string;
	agreements: SalaryAgreementTimelineEntry[];
	current: SalaryAgreementResolution;
}

interface ResolveOptions {
	source?: SalaryAgreementSource;
	employeeId?: number;
	asOf?: string;
}

interface TimelineOptions {
	asOf: string;
	source?: SalaryAgreementSource;
	employeeId?: number;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})(?:-(01))?$/;

function pad(value: number, width: number): string {
	return String(value).padStart(width, '0');
}

function formatUtcDate(year: number, month: number, day: number): string {
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function dateParts(
	value: string
): { year: number; month: number; day: number } | null {
	const match = DATE_PATTERN.exec(value.trim());
	if (match === null) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1)
		return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	)
		return null;
	return { year, month, day };
}

/** Normalize a `YYYY-MM-DD` calendar day, or return null when it is invalid. */
export function normalizeSalaryDate(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const parts = dateParts(value);
	if (parts === null) return null;
	return formatUtcDate(parts.year, parts.month, parts.day);
}

/**
 * Normalize `YYYY-MM` or `YYYY-MM-01` to the month's first day.
 * Any other day, impossible month or free-form text throws; callers must not
 * silently round a mid-month date into a monthly anchor they did not choose.
 */
export function normalizeSalaryMonth(value: string): string {
	const match = MONTH_PATTERN.exec(String(value).trim());
	if (match === null) {
		throw new RangeError(`Invalid salary month "${value}"`);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	if (year < 1000 || year > 9999 || month < 1 || month > 12) {
		throw new RangeError(`Invalid salary month "${value}"`);
	}
	return formatUtcDate(year, month, 1);
}

/** Inclusive first and last calendar day of a payroll month. */
export function salaryPeriodBounds(month: string): {
	start: string;
	end: string;
} {
	const start = normalizeSalaryMonth(month);
	const parts = dateParts(start);
	if (parts === null) throw new RangeError(`Invalid salary month "${month}"`);
	const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
	return {
		start,
		end: formatUtcDate(parts.year, parts.month, lastDay),
	};
}

/**
 * `max(month start, joining date)` — the existing payroll anchor. Established
 * Employees are always read at month start; a mid-month joiner is read at the
 * verified joining date. A malformed date throws rather than being ignored.
 */
export function salaryMonthAnchor(
	month: string,
	employmentStart?: string | null
): string {
	const monthStart = normalizeSalaryMonth(month);
	if (employmentStart === undefined || employmentStart === null) {
		return monthStart;
	}
	if (String(employmentStart).trim() === '') return monthStart;
	const joining = normalizeSalaryDate(employmentStart);
	if (joining === null) {
		throw new RangeError(`Invalid joining date "${employmentStart}"`);
	}
	return joining > monthStart ? joining : monthStart;
}

/** The calendar day before `date`, independent of the host timezone. */
export function previousSalaryDay(date: string): string {
	const parts = dateParts(String(date));
	if (parts === null) throw new RangeError(`Invalid salary date "${date}"`);
	const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
	value.setUTCDate(value.getUTCDate() - 1);
	return formatUtcDate(
		value.getUTCFullYear(),
		value.getUTCMonth() + 1,
		value.getUTCDate()
	);
}

function cancelledValue(row: SalaryProfileRow): string | null {
	const value = row.cancelled_at;
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text === '' ? null : text;
}

function activeValue(row: SalaryProfileRow): boolean {
	const value = row.is_active;
	return !(value === 0 || value === '0' || value === false);
}

function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value > 0 ? value : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const number = Number(value);
		return Number.isInteger(number) && number > 0 ? number : null;
	}
	return null;
}

function textValue(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value.trim();
	return text === '' ? null : text;
}

function agreementFromRow(
	row: SalaryProfileRow,
	source: SalaryAgreementSource
): SalaryAgreement | null {
	const agreementId = positiveInteger(row.id);
	const employeeId = positiveInteger(row.employee_id);
	if (agreementId === null || employeeId === null) return null;
	const effectiveFrom = normalizeSalaryDate(row.effective_from);
	if (effectiveFrom === null) return null;
	const rawTo = row.effective_to;
	const effectiveTo =
		rawTo === undefined || rawTo === null || String(rawTo).trim() === ''
			? null
			: normalizeSalaryDate(rawTo);
	if (rawTo !== undefined && rawTo !== null && String(rawTo).trim() !== '') {
		if (effectiveTo === null) return null;
	}
	if (effectiveTo !== null && effectiveTo < effectiveFrom) return null;

	return {
		agreement_id: agreementId,
		employee_id: employeeId,
		source,
		effective_from: effectiveFrom,
		effective_to: effectiveTo,
		salary_type: textValue(row.salary_type),
		cancelled_at: cancelledValue(row),
		is_active: activeValue(row),
		profile: row,
	};
}

/**
 * Classify one retained agreement against an explicit calendar date.
 * `cancelled_at` wins; otherwise future = scheduled, ended = previous.
 */
export function classifySalaryAgreement(
	agreement: Pick<
		SalaryAgreement,
		'effective_from' | 'effective_to' | 'cancelled_at'
	>,
	asOf: string
): SalaryAgreementClassification {
	if (cancelledValue({ cancelled_at: agreement.cancelled_at }) !== null) {
		return 'cancelled';
	}
	const from = normalizeSalaryDate(agreement.effective_from);
	const rawTo = agreement.effective_to;
	const to =
		rawTo === null || rawTo === undefined ? null : normalizeSalaryDate(rawTo);
	const reference = normalizeSalaryDate(asOf);
	if (
		from === null ||
		reference === null ||
		(rawTo !== null && rawTo !== undefined && to === null)
	) {
		throw new RangeError('Invalid salary agreement date');
	}
	if (from > reference) return 'scheduled';
	if (to !== null && to < reference) return 'previous';
	return 'current';
}

function agreementsById(
	rows: readonly SalaryProfileRow[],
	source: SalaryAgreementSource,
	employeeId?: number
): SalaryAgreement[] {
	if (employeeId !== undefined && positiveInteger(employeeId) === null) {
		throw new RangeError(`Invalid Employee id "${employeeId}"`);
	}
	const seen = new Map<number, SalaryAgreement>();
	for (const row of rows) {
		const agreement = agreementFromRow(row, source);
		if (agreement === null) continue;
		if (employeeId !== undefined && agreement.employee_id !== employeeId)
			continue;
		if (!seen.has(agreement.agreement_id)) {
			seen.set(agreement.agreement_id, agreement);
		}
	}
	return [...seen.values()];
}

function selectedResolution(
	agreement: SalaryAgreement,
	asOf: string
): SalaryAgreementResolution {
	return {
		state: 'selected',
		source: agreement.source,
		agreement_id: agreement.agreement_id,
		profile: agreement.profile,
		effective_from: agreement.effective_from,
		effective_to: agreement.effective_to,
		salary_type: agreement.salary_type,
		classification: classifySalaryAgreement(agreement, asOf),
		conflict_ids: [],
	};
}

/**
 * Resolve the one agreement covering `anchor`. There is deliberately no latest
 * fallback: no cover is `unavailable`, and two or more distinct covering ids
 * are `ambiguous` with every id reported. Cancelled/inactive rows are skipped.
 */
export function resolveSalaryAgreementAt(
	rows: readonly SalaryProfileRow[],
	anchor: string,
	options: ResolveOptions = {}
): SalaryAgreementResolution {
	const anchorDate = normalizeSalaryDate(anchor);
	if (anchorDate === null) {
		throw new RangeError(`Invalid salary anchor "${anchor}"`);
	}
	const reference = options.asOf ?? anchorDate;
	if (normalizeSalaryDate(reference) === null) {
		throw new RangeError(`Invalid salary reference date "${reference}"`);
	}
	const source = options.source ?? 'employee_salary_profile';
	const agreements = agreementsById(rows, source, options.employeeId);
	const covering = agreements.filter(
		(agreement) =>
			agreement.is_active &&
			agreement.cancelled_at === null &&
			agreement.effective_from <= anchorDate &&
			(agreement.effective_to === null || agreement.effective_to >= anchorDate)
	);

	if (covering.length === 0) {
		return {
			state: 'unavailable',
			source: null,
			agreement_id: null,
			profile: null,
			effective_from: null,
			effective_to: null,
			salary_type: null,
			classification: null,
			conflict_ids: [],
		};
	}

	if (covering.length > 1) {
		return {
			state: 'ambiguous',
			source: null,
			agreement_id: null,
			profile: null,
			effective_from: null,
			effective_to: null,
			salary_type: null,
			classification: null,
			conflict_ids: covering
				.map((agreement) => agreement.agreement_id)
				.sort((left, right) => left - right),
		};
	}

	return selectedResolution(covering[0], reference);
}

/**
 * Project every retained agreement for display/read contracts. Unlike
 * selection, this keeps inactive and cancelled identities; they are classified
 * but can never become `current`.
 */
export function buildSalaryAgreementTimeline(
	rows: readonly SalaryProfileRow[],
	options: TimelineOptions
): SalaryAgreementTimeline {
	const asOf = normalizeSalaryDate(options.asOf);
	if (asOf === null) {
		throw new RangeError(`Invalid salary reference date "${options.asOf}"`);
	}
	const source = options.source ?? 'employee_salary_profile';
	const agreements = agreementsById(rows, source, options.employeeId).sort(
		(left, right) =>
			left.effective_from.localeCompare(right.effective_from) ||
			left.agreement_id - right.agreement_id
	);
	const employeeId =
		options.employeeId ??
		(agreements.length > 0 ? agreements[0].employee_id : null);

	return {
		employee_id: employeeId,
		as_of: asOf,
		agreements: agreements.map((agreement) => ({
			agreement,
			classification: classifySalaryAgreement(agreement, asOf),
		})),
		current: resolveSalaryAgreementAt(rows, asOf, {
			source,
			...(options.employeeId === undefined
				? {}
				: { employeeId: options.employeeId }),
			asOf,
		}),
	};
}
