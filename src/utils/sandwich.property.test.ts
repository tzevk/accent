import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	findSandwichedDays,
	getSandwichConversions,
	isSandwichLeaveStatus,
	isSandwichOffStatus,
} from '@/utils/sandwich';

/**
 * Properties of the bracketed Weekly Off / Holiday rule (ADR-0005). The
 * generator builds consecutive attendance days, so every case is a real
 * calendar run; an oracle asserts where a conversion is allowed.
 */

const STATUSES = [
	'PL',
	'CL',
	'SL',
	'EL',
	'LWP',
	'UL',
	'WO',
	'H',
	'P',
	'A',
	'HD',
	'OT',
	'',
] as const;

const START = '2026-05-01';

const addDays = (date: string, days: number): string => {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
};

const buildStatusMap = (
	statuses: readonly string[]
): Record<string, string> => {
	const map: Record<string, string> = {};
	statuses.forEach((status, index) => {
		map[addDays(START, index)] = status;
	});
	return map;
};

const statusArb = fc.array(fc.constantFrom(...STATUSES), {
	minLength: 1,
	maxLength: 12,
});

describe('sandwich properties', () => {
	it('only converts an off day to a bracketing leave code', () => {
		fc.assert(
			fc.property(statusArb, (statuses) => {
				const map = buildStatusMap(statuses);
				const conversions = getSandwichConversions(map);

				for (const [date, code] of Object.entries(conversions)) {
					expect(isSandwichOffStatus(map[date])).toBe(true);
					expect(isSandwichLeaveStatus(code)).toBe(true);
				}
			}),
			{ numRuns: 300 }
		);
	});

	it('does not depend on insertion order', () => {
		fc.assert(
			fc.property(statusArb, (statuses) => {
				const map = buildStatusMap(statuses);
				const reversed = Object.fromEntries(
					Object.entries(map).reverse()
				) as Record<string, string>;

				expect(getSandwichConversions(reversed)).toEqual(
					getSandwichConversions(map)
				);
			}),
			{ numRuns: 300 }
		);
	});

	it('is idempotent after the conversions are written back', () => {
		fc.assert(
			fc.property(statusArb, (statuses) => {
				const map = buildStatusMap(statuses);
				const conversions = getSandwichConversions(map);
				const applied = { ...map, ...conversions };

				expect(getSandwichConversions(applied)).toEqual({});
			}),
			{ numRuns: 300 }
		);
	});

	it('converts an off day that has leave immediately before and after it', () => {
		fc.assert(
			fc.property(statusArb, (statuses) => {
				const map = buildStatusMap(statuses);
				const conversions = getSandwichConversions(map);

				for (const [date, status] of Object.entries(map)) {
					if (!isSandwichOffStatus(status)) continue;
					if (
						!isSandwichLeaveStatus(map[addDays(date, -1)]) ||
						!isSandwichLeaveStatus(map[addDays(date, 1)])
					) {
						continue;
					}
					expect(conversions[date]).toBeDefined();
				}
			}),
			{ numRuns: 300 }
		);
	});

	it('converts only inside a maximal off run bracketed by leave on both ends', () => {
		fc.assert(
			fc.property(statusArb, (statuses) => {
				const map = buildStatusMap(statuses);
				const conversions = getSandwichConversions(map);

				for (const date of Object.keys(conversions)) {
					let runStart = date;
					while (isSandwichOffStatus(map[addDays(runStart, -1)])) {
						runStart = addDays(runStart, -1);
					}
					let runEnd = date;
					while (isSandwichOffStatus(map[addDays(runEnd, 1)])) {
						runEnd = addDays(runEnd, 1);
					}

					expect(isSandwichLeaveStatus(map[addDays(runStart, -1)])).toBe(true);
					expect(isSandwichLeaveStatus(map[addDays(runEnd, 1)])).toBe(true);
				}
			}),
			{ numRuns: 300 }
		);
	});

	it('lists the converted days in ascending order', () => {
		fc.assert(
			fc.property(statusArb, (statuses) => {
				const map = buildStatusMap(statuses);
				const dates = findSandwichedDays(map);
				const expected = Object.keys(getSandwichConversions(map)).sort();

				expect(dates).toEqual(expected);
				expect([...dates].sort()).toEqual(dates);
			}),
			{ numRuns: 300 }
		);
	});
});
