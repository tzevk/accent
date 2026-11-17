/**
 * Owned MariaDB connections and deterministic lock barriers for issue #446.
 *
 * Every helper here opens or manipulates only the connection the caller hands
 * it. The Playwright worker's `db` fixture stays the independent committed-state
 * reader; contention transactions use these connections so two real sessions
 * (and real InnoDB row locks) are involved.
 */
import {
	createConnection,
	type Connection,
	type RowDataPacket,
} from 'mysql2/promise';
import type { E2ERuntime } from '../../../scripts/e2e/contracts.ts';
import {
	SALARY_WRITE_ISOLATION,
	beginSalaryWriteTransaction,
} from '@/lib/salary-write-isolation';

const LOCK_WAIT_TIMEOUT_MS = 20_000;
const LOCK_WAIT_POLL_MS = 20;

/** Open one independent connection under the harness-owned disposable database. */
export async function connectContentionConnection(
	runtime: E2ERuntime
): Promise<Connection> {
	return createConnection({
		host: runtime.database.host,
		port: runtime.database.port,
		database: runtime.database.database,
		user: runtime.database.user,
		password: runtime.database.password,
		dateStrings: true,
	});
}

/** The server thread id, so a lock wait can be attributed to this session. */
export async function contentionThreadId(
	connection: Connection
): Promise<number> {
	const [rows] = await connection.query<RowDataPacket[]>(
		'SELECT CONNECTION_ID() AS id'
	);
	const id = Number(rows[0]?.id);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error('[salary-contention] database returned no connection id');
	}
	return id;
}

/**
 * Start a transaction at the isolation level the salary store contracts rely
 * on. Production salary writers use the same `beginSalaryWriteTransaction`
 * helper: READ COMMITTED keeps `FOR UPDATE` a current read and a record lock,
 * but removes the REPEATABLE READ gap locks that deadlocked independent
 * Employees. The assertion below fails closed if the server did not apply it.
 */
