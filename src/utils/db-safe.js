
import { dbConnect } from './database.js';

/**
 * Execute a database operation with automatic connection management.
 * The connection is released back to the pool when the operation completes
 * (or throws).
 *
 * @param {Function} operation - Async function that receives the db connection
 * @returns {Promise<any>} - Result from the operation
 *
 * @example
 *   const rows = await withDB(async (db) => {
 *     const [rows] = await db.execute('SELECT * FROM users');
 *     return rows;
 *   });
 */
export async function withDB(operation) {
  let db;
  try {
    db = await dbConnect();
    return await operation(db);
  } finally {
    if (db) {
      try {
        db.release();
      } catch (err) {
        // release() is idempotent (double-release is a no-op) so errors here
        // indicate the connection was already destroyed — safe to ignore.
        console.error('Error releasing DB connection:', err);
      }
    }
  }
}

/**
 * Execute database operations inside a transaction with automatic
 * connection management.  The transaction is committed on success and
 * rolled back on error.  The connection is always released.
 *
 * @param {Function} operation - Async function that receives the db connection
 * @returns {Promise<any>} - Result from the operation
 *
 * @example
 *   await withTransaction(async (db) => {
 *     await db.execute('INSERT INTO orders ...', [...]);
 *     await db.execute('UPDATE inventory ...', [...]);
 *   });
 */
export async function withTransaction(operation) {
  let db;
  try {
    db = await dbConnect();
    await db.beginTransaction();
    const result = await operation(db);
    await db.commit();
    return result;
  } catch (error) {
    if (db) {
      try {
        await db.rollback();
      } catch (rollbackErr) {
        console.error('Error rolling back transaction:', rollbackErr);
      }
    }
    throw error;
  } finally {
    if (db) {
      try {
        db.release();
      } catch (err) {
        console.error('Error releasing DB connection:', err);
      }
    }
  }
}
