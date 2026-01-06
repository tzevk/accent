import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function extendComponentType() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'accent'
  });

  try {
    console.log('Connected to database...');
    
    // Check current column type
    const [columns] = await connection.query(`
      SHOW COLUMNS FROM payroll_schedules WHERE Field = 'component_type'
    `);
    
    console.log('Current column type:', columns[0]?.Type);
    
    // Alter to VARCHAR(50) to allow any component type
    await connection.query(`
      ALTER TABLE payroll_schedules 
      MODIFY COLUMN component_type VARCHAR(50) NOT NULL
    `);
    
    console.log('✅ Successfully extended component_type column to VARCHAR(50)');
    
    // Verify the change
    const [newColumns] = await connection.query(`
      SHOW COLUMNS FROM payroll_schedules WHERE Field = 'component_type'
    `);
    
    console.log('New column type:', newColumns[0]?.Type);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await connection.end();
    console.log('Database connection closed.');
  }
}

extendComponentType();
