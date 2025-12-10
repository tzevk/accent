#!/usr/bin/env node
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: '.env.local' });

async function createWorkLogsTable() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    console.log('Creating user_work_logs table...');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_work_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        log_date DATE NOT NULL,
        log_type ENUM('plan', 'done', 'note') DEFAULT 'done',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(100),
        priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
        status ENUM('pending', 'in_progress', 'completed', 'blocked') DEFAULT 'completed',
        time_spent INT COMMENT 'Time spent in minutes',
        project_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_log_date (log_date),
        INDEX idx_user_date (user_id, log_date),
        INDEX idx_log_type (log_type),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_work_logs table created successfully');
    console.log('');
    console.log('Work logs table created successfully!');
    console.log('Employees can now log their daily work activities.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await db.end();
  }
}

createWorkLogsTable()
  .then(() => {
    console.log('✅ Setup complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Setup failed:', error);
    process.exit(1);
  });
