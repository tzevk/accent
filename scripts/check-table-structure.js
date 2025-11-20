#!/usr/bin/env node

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function main() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
  });

  console.log('Projects table structure:');
  const [projectCols] = await db.execute("SHOW COLUMNS FROM projects");
  projectCols.forEach(c => console.log(`  ${c.Field}: ${c.Type} ${c.Key}`));

  console.log('\nUsers table structure:');
  const [userCols] = await db.execute("SHOW COLUMNS FROM users");
  userCols.forEach(c => console.log(`  ${c.Field}: ${c.Type} ${c.Key}`));

  console.log('\nEmployees table structure:');
  const [empCols] = await db.execute("SHOW COLUMNS FROM employees");
  empCols.forEach(c => console.log(`  ${c.Field}: ${c.Type} ${c.Key}`));

  await db.end();
}

main().catch(console.error);
