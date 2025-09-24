import dotenv from 'dotenv';
import { dbConnect } from '../database.js';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function runMigration() {
  let connection;
  try {
    connection = await dbConnect();
    
    const alterTableQuery = `
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS location VARCHAR(255),
      ADD COLUMN IF NOT EXISTS contact_person VARCHAR(100),
      ADD COLUMN IF NOT EXISTS designation VARCHAR(100),
      ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20),
      ADD COLUMN IF NOT EXISTS email VARCHAR(100),
      ADD COLUMN IF NOT EXISTS sector VARCHAR(100)
    `;

    await connection.query(alterTableQuery);
    console.log('✅ Successfully added new fields to companies table');

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