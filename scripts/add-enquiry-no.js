#!/usr/bin/env node
/*
  Migration: add-enquiry-no.js
  Adds the `enquiry_no` column to the `proposals` table if it doesn't already exist.
  Usage: node scripts/add-enquiry-no.js
*/
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { dbConnect } from '../src/utils/database.js';

async function run() {
  const db = await dbConnect();
  try {
    console.log('Adding column enquiry_no to proposals (if not exists)...');
    await db.execute("ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_no VARCHAR(255) DEFAULT NULL");
    console.log('Migration complete: enquiry_no column ensured.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    try { await db.end(); } catch {}
  }
}

run().catch(e => {
  console.error('Fatal migration error:', e);
  process.exit(1);
});
