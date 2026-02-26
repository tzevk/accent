/**
 * Payroll Calculator Utility
 * ---------------------------
 * Uses frozen PAYROLL_CONFIG to calculate all salary components
 * Integrates with core payroll tables:
 *  - da_schedule
 *  - employee_salary_profile
 *  - payroll_slips
 *  - employee_attendance (for monthly calculations)
 */

import PAYROLL_CONFIG, { 
  calculatePF, 
  calculateESIC, 
  calculateProfessionalTax 
} from './payroll-config';
import { dbConnect } from './database';

/**
 * Get current active DA amount from da_schedule
 * @param {Date} forDate - Date to check (defaults to today)
 * @returns {Promise<number>} Current DA amount
 */
export async function getCurrentDA(forDate = new Date()) {
  const db = await dbConnect();
  
  try {
    const [rows] = await db.execute(
      `SELECT da_amount 
       FROM da_schedule 
       WHERE is_active = 1 
         AND ? BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31')
       LIMIT 1`,
      [forDate]
    );
    
    await db.end();
    return rows.length > 0 ? parseFloat(rows[0].da_amount) : PAYROLL_CONFIG.DA_FIXED_AMOUNT;
  } catch (error) {
    await db.end();
    console.error('Error getting current DA:', error);
    return PAYROLL_CONFIG.DA_FIXED_AMOUNT; // Fallback to config default
  }
}

/**
 * Get employee's total working hours from attendance for a given month
 * @param {number} employeeId - Employee ID
 * @param {string} month - Month in YYYY-MM format
 * @param {string} defaultInTime - Default in time (HH:MM format)
 * @param {string} defaultOutTime - Default out time (HH:MM format)
 * @returns {Promise<number>} Total working hours
 */
export async function getEmployeeMonthlyHours(employeeId, month, defaultInTime = '09:00', defaultOutTime = '17:30') {
  const db = await dbConnect();
  
  try {
    // Get attendance records with in/out times
    const [records] = await db.execute(
      `SELECT 
        status,
        in_time,
        out_time
       FROM employee_attendance 
       WHERE employee_id = ? 
         AND DATE_FORMAT(attendance_date, '%Y-%m') = ?
         AND status IN ('P', 'HD', 'OT')`,
      [employeeId, month.substring(0, 7)]
    );
    
    db.release();
    
    let totalHours = 0;
    
    // Helper to parse time string to decimal hours
    const timeToDecimal = (timeStr) => {
      if (!timeStr) return null;
      const timePart = timeStr.toString().substring(0, 5);
      const [hours, minutes] = timePart.split(':').map(Number);
      return hours + (minutes / 60);
    };
    
    // Parse default times
    const defaultIn = timeToDecimal(defaultInTime);
    const defaultOut = timeToDecimal(defaultOutTime);
    const defaultDailyHours = defaultOut - defaultIn;
    
    records.forEach(record => {
      const inTime = timeToDecimal(record.in_time) || defaultIn;
      const outTime = timeToDecimal(record.out_time) || defaultOut;
      
      let hours = outTime > inTime ? outTime - inTime : defaultDailyHours;
      
      // Half day = half hours
      if (record.status === 'HD') {
        hours = hours / 2;
      }
      
      totalHours += hours;
    });
    
    return totalHours;
  } catch (error) {
    db.release();
    console.error('Error getting employee monthly hours:', error);
    // Return default hours (160 for a month)
    return 160;
  }
}

/**
 * Get employee's attendance summary for a given month
 * @param {number} employeeId - Employee ID
 * @param {string} month - Month in YYYY-MM format
 * @returns {Promise<object>} Attendance summary
 */
export async function getEmployeeAttendance(employeeId, month) {
  const db = await dbConnect();
  
  try {
    // Get standard working days from config (default 26)
    const standardWorkingDays = PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26;
    
    // Get attendance records for the month
    const [records] = await db.execute(
      `SELECT 
        status,
        overtime_hours,
        is_weekly_off
       FROM employee_attendance 
       WHERE employee_id = ? 
         AND DATE_FORMAT(attendance_date, '%Y-%m') = ?`,
      [employeeId, month.substring(0, 7)] // Extract YYYY-MM from month
    );
    
    db.release();
    
    // Calculate attendance summary
    let daysPresent = 0;
    let daysAbsent = 0;
    let daysLeave = 0;
    let weeklyOff = 0;
    let holidays = 0;
    let halfDays = 0;
    let totalOvertimeHours = 0;
    
    records.forEach(record => {
      switch (record.status) {
        case 'P': // Present
          daysPresent++;
          break;
        case 'A': // Absent
          daysAbsent++;
          break;
        case 'PL': // Paid Leave
        case 'CL': // Casual Leave
        case 'SL': // Sick Leave
        case 'EL': // Earned Leave
          daysLeave++;
          daysPresent++; // Paid leaves count as present for salary
          break;
        case 'UL': // Unpaid Leave
        case 'LWP': // Leave Without Pay
          daysAbsent++;
          break;
        case 'HD': // Half Day
          halfDays++;
          daysPresent += 0.5;
          break;
        case 'WO': // Weekly Off
          weeklyOff++;
          break;
        case 'H': // Holiday
          holidays++;
          break;
      }
      
      if (record.is_weekly_off) weeklyOff++;
      totalOvertimeHours += parseFloat(record.overtime_hours || 0);
    });
    
    // If no attendance records found, assume full month present
    const hasAttendanceData = records.length > 0;
    const effectivePresentDays = hasAttendanceData ? daysPresent : standardWorkingDays;
    const lossOfPayDays = hasAttendanceData ? daysAbsent : 0;
    
    return {
      standardWorkingDays,
      daysPresent: effectivePresentDays,
      daysAbsent: lossOfPayDays,
      daysLeave,
      weeklyOff,
      holidays,
      halfDays,
      totalOvertimeHours,
      hasAttendanceData,
      // Payable days = Present + Paid Leaves (excluding unpaid leaves/absents)
      payableDays: effectivePresentDays,
      // Loss of Pay days
      lopDays: lossOfPayDays
    };
  } catch (error) {
    db.release();
    console.error('Error getting employee attendance:', error);
    // Return default (full month) if error
    return {
      standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
      daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
      daysAbsent: 0,
      daysLeave: 0,
      weeklyOff: 0,
      holidays: 0,
      halfDays: 0,
      totalOvertimeHours: 0,
      hasAttendanceData: false,
      payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
      lopDays: 0
    };
  }
}

