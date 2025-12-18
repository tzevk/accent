/**
 * Database migration script for Internal Messaging System
 * Run with: node scripts/create-messages-tables.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createMessagesTables() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'accent_crm',
  });

  console.log('Connected to database. Creating messages tables...\n');

  try {
    // Create messages table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        related_module ENUM('lead', 'client', 'project', 'employee', 'company', 'proposal', 'none') DEFAULT 'none',
        related_id INT DEFAULT NULL,
        read_status BOOLEAN DEFAULT FALSE,
        read_at DATETIME DEFAULT NULL,
        is_deleted_by_sender BOOLEAN DEFAULT FALSE,
        is_deleted_by_receiver BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        INDEX idx_sender (sender_id),
        INDEX idx_receiver (receiver_id),
        INDEX idx_read_status (read_status),
        INDEX idx_related (related_module, related_id),
        INDEX idx_created_at (created_at),
        
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created messages table');

    // Create message_attachments table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id INT NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size INT NOT NULL,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        INDEX idx_message (message_id),
        
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created message_attachments table');

    // Create message_threads table for conversation grouping (optional but useful)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS message_threads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user1_id INT NOT NULL,
        user2_id INT NOT NULL,
        last_message_id INT DEFAULT NULL,
        last_message_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        UNIQUE KEY unique_thread (user1_id, user2_id),
        INDEX idx_user1 (user1_id),
        INDEX idx_user2 (user2_id),
        INDEX idx_last_message (last_message_at),
        
        FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✓ Created message_threads table');

    console.log('\n✅ All messaging tables created successfully!');
    
  } catch (error) {
    console.error('Error creating tables:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

createMessagesTables().catch(console.error);
