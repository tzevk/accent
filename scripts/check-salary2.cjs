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

  const [slips] = await db.execute(`
    SELECT ps.*, e.employee_id as emp_code 
    FROM payroll_slips ps 
    JOIN employees e ON e.id = ps.employee_id 
    WHERE e.employee_id = 'ATS0001' 
    ORDER BY ps.month DESC LIMIT 3
  `);
  
  if (slips.length > 0) {
    for (const slip of slips) {
      console.log('=== Payroll Slip for', slip.month, '===');
      console.log('gross:', slip.gross);
      console.log('basic:', slip.basic);
      console.log('da:', slip.da);
      console.log('da_used:', slip.da_used);
      console.log('hra:', slip.hra);
      console.log('conveyance:', slip.conveyance);
      console.log('call_allowance:', slip.call_allowance);
      console.log('other_allowances:', slip.other_allowances);
      console.log('bonus:', slip.bonus);
      console.log('incentive:', slip.incentive);
      console.log('total_earnings:', slip.total_earnings);
      console.log('pf_employee:', slip.pf_employee);
      console.log('esic_employee:', slip.esic_employee);
      console.log('pt:', slip.pt);
      console.log('total_deductions:', slip.total_deductions);
      console.log('net_pay:', slip.net_pay);
      console.log('full_month_gross:', slip.full_month_gross);
      console.log('standard_working_days:', slip.standard_working_days);
      console.log('days_present:', slip.days_present);
      console.log('payable_days:', slip.payable_days);
      console.log('lop_days:', slip.lop_days);
    }
  } else {
    console.log('No payroll slips found for ATS0001');
  }

  const [das] = await db.execute('SELECT * FROM da_schedule ORDER BY effective_from DESC');
  console.log('\n=== All DA Schedules ===');
  das.forEach(d => {
    console.log('id=' + d.id + ' amount=' + d.da_amount + ' from=' + d.effective_from + ' to=' + d.effective_to + ' active=' + d.is_active);
  });

  db.release();
  await pool.end();
})();
