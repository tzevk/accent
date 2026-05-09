const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 2
  });
  const db = await pool.getConnection();

  // Find employee ATS0001
  const [emp] = await db.execute("SELECT id, employee_id, first_name, last_name FROM employees WHERE employee_id = 'ATS0001'");
  console.log('Employee:', JSON.stringify(emp[0]));
  const empId = emp[0].id;

  // Check salary_structures
  const [ss] = await db.execute('SELECT * FROM salary_structures WHERE employee_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1', [empId]);
  if (ss.length > 0) {
    console.log('\n=== salary_structures ===');
    console.log('ctc:', ss[0].ctc);
    console.log('gross_salary:', ss[0].gross_salary);
    console.log('basic_salary:', ss[0].basic_salary);
    console.log('basic:', ss[0].basic);
    console.log('da:', ss[0].da);
    console.log('hra:', ss[0].hra);
    console.log('conveyance:', ss[0].conveyance);
    console.log('call_allowance:', ss[0].call_allowance);
    console.log('other_allowances:', ss[0].other_allowances);
    console.log('pf_applicable:', ss[0].pf_applicable);
    console.log('esic_applicable:', ss[0].esic_applicable);
    console.log('pt_applicable:', ss[0].pt_applicable);
  } else {
    console.log('\nNo salary_structures found');
  }

  // Check employee_salary_profile
  const [esp] = await db.execute('SELECT * FROM employee_salary_profile WHERE employee_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1', [empId]);
  if (esp.length > 0) {
    console.log('\n=== employee_salary_profile ===');
    console.log('gross_salary:', esp[0].gross_salary);
    console.log('basic:', esp[0].basic);
    console.log('basic_plus_da:', esp[0].basic_plus_da);
    console.log('da:', esp[0].da);
    console.log('hra:', esp[0].hra);
    console.log('conveyance:', esp[0].conveyance);
    console.log('call_allowance:', esp[0].call_allowance);
    console.log('other_allowances:', esp[0].other_allowances);
    console.log('bonus:', esp[0].bonus);
    console.log('incentive:', esp[0].incentive);
    console.log('total_earnings:', esp[0].total_earnings);
    console.log('total_deductions:', esp[0].total_deductions);
    console.log('net_pay:', esp[0].net_pay);
    console.log('employer_cost:', esp[0].employer_cost);
    console.log('pf_employee:', esp[0].pf_employee);
    console.log('esic_employee:', esp[0].esic_employee);
    console.log('pt:', esp[0].pt);
    console.log('retention:', esp[0].retention);
    console.log('insurance:', esp[0].insurance);
    console.log('salary_type:', esp[0].salary_type);
  } else {
    console.log('\nNo employee_salary_profile found');
  }

  // Check current DA schedule
  const [da] = await db.execute("SELECT * FROM da_schedule WHERE is_active = 1 ORDER BY effective_from DESC LIMIT 1");
  console.log('\n=== DA Schedule ===');
  console.log(da.length > 0 ? JSON.stringify(da[0]) : 'No DA schedule found');

  // Check if there are any payroll slips now
  const [slips] = await db.execute('SELECT COUNT(*) as cnt FROM payroll_slips');
  console.log('\nPayroll slips count:', slips[0].cnt);

  db.release();
  await pool.end();
})();
