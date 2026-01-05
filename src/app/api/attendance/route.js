import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET - Fetch attendance records
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const month = searchParams.get('month'); // Format: YYYY-MM
    const year = searchParams.get('year');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    connection = await dbConnect();

    let query = `
      SELECT 
        a.*,
        e.employee_id AS employee_code,
        e.first_name,
        e.last_name,
        e.department
      FROM employee_attendance a
      JOIN employees e ON a.employee_id = e.id
      WHERE 1=1
    `;
    const queryParams = [];

    if (employeeId) {
      query += ' AND a.employee_id = ?';
      queryParams.push(employeeId);
    }

    if (month) {
      query += ' AND DATE_FORMAT(a.attendance_date, "%Y-%m") = ?';
      queryParams.push(month);
    }

    if (year) {
      query += ' AND YEAR(a.attendance_date) = ?';
      queryParams.push(year);
    }

    if (startDate && endDate) {
      query += ' AND a.attendance_date BETWEEN ? AND ?';
      queryParams.push(startDate, endDate);
    }

    query += ' ORDER BY a.attendance_date DESC, e.employee_id ASC';

    const [records] = await connection.execute(query, queryParams);

    // Group by employee for summary
    const employeeSummary = {};
    records.forEach(record => {
      if (!employeeSummary[record.employee_id]) {
        employeeSummary[record.employee_id] = {
          employee_id: record.employee_id,
          employee_code: record.employee_code,
          first_name: record.first_name,
          last_name: record.last_name,
          department: record.department,
          total_present: 0,
          total_absent: 0,
          total_leave: 0,
          total_overtime_hours: 0,
          total_weekly_off: 0,
          days: {}
        };
      }
      
      const dateKey = new Date(record.attendance_date).toISOString().split('T')[0];
      employeeSummary[record.employee_id].days[dateKey] = {
        status: record.status,
        overtime_hours: record.overtime_hours,
        is_weekly_off: record.is_weekly_off,
        remarks: record.remarks
      };

      // Update totals
      if (record.status === 'P') employeeSummary[record.employee_id].total_present++;
      if (record.status === 'A') employeeSummary[record.employee_id].total_absent++;
      if (record.status === 'PL') employeeSummary[record.employee_id].total_leave++;
      if (record.is_weekly_off) employeeSummary[record.employee_id].total_weekly_off++;
      employeeSummary[record.employee_id].total_overtime_hours += parseFloat(record.overtime_hours || 0);
    });

    return NextResponse.json({
      success: true,
      records,
      summary: Object.values(employeeSummary)
    });

  } catch (error) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch attendance' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// POST - Save/Update attendance records (bulk)
export async function POST(request) {
  // RBAC check
  const authResultPost = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE);
  if (authResultPost.authorized === false) return authResultPost.response;

  let connection;
  try {
    const body = await request.json();
    const { attendance_records, month } = body;

    if (!attendance_records || !Array.isArray(attendance_records)) {
      return NextResponse.json({ error: 'Attendance records array is required' }, { status: 400 });
    }

    if (attendance_records.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No records to save',
        successCount: 0,
        errorCount: 0
      });
    }

    connection = await dbConnect();
    
    // Create table if it doesn't exist
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        attendance_date DATE NOT NULL,
        status VARCHAR(10) DEFAULT 'P',
        overtime_hours DECIMAL(5, 2) DEFAULT 0,
        is_weekly_off TINYINT(1) DEFAULT 0,
        remarks TEXT,
        in_time TIME,
        out_time TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_emp_date (employee_id, attendance_date),
        INDEX idx_attendance_date (attendance_date),
        INDEX idx_employee_id (employee_id)
      )
    `);
    
    // Start transaction
    await connection.beginTransaction();

    try {
      // Use INSERT ... ON DUPLICATE KEY UPDATE for upsert
      const insertQuery = `
        INSERT INTO employee_attendance 
          (employee_id, attendance_date, status, overtime_hours, is_weekly_off, remarks)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          overtime_hours = VALUES(overtime_hours),
          is_weekly_off = VALUES(is_weekly_off),
          remarks = VALUES(remarks),
          updated_at = CURRENT_TIMESTAMP
      `;

      let successCount = 0;
      let errorCount = 0;
      const errors = [];

      for (const record of attendance_records) {
        try {
          await connection.execute(insertQuery, [
            record.employee_id,
            record.attendance_date,
            record.status || 'P',
            record.overtime_hours || 0,
            record.is_weekly_off ? 1 : 0,
            record.remarks || null
          ]);
          successCount++;
        } catch (err) {
          console.error('Error inserting attendance record:', err);
          errorCount++;
          errors.push({
            employee_id: record.employee_id,
            date: record.attendance_date,
            error: err.message
          });
        }
      }
      
      // Commit transaction
      await connection.commit();

      return NextResponse.json({
        success: true,
        message: `Attendance saved: ${successCount} records updated${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
        successCount,
        errorCount,
        errors: errorCount > 0 ? errors : undefined
      });
      
    } catch (err) {
      // Rollback on error
      await connection.rollback();
      throw err;
    }

  } catch (error) {
    console.error('Error saving attendance:', error);
    return NextResponse.json({ error: error.message || 'Failed to save attendance' }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
