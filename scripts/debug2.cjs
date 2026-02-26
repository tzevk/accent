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

  const [months] = await db.execute('SELECT month, COUNT(*) as cnt FROM payroll_slips GROUP BY month ORDER BY month DESC LIMIT 5');
  console.log('MONTHS:', JSON.stringify(months));

  const [profiles] = await db.execute('SELECT salary_type, is_active, COUNT(*) as cnt FROM employee_salary_profile GROUP BY salary_type, is_active');
  console.log('PROFILES:', JSON.stringify(profiles));

  const [total] = await db.execute('SELECT COUNT(*) as cnt FROM payroll_slips');
  console.log('TOTAL_SLIPS:', total[0].cnt);

  const [allEmps] = await db.execute('SELECT COUNT(DISTINCT employee_id) as cnt FROM payroll_slips');
  console.log('UNIQUE_EMPS:', allEmps[0].cnt);

  // Check the NOT EXISTS query without month filter
  const [payrollNoMonth] = await db.execute('SELECT COUNT(*) as cnt FROM payroll_slips ps JOIN employees e ON e.id = ps.employee_id WHERE NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = \'contract\')');
  console.log('PAYROLL_NO_MONTH:', payrollNoMonth[0].cnt);

  // Check with month filter for recent months
  const [payroll202503] = await db.execute('SELECT COUNT(*) as cnt FROM payroll_slips ps JOIN employees e ON e.id = ps.employee_id WHERE ps.month = \'2025-03-01\' AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = \'contract\')');
  console.log('PAYROLL_2025_03:', payroll202503[0].cnt);

  db.release();
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
