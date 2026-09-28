import { describe, it, expect, vi } from 'vitest';
import {
	applyApprovedLeave,
	computeDurationDays,
	deriveSandwichDatesInRange,
	parseSandwichAcknowledgedDays,
	revertApprovedLeave,
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
	it('converts bracketed 2nd-Saturday/Sunday extras in the same leave type', async () => {
		// May 2026: Fri 8, Sat 9 (2nd Saturday), Sun 10, Mon 11.
		// Sandwich re-derives Sat/Sun as extras deducted with the applied type.
		const { db, writes } = makeDb([]);
		const result = await applyApprovedLeave(
			db as never,
			application({ start_date: '2026-05-08', end_date: '2026-05-11' }),
			1
		);
		const writtenDates = writes.map((w) => w.params[1]);
		expect([...writtenDates].sort()).toEqual([
			'2026-05-08',
			'2026-05-09',
			'2026-05-10',
			'2026-05-11',
		]);
		expect(result.attendance.map((a) => a.date)).toEqual([
			'2026-05-08',
			'2026-05-09',
			'2026-05-10',
			'2026-05-11',
		]);
		expect(result.version).toBe(2);
		expect(result.sandwich.dates).toEqual(['2026-05-09', '2026-05-10']);
	});

	it('still skips single-sided Weekly Off adjacency (no bracketing leave)', async () => {
		// Fri 2026-05-08 to Sun 2026-05-10: Sat/Sun trail with no Monday
		// leave, so nothing brackets them.
		const { db, writes } = makeDb([]);
		const result = await applyApprovedLeave(
			db as never,
			application({ start_date: '2026-05-08', end_date: '2026-05-10' }),
			1
		);
		const writtenDates = writes.map((w) => w.params[1]);
		expect(writtenDates).toEqual(['2026-05-08']);
		expect(result.attendance.map((a) => a.date)).toEqual(['2026-05-08']);
		expect(result.sandwich.dates).toEqual([]);
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

	it('deducts billable days plus Sandwich extras in the approval ledger', async () => {
		// May 2026 Fri-to-Mon: 2 billable + 2 sandwich extras = 4 paid days
		// with sufficient balance (quota 12).
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
			{ leave_type_id: 1, year: 2026, days: 4 },
		]);
		expect(result.sandwich.dates).toEqual(['2026-05-09', '2026-05-10']);
		expect(result.version).toBe(2);
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

describe('sandwich derivation server-side (#235)', () => {
	it('derives the canonical Fri-to-Mon extras (Sat/Sun WO)', () => {
		expect(deriveSandwichDatesInRange('2026-05-08', '2026-05-11')).toEqual([
			'2026-05-09',
			'2026-05-10',
		]);
	});

	it('derives a Holiday wedge between two working days', () => {
		expect(
			deriveSandwichDatesInRange(
				'2026-08-25',
				'2026-08-27',
				false,
				new Set(['2026-08-26'])
			)
		).toEqual(['2026-08-26']);
	});

	it('ignores single-sided adjacency with leave on one side only', () => {
		expect(deriveSandwichDatesInRange('2026-05-08', '2026-05-10')).toEqual([]);
		expect(deriveSandwichDatesInRange('2026-05-10', '2026-05-11')).toEqual([]);
	});

	it('leaves half-day single-date flow untouched', () => {
		expect(
			deriveSandwichDatesInRange('2026-08-25', '2026-08-25', true)
		).toEqual([]);
	});

	it('coerces the acknowledged count with an alias and rejects malformed counts', () => {
		expect(parseSandwichAcknowledgedDays({})).toBe(0);
		expect(
			parseSandwichAcknowledgedDays({ sandwich_acknowledged_days: 2 })
		).toBe(2);
		expect(
			parseSandwichAcknowledgedDays({ acknowledged_sandwich_days: 1 })
		).toBe(1);
		expect(
			parseSandwichAcknowledgedDays({ sandwich_acknowledged_days: 'x' })
		).toBeNull();
		expect(
			parseSandwichAcknowledgedDays({ sandwich_acknowledged_days: -1 })
		).toBeNull();
	});
});

describe('sandwich overflow to unpaid leave (#235)', () => {
	function overflowDb() {
		const writes: Array<{ sql: string; params: unknown[] }> = [];
		const execute = vi.fn(async (sql: string, params?: unknown[]) => {
			if (String(sql).includes('FROM holiday_master')) return [[]];
			if (String(sql).includes('FROM employee_attendance')) return [[]];
			if (String(sql).includes('FROM employee_leaves')) {
				return [[{ total_leaves: 12, used_leaves: 11 }]];
			}
			if (
				String(sql).includes('FROM leave_types') &&
				String(sql).includes("'UL'")
			) {
				return [[{ id: 99, code: 'UL' }]];
			}
			if (String(sql).startsWith('INSERT INTO employee_attendance')) {
				writes.push({ sql, params: (params ?? []) as unknown[] });
				return [{ affectedRows: 1 }];
			}
			return [[{ affectedRows: 1 }]];
		});
		return { db: { execute }, writes, execute };
	}

	it('caps the paid ledger at the remaining balance and writes the tail as unpaid', async () => {
		// Fri-to-Mon totals 4 with 1 day remaining: 1 paid + 3 unpaid.
		const { db, writes } = overflowDb();
		const result = await applyApprovedLeave(
			db as never,
			application({
				start_date: '2026-05-08',
				end_date: '2026-05-11',
				requires_balance: 1,
				default_annual_quota: 12,
			}),
			1
		);
		expect(result.balances).toEqual([
			{ leave_type_id: 1, year: 2026, days: 1 },
		]);
		expect(result.sandwich.dates).toEqual(['2026-05-09', '2026-05-10']);
		expect(result.sandwich.overflowCode).toBe('UL');
		expect(result.sandwich.overflowDates).toHaveLength(3);
		const statusByDate = new Map(writes.map((w) => [w.params[1], w.params[2]]));
		expect(statusByDate.get('2026-05-08')).toBe('CL');
		expect(statusByDate.get('2026-05-09')).toBe('UL');
		expect(statusByDate.get('2026-05-10')).toBe('UL');
		expect(statusByDate.get('2026-05-11')).toBe('UL');
	});
});

describe('sandwich revert restores exactly (#235)', () => {
	it('restores converted WO/H statuses and capped balances', async () => {
		const executed: Array<{ sql: string; params: unknown[] }> = [];
		const db = {
			execute: vi.fn(async (sql: string, params?: unknown[]) => {
				executed.push({
					sql: String(sql),
					params: (params ?? []) as unknown[],
				});
				return [[]];
			}),
		};
		await revertApprovedLeave(
			db as never,
			{
				id: 7,
				employee_id: 3,
				written_attendance: JSON.stringify({
					version: 2,
					attendance: [
						{ date: '2026-05-08', prev_status: null },
						{ date: '2026-05-09', prev_status: 'WO' },
						{ date: '2026-05-10', prev_status: 'WO' },
						{ date: '2026-05-11', prev_status: null },
					],
					balances: [{ leave_type_id: 1, year: 2026, days: 1 }],
					sandwich: {
						dates: ['2026-05-09', '2026-05-10'],
						overflowDates: ['2026-05-09', '2026-05-10', '2026-05-11'],
						overflowLeaveTypeId: 99,
						overflowCode: 'UL',
					},
				}),
			} as never
		);
		const sqls = executed.map((e) => e.sql);
		expect(
			sqls.filter((s) => s.includes('DELETE FROM employee_attendance'))
		).toHaveLength(2);
		expect(
			sqls.filter((s) => s.includes('UPDATE employee_attendance'))
		).toHaveLength(2);
		const restore = executed.find((e) =>
			e.sql.includes('UPDATE employee_attendance')
		);
		expect(restore?.params[0]).toBe('WO');
		expect(
			sqls.filter((s) => s.includes('used_leaves = GREATEST'))
		).toHaveLength(1);
	});
});
