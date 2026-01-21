/**
 * Script to add SmartOffice columns (EmployeeCode, DeviceCode, Status) to employees table
 * Matches employees by first name from employee.csv
 * 
 * Usage: node scripts/sync-smartoffice-codes.cjs
 */

require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function main() {
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306
  };

  console.log(`Connecting to database ${config.database} on ${config.host}...`);
  
  const connection = await mysql.createConnection(config);
  
  try {
    // Step 1: Add columns if they don't exist
    console.log('\n📦 Checking/adding required columns...');
    
    const columnsToAdd = [
      { name: 'smartoffice_code', type: 'VARCHAR(50) NULL' },
      { name: 'device_code', type: 'VARCHAR(50) NULL' },
      { name: 'smartoffice_status', type: 'VARCHAR(50) NULL' }
    ];
    
    for (const col of columnsToAdd) {
      try {
        await connection.execute(`ALTER TABLE employees ADD COLUMN ${col.name} ${col.type}`);
        console.log(`   ✅ Added column: ${col.name}`);
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          console.log(`   ⏭️  Column already exists: ${col.name}`);
        } else {
          throw err;
        }
      }
    }

    // Step 2: Read CSV file
    console.log('\n📄 Reading employee.csv...');
    const csvPath = path.join(__dirname, '..', 'public', 'employee.csv');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.trim().split('\n');
    
    // Skip header line (first line is timestamp, second is header)
    const dataLines = lines.slice(2);
    
    const csvData = dataLines.map(line => {
      const [employeeCode, employeeName, deviceCode, status] = line.split(',').map(s => s.trim());
      return { employeeCode, employeeName, deviceCode, status };
    }).filter(d => d.employeeCode && d.employeeName);
    
    console.log(`   Found ${csvData.length} employees in CSV`);

    // Step 3: Get existing employees from database
    const [dbEmployees] = await connection.execute(`
      SELECT id, employee_id, first_name, last_name, 
             CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as full_name,
             biometric_code, smartoffice_code, device_code, smartoffice_status
      FROM employees
    `);
    
    console.log(`   Found ${dbEmployees.length} employees in database`);

    // Step 4: Match and update
    console.log('\n🔄 Matching and updating employees...\n');
    
    let matched = 0;
    let updated = 0;
    let notFound = [];

    for (const csvEmp of csvData) {
      // Try to find matching employee by name
      const csvNameLower = csvEmp.employeeName.toLowerCase().replace(/[^a-z\s]/g, '').trim();
      const csvFirstName = csvNameLower.split(' ')[0];
      
      let dbEmp = null;
      
      // Try exact full name match first
      dbEmp = dbEmployees.find(e => 
        e.full_name.toLowerCase().replace(/[^a-z\s]/g, '').trim() === csvNameLower
      );
      
      // Try first name match
      if (!dbEmp) {
        dbEmp = dbEmployees.find(e => 
          e.first_name && e.first_name.toLowerCase().replace(/[^a-z\s]/g, '').trim() === csvFirstName
        );
      }
      
      // Try partial match
      if (!dbEmp) {
        dbEmp = dbEmployees.find(e => {
          const dbNameLower = e.full_name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
          return dbNameLower.includes(csvFirstName) || csvNameLower.includes(dbNameLower.split(' ')[0]);
        });
      }

      if (!dbEmp) {
        notFound.push(csvEmp.employeeName);
        continue;
      }

      matched++;
      
      // Check if update needed
      const needsUpdate = 
        dbEmp.smartoffice_code !== csvEmp.employeeCode ||
        dbEmp.device_code !== csvEmp.deviceCode ||
        dbEmp.smartoffice_status !== csvEmp.status ||
        dbEmp.biometric_code !== csvEmp.employeeCode;
      
      if (needsUpdate) {
        await connection.execute(`
          UPDATE employees 
          SET smartoffice_code = ?,
              device_code = ?,
              smartoffice_status = ?,
              biometric_code = ?,
              updated_at = NOW()
          WHERE id = ?
        `, [csvEmp.employeeCode, csvEmp.deviceCode, csvEmp.status, csvEmp.employeeCode, dbEmp.id]);
        
        console.log(`✅ ${csvEmp.employeeName} → ${dbEmp.full_name.trim()} (ID: ${dbEmp.id})`);
        console.log(`   Code: ${csvEmp.employeeCode}, Device: ${csvEmp.deviceCode}, Status: ${csvEmp.status}`);
        updated++;
      } else {
        console.log(`⏭️  ${csvEmp.employeeName} (already up to date)`);
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`   CSV Employees: ${csvData.length}`);
    console.log(`   Matched: ${matched}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Not found: ${notFound.length}`);
    
    if (notFound.length > 0) {
      console.log('\n❌ Employees not found in database:');
      notFound.forEach(name => console.log(`   - ${name}`));
    }
    
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
