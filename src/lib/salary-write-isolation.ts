/**
 * Isolation protocol for every transaction that writes salary state.
 *
 * Salary writes deadlocked between *independent* Employees under REPEATABLE
 * READ: a `SELECT ... FOR UPDATE` whose search range has no matching row takes
 * a next-key (gap) lock, and gap locks are shared. Two `create-initial`
 * transactions for different fresh Employees both held an X lock on the same
 * supremum of `uq_employee_salary_profile_eligible_start`, then each requested
 * an X insert-intention lock in that supremum and blocked on the other's gap
 * lock — MariaDB reported ER_LOCK_DEADLOCK on `INSERT INTO
 * employee_salary_profile` (and the same shape on the
 * `employee_salary_payroll_use` unique key) even though the Employees never
 * shared a row.
 *
 * Salary write transactions therefore run at READ COMMITTED:
 *
 * - `FOR UPDATE` remains a current read (it always sees the latest committed
 *   rows), so the Employee mutex, expected-version conflicts and
 *   `run -> Employees ascending -> profile/use` ordering are unchanged.
 * - It takes exclusive *record* locks without gap locks, so transactions for
 *   different Employees no longer contend for the same index gap.
 *
 * The statement is `SET TRANSACTION`, not `SET SESSION`/`SET GLOBAL`: it applies
 * only to the next transaction on that connection and leaves a pooled
 * connection's default isolation untouched. It must run immediately before
 * `BEGIN`/`START TRANSACTION`.
 *
 * Every salary-writing transaction — salary commands, payroll generation,
 * payroll finalization and the salary-use backfill — must begin here (or pass
 * `SALARY_WRITE_ISOLATION` to the shared `withTransaction` helper).
 */
export const SALARY_WRITE_ISOLATION = 'READ COMMITTED';

/** The exact per-transaction statement, shared by every salary writer. */
export const SALARY_WRITE_ISOLATION_SQL = `SET TRANSACTION ISOLATION LEVEL ${SALARY_WRITE_ISOLATION}`;

/** The minimal caller-owned connection surface this protocol needs. */
export interface SalaryWriteTransactionDb {
	/** Text protocol: `SET TRANSACTION` is a utility statement, not a prepared one. */
	query(sql: string): Promise<unknown>;
	beginTransaction(): Promise<void>;
}

/**
 * Start one salary-write transaction on a caller-owned connection.
 *
 * The caller still owns commit/rollback and the connection lifecycle. This only
 * makes the isolation the salary store contracts rely on explicit and identical
 * in production, the use backfill and the real-database contention proof.
 */
export async function beginSalaryWriteTransaction(
	db: SalaryWriteTransactionDb
): Promise<void> {
	await db.query(SALARY_WRITE_ISOLATION_SQL);
	await db.beginTransaction();
}
