/**
 * Schema Cache — caches INFORMATION_SCHEMA column metadata in-process.
 * Avoids expensive DDL / INFORMATION_SCHEMA queries on every API request.
 *
 * Cache is per-process and auto-expires after TTL (default 10 minutes).
 */

const _cache = new Map(); // tableName → { columns: Set<string>, pkCol: string, ts: number }
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Get the set of column names for a table. Uses in-memory cache.
 * @param {object} db  A pool connection (from dbConnect())
 * @param {string} tableName
 * @returns {Promise<Set<string>>}
 */
export async function getTableColumns(db, tableName) {
	const hit = _cacheGet(tableName);
	if (hit) return hit.columns;

	const [cols] = await db.execute(
		`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
		[tableName]
	);
	const columns = new Set((cols || []).map((c) => c.COLUMN_NAME));
	const existing = _cache.get(tableName);
	_cache.set(tableName, {
		columns,
		pkCol: existing?.pkCol ?? null,
		ts: Date.now(),
	});
	return columns;
}

/** @returns {{ columns: Set<string>, pkCol: string|null, ts: number }|null} */
function _cacheGet(tableName) {
	const entry = _cache.get(tableName);
	if (!entry) return null;
	if (Date.now() - entry.ts < CACHE_TTL) return entry;
	return null;
}

/**
 * Get the primary key column for a table. Uses in-memory cache.
 * @param {object} db
 * @param {string} tableName
 * @returns {Promise<string|null>}
 */
export async function getPrimaryKeyColumn(db, tableName) {
	const entry = _cacheGet(tableName);
	if (entry?.pkCol !== undefined) return entry.pkCol;

	const [pkRows] = await db.execute(
		`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'`,
		[tableName]
	);
	const pkCol = pkRows?.length > 0 ? pkRows[0].COLUMN_NAME : null;
	const existing = _cache.get(tableName);
	_cache.set(tableName, {
		columns: existing?.columns ?? new Set(),
		pkCol,
		ts: existing?.ts ?? Date.now(),
	});
	return pkCol;
}

/**
 * Check if a table has a specific column. Uses cache.
 */
export async function hasColumn(db, tableName, columnName) {
	const columns = await getTableColumns(db, tableName);
	return columns.has(columnName);
}

/**
 * Invalidate the cache for a table (call after ALTER TABLE, if ever needed).
 */
export function invalidateCache(tableName) {
	if (tableName) {
		_cache.delete(tableName);
	} else {
		_cache.clear();
	}
}
