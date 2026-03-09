import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch attendance_monthly records for a given month and year
export async function GET(request) {
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // numeric 1-12
    const year = searchParams.get('year');   // numeric e.g. 2026

    if (!month || !year) {
      return NextResponse.json({ error: 'month and year are required' }, { status: 400 });
    }

    connection = await dbConnect();

    const [rows] = await connection.execute(
      `SELECT
        am.*,
        e.employee_id AS employee_code,
        e.first_name,
        e.last_name,
        e.department,
        e.position
      FROM attendance_monthly am
      JOIN employees e ON am.employee_id = e.id
      WHERE am.month = ? AND am.year = ?
      ORDER BY e.first_name, e.last_name`,
      [parseInt(month), parseInt(year)]
    );

    // Also get the list of employee IDs that are marked (for "Unmarked" filtering)
    const markedEmployeeIds = rows.map(r => r.employee_id);

    return NextResponse.json({
      success: true,
      data: rows,
      markedEmployeeIds,
      month: parseInt(month),
      year: parseInt(year)
    });
  } catch (err) {
    console.error('Error fetching monthly attendance:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// POST - Create a new attendance_monthly record
export async function POST(request) {
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.WRITE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      employee_id, month, year,
      present_days = 0, absent_days = 0, half_days = 0,
      holidays = 0, weekly_offs = 0, overtime_hours = 0,
      privileged_leave = 0, sick_leave = 0, casual_leave = 0,
      lop_days = 0, payable_days = null, working_days = null, remarks = ''
    } = body;

    if (!employee_id || !month || !year) {
      return NextResponse.json({ error: 'employee_id, month and year are required' }, { status: 400 });
    }

    connection = await dbConnect();

    // Check for duplicate
    const [existing] = await connection.execute(
      'SELECT id FROM attendance_monthly WHERE employee_id = ? AND month = ? AND year = ?',
      [employee_id, parseInt(month), parseInt(year)]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Record already exists. Use PUT to update.', existingId: existing[0].id },
        { status: 409 }
      );
    }

    const calcPayable = payable_days != null
      ? payable_days
      : parseFloat(present_days) + parseFloat(half_days) * 0.5
        + parseFloat(privileged_leave) + parseFloat(sick_leave) + parseFloat(casual_leave);

    const [result] = await connection.execute(
      `INSERT INTO attendance_monthly
        (employee_id, month, year, present_days, absent_days, half_days, holidays, weekly_offs,
         overtime_hours, privileged_leave, sick_leave, casual_leave, lop_days, payable_days, working_days, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id, parseInt(month), parseInt(year),
        present_days, absent_days, half_days, holidays, weekly_offs,
        overtime_hours, privileged_leave, sick_leave, casual_leave,
        lop_days, calcPayable, working_days, remarks
      ]
    );

    return NextResponse.json({ success: true, id: result.insertId });
  } catch (err) {
    console.error('Error creating monthly attendance:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// PUT - Upsert (create or update) an attendance_monthly record
export async function PUT(request) {
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.WRITE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const body = await request.json();
    const {
      id,
      employee_id, month, year,
      present_days, absent_days, half_days,
      holidays, weekly_offs, overtime_hours,
      privileged_leave, sick_leave, casual_leave,
      lop_days, payable_days, working_days, remarks
    } = body;

    if (!id && !(employee_id && month && year)) {
      return NextResponse.json({ error: 'Either id or (employee_id + month + year) is required' }, { status: 400 });
    }

    connection = await dbConnect();

    // Build update fields dynamically — only fields supplied in the request
    const fields = [];
    const values = [];
    const fieldMap = {
      present_days, absent_days, half_days, holidays, weekly_offs,
      overtime_hours, privileged_leave, sick_leave, casual_leave,
      lop_days, payable_days, working_days, remarks
    };
    for (const [key, val] of Object.entries(fieldMap)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    let whereClause, whereValues;
    if (id) {
      whereClause = 'id = ?';
      whereValues = [id];
    } else {
      whereClause = 'employee_id = ? AND month = ? AND year = ?';
      whereValues = [employee_id, parseInt(month), parseInt(year)];
    }

    const [result] = await connection.execute(
      `UPDATE attendance_monthly SET ${fields.join(', ')}, updated_at = NOW() WHERE ${whereClause}`,
      [...values, ...whereValues]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, affectedRows: result.affectedRows });
  } catch (err) {
    console.error('Error updating monthly attendance:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// DELETE - Remove an attendance_monthly record
export async function DELETE(request) {
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.WRITE);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const employee_id = searchParams.get('employee_id');
    const month = searchParams.get('month');
    const year = searchParams.get('year');

    if (!id && !(employee_id && month && year)) {
      return NextResponse.json({ error: 'Either id or (employee_id + month + year) is required' }, { status: 400 });
    }

    connection = await dbConnect();

    let result;
    if (id) {
      [result] = await connection.execute('DELETE FROM attendance_monthly WHERE id = ?', [id]);
    } else {
      [result] = await connection.execute(
        'DELETE FROM attendance_monthly WHERE employee_id = ? AND month = ? AND year = ?',
        [employee_id, parseInt(month), parseInt(year)]
      );
    }

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error deleting monthly attendance:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
