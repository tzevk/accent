/**
 * API to list SmartOffice employees with their UserIds
 * This helps users find the correct biometric code to enter
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const showRecent = searchParams.get('recent') === 'true';
    
    // Get employees from SmartOffice
    let empQuery = `
      SELECT TOP 100
        EmployeeId,
        EmployeeCode,
        NumericCode,
        EmployeeName,
        Status
      FROM Employees
      WHERE 1=1
    `;
    
    if (search) {
      empQuery += ` AND (
        EmployeeName LIKE '%${search}%' OR
        EmployeeCode LIKE '%${search}%' OR
        NumericCode LIKE '%${search}%'
      )`;
    }
    
    empQuery += ` ORDER BY EmployeeName`;
    
    const employees = await querySmartOffice(empQuery);
    
    // Get distinct UserIds from recent DeviceLogs to see who has punch data
    let recentUserIds = [];
    if (showRecent) {
      try {
        const currentDate = new Date();
        const month = currentDate.getMonth() + 1;
        const year = currentDate.getFullYear();
        const tableName = `DeviceLogs_${month}_${year}`;
        
        const recentQuery = `
          SELECT DISTINCT UserId, COUNT(*) as punch_count
          FROM [${tableName}]
          WHERE LogDate >= DATEADD(day, -7, GETDATE())
          GROUP BY UserId
          ORDER BY punch_count DESC
        `;
        recentUserIds = await querySmartOffice(recentQuery);
      } catch (err) {
        console.log('Could not fetch recent UserIds:', err.message);
      }
    }
    
    // Map employees to include punch status
    const recentUserIdSet = new Set(recentUserIds.map(r => r.UserId));
    const employeesWithPunchStatus = employees.map(emp => ({
      ...emp,
      hasRecentPunches: recentUserIdSet.has(emp.EmployeeCode) || recentUserIdSet.has(emp.NumericCode),
      // The UserId to use in biometric_code field
      biometric_code_to_use: emp.EmployeeCode || emp.NumericCode
    }));
    
    return NextResponse.json({
      success: true,
      total: employees.length,
      employees: employeesWithPunchStatus,
      recentActiveUserIds: recentUserIds.slice(0, 20),
      hint: 'Use the "biometric_code_to_use" or "EmployeeCode" value as the Biometric Code in employee management'
    });
    
  } catch (error) {
    console.error('Error listing SmartOffice employees:', error);
    return NextResponse.json({
      error: 'Failed to list SmartOffice employees',
      details: error.message
    }, { status: 500 });
  }
}
