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
 * Get employee's current salary profile
 * @param {number} employeeId - Employee ID
 * @param {Date} forDate - Date to check (defaults to today)
 * @returns {Promise<object|null>} Salary profile or null
 */
export async function getEmployeeSalaryProfile(employeeId, forDate = new Date()) {
  const db = await dbConnect();
  
  try {
    const [rows] = await db.execute(
      `SELECT * 
       FROM employee_salary_profile 
       WHERE employee_id = ? 
         AND is_active = 1 
         AND ? >= effective_from 
         AND (effective_to IS NULL OR ? <= effective_to)
       LIMIT 1`,
      [employeeId, forDate, forDate]
    );
    
    await db.end();
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    await db.end();
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
    throw new Error(`No active salary profile found for employee ${employeeId}`);
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

/**
 * Generate and save payroll slip for an employee
 * Links salary structure with attendance for monthly calculations
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Generated payroll slip
 */
export async function generatePayrollSlip(employeeId, month) {
  const payroll = await calculateEmployeePayroll(employeeId, month);
  
  const db = await dbConnect();
  
  try {
    // Ensure payroll_slips table has all required columns
    const columnsToAdd = [
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
    
    for (const col of columnsToAdd) {
      try {
        await db.query(`ALTER TABLE payroll_slips ADD COLUMN ${col.name} ${col.definition}`);
      } catch (alterErr) {
        // Ignore if column already exists
      }
    }
    
    // Insert payroll slip with attendance data
    const [result] = await db.execute(
      `INSERT INTO payroll_slips (
        month, employee_id, gross, da_used, da, basic, hra, conveyance, call_allowance,
        other_allowances, bonus, incentive, total_earnings, 
        pf_employee, esic_employee, pt, mlwf, retention, lwf, tds,
        other_deductions, total_deductions, net_pay, 
        pf_employer, esic_employer, mlwf_employer, insurance,
        gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
        standard_working_days, days_present, days_absent, days_leave, payable_days, lop_days,
        lop_deduction, overtime_hours, full_month_gross,
        payment_status, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payroll.month, payroll.employee_id, payroll.gross, payroll.da_used, payroll.da,
        payroll.basic, payroll.hra, payroll.conveyance, payroll.call_allowance,
        payroll.other_allowances, payroll.bonus, payroll.incentive, payroll.total_earnings,
        payroll.pf_employee, payroll.esic_employee, payroll.pt, payroll.mlwf, payroll.retention,
        payroll.lwf, payroll.tds, payroll.other_deductions, payroll.total_deductions, payroll.net_pay,
        payroll.pf_employer, payroll.esic_employer, payroll.mlwf_employer, payroll.insurance,
        payroll.gratuity, payroll.pf_admin, payroll.edli, payroll.total_employer_contributions,
        payroll.employer_cost,
        payroll.attendance.standard_working_days, payroll.attendance.days_present,
        payroll.attendance.days_absent, payroll.attendance.days_leave, payroll.attendance.payable_days,
        payroll.attendance.lop_days, payroll.lop_deduction, payroll.attendance.overtime_hours,
        payroll.full_month.gross,
        payroll.payment_status, payroll.remarks
      ]
    );
    
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

/**
 * Generate payroll slips for all active employees for a given month
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Summary of generation results
 */
export async function generateMonthlyPayroll(month) {
  const db = await dbConnect();
  
  try {
    // Get all employees with active salary profiles
    const [employees] = await db.execute(
      `SELECT DISTINCT esp.employee_id, e.name 
       FROM employee_salary_profile esp
       JOIN employees e ON e.id = esp.employee_id
       WHERE esp.is_active = 1 
         AND ? >= esp.effective_from 
         AND (esp.effective_to IS NULL OR ? <= esp.effective_to)`,
      [month, month]
    );
    
    await db.end();
    
    const results = {
      month,
      total: employees.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    
    for (const emp of employees) {
      try {
        await generatePayrollSlip(emp.employee_id, month);
        results.success++;
      } catch (error) {
        if (error.message.includes('already exists')) {
          results.skipped++;
        } else {
          results.failed++;
          results.errors.push({
            employee_id: emp.employee_id,
            name: emp.name,
            error: error.message
          });
        }
      }
    }
    
    return results;
  } catch (error) {
    await db.end();
    throw error;
  }
}

const payrollCalculator = {
  getCurrentDA,
  getEmployeeAttendance,
  getEmployeeSalaryProfile,
  calculateEmployeePayroll,
  generatePayrollSlip,
  generateMonthlyPayroll
};

export default payrollCalculator;
