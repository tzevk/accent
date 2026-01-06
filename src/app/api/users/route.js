import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES as API_RESOURCES, PERMISSIONS as API_PERMISSIONS } from '@/utils/api-permissions';

// Ensure users table exists and has proper structure for role-based system
async function ensureUsersTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(100),
      employee_id INT DEFAULT NULL,
      role_id INT DEFAULT NULL,
      permissions JSON DEFAULT NULL,
      field_permissions JSON DEFAULT NULL,
      department VARCHAR(100) DEFAULT NULL,
      full_name VARCHAR(100) DEFAULT NULL,
      status ENUM('active', 'inactive') DEFAULT 'active',
      is_active BOOLEAN DEFAULT TRUE,
      is_super_admin BOOLEAN DEFAULT FALSE,
      last_login TIMESTAMP NULL,
      last_password_change TIMESTAMP NULL,
      created_by INT DEFAULT NULL,
      updated_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_employee_id (employee_id),
      INDEX idx_role_id (role_id)
    )
  `);
  // In case table already existed without these columns, attempt to add them
  try {
    await db.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE');
  } catch {
    // ignore if not supported or already present
  }
  try {
    await db.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS field_permissions JSON DEFAULT NULL');
  } catch {
    // ignore if not supported or already present
  }
  
  // Ensure roles table exists
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

// GET - list users with optional pagination and role information
export async function GET(request) {
  try {
    // RBAC: read users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.READ);
    if (auth instanceof Response) return auth;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const offset = (page - 1) * limit;

    const db = await dbConnect();
    await ensureUsersTable(db);

    const [rows] = await db.execute(
      `SELECT u.*, 
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name, 
              e.employee_id as employee_code,
              e.department as employee_department,
              e.position as employee_position,
              r.display_name as role_name,
              r.role_key,
              r.permissions as role_permissions
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.is_active = TRUE
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Get total count for pagination
    const [countResult] = await db.execute(
      'SELECT COUNT(*) as total FROM users WHERE is_active = TRUE'
    );

    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: rows,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST - create user with role-based system
export async function POST(request) {
  let db;
  try {
    // RBAC: create users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.CREATE);
    if (auth instanceof Response) return auth;
    const data = await request.json();
    const { username, password, email, employee_id, role_id, permissions, created_by } = data;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'username and password are required' }, { status: 400 });
    }

    if (!employee_id) {
      return NextResponse.json({ success: false, error: 'employee_id is required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureUsersTable(db);

    // check duplicates
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email || '']);
    if (existing && existing.length > 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User with this username or email already exists' }, { status: 409 });
    }

    // Ensure employee exists and get employee details
    const [emp] = await db.execute('SELECT id, first_name, last_name, email as emp_email, department FROM employees WHERE id = ? LIMIT 1', [employee_id]);
    if (!emp || emp.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 400 });
    }

    const employee = emp[0];
    const fullName = `${employee.first_name} ${employee.last_name}`;
    const userEmail = email || employee.emp_email;

    // Validate role if provided
    let roleData = null;
    if (role_id) {
      const [role] = await db.execute('SELECT * FROM roles_master WHERE id = ? AND status = "active" LIMIT 1', [role_id]);
      if (!role || role.length === 0) {
        await db.end();
        return NextResponse.json({ success: false, error: 'Invalid role selected' }, { status: 400 });
      }
      roleData = role[0];
    }

    // Create the user
    const [result] = await db.execute(
      `INSERT INTO users (username, password_hash, email, employee_id, role_id, permissions, department, full_name, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username, 
        password, 
        userEmail || null, 
        employee_id || null, 
        role_id || null, 
        permissions ? JSON.stringify(permissions) : null,
        roleData ? roleData.department : (employee.department || null),
        fullName || null,
        created_by || null
      ]
    );

    const [rows] = await db.execute(`
      SELECT u.*, 
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             r.role_name, r.role_code
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id
      LEFT JOIN roles_master r ON u.role_id = r.id
      WHERE u.id = ?`, [result.insertId]);
    
    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: rows[0], 
      message: 'User created successfully' 
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to create user' }, { status: 500 });
  }
}

// PUT - update user
export async function PUT(request) {
  try {
    // RBAC: update users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ success: false, error: 'User id is required' }, { status: 400 });

    const db = await dbConnect();
    await ensureUsersTable(db);

    const [existing] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [data.id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // check duplicate username/email
    if (data.username || data.email) {
      const [dups] = await db.execute('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?', [data.username || '', data.email || '', data.id]);
      if (dups.length > 0) {
        await db.end();
        return NextResponse.json({ success: false, error: 'Username or email already in use' }, { status: 409 });
      }
    }

    const fields = [];
    const vals = [];
    // Allow updating role_id (system role), permissions, field_permissions, and user details
    const allowed = ['username', 'password_hash', 'email', 'employee_id', 'role', 'role_id', 'permissions', 'field_permissions', 'full_name', 'status', 'department'];
    
    console.log('[PUT /api/users] Received data keys:', Object.keys(data));
    console.log('[PUT /api/users] Permissions in request:', data.permissions);
    
    allowed.forEach(k => {
      if (data.hasOwnProperty(k)) {
        if (k === 'permissions' || k === 'field_permissions') {
          fields.push(`${k} = ?`);
          // Handle empty arrays - still save them as JSON
          const jsonValue = Array.isArray(data[k]) || (data[k] && typeof data[k] === 'object') 
            ? JSON.stringify(data[k]) 
            : null;
          vals.push(jsonValue);
          console.log(`[PUT /api/users] Setting ${k} to:`, jsonValue);
        } else if (k === 'employee_id' || k === 'role_id') {
          // Convert empty strings to NULL for integer fields
          fields.push(`${k} = ?`);
          vals.push(data[k] === '' || data[k] === null ? null : data[k]);
        } else {
          fields.push(`${k} = ?`);
          vals.push(data[k]);
        }
      }
    });

    if (fields.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    vals.push(data.id);
    await db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [data.id]);
    await db.end();

    return NextResponse.json({ success: true, data: rows[0], message: 'User updated' });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ success: false, error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE - delete user by id query param
export async function DELETE(request) {
  try {
    // RBAC: delete users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'User id is required' }, { status: 400 });

    const db = await dbConnect();
    await ensureUsersTable(db);

    const [existing] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete user' }, { status: 500 });
  }
}
