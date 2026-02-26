import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

/**
 * GET - Fetch payroll slips
 * Query params:
 *  - month: Filter by month (YYYY-MM-01)
 *  - employee_id: Filter by employee
 *  - payment_status: Filter by status (pending, processed, paid, hold)
 */
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const employee_id = searchParams.get('employee_id');
    const payment_status = searchParams.get('payment_status');
    const salary_type = searchParams.get('salary_type');
    
    db = await dbConnect();
    
    let query = `
      SELECT ps.*, 
             CONCAT(e.first_name, ' ', e.last_name) as employee_name, 
             e.employee_id as employee_code,
             e.department,
             e.grade as designation,
             e.joining_date
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      WHERE 1=1
    `;
    const params = [];
    
    if (month) {
      query += ` AND ps.month = ?`;
      params.push(month);
    }
    
    if (employee_id) {
      query += ` AND ps.employee_id = ?`;
      params.push(employee_id);
    }
    
    if (payment_status) {
      query += ` AND ps.payment_status = ?`;
      params.push(payment_status);
    }

    if (salary_type === 'payroll') {
      query += ` AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    } else if (salary_type === 'contract') {
      query += ` AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    }
    
    query += ` ORDER BY ps.month DESC, e.first_name ASC`;
    
    const [rows] = await db.execute(query, params);

    return NextResponse.json({ 
      success: true, 
      data: rows 
    });
  } catch (error) {
    console.error('GET /api/payroll/slips error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch payroll slips', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}

/**
 * PUT - Update payroll slip payment status
 * Note: Other fields are immutable (snapshot history)
 */
export async function PUT(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.UPDATE);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { id, payment_status, payment_date, payment_reference, remarks } = await request.json();
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID is required' },
        { status: 400 }
      );
    }
    
    db = await dbConnect();
    
    // Only allow updating payment-related fields (slip data is immutable)
    await db.execute(
      `UPDATE payroll_slips 
       SET payment_status = COALESCE(?, payment_status),
           payment_date = ?,
           payment_reference = ?,
           remarks = ?
       WHERE id = ?`,
      [
        payment_status ?? null,
        payment_date !== undefined ? payment_date : undefined,
        payment_reference !== undefined ? payment_reference : undefined,
        remarks !== undefined ? remarks : undefined,
        id
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Payroll slip updated successfully'
    });
  } catch (error) {
    console.error('PUT /api/payroll/slips error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update payroll slip', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}

/**
 * DELETE - Delete a payroll slip or all slips
 */
export async function DELETE(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.DELETE);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const all = searchParams.get('all');
    
    db = await dbConnect();
    
    if (all === 'true') {
      // Delete all payroll slips
      const [result] = await db.execute('DELETE FROM payroll_slips');

      return NextResponse.json({
        success: true,
        message: `All payroll slips deleted successfully (${result.affectedRows} records)`
      });
    }
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID is required' },
        { status: 400 }
      );
    }
    
    await db.execute('DELETE FROM payroll_slips WHERE id = ?', [id]);

    return NextResponse.json({
      success: true,
      message: 'Payroll slip deleted successfully'
    });
  } catch (error) {
    console.error('DELETE /api/payroll/slips error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete payroll slip', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}
