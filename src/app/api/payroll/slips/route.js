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

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const employee_id = searchParams.get('employee_id');
    const payment_status = searchParams.get('payment_status');
    
    const db = await dbConnect();
    
    let query = `
      SELECT ps.*, e.name as employee_name, e.employee_code
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
    
    query += ` ORDER BY ps.month DESC, ps.employee_id`;
    
    const [rows] = await db.execute(query, params);
    
    await db.end();
    
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

  try {
    const { id, payment_status, payment_date, payment_reference, remarks } = await request.json();
    
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'ID is required' },
        { status: 400 }
      );
    }
    
    const db = await dbConnect();
    
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
    
    await db.end();
    
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
  }
}
