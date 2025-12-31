import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.VENDORS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;
  let db;
  try {
    db = await dbConnect();
    
    // Create vendors table if it doesn't exist
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
    
    await db.execute(createTableQuery);

    // Add columns if they don't exist (for existing tables)
    const alterTableQueries = [
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_id VARCHAR(50) UNIQUE`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contact_designation VARCHAR(100)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_street VARCHAR(500)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_city VARCHAR(100)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_state VARCHAR(100)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_country VARCHAR(100)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS address_pin VARCHAR(20)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS iso_certifications TEXT`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS other_compliance_docs TEXT`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS bank_account_no VARCHAR(100)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ifsc_swift_code VARCHAR(50)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS currency_preference VARCHAR(10)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(255)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS credit_limit DECIMAL(15, 2)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS previous_projects TEXT`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS avg_quality_rating DECIMAL(2, 1)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS avg_delivery_rating DECIMAL(2, 1)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS avg_reliability_rating DECIMAL(2, 1)`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS blacklist_notes TEXT`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contract_attachments TEXT`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS certificate_attachments TEXT`,
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS profile_attachments TEXT`
    ];

    for (const alterQuery of alterTableQueries) {
      try {
        await db.execute(alterQuery);
      } catch (err) {
        // Ignore errors for columns that already exist
        if (!err.message.includes('Duplicate column name')) {
          console.error('Error altering table:', err);
        }
      }
    }

    // Fetch all vendors
    const [vendors] = await db.query('SELECT * FROM vendors ORDER BY created_at DESC');

    return Response.json({
      success: true,
      data: vendors
    });

  } catch (error) {
    console.error('Error fetching vendors:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch (e) { console.error('Error releasing connection:', e); }
    }
  }
}

export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.VENDORS, PERMISSIONS.CREATE);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    db = await dbConnect();
    const data = await request.json();
    const {
      vendor_id,
      vendor_name,
      vendor_type,
      industry_category,
      status,
      contact_person,
      contact_designation,
      phone,
      email,
      address_street,
      address_city,
      address_state,
      address_country,
      address_pin,
      website,
      gst_vat_tax_id,
      pan_legal_reg_no,
      msme_ssi_registration,
      iso_certifications,
      other_compliance_docs,
      bank_name,
      bank_account_no,
      ifsc_swift_code,
      currency_preference,
      payment_terms,
      credit_limit,
      previous_projects,
      avg_quality_rating,
      avg_delivery_rating,
      avg_reliability_rating,
      blacklist_notes,
      remarks,
      contract_attachments,
      certificate_attachments,
      profile_attachments
    } = data;

    // Validate required fields
    if (!vendor_name) {
      return Response.json({
        success: false,
        error: 'Vendor name is required'
      }, { status: 400 });
    }

    // Auto-generate vendor_id if not provided
    let finalVendorId = vendor_id;
    if (!finalVendorId || finalVendorId.trim() === '') {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      
      // Get the highest vendor_id for this month/year
      const monthYearPattern = `%-${month}-${year}`;
      const [existingVendors] = await db.query(
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
      
      finalVendorId = `${String(serialNumber).padStart(3, '0')}-${month}-${year}`;
    }

    const insertQuery = `
      INSERT INTO vendors (
        vendor_id, vendor_name, vendor_type, industry_category, status,
        contact_person, contact_designation, phone, email,
        address_street, address_city, address_state, address_country, address_pin, website,
        gst_vat_tax_id, pan_legal_reg_no, msme_ssi_registration, iso_certifications, other_compliance_docs,
        bank_name, bank_account_no, ifsc_swift_code, currency_preference, payment_terms, credit_limit,
        previous_projects, avg_quality_rating, avg_delivery_rating, avg_reliability_rating, 
        blacklist_notes, remarks,
        contract_attachments, certificate_attachments, profile_attachments
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.execute(insertQuery, [
      finalVendorId, vendor_name, vendor_type, industry_category, status || 'Active',
      contact_person, contact_designation, phone, email,
      address_street, address_city, address_state, address_country, address_pin, website,
      gst_vat_tax_id, pan_legal_reg_no, msme_ssi_registration, iso_certifications, other_compliance_docs,
      bank_name, bank_account_no, ifsc_swift_code, currency_preference || 'INR', payment_terms, 
      credit_limit && credit_limit !== '' ? credit_limit : null,
      previous_projects, 
      avg_quality_rating && avg_quality_rating !== '' ? avg_quality_rating : null, 
      avg_delivery_rating && avg_delivery_rating !== '' ? avg_delivery_rating : null, 
      avg_reliability_rating && avg_reliability_rating !== '' ? avg_reliability_rating : null,
      blacklist_notes, remarks,
      contract_attachments, certificate_attachments, profile_attachments
    ]);

    return Response.json({
      success: true,
      data: { id: result.insertId, vendor_id: finalVendorId },
      message: 'Vendor created successfully'
    });

  } catch (error) {
    console.error('Error creating vendor:', error);
    return Response.json({
      success: false,
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch (e) { console.error('Error releasing connection:', e); }
    }
  }
}
