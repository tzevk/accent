import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import ExcelJS from 'exceljs';

/** Convert any value to a finite number; returns 0 for NaN/Infinity/null/undefined/strings */
const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** Safely convert to string, stripping null/undefined */
const safeStr = (v) => (v == null ? '' : String(v));

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

    const validSalaryTypes = ['monthly', 'hourly', 'daily', 'contract', 'lumpsum', 'custom', 'payroll'];
    db = await dbConnect();

    let query = `SELECT 
        ps.*,
        CONCAT(e.first_name, ' ', e.last_name) as full_name,
        e.employee_id as employee_code,
        e.position,
        e.uan,
        e.pf_no,
        e.esi_no,
        ss_inner.basic_salary as structure_basic_salary,
        ss_inner.gross_salary as structure_gross_salary,
        sp_inner.gross_salary as profile_gross,
        sp_inner.employer_cost as profile_ctc,
        sp_inner.total_earnings as profile_total_earnings,
        sp_inner.basic_plus_da as profile_basic_plus_da,
        sp_inner.basic as profile_basic,
        sp_inner.da as profile_da,
        sp_inner.hra as profile_hra,
        sp_inner.conveyance as profile_conveyance,
        sp_inner.call_allowance as profile_call_allowance,
        sp_inner.other_allowances as profile_other_allowances,
        sp_inner.incentive as profile_incentive
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      LEFT JOIN salary_structures ss_inner ON ss_inner.employee_id = e.id AND ss_inner.is_active = 1
      LEFT JOIN employee_salary_profile sp_inner ON sp_inner.employee_id = e.id AND sp_inner.is_active = 1
      WHERE ps.month = ?`;
    const params = [month];

    if (salaryType === 'payroll') {
      // Payroll = everything except contract
      query += ` AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    } else if (salaryType === 'contract') {
      // Contract = only contract
      query += ` AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    } else if (salaryType && validSalaryTypes.includes(salaryType)) {
      query += ` AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND (sp.salary_type = ? OR (sp.salary_type IS NULL AND ? = 'monthly')))`;
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

    // ── Fetch attendance data for all employees in the given month ──
    const [yr, mn] = month.split('-');
    const monthNum = parseInt(mn, 10);
    const yearNum = parseInt(yr, 10);
    const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
    const weeklyOffDaysInMonth = Array.from({ length: daysInMonth }, (_, index) => {
      const date = new Date(yearNum, monthNum - 1, index + 1);
      return date.getDay() === 0 ? 1 : 0;
    }).reduce((sum, day) => sum + day, 0);

    // Get days_present per employee from attendance table
    const employeeIds = slips.map(s => s.employee_id);
    const attendanceMap = {};
    const lwpMap = {};
    if (employeeIds.length > 0) {
      try {
        const placeholders = employeeIds.map(() => '?').join(',');
        const monthKey = `${yr}-${mn}`;
        const [attendanceRows] = await db.execute(
          `SELECT 
            employee_id,
            COUNT(DISTINCT DATE(attendance_date)) as days_present
          FROM employee_attendance 
          WHERE employee_id IN (${placeholders})
          AND DATE_FORMAT(attendance_date, '%Y-%m') = ?
          AND status IN ('P', 'HD', 'OT')
          GROUP BY employee_id`,
          [...employeeIds, monthKey]
        );
        for (const row of attendanceRows) {
          attendanceMap[row.employee_id] = row.days_present || 0;
        }
      } catch (attErr) {
        console.log('Attendance fetch for export skipped:', attErr.message);
      }

      // Get LWP days per employee from employee_attendance_summary
      const monthKey = `${yr}-${mn}`;
      try {
        const placeholders2 = employeeIds.map(() => '?').join(',');
        const [lwpRows] = await db.execute(
          `SELECT employee_id, total_lwp
           FROM employee_attendance_summary
           WHERE employee_id IN (${placeholders2})
           AND month = ?`,
          [...employeeIds, monthKey]
        );
        for (const row of lwpRows) {
          lwpMap[row.employee_id] = parseInt(row.total_lwp) || 0;
        }
      } catch (lwpErr) {
        console.log('LWP fetch for export skipped:', lwpErr.message);
      }
    }

    // Fetch DA using the same active schedule logic as the Manage Schedule flow
    let scheduledDA = 0;
    try {
      const monthDate = `${yr}-${mn}-01`;
      const [daRows] = await db.execute(
        `SELECT value_type, value FROM payroll_schedules 
         WHERE component_type = 'da' AND is_active = 1 
           AND effective_from <= ?
           AND (effective_to IS NULL OR effective_to >= ?)
         ORDER BY effective_from DESC LIMIT 1`,
        [monthDate, monthDate]
      );
      if (daRows.length > 0) {
        const daRow = daRows[0];
        scheduledDA = daRow.value_type === 'percentage'
          ? 0
          : (parseFloat(daRow.value) || 0);
      }
    } catch (daErr) {
      console.log('DA schedule fetch for export skipped:', daErr.message);
    }

    // Fetch loan and advance data from salary profiles
    const loanAdvanceMap = {};
    if (employeeIds.length > 0) {
      try {
        const placeholders3 = employeeIds.map(() => '?').join(',');
        const [salaryRows] = await db.execute(
          `SELECT employee_id, loan_amount_per_month, loan_active, advance_amount, advance_active
           FROM employee_salary_profile
           WHERE employee_id IN (${placeholders3})
           AND (is_active = 1 OR id IN (
             SELECT MAX(id) FROM employee_salary_profile WHERE employee_id IN (${placeholders3}) GROUP BY employee_id
           ))
           ORDER BY id DESC`,
          [...employeeIds, ...employeeIds]
        );
        for (const row of salaryRows) {
          if (!loanAdvanceMap[row.employee_id]) {
            loanAdvanceMap[row.employee_id] = {
              loan: row.loan_active ? (parseFloat(row.loan_amount_per_month) || 0) : 0,
              advance: row.advance_active ? (parseFloat(row.advance_amount) || 0) : 0
            };
          }
        }
      } catch (laErr) {
        console.log('Loan/Advance fetch for export skipped:', laErr.message);
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Accent CRM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Sheet1');
    const isContractExport = salaryType === 'contract';

    // Total columns: contract is simple, payroll has full breakdown
    const totalCols = isContractExport ? 5 : 36;
    // For columns > 26, use AA, AB, etc.
    const getColLetter = (n) => {
      let s = '';
      while (n > 0) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
      }
      return s;
    };
    const lastCol = getColLetter(totalCols);

    // Row 1: Title - PAY SHEET or CONTRACT PAY SHEET
    sheet.mergeCells(`A1:${lastCol}1`);
    const titleCell = sheet.getCell('A1');
    titleCell.value = isContractExport ? 'CONTRACT PAY SHEET' : 'PAY SHEET';
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };
    titleCell.border = { bottom: { style: 'thin' } };

    // Row 2: Form reference
    sheet.mergeCells(`A2:${lastCol}2`);
    const formCell = sheet.getCell('A2');
    formCell.value = 'FORM II SEE RULE 27 (1)';
    formCell.font = { bold: true, size: 11 };
    formCell.alignment = { horizontal: 'center' };

    // Row 3: Muster Roll
    sheet.mergeCells(`A3:${lastCol}3`);
    const musterCell = sheet.getCell('A3');
    musterCell.value = 'MUSTER ROLL CUM WAGES REGISTER';
    musterCell.font = { bold: true, size: 12 };
    musterCell.alignment = { horizontal: 'center' };

    // Row 4: Company name | gap | DATE OF PAYMENT | FOR THE MONTH OF | month
    // IMPORTANT: Only set styles on merge master cells, NOT on cells inside merged ranges
    // (accessing non-master cells creates extra <c> elements in OOXML that Excel flags as corrupt)
    const quarterCol = Math.floor(totalCols / 4);
    const companyEndCol = Math.max(quarterCol - 1, 1);
    const row4Border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    sheet.mergeCells(`A4:${getColLetter(companyEndCol)}4`);
    const companyCell = sheet.getCell('A4');
    companyCell.value = 'ACCENT TECHNO SOLUTIONS PVT LTD';
    companyCell.font = { bold: true, size: 11 };
    companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
    companyCell.border = row4Border;

    // Gap cell between company and DOP (only when there is a column gap)
    if (companyEndCol < quarterCol) {
      sheet.getRow(4).getCell(quarterCol).border = row4Border;
    }

    const dopStartCol = quarterCol + 1;
    const dopEndCol = quarterCol * 2;
    sheet.mergeCells(`${getColLetter(dopStartCol)}4:${getColLetter(dopEndCol)}4`);
    const dopCell = sheet.getCell(`${getColLetter(dopStartCol)}4`);
    dopCell.value = 'DATE OF PAYMENT';
    dopCell.font = { bold: true, size: 11 };
    dopCell.alignment = { horizontal: 'center', vertical: 'middle' };
    dopCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    dopCell.border = row4Border;

    const fmStartCol = dopEndCol + 1;
    const fmEndCol = quarterCol * 3;
    sheet.mergeCells(`${getColLetter(fmStartCol)}4:${getColLetter(fmEndCol)}4`);
    const fmCell = sheet.getCell(`${getColLetter(fmStartCol)}4`);
    fmCell.value = 'FOR THE MONTH OF';
    fmCell.font = { bold: true, size: 11 };
    fmCell.alignment = { horizontal: 'center', vertical: 'middle' };
    fmCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    fmCell.border = row4Border;

    const mvStartCol = fmEndCol + 1;
    sheet.mergeCells(`${getColLetter(mvStartCol)}4:${lastCol}4`);
    const mvCell = sheet.getCell(`${getColLetter(mvStartCol)}4`);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    mvCell.value = `${monthNames[monthNum - 1]}-${yr.slice(2)}`;
    mvCell.font = { bold: true, size: 11 };
    mvCell.alignment = { horizontal: 'center', vertical: 'middle' };
    mvCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
    mvCell.border = row4Border;

    // Row 5: Empty separator
    sheet.getRow(5).height = 6;

    // Shared style objects (reuse references for speed)
    const thinBorder = { style: 'thin' };
    const borderAll = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder };
    const borderTotals = { top: { style: 'double' }, left: thinBorder, bottom: thinBorder, right: thinBorder };
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    const alignMiddle = { vertical: 'middle' };
    const alignRightMiddle = { horizontal: 'right', vertical: 'middle' };
    const alignCenterMiddle = { horizontal: 'center', vertical: 'middle', wrapText: true };
    const numFmt = '#,##0.00';
    const headerFont = { bold: true, size: 10 };
    const boldFont = { bold: true };

    if (isContractExport) {
      // ── Contract sheet: simple layout ──
      const contractHeaders = ['Full Name', 'Position', 'Contract Amount', 'TDS Deduction (10%)', 'In-Hand CTC'];

      const contractHeaderRow = sheet.getRow(6);
      contractHeaderRow.height = 24;
      contractHeaders.forEach((header, i) => {
        const cell = contractHeaderRow.getCell(i + 1);
        cell.value = header;
        cell.font = headerFont;
        cell.alignment = alignCenterMiddle;
        cell.fill = headerFill;
        cell.border = borderAll;
      });

      // Pre-compute totals
      let sumContract = 0, sumTds = 0, sumInHand = 0;

      slips.forEach((slip, index) => {
        const contractAmount = safeNum(slip.gross || slip.total_earnings);
        const tds = safeNum(slip.tds);
        const inHandCTC = contractAmount - tds;
        sumContract += contractAmount;
        sumTds += tds;
        sumInHand += inHandCTC;

        const row = sheet.getRow(7 + index);
        row.values = [safeStr(slip.full_name), safeStr(slip.position), contractAmount, tds, inHandCTC];
        for (let c = 1; c <= 5; c++) {
          const cell = row.getCell(c);
          cell.border = borderAll;
          cell.alignment = c >= 3 ? alignRightMiddle : alignMiddle;
          if (c >= 3) cell.numFmt = numFmt;
        }
      });

      // Totals row
      const totalsRow = sheet.getRow(7 + slips.length);
      totalsRow.values = ['TOTAL', '', sumContract, sumTds, sumInHand];
      totalsRow.getCell(1).font = boldFont;
      for (let c = 1; c <= 5; c++) {
        const cell = totalsRow.getCell(c);
        cell.border = borderTotals;
        if (c >= 3) {
          cell.numFmt = numFmt;
          cell.font = boldFont;
          cell.alignment = alignRightMiddle;
        }
      }

      [25, 20, 18, 18, 18].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

    } else {
      // ── Payroll - Extensive salary breakdown ──
      const headers = [
        // Employee Info (1-5)
        'SR NO.',
        'Emp Code',
        'Full Name',
        'Position',
        'UAN',
        // Attendance (6-14)
        'PF No.',
        'ESIC No.',
        'Total Days',
        'Days Present',
        'Days Paid',
        'LWP Days',
        'Leave',
        'WeekOff',
        // Earnings (15-25)
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
        'OT AMOUNT',
        // More Earnings (25)
        'INCENTIVE',
        // Gross (26)
        'GROSS EARNING',
        // Deductions (27-35)
        'PROVIDENT FUND',
        'ESIC',
        'PROFESSIONAL TAX',
        'LOAN',
        'ADVANCE',
        'TDS',
        'RETENTION',
        'MLWF',
        'TOTAL DEDUCTION',
        // Net (36)
        'NET PAY',
      ];

      // Row 6: Headers
      const headerFont9 = { bold: true, size: 9 };
      const headerRow = sheet.getRow(6);
      headerRow.height = 30;
      headers.forEach((header, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = header;
        cell.font = headerFont9;
        cell.alignment = alignCenterMiddle;
        cell.fill = headerFill;
        cell.border = borderAll;
      });
      // Highlight header cells for key columns
      headerRow.getCell(26).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } }; // GROSS
      headerRow.getCell(35).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } }; // DEDUCTIONS
      headerRow.getCell(36).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } }; // NET

      const alignCenterVertMiddle = { horizontal: 'center', vertical: 'middle' };
      const colCount = headers.length;

      // Pre-compute totals accumulators (columns 8..36, index 7..35)
      const totals = new Float64Array(colCount); // zero-initialized

      // Data rows - batch write
      for (let idx = 0; idx < slips.length; idx++) {
        const slip = slips[idx];
        // All numeric values use safeNum() to guarantee finite numbers (never NaN/Infinity/strings)
        const tds = safeNum(slip.tds);
        const totalDays = daysInMonth;
        const standardWorkingDays = safeNum(slip.standard_working_days) || totalDays;
        const lopDays = lwpMap[slip.employee_id] != null ? safeNum(lwpMap[slip.employee_id]) : safeNum(slip.lop_days);
        const absentDays = Math.max(lopDays, safeNum(slip.days_absent));
        const daysLeave = safeNum(slip.days_leave);
        const weeklyOff = weeklyOffDaysInMonth;
        const daysPresent = Math.max(0, totalDays - weeklyOff - absentDays);
        const payableDays = Math.max(0, totalDays - lopDays);
        // Only apply pro-rata when there are actual absent/LOP days
        const isAbsent = absentDays > 0;
        const prorataFactor = isAbsent && standardWorkingDays > 0
          ? Math.min(1, (standardWorkingDays - absentDays) / standardWorkingDays)
          : 1;

        const structureBasicPlusDa = safeNum(slip.structure_basic_salary);
        const profileBasic = safeNum(slip.profile_basic);
        const profileBasicPlusDa = safeNum(slip.profile_basic_plus_da);
        const basicPlusDaFull = Math.max(
          0,
          structureBasicPlusDa > 0
            ? structureBasicPlusDa
            : profileBasic > 0
              ? profileBasic
              : profileBasicPlusDa > 0
                ? profileBasicPlusDa
                : (safeNum(slip.basic) || (safeNum(slip.profile_basic) + safeNum(slip.profile_da)))
        );
        const daFull = scheduledDA > 0 ? scheduledDA : safeNum(slip.da_used || slip.da);
        const basicFull = Math.max(0, basicPlusDaFull - daFull);
        const basicPlusDa = basicFull + daFull;
        const hraFull = safeNum(slip.hra);
        const conveyanceFull = safeNum(slip.conveyance);
        const callAllowanceFull = safeNum(slip.call_allowance);
        const otherAllowancesFull = safeNum(slip.other_allowances);
        const bonusFull = safeNum(slip.bonus);
        const incentive = safeNum(slip.incentive);
        const paidHoliday = safeNum(slip.paid_holiday);
        const otRateFull = safeNum(slip.ot_rate);

        // Basic/DA split should match salary structure + Manage Schedule exactly
        const basic = basicFull;
        const da = daFull;
        const hra = hraFull * prorataFactor;
        const conveyance = conveyanceFull * prorataFactor;
        const callAllowance = callAllowanceFull * prorataFactor;
        const otherAllowances = otherAllowancesFull * prorataFactor;
        const bonus = bonusFull * prorataFactor;
        const otRate = otRateFull * prorataFactor;
        // Gross = total earnings using fetched Basic + DA from salary structure/profile
        const gross = basicPlusDa + hra + conveyance + callAllowance + otherAllowances + paidHoliday + bonus + otRate + incentive;
        
        // Pro-rate percentage-based deductions only if person is absent
        const pfEmployee = isAbsent ? safeNum(slip.pf_employee) * prorataFactor : safeNum(slip.pf_employee);
        const esicEmployee = isAbsent ? safeNum(slip.esic_employee) * prorataFactor : safeNum(slip.esic_employee);
        // PT is always 300 in February, but also pro-rate if absent
        const originalPt = safeNum(slip.pt);
        const pt = isAbsent ? ((monthNum === 2) ? 300 * prorataFactor : originalPt * prorataFactor) : ((monthNum === 2) ? 300 : originalPt);
        const empLoanAdvance = loanAdvanceMap[slip.employee_id] || { loan: 0, advance: 0 };
        const loan = empLoanAdvance.loan || safeNum(slip.loan);
        const advance = empLoanAdvance.advance || safeNum(slip.advance);
        const retention = isAbsent ? safeNum(slip.retention) * prorataFactor : safeNum(slip.retention);
        // MLWF: compulsory ₹25 deduction in June and December
        const mlwf = (monthNum === 6 || monthNum === 12) ? 25 : safeNum(slip.mlwf);
        // Recalculate total_deductions from pro-rated components
        const baseDeductions = pfEmployee + esicEmployee + pt + mlwf + retention;
        const totalDeductions = baseDeductions + loan + advance;
        const netPay = gross - totalDeductions;
        const otHours = safeNum(slip.overtime_hours);

        const row = sheet.getRow(7 + idx);
        // ExcelJS contiguous array: index 0 → column 1, index 1 → column 2, etc.
        row.values = [
          idx + 1, safeStr(slip.employee_code), safeStr(slip.full_name),
          safeStr(slip.position), safeStr(slip.uan),
          safeStr(slip.pf_no), safeStr(slip.esi_no) || '--',
          totalDays, daysPresent, payableDays, lopDays, daysLeave, 6, 0, otHours,
          basic, da, hra, conveyance, callAllowance, otherAllowances,
          paidHoliday, bonus, otRate, incentive, gross,
          pfEmployee, esicEmployee, pt, loan, advance, tds, retention, mlwf,
          totalDeductions, netPay,
        ];

        // Accumulate totals for numeric columns (8..36 = index 7..35)
        totals[7] += totalDays; totals[8] += daysPresent; totals[9] += payableDays;
        totals[10] += lopDays; totals[11] += daysLeave; totals[12] += 4; totals[14] += otHours;
        totals[15] += basic; totals[16] += da; totals[17] += hra;
        totals[18] += conveyance; totals[19] += callAllowance; totals[20] += otherAllowances;
        totals[21] += paidHoliday; totals[22] += bonus; totals[23] += otRate;
        totals[24] += incentive; totals[25] += gross;
        totals[26] += pfEmployee; totals[27] += esicEmployee; totals[28] += pt;
        totals[29] += loan; totals[30] += advance; totals[31] += tds;
        totals[32] += retention; totals[33] += mlwf; totals[34] += totalDeductions;
        totals[35] += netPay;

        // Apply styles per cell
        for (let c = 1; c <= colCount; c++) {
          const cell = row.getCell(c);
          cell.border = borderAll;
          if (c <= 2) {
            cell.alignment = alignCenterVertMiddle;
          } else if (c >= 8) {
            cell.numFmt = numFmt;
            cell.alignment = alignRightMiddle;
          } else {
            cell.alignment = alignMiddle;
          }
        }
      }

      // Totals row
      const totalsRowNum = 7 + slips.length;
      const totalsRow = sheet.getRow(totalsRowNum);
      const totalsValues = ['', '', 'TOTAL'];
      for (let c = 4; c <= colCount; c++) {
        totalsValues.push(c >= 8 ? totals[c - 1] : '');
      }
      totalsRow.values = totalsValues;
      totalsRow.getCell(3).font = { bold: true, size: 10 };
      for (let c = 1; c <= colCount; c++) {
        const cell = totalsRow.getCell(c);
        cell.border = borderTotals;
        if (c >= 8) {
          cell.numFmt = numFmt;
          cell.font = boldFont;
          cell.alignment = alignRightMiddle;
        }
      }

      // Column widths
      [6,12,22,16,15,20,15,10,10,10,10,8,8,10,8,12,10,10,16,14,14,14,10,8,10,14,14,10,14,10,10,10,12,10,14,14]
        .forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const uint8 = new Uint8Array(buffer);
    const filename = `Salary_Sheet_${month.substring(0, 7)}.xlsx`;

    // Use native Response (not NextResponse) to avoid any App Router body transformations.
    // Do NOT set Content-Length — next.config compress:true gzips the body and
    // an explicit Content-Length referring to the raw size would truncate the download.
    return new Response(uint8, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
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
