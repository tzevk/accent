import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();

    await db.execute(`CREATE TABLE IF NOT EXISTS softwares (
      id VARCHAR(36) PRIMARY KEY,
      category_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    const [rows] = await db.execute('SELECT id, category_id, name, provider, created_at, updated_at FROM softwares ORDER BY name');
    await db.end();
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Softwares GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load softwares', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { category_id, name, provider } = body;
    if (!category_id || !name) return NextResponse.json({ success: false, error: 'category_id and name are required' }, { status: 400 });

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS softwares (
      id VARCHAR(36) PRIMARY KEY,
      category_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    await db.execute('INSERT INTO softwares (id, category_id, name, provider) VALUES (?, ?, ?, ?)', [id, category_id, name, provider]);
    await db.end();
    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Softwares POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create software', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, name, provider, category_id } = body;
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const db = await dbConnect();
    await db.execute('UPDATE softwares SET name = COALESCE(?, name), provider = COALESCE(?, provider), category_id = COALESCE(?, category_id) WHERE id = ?', [name ?? null, provider ?? null, category_id ?? null, id]);
    await db.end();
    return NextResponse.json({ success: true, message: 'Software updated' });
  } catch (error) {
    console.error('Softwares PUT error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update software', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const db = await dbConnect();
    try {
      await db.execute('DELETE FROM software_versions WHERE software_id = ?', [id]);
    } catch {}
    await db.execute('DELETE FROM softwares WHERE id = ?', [id]);
    await db.end();
    return NextResponse.json({ success: true, message: 'Software deleted' });
  } catch (error) {
    console.error('Softwares DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete software', details: error.message }, { status: 500 });
  }
}
