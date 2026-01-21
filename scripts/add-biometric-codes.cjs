/**
 * Script to add biometric codes to employees table
 * 
 * Usage:
 *   1. Fill in the EMPLOYEE_BIOMETRIC_MAPPING below with employee_id -> biometric_code pairs
 *   2. Run: node scripts/add-biometric-codes.js
 * 
 * The biometric_code should be the UserId from SmartOffice DeviceLogs
 * (Check /api/smartoffice/list-employees?recent=true for active UserIds)
 */

require('dotenv').config({ path: '.env.local' });
const mysql = require('mysql2/promise');

// ============================================================================
// FILL IN YOUR EMPLOYEE -> BIOMETRIC CODE MAPPING HERE
// Format: { employee_id: 'biometric_code' } or { 'employee_name': 'biometric_code' }
// ============================================================================

const EMPLOYEE_BIOMETRIC_MAPPING = {
  // Example by employee_id:
  // 26: '9135',
  // 56: '9153',
  // 49: '176139',
  
  // Example by employee name (case-insensitive match):
  // 'SIDDHESH MESTRY': '9135',
  // 'PRASHANT AWATE': '9153',
  // 'SAHIL SANDIP MALI': '176139',
};

// ============================================================================
// Alternatively, you can provide a CSV-style list here
// Format: "employee_name,biometric_code" per line
// ============================================================================

const CSV_MAPPING = `
`;
// Example:
// SIDDHESH MESTRY,9135
// PRASHANT AWATE,9153
// SAHIL MALI,176139

// ============================================================================
// SCRIPT LOGIC - Don't modify below unless needed
// ============================================================================

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
    // Parse CSV mapping if provided
    const csvLines = CSV_MAPPING.trim().split('\n').filter(line => line.trim());
    const csvMapping = {};
    csvLines.forEach(line => {
      const [name, code] = line.split(',').map(s => s.trim());
      if (name && code) {
        csvMapping[name.toUpperCase()] = code;
      }
    });

    // Combine both mappings
    const mapping = { ...EMPLOYEE_BIOMETRIC_MAPPING };
    Object.entries(csvMapping).forEach(([name, code]) => {
      mapping[name] = code;
    });

    if (Object.keys(mapping).length === 0) {
      console.log('\n⚠️  No employee-biometric mappings provided!');
      console.log('   Edit this script and fill in EMPLOYEE_BIOMETRIC_MAPPING or CSV_MAPPING');
      
      // Show current employees and their biometric codes
      console.log('\n📋 Current employees with biometric codes:');
      const [employees] = await connection.execute(`
        SELECT id, employee_id, CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as name, biometric_code
        FROM employees 
        WHERE status = 'active'
        ORDER BY first_name, last_name
      `);
      
      console.log('\nID\tEmp ID\t\tName\t\t\t\tBiometric Code');
      console.log('-'.repeat(80));
      employees.forEach(emp => {
        const name = emp.name.trim().padEnd(30);
        const empId = (emp.employee_id || '').padEnd(12);
        const bioCode = emp.biometric_code || '-';
        console.log(`${emp.id}\t${empId}\t${name}\t${bioCode}`);
      });
      
      console.log('\n💡 Get active SmartOffice UserIds from: /api/smartoffice/list-employees?recent=true');
      
      connection.end();
      return;
    }

    console.log(`\n📝 Processing ${Object.keys(mapping).length} employee mappings...\n`);

    // Get all employees
    const [employees] = await connection.execute(`
      SELECT id, employee_id, CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,'')) as name, biometric_code
      FROM employees
    `);

    const employeeById = {};
    const employeeByName = {};
    employees.forEach(emp => {
      employeeById[emp.id] = emp;
      employeeByName[emp.name.trim().toUpperCase()] = emp;
    });

    let updated = 0;
    let skipped = 0;
    let notFound = 0;

    for (const [key, biometricCode] of Object.entries(mapping)) {
      let employee = null;
      
      // Try to find by ID first
      if (!isNaN(key)) {
        employee = employeeById[parseInt(key)];
      }
      
      // Then try by name
      if (!employee) {
        employee = employeeByName[key.toUpperCase()];
      }
      
      // Partial name match
      if (!employee) {
        const upperKey = key.toUpperCase();
        employee = employees.find(e => 
          e.name.toUpperCase().includes(upperKey) || 
          upperKey.includes(e.name.toUpperCase().trim())
        );
      }

      if (!employee) {
        console.log(`❌ Employee not found: "${key}"`);
        notFound++;
        continue;
      }

      if (employee.biometric_code === biometricCode) {
        console.log(`⏭️  Skipped (already set): ${employee.name.trim()} → ${biometricCode}`);
        skipped++;
        continue;
      }

      // Update the employee
      await connection.execute(
        'UPDATE employees SET biometric_code = ?, updated_at = NOW() WHERE id = ?',
        [biometricCode, employee.id]
      );
      
      console.log(`✅ Updated: ${employee.name.trim()} (ID: ${employee.id}) → ${biometricCode}`);
      updated++;
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Summary:`);
    console.log(`   ✅ Updated: ${updated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Not found: ${notFound}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await connection.end();
  }
}

main().catch(console.error);
