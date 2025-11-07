import dotenv from 'dotenv';
import { dbConnect } from '../src/utils/database.js';

// Load .env.local or .env
import fs from 'fs/promises';
import path from 'path';
const envLocal = path.resolve(process.cwd(), '.env.local');
const envDefault = path.resolve(process.cwd(), '.env');
try { await fs.access(envLocal); dotenv.config({ path: envLocal }); } catch { dotenv.config({ path: envDefault }); }

async function main() {
  const conn = await dbConnect();
  try {
    // Ensure base employees table exists (non-destructive)
    await conn.execute(`CREATE TABLE IF NOT EXISTS employees (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id VARCHAR(50) UNIQUE NOT NULL,
      first_name VARCHAR(50) NOT NULL,
      last_name VARCHAR(50) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      phone VARCHAR(50),
      department VARCHAR(100),
      position VARCHAR(100),
      hire_date DATE,
      salary DECIMAL(12,2),
      status VARCHAR(50) DEFAULT 'active',
      manager_id INT,
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100),
      pin VARCHAR(20),
      personal_email VARCHAR(255),
      profile_photo_url VARCHAR(255),
      bonus_eligible TINYINT(1) DEFAULT 0,
      stat_pf TINYINT(1) DEFAULT 0,
      stat_mlwf TINYINT(1) DEFAULT 0,
      stat_pt TINYINT(1) DEFAULT 0,
      stat_esic TINYINT(1) DEFAULT 0,
      stat_tds TINYINT(1) DEFAULT 0,
      qualification VARCHAR(150),
      institute VARCHAR(150),
      passing_year VARCHAR(4),
      work_experience TEXT,
      bank_account_no VARCHAR(50),
      bank_ifsc VARCHAR(50),
      bank_name VARCHAR(150),
      bank_branch VARCHAR(150),
      account_holder_name VARCHAR(150),
      pan VARCHAR(50),
      aadhar VARCHAR(50),
      gratuity_no VARCHAR(50),
      uan VARCHAR(50),
      esi_no VARCHAR(50),
      attendance_id VARCHAR(50),
      biometric_code VARCHAR(50),
      exit_date DATE,
      exit_reason TEXT,
      notes TEXT,
      username VARCHAR(50),
      role VARCHAR(150),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);

    // Determine next ATS id
    const [rows] = await conn.execute("SELECT employee_id FROM employees WHERE employee_id LIKE 'ATS%'");
    let maxNum = 0;
    for (const r of rows) {
      const m = String(r.employee_id || '').match(/ATS0*(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
      }
    }
    const next = String(maxNum + 1).padStart(3, '0');
    const employeeId = `ATS${next}`;

    const payload = {
      employee_id: employeeId,
      first_name: 'Test',
      last_name: `User${next}`,
      email: `test.user${next}@example.com`,
      phone: '+1-555-0100',
      department: 'Engineering',
      position: 'Test Engineer',
      hire_date: new Date().toISOString().slice(0,10),
      salary: 75000,
      status: 'active',
      address: '123 Test Lane',
      city: 'Testville',
      state: 'TS',
      country: 'Testland',
      pin: '123456',
      personal_email: `test.personal${next}@example.com`,
      profile_photo_url: '',
      bonus_eligible: 1,
      stat_pf: 1,
      stat_mlwf: 0,
      stat_pt: 1,
      stat_esic: 0,
      stat_tds: 1,
      qualification: 'B.Tech',
      institute: 'Test University',
      passing_year: '2020',
      work_experience: '3 years at ExampleCorp',
      bank_account_no: '1234567890',
      bank_ifsc: 'TEST000123',
      bank_name: 'Test Bank',
      bank_branch: 'Main',
      account_holder_name: 'Test User',
      pan: 'TESTP1234T',
      aadhar: '123412341234',
      gratuity_no: 'GRT123',
      uan: 'UAN123456',
      esi_no: 'ESI123456',
      attendance_id: 'ATD123',
      biometric_code: 'BIO1234',
      exit_date: null,
      exit_reason: null,
      notes: 'Inserted by test script',
      username: `test.user${next}`,
      role: 'Tester'
    };

    const cols = Object.keys(payload);
    const placeholders = cols.map(() => '?').join(',');
    const vals = cols.map(k => payload[k]);

    const sql = `INSERT INTO employees (${cols.join(',')}) VALUES (${placeholders})`;
    const [res] = await conn.execute(sql, vals);
    console.log('Inserted test employee:', employeeId, 'insertId:', res.insertId);
  } catch (err) {
    console.error('Failed to insert test employee:', err);
  } finally {
    await conn.end();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(err => { console.error(err); process.exit(1); });
}
