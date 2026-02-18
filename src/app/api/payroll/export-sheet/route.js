import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import ExcelJS from 'exceljs';

/**
 * GET - Export salary sheet as Excel file
 * Query params:
 *  - month: Month to export (YYYY-MM-01)
 *  - salary_type: Filter by salary type (monthly, hourly, daily, contract, lumpsum, custom)
 */
export async function GET(request) {
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const salaryType = searchParams.get('salary_type');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'Month is required (format: YYYY-MM-01)' },
        { status: 400 }
      );
    }

    const validSalaryTypes = ['monthly', 'hourly', 'daily', 'contract', 'lumpsum', 'custom'];
    db = await dbConnect();

    let query = `SELECT 
        ps.*,
        CONCAT(e.first_name, ' ', e.last_name) as full_name,
        e.employee_id as employee_code,
        e.grade as designation,
        e.uan,
        e.pf_no,
        e.esi_no,
        e.department,
        sp.salary_type
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      LEFT JOIN employee_salary_profile sp ON sp.employee_id = e.id AND sp.is_active = 1
      WHERE ps.month = ?`;
    const params = [month];

    if (salaryType && validSalaryTypes.includes(salaryType)) {
      query += ` AND (sp.salary_type = ? OR (sp.salary_type IS NULL AND ? = 'monthly'))`;
      params.push(salaryType, salaryType);
    }

    query += ` ORDER BY e.employee_id ASC`;

    const [slips] = await db.execute(query, params);

    if (slips.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No payroll slips found for this month. Please generate payroll first.' },
        { status: 404 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent CRM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Sheet1');
    const monthDate = new Date(month);
    const isContractExport = salaryType === 'contract';

    // Row 1: Title
    sheet.mergeCells('A1:L1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = isContractExport ? 'CONTRACT PAY SHEET' : 'PAY SHEET';
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };

    // Row 2: Form reference
    sheet.mergeCells('A2:L2');
    const formCell = sheet.getCell('A2');
    formCell.value = 'FORM II SEE RULE 27 (1)';
    formCell.alignment = { horizontal: 'center' };

    // Row 3: Muster Roll
    sheet.mergeCells('A3:L3');
    const musterCell = sheet.getCell('A3');
    musterCell.value = 'MUSTER ROLL CUM WAGES REGISTER';
    musterCell.font = { bold: true };
    musterCell.alignment = { horizontal: 'center' };

    // Row 4: Company name and month
    sheet.mergeCells('A4:C4');
    sheet.getCell('A4').value = 'ACCENT TECHNO SOLUTIONS PVT LTD';
    sheet.getCell('A4').font = { bold: true };

    sheet.mergeCells('G4:I4');
    sheet.getCell('G4').value = 'DATE OF PAYMENT';

    sheet.mergeCells('K4:L4');
    sheet.getCell('K4').value = 'FOR THE MONTH OF';

    sheet.mergeCells('N4:P4');
    sheet.getCell('N4').value = monthDate;
    sheet.getCell('N4').numFmt = 'mmm-yyyy';

    if (isContractExport) {
      // ── Contract-specific sheet layout ──
      const contractHeaders = [
        'Emp Code',
        'Full Name',
        'Designation',
        'Month Days',
        'Working Days',
        'Rate Per Month',
        'Monthly Amount',
        'OT Hours',
        'OT Amount',
        'Total Amount',
        '10% TDS',
        'Retention',
        'Net Payable Amount',
      ];

      const contractHeaderRow = sheet.getRow(6);
      contractHeaders.forEach((header, index) => {
        const cell = contractHeaderRow.getCell(index + 1);
        cell.value = header;
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      slips.forEach((slip, index) => {
        const row = sheet.getRow(7 + index);
        const gross = slip.gross || slip.total_earnings || 0;
        const workingDays = slip.payable_days || slip.days_present || 0;
        const monthDays = slip.standard_working_days || 26;
        const ratePerMonth = slip.full_month_gross || gross;
        const monthlyAmount = gross;
        const otHours = slip.overtime_hours || 0;
        const otAmount = 0; // OT amount from slip if available
        const totalAmount = monthlyAmount + otAmount;
        const tds = slip.tds || 0;
        const retention = slip.retention || 0;
        const netPayable = totalAmount - tds - retention;

        const values = [
          slip.employee_code || '',
          slip.full_name || '',
          slip.designation || '',
          monthDays,
          workingDays,
          ratePerMonth,
          monthlyAmount,
          otHours,
          otAmount,
          totalAmount,
          tds,
          retention,
          netPayable,
        ];

        values.forEach((val, colIndex) => {
          const cell = row.getCell(colIndex + 1);
          cell.value = val;
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          if (colIndex >= 3 && typeof val === 'number') {
            cell.numFmt = '#,##0';
          }
        });
      });

      const contractColWidths = [12, 25, 20, 12, 12, 15, 15, 10, 12, 15, 12, 12, 18];
      contractColWidths.forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
      });

    } else {
      // ── Standard (non-contract) sheet layout ──
      const headers = [
        'Emp Code',
        'Full Name',
        'Designation',
        'UAN',
        'PF No.',
        'ESIC No.',
        'Total Days',
        'Days Present',
        'Days Paid',
        'LWP Days',
        'Leave',
        'WeekOff',
        'Paid Holiday',
        'OT Hours',
        'BASIC',
        'DA',
        'HRA',
        'CONVEYANCE ALLOWANCE',
        'CALL ALLOWANCE',
        'OTHER ALLOWANCE',
        'PAID HOLIDAY AMOUNT',
        'BONUS',
        'OT RATE',
        'INCENTIVE',
        'GROSS',
        'PROVIDENT FUND',
        'ESIC',
        'PROFESSIONAL TAX',
        'LOAN',
        'ADVANCE',
        'TAX DEDUCTED AT SOURCE',
        'AMOUNT AFTER TDS',
        'RETENTION AMOUNT',
        'TOTAL DED',
        'NET SAL',
        'Signature',
      ];

      const headerRow = sheet.getRow(6);
      headers.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header;
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      slips.forEach((slip, index) => {
        const row = sheet.getRow(7 + index);
        const gross = slip.gross || slip.total_earnings || 0;
        const tds = slip.tds || 0;

        const values = [
          slip.employee_code || '',
          slip.full_name || '',
          slip.designation || '',
          slip.uan || '',
          slip.pf_no || '',
          slip.esi_no || '--',
          slip.standard_working_days || 26,
          slip.days_present || 0,
          slip.payable_days || 0,
          slip.lop_days || 0,
          slip.days_leave || 0,
          4,
          0,
          slip.overtime_hours || 0,
          slip.basic || 0,
          slip.da || slip.da_used || 0,
          slip.hra || 0,
          slip.conveyance || 0,
          slip.call_allowance || 0,
          slip.other_allowances || 0,
          0,
          slip.bonus || 0,
          0,
          slip.incentive || 0,
          gross,
          slip.pf_employee || 0,
          slip.esic_employee || 0,
          slip.pt || 0,
          0,
          0,
          tds,
          gross - tds,
          slip.retention || 0,
          slip.total_deductions || 0,
          slip.net_pay || 0,
          '',
        ];

        values.forEach((val, colIndex) => {
          const cell = row.getCell(colIndex + 1);
          cell.value = val;
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          if (colIndex >= 14 && typeof val === 'number') {
            cell.numFmt = '#,##0';
          }
        });
      });

      const columnWidths = [
        12, 25, 20, 15, 25, 15,
        10, 10, 10, 10, 8, 8, 10, 8,
        12, 10, 10, 15, 12, 14, 14, 10, 8, 10,
        12, 14, 10, 14, 10, 10, 18, 18, 15, 12, 12, 12,
      ];
      columnWidths.forEach((width, index) => {
        sheet.getColumn(index + 1).width = width;
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Salary_Sheet_${month.substring(0, 7)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

  } catch (error) {
    console.error('GET /api/payroll/export-sheet error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to export salary sheet', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}
