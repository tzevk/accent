require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mysql = require('mysql2/promise');

async function addCompanyIdColumn() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    
    console.log('✅ Connected successfully!\n');
    
    // Check if company_id column already exists
    console.log('📋 Checking if company_id column exists...');
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'company_id'
    `, [process.env.DB_NAME]);
    
    if (columns.length > 0) {
      console.log('ℹ️  company_id column already exists. No changes needed.');
      return;
    }
    
    console.log('➕ Adding company_id column to leads table...');
    await connection.execute(`
      ALTER TABLE leads 
      ADD COLUMN company_id INT NULL AFTER id
    `);
    
    console.log('✅ company_id column added successfully!');
    
    // Verify the column was added
    const [verification] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'company_id'
    `, [process.env.DB_NAME]);
    
    if (verification.length > 0) {
      console.log('\n✓ Verification:');
      console.log(`  Column: ${verification[0].COLUMN_NAME}`);
      console.log(`  Type: ${verification[0].DATA_TYPE}`);
      console.log(`  Nullable: ${verification[0].IS_NULLABLE}`);
    }
    
    console.log('\n🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Details:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed.');
    }
  }
}

addCompanyIdColumn();
