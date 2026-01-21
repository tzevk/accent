/**
 * SmartOffice Attendance Integration API
 * Fetches attendance data from external SmartOffice SQL Server
 * READ-ONLY - Does not modify SmartOffice data
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';
import { dbConnect } from '@/utils/database';

/**
 * GET /api/smartoffice/attendance
 * Fetch attendance from SmartOffice for a given month
 * 
 * Query params:
 *  - month: YYYY-MM format (required)
 *  - employee_code: Filter by specific employee code (optional)
 *  - sync: If 'true', also sync to local database (optional)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month'); // YYYY-MM
    const employeeCode = searchParams.get('employee_code');
    const shouldSync = searchParams.get('sync') === 'true';

    if (!month) {
      return NextResponse.json({ 
        error: 'Month parameter required (format: YYYY-MM)' 
      }, { status: 400 });
    }

    // Parse month to get date range
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split('T')[0]; // Last day of month

    // First, get the SmartOffice codes for our local employees
    const localDb = await dbConnect();
    const [localEmployees] = await localDb.execute(`
      SELECT id, employee_id, biometric_code, first_name, last_name
      FROM employees
      WHERE biometric_code IS NOT NULL
    `);
    localDb.release();
    
    // Get list of SmartOffice codes we care about
    const biometricCodes = localEmployees.map(e => e.biometric_code).filter(Boolean);
    
    if (biometricCodes.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No employees have biometric codes mapped. Please run employee matching first.',
        hint: 'Visit /api/smartoffice/match-employees to match employees'
      }, { status: 400 });
    }

    // Build SmartOffice query - filter by our mapped employee codes
    let query = `
      SELECT 
        a.EmployeeId,
        a.AttendanceDate,
        a.InTime,
        a.OutTime,
        a.Duration,
        a.Status,
        a.LateBy,
        a.EarlyBy,
        a.OverTime,
        a.Present,
        a.Absent,
        a.LeaveType,
        a.LeaveStatus,
        a.Remarks,
        a.WeeklyOff,
        a.Holiday,
        e.EmployeeCode,
        e.EmployeeName,
        e.NumericCode,
        e.DepartmentId
      FROM AttendanceLogs a
      INNER JOIN Employees e ON a.EmployeeId = e.EmployeeId
      WHERE a.AttendanceDate >= @startDate 
        AND a.AttendanceDate <= @endDate
        AND e.EmployeeCode IN (${biometricCodes.map(c => `'${c}'`).join(',')})
    `;

    const params = { startDate, endDate };

    if (employeeCode) {
      query += ` AND e.EmployeeCode = @employeeCode`;
      params.employeeCode = employeeCode;
    }

    query += ` ORDER BY e.EmployeeCode, a.AttendanceDate`;

    // Fetch from SmartOffice
    const smartOfficeData = await querySmartOffice(query, params);

    // Group by employee
    const employeeAttendance = {};
    smartOfficeData.forEach(record => {
      const empCode = record.EmployeeCode;
      if (!employeeAttendance[empCode]) {
        employeeAttendance[empCode] = {
          employee_code: empCode,
          employee_name: record.EmployeeName,
          numeric_code: record.NumericCode,
          department_id: record.DepartmentId,
          total_present: 0,
          total_absent: 0,
          total_late: 0,
          total_overtime_minutes: 0,
          total_weekly_off: 0,
          total_holidays: 0,
          days: {}
        };
      }

      const dateKey = new Date(record.AttendanceDate).toISOString().split('T')[0];
      
      // Parse times (format could be "HH:mm" or "HH:mm:ss")
      const inTime = record.InTime ? record.InTime.substring(0, 5) : null;
      const outTime = record.OutTime ? record.OutTime.substring(0, 5) : null;

      employeeAttendance[empCode].days[dateKey] = {
        status: mapStatus(record.Status, record.Present, record.Absent, record.WeeklyOff, record.Holiday, record.LeaveType),
        in_time: inTime,
        out_time: outTime,
        duration: record.Duration,
        late_by: record.LateBy || 0,
        early_by: record.EarlyBy || 0,
        overtime: record.OverTime || 0,
        leave_type: record.LeaveType,
        remarks: record.Remarks,
        is_weekly_off: record.WeeklyOff === 1,
        is_holiday: record.Holiday === 1
      };

      // Update totals
      if (record.Present > 0) employeeAttendance[empCode].total_present += record.Present;
      if (record.Absent > 0) employeeAttendance[empCode].total_absent += record.Absent;
      if (record.LateBy > 0) employeeAttendance[empCode].total_late++;
      if (record.OverTime > 0) employeeAttendance[empCode].total_overtime_minutes += record.OverTime;
      if (record.WeeklyOff === 1) employeeAttendance[empCode].total_weekly_off++;
      if (record.Holiday === 1) employeeAttendance[empCode].total_holidays++;
    });

    const result = {
      success: true,
      month,
      startDate,
      endDate,
      source: 'SmartOffice',
      totalRecords: smartOfficeData.length,
      employees: Object.values(employeeAttendance)
    };

    // Optionally sync to local database
    if (shouldSync) {
      const syncResult = await syncToLocalDatabase(employeeAttendance, month);
      result.syncResult = syncResult;
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('SmartOffice attendance error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      details: 'Failed to fetch attendance from SmartOffice'
    }, { status: 500 });
  }
}

/**
 * Map SmartOffice status to our status codes
 */
