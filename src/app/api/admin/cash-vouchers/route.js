import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/cash-vouchers
 * List all cash vouchers with pagination and filtering
 */
export async function GET(request) {
  let db;
  
  try {
    // Auth check
    let user;
    try {
      user = await getCurrentUser(request);
    } catch (authErr) {
      console.error('Auth check failed:', authErr?.message);
      return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
    }
    
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Only admin can access
    if (!user.is_super_admin && user.role?.code !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const type = searchParams.get('type') || '';
    const status = searchParams.get('status') || '';
    const offset = (page - 1) * limit;

    db = await dbConnect();
    
    // Ensure table exists with updated schema
    await db.execute(`
      CREATE TABLE IF NOT EXISTS cash_vouchers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        voucher_number VARCHAR(50) UNIQUE,
        voucher_date DATE,
        voucher_type ENUM('payment', 'receipt') DEFAULT 'payment',
        paid_to VARCHAR(255),
        payment_mode ENUM('cash', 'cheque') DEFAULT 'cash',
        total_amount DECIMAL(15,2) DEFAULT 0,
        amount_in_words TEXT,
        line_items JSON,
        prepared_by VARCHAR(255),
        checked_by VARCHAR(255),
        approved_by_name VARCHAR(255),
        receiver_signature VARCHAR(255),
        status ENUM('pending', 'approved', 'rejected', 'paid') DEFAULT 'pending',
        approved_by INT,
        approved_at DATETIME,
        notes TEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Add missing columns if table already exists
    try {
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS paid_to VARCHAR(255)');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS total_amount DECIMAL(15,2) DEFAULT 0');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS amount_in_words TEXT');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS line_items JSON');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS prepared_by VARCHAR(255)');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS checked_by VARCHAR(255)');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS approved_by_name VARCHAR(255)');
      await db.execute('ALTER TABLE cash_vouchers ADD COLUMN IF NOT EXISTS receiver_signature VARCHAR(255)');
    } catch (e) { /* columns may already exist */ }

    // Build query conditions
    let conditions = [];
    let params = [];
    
    if (type && type !== 'all') {
      conditions.push('voucher_type = ?');
      params.push(type);
    }
    
    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get vouchers with pagination
    const [vouchers] = await db.execute(
      `SELECT * FROM cash_vouchers ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get total count for pagination
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM cash_vouchers ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    // Get stats
    const [statsResult] = await db.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status IN ('approved', 'paid') THEN amount ELSE 0 END) as total_amount
      FROM cash_vouchers
    `);
    
    const stats = statsResult[0] || { total: 0, pending: 0, approved: 0, rejected: 0, total_amount: 0 };

    return NextResponse.json({
      success: true,
      data: vouchers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      stats: {
        total: Number(stats.total) || 0,
        pending: Number(stats.pending) || 0,
        approved: Number(stats.approved) || 0,
        rejected: Number(stats.rejected) || 0,
        total_amount: Number(stats.total_amount) || 0
      }
    });
    
  } catch (error) {
    console.error('Cash vouchers list error:', error?.message, error?.stack);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch cash vouchers', details: error?.message },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * POST /api/admin/cash-vouchers
 * Create a new cash voucher
 */
export async function POST(request) {
  let db;
  
  try {
    let user;
    try {
      user = await getCurrentUser(request);
    } catch (authErr) {
      return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
    }
    
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!user.is_super_admin && user.role?.code !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const data = await request.json();
    
    db = await dbConnect();
    
    // Generate voucher number if not provided
    let voucherNumber = data.voucher_number;
    if (!voucherNumber) {
      const [lastVoucher] = await db.execute(
        `SELECT voucher_number FROM cash_vouchers ORDER BY id DESC LIMIT 1`
      );
      
      voucherNumber = 'CV-0001';
      if (lastVoucher.length > 0 && lastVoucher[0].voucher_number) {
        const lastNum = parseInt(lastVoucher[0].voucher_number.replace('CV-', '')) || 0;
        voucherNumber = `CV-${String(lastNum + 1).padStart(4, '0')}`;
      }
    }

    const [result] = await db.execute(
      `INSERT INTO cash_vouchers (
        voucher_number, voucher_date, voucher_type, paid_to, 
        payment_mode, total_amount, amount_in_words, line_items,
        prepared_by, checked_by, approved_by_name, receiver_signature,
        status, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        voucherNumber,
        data.voucher_date || new Date().toISOString().split('T')[0],
        data.voucher_type || 'payment',
        data.paid_to || '',
        data.payment_mode || 'cash',
        data.total_amount || 0,
        data.amount_in_words || '',
        JSON.stringify(data.line_items || []),
        data.prepared_by || '',
        data.checked_by || '',
        data.approved_by || '',
        data.receiver_signature || '',
        data.status || 'pending',
        data.notes || '',
        user.id
      ]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: result.insertId,
        voucher_number: voucherNumber
      },
      message: 'Cash voucher created successfully'
    });
    
  } catch (error) {
    console.error('Create cash voucher error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'Failed to create cash voucher', details: error?.message },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * DELETE /api/admin/cash-vouchers
 * Delete a cash voucher by ID (passed as query param)
 */
export async function DELETE(request) {
  let db;
  
  try {
    let user;
    try {
      user = await getCurrentUser(request);
    } catch (authErr) {
      return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
    }
    
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!user.is_super_admin && user.role?.code !== 'admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Voucher ID is required' }, { status: 400 });
    }

    db = await dbConnect();
    
    const [result] = await db.execute(
      'DELETE FROM cash_vouchers WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ success: false, error: 'Voucher not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Cash voucher deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete cash voucher error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'Failed to delete cash voucher', details: error?.message },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}
