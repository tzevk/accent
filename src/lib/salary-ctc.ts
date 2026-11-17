import Decimal from 'decimal.js';

/**
 * One presence-based monthly CTC resolver for payroll, salary previews and
 * salary-dependent readers.
 *
 * Canonical `employer_cost` wins by presence, so an explicitly stored zero is
 * a real agreed CTC rather than a request to fall back. The legacy gross
 * fields are consulted only when canonical CTC is absent, and a resolved
 * legacy amount is disclosed through `legacyFallback`/`source`.
 *
 * The functions are pure: no database, routes or component state.
 */

/** Salary Profile fields that may carry the agreed monthly CTC. */
export type SalaryCtcSource =
	| 'employer_cost'
	| 'gross_salary'
	| 'gross'
	| 'none';

/** A concrete field that supplied, or failed to supply, the CTC. */
export type SalaryCtcField = Exclude<SalaryCtcSource, 'none'>;

/** Why a present CTC value cannot be used. */
export type SalaryCtcInvalidReason = 'not-finite' | 'negative' | 'out-of-range';

/** Why a CTC input is absent or unusable. */
export type SalaryCtcValidationFailure = 'missing' | SalaryCtcInvalidReason;

export interface SalaryCtcResolved {
	status: 'resolved';
	/** Exact monthly CTC; the caller converts at a JSON/database boundary. */
	amount: Decimal;
	source: SalaryCtcField;
	/** True only when a legacy gross field supplied the amount. */
	legacyFallback: boolean;
}

export interface SalaryCtcMissing {
	status: 'missing';
	amount: null;
	source: 'none';
	legacyFallback: false;
}

export interface SalaryCtcInvalid {
	status: 'invalid';
	amount: null;
	source: SalaryCtcField;
	legacyFallback: false;
	reason: SalaryCtcInvalidReason;
}

export type SalaryCtcResolution =
	| SalaryCtcResolved
	| SalaryCtcMissing
	| SalaryCtcInvalid;

export type SalaryCtcValidation =
	| { valid: true; amount: Decimal }
	| { valid: false; reason: SalaryCtcValidationFailure };

export type DailyHoursValidationFailure =
	| 'missing'
	| 'not-finite'
	| 'nonpositive';

export type DailyHoursValidation =
	| { valid: true; hours: Decimal }
	| { valid: false; reason: DailyHoursValidationFailure };

/**
 * `employee_salary_profile.employer_cost` is DECIMAL(12,2), so a storeable
 * monthly CTC can never exceed this.
 */
export const SALARY_CTC_MAX = 9_999_999_999.99;

const SALARY_CTC_MAX_DECIMAL = new Decimal('9999999999.99');

/** Legacy fallback order: the established gross meanings, never contract_amount. */
const LEGACY_CTC_FIELDS: readonly SalaryCtcField[] = ['gross_salary', 'gross'];

/** Absent means the field was never supplied; zero is present. */
export function isSalaryCtcPresent(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

type PresentSalaryCtcValidation =
	| { valid: true; amount: Decimal }
	| { valid: false; reason: SalaryCtcInvalidReason };

/**
 * Check a CTC value whose presence the caller already established, so the
 * failure reason stays inside `SalaryCtcInvalidReason`.
 */
function validatePresentSalaryCtc(
	value: Decimal.Value
): PresentSalaryCtcValidation {
	let amount: Decimal;
	try {
		amount = new Decimal(value);
	} catch {
		return { valid: false, reason: 'not-finite' };
	}

	if (!amount.isFinite()) {
		return { valid: false, reason: 'not-finite' };
	}
	if (amount.isNegative()) {
		return { valid: false, reason: 'negative' };
	}
	if (amount.gt(SALARY_CTC_MAX_DECIMAL)) {
		return { valid: false, reason: 'out-of-range' };
	}

	return { valid: true, amount };
}

/**
 * Validate a monthly CTC input: finite, nonnegative and inside the database
 * column range. Explicit zero is valid.
 */
export function validateSalaryCtc(value: unknown): SalaryCtcValidation {
	if (!isSalaryCtcPresent(value)) {
		return { valid: false, reason: 'missing' };
	}
	return validatePresentSalaryCtc(value as Decimal.Value);
}

/** Validate standard daily hours: finite and strictly positive. */
export function validateDailyHours(value: unknown): DailyHoursValidation {
	if (!isSalaryCtcPresent(value)) {
		return { valid: false, reason: 'missing' };
	}

	let hours: Decimal;
	try {
		hours = new Decimal(value as Decimal.Value);
	} catch {
		return { valid: false, reason: 'not-finite' };
	}

	if (!hours.isFinite()) {
		return { valid: false, reason: 'not-finite' };
	}
	// Decimal.isPositive() reports the sign, where zero is positive, so require
	// strictly greater than zero numerically.
	if (hours.lte(0)) {
		return { valid: false, reason: 'nonpositive' };
	}

	return { valid: true, hours };
}

/**
 * Resolve the agreement's monthly CTC for payroll and salary estimates.
 *
 * - canonical `employer_cost` present (including zero) → resolved canonical;
 * - present but invalid canonical → `invalid`, never a legacy substitution;
 * - canonical absent → established positive-only `gross_salary` then `gross`
 *   fallback, disclosed through source/legacyFallback;
 * - otherwise → `missing`, which is distinct from an explicit zero.
 */
export function resolveSalaryCtc(
	profile: Record<string, unknown> | null | undefined
): SalaryCtcResolution {
	if (!profile) {
		return {
			status: 'missing',
			amount: null,
			source: 'none',
			legacyFallback: false,
		};
	}

	const employerCost = profile.employer_cost;
	if (isSalaryCtcPresent(employerCost)) {
		const validation = validatePresentSalaryCtc(employerCost as Decimal.Value);
		if (!validation.valid) {
			return {
				status: 'invalid',
				amount: null,
				source: 'employer_cost',
				legacyFallback: false,
				reason: validation.reason,
			};
		}
		return {
			status: 'resolved',
			amount: validation.amount,
			source: 'employer_cost',
			legacyFallback: false,
		};
	}

	for (const field of LEGACY_CTC_FIELDS) {
		const value = profile[field];
		if (!isSalaryCtcPresent(value)) continue;
		const validation = validatePresentSalaryCtc(value as Decimal.Value);
		// The legacy chain stays positive-only: a stored zero is treated as
		// absence, so a later positive gross field still wins.
		if (validation.valid && validation.amount.gt(0)) {
			return {
				status: 'resolved',
				amount: validation.amount,
				source: field,
				legacyFallback: true,
			};
		}
	}

	return {
		status: 'missing',
		amount: null,
		source: 'none',
		legacyFallback: false,
	};
}
