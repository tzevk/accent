import { dbConnect } from '@/utils/database';

// GET all companies
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get('search') || '').trim().toLowerCase();

    const db = await dbConnect();
    
    // Create companies table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS companies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id VARCHAR(50) UNIQUE,
        company_name VARCHAR(255) NOT NULL,
        industry VARCHAR(100),
        company_size VARCHAR(50),
        website VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100),
        postal_code VARCHAR(20),
        description TEXT,
        founded_year INT,
        revenue VARCHAR(100),
        notes TEXT,
        location VARCHAR(255),
        contact_person VARCHAR(100),
        designation VARCHAR(100),
        mobile_number VARCHAR(20),
        sector VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Build base SQL and optionally apply a search WHERE clause (case-insensitive)
    let sql = `SELECT c.*, COALESCE(COUNT(DISTINCT l.id), 0) AS lead_count, COALESCE(COUNT(f.id), 0) AS follow_up_count
       FROM companies c
       -- leads table stores company_name (string) rather than a numeric company_id
       LEFT JOIN leads l ON l.company_name = c.company_name
       LEFT JOIN follow_ups f ON f.lead_id = l.id`;

    const params = [];
    if (search) {
      sql += ` WHERE (LOWER(c.company_name) LIKE ? OR LOWER(c.company_id) LIKE ? OR LOWER(c.city) LIKE ? OR LOWER(c.contact_person) LIKE ? OR LOWER(c.industry) LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ` GROUP BY c.id ORDER BY c.company_name ASC`;

    const [rows] = await db.execute(sql, params);
    
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: rows 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch companies' 
    }, { status: 500 });
  }
}

// POST - Create new company
export async function POST(request) {
  let db;
  try {
    const data = await request.json();
    // console.log('Received data:', data);
    
    const {
      company_id,
      company_name,
      industry,
      company_size,
      website,
      phone,
      email,
      address,
      city,
      state,
      country,
      postal_code,
      description,
      founded_year,
      revenue,
      notes,
      location,
      contact_person,
      designation,
      mobile_number,
      sector
    } = data;

    if (!company_name) {
      return Response.json({ 
        success: false, 
        error: 'Company name is required' 
      }, { status: 400 });
    }

    db = await dbConnect();

    // Create companies table if it doesn't exist (ensure company_id uniqueness)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS companies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id VARCHAR(50) UNIQUE,
        company_name VARCHAR(255) NOT NULL,
        industry VARCHAR(100),
        company_size VARCHAR(50),
        website VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100),
        postal_code VARCHAR(20),
        description TEXT,
        founded_year INT,
        revenue VARCHAR(100),
        notes TEXT,
        location VARCHAR(255),
        contact_person VARCHAR(100),
        designation VARCHAR(100),
        mobile_number VARCHAR(20),
        sector VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    // If company_id provided, check for duplicates
    if (company_id) {
      const [existing] = await db.execute('SELECT id FROM companies WHERE company_id = ? LIMIT 1', [company_id]);
      if (existing && existing.length > 0) {
        return Response.json({ success: false, error: 'Company with this company_id already exists' }, { status: 409 });
      }
    }

    // Insert the new company
    const [result] = await db.execute(
      `INSERT INTO companies (
        company_id, company_name, industry, company_size, website, phone, email,
        address, city, state, country, postal_code, description,
        founded_year, revenue, notes, location, contact_person, designation,
        mobile_number, sector
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id || null, company_name, industry || null, company_size || null, 
        website || null, phone || null, email || null, address || null, 
        city || null, state || null, country || null, postal_code || null, 
        description || null, founded_year || null, revenue || null, notes || null,
        location || null, contact_person || null, designation || null,
        mobile_number || null, sector || null
      ]
    );
    // Fetch the created company
    const [rows] = await db.execute('SELECT * FROM companies WHERE id = ?', [result.insertId]);
    const created = rows && rows[0] ? rows[0] : { id: result.insertId };

    return Response.json({ success: true, data: created, message: 'Company created successfully' });
  } catch (error) {
    console.error('Database error details:', error);
    if (error && error.code === 'ER_DUP_ENTRY') {
      return Response.json({ success: false, error: 'Duplicate entry' }, { status: 409 });
    }
    return Response.json({ success: false, error: 'Failed to create company: ' + (error.message || String(error)) }, { status: 500 });
  }
  finally {
    if (db) await db.end();
  }
}
