import { describe, it, expect } from 'vitest';
import {
	R,
	add,
	sub,
	mul,
	div,
	pctOf,
	roundR,
	gte,
	gt,
	isZero,
	toNumber,
} from '@/lib/money';
import Decimal from 'decimal.js';

// ── R (parse) ────────────────────────────────────────────────────────

describe('R (parse)', () => {
	it('parses a number', () => {
		const d = R(42);
		expect(d).toBeInstanceOf(Decimal);
		expect(d.toNumber()).toBe(42);
	});

	it('parses a numeric string (mysql2 DECIMAL column)', () => {
		const d = R('15000.50');
		expect(d.toNumber()).toBe(15000.5);
	});

	it('parses an existing Decimal', () => {
		const orig = new Decimal(99.99);
		const d = R(orig);
		expect(d.toNumber()).toBe(99.99);
	});

	it('defaults null to 0', () => {
		expect(R(null).toNumber()).toBe(0);
	});

	it('defaults undefined to 0', () => {
		expect(R(undefined).toNumber()).toBe(0);
	});

	it('defaults empty string to 0', () => {
		expect(R('').toNumber()).toBe(0);
	});

	it('defaults 0 to 0', () => {
		expect(R(0).toNumber()).toBe(0);
	});

	it('defaults falsy to 0 (false)', () => {
		expect(R(false as unknown as Decimal.Value).toNumber()).toBe(0);
	});
});

// ── add ──────────────────────────────────────────────────────────────

describe('add', () => {
	it('adds two numbers exactly', () => {
		expect(toNumber(add(0.1, 0.2))).toBe(0.3);
	});

	it('adds multiple values', () => {
		expect(toNumber(add(10, 20, 30, 40))).toBe(100);
	});

	it('adds mixed string and number', () => {
		expect(toNumber(add('100.50', 50.25))).toBe(150.75);
	});

	it('adds with Decimal values', () => {
		expect(toNumber(add(new Decimal(5), new Decimal(7)))).toBe(12);
	});

	it('adds zero values correctly', () => {
		expect(toNumber(add(0, 0, 0))).toBe(0);
	});

	it('treats falsy as 0', () => {
		expect(toNumber(add(null, 5, undefined))).toBe(5);
	});

	it('adds large values without precision loss', () => {
		expect(toNumber(add(9999999.99, 0.01))).toBe(10000000.0);
	});

	it('adds single value (identity)', () => {
		expect(toNumber(add(42))).toBe(42);
	});

	it('adds no values returns 0', () => {
		expect(toNumber(add())).toBe(0);
	});
});

// ── sub ──────────────────────────────────────────────────────────────

describe('sub', () => {
	it('subtracts exactly', () => {
		expect(toNumber(sub(1000.1, 500.05))).toBe(500.05);
	});

	it('subtracts with strings', () => {
		expect(toNumber(sub('200.50', '100.25'))).toBe(100.25);
	});

	it('returns negative when b > a', () => {
		expect(toNumber(sub(5, 10))).toBe(-5);
	});

	it('returns zero when equal', () => {
		expect(toNumber(sub(50, 50))).toBe(0);
	});

	it('treats falsy as 0', () => {
		expect(toNumber(sub(null, 5))).toBe(-5);
		expect(toNumber(sub(5, null))).toBe(5);
	});
});

// ── mul ──────────────────────────────────────────────────────────────

describe('mul', () => {
	it('multiplies exactly', () => {
		expect(toNumber(mul(0.1, 0.2))).toBe(0.02);
	});

	it('multiplies money values', () => {
		expect(toNumber(mul('15000', 0.12))).toBe(1800);
	});
});

// ── div ──────────────────────────────────────────────────────────────

describe('div', () => {
	it('divides exactly', () => {
		expect(toNumber(div(18000, 8))).toBe(2250);
	});

	it('divides with repeating decimal', () => {
		const result = div(10, 3);
		// Decimal with precision 20
		expect(result.toFixed(4)).toBe('3.3333');
	});
});

// ── pctOf ────────────────────────────────────────────────────────────

describe('pctOf', () => {
	it('calculates percentage with default 2dp', () => {
		expect(toNumber(pctOf(1000, 18))).toBe(180);
	});

	it('calculates GST (fractional amount)', () => {
		expect(pctOf(101.85, 18).toFixed(2)).toBe('18.33');
	});

	it('calculates with 0dp for salary heads', () => {
		// 18000 * 12% = 2160, should round to 0dp → 2160
		expect(toNumber(pctOf(18000, 12, 0))).toBe(2160);
	});

	it('handles 0 percent', () => {
		expect(toNumber(pctOf(5000, 0))).toBe(0);
	});

	it('handles 0 amount', () => {
		expect(toNumber(pctOf(0, 18))).toBe(0);
	});

	it('handles gross * 60% for basic+da', () => {
		expect(toNumber(pctOf(30000, 60, 0))).toBe(18000);
	});

	it('handles gratuity (4.81% of 18000 → 865.8 → 866)', () => {
		expect(toNumber(pctOf(18000, 4.81, 0))).toBe(866);
	});
});

// ── roundR ───────────────────────────────────────────────────────────

describe('roundR', () => {
	it('rounds to whole rupees (.5 up)', () => {
		expect(toNumber(roundR(100.5))).toBe(101);
	});

	it('rounds down below .5', () => {
		expect(toNumber(roundR(100.49))).toBe(100);
	});

	it('handles exact integer', () => {
		expect(toNumber(roundR(100))).toBe(100);
	});

	it('handles string input', () => {
		expect(toNumber(roundR('15000.67'))).toBe(15001);
	});
});

// ── Comparisons ──────────────────────────────────────────────────────

describe('gte', () => {
	it('returns true when greater', () => {
		expect(gte(10, 5)).toBe(true);
	});

	it('returns true when equal', () => {
		expect(gte(120.18, 120.18)).toBe(true);
	});

	it('returns false when less', () => {
		expect(gte(5, 10)).toBe(false);
	});

	it('works with strings', () => {
		expect(gte('15000', '14000')).toBe(true);
	});

	it('catches float comparison edge case (0.1 + 0.2 >= 0.3)', () => {
		// 0.1 + 0.2 = 0.30000000000000004 in IEEE 754
		// Raw >= would give true, but gte must also give true
		expect(gte(0.1 + 0.2, 0.3)).toBe(true);
	});
});

describe('gt', () => {
	it('returns true when strictly greater', () => {
		expect(gt(10, 5)).toBe(true);
	});

	it('returns false when equal', () => {
		expect(gt(10, 10)).toBe(false);
	});

	it('returns false when less', () => {
		expect(gt(5, 10)).toBe(false);
	});
});

describe('isZero', () => {
	it('returns true for 0', () => {
		expect(isZero(0)).toBe(true);
	});

	it('returns true for "0"', () => {
		expect(isZero('0')).toBe(true);
	});

	it('returns true for null', () => {
		expect(isZero(null)).toBe(true);
	});

	it('returns false for non-zero', () => {
		expect(isZero(0.01)).toBe(false);
	});
});

// ── toNumber (boundary escape) ───────────────────────────────────────

describe('toNumber', () => {
	it('converts Decimal to number', () => {
		const d = new Decimal(42);
		expect(toNumber(d)).toBe(42);
		expect(typeof toNumber(d)).toBe('number');
	});

	it('round-trips through R', () => {
		expect(toNumber(R('15000.50'))).toBe(15000.5);
	});
});
