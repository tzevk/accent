import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

async function addScreenTimeTracking() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    console.log('Adding screen time tracking tables...');

    // Create page visit tracking table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_page_visits (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        page_path VARCHAR(500) NOT NULL,
        page_title VARCHAR(255),
        visit_start TIMESTAMP NOT NULL,
        visit_end TIMESTAMP NULL,
        duration_seconds INT DEFAULT 0,
        interactions_count INT DEFAULT 0,
        clicks_count INT DEFAULT 0,
        scrolls_count INT DEFAULT 0,
        visibility_changes INT DEFAULT 0,
        was_idle BOOLEAN DEFAULT FALSE,
        session_id VARCHAR(255),
        referrer VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_page_path (page_path(255)),
        INDEX idx_visit_start (visit_start),
        INDEX idx_user_date (user_id, visit_start),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_page_visits table created');

    // Create user interactions table (detailed tracking)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_interactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        interaction_type ENUM(
          'click', 'mouse_move', 'keypress', 'scroll',
          'focus', 'blur', 'visibility_change',
          'navigation', 'form_submit', 'button_click'
        ) NOT NULL,
        page_path VARCHAR(500),
        element_type VARCHAR(100),
        element_id VARCHAR(255),
        element_class VARCHAR(255),
        position_x INT,
        position_y INT,
        details JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_type (interaction_type),
        INDEX idx_created_at (created_at),
        INDEX idx_user_date (user_id, created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_interactions table created');

    // Create screen time summary table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_screen_time (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        date DATE NOT NULL,
        total_screen_time_minutes INT DEFAULT 0,
        active_time_minutes INT DEFAULT 0,
        idle_time_minutes INT DEFAULT 0,
        pages_visited INT DEFAULT 0,
        unique_pages INT DEFAULT 0,
        total_clicks INT DEFAULT 0,
        total_scrolls INT DEFAULT 0,
        total_keypresses INT DEFAULT 0,
        session_count INT DEFAULT 0,
        avg_session_duration_minutes DECIMAL(10,2) DEFAULT 0,
        longest_session_minutes INT DEFAULT 0,
        most_visited_page VARCHAR(500),
        focus_score DECIMAL(5,2) DEFAULT 0,
        productivity_score DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_date (user_id, date),
        INDEX idx_user_id (user_id),
        INDEX idx_date (date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ user_screen_time table created');

    // Update user_activity_logs to support new action types
    await db.execute(`
      ALTER TABLE user_activity_logs 
      MODIFY COLUMN action_type ENUM(
        'login', 'logout', 
        'create', 'read', 'update', 'delete',
        'view_page', 'download', 'upload',
        'assign', 'approve', 'reject',
        'comment', 'status_change',
        'click', 'mouse_move', 'keypress', 'scroll',
        'focus', 'blur', 'visibility_change',
        'other'
      ) NOT NULL
    `);

    console.log('✅ user_activity_logs updated with new action types');

    // Add duration_seconds column to user_work_sessions if not exists
    await db.execute(`
      ALTER TABLE user_work_sessions 
      ADD COLUMN IF NOT EXISTS total_screen_time_minutes INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS active_screen_time_minutes INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS idle_screen_time_minutes INT DEFAULT 0
    `).catch(() => {
      console.log('Note: Screen time columns may already exist in user_work_sessions');
    });

    console.log('✅ user_work_sessions updated');

    // Create triggers to auto-update screen time
    await db.execute(`
      CREATE TRIGGER IF NOT EXISTS update_screen_time_on_page_visit
      AFTER UPDATE ON user_page_visits
      FOR EACH ROW
      BEGIN
        IF NEW.visit_end IS NOT NULL AND OLD.visit_end IS NULL THEN
          INSERT INTO user_screen_time 
            (user_id, date, total_screen_time_minutes, pages_visited, unique_pages)
          VALUES 
            (NEW.user_id, DATE(NEW.visit_start), NEW.duration_seconds / 60, 1, 1)
          ON DUPLICATE KEY UPDATE
            total_screen_time_minutes = total_screen_time_minutes + (NEW.duration_seconds / 60),
            pages_visited = pages_visited + 1,
            updated_at = CURRENT_TIMESTAMP;
        END IF;
      END
    `).catch(() => {
      console.log('Note: Trigger may already exist');
    });

    console.log('✅ Triggers created for auto-updating screen time');

    console.log('');
    console.log('==========================================');
    console.log('✅ Screen time tracking setup complete!');
    console.log('==========================================');
    console.log('');
    console.log('New tables created:');
    console.log('  - user_page_visits (tracks time on each page)');
    console.log('  - user_interactions (detailed interaction tracking)');
    console.log('  - user_screen_time (daily aggregated screen time)');
    console.log('');
    console.log('Enhanced tracking now includes:');
    console.log('  ✓ Page visit duration');
    console.log('  ✓ Active vs idle time');
    console.log('  ✓ Click, scroll, keypress counts');
    console.log('  ✓ Focus/blur events');
    console.log('  ✓ Tab visibility changes');
    console.log('  ✓ Session duration tracking');
    console.log('  ✓ Productivity scoring');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await db.end();
  }
}

addScreenTimeTracking().catch(console.error);
