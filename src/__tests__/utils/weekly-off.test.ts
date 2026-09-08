import { describe, it, expect } from 'vitest';
import { isWeeklyOff } from '@/utils/weekly-off';

describe('isWeeklyOff', () => {
	it('marks every Sunday as a weekly off', () => {
		expect(isWeeklyOff('2026-05-03')).toBe(true);
		expect(isWeeklyOff('2026-05-31')).toBe(true);
	});

	it('marks only the 2nd and 4th Saturdays as weekly offs', () => {
		// May 2026: Saturdays 2, 9, 16, 23, 30.
		expect(isWeeklyOff('2026-05-02')).toBe(false); // 1st
		expect(isWeeklyOff('2026-05-09')).toBe(true); // 2nd
		expect(isWeeklyOff('2026-05-16')).toBe(false); // 3rd
		expect(isWeeklyOff('2026-05-23')).toBe(true); // 4th
		expect(isWeeklyOff('2026-05-30')).toBe(false); // 5th
		// August 2026 starts on a Saturday.
		expect(isWeeklyOff('2026-08-01')).toBe(false);
		expect(isWeeklyOff('2026-08-08')).toBe(true);
		expect(isWeeklyOff('2026-08-22')).toBe(true);
		expect(isWeeklyOff('2026-08-29')).toBe(false);
	});

	it('returns false for weekdays and junk', () => {
		expect(isWeeklyOff('2026-05-04')).toBe(false); // Mon
		expect(isWeeklyOff('bogus')).toBe(false);
		expect(isWeeklyOff('2026-02-31')).toBe(false); // non-existent date
	});
});
