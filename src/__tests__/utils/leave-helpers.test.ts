import { describe, it, expect, vi } from 'vitest';
import {
	applyApprovedLeave,
	computeDurationDays,
	splitDaysByYear,
} from '@/utils/leave-helpers';

function makeDb(holidayRows: Array<Record<string, unknown>>) {
	const writes: Array<{ sql: string; params: unknown[] }> = [];
	const execute = vi.fn(async (sql: string, params?: unknown[]) => {
		if (String(sql).includes('FROM holiday_master')) {
			return [holidayRows];
		}
		if (String(sql).includes('FROM employee_attendance')) {
			return [[]];
		}
		if (String(sql).startsWith('INSERT INTO employee_attendance')) {
			writes.push({ sql, params: (params ?? []) as unknown[] });
			return [{ affectedRows: 1 }];
		}
		return [[{ affectedRows: 1 }]];
	});
	return { db: { execute }, writes, execute };
}

function application(overrides = {}) {
	return {
		id: 7,
		user_id: 2,
		employee_id: 3,
		leave_type_id: 1,
		start_date: '2026-08-25',
		end_date: '2026-08-26',
		half_day: 0,
		is_paid: 1,
		code: 'CL',
		requires_balance: 0,
		default_annual_quota: 12,
		...overrides,
	};
}

describe('applyApprovedLeave holiday set', () => {
	it('queries the active holiday set via the date column', async () => {
		const { db, execute } = makeDb([]);
		await applyApprovedLeave(db as never, application(), 1);
		const holidayCall = execute.mock.calls.find(([sql]) =>
			String(sql).includes('FROM holiday_master')
		);
		expect(holidayCall).toBeTruthy();
		const sql = String(holidayCall![0]);
		expect(sql).toContain('FROM holiday_master');
		expect(sql).not.toContain('holiday_date');
		expect(sql).toMatch(/is_active\s*=\s*1/);
	});

	it('excludes active holidays from attendance writes', async () => {
		const { db, writes } = makeDb([{ date: '2026-08-26' }]);
		const result = await applyApprovedLeave(db as never, application(), 1);
		const writtenDates = writes.map((w) => w.params[1]);
		expect(writtenDates).toEqual(['2026-08-25']);
		expect(result.attendance.map((a) => a.date)).toEqual(['2026-08-25']);
	});

	it('writes every working day when no active holiday falls in range', async () => {
		const { db, writes } = makeDb([]);
		const result = await applyApprovedLeave(db as never, application(), 1);
		expect(writes).toHaveLength(2);
		expect(result.attendance.map((a) => a.date)).toEqual([
			'2026-08-25',
			'2026-08-26',
		]);
	});
});

describe('applyApprovedLeave weekly offs', () => {
	it('skips 2nd/4th Saturdays like Sundays', async () => {
		// May 2026: Fri 8, Sat 9 (2nd Saturday), Sun 10, Mon 11.
		const { db, writes } = makeDb([]);
		const result = await applyApprovedLeave(
			db as never,
			application({ start_date: '2026-05-08', end_date: '2026-05-11' }),
			1
		);
		const writtenDates = writes.map((w) => w.params[1]);
		expect(writtenDates).toEqual(['2026-05-08', '2026-05-11']);
		expect(result.attendance.map((a) => a.date)).toEqual([
			'2026-05-08',
			'2026-05-11',
		]);
	});

	it('still writes 1st/3rd/5th Saturdays as working days', async () => {
		// May 2026: Fri 1, Sat 2 (1st Saturday), Sun 3.
		const { db, writes } = makeDb([]);
		const result = await applyApprovedLeave(
			db as never,
			application({ start_date: '2026-05-01', end_date: '2026-05-03' }),
			1
		);
		const writtenDates = writes.map((w) => w.params[1]);
		expect(writtenDates).toEqual(['2026-05-01', '2026-05-02']);
		expect(result.attendance.map((a) => a.date)).toEqual([
			'2026-05-01',
			'2026-05-02',
		]);
	});
});

describe('ledger fix: in-range off-days unbilled (#231)', () => {
	it('excludes in-range Weekly Off days from the billed duration (Fri-to-Mon charges 2)', () => {
		// May 2026: Fri 8, Sat 9 (2nd Saturday WO), Sun 10 (WO), Mon 11.
		expect(computeDurationDays('2026-05-08', '2026-05-11')).toBe(2);
	});

	it('excludes Holiday days in the set from the billed duration', () => {
		// Tue 2026-08-25 + Wed 2026-08-26 (holiday) bills 1.
		expect(
			computeDurationDays(
				'2026-08-25',
				'2026-08-26',
				false,
				new Set(['2026-08-26'])
			)
		).toBe(1);
	});

	it('leaves half-day single-date flow unchanged', () => {
		expect(computeDurationDays('2026-08-25', '2026-08-25', true)).toBe(0.5);
	});

	it('apportions billable days per year across a multi-year split', () => {
		// Wed 2026-12-30, Thu 31, Fri 2027-01-01, Sat 01-02 (1st Sat, working),
		// Sun 01-03 (WO), Mon 01-04 → 2026:2, 2027:3.
		expect(splitDaysByYear('2026-12-30', '2027-01-04')).toEqual([
			{ year: 2026, days: 2 },
			{ year: 2027, days: 3 },
		]);
	});

	it('deducts only billable days in the approval ledger (WO excluded)', async () => {
		const { db } = makeDb([]);
		const result = await applyApprovedLeave(
			db as never,
			application({
				start_date: '2026-05-08',
				end_date: '2026-05-11',
				requires_balance: 1,
			}),
			1
		);
		expect(result.balances).toEqual([
			{ leave_type_id: 1, year: 2026, days: 2 },
		]);
	});

	it('deducts only billable days in the approval ledger (Holiday excluded)', async () => {
		const { db } = makeDb([{ date: '2026-08-26' }]);
		const result = await applyApprovedLeave(
			db as never,
			application({ requires_balance: 1 }),
			1
		);
		expect(result.balances).toEqual([
			{ leave_type_id: 1, year: 2026, days: 1 },
		]);
	});
});
