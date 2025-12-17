import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES as API_RESOURCES, PERMISSIONS as API_PERMISSIONS } from '@/utils/api-permissions';

// GET - fetch single user by ID
export async function GET(request, { params }) {
  let db;
  try {
    // RBAC: read users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.READ);
    if (auth instanceof Response) return auth;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    const [rows] = await db.execute(`
      SELECT u.*, 
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             e.first_name, e.last_name, e.email as employee_email, e.department as employee_department,
             r.role_name, r.role_code
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id
      LEFT JOIN roles_master r ON u.role_id = r.id
      WHERE u.id = ?
      LIMIT 1
    `, [id]);

    await db.end();

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      data: rows[0]
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to fetch user' }, { status: 500 });
  }
}

// PUT - update single user by ID
export async function PUT(request, { params }) {
  let db;
  try {
    // RBAC: update users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    const data = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Check if user exists
    const [existing] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Build update query dynamically based on provided fields
    const updateFields = [];
    const updateValues = [];

    if (data.username !== undefined) {
      updateFields.push('username = ?');
      updateValues.push(data.username);
    }
    if (data.email !== undefined) {
      updateFields.push('email = ?');
      updateValues.push(data.email || null);
    }
    if (data.role_id !== undefined) {
      updateFields.push('role_id = ?');
      updateValues.push(data.role_id || null);
    }
    if (data.permissions !== undefined) {
      updateFields.push('permissions = ?');
      updateValues.push(data.permissions ? JSON.stringify(data.permissions) : null);
    }
    if (data.field_permissions !== undefined) {
      updateFields.push('field_permissions = ?');
      updateValues.push(data.field_permissions ? JSON.stringify(data.field_permissions) : null);
    }
    if (data.status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(data.status);
    }
    if (data.is_active !== undefined) {
      updateFields.push('is_active = ?');
      updateValues.push(data.is_active ? 1 : 0);
    }
    if (data.department !== undefined) {
      updateFields.push('department = ?');
      updateValues.push(data.department || null);
    }
    if (data.full_name !== undefined) {
      updateFields.push('full_name = ?');
      updateValues.push(data.full_name || null);
    }

    if (updateFields.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    // Add ID to values
    updateValues.push(id);

    await db.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Fetch updated user
    const [rows] = await db.execute(`
      SELECT u.*, 
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             r.role_name, r.role_code
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id
      LEFT JOIN roles_master r ON u.role_id = r.id
      WHERE u.id = ?
    `, [id]);

    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: rows[0],
      message: 'User updated successfully'
    });
  } catch (error) {
    console.error('Error updating user:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE - delete single user by ID
export async function DELETE(request, { params }) {
  let db;
  try {
    // RBAC: delete users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: 'User ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Check if user exists
    const [existing] = await db.execute('SELECT id, is_super_admin FROM users WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Prevent deleting super admin
    if (existing[0].is_super_admin) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Cannot delete super admin user' }, { status: 403 });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to delete user' }, { status: 500 });
  }
}
