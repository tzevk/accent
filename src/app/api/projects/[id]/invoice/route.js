import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// Generate invoice number in format: ATS/I/MM-YY/XXX
function generateInvoiceNumber(count) {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // 01-12
  const year = String(now.getFullYear()).slice(-2); // Last 2 digits of year
  
  // Number starts from 228 (after 227), so add 227 to count
  const sequenceNumber = count + 228;
  
  return `ATS/I/${month}-${year}/${sequenceNumber}`;
}

// Create project_invoices table if it doesn't exist
async function ensureTableExists(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS project_invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      invoice_number VARCHAR(100),
      invoice_date DATE,
      company_name VARCHAR(255),
      city VARCHAR(100),
      invoice_amount DECIMAL(15, 2),
      project_number VARCHAR(100),
      expenses_head VARCHAR(255),
      payment DECIMAL(15, 2),
      purchase_description TEXT,
      payment_overdue_days INT DEFAULT 0,
      remarks TEXT,
      tab_type VARCHAR(50) DEFAULT 'invoice',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project_id (project_id),
      INDEX idx_invoice_number (invoice_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Safely add new columns to existing tables
  const migrations = [
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS project_number VARCHAR(100)",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS expenses_head VARCHAR(255)",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS payment DECIMAL(15,2)",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS purchase_description TEXT",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS payment_overdue_days INT DEFAULT 0",
    "ALTER TABLE project_invoices ADD COLUMN IF NOT EXISTS tab_type VARCHAR(50) DEFAULT 'invoice'",
  ];
  for (const sql of migrations) {
    try { await connection.execute(sql); } catch (_) { /* column may already exist */ }
  }
}

// GET - Fetch all invoices for a project
export async function GET(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Project ID required' }, { status: 400 });
    }

    connection = await dbConnect();
    await ensureTableExists(connection);

    const [invoices] = await connection.execute(
      `SELECT * FROM project_invoices WHERE project_id = ? ORDER BY created_at DESC`,
      [id]
    );

    // Generate next invoice number
    const [countResult] = await connection.execute(
      'SELECT COUNT(*) as count FROM project_invoices WHERE invoice_number IS NOT NULL AND invoice_number != ""'
    );
    const count = countResult[0]?.count || 0;
    const nextInvoiceNumber = generateInvoiceNumber(count);

    return NextResponse.json({ 
      success: true, 
      invoices: invoices || [],
      nextInvoiceNumber
    });

  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// POST - Create a new invoice
export async function POST(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const data = await request.json();
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Project ID required' }, { status: 400 });
    }

    connection = await dbConnect();
    await ensureTableExists(connection);

    const {
      invoice_number,
      invoice_date,
      company_name,
      city,
      invoice_amount,
      project_number,
      expenses_head,
      payment,
      purchase_description,
      payment_overdue_days,
      remarks,
      tab_type
    } = data;

    // Insert new invoice
    const [result] = await connection.execute(
      `INSERT INTO project_invoices 
       (project_id, invoice_number, invoice_date, company_name, city, invoice_amount,
        project_number, expenses_head, payment, purchase_description, payment_overdue_days, remarks, tab_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        invoice_number || null,
        invoice_date || null,
        company_name || null,
        city || null,
        invoice_amount || null,
        project_number || null,
        expenses_head || null,
        payment || null,
        purchase_description || null,
        payment_overdue_days || 0,
        remarks || null,
        tab_type || 'invoice'
      ]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Invoice created successfully',
      invoiceId: result.insertId
    });

  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// PUT - Update an existing invoice
export async function PUT(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const data = await request.json();
    
    if (!id || !data.invoiceId) {
      return NextResponse.json({ success: false, error: 'Project ID and Invoice ID required' }, { status: 400 });
    }

    connection = await dbConnect();
    await ensureTableExists(connection);

    const {
      invoiceId,
      invoice_number,
      invoice_date,
      company_name,
      city,
      invoice_amount,
      project_number,
      expenses_head,
      payment,
      purchase_description,
      payment_overdue_days,
      remarks,
      tab_type
    } = data;

    await connection.execute(
      `UPDATE project_invoices 
       SET invoice_number = ?, invoice_date = ?, company_name = ?, city = ?,
           invoice_amount = ?, project_number = ?, expenses_head = ?, payment = ?,
           purchase_description = ?, payment_overdue_days = ?, remarks = ?, tab_type = ?
       WHERE id = ? AND project_id = ?`,
      [
        invoice_number || null,
        invoice_date || null,
        company_name || null,
        city || null,
        invoice_amount || null,
        project_number || null,
        expenses_head || null,
        payment || null,
        purchase_description || null,
        payment_overdue_days || 0,
        remarks || null,
        tab_type || 'invoice',
        invoiceId,
        id
      ]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Invoice updated successfully'
    });

  } catch (error) {
    console.error('Error updating invoice:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// DELETE - Delete an invoice
export async function DELETE(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get('invoiceId');
    
    if (!id || !invoiceId) {
      return NextResponse.json({ success: false, error: 'Project ID and Invoice ID required' }, { status: 400 });
    }

    connection = await dbConnect();
    
    await connection.execute(
      `DELETE FROM project_invoices WHERE id = ? AND project_id = ?`,
      [invoiceId, id]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Invoice deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting invoice:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
