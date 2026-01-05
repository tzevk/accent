import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// POST /api/payroll/salary-profile - Create/Update employee salary profile
export async function POST(request) {
  let db;
  try {
    // Check permission - wrap in try-catch to provide better error messages
    try {
      await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE);
    } catch (permErr) {
      console.error('Permission check failed:', permErr);
      return NextResponse.json(
        { success: false, error: 'Permission denied: ' + (permErr.message || 'You do not have permission to update employees') },
        { status: 403 }
      );
    }

    const body = await request.json();
    console.log('Received salary profile data:', JSON.stringify(body, null, 2));
    
    const { 
      employee_id, 
      gross_salary, 
      other_allowances = 0, 
      effective_from = new Date().toISOString().split('T')[0],
      da_year = new Date().getFullYear(),
      pf_applicable = true,
      esic_applicable = true,
      // Additional breakdown fields
      basic_plus_da,
      da,
      basic,
      hra,
      conveyance,
      call_allowance,
      pf_employee,
      esic_employee,
      pf_employer,
      esic_employer,
      total_earnings,
      total_deductions,
      net_pay,
      employer_cost,
      is_manual_override = false
    } = body;

    // Validate required fields
    if (!employee_id || gross_salary === undefined || gross_salary === null || gross_salary === '') {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: employee_id and gross_salary are required' },
        { status: 400 }
      );
    }

    db = await dbConnect();
    
    try {
      // Create table if it doesn't exist - NO FOREIGN KEY to avoid constraint issues
      await db.query(`
        CREATE TABLE IF NOT EXISTS employee_salary_profile (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id INT NOT NULL,
          gross_salary DECIMAL(12, 2) NOT NULL DEFAULT 0,
          other_allowances DECIMAL(12, 2) DEFAULT 0,
          effective_from DATE,
          da_year INT,
          pf_applicable TINYINT(1) DEFAULT 1,
          esic_applicable TINYINT(1) DEFAULT 1,
          basic_plus_da DECIMAL(12, 2),
          da DECIMAL(12, 2),
          basic DECIMAL(12, 2),
          hra DECIMAL(12, 2),
          conveyance DECIMAL(12, 2),
          call_allowance DECIMAL(12, 2),
          pf_employee DECIMAL(12, 2),
          esic_employee DECIMAL(12, 2),
          pf_employer DECIMAL(12, 2),
          esic_employer DECIMAL(12, 2),
          total_earnings DECIMAL(12, 2),
          total_deductions DECIMAL(12, 2),
          net_pay DECIMAL(12, 2),
          employer_cost DECIMAL(12, 2),
          is_manual_override TINYINT(1) DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_employee_id (employee_id),
          INDEX idx_employee_effective (employee_id, effective_from)
        )
      `);
      
      // Add missing columns if table already exists with old schema
      const columnsToAdd = [
        { name: 'gross', definition: 'DECIMAL(12, 2) DEFAULT 0' },
        { name: 'gross_salary', definition: 'DECIMAL(12, 2) DEFAULT 0' },
        { name: 'other_allowances', definition: 'DECIMAL(12, 2) DEFAULT 0' },
        { name: 'effective_from', definition: 'DATE' },
        { name: 'da_year', definition: 'INT' },
        { name: 'pf_applicable', definition: 'TINYINT(1) DEFAULT 1' },
        { name: 'esic_applicable', definition: 'TINYINT(1) DEFAULT 1' },
        { name: 'basic_plus_da', definition: 'DECIMAL(12, 2)' },
        { name: 'da', definition: 'DECIMAL(12, 2)' },
        { name: 'basic', definition: 'DECIMAL(12, 2)' },
        { name: 'hra', definition: 'DECIMAL(12, 2)' },
        { name: 'conveyance', definition: 'DECIMAL(12, 2)' },
        { name: 'call_allowance', definition: 'DECIMAL(12, 2)' },
        { name: 'pf_employee', definition: 'DECIMAL(12, 2)' },
        { name: 'esic_employee', definition: 'DECIMAL(12, 2)' },
        { name: 'pf_employer', definition: 'DECIMAL(12, 2)' },
        { name: 'esic_employer', definition: 'DECIMAL(12, 2)' },
        { name: 'total_earnings', definition: 'DECIMAL(12, 2)' },
        { name: 'total_deductions', definition: 'DECIMAL(12, 2)' },
        { name: 'net_pay', definition: 'DECIMAL(12, 2)' },
        { name: 'employer_cost', definition: 'DECIMAL(12, 2)' },
        { name: 'is_manual_override', definition: 'TINYINT(1) DEFAULT 0' },
      ];
      
      for (const col of columnsToAdd) {
        try {
          await db.query(`ALTER TABLE employee_salary_profile ADD COLUMN ${col.name} ${col.definition}`);
          console.log(`Added column: ${col.name}`);
        } catch (alterErr) {
          // Column already exists - ignore error code 1060
          if (alterErr.code !== 'ER_DUP_FIELDNAME' && alterErr.errno !== 1060) {
            console.log(`Column ${col.name} might already exist or error:`, alterErr.message);
          }
        }
      }
      
      // Also modify existing 'gross' column to have a default value if it exists without one
      try {
        await db.query(`ALTER TABLE employee_salary_profile MODIFY COLUMN gross DECIMAL(12, 2) DEFAULT 0`);
      } catch {
        // Ignore if column doesn't exist
      }
      
      console.log('Table schema verified/updated successfully');

      await db.beginTransaction();

      // Check if employee exists
      const [empRows] = await db.query(
        'SELECT id FROM employees WHERE id = ?',
        [employee_id]
      );
      
      console.log('Employee check result:', empRows);

      if (empRows.length === 0) {
        await db.rollback();
        return NextResponse.json(
          { success: false, error: `Employee not found with ID: ${employee_id}` },
          { status: 404 }
        );
      }

      // Insert or Update salary profile record (use ON DUPLICATE KEY UPDATE for existing records)
      console.log('Inserting/Updating salary profile...');
      const [result] = await db.query(
        `INSERT INTO employee_salary_profile 
         (employee_id, gross, gross_salary, other_allowances, effective_from, da_year, pf_applicable, esic_applicable,
          basic_plus_da, da, basic, hra, conveyance, call_allowance, 
          pf_employee, esic_employee, pf_employer, esic_employer,
          total_earnings, total_deductions, net_pay, employer_cost, is_manual_override) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          gross = VALUES(gross),
          gross_salary = VALUES(gross_salary),
          other_allowances = VALUES(other_allowances),
          pf_applicable = VALUES(pf_applicable),
          esic_applicable = VALUES(esic_applicable),
          basic_plus_da = VALUES(basic_plus_da),
          da = VALUES(da),
          basic = VALUES(basic),
          hra = VALUES(hra),
          conveyance = VALUES(conveyance),
          call_allowance = VALUES(call_allowance),
          pf_employee = VALUES(pf_employee),
          esic_employee = VALUES(esic_employee),
          pf_employer = VALUES(pf_employer),
          esic_employer = VALUES(esic_employer),
          total_earnings = VALUES(total_earnings),
          total_deductions = VALUES(total_deductions),
          net_pay = VALUES(net_pay),
          employer_cost = VALUES(employer_cost),
          is_manual_override = VALUES(is_manual_override),
          updated_at = CURRENT_TIMESTAMP`,
        [
          employee_id, 
          parseFloat(gross_salary) || 0,  // gross (legacy column)
          parseFloat(gross_salary) || 0,  // gross_salary 
          parseFloat(other_allowances) || 0, 
          effective_from, 
          da_year, 
          pf_applicable ? 1 : 0, 
          esic_applicable ? 1 : 0,
          parseFloat(basic_plus_da) || null, 
          parseFloat(da) || null, 
          parseFloat(basic) || null, 
          parseFloat(hra) || null, 
          parseFloat(conveyance) || null, 
          parseFloat(call_allowance) || null,
          parseFloat(pf_employee) || null, 
          parseFloat(esic_employee) || null, 
          parseFloat(pf_employer) || null, 
          parseFloat(esic_employer) || null,
          parseFloat(total_earnings) || null, 
          parseFloat(total_deductions) || null, 
          parseFloat(net_pay) || null, 
          parseFloat(employer_cost) || null,
          is_manual_override ? 1 : 0
        ]
      );
      
      console.log('Insert/Update result:', result);

      await db.commit();
      
      const isUpdate = result.affectedRows === 2; // ON DUPLICATE KEY UPDATE returns 2 for updates

      return NextResponse.json({
        success: true,
        message: isUpdate ? 'Salary profile updated successfully' : 'Salary profile saved successfully',
        data: {
          id: result.insertId || null,
          employee_id,
          gross_salary,
          other_allowances,
          effective_from,
          da_year,
          pf_applicable,
          esic_applicable
        }
      });

    } catch (err) {
      await db.rollback();
      throw err;
    } finally {
      if (db) db.release();
    }

  } catch (error) {
    console.error('Error saving salary profile:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/payroll/salary-profile?employee_id=X - Get employee's salary profile history
export async function GET(request) {
  let db;
  try {
    await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);

    const { searchParams } = new URL(request.url);
    const employee_id = searchParams.get('employee_id');

    if (!employee_id) {
      return NextResponse.json(
        { success: false, error: 'Missing employee_id parameter' },
        { status: 400 }
      );
    }

    db = await dbConnect();
    
    try {
      // Get all salary profiles for this employee, ordered by effective_from descending
      const [profiles] = await db.query(
        `SELECT 
          id, 
          employee_id, 
          COALESCE(gross_salary, gross) as gross_salary,
          gross,
          other_allowances, 
          effective_from, 
          da_year,
          pf_applicable, 
          esic_applicable,
          basic_plus_da,
          da,
          basic,
          hra,
          conveyance,
          call_allowance,
          pf_employee,
          esic_employee,
          pf_employer,
          esic_employer,
          total_earnings,
          total_deductions,
          net_pay,
          employer_cost,
          is_manual_override,
          created_at,
          updated_at
         FROM employee_salary_profile 
         WHERE employee_id = ?
         ORDER BY effective_from DESC, updated_at DESC`,
        [employee_id]
      );

      return NextResponse.json({
        success: true,
        data: profiles
      });

    } finally {
      if (db) db.release();
    }

  } catch (error) {
    console.error('Error fetching salary profiles:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/payroll/salary-profile?id=X - Delete a salary profile
export async function DELETE(request) {
  let db;
  try {
    await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.DELETE);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Missing id parameter' },
        { status: 400 }
      );
    }

    db = await dbConnect();
    
    try {
      const [result] = await db.query(
        'DELETE FROM employee_salary_profile WHERE id = ?',
        [id]
      );

      if (result.affectedRows === 0) {
        return NextResponse.json(
          { success: false, error: 'Salary profile not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        message: 'Salary profile deleted successfully'
      });

    } finally {
      if (db) db.release();
    }

  } catch (error) {
    console.error('Error deleting salary profile:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
