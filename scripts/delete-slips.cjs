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

  const [del] = await db.execute('DELETE FROM payroll_slips');
  console.log('Deleted payroll slips:', del.affectedRows);

  db.release();
  await pool.end();
})();
