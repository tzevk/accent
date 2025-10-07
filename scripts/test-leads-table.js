require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mysql = require('mysql2/promise');

async function testLeadsTable() {
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
    
    // Check if leads table exists
    console.log('📋 Checking leads table structure...');
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads'
      ORDER BY ORDINAL_POSITION
    `, [process.env.DB_NAME]);
    
    if (columns.length === 0) {
      console.log('❌ Leads table does not exist!');
      return;
    }
    
    console.log('\nLeads table columns:');
    console.log('─'.repeat(80));
    columns.forEach(col => {
      console.log(`${col.COLUMN_NAME.padEnd(30)} ${col.DATA_TYPE.padEnd(20)} ${col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL'}`);
    });
    console.log('─'.repeat(80));
    
    // Check for lead_id and company_id columns
    const hasLeadId = columns.some(col => col.COLUMN_NAME === 'lead_id');
    const hasCompanyId = columns.some(col => col.COLUMN_NAME === 'company_id');
    
    console.log(`\n✓ lead_id column: ${hasLeadId ? '✅ EXISTS' : '❌ MISSING'}`);
    console.log(`✓ company_id column: ${hasCompanyId ? '✅ EXISTS' : '❌ MISSING'}`);
    
    // Count existing leads
    const [countResult] = await connection.execute('SELECT COUNT(*) as total FROM leads');
    console.log(`\n📊 Total leads in database: ${countResult[0].total}`);
    
    // Check for leads with lead_id
    if (hasLeadId) {
      const [leadsWithId] = await connection.execute('SELECT COUNT(*) as total FROM leads WHERE lead_id IS NOT NULL');
      console.log(`📊 Leads with lead_id: ${leadsWithId[0].total}`);
      
      // Show sample lead_ids
      const [sampleIds] = await connection.execute('SELECT lead_id FROM leads WHERE lead_id IS NOT NULL LIMIT 5');
      if (sampleIds.length > 0) {
        console.log('\n📝 Sample lead_ids:');
        sampleIds.forEach(row => console.log(`   - ${row.lead_id}`));
      }
    }
    
    console.log('\n✅ Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Details:', error);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed.');
    }
  }
}

testLeadsTable();
