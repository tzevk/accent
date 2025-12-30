import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// GET - Fetch attendance summary for an employee (for salary calculation)
export async function GET(request, { params }) {
  let connection;
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // Format: YYYY-MM
    const year = searchParams.get('year');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!id) {
      return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 });
    }

    connection = await dbConnect();

    // Get employee details
    const [employees] = await connection.execute(`
      SELECT id, employee_id AS employee_code, first_name, last_name, department
      FROM employees WHERE id = ?
    `, [id]);

    if (employees.length === 0) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    const employee = employees[0];

    // Build attendance query
    let query = `
      SELECT 
        attendance_date,
        status,
        overtime_hours,
        is_weekly_off,
        remarks
      FROM employee_attendance
      WHERE employee_id = ?
    `;
    const queryParams = [id];

    if (month) {
      query += ' AND DATE_FORMAT(attendance_date, "%Y-%m") = ?';
      queryParams.push(month);
    }

    if (year && !month) {
      query += ' AND YEAR(attendance_date) = ?';
      queryParams.push(year);
    }

    if (startDate && endDate) {
      query += ' AND attendance_date BETWEEN ? AND ?';
      queryParams.push(startDate, endDate);
    }

    query += ' ORDER BY attendance_date ASC';

    const [records] = await connection.execute(query, queryParams);

    // Calculate summary
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalLeave = 0;
    let totalOvertimeHours = 0;
    let totalWeeklyOff = 0;
    let totalWorkingDays = 0;
    const daysDetail = {};

    records.forEach(record => {
      const dateKey = new Date(record.attendance_date).toISOString().split('T')[0];
      daysDetail[dateKey] = {
        status: record.status,
        overtime_hours: parseFloat(record.overtime_hours || 0),
        is_weekly_off: record.is_weekly_off === 1,
        remarks: record.remarks
      };

      if (record.status === 'P') {
        totalPresent++;
        totalWorkingDays++;
      }
      if (record.status === 'A') totalAbsent++;
      if (record.status === 'PL') {
        totalLeave++;
        totalWorkingDays++; // Paid leave counts as working day
      }
      if (record.status === 'OT') {
        totalPresent++;
        totalWorkingDays++;
        totalOvertimeHours += parseFloat(record.overtime_hours || 0);
      }
      if (record.is_weekly_off === 1) totalWeeklyOff++;
    });

    // Calculate payable days (for salary calculation)
    // Payable days = Present + Paid Leave + Weekly Off
    const payableDays = totalPresent + totalLeave + totalWeeklyOff;
    
    // Get standard working days from salary structure if available
    const [salaryStructure] = await connection.execute(`
      SELECT standard_working_days FROM salary_structures 
      WHERE employee_id = ? AND is_active = 1
    `, [id]);

    const standardWorkingDays = salaryStructure.length > 0 
      ? salaryStructure[0].standard_working_days 
      : 26; // Default to 26

    // Calculate LOP days (Loss of Pay)
    const totalDaysInPeriod = Object.keys(daysDetail).length;
    const lopDays = Math.max(0, totalAbsent); // Absent days are LOP

    // Attendance percentage
    const attendancePercentage = totalDaysInPeriod > 0 
      ? ((totalPresent + totalLeave) / (totalDaysInPeriod - totalWeeklyOff) * 100).toFixed(2)
      : 0;

    return NextResponse.json({
      success: true,
      employee: {
        id: employee.id,
        employee_code: employee.employee_code,
        name: `${employee.first_name} ${employee.last_name}`,
        department: employee.department
      },
      summary: {
        total_present: totalPresent,
        total_absent: totalAbsent,
        total_leave: totalLeave,
        total_overtime_hours: totalOvertimeHours,
        total_weekly_off: totalWeeklyOff,
        total_working_days: totalWorkingDays,
        payable_days: payableDays,
        lop_days: lopDays,
        standard_working_days: standardWorkingDays,
        attendance_percentage: parseFloat(attendancePercentage),
        total_days_in_period: totalDaysInPeriod
      },
      days: daysDetail,
      // For salary calculation
      salary_calculation_params: {
        payable_days: payableDays,
        lop_days: lopDays,
        overtime_hours: totalOvertimeHours,
        standard_working_days: standardWorkingDays,
        // Ratio for prorated salary
        pay_ratio: standardWorkingDays > 0 ? payableDays / standardWorkingDays : 1
      }
    });

  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch attendance summary' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
