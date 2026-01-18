import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// Create table if not exists
async function ensureTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS description_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      description_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

// GET - List all descriptions
export async function GET() {
  let db;
  try {
    db = await dbConnect();
    await ensureTable(db);

    const [rows] = await db.execute(`
      SELECT * FROM description_master 
      ORDER BY description_name ASC
    `);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching descriptions:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch descriptions' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// POST - Create new description
export async function POST(request) {
  let db;
  try {
    const body = await request.json();
    const { description_name, is_active = true, created_by } = body;

    if (!description_name?.trim()) {
      return NextResponse.json({ success: false, error: 'Description name is required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTable(db);

    const [result] = await db.execute(
      `INSERT INTO description_master (description_name, is_active, created_by) VALUES (?, ?, ?)`,
      [description_name.trim(), is_active ? 1 : 0, created_by || null]
    );

    return NextResponse.json({ 
      success: true, 
      data: { id: result.insertId, description_name, is_active } 
    });
  } catch (error) {
    console.error('Error creating description:', error);
    return NextResponse.json({ success: false, error: 'Failed to create description' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// PUT - Update description
export async function PUT(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { description_name, is_active } = body;

    if (!description_name?.trim()) {
      return NextResponse.json({ success: false, error: 'Description name is required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureTable(db);

    await db.execute(
      `UPDATE description_master SET description_name = ?, is_active = ? WHERE id = ?`,
      [description_name.trim(), is_active ? 1 : 0, id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating description:', error);
    return NextResponse.json({ success: false, error: 'Failed to update description' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// DELETE - Delete description
export async function DELETE(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }

    db = await dbConnect();
    await db.execute('DELETE FROM description_master WHERE id = ?', [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting description:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete description' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
