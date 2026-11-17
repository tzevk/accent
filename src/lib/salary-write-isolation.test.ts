import { describe, expect, it, vi } from 'vitest';
import {
	SALARY_WRITE_ISOLATION,
	SALARY_WRITE_ISOLATION_SQL,
	beginSalaryWriteTransaction,
	type SalaryWriteTransactionDb,
} from './salary-write-isolation';

/**
 * The real-database proof for the cross-Employee deadlock lives in
 * `e2e/specs/salary-contention.spec.ts`. These unit cases lock the protocol it
 * relies on: a per-transaction (never session/global) READ COMMITTED start, so
 * `FOR UPDATE` keeps its current-read and record-lock semantics without
 * REPEATABLE READ gap locks.
 */
describe('salary write transaction isolation', () => {
	it('sets READ COMMITTED for the next transaction before BEGIN', async () => {
		const calls: string[] = [];
		const db = {
			query: vi.fn(async (sql: string) => {
				calls.push(sql);
				return [undefined, undefined];
			}),
			beginTransaction: vi.fn(async () => {
				calls.push('BEGIN');
			}),
		};

		await beginSalaryWriteTransaction(db);

		expect(calls).toEqual([SALARY_WRITE_ISOLATION_SQL, 'BEGIN']);
		expect(SALARY_WRITE_ISOLATION_SQL).toBe(
			'SET TRANSACTION ISOLATION LEVEL READ COMMITTED'
		);
	});

	it('never changes the SESSION or GLOBAL isolation of a pooled connection', async () => {
		const db = {
			query: vi.fn<SalaryWriteTransactionDb['query']>(async () => [
				undefined,
				undefined,
			]),
			beginTransaction: vi.fn(async () => undefined),
		};

		await beginSalaryWriteTransaction(db);

		const sql = String(db.query.mock.calls[0]?.[0]);
		expect(sql).not.toMatch(/SESSION|GLOBAL/i);
		expect(sql).toContain(SALARY_WRITE_ISOLATION);
	});

	it('does not start the transaction when the isolation statement fails', async () => {
		const db = {
			query: vi.fn(async () => {
				throw new Error('isolation rejected');
			}),
			beginTransaction: vi.fn(async () => undefined),
		};

		await expect(beginSalaryWriteTransaction(db)).rejects.toThrow(
			'isolation rejected'
		);
		expect(db.beginTransaction).not.toHaveBeenCalled();
	});
});
