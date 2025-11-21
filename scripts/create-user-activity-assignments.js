#!/usr/bin/env node

/**
 * Database Migration: Create user_activity_assignments table
 * 
 * This script creates the table for tracking activity assignments to users.
 * Activities can be assigned from projects to specific team members with
 * due dates, priorities, and progress tracking.
 * 
 * Run: node scripts/create-user-activity-assignments.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function dbConnect() {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'accentcrm',
    port: process.env.DB_PORT || 3306
  });
}

async function main() {
  let db;
  
  try {
    console.log('🔌 Connecting to database...');
    db = await dbConnect();
    console.log('✅ Connected to database');

    // Create user_activity_assignments table
    console.log('\n📋 Creating user_activity_assignments table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_activity_assignments (
        id VARCHAR(36) PRIMARY KEY,
        user_id INT NOT NULL,
        employee_id INT,
        project_id INT,
        activity_id VARCHAR(36),
        activity_name VARCHAR(255) NOT NULL,
        discipline_id VARCHAR(36),
        discipline_name VARCHAR(255),
        assigned_by INT,
        assigned_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        due_date DATE,
        priority ENUM('Low', 'Medium', 'High', 'Critical') DEFAULT 'Medium',
        status ENUM('Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled') DEFAULT 'Not Started',
        progress_percentage INT DEFAULT 0,
        estimated_hours DECIMAL(10,2),
        actual_hours DECIMAL(10,2),
        notes TEXT,
        completion_date DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
        FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user_status (user_id, status),
        INDEX idx_project_user (project_id, user_id),
        INDEX idx_due_date (due_date),
        INDEX idx_assigned_date (assigned_date),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ user_activity_assignments table created/verified');

    // Create activity_updates table for tracking activity history
    console.log('\n📋 Creating activity_updates table for audit trail...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS activity_updates (
        id VARCHAR(36) PRIMARY KEY,
        activity_assignment_id VARCHAR(36) NOT NULL,
        updated_by INT NOT NULL,
        update_type ENUM('status_change', 'progress_update', 'hours_update', 'note_added', 'assigned', 'reassigned') NOT NULL,
        old_value TEXT,
        new_value TEXT,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (activity_assignment_id) REFERENCES user_activity_assignments(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_activity_assignment (activity_assignment_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ activity_updates table created/verified');

    // Create activity_comments table for discussion threads
    console.log('\n📋 Creating activity_comments table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS activity_comments (
        id VARCHAR(36) PRIMARY KEY,
        activity_assignment_id VARCHAR(36) NOT NULL,
        user_id INT NOT NULL,
        comment TEXT NOT NULL,
        parent_comment_id VARCHAR(36),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (activity_assignment_id) REFERENCES user_activity_assignments(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_comment_id) REFERENCES activity_comments(id) ON DELETE CASCADE,
        INDEX idx_activity_assignment (activity_assignment_id),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ activity_comments table created/verified');

    // Verify table structure
    console.log('\n🔍 Verifying table structure...');
    const [columns] = await db.execute(`
      SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'user_activity_assignments'
      ORDER BY ORDINAL_POSITION
    `);
    
    console.log('\n📊 Table structure:');
    columns.forEach(col => {
      console.log(`  - ${col.COLUMN_NAME}: ${col.COLUMN_TYPE} ${col.IS_NULLABLE === 'NO' ? 'NOT NULL' : 'NULL'}`);
    });

    // Check indexes
    const [indexes] = await db.execute(`
      SHOW INDEX FROM user_activity_assignments
    `);
    
    console.log('\n🔑 Indexes created:');
    const uniqueIndexes = [...new Set(indexes.map(idx => idx.Key_name))];
    uniqueIndexes.forEach(idx => {
      console.log(`  - ${idx}`);
    });

    // Sample query to verify everything works
    console.log('\n✅ Running test query...');
    await db.execute(`
      SELECT COUNT(*) as count FROM user_activity_assignments
    `);
    console.log('✅ Test query successful');

    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📝 Summary:');
    console.log('   - user_activity_assignments table created');
    console.log('   - activity_updates table created (audit trail)');
    console.log('   - activity_comments table created (discussion threads)');
    console.log('   - All foreign keys and indexes configured');
    console.log('\n💡 Next steps:');
    console.log('   1. Create API endpoints: /api/users/[id]/activities');
    console.log('   2. Create API endpoints: /api/projects/[id]/assign-activities');
    console.log('   3. Update dashboard to display assigned activities');
    console.log('   4. Add activity assignment UI to project edit page');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    if (db) {
      await db.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Run migration
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
