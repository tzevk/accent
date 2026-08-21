// Adds Rahul Sharma to the Payroll employees list (src/app/employees/payroll).
// - If an active employee named "Rahul Sharma" already exists, updates its
//   employee_type to 'Payroll'.
// - Otherwise inserts a new Payroll employee with an auto-generated ATS id,
//   matching the /api/employees POST logic.
//
// Run with: node scripts/add-rahul-sharma-payroll.js

import { dbConnect } from '../src/utils/database.js';

const FIRST_NAME = 'Rahul';
const LAST_NAME = 'Sharma';
const EMAIL = 'rahul.sharma@accent.test';

async function nextEmployeeId(db) {
	const [rows] = await db.execute(
		"SELECT employee_id FROM employees WHERE employee_id LIKE 'ATS%' AND isDelete = 0"
	);
	let maxNum = 0;
	for (const r of rows) {
		const m = String(r.employee_id || '').match(/ATS0*(\d+)$/i);
		if (m) {
			const n = parseInt(m[1], 10);
			if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
		}
	}
	return `ATS${String(maxNum + 1).padStart(3, '0')}`;
}

async function main() {
	const db = await dbConnect();
	try {
		// 1. Existing employee with the same name?
		const [byName] = await db.execute(
			`SELECT id, employee_id, email, employee_type FROM employees
       WHERE first_name = ? AND last_name = ? AND isDelete = 0`,
			[FIRST_NAME, LAST_NAME]
		);

		if (byName.length > 0) {
			const emp = byName[0];
			if (emp.employee_type === 'Payroll') {
				console.log(
					`• ${FIRST_NAME} ${LAST_NAME} (#${emp.id}, ${emp.employee_id}) is already a Payroll employee — nothing to do`
				);
				return;
			}
			await db.execute('UPDATE employees SET employee_type = ? WHERE id = ?', [
				'Payroll',
				emp.id,
			]);
			console.log(
				`✓ Updated ${FIRST_NAME} ${LAST_NAME} (#${emp.id}, ${emp.employee_id}) → employee_type 'Payroll'`
			);
			return;
		}

		// 2. Existing employee with the same email?
		const [byEmail] = await db.execute(
			`SELECT id, employee_id, first_name, last_name, employee_type FROM employees
       WHERE email = ? AND isDelete = 0`,
			[EMAIL]
		);

		if (byEmail.length > 0) {
			const emp = byEmail[0];
			if (emp.employee_type === 'Payroll') {
				console.log(
					`• ${emp.first_name} ${emp.last_name} (#${emp.id}, ${emp.employee_id}) is already a Payroll employee — nothing to do`
				);
				return;
			}
			await db.execute('UPDATE employees SET employee_type = ? WHERE id = ?', [
				'Payroll',
				emp.id,
			]);
			console.log(
				`✓ Updated ${emp.first_name} ${emp.last_name} (#${emp.id}, ${emp.employee_id}) → employee_type 'Payroll'`
			);
			return;
		}

		// 3. Insert a fresh Payroll employee
		const employeeId = await nextEmployeeId(db);
		const [result] = await db.execute(
			`INSERT INTO employees
        (employee_id, first_name, last_name, email, employee_type, status, joining_date, company_name, isDelete)
       VALUES (?, ?, ?, ?, 'Payroll', 'active', CURDATE(), 'Accent Techno Solutions Pvt Ltd', 0)`,
			[employeeId, FIRST_NAME, LAST_NAME, EMAIL]
		);
		console.log(
			`✓ Inserted ${FIRST_NAME} ${LAST_NAME} as employee #${result.insertId} (${employeeId}) with employee_type 'Payroll'`
		);
	} finally {
		db.release();
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		if (err && err.code === 'ER_DUP_ENTRY') {
			console.error('✗ Duplicate employee_id/email — adjust EMAIL and retry.');
		} else {
			console.error('✗ Failed:', err?.message || err);
		}
		process.exit(1);
	});
