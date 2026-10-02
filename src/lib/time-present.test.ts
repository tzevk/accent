import { describe, it, expect } from 'vitest';
import {
	bucketPunchesByEmployeeDay,
	computeTimePresent,
	computeTimePresentForDays,
} from '@/lib/time-present';

/** The calculator reads only these two fields; anything else is ignored. */
const punch = (employee_code: string, log_date: string) => ({
	employee_code,
	log_date,
});

const DAY_1 = '2026-09-01';
const DAY_2 = '2026-09-02';
const DAY_3 = '2026-09-03';

describe('computeTimePresent — the odd-Punch defect this ticket exists to fix', () => {
	it('reads 09:02 / 12:10 / 18:41 as first to last, not 3.13', () => {
		// The old alternation inferred the last punch as an `in`, so the day
		// ended at the second punch: 09:02 → 12:10 = 3h08m = 3.13h.
		// First → last is 09:02 → 18:41 = 9h39m = 9.65h.
		const [day] = computeTimePresent([
			punch('102', `${DAY_1} 09:02:00`),
			punch('102', `${DAY_1} 12:10:00`),
			punch('102', `${DAY_1} 18:41:00`),
		]);
		expect(day).toEqual({
			date: DAY_1,
			hours: 9.65,
			merged: false,
			mergeRefused: false,
		});
		expect(day.hours).not.toBe(3.13);
	});

	it('lets five accidental punches change nothing', () => {
		const [day] = computeTimePresent([
			punch('102', `${DAY_1} 08:55:00`),
			punch('102', `${DAY_1} 10:30:00`),
			punch('102', `${DAY_1} 10:33:00`),
			punch('102', `${DAY_1} 13:05:00`),
			punch('102', `${DAY_1} 19:02:00`),
		]);
		const [twoPunch] = computeTimePresent([
			punch('102', `${DAY_1} 08:55:00`),
			punch('102', `${DAY_1} 19:02:00`),
		]);
		// 08:55 → 19:02 = 10h07m = 10.1166… → 10.12; middles are ignored.
		expect(day.hours).toBe(10.12);
		expect(day.hours).toBe(twoPunch.hours);
	});

	it('lets seven accidental punches change nothing', () => {
		const [day] = computeTimePresent([
			punch('102', `${DAY_1} 09:12:00`),
			punch('102', `${DAY_1} 11:00:00`),
			punch('102', `${DAY_1} 11:04:00`),
			punch('102', `${DAY_1} 15:20:00`),
			punch('102', `${DAY_1} 15:24:00`),
			punch('102', `${DAY_1} 16:40:00`),
			punch('102', `${DAY_1} 18:55:00`),
		]);
		const [twoPunch] = computeTimePresent([
			punch('102', `${DAY_1} 09:12:00`),
			punch('102', `${DAY_1} 18:55:00`),
		]);
		// 09:12 → 18:55 = 9h43m = 9.7166… → 9.72; middles are ignored.
		expect(day.hours).toBe(9.72);
		expect(day.hours).toBe(twoPunch.hours);
	});
});

describe('uncomputable days are null, never zero', () => {
	it('reports a lone Punch as uncomputable', () => {
		const [day] = computeTimePresent([punch('103', `${DAY_1} 09:20:00`)]);
		expect(day).toEqual({
			date: DAY_1,
			hours: null,
			merged: false,
			mergeRefused: false,
		});
		expect(day.hours).not.toBe(0);
	});

	it('reports nothing at all for an empty month', () => {
		expect(computeTimePresent([])).toEqual([]);
	});

	it('omits dates with no punches instead of inventing rows', () => {
		const days = computeTimePresent([
			punch('102', `${DAY_2} 10:00:00`),
			punch('102', `${DAY_2} 16:00:00`),
		]);
		expect(days.map((day) => day.date)).toEqual([DAY_2]);
	});
});

