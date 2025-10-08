require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

async function createVendorsTable() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });

    console.log('✅ Connected to database');

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS vendors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        vendor_id VARCHAR(50) UNIQUE,
        vendor_name VARCHAR(255) NOT NULL,
        vendor_type VARCHAR(100),
        industry_category VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Active',
        
        -- Contact Information
        contact_person VARCHAR(255),
        contact_designation VARCHAR(100),
        phone VARCHAR(50),
        email VARCHAR(255),
        address_street VARCHAR(500),
        address_city VARCHAR(100),
        address_state VARCHAR(100),
        address_country VARCHAR(100),
        address_pin VARCHAR(20),
        website VARCHAR(255),
        
        -- Registration & Compliance
        gst_vat_tax_id VARCHAR(100),
        pan_legal_reg_no VARCHAR(100),
        msme_ssi_registration VARCHAR(100),
        iso_certifications TEXT,
        other_compliance_docs TEXT,
        
        -- Financial Information
        bank_name VARCHAR(255),
        bank_account_no VARCHAR(100),
        ifsc_swift_code VARCHAR(50),
        currency_preference VARCHAR(10) DEFAULT 'INR',
        payment_terms VARCHAR(255),
        credit_limit DECIMAL(15, 2),
        
        -- Performance & History
        previous_projects TEXT,
        avg_quality_rating DECIMAL(2, 1),
        avg_delivery_rating DECIMAL(2, 1),
        avg_reliability_rating DECIMAL(2, 1),
        blacklist_notes TEXT,
        remarks TEXT,
        
        -- Attachments (storing file paths/URLs)
        contract_attachments TEXT,
        certificate_attachments TEXT,
        profile_attachments TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    await connection.query(createTableQuery);
    console.log('✅ Vendors table created successfully');

    // Verify table creation
    const [tables] = await connection.query("SHOW TABLES LIKE 'vendors'");
    if (tables.length > 0) {
      console.log('✅ Verified: vendors table exists');
      
      // Show table structure
      const [columns] = await connection.query('DESCRIBE vendors');
      console.log('\n📋 Table structure:');
      columns.forEach(col => {
        console.log(`  ${col.Field.padEnd(30)} ${col.Type.padEnd(20)} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n👋 Database connection closed');
    }
  }
}

createVendorsTable();
