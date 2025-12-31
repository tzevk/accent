/**
 * Centralized Payroll Configuration
 * All salary structure rules and calculation constants in one place
 * 
 * Last Updated: December 31, 2025
 */

export const PAYROLL_CONFIG = {
  // ═══════════════════════════════════════════════════════════════════
  // SALARY STRUCTURE - Percentages of Gross Salary
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Basic + DA (Dearness Allowance) = 60% of Gross
   * This is the foundation for PF and other calculations
   */
  BASIC_DA_PERCENT: 60,
  
  /**
   * HRA (House Rent Allowance) = 20% of Gross
   */
  HRA_PERCENT: 20,
  
  /**
   * Conveyance Allowance = 10% of Gross
   */
  CONVEYANCE_PERCENT: 10,
  
  /**
   * Call Allowance = 10% of Gross
   */
  CALL_ALLOWANCE_PERCENT: 10,
  
  // ═══════════════════════════════════════════════════════════════════
  // PROVIDENT FUND (PF) - Based on Basic+DA or Gross
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Employee PF Contribution = 12% of Gross (or Basic+DA)
   */
  EMPLOYEE_PF_PERCENT: 12,
  
  /**
   * Employer PF Contribution = 13% of Gross (or Basic+DA)
   * Breakdown: 3.67% to EPF + 8.33% to EPS + Admin charges
   */
  EMPLOYER_PF_PERCENT: 13,
  
  /**
   * EPF (Employee Provident Fund) = 3.67% of wage base
   */
  EMPLOYER_EPF_PERCENT: 3.67,
  
  /**
   * EPS (Employee Pension Scheme) = 8.33% of wage base (max ₹15,000)
   */
  EMPLOYER_EPS_PERCENT: 8.33,
  
  /**
   * PF Admin Charges = 0.5% of wage base
   */
  PF_ADMIN_PERCENT: 0.5,
  
  /**
   * PF Wage Ceiling - Maximum salary base for PF calculation
   */
  PF_WAGE_CEILING: 15000,
  
  // ═══════════════════════════════════════════════════════════════════
  // ESIC (Employee State Insurance Corporation)
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Employee ESIC Contribution = 0.75% of Gross
   */
  EMPLOYEE_ESIC_PERCENT: 0.75,
  
  /**
   * Employer ESIC Contribution = 3.25% of Gross
   */
  EMPLOYER_ESIC_PERCENT: 3.25,
  
  /**
   * ESIC Eligibility Threshold - Gross salary must be ≤ ₹21,000
   */
  ESIC_SALARY_CEILING: 21000,
  
  // ═══════════════════════════════════════════════════════════════════
  // OTHER STATUTORY CONTRIBUTIONS
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * EDLI (Employee Deposit Linked Insurance) = 0.5% of wage base
   */
  EDLI_PERCENT: 0.5,
  
  /**
   * EDLI Admin = 0.01% of wage base
   */
  EDLI_ADMIN_PERCENT: 0.01,
  
  /**
   * Gratuity Provision = 4.81% of Basic (for 5+ years service)
   */
  GRATUITY_PERCENT: 4.81,
  
  /**
   * Professional Tax (Maharashtra slab rates)
   */
  PROFESSIONAL_TAX: {
    ABOVE_10000: 200,
    ABOVE_7500: 175,
    ABOVE_5000: 150,
    DEFAULT: 0
  },
  
  /**
   * Labour Welfare Fund (LWF) - Maharashtra
   * Usually ₹25 twice a year (June & December)
   */
  LWF_HALF_YEARLY: 25,
  
  // ═══════════════════════════════════════════════════════════════════
  // WORKING STANDARDS
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * Standard working days per month
   */
  STANDARD_WORKING_DAYS: 26,
  
  /**
   * Standard working hours per day
   */
  STANDARD_HOURS_PER_DAY: 8,
  
  /**
   * Overtime multiplier
   */
  OT_MULTIPLIER: 1.5,
  
  // ═══════════════════════════════════════════════════════════════════
  // FIXED ALLOWANCES (Optional - can be overridden)
  // ═══════════════════════════════════════════════════════════════════
  
  /**
   * DA (Dearness Allowance) - Fixed amount option
   * Set to 0 or null to calculate as part of Basic+DA percentage
   */
  DA_FIXED_AMOUNT: 0,
  
  /**
   * Conveyance - Fixed amount option (overrides percentage if set)
   * Set to 0 or null to use percentage calculation
   */
  CONVEYANCE_FIXED_AMOUNT: 0,
  
  /**
   * Medical Allowance - Fixed amount (optional)
   */
  MEDICAL_FIXED_AMOUNT: 0,
};

/**
 * Calculate all salary components from Gross Salary
 * @param {number} grossSalary - Gross salary amount
 * @param {object} overrides - Optional overrides for specific config values
 * @returns {object} Detailed salary breakdown
 */
