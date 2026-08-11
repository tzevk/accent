import { describe, it, expect } from 'vitest';
import { capProjectDays } from '@/lib/timesheet-cap';

function project(days: Record<string, number>) {
	const total_hours = Object.values(days).reduce((a, b) => a + b, 0);
	return { days, total_hours: Math.round(total_hours * 100) / 100 };
}

describe('capProjectDays', () => {
	it('passes hours through when daily totals are within the standard day', () => {
		const projects = [
			project({ '2026-04-01': 4, '2026-04-02': 6 }),
			project({ '2026-04-01': 4 }),
		];
		const capped = capProjectDays(projects);
		expect(capped).toEqual(projects);
		expect(capped[0].total_hours).toBe(10);
	});

	it('caps a single project day to 8 hours', () => {
		const projects = [project({ '2026-04-01': 10 })];
		const capped = capProjectDays(projects);
		expect(capped[0].days).toEqual({ '2026-04-01': 8 });
		expect(capped[0].total_hours).toBe(8);
	});

	it('distributes the daily cap proportionally across projects', () => {
		const projects = [
			project({ '2026-04-01': 6 }),
			project({ '2026-04-01': 7 }),
		];
		const capped = capProjectDays(projects);
		// 13h logged → 8h normal, split 6:7
		expect(capped[0].days).toEqual({ '2026-04-01': 3.69 });
		expect(capped[1].days).toEqual({ '2026-04-01': 4.31 });
		const dailySum =
			capped[0].days['2026-04-01'] + capped[1].days['2026-04-01'];
		expect(dailySum).toBe(8);
		expect(capped[0].total_hours).toBe(3.69);
		expect(capped[1].total_hours).toBe(4.31);
	});

	it('caps per day independently', () => {
		const projects = [project({ '2026-04-01': 10, '2026-04-02': 5 })];
		const capped = capProjectDays(projects);
		expect(capped[0].days).toEqual({ '2026-04-01': 8, '2026-04-02': 5 });
		expect(capped[0].total_hours).toBe(13);
	});

	it('respects a custom standard working day', () => {
		const projects = [project({ '2026-04-01': 10 })];
		const capped = capProjectDays(projects, 9);
		expect(capped[0].days).toEqual({ '2026-04-01': 9 });
	});

	it('falls back to 8 hours for a zero or missing standard day', () => {
		const projects = [project({ '2026-04-01': 10 })];
		expect(capProjectDays(projects, 0)[0].days).toEqual({
			'2026-04-01': 8,
		});
		expect(capProjectDays(projects, undefined)[0].days).toEqual({
			'2026-04-01': 8,
		});
	});

	it('is a no-op for empty input or zero-hour days', () => {
		expect(capProjectDays([])).toEqual([]);
		const projects = [project({ '2026-04-01': 0 })];
		expect(capProjectDays(projects)).toEqual(projects);
	});
});