describe('cross-midnight merge', () => {
	it('counts a 22:00 → 06:30 night shift on the day it began', () => {
		const days = computeTimePresent([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_2} 06:30:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
		]);
	});

	it('consumes the merged punch so the next day is not counted twice', () => {
		const days = computeTimePresent([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_2} 06:30:00`),
			punch('104', `${DAY_2} 19:00:00`),
			punch('104', `${DAY_2} 23:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
			{ date: DAY_2, hours: 4, merged: false, mergeRefused: false },
		]);
		// Unconsumed, the second day would read 06:30 → 23:00 = 16.5h.
		expect(days[1].hours).not.toBe(16.5);
	});

	it('extends a night shift that already has a punch before midnight', () => {
		const days = computeTimePresent([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_1} 23:58:00`),
			punch('104', `${DAY_2} 06:30:00`),
		]);
		// 22:00 → 06:30 = 8.5h, not the day's own 22:00 → 23:58 span of 1.97h.
		expect(days).toEqual([
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
		]);
	});

	it('gives a night-shift worker both the shift and that evening', () => {
		const days = computeTimePresent([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_2} 06:30:00`),
			punch('104', `${DAY_2} 18:00:00`),
			punch('104', `${DAY_2} 23:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
			{ date: DAY_2, hours: 5, merged: false, mergeRefused: false },
		]);
		for (const day of days) expect(day.hours).toBeLessThanOrEqual(12);
	});

	it('carries the merge chain across consecutive night shifts', () => {
		const days = computeTimePresent([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_1} 23:58:00`),
			punch('104', `${DAY_2} 06:30:00`),
			punch('104', `${DAY_2} 22:00:00`),
			punch('104', `${DAY_2} 23:58:00`),
			punch('104', `${DAY_3} 06:30:00`),
		]);
		// Each morning tail is consumed by the previous evening, in order.
		expect(days).toEqual([
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
			{ date: DAY_2, hours: 8.5, merged: true, mergeRefused: false },
		]);
	});
});

describe('a refused merge invents nothing', () => {
	it('refuses 18:00 → 09:00 next morning (15h) and reads both days uncomputable', () => {
		const days = computeTimePresent([
			punch('105', `${DAY_1} 18:00:00`),
			punch('105', `${DAY_2} 09:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: null, merged: false, mergeRefused: true },
			{ date: DAY_2, hours: null, merged: false, mergeRefused: false },
		]);
		expect(days[0].hours).not.toBe(15);
		expect(days[0].hours).not.toBe(0);
	});

	it('leaves the next day its own punches after a refusal', () => {
		const days = computeTimePresent([
			punch('105', `${DAY_1} 18:00:00`),
			punch('105', `${DAY_2} 09:00:00`),
			punch('105', `${DAY_2} 17:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: null, merged: false, mergeRefused: true },
			{ date: DAY_2, hours: 8, merged: false, mergeRefused: false },
		]);
	});

	it('merges at exactly 12 hours from the first punch', () => {
		const days = computeTimePresent([
			punch('105', `${DAY_1} 22:00:00`),
			punch('105', `${DAY_2} 10:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 12, merged: true, mergeRefused: false },
		]);
	});

	it('refuses one second past 12 hours from the first punch', () => {
		const days = computeTimePresent([
			punch('105', `${DAY_1} 22:00:00`),
			punch('105', `${DAY_2} 10:00:01`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: null, merged: false, mergeRefused: true },
			{ date: DAY_2, hours: null, merged: false, mergeRefused: false },
		]);
	});

	it('keeps an ordinary day computable when the next morning is too far to merge', () => {
		// 09:00 → 18:30 and the next day's 09:00 is 24h from this day's first
		// punch: no merge happens, and the day keeps its own measured span.
		// Refusing it would blank every ordinary workday in the report.
		const days = computeTimePresent([
			punch('102', `${DAY_1} 09:00:00`),
			punch('102', `${DAY_1} 18:30:00`),
			punch('102', `${DAY_2} 09:00:00`),
			punch('102', `${DAY_2} 18:30:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 9.5, merged: false, mergeRefused: false },
			{ date: DAY_2, hours: 9.5, merged: false, mergeRefused: false },
		]);
	});
});

