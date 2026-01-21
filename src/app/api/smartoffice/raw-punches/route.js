/**
 * API to extract RAW PUNCHES from SmartOffice DeviceLogs
 * Returns individual punch timestamps for each employee
 * 
 * NOTE: biometric_code in local DB should be the UserId from SmartOffice DeviceLogs
 * User must manually enter the correct SmartOffice UserId for each employee
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';
import { dbConnect } from '@/utils/database';

// GET - Extract raw punches for a date range
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const biometricCode = searchParams.get('biometricCode'); // Optional: filter by specific employee

    if (!startDate || !endDate) {
      return NextResponse.json({
        error: 'startDate and endDate are required (YYYY-MM-DD format)'
      }, { status: 400 });
    }

    // Get employee biometric codes from local DB
    // biometric_code = SmartOffice UserId (entered manually by user)
    let biometricCodes = [];
    
    if (biometricCode) {
      biometricCodes = [biometricCode];
    } else {
      const conn = await dbConnect();
      try {
        const [employees] = await conn.execute(
          'SELECT biometric_code FROM employees WHERE biometric_code IS NOT NULL AND biometric_code != ""'
        );
        biometricCodes = employees.map(e => e.biometric_code);
      } finally {
        conn.release();
      }
    }

    if (biometricCodes.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No employees with biometric codes found',
        data: []
      });
    }

    // Parse dates to determine which partitioned tables to query
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Generate list of month/year combinations
    const monthYearCombos = [];
    let current = new Date(start.getFullYear(), start.getMonth(), 1);
    while (current <= end) {
      monthYearCombos.push({
        month: current.getMonth() + 1,
        year: current.getFullYear()
      });
      current.setMonth(current.getMonth() + 1);
    }

    // Build queries for partitioned tables
    // biometricCodes are directly used as UserId in DeviceLogs
    const tableQueries = monthYearCombos.map(({ month, year }) => {
      const tableName = `DeviceLogs_${month}_${year}`;
      return `
        SELECT 
          DeviceLogId,
          UserId AS biometric_code,
          LogDate AS punch_time,
          Direction AS direction,
          DeviceId AS device_id,
          VerificationMode AS verification_mode,
          AttenndanceMarkingType AS marking_type,
          '${tableName}' AS source_table
        FROM [${tableName}]
        WHERE UserId IN (${biometricCodes.map(c => `'${c}'`).join(',')})
          AND CAST(LogDate AS DATE) >= '${startDate}'
          AND CAST(LogDate AS DATE) <= '${endDate}'
      `;
    });

    // Also try the main DeviceLogs table (for non-partitioned data)
    tableQueries.push(`
      SELECT 
        DeviceLogId,
        UserId AS biometric_code,
        LogDate AS punch_time,
        Direction AS direction,
        DeviceId AS device_id,
        VerificationMode AS verification_mode,
        AttenndanceMarkingType AS marking_type,
        'DeviceLogs' AS source_table
      FROM [DeviceLogs]
      WHERE UserId IN (${biometricCodes.map(c => `'${c}'`).join(',')})
        AND CAST(LogDate AS DATE) >= '${startDate}'
        AND CAST(LogDate AS DATE) <= '${endDate}'
    `);

    // Try each table individually and collect results (some tables may not exist)
    let allPunches = [];
    
    for (const query of tableQueries) {
      try {
        const results = await querySmartOffice(query);
        allPunches = [...allPunches, ...results];
      } catch (err) {
        // Table might not exist, skip silently
        console.log(`Skipping table query: ${err.message}`);
      }
    }

    // Sort by biometric_code and punch_time
    allPunches.sort((a, b) => {
      if (a.biometric_code !== b.biometric_code) {
        return String(a.biometric_code).localeCompare(String(b.biometric_code));
      }
      return new Date(a.punch_time) - new Date(b.punch_time);
    });

    // Group punches by employee and date for easier processing
    const punchesByEmployeeDate = {};
    
    for (const punch of allPunches) {
      const punchDate = new Date(punch.punch_time).toISOString().split('T')[0];
      const key = `${punch.biometric_code}_${punchDate}`;
      
      if (!punchesByEmployeeDate[key]) {
        punchesByEmployeeDate[key] = {
          biometric_code: punch.biometric_code,
          date: punchDate,
          punches: []
        };
      }
      
      punchesByEmployeeDate[key].punches.push({
        id: punch.DeviceLogId,
        time: punch.punch_time,
        direction: punch.direction,
        device_id: punch.device_id,
        verification_mode: punch.verification_mode,
        marking_type: punch.marking_type,
        source_table: punch.source_table
      });
    }

    return NextResponse.json({
      success: true,
      dateRange: { startDate, endDate },
      employeeCount: biometricCodes.length,
      totalPunches: allPunches.length,
      punchDays: Object.keys(punchesByEmployeeDate).length,
      data: Object.values(punchesByEmployeeDate)
    });

  } catch (error) {
    console.error('Error extracting raw punches:', error);
    return NextResponse.json({
      error: 'Failed to extract raw punches',
      details: error.message
    }, { status: 500 });
  }
}
