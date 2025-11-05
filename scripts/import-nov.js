import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import Papa from 'papaparse';

// Load environment variables from .env.local first, then fallback to .env
const envLocal = path.resolve(process.cwd(), '.env.local');
const envDefault = path.resolve(process.cwd(), '.env');
if (fs) {
  try {
    // prefer .env.local if present
    await fs.access(envLocal);
    dotenv.config({ path: envLocal });
  } catch {
    dotenv.config({ path: envDefault });
  }
}

import { dbConnect } from '../src/utils/database.js';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

async function parseCSVFile(filePath) {
  const raw = await fs.readFile(filePath, { encoding: 'utf8' });
  const parsed = Papa.parse(raw, { header: true, skipEmptyLines: true });
  if (parsed.errors && parsed.errors.length > 0) {
    console.warn('CSV parse warnings/errors:', parsed.errors.slice(0,5));
  }
  return parsed.data;
}

function normalizeHeaderLookup(row) {
  // lower-case keys trimmed for flexible lookup
  const map = {};
  for (const k of Object.keys(row)) {
    map[k.trim().toLowerCase()] = k;
  }
  return (names) => {
    for (const n of names) {
      const key = n.trim().toLowerCase();
      if (map[key]) return map[key];
    }
    return null;
  };
}

function safeNum(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (s === '') return null;
  const n = Number(s.replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const csvPath = path.resolve(process.cwd(), 'nov.csv');
  try {
    await fs.access(csvPath);
  } catch {
    console.error('Could not find nov.csv at project root. Expected at:', csvPath);
    process.exit(1);
  }

  const rows = await parseCSVFile(csvPath);
  if (!rows || rows.length === 0) {
    console.error('No rows found in nov.csv');
    process.exit(1);
  }

  // Use the first row to build flexible header lookups
  const keyFor = normalizeHeaderLookup(rows[0]);
  const employeeCodeKey = keyFor(['Employee Code', 'EmployeeCode', 'Emp Code', 'Code']);
  const fullNameKey = keyFor(['Full Name', 'FullName', 'Name', 'Employee Name']);
  const basicKey = keyFor(['BASIC', 'Basic', 'basic']);
  const daKey = keyFor(['DA', 'da']);
  const hraKey = keyFor(['HRA', 'hra']);
  const conveyKey = keyFor(['CONVEYANCE ALLOWANCE','Conveyance Allowance','CONVEYANCE','conveyance']);
  const callKey = keyFor(['CALL ALLOWANCE','Call Allowance','call_allowance']);
  const otherKey = keyFor(['OTHER ALLOWANCE','Other Allowance','other_allowance']);
  const grossKey = keyFor(['GROSS','Gross','gross']);

  if (!employeeCodeKey) {
    console.error('Could not find Employee Code column in CSV. Available columns:', Object.keys(rows[0]));
    process.exit(1);
  }

  const conn = await dbConnect();

  // Ensure minimal employees table exists so we can create placeholder employees when missing
  try {
    await conn.execute(`CREATE TABLE IF NOT EXISTS employees (
      id INT PRIMARY KEY AUTO_INCREMENT,
      employee_id VARCHAR(50) UNIQUE NOT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) DEFAULT '',
      email VARCHAR(255) UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
  } catch (err) {
    console.warn('Could not ensure employees table exists:', err.message || err);
  }

  // Ensure minimal salary_master exists (non-destructive)
  await conn.execute(`CREATE TABLE IF NOT EXISTS salary_master (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    effective_from DATE NOT NULL,
    salary_type VARCHAR(20) DEFAULT 'Monthly',
    basic_salary DECIMAL(12,2) DEFAULT 0,
    da DECIMAL(12,2) DEFAULT NULL,
    hra DECIMAL(12,2) DEFAULT NULL,
    conveyance DECIMAL(12,2) DEFAULT NULL,
    call_allowance DECIMAL(12,2) DEFAULT NULL,
    other_allowance DECIMAL(12,2) DEFAULT NULL,
    gross_salary DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  // Make sure required columns exist (for older DBs that have a different schema)
  try {
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS basic_salary DECIMAL(12,2) DEFAULT 0');
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS da DECIMAL(12,2) DEFAULT NULL');
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS hra DECIMAL(12,2) DEFAULT NULL');
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS conveyance DECIMAL(12,2) DEFAULT NULL');
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS call_allowance DECIMAL(12,2) DEFAULT NULL');
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS other_allowance DECIMAL(12,2) DEFAULT NULL');
    await conn.execute('ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS gross_salary DECIMAL(12,2) DEFAULT 0');
  } catch (err) {
    // Non-fatal: some MySQL versions may not support IF NOT EXISTS on ALTER COLUMN
    console.warn('Could not ensure salary_master columns exist (ALTER TABLE may not be supported):', err.message || err);
  }

  // Determine effective_from as first day of current month
  const now = new Date();
  const effFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const effFromStr = effFrom.toISOString().slice(0,10);

  let inserted = 0;
  let skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const employeeCode = r[employeeCodeKey] ? String(r[employeeCodeKey]).trim() : '';
    if (!employeeCode) {
      skipped++;
      errors.push(`Row ${i+2}: missing employee code`);
      continue;
    }

    // Look up employee by employee_id; if not found, create a placeholder employee
    let employeeFound = true;
    try {
      const [found] = await conn.execute('SELECT employee_id FROM employees WHERE employee_id = ? LIMIT 1', [employeeCode]);
      if (!found || found.length === 0) {
        employeeFound = false;
      }
    } catch (err) {
      errors.push(`Row ${i+2}: DB lookup error for ${employeeCode}: ${err.message}`);
      skipped++;
      continue;
    }

    if (!employeeFound) {
      // Create placeholder employee using Full Name if available
      let rawName = fullNameKey && r[fullNameKey] ? String(r[fullNameKey]).trim() : '';
      let firstName = 'Unknown';
      let lastName = '';
      if (rawName) {
        const parts = rawName.split(' ').filter(Boolean);
        firstName = parts.shift() || 'Unknown';
        lastName = parts.join(' ') || employeeCode;
      } else {
        lastName = employeeCode;
      }

      const emailLocal = `${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}.${(lastName || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      const placeholderEmail = `${emailLocal || employeeCode.toLowerCase()}@accentcrm.com`;

      try {
        await conn.execute(
          `INSERT INTO employees (employee_id, first_name, last_name, email) VALUES (?, ?, ?, ?)`,
          [employeeCode, firstName, lastName, placeholderEmail]
        );
        // proceed — placeholder created
      } catch {
        // If insert failed (e.g., unique email collision), try without email
        try {
          await conn.execute(
            `INSERT INTO employees (employee_id, first_name, last_name) VALUES (?, ?, ?)`,
            [employeeCode, firstName, lastName]
          );
        } catch (err2) {
          errors.push(`Row ${i+2}: failed to create placeholder employee for ${employeeCode}: ${err2.message}`);
          skipped++;
          continue;
        }
      }
    }

    const basic = safeNum(basicKey ? r[basicKey] : null) || 0;
    const da = safeNum(daKey ? r[daKey] : null) || null;
    const hra = safeNum(hraKey ? r[hraKey] : null) || null;
    const convey = safeNum(conveyKey ? r[conveyKey] : null) || null;
    const callAllowance = safeNum(callKey ? r[callKey] : null) || null;
    const other = safeNum(otherKey ? r[otherKey] : null) || null;
    const gross = safeNum(grossKey ? r[grossKey] : null) || null;

    const id = randomUUID();
    try {
      await conn.execute(
        `INSERT INTO salary_master (id, employee_id, effective_from, salary_type, basic_salary, da, hra, conveyance, call_allowance, other_allowance, gross_salary)
         VALUES (?, ?, ?, 'Monthly', ?, ?, ?, ?, ?, ?, ?)`,
        [id, employeeCode, effFromStr, basic, da, hra, convey, callAllowance, other, gross]
      );
      inserted++;
    } catch (err) {
      errors.push(`Row ${i+2}: failed to insert for ${employeeCode}: ${err.message}`);
      skipped++;
    }
  }

  await conn.end();

  console.log('Import complete. Summary:');
  console.log('Total rows:', rows.length);
  console.log('Inserted:', inserted);
  console.log('Skipped:', skipped);
  if (errors.length > 0) console.log('Errors (first 20):\n', errors.slice(0,20).join('\n'));
}

// ESM-compatible entrypoint detection. When run directly (node scripts/import-nov.js)
// process.argv[1] equals the resolved path of this module.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
}
