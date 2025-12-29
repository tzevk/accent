/**
 * Script to list all columns in the employees table
 * Run with: node scripts/list-employee-columns.js
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function listEmployeeColumns() {
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

    // Get all columns from employees table
    const [columns] = await connection.execute(`
      SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        COLUMN_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        COLUMN_KEY,
        EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'employees'
      ORDER BY ORDINAL_POSITION
    `, [process.env.DB_NAME]);

    if (columns.length === 0) {
      console.log('No columns found. The employees table may not exist.');
      return;
    }

    console.log(`Found ${columns.length} columns in 'employees' table:\n`);
    console.log('=' .repeat(100));
    console.log(
      'COLUMN_NAME'.padEnd(30) +
      'TYPE'.padEnd(25) +
      'NULLABLE'.padEnd(10) +
      'KEY'.padEnd(8) +
      'DEFAULT'
    );
    console.log('=' .repeat(100));

    for (const col of columns) {
      console.log(
        col.COLUMN_NAME.padEnd(30) +
        col.COLUMN_TYPE.padEnd(25) +
        col.IS_NULLABLE.padEnd(10) +
        (col.COLUMN_KEY || '-').padEnd(8) +
        (col.COLUMN_DEFAULT ?? 'NULL')
      );
    }

    console.log('=' .repeat(100));
    console.log(`\nTotal: ${columns.length} columns`);

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

listEmployeeColumns();
