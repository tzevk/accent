/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve('.env.local') });

async function inspectDatabase() {
  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;
  if (!DB_HOST || !DB_NAME || !DB_USER) {
    console.error('Missing database env vars. Check .env.local.');
    process.exit(1);
  }

  try {
    const connection = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT ? Number(DB_PORT) : 3306,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    });

    console.log(`Connected to ${DB_NAME}`);

    const [tables] = await connection.query('SHOW TABLES');
    const tableNames = tables.map((row) => Object.values(row)[0]);

    for (const table of tableNames) {
      console.log(`\n=== ${table} ===`);
      const [columns] = await connection.query(`SHOW FULL COLUMNS FROM \`${table}\``);
      columns.forEach((column) => {
        console.log(
          `${column.Field}\t${column.Type}\t${column.Null}\t${column.Key}\t${column.Default ?? ''}`
        );
      });
    }

    await connection.end();
  } catch (error) {
    console.error('Failed to inspect database:', error.message);
    process.exit(1);
  }
}

inspectDatabase();
