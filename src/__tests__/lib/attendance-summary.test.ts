import { describe, it, expect } from 'vitest';
import { computeAttendanceSummary } from '@/lib/attendance-summary';

describe('computeAttendanceSummary', () => {
	it('counts Earned Leave as paid leave in payable days', () => {
		const summary = computeAttendanceSummary(
			{
				'2026-08-01': { status: 'P' },
				'2026-08-02': { status: 'EL' },
			},
			{}
		);
		expect(summary.EL).toBe(1);
		expect(summary.payable).toBe(2);
	});

	it('groups unpaid codes with Leave Without Pay', () => {
		const summary = computeAttendanceSummary(
			{
				'2026-08-01': { status: 'LWP' },
				'2026-08-02': { status: 'UL' },
			},
			{}
		);
		expect(summary.LWP).toBe(2);
		expect(summary.payable).toBe(0);
	});

	it('counts overtime rows as Present for working-hours totals', () => {
		const summary = computeAttendanceSummary(
			{
				'2026-08-01': { status: 'OT' },
				'2026-08-02': { status: 'P' },
			},
			{}
		);
		expect(summary.P).toBe(2);
		expect(summary.totalHours).toBe(16);
		expect(summary.payable).toBe(2);
	});

	it('credits in/out times for OT rows like Present days', () => {
		const summary = computeAttendanceSummary(
			{
				'2026-08-01': {
					status: 'OT',
					in_time: '09:00',
					out_time: '19:00',
				},
			},
			{}
		);
		expect(summary.totalHours).toBeCloseTo(10, 5);
	});

	it('excludes sub-gate overtime from payable OT hours and amounts', () => {
		const summary = computeAttendanceSummary(
			{
				'2026-08-01': { status: 'P', overtime_hours: 1.5 },
				'2026-08-02': { status: 'P', overtime_hours: 2 },
				'2026-08-03': { status: 'OT', overtime_hours: 3 },
			},
			{ basic_plus_da: 8000 }
		);
		expect(summary.totalOTHours).toBe(3);
		// (8000 / 8) * 3 = 3000 via money helpers, no float drift
		expect(summary.totalOTAmount).toBe(3000);
		// OT day still counts as present for hours even when gated
		expect(summary.totalHours).toBe(24);
	});

	it('keeps payable math auditable across mixed codes', () => {
		const summary = computeAttendanceSummary(
			{
				'2026-08-01': { status: 'P' },
				'2026-08-02': { status: 'HD' },
				'2026-08-03': { status: 'PL' },
				'2026-08-04': { status: 'CL' },
				'2026-08-05': { status: 'SL' },
				'2026-08-06': { status: 'EL' },
				'2026-08-07': { status: 'WO' },
				'2026-08-08': { status: 'H' },
				'2026-08-09': { status: 'A' },
				'2026-08-10': { status: 'LWP' },
				'2026-08-11': { status: 'UL' },
			},
			{}
		);
		// P(1) + HD(0.5) + PL + CL + SL + EL = 5.5
		expect(summary.payable).toBe(5.5);
		expect(summary.LWP).toBe(2);
	});
});
