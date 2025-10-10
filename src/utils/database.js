import mysql from 'mysql2/promise'

export async function dbConnect() {
  const host = process.env.DB_HOST || 'localhost'
  const port = Number(process.env.DB_PORT) || 3306
  const database = process.env.DB_NAME || 'accent'
  const user = process.env.DB_USER || 'root'
  const password = process.env.DB_PASSWORD || ''

  try {
    const connection = await mysql.createConnection({ host, port, database, user, password })
    return connection
  } catch (err) {
    // Auto-create database if it doesn't exist, then reconnect
    if (err && (err.code === 'ER_BAD_DB_ERROR' || err.errno === 1049)) {
      const admin = await mysql.createConnection({ host, port, user, password })
      try {
        await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
      } finally {
        await admin.end()
      }
      const connection = await mysql.createConnection({ host, port, database, user, password })
      return connection
    }
    throw err
  }
}
