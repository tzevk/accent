import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function createActivityLogsTable() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    console.log('Creating user_activity_logs table...');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_activity_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        action_type ENUM(
          'login', 'logout', 
          'create', 'read', 'update', 'delete',
          'view_page', 'download', 'upload',
          'assign', 'approve', 'reject',
          'comment', 'status_change',
          'other'
        ) NOT NULL,
        resource_type VARCHAR(100),
        resource_id INT,
        description TEXT,
        details JSON,
        ip_address VARCHAR(45),
        user_agent TEXT,
        session_id VARCHAR(255),
        duration_seconds INT,
        status ENUM('success', 'failed', 'pending') DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_action_type (action_type),
        INDEX idx_resource (resource_type, resource_id),
        INDEX idx_created_at (created_at),
        INDEX idx_user_date (user_id, created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_activity_logs table created successfully');

    // Create work sessions table for time tracking
    console.log('Creating user_work_sessions table...');
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_work_sessions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        session_start TIMESTAMP NOT NULL,
        session_end TIMESTAMP NULL,
        duration_minutes INT,
        activities_count INT DEFAULT 0,
        pages_viewed INT DEFAULT 0,
        resources_modified INT DEFAULT 0,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status ENUM('active', 'idle', 'ended') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_session_start (session_start),
        INDEX idx_status (status),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_work_sessions table created successfully');

    // Create daily work summary table
    console.log('Creating user_daily_summary table...');
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_daily_summary (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        date DATE NOT NULL,
        total_work_minutes INT DEFAULT 0,
        login_count INT DEFAULT 0,
        activities_completed INT DEFAULT 0,
        resources_created INT DEFAULT 0,
        resources_updated INT DEFAULT 0,
        resources_deleted INT DEFAULT 0,
        pages_viewed INT DEFAULT 0,
        first_login TIMESTAMP NULL,
        last_activity TIMESTAMP NULL,
        productivity_score DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_date (user_id, date),
        INDEX idx_user_id (user_id),
        INDEX idx_date (date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_daily_summary table created successfully');
    console.log('');
    console.log('All tables created successfully!');
    console.log('You can now start logging user activities.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await db.end();
  }
}

createActivityLogsTable().catch(console.error);
