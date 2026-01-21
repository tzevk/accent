/**
 * API to explore SmartOffice SQL Server database
 * READ-ONLY - Used to discover attendance tables and data
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';

// GET - Explore SmartOffice database
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'tables';
    const tableName = searchParams.get('table');

    let result;
    let query;

    switch (action) {
      case 'tables':
        // List all tables in the database
        query = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`;
        result = await querySmartOffice(query);
        return NextResponse.json({
          success: true,
          action: 'List all tables',
          query,
          data: result.map(r => r.TABLE_NAME),
        });

      case 'columns':
        // Get columns for a specific table
        if (!tableName) {
          return NextResponse.json({ error: 'Table name required' }, { status: 400 });
        }
        query = `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH 
                 FROM INFORMATION_SCHEMA.COLUMNS 
                 WHERE TABLE_NAME = @tableName 
                 ORDER BY ORDINAL_POSITION`;
        result = await querySmartOffice(query, { tableName });
        return NextResponse.json({
          success: true,
          action: `Columns for table: ${tableName}`,
          query,
          data: result,
        });

      case 'sample':
        // Get sample data from a table (TOP 10 rows)
        if (!tableName) {
          return NextResponse.json({ error: 'Table name required' }, { status: 400 });
        }
        query = `SELECT TOP 10 * FROM [${tableName}]`;
        result = await querySmartOffice(query);
        return NextResponse.json({
          success: true,
          action: `Sample data from: ${tableName}`,
          query,
          rowCount: result.length,
          data: result,
        });

      case 'count':
        // Get row count for a table
        if (!tableName) {
          return NextResponse.json({ error: 'Table name required' }, { status: 400 });
        }
        query = `SELECT COUNT(*) as total FROM [${tableName}]`;
        result = await querySmartOffice(query);
        return NextResponse.json({
          success: true,
          action: `Row count for: ${tableName}`,
          query,
          data: result[0],
        });

      case 'ats-attendance':
        // Check ATS attendance specifically
        query = `
          SELECT TOP 10
            a.AttendanceDate,
            a.InTime,
            a.OutTime,
            a.Status,
            e.EmployeeCode,
            e.EmployeeName
          FROM AttendanceLogs a
          INNER JOIN Employees e ON a.EmployeeId = e.EmployeeId
          WHERE e.EmployeeCode LIKE 'ATS%'
          ORDER BY a.AttendanceDate DESC
        `;
        result = await querySmartOffice(query);
        return NextResponse.json({
          success: true,
          action: 'ATS employees attendance (latest 10)',
          query,
          data: result,
        });

      case 'latest-date':
        // Get latest attendance date
        query = `
          SELECT TOP 1 AttendanceDate 
          FROM AttendanceLogs 
          ORDER BY AttendanceDate DESC
        `;
        result = await querySmartOffice(query);
        return NextResponse.json({
          success: true,
          action: 'Latest attendance date',
          data: result[0],
        });

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('SmartOffice explore error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      details: 'Could not connect to SmartOffice database. Make sure the SQL Server is accessible from this machine.',
    }, { status: 500 });
  }
}
