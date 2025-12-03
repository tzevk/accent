/**
 * Database connection safety utilities
 * Ensures connections are always released even if errors occur
 */

import { dbConnect } from './database.js';

/**
 * Execute a database operation with automatic connection management
 * @param {Function} operation - Async function that receives db connection
 * @returns {Promise<any>} - Result from the operation
 */
export async function withDB(operation) {
  let db;
  try {
    db = await dbConnect();
    return await operation(db);
  } finally {
    if (db) {
      try {
        await db.end();
      } catch (err) {
        console.error('Error releasing DB connection:', err);
      }
    }
  }
}

/**
 * Execute multiple database operations in sequence with single connection
 * @param {Function} operation - Async function that receives db connection
 * @returns {Promise<any>} - Result from the operation
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
        await db.end();
      } catch (err) {
        console.error('Error releasing DB connection:', err);
      }
    }
  }
}
