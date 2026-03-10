import dotenv from 'dotenv';
import mysql from 'mysql2/promise'

// Load env from .env.local for server-side tools/scripts that may not automatically load it
dotenv.config({ path: '.env.local' });

// Use globalThis to persist across HMR reloads in dev
let pool = globalThis.__dbPool || null;
let _shutdownRegistered = globalThis.__dbShutdownRegistered || false;

export async function dbConnect() {
  const host = process.env.DB_HOST
  const port = Number(process.env.DB_PORT)
  const database = process.env.DB_NAME
  const user = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT || 10000) // ms
  // Optimized for production: allow more connections but manage idle efficiently
  // Increased from 10 to 25 to handle concurrent users and polling
  // Keep this LOW (5–8) to stay under MySQL's max_user_connections.
  // waitForConnections + queueLimit handles bursts via queuing, not more connections.
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 5)
  const maxRetries = Number(process.env.DB_CONNECT_RETRIES || 3)

  // Initialize pool once
  if (!pool) {
    let attempt = 0;
    let lastError;
    const tryHosts = [host, host === 'localhost' ? '127.0.0.1' : null].filter(Boolean);
    while (attempt <= maxRetries) {
      const tryHost = tryHosts[Math.min(attempt, tryHosts.length - 1)];
      try {
        pool = mysql.createPool({
          host: tryHost,
          port,
          database,
          user,
          password,
          waitForConnections: true,
          connectionLimit,
          queueLimit: 200,        // Queue requests during high load instead of throwing
          connectTimeout,
          dateStrings: true,
          maxIdle: 2,              // Only keep 2 idle connections — release the rest quickly
          idleTimeout: 30000,     // 30s idle before teardown (was 120s)
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000
        });
        // Warm a connection to validate database existence
        const test = await pool.getConnection();
        test.release();
        
        // Add pool error handlers and monitoring
        pool.on('connection', (connection) => {
          connection.on('error', (err) => {
            console.error('MySQL connection error:', err);
          });
        });
        
        // Pool stats logging disabled for performance
        lastError = undefined;
        break; // success
      } catch (err) {
        lastError = err;
        pool = null; // Reset pool on failure so next attempt can recreate it
        // Auto-create database if it doesn't exist, then recreate pool
        if (err && (err.code === 'ER_BAD_DB_ERROR' || err.errno === 1049)) {
          const admin = await mysql.createConnection({ host: tryHost, port, user, password, connectTimeout });
          try {
            await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
          } finally {
            await admin.end();
          }
          // retry once more to create pool with the new DB
          attempt++;
          continue;
        }
        // Retry for transient network errors
        if (['ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND'].includes(err?.code)) {
          attempt++;
          // small delay between retries
          await new Promise(r => setTimeout(r, 300));
          continue;
        }
        // Non-retryable
        throw err;
      }
    }
    if (!pool && lastError) {
      const enriched = new Error(`DB_CONNECTION_FAILED: Could not connect to MySQL at ${host}:${port} after ${maxRetries + 1} attempt(s). Last error: ${lastError?.code || lastError?.message}`)
      enriched.code = 'DB_CONNECTION_FAILED'
      enriched.cause = lastError
      throw enriched
    }
    
    // Persist pool on globalThis so HMR doesn't orphan it
    globalThis.__dbPool = pool;

    // Register graceful shutdown handlers once (survives HMR via globalThis flag)
    if (!_shutdownRegistered) {
      _shutdownRegistered = true;
      globalThis.__dbShutdownRegistered = true;
      const gracefulShutdown = async (signal) => {
        console.log(`[DB Pool] Received ${signal}, closing pool...`);
        await closePool();
        process.exit(0);
      };
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
  }

  // Retry getConnection if we hit "too many connections"
  let conn;
  let connAttempts = 0;
  const MAX_CONN_RETRIES = 3;
  while (true) {
    try {
      conn = await pool.getConnection();
      break;
    } catch (err) {
      connAttempts++;
      // ER_TOO_MANY_USER_CONNECTIONS (1203) or ER_CON_COUNT_ERROR (1040)
      if ((err.errno === 1203 || err.errno === 1040 || err.code === 'ER_CON_COUNT_ERROR' || err.code === 'ER_TOO_MANY_USER_CONNECTIONS') && connAttempts <= MAX_CONN_RETRIES) {
        console.warn(`[DB] Too many connections (attempt ${connAttempts}/${MAX_CONN_RETRIES}), waiting before retry...`);
        await new Promise(r => setTimeout(r, 500 * connAttempts)); // 500ms, 1s, 1.5s
        continue;
      }
      throw err;
    }
  }
  
  // Force-release connections held too long (leak safety net)
  const FORCE_RELEASE_MS = Number(process.env.DB_FORCE_RELEASE_MS || 8000);
  const releaseTimer = setTimeout(() => {
    console.warn('⚠️  Connection held for more than ' + (FORCE_RELEASE_MS / 1000) + 's, force releasing:', {
      threadId: conn.threadId,
      acquiredAt: conn._acquiredStack?.split('\n')[2]?.trim()
    });
    if (conn && typeof conn.release === 'function') {
      try {
        conn.release();
      } catch (err) {
        console.error('Error force-releasing connection:', err);
      }
    }
  }, FORCE_RELEASE_MS);
  
  // Track connection creation for debugging (only in development — Error().stack is expensive)
  conn._acquiredAt = Date.now();
  if (process.env.NODE_ENV === 'development') {
    conn._acquiredStack = new Error().stack;
  }
  
  // Wrap release to clear the timeout and prevent double-release
  const originalRelease = conn.release.bind(conn);
  let released = false;
  conn.release = function() {
    if (released) {
      // Silently ignore double-release (common in finally blocks)
      return;
    }
    released = true;
    clearTimeout(releaseTimer);
    return originalRelease();
  };
  
  // Alias end() to release() for compatibility with existing code
  conn.end = conn.release;
  
  return conn;
}

