const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: '115.124.106.101',
    user: 'tk',
    password: '8F?m3xh32',
    database: 'crmaccent',
    port: 3306
  });

  const db = await pool.getConnection();

  // Check salary_structures table
  const [ssCols] = await db.execute('SHOW COLUMNS FROM salary_structures');
  console.log('SALARY_STRUCTURES_COLS:', ssCols.map(c => c.Field).join(', '));

  // Check payroll_slips columns
  const [psCols] = await db.execute('SHOW COLUMNS FROM payroll_slips');
  console.log('PAYROLL_SLIPS_COLS:', psCols.map(c => c.Field).join(', '));

  // Check if payroll_slips has salary_type
  const [psType] = await db.execute("SHOW COLUMNS FROM payroll_slips LIKE 'salary_type'");
  console.log('PS_HAS_SALARY_TYPE:', psType.length > 0);

  // Check salary structures data
  const [ssData] = await db.execute('SELECT salary_type, is_active, COUNT(*) as cnt FROM salary_structures GROUP BY salary_type, is_active');
  console.log('SALARY_STRUCTURES:', JSON.stringify(ssData));

  // Check per-employee profile types
  const [multiProfiles] = await db.execute('SELECT esp.employee_id, GROUP_CONCAT(esp.salary_type) as types FROM employee_salary_profile esp WHERE esp.is_active = 1 GROUP BY esp.employee_id LIMIT 15');
  console.log('EMPLOYEE_PROFILES:', JSON.stringify(multiProfiles));

  // Check if the 12 payroll slip employees are in salary_structures
  const [ssEmps] = await db.execute('SELECT DISTINCT ss.employee_id, ss.salary_type FROM salary_structures ss WHERE ss.is_active = 1 AND ss.employee_id IN (SELECT employee_id FROM payroll_slips) ORDER BY ss.employee_id');
  console.log('SS_FOR_SLIP_EMPS:', JSON.stringify(ssEmps));

  // Sample payroll slip
  const [sampleSlip] = await db.execute('SELECT * FROM payroll_slips LIMIT 1');
  console.log('SAMPLE_SLIP_KEYS:', Object.keys(sampleSlip[0]).join(', '));
  console.log('SAMPLE_SLIP:', JSON.stringify(sampleSlip[0]));

  db.release();
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
