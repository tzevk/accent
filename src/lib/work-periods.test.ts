import { describe, expect, it } from 'vitest';
import {
	formatIstLocal,
	isSelfServicePeriod,
	istDate,
	parseIstLocal,
	shiftIstDate,
	weekStartFor,
	workPeriodDailyEntries,
	workPeriodWeekSeconds,
} from '@/lib/work-periods';

describe('parseIstLocal', () => {
	it('parses exact IST wall-clock minutes into UTC epoch milliseconds', () => {
		expect(parseIstLocal('2026-06-01T00:00')).toBe(
			Date.UTC(2026, 4, 31, 18, 30)
		);
		expect(parseIstLocal('2026-06-01T22:00')).toBe(
			Date.UTC(2026, 5, 1, 16, 30)
		);
	});

	it('accepts valid leap days and rejects calendar overflow', () => {
		expect(parseIstLocal('2024-02-29T23:59')).toBe(
			Date.UTC(2024, 1, 29, 18, 29)
		);
		expect(parseIstLocal('2000-02-29T00:00')).not.toBeNull();
		expect(parseIstLocal('2023-02-29T00:00')).toBeNull();
		expect(parseIstLocal('1900-02-29T00:00')).toBeNull();
		expect(parseIstLocal('2026-04-31T09:00')).toBeNull();
		expect(parseIstLocal('2026-13-01T09:00')).toBeNull();
		expect(parseIstLocal('2026-06-00T09:00')).toBeNull();
	});

	it('rejects missing fields, non-minute precision, zones, and non-strings', () => {
		expect(parseIstLocal('2026-06-01T24:00')).toBeNull();
		expect(parseIstLocal('2026-06-01T09:60')).toBeNull();
		expect(parseIstLocal('2026-06-01T09:00:00')).toBeNull();
		expect(parseIstLocal('2026-06-01T09:00Z')).toBeNull();
		expect(parseIstLocal('2026-06-01T09:00+05:30')).toBeNull();
		expect(parseIstLocal('2026-6-01T09:00')).toBeNull();
		expect(parseIstLocal(' 2026-06-01T09:00')).toBeNull();
		expect(parseIstLocal('2026-06-01T09:00\n')).toBeNull();
		expect(parseIstLocal('2026-06-01T09:00\r\n')).toBeNull();
		expect(parseIstLocal('10000-06-01T09:00')).toBeNull();
		expect(parseIstLocal('')).toBeNull();
		expect(parseIstLocal(null)).toBeNull();
		expect(parseIstLocal(undefined)).toBeNull();
		expect(parseIstLocal(new Date('2026-06-01T03:30:00Z'))).toBeNull();
	});
});

describe('IST formatting', () => {
	it('formats epoch milliseconds as IST without using the host time zone', () => {
		expect(formatIstLocal(Date.UTC(2026, 4, 31, 18, 30))).toBe(
			'2026-06-01T00:00'
		);
		expect(formatIstLocal(Date.UTC(2026, 4, 31, 18, 29))).toBe(
			'2026-05-31T23:59'
		);
		expect(formatIstLocal(Date.UTC(2026, 5, 1, 16, 30))).toBe(
			'2026-06-01T22:00'
		);
	});

	it('derives the IST calendar date at the UTC date boundary', () => {
		expect(istDate(Date.UTC(2026, 4, 31, 18, 29))).toBe('2026-05-31');
		expect(istDate(Date.UTC(2026, 4, 31, 18, 30))).toBe('2026-06-01');
	});
});

