import { describe, expect, it } from 'vitest';
import { hasTodayColumn, preScrollLeft, todayDate } from './scroll-to-today';

describe('preScrollLeft', () => {
	it('puts today just right of the sticky Employee column', () => {
		// Today's column starts 560px into the region; the sticky Employee
		// column covers the first 240px, so the reader wants it at 320.
		expect(preScrollLeft(560 - 240, 0)).toBe(320);
	});

	it('carries a non-zero scroll position forward', () => {
		// Measured at scrollLeft 100: the same target is 100 closer than the
		// rect delta said, so the delta must not be applied unadjusted.
		expect(preScrollLeft(220, 100)).toBe(320);
	});

	it('never scrolls backwards', () => {
		// Today sits under the sticky column already (early month, narrow
		// sticky column): leaving the matrix at its first day is correct.
		expect(preScrollLeft(-80, 0)).toBe(0);
		expect(preScrollLeft(-80, 300)).toBe(220);
	});
});

describe('hasTodayColumn', () => {
	const days = ['2026-10-01', '2026-10-15', '2026-10-31'];

	it('is true when today is a column of the month', () => {
		expect(hasTodayColumn('2026-10-15', days)).toBe(true);
	});

	it('is false for a month that does not hold today', () => {
		// The report defaults to the latest month with logs, which is often
		// last month — such a month opens at its first day instead.
		expect(hasTodayColumn('2026-09-30', days)).toBe(false);
		expect(hasTodayColumn('2026-11-01', days)).toBe(false);
	});
});

describe('todayDate', () => {
	it('formats the local calendar date, not a UTC day', () => {
		// 2026-10-15 02:00 IST is 2026-10-14 20:30 UTC: a UTC reading would
		// hand the viewer a column that is not today.
		const local = new Date(2026, 9, 15, 2, 0, 0);
		expect(todayDate(local)).toBe('2026-10-15');
		expect(local.toISOString().slice(0, 10)).toBe('2026-10-14');
	});

	it('zero-pads single-digit months and days', () => {
		expect(todayDate(new Date(2026, 0, 5))).toBe('2026-01-05');
	});
});