/**
 * Get employee's current salary profile from salary_structures table
 * @param {number} employeeId - Employee ID
 * @param {Date} forDate - Date to check (defaults to today)
 * @returns {Promise<object|null>} Salary profile or null
 */
export async function getEmployeeSalaryProfile(employeeId, forDate = new Date()) {
  const db = await dbConnect();
  
  // Format date for MySQL
  const dateStr = typeof forDate === 'string' ? forDate : forDate.toISOString().split('T')[0];
  
  try {
    // First try the salary_structures table (newer) - simplified query
    const [rows] = await db.execute(
      `SELECT 
        ss.*,
        ss.ctc as gross_salary,
        ss.basic_salary as basic_plus_da,
        ss.pf_applicable,
        ss.esic_applicable,
        ss.pt_applicable,
        ss.mlwf_applicable,
        ss.standard_working_days
       FROM salary_structures ss
       WHERE ss.employee_id = ? 
         AND ss.is_active = 1
       ORDER BY ss.effective_from DESC
       LIMIT 1`,
      [employeeId]
    );
    
    if (rows.length > 0) {
      db.release();
      return rows[0];
    }
    
    // Fallback to employee_salary_profile table (legacy)
    const [legacyRows] = await db.execute(
      `SELECT * 
       FROM employee_salary_profile 
       WHERE employee_id = ? 
         AND is_active = 1
       ORDER BY effective_from DESC
       LIMIT 1`,
      [employeeId]
    );
    
    db.release();
    return legacyRows.length > 0 ? legacyRows[0] : null;
  } catch (error) {
    db.release();
    console.error('Error getting employee salary profile:', error);
    return null;
  }
}

/**
 * Calculate complete payroll breakdown for an employee
 * Links salary structure with attendance for monthly calculations
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Complete payroll breakdown
 */
