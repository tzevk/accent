import dotenv from 'dotenv';
import { dbConnect } from '../database.js';

// Load environment variables from .env.local (if present)
dotenv.config({ path: '.env.local' });

async function runMigration() {
  let connection;
  try {
    connection = await dbConnect();

    const alterTableQuery = `
      ALTER TABLE leads
      ADD COLUMN IF NOT EXISTS designation VARCHAR(255)
    `;

    await connection.query(alterTableQuery);
    console.log('✅ Successfully added designation column to leads table');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
