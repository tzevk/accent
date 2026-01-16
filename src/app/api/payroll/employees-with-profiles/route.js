import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// GET /api/payroll/employees-with-profiles - Get all active employees from employee master
export async function GET(request) {
  let db;
  try {
    db = await dbConnect();
    
    // Get all active employees from employee master
    const [employees] = await db.query(
      `SELECT 
        id,
        employee_id,
        first_name,
        last_name,
        CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')) as full_name,
        department,
        status,
        email,
        phone
       FROM employees
       WHERE status = 'active' OR status IS NULL
       ORDER BY first_name, last_name`
    );

    return NextResponse.json({
      success: true,
      data: employees || [],
      total: employees?.length || 0
    });

  } catch (error) {
    console.error('Error fetching employees:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch employees: ' + error.message, data: [] },
      { status: 500 }
    );
  } finally {
    if (db) {
      try {
        db.release();
      } catch {
        // Ignore release errors
      }
    }
  }
}
