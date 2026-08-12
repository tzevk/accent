import { describe, it, expect } from 'vitest';
import {
	resolveDirection,
	applyInferredDirections,
	buildStats,
	monthLabel,
} from '@/app/reports/attendance-report/data-source';

describe('resolveDirection', () => {
	it('normalizes case and whitespace', () => {
		expect(resolveDirection('in')).toBe('in');
		expect(resolveDirection('IN')).toBe('in');
		expect(resolveDirection(' In ')).toBe('in');
		expect(resolveDirection('out')).toBe('out');
		expect(resolveDirection('OUT')).toBe('out');
	});

	it('treats blank device values as unknown', () => {
		// Face-scan units routinely leave AttDirection blank (real samples
		// arrived as a single space).
		expect(resolveDirection(null)).toBe('unknown');
		expect(resolveDirection(undefined)).toBe('unknown');
		expect(resolveDirection('')).toBe('unknown');
		expect(resolveDirection(' ')).toBe('unknown');
	});

	it('falls back for unrecognized values', () => {
		expect(resolveDirection('xyz')).toBe('unknown');
		expect(resolveDirection('0')).toBe('unknown');
	});
});

describe('applyInferredDirections', () => {
	const punch = (
		employee_code: string,
		log_date: string,
		direction: string | null = null
	) => ({ employee_code, log_date, direction });

	it('alternates in/out for blank directions within one day', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29'),
			punch('102', '2026-08-12 18:02:11'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'out']);
	});

	it('cycles in/out/in for three punches in a day', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29'),
			punch('102', '2026-08-12 13:00:00'),
			punch('102', '2026-08-12 18:02:11'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'out', 'in']);
	});

	it('keeps device-provided directions as-is', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29', 'in'),
			punch('102', '2026-08-12 18:02:11', 'out'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'out']);
	});

	it('positions unknown punches by their slot among known ones', () => {
		// Device reported the first punch; the blank second punch is the
		// day's second slot, so it resolves to 'out'.
		const rows = [
			punch('102', '2026-08-12 09:15:29', 'in'),
			punch('102', '2026-08-12 18:02:11'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'out']);
	});

	it('resets the alternation per day', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29'),
			punch('102', '2026-08-13 09:20:00'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'in']);
	});

	it('tracks employees independently', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29'),
			punch('114', '2026-08-12 09:15:30'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'in']);
	});

	it('assigns parity chronologically while preserving input order', () => {
		// Input is newest-first (as the report fetches); the 18:02 punch is
		// the day's second slot and must be 'out' despite appearing first.
		const rows = [
			punch('102', '2026-08-12 18:02:11'),
			punch('102', '2026-08-12 09:15:29'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['out', 'in']);
	});
});

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
