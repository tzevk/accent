import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch quotations
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
      CREATE TABLE IF NOT EXISTS quotations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        quotation_number VARCHAR(50) UNIQUE NOT NULL,
        client_name VARCHAR(255) NOT NULL,
        client_email VARCHAR(255),
        client_phone VARCHAR(50),
        client_address TEXT,
        subject VARCHAR(500),
        items JSON,
        subtotal DECIMAL(15, 2) DEFAULT 0,
        tax_rate DECIMAL(5, 2) DEFAULT 18,
        tax_amount DECIMAL(15, 2) DEFAULT 0,
        discount DECIMAL(15, 2) DEFAULT 0,
        total DECIMAL(15, 2) DEFAULT 0,
        notes TEXT,
        terms TEXT,
        valid_until DATE,
        status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      )
    `);

    // Ensure status column exists (for tables created before status was added)
    try {
      await connection.execute(`
        ALTER TABLE quotations 
        ADD COLUMN IF NOT EXISTS status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft'
      `);
    } catch (alterError) {
      // Column might already exist or DB doesn't support IF NOT EXISTS, ignore
      if (!alterError.message.includes('Duplicate column')) {
        console.log('Note: Could not add status column (may already exist)');
      }
    }

    // Build query
    let query = 'SELECT * FROM quotations WHERE 1=1';
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

    const [quotations] = await connection.execute(query, params);

    // Parse JSON items for each quotation
    const parsedQuotations = quotations.map(q => ({
      ...q,
      items: typeof q.items === 'string' ? JSON.parse(q.items) : q.items
    }));

    // Get stats - wrap in try-catch in case status column doesn't exist
    let stats = { total: 0, draft: 0, sent: 0, approved: 0, rejected: 0 };
    try {
      const [statsResult] = await connection.execute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
        FROM quotations
      `);
      stats = statsResult[0] || stats;
    } catch (statsError) {
      // If stats query fails, just return default stats with total count
      console.log('Stats query failed, using default:', statsError.message);
      stats.total = total;
    }

    return NextResponse.json({
      success: true,
      data: parsedQuotations,
      stats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching quotations:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch quotations' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// POST - Create new quotation
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.CREATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      quotation_number,
      client_name,
      client_email,
      client_phone,
      client_address,
      subject,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      notes,
      terms,
      valid_until,
      status
    } = body;

    if (!quotation_number || !client_name) {
      return NextResponse.json(
        { success: false, error: 'Quotation number and client name are required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      `INSERT INTO quotations 
       (quotation_number, client_name, client_email, client_phone, client_address, subject, items, subtotal, tax_rate, tax_amount, discount, total, notes, terms, valid_until, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quotation_number,
        client_name,
        client_email || null,
        client_phone || null,
        client_address || null,
        subject || null,
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 18,
        tax_amount || 0,
        discount || 0,
        total || 0,
        notes || null,
        terms || null,
        valid_until || null,
        status || 'draft',
        authResult.user?.id || null
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Quotation created successfully',
      id: result.insertId
    });
  } catch (error) {
    console.error('Error creating quotation:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { success: false, error: 'A quotation with this number already exists' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// PUT - Update quotation
export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      id,
      quotation_number,
      client_name,
      client_email,
      client_phone,
      client_address,
      subject,
      items,
      subtotal,
      tax_rate,
      tax_amount,
      discount,
      total,
      notes,
      terms,
      valid_until,
      status
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Quotation ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      `UPDATE quotations SET
       quotation_number = ?,
       client_name = ?,
       client_email = ?,
       client_phone = ?,
       client_address = ?,
       subject = ?,
       items = ?,
       subtotal = ?,
       tax_rate = ?,
       tax_amount = ?,
       discount = ?,
       total = ?,
       notes = ?,
       terms = ?,
       valid_until = ?,
       status = ?
       WHERE id = ?`,
      [
        quotation_number,
        client_name,
        client_email || null,
        client_phone || null,
        client_address || null,
        subject || null,
        JSON.stringify(items || []),
        subtotal || 0,
        tax_rate || 18,
        tax_amount || 0,
        discount || 0,
        total || 0,
        notes || null,
        terms || null,
        valid_until || null,
        status || 'draft',
        id
      ]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Quotation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Quotation updated successfully'
    });
  } catch (error) {
    console.error('Error updating quotation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}

// DELETE - Delete quotation
export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.DELETE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Quotation ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [result] = await connection.execute(
      'DELETE FROM quotations WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Quotation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Quotation deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting quotation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete quotation' },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
