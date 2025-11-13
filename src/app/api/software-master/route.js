import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();

    await db.execute(`CREATE TABLE IF NOT EXISTS software_categories (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS softwares (
      id VARCHAR(36) PRIMARY KEY,
      category_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      provider VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    await db.execute(`CREATE TABLE IF NOT EXISTS software_versions (
      id VARCHAR(36) PRIMARY KEY,
      software_id VARCHAR(36) NOT NULL,
      name VARCHAR(255) NOT NULL,
      release_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    const [cats] = await db.execute('SELECT id, name, description, status, created_at, updated_at FROM software_categories ORDER BY name');
    let softwares = [];
    try {
      const [sws] = await db.execute('SELECT id, category_id, name, provider, created_at, updated_at FROM softwares ORDER BY name');
      softwares = sws;
    } catch {
      softwares = [];
    }

    let versions = [];
    try {
      const [vers] = await db.execute('SELECT id, software_id, name, release_date, notes, created_at, updated_at FROM software_versions ORDER BY name');
      versions = vers;
    } catch {
      versions = [];
    }

    await db.end();

    const mapped = cats.map((cat) => ({
      id: cat.id,
      name: cat.name,
      description: cat.description,
      status: cat.status,
      created_at: cat.created_at,
      updated_at: cat.updated_at,
      softwares: (softwares.filter((s) => s.category_id === cat.id) || []).map((s) => ({
        id: s.id,
        name: s.name,
        provider: s.provider,
        created_at: s.created_at,
        updated_at: s.updated_at,
        versions: (versions.filter((v) => String(v.software_id) === String(s.id)) || []).map((v) => ({ id: v.id, name: v.name, release_date: v.release_date, notes: v.notes }))
      }))
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Software master GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load software master', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { name, description = '', status = 'active' } = body;
    if (!name) return NextResponse.json({ success: false, error: 'Category name is required' }, { status: 400 });

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(`CREATE TABLE IF NOT EXISTS software_categories (
      id VARCHAR(36) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    await db.execute('INSERT INTO software_categories (id, name, description, status) VALUES (?, ?, ?, ?)', [id, name, description, status]);
    await db.end();

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Software master POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create category', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, name, description, status } = body;
    if (!id) return NextResponse.json({ success: false, error: 'Category id is required' }, { status: 400 });

    const db = await dbConnect();
    await db.execute(`UPDATE software_categories SET name = COALESCE(?, name), description = COALESCE(?, description), status = COALESCE(?, status) WHERE id = ?`, [name ?? null, description ?? null, status ?? null, id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Category updated' });
  } catch (error) {
    console.error('Software master PUT error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update category', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'Category id is required' }, { status: 400 });

    const db = await dbConnect();
    try {
      await db.execute('DELETE FROM software_versions WHERE software_id IN (SELECT id FROM softwares WHERE category_id = ?)', [id]);
    } catch {
      // ignore if table missing
    }
    try {
      await db.execute('DELETE FROM softwares WHERE category_id = ?', [id]);
    } catch {
      // ignore
    }
    await db.execute('DELETE FROM software_categories WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Category deleted' });
  } catch (error) {
    console.error('Software master DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete category', details: error.message }, { status: 500 });
  }
}
