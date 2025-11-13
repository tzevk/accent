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
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 10)
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
          maxIdle: 10,
          idleTimeout: 60000
        });
        // Warm a connection to validate database existence
        const test = await pool.getConnection();
        test.release();
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
  // Alias end() to release() for compatibility with existing code
  if (typeof conn.end !== 'function') {
    conn.end = conn.release.bind(conn);
  } else {
    // overwrite to ensure end() doesn't close the pool
    conn.end = conn.release.bind(conn);
  }
  return conn;
}
