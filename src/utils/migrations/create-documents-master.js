import dotenv from 'dotenv';
import { dbConnect } from '../database.js';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function runMigration() {
  let connection;
  try {
    connection = await dbConnect();

    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS documents_master (
        id INT PRIMARY KEY AUTO_INCREMENT,
        doc_key VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    await connection.query(createTableQuery);
    console.log('✅ Successfully ensured documents_master table exists');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
