/**
 * Frozen pure-logic checks for the Attendance report cell renderer.
 *
 * Cell rendering is a data decision, not a calendar one: an authored
 * `employee_attendance.status` is one signal, measured effort (Logged Hours
 * and Punches) is another, and a non-working day only gets muted when neither
 * exists on it.
 */

import { describe, it, expect } from 'vitest';
import {
	ATTENDANCE_STATUS_BADGE,
	CELL_TONE_CLASSES,
	resolveStatusBadge,
	resolveAttendanceCell,
} from '@/app/reports/attendance-report/cell-status';
import { PAID_LEAVE_CODES, UNPAID_CODES } from '@/lib/attendance-summary';
import { isWeeklyOff } from '@/utils/weekly-off';

// August 2026: 02 is a Sunday, 08/22 the 2nd/4th Saturdays, 01/15/29 the
// working Saturdays, 05 a Wednesday.
const SUNDAY = '2026-08-02';
const OFF_SATURDAY_2ND = '2026-08-08';
const OFF_SATURDAY_4TH = '2026-08-22';
const WORKING_SATURDAY_1ST = '2026-08-01';
const WORKING_SATURDAY_3RD = '2026-08-15';
const WORKING_SATURDAY_5TH = '2026-08-29';
const WEDNESDAY = '2026-08-05';
const HOLIDAY = '2026-08-12';

describe('ATTENDANCE_STATUS_BADGE', () => {
	it('maps every status the codebase authors to a label and tone', () => {
		expect(ATTENDANCE_STATUS_BADGE).toMatchObject({
			P: { label: 'Present', tone: 'green' },
			HD: { label: 'Half Day', tone: 'amber' },
			A: { label: 'Absent', tone: 'red' },
			WO: { label: 'Weekly Off', tone: 'blue' },
			H: { label: 'Holiday', tone: 'slate' },
			PL: { label: 'Privilege Leave', tone: 'green' },
			CL: { label: 'Casual Leave', tone: 'green' },
			SL: { label: 'Sick Leave', tone: 'green' },
			EL: { label: 'Earned Leave', tone: 'green' },
			LWP: { label: 'Leave Without Pay', tone: 'orange' },
			UL: { label: 'Unpaid Leave', tone: 'orange' },
			OT: { label: 'Overtime Present', tone: 'amber' },
		});
	});

	it('covers exactly the 12 authored status codes', () => {
		expect(Object.keys(ATTENDANCE_STATUS_BADGE).sort()).toEqual(
			[
				'A',
				'CL',
				'EL',
				'H',
				'HD',
				'LWP',
				'OT',
				'P',
				'PL',
				'SL',
				'UL',
				'WO',
			].sort()
		);
	});

	it('covers every paid and unpaid leave code with a real label', () => {
		for (const code of [...PAID_LEAVE_CODES, ...UNPAID_CODES]) {
			const badge = ATTENDANCE_STATUS_BADGE[code];
			expect(badge, `missing badge for ${code}`).toBeTruthy();
			expect(badge.label).not.toBe('Leave');
			expect(CELL_TONE_CLASSES[badge.tone]).toBeTruthy();
		}
	});
});

describe('resolveStatusBadge', () => {
	it('normalises surrounding whitespace and case', () => {
		expect(resolveStatusBadge('  p ')).toEqual({
			code: 'P',
			label: 'Present',
			tone: 'green',
		});
		expect(resolveStatusBadge('a')).toEqual({
			code: 'A',
			label: 'Absent',
			tone: 'red',
		});
	});

	it('returns null when there is no authored status', () => {
		expect(resolveStatusBadge(null)).toBeNull();
		expect(resolveStatusBadge(undefined)).toBeNull();
		expect(resolveStatusBadge('')).toBeNull();
		expect(resolveStatusBadge('   ')).toBeNull();
	});

	it('does not invent a badge for an unknown status code', () => {
		expect(resolveStatusBadge('XX')).toBeNull();
		expect(resolveStatusBadge('PENDING')).toBeNull();
		expect(resolveStatusBadge('0')).toBeNull();
	});

	it('returns the same entry the map exposes', () => {
		expect(resolveStatusBadge('hd')).toEqual({
			code: 'HD',
			label: ATTENDANCE_STATUS_BADGE.HD.label,
			tone: ATTENDANCE_STATUS_BADGE.HD.tone,
		});
	});
});

