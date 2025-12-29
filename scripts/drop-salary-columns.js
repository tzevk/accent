/**
 * Migration script to drop salary-related columns from the employees table
 * Run with: node scripts/drop-salary-columns.js
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const COLUMNS_TO_DROP = [
  'salary',
  'gross_salary',
  'total_deductions',
  'net_salary',
  'leave_structure'
];

async function dropSalaryColumns() {
  let connection;
  
  try {
    // Connect using environment variables
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });

    console.log('Connected to database:', process.env.DB_NAME);
    console.log('');

    for (const column of COLUMNS_TO_DROP) {
      // Check if column exists
      const [rows] = await connection.execute(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
          AND TABLE_NAME = 'employees' 
          AND COLUMN_NAME = ?
      `, [process.env.DB_NAME, column]);

      if (rows.length > 0) {
        console.log(`Dropping column: ${column}...`);
        await connection.execute(`ALTER TABLE employees DROP COLUMN ${column}`);
        console.log(`  ✓ Successfully dropped '${column}'`);
      } else {
        console.log(`  - Column '${column}' does not exist, skipping`);
      }
    }

    console.log('');
    console.log('Done! All salary-related columns have been removed.');

  } catch (error) {
    console.error('Error:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('Could not connect to database. Check your .env.local settings.');
    }
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

dropSalaryColumns();
