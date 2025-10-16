import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

// GET - list all active roles
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const department = searchParams.get('department');
    const includeInactive = searchParams.get('include_inactive') === 'true';

    const db = await dbConnect();
    
    let query = `
      SELECT id, role_code, role_name, role_hierarchy, department, permissions, description, status
      FROM roles_master 
    `;
    
    const conditions = [];
    const params = [];
    
    if (!includeInactive) {
      conditions.push('status = ?');
      params.push('active');
    }
    
    if (department) {
      conditions.push('department = ?');
      params.push(department);
    }
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    query += ' ORDER BY role_hierarchy DESC, role_name ASC';

    const [rows] = await db.execute(query, params);
    await db.end();

    // Parse permissions JSON for each role
    const rolesWithPermissions = rows.map(role => ({
      ...role,
      permissions: role.permissions ? JSON.parse(role.permissions) : []
    }));

    return NextResponse.json({ success: true, data: rolesWithPermissions });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch roles' }, { status: 500 });
  }
}

// POST - create new role
export async function POST(request) {
  try {
    const data = await request.json();
    const { role_code, role_name, role_hierarchy, department, permissions, description } = data;

    if (!role_code || !role_name) {
      return NextResponse.json({ success: false, error: 'role_code and role_name are required' }, { status: 400 });
    }

    const db = await dbConnect();

    // Check if role code already exists
    const [existing] = await db.execute('SELECT id FROM roles_master WHERE role_code = ?', [role_code]);
    if (existing.length > 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Role code already exists' }, { status: 409 });
    }

    const [result] = await db.execute(
      `INSERT INTO roles_master (role_code, role_name, role_hierarchy, department, permissions, description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        role_code,
        role_name,
        role_hierarchy || 0,
        department || null,
        permissions ? JSON.stringify(permissions) : null,
        description || null
      ]
    );

    const [newRole] = await db.execute('SELECT * FROM roles_master WHERE id = ?', [result.insertId]);
    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: {
        ...newRole[0],
        permissions: newRole[0].permissions ? JSON.parse(newRole[0].permissions) : []
      },
      message: 'Role created successfully' 
    });
  } catch (error) {
    console.error('Error creating role:', error);
    return NextResponse.json({ success: false, error: 'Failed to create role' }, { status: 500 });
  }
}

// PUT - update role
export async function PUT(request) {
  try {
    const data = await request.json();
    const { id, role_code, role_name, role_hierarchy, department, permissions, description, status } = data;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Role ID is required' }, { status: 400 });
    }

    const db = await dbConnect();

    // Check if role exists
    const [existing] = await db.execute('SELECT id FROM roles_master WHERE id = ?', [id]);
    if (existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }

    // Build update query dynamically
    const updates = [];
    const params = [];

    if (role_code !== undefined) {
      updates.push('role_code = ?');
      params.push(role_code);
    }
    if (role_name !== undefined) {
      updates.push('role_name = ?');
      params.push(role_name);
    }
    if (role_hierarchy !== undefined) {
      updates.push('role_hierarchy = ?');
      params.push(role_hierarchy);
    }
    if (department !== undefined) {
      updates.push('department = ?');
      params.push(department);
    }
    if (permissions !== undefined) {
      updates.push('permissions = ?');
      params.push(JSON.stringify(permissions));
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(status);
    }

    if (updates.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    params.push(id);
    await db.execute(`UPDATE roles_master SET ${updates.join(', ')} WHERE id = ?`, params);

    const [updatedRole] = await db.execute('SELECT * FROM roles_master WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: {
        ...updatedRole[0],
        permissions: updatedRole[0].permissions ? JSON.parse(updatedRole[0].permissions) : []
      },
      message: 'Role updated successfully' 
    });
  } catch (error) {
    console.error('Error updating role:', error);
    return NextResponse.json({ success: false, error: 'Failed to update role' }, { status: 500 });
  }
}