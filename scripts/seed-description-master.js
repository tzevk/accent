// Script to seed descriptions into description_master
// Run with: node scripts/seed-description-master.js

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const descriptions = [
	'Tea / Coffee / Beverages',
	'Snacks & Refreshments',
	'Lunch / Dinner Meetings',
	'Client Entertainment',
	'Local Conveyance (Auto / Cab / Bus)',
	'Fuel / Petrol / Diesel',
	'Toll & Parking Charges',
	'Stationery & Office Supplies',
	'Printing & Photocopy',
	'Courier / Postage',
	'Office Grocery & Provisions',
	'Cleaning Materials',
	'Books & Periodicals',
	'Software & Digital Tools',
	'Internet / Dongle Recharge',
	'Mobile Phone Recharge',
	'Medical & Emergency Expenses',
	'Staff Welfare / Team Outing',
	'Small Repairs & Maintenance',
	'Miscellaneous Cash Expenses',
];

async function seedDescriptions() {
	const connection = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
	});

	console.log('Connected to database. Seeding descriptions...\n');

	await connection.execute(`
    CREATE TABLE IF NOT EXISTS description_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      description_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

	let inserted = 0;
	let skipped = 0;

	for (const name of descriptions) {
		try {
			await connection.execute(
				`INSERT INTO description_master (description_name, is_active)
         VALUES (?, TRUE)`,
				[name]
			);
			console.log(`  ✓ ${name}`);
			inserted++;
		} catch (err) {
			if (err.errno === 1062) {
				console.log(`  – ${name} (already exists)`);
				skipped++;
			} else {
				console.log(`  ✗ ${name} - ${err.message}`);
			}
		}
	}

	await connection.end();
	console.log(`\nDone! ${inserted} inserted, ${skipped} skipped.`);
}

seedDescriptions().catch(console.error);
