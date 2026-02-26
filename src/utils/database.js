import dotenv from 'dotenv';
import mysql from 'mysql2/promise'

// Load env from .env.local for server-side tools/scripts that may not automatically load it
dotenv.config({ path: '.env.local' });

let pool;
let _shutdownRegistered = false;

export async function dbConnect() {
  const host = process.env.DB_HOST
  const port = Number(process.env.DB_PORT)
  const database = process.env.DB_NAME
  const user = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT || 10000) // ms
  // Reduced from 10 to 2 for shared server — keeps fewer connections open
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 2)
  const maxRetries = Number(process.env.DB_CONNECT_RETRIES || 2)

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
          queueLimit: 20,         // Reduced: limit the queue to prevent unbounded buildup
          connectTimeout,
          dateStrings: true,
          maxIdle: 1,             // Reduced: keep only 1 idle connection on shared server
          idleTimeout: 15000,     // Reduced from 30s: release idle connections faster (15s)
          enableKeepAlive: true,
          keepAliveInitialDelay: 10000 // Send keepalive after 10s
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
    
    // Register graceful shutdown handlers once
    if (!_shutdownRegistered) {
      _shutdownRegistered = true;
      const gracefulShutdown = async (signal) => {
        console.log(`[DB Pool] Received ${signal}, closing pool...`);
        await closePool();
        process.exit(0);
      };
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
  }

  const conn = await pool.getConnection();
  
  // Reduced from 30s to 15s — if a connection is held this long, something is wrong
  const FORCE_RELEASE_MS = Number(process.env.DB_FORCE_RELEASE_MS || 15000);
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
