require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

async function testVendorOperations() {
  let connection;
  
  try {
    // Create database connection
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306
    });

    console.log('✅ Connected to database');

    // Check if vendors table exists
    const [tables] = await connection.query("SHOW TABLES LIKE 'vendors'");
    
    if (tables.length === 0) {
      console.log('❌ Vendors table does not exist');
      return;
    }
    
    console.log('✅ Vendors table exists');

    // Show table structure
    const [columns] = await connection.query('DESCRIBE vendors');
    console.log('\n📋 Vendors table structure:');
    columns.forEach(col => {
      console.log(`  - ${col.Field} (${col.Type}) ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Key ? `[${col.Key}]` : ''}`);
    });

    // Test vendor creation with auto-generated vendor_id
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();

    const testVendor = {
      vendor_name: 'Test Engineering Solutions Pvt Ltd',
      vendor_type: 'Supplier',
      industry_category: 'Electrical',
      status: 'Active',
      contact_person: 'Rajesh Kumar',
      contact_designation: 'Sales Manager',
      phone: '+91-9876543210',
      email: 'rajesh.kumar@testeng.com',
      address_street: '123 Industrial Area, Phase 2',
      address_city: 'Mumbai',
      address_state: 'Maharashtra',
      address_country: 'India',
      address_pin: '400001',
      website: 'https://testeng.com',
      gst_vat_tax_id: '27AABCT1234F1Z5',
      pan_legal_reg_no: 'AABCT1234F',
      msme_ssi_registration: 'UDYAM-MH-12-1234567',
      iso_certifications: 'ISO 9001:2015, ISO 14001:2015',
      bank_name: 'HDFC Bank',
      bank_account_no: '50100123456789',
      ifsc_swift_code: 'HDFC0001234',
      currency_preference: 'INR',
      payment_terms: '30 days credit',
      credit_limit: 500000.00,
      avg_quality_rating: 4.5,
      avg_delivery_rating: 4.2,
      avg_reliability_rating: 4.7,
      remarks: 'Reliable vendor with good track record'
    };

    // Get the highest vendor_id for this month/year
    const monthYearPattern = `%-${month}-${year}`;
    const [existingVendors] = await connection.query(
      'SELECT vendor_id FROM vendors WHERE vendor_id LIKE ? ORDER BY vendor_id DESC LIMIT 1',
      [monthYearPattern]
    );
    
    let serialNumber = 1;
    if (existingVendors.length > 0 && existingVendors[0].vendor_id) {
      const parts = existingVendors[0].vendor_id.split('-');
      if (parts.length === 3) {
        serialNumber = parseInt(parts[0]) + 1;
      }
    }
    
    const vendorId = `${String(serialNumber).padStart(3, '0')}-${month}-${year}`;
    
    console.log(`\n🔢 Auto-generated Vendor ID: ${vendorId}`);

    // Insert test vendor
    const insertQuery = `
      INSERT INTO vendors (
        vendor_id, vendor_name, vendor_type, industry_category, status,
        contact_person, contact_designation, phone, email,
        address_street, address_city, address_state, address_country, address_pin, website,
        gst_vat_tax_id, pan_legal_reg_no, msme_ssi_registration, iso_certifications,
        bank_name, bank_account_no, ifsc_swift_code, currency_preference, payment_terms, credit_limit,
        avg_quality_rating, avg_delivery_rating, avg_reliability_rating, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await connection.query(insertQuery, [
      vendorId,
      testVendor.vendor_name,
      testVendor.vendor_type,
      testVendor.industry_category,
      testVendor.status,
      testVendor.contact_person,
      testVendor.contact_designation,
      testVendor.phone,
      testVendor.email,
      testVendor.address_street,
      testVendor.address_city,
      testVendor.address_state,
      testVendor.address_country,
      testVendor.address_pin,
      testVendor.website,
      testVendor.gst_vat_tax_id,
      testVendor.pan_legal_reg_no,
      testVendor.msme_ssi_registration,
      testVendor.iso_certifications,
      testVendor.bank_name,
      testVendor.bank_account_no,
      testVendor.ifsc_swift_code,
      testVendor.currency_preference,
      testVendor.payment_terms,
      testVendor.credit_limit,
      testVendor.avg_quality_rating,
      testVendor.avg_delivery_rating,
      testVendor.avg_reliability_rating,
      testVendor.remarks
    ]);

    console.log(`✅ Test vendor created with ID: ${result.insertId}`);

    // Retrieve and verify the vendor
    const [vendors] = await connection.query(
      'SELECT * FROM vendors WHERE id = ?',
      [result.insertId]
    );

    if (vendors.length > 0) {
      const vendor = vendors[0];
      console.log('\n📦 Vendor Details:');
      console.log(`  Vendor ID: ${vendor.vendor_id}`);
      console.log(`  Name: ${vendor.vendor_name}`);
      console.log(`  Type: ${vendor.vendor_type}`);
      console.log(`  Category: ${vendor.industry_category}`);
      console.log(`  Status: ${vendor.status}`);
      console.log(`  Contact: ${vendor.contact_person} (${vendor.contact_designation})`);
      console.log(`  Phone: ${vendor.phone}`);
      console.log(`  Email: ${vendor.email}`);
      console.log(`  City: ${vendor.address_city}, ${vendor.address_state}, ${vendor.address_country}`);
      console.log(`  GST: ${vendor.gst_vat_tax_id}`);
      console.log(`  Bank: ${vendor.bank_name} - ${vendor.bank_account_no}`);
      console.log(`  Payment Terms: ${vendor.payment_terms}`);
      console.log(`  Credit Limit: ${vendor.currency_preference} ${vendor.credit_limit}`);
      console.log(`  Quality Rating: ${vendor.avg_quality_rating}/5`);
      console.log(`  Delivery Rating: ${vendor.avg_delivery_rating}/5`);
      console.log(`  Reliability Rating: ${vendor.avg_reliability_rating}/5`);
    }

    // Get vendor statistics
    const [stats] = await connection.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END) as inactive,
        SUM(CASE WHEN status = 'Blacklisted' THEN 1 ELSE 0 END) as blacklisted,
        AVG(avg_quality_rating) as avg_quality,
        AVG(avg_delivery_rating) as avg_delivery,
        AVG(avg_reliability_rating) as avg_reliability
      FROM vendors
    `);

    console.log('\n📊 Vendor Statistics:');
    console.log(`  Total Vendors: ${stats[0].total}`);
    console.log(`  Active: ${stats[0].active}`);
    console.log(`  Inactive: ${stats[0].inactive}`);
    console.log(`  Blacklisted: ${stats[0].blacklisted}`);
    console.log(`  Avg Quality Rating: ${stats[0].avg_quality ? stats[0].avg_quality.toFixed(2) : 'N/A'}`);
    console.log(`  Avg Delivery Rating: ${stats[0].avg_delivery ? stats[0].avg_delivery.toFixed(2) : 'N/A'}`);
    console.log(`  Avg Reliability Rating: ${stats[0].avg_reliability ? stats[0].avg_reliability.toFixed(2) : 'N/A'}`);

    console.log('\n✅ All tests passed!');
    console.log(`\n🗑️  To delete this test vendor, run:`);
    console.log(`   DELETE FROM vendors WHERE id = ${result.insertId};`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n👋 Database connection closed');
    }
  }
}

testVendorOperations();