describe('elapsed time is absolute, never minutes-of-day', () => {
	it('refuses a candidate whose minutes-of-day would pass a fixed guard', () => {
		// 08:00 then 09:00 next morning is 25h of absolute elapsed time;
		// minutes-of-day would read 1h and merge a 25-hour presence.
		const days = computeTimePresent([
			punch('107', `${DAY_1} 08:00:00`),
			punch('107', `${DAY_2} 09:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: null, merged: false, mergeRefused: true },
			{ date: DAY_2, hours: null, merged: false, mergeRefused: false },
		]);
	});

	it('merges a tail that is earlier on the clock than the day it joins', () => {
		// 21:30 → 04:00 next morning is 6.5h of absolute elapsed time, even
		// though the tail looks earlier than the first punch on a clock face.
		const days = computeTimePresent([
			punch('107', `${DAY_1} 21:30:00`),
			punch('107', `${DAY_2} 04:00:00`),
			punch('107', `${DAY_2} 18:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 6.5, merged: true, mergeRefused: false },
			{ date: DAY_2, hours: null, merged: false, mergeRefused: false },
		]);
	});
});

describe('devices and redundant taps', () => {
	it('pools two devices into one span', () => {
		interface DevicePunch {
			employee_code: string;
			log_date: string;
			serial_number: string;
		}
		const rows: DevicePunch[] = [
			{
				employee_code: '106',
				log_date: `${DAY_1} 09:04:00`,
				serial_number: '84E0F4293A531501',
			},
			{
				employee_code: '106',
				log_date: `${DAY_1} 09:12:00`,
				serial_number: '84E0F4293C491501',
			},
			{
				employee_code: '106',
				log_date: `${DAY_1} 18:40:00`,
				serial_number: '84E0F4293A531501',
			},
		];
		expect(computeTimePresent(rows)).toEqual([
			{ date: DAY_1, hours: 9.6, merged: false, mergeRefused: false },
		]);
		expect(bucketPunchesByEmployeeDay(rows).get(`106|${DAY_1}`)).toHaveLength(
			3
		);
	});

	it('is unmoved by retry taps inside and outside the collapse window', () => {
		const [plain] = computeTimePresent([
			punch('102', `${DAY_1} 09:00:00`),
			punch('102', `${DAY_1} 18:30:00`),
		]);
		const [inside] = computeTimePresent([
			punch('102', `${DAY_1} 09:00:00`),
			punch('102', `${DAY_1} 09:00:40`),
			punch('102', `${DAY_1} 18:30:00`),
		]);
		const [outside] = computeTimePresent([
			punch('102', `${DAY_1} 09:00:00`),
			punch('102', `${DAY_1} 09:06:00`),
			punch('102', `${DAY_1} 18:30:00`),
		]);
		expect(plain.hours).toBe(9.5);
		expect(inside.hours).toBe(9.5);
		expect(outside.hours).toBe(9.5);
	});
});

