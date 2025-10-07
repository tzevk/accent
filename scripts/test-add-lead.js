require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mysql = require('mysql2/promise');

async function addTestLead() {
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
    
    // Generate lead_id
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentPattern = `-${month}-${year}`;
    
    console.log('🔍 Finding highest lead_id for current month/year...');
    const [leads] = await connection.execute(
      'SELECT lead_id FROM leads WHERE lead_id LIKE ? ORDER BY lead_id DESC',
      [`%${currentPattern}`]
    );
    
    let maxSerial = 0;
    leads.forEach(l => {
      if (l.lead_id && l.lead_id.endsWith(currentPattern)) {
        const serialPart = l.lead_id.split('-')[0];
        const serial = parseInt(serialPart, 10);
        if (!isNaN(serial) && serial > maxSerial) {
          maxSerial = serial;
        }
      }
    });
    
    const nextSerial = String(maxSerial + 1).padStart(3, '0');
    const generatedLeadId = `${nextSerial}-${month}-${year}`;
    
    console.log(`📝 Generated lead_id: ${generatedLeadId}\n`);
    
    // Test lead data
    const testLead = {
      lead_id: generatedLeadId,
      company_id: null,
      company_name: 'Test Company ABC',
      contact_name: 'John Doe',
      contact_email: 'john.doe@testcompany.com',
      phone: '+1234567890',
      city: 'Mumbai',
      project_description: 'Test project for EPC services',
      enquiry_type: 'Email',
      enquiry_status: 'Under Discussion',
      enquiry_date: new Date().toISOString().split('T')[0],
      lead_source: 'Website',
      priority: 'Medium',
      notes: 'This is a test lead created by migration script'
    };
    
    console.log('➕ Inserting test lead...');
    console.log('Lead data:');
    console.log(JSON.stringify(testLead, null, 2));
    console.log();
    
    const [result] = await connection.execute(`
      INSERT INTO leads (
        lead_id, company_id, company_name, contact_name, contact_email, phone, city,
        project_description, enquiry_type, enquiry_status, enquiry_date,
        lead_source, priority, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      testLead.lead_id,
      testLead.company_id,
      testLead.company_name,
      testLead.contact_name,
      testLead.contact_email,
      testLead.phone,
      testLead.city,
      testLead.project_description,
      testLead.enquiry_type,
      testLead.enquiry_status,
      testLead.enquiry_date,
      testLead.lead_source,
      testLead.priority,
      testLead.notes
    ]);
    
    console.log(`✅ Test lead inserted successfully!`);
    console.log(`   Insert ID: ${result.insertId}`);
    
    // Verify the insertion
    const [inserted] = await connection.execute(
      'SELECT * FROM leads WHERE id = ?',
      [result.insertId]
    );
    
    if (inserted.length > 0) {
      console.log('\n✓ Verification - Retrieved lead:');
      console.log(`   ID: ${inserted[0].id}`);
      console.log(`   Lead ID: ${inserted[0].lead_id}`);
      console.log(`   Company: ${inserted[0].company_name}`);
      console.log(`   Contact: ${inserted[0].contact_name}`);
      console.log(`   Email: ${inserted[0].contact_email}`);
      console.log(`   Status: ${inserted[0].enquiry_status}`);
    }
    
    // Count total leads with lead_id
    const [count] = await connection.execute(
      'SELECT COUNT(*) as total FROM leads WHERE lead_id IS NOT NULL'
    );
    console.log(`\n📊 Total leads with lead_id: ${count[0].total}`);
    
    console.log('\n🎉 Test completed successfully!');
    console.log('💡 You can now delete this test lead from the database if needed.');
    console.log(`   DELETE FROM leads WHERE id = ${result.insertId};`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('SQL State:', error.sqlState);
    console.error('SQL Message:', error.sqlMessage);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed.');
    }
  }
}

addTestLead();
