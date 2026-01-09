import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch invoices
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const status = searchParams.get('status');
    const offset = (page - 1) * limit;

    connection = await dbConnect();

    // Check if table exists, create if not
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        invoice_number VARCHAR(50) UNIQUE NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        client_phone VARCHAR(50),
        client_address TEXT,
        description VARCHAR(500),
        items JSON,
        subtotal DECIMAL(15, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 2) DEFAULT 18,
        tax_amount DECIMAL(15, 2) DEFAULT 0,
        discount DECIMAL(15, 2) DEFAULT 0,
        total DECIMAL(15, 2) DEFAULT 0,
        amount_paid DECIMAL(15, 2) DEFAULT 0,
        balance_due DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        due_date DATE,
        status ENUM('draft', 'sent', 'paid', 'overdue', 'cancelled') DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        INDEX idx_due_date (due_date)
      )
    `);

    // Build query
    let query = 'SELECT * FROM invoices WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }

    // Get total count
    const countQuery = query.replace('*', 'COUNT(*) as total');
    const [countResult] = await connection.execute(countQuery, params);
    const total = countResult?.[0]?.total || 0;

    // Get paginated results
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [invoices] = await connection.execute(query, params);

    // Parse JSON items for each invoice
    const parsedInvoices = invoices.map(inv => ({
      ...inv,
      items: typeof inv.items === 'string' ? JSON.parse(inv.items) : inv.items
    }));

    // Get stats
    let stats = { total: 0, draft: 0, sent: 0, paid: 0, overdue: 0, cancelled: 0 };
    try {
      const [statsResult] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM invoices
      `);
      stats = statsResult[0] || stats;
    } catch (statsError) {
      console.error('Error fetching stats:', statsError);
    }

    return NextResponse.json({
      success: true,
      data: parsedInvoices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      stats
    });

  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch invoices', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// Helper function to generate invoice number
function generateInvoiceNumber(count) {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const num = (count + 1).toString().padStart(4, '0');
  return `INV-${year}${month}-${num}`;
}

// POST - Create new invoice
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.WRITE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    
    const {
      client_name,
      client_email,
      client_phone,
      client_address,
      description,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      amount_paid,
      balance_due,
      notes,
      terms,
      due_date,
      status
    } = body;

    if (!client_name) {
      return NextResponse.json(
        { success: false, message: 'Client name is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    // Get count for invoice number generation
    const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM invoices');
    const count = countResult[0]?.count || 0;
    const invoiceNumber = generateInvoiceNumber(count);

    // Insert invoice
    const [result] = await connection.execute(
      `INSERT INTO invoices (
        invoice_number, client_name, client_email, client_phone, client_address,
        description, items, subtotal, tax_rate, tax_amount, discount, total,
        amount_paid, balance_due, notes, terms, due_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNumber,
        client_name,
        client_email || null,
        client_phone || null,
        client_address || null,
        description || null,
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 18,
        tax_amount || 0,
        discount || 0,
        total || 0,
        amount_paid || 0,
        balance_due || total || 0,
        notes || null,
        terms || null,
        due_date || null,
        status || 'draft'
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Invoice created successfully',
      data: {
        id: result.insertId,
        invoice_number: invoiceNumber
      }
    });

  } catch (error) {
    console.error('Error creating invoice:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create invoice', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
