import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';

// Ensure users table exists and has an employee_id column for mapping
async function ensureUsersTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      employee_id INT DEFAULT NULL,
      role VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username),
      INDEX idx_employee_id (employee_id)
    )
  `);
  // Ensure employee_id column exists for older schemas
  try {
    const [cols] = await db.execute("SHOW COLUMNS FROM users LIKE 'employee_id'");
    if (!cols || cols.length === 0) {
      await db.execute('ALTER TABLE users ADD COLUMN employee_id INT DEFAULT NULL');
      await db.execute('CREATE INDEX IF NOT EXISTS idx_employee_id ON users (employee_id)');
    }
  } catch (err) {
    // In case SHOW COLUMNS fails (permissions, older MySQL), ignore and proceed
    console.warn('users table compatibility check failed:', err && err.message);
  }
}

// GET - list users with optional pagination
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const offset = (page - 1) * limit;

    const db = await dbConnect();
    await ensureUsersTable(db);

    const [rows] = await db.execute(
      `SELECT u.*, CONCAT(e.first_name, ' ', e.last_name) AS employee_name, e.employee_id as employee_code
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    await db.end();

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch users' }, { status: 500 });
  }
}

// POST - create user
export async function POST(request) {
  let db;
  try {
    const data = await request.json();
    const { username, password, email, employee_id, role } = data;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'username and password are required' }, { status: 400 });
    }

    db = await dbConnect();
    await ensureUsersTable(db);

    // check duplicates
    const [existing] = await db.execute('SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email || '']);
    if (existing && existing.length > 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User with this username or email already exists' }, { status: 409 });
    }

    // if employee_id is provided, ensure employee exists
    if (employee_id) {
      const [emp] = await db.execute('SELECT id FROM employees WHERE id = ? LIMIT 1', [employee_id]);
      if (!emp || emp.length === 0) {
        await db.end();
        return NextResponse.json({ success: false, error: 'Linked employee not found' }, { status: 400 });
      }
    }

    // For now store password raw into password_hash to match existing auth route (replace later with real hashing)
    const [result] = await db.execute(
      'INSERT INTO users (username, password_hash, email, employee_id, role) VALUES (?, ?, ?, ?, ?)',
      [username, password, email || null, employee_id || null, role || null]
    );

    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
    await db.end();

    return NextResponse.json({ success: true, data: rows[0], message: 'User created' }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to create user' }, { status: 500 });
  }
}

// PUT - update user
export async function PUT(request) {
  try {
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
    const allowed = ['username', 'password_hash', 'email', 'employee_id', 'role'];
    allowed.forEach(k => {
      if (data.hasOwnProperty(k)) {
        fields.push(`${k} = ?`);
        vals.push(data[k]);
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
