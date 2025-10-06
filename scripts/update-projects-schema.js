/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

async function updateProjectsSchema() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,   // 🔹 FIXED
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306    // 🔹 Optional: if port is in .env
    });

    console.log('Connected to database');

    // First, get existing foreign key constraints
    const [constraints] = await connection.query(`
      SELECT CONSTRAINT_NAME
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'projects'
      AND REFERENCED_TABLE_NAME IS NOT NULL
    `);

    // Drop existing foreign keys
    for (const row of constraints) {
      try {
        await connection.execute(
          `ALTER TABLE projects DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``
        );
        console.log(`Dropped foreign key: ${row.CONSTRAINT_NAME}`);
      } catch (err) {
        console.warn(`Failed to drop foreign key ${row.CONSTRAINT_NAME}:`, err.message);
      }
    }

    // Alter statements
    const alterStatements = [
      'ALTER TABLE projects ADD COLUMN target_date DATE',
      'ALTER TABLE projects ADD COLUMN assigned_to VARCHAR(255)',
      'ALTER TABLE projects ADD COLUMN type VARCHAR(50) DEFAULT "ONGOING"',
      'ALTER TABLE projects ADD COLUMN proposal_id INT NULL',
      'ALTER TABLE projects MODIFY COLUMN status VARCHAR(50) DEFAULT "NEW"',
      'ALTER TABLE projects MODIFY COLUMN priority VARCHAR(50) DEFAULT "MEDIUM"',
      'ALTER TABLE projects ADD CONSTRAINT fk_projects_proposal FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL'
    ];

    // Run statements
    for (const stmt of alterStatements) {
      try {
        await connection.execute(stmt);
        console.log('Executed:', stmt);
      } catch (err) {
        console.warn('Skipped/Failed:', stmt);
        console.warn('Error:', err.message);
      }
    }

    console.log('Schema update completed');
    await connection.end();
  } catch (error) {
    console.error('Failed to update schema:', error);
    process.exit(1);
  }
}

updateProjectsSchema();
