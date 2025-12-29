// Migration script to create employee_attendance table
// Run with: node scripts/create-attendance-table.js

const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function createAttendanceTable() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'accent_db'
    });

    console.log('Connected to database');

    // Create employee_attendance table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS employee_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        attendance_date DATE NOT NULL,
        status ENUM('P', 'A', 'PL', 'OT', 'WO', 'HD', 'CL', 'SL', 'ML', 'PaL') DEFAULT 'P' COMMENT 'P=Present, A=Absent, PL=Privileged Leave, OT=Overtime, WO=Weekly Off, HD=Half Day, CL=Casual Leave, SL=Sick Leave, ML=Maternity Leave, PaL=Paternity Leave',
        check_in_time TIME DEFAULT NULL,
        check_out_time TIME DEFAULT NULL,
        overtime_hours DECIMAL(5,2) DEFAULT 0.00,
        is_weekly_off TINYINT(1) DEFAULT 0,
        is_holiday TINYINT(1) DEFAULT 0,
        remarks VARCHAR(500) DEFAULT NULL,
        approved_by INT DEFAULT NULL,
        approved_at DATETIME DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        UNIQUE KEY unique_employee_date (employee_id, attendance_date),
        INDEX idx_employee_id (employee_id),
        INDEX idx_attendance_date (attendance_date),
        INDEX idx_status (status),
        INDEX idx_month (attendance_date),
        
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ employee_attendance table created successfully');

    // Create attendance_settings table for company-wide settings
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS attendance_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT DEFAULT NULL,
        week_off_day1 TINYINT DEFAULT 0 COMMENT '0=Sunday, 1=Monday, etc.',
        week_off_day2 TINYINT DEFAULT NULL COMMENT 'Second weekly off (e.g., Saturday)',
        alternate_saturday TINYINT(1) DEFAULT 1 COMMENT '1=1st & 3rd Saturday off, 0=All Saturdays working',
        standard_working_hours DECIMAL(4,2) DEFAULT 8.00,
        grace_period_minutes INT DEFAULT 15,
        half_day_hours DECIMAL(4,2) DEFAULT 4.00,
        overtime_threshold_hours DECIMAL(4,2) DEFAULT 8.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ attendance_settings table created successfully');

    // Insert default attendance settings
    await connection.execute(`
      INSERT IGNORE INTO attendance_settings 
        (id, week_off_day1, week_off_day2, alternate_saturday, standard_working_hours, grace_period_minutes)
      VALUES 
        (1, 0, 6, 1, 8.00, 15)
    `);

    console.log('✅ Default attendance settings inserted');

    // Create holidays table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS company_holidays (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT DEFAULT NULL,
        holiday_date DATE NOT NULL,
        holiday_name VARCHAR(100) NOT NULL,
        holiday_type ENUM('national', 'regional', 'company', 'optional') DEFAULT 'company',
        is_paid TINYINT(1) DEFAULT 1,
        year INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        UNIQUE KEY unique_holiday_date (company_id, holiday_date),
        INDEX idx_year (year),
        INDEX idx_holiday_date (holiday_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ company_holidays table created successfully');

    console.log('\n🎉 All attendance tables created successfully!');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

createAttendanceTable();
