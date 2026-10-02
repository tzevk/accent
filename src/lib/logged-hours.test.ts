import { describe, it, expect } from 'vitest';
import {
	parseDailyEntries,
	sumLoggedHoursForMonth,
	hoursByDateForMonth,
} from '@/lib/logged-hours';

const MAY = '2026-05';

describe('parseDailyEntries', () => {
	it('parses a JSON string payload (mysql2 longtext)', () => {
		const entries = parseDailyEntries(
			'[{"date":"2026-05-04","hours":8},{"date":"2026-05-05","hours":9}]'
		);
		expect(entries).toEqual([
			{ date: '2026-05-04', hours: 8 },
			{ date: '2026-05-05', hours: 9 },
		]);
	});

	it('accepts an already-parsed array', () => {
		expect(parseDailyEntries([{ date: '2026-05-04', hours: 8 }])).toEqual([
			{ date: '2026-05-04', hours: 8 },
		]);
	});

	it('returns [] for null, empty, "null", and "[]" payloads', () => {
		expect(parseDailyEntries(null)).toEqual([]);
		expect(parseDailyEntries(undefined)).toEqual([]);
		expect(parseDailyEntries('')).toEqual([]);
		expect(parseDailyEntries('null')).toEqual([]);
		expect(parseDailyEntries('[]')).toEqual([]);
	});

	it('returns [] for a JSON object payload', () => {
		expect(parseDailyEntries('{"date":"2026-05-04","hours":8}')).toEqual([]);
	});

	it('returns [] for malformed JSON without throwing', () => {
		expect(() => parseDailyEntries('{invalid json')).not.toThrow();
		expect(parseDailyEntries('{invalid json')).toEqual([]);
	});

	it('drops non-object members and keeps valid siblings', () => {
		const entries = parseDailyEntries([
			null,
			3,
			'2026-05-04',
			{ nested: { date: '2026-05-04', hours: 8 } },
			['2026-05-04', 8],
			{ date: '2026-05-04', hours: 8 },
		]);
		expect(entries).toEqual([{ date: '2026-05-04', hours: 8 }]);
	});

	it('drops entries with a missing or non-string date', () => {
		const entries = parseDailyEntries([
			{ qty_done: 3 },
			{ date: 20260504, hours: 8 },
			{ date: null, hours: 8 },
			{ date: '2026-05', hours: 8 },
			{ date: '2026-05-04', hours: 8 },
		]);
		expect(entries).toEqual([{ date: '2026-05-04', hours: 8 }]);
	});

	it('coerces numeric-string hours and tolerates surrounding whitespace', () => {
		const entries = parseDailyEntries([
			{ date: '2026-05-04', hours: '8' },
			{ date: '2026-05-05', hours: '8.5' },
			{ date: '2026-05-06', hours: ' 8 ' },
		]);
		expect(entries).toEqual([
			{ date: '2026-05-04', hours: 8 },
			{ date: '2026-05-05', hours: 8.5 },
			{ date: '2026-05-06', hours: 8 },
		]);
	});

	it('drops zero, negative, NaN, infinite, non-numeric, and missing hours', () => {
		const entries = parseDailyEntries([
			{ date: '2026-05-04', hours: 0 },
			{ date: '2026-05-05', hours: -3 },
			{ date: '2026-05-06', hours: NaN },
			{ date: '2026-05-07', hours: Infinity },
			{ date: '2026-05-08', hours: 'abc' },
			{ date: '2026-05-09' },
			{ date: '2026-05-10', hours: true },
			{ date: '2026-05-11', hours: 8 },
		]);
		expect(entries).toEqual([{ date: '2026-05-11', hours: 8 }]);
	});

	it('normalizes a time-suffixed date to its YYYY-MM-DD day', () => {
		expect(
			parseDailyEntries([{ date: '2026-05-04T18:30:00.000Z', hours: 4 }])
		).toEqual([{ date: '2026-05-04', hours: 4 }]);
	});
});

describe('sumLoggedHoursForMonth', () => {
	it('sums the requested month across several payloads', () => {
		const total = sumLoggedHoursForMonth(
			[
				'[{"date":"2026-05-04","hours":8},{"date":"2026-06-01","hours":8}]',
				[{ date: '2026-05-05', hours: 4.5 }],
			],
			MAY
		);
		expect(total).toBe(12.5);
	});

	it('never caps hours (ADR-0010)', () => {
		expect(
			sumLoggedHoursForMonth([[{ date: '2026-05-04', hours: 24 }]], MAY)
		).toBe(24);
		const heavyMonth = Array.from({ length: 15 }, (_, i) => ({
			date: `2026-05-${String(i + 1).padStart(2, '0')}`,
			hours: 20,
		}));
		expect(sumLoggedHoursForMonth([heavyMonth], MAY)).toBe(300);
	});

	it('returns 0 for empty, malformed, and out-of-month payloads', () => {
		expect(sumLoggedHoursForMonth([], MAY)).toBe(0);
		expect(sumLoggedHoursForMonth([null, '', 'not json'], MAY)).toBe(0);
		expect(
			sumLoggedHoursForMonth([[{ date: '2026-04-30', hours: 8 }]], MAY)
		).toBe(0);
	});

	it('rounds the total to 2 decimal places', () => {
		expect(
			sumLoggedHoursForMonth(
				[
					[
						{ date: '2026-05-04', hours: 0.1 },
						{ date: '2026-05-05', hours: 0.2 },
					],
				],
				MAY
			)
		).toBe(0.3);
		expect(
			sumLoggedHoursForMonth(
				[
					[
						{ date: '2026-05-04', hours: 1.005 },
						{ date: '2026-05-05', hours: 1.005 },
						{ date: '2026-05-06', hours: 1.005 },
					],
				],
				MAY
			)
		).toBe(3.01);
	});
});

describe('hoursByDateForMonth', () => {
	it('keys hours by date for the month only', () => {
		const byDate = hoursByDateForMonth(
			[
				'[{"date":"2026-05-04","hours":8},{"date":"2026-06-01","hours":9}]',
				[{ date: '2026-05-05', hours: 4.5 }],
			],
			MAY
		);
		expect(byDate).toEqual({ '2026-05-04': 8, '2026-05-05': 4.5 });
	});

	it('accumulates duplicate dates', () => {
		const byDate = hoursByDateForMonth(
			[
				[{ date: '2026-05-04', hours: 3 }],
				[
					{ date: '2026-05-04', hours: 5 },
					{ date: '2026-05-05', hours: 2 },
				],
			],
			MAY
		);
		expect(byDate).toEqual({ '2026-05-04': 8, '2026-05-05': 2 });
	});

	it('rounds each date total to 2 decimal places', () => {
		const byDate = hoursByDateForMonth(
			[
				[
					{ date: '2026-05-04', hours: 0.1 },
					{ date: '2026-05-04', hours: 0.2 },
				],
			],
			MAY
		);
		expect(byDate).toEqual({ '2026-05-04': 0.3 });
	});

	it('returns an empty object when nothing matches', () => {
		expect(hoursByDateForMonth([], MAY)).toEqual({});
		expect(hoursByDateForMonth(['not json'], MAY)).toEqual({});
		expect(
			hoursByDateForMonth([[{ date: '2026-04-30', hours: 8 }]], MAY)
		).toEqual({});
	});
});
