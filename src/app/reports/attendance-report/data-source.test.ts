import { describe, it, expect } from 'vitest';
import {
	buildStats,
	cellEndpointsFromSpan,
} from '@/app/reports/attendance-report/data-source';
import type { DayPunchSpan, PunchLike } from '@/lib/time-present';

// Punch direction utilities live in @/lib/punch — covered by
// src/lib/punch.test.ts; the attendance webhook imports resolveDirection
// from there directly.

describe('buildStats', () => {
	const punchRow = (
		id: number,
		employee_code: string,
		date: string,
		serial_number: string,
		employee_id: number | null
	) => ({
		id,
		employee_code,
		log_date: `${date} 09:15:29`,
		date,
		time: '09:15:29',
		serial_number,
		raw_direction: '',
		direction: 'in' as const,
		employee_id,
		employee_name: employee_id ? 'Ada Lovelace' : null,
		acc_employee_code: employee_id ? 'EMP001' : null,
	});

	it('counts totals, mapping status, days, employees, and devices', () => {
		const stats = buildStats([
			punchRow(1, '102', '2026-08-12', '84E0F42938231501', 1),
			punchRow(2, '102', '2026-08-12', '84E0F42938231501', 1),
			punchRow(3, '114', '2026-08-13', '84E0F42938231501', null),
			punchRow(4, '114', '2026-08-13', 'AA00000000000002', null),
		]);
		expect(stats.total_punches).toBe(4);
		expect(stats.mapped_punches).toBe(2);
		expect(stats.unmapped_punches).toBe(2);
		expect(stats.distinct_days).toBe(2);
		expect(stats.distinct_employees).toBe(2);
		expect(stats.distinct_devices).toBe(2);
	});

	it('returns zeros for an empty punch list', () => {
		const stats = buildStats([]);
		expect(stats).toEqual({
			total_punches: 0,
			mapped_punches: 0,
			unmapped_punches: 0,
			distinct_days: 0,
			distinct_employees: 0,
			distinct_devices: 0,
		});
	});
});

// One walked day in the shape @/lib/time-present's span view returns it.
// What the walk decides is that own suite's subject; these cases cover only
// how a walked day becomes the cell's three endpoint fields.
function daySpan(over: Partial<DayPunchSpan>): DayPunchSpan {
	return {
		date: '2026-08-12',
		hours: 8,
		merged: false,
		mergeRefused: false,
		punchCount: 2,
		firstPunch: punch('2026-08-12 09:07:43'),
		lastPunch: punch('2026-08-12 17:22:05'),
		computable: true,
		...over,
	};
}

function punch(log_date: string): PunchLike {
	return { employee_code: '102', log_date };
}

describe('cellEndpointsFromSpan', () => {
	it("slices 'HH:MM' out of each endpoint's device timestamp", () => {
		expect(cellEndpointsFromSpan(daySpan({}))).toEqual({
			first_punch: '09:07',
			last_punch: '17:22',
			last_punch_next_day: false,
		});
	});

	it('keeps both clock edges exact at the ends of a day', () => {
		// The cut is a slice, not a parse, so midnight and the last minute
		// survive it whole.
		expect(
			cellEndpointsFromSpan(
				daySpan({
					firstPunch: punch('2026-08-12 00:00:12'),
					lastPunch: punch('2026-08-12 23:59:59'),
				})
			)
		).toEqual({
			first_punch: '00:00',
			last_punch: '23:59',
			last_punch_next_day: false,
		});
	});

	it('flags an Out that belongs to the next calendar day', () => {
		// #348's worked example: In 22:00 on the 12th, Out 00:30 on the 13th.
		// The walk reports this day with punchCount 1, so the punch count
		// cannot decide whether a second endpoint exists.
		expect(
			cellEndpointsFromSpan(
				daySpan({
					merged: true,
					punchCount: 1,
					firstPunch: punch('2026-08-12 22:00:11'),
					lastPunch: punch('2026-08-13 00:30:44'),
				})
			)
		).toEqual({
			first_punch: '22:00',
			last_punch: '00:30',
			last_punch_next_day: true,
		});
	});

	it('nulls the Out when the walk reports the day uncomputable', () => {
		// The module's own projection: `computable: false` drops the second
		// endpoint to null even when the day still held a Last Punch. Which day
		// shapes are uncomputable (a lone Punch, a refused merge) is the walk's
		// decision, covered in @/lib/time-present.test.ts; this maps that flag
		// to the null alone.
		expect(
			cellEndpointsFromSpan(daySpan({ computable: false, hours: null }))
		).toEqual({
			first_punch: '09:07',
			last_punch: null,
			last_punch_next_day: false,
		});
	});
});
