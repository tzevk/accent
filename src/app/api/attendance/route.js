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

// POST - Save/Update attendance records (bulk) - OPTIMIZED with batching
export async function POST(request) {
  // RBAC check
  const authResultPost = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE);
  if (authResultPost.authorized === false) return authResultPost.response;

  let connection;
  try {
    const body = await request.json();
    const { attendance_records } = body;

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
    
    // Create table if it doesn't exist (only runs once due to IF NOT EXISTS)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS employee_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        attendance_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'P',
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

    // Process in smaller batches of 50 records to avoid query size limits
    const BATCH_SIZE = 50;
    let totalProcessed = 0;
    
    for (let i = 0; i < attendance_records.length; i += BATCH_SIZE) {
      const batch = attendance_records.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = [];
      
      for (const record of batch) {
        const status = (record.status || 'P').substring(0, 20);
        values.push(
          record.employee_id,
          record.attendance_date,
          status,
          record.overtime_hours || 0,
          record.is_weekly_off ? 1 : 0,
          record.remarks || null,
          record.in_time || null,
          record.out_time || null
        );
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
      }
      
      // Use query instead of execute for better performance with dynamic queries
      const batchQuery = `
        INSERT INTO employee_attendance 
          (employee_id, attendance_date, status, overtime_hours, is_weekly_off, remarks, in_time, out_time)
        VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          overtime_hours = VALUES(overtime_hours),
          is_weekly_off = VALUES(is_weekly_off),
          remarks = VALUES(remarks),
          in_time = VALUES(in_time),
          out_time = VALUES(out_time),
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await connection.query(batchQuery, values);
      totalProcessed += batch.length;
    }
    
    // Release connection before returning
    connection.release();
    connection = null;

    return NextResponse.json({
      success: true,
      message: `Attendance saved: ${totalProcessed} records processed`,
      successCount: totalProcessed,
      errorCount: 0
    });

  } catch (error) {
    console.error('Error saving attendance:', error);
    if (connection) {
      try { connection.release(); } catch {}
    }
    return NextResponse.json({ error: error.message || 'Failed to save attendance' }, { status: 500 });
  }
}
