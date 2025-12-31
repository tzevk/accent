import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// POST /api/payroll/salary-profile - Create/Update employee salary profile
export async function POST(request) {
  let db;
  try {
    // Check permission
    await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE);

    const body = await request.json();
    const { 
      employee_id, 
      gross_salary, 
      other_allowances = 0, 
      effective_from = new Date().toISOString().split('T')[0], // Auto-generate if not provided
      da_year = new Date().getFullYear(), // Auto-generate if not provided
      pf_applicable = true,
      esic_applicable = true
    } = body;

    // Validate required fields
    if (!employee_id || !gross_salary) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: employee_id, gross_salary' },
        { status: 400 }
      );
    }

    db = await dbConnect();
    
    try {
      await db.beginTransaction();

      // Check if employee exists
      const [empRows] = await db.query(
        'SELECT id FROM employees WHERE id = ?',
        [employee_id]
      );

      if (empRows.length === 0) {
        await db.rollback();
        return NextResponse.json(
          { success: false, error: 'Employee not found' },
          { status: 404 }
        );
      }

      // Insert new salary profile record
      const [result] = await db.query(
        `INSERT INTO employee_salary_profile 
         (employee_id, gross_salary, other_allowances, effective_from, da_year, pf_applicable, esic_applicable) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [employee_id, gross_salary, other_allowances, effective_from, da_year, pf_applicable, esic_applicable]
      );

      await db.commit();

      return NextResponse.json({
        success: true,
        message: 'Salary profile saved successfully',
        data: {
          id: result.insertId,
          employee_id,
          gross_salary,
          other_allowances,
          effective_from,
          da_year,
          pf_applicable,
          esic_applicable
        }
      });

    } catch (err) {
      await db.rollback();
      throw err;
    } finally {
      if (db) await db.end();
    }

  } catch (error) {
    console.error('Error saving salary profile:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/payroll/salary-profile?employee_id=X - Get employee's salary profile history
export async function GET(request) {
  let db;
  try {
    await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);

    const { searchParams } = new URL(request.url);
    const employee_id = searchParams.get('employee_id');

    if (!employee_id) {
      return NextResponse.json(
        { success: false, error: 'Missing employee_id parameter' },
        { status: 400 }
      );
    }

    db = await dbConnect();
    
    try {
      // Get all salary profiles for this employee, ordered by effective_from descending
      const [profiles] = await db.query(
        `SELECT 
          id, 
          employee_id, 
          gross_salary, 
          other_allowances, 
          effective_from, 
          da_year,
          pf_applicable, 
          esic_applicable,
          created_at
         FROM employee_salary_profile 
         WHERE employee_id = ?
         ORDER BY effective_from DESC`,
        [employee_id]
      );

      return NextResponse.json({
        success: true,
        data: profiles
      });

    } finally {
      if (db) await db.end();
    }

  } catch (error) {
    console.error('Error fetching salary profiles:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
