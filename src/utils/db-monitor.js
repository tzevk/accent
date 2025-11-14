/**
 * Database Connection Monitor Middleware
 * Logs connection pool stats in development mode
 * Add this to any API route to debug connection issues
 */

import { getPoolStats } from '@/utils/database';

export function logConnectionStats(label = 'API Route') {
  if (process.env.NODE_ENV === 'development') {
    const stats = getPoolStats();
    if (stats) {
      const usage = stats.totalConnections - stats.freeConnections;
      const percentage = Math.round((usage / stats.connectionLimit) * 100);
      console.log(
        `[DB Pool] ${label} | In Use: ${usage}/${stats.connectionLimit} (${percentage}%) | Free: ${stats.freeConnections}`
      );
    }
  }
}

/**
 * Wrapper to ensure connection is always released
 * Usage: await withConnection(async (conn) => { ... })
 */
export async function withConnection(callback) {
  const { dbConnect } = await import('@/utils/database');
  const conn = await dbConnect();
  
  try {
    return await callback(conn);
  } finally {
    // Ensure connection is always released
    if (conn && typeof conn.release === 'function') {
      conn.release();
    }
  }
}
