import { describe, it, expect } from 'vitest';
import {
	resolveDirection,
	applyInferredDirections,
	deriveDayTimes,
	deriveOvertime,
} from '@/lib/punch';

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
		// Input is newest-first (the report fetches); the 18:02 punch is
		// the day's second slot and must be 'out' despite appearing first.
		const rows = [
			punch('102', '2026-08-12 18:02:11'),
			punch('102', '2026-08-12 09:15:29'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['out', 'in']);
	});

	it('collapses double-taps without advancing the alternation', () => {
		// Seen live: retry taps 15s apart rendering as a phantom in/out pair.
		const rows = [
			punch('102', '2026-08-12 09:15:29'),
			punch('102', '2026-08-12 09:15:44'),
			punch('102', '2026-08-12 18:02:11'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'in', 'out']);
	});

	it('alternates punches outside the collapse window', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29'),
			punch('102', '2026-08-12 09:18:00'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'out']);
	});

	it('never collapses explicit device directions', () => {
		const rows = [
			punch('102', '2026-08-12 09:15:29', 'in'),
			punch('102', '2026-08-12 09:15:44'),
			punch('102', '2026-08-12 09:15:50', 'out'),
		];
		const result = applyInferredDirections(rows);
		expect(result.map((r) => r.direction)).toEqual(['in', 'in', 'out']);
	});
});

describe('deriveDayTimes', () => {
	const punch = (log_date: string, direction: string | null = null) => ({
		employee_code: '102',
		log_date,
		direction,
	});

	it('takes first in and last out of a normal day', () => {
		const [times] = [
			deriveDayTimes([
				punch('2026-08-12 09:15:29', 'in'),
				punch('2026-08-12 13:00:00', 'out'),
				punch('2026-08-12 13:45:00', 'in'),
				punch('2026-08-12 18:02:11', 'out'),
			]),
		];
		expect(times).toEqual({ in_time: '09:15', out_time: '18:02' });
	});

	it('leaves out_time blank when the day has only in punches', () => {
		// Forgot to check out: never invent a checkout time.
		const times = deriveDayTimes([
			punch('2026-08-12 09:15:29', 'in'),
			punch('2026-08-12 18:30:00', 'in'),
		]);
		expect(times).toEqual({ in_time: '09:15', out_time: null });
	});

	it('keeps a real out punch even when a later in arrives', () => {
		// Checked out, then punched in again (e.g. returned to the office):
		// last out is still the day's checkout.
		const times = deriveDayTimes([
			punch('2026-08-12 09:15:29', 'in'),
			punch('2026-08-12 18:02:11', 'out'),
			punch('2026-08-12 18:30:00', 'in'),
		]);
		expect(times).toEqual({ in_time: '09:15', out_time: '18:02' });
	});

	it('handles a lone out punch without an in', () => {
		const times = deriveDayTimes([punch('2026-08-12 18:02:11', 'out')]);
		expect(times).toEqual({ in_time: null, out_time: '18:02' });
	});

	it('derives from blank directions via inference', () => {
		// Face-scan day with no reported directions: inference inside
		// applyInferredDirections assigns in/out before derivation.
		const times = deriveDayTimes([
			punch('2026-08-12 09:15:29'),
			punch('2026-08-12 18:02:11'),
		]);
		expect(times).toEqual({ in_time: '09:15', out_time: '18:02' });
	});

	it('returns blank times for no punches', () => {
		expect(deriveDayTimes([])).toEqual({ in_time: null, out_time: null });
	});
});

describe('deriveOvertime', () => {
	it('derives hours past the 2h gate over an 8h day', () => {
		// 09:00 → 19:30 = 10.5h; excess 2.5h > 2h gate → payable.
		expect(deriveOvertime('09:00', '19:30')).toBe(2.5);
	});

	it('drops excess at or below the 2h gate', () => {
		// 09:00 → 19:00 = 10h; excess exactly 2h is not past the gate.
		expect(deriveOvertime('09:00', '19:00')).toBe(0);
		// 09:00 → 18:30 = 9.5h; excess 1.5h below the gate.
		expect(deriveOvertime('09:00', '18:30')).toBe(0);
	});

	it('returns 0 without both times', () => {
		expect(deriveOvertime(null, '19:30')).toBe(0);
		expect(deriveOvertime('09:00', null)).toBe(0);
		expect(deriveOvertime(null, null)).toBe(0);
	});

	it('returns 0 for a non-positive span', () => {
		expect(deriveOvertime('19:00', '09:00')).toBe(0);
		expect(deriveOvertime('09:00', '09:00')).toBe(0);
	});
});
