// Script to seed initial categories into category_master
// Run with: node scripts/seed-category-master.js

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });
console.log('DB_HOST:', process.env.DB_HOST);

const categories = [
	'Cash in Hand',
	'Petty Cash',
	'Office Expenses',
	'Stationery & Printing Expenses',
	'Printing & Photocopy Expenses',
	'Tea & Refreshment Expenses',
	'Pantry Expenses',
	'Housekeeping Expenses',
	'Courier & Postage Expenses',
	'Telephone Expenses',
	'Mobile Expenses',
	'Internet Expenses',
	'Electricity Expenses',
	'Water Expenses',
	'Office Rent',
	'Office Maintenance Expenses',
	'Repairs & Maintenance Expenses',
	'Staff Welfare Expenses',
	'Employee Reimbursement',
	'Salary Advance',
	'Conveyance Expenses',
	'Travelling Expenses',
	'Fuel Expenses',
	'Vehicle Maintenance Expenses',
	'Parking & Toll Charges',
	'Site Expenses',
	'Material Purchase',
	'Consumables Purchase',
	'Labour Charges',
	'Contract Labour Charges',
	'Loading & Unloading Charges',
	'Freight & Transportation Charges',
	'Equipment Hire Charges',
	'Professional Fees',
	'Consultancy Charges',
	'Legal & Professional Charges',
	'Bank Charges',
	'Software & Subscription Expenses',
	'Advertisement & Marketing Expenses',
	'Business Promotion Expenses',
	'Miscellaneous Expenses',
	'Vendor Advance',
	'Employee Advance',
	'Customer Advance Received',
	'Customer Receipt',
	'Security Deposit Paid',
	'Security Deposit Received',
	'Loan Received',
	'Loan Repayment',
	'Interest Received',
	'Interest Paid',
	'Miscellaneous Income',
	'Cash Deposited into Bank',
	'Cash Withdrawn from Bank',
	'GST Payment',
	'GST Refund Received',
	'TDS Payment',
	'Fixed Asset Purchase',
	'Accounts Receivable',
	'Accounts Payable',
];

async function seedCategories() {
	const connection = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT),
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
	});

	console.log('Connected to database. Seeding categories...\n');

	await connection.execute(`
    CREATE TABLE IF NOT EXISTS category_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

	let inserted = 0;
	let skipped = 0;

	for (const name of categories) {
		try {
			await connection.execute(
				`INSERT INTO category_master (category_name, is_active)
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

seedCategories().catch(console.error);
