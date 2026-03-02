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
        remarks: record.remarks,
        in_time: record.in_time,
        out_time: record.out_time,
        idle_time: record.idle_time || 0
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
        idle_time INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_emp_date (employee_id, attendance_date),
        INDEX idx_attendance_date (attendance_date),
        INDEX idx_employee_id (employee_id)
      )
    `);

    // Add idle_time column if it doesn't exist (for existing tables)
    try {
      await connection.query(`ALTER TABLE employee_attendance ADD COLUMN idle_time INT DEFAULT 0 AFTER out_time`);
    } catch (e) {
      // Column already exists – ignore
    }

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
          record.out_time || null,
          record.idle_time || 0
        );
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?)');
      }
      
      // Use query instead of execute for better performance with dynamic queries
      const batchQuery = `
        INSERT INTO employee_attendance 
          (employee_id, attendance_date, status, overtime_hours, is_weekly_off, remarks, in_time, out_time, idle_time)
        VALUES ${placeholders.join(', ')}
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          overtime_hours = VALUES(overtime_hours),
          is_weekly_off = VALUES(is_weekly_off),
          remarks = VALUES(remarks),
          in_time = VALUES(in_time),
          out_time = VALUES(out_time),
          idle_time = VALUES(idle_time),
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await connection.query(batchQuery, values);
      totalProcessed += batch.length;
    }

    // --- Update monthly summary for each employee ---
    // Create summary table if not exists
    await connection.query(`
      CREATE TABLE IF NOT EXISTS employee_attendance_summary (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        month VARCHAR(7) NOT NULL,
        total_present INT DEFAULT 0,
        total_absent INT DEFAULT 0,
        total_weekly_off INT DEFAULT 0,
        total_holiday INT DEFAULT 0,
        total_privilege_leave INT DEFAULT 0,
        total_casual_leave INT DEFAULT 0,
        total_sick_leave INT DEFAULT 0,
        total_lwp INT DEFAULT 0,
        total_half_day INT DEFAULT 0,
        total_overtime_hours DECIMAL(8,2) DEFAULT 0,
        total_working_hours DECIMAL(8,2) DEFAULT 0,
        std_in_time TIME,
        std_out_time TIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_emp_month (employee_id, month),
        INDEX idx_month (month)
      )
    `);

    // Compute per-employee summary from the saved records for this month
    const monthKey = body.month;
    if (monthKey) {
      const [savedRecords] = await connection.execute(
        `SELECT employee_id, status, overtime_hours, is_weekly_off, in_time, out_time, idle_time
         FROM employee_attendance
         WHERE DATE_FORMAT(attendance_date, "%Y-%m") = ?`,
        [monthKey]
      );

      const empSummaries = {};
      savedRecords.forEach(r => {
        if (!empSummaries[r.employee_id]) {
          empSummaries[r.employee_id] = {
            present: 0, absent: 0, weekly_off: 0, holiday: 0,
            privilege_leave: 0, casual_leave: 0, sick_leave: 0,
            lwp: 0, half_day: 0, overtime_hours: 0, working_hours: 0,
            std_in_time: r.in_time || null, std_out_time: r.out_time || null
          };
        }
        const s = empSummaries[r.employee_id];
        if (r.status === 'P') s.present++;
        if (r.status === 'A') s.absent++;
        if (r.status === 'WO') s.weekly_off++;
        if (r.status === 'H') s.holiday++;
        if (r.status === 'PL') s.privilege_leave++;
        if (r.status === 'CL') s.casual_leave++;
        if (r.status === 'SL') s.sick_leave++;
        if (r.status === 'LWP') s.lwp++;
        if (r.status === 'HD') s.half_day++;
        s.overtime_hours += parseFloat(r.overtime_hours || 0);

        // Calculate working hours for present/HD/OT days
        if (r.status === 'P' || r.status === 'HD' || r.status === 'OT') {
          const inTime = r.in_time ? r.in_time.toString().substring(0, 5) : '09:00';
          const outTime = r.out_time ? r.out_time.toString().substring(0, 5) : '17:30';
          const [inH, inM] = inTime.split(':').map(Number);
          const [outH, outM] = outTime.split(':').map(Number);
          const inDec = inH + inM / 60;
          const outDec = outH + outM / 60;
          if (outDec > inDec) {
            let hrs = outDec - inDec;
            // Subtract idle time (stored in minutes)
            const idleHrs = (r.idle_time || 0) / 60;
            hrs = Math.max(0, hrs - idleHrs);
            if (r.status === 'HD') hrs = hrs / 2;
            s.working_hours += hrs;
          }
        }

        if (r.in_time) s.std_in_time = r.in_time;
        if (r.out_time) s.std_out_time = r.out_time;
      });

      // Upsert summaries
      for (const [empId, s] of Object.entries(empSummaries)) {
        await connection.execute(
          `INSERT INTO employee_attendance_summary 
            (employee_id, month, total_present, total_absent, total_weekly_off, total_holiday,
             total_privilege_leave, total_casual_leave, total_sick_leave, total_lwp, total_half_day,
             total_overtime_hours, total_working_hours, std_in_time, std_out_time)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             total_present = VALUES(total_present),
             total_absent = VALUES(total_absent),
             total_weekly_off = VALUES(total_weekly_off),
             total_holiday = VALUES(total_holiday),
             total_privilege_leave = VALUES(total_privilege_leave),
             total_casual_leave = VALUES(total_casual_leave),
             total_sick_leave = VALUES(total_sick_leave),
             total_lwp = VALUES(total_lwp),
             total_half_day = VALUES(total_half_day),
             total_overtime_hours = VALUES(total_overtime_hours),
             total_working_hours = VALUES(total_working_hours),
             std_in_time = VALUES(std_in_time),
             std_out_time = VALUES(std_out_time),
             updated_at = CURRENT_TIMESTAMP`,
          [empId, monthKey, s.present, s.absent, s.weekly_off, s.holiday,
           s.privilege_leave, s.casual_leave, s.sick_leave, s.lwp, s.half_day,
           parseFloat(s.overtime_hours.toFixed(2)), parseFloat(s.working_hours.toFixed(2)),
           s.std_in_time, s.std_out_time]
        );
      }
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
