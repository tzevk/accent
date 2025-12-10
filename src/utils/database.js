import dotenv from 'dotenv';
import mysql from 'mysql2/promise'

// Load env from .env.local for server-side tools/scripts that may not automatically load it
dotenv.config({ path: '.env.local' });

let pool;

export async function dbConnect() {
  const host = process.env.DB_HOST
  const port = Number(process.env.DB_PORT)
  const database = process.env.DB_NAME
  const user = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT || 10000) // ms
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 3) // Reduced to 3 to prevent exceeding max_user_connections
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
          queueLimit: 0,
          connectTimeout,
          dateStrings: true,
          maxIdle: 1, // Keep max 1 idle connection (reduced from 2)
          idleTimeout: 15000, // Close idle connections after 15s (reduced from 30s)
          enableKeepAlive: true,
          keepAliveInitialDelay: 0
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
        
        pool.on('acquire', (connection) => {
          if (process.env.NODE_ENV === 'development') {
            console.log('📥 Connection %d acquired', connection.threadId);
          }
        });
        
        pool.on('release', (connection) => {
          if (process.env.NODE_ENV === 'development') {
            console.log('📤 Connection %d released', connection.threadId);
          }
        });
        
        // Log pool stats every 30 seconds in development
        if (process.env.NODE_ENV === 'development') {
          setInterval(() => {
            const stats = getPoolStats();
            if (stats && stats.totalConnections > 0) {
              console.log('🔌 Pool stats:', stats);
            }
          }, 30000);
        }
        
        lastError = undefined;
        break; // success
      } catch (err) {
        lastError = err;
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
  }

  const conn = await pool.getConnection();
  
  // Add connection timeout to auto-release if not released in 15s (reduced from 30s)
  const releaseTimer = setTimeout(() => {
    console.warn('⚠️  Connection held for more than 15s, force releasing:', {
      threadId: conn.threadId,
      stack: new Error().stack
    });
    if (conn && typeof conn.release === 'function') {
      try {
        conn.release();
      } catch (err) {
        console.error('Error force-releasing connection:', err);
      }
    }
  }, 15000);
  
  // Track connection creation for debugging
  conn._acquiredAt = Date.now();
  conn._acquiredStack = new Error().stack;
  
  // Wrap release to clear the timeout
  const originalRelease = conn.release.bind(conn);
  let released = false;
  conn.release = function() {
    if (released) {
      console.warn('⚠️  Attempting to release connection twice:', conn.threadId);
      return;
    }
    released = true;
    clearTimeout(releaseTimer);
    return originalRelease();
  };
  
  // Alias end() to release() for compatibility with existing code
  conn.end = conn.release.bind(conn);
  
  return conn;
}

// Export function to close pool (useful for cleanup)
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Export function to get pool stats (for debugging)
export function getPoolStats() {
  if (!pool) return null;
  return {
    totalConnections: pool.pool?._allConnections?.length || 0,
    freeConnections: pool.pool?._freeConnections?.length || 0,
    connectionLimit: pool.pool?.config?.connectionLimit || 0
  };
}
