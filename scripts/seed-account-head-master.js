// Script to seed initial account heads into account_head_master
// Run with: node scripts/seed-account-head-master.js

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const accountHeads = [
	'Salaries & Wages',
	'Bonus & Incentives',
	'Staff Welfare Expenses',
	'Professional Fees',
	'Consultancy Charges',
	'Legal Fees',
	'Audit Fees',
	'Training & Development Expenses',
	'Office Rent',
	'Electricity Charges',
	'Water Charges',
	'Internet & Broadband Charges',
	'Telephone & Mobile Expenses',
	'Office Maintenance',
	'Repair and Maintenance',
	'Housekeeping Expenses',
	'Security Services',
	'Cleaning Material',
	'Printing & Stationery',
	'Courier & Postage',
	'Local Conveyance',
	'Domestic Travel Expenses',
	'International Travel Expenses',
	'Hotel & Accommodation Expenses',
	'Vehicle Fuel Expenses',
	'Vehicle Maintenance',
	'Toll & Parking Charges',
	'Advertisement Expenses',
	'Digital Marketing Expenses',
	'Business Promotion Expenses',
	'Exhibition & Event Expenses',
	'Website Development & Maintenance',
	'Software Subscription Charges',
	'ERP Software Expenses',
	'Computer Repairs & Maintenance',
	'Project Expenses',
	'Site Expenses',
	'Student Training Material Expenses',
	'Student Welfare Expenses',
	'Bank Charges',
	'Interest on Loan',
	'Interest on Cash Credit/Overdraft',
	'Loan Processing Charges',
	'Insurance Expenses',
	'GST Consultant Fees',
	'ROC Filing Fees',
	'Government License & Registration Fees',
	'Trade License Renewal Fees',
	'Membership & Subscription Fees',
	'Depreciation',
	'Bad Debts Written Off',
	'Donations & CSR Expenses',
	'Miscellaneous Business Expenses',
	'Repairs & Maintenance – Office Equipment',
	'Repairs & Maintenance – Furniture & Fixtures',
	'Repairs & Maintenance – Computers',
	'Repairs & Maintenance – Vehicles',
	'Repair & Maintenance – Plant & Machinery',
	'Staff Uniform Expenses',
	'Photography & Videography Expenses',
	'License Renewal Expenses',
	'Domain Registration Charges',
	'Penalty & Late Fees',
	'Tender & Bid Expenses',
	'Business Development Expenses',
	'Other Administrative Expenses',
];

async function seedAccountHeads() {
	const connection = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
	});

	console.log('Connected to database. Seeding account heads...\n');

	await connection.execute(`
    CREATE TABLE IF NOT EXISTS account_head_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      account_head_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

	let inserted = 0;
	let skipped = 0;

	for (const name of accountHeads) {
		try {
			await connection.execute(
				`INSERT INTO account_head_master (account_head_name, is_active)
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

seedAccountHeads().catch(console.error);
