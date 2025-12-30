import { createConnection } from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function createProposalFollowupsTable() {
  const connection = await createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    console.log('Creating proposal_followups table...');
    
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS proposal_followups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        proposal_id INT NOT NULL,
        follow_up_date DATE NOT NULL,
        follow_up_type ENUM('Call', 'Email', 'Meeting', 'Site Visit', 'Other') DEFAULT 'Call',
        description TEXT,
        status ENUM('Scheduled', 'In Progress', 'Completed', 'Cancelled') DEFAULT 'Scheduled',
        outcome TEXT,
        next_action TEXT,
        next_follow_up_date DATE,
        contacted_person VARCHAR(255),
        notes TEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE,
        INDEX idx_proposal_id (proposal_id),
        INDEX idx_follow_up_date (follow_up_date),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('✅ proposal_followups table created successfully!');
    
    // Verify the table structure
    const [columns] = await connection.execute('DESCRIBE proposal_followups');
    console.log('\nTable structure:');
    columns.forEach(col => {
      console.log(`  ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : ''} ${col.Key === 'PRI' ? 'PRIMARY KEY' : ''}`);
    });
    
  } catch (error) {
    console.error('Error creating table:', error.message);
  } finally {
    await connection.end();
    console.log('\nConnection closed.');
  }
}

createProposalFollowupsTable();
