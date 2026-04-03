const path = require('path');
const ExcelJS = require('exceljs');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

const workbookPath = process.argv.find((arg) => arg.endsWith('.xlsx')) || path.join(__dirname, 'Updated salary Sheet.xlsx');
const replaceExistingMonth = process.argv.includes('--replace-existing-month');

const normalizeText = (value) => String(value || '')
  .replace(/[.]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase();
const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};
const toMonthKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
};
const toDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
};

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(workbookPath);

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Workbook does not contain any worksheets');
  }

  let payrollMonth = null;
  for (let rowNumber = 1; rowNumber <= 5 && !payrollMonth; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    row.eachCell((cell) => {
      const dateValue = toDate(cell.value);
      if (dateValue && !payrollMonth) {
        payrollMonth = toMonthKey(dateValue);
      }
    });
  }

  if (!payrollMonth) {
    throw new Error('Could not determine payroll month from the workbook header');
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 2
  });

  const db = await pool.getConnection();

  try {
    const [employeeRows] = await db.execute(
      `SELECT id, employee_id, first_name, middle_name, last_name, username,
              attendance_id, biometric_code, smartoffice_code, device_code,
              account_holder_name, company_name
       FROM employees`
    );

    const employeeLookup = new Map();
    for (const employee of employeeRows) {
      const candidateValues = [
        `${employee.first_name || ''} ${employee.middle_name || ''} ${employee.last_name || ''}`,
        `${employee.first_name || ''} ${employee.last_name || ''}`,
        employee.employee_id,
        employee.username,
        employee.attendance_id,
        employee.biometric_code,
        employee.smartoffice_code,
        employee.device_code,
        employee.account_holder_name,
        employee.company_name,
      ];

      for (const candidate of candidateValues) {
        const key = normalizeText(candidate);
        if (!key || employeeLookup.has(key)) continue;
        employeeLookup.set(key, employee);
      }
    }

    const records = [];
    const unmatchedRows = [];

    for (let rowNumber = 8; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const fullName = normalizeText(row.getCell(1).value);
      if (!fullName) continue;

      const employee = employeeLookup.get(fullName);
      if (!employee) {
        unmatchedRows.push({ rowNumber, fullName });
        continue;
      }

      const totalDays = parseNumber(row.getCell(6).value);
      const daysPresent = parseNumber(row.getCell(7).value);
      const daysPaid = parseNumber(row.getCell(8).value);
      const lwpDays = parseNumber(row.getCell(9).value);
      const leaveDays = parseNumber(row.getCell(10).value);
      const weekOffDays = parseNumber(row.getCell(11).value);
      const paidHoliday = parseNumber(row.getCell(12).value);
      const overtimeHours = parseNumber(row.getCell(13).value);

      const basic = parseNumber(row.getCell(14).value);
      const da = parseNumber(row.getCell(15).value);
      const hra = parseNumber(row.getCell(16).value);
      const conveyance = parseNumber(row.getCell(17).value);
      const callAllowance = parseNumber(row.getCell(18).value);
      const otherAllowances = parseNumber(row.getCell(19).value);
      const bonus = parseNumber(row.getCell(21).value);
      const incentive = parseNumber(row.getCell(23).value);
      const gross = parseNumber(row.getCell(34).value);

      const pfEmployee = parseNumber(row.getCell(41).value);
      const esicEmployee = parseNumber(row.getCell(42).value);
      const pt = parseNumber(row.getCell(43).value);
      const loan = parseNumber(row.getCell(44).value);
      const advance = parseNumber(row.getCell(45).value);
      const tds = parseNumber(row.getCell(46).value);
      const retention = parseNumber(row.getCell(47).value);
      const totalDeductions = parseNumber(row.getCell(48).value);
      const netPay = parseNumber(row.getCell(49).value);

      const daysAbsent = Math.max(totalDays - daysPresent - weekOffDays - leaveDays - paidHoliday, 0);
      const otherDeductions = loan + advance;
      const employerContributions = 0;
      const employerCost = gross + employerContributions;
      const computedTotalDeductions = pfEmployee + esicEmployee + pt + retention + tds + otherDeductions;

      if (Math.abs(computedTotalDeductions - totalDeductions) > 0.5) {
        console.warn(`Row ${rowNumber} total deduction mismatch for ${fullName}: sheet=${totalDeductions}, computed=${computedTotalDeductions}`);
      }

      records.push({
        month: payrollMonth,
        employee_id: employee.id,
        gross,
        da_used: da,
        da,
        basic,
        hra,
        conveyance,
        call_allowance: callAllowance,
        other_allowances: otherAllowances,
        bonus,
        incentive,
        ot_rate: parseNumber(row.getCell(22).value),
        total_earnings: gross,
        pf_employee: pfEmployee,
        esic_employee: esicEmployee,
        pt,
        mlwf: 0,
        retention,
        lwf: 0,
        tds,
        other_deductions: otherDeductions,
        total_deductions: totalDeductions,
        net_pay: netPay,
        pf_employer: 0,
        esic_employer: 0,
        mlwf_employer: 0,
        insurance: 0,
        gratuity: 0,
        pf_admin: 0,
        edli: 0,
        total_employer_contributions: employerContributions,
        employer_cost: employerCost,
        standard_working_days: totalDays,
        days_present: daysPresent,
        days_absent: daysAbsent,
        days_leave: leaveDays,
        payable_days: daysPaid,
        lop_days: lwpDays,
        lop_deduction: 0,
        overtime_hours: overtimeHours,
        full_month_gross: gross,
        pl_total: 21,
        pl_used: 0,
        pl_balance: 21,
        payment_status: 'pending',
        remarks: `Imported from ${path.basename(workbookPath)} row ${rowNumber}; source weekoff=${weekOffDays}; paid_holiday=${paidHoliday}`,
      });
    }

    if (records.length === 0) {
      throw new Error('No employee rows were found in the workbook');
    }

    if (unmatchedRows.length > 0) {
      console.warn(`Unmatched rows: ${unmatchedRows.length}`);
      for (const row of unmatchedRows.slice(0, 10)) {
        console.warn(`  row ${row.rowNumber}: ${row.fullName}`);
      }
    }

    await db.beginTransaction();

    if (replaceExistingMonth) {
      const [deleted] = await db.execute(
        'DELETE FROM payroll_slips WHERE month = ?',
        [payrollMonth]
      );
      console.log(`Deleted ${deleted.affectedRows} existing payroll slip(s) for ${payrollMonth}`);
    } else {
      const [existing] = await db.execute(
        'SELECT COUNT(*) AS count FROM payroll_slips WHERE month = ?',
        [payrollMonth]
      );
      if ((existing[0]?.count || 0) > 0) {
        throw new Error(`Payroll slips already exist for ${payrollMonth}. Re-run with --replace-existing-month to overwrite them.`);
      }
    }

    const insertSql = `INSERT INTO payroll_slips (
      month, employee_id, gross, da_used, da, basic, hra, conveyance, call_allowance,
      other_allowances, bonus, incentive, ot_rate, total_earnings,
      pf_employee, esic_employee, pt, mlwf, retention, lwf, tds,
      other_deductions, total_deductions, net_pay,
      pf_employer, esic_employer, mlwf_employer, insurance,
      gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
      standard_working_days, days_present, days_absent, days_leave, payable_days, lop_days,
      lop_deduction, overtime_hours, full_month_gross,
      pl_total, pl_used, pl_balance,
      payment_status, remarks
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const record of records) {
      await db.execute(insertSql, [
        record.month,
        record.employee_id,
        record.gross,
        record.da_used,
        record.da,
        record.basic,
        record.hra,
        record.conveyance,
        record.call_allowance,
        record.other_allowances,
        record.bonus,
        record.incentive,
        record.ot_rate,
        record.total_earnings,
        record.pf_employee,
        record.esic_employee,
        record.pt,
        record.mlwf,
        record.retention,
        record.lwf,
        record.tds,
        record.other_deductions,
        record.total_deductions,
        record.net_pay,
        record.pf_employer,
        record.esic_employer,
        record.mlwf_employer,
        record.insurance,
        record.gratuity,
        record.pf_admin,
        record.edli,
        record.total_employer_contributions,
        record.employer_cost,
        record.standard_working_days,
        record.days_present,
        record.days_absent,
        record.days_leave,
        record.payable_days,
        record.lop_days,
        record.lop_deduction,
        record.overtime_hours,
        record.full_month_gross,
        record.pl_total,
        record.pl_used,
        record.pl_balance,
        record.payment_status,
        record.remarks,
      ]);
    }

    await db.commit();

    console.log(`Imported ${records.length} payroll slip(s) for ${payrollMonth}`);
    if (unmatchedRows.length > 0) {
      console.log(`Skipped ${unmatchedRows.length} unmatched row(s)`);
    }
  } catch (error) {
    try {
      await db.rollback();
    } catch (_) {
      // ignore rollback failures
    }
    throw error;
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Salary sheet import failed:', error.message);
  process.exitCode = 1;
});