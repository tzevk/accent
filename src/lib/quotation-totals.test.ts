import { describe, it, expect } from 'vitest';
import { add, toNumber } from '@/lib/money';
import { computeQuotationTotals } from '@/lib/quotation-totals';
import Decimal from 'decimal.js';

// ── Summing scope items ─────────────────────────────────────────────

describe('computeQuotationTotals — gross', () => {
	it('sums multiple item amounts', () => {
		const t = computeQuotationTotals(
			[
				{ qty: 1, amount: '1000.50' },
				{ qty: 2, amount: 150 },
				{ qty: 1, amount: 249.5 },
			],
			0
		);
		expect(toNumber(t.gross)).toBe(1400);
	});

	it('keeps an empty item list at zero', () => {
		const t = computeQuotationTotals([], 18);
		expect(toNumber(t.gross)).toBe(0);
		expect(toNumber(t.net)).toBe(0);
	});

	it('treats a missing, empty or non-numeric amount as 0, never NaN', () => {
		const t = computeQuotationTotals(
			[
				{ qty: 1, amount: null },
				{ qty: 1, amount: undefined },
				{ qty: 1, amount: '' },
				{ qty: 1, amount: 'not-a-number' },
				{ qty: 1, amount: '75.25' },
			],
			18
		);
		expect(toNumber(t.gross)).toBe(75.25);
		expect(t.gross.isNaN()).toBe(false);
		expect(t.gst.isNaN()).toBe(false);
	});

	it('ignores qty: totals come from stored amounts, and junk qty is harmless', () => {
		const t = computeQuotationTotals(
			[
				{ qty: '', amount: 10 },
				{ qty: null, amount: 20 },
				{ qty: 'abc', amount: 30 },
			],
			0
		);
		expect(toNumber(t.gross)).toBe(60);
	});
});

// ── GST application ─────────────────────────────────────────────────

describe('computeQuotationTotals — gst/net', () => {
	it('applies 18% GST exactly on a round gross', () => {
		const t = computeQuotationTotals([{ amount: 200 }], 18);
		expect(toNumber(t.gst)).toBe(36);
		expect(toNumber(t.net)).toBe(236);
	});

	it('rounds the GST to 2dp before adding it (101.85 → 18.33)', () => {
		const t = computeQuotationTotals([{ amount: '101.85' }], 18);
		expect(toNumber(t.gst)).toBe(18.33);
		expect(toNumber(t.net)).toBe(120.18);
	});

	it('accepts a decimal GST rate from a string', () => {
		const t = computeQuotationTotals([{ amount: 1000 }], '2.5');
		expect(toNumber(t.gst)).toBe(25);
		expect(toNumber(t.net)).toBe(1025);
	});

	it('applies no GST for 0, empty, null or undefined percentages', () => {
		for (const pct of [0, '', null, undefined] as const) {
			const t = computeQuotationTotals([{ amount: '499.99' }], pct);
			expect(toNumber(t.gst)).toBe(0);
			expect(toNumber(t.net)).toBe(499.99);
		}
	});

	it('treats a non-numeric GST rate as no GST', () => {
		const t = computeQuotationTotals([{ amount: 100 }], 'oops');
		expect(toNumber(t.gst)).toBe(0);
		expect(toNumber(t.net)).toBe(100);
	});
});

// ── CGST/SGST split ─────────────────────────────────────────────────

describe('computeQuotationTotals — cgst/sgst split', () => {
	it('splits GST evenly into CGST + SGST', () => {
		const t = computeQuotationTotals([{ amount: '101.85' }], 18);
		expect(toNumber(t.cgst)).toBe(9.165);
		expect(toNumber(t.sgst)).toBe(9.165);
	});

	it('keeps cgst + sgst exactly equal to the GST (odd paise included)', () => {
		for (const amount of ['101.85', '200', '13377', '0.05']) {
			const t = computeQuotationTotals([{ amount }], 18);
			expect(toNumber(add(t.cgst, t.sgst))).toBe(toNumber(t.gst));
		}
	});

	it('returns zero halves when GST is zero', () => {
		const t = computeQuotationTotals([{ amount: 500 }], 0);
		expect(toNumber(t.cgst)).toBe(0);
		expect(toNumber(t.sgst)).toBe(0);
	});
});

// ── Return contract ─────────────────────────────────────────────────

describe('computeQuotationTotals — decimals', () => {
	it('returns Decimals on every field', () => {
		const t = computeQuotationTotals([{ amount: '10.10' }], 18);
		expect(t.gross).toBeInstanceOf(Decimal);
		expect(t.gst).toBeInstanceOf(Decimal);
		expect(t.net).toBeInstanceOf(Decimal);
		expect(t.cgst).toBeInstanceOf(Decimal);
		expect(t.sgst).toBeInstanceOf(Decimal);
	});
});
