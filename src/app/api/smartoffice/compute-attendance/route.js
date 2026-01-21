/**
 * API to COMPUTE and STORE clean attendance from raw punches
 * 
 * This endpoint:
 * 1. Extracts raw punches from SmartOffice DeviceLogs
 * 2. Computes clean attendance (first in, last out, duration, status)
 * 3. Stores results in local computed_attendance table
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';
import { dbConnect } from '@/utils/database';

// Initialize the computed_attendance table if it doesn't exist
async function initComputedAttendanceTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS computed_attendance (
      id INT AUTO_INCREMENT PRIMARY KEY,
      employee_id INT NOT NULL,
      biometric_code VARCHAR(50) NOT NULL,
      attendance_date DATE NOT NULL,
      first_in TIME NULL,
      last_out TIME NULL,
      total_punches INT DEFAULT 0,
      work_duration_minutes INT DEFAULT 0,
      work_duration VARCHAR(10) DEFAULT '00:00',
      status ENUM('Present', 'Absent', 'Half Day', 'Late', 'Early Out', 'Late & Early Out') DEFAULT 'Absent',
      late_by_minutes INT DEFAULT 0,
      early_out_minutes INT DEFAULT 0,
      overtime_minutes INT DEFAULT 0,
      punch_details JSON NULL,
      source VARCHAR(20) DEFAULT 'SmartOffice',
      computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_emp_date (employee_id, attendance_date),
      INDEX idx_date (attendance_date),
      INDEX idx_biometric (biometric_code),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Get raw punches for a date range from SmartOffice
// biometric_code = SmartOffice UserId (entered manually by user)
async function getRawPunches(biometricCodes, startDate, endDate) {
  if (biometricCodes.length === 0) {
    return [];
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Generate month/year combinations for partitioned tables
  const monthYearCombos = [];
  let current = new Date(start.getFullYear(), start.getMonth(), 1);
  while (current <= end) {
    monthYearCombos.push({
      month: current.getMonth() + 1,
      year: current.getFullYear()
    });
    current.setMonth(current.getMonth() + 1);
  }

  let allPunches = [];
  
  // Query each partitioned table
  // biometricCodes are directly used as UserId in DeviceLogs
  for (const { month, year } of monthYearCombos) {
    const tableName = `DeviceLogs_${month}_${year}`;
    const query = `
      SELECT 
        DeviceLogId,
        UserId AS biometric_code,
        LogDate AS punch_time,
        Direction AS direction,
        DeviceId AS device_id
      FROM [${tableName}]
      WHERE UserId IN (${biometricCodes.map(c => `'${c}'`).join(',')})
        AND CAST(LogDate AS DATE) >= '${startDate}'
        AND CAST(LogDate AS DATE) <= '${endDate}'
      ORDER BY UserId, LogDate
    `;
    
    try {
      const results = await querySmartOffice(query);
      allPunches = [...allPunches, ...results];
    } catch (err) {
      // Table might not exist, skip silently
      console.log(`Table ${tableName} not found, skipping...`);
    }
  }
  
  // Also try main DeviceLogs table
  try {
    const query = `
      SELECT 
        DeviceLogId,
        UserId AS biometric_code,
        LogDate AS punch_time,
        Direction AS direction,
        DeviceId AS device_id
      FROM [DeviceLogs]
      WHERE UserId IN (${biometricCodes.map(c => `'${c}'`).join(',')})
        AND CAST(LogDate AS DATE) >= '${startDate}'
        AND CAST(LogDate AS DATE) <= '${endDate}'
      ORDER BY UserId, LogDate
    `;
    const results = await querySmartOffice(query);
    allPunches = [...allPunches, ...results];
  } catch (err) {
    console.log('Main DeviceLogs table not accessible:', err.message);
  }
  
  console.log(`Found ${allPunches.length} total punches for ${biometricCodes.length} employees`);
  
  return allPunches;
}

// Compute clean attendance from raw punches
function computeAttendance(punches, shiftConfig = { startTime: '09:00', endTime: '18:00', minHours: 8, halfDayHours: 4, lateGrace: 15 }) {
  // Group punches by employee and date
  const groupedPunches = {};;
  
  for (const punch of punches) {
    const punchDate = new Date(punch.punch_time).toISOString().split('T')[0];
    const key = `${punch.biometric_code}_${punchDate}`;
    
    if (!groupedPunches[key]) {
      groupedPunches[key] = {
        biometric_code: punch.biometric_code,
        date: punchDate,
        punches: []
      };
    }
    
    groupedPunches[key].punches.push({
      time: new Date(punch.punch_time),
      direction: punch.direction,
      device_id: punch.device_id
    });
  }
  
  // Compute attendance for each employee-date
  const computedRecords = [];
  
  for (const key in groupedPunches) {
    const record = groupedPunches[key];
    const dayPunches = record.punches.sort((a, b) => a.time - b.time);
    
    // Get first and last punch times
    const firstPunch = dayPunches[0];
    const lastPunch = dayPunches[dayPunches.length - 1];
    
    const firstIn = firstPunch.time;
    const lastOut = lastPunch.time;
    
    // Calculate work duration in minutes
    const durationMs = lastOut - firstIn;
    const durationMinutes = Math.floor(durationMs / (1000 * 60));
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    const durationFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    // Parse shift times
    const [shiftStartHour, shiftStartMin] = shiftConfig.startTime.split(':').map(Number);
    const [shiftEndHour, shiftEndMin] = shiftConfig.endTime.split(':').map(Number);
    
    // Calculate late by - use UTC methods since times are stored as UTC
    const expectedStart = new Date(firstIn);
    expectedStart.setUTCHours(shiftStartHour, shiftStartMin, 0, 0);
    const lateByMs = firstIn - expectedStart;
    const lateByMinutes = Math.max(0, Math.floor(lateByMs / (1000 * 60)) - shiftConfig.lateGrace);
    
    // Calculate early out - use UTC methods
    const expectedEnd = new Date(lastOut);
    expectedEnd.setUTCHours(shiftEndHour, shiftEndMin, 0, 0);
    const earlyOutMs = expectedEnd - lastOut;
    const earlyOutMinutes = Math.max(0, Math.floor(earlyOutMs / (1000 * 60)));
    
    // Calculate overtime (work after shift end)
    const overtimeMs = Math.max(0, lastOut - expectedEnd);
    const overtimeMinutes = Math.floor(overtimeMs / (1000 * 60));
    
    // Determine status
    let status = 'Present';
    const workHours = durationMinutes / 60;
    
    if (workHours < shiftConfig.halfDayHours) {
      status = 'Half Day';
    } else if (lateByMinutes > 0 && earlyOutMinutes > 0) {
      status = 'Late & Early Out';
    } else if (lateByMinutes > 0) {
      status = 'Late';
    } else if (earlyOutMinutes > 0) {
      status = 'Early Out';
    }
    
    // Format times for storage - extract time from UTC string directly
    // SmartOffice stores local times as UTC, so we use the UTC components
    const formatTime = (date) => {
      const hours = date.getUTCHours().toString().padStart(2, '0');
      const mins = date.getUTCMinutes().toString().padStart(2, '0');
      const secs = date.getUTCSeconds().toString().padStart(2, '0');
      return `${hours}:${mins}:${secs}`;
    };
    
    computedRecords.push({
      biometric_code: record.biometric_code,
      date: record.date,
      first_in: formatTime(firstIn),
      last_out: formatTime(lastOut),
      total_punches: dayPunches.length,
      work_duration_minutes: durationMinutes,
      work_duration: durationFormatted,
      status,
      late_by_minutes: lateByMinutes,
      early_out_minutes: earlyOutMinutes,
      overtime_minutes: overtimeMinutes,
      punch_details: JSON.stringify(dayPunches.map(p => ({
        time: formatTime(p.time),
        direction: p.direction,
        device_id: p.device_id
      })))
    });
  }
  
  return computedRecords;
}

// POST - Compute and store attendance
export async function POST(request) {
  const conn = await dbConnect();
  
  try {
    const body = await request.json();
    const { startDate, endDate, overwrite = false } = body;
    
    if (!startDate || !endDate) {
      return NextResponse.json({
        error: 'startDate and endDate are required (YYYY-MM-DD format)'
      }, { status: 400 });
    }
    
    // Initialize table
    await initComputedAttendanceTable(conn);
    
    // Get employees with biometric codes
    const [employees] = await conn.execute(
      `SELECT id, biometric_code, CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as name, department 
       FROM employees WHERE biometric_code IS NOT NULL AND biometric_code != ""`
    );
    
    if (employees.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No employees with biometric codes found',
        computed: 0,
        stored: 0
      });
    }
    
    const biometricCodes = employees.map(e => e.biometric_code);
    const biometricToEmployee = {};
    employees.forEach(e => {
      biometricToEmployee[e.biometric_code] = { id: e.id, name: e.name?.trim() || 'Unknown', department: e.department };
    });
    
    // Extract raw punches from SmartOffice
    const rawPunches = await getRawPunches(biometricCodes, startDate, endDate);
    
    if (rawPunches.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No raw punches found for the date range',
        dateRange: { startDate, endDate },
        stats: {
          employeesProcessed: employees.length,
          rawPunchesFound: 0,
          recordsComputed: 0,
          inserted: 0,
          updated: 0,
          skipped: 0
        }
      });
    }
    
    // Compute clean attendance
    const computedRecords = computeAttendance(rawPunches);
    
    // Store in local database
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const record of computedRecords) {
      const employee = biometricToEmployee[record.biometric_code];
      if (!employee) {
        skippedCount++;
        continue;
      }
      
      if (overwrite) {
        // Use REPLACE to overwrite existing records
        await conn.execute(`
          REPLACE INTO computed_attendance 
          (employee_id, biometric_code, attendance_date, first_in, last_out, 
           total_punches, work_duration_minutes, work_duration, status, 
           late_by_minutes, early_out_minutes, overtime_minutes, punch_details, computed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `, [
          employee.id,
          record.biometric_code,
          record.date,
          record.first_in,
          record.last_out,
          record.total_punches,
          record.work_duration_minutes,
          record.work_duration,
          record.status,
          record.late_by_minutes,
          record.early_out_minutes,
          record.overtime_minutes,
          record.punch_details
        ]);
        updatedCount++;
      } else {
        // Insert only if not exists
        try {
          await conn.execute(`
            INSERT INTO computed_attendance 
            (employee_id, biometric_code, attendance_date, first_in, last_out, 
             total_punches, work_duration_minutes, work_duration, status, 
             late_by_minutes, early_out_minutes, overtime_minutes, punch_details, computed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
          `, [
            employee.id,
            record.biometric_code,
            record.date,
            record.first_in,
            record.last_out,
            record.total_punches,
            record.work_duration_minutes,
            record.work_duration,
            record.status,
            record.late_by_minutes,
            record.early_out_minutes,
            record.overtime_minutes,
            record.punch_details
          ]);
          insertedCount++;
        } catch (err) {
          if (err.code === 'ER_DUP_ENTRY') {
            skippedCount++;
          } else {
            throw err;
          }
        }
      }
    }
    
    return NextResponse.json({
      success: true,
      message: 'Attendance computed and stored successfully',
      dateRange: { startDate, endDate },
      stats: {
        employeesProcessed: employees.length,
        rawPunchesFound: rawPunches.length,
        recordsComputed: computedRecords.length,
        inserted: insertedCount,
        updated: updatedCount,
        skipped: skippedCount
      }
    });
    
  } catch (error) {
    console.error('Error computing attendance:', error);
    return NextResponse.json({
      error: 'Failed to compute and store attendance',
      details: error.message
    }, { status: 500 });
  } finally {
    conn.release();
  }
}

// GET - Retrieve computed attendance
export async function GET(request) {
  const conn = await dbConnect();
  
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const includeDetails = searchParams.get('includeDetails') === 'true';
    
    // Initialize table if needed
    await initComputedAttendanceTable(conn);
    
    let query = `
      SELECT 
        ca.id,
        ca.employee_id,
        ca.biometric_code,
        ca.attendance_date,
        ca.first_in,
        ca.last_out,
        ca.total_punches,
        ca.work_duration_minutes,
        ca.work_duration,
        ca.status,
        ca.late_by_minutes,
        ca.early_out_minutes,
        ca.overtime_minutes,
        ${includeDetails ? 'ca.punch_details,' : ''}
        ca.computed_at,
        CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')) AS employee_name,
        e.department
      FROM computed_attendance ca
      LEFT JOIN employees e ON ca.employee_id = e.id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (startDate) {
      query += ' AND ca.attendance_date >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      query += ' AND ca.attendance_date <= ?';
      params.push(endDate);
    }
    
    if (employeeId) {
      query += ' AND ca.employee_id = ?';
      params.push(employeeId);
    }
    
    if (status) {
      query += ' AND ca.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY ca.attendance_date DESC, employee_name';
    
    const [records] = await conn.execute(query, params);
    
    // Get summary stats
    const [stats] = await conn.execute(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT employee_id) as unique_employees,
        COUNT(DISTINCT attendance_date) as unique_dates,
        SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present_count,
        SUM(CASE WHEN status = 'Late' THEN 1 ELSE 0 END) as late_count,
        SUM(CASE WHEN status = 'Half Day' THEN 1 ELSE 0 END) as half_day_count,
        SUM(CASE WHEN status = 'Early Out' THEN 1 ELSE 0 END) as early_out_count,
        AVG(work_duration_minutes) as avg_work_minutes
      FROM computed_attendance
      ${startDate ? 'WHERE attendance_date >= ?' : ''}
      ${endDate ? (startDate ? ' AND' : 'WHERE') + ' attendance_date <= ?' : ''}
    `, [startDate, endDate].filter(Boolean));
    
    return NextResponse.json({
      success: true,
      summary: stats[0],
      count: records.length,
      data: records.map(r => ({
        ...r,
        punch_details: includeDetails && r.punch_details ? JSON.parse(r.punch_details) : undefined
      }))
    });
    
  } catch (error) {
    console.error('Error retrieving computed attendance:', error);
    return NextResponse.json({
      error: 'Failed to retrieve computed attendance',
      details: error.message
    }, { status: 500 });
  } finally {
    conn.release();
  }
}