describe('resolveAttendanceCell — authored status', () => {
	it('carries the authored status and the measured time present side by side', () => {
		const cell = resolveAttendanceCell({
			date: WEDNESDAY,
			status: 'HD',
			loggedHours: 4,
			punchCount: 2,
			timePresentHours: 3.5,
		});
		expect(cell.statusCode).toBe('HD');
		expect(cell.statusLabel).toBe('Half Day');
		expect(cell.statusTone).toBe('amber');
		expect(cell.timePresentHours).toBe(3.5);
		expect(cell.timePresentComputable).toBe(true);
	});

	it('does not let measured punches invent an authored status', () => {
		const cell = resolveAttendanceCell({
			date: WEDNESDAY,
			punchCount: 2,
			timePresentHours: 8,
		});
		expect(cell.statusCode).toBeNull();
		expect(cell.statusLabel).toBeNull();
		expect(cell.statusTone).toBeNull();
		expect(cell.hasPunches).toBe(true);
	});

	it('keeps an unknown authored code out of the badge while preserving it', () => {
		const cell = resolveAttendanceCell({ date: WEDNESDAY, status: 'ZZ' });
		expect(cell.statusCode).toBe('ZZ');
		expect(cell.statusLabel).toBeNull();
		expect(cell.statusTone).toBeNull();
	});

	it('does not let authored time present overwrite the uncomputable state', () => {
		const cell = resolveAttendanceCell({
			date: WEDNESDAY,
			status: 'P',
			timePresentHours: null,
		});
		expect(cell.statusLabel).toBe('Present');
		expect(cell.timePresentHours).toBeNull();
		expect(cell.timePresentComputable).toBe(false);
	});
});

describe('resolveAttendanceCell — non-working days', () => {
	it('mutes a weekly off with no logged hours and no punches', () => {
		const cell = resolveAttendanceCell({ date: SUNDAY });
		expect(cell.weeklyOff).toBe(true);
		expect(cell.nonWorking).toBe(true);
		expect(cell.muted).toBe(true);
	});

	it('mutes the 2nd and 4th Saturday weekly offs', () => {
		expect(resolveAttendanceCell({ date: OFF_SATURDAY_2ND }).muted).toBe(true);
		expect(resolveAttendanceCell({ date: OFF_SATURDAY_4TH }).muted).toBe(true);
	});

	it('never mutes a working Saturday (1st/3rd/5th)', () => {
		for (const date of [
			WORKING_SATURDAY_1ST,
			WORKING_SATURDAY_3RD,
			WORKING_SATURDAY_5TH,
		]) {
			expect(isWeeklyOff(date)).toBe(false);
			const cell = resolveAttendanceCell({ date });
			expect(cell.weeklyOff).toBe(false);
			expect(cell.nonWorking).toBe(false);
			expect(cell.muted).toBe(false);
		}
	});

	it('never mutes a plain working day', () => {
		const cell = resolveAttendanceCell({ date: WEDNESDAY });
		expect(cell.nonWorking).toBe(false);
		expect(cell.muted).toBe(false);
	});

	it('does not mute a weekly off carrying logged hours', () => {
		const cell = resolveAttendanceCell({
			date: SUNDAY,
			loggedHours: 6,
		});
		expect(cell.nonWorking).toBe(true);
		expect(cell.hasLoggedHours).toBe(true);
		expect(cell.muted).toBe(false);
		expect(cell.workedNonWorkingDay).toBe(true);
	});

	it('does not mute a weekly off carrying punches with uncomputable time present', () => {
		const cell = resolveAttendanceCell({
			date: SUNDAY,
			punchCount: 2,
			timePresentHours: null,
			mergeRefused: true,
		});
		expect(cell.hasPunches).toBe(true);
		expect(cell.timePresentComputable).toBe(false);
		expect(cell.muted).toBe(false);
	});

	it('mutes a weekly off whose only evidence is an uncomputable merge refusal', () => {
		const cell = resolveAttendanceCell({
			date: SUNDAY,
			timePresentHours: null,
			mergeRefused: true,
		});
		expect(cell.hasPunches).toBe(false);
		expect(cell.hasLoggedHours).toBe(false);
		expect(cell.muted).toBe(true);
	});

	it('mutes a weekly off whose logged hours are zero, negative, or unparsable', () => {
		expect(resolveAttendanceCell({ date: SUNDAY, loggedHours: 0 }).muted).toBe(
			true
		);
		expect(resolveAttendanceCell({ date: SUNDAY, loggedHours: -3 }).muted).toBe(
			true
		);
		expect(
			resolveAttendanceCell({ date: SUNDAY, loggedHours: 'abc' }).muted
		).toBe(true);
	});

	it('ignores a non-positive punch count', () => {
		const cell = resolveAttendanceCell({ date: SUNDAY, punchCount: 0 });
		expect(cell.hasPunches).toBe(false);
		expect(cell.muted).toBe(true);
	});
});

