// Script to insert 2026 holidays directly into the database
// Run with: node insert-holidays-2026.js

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const holidays2026 = [
  { name: 'New Year', date: '2026-01-01', type: 'national', description: 'New Year is the time or day at which a new calendar year begins.' },
  { name: 'Republic Day of India', date: '2026-01-26', type: 'national', description: 'Republic Day honours the date on which the Constitution of India came into effect on 26 January 1950.' },
  { name: 'Holi - Rang Panchami', date: '2026-03-03', type: 'religious', description: 'Holi is a Hindu spring festival, originating from the Indian subcontinent.' },
  { name: 'Gudhi Padwa', date: '2026-03-19', type: 'religious', description: 'The Gudhi is said to represent the flag of Brahma as mentioned in the Brahma Purana.' },
  { name: 'Ramzan ID', date: '2026-03-21', type: 'religious', description: 'Ramzan is a sacred time of the year for millions of Muslims all over the world.' },
  { name: 'Maharashtra Day', date: '2026-05-01', type: 'regional', description: 'Maharashtra Day commemorating the formation of the state of Maharashtra.' },
  { name: 'Independence Day', date: '2026-08-15', type: 'national', description: 'Independence Day is celebrated on 15 August as a national holiday in India.' },
  { name: 'Ganesh Chaturthi', date: '2026-09-14', type: 'religious', description: 'Ganesh Chaturthi is a Hindu festival celebrating the birth of Lord Ganesha.' },
  { name: 'Anant Chaturdashi', date: '2026-09-25', type: 'religious', is_optional: true, description: 'Anant Chaturdashi - Half Day 8:00 am to 1:30 pm.' },
  { name: 'Gandhi Jayanti', date: '2026-10-02', type: 'national', description: 'Gandhi Jayanti is a national festival celebrated to mark the birth anniversary of Mahatma Gandhi.' },
  { name: 'Dussehra', date: '2026-10-20', type: 'religious', description: 'Vijayadashami celebrations include processions to a river or ocean front.' },
  { name: 'Deepawali', date: '2026-11-08', type: 'religious', description: 'Diwali is the Hindu festival of lights.' },
  { name: 'Deepawali (Day 2)', date: '2026-11-11', type: 'religious', description: 'Second day of Diwali celebrations.' },
  { name: 'Christmas', date: '2026-12-25', type: 'religious', description: 'Christmas commemorates the birth of Jesus Christ.' }
];

async function insertHolidays() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  console.log('Connected to database. Inserting 2026 holidays...\n');

  // Ensure table exists
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS holiday_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      date DATE NOT NULL,
      type ENUM('national', 'religious', 'regional', 'company', 'optional') DEFAULT 'national',
      is_optional BOOLEAN DEFAULT FALSE,
      description TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_holiday_date (name, date)
    )
  `);

  for (const holiday of holidays2026) {
    try {
      await connection.execute(
        `INSERT INTO holiday_master (name, date, type, is_optional, description, is_active) 
         VALUES (?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE 
           type = VALUES(type),
           is_optional = VALUES(is_optional),
           description = VALUES(description),
           is_active = TRUE`,
        [holiday.name, holiday.date, holiday.type, holiday.is_optional || false, holiday.description]
      );
      console.log(`✓ ${holiday.name} (${holiday.date})`);
    } catch (err) {
      console.log(`✗ ${holiday.name} - ${err.message}`);
    }
  }

  await connection.end();
  console.log('\n✓ Done! Refresh your attendance page to see holidays marked as "H".');
}

insertHolidays().catch(console.error);
