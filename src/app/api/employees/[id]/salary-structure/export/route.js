import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request, { params }) {
  let connection;
  try {
    const auth = await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);
    if (auth instanceof Response) return auth;

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Employee ID is required' }, { status: 400 });
    }

    connection = await dbConnect();

    const [employeeRows] = await connection.execute(
      `SELECT id, employee_id, first_name, last_name, email, department, position
       FROM employees
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (employeeRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
    }

    const employee = employeeRows[0];

    const [structures] = await connection.execute(
      `SELECT *
       FROM salary_structures
       WHERE employee_id = ?
       ORDER BY effective_from DESC, version DESC`,
      [id]
    );

    const [salaryProfiles] = await connection.execute(
      `SELECT *
       FROM employee_salary_profile
       WHERE employee_id = ?
       ORDER BY COALESCE(effective_from, '1900-01-01') DESC, id DESC`,
      [id]
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent CRM';
    workbook.created = new Date();

    const metaSheet = workbook.addWorksheet('Employee');
    metaSheet.columns = [
      { header: 'Field', key: 'field', width: 24 },
      { header: 'Value', key: 'value', width: 48 }
    ];
    metaSheet.addRows([
      { field: 'Employee DB ID', value: employee.id },
      { field: 'Employee Code', value: employee.employee_id || '' },
      { field: 'Employee Name', value: `${employee.first_name || ''} ${employee.last_name || ''}`.trim() },
      { field: 'Email', value: employee.email || '' },
      { field: 'Department', value: employee.department || '' },
      { field: 'Position', value: employee.position || '' },
      { field: 'Exported At', value: new Date().toISOString() }
    ]);
    metaSheet.getRow(1).font = { bold: true };

    const structuresSheet = workbook.addWorksheet('Structures');
    if (structures.length > 0) {
      const structureHeaders = Object.keys(structures[0]);
      structuresSheet.columns = structureHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(14, key.length + 4)
      }));
      structures.forEach((row) => structuresSheet.addRow(row));
      structuresSheet.getRow(1).font = { bold: true };
      structuresSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      structuresSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      structuresSheet.addRow({ message: 'No salary structures found for this employee' });
      structuresSheet.getRow(1).font = { bold: true };
    }

    const profileSheet = workbook.addWorksheet('SalaryProfiles');
    if (salaryProfiles.length > 0) {
      const profileHeaders = Object.keys(salaryProfiles[0]);
      profileSheet.columns = profileHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(16, key.length + 4)
      }));
      salaryProfiles.forEach((row) => profileSheet.addRow(row));
      profileSheet.getRow(1).font = { bold: true };
      profileSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      profileSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      profileSheet.addRow({ message: 'No employee salary profile records found for this employee' });
      profileSheet.getRow(1).font = { bold: true };
    }

    const componentsSheet = workbook.addWorksheet('Components');
    let components = [];
    if (structures.length > 0) {
      const structureIds = structures.map((s) => s.id);
      const placeholders = structureIds.map(() => '?').join(',');
      const [componentRows] = await connection.execute(
        `SELECT *
         FROM salary_structure_components
         WHERE salary_structure_id IN (${placeholders})
         ORDER BY salary_structure_id DESC, display_order ASC, id ASC`,
        structureIds
      );
      components = componentRows;
    }

    if (components.length > 0) {
      const componentHeaders = Object.keys(components[0]);
      componentsSheet.columns = componentHeaders.map((key) => ({
        header: key,
        key,
        width: Math.max(16, key.length + 4)
      }));
      components.forEach((row) => componentsSheet.addRow(row));
      componentsSheet.getRow(1).font = { bold: true };
      componentsSheet.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      componentsSheet.columns = [{ header: 'message', key: 'message', width: 48 }];
      componentsSheet.addRow({ message: 'No salary structure components found for this employee' });
      componentsSheet.getRow(1).font = { bold: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const safeCode = String(employee.employee_id || `EMP_${employee.id}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `Salary_Structure_${safeCode}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    console.error('Salary structure export error:', error);
    return NextResponse.json({ success: false, error: 'Failed to export salary structure', details: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