export async function calculateEmployeePayroll(employeeId, month) {
  // Get employee's salary profile
  const profile = await getEmployeeSalaryProfile(employeeId, month);
  
  if (!profile) {
    // Return null instead of throwing - let caller handle missing profile
    return null;
  }
  
  // Get current DA
  const daAmount = await getCurrentDA(month);
  
  // Get attendance data for the month
  const attendance = await getEmployeeAttendance(employeeId, month);
  
  // Calculate attendance factor (payable days / standard working days)
  const attendanceFactor = attendance.payableDays / attendance.standardWorkingDays;
  
  // Full month values from salary profile
  const fullGross = parseFloat(profile.gross_salary || profile.gross) || 0;
  const fullOtherAllowances = parseFloat(profile.other_allowances) || 0;
  const pfApplicable = profile.pf_applicable === 1;
  const esicApplicable = profile.esic_applicable === 1;
  const ptApplicable = profile.pt_applicable === 1;
  const mlwfApplicable = profile.mlwf_applicable === 1;
  const retentionApplicable = profile.retention_applicable === 1;
  const bonusApplicable = profile.bonus_applicable === 1;
  const incentiveApplicable = profile.incentive_applicable === 1;
  const insuranceApplicable = profile.insurance_applicable === 1;
  
  // ═══════════════════════════════════════════════════════════════════
  // PRO-RATA CALCULATION BASED ON ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════
  
  // Apply attendance factor to get actual payable amounts
  const gross = Math.round(fullGross * attendanceFactor);
  const otherAllowances = Math.round(fullOtherAllowances * attendanceFactor);
  
  // Loss of Pay (LOP) deduction
  const lopDeduction = Math.round(fullGross - gross);
  
  // ═══════════════════════════════════════════════════════════════════
  // EARNINGS (Using saved profile values or calculate from percentages)
  // ═══════════════════════════════════════════════════════════════════
  
  // Use saved breakdown values if available, otherwise calculate
  let basic, da, hra, conveyance, callAllowance, bonus, incentive;
  
  if (profile.basic_plus_da && profile.da) {
    // Use saved values and apply attendance factor
    basic = Math.round((parseFloat(profile.basic_plus_da) || 0) * attendanceFactor);
    da = Math.round((parseFloat(profile.da) || 0) * attendanceFactor);
    hra = Math.round((parseFloat(profile.hra) || 0) * attendanceFactor);
    conveyance = Math.round((parseFloat(profile.conveyance) || 0) * attendanceFactor);
    callAllowance = Math.round((parseFloat(profile.call_allowance) || 0) * attendanceFactor);
    bonus = bonusApplicable ? Math.round((parseFloat(profile.bonus) || 0) * attendanceFactor) : 0;
    incentive = incentiveApplicable ? Math.round((parseFloat(profile.incentive) || 0) * attendanceFactor) : 0;
  } else {
    // Calculate from gross using PAYROLL_CONFIG percentages
    // Basic + DA = 60% of Gross
    const basicDaTotal = Math.round(gross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
    basic = basicDaTotal - Math.round(daAmount * attendanceFactor);
    da = Math.round(daAmount * attendanceFactor);
    
    // HRA = 20% of Gross
    hra = Math.round(gross * (PAYROLL_CONFIG.HRA_PERCENT / 100));
    
    // Conveyance = 10% of Gross
    conveyance = Math.round(gross * (PAYROLL_CONFIG.CONVEYANCE_PERCENT / 100));
    
    // Call Allowance = 10% of Gross
    callAllowance = Math.round(gross * (PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT / 100));
    
    bonus = 0;
    incentive = 0;
  }
  
  const totalEarnings = basic + da + hra + conveyance + callAllowance + otherAllowances + incentive;
  
  // ═══════════════════════════════════════════════════════════════════
  // EMPLOYEE DEDUCTIONS (calculated on actual payable gross)
  // ═══════════════════════════════════════════════════════════════════
  
  // PF: 12% of Gross (capped at wage ceiling)
  const pfBreakdown = calculatePF(gross, pfApplicable, '15000');
  const pfEmployee = pfBreakdown.employeeContribution;
  
  // ESIC: 0.75% of Gross (only if eligible)
  const esicBreakdown = calculateESIC(gross, esicApplicable);
  const esicEmployee = esicBreakdown.employeeContribution;
  
  // Professional Tax (Maharashtra slab) - fixed amount, not pro-rata
  const pt = ptApplicable ? calculateProfessionalTax(fullGross) : 0;
  
  // MLWF - use saved value or 0
  const mlwf = mlwfApplicable ? (parseFloat(profile.mlwf) || 0) : 0;
  
  // Retention
  const retention = retentionApplicable ? (parseFloat(profile.retention) || 0) : 0;
  
  // LWF, TDS, Other deductions
  const lwf = 0; // Usually ₹25 twice a year
  const tds = 0; // Calculated separately based on tax regime
  const otherDeductions = 0;
  
  const totalDeductions = pfEmployee + esicEmployee + pt + mlwf + retention + lwf + tds + otherDeductions;
  
  // ═══════════════════════════════════════════════════════════════════
  // NET PAY
  // ═══════════════════════════════════════════════════════════════════
  
  const netPay = totalEarnings - totalDeductions;
  
  // ═══════════════════════════════════════════════════════════════════
  // EMPLOYER CONTRIBUTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  // Employer PF: 13% of Gross
  const pfEmployer = pfBreakdown.employerTotal;
  
  // Employer ESIC: 3.25% of Gross
  const esicEmployer = esicBreakdown.employerContribution;
  
  // Employer MLWF
  const mlwfEmployer = mlwfApplicable ? (parseFloat(profile.mlwf_employer) || 0) : 0;
  
  // Insurance (PA/Mediclaim)
  const insurance = insuranceApplicable ? (parseFloat(profile.insurance) || 0) : 0;
  
  // Gratuity: 4.81% of Basic (calculated on full basic, not pro-rata)
  const fullBasic = parseFloat(profile.basic_plus_da) || Math.round(fullGross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
  const gratuity = Math.round(fullBasic * (PAYROLL_CONFIG.GRATUITY_PERCENT / 100));
  
  // PF Admin: 0.5% of wage base
  const pfAdmin = pfBreakdown.pfAdmin;
  
  // EDLI: 0.5% of wage base
  const edli = Math.round(pfBreakdown.wageBase * (PAYROLL_CONFIG.EDLI_PERCENT / 100));
  
  const totalEmployerContributions = pfEmployer + esicEmployer + mlwfEmployer + bonus + insurance + gratuity + pfAdmin + edli;
  
  // ═══════════════════════════════════════════════════════════════════
  // TOTAL EMPLOYER COST (CTC)
  // ═══════════════════════════════════════════════════════════════════
  
  const employerCost = totalEarnings + totalEmployerContributions;
  
  return {
    month,
    employee_id: employeeId,
    
    // Earnings
    gross,
    da_used: daAmount,
    da,
    basic,
    hra,
    conveyance,
    call_allowance: callAllowance,
    other_allowances: otherAllowances,
    bonus,
    incentive,
    total_earnings: totalEarnings,
    
    // Employee Deductions
    pf_employee: pfEmployee,
    esic_employee: esicEmployee,
    pt,
    mlwf,
    retention,
    lwf,
    tds,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    
    // Net Pay
    net_pay: netPay,
    
    // Employer Contributions
    pf_employer: pfEmployer,
    esic_employer: esicEmployer,
    mlwf_employer: mlwfEmployer,
    insurance,
    gratuity,
    pf_admin: pfAdmin,
    edli,
    total_employer_contributions: totalEmployerContributions,
    
    // Total Cost
    employer_cost: employerCost,
    
    // Attendance Data
    attendance: {
      standard_working_days: attendance.standardWorkingDays,
      days_present: attendance.daysPresent,
      days_absent: attendance.daysAbsent,
      days_leave: attendance.daysLeave,
      weekly_off: attendance.weeklyOff,
      holidays: attendance.holidays,
      half_days: attendance.halfDays,
      payable_days: attendance.payableDays,
      lop_days: attendance.lopDays,
      overtime_hours: attendance.totalOvertimeHours,
      has_attendance_data: attendance.hasAttendanceData
    },
    
    // Full month values (before pro-rata)
    full_month: {
      gross: fullGross,
      other_allowances: fullOtherAllowances
    },
    
    // LOP Deduction
    lop_deduction: lopDeduction,
    
    // Metadata
    payment_status: 'pending',
    remarks: null
  };
}

// ═══════════════════════════════════════════════════════════════════
// SCHEMA MIGRATION - run once per process lifetime
// ═══════════════════════════════════════════════════════════════════
let _columnsEnsured = false;

const PAYROLL_COLUMNS_TO_ADD = [
  { name: 'da', definition: 'DECIMAL(12, 2)' },
  { name: 'bonus', definition: 'DECIMAL(12, 2)' },
  { name: 'incentive', definition: 'DECIMAL(12, 2)' },
  { name: 'mlwf', definition: 'DECIMAL(12, 2)' },
  { name: 'retention', definition: 'DECIMAL(12, 2)' },
  { name: 'mlwf_employer', definition: 'DECIMAL(12, 2)' },
  { name: 'insurance', definition: 'DECIMAL(12, 2)' },
  { name: 'standard_working_days', definition: 'INT DEFAULT 26' },
  { name: 'days_present', definition: 'DECIMAL(5,1)' },
  { name: 'days_absent', definition: 'DECIMAL(5,1)' },
  { name: 'days_leave', definition: 'DECIMAL(5,1)' },
  { name: 'payable_days', definition: 'DECIMAL(5,1)' },
  { name: 'lop_days', definition: 'DECIMAL(5,1)' },
  { name: 'lop_deduction', definition: 'DECIMAL(12, 2)' },
  { name: 'overtime_hours', definition: 'DECIMAL(5,2)' },
  { name: 'full_month_gross', definition: 'DECIMAL(12, 2)' },
];

async function ensurePayrollColumns(db) {
  if (_columnsEnsured) return;
  for (const col of PAYROLL_COLUMNS_TO_ADD) {
    try {
      await db.query(`ALTER TABLE payroll_slips ADD COLUMN ${col.name} ${col.definition}`);
    } catch (_) { /* column already exists */ }
  }
  _columnsEnsured = true;
}

// Helper to convert undefined to null
const n = (val) => val === undefined ? null : val;

const INSERT_SLIP_SQL = `INSERT INTO payroll_slips (
  month, employee_id, gross, da_used, da, basic, hra, conveyance, call_allowance,
  other_allowances, bonus, incentive, total_earnings,
  pf_employee, esic_employee, pt, mlwf, retention, lwf, tds,
  other_deductions, total_deductions, net_pay,
  pf_employer, esic_employer, mlwf_employer, insurance,
  gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
  standard_working_days, days_present, days_absent, days_leave, payable_days, lop_days,
  lop_deduction, overtime_hours, full_month_gross,
  payment_status, remarks
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function payrollToParams(payroll) {
  return [
    payroll.month,
    payroll.employee_id,
    n(payroll.gross) || 0,
    n(payroll.da_used) || 0,
    n(payroll.da) || 0,
    n(payroll.basic) || 0,
    n(payroll.hra) || 0,
    n(payroll.conveyance) || 0,
    n(payroll.call_allowance) || 0,
    n(payroll.other_allowances) || 0,
    n(payroll.bonus) || 0,
    n(payroll.incentive) || 0,
    n(payroll.total_earnings) || 0,
    n(payroll.pf_employee) || 0,
    n(payroll.esic_employee) || 0,
    n(payroll.pt) || 0,
    n(payroll.mlwf) || 0,
    n(payroll.retention) || 0,
    n(payroll.lwf) || 0,
    n(payroll.tds) || 0,
    n(payroll.other_deductions) || 0,
    n(payroll.total_deductions) || 0,
    n(payroll.net_pay) || 0,
    n(payroll.pf_employer) || 0,
    n(payroll.esic_employer) || 0,
    n(payroll.mlwf_employer) || 0,
    n(payroll.insurance) || 0,
    n(payroll.gratuity) || 0,
    n(payroll.pf_admin) || 0,
    n(payroll.edli) || 0,
    n(payroll.total_employer_contributions) || 0,
    n(payroll.employer_cost) || 0,
    n(payroll.attendance?.standard_working_days) || 26,
    n(payroll.attendance?.days_present) || 0,
    n(payroll.attendance?.days_absent) || 0,
    n(payroll.attendance?.days_leave) || 0,
    n(payroll.attendance?.payable_days) || 26,
    n(payroll.attendance?.lop_days) || 0,
    n(payroll.lop_deduction) || 0,
    n(payroll.attendance?.overtime_hours) || 0,
    n(payroll.full_month?.gross) || 0,
    payroll.payment_status || 'pending',
    payroll.remarks || null
  ];
}

/**
 * Generate and save payroll slip for an employee
 * Links salary structure with attendance for monthly calculations
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Generated payroll slip
 */
export async function generatePayrollSlip(employeeId, month) {
  const payroll = await calculateEmployeePayroll(employeeId, month);
  
  if (!payroll) {
    throw new Error(`No active salary profile found for employee ${employeeId}. Please set up salary structure first.`);
  }
  
  const db = await dbConnect();
  
  try {
    await ensurePayrollColumns(db);
    
    const [result] = await db.execute(INSERT_SLIP_SQL, payrollToParams(payroll));
    
    db.release();
    
    return {
      ...payroll,
      id: result.insertId,
      created_at: new Date()
    };
  } catch (error) {
    db.release();
    
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error(`Payroll slip already exists for employee ${employeeId} for month ${month}`);
    }
    
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════
// BATCH HELPERS — fetch data for many employees in one DB round-trip
// ═══════════════════════════════════════════════════════════════════

/**
 * Fetch salary profiles for a list of employee IDs in a single query.
 * Returns a Map<employee_id, profile>.
 */
async function batchGetSalaryProfiles(db, employeeIds) {
  if (employeeIds.length === 0) return new Map();

  const placeholders = employeeIds.map(() => '?').join(',');

  // Newer salary_structures table (takes priority)
  const [ssRows] = await db.execute(
    `SELECT ss.*,
            ss.ctc as gross_salary,
            ss.basic_salary as basic_plus_da,
            ss.pf_applicable, ss.esic_applicable,
            ss.pt_applicable, ss.mlwf_applicable,
            ss.standard_working_days
     FROM salary_structures ss
     INNER JOIN (
       SELECT employee_id, MAX(id) as max_id
       FROM salary_structures
       WHERE is_active = 1 AND employee_id IN (${placeholders})
       GROUP BY employee_id
     ) latest ON ss.id = latest.max_id`,
    employeeIds
  );

  const profileMap = new Map();
  for (const row of ssRows) profileMap.set(row.employee_id, row);

  // Legacy employee_salary_profile for employees not found above
  const missingIds = employeeIds.filter(id => !profileMap.has(id));
  if (missingIds.length > 0) {
    const ph2 = missingIds.map(() => '?').join(',');
    const [legacyRows] = await db.execute(
      `SELECT esp.*
       FROM employee_salary_profile esp
       INNER JOIN (
         SELECT employee_id, MAX(id) as max_id
         FROM employee_salary_profile
         WHERE is_active = 1 AND employee_id IN (${ph2})
         GROUP BY employee_id
       ) latest ON esp.id = latest.max_id`,
      missingIds
    );
    for (const row of legacyRows) profileMap.set(row.employee_id, row);
  }

  return profileMap;
}

/**
 * Fetch attendance records for a list of employee IDs for a given month
 * in a single query. Returns Map<employee_id, attendanceSummary>.
 */
async function batchGetAttendance(db, employeeIds, month) {
  const defaultSummary = () => ({
    standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
    daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
    daysAbsent: 0, daysLeave: 0, weeklyOff: 0, holidays: 0, halfDays: 0,
    totalOvertimeHours: 0, hasAttendanceData: false,
    payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26, lopDays: 0
  });

  if (employeeIds.length === 0) return new Map();

  const placeholders = employeeIds.map(() => '?').join(',');
  const monthPrefix = month.substring(0, 7);

  const [records] = await db.execute(
    `SELECT employee_id, status, overtime_hours, is_weekly_off
     FROM employee_attendance
     WHERE employee_id IN (${placeholders})
       AND DATE_FORMAT(attendance_date, '%Y-%m') = ?`,
    [...employeeIds, monthPrefix]
  );

  // Group by employee
  const grouped = new Map();
  for (const r of records) {
    if (!grouped.has(r.employee_id)) grouped.set(r.employee_id, []);
    grouped.get(r.employee_id).push(r);
  }

  const standardWorkingDays = PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26;
  const resultMap = new Map();

  for (const empId of employeeIds) {
    const empRecords = grouped.get(empId);
    if (!empRecords || empRecords.length === 0) {
      resultMap.set(empId, defaultSummary());
      continue;
    }

    let daysPresent = 0, daysAbsent = 0, daysLeave = 0;
    let weeklyOff = 0, holidays = 0, halfDays = 0, totalOvertimeHours = 0;

    for (const record of empRecords) {
      switch (record.status) {
        case 'P': daysPresent++; break;
        case 'A': daysAbsent++; break;
        case 'PL': case 'CL': case 'SL': case 'EL':
          daysLeave++; daysPresent++; break;
        case 'UL': case 'LWP': daysAbsent++; break;
        case 'HD': halfDays++; daysPresent += 0.5; break;
        case 'WO': weeklyOff++; break;
        case 'H': holidays++; break;
      }
      if (record.is_weekly_off) weeklyOff++;
      totalOvertimeHours += parseFloat(record.overtime_hours || 0);
    }

    resultMap.set(empId, {
      standardWorkingDays,
      daysPresent,
      daysAbsent,
      daysLeave,
      weeklyOff,
      holidays,
      halfDays,
      totalOvertimeHours,
      hasAttendanceData: true,
      payableDays: daysPresent,
      lopDays: daysAbsent
    });
  }

  return resultMap;
}

/**
 * Compute payroll breakdown in-memory (no DB calls).
 * Same logic as calculateEmployeePayroll but accepts pre-fetched data.
 */
function computePayroll(employeeId, month, profile, daAmount, attendance) {
  const attendanceFactor = attendance.payableDays / attendance.standardWorkingDays;
  const fullGross = parseFloat(profile.gross_salary || profile.gross) || 0;
  const fullOtherAllowances = parseFloat(profile.other_allowances) || 0;
  const pfApplicable = profile.pf_applicable === 1;
  const esicApplicable = profile.esic_applicable === 1;
  const ptApplicable = profile.pt_applicable === 1;
  const mlwfApplicable = profile.mlwf_applicable === 1;
  const retentionApplicable = profile.retention_applicable === 1;
  const bonusApplicable = profile.bonus_applicable === 1;
  const incentiveApplicable = profile.incentive_applicable === 1;
  const insuranceApplicable = profile.insurance_applicable === 1;

  const gross = Math.round(fullGross * attendanceFactor);
  const otherAllowances = Math.round(fullOtherAllowances * attendanceFactor);
  const lopDeduction = Math.round(fullGross - gross);

  let basic, da, hra, conveyance, callAllowance, bonus, incentive;

  if (profile.basic_plus_da && profile.da) {
    basic = Math.round((parseFloat(profile.basic_plus_da) || 0) * attendanceFactor);
    da = Math.round((parseFloat(profile.da) || 0) * attendanceFactor);
    hra = Math.round((parseFloat(profile.hra) || 0) * attendanceFactor);
    conveyance = Math.round((parseFloat(profile.conveyance) || 0) * attendanceFactor);
    callAllowance = Math.round((parseFloat(profile.call_allowance) || 0) * attendanceFactor);
    bonus = bonusApplicable ? Math.round((parseFloat(profile.bonus) || 0) * attendanceFactor) : 0;
    incentive = incentiveApplicable ? Math.round((parseFloat(profile.incentive) || 0) * attendanceFactor) : 0;
  } else {
    const basicDaTotal = Math.round(gross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
    basic = basicDaTotal - Math.round(daAmount * attendanceFactor);
    da = Math.round(daAmount * attendanceFactor);
    hra = Math.round(gross * (PAYROLL_CONFIG.HRA_PERCENT / 100));
    conveyance = Math.round(gross * (PAYROLL_CONFIG.CONVEYANCE_PERCENT / 100));
    callAllowance = Math.round(gross * (PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT / 100));
    bonus = 0;
    incentive = 0;
  }

  const totalEarnings = basic + da + hra + conveyance + callAllowance + otherAllowances + incentive;
  const pfBreakdown = calculatePF(gross, pfApplicable, '15000');
  const pfEmployee = pfBreakdown.employeeContribution;
  const esicBreakdown = calculateESIC(gross, esicApplicable);
  const esicEmployee = esicBreakdown.employeeContribution;
  const pt = ptApplicable ? calculateProfessionalTax(fullGross) : 0;
  const mlwf = mlwfApplicable ? (parseFloat(profile.mlwf) || 0) : 0;
  const retention = retentionApplicable ? (parseFloat(profile.retention) || 0) : 0;
  const totalDeductions = pfEmployee + esicEmployee + pt + mlwf + retention;
  const netPay = totalEarnings - totalDeductions;
  const pfEmployer = pfBreakdown.employerTotal;
  const esicEmployer = esicBreakdown.employerContribution;
  const mlwfEmployer = mlwfApplicable ? (parseFloat(profile.mlwf_employer) || 0) : 0;
  const insurance = insuranceApplicable ? (parseFloat(profile.insurance) || 0) : 0;
  const fullBasic = parseFloat(profile.basic_plus_da) || Math.round(fullGross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
  const gratuity = Math.round(fullBasic * (PAYROLL_CONFIG.GRATUITY_PERCENT / 100));
  const pfAdmin = pfBreakdown.pfAdmin;
  const edli = Math.round(pfBreakdown.wageBase * (PAYROLL_CONFIG.EDLI_PERCENT / 100));
  const totalEmployerContributions = pfEmployer + esicEmployer + mlwfEmployer + bonus + insurance + gratuity + pfAdmin + edli;
  const employerCost = totalEarnings + totalEmployerContributions;

  return {
    month, employee_id: employeeId,
    gross, da_used: daAmount, da, basic, hra, conveyance,
    call_allowance: callAllowance, other_allowances: otherAllowances,
    bonus, incentive, total_earnings: totalEarnings,
    pf_employee: pfEmployee, esic_employee: esicEmployee, pt, mlwf, retention,
    lwf: 0, tds: 0, other_deductions: 0, total_deductions: totalDeductions,
    net_pay: netPay,
    pf_employer: pfEmployer, esic_employer: esicEmployer, mlwf_employer: mlwfEmployer,
    insurance, gratuity, pf_admin: pfAdmin, edli,
    total_employer_contributions: totalEmployerContributions,
    employer_cost: employerCost,
    attendance: {
      standard_working_days: attendance.standardWorkingDays,
      days_present: attendance.daysPresent,
      days_absent: attendance.daysAbsent,
      days_leave: attendance.daysLeave,
      weekly_off: attendance.weeklyOff,
      holidays: attendance.holidays,
      half_days: attendance.halfDays,
      payable_days: attendance.payableDays,
      lop_days: attendance.lopDays,
      overtime_hours: attendance.totalOvertimeHours,
      has_attendance_data: attendance.hasAttendanceData
    },
    full_month: { gross: fullGross, other_allowances: fullOtherAllowances },
    lop_deduction: lopDeduction,
    payment_status: 'pending', remarks: null
  };
}

/**
 * Generate payroll slips for all active employees for a given month.
 * OPTIMIZED: uses batch DB queries + multi-row inserts.
 * @param {string} month - Payroll month (YYYY-MM-01 format)
 * @param {string|null} salaryType - Optional salary type filter
 * @returns {Promise<object>} Summary of generation results
 */
export async function generateMonthlyPayroll(month, salaryType = null) {
  const db = await dbConnect();

  try {
    const validSalaryTypes = ['monthly', 'hourly', 'daily', 'contract', 'lumpsum', 'custom', 'payroll'];
    const filterBySalaryType = salaryType && validSalaryTypes.includes(salaryType);
    const isPayrollFilter = salaryType === 'payroll';
    const isContractFilter = salaryType === 'contract';

    // ── 1. Fetch employee list (same logic, single connection) ──
    let ssQuery = `SELECT DISTINCT ss.employee_id, CONCAT(e.first_name, ' ', e.last_name) as name
       FROM salary_structures ss
       JOIN employees e ON e.id = ss.employee_id
       LEFT JOIN employee_salary_profile esp ON esp.employee_id = e.id AND esp.is_active = 1
       WHERE (e.status = 'active' OR e.status IS NULL)
         AND ss.is_active = 1`;
    const ssParams = [];
    if (isPayrollFilter) ssQuery += ` AND (esp.salary_type IS NULL OR esp.salary_type != 'contract')`;
    else if (isContractFilter) ssQuery += ` AND esp.salary_type = 'contract'`;
    const [ssEmployees] = await db.execute(ssQuery, ssParams);

    let espQuery = `SELECT DISTINCT esp.employee_id, CONCAT(e.first_name, ' ', e.last_name) as name
       FROM employee_salary_profile esp
       JOIN employees e ON e.id = esp.employee_id
       WHERE (e.status = 'active' OR e.status IS NULL)
         AND esp.is_active = 1
         AND esp.employee_id NOT IN (SELECT employee_id FROM salary_structures WHERE is_active = 1)`;
    const espParams = [];
    if (isPayrollFilter) espQuery += ` AND (esp.salary_type IS NULL OR esp.salary_type != 'contract')`;
    else if (isContractFilter) espQuery += ` AND esp.salary_type = 'contract'`;
    else if (filterBySalaryType) {
      espQuery += ` AND (esp.salary_type = ? OR (esp.salary_type IS NULL AND ? = 'monthly'))`;
      espParams.push(salaryType, salaryType);
    }
    const [espEmployees] = await db.execute(espQuery, espParams);

    const employees = [...ssEmployees, ...espEmployees];
    if (employees.length === 0) {
      db.release();
      return { month, total: 0, success: 0, failed: 0, skipped: 0, errors: [] };
    }

    const employeeIds = employees.map(e => e.employee_id);
    const employeeNameMap = new Map(employees.map(e => [e.employee_id, e.name]));

    // ── 2. Check for existing slips (skip duplicates in bulk) ──
    const phExisting = employeeIds.map(() => '?').join(',');
    const [existingSlips] = await db.execute(
      `SELECT employee_id FROM payroll_slips WHERE month = ? AND employee_id IN (${phExisting})`,
      [month, ...employeeIds]
    );
    const existingSet = new Set(existingSlips.map(r => r.employee_id));
    const newIds = employeeIds.filter(id => !existingSet.has(id));

    const results = {
      month,
      total: employees.length,
      success: 0,
      failed: 0,
      skipped: existingSet.size,
      errors: []
    };

    if (newIds.length === 0) {
      db.release();
      return results;
    }

    // ── 3. Batch-fetch DA, salary profiles, attendance ──
    const [daRows] = await db.execute(
      `SELECT da_amount FROM da_schedule WHERE is_active = 1
       AND ? BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31') LIMIT 1`,
      [month]
    );
    const daAmount = daRows.length > 0 ? parseFloat(daRows[0].da_amount) : PAYROLL_CONFIG.DA_FIXED_AMOUNT;

    const profileMap = await batchGetSalaryProfiles(db, newIds);
    const attendanceMap = await batchGetAttendance(db, newIds, month);

    // ── 4. Ensure schema once ──
    await ensurePayrollColumns(db);

    // ── 5. Compute all payrolls in memory and batch-insert ──
    const BATCH_SIZE = 50;
    const toInsert = [];

    for (const empId of newIds) {
      const profile = profileMap.get(empId);
      if (!profile) {
        results.failed++;
        results.errors.push({
          employee_id: empId,
          name: employeeNameMap.get(empId),
          error: `No active salary profile found for employee ${empId}`
        });
        continue;
      }

      const defaultAtt = {
        standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
        daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
        daysAbsent: 0, daysLeave: 0, weeklyOff: 0, holidays: 0,
        halfDays: 0, totalOvertimeHours: 0, hasAttendanceData: false,
        payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26, lopDays: 0
      };
      const attendance = attendanceMap.get(empId) || defaultAtt;

      try {
        const payroll = computePayroll(empId, month, profile, daAmount, attendance);
        toInsert.push(payroll);
      } catch (err) {
        results.failed++;
        results.errors.push({ employee_id: empId, name: employeeNameMap.get(empId), error: err.message });
      }
    }

    // Multi-row INSERT in batches of BATCH_SIZE
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE);
      const singlePlaceholder = '(' + new Array(43).fill('?').join(',') + ')';
      const allPlaceholders = batch.map(() => singlePlaceholder).join(',');
      const allParams = batch.flatMap(payrollToParams);

      const batchSQL = `INSERT INTO payroll_slips (
        month, employee_id, gross, da_used, da, basic, hra, conveyance, call_allowance,
        other_allowances, bonus, incentive, total_earnings,
        pf_employee, esic_employee, pt, mlwf, retention, lwf, tds,
        other_deductions, total_deductions, net_pay,
        pf_employer, esic_employer, mlwf_employer, insurance,
        gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
        standard_working_days, days_present, days_absent, days_leave, payable_days, lop_days,
        lop_deduction, overtime_hours, full_month_gross,
        payment_status, remarks
      ) VALUES ${allPlaceholders}`;

      try {
        await db.query(batchSQL, allParams);
        results.success += batch.length;
      } catch (batchErr) {
        // Fallback: insert one-by-one so partial success is recorded
        for (const payroll of batch) {
          try {
            await db.execute(INSERT_SLIP_SQL, payrollToParams(payroll));
            results.success++;
          } catch (singleErr) {
            if (singleErr.code === 'ER_DUP_ENTRY') {
              results.skipped++;
            } else {
              results.failed++;
              results.errors.push({
                employee_id: payroll.employee_id,
                name: employeeNameMap.get(payroll.employee_id),
                error: singleErr.message
              });
            }
          }
        }
      }
    }

    db.release();
    return results;
  } catch (error) {
    db.release();
    throw error;
  }
}

