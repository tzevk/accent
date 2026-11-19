import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isWeeklyOff } from '@/utils/weekly-off';

/**
 * Properties of the company weekly-off calendar (ADR-0004): every Sunday,
 * the 2nd and 4th Saturday, and nothing else. The oracle is the policy
 * statement, not the implementation's branches.
 */

const dayArb = fc.date({
	min: new Date(Date.UTC(2000, 0, 1)),
	max: new Date(Date.UTC(2035, 11, 31)),
	noInvalidDate: true,
});

const pad = (value: number): string => String(value).padStart(2, '0');

describe('weekly-off properties', () => {
	it('matches the Sunday plus 2nd/4th Saturday policy on every date', () => {
		fc.assert(
			fc.property(dayArb, (date) => {
				const key = date.toISOString().slice(0, 10);
				const weekday = date.getUTCDay();
				const saturdayOfMonth = Math.ceil(date.getUTCDate() / 7);
				const expected =
					weekday === 0 ||
					(weekday === 6 && (saturdayOfMonth === 2 || saturdayOfMonth === 4));

				expect(isWeeklyOff(key)).toBe(expected);
			}),
			{ numRuns: 500 }
		);
	});

	it('returns false for junk that is not a date key', () => {
		fc.assert(
			fc.property(fc.string(), (suffix) => {
				expect(isWeeklyOff(`junk-${suffix}`)).toBe(false);
			}),
			{ numRuns: 200 }
		);
	});

	it('returns false for date-shaped strings that do not exist', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 2000, max: 2035 }),
				fc.integer({ min: 1, max: 12 }),
				fc.integer({ min: 1, max: 31 }),
				(year, month, day) => {
					const key = `${year}-${pad(month)}-${pad(day)}`;
					const parsed = new Date(`${key}T00:00:00Z`);
					const exists =
						!Number.isNaN(parsed.getTime()) &&
						parsed.toISOString().slice(0, 10) === key;

					if (!exists) expect(isWeeklyOff(key)).toBe(false);
				}
			),
			{ numRuns: 300 }
		);
	});

	it('is deterministic for the same date', () => {
		fc.assert(
			fc.property(dayArb, (date) => {
				const key = date.toISOString().slice(0, 10);
				expect(isWeeklyOff(key)).toBe(isWeeklyOff(key));
			}),
			{ numRuns: 200 }
		);
	});
});
