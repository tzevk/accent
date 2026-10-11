import { describe, it, expect } from 'vitest';
import {
	EXPECTED_WORK_MINS,
	FIXED_IN_TIME,
	FIXED_OUT_TIME,
	LATE_GRACE_TIME,
	isLateLogin,
	isOvertime,
} from '@/lib/shift-times';

/**
 * The shift window and the two remarks its tiles carry.
 *
 * The grace band is 09:00–09:30 and it is the Late remark's threshold only:
 * duty start stays 09:00, so expected work does not move with it.
 */
describe('the fixed shift', () => {
	it('opens at 9:00, ends at 5:30 PM and expects 480 minutes', () => {
		expect(FIXED_IN_TIME).toBe('09:00');
		expect(FIXED_OUT_TIME).toBe('17:30');
		// (17:30 - 09:00) - a 30-minute lunch = 8h
		expect(EXPECTED_WORK_MINS).toBe(480);
	});
});

describe('isLateLogin — arrival after the 9:00–9:30 grace band', () => {
	it('is on time for the whole grace band', () => {
		expect(isLateLogin('08:45')).toBe(false);
		expect(isLateLogin('09:00')).toBe(false);
		expect(isLateLogin('09:15')).toBe(false);
		expect(isLateLogin('09:29')).toBe(false);
	});

	it('treats the grace threshold itself as on time and 9:31 as late', () => {
		expect(LATE_GRACE_TIME).toBe('09:30');
		expect(isLateLogin('09:30')).toBe(false);
		expect(isLateLogin('09:31')).toBe(true);
	});

	it('is late for any arrival past the band', () => {
		expect(isLateLogin('09:45')).toBe(true);
		expect(isLateLogin('11:20')).toBe(true);
	});

	it('does not mark an arrival before duty start as late', () => {
		expect(isLateLogin('07:30')).toBe(false);
	});

	it('is never late for a missing, empty or unparseable time', () => {
		expect(isLateLogin('')).toBe(false);
		expect(isLateLogin(null)).toBe(false);
		expect(isLateLogin(undefined)).toBe(false);
		expect(isLateLogin('not-a-time')).toBe(false);
	});
});

describe('isOvertime — a time outside the fixed shift window', () => {
	it('reads on time for the whole window, both bounds inclusive', () => {
		expect(isOvertime('09:00')).toBe(false);
		expect(isOvertime('12:00')).toBe(false);
		expect(isOvertime('17:30')).toBe(false);
	});

	it('flags an early time and a time past duty end', () => {
		expect(isOvertime('08:45')).toBe(true);
		expect(isOvertime('17:31')).toBe(true);
		expect(isOvertime('21:00')).toBe(true);
	});

	it('is never overtime for a missing, empty or unparseable time', () => {
		expect(isOvertime('')).toBe(false);
		expect(isOvertime(null)).toBe(false);
		expect(isOvertime(undefined)).toBe(false);
		expect(isOvertime('not-a-time')).toBe(false);
	});

	it('does not spy on the grace band: a 9:15 arrival is neither late nor overtime', () => {
		expect(isLateLogin('09:15')).toBe(false);
		expect(isOvertime('09:15')).toBe(false);
	});
});