describe('resolveAttendanceCell — holidays', () => {
	it('mutes a holiday with nothing on it', () => {
		const cell = resolveAttendanceCell({
			date: HOLIDAY,
			nonOptionalHolidays: new Set([HOLIDAY]),
		});
		expect(cell.holiday).toBe(true);
		expect(cell.nonWorking).toBe(true);
		expect(cell.muted).toBe(true);
	});

	it('does not mute a holiday carrying logged hours or punches', () => {
		const hours = resolveAttendanceCell({
			date: HOLIDAY,
			loggedHours: 2,
			nonOptionalHolidays: [HOLIDAY],
		});
		expect(hours.muted).toBe(false);
		const punches = resolveAttendanceCell({
			date: HOLIDAY,
			punchCount: 3,
			nonOptionalHolidays: [HOLIDAY],
		});
		expect(punches.muted).toBe(false);
	});

	it('treats an optional holiday as a working day even when a caller passes it', () => {
		const cell = resolveAttendanceCell({
			date: HOLIDAY,
			nonOptionalHolidays: [HOLIDAY],
			optionalHolidays: [HOLIDAY],
		});
		expect(cell.holiday).toBe(false);
		expect(cell.nonWorking).toBe(false);
		expect(cell.muted).toBe(false);
	});

	it('flags a holiday that falls on a weekly off as both, still muting it', () => {
		const cell = resolveAttendanceCell({
			date: SUNDAY,
			nonOptionalHolidays: new Set([SUNDAY]),
		});
		expect(cell.holiday).toBe(true);
		expect(cell.weeklyOff).toBe(true);
		expect(cell.nonWorking).toBe(true);
		expect(cell.muted).toBe(true);
	});

	it('leaves other days alone when a holiday set is supplied', () => {
		const cell = resolveAttendanceCell({
			date: WEDNESDAY,
			nonOptionalHolidays: new Set([HOLIDAY]),
		});
		expect(cell.holiday).toBe(false);
		expect(cell.muted).toBe(false);
	});

	it('does not mutate the caller holiday sets', () => {
		const nonOptional = new Set([HOLIDAY]);
		const optional = new Set(['2026-08-13']);
		resolveAttendanceCell({
			date: SUNDAY,
			loggedHours: 1,
			nonOptionalHolidays: nonOptional,
			optionalHolidays: optional,
		});
		expect([...nonOptional]).toEqual([HOLIDAY]);
		expect([...optional]).toEqual(['2026-08-13']);
	});
});

describe('resolveAttendanceCell — input tolerance', () => {
	it('accepts numeric strings and treats a malformed date as a working day', () => {
		const cell = resolveAttendanceCell({
			date: 'not-a-date',
			loggedHours: '4.5',
			punchCount: '2',
		});
		expect(cell.weeklyOff).toBe(false);
		expect(cell.hasLoggedHours).toBe(true);
		expect(cell.hasPunches).toBe(true);
	});

	it('defaults every signal when the caller supplies only a date', () => {
		const cell = resolveAttendanceCell({ date: WEDNESDAY });
		expect(cell).toEqual({
			date: WEDNESDAY,
			statusCode: null,
			statusLabel: null,
			statusTone: null,
			loggedHours: 0,
			hasLoggedHours: false,
			punchCount: 0,
			hasPunches: false,
			timePresentHours: null,
			timePresentComputable: false,
			mergeRefused: false,
			weeklyOff: false,
			holiday: false,
			nonWorking: false,
			workedNonWorkingDay: false,
			muted: false,
		});
	});
});
