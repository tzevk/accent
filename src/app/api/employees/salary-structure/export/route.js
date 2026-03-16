import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request) {
  let connection;
  try {
    const auth = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
    if (auth instanceof Response) return auth;

    connection = await dbConnect();

    const [employees] = await connection.execute(
      `SELECT id, employee_id, first_name, last_name, email, department, position, status, employment_status, hire_date, joining_date
       FROM employees
       ORDER BY id ASC`
    );

    const [salaryProfiles] = await connection.execute(
      `SELECT *
       FROM employee_salary_profile
       ORDER BY employee_id ASC, COALESCE(effective_from, '1900-01-01') DESC, id DESC`
    );

    const [structures] = await connection.execute(
      `SELECT *
       FROM salary_structures
       ORDER BY employee_id ASC, COALESCE(effective_from, '1900-01-01') DESC, version DESC, id DESC`
    );

    const [components] = await connection.execute(
      `SELECT c.*, s.employee_id
       FROM salary_structure_components c
       LEFT JOIN salary_structures s ON s.id = c.salary_structure_id
       ORDER BY s.employee_id ASC, c.salary_structure_id DESC, c.display_order ASC, c.id ASC`
    );

    const employeeLookup = new Map(
      employees.map((e) => [
        Number(e.id),
        {
          employee_name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          employee_code: e.employee_id || ''
        }
      ])
    );

    const employeesForSheet = employees.map((e) => ({
      employee_name: `${e.first_name || ''} ${e.last_name || ''}`.trim(),
      employee_code: e.employee_id || '',
      email: e.email || '',
      department: e.department || '',
      position: e.position || '',
      status: e.status || '',
      employment_status: e.employment_status || '',
      hire_date: e.hire_date || null,
      joining_date: e.joining_date || null
    }));

    const salaryProfilesForSheet = salaryProfiles.map((row) => {
      const emp = employeeLookup.get(Number(row.employee_id)) || { employee_name: '', employee_code: '' };
      const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'employee_id'));
      return {
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        ...rest
      };
    });

    const structuresForSheet = structures.map((row) => {
      const emp = employeeLookup.get(Number(row.employee_id)) || { employee_name: '', employee_code: '' };
      const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'employee_id'));
      return {
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        ...rest
      };
    });

    const componentsForSheet = components.map((row) => {
      const emp = employeeLookup.get(Number(row.employee_id)) || { employee_name: '', employee_code: '' };
      const rest = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'employee_id'));
      return {
        employee_name: emp.employee_name,
        employee_code: emp.employee_code,
        ...rest
      };
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent CRM';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 34 },
      { header: 'Count', key: 'count', width: 20 }
    ];
    summarySheet.addRows([
      { metric: 'Total Employees', count: employees.length },
      { metric: 'Total Salary Profile Rows', count: salaryProfiles.length },
      { metric: 'Total Salary Structure Rows', count: structures.length },
      { metric: 'Total Structure Component Rows', count: components.length },
      { metric: 'Exported At', count: new Date().toISOString() }
    ]);
    summarySheet.getRow(1).font = { bold: true };

    const employeesSheet = workbook.addWorksheet('Employees');
    if (employeesForSheet.length > 0) {
      const employeeHeaders = Object.keys(employeesForSheet[0]);
      employeesSheet.columns = employeeHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(16, key.length + 4)
      }));
      employeesForSheet.forEach((row) => employeesSheet.addRow(row));
      employeesSheet.getRow(1).font = { bold: true };
      employeesSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      employeesSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      employeesSheet.addRow({ message: 'No employees found' });
      employeesSheet.getRow(1).font = { bold: true };
    }

    const profilesSheet = workbook.addWorksheet('SalaryProfiles');
    if (salaryProfilesForSheet.length > 0) {
      const profileHeaders = Object.keys(salaryProfilesForSheet[0]);
      profilesSheet.columns = profileHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(16, key.length + 4)
      }));
      salaryProfilesForSheet.forEach((row) => profilesSheet.addRow(row));
      profilesSheet.getRow(1).font = { bold: true };
      profilesSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      profilesSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      profilesSheet.addRow({ message: 'No employee salary profile rows found' });
      profilesSheet.getRow(1).font = { bold: true };
    }

    const structuresSheet = workbook.addWorksheet('Structures');
    if (structuresForSheet.length > 0) {
      const structureHeaders = Object.keys(structuresForSheet[0]);
      structuresSheet.columns = structureHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(16, key.length + 4)
      }));
      structuresForSheet.forEach((row) => structuresSheet.addRow(row));
      structuresSheet.getRow(1).font = { bold: true };
      structuresSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      structuresSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      structuresSheet.addRow({ message: 'No salary structure rows found' });
      structuresSheet.getRow(1).font = { bold: true };
    }

    const componentsSheet = workbook.addWorksheet('Components');
    if (componentsForSheet.length > 0) {
      const componentHeaders = Object.keys(componentsForSheet[0]);
      componentsSheet.columns = componentHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(16, key.length + 4)
      }));
      componentsForSheet.forEach((row) => componentsSheet.addRow(row));
      componentsSheet.getRow(1).font = { bold: true };
      componentsSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      componentsSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      componentsSheet.addRow({ message: 'No salary structure component rows found' });
      componentsSheet.getRow(1).font = { bold: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Salary_Structure_All_Users_${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    console.error('All users salary structure export error:', error);
    return NextResponse.json({ success: false, error: 'Failed to export salary structures for all users', details: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
