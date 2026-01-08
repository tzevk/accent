import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch all employees from employee master
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 1000; // Default high limit for master data
    
    const connection = await dbConnect();

    // Get all active employees with essential fields for master dropdown
    const [employees] = await connection.execute(
      `SELECT 
        id,
        employee_id,
        first_name,
        last_name,
        email,
        department,
        workplace,
        status,
        CONCAT(first_name, ' ', last_name) as full_name
       FROM employees 
       WHERE status = 'active'
       ORDER BY first_name, last_name
       LIMIT ?`,
      [limit]
    );

    await connection.end();

    return NextResponse.json({
      success: true,
      data: employees,
      total: employees.length
    });

  } catch (error) {
    console.error('Error fetching employees from master:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch employees from master',
        data: []
      },
      { status: 500 }
    );
  }
}