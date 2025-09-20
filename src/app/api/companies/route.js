import { dbConnect } from '@/utils/database';

// GET all companies
export async function GET() {
  try {
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    const [rows] = await db.execute(
      'SELECT * FROM companies ORDER BY company_name ASC'
    );
    
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
  try {
    const data = await request.json();
    console.log('Received data:', data);
    
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
      notes
    } = data;

    if (!company_name) {
      return Response.json({ 
        success: false, 
        error: 'Company name is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();
    console.log('Database connected successfully');
    
    // Create companies table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS companies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id VARCHAR(50),
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('Table creation/verification completed');
    
    // Insert the new company
    const [result] = await db.execute(
      `INSERT INTO companies (
        company_id, company_name, industry, company_size, website, phone, email,
        address, city, state, country, postal_code, description,
        founded_year, revenue, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id || null, company_name, industry || null, company_size || null, 
        website || null, phone || null, email || null, address || null, 
        city || null, state || null, country || null, postal_code || null, 
        description || null, founded_year || null, revenue || null, notes || null
      ]
    );
    
    console.log('Insert successful, ID:', result.insertId);
    await db.end();
    
    return Response.json({ 
      success: true, 
      data: { id: result.insertId },
      message: 'Company created successfully' 
    });
  } catch (error) {
    console.error('Database error details:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to create company: ' + error.message 
    }, { status: 500 });
  }
}
