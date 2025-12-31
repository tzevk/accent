/**
 * Create Core Payroll Tables
 * ---------------------------
 * 3 minimal & efficient tables for payroll management
 * 
 * 1. DA Schedule - Tracks DA amounts (changes every 6 months)
 * 2. Employee Salary Profile - Stores employee-specific salary data
 * 3. Payroll Slips - Monthly snapshot results (immutable history)
 * 
 * Usage: node scripts/create-payroll-core-tables.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createPayrollCoreTables() {
  console.log('🚀 Creating Core Payroll Tables...\n');
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    // ═══════════════════════════════════════════════════════════════════
    // TABLE 1: DA Schedule (Dearness Allowance changes every 6 months)
    // ═══════════════════════════════════════════════════════════════════
    console.log('📋 Creating table: da_schedule');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS da_schedule (
        id INT AUTO_INCREMENT PRIMARY KEY,
        da_amount DECIMAL(10,2) NOT NULL COMMENT 'Fixed DA amount in rupees',
        effective_from DATE NOT NULL COMMENT 'Start date of this DA rate',
        effective_to DATE DEFAULT NULL COMMENT 'End date of this DA rate (NULL = current)',
        is_active TINYINT(1) DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        remarks TEXT DEFAULT NULL COMMENT 'Notes about this DA revision',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_effective_dates (effective_from, effective_to),
        INDEX idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='DA Schedule - Changes every 6 months';
    `);
    console.log('✅ Table da_schedule created\n');

    // ═══════════════════════════════════════════════════════════════════
    // TABLE 2: Employee Salary Profile (Only stores what varies per employee)
    // ═══════════════════════════════════════════════════════════════════
    console.log('📋 Creating table: employee_salary_profile');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_salary_profile (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL COMMENT 'FK to employees table',
        gross DECIMAL(12,2) NOT NULL COMMENT 'Gross salary (all percentages derive from this)',
        other_allowances DECIMAL(10,2) DEFAULT 0 COMMENT 'Optional additional allowances beyond standard components',
        effective_from DATE NOT NULL COMMENT 'Start date of this salary structure',
        effective_to DATE DEFAULT NULL COMMENT 'End date (NULL = current)',
        is_active TINYINT(1) DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        pf_applicable TINYINT(1) DEFAULT 1 COMMENT 'Is PF applicable? 1=Yes, 0=No',
        esic_applicable TINYINT(1) DEFAULT 1 COMMENT 'Is ESIC applicable? 1=Yes, 0=No',
        remarks TEXT DEFAULT NULL COMMENT 'Notes about this salary structure',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        INDEX idx_employee (employee_id),
        INDEX idx_effective_dates (effective_from, effective_to),
        INDEX idx_active (is_active),
        UNIQUE KEY unique_active_employee (employee_id, is_active, effective_from)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Employee Salary Profile - Stores only variable data per employee';
    `);
    console.log('✅ Table employee_salary_profile created\n');

    // ═══════════════════════════════════════════════════════════════════
    // TABLE 3: Payroll Slips (Immutable monthly snapshots)
    // ═══════════════════════════════════════════════════════════════════
    console.log('📋 Creating table: payroll_slips');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payroll_slips (
        id INT AUTO_INCREMENT PRIMARY KEY,
        month DATE NOT NULL COMMENT 'Payroll month (YYYY-MM-01 format)',
        employee_id INT NOT NULL COMMENT 'FK to employees table',
        
        -- EARNINGS (Calculated from Gross using frozen PAYROLL_CONFIG)
        gross DECIMAL(12,2) NOT NULL COMMENT 'Gross salary for the month',
        da_used DECIMAL(10,2) DEFAULT 0 COMMENT 'DA amount applied this month',
        basic DECIMAL(12,2) NOT NULL COMMENT 'Basic + DA (60% of Gross)',
        hra DECIMAL(12,2) NOT NULL COMMENT 'HRA (20% of Gross)',
        conveyance DECIMAL(12,2) NOT NULL COMMENT 'Conveyance (10% of Gross)',
        call_allowance DECIMAL(12,2) NOT NULL COMMENT 'Call Allowance (10% of Gross)',
        other_allowances DECIMAL(10,2) DEFAULT 0 COMMENT 'Any additional allowances',
        total_earnings DECIMAL(12,2) NOT NULL COMMENT 'Sum of all earnings',
        
        -- EMPLOYEE DEDUCTIONS
        pf_employee DECIMAL(10,2) DEFAULT 0 COMMENT 'Employee PF (12% of Gross)',
        esic_employee DECIMAL(10,2) DEFAULT 0 COMMENT 'Employee ESIC (0.75% of Gross)',
        pt DECIMAL(10,2) DEFAULT 0 COMMENT 'Professional Tax (Maharashtra)',
        lwf DECIMAL(10,2) DEFAULT 0 COMMENT 'Labour Welfare Fund',
        tds DECIMAL(10,2) DEFAULT 0 COMMENT 'Tax Deducted at Source',
        other_deductions DECIMAL(10,2) DEFAULT 0 COMMENT 'Other deductions',
        total_deductions DECIMAL(12,2) NOT NULL COMMENT 'Sum of all deductions',
        
        -- NET PAY
        net_pay DECIMAL(12,2) NOT NULL COMMENT 'Take-home salary (Earnings - Deductions)',
        
        -- EMPLOYER CONTRIBUTIONS (Not deducted from salary)
        pf_employer DECIMAL(10,2) DEFAULT 0 COMMENT 'Employer PF (13% of Gross)',
        esic_employer DECIMAL(10,2) DEFAULT 0 COMMENT 'Employer ESIC (3.25% of Gross)',
        gratuity DECIMAL(10,2) DEFAULT 0 COMMENT 'Gratuity provision (4.81% of Basic)',
        pf_admin DECIMAL(10,2) DEFAULT 0 COMMENT 'PF Admin charges (0.5%)',
        edli DECIMAL(10,2) DEFAULT 0 COMMENT 'EDLI charges (0.5%)',
        total_employer_contributions DECIMAL(12,2) DEFAULT 0 COMMENT 'Total employer cost',
        
        -- TOTAL CTC
        employer_cost DECIMAL(12,2) NOT NULL COMMENT 'Total employer cost including contributions',
        
        -- METADATA
        payment_status ENUM('pending', 'processed', 'paid', 'hold') DEFAULT 'pending' COMMENT 'Payment status',
        payment_date DATE DEFAULT NULL COMMENT 'Date when payment was made',
        payment_reference VARCHAR(100) DEFAULT NULL COMMENT 'Payment transaction reference',
        remarks TEXT DEFAULT NULL COMMENT 'Additional notes',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When this slip was generated',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
        UNIQUE KEY unique_month_employee (month, employee_id) COMMENT 'One slip per employee per month',
        INDEX idx_month (month),
        INDEX idx_employee (employee_id),
        INDEX idx_payment_status (payment_status),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Payroll Slips - Immutable monthly snapshots';
    `);
    console.log('✅ Table payroll_slips created\n');

    // ═══════════════════════════════════════════════════════════════════
    // Insert Sample DA Schedule (Optional - for testing)
    // ═══════════════════════════════════════════════════════════════════
    console.log('📊 Inserting sample DA schedule entries...');
    await connection.execute(`
      INSERT IGNORE INTO da_schedule (da_amount, effective_from, effective_to, is_active, remarks)
      VALUES 
        (0, '2024-01-01', '2024-06-30', 0, 'H1 2024 - Zero DA'),
        (0, '2024-07-01', '2024-12-31', 0, 'H2 2024 - Zero DA'),
        (0, '2025-01-01', '2025-06-30', 0, 'H1 2025 - Zero DA'),
        (0, '2025-07-01', '2025-12-31', 1, 'H2 2025 - Current Active - Zero DA'),
        (0, '2026-01-01', NULL, 0, 'H1 2026 - Future - Zero DA (Inactive until activated)')
    `);
    console.log('✅ Sample DA schedule inserted\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✨ All Core Payroll Tables Created Successfully!');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    console.log('📋 Tables Created:');
    console.log('   1. da_schedule - DA amounts (changes every 6 months)');
    console.log('   2. employee_salary_profile - Employee-specific salary data');
    console.log('   3. payroll_slips - Monthly payroll snapshots (immutable)\n');
    
    console.log('🔧 Key Features:');
    console.log('   ✓ Minimal & efficient schema');
    console.log('   ✓ All percentages calculated from PAYROLL_CONFIG');
    console.log('   ✓ DA schedule tracks 6-month changes');
    console.log('   ✓ Employee profiles store only variable data (gross, other_allowances)');
    console.log('   ✓ Payroll slips are immutable history snapshots');
    console.log('   ✓ UNIQUE constraint on (month, employee_id) prevents duplicates\n');
    
    console.log('📊 Next Steps:');
    console.log('   1. Update DA schedule every 6 months in da_schedule table');
    console.log('   2. Create employee_salary_profile entries for each employee');
    console.log('   3. Generate monthly payroll_slips using payroll generation script\n');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  } finally {
    await connection.end();
  }
}
createPayrollCoreTables()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

export { createPayrollCoreTables };

export default { createPayrollCoreTables };
