import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

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
             e.position,
             e.joining_date,
                  ss_inner.basic_salary as structure_basic_salary,
                  ss_inner.gross_salary as structure_gross_salary,
             sp_inner.gross_salary as profile_gross,
                  sp_inner.employer_cost as profile_ctc,
                        sp_inner.basic as profile_basic,
                        sp_inner.basic_plus_da as profile_basic_plus_da
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
                LEFT JOIN salary_structures ss_inner ON ss_inner.employee_id = e.id AND ss_inner.is_active = 1
      LEFT JOIN employee_salary_profile sp_inner ON sp_inner.employee_id = e.id AND sp_inner.is_active = 1
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

    // Normalize BASIC/DA from canonical sources so all UIs read consistent values.
    let scheduledDA = 0;
    if (month) {
      try {
        const [yr, mn] = String(month).split('-');
        const monthDate = `${yr}-${mn}-01`;
        const [daRows] = await db.execute(
          `SELECT value_type, value
           FROM payroll_schedules
           WHERE component_type = 'da' AND is_active = 1
             AND effective_from <= ?
             AND (effective_to IS NULL OR effective_to >= ?)
           ORDER BY effective_from DESC
           LIMIT 1`,
          [monthDate, monthDate]
        );
        if (daRows.length > 0) {
          const daRow = daRows[0];
          scheduledDA = daRow.value_type === 'percentage' ? 0 : safeNum(daRow.value);
        }
      } catch (daErr) {
        console.log('DA fetch in slips route skipped:', daErr.message);
      }
    }

    const normalizedRows = rows.map((row) => {
      const basicPlusDaSource = Math.max(
        0,
        safeNum(row.structure_basic_salary)
          || safeNum(row.profile_basic)
          || safeNum(row.profile_basic_plus_da)
          || safeNum(row.basic)
      );
      const da = scheduledDA > 0 ? scheduledDA : (safeNum(row.da_used) || safeNum(row.da));
      const basic = Math.max(0, basicPlusDaSource - da);

      return {
        ...row,
        basic,
        da,
        basic_plus_da_source: basicPlusDaSource,
      };
    });

    return NextResponse.json({ 
      success: true, 
      data: normalizedRows 
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
