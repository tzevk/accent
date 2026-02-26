import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'abornedata',
  port: process.env.DB_PORT || 3306
});

async function main() {
  const db = await pool.getConnection();

  // 1. What months have slips?
  const [months] = await db.execute('SELECT DISTINCT month FROM payroll_slips ORDER BY month DESC');
  console.log('Available months:', months.map(r => r.month));

  // 2. Month column type
  const [cols] = await db.execute("SHOW COLUMNS FROM payroll_slips LIKE 'month'");
  console.log('Month column type:', cols[0]);

  // 3. Sample raw month values
  const [samples] = await db.execute('SELECT id, month, CAST(month AS CHAR) as month_str FROM payroll_slips LIMIT 3');
  console.log('Sample month values:', samples);

  // 4. Count with 2025-03-01
  const [r1] = await db.execute("SELECT COUNT(*) as cnt FROM payroll_slips WHERE month = '2025-03-01'");
  console.log('Match 2025-03-01:', r1[0].cnt);

  // 5. Count with LIKE
  const [r2] = await db.execute("SELECT COUNT(*) as cnt FROM payroll_slips WHERE CAST(month AS CHAR) LIKE '2025-03%'");
  console.log('Match LIKE 2025-03%:', r2[0].cnt);

  // 6. Salary profiles
  const [profiles] = await db.execute('SELECT COUNT(*) as cnt, salary_type, is_active FROM employee_salary_profile GROUP BY salary_type, is_active');
  console.log('Salary profiles:', profiles);

  // 7. Payroll export query (NOT EXISTS contract)
  const [payrollResult] = await db.execute(`
    SELECT COUNT(*) as cnt
    FROM payroll_slips ps
    JOIN employees e ON e.id = ps.employee_id
    WHERE ps.month = '2025-03-01'
    AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')
  `);
  console.log('Export payroll query (NOT EXISTS contract):', payrollResult[0].cnt);

  // 8. Contract export query (EXISTS contract)
  const [contractResult] = await db.execute(`
    SELECT COUNT(*) as cnt
    FROM payroll_slips ps
    JOIN employees e ON e.id = ps.employee_id
    WHERE ps.month = '2025-03-01'
    AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')
  `);
  console.log('Export contract query (EXISTS contract):', contractResult[0].cnt);

  // 9. No filter
  const [nofilter] = await db.execute(`
    SELECT COUNT(*) as cnt
    FROM payroll_slips ps
    JOIN employees e ON e.id = ps.employee_id
    WHERE ps.month = '2025-03-01'
  `);
  console.log('No filter result:', nofilter[0].cnt);

  // 10. Check latest month
  const [latest] = await db.execute('SELECT month, COUNT(*) as cnt FROM payroll_slips GROUP BY month ORDER BY month DESC LIMIT 5');
  console.log('Latest months with counts:', latest);

  db.release();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
