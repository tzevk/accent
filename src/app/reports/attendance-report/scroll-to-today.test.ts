// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { preScrollLeft, todayDate, todaysColumn } from './scroll-to-today';
import { execFileSync } from 'node:child_process';

describe('todaysColumn', () => {
	const days = ['2026-10-01', '2026-10-15', '2026-10-31'];

	it('names the column for today', () => {
		// The same answer drives the open scroll position and the today
		// colour, so a month holding today must resolve to exactly that date.
		expect(todaysColumn(days, '2026-10-15')).toBe('2026-10-15');
	});

	it('is null for a month that does not hold today', () => {
		// The report defaults to the latest month with logs, which is often
		// last month — such a month opens at its first day, with no today
		// colour anywhere in the grid.
		expect(todaysColumn(days, '2026-09-30')).toBeNull();
		expect(todaysColumn(days, '2026-11-01')).toBeNull();
	});

	it('is null before any month has loaded', () => {
		expect(todaysColumn([], '2026-10-15')).toBeNull();
	});
});

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

describe('todayDate', () => {
	it.each([
		['UTC', '2026-10-14T20:30:00.000Z', '2026-10-14'],
		['Asia/Kolkata', '2026-10-14T20:30:00.000Z', '2026-10-15'],
		['America/Los_Angeles', '2026-10-15T01:00:00.000Z', '2026-10-14'],
	])('formats the local calendar date in %s', (timezone, instant, expected) => {
		// Each process owns its timezone, independent of the host and other tests.
		const moduleUrl = new URL('./scroll-to-today.ts', import.meta.url).href;
		const actual = execFileSync(
			process.execPath,
			[
				'--input-type=module',
				'--eval',
				`import { todayDate } from ${JSON.stringify(moduleUrl)};
			process.stdout.write(todayDate(new Date(${JSON.stringify(instant)})));`,
			],
			{
				encoding: 'utf8',
				env: { ...process.env, TZ: timezone },
			}
		);
		expect(actual).toBe(expected);
	});

	it('zero-pads single-digit months and days', () => {
		expect(todayDate(new Date(2026, 0, 5))).toBe('2026-01-05');
	});
});
