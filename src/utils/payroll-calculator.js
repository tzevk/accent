/**
 * Payroll Calculator Utility
 * ---------------------------
 * Uses frozen PAYROLL_CONFIG to calculate all salary components
 * Integrates with core payroll tables:
 *  - da_schedule
 *  - employee_salary_profile
 *  - payroll_slips
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
  
  const gross = parseFloat(profile.gross);
  const otherAllowances = parseFloat(profile.other_allowances) || 0;
  const pfApplicable = profile.pf_applicable === 1;
  const esicApplicable = profile.esic_applicable === 1;
  
  // ═══════════════════════════════════════════════════════════════════
  // EARNINGS (Using frozen PAYROLL_CONFIG percentages)
  // ═══════════════════════════════════════════════════════════════════
  
  // Basic + DA = 60% of Gross
  const basic = Math.round(gross * (PAYROLL_CONFIG.BASIC_DA_PERCENT / 100));
  
  // HRA = 20% of Gross
  const hra = Math.round(gross * (PAYROLL_CONFIG.HRA_PERCENT / 100));
  
  // Conveyance = 10% of Gross
  const conveyance = Math.round(gross * (PAYROLL_CONFIG.CONVEYANCE_PERCENT / 100));
  
  // Call Allowance = 10% of Gross
  const callAllowance = Math.round(gross * (PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT / 100));
  
  const totalEarnings = gross + otherAllowances;
  
  // ═══════════════════════════════════════════════════════════════════
  // EMPLOYEE DEDUCTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  // PF: 12% of Gross (capped at wage ceiling)
  const pfBreakdown = calculatePF(gross, pfApplicable, '15000');
  const pfEmployee = pfBreakdown.employeeContribution;
  
  // ESIC: 0.75% of Gross (only if eligible)
  const esicBreakdown = calculateESIC(gross, esicApplicable);
  const esicEmployee = esicBreakdown.employeeContribution;
  
  // Professional Tax (Maharashtra slab)
  const pt = calculateProfessionalTax(gross);
  
  // LWF, TDS, Other deductions
  const lwf = 0; // Usually ₹25 twice a year
  const tds = 0; // Calculated separately based on tax regime
  const otherDeductions = 0;
  
  const totalDeductions = pfEmployee + esicEmployee + pt + lwf + tds + otherDeductions;
  
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
  
  // Gratuity: 4.81% of Basic
  const gratuity = Math.round(basic * (PAYROLL_CONFIG.GRATUITY_PERCENT / 100));
  
  // PF Admin: 0.5% of wage base
  const pfAdmin = pfBreakdown.pfAdmin;
  
  // EDLI: 0.5% of wage base
  const edli = Math.round(pfBreakdown.wageBase * (PAYROLL_CONFIG.EDLI_PERCENT / 100));
  
  const totalEmployerContributions = pfEmployer + esicEmployer + gratuity + pfAdmin + edli;
  
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
    total_earnings: totalEarnings,
    
    // Employee Deductions
    pf_employee: pfEmployee,
    esic_employee: esicEmployee,
    pt,
    lwf,
    tds,
    other_deductions: otherDeductions,
    total_deductions: totalDeductions,
    
    // Net Pay
    net_pay: netPay,
    
    // Employer Contributions
    pf_employer: pfEmployer,
    esic_employer: esicEmployer,
    gratuity,
    pf_admin: pfAdmin,
    edli,
    total_employer_contributions: totalEmployerContributions,
    
    // Total Cost
    employer_cost: employerCost,
    
    // Metadata
    payment_status: 'pending',
    remarks: null
  };
}

/**
 * Generate and save payroll slip for an employee
 * @param {number} employeeId - Employee ID
 * @param {Date} month - Payroll month (YYYY-MM-01 format)
 * @returns {Promise<object>} Generated payroll slip
 */
export async function generatePayrollSlip(employeeId, month) {
  const payroll = await calculateEmployeePayroll(employeeId, month);
  
  const db = await dbConnect();
  
  try {
    // Insert payroll slip (will fail if duplicate due to UNIQUE constraint)
    const [result] = await db.execute(
      `INSERT INTO payroll_slips (
        month, employee_id, gross, da_used, basic, hra, conveyance, call_allowance,
        other_allowances, total_earnings, pf_employee, esic_employee, pt, lwf, tds,
        other_deductions, total_deductions, net_pay, pf_employer, esic_employer,
        gratuity, pf_admin, edli, total_employer_contributions, employer_cost,
        payment_status, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payroll.month, payroll.employee_id, payroll.gross, payroll.da_used,
        payroll.basic, payroll.hra, payroll.conveyance, payroll.call_allowance,
        payroll.other_allowances, payroll.total_earnings, payroll.pf_employee,
        payroll.esic_employee, payroll.pt, payroll.lwf, payroll.tds,
        payroll.other_deductions, payroll.total_deductions, payroll.net_pay,
        payroll.pf_employer, payroll.esic_employer, payroll.gratuity,
        payroll.pf_admin, payroll.edli, payroll.total_employer_contributions,
        payroll.employer_cost, payroll.payment_status, payroll.remarks
      ]
    );
    
    await db.end();
    
    return {
      ...payroll,
      id: result.insertId,
      created_at: new Date()
    };
  } catch (error) {
    await db.end();
    
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
  getEmployeeSalaryProfile,
  calculateEmployeePayroll,
  generatePayrollSlip,
  generateMonthlyPayroll
};

export default payrollCalculator;
