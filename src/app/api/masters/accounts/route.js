import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/masters/accounts
 * List all account heads
 */
export async function GET(request) {
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

    db = await dbConnect();
    
    // Create table if not exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS account_master (
        id INT PRIMARY KEY AUTO_INCREMENT,
        account_code VARCHAR(50) UNIQUE,
        account_name VARCHAR(255) NOT NULL,
        account_type ENUM('expense', 'income', 'asset', 'liability') DEFAULT 'expense',
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    let query = 'SELECT * FROM account_master';
    if (activeOnly) {
      query += ' WHERE is_active = TRUE';
    }
    query += ' ORDER BY account_name ASC';

    const [accounts] = await db.execute(query);

    return NextResponse.json({
      success: true,
      data: accounts
    });
    
  } catch (error) {
    console.error('Get accounts error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch accounts' },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * POST /api/masters/accounts
 * Create a new account
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

    const data = await request.json();
    const { account_code, account_name, account_type, description, is_active } = data;

    if (!account_code || !account_name) {
      return NextResponse.json({ success: false, error: 'Account code and name are required' }, { status: 400 });
    }

    db = await dbConnect();

    const [result] = await db.execute(
      `INSERT INTO account_master (account_code, account_name, account_type, description, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [account_code, account_name, account_type || 'expense', description || '', is_active !== false, user.id]
    );

    return NextResponse.json({
      success: true,
      message: 'Account created successfully',
      id: result.insertId
    });
    
  } catch (error) {
    console.error('Create account error:', error?.message);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, error: 'Account code already exists' }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create account' },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * PUT /api/masters/accounts?id=X
 * Update an account
 */
export async function PUT(request) {
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

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Account ID is required' }, { status: 400 });
    }

    const data = await request.json();
    const { account_code, account_name, account_type, description, is_active } = data;

    if (!account_code || !account_name) {
      return NextResponse.json({ success: false, error: 'Account code and name are required' }, { status: 400 });
    }

    db = await dbConnect();

    await db.execute(
      `UPDATE account_master 
       SET account_code = ?, account_name = ?, account_type = ?, description = ?, is_active = ?
       WHERE id = ?`,
      [account_code, account_name, account_type || 'expense', description || '', is_active !== false, id]
    );

    return NextResponse.json({
      success: true,
      message: 'Account updated successfully'
    });
    
  } catch (error) {
    console.error('Update account error:', error?.message);
    if (error.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ success: false, error: 'Account code already exists' }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: 'Failed to update account' },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}

/**
 * DELETE /api/masters/accounts?id=X
 * Delete an account
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

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Account ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    await db.execute('DELETE FROM account_master WHERE id = ?', [id]);

    return NextResponse.json({
      success: true,
      message: 'Account deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete account error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'Failed to delete account' },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}
