import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import Decimal from 'decimal.js';
import { R, add, sub, pctOf, roundR, toNumber } from '@/lib/money';

/**
 * Properties of the money boundary (CODING_STANDARDS.md, money and payroll).
 * The generators use integer cents so every expectation is exact; a float
 * round-trip would hide the drift these properties exist to catch.
 */

const centsArb = fc.integer({ min: 0, max: 1_000_000_000 });
const signedCentsArb = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

const decimalFromCents = (cents: number): Decimal =>
	new Decimal(cents).div(100);

describe('money properties', () => {
	it('round-trips exact decimal strings through R', () => {
		fc.assert(
			fc.property(signedCentsArb, (cents) => {
				const exact = decimalFromCents(cents);
				expect(R(exact.toString()).equals(exact)).toBe(true);
				expect(R(exact.toFixed(2)).equals(exact)).toBe(true);
			}),
			{ numRuns: 300 }
		);
	});

	it('keeps addition commutative and associative', () => {
		fc.assert(
			fc.property(signedCentsArb, signedCentsArb, signedCentsArb, (a, b, c) => {
				const da = decimalFromCents(a);
				const db = decimalFromCents(b);
				const dc = decimalFromCents(c);

				expect(add(da, db).equals(add(db, da))).toBe(true);
				expect(add(add(da, db), dc).equals(add(da, add(db, dc)))).toBe(true);
			}),
			{ numRuns: 300 }
		);
	});

	it('reverses subtraction by addition', () => {
		fc.assert(
			fc.property(signedCentsArb, signedCentsArb, (a, b) => {
				const da = decimalFromCents(a);
				const db = decimalFromCents(b);
				expect(add(sub(da, db), db).equals(da)).toBe(true);
			}),
			{ numRuns: 300 }
		);
	});

	it('never exceeds the amount for a percentage between 0 and 100', () => {
		fc.assert(
			fc.property(
				centsArb,
				fc.integer({ min: 0, max: 100 }),
				(cents, percent) => {
					const amount = decimalFromCents(cents);
					const share = pctOf(amount, percent);

					expect(share.gte(0)).toBe(true);
					expect(share.lte(amount)).toBe(true);
				}
			),
			{ numRuns: 300 }
		);
	});

	it('rounds whole rupees idempotently and within half a rupee', () => {
		fc.assert(
			fc.property(signedCentsArb, (cents) => {
				const amount = decimalFromCents(cents);
				const rounded = roundR(amount);

				expect(roundR(rounded).equals(rounded)).toBe(true);
				expect(amount.minus(rounded).abs().lte('0.5')).toBe(true);
			}),
			{ numRuns: 300 }
		);
	});

	it('converts safe integers back without loss', () => {
		fc.assert(
			fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), (value) => {
				expect(toNumber(R(value))).toBe(value);
			}),
			{ numRuns: 300 }
		);
	});
});
