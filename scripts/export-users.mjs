import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import mysql from 'mysql2/promise';
import ExcelJS from 'exceljs';
import path from 'path';

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    const [rows] = await connection.execute(
      `SELECT full_name, username FROM users ORDER BY full_name, username`
    );

    console.log(`Found ${rows.length} users`);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Users');

    sheet.columns = [
      { header: 'Name', key: 'full_name', width: 30 },
      { header: 'Username', key: 'username', width: 25 },
      { header: 'Password', key: 'password', width: 25 },
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9E1F2' },
    };

    for (const row of rows) {
      const name = row.full_name || row.username || '';
      const firstName = name.split(' ')[0].toLowerCase();
      const password = firstName ? `${firstName}@001` : '';
      sheet.addRow({
        full_name: row.full_name || '',
        username: row.username || '',
        password,
      });
    }

    const outPath = path.resolve('public', 'users.xlsx');
    await workbook.xlsx.writeFile(outPath);
    console.log(`Excel file saved to ${outPath}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
