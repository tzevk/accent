#!/usr/bin/env node
/*
  Script: create-software-tables.js
  Creates the software master related tables in the database using the project's dbConnect helper.
  Usage: node scripts/create-software-tables.js
  Loads environment variables from .env.local (if present).
*/

import dotenv from 'dotenv';
import { dbConnect } from '../src/utils/database.js';

// Load .env.local first so dbConnect picks up variables
dotenv.config({ path: '.env.local' });

// Basic warning if common DB env vars are missing
if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER) {
  console.warn('Warning: DB_HOST, DB_NAME, or DB_USER not set in environment. Ensure .env.local exists or provide env vars.');
}
async function createTables() {
  const db = await dbConnect();
  try {
    console.log('Creating table: software_categories');
    await db.execute(`CREATE TABLE IF NOT EXISTS software_categories (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    console.log('Creating table: softwares');
    await db.execute(`CREATE TABLE IF NOT EXISTS softwares (
      id VARCHAR(36) PRIMARY KEY,
      category_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    console.log('Creating table: software_versions');
    await db.execute(`CREATE TABLE IF NOT EXISTS software_versions (
      id VARCHAR(36) PRIMARY KEY,
      software_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      release_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    console.log('All software tables created (or already existed).');
  } catch (err) {
    console.error('Error creating software tables:', err);
    process.exitCode = 1;
  } finally {
    try {
      await db.end();
    } catch {
      // ignore
    }
  }
}

createTables().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