describe('bucketing and independence', () => {
	it('buckets by employee and day with the shared key format, sorted', () => {
		const buckets = bucketPunchesByEmployeeDay([
			punch('114', `${DAY_2} 09:00:00`),
			punch('102', `${DAY_1} 18:41:00`),
			punch('102', `${DAY_1} 09:02:00`),
		]);
		expect([...buckets.keys()]).toEqual([`114|${DAY_2}`, `102|${DAY_1}`]);
		expect(buckets.get(`102|${DAY_1}`)?.map((row) => row.log_date)).toEqual([
			`${DAY_1} 09:02:00`,
			`${DAY_1} 18:41:00`,
		]);
	});

	it('sorts an unsorted input into employee-day order', () => {
		const rows = [
			punch('102', `${DAY_2} 18:00:00`),
			punch('102', `${DAY_1} 09:02:00`),
			punch('102', `${DAY_2} 09:00:00`),
			punch('102', `${DAY_1} 18:41:00`),
			punch('102', `${DAY_1} 12:10:00`),
		];
		expect(computeTimePresent(rows)).toEqual([
			{ date: DAY_1, hours: 9.65, merged: false, mergeRefused: false },
			{ date: DAY_2, hours: 9, merged: false, mergeRefused: false },
		]);
	});

	it("never lets one employee take another employee's punch", () => {
		const days = computeTimePresent([
			punch('201', `${DAY_1} 22:00:00`),
			punch('202', `${DAY_1} 22:30:00`),
			punch('202', `${DAY_1} 23:45:00`),
			punch('202', `${DAY_2} 07:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: null, merged: false, mergeRefused: false },
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
		]);
	});

	it('keeps employees independent in one call', () => {
		const days = computeTimePresent([
			punch('201', `${DAY_1} 22:00:00`),
			punch('201', `${DAY_2} 07:00:00`),
			punch('202', `${DAY_1} 09:00:00`),
			punch('202', `${DAY_1} 17:00:00`),
			punch('202', `${DAY_2} 09:00:00`),
			punch('202', `${DAY_2} 18:00:00`),
		]);
		expect(days).toEqual([
			{ date: DAY_1, hours: 9, merged: true, mergeRefused: false },
			{ date: DAY_1, hours: 8, merged: false, mergeRefused: false },
			{ date: DAY_2, hours: 9, merged: false, mergeRefused: false },
		]);
	});
});

describe('malformed timestamps', () => {
	it('never throws and reads its day as uncomputable', () => {
		const rows = [
			punch('999', `${DAY_1} 09:00:00`),
			punch('999', `${DAY_1} nope`),
		];
		expect(() => computeTimePresent(rows)).not.toThrow();
		expect(computeTimePresent(rows)).toEqual([
			{ date: DAY_1, hours: null, merged: false, mergeRefused: false },
		]);
	});

	it('sorts a malformed punch last inside its bucket', () => {
		const rows = [
			punch('999', `${DAY_1} nope`),
			punch('999', `${DAY_1} 09:00:00`),
		];
		expect(
			bucketPunchesByEmployeeDay(rows)
				.get(`999|${DAY_1}`)
				?.map((row) => row.log_date)
		).toEqual([`${DAY_1} 09:00:00`, `${DAY_1} nope`]);
	});
});

describe('purity', () => {
	it("does not mutate the caller's rows", () => {
		const rows = [
			punch('102', `${DAY_1} 18:41:00`),
			punch('102', `${DAY_1} 09:02:00`),
		];
		computeTimePresent(rows);
		expect(rows.map((row) => row.log_date)).toEqual([
			`${DAY_1} 18:41:00`,
			`${DAY_1} 09:02:00`,
		]);
	});

	it("does not consume punches out of a caller's buckets", () => {
		const buckets = bucketPunchesByEmployeeDay([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_2} 06:30:00`),
		]);
		computeTimePresentForDays(buckets);
		expect(buckets.get(`104|${DAY_2}`)).toHaveLength(1);
	});

	it('is repeatable for the same input', () => {
		const rows = [
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_2} 06:30:00`),
			punch('104', `${DAY_2} 18:00:00`),
		];
		expect(computeTimePresent(rows)).toEqual(computeTimePresent(rows));
	});
});

describe('computeTimePresentForDays', () => {
	it('consumes the merged punch from the following day', () => {
		const buckets = bucketPunchesByEmployeeDay([
			punch('104', `${DAY_1} 22:00:00`),
			punch('104', `${DAY_2} 06:30:00`),
			punch('104', `${DAY_2} 18:00:00`),
		]);
		expect(computeTimePresentForDays(buckets)).toEqual([
			{ date: DAY_1, hours: 8.5, merged: true, mergeRefused: false },
			{ date: DAY_2, hours: null, merged: false, mergeRefused: false },
		]);
	});

	it('reports nothing for an empty map', () => {
		expect(computeTimePresentForDays(new Map())).toEqual([]);
	});
});
