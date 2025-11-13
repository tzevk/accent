import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS software_versions (
      id VARCHAR(36) PRIMARY KEY,
      software_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      release_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    const [rows] = await db.execute('SELECT id, software_id, name, release_date, notes, created_at, updated_at FROM software_versions ORDER BY name');
    await db.end();
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Software versions GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load software versions', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { software_id, name, release_date, notes } = body;
    if (!software_id || !name) return NextResponse.json({ success: false, error: 'software_id and name are required' }, { status: 400 });

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS software_versions (
      id VARCHAR(36) PRIMARY KEY,
      software_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      release_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    await db.execute('INSERT INTO software_versions (id, software_id, name, release_date, notes) VALUES (?, ?, ?, ?, ?)', [id, software_id, name, release_date, notes]);
    await db.end();
    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Software versions POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create software version', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, name, release_date, notes, software_id } = body;
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const db = await dbConnect();
    await db.execute('UPDATE software_versions SET name = COALESCE(?, name), release_date = COALESCE(?, release_date), notes = COALESCE(?, notes), software_id = COALESCE(?, software_id) WHERE id = ?', [name ?? null, release_date ?? null, notes ?? null, software_id ?? null, id]);
    await db.end();
    return NextResponse.json({ success: true, message: 'Software version updated' });
  } catch (error) {
    console.error('Software versions PUT error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update software version', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const db = await dbConnect();
    await db.execute('DELETE FROM software_versions WHERE id = ?', [id]);
    await db.end();
    return NextResponse.json({ success: true, message: 'Software version deleted' });
  } catch (error) {
    console.error('Software versions DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete software version', details: error.message }, { status: 500 });
  }
}
