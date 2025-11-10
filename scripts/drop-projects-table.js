#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import { pathToFileURL } from 'url';

dotenv.config({ path: '.env.local' });

async function main() {
  try {
    const dbModulePath = pathToFileURL(path.resolve(process.cwd(), 'src/utils/database.js')).href;
    const { dbConnect } = await import(dbModulePath);
    const conn = await dbConnect();

    console.log('Dropping projects table (if exists)...');
    await conn.execute('DROP TABLE IF EXISTS projects');
    console.log('Dropped projects table successfully.');

    await conn.end?.();
    process.exit(0);
  } catch (err) {
    console.error('Failed to drop projects table:', err);
    process.exit(1);
  }
}

main();
