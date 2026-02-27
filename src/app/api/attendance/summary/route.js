import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch attendance summary for employee master display
export async function GET(request) {
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const month = searchParams.get('month'); // Format: YYYY-MM
    const year = searchParams.get('year');

    connection = await dbConnect();

    // Check if summary table exists
    try {
      await connection.execute('SELECT 1 FROM employee_attendance_summary LIMIT 1');
    } catch {
      return NextResponse.json({ success: true, data: [], message: 'No attendance data yet' });
    }

    let query = `
      SELECT 
        s.*,
        e.employee_id AS employee_code,
        e.first_name,
        e.last_name,
        e.department
      FROM employee_attendance_summary s
      JOIN employees e ON s.employee_id = e.id
      WHERE 1=1
    `;
    const params = [];

    if (employeeId) {
      query += ' AND s.employee_id = ?';
      params.push(employeeId);
    }

    if (month) {
      query += ' AND s.month = ?';
      params.push(month);
    }

    if (year) {
      query += ' AND s.month LIKE ?';
      params.push(`${year}-%`);
    }

    query += ' ORDER BY s.month DESC';

    const [rows] = await connection.execute(query, params);

    // If requesting day-level detail for a specific employee + month
    let dayDetails = [];
    if (employeeId && month) {
      try {
        const [details] = await connection.execute(
          `SELECT attendance_date, status, overtime_hours, in_time, out_time, is_weekly_off, remarks
           FROM employee_attendance
           WHERE employee_id = ? AND DATE_FORMAT(attendance_date, "%Y-%m") = ?
           ORDER BY attendance_date ASC`,
          [employeeId, month]
        );
        dayDetails = details.map(d => ({
          ...d,
          attendance_date: new Date(d.attendance_date).toISOString().split('T')[0],
          in_time: d.in_time ? d.in_time.toString().substring(0, 5) : null,
          out_time: d.out_time ? d.out_time.toString().substring(0, 5) : null
        }));
      } catch {
        // Day details not available
      }
    }

    return NextResponse.json({
      success: true,
      data: rows,
      dayDetails,
      total: rows.length
    });

  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch attendance summary' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
