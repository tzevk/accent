/**
 * SmartOffice Employee Mapping API
 * Matches SmartOffice employees with local employees and updates biometric_code
 */

import { NextResponse } from 'next/server';
import { querySmartOffice } from '@/utils/smartoffice-db';
import { dbConnect } from '@/utils/database';

/**
 * GET /api/smartoffice/match-employees
 * Compare SmartOffice employees with local employees and find matches
 */
export async function GET(request) {
  let localDb;
  
  try {
    const { searchParams } = new URL(request.url);
    const showAll = searchParams.get('all') === 'true';
    
    // Fetch SmartOffice employees (remove ATS filter to see all)
    const smartOfficeQuery = `
      SELECT TOP 500
        EmployeeId,
        EmployeeCode,
        EmployeeName,
        NumericCode,
        DepartmentId,
        Status
      FROM Employees
      WHERE EmployeeCode IS NOT NULL
      ORDER BY EmployeeCode
    `;
    
    const smartOfficeEmployees = await querySmartOffice(smartOfficeQuery);
    
    // Fetch local employees
    localDb = await dbConnect();
    const [localEmployees] = await localDb.execute(`
      SELECT 
        id,
        employee_id,
        first_name,
        last_name,
        CONCAT(first_name, ' ', IFNULL(last_name, '')) as full_name,
        email,
        biometric_code,
        attendance_id,
        department,
        status
      FROM employees
      ORDER BY first_name, last_name
    `);
    
    // Matching results
    const matched = [];
    const unmatchedSmartOffice = [];
    const unmatchedLocal = [];
    
    // Create lookup maps
    const localByName = {};
    const localByBiometric = {};
    const localByEmployeeId = {};
    
    localEmployees.forEach(emp => {
      const fullName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim().toLowerCase();
      const firstName = (emp.first_name || '').toLowerCase();
      
      if (fullName) localByName[fullName] = emp;
      if (firstName) {
        if (!localByName[firstName]) localByName[firstName] = emp;
      }
      if (emp.biometric_code) localByBiometric[emp.biometric_code] = emp;
      if (emp.attendance_id) localByBiometric[emp.attendance_id] = emp;
      if (emp.employee_id) {
        localByBiometric[emp.employee_id] = emp;
        localByEmployeeId[emp.employee_id] = emp;
        // Also store without leading zeros: ATS0001 -> ATS1
        const shortCode = emp.employee_id.replace(/ATS0+/, 'ATS');
        localByEmployeeId[shortCode] = emp;
      }
    });
    
    const matchedLocalIds = new Set();
    
    // Try to match SmartOffice employees
    smartOfficeEmployees.forEach(soEmp => {
      const soName = (soEmp.EmployeeName || '').toLowerCase().trim();
      const soCode = soEmp.EmployeeCode;
      
      // Try matching by employee code / biometric code first
      let localMatch = localByBiometric[soCode] || localByEmployeeId[soCode];
      
      // Try by name if no code match
      if (!localMatch) {
        localMatch = localByName[soName];
      }
      
      // Try partial name match (first name only)
      if (!localMatch) {
        const soFirstName = soName.split(' ')[0];
        if (soFirstName.length > 2) {
          localMatch = localByName[soFirstName];
        }
      }
      
      if (localMatch && !matchedLocalIds.has(localMatch.id)) {
        matchedLocalIds.add(localMatch.id);
        matched.push({
          smartoffice: {
            id: soEmp.EmployeeId,
            code: soCode,
            name: soEmp.EmployeeName,
            numeric_code: soEmp.NumericCode
          },
          local: {
            id: localMatch.id,
            employee_id: localMatch.employee_id,
            name: localMatch.full_name,
            biometric_code: localMatch.biometric_code,
            already_linked: localMatch.biometric_code === soCode
          }
        });
      } else {
        unmatchedSmartOffice.push({
          id: soEmp.EmployeeId,
          code: soCode,
          name: soEmp.EmployeeName,
          numeric_code: soEmp.NumericCode
        });
      }
    });
    
    // Find unmatched local employees
    localEmployees.forEach(emp => {
      if (!matchedLocalIds.has(emp.id)) {
        unmatchedLocal.push({
          id: emp.id,
          employee_id: emp.employee_id,
          name: emp.full_name,
          biometric_code: emp.biometric_code
        });
      }
    });
    
    return NextResponse.json({
      success: true,
      summary: {
        smartoffice_total: smartOfficeEmployees.length,
        local_total: localEmployees.length,
        matched: matched.length,
        unmatched_smartoffice: unmatchedSmartOffice.length,
        unmatched_local: unmatchedLocal.length,
        already_linked: matched.filter(m => m.local.already_linked).length
      },
      matched,
      unmatchedSmartOffice,
      unmatchedLocal
    });
    
  } catch (error) {
    console.error('Match employees error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    if (localDb) localDb.release();
  }
}

/**
 * POST /api/smartoffice/match-employees
 * Apply matches - update local employees with SmartOffice biometric codes
 * 
 * Body: { matches: [{ local_id, smartoffice_code }] }
 * Or: { auto: true } to automatically apply all matched
 */
export async function POST(request) {
  let localDb;
  
  try {
    const body = await request.json();
    const { matches, auto } = body;
    
    localDb = await dbConnect();
    
    let toApply = [];
    
    if (auto) {
      // Auto-apply: Get all matches and apply them
      const getResponse = await GET(request);
      const data = await getResponse.json();
      
      if (data.matched) {
        toApply = data.matched
          .filter(m => !m.local.already_linked)
          .map(m => ({
            local_id: m.local.id,
            smartoffice_code: m.smartoffice.code
          }));
      }
    } else if (matches && Array.isArray(matches)) {
      toApply = matches;
    }
    
    if (toApply.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No matches to apply',
        updated: 0
      });
    }
    
    // Update local employees with biometric codes
    let updated = 0;
    let failed = 0;
    
    for (const match of toApply) {
      try {
        await localDb.execute(
          `UPDATE employees SET biometric_code = ?, updated_at = NOW() WHERE id = ?`,
          [match.smartoffice_code, match.local_id]
        );
        updated++;
      } catch (err) {
        console.error(`Failed to update employee ${match.local_id}:`, err.message);
        failed++;
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `Updated ${updated} employees with biometric codes`,
      updated,
      failed
    });
    
  } catch (error) {
    console.error('Apply matches error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  } finally {
    if (localDb) localDb.release();
  }
}
