import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

function normalizeString(value, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed && !allowEmpty) {
    return null;
  }
  return trimmed;
}

function buildUpdate(fields, values, column, rawValue, { allowEmpty = false } = {}) {
  if (typeof rawValue === 'undefined') return;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      if (allowEmpty) {
        fields.push(`${column} = NULL`);
      }
      return;
    }
    fields.push(`${column} = ?`);
    values.push(trimmed);
    return;
  }
  fields.push(`${column} = ?`);
  values.push(rawValue);
}

function serializeResponse(user) {
  return {
    user,
    permissions: {
      role: user?.role_permissions || [],
      user: user?.permissions || [],
      merged: user?.merged_permissions || []
    }
  };
}

export async function GET(request) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ success: true, data: serializeResponse(user) });
}

export async function PUT(request) {
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  const profileChanges = payload?.profile || {};
  const employeeChanges = payload?.employee || {};
  const wantsEmployeeUpdate = Object.keys(employeeChanges).length > 0;
  const wantsProfileUpdate = Object.keys(profileChanges).length > 0;

  if (!wantsEmployeeUpdate && !wantsProfileUpdate) {
    return NextResponse.json({ success: false, error: 'No changes provided' }, { status: 400 });
  }

  // If employee updates are requested but user is not yet linked to an employee,
  // auto-create a minimal employee record and link it to the user so updates can proceed.
  // This improves first-run UX for super admins and new accounts.

  let db;
  try {
    db = await dbConnect();
    // Ensure employees table exists (minimal schema compatible with app)
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS employees (
          id INT PRIMARY KEY AUTO_INCREMENT,
          employee_id VARCHAR(20) UNIQUE NOT NULL,
          first_name VARCHAR(50) NOT NULL,
          last_name VARCHAR(50) NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          phone VARCHAR(20),
          department VARCHAR(50),
          position VARCHAR(100),
          status ENUM('active','inactive','terminated') DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
    } catch {}

      // Auto-create and link an employee record if requested and missing, unless the user is a super admin
      if (wantsEmployeeUpdate && !currentUser.employee?.id && !currentUser.is_super_admin) {
      try {
        const fullName = currentUser.full_name || currentUser.username || 'User';
        const parts = String(fullName).trim().split(/\s+/);
        const first = parts[0] || 'User';
        const last = parts.slice(1).join(' ') || 'Admin';
        const empCode = `EMP-${Date.now()}`;
        const email = currentUser.email || `${currentUser.username || 'user'}@example.com`;
        const roleName = currentUser?.role?.name || null;
        const dept = currentUser?.department || null;
        const [ins] = await db.execute(
          `INSERT INTO employees (employee_id, first_name, last_name, email, department, position, status)
           VALUES (?, ?, ?, ?, ?, ?, 'active')`,
          [empCode, first, last, email, dept, roleName]
        );
        await db.execute(`UPDATE users SET employee_id = ? WHERE id = ?`, [ins.insertId, currentUser.id]);
        // Refresh currentUser for subsequent update logic
        currentUser.employee = { id: ins.insertId };
      } catch (err) {
        // If creation fails due to duplicate email, try to link existing employee by email
        if (err?.code === 'ER_DUP_ENTRY') {
          try {
            const [rows] = await db.execute('SELECT id FROM employees WHERE email = ? LIMIT 1', [currentUser.email]);
            if (rows && rows.length > 0) {
              const existingId = rows[0].id;
              await db.execute(`UPDATE users SET employee_id = ? WHERE id = ?`, [existingId, currentUser.id]);
              currentUser.employee = { id: existingId };
            }
          } catch (linkErr) {
            console.warn('Failed to link existing employee by email:', linkErr?.code || linkErr?.message || linkErr);
          }
        } else {
          console.warn('Auto-create employee failed:', err?.code || err?.message || err);
        }
      }
    }

    if (wantsProfileUpdate) {
      // Determine which columns actually exist in users table (for older schemas)
      let userCols = new Set();
      try {
        const [cols] = await db.execute('SHOW COLUMNS FROM users');
        userCols = new Set(cols.map(c => c.Field));
      } catch {}
      const fields = [];
      const values = [];

      const fullName = normalizeString(profileChanges.full_name, { allowEmpty: false });
      if (typeof profileChanges.full_name !== 'undefined') {
        if (!fullName) {
          return NextResponse.json({ success: false, error: 'Full name is required' }, { status: 400 });
        }
        if (userCols.has('full_name')) {
          buildUpdate(fields, values, 'full_name', fullName, { allowEmpty: false });
        } else if (userCols.has('username')) {
          // Fallback for very old schemas without full_name: store in username
          buildUpdate(fields, values, 'username', fullName, { allowEmpty: false });
        }
      }

      if (typeof profileChanges.email !== 'undefined') {
        const email = normalizeString(profileChanges.email, { allowEmpty: false });
        if (!email) {
          return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return NextResponse.json({ success: false, error: 'Enter a valid email address' }, { status: 400 });
        }
        if (userCols.has('email')) {
          buildUpdate(fields, values, 'email', email, { allowEmpty: false });
        }
      }

      if (fields.length > 0) {
        if (userCols.has('updated_at')) {
          fields.push('updated_at = CURRENT_TIMESTAMP');
        }
        values.push(currentUser.id);
        try {
          await db.execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
        } catch (error) {
          if (error?.code === 'ER_DUP_ENTRY') {
            return NextResponse.json({ success: false, error: 'Email already in use.' }, { status: 409 });
          }
          throw error;
        }
      }
    }

    if (wantsEmployeeUpdate && currentUser.employee?.id) {
      const fields = [];
      const values = [];
      const allowNullFields = new Set([
        'personal_email',
        'present_address',
        'city',
        'state',
        'country',
        'emergency_contact_name',
        'emergency_contact_phone',
        'profile_photo_url'
      ]);

      const processField = (column) => {
        if (!Object.prototype.hasOwnProperty.call(employeeChanges, column)) return;
        const raw = employeeChanges[column];
        if (typeof raw === 'string') {
          const trimmed = raw.trim();
          if (!trimmed) {
            if (allowNullFields.has(column)) {
              fields.push(`${column} = NULL`);
            }
            return;
          }
          fields.push(`${column} = ?`);
          values.push(trimmed);
          return;
        }
        if (raw === null) {
          if (allowNullFields.has(column)) {
            fields.push(`${column} = NULL`);
          }
          return;
        }
        fields.push(`${column} = ?`);
        values.push(raw);
      };

      const employeeAllowed = [
        'phone',
        'mobile',
        'personal_email',
        'present_address',
        'city',
        'state',
        'country',
        'emergency_contact_name',
        'emergency_contact_phone',
        'profile_photo_url'
      ];

      employeeAllowed.forEach(processField);

      if (fields.length > 0) {
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(currentUser.employee.id);
        try {
          await db.execute(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`, values);
        } catch (error) {
          if (error?.code === 'ER_DUP_ENTRY') {
            return NextResponse.json({ success: false, error: 'Duplicate employee information detected.' }, { status: 409 });
          }
          throw error;
        }
      }
    }
  } catch (error) {
    console.error('Settings update failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  } finally {
    if (db) {
      try { await db.end(); } catch {}
    }
  }

  const refreshedUser = await getCurrentUser(request);
  if (!refreshedUser) {
    return NextResponse.json({ success: false, error: 'Unable to reload profile' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: serializeResponse(refreshedUser) });
}
