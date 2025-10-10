import mysql from 'mysql2/promise'

let pool;

export async function dbConnect() {
  const host = process.env.DB_HOST || 'localhost'
  const port = Number(process.env.DB_PORT) || 3306
  const database = process.env.DB_NAME || 'accent'
  const user = process.env.DB_USER || 'root'
  const password = process.env.DB_PASSWORD || ''
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT || 10000) // ms
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT || 10)

  // Initialize pool once
  if (!pool) {
    try {
      pool = mysql.createPool({
        host,
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
    } catch (err) {
      // Auto-create database if it doesn't exist, then recreate pool
      if (err && (err.code === 'ER_BAD_DB_ERROR' || err.errno === 1049)) {
        const admin = await mysql.createConnection({ host, port, user, password, connectTimeout });
        try {
          await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
        } finally {
          await admin.end();
        }
        pool = mysql.createPool({
          host,
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
      } else {
        throw err;
      }
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
