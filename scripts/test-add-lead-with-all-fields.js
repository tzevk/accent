require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env.local') });
const mysql = require('mysql2/promise');

async function addTestLeadWithAllFields() {
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
    
    // Test lead data with ALL fields
    const testLead = {
      lead_id: generatedLeadId,
      company_id: null,
      company_name: 'Advanced Engineering Solutions Ltd',
      contact_name: 'Sarah Johnson',
      contact_email: 'sarah.johnson@adveng.com',
      inquiry_email: 'inquiry@adveng.com',
      cc_emails: 'manager@adveng.com, director@adveng.com, ceo@adveng.com, procurement@adveng.com',
      phone: '+91-22-4567-8900',
      city: 'Mumbai',
      project_description: 'Looking for EPC services for a new petrochemical plant. The project involves engineering, procurement, and construction of a 50,000 MTPA facility.',
      enquiry_type: 'Email',
      enquiry_status: 'Under Discussion',
      enquiry_date: new Date().toISOString().split('T')[0],
      lead_source: 'Website',
      priority: 'High',
      notes: 'High-value opportunity. Client has previous experience with similar projects. Budget estimated at $10M. Timeline: 18 months. Follow up scheduled for next week.'
    };
    
    console.log('➕ Inserting test lead with ALL fields...');
    console.log('═'.repeat(80));
    console.log('Lead Data:');
    console.log('═'.repeat(80));
    Object.keys(testLead).forEach(key => {
      const value = testLead[key] || '(null)';
      console.log(`  ${key.padEnd(25)}: ${value}`);
    });
    console.log('═'.repeat(80));
    console.log();
    
    const [result] = await connection.execute(`
      INSERT INTO leads (
        lead_id, company_id, company_name, contact_name, contact_email, inquiry_email, cc_emails,
        phone, city, project_description, enquiry_type, enquiry_status, enquiry_date,
        lead_source, priority, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      testLead.lead_id,
      testLead.company_id,
      testLead.company_name,
      testLead.contact_name,
      testLead.contact_email,
      testLead.inquiry_email,
      testLead.cc_emails,
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
      const lead = inserted[0];
      console.log('\n✓ Verification - Retrieved lead from database:');
      console.log('═'.repeat(80));
      console.log(`  ID                       : ${lead.id}`);
      console.log(`  Lead ID                  : ${lead.lead_id}`);
      console.log(`  Company                  : ${lead.company_name}`);
      console.log(`  Contact Name             : ${lead.contact_name}`);
      console.log(`  Contact Email            : ${lead.contact_email}`);
      console.log(`  Inquiry Email (NEW)      : ${lead.inquiry_email}`);
      console.log(`  CC Emails (NEW)          : ${lead.cc_emails}`);
      console.log(`  Phone                    : ${lead.phone}`);
      console.log(`  City                     : ${lead.city}`);
      console.log(`  Project Description      : ${lead.project_description}`);
      console.log(`  Enquiry Type             : ${lead.enquiry_type}`);
      console.log(`  Status                   : ${lead.enquiry_status}`);
      console.log(`  Enquiry Date             : ${lead.enquiry_date}`);
      console.log(`  Lead Source              : ${lead.lead_source}`);
      console.log(`  Priority                 : ${lead.priority}`);
      console.log(`  Notes                    : ${lead.notes}`);
      console.log('═'.repeat(80));
    }
    
    // Count CC emails
    if (inserted.length > 0 && inserted[0].cc_emails) {
      const ccEmailArray = inserted[0].cc_emails.split(',').map(e => e.trim());
      console.log(`\n📧 Email Analysis:`);
      console.log(`  Inquiry Email: ${inserted[0].inquiry_email}`);
      console.log(`  Number of CC Emails: ${ccEmailArray.length}`);
      console.log(`  CC Email List:`);
      ccEmailArray.forEach((email, index) => {
        console.log(`    ${index + 1}. ${email}`);
      });
    }
    
    // Count total leads with email fields
    const [emailCount] = await connection.execute(
      'SELECT COUNT(*) as total FROM leads WHERE inquiry_email IS NOT NULL OR cc_emails IS NOT NULL'
    );
    console.log(`\n📊 Total leads with email fields: ${emailCount[0].total}`);
    
    console.log('\n🎉 Test completed successfully!');
    console.log('💡 You can view this lead in the frontend or delete it using:');
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

addTestLeadWithAllFields();
