/**
 * SmartOffice Employees API
 * Fetches employee list from SmartOffice for mapping
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';

/**
 * GET /api/smartoffice/employees
 * Fetch employees from SmartOffice
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const activeOnly = searchParams.get('active') === 'true'; // Default to false now

    let query = `
      SELECT TOP 500
        EmployeeId,
        EmployeeCode,
        EmployeeName,
        NumericCode,
        DepartmentId,
        Status
      FROM Employees
      WHERE EmployeeCode IS NOT NULL
        AND EmployeeCode LIKE 'ATS%'
    `;

    const params = {};

    if (search) {
      query += ` AND (EmployeeCode LIKE @search OR EmployeeName LIKE @search)`;
      params.search = `%${search}%`;
    }

    query += ` ORDER BY EmployeeCode`;

    const employees = await querySmartOffice(query, params);

    return NextResponse.json({
      success: true,
      total: employees.length,
      employees: employees.map(emp => ({
        id: emp.EmployeeId,
        code: emp.EmployeeCode,
        name: emp.EmployeeName,
        numeric_code: emp.NumericCode,
        department_id: emp.DepartmentId,
        status: emp.Status
      }))
    });

  } catch (error) {
    console.error('SmartOffice employees error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
