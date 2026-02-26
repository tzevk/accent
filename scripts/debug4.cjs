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

  // salary_structures pay_type values
  const [ssPayTypes] = await db.execute('SELECT pay_type, is_active, COUNT(*) as cnt FROM salary_structures GROUP BY pay_type, is_active');
  console.log('SS_PAY_TYPES:', JSON.stringify(ssPayTypes));

  // Per-employee salary_structures for employees with payroll slips
  const [ssEmps] = await db.execute('SELECT ss.employee_id, ss.pay_type, ss.is_active FROM salary_structures ss WHERE ss.employee_id IN (SELECT employee_id FROM payroll_slips) ORDER BY ss.employee_id');
  console.log('SS_FOR_SLIP_EMPS:', JSON.stringify(ssEmps));

  // Per-employee employee_salary_profile types for employees with payroll slips
  const [espEmps] = await db.execute('SELECT esp.employee_id, GROUP_CONCAT(DISTINCT esp.salary_type) as types FROM employee_salary_profile esp WHERE esp.is_active = 1 AND esp.employee_id IN (SELECT employee_id FROM payroll_slips) GROUP BY esp.employee_id');
  console.log('ESP_FOR_SLIP_EMPS:', JSON.stringify(espEmps));

  // All employee_salary_profile types for ALL employees
  const [allEsp] = await db.execute('SELECT esp.employee_id, GROUP_CONCAT(DISTINCT esp.salary_type) as types FROM employee_salary_profile esp WHERE esp.is_active = 1 GROUP BY esp.employee_id');
  console.log('ALL_ESP_TYPES:', JSON.stringify(allEsp.slice(0, 20)));
  console.log('ALL_ESP_COUNT:', allEsp.length);

  // How many employees have ONLY contract profile (no monthly/hourly/etc)
  const [onlyContract] = await db.execute("SELECT COUNT(DISTINCT esp.employee_id) as cnt FROM employee_salary_profile esp WHERE esp.is_active = 1 AND esp.salary_type = 'contract' AND esp.employee_id NOT IN (SELECT DISTINCT employee_id FROM employee_salary_profile WHERE is_active = 1 AND salary_type != 'contract')");
  console.log('ONLY_CONTRACT_EMPLOYEES:', onlyContract[0].cnt);

  // How many employees in salary_structures with pay_type = 'contract'
  const [ssContract] = await db.execute("SELECT COUNT(DISTINCT employee_id) as cnt FROM salary_structures WHERE is_active = 1 AND pay_type = 'contract'");
  console.log('SS_CONTRACT:', ssContract[0].cnt);

  db.release();
  await pool.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
