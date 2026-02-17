import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import ExcelJS from 'exceljs';

/**
 * GET - Export salary sheet as Excel file in the "Updated salary Sheet" format
 * Query params:
 *  - month: Month to export (YYYY-MM-01)
 */
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'Month is required (format: YYYY-MM-01)' },
        { status: 400 }
      );
    }

    const db = await dbConnect();

    // Fetch all payroll slips for the month with employee details
    const [slips] = await db.execute(
      `SELECT 
        ps.*,
        CONCAT(e.first_name, ' ', e.last_name) as full_name,
        e.employee_id as employee_code,
        e.grade as designation,
        e.uan,
        e.pf_no,
        e.esi_no,
        e.department
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ?
      ORDER BY e.first_name ASC`,
      [month]
    );

    await db.end();

    if (slips.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No payroll slips found for this month. Please generate payroll first.' },
        { status: 404 }
      );
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent CRM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Sheet1');

    // Parse month for display
    const monthDate = new Date(month);

    // Row 1: Title
    sheet.mergeCells('A1:L1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'PAY SHEET';
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

    // Row 5: Empty
    // Row 6: Header row
    const headers = [
      'Full Name',           // A
      'Designation',         // B
      'UAN',                 // C
      'PF No.',              // D
      'ESIC No.',            // E
      'Total Days',          // F
      'Days Present',        // G
      'Days Paid',           // H
      'LWP Days',            // I
      'Leave',               // J
      'WeekOff',             // K
      'Paid Holiday',        // L
      'OT Hours',            // M
      'BASIC',               // N
      'DA',                  // O
      'HRA',                 // P
      'CONVEYANCE ALLOWANCE', // Q
      'CALL ALLOWANCE',      // R
      'OTHER ALLOWANCE',     // S
      'PAID HOLIDAY AMOUNT', // T
      'BONUS',               // U
      'OT RATE',             // V
      'INCENTIVE',           // W
      'BASIC Arrears',       // X
      'DA Arrears',          // Y
      'HRA Arrears',         // Z
      'CALW Arrears',        // AA
      'CALALW Arrears',      // AB
      'OTHALW Arrears',      // AC
      'PHA Arrears',         // AD
      'BONUS Arrears',       // AE
      'OT Arrears',          // AF
      'INCENTIVE Arrears',   // AG
      'GROSS',               // AH
      'EBONUS',              // AI
      'EMPRPF',              // AJ
      'PAI',                 // AK
      'RATE',                // AL
      'EC',                  // AM
      'EPFWAGE',             // AN
      'PROVIDENT FUND',      // AO
      'ESIC',                // AP
      'PROFESSIONAL TAX',    // AQ
      'LOAN',                // AR
      'ADVANCE',             // AS
      'TAX DEDUCTED AT SOURCE', // AT
      'RETENTION AMOUNT',    // AU
      'TOTAL DED',           // AV
      'NET SAL',             // AW
      'Signature',           // AX
    ];

    const headerRow = sheet.getRow(6);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Row 7: Sub-header (Rs. P.)
    const subHeaderRow = sheet.getRow(7);
    headers.forEach((header, index) => {
      const cell = subHeaderRow.getCell(index + 1);
      if (index < 13) {
        cell.value = header; // Repeat text headers
      } else if (index < 49) {
        cell.value = 'Rs. P.';
      } else {
        cell.value = 'Signature';
      }
      cell.font = { size: 9 };
      cell.alignment = { horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Data rows starting from row 8
    slips.forEach((slip, index) => {
      const row = sheet.getRow(8 + index);
      
      const totalDays = slip.standard_working_days || 26;
      const daysPresent = slip.days_present || 0;
      const daysPaid = slip.payable_days || 0;
      const lwpDays = slip.lop_days || 0;
      const daysLeave = slip.days_leave || 0;
      // WeekOff and Paid Holiday calculations (estimated)
      const weekOff = 4; // Approximate 4 weekends
      const paidHoliday = 0;
      const otHours = slip.overtime_hours || 0;

      const values = [
        slip.full_name || '',                       // Full Name
        slip.designation || '',                     // Designation
        slip.uan || '',                             // UAN
        slip.pf_no || '',                           // PF No.
        slip.esi_no || '--',                        // ESIC No.
        totalDays,                                  // Total Days
        daysPresent,                                // Days Present
        daysPaid,                                   // Days Paid
        lwpDays,                                    // LWP Days
        daysLeave,                                  // Leave
        weekOff,                                    // WeekOff
        paidHoliday,                                // Paid Holiday
        otHours,                                    // OT Hours
        slip.basic || 0,                            // BASIC
        slip.da || slip.da_used || 0,               // DA
        slip.hra || 0,                              // HRA
        slip.conveyance || 0,                       // CONVEYANCE ALLOWANCE
        slip.call_allowance || 0,                   // CALL ALLOWANCE
        slip.other_allowances || 0,                 // OTHER ALLOWANCE
        0,                                          // PAID HOLIDAY AMOUNT
        slip.bonus || 0,                            // BONUS
        0,                                          // OT RATE
        slip.incentive || 0,                        // INCENTIVE
        0,                                          // BASIC Arrears
        0,                                          // DA Arrears
        0,                                          // HRA Arrears
        0,                                          // CALW Arrears
        0,                                          // CALALW Arrears
        0,                                          // OTHALW Arrears
        0,                                          // PHA Arrears
        0,                                          // BONUS Arrears
        0,                                          // OT Arrears
        0,                                          // INCENTIVE Arrears
        slip.gross || slip.total_earnings || 0,     // GROSS
        0,                                          // EBONUS
        slip.pf_employer || 0,                      // EMPRPF
        0,                                          // PAI
        0,                                          // RATE
        0,                                          // EC
        0,                                          // EPFWAGE
        slip.pf_employee || 0,                      // PROVIDENT FUND
        slip.esic_employee || 0,                    // ESIC
        slip.pt || 0,                               // PROFESSIONAL TAX
        0,                                          // LOAN
        0,                                          // ADVANCE
        slip.tds || 0,                              // TAX DEDUCTED AT SOURCE
        slip.retention || 0,                        // RETENTION AMOUNT
        slip.total_deductions || 0,                 // TOTAL DED
        slip.net_pay || 0,                          // NET SAL
        '',                                         // Signature
      ];

      values.forEach((val, colIndex) => {
        const cell = row.getCell(colIndex + 1);
        cell.value = val;
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        
        // Number formatting for currency columns (columns 14+)
        if (colIndex >= 13 && colIndex < 49 && typeof val === 'number') {
          cell.numFmt = '#,##0';
        }
      });
    });

    // Set column widths
    const columnWidths = [
      25, // Full Name
      20, // Designation
      15, // UAN
      25, // PF No.
      15, // ESIC No.
      10, // Total Days
      10, // Days Present
      10, // Days Paid
      10, // LWP Days
      8,  // Leave
      8,  // WeekOff
      10, // Paid Holiday
      8,  // OT Hours
      12, // BASIC
      10, // DA
      10, // HRA
      15, // CONVEYANCE ALLOWANCE
      12, // CALL ALLOWANCE
      14, // OTHER ALLOWANCE
      14, // PAID HOLIDAY AMOUNT
      10, // BONUS
      8,  // OT RATE
      10, // INCENTIVE
      12, // BASIC Arrears
      10, // DA Arrears
      10, // HRA Arrears
      12, // CALW Arrears
      12, // CALALW Arrears
      12, // OTHALW Arrears
      10, // PHA Arrears
      12, // BONUS Arrears
      10, // OT Arrears
      14, // INCENTIVE Arrears
      12, // GROSS
      10, // EBONUS
      10, // EMPRPF
      8,  // PAI
      8,  // RATE
      8,  // EC
      10, // EPFWAGE
      14, // PROVIDENT FUND
      10, // ESIC
      14, // PROFESSIONAL TAX
      10, // LOAN
      10, // ADVANCE
      18, // TAX DEDUCTED AT SOURCE
      15, // RETENTION AMOUNT
      12, // TOTAL DED
      12, // NET SAL
      12, // Signature
    ];

    columnWidths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Return Excel file
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
  }
}
