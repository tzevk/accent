import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';

export async function GET() {
  try {
    const db = await dbConnect();

    // Create documents_master table if it doesn't exist
    await db.execute(`
      CREATE TABLE IF NOT EXISTS documents_master (
        id VARCHAR(36) PRIMARY KEY,
        doc_key VARCHAR(100) UNIQUE,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await db.execute(
      'SELECT id, doc_key, name, status, description, created_at, updated_at FROM documents_master ORDER BY name'
    );
    await db.end();

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Document master GET error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load documents master', details: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { doc_key, name, status = 'active', description = '' } = body;

    if (!name || !doc_key) {
      return NextResponse.json({ success: false, error: 'Document key and name are required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await db.execute(
      'INSERT INTO documents_master (id, doc_key, name, status, description) VALUES (?, ?, ?, ?, ?)',
      [id, doc_key, name, status, description]
    );
    await db.end();

    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    console.error('Document master POST error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create document type', details: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const { id, doc_key, name, status, description } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Document id is required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute(
      `UPDATE documents_master
       SET doc_key = COALESCE(?, doc_key),
           name = COALESCE(?, name),
           status = COALESCE(?, status),
           description = COALESCE(?, description)
       WHERE id = ?`,
      [doc_key ?? null, name ?? null, status ?? null, description ?? null, id]
    );
    await db.end();

    return NextResponse.json({ success: true, message: 'Document updated' });
  } catch (error) {
    console.error('Document master PUT error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update document', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Document id is required' }, { status: 400 });
    }

    const db = await dbConnect();
    await db.execute('DELETE FROM documents_master WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('Document master DELETE error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete document', details: error.message }, { status: 500 });
  }
}