/**
 * Generate payroll slips for a list of specific employee IDs.
 * OPTIMIZED: batch-fetches data and inserts in bulk.
 * @param {number[]} employeeIds - Array of employee IDs
 * @param {string} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Summary { success, failed, skipped, errors }
 */
export async function generatePayrollSlipsBatch(employeeIds, month) {
  if (!employeeIds || employeeIds.length === 0) {
    return { success: 0, failed: 0, skipped: 0, errors: [] };
  }

  const db = await dbConnect();
  try {
    // Check existing
    const ph = employeeIds.map(() => '?').join(',');
    const [existingSlips] = await db.execute(
      `SELECT employee_id FROM payroll_slips WHERE month = ? AND employee_id IN (${ph})`,
      [month, ...employeeIds]
    );
    const existingSet = new Set(existingSlips.map(r => r.employee_id));
    const newIds = employeeIds.filter(id => !existingSet.has(id));

    const results = { success: 0, failed: 0, skipped: existingSet.size, errors: [] };
    if (newIds.length === 0) { db.release(); return results; }

    // Batch-fetch
    const [daRows] = await db.execute(
      `SELECT da_amount FROM da_schedule WHERE is_active = 1
       AND ? BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31') LIMIT 1`,
      [month]
    );
    const daAmount = daRows.length > 0 ? parseFloat(daRows[0].da_amount) : PAYROLL_CONFIG.DA_FIXED_AMOUNT;

    const profileMap = await batchGetSalaryProfiles(db, newIds);
    const attendanceMap = await batchGetAttendance(db, newIds, month);
    await ensurePayrollColumns(db);

    for (const empId of newIds) {
      const profile = profileMap.get(empId);
      if (!profile) {
        results.failed++;
        results.errors.push({ employee_id: empId, error: `No active salary profile found for employee ${empId}` });
        continue;
      }
      const defaultAtt = {
        standardWorkingDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
        daysPresent: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26,
        daysAbsent: 0, daysLeave: 0, weeklyOff: 0, holidays: 0,
        halfDays: 0, totalOvertimeHours: 0, hasAttendanceData: false,
        payableDays: PAYROLL_CONFIG.STANDARD_WORKING_DAYS || 26, lopDays: 0
      };
      const attendance = attendanceMap.get(empId) || defaultAtt;
      try {
        const payroll = computePayroll(empId, month, profile, daAmount, attendance);
        await db.execute(INSERT_SLIP_SQL, payrollToParams(payroll));
        results.success++;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') results.skipped++;
        else { results.failed++; results.errors.push({ employee_id: empId, error: err.message }); }
      }
    }

    db.release();
    return results;
  } catch (error) {
    db.release();
    throw error;
  }
}

const payrollCalculator = {
  getCurrentDA,
  getEmployeeAttendance,
  getEmployeeSalaryProfile,
  calculateEmployeePayroll,
  generatePayrollSlip,
  generatePayrollSlipsBatch,
  generateMonthlyPayroll
};

export default payrollCalculator;
