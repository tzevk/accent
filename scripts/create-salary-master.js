/**
 * Create salary_master table
 * This table stores predefined salary structures that can be assigned to employees
 */

import mysql from 'mysql2/promise';

async function createTable() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'accent_db'
  });

  try {
    console.log('Creating salary_master table...');
    
    // Drop and recreate to ensure correct structure
    await connection.execute(`DROP TABLE IF EXISTS salary_master`);
    
    await connection.execute(`
      CREATE TABLE salary_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        
        -- Basic Salary Components
        basic_salary DECIMAL(12,2) DEFAULT 0,
        da DECIMAL(12,2) DEFAULT 0 COMMENT 'Dearness Allowance',
        hra DECIMAL(12,2) DEFAULT 0 COMMENT 'House Rent Allowance',
        
        -- Allowances
        conveyance_allowance DECIMAL(12,2) DEFAULT 0,
        medical_allowance DECIMAL(12,2) DEFAULT 0,
        special_allowance DECIMAL(12,2) DEFAULT 0,
        call_allowance DECIMAL(12,2) DEFAULT 0,
        other_allowance DECIMAL(12,2) DEFAULT 0,
        
        -- Calculated Fields
        gross_salary DECIMAL(12,2) DEFAULT 0,
        
        -- Deductions
        pf_percentage DECIMAL(5,2) DEFAULT 12 COMMENT 'PF percentage of basic',
        esi_percentage DECIMAL(5,2) DEFAULT 0.75 COMMENT 'ESI percentage if applicable',
        professional_tax DECIMAL(12,2) DEFAULT 200,
        mlwf_employee DECIMAL(12,2) DEFAULT 5 COMMENT 'Maharashtra Labour Welfare Fund - Employee',
        mlwf_employer DECIMAL(12,2) DEFAULT 13 COMMENT 'Maharashtra Labour Welfare Fund - Employer',
        tds_percentage DECIMAL(5,2) DEFAULT 0,
        mediclaim DECIMAL(12,2) DEFAULT 0 COMMENT 'Medical Insurance Premium',
        
        -- Employer Contributions
        employer_pf_percentage DECIMAL(5,2) DEFAULT 12 COMMENT 'Employer PF contribution percentage',
        bonus_percentage DECIMAL(5,2) DEFAULT 8.33 COMMENT 'Bonus percentage',
        gratuity_percentage DECIMAL(5,2) DEFAULT 4.81 COMMENT 'Gratuity percentage',
        
        -- Leave Policy
        annual_leaves INT DEFAULT 21,
        casual_leaves INT DEFAULT 7,
        sick_leaves INT DEFAULT 7,
        
        -- OT Settings
        ot_rate_per_hour DECIMAL(12,2) DEFAULT 0,
        
        -- Meta
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_name (name),
        INDEX idx_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ salary_master table created successfully!');

    // Insert some default salary structures
    await connection.execute(`
      INSERT IGNORE INTO salary_master (id, name, description, basic_salary, hra, conveyance_allowance, medical_allowance, special_allowance, gross_salary, pf_percentage, professional_tax)
      VALUES 
        (1, 'Junior Developer', 'Entry level developer salary structure', 15000, 6000, 1600, 1250, 3150, 27000, 12, 200),
        (2, 'Senior Developer', 'Senior level developer salary structure', 30000, 12000, 1600, 1250, 10150, 55000, 12, 200),
        (3, 'Team Lead', 'Team lead salary structure', 45000, 18000, 1600, 1250, 19150, 85000, 12, 200),
        (4, 'Manager', 'Manager level salary structure', 60000, 24000, 1600, 1250, 33150, 120000, 12, 200)
    `);

    console.log('✅ Default salary structures inserted!');

  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  } finally {
    await connection.end();
  }
}

createTable()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
