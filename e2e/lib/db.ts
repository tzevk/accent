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
			ssl: E2E_ENV.db.ssl,
			connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 30000),
			connectionLimit: 3,
			dateStrings: true,
		});
	}
	return pool;
}

export async function pingDb(retries = 60, delayMs = 5000): Promise<void> {
	let attempt = 0;
	while (attempt < retries) {
		try {
			const conn = await db().getConnection();
			conn.release();
			return;
		} catch (error: any) {
			attempt++;
			console.log(
				`[e2e:db] waiting for database ready (${E2E_ENV.db.host}:${E2E_ENV.db.port})... ` +
					`attempt ${attempt}/${retries} (${error.code || error.message})`
			);
			if (attempt >= retries) {
				throw error;
			}
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
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
