import dotenv from 'dotenv';
import { dbConnect } from './src/utils/database.js';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function setupDatabase() {
  try {
    console.log('Connecting to database...');
    const db = await dbConnect();

    // Create companies table
    console.log('Creating companies table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS companies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id VARCHAR(50) UNIQUE,
        company_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company_id (company_id),
        INDEX idx_company_name (company_name)
      )
    `);
    console.log('✓ Companies table created successfully');

    // Create users table for authentication
    console.log('Creating users table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_username (username)
      )
    `);
    console.log('✓ Users table created successfully');

    // Check if users table has the right structure
    const [tableInfo] = await db.execute('DESCRIBE users');
    console.log('Users table structure:', tableInfo.map(col => col.Field));

    // Insert default admin user if it doesn't exist
    console.log('Checking for default admin user...');
    const [existingUsers] = await db.execute('SELECT COUNT(*) as count FROM users WHERE username = ?', ['admin']);
    
    if (existingUsers[0].count === 0) {
      await db.execute('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)', 
        ['admin', 'admin123', 'admin@example.com']);
      console.log('✓ Default admin user created (username: admin, password: admin123)');
    } else {
      console.log('✓ Admin user already exists');
    }

    // Create proposals table with proper foreign key relationship
    console.log('Creating proposals table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS proposals (
        id INT PRIMARY KEY AUTO_INCREMENT,
        proposal_id VARCHAR(20) UNIQUE NOT NULL,
        lead_id INT,
        title VARCHAR(255) NOT NULL,
        client VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        contact_email VARCHAR(255),
        phone VARCHAR(20),
        project_description TEXT,
        city VARCHAR(100),
        priority ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
        notes TEXT,
        value DECIMAL(10,2),
        status ENUM('draft', 'pending', 'approved', 'rejected') DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        due_date DATE,
        INDEX idx_proposal_id (proposal_id),
        INDEX idx_client (client),
        INDEX idx_status (status)
      )
    `);
    console.log('✓ Proposals table created successfully');

    // Create leads table if it doesn't exist (for foreign key reference)
    console.log('Creating/updating leads table...');
    await db.execute(`
      CREATE TABLE IF NOT EXISTS leads (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255),
        contact_email VARCHAR(255),
        phone VARCHAR(20),
        city VARCHAR(100),
        project_description TEXT,
        enquiry_type ENUM('Email', 'Call', 'Website', 'Justdial', 'Referral', 'LinkedIn', 'Other') DEFAULT 'Email',
        enquiry_status ENUM('Under Discussion', 'Awaiting', 'Awarded', 'Regretted', 'Close', 'Converted to Proposal') DEFAULT 'Under Discussion',
        enquiry_date DATE,
        lead_source VARCHAR(255),
        priority ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_company_name (company_name),
        INDEX idx_enquiry_status (enquiry_status),
        INDEX idx_priority (priority)
      )
    `);
    console.log('✓ Leads table created/updated successfully');

    // Add foreign key constraint to proposals table if it doesn't exist
    try {
      await db.execute(`
        ALTER TABLE proposals 
        ADD CONSTRAINT fk_proposals_leads 
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      `);
      console.log('✓ Foreign key constraint added to proposals table');
    } catch (error) {
      if (error.code !== 'ER_DUP_KEYNAME') {
        console.log('Foreign key constraint already exists or error:', error.message);
      }
    }

    await db.end();
    console.log('\n🎉 Database setup completed successfully!');
    
    console.log('\n📋 Tables created:');
    console.log('• companies (id, company_id, company_name, created_at, updated_at)');
    console.log('• proposals (id, proposal_id, lead_id, title, client, contact info, etc.)');
    console.log('• leads (id, company_name, contact info, enquiry details, etc.)');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    process.exit(1);
  }
}

// Run the setup
setupDatabase();
