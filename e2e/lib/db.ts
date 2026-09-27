import mysql from 'mysql2/promise';
import type { ResultSetHeader } from 'mysql2/promise';
import { E2E_ENV } from './env';

/**
 * Small mysql2 pool for E2E assertions and fixture management. This is the
 * independent half of the harness: specs assert what the API returns, and this
 * client verifies what actually landed in the database.
 */

let pool: mysql.Pool | null = null;

function db(): mysql.Pool {
	if (!pool) {
		pool = mysql.createPool({
			host: E2E_ENV.db.host,
			port: E2E_ENV.db.port,
			user: E2E_ENV.db.user,
			password: E2E_ENV.db.password,
			database: E2E_ENV.db.name,
			connectionLimit: 3,
			dateStrings: true,
		});
	}
	return pool;
}

export async function rows<T = Record<string, unknown>>(
	sql: string,
	params: unknown[] = []
): Promise<T[]> {
	const [result] = await db().execute(sql, params as never[]);
	return result as T[];
}

export async function exec(
	sql: string,
	params: unknown[] = []
): Promise<ResultSetHeader> {
	const [result] = await db().execute(sql, params as never[]);
	return result as ResultSetHeader;
}

export async function closeDb(): Promise<void> {
	if (pool) {
		await pool.end();
		pool = null;
	}
}
