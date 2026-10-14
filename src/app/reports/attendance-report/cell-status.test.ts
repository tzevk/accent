import { describe, it, expect } from 'vitest';
import { resolveAttendanceCell, type AttendanceCellInput } from './cell-status';

/** A Tuesday, so a working day with no holiday overrides. */
const WORKING_DAY = '2026-09-01';
/** A Sunday: a Weekly Off (ADR-0004). */
const WEEKLY_OFF_DAY = '2026-09-06';

/** One cell's input; each test overrides only what it asserts. */
const day = (over: Partial<AttendanceCellInput> = {}): AttendanceCellInput => ({
	date: WORKING_DAY,
	...over,
});

describe('resolveAttendanceCell: the In and Out labels', () => {
	it('shows the first and the last Punch on a day of two or more Punches', () => {
		const cell = resolveAttendanceCell(
			day({
				punchCount: 3,
				firstPunch: '09:00',
				lastPunch: '17:30',
				lastPunchNextDay: false,
			})
		);
		expect(cell.inLabel).toBe('09:00');
		expect(cell.outLabel).toBe('17:30');
		expect(cell.outIsNextDay).toBe(false);
		expect(cell.outIsSecondEndpoint).toBe(true);
	});

	it('shows the next day clock as the Out when a night shift merged', () => {
		const cell = resolveAttendanceCell(
			day({
				punchCount: 1,
				firstPunch: '22:00',
				lastPunch: '00:30',
				lastPunchNextDay: true,
			})
		);
		expect(cell.inLabel).toBe('22:00');
		expect(cell.outLabel).toBe('00:30');
		expect(cell.outIsNextDay).toBe(true);
		expect(cell.outIsSecondEndpoint).toBe(true);
	});

	it('shows one Punch as the In and the em dash as the Out', () => {
		const cell = resolveAttendanceCell(
			day({ punchCount: 1, firstPunch: '09:00', lastPunch: null })
		);
		expect(cell.inLabel).toBe('09:00');
		expect(cell.outLabel).toBe('—');
		expect(cell.outIsSecondEndpoint).toBe(false);
	});

	it('shows no times on a day whose only Punch became the previous tail', () => {
		const cell = resolveAttendanceCell(
			day({ punchCount: 1, firstPunch: null, lastPunch: null })
		);
		expect(cell.inLabel).toBe('');
		expect(cell.outLabel).toBe('');
		expect(cell.outIsNextDay).toBe(false);
		expect(cell.outIsSecondEndpoint).toBe(false);
	});

	it('shows one Punch and no Out on a day whose merge was refused', () => {
		const cell = resolveAttendanceCell(
			day({ punchCount: 1, firstPunch: '23:00', lastPunch: null })
		);
		expect(cell.inLabel).toBe('23:00');
		expect(cell.outLabel).toBe('—');
		expect(cell.outIsNextDay).toBe(false);
	});

	it('shows one Punch and no Out when a merge took the earlier tail', () => {
		// The previous day consumed this day's first Punch, so one row of this
		// day's two survives. It is still not a span.
		const cell = resolveAttendanceCell(
			day({ punchCount: 2, firstPunch: '09:00', lastPunch: null })
		);
		expect(cell.inLabel).toBe('09:00');
		expect(cell.outLabel).toBe('—');
	});

	it('shows no times on a muted Weekly Off with no Punches', () => {
		const cell = resolveAttendanceCell(
			day({ date: WEEKLY_OFF_DAY, punchCount: 0 })
		);
		expect(cell.muted).toBe(true);
		expect(cell.inLabel).toBe('');
		expect(cell.outLabel).toBe('');
	});

	it('shows no times on a muted holiday with no Punches', () => {
		const cell = resolveAttendanceCell(
			day({ nonOptionalHolidays: [WORKING_DAY], punchCount: 0 })
		);
		expect(cell.holiday).toBe(true);
		expect(cell.muted).toBe(true);
		expect(cell.inLabel).toBe('');
		expect(cell.outLabel).toBe('');
	});

	it('shows both times on a non-working day that carries real effort', () => {
		const cell = resolveAttendanceCell(
			day({
				date: WEEKLY_OFF_DAY,
				loggedHours: 8,
				punchCount: 2,
				firstPunch: '10:00',
				lastPunch: '16:00',
			})
		);
		expect(cell.workedNonWorkingDay).toBe(true);
		expect(cell.muted).toBe(false);
		expect(cell.inLabel).toBe('10:00');
		expect(cell.outLabel).toBe('16:00');
	});

	it('shows no times on a working day with no Punches at all', () => {
		const cell = resolveAttendanceCell(day({ punchCount: 0 }));
		expect(cell.muted).toBe(false);
		expect(cell.inLabel).toBe('');
		expect(cell.outLabel).toBe('');
	});
});
