import { dbConnect } from '../src/utils/database.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');

// Load env vars from .env.local
dotenv.config({ path: envPath });

async function clearLeads() {
  console.log('Connecting to database...');
  const db = await dbConnect();
  
  try {
    // Get count before deletion
    const [countRows] = await db.execute('SELECT COUNT(*) as count FROM leads');
    const beforeCount = countRows[0].count;
    console.log(`Found ${beforeCount} leads to delete`);

    // Delete all leads
    const [result] = await db.execute('DELETE FROM leads');
    console.log(`Successfully deleted ${result.affectedRows} leads`);
    
    // Verify deletion
    const [verifyRows] = await db.execute('SELECT COUNT(*) as count FROM leads');
    console.log(`Leads remaining: ${verifyRows[0].count}`);
  } catch (err) {
    console.error('Error deleting leads:', err);
    process.exit(1);
  } finally {
    await db.end();
  }
}

// Run the deletion
clearLeads();