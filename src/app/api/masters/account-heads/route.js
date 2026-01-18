import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// Create table if not exists
async function ensureTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS account_head_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_head_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

// GET - List all account heads
export async function GET() {
  let db;
  try {
    db = await dbConnect();
    await ensureTable(db);

    const [rows] = await db.execute(`
      SELECT * FROM account_head_master 
      ORDER BY account_head_name ASC
    `);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching account heads:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch account heads' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// POST - Create new account head
export async function POST(request) {
  let db;
  try {
    const body = await request.json();
    const { account_head_name, is_active = true, created_by } = body;

    if (!account_head_name?.trim()) {
      return NextResponse.json({ success: false, error: 'Account head name is required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTable(db);

    const [result] = await db.execute(
      `INSERT INTO account_head_master (account_head_name, is_active, created_by) VALUES (?, ?, ?)`,
      [account_head_name.trim(), is_active ? 1 : 0, created_by || null]
    );

    return NextResponse.json({ 
      success: true, 
      data: { id: result.insertId, account_head_name, is_active } 
    });
  } catch (error) {
    console.error('Error creating account head:', error);
    return NextResponse.json({ success: false, error: 'Failed to create account head' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// PUT - Update account head
export async function PUT(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { account_head_name, is_active } = body;

    if (!account_head_name?.trim()) {
      return NextResponse.json({ success: false, error: 'Account head name is required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTable(db);

    await db.execute(
      `UPDATE account_head_master SET account_head_name = ?, is_active = ? WHERE id = ?`,
      [account_head_name.trim(), is_active ? 1 : 0, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating account head:', error);
    return NextResponse.json({ success: false, error: 'Failed to update account head' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// DELETE - Delete account head
export async function DELETE(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    db = await dbConnect();
    await db.execute('DELETE FROM account_head_master WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting account head:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete account head' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
