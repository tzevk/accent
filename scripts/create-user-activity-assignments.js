/**
 * Create user_activity_assignments table
 * This table stores activities assigned to users from project edit page
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
    console.log('Creating user_activity_assignments table...');
    
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_activity_assignments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        project_id INT,
        activity_name VARCHAR(255) NOT NULL,
        activity_description TEXT,
        due_date DATE,
        priority ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'Critical') DEFAULT 'MEDIUM',
        estimated_hours DECIMAL(10, 2) DEFAULT 0,
        actual_hours DECIMAL(10, 2) DEFAULT 0,
        progress_percentage INT DEFAULT 0,
        status ENUM('NOT_STARTED', 'Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled') DEFAULT 'NOT_STARTED',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_user_id (user_id),
        INDEX idx_project_id (project_id),
        INDEX idx_status (status),
        INDEX idx_due_date (due_date),
        INDEX idx_priority (priority)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_activity_assignments table created successfully!');

    // Also create activity_updates table for tracking changes
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS activity_updates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        activity_assignment_id INT NOT NULL,
        updated_by INT,
        update_type VARCHAR(50),
        old_value TEXT,
        new_value TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_activity_assignment_id (activity_assignment_id),
        INDEX idx_updated_by (updated_by),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ activity_updates table created successfully!');

  } catch (error) {
    console.error('Error creating tables:', error);
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
