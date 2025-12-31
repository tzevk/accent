/**
 * Migration: Add da_year column to employee_salary_profile table
 * This allows tracking which year's DA schedule should be used for calculations
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

async function addDAYearColumn() {
  let connection;
  
  try {
    console.log('🔄 Connecting to database...');
    
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });

    console.log('✅ Connected successfully');

    // Check if column already exists
    const [columns] = await connection.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'employee_salary_profile' 
        AND COLUMN_NAME = 'da_year'
    `, [process.env.DB_NAME]);

    if (columns.length > 0) {
      console.log('⚠️  Column da_year already exists in employee_salary_profile table');
      return;
    }

    console.log('🔄 Adding da_year column to employee_salary_profile table...');

    // Add da_year column after effective_from
    await connection.query(`
      ALTER TABLE employee_salary_profile 
      ADD COLUMN da_year INT NOT NULL DEFAULT 2025 
      COMMENT 'Year for which DA schedule should be applied'
      AFTER effective_from
    `);

    console.log('✅ Column da_year added successfully');

    // Update existing records to use current year if needed
    await connection.query(`
      UPDATE employee_salary_profile 
      SET da_year = YEAR(effective_from)
      WHERE da_year = 2025
    `);

    console.log('✅ Existing records updated with appropriate year');

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. The da_year column has been added to employee_salary_profile');
    console.log('2. Existing records have been updated with year from effective_from date');
    console.log('3. New salary profiles will require da_year to be specified');

  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run the migration
addDAYearColumn()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
