import { describe, it, expect } from 'vitest';
import {
	buildStats,
	monthLabel,
} from '@/app/reports/attendance-report/data-source';

// resolveDirection / applyInferredDirections now live in @/lib/punch —
// covered by src/__tests__/lib/punch.test.ts; data-source re-exports them.

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

describe('monthLabel', () => {
	it('formats YYYY-MM', () => {
		expect(monthLabel('2026-08')).toBe('August 2026');
		expect(monthLabel('2026-01')).toBe('January 2026');
	});

	it('passes through invalid input', () => {
		expect(monthLabel('bogus')).toBe('bogus');
		expect(monthLabel('2026-13')).toBe('2026-13');
	});
});
