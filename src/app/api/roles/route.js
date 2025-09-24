import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

async function ensureRolesTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS roles (
      id INT PRIMARY KEY AUTO_INCREMENT,
      role_key VARCHAR(100) UNIQUE NOT NULL,
      display_name VARCHAR(255),
      permissions JSON,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function GET() {
  try {
    const db = await dbConnect();
    await ensureRolesTable(db);

    const [rows] = await db.execute('SELECT * FROM roles ORDER BY created_at DESC');
    await db.end();
    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch roles' }, { status: 500 });
  }
}

export async function POST(request) {
  let db;
  try {
    const data = await request.json();
    const { role_key, display_name, permissions } = data;

    if (!role_key) return NextResponse.json({ success: false, error: 'role_key is required' }, { status: 400 });

    db = await dbConnect();
    await ensureRolesTable(db);

    const [existing] = await db.execute('SELECT id FROM roles WHERE role_key = ? LIMIT 1', [role_key]);
    if (existing && existing.length > 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Role already exists' }, { status: 409 });
    }

    const perms = permissions ? JSON.stringify(permissions) : JSON.stringify([]);
    const [res] = await db.execute('INSERT INTO roles (role_key, display_name, permissions) VALUES (?, ?, ?)', [role_key, display_name || null, perms]);
    const [rows] = await db.execute('SELECT * FROM roles WHERE id = ?', [res.insertId]);
    await db.end();
    return NextResponse.json({ success: true, data: rows[0], message: 'Role created' }, { status: 201 });
  } catch (error) {
    console.error('Error creating role:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to create role' }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const data = await request.json();
    if (!data.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const db = await dbConnect();
    await ensureRolesTable(db);

    const [existing] = await db.execute('SELECT id FROM roles WHERE id = ? LIMIT 1', [data.id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }

    const fields = [];
    const vals = [];
    if (data.role_key) { fields.push('role_key = ?'); vals.push(data.role_key); }
    if (data.display_name) { fields.push('display_name = ?'); vals.push(data.display_name); }
    if (data.permissions) { fields.push('permissions = ?'); vals.push(JSON.stringify(data.permissions)); }

    if (fields.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    vals.push(data.id);
    await db.execute(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`, vals);
    const [rows] = await db.execute('SELECT * FROM roles WHERE id = ?', [data.id]);
    await db.end();
    return NextResponse.json({ success: true, data: rows[0], message: 'Role updated' });
  } catch (error) {
    console.error('Error updating role:', error);
    return NextResponse.json({ success: false, error: 'Failed to update role' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });

    const db = await dbConnect();
    await ensureRolesTable(db);
    const [existing] = await db.execute('SELECT id FROM roles WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }

    await db.execute('DELETE FROM roles WHERE id = ?', [id]);
    await db.end();
    return NextResponse.json({ success: true, message: 'Role deleted' });
  } catch (error) {
    console.error('Error deleting role:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete role' }, { status: 500 });
  }
}
