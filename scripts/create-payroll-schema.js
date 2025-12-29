/**
 * Indian Payroll System - Database Schema Migration
 * 
 * Run with: node scripts/create-payroll-schema.js
 * 
 * NESTED STRUCTURE:
 * ══════════════════════════════════════════════════════════════════════════════
 * 
 * employees (existing)
 * │
 * ├─► salary_structures (1:N - versioned)
 * │   └─► salary_structure_components (1:N)
 * │
 * ├─► daily_work_hours (1:N - for hourly/daily employees)
 * │
 * ├─► attendance_monthly (1:N - one per month)
 * │
 * └─► employee_loans (1:N)
 *     └─► loan_repayment_schedule (1:N)
 * 
 * payroll_runs (company-level monthly batch)
 * │
 * ├─► employee_payroll (1:N - one per employee per run)
 * │   ├─► employee_payroll_components (1:N)
 * │   ├─► salary_slips (1:1)
 * │   └─► salary_manual_overrides (1:N)
 * │
 * └─► statutory_payments (1:N - PF/ESI/PT/MLWF/TDS)
 * 
 * payroll_audit_logs (standalone - references all entities)
 * 
 * ══════════════════════════════════════════════════════════════════════════════
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: '.env.local' });

async function createPayrollSchema() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      multipleStatements: true
    });

    console.log('Connected to database:', process.env.DB_NAME);
    console.log('Creating Indian Payroll schema (nested structure)...\n');

    // ╔════════════════════════════════════════════════════════════════════════╗
    // ║ LEVEL 1: EMPLOYEE-NESTED TABLES                                        ║
    // ╚════════════════════════════════════════════════════════════════════════╝

    // ──────────────────────────────────────────────────────────────────────────
    // 1.1 employees → salary_structures
    // ──────────────────────────────────────────────────────────────────────────
    console.log('1.1 Creating salary_structures...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS salary_structures (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        
        -- Version Control
        version INT NOT NULL DEFAULT 1,
        effective_from DATE NOT NULL,
        effective_to DATE DEFAULT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        
        -- Pay Type
        pay_type ENUM('monthly', 'hourly', 'daily') NOT NULL DEFAULT 'monthly',
        
        -- For Monthly Employees
        ctc DECIMAL(12,2) DEFAULT 0,
        gross_salary DECIMAL(12,2) DEFAULT 0,
        basic_salary DECIMAL(12,2) DEFAULT 0,
        
        -- For Hourly/Daily Employees
        hourly_rate DECIMAL(10,2) DEFAULT NULL,
        daily_rate DECIMAL(10,2) DEFAULT NULL,
        ot_multiplier DECIMAL(3,1) DEFAULT 1.5,
        
        -- Statutory Flags
        pf_applicable TINYINT(1) DEFAULT 1,
        esic_applicable TINYINT(1) DEFAULT 0,
        pt_applicable TINYINT(1) DEFAULT 1,
        mlwf_applicable TINYINT(1) DEFAULT 1,
        tds_applicable TINYINT(1) DEFAULT 1,
        
        -- PF Configuration
        pf_wage_ceiling ENUM('15000', 'actual') DEFAULT '15000',
        
        -- Working Hours Config
        standard_working_days INT DEFAULT 26,
        standard_hours_per_day DECIMAL(4,2) DEFAULT 8.00,
        
        -- Metadata
        remarks TEXT,
        created_by INT DEFAULT NULL,
        approved_by INT DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        INDEX idx_employee_active (employee_id, is_active),
        INDEX idx_effective (effective_from, effective_to),
        INDEX idx_pay_type (pay_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ salary_structures');

    // ──────────────────────────────────────────────────────────────────────────
    // 1.2 salary_structures → salary_structure_components
    // ──────────────────────────────────────────────────────────────────────────
    console.log('1.2 Creating salary_structure_components...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS salary_structure_components (
        id INT PRIMARY KEY AUTO_INCREMENT,
        salary_structure_id INT NOT NULL,
        
        -- Component
        component_name VARCHAR(100) NOT NULL,
        component_code VARCHAR(20) NOT NULL,
        component_type ENUM('earning', 'deduction', 'employer_contribution') NOT NULL,
        
        -- Calculation
        calculation_type ENUM('fixed', 'percentage') NOT NULL DEFAULT 'fixed',
        fixed_amount DECIMAL(12,2) DEFAULT 0,
        percentage_value DECIMAL(5,2) DEFAULT NULL,
        percentage_of ENUM('basic', 'gross', 'ctc') DEFAULT NULL,
        
        -- Limits
        max_amount DECIMAL(12,2) DEFAULT NULL,
        
        -- Tax
        is_taxable TINYINT(1) DEFAULT 1,
        
        -- Statutory
        is_statutory TINYINT(1) DEFAULT 0,
        statutory_type ENUM('pf', 'esic', 'pt', 'mlwf', 'tds') DEFAULT NULL,
        
        -- Display
        display_order INT DEFAULT 0,
        show_in_slip TINYINT(1) DEFAULT 1,
        is_active TINYINT(1) DEFAULT 1,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE CASCADE,
        INDEX idx_structure_type (salary_structure_id, component_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ salary_structure_components');

    // ──────────────────────────────────────────────────────────────────────────
    // 2.1 employees → daily_work_hours (for hourly/daily employees)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('2.1 Creating daily_work_hours...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS daily_work_hours (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        
        -- Date
        work_date DATE NOT NULL,
        
        -- Time Tracking
        check_in TIME DEFAULT NULL,
        check_out TIME DEFAULT NULL,
        break_minutes INT DEFAULT 0,
        
        -- Hours
        regular_hours DECIMAL(5,2) NOT NULL DEFAULT 0,
        overtime_hours DECIMAL(5,2) DEFAULT 0,
        total_hours DECIMAL(5,2) GENERATED ALWAYS AS (regular_hours + overtime_hours) STORED,
        
        -- Rate Snapshot
        hourly_rate DECIMAL(10,2) DEFAULT NULL,
        ot_rate DECIMAL(10,2) DEFAULT NULL,
        
        -- Day Type
        day_type ENUM('working', 'weekly_off', 'holiday') DEFAULT 'working',
        
        -- Status
        status ENUM('draft', 'submitted', 'approved', 'rejected') DEFAULT 'draft',
        approved_by INT DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        
        -- Aggregation
        is_aggregated TINYINT(1) DEFAULT 0,
        attendance_monthly_id INT DEFAULT NULL,
        
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        
        UNIQUE KEY uk_employee_date (employee_id, work_date),
        INDEX idx_date (work_date),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ daily_work_hours');

    // ──────────────────────────────────────────────────────────────────────────
    // 3.1 employees → attendance_monthly
    // ──────────────────────────────────────────────────────────────────────────
    console.log('3.1 Creating attendance_monthly...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS attendance_monthly (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        
        -- Period
        month INT NOT NULL,
        year INT NOT NULL,
        
        -- Days
        total_days INT NOT NULL DEFAULT 30,
        working_days INT NOT NULL DEFAULT 26,
        present_days DECIMAL(4,1) NOT NULL DEFAULT 0,
        paid_leaves DECIMAL(4,1) DEFAULT 0,
        unpaid_leaves DECIMAL(4,1) DEFAULT 0,
        holidays INT DEFAULT 0,
        weekly_offs INT DEFAULT 4,
        
        -- Hours (aggregated from daily_work_hours)
        total_regular_hours DECIMAL(6,2) DEFAULT 0,
        total_overtime_hours DECIMAL(6,2) DEFAULT 0,
        total_hours DECIMAL(6,2) GENERATED ALWAYS AS (total_regular_hours + total_overtime_hours) STORED,
        
        -- Calculated
        lop_days DECIMAL(4,1) GENERATED ALWAYS AS (
          GREATEST(0, working_days - present_days - paid_leaves)
        ) STORED,
        payable_days DECIMAL(4,1) GENERATED ALWAYS AS (
          present_days + paid_leaves
        ) STORED,
        
        -- Lock
        is_locked TINYINT(1) DEFAULT 0,
        locked_at DATETIME DEFAULT NULL,
        locked_by INT DEFAULT NULL,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        UNIQUE KEY uk_employee_month_year (employee_id, month, year),
        INDEX idx_period (year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ attendance_monthly');

    // ──────────────────────────────────────────────────────────────────────────
    // 4.1 employees → employee_loans
    // ──────────────────────────────────────────────────────────────────────────
    console.log('4.1 Creating employee_loans...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_loans (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id INT NOT NULL,
        
        -- Type
        loan_type ENUM('salary_advance', 'personal_loan', 'emergency_loan') NOT NULL,
        
        -- Amount
        principal_amount DECIMAL(12,2) NOT NULL,
        interest_rate DECIMAL(5,2) DEFAULT 0,
        total_payable DECIMAL(12,2) NOT NULL,
        
        -- EMI
        emi_amount DECIMAL(12,2) NOT NULL,
        total_installments INT NOT NULL,
        installments_paid INT DEFAULT 0,
        
        -- Balance
        amount_recovered DECIMAL(12,2) DEFAULT 0,
        amount_pending DECIMAL(12,2) GENERATED ALWAYS AS (total_payable - amount_recovered) STORED,
        
        -- Dates
        disbursement_date DATE NOT NULL,
        start_month DATE NOT NULL,
        
        -- Status
        status ENUM('active', 'completed', 'waived') DEFAULT 'active',
        
        -- Approval
        approved_by INT DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        
        purpose TEXT,
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        INDEX idx_employee_status (employee_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ employee_loans');

    // ──────────────────────────────────────────────────────────────────────────
    // 4.2 employee_loans → loan_repayment_schedule
    // ──────────────────────────────────────────────────────────────────────────
    console.log('4.2 Creating loan_repayment_schedule...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS loan_repayment_schedule (
        id INT PRIMARY KEY AUTO_INCREMENT,
        loan_id INT NOT NULL,
        employee_id INT NOT NULL,
        
        -- Installment
        installment_number INT NOT NULL,
        due_month INT NOT NULL,
        due_year INT NOT NULL,
        
        -- Amount
        emi_amount DECIMAL(12,2) NOT NULL,
        principal_amount DECIMAL(12,2) NOT NULL,
        interest_amount DECIMAL(12,2) DEFAULT 0,
        
        -- Status
        status ENUM('pending', 'paid', 'partial', 'waived') DEFAULT 'pending',
        paid_amount DECIMAL(12,2) DEFAULT 0,
        paid_date DATE DEFAULT NULL,
        
        -- Payroll Link (filled when deducted via payroll)
        payroll_id INT DEFAULT NULL,
        
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (loan_id) REFERENCES employee_loans(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        
        UNIQUE KEY uk_loan_installment (loan_id, installment_number),
        INDEX idx_employee_due (employee_id, due_year, due_month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ loan_repayment_schedule');

    // ╔════════════════════════════════════════════════════════════════════════╗
    // ║ LEVEL 2: PAYROLL RUN HIERARCHY                                         ║
    // ╚════════════════════════════════════════════════════════════════════════╝

    // ──────────────────────────────────────────────────────────────────────────
    // 5.1 payroll_runs (company-level monthly batch)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('5.1 Creating payroll_runs...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payroll_runs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        
        -- Period
        month INT NOT NULL,
        year INT NOT NULL,
        run_number INT NOT NULL DEFAULT 1,
        
        -- Status: draft → processing → finalized → paid
        status ENUM('draft', 'processing', 'finalized', 'paid', 'cancelled') NOT NULL DEFAULT 'draft',
        
        -- Summary
        total_employees INT DEFAULT 0,
        total_gross DECIMAL(15,2) DEFAULT 0,
        total_deductions DECIMAL(15,2) DEFAULT 0,
        total_net_pay DECIMAL(15,2) DEFAULT 0,
        total_employer_contribution DECIMAL(15,2) DEFAULT 0,
        
        -- Processing
        processed_by INT DEFAULT NULL,
        processed_at DATETIME DEFAULT NULL,
        
        -- Finalization
        finalized_by INT DEFAULT NULL,
        finalized_at DATETIME DEFAULT NULL,
        
        -- Payment
        payment_date DATE DEFAULT NULL,
        paid_by INT DEFAULT NULL,
        paid_at DATETIME DEFAULT NULL,
        
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        UNIQUE KEY uk_month_year_run (month, year, run_number),
        INDEX idx_status (status),
        INDEX idx_period (year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ payroll_runs');

    // ──────────────────────────────────────────────────────────────────────────
    // 5.2 payroll_runs → employee_payroll
    // ──────────────────────────────────────────────────────────────────────────
    console.log('5.2 Creating employee_payroll...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_payroll (
        id INT PRIMARY KEY AUTO_INCREMENT,
        payroll_run_id INT NOT NULL,
        employee_id INT NOT NULL,
        salary_structure_id INT NOT NULL,
        attendance_id INT DEFAULT NULL,
        
        -- Period
        month INT NOT NULL,
        year INT NOT NULL,
        
        -- Pay Type
        pay_type ENUM('monthly', 'hourly', 'daily') NOT NULL DEFAULT 'monthly',
        
        -- Attendance Snapshot
        working_days INT NOT NULL,
        present_days DECIMAL(4,1) NOT NULL,
        payable_days DECIMAL(4,1) NOT NULL,
        lop_days DECIMAL(4,1) DEFAULT 0,
        
        -- Hours (for hourly employees)
        regular_hours DECIMAL(6,2) DEFAULT 0,
        overtime_hours DECIMAL(6,2) DEFAULT 0,
        hourly_rate DECIMAL(10,2) DEFAULT NULL,
        ot_rate DECIMAL(10,2) DEFAULT NULL,
        
        -- Earnings
        basic_earned DECIMAL(12,2) DEFAULT 0,
        hra_earned DECIMAL(12,2) DEFAULT 0,
        other_allowances DECIMAL(12,2) DEFAULT 0,
        overtime_pay DECIMAL(12,2) DEFAULT 0,
        arrears DECIMAL(12,2) DEFAULT 0,
        total_earnings DECIMAL(12,2) DEFAULT 0,
        
        -- Deductions
        pf_employee DECIMAL(12,2) DEFAULT 0,
        esic_employee DECIMAL(12,2) DEFAULT 0,
        professional_tax DECIMAL(12,2) DEFAULT 0,
        mlwf_employee DECIMAL(12,2) DEFAULT 0,
        tds DECIMAL(12,2) DEFAULT 0,
        lop_deduction DECIMAL(12,2) DEFAULT 0,
        loan_recovery DECIMAL(12,2) DEFAULT 0,
        other_deductions DECIMAL(12,2) DEFAULT 0,
        total_deductions DECIMAL(12,2) DEFAULT 0,
        
        -- Employer Contributions
        pf_employer DECIMAL(12,2) DEFAULT 0,
        esic_employer DECIMAL(12,2) DEFAULT 0,
        mlwf_employer DECIMAL(12,2) DEFAULT 0,
        total_employer_contribution DECIMAL(12,2) DEFAULT 0,
        
        -- Net
        gross_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
        net_pay DECIMAL(12,2) NOT NULL DEFAULT 0,
        
        -- Payment
        payment_status ENUM('pending', 'processed', 'paid', 'hold') DEFAULT 'pending',
        payment_reference VARCHAR(100) DEFAULT NULL,
        payment_date DATE DEFAULT NULL,
        
        -- Bank Snapshot
        bank_name VARCHAR(100) DEFAULT NULL,
        bank_account_no VARCHAR(50) DEFAULT NULL,
        bank_ifsc VARCHAR(20) DEFAULT NULL,
        
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE RESTRICT,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        FOREIGN KEY (salary_structure_id) REFERENCES salary_structures(id) ON DELETE RESTRICT,
        FOREIGN KEY (attendance_id) REFERENCES attendance_monthly(id) ON DELETE SET NULL,
        
        UNIQUE KEY uk_run_employee (payroll_run_id, employee_id),
        INDEX idx_employee_period (employee_id, year, month),
        INDEX idx_payment_status (payment_status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ employee_payroll');

    // ──────────────────────────────────────────────────────────────────────────
    // 5.3 employee_payroll → employee_payroll_components
    // ──────────────────────────────────────────────────────────────────────────
    console.log('5.3 Creating employee_payroll_components...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_payroll_components (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_payroll_id INT NOT NULL,
        
        -- Component Snapshot
        component_name VARCHAR(100) NOT NULL,
        component_code VARCHAR(20) NOT NULL,
        component_type ENUM('earning', 'deduction', 'employer_contribution') NOT NULL,
        
        -- Amounts
        calculated_amount DECIMAL(12,2) NOT NULL,
        actual_amount DECIMAL(12,2) NOT NULL,
        
        -- Statutory
        is_statutory TINYINT(1) DEFAULT 0,
        statutory_type VARCHAR(10) DEFAULT NULL,
        
        display_order INT DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_payroll_id) REFERENCES employee_payroll(id) ON DELETE CASCADE,
        INDEX idx_payroll_type (employee_payroll_id, component_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ employee_payroll_components');

    // ──────────────────────────────────────────────────────────────────────────
    // 5.4 employee_payroll → salary_slips
    // ──────────────────────────────────────────────────────────────────────────
    console.log('5.4 Creating salary_slips...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS salary_slips (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_payroll_id INT NOT NULL,
        employee_id INT NOT NULL,
        
        -- Period
        month INT NOT NULL,
        year INT NOT NULL,
        
        -- Slip
        slip_number VARCHAR(50) NOT NULL UNIQUE,
        
        -- PDF
        pdf_path VARCHAR(500) DEFAULT NULL,
        pdf_generated_at DATETIME DEFAULT NULL,
        
        -- Distribution
        email_sent TINYINT(1) DEFAULT 0,
        email_sent_at DATETIME DEFAULT NULL,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_payroll_id) REFERENCES employee_payroll(id) ON DELETE RESTRICT,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        
        INDEX idx_employee_period (employee_id, year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ salary_slips');

    // ──────────────────────────────────────────────────────────────────────────
    // 5.5 employee_payroll → salary_manual_overrides
    // ──────────────────────────────────────────────────────────────────────────
    console.log('5.5 Creating salary_manual_overrides...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS salary_manual_overrides (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_payroll_id INT NOT NULL,
        employee_id INT NOT NULL,
        
        -- Override Target
        component_code VARCHAR(50) NOT NULL,
        component_type ENUM('earning', 'deduction', 'employer_contribution') NOT NULL,
        
        -- Values
        original_value DECIMAL(12,2) NOT NULL,
        override_value DECIMAL(12,2) NOT NULL,
        
        -- Reason
        reason TEXT NOT NULL,
        override_category ENUM(
          'attendance_correction', 
          'arrears_adjustment', 
          'tax_adjustment',
          'loan_waiver',
          'error_correction',
          'other'
        ) NOT NULL,
        
        -- Approval
        requested_by INT NOT NULL,
        requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        approved_by INT DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        
        is_applied TINYINT(1) DEFAULT 0,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_payroll_id) REFERENCES employee_payroll(id) ON DELETE RESTRICT,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        
        INDEX idx_payroll (employee_payroll_id),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ salary_manual_overrides');

    // ──────────────────────────────────────────────────────────────────────────
    // 5.6 payroll_runs → statutory_payments
    // ──────────────────────────────────────────────────────────────────────────
    console.log('5.6 Creating statutory_payments...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS statutory_payments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        payroll_run_id INT NOT NULL,
        
        -- Type
        statutory_type ENUM('pf', 'esic', 'pt', 'mlwf', 'tds') NOT NULL,
        
        -- Period
        month INT NOT NULL,
        year INT NOT NULL,
        
        -- Amounts
        employee_contribution DECIMAL(15,2) DEFAULT 0,
        employer_contribution DECIMAL(15,2) DEFAULT 0,
        total_amount DECIMAL(15,2) NOT NULL,
        employee_count INT DEFAULT 0,
        
        -- Due Date
        due_date DATE DEFAULT NULL,
        
        -- Payment
        status ENUM('pending', 'paid', 'delayed') DEFAULT 'pending',
        challan_number VARCHAR(100) DEFAULT NULL,
        challan_date DATE DEFAULT NULL,
        paid_date DATE DEFAULT NULL,
        paid_amount DECIMAL(15,2) DEFAULT NULL,
        payment_reference VARCHAR(100) DEFAULT NULL,
        
        -- Late Fee
        late_fee DECIMAL(12,2) DEFAULT 0,
        interest DECIMAL(12,2) DEFAULT 0,
        
        -- Document
        receipt_path VARCHAR(500) DEFAULT NULL,
        
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (payroll_run_id) REFERENCES payroll_runs(id) ON DELETE RESTRICT,
        
        UNIQUE KEY uk_run_type (payroll_run_id, statutory_type),
        INDEX idx_type_period (statutory_type, year, month),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ statutory_payments');

    // ╔════════════════════════════════════════════════════════════════════════╗
    // ║ LEVEL 3: STANDALONE TABLES                                             ║
    // ╚════════════════════════════════════════════════════════════════════════╝

    // ──────────────────────────────────────────────────────────────────────────
    // 6.1 payroll_audit_logs (references all entities)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('6.1 Creating payroll_audit_logs...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payroll_audit_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        
        -- Entity Reference
        entity_type ENUM(
          'salary_structure',
          'daily_work_hours',
          'attendance',
          'employee_loan',
          'payroll_run',
          'employee_payroll',
          'statutory_payment',
          'manual_override'
        ) NOT NULL,
        entity_id INT NOT NULL,
        employee_id INT DEFAULT NULL,
        
        -- Action
        action ENUM('create', 'update', 'delete', 'approve', 'reject', 'finalize', 'lock') NOT NULL,
        
        -- Changes
        old_values JSON DEFAULT NULL,
        new_values JSON DEFAULT NULL,
        
        -- Context
        payroll_run_id INT DEFAULT NULL,
        month INT DEFAULT NULL,
        year INT DEFAULT NULL,
        
        -- Who & When
        performed_by INT NOT NULL,
        performed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        
        remarks TEXT,
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_entity (entity_type, entity_id),
        INDEX idx_employee (employee_id),
        INDEX idx_performed_by (performed_by),
        INDEX idx_period (year, month)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('    ✓ payroll_audit_logs');

    // Add FK for loan_repayment_schedule → employee_payroll (after both exist)
    console.log('\nAdding cross-references...');
    try {
      await connection.execute(`
        ALTER TABLE loan_repayment_schedule 
        ADD CONSTRAINT fk_loan_repayment_payroll 
        FOREIGN KEY (payroll_id) REFERENCES employee_payroll(id) ON DELETE SET NULL
      `);
      console.log('    ✓ loan_repayment_schedule → employee_payroll FK added');
    } catch (e) {
      if (e.code !== 'ER_DUP_KEYNAME' && e.code !== 'ER_FK_DUP_NAME') {
        console.log('    ⚠ FK may already exist');
      }
    }

    // ╔════════════════════════════════════════════════════════════════════════╗
    // ║ SUMMARY                                                                ║
    // ╚════════════════════════════════════════════════════════════════════════╝
    console.log('\n' + '═'.repeat(70));
    console.log(' INDIAN PAYROLL SCHEMA - NESTED STRUCTURE CREATED');
    console.log('═'.repeat(70));
    console.log(`
 LEVEL 1: Employee-Nested Tables
 ───────────────────────────────
 1.1 salary_structures           ← employees
 1.2 salary_structure_components ← salary_structures
 2.1 daily_work_hours            ← employees
 3.1 attendance_monthly          ← employees
 4.1 employee_loans              ← employees
 4.2 loan_repayment_schedule     ← employee_loans

 LEVEL 2: Payroll Run Hierarchy
 ──────────────────────────────
 5.1 payroll_runs                (company batch)
 5.2 employee_payroll            ← payroll_runs + employees
 5.3 employee_payroll_components ← employee_payroll
 5.4 salary_slips                ← employee_payroll
 5.5 salary_manual_overrides     ← employee_payroll
 5.6 statutory_payments          ← payroll_runs

 LEVEL 3: Standalone
 ───────────────────
 6.1 payroll_audit_logs          (references all)

 Total Tables: 13
`);

  } catch (error) {
    console.error('\nError:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed.');
    }
  }
}

createPayrollSchema();
