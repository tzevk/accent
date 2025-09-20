#!/usr/bin/env node

// Script to clear all data from the leads table while keeping the table structure
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function clearLeadsTable() {
  let connection;
  
  try {
    console.log('🔗 Connecting to database...');
    
    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    console.log('✅ Connected to database successfully');

    // First, check how many records exist
    const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM leads');
    const recordCount = countResult[0].count;
    
    console.log(`📊 Found ${recordCount} records in leads table`);

    if (recordCount === 0) {
      console.log('ℹ️  Table is already empty, nothing to delete');
      return;
    }

    // Confirm deletion (in a real scenario, you might want user confirmation)
    console.log('🗑️  Deleting all records from leads table...');
    
    // Delete all records (TRUNCATE is faster but DELETE allows for more control)
    const [deleteResult] = await connection.execute('DELETE FROM leads');
    
    console.log(`✅ Successfully deleted ${deleteResult.affectedRows} records`);
    
    // Reset auto-increment counter (optional)
    await connection.execute('ALTER TABLE leads AUTO_INCREMENT = 1');
    console.log('🔄 Reset auto-increment counter to 1');

    // Verify the table is empty
    const [verifyResult] = await connection.execute('SELECT COUNT(*) as count FROM leads');
    const remainingCount = verifyResult[0].count;
    
    if (remainingCount === 0) {
      console.log('✅ Verification: Table is now empty');
    } else {
      console.log(`⚠️  Warning: ${remainingCount} records still remain`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Run the script
clearLeadsTable()
  .then(() => {
    console.log('🎉 Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error.message);
    process.exit(1);
  });
