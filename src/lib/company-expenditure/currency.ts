/**
 * Currency conversion — the one place an original amount becomes a
 * reporting-currency amount (ticket #319).
 *
 * Rules, straight from the parent specification:
 *  - A missing original currency is unknown, never `'INR'`: it may not be
 *    added into any currency subtotal and stays an explicit exception.
 *  - A reporting target may default to the company reporting currency; the
 *    original transaction currency is never inferred from a Project default.
 *  - An amount is stated in the requested reporting currency only from
 *    matching stored evidence: the original currency equals the requested
 *    basis, or the stored target equals it and a full rate triple was
 *    captured. No inverse or cross-rate is ever derived.
 *  - Conversion is per record, round-half-up to cents, using the shared
 *    Decimal arithmetic at higher precision than the money default (a
 *    DECIMAL(20,10) rate on a 2-decimal amount can exceed 20 significant
 *    digits). Callers sum the returned cent figures; nothing else multiplies
 *    a rate or rounds a converted amount.
 */

import Decimal from 'decimal.js';
import { toNumber } from '@/lib/money';
import type {
	ConversionEvidence,
	ConversionExceptionCode,
	ConversionOutcome,
	ConversionStatus,
} from './types';

export const REPORTING_CURRENCY = 'INR';

/** A DECIMAL(20,10) rate must not be truncated by the money default. */
const CONVERSION = Decimal.clone({
	precision: 40,
	rounding: Decimal.ROUND_HALF_UP,
});

const MAX_RATE_DECIMALS = 10;

/** Trimmed upper-case code, or null when the value is absent or blank. */
export function currencyCodeOf(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const code = String(value).trim().toUpperCase();
	return code.length === 0 ? null : code;
}

/** True when the value is absent/blank or a three-letter currency code. */
export function isCurrencyCode(value: unknown): boolean {
	const code = currencyCodeOf(value);
	return code === null || /^[A-Z]{3}$/.test(code);
}

/** The requested (or stored) reporting target; absent means the company's. */
export function reportingCurrencyOf(input: {
	reportingCurrency?: string | null;
}): string {
	return currencyCodeOf(input.reportingCurrency) ?? REPORTING_CURRENCY;
}

/**
 * The rate as a precise Decimal, or null when absent or unusable. Accepts the
 * database's string, a Decimal, or a number; values beyond ten decimal places
 * or not strictly positive are rejected rather than silently rounded.
 */
export function parseConversionRate(
	value: Decimal.Value | null | undefined
): Decimal | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	if (text.length === 0) return null;
	try {
		const rate = CONVERSION(text);
		if (!rate.isFinite() || rate.lte(0)) return null;
		if (rate.decimalPlaces() > MAX_RATE_DECIMALS) return null;
		return rate;
	} catch {
		return null;
	}
}

/**
 * Why this record's own evidence cannot support a conversion, or null when it
 * can (including when the amount is already in its reporting target).
 */
export function conversionException(
	evidence: ConversionEvidence
): ConversionExceptionCode | null {
	const original = currencyCodeOf(evidence.currency);
	if (original === null) return 'original_currency_missing';
	if (original === reportingCurrencyOf(evidence)) return null;
	const rawRate = evidence.conversionRate;
	const hasRateText =
		rawRate !== null && rawRate !== undefined && String(rawRate).trim() !== '';
	if (hasRateText && parseConversionRate(rawRate) === null) {
		return 'conversion_rate_invalid';
	}
	if (!hasRateText) return 'conversion_evidence_missing';
	if (
		!evidence.conversionDate ||
		!evidence.conversionEvidenceReference ||
		String(evidence.conversionEvidenceReference).trim().length === 0
	) {
		return 'conversion_evidence_missing';
	}
	return null;
}

/**
 * Whether an amount can be stated in the requested reporting currency:
 * `reporting` when it is already in that basis, `converted` when matching
 * stored evidence supports it, `unsupported` otherwise.
 */
export function conversionStatusOf(
	evidence: ConversionEvidence,
	requestedReportingCurrency: string = REPORTING_CURRENCY
): ConversionStatus {
	const basis =
		currencyCodeOf(requestedReportingCurrency) ?? REPORTING_CURRENCY;
	const original = currencyCodeOf(evidence.currency);
	if (original === null) return 'unsupported';
	if (original === basis) return 'reporting';
	if (
		conversionException(evidence) === null &&
		reportingCurrencyOf(evidence) === basis
	) {
		return 'converted';
	}
	return 'unsupported';
}

/** The one function consumers call to state an amount in the reporting basis. */
export function convertToReporting(
	amount: number | null,
	evidence: ConversionEvidence,
	requestedReportingCurrency: string = REPORTING_CURRENCY
): ConversionOutcome {
	const basis =
		currencyCodeOf(requestedReportingCurrency) ?? REPORTING_CURRENCY;
	const status = conversionStatusOf(evidence, basis);
	if (status === 'unsupported') {
		return {
			status,
			reportingCurrency: basis,
			amount: null,
			exception: conversionException(evidence),
		};
	}
	if (amount === null) {
		return { status, reportingCurrency: basis, amount: null, exception: null };
	}
	if (status === 'reporting') {
		return {
			status,
			reportingCurrency: basis,
			amount: toNumber(CONVERSION(amount)),
			exception: null,
		};
	}
	const rate = parseConversionRate(evidence.conversionRate) as Decimal;
	return {
		status,
		reportingCurrency: basis,
		amount: toNumber(
			CONVERSION(amount).times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
		),
		exception: null,
	};
}

/** The conversion evidence a stored cost carries, in one shape. */
export function evidenceOf(record: {
	currency: string | null;
	reportingCurrency: string | null;
	conversionRate: string | null;
	conversionDate: string | null;
	conversionEvidenceReference: string | null;
}): ConversionEvidence {
	return {
		currency: record.currency,
		reportingCurrency: record.reportingCurrency,
		conversionRate: record.conversionRate,
		conversionDate: record.conversionDate,
		conversionEvidenceReference: record.conversionEvidenceReference,
	};
}
