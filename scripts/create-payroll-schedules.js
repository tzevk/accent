/**
 * Create Payroll Component Schedules Tables
 * ------------------------------------------
 * Creates tables to manage dynamic payroll components that can change over time
 * Similar to DA schedule, but for PF, PT, ESIC, Insurance, Bonus, Leaves, etc.
 * 
 * Usage: node scripts/create-payroll-schedules.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createPayrollSchedules() {
  console.log('🚀 Creating Payroll Component Schedules...\n');
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  });

  try {
    // ═══════════════════════════════════════════════════════════════════
    // Unified Payroll Schedules Table
    // ═══════════════════════════════════════════════════════════════════
    console.log('📋 Creating table: payroll_schedules');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS payroll_schedules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        component_type ENUM(
          'da',
          'pf_employee',
          'pf_employer', 
          'esic_employee',
          'esic_employer',
          'pt',
          'mlwf',
          'insurance',
          'personal_accident',
          'mediclaim',
          'bonus',
          'leaves',
          'tds'
        ) NOT NULL COMMENT 'Type of payroll component',
        
        value_type ENUM('fixed', 'percentage') NOT NULL COMMENT 'Whether this is a fixed amount or percentage',
        value DECIMAL(10,2) NOT NULL COMMENT 'Amount or percentage value',
        
        effective_from DATE NOT NULL COMMENT 'Start date for this rate',
        effective_to DATE DEFAULT NULL COMMENT 'End date (NULL = current)',
        is_active TINYINT(1) DEFAULT 1 COMMENT '1 = Active, 0 = Inactive',
        
        -- Optional slab configuration (for PT, etc.)
        min_salary DECIMAL(12,2) DEFAULT NULL COMMENT 'Minimum salary for slab (for PT, etc.)',
        max_salary DECIMAL(12,2) DEFAULT NULL COMMENT 'Maximum salary for slab (for PT, etc.)',
        
        remarks TEXT DEFAULT NULL COMMENT 'Notes about this component schedule',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_component (component_type),
        INDEX idx_effective_dates (effective_from, effective_to),
        INDEX idx_active (is_active),
        INDEX idx_salary_slab (component_type, min_salary, max_salary)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Unified payroll component schedules';
    `);
    console.log('✅ Table payroll_schedules created\n');

    // ═══════════════════════════════════════════════════════════════════
    // Insert Default Values (Based on frozen config)
    // ═══════════════════════════════════════════════════════════════════
    console.log('📋 Inserting default payroll schedules...');
    
    await connection.execute(`
      INSERT INTO payroll_schedules 
        (component_type, value_type, value, effective_from, is_active, remarks) 
      VALUES
        -- PF Rates
        ('pf_employee', 'percentage', 12.00, '2024-01-01', 1, 'Employee PF contribution - 12% of Basic+DA'),
        ('pf_employer', 'percentage', 13.00, '2024-01-01', 1, 'Employer PF contribution - 13% of Basic+DA'),
        
        -- ESIC Rates
        ('esic_employee', 'percentage', 0.75, '2024-01-01', 1, 'Employee ESIC contribution - 0.75% of Gross'),
        ('esic_employer', 'percentage', 3.25, '2024-01-01', 1, 'Employer ESIC contribution - 3.25% of Gross'),
        
        -- Professional Tax Slabs (Maharashtra)
        ('pt', 'fixed', 0, '2024-01-01', 1, 'PT for salary up to ₹5,000'),
        ('pt', 'fixed', 150, '2024-01-01', 1, 'PT for salary ₹5,001 to ₹7,500'),
        ('pt', 'fixed', 175, '2024-01-01', 1, 'PT for salary ₹7,501 to ₹10,000'),
        ('pt', 'fixed', 200, '2024-01-01', 1, 'PT for salary above ₹10,000'),
        
        -- MLWF (Maharashtra Labour Welfare Fund)
        ('mlwf', 'fixed', 25, '2024-01-01', 1, 'MLWF - Twice a year (June & December)'),
        
        -- TDS (Tax Deducted at Source)
        ('tds', 'percentage', 10.00, '2024-01-01', 1, 'TDS - 10% of gross salary'),
        
        -- Insurance (Default fixed amounts - can be customized)
        ('insurance', 'fixed', 500, '2024-01-01', 1, 'General insurance per month'),
        ('personal_accident', 'fixed', 200, '2024-01-01', 1, 'Personal accident insurance per month'),
        ('mediclaim', 'fixed', 300, '2024-01-01', 1, 'Mediclaim insurance per month'),
        
        -- Bonus (Percentage of gross)
        ('bonus', 'percentage', 8.33, '2024-01-01', 1, 'Statutory bonus - 8.33% of gross (max ₹7,000 wage)'),
        
        -- Leaves (Days per year)
        ('leaves', 'fixed', 24, '2024-01-01', 1, 'Casual and sick leaves per year'),
        
        -- TDS (Income Tax - typically based on slabs, default 0 for non-taxable income)
        ('tds', 'percentage', 0, '2024-01-01', 1, 'TDS - Tax Deducted at Source (0% for income below taxable limit)')
      ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
    `);
    
    console.log('✅ Default schedules inserted\n');

    // ═══════════════════════════════════════════════════════════════════
    // Update PT slabs with salary ranges
    // ═══════════════════════════════════════════════════════════════════
    console.log('📋 Updating PT slab ranges...');
    
    await connection.execute(`
      UPDATE payroll_schedules 
      SET 
        min_salary = 0, 
        max_salary = 5000 
      WHERE component_type = 'pt' AND value = 0;
    `);
    
    await connection.execute(`
      UPDATE payroll_schedules 
      SET 
        min_salary = 5001, 
        max_salary = 7500 
      WHERE component_type = 'pt' AND value = 150;
    `);
    
    await connection.execute(`
      UPDATE payroll_schedules 
      SET 
        min_salary = 7501, 
        max_salary = 10000 
      WHERE component_type = 'pt' AND value = 175;
    `);
    
    await connection.execute(`
      UPDATE payroll_schedules 
      SET 
        min_salary = 10001, 
        max_salary = 999999999 
      WHERE component_type = 'pt' AND value = 200;
    `);
    
    console.log('✅ PT slabs updated\n');

    console.log('✅ All payroll schedules created successfully!');
    
  } catch (error) {
    console.error('❌ Error creating payroll schedules:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

// Run the migration
createPayrollSchedules()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