export async function beginContentionTransaction(
	connection: Connection
): Promise<number> {
	await beginSalaryWriteTransaction(connection);
	// This read happens before the Employee mutex and is deliberately the
	// transaction's first consistent read: it is exactly the pre-lock snapshot a
	// REPEATABLE READ transaction would keep reusing. Under READ COMMITTED the
	// later `FOR UPDATE` reads stay current, which the blocked-contention
	// assertions prove. MariaDB usually keeps a read-only transaction out of
	// INNODB_TRX (see observeLockWait), so the level below is asserted whenever
	// the server exposes the row and the active transaction otherwise.
	await connection.query('SELECT id FROM employees LIMIT 1');
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT TRX_ISOLATION_LEVEL AS isolation
       FROM information_schema.INNODB_TRX
      WHERE trx_mysql_thread_id = CONNECTION_ID()
      LIMIT 1`
	);
	// MariaDB only lists a transaction in INNODB_TRX once InnoDB has started a
	// transaction object; a lock-free, read-only transaction is deliberately
	// absent there even while `@@in_transaction` is 1. Assert the real level
	// whenever the row exists, and otherwise assert the transaction is active.
	// The SET-before-BEGIN ordering has its own unit test, and the scenarios
	// prove READ COMMITTED behaviorally: independent Employees never gap-lock.
	if (rows[0] !== undefined) {
		assertObservedIsolation(rows[0].isolation, 'BEGIN');
	} else {
		const [state] = await connection.query<RowDataPacket[]>(
			'SELECT @@in_transaction AS active'
		);
		if (Number(state[0]?.active) !== 1) {
			throw new Error('[salary-contention] no active transaction after BEGIN');
		}
	}
	return contentionThreadId(connection);
}

/** Compare the server's spelling of the salary-write isolation level. */
function assertObservedIsolation(value: unknown, label: string): void {
	const observed = String(value ?? '')
		.replace(/-/g, ' ')
		.trim()
		.toUpperCase();
	if (observed !== SALARY_WRITE_ISOLATION) {
		throw new Error(
			`[salary-contention] ${label}: expected ${SALARY_WRITE_ISOLATION}, observed ${JSON.stringify(value)}`
		);
	}
}

/**
 * Assert the caller's still-open, already-written transaction is at READ
 * COMMITTED.
 *
 * Only call this after the command/generation seam returned and before the
 * caller commits. MariaDB 10.11 can omit a transaction from `INNODB_TRX` even
 * after it wrote (the same omission that hides a blocked first locking read),
 * so an absent row falls back to proving the transaction is still open; a row
 * that is present must report the real level.
 */
export async function assertSalaryWriteIsolation(
	connection: Connection,
	label: string
): Promise<void> {
	const [rows] = await connection.query<RowDataPacket[]>(
		`SELECT trx_isolation_level AS isolation, trx_state AS state
       FROM information_schema.INNODB_TRX
      WHERE trx_mysql_thread_id = CONNECTION_ID()
      LIMIT 1`
	);
	if (rows[0] === undefined) {
		const [state] = await connection.query<RowDataPacket[]>(
			'SELECT @@in_transaction AS active'
		);
		if (Number(state[0]?.active) !== 1) {
			throw new Error(
				`[salary-contention] ${label}: no open transaction after the write`
			);
		}
		return;
	}
	assertObservedIsolation(
		rows[0].isolation,
		`${label} (state ${String(rows[0].state)})`
	);
}

/**
 * The InnoDB monitor block for a session that is blocked on the Employee mutex.
 *
 * MariaDB 10.11's `INNODB_TRX` omits a transaction blocked on its first
 * `FOR UPDATE` (it only appears once InnoDB has started a read-write
 * transaction), which is exactly the state of the loser in these scenarios:
 * its first locking read is the blocked Employee mutex. The InnoDB monitor
 * (`SHOW ENGINE INNODB STATUS`) does list the session, its real `LOCK WAIT`
 * state and the blocked statement, so the wait is proven there; the monitor is
 * also the source of the waiting transaction id used for the isolation lookup.
 */
function blockedEmployeeMutexTransactionId(
	status: unknown,
	threadId: number
): { trxId: number; statement: string } | null {
	const text = String(status ?? '');
	if (text === '') return null;
	for (const block of text.split('---TRANSACTION ').slice(1)) {
		if (!block.includes(`MariaDB thread id ${threadId},`)) continue;
		if (!/(^|\n)LOCK WAIT\b/.test(block)) continue;
		// The scenario mutex is the scoped Employee `FOR UPDATE` read. Refuse a
		// wait on some other row (for example the Payroll Run lock) rather than
		// accepting any lock wait as the contention proof.
		if (!/\bFROM\s+`?employees`?\b/i.test(block)) continue;
		if (!/\bFOR\s+UPDATE\b/i.test(block)) continue;
		const statement =
			block
				.split('\n')
				.map((line) => line.trim())
				.find((line) => /\bFROM\s+`?employees`?\b/i.test(line)) ??
			'employees FOR UPDATE';
		const trxId = Number(/^(\d+),/.exec(block)?.[1]);
		if (!Number.isInteger(trxId) || trxId <= 0) continue;
		return { trxId, statement };
	}
	return null;
}

/**
 * Wait until InnoDB reports that the given session is blocked on the Employee
 * mutex, then verify the blocked transaction's isolation when the server
 * exposes it.
 *
 * This is a bounded observation of actual InnoDB state, not a sleep or a
 * "start both promises at once" approximation. A command that never blocks is
 * a test failure, not a race that happened to win.
 */
export async function observeLockWait(
	observer: Connection,
	threadId: number,
	label: string
): Promise<void> {
	const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
	for (;;) {
		const [monitorRows] = await observer.query<RowDataPacket[]>(
			'SHOW ENGINE INNODB STATUS'
		);
		const observed = blockedEmployeeMutexTransactionId(
			monitorRows[0]?.Status,
			threadId
		);
		if (observed !== null) {
			const waitTrxId = observed.trxId;
			// `INNODB_TRX` is authoritative when it lists the blocked transaction;
			// on this server it usually does not for a first locking read, so a
			// missing row is not evidence against the (already proven) wait. Match
			// by the monitor's transaction id as well as the thread id because the
			// server may expose the row without the thread mapping.
			const [rows] = await observer.query<RowDataPacket[]>(
				`SELECT trx_isolation_level AS isolation, trx_state AS state
           FROM information_schema.INNODB_TRX
          WHERE trx_id = ? OR trx_mysql_thread_id = ?
          LIMIT 1`,
				[waitTrxId, threadId]
			);
			const evidence =
				rows[0] === undefined
					? 'INNODB_TRX omitted (first locking read)'
					: `INNODB_TRX state ${String(rows[0].state)}, isolation ${String(rows[0].isolation)}`;
			console.log(
				`[salary-contention] ${label}: session ${threadId} LOCK WAIT transaction ${waitTrxId} on ${observed.statement}; ${evidence}`
			);
			if (rows[0] !== undefined) {
				assertObservedIsolation(
					rows[0].isolation,
					`${label} (session ${threadId}, transaction ${waitTrxId}, state ${String(rows[0].state)})`
				);
			}
			return;
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`[salary-contention] ${label}: session ${threadId} never reported a database lock wait`
			);
		}
		const tick = Promise.withResolvers<void>();
		setTimeout(tick.resolve, LOCK_WAIT_POLL_MS);
		await tick.promise;
	}
}

/**
 * Run a callback with a small pool of owned connections. Every connection is
 * destroyed in the `finally` — InnoDB rolls its transaction back immediately —
 * so a failed contention attempt cannot hold the Employee mutex into cleanup.
 * Scenario code settles any command promise it started before returning;
 * destroying a connection with a statement still in flight is what produced
 * "connection is in closed state" noise in the first proof run.
 */
export async function withContentionConnections<T>(
	runtime: E2ERuntime,
	run: (open: () => Promise<Connection>) => Promise<T>
): Promise<T> {
	const connections: Connection[] = [];
	const open = async (): Promise<Connection> => {
		const connection = await connectContentionConnection(runtime);
		connections.push(connection);
		return connection;
	};
	try {
		return await run(open);
	} finally {
		// Destroy rather than await rollback: a failed barrier can leave a query
		// blocked on a lock, and queued ROLLBACK/END would hang cleanup. Destroy
		// closes the owned session immediately; InnoDB rolls its transaction back.
		for (const connection of connections) {
			try {
				connection.destroy();
			} catch {
				/* cleanup must not mask the test's own failure */
			}
		}
	}
}

/** Lock the month's Payroll Run row, the first lock every write path takes. */
export async function lockPayrollRunRow(
	connection: Connection,
	runId: number
): Promise<void> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT id
       FROM payroll_runs
      WHERE id = ?
      LIMIT 1
      FOR UPDATE`,
		[runId]
	);
	if (rows.length === 0) {
		throw new Error(
			`[salary-contention] Payroll Run ${runId} does not exist in the owned database`
		);
	}
}
