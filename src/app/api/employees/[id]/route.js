import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES as API_RESOURCES, PERMISSIONS as API_PERMISSIONS } from '@/utils/api-permissions';

// GET - fetch single employee by ID
export async function GET(request, { params }) {
  let db;
  try {
    // RBAC: read employees
    const auth = await ensurePermission(request, API_RESOURCES.EMPLOYEES, API_PERMISSIONS.READ);
    if (auth instanceof Response) return auth;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Employee ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    const [rows] = await db.execute(`
      SELECT * FROM employees WHERE id = ? LIMIT 1
    `, [id]);

    await db.end();

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      data: rows[0]
    });
  } catch (error) {
    console.error('Error fetching employee:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to fetch employee' }, { status: 500 });
  }
}

// PUT - update single employee by ID
export async function PUT(request, { params }) {
  let db;
  try {
    // RBAC: update employees
    const auth = await ensurePermission(request, API_RESOURCES.EMPLOYEES, API_PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    const data = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'Employee ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Check if employee exists
    const [existing] = await db.execute('SELECT id FROM employees WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    // Build update query dynamically based on provided fields
    const allowedFields = [
      'first_name', 'last_name', 'middle_name', 'email', 'phone', 'mobile',
      'department', 'position', 'designation', 'employee_id', 'employee_type',
      'gender', 'dob', 'joining_date', 'grade', 'level', 'workplace',
      'reporting_to', 'pf_no', 'marital_status', 'employment_status', 'role',
      'present_address', 'city', 'pin', 'state', 'country',
      'personal_email', 'profile_photo_url', 'status'
    ];

    const updateFields = [];
    const updateValues = [];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        updateValues.push(data[field] || null);
      }
    }

    if (updateFields.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    // Add ID to values
    updateValues.push(id);

    await db.execute(
      `UPDATE employees SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    // Fetch updated employee
    const [rows] = await db.execute('SELECT * FROM employees WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: rows[0],
      message: 'Employee updated successfully'
    });
  } catch (error) {
    console.error('Error updating employee:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to update employee' }, { status: 500 });
  }
}

// DELETE - delete single employee by ID
export async function DELETE(request, { params }) {
  let db;
  try {
    // RBAC: delete employees
    const auth = await ensurePermission(request, API_RESOURCES.EMPLOYEES, API_PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;

    const { id } = await params;

    if (!id) {
      return NextResponse.json({ success: false, error: 'Employee ID is required' }, { status: 400 });
    }

    db = await dbConnect();

    // Check if employee exists
    const [existing] = await db.execute('SELECT id FROM employees WHERE id = ? LIMIT 1', [id]);
    if (!existing || existing.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    // Check if employee has linked user accounts
    const [users] = await db.execute('SELECT id FROM users WHERE employee_id = ? LIMIT 1', [id]);
    if (users && users.length > 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Cannot delete employee with linked user account. Delete the user account first.' 
      }, { status: 400 });
    }

    await db.execute('DELETE FROM employees WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Employee deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting employee:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to delete employee' }, { status: 500 });
  }
}
