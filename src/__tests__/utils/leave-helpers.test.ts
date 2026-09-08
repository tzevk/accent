import { describe, it, expect, vi } from 'vitest';
import { applyApprovedLeave } from '@/utils/leave-helpers';

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
