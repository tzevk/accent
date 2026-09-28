import fs from 'fs';
import mysql from 'mysql2/promise';

// ═══════════════════════════════════════════════════════════════════════════
// Proxy-local MySQL pool (ADR-0011)
//
// Next 16 runs proxy.ts on the Node.js runtime, so the proxy may talk to
// MySQL — but the proxy must not rely on shared modules or globals with the
// route handlers. This pool is therefore deliberately separate from
// src/utils/database.js (own connection budget, no globalThis, created only
// when the session probe or a rate-limit bucket actually needs it).
// ═══════════════════════════════════════════════════════════════════════════

// Small on purpose: the proxy holds a connection per instance for at most a
// couple of indexed queries per request, and MySQL's connection budget has to
// cover this pool *plus* the app pool for every instance (ADR-0011).
const CONNECTION_LIMIT = Number(process.env.PROXY_DB_CONNECTION_LIMIT || 2);

/** One result row; callers narrow the fields they read. */
export type ProxyRow = Record<string, unknown>;

let pool: mysql.Pool | null = null;

function readDbConfig(): mysql.PoolOptions {
	const environment = String(process.env.NODE_ENV || 'development');
	let database;
	let user;
	let password;

	if (environment === 'production') {
		database = process.env.PROD_DB_NAME;
		user = process.env.PROD_DB_USER;
		password = process.env.PROD_DB_PASSWORD;
	} else if (environment === 'staging') {
		database = process.env.STAGING_DB_NAME;
		user = process.env.STAGING_DB_USER;
		password = process.env.STAGING_DB_PASSWORD;
	} else {
		database = process.env.DEV_DB_NAME;
		user = process.env.DEV_DB_USER;
		password = process.env.DEV_DB_PASSWORD;
	}

	return {
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT),
		database,
		user,
		password,
	};
}

// SEC-20: the proxy holds its own pool, so it has to honour the same
// DB_SSL_MODE / DB_SSL_CA_PATH contract as src/utils/database.js (off |
// require | verify) instead of silently connecting without TLS.
function getDbSslConfig(): mysql.SslOptions | undefined {
	const mode = String(process.env.DB_SSL_MODE || 'off').toLowerCase();
	if (mode === 'off') return undefined;
	if (mode !== 'require' && mode !== 'verify') {
		throw new Error(
			`Invalid DB_SSL_MODE "${process.env.DB_SSL_MODE}" — expected verify, require or off`
		);
	}
	const caPath = process.env.DB_SSL_CA_PATH;
	const ca = caPath ? fs.readFileSync(caPath) : undefined;
	return {
		// A configured CA always enables verification; 'verify' also verifies
		// against the system trust store when no CA is given.
		rejectUnauthorized: mode === 'verify' || Boolean(ca),
		...(ca ? { ca } : {}),
	};
}

function getPool(): mysql.Pool {
	if (!pool) {
		const created = mysql.createPool({
			...readDbConfig(),
			ssl: getDbSslConfig(),
			waitForConnections: true,
			connectionLimit: CONNECTION_LIMIT,
			queueLimit: 50,
			connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
			dateStrings: true,
			maxIdle: 2,
			idleTimeout: 30000,
			enableKeepAlive: true,
			keepAliveInitialDelay: 10000,
		});
		// A dropped connection must not surface as an unhandled 'error' event.
		created.on('connection', (connection) => {
			connection.on('error', (error: Error) => {
				console.error('[proxy-db] MySQL connection error:', error.message);
			});
		});
		pool = created;
	}
	return pool;
}

/** One bound parameter; callers pass scalars only. */
export type ProxyParam = string | number | boolean | Date | null;

/**
 * Run one parameterized statement on the proxy pool.
 * Returns the result rows, or the result header for writes.
 * Throws when the statement fails — the caller decides whether that means
 * "deny" (session probe) or "fail open" (rate limiting).
 */
export async function queryProxy<T = ProxyRow>(
	sql: string,
	params: ProxyParam[] = []
): Promise<T[]> {
	const [rows] = await getPool().execute(sql, params);
	return rows as T[];
}