function mapStatus(status, present, absent, weeklyOff, holiday, leaveType) {
  if (weeklyOff === 1) return 'WO'; // Weekly Off
  if (holiday === 1) return 'H'; // Holiday
  if (leaveType && leaveType.trim()) {
    // Map leave types
    const lt = leaveType.toUpperCase().trim();
    if (lt.includes('CL') || lt.includes('CASUAL')) return 'CL';
    if (lt.includes('SL') || lt.includes('SICK')) return 'SL';
    if (lt.includes('PL') || lt.includes('PRIVILEGE') || lt.includes('EARNED')) return 'PL';
    if (lt.includes('LWP') || lt.includes('WITHOUT PAY')) return 'LWP';
    if (lt.includes('COMP') || lt.includes('COMPENSATORY')) return 'CO';
    return 'L'; // Generic leave
  }
  if (present >= 1) return 'P'; // Present
  if (present > 0 && present < 1) return 'HD'; // Half Day
  if (absent >= 1) return 'A'; // Absent
  
  // Check status string
  if (status) {
    const s = status.toUpperCase().trim();
    if (s === 'P' || s === 'PRESENT') return 'P';
    if (s === 'A' || s === 'ABSENT') return 'A';
    if (s === 'L' || s === 'LEAVE') return 'L';
    if (s === 'HD' || s === 'HALF') return 'HD';
  }
  
  return 'A'; // Default to absent
}

/**
 * Sync SmartOffice attendance to local database
 */
async function syncToLocalDatabase(employeeAttendance, month) {
  let connection;
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  try {
    connection = await dbConnect();

    // Get employee mapping (biometric_code -> local employee id)
    const [localEmployees] = await connection.execute(`
      SELECT id, employee_id, biometric_code, attendance_id, first_name, last_name
      FROM employees 
      WHERE biometric_code IS NOT NULL OR attendance_id IS NOT NULL
    `);

    // Create mapping: SmartOffice code -> local employee ID
    const employeeMap = {};
    localEmployees.forEach(emp => {
      if (emp.biometric_code) employeeMap[emp.biometric_code] = emp.id;
      if (emp.attendance_id) employeeMap[emp.attendance_id] = emp.id;
      // Also map by employee_id if it matches
      if (emp.employee_id) employeeMap[emp.employee_id] = emp.id;
    });

    // Sync each employee's attendance
    for (const empData of Object.values(employeeAttendance)) {
      const localEmployeeId = employeeMap[empData.employee_code] || 
                              employeeMap[empData.numeric_code?.toString()];

      if (!localEmployeeId) {
        skipped++;
        continue; // Skip if no matching local employee
      }

      // Insert/update each day's attendance
      for (const [dateKey, dayData] of Object.entries(empData.days)) {
        try {
          await connection.execute(`
            INSERT INTO employee_attendance 
              (employee_id, attendance_date, status, in_time, out_time, overtime_hours, is_weekly_off, remarks, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              status = VALUES(status),
              in_time = VALUES(in_time),
              out_time = VALUES(out_time),
              overtime_hours = VALUES(overtime_hours),
              is_weekly_off = VALUES(is_weekly_off),
              remarks = CONCAT(IFNULL(remarks, ''), ' [SmartOffice Sync]'),
              updated_at = NOW()
          `, [
            localEmployeeId,
            dateKey,
            dayData.status,
            dayData.in_time,
            dayData.out_time,
            Math.round((dayData.overtime || 0) / 60 * 100) / 100, // Convert minutes to hours
            dayData.is_weekly_off ? 1 : 0,
            dayData.remarks || `Late: ${dayData.late_by}min, Early: ${dayData.early_by}min`
          ]);
          synced++;
        } catch (err) {
          console.error(`Sync error for ${empData.employee_code} on ${dateKey}:`, err.message);
          failed++;
        }
      }
    }

    return {
      success: true,
      synced,
      failed,
      skipped,
      message: `Synced ${synced} records, ${failed} failed, ${skipped} employees not mapped`
    };

  } catch (error) {
    console.error('Sync error:', error);
    return {
      success: false,
      error: error.message,
      synced,
      failed,
      skipped
    };
  } finally {
    if (connection) connection.release();
  }
}