describe('IST calendar helpers', () => {
	it('returns the Monday of the ISO week across Sundays, months, and years', () => {
		expect(weekStartFor('2026-06-01')).toBe('2026-06-01');
		expect(weekStartFor('2026-06-07')).toBe('2026-06-01');
		expect(weekStartFor('2026-06-08')).toBe('2026-06-08');
		expect(weekStartFor('2026-05-31')).toBe('2026-05-25');
		expect(weekStartFor('2027-01-01')).toBe('2026-12-28');
	});

	it('shifts calendar dates across leap days and month boundaries', () => {
		expect(shiftIstDate('2026-05-31', 1)).toBe('2026-06-01');
		expect(shiftIstDate('2026-06-01', -1)).toBe('2026-05-31');
		expect(shiftIstDate('2024-02-28', 1)).toBe('2024-02-29');
		expect(shiftIstDate('2024-02-29', 1)).toBe('2024-03-01');
		expect(shiftIstDate('2023-02-28', 1)).toBe('2023-03-01');
		expect(shiftIstDate('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('rejects invalid dates and non-integral day shifts', () => {
		expect(() => weekStartFor('2026-02-29')).toThrow(RangeError);
		expect(() => weekStartFor('2026-04-31')).toThrow(RangeError);
		expect(() => shiftIstDate('2026-13-01', 1)).toThrow(RangeError);
		expect(() => shiftIstDate('2026-06-01', 0.5)).toThrow(RangeError);
	});
});

describe('isSelfServicePeriod', () => {
	it('allows an overnight period on Tuesday but not on Wednesday', () => {
		const startMs = Date.UTC(2026, 5, 1, 16, 30);
		const endMs = Date.UTC(2026, 5, 1, 20, 30);

		expect(
			isSelfServicePeriod(startMs, endMs, Date.UTC(2026, 5, 2, 6, 30))
		).toBe(true);
		expect(
			isSelfServicePeriod(startMs, endMs, Date.UTC(2026, 5, 3, 6, 30))
		).toBe(false);
	});

	it('uses IST dates for Sunday-to-Monday and month-boundary work', () => {
		const startMs = Date.UTC(2026, 4, 31, 18, 0);
		const endMs = Date.UTC(2026, 4, 31, 19, 0);

		expect(isSelfServicePeriod(startMs, endMs, endMs)).toBe(true);
		expect(
			isSelfServicePeriod(startMs, endMs, Date.UTC(2026, 5, 2, 6, 30))
		).toBe(false);
	});

	it('allows two endpoints from yesterday and rejects older or future work', () => {
		const yesterdayStart = Date.UTC(2026, 5, 1, 3, 30);
		const yesterdayEnd = Date.UTC(2026, 5, 1, 4, 30);
		const nowMs = Date.UTC(2026, 5, 2, 6, 30);

		expect(isSelfServicePeriod(yesterdayStart, yesterdayEnd, nowMs)).toBe(true);
		expect(
			isSelfServicePeriod(Date.UTC(2026, 4, 31, 16, 30), yesterdayEnd, nowMs)
		).toBe(false);
		expect(
			isSelfServicePeriod(
				Date.UTC(2026, 5, 2, 3, 30),
				Date.UTC(2026, 5, 2, 4, 30),
				Date.UTC(2026, 5, 2, 4, 0)
			)
		).toBe(false);
	});

	it('rejects invalid or non-positive intervals', () => {
		const nowMs = Date.UTC(2026, 5, 2, 6, 30);

		expect(isSelfServicePeriod(NaN, nowMs, nowMs)).toBe(false);
		expect(isSelfServicePeriod(nowMs, nowMs, nowMs)).toBe(false);
		expect(isSelfServicePeriod(nowMs, nowMs - 60_000, nowMs)).toBe(false);
		expect(isSelfServicePeriod(nowMs - 60_000, nowMs, NaN)).toBe(false);
	});
});

describe('workPeriodWeekSeconds', () => {
	it('counts the full duration when an overnight period stays in one week', () => {
		expect(
			workPeriodWeekSeconds(
				Date.UTC(2026, 5, 1, 16, 30),
				Date.UTC(2026, 5, 1, 20, 30),
				'2026-06-01'
			)
		).toBe(14_400);
	});

	it('clips Sunday-to-Monday work into each Monday-based week', () => {
		const startMs = Date.UTC(2026, 5, 7, 17, 30);
		const endMs = Date.UTC(2026, 5, 7, 19, 30);

		expect(workPeriodWeekSeconds(startMs, endMs, '2026-06-01')).toBe(3_600);
		expect(workPeriodWeekSeconds(startMs, endMs, '2026-06-08')).toBe(3_600);
		expect(workPeriodWeekSeconds(startMs, endMs, '2026-05-25')).toBe(0);
	});

	it('gives back-to-back periods zero intersection at their shared boundary', () => {
		const boundaryMs = Date.UTC(2026, 5, 7, 18, 30);

		expect(
			workPeriodWeekSeconds(
				Date.UTC(2026, 5, 7, 16, 30),
				boundaryMs,
				'2026-06-01'
			)
		).toBe(7_200);
		expect(
			workPeriodWeekSeconds(
				Date.UTC(2026, 5, 7, 16, 30),
				boundaryMs,
				'2026-06-08'
			)
		).toBe(0);
		expect(
			workPeriodWeekSeconds(
				boundaryMs,
				Date.UTC(2026, 5, 7, 20, 30),
				'2026-06-01'
			)
		).toBe(0);
		expect(
			workPeriodWeekSeconds(
				boundaryMs,
				Date.UTC(2026, 5, 7, 20, 30),
				'2026-06-08'
			)
		).toBe(7_200);
	});

	it('returns zero for invalid intervals and rejects an invalid week', () => {
		expect(
			workPeriodWeekSeconds(
				Date.UTC(2026, 5, 1, 16, 30),
				Date.UTC(2026, 5, 1, 16, 30),
				'2026-06-01'
			)
		).toBe(0);
		expect(() =>
			workPeriodWeekSeconds(
				Date.UTC(2026, 5, 1, 16, 30),
				Date.UTC(2026, 5, 1, 20, 30),
				'2026-02-29'
			)
		).toThrow(RangeError);
	});
});

describe('workPeriodDailyEntries', () => {
	it('splits an overnight period at IST midnight and credits quantity once', () => {
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 5, 1, 16, 30),
				endMs: Date.UTC(2026, 5, 1, 20, 30),
				quantity: 12,
				dateCompleted: '2026-06-02',
				remarks: 'Installed valves',
			})
		).toEqual([
			{
				date: '2026-06-01',
				hours: 2,
				qty_done: 0,
				remarks: 'Installed valves',
			},
			{
				date: '2026-06-02',
				hours: 2,
				qty_done: 12,
				remarks: 'Installed valves',
			},
		]);
	});

	it('keeps minute precision and defaults empty quantity and remarks', () => {
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 5, 2, 3, 45),
				endMs: Date.UTC(2026, 5, 2, 3, 50),
				quantity: null,
				dateCompleted: null,
				remarks: null,
			})
		).toEqual([
			{ date: '2026-06-02', hours: 1 / 12, qty_done: 0, remarks: '' },
		]);
	});

	it('splits a Sunday-to-Monday month boundary and adds a separate quantity date', () => {
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 4, 31, 18, 0),
				endMs: Date.UTC(2026, 4, 31, 19, 0),
				quantity: 7.5,
				dateCompleted: '2026-06-03',
				remarks: 'Completed month-end batch',
			})
		).toEqual([
			{
				date: '2026-05-31',
				hours: 0.5,
				qty_done: 0,
				remarks: 'Completed month-end batch',
			},
			{
				date: '2026-06-01',
				hours: 0.5,
				qty_done: 0,
				remarks: 'Completed month-end batch',
			},
			{
				date: '2026-06-03',
				hours: 0,
				qty_done: 7.5,
				remarks: 'Completed month-end batch',
			},
		]);
	});

	it('credits an explicit completion date on the first worked day only', () => {
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 5, 1, 16, 30),
				endMs: Date.UTC(2026, 5, 1, 20, 30),
				quantity: 3,
				dateCompleted: '2026-06-01',
				remarks: '',
			})
		).toEqual([
			{ date: '2026-06-01', hours: 2, qty_done: 3, remarks: '' },
			{ date: '2026-06-02', hours: 2, qty_done: 0, remarks: '' },
		]);
	});

	it('does not add a date-only row for zero quantity or invalid intervals', () => {
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 4, 31, 18, 0),
				endMs: Date.UTC(2026, 4, 31, 19, 0),
				quantity: 0,
				dateCompleted: '2026-06-03',
				remarks: '',
			})
		).toEqual([
			{ date: '2026-05-31', hours: 0.5, qty_done: 0, remarks: '' },
			{ date: '2026-06-01', hours: 0.5, qty_done: 0, remarks: '' },
		]);
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 5, 1, 16, 30),
				endMs: Date.UTC(2026, 5, 1, 16, 30),
				quantity: 3,
				dateCompleted: '2026-06-03',
				remarks: '',
			})
		).toEqual([]);
	});

	it('adds a quantity-only row when Date Completed defaults to a midnight end', () => {
		expect(
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 5, 7, 16, 30),
				endMs: Date.UTC(2026, 5, 7, 18, 30),
				quantity: 4,
				dateCompleted: null,
				remarks: 'Week handoff',
			})
		).toEqual([
			{ date: '2026-06-07', hours: 2, qty_done: 0, remarks: 'Week handoff' },
			{ date: '2026-06-08', hours: 0, qty_done: 4, remarks: 'Week handoff' },
		]);
	});

	it('rejects an invalid Date Completed instead of emitting an invalid date row', () => {
		expect(() =>
			workPeriodDailyEntries({
				startMs: Date.UTC(2026, 5, 1, 16, 30),
				endMs: Date.UTC(2026, 5, 1, 20, 30),
				quantity: 3,
				dateCompleted: '2026-02-30',
				remarks: '',
			})
		).toThrow(RangeError);
	});
});