export function calculateSalaryFromGross(grossSalary, overrides = {}) {
  const config = { ...PAYROLL_CONFIG, ...overrides };
  const gross = parseFloat(grossSalary) || 0;
  
  if (gross === 0) return null;
  
  // Calculate components
  const basicDA = Math.round(gross * (config.BASIC_DA_PERCENT / 100));
  const hra = Math.round(gross * (config.HRA_PERCENT / 100));
  const conveyance = config.CONVEYANCE_FIXED_AMOUNT || Math.round(gross * (config.CONVEYANCE_PERCENT / 100));
  const callAllowance = Math.round(gross * (config.CALL_ALLOWANCE_PERCENT / 100));
  
  return {
    gross,
    basicDA,
    hra,
    conveyance,
    callAllowance,
    // Other allowances are optional
    otherAllowances: 0
  };
}

/**
 * Calculate PF contributions
 * @param {number} basicSalary - Basic salary (or Basic+DA)
 * @param {boolean} pfApplicable - Whether PF is applicable
 * @param {string} ceiling - 'actual' or '15000'
 * @returns {object} PF breakdown
 */
export function calculatePF(basicSalary, pfApplicable = true, ceiling = '15000') {
  if (!pfApplicable) {
    return {
      wageBase: 0,
      employeeContribution: 0,
      employerEPF: 0,
      employerEPS: 0,
      employerTotal: 0,
      pfAdmin: 0
    };
  }
  
  const basic = parseFloat(basicSalary) || 0;
  const wageBase = ceiling === 'actual' ? basic : Math.min(basic, PAYROLL_CONFIG.PF_WAGE_CEILING);
  
  const employeeContribution = Math.round(wageBase * (PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT / 100));
  const employerEPF = Math.round(wageBase * (PAYROLL_CONFIG.EMPLOYER_EPF_PERCENT / 100));
  const epsBase = Math.min(basic, PAYROLL_CONFIG.PF_WAGE_CEILING);
  const employerEPS = Math.round(epsBase * (PAYROLL_CONFIG.EMPLOYER_EPS_PERCENT / 100));
  const pfAdmin = Math.round(wageBase * (PAYROLL_CONFIG.PF_ADMIN_PERCENT / 100));
  
  return {
    wageBase,
    employeeContribution,
    employerEPF,
    employerEPS,
    employerTotal: employerEPF + employerEPS,
    pfAdmin
  };
}

/**
 * Calculate ESIC contributions
 * @param {number} grossSalary - Gross salary amount
 * @param {boolean} esicApplicable - Whether ESIC is applicable
 * @returns {object} ESIC breakdown
 */
export function calculateESIC(grossSalary, esicApplicable = false) {
  const gross = parseFloat(grossSalary) || 0;
  const eligible = esicApplicable && gross <= PAYROLL_CONFIG.ESIC_SALARY_CEILING;
  
  if (!eligible) {
    return {
      eligible: false,
      employeeContribution: 0,
      employerContribution: 0
    };
  }
  
  return {
    eligible: true,
    employeeContribution: Math.round(gross * (PAYROLL_CONFIG.EMPLOYEE_ESIC_PERCENT / 100)),
    employerContribution: Math.round(gross * (PAYROLL_CONFIG.EMPLOYER_ESIC_PERCENT / 100))
  };
}

/**
 * Calculate Professional Tax (Maharashtra slab)
 * @param {number} grossSalary - Gross salary amount
 * @returns {number} Professional tax amount
 */
export function calculateProfessionalTax(grossSalary) {
  const gross = parseFloat(grossSalary) || 0;
  const pt = PAYROLL_CONFIG.PROFESSIONAL_TAX;
  
  if (gross > 10000) return pt.ABOVE_10000;
  if (gross > 7500) return pt.ABOVE_7500;
  if (gross > 5000) return pt.ABOVE_5000;
  return pt.DEFAULT;
}

/**
 * Get display-friendly config summary
 * @returns {object} Human-readable config summary
 */
export function getPayrollConfigSummary() {
  return {
    salaryStructure: {
      'Basic + DA': `${PAYROLL_CONFIG.BASIC_DA_PERCENT}% of Gross`,
      'HRA': `${PAYROLL_CONFIG.HRA_PERCENT}% of Gross`,
      'Conveyance': `${PAYROLL_CONFIG.CONVEYANCE_PERCENT}% of Gross`,
      'Call Allowance': `${PAYROLL_CONFIG.CALL_ALLOWANCE_PERCENT}% of Gross`,
      'Other Allowances': 'Optional (extra)'
    },
    providentFund: {
      'Employee PF': `${PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT}% of Gross`,
      'Employer PF': `${PAYROLL_CONFIG.EMPLOYER_PF_PERCENT}% of Gross`,
      'Wage Ceiling': `₹${PAYROLL_CONFIG.PF_WAGE_CEILING}`
    },
    esic: {
      'Employee ESIC': `${PAYROLL_CONFIG.EMPLOYEE_ESIC_PERCENT}% of Gross`,
      'Employer ESIC': `${PAYROLL_CONFIG.EMPLOYER_ESIC_PERCENT}% of Gross`,
      'Eligibility': `Gross ≤ ₹${PAYROLL_CONFIG.ESIC_SALARY_CEILING}`
    }
  };
}

export default PAYROLL_CONFIG;