// Export function to close pool (useful for cleanup)
export async function closePool() {
  if (pool) {
    try {
      await pool.end();
    } catch (err) {
      console.error('Error closing MySQL pool:', err);
    }
    pool = null;
    globalThis.__dbPool = null;
  }
}

// Export function to get pool stats (for debugging)
export function getPoolStats() {
  if (!pool) return null;
  return {
    totalConnections: pool.pool?._allConnections?.length || 0,
    freeConnections: pool.pool?._freeConnections?.length || 0,
    connectionLimit: pool.pool?.config?.connectionLimit || 0,
    queueLength: pool.pool?._connectionQueue?.length || 0
  };
}

/**
 * Execute a callback with a DB connection that is ALWAYS released afterwards.
 * Eliminates connection leaks by design — use this instead of raw dbConnect()
 * for any code that doesn't need to hold a connection across multiple steps.
 *
 * Usage:
 *   const rows = await withDb(async (db) => {
 *     const [rows] = await db.execute('SELECT ...');
 *     return rows;
 *   });
 *
 * @param {(db: import('mysql2/promise').PoolConnection) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withDb(fn) {
  const db = await dbConnect();
  try {
    return await fn(db);
  } finally {
    try { db.release(); } catch (_) { /* ignore */ }
  }
}

/**
 * Execute a single query directly on the pool — no getConnection/release needed.
 * This is the SAFEST way to run simple queries because the pool handles the
 * connection lifecycle automatically. Use for any simple SELECT/INSERT/UPDATE.
 *
 * Usage:
 *   const [rows] = await query('SELECT * FROM users WHERE id = ?', [userId]);
 *
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<[any[], any]>}
 */
export async function query(sql, params = []) {
  await ensurePool();
  return pool.execute(sql, params);
}

/**
 * Ensure pool is initialized (called internally by query())
 */
async function ensurePool() {
  if (!pool) {
    // dbConnect creates the pool as a side effect, then we release the connection
    const conn = await dbConnect();
    conn.release();
  }
}
