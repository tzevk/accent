#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Reuse db helper to ensure same config & connection handling
const { dbConnect } = await import('../src/utils/database.js');

(async function main() {
  const pool = await dbConnect();
  const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || null;
  if (!dbName) {
    console.error('DB_NAME or MYSQL_DATABASE environment variable not set in .env.local');
    process.exit(1);
  }

  const columns = [
    { name: 'project_assumption_list', desiredType: 'LONGTEXT' },
    { name: 'project_lessons_learnt_list', desiredType: 'LONGTEXT' }
  ];

  try {
    for (const col of columns) {
      const [rows] = await pool.execute(
        `SELECT DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = ?`,
        [dbName, col.name]
      );

      if (!rows || rows.length === 0) {
        console.log(`${col.name} not found — adding as ${col.desiredType}`);
        await pool.execute(`ALTER TABLE projects ADD COLUMN ${col.name} ${col.desiredType} NULL`);
        console.log(`Added ${col.name}`);
      } else {
        const row = rows[0];
        const currentType = (row.COLUMN_TYPE || '').toLowerCase();
        console.log(`Found ${col.name} with type ${row.COLUMN_TYPE}`);
        // Normalize checks — if not text-like, alter
        if (!currentType.includes('text') && !currentType.includes('json')) {
          console.log(`Modifying ${col.name} to ${col.desiredType}`);
          await pool.execute(`ALTER TABLE projects MODIFY COLUMN ${col.name} ${col.desiredType} NULL`);
          console.log(`Modified ${col.name} to ${col.desiredType}`);
        } else {
          console.log(`No change required for ${col.name}`);
        }
      }
    }

    console.log('All migrations complete');
    await pool.end?.();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err?.message || err);
    await pool.end?.();
    process.exit(2);
  }
})();
