import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// Generate quotation number in format: ATSPL/Q/MM/YY-YY/XXX
function generateQuotationNumber(count) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // 01-12
  
  // Calculate financial year (April to March)
  // If current month is Jan-Mar, we're in the previous financial year
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  
  let fyStartYear, fyEndYear;
  if (currentMonth >= 4) {
    // April or later - current year is start of FY
    fyStartYear = currentYear;
    fyEndYear = currentYear + 1;
  } else {
    // Jan-Mar - previous year is start of FY
    fyStartYear = currentYear - 1;
    fyEndYear = currentYear;
  }
  
  // Format: YY-YY (e.g., 25-26)
  const fyString = `${String(fyStartYear).slice(-2)}-${String(fyEndYear).slice(-2)}`;
  
  // Number starts from 7 (after 6), so add 6 to count
  const sequenceNumber = count + 107;
  
  return `ATSPL/Q/${month}/${fyString}/${sequenceNumber}`;
}

// GET - Fetch quotation for a project
export async function GET(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    connection = await dbConnect();

    // Check if project_quotations table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS project_quotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        quotation_number VARCHAR(100),
        quotation_date DATE,
        client_name VARCHAR(255),
        enquiry_number VARCHAR(100),
        enquiry_quantity VARCHAR(255),
        scope_of_work TEXT,
        gross_amount DECIMAL(15, 2) DEFAULT 0,
        gst_percentage DECIMAL(5, 2) DEFAULT 18,
        gst_amount DECIMAL(15, 2) DEFAULT 0,
        net_amount DECIMAL(15, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        UNIQUE KEY unique_project (project_id)
      )
    `);

    // Add client_name column if it doesn't exist
    try {
      await connection.execute('ALTER TABLE project_quotations ADD COLUMN client_name VARCHAR(255)');
    } catch (e) {
      // Column already exists
    }

    // Fetch quotation for this project
    const [rows] = await connection.execute(
      'SELECT * FROM project_quotations WHERE project_id = ?',
      [id]
    );

    // Generate next quotation number if no quotation exists
    let nextQuotationNumber = '';
    if (rows.length === 0) {
      const [countResult] = await connection.execute(
        'SELECT COUNT(*) as count FROM project_quotations WHERE quotation_number IS NOT NULL AND quotation_number != ""'
      );
      const count = countResult[0]?.count || 0;
      nextQuotationNumber = generateQuotationNumber(count);
    }

    return NextResponse.json({
      success: true,
      data: rows[0] || null,
      nextQuotationNumber
    });
  } catch (error) {
    console.error('Error fetching project quotation:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// POST - Create or update quotation for a project
export async function POST(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const body = await request.json();
    
    const {
      quotation_number,
      quotation_date,
      client_name,
      enquiry_number,
      enquiry_quantity,
      scope_of_work,
      gross_amount,
      gst_percentage = 18,
      gst_amount,
      net_amount
    } = body;

    connection = await dbConnect();

    // Check if project_quotations table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS project_quotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        quotation_number VARCHAR(100),
        quotation_date DATE,
        client_name VARCHAR(255),
        enquiry_number VARCHAR(100),
        enquiry_quantity VARCHAR(255),
        scope_of_work TEXT,
        gross_amount DECIMAL(15, 2) DEFAULT 0,
        gst_percentage DECIMAL(5, 2) DEFAULT 18,
        gst_amount DECIMAL(15, 2) DEFAULT 0,
        net_amount DECIMAL(15, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_project_id (project_id),
        UNIQUE KEY unique_project (project_id)
      )
    `);

    // Add client_name column if it doesn't exist
    try {
      await connection.execute('ALTER TABLE project_quotations ADD COLUMN client_name VARCHAR(255)');
    } catch (e) {
      // Column already exists
    }

    // Check if quotation already exists for this project
    const [existing] = await connection.execute(
      'SELECT id FROM project_quotations WHERE project_id = ?',
      [id]
    );

    if (existing.length > 0) {
      // Update existing quotation
      await connection.execute(
        `UPDATE project_quotations SET
          quotation_number = ?,
          quotation_date = ?,
          client_name = ?,
          enquiry_number = ?,
          enquiry_quantity = ?,
          scope_of_work = ?,
          gross_amount = ?,
          gst_percentage = ?,
          gst_amount = ?,
          net_amount = ?,
          updated_at = NOW()
        WHERE project_id = ?`,
        [
          quotation_number,
          quotation_date || null,
          client_name || null,
          enquiry_number,
          enquiry_quantity,
          scope_of_work,
          gross_amount || 0,
          gst_percentage || 18,
          gst_amount || 0,
          net_amount || 0,
          id
        ]
      );
    } else {
      // Insert new quotation
      await connection.execute(
        `INSERT INTO project_quotations (
          project_id, quotation_number, quotation_date, client_name, enquiry_number,
          enquiry_quantity, scope_of_work, gross_amount, gst_percentage,
          gst_amount, net_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          quotation_number,
          quotation_date || null,
          client_name || null,
          enquiry_number,
          enquiry_quantity,
          scope_of_work,
          gross_amount || 0,
          gst_percentage || 18,
          gst_amount || 0,
          net_amount || 0
        ]
      );
    }

    // Fetch updated quotation
    const [rows] = await connection.execute(
      'SELECT * FROM project_quotations WHERE project_id = ?',
      [id]
    );

    return NextResponse.json({
      success: true,
      data: rows[0],
      message: existing.length > 0 ? 'Quotation updated' : 'Quotation created'
    });
  } catch (error) {
    console.error('Error saving project quotation:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
