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
    if (connection) await connection.end();
  }
}
