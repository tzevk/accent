import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

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
  // RBAC check
  const authResultPost = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.UPDATE);
  if (authResultPost.authorized === false) return authResultPost.response;

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
  // RBAC check
  const authResultPut = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.UPDATE);
  if (authResultPut.authorized === false) return authResultPut.response;

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
  // RBAC check
  const authResultDel = await ensurePermission(request, RESOURCES.SETTINGS, PERMISSIONS.DELETE);
  if (authResultDel.authorized === false) return authResultDel.response;

  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    console.log('DELETE version request - ID:', id);
    
    if (!id) {
      console.log('DELETE version failed - no ID provided');
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    db = await dbConnect();
    
    // Check if version exists before deleting
    const [existing] = await db.execute('SELECT id, software_id, name FROM software_versions WHERE id = ?', [id]);
    console.log('DELETE version - existing check:', existing);
    
    if (existing.length === 0) {
      console.log('DELETE version failed - version not found');
      await db.end();
      return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });
    }
    
    console.log('DELETE version - attempting to delete:', existing[0]);
    const [result] = await db.execute('DELETE FROM software_versions WHERE id = ?', [id]);
    console.log('DELETE version - result:', result);
    
    await db.end();
    
    if (result.affectedRows === 0) {
      console.log('DELETE version failed - no rows affected');
      return NextResponse.json({ success: false, error: 'Failed to delete version - no rows affected' }, { status: 500 });
    }
    
    console.log('DELETE version successful - affected rows:', result.affectedRows);
    return NextResponse.json({ success: true, message: 'Software version deleted successfully' });
  } catch (error) {
    console.error('Software versions DELETE error:', error);
    console.error('Error stack:', error.stack);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to delete software version', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  } finally {
    if (db) {
      try {
        await db.end();
      } catch (e) {
        console.error('Error closing database connection:', e);
      }
    }
  }
}
