#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Dynamic import to use same db helper as app
const { dbConnect } = await import('../src/utils/database.js');

(async function main() {
  const desiredLen = 100; // choose desired project_id length
  const pool = await dbConnect();
  const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || null;
  if (!dbName) {
    console.error('DB_NAME or MYSQL_DATABASE environment variable not set in .env.local');
    process.exit(1);
  }

  try {
    const [rows] = await pool.execute(
      `SELECT CHARACTER_MAXIMUM_LENGTH, DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'project_id'`,
      [dbName]
    );

    if (!rows || rows.length === 0) {
      console.log('project_id column not found on projects table — adding it as VARCHAR(' + desiredLen + ") UNIQUE");
      await pool.execute(`ALTER TABLE projects ADD COLUMN project_id VARCHAR(${desiredLen}) UNIQUE`);
      console.log('Added project_id column');
    } else {
      const col = rows[0];
      const currentLen = col.CHARACTER_MAXIMUM_LENGTH || (col.COLUMN_TYPE && (col.COLUMN_TYPE.match(/varchar\((\d+)\)/i) || [])[1]) || null;
      console.log('Detected project_id column type:', col.COLUMN_TYPE, 'currentLen:', currentLen);
      if (currentLen && Number(currentLen) < desiredLen) {
        console.log(`Altering project_id column to VARCHAR(${desiredLen})`);
        await pool.execute(`ALTER TABLE projects MODIFY COLUMN project_id VARCHAR(${desiredLen})`);
        console.log('Altered project_id to new length');
      } else {
        console.log('No change required for project_id column');
      }
    }

    console.log('Done');
    await pool.end?.();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err?.message || err);
    await pool.end?.();
    process.exit(2);
  }
})();
