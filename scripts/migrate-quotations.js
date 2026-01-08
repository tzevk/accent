/**
 * Migration script to add status column to quotations table
 * Run with: node scripts/migrate-quotations.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function migrate() {
  let connection;
  
  try {
    // Database connection config - uses same env vars as the app
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'accent_db',
      port: process.env.DB_PORT || 3306
    });

    console.log('Connected to database');

    // Check if quotations table exists
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'quotations'"
    );

    if (tables.length === 0) {
      console.log('Quotations table does not exist. Creating it...');
      
      await connection.execute(`
        CREATE TABLE quotations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          quotation_number VARCHAR(50) UNIQUE NOT NULL,
          client_name VARCHAR(255) NOT NULL,
          client_email VARCHAR(255),
          client_phone VARCHAR(50),
          client_address TEXT,
          subject VARCHAR(500),
          items JSON,
          subtotal DECIMAL(15, 2) DEFAULT 0,
          tax_rate DECIMAL(5, 2) DEFAULT 18,
          tax_amount DECIMAL(15, 2) DEFAULT 0,
          discount DECIMAL(15, 2) DEFAULT 0,
          total DECIMAL(15, 2) DEFAULT 0,
          notes TEXT,
          terms TEXT,
          valid_until DATE,
          status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft',
          created_by INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_status (status),
          INDEX idx_created_at (created_at)
        )
      `);
      
      console.log('✅ Quotations table created successfully');
    } else {
      console.log('Quotations table exists. Checking for status column...');
      
      // Check if status column exists
      const [columns] = await connection.execute(
        "SHOW COLUMNS FROM quotations LIKE 'status'"
      );

      if (columns.length === 0) {
        console.log('Adding status column...');
        
        await connection.execute(`
          ALTER TABLE quotations 
          ADD COLUMN status ENUM('draft', 'sent', 'approved', 'rejected') DEFAULT 'draft'
        `);
        
        console.log('✅ Status column added successfully');
        
        // Add index for status column
        try {
          await connection.execute(`
            ALTER TABLE quotations ADD INDEX idx_status (status)
          `);
          console.log('✅ Index for status column added');
        } catch (indexError) {
          if (indexError.code === 'ER_DUP_KEYNAME') {
            console.log('Index already exists, skipping');
          } else {
            console.log('Could not add index:', indexError.message);
          }
        }
      } else {
        console.log('✅ Status column already exists');
      }
    }

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('Database connection closed');
    }
  }
}

// Run migration
migrate();
