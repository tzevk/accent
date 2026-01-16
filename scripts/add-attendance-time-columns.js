import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function addTimeColumns() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'aboratory'
    });

    console.log('Connected to database');

    // Check if columns already exist
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'employee_attendance' 
      AND COLUMN_NAME IN ('in_time', 'out_time')
    `);

    const existingColumns = columns.map(c => c.COLUMN_NAME);
    
    if (!existingColumns.includes('in_time')) {
      console.log('Adding in_time column...');
      await connection.execute(`
        ALTER TABLE employee_attendance 
        ADD COLUMN in_time TIME NULL AFTER remarks
      `);
      console.log('✓ in_time column added');
    } else {
      console.log('✓ in_time column already exists');
    }

    if (!existingColumns.includes('out_time')) {
      console.log('Adding out_time column...');
      await connection.execute(`
        ALTER TABLE employee_attendance 
        ADD COLUMN out_time TIME NULL AFTER in_time
      `);
      console.log('✓ out_time column added');
    } else {
      console.log('✓ out_time column already exists');
    }

    console.log('\nMigration completed successfully!');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

addTimeColumns();
