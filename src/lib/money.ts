import Decimal from 'decimal.js';

// One-time global config
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Parse a DB value to a Decimal.
 * mysql2 returns DECIMAL columns as strings, so this accepts string | number | Decimal.
 * Falsy values default to 0.
 */
export const R = (v: Decimal.Value): Decimal => new Decimal(v || 0);

// ── Arithmetic ──────────────────────────────────────────────────────

export const add = (...vals: Decimal.Value[]): Decimal => {
	let sum = new Decimal(0);
	for (const v of vals) sum = sum.plus(v || 0);
	return sum;
};

export const sub = (a: Decimal.Value, b: Decimal.Value): Decimal =>
	R(a).minus(R(b));

export const mul = (a: Decimal.Value, b: Decimal.Value): Decimal =>
	R(a).times(R(b));

export const div = (a: Decimal.Value, b: Decimal.Value): Decimal =>
	R(a).div(R(b));
/**
 * amount × (percent / 100), rounded.
 * Default 2dp for money, 0dp for salary heads.
 */
export const pctOf = (
	amount: Decimal.Value,
	percent: number,
	dp = 2
): Decimal => R(amount).times(percent).div(100).toDecimalPlaces(dp);

/** Round to whole rupees (for salary components). */
export const roundR = (v: Decimal.Value): Decimal =>
	R(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

// ── Comparisons ─────────────────────────────────────────────────────

export const gte = (a: Decimal.Value, b: Decimal.Value): boolean => R(a).gte(b);
export const gt = (a: Decimal.Value, b: Decimal.Value): boolean => R(a).gt(b);
export const isZero = (v: Decimal.Value): boolean => R(v).isZero();

// ── Boundary conversion ─────────────────────────────────────────────

/** Decimal → number (for DB INSERT params / JSON responses). */
export const toNumber = (d: Decimal): number => d.toNumber();
