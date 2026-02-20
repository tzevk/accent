import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES as API_RESOURCES, PERMISSIONS as API_PERMISSIONS } from '@/utils/api-permissions';

// Flag to run schema DDL at most once per process
let _usersSchemaReady = false;

// Ensure users table exists and has proper structure for role-based system
async function ensureUsersTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(100),
      employee_id INT DEFAULT NULL,
      vendor_id INT DEFAULT NULL,
      account_type ENUM('employee', 'vendor') DEFAULT 'employee',
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
      INDEX idx_vendor_id (vendor_id),
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
  try {
    await db.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_id INT DEFAULT NULL');
  } catch {
    // ignore if not supported or already present
  }
  try {
    await db.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type ENUM("employee", "vendor") DEFAULT "employee"');
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
  let db;
  try {
    // RBAC: read users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.READ);
    if (auth instanceof Response) return auth;
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const offset = (page - 1) * limit;

    db = await dbConnect();
    if (!_usersSchemaReady) { await ensureUsersTable(db); _usersSchemaReady = true; }

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
  } finally {
    if (db) db.release();
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
    const { username, password, email, employee_id, vendor_id, account_type, role_id, permissions, created_by } = data;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'username and password are required' }, { status: 400 });
    }

    // Validate account type - either employee or vendor must be provided
    const userAccountType = account_type || 'employee';
    if (userAccountType === 'employee' && !employee_id) {
      return NextResponse.json({ success: false, error: 'employee_id is required for employee accounts' }, { status: 400 });
    }
    if (userAccountType === 'vendor' && !vendor_id) {
      return NextResponse.json({ success: false, error: 'vendor_id is required for vendor accounts' }, { status: 400 });
    }

    db = await dbConnect();
    if (!_usersSchemaReady) { await ensureUsersTable(db); _usersSchemaReady = true; }

    // check duplicates
    const [existing] = await db.execute(
      'SELECT id FROM users WHERE username = ? OR (email = ? AND email IS NOT NULL AND email != \'\') LIMIT 1', 
      [username, email || null]
    );
    if (existing && existing.length > 0) {

      return NextResponse.json({ success: false, error: 'User with this username or email already exists' }, { status: 409 });
    }

    let fullName = '';
    let userEmail = email;
    let department = null;

    // Handle employee or vendor account
    if (userAccountType === 'employee') {
      // Ensure employee exists and get employee details
      const [emp] = await db.execute('SELECT id, first_name, last_name, email as emp_email, department FROM employees WHERE id = ? LIMIT 1', [employee_id]);
      if (!emp || emp.length === 0) {

        return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 400 });
      }
      const employee = emp[0];
      fullName = `${employee.first_name} ${employee.last_name}`;
      userEmail = email || employee.emp_email;
      department = employee.department;
    } else if (userAccountType === 'vendor') {
      // Ensure vendor exists and get vendor details
      const [vnd] = await db.execute('SELECT id, vendor_name, contact_person, email as vendor_email FROM vendors WHERE id = ? LIMIT 1', [vendor_id]);
      if (!vnd || vnd.length === 0) {

        return NextResponse.json({ success: false, error: 'Vendor not found' }, { status: 400 });
      }
      const vendor = vnd[0];
      fullName = vendor.contact_person || vendor.vendor_name;
      userEmail = email || vendor.vendor_email;
      department = 'Vendor';
    }

    // Validate role if provided
    let roleData = null;
    if (role_id) {
      const [role] = await db.execute('SELECT * FROM roles_master WHERE id = ? AND status = "active" LIMIT 1', [role_id]);
      if (!role || role.length === 0) {

        return NextResponse.json({ success: false, error: 'Invalid role selected' }, { status: 400 });
      }
      roleData = role[0];
    }

    // Create the user
    const [result] = await db.execute(
      `INSERT INTO users (username, password_hash, email, employee_id, vendor_id, account_type, role_id, permissions, department, full_name, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username, 
        password, 
        userEmail || null, 
        userAccountType === 'employee' ? employee_id : null, 
        userAccountType === 'vendor' ? vendor_id : null,
        userAccountType,
        role_id || null, 
        permissions ? JSON.stringify(permissions) : null,
        roleData ? roleData.department : department,
        fullName || null,
        created_by || null
      ]
    );

    const [rows] = await db.execute(`
      SELECT u.*, 
             CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
             v.vendor_name,
             r.role_name, r.role_code
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id
      LEFT JOIN vendors v ON u.vendor_id = v.id
      LEFT JOIN roles_master r ON u.role_id = r.id
      WHERE u.id = ?`, [result.insertId]);

    return NextResponse.json({ 
      success: true, 
      data: rows[0], 
      message: 'User created successfully' 
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);

    return NextResponse.json({ success: false, error: 'Failed to create user' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// PUT - update user
export async function PUT(request) {
  let db;
  try {
    // RBAC: update users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;
    const data = await request.json();
    if (!data.id) return NextResponse.json({ success: false, error: 'User id is required' }, { status: 400 });

    db = await dbConnect();
    if (!_usersSchemaReady) { await ensureUsersTable(db); _usersSchemaReady = true; }

    const [existing] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [data.id]);
    if (!existing || existing.length === 0) {

      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // check duplicate username/email
    if (data.username || data.email) {
      const [dups] = await db.execute('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?', [data.username || '', data.email || '', data.id]);
      if (dups.length > 0) {

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

      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    vals.push(data.id);
    await db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals);
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [data.id]);

    return NextResponse.json({ success: true, data: rows[0], message: 'User updated' });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ success: false, error: 'Failed to update user' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}

// DELETE - delete user by id query param
export async function DELETE(request) {
  let db;
  try {
    // RBAC: delete users
    const auth = await ensurePermission(request, API_RESOURCES.USERS, API_PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'User id is required' }, { status: 400 });

    db = await dbConnect();
    if (!_usersSchemaReady) { await ensureUsersTable(db); _usersSchemaReady = true; }

    const [existing] = await db.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {

      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [id]);

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete user' }, { status: 500 });
  } finally {
    if (db) db.release();
  }
}
