const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

async function createProjectActivitiesTable() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'accentcrm',
    });

    console.log('📦 Connected to database');

    // Create project_activities table
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS project_activities (
        id VARCHAR(36) PRIMARY KEY,
        project_id INT NOT NULL,
        activity_id VARCHAR(36),
        activity_name VARCHAR(255) NOT NULL,
        discipline_id VARCHAR(36),
        discipline_name VARCHAR(255),
        start_date DATE,
        end_date DATE,
        manhours_planned DECIMAL(10,2) DEFAULT 0,
        manhours_actual DECIMAL(10,2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Pending',
        progress_percentage DECIMAL(5,2) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        INDEX idx_project_id (project_id),
        INDEX idx_activity_id (activity_id),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await connection.execute(createTableQuery);
    console.log('✅ Created project_activities table successfully!');

    // Display table structure
    const [columns] = await connection.execute('DESCRIBE project_activities');
    console.log('\n📋 Table Structure:');
    console.table(columns);

  } catch (error) {
    console.error('❌ Error creating table:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

createProjectActivitiesTable();
