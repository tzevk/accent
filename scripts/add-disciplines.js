import mysql from 'mysql2/promise';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function addDisciplines() {
  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });
  
  const disciplines = [
    { name: 'Electrical', description: 'Electrical engineering discipline' },
    { name: 'Instrumentation', description: 'Instrumentation and control systems' },
    { name: 'Process', description: 'Process engineering discipline' },
    { name: 'Mechanical', description: 'Mechanical engineering discipline' },
    { name: 'Civil', description: 'Civil engineering discipline' },
    { name: 'Structural', description: 'Structural engineering discipline' },
    { name: 'Piping', description: 'Piping engineering discipline' },
    { name: 'HVAC', description: 'Heating, ventilation, and air conditioning' },
    { name: 'Fire Fighting', description: 'Fire protection systems' },
    { name: 'Safety', description: 'Safety engineering discipline' },
    { name: 'Architecture', description: 'Architectural design' },
    { name: 'Project Management', description: 'Project management activities' },
    { name: 'Documentation', description: 'Documentation and drawings' },
    { name: 'Quality Control', description: 'Quality assurance and control' },
    { name: 'Procurement', description: 'Procurement activities' }
  ];
  
  // Check existing disciplines
  const [existing] = await pool.execute('SELECT function_name FROM functions_master');
  const existingNames = existing.map(e => e.function_name.toLowerCase());
  
  let added = 0;
  for (const disc of disciplines) {
    if (!existingNames.includes(disc.name.toLowerCase())) {
      const id = crypto.randomUUID();
      await pool.execute(
        'INSERT INTO functions_master (id, function_name, status, description) VALUES (?, ?, ?, ?)',
        [id, disc.name, 'active', disc.description]
      );
      console.log('Added:', disc.name);
      added++;
    } else {
      console.log('Already exists:', disc.name);
    }
  }
  
  console.log('\nTotal added:', added);
  
  // Show final count
  const [final] = await pool.execute('SELECT COUNT(*) as count FROM functions_master');
  console.log('Total disciplines now:', final[0].count);
  
  await pool.end();
}

addDisciplines().catch(console.error);
