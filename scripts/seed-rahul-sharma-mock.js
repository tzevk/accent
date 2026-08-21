// Seeds mock data for Rahul Sharma (Payroll employee):
//   1. Fills his `employees` row (personal / work / bank / statutory details).
//   2. Upserts an active `employee_salary_profile` (monthly component breakdown).
//   3. Creates or updates his `salary_structures` entry (+ components).
//
// Mock salary (monthly): gross ₹45,000
//   Earnings : Basic 18,000 · DA 3,000 · HRA 9,000 · Conveyance 3,600
//              · Call allowance 2,400 · Other allowances 9,000
//   Deductions: PF 1,800 · PT 200 · MLWF 12  → net pay ₹42,988
//
// Run with: node scripts/seed-rahul-sharma-mock.js

import { dbConnect } from '../src/utils/database.js';

const FIRST_NAME = 'Rahul';
const LAST_NAME = 'Sharma';
const EMAIL = 'rahul.sharma@accent.test';
const EFFECTIVE_FROM = '2025-04-01';
const DA_YEAR = 2025;

// ── Mock employee master data ──
const EMPLOYEE_MOCK = {
	phone: '+91 98220 44556',
	gender: 'Male',
	dob: '1992-06-15',
	marital_status: 'Single',
	department: 'Engineering',
	position: 'Senior Design Engineer',
	designation: 'Senior Design Engineer',
	employment_status: 'Permanent',
	workplace: 'Head Office',
	grade: 'A',
	level: 'L3',
	hire_date: '2023-04-10',
	joining_date: '2023-04-10',
	address: 'Flat 402, Sunrise Residency, Baner Road',
	city: 'Pune',
	state: 'Maharashtra',
	pin: '411045',
	country: 'India',
	personal_email: 'rahul.sharma.personal@gmail.com',
	bank_name: 'HDFC Bank',
	bank_branch: 'Pune - Baner',
	account_holder_name: 'Rahul Sharma',
	bank_account_no: '50100456789012',
	bank_ifsc: 'HDFC0001234',
	pan: 'ABCPS1234K',
	aadhar: '452388901122',
	gratuity_no: 'GRS-0129',
	uan: '101234567890',
	esi_no: null,
	biometric_code: 'ATS002',
	attendance_id: 'EMP-002',
	bonus_eligible: 1,
	stat_pf: 1,
	stat_mlwf: 1,
	stat_pt: 1,
	stat_esic: 0,
	stat_tds: 0,
	gross_salary: '45000.00',
	total_deductions: '2012.00',
	net_salary: '42988.00',
	notes: 'Mock data seeded by scripts/seed-rahul-sharma-mock.js',
};

// ── Mock salary profile (employee_salary_profile) ──
const SALARY_PROFILE_MOCK = {
	gross: '45000.00',
	gross_salary: '45000.00',
	other_allowances: '9000.00',
	effective_from: EFFECTIVE_FROM,
	effective_to: null,
	da_year: DA_YEAR,
	pf_applicable: 1,
	esic_applicable: 0, // gross above ESIC wage ceiling (₹21,000)
	pt_applicable: 1,
	mlwf_applicable: 1,
	retention_applicable: 0,
	bonus_applicable: 0,
	monthly_bonus: 0,
	incentive_applicable: 0,
	insurance_applicable: 0,
	basic_plus_da: '21000.00',
	da: '3000.00',
	basic: '18000.00',
	hra: '9000.00',
	conveyance: '3600.00',
	call_allowance: '2400.00',
	pf_employee: '1800.00',
	esic_employee: null,
	pf_employer: '1800.00',
	esic_employer: null,
	pt: '200.00',
	mlwf: '12.00',
	mlwf_employer: '24.00',
	retention: null,
	insurance: null,
	total_earnings: '45000.00',
	total_deductions: '2012.00',
	net_pay: '42988.00',
	employer_cost: '46824.00',
	salary_type: 'monthly',
	std_hours_per_day: '8.0',
	std_in_time: '09:00:00',
	std_out_time: '17:30:00',
	ot_multiplier: '1.50',
	std_working_days: 26,
	tds_percentage: null,
	pl_total: 24,
	pl_used: 2,
	pl_balance: 22,
};

// ── Mock salary structure components ──
const COMPONENTS_MOCK = [
	{ name: 'Basic', code: 'BASIC', type: 'earning', amount: '18000.00' },
	{
		name: 'Dearness Allowance',
		code: 'DA',
		type: 'earning',
		amount: '3000.00',
	},
	{ name: 'HRA', code: 'HRA', type: 'earning', amount: '9000.00' },
	{
		name: 'Conveyance Allowance',
		code: 'CONV',
		type: 'earning',
		amount: '3600.00',
	},
	{
		name: 'Call Allowance',
		code: 'CALL',
		type: 'earning',
		amount: '2400.00',
	},
	{
		name: 'Other Allowance',
		code: 'OTHER',
		type: 'earning',
		amount: '9000.00',
	},
	{
		name: 'Provident Fund',
		code: 'PF',
		type: 'deduction',
		amount: '1800.00',
		statutory: 'pf',
	},
	{
		name: 'Professional Tax',
		code: 'PT',
		type: 'deduction',
		amount: '200.00',
		statutory: 'pt',
	},
	{
		name: 'MLWF',
		code: 'MLWF',
		type: 'deduction',
		amount: '12.00',
		statutory: 'mlwf',
	},
	{
		name: 'EPF Employer',
		code: 'PF_ER',
		type: 'employer_contribution',
		amount: '1800.00',
		statutory: 'pf',
	},
	{
		name: 'MLWF Employer',
		code: 'MLWF_ER',
		type: 'employer_contribution',
		amount: '24.00',
		statutory: 'mlwf',
	},
];

async function findEmployee(db) {
	const [rows] = await db.execute(
		`SELECT id, employee_id, first_name, last_name FROM employees
     WHERE (first_name = ? AND last_name = ?) OR email = ?
     LIMIT 1`,
		[FIRST_NAME, LAST_NAME, EMAIL]
	);
	return rows[0] || null;
}

async function seedEmployeeRow(db, emp) {
	const updates = Object.keys(EMPLOYEE_MOCK)
		.map((key) => `${key} = ?`)
		.join(', ');
	await db.execute(`UPDATE employees SET ${updates} WHERE id = ?`, [
		...Object.values(EMPLOYEE_MOCK),
		emp.id,
	]);
	console.log(
		`✓ Updated employees row #${emp.id} (${emp.employee_id}) with mock profile data`
	);
}

async function seedSalaryProfile(db, emp) {
	const [existing] = await db.execute(
		`SELECT id FROM employee_salary_profile
     WHERE employee_id = ? AND is_active = 1
     ORDER BY effective_from DESC LIMIT 1`,
		[emp.id]
	);

	const cols = Object.keys(SALARY_PROFILE_MOCK);
	const vals = Object.values(SALARY_PROFILE_MOCK);

	if (existing.length > 0) {
		const updates = cols.map((key) => `${key} = ?`).join(', ');
		await db.execute(
			`UPDATE employee_salary_profile SET ${updates} WHERE id = ?`,
			[...vals, existing[0].id]
		);
		console.log(
			`✓ Updated active salary profile #${existing[0].id} (gross ₹45,000/month)`
		);
		return;
	}

	const placeholders = cols.map(() => '?').join(', ');
	await db.execute(
		`INSERT INTO employee_salary_profile (employee_id, ${cols.join(', ')})
     VALUES (?, ${placeholders})`,
		[emp.id, ...vals]
	);
	console.log(`✓ Created salary profile (gross ₹45,000/month)`);
}

async function seedSalaryStructure(db, emp) {
	const structureFields = {
		pay_type: 'monthly',
		ctc: '561888.00',
		gross_salary: '45000.00',
		basic_salary: '18000.00',
		hourly_rate: null,
		daily_rate: null,
		ot_multiplier: '1.5',
		pf_applicable: 1,
		esic_applicable: 0,
		pt_applicable: 1,
		mlwf_applicable: 1,
		tds_applicable: 1,
		pf_wage_ceiling: '15000',
		standard_working_days: 26,
		standard_hours_per_day: '8.00',
		remarks: 'Mock structure seeded by scripts/seed-rahul-sharma-mock.js',
	};

	const [existing] = await db.execute(
		`SELECT id, version FROM salary_structures
     WHERE employee_id = ? AND is_active = 1
     ORDER BY effective_from DESC LIMIT 1`,
		[emp.id]
	);

	let structureId;
	if (existing.length > 0) {
		structureId = existing[0].id;
		const updates = Object.keys(structureFields)
			.map((key) => `${key} = ?`)
			.join(', ');
		await db.execute(
			`UPDATE salary_structures SET ${updates}, effective_from = ? WHERE id = ?`,
			[...Object.values(structureFields), EFFECTIVE_FROM, structureId]
		);
		// Replace components so re-runs stay clean
		await db.execute(
			'DELETE FROM salary_structure_components WHERE salary_structure_id = ?',
			[structureId]
		);
		console.log(
			`✓ Updated salary structure v${existing[0].version} (#${structureId})`
		);
	} else {
		const [versionRow] = await db.execute(
			'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM salary_structures WHERE employee_id = ?',
			[emp.id]
		);
		const nextVersion = versionRow[0].next_version;
		const dataCols = Object.keys(structureFields);
		const placeholders = dataCols.map(() => '?').join(', ');
		const [result] = await db.execute(
			`INSERT INTO salary_structures
        (employee_id, version, effective_from, is_active, ${dataCols.join(', ')})
       VALUES (?, ?, ?, 1, ${placeholders})`,
			[emp.id, nextVersion, EFFECTIVE_FROM, ...Object.values(structureFields)]
		);
		structureId = result.insertId;
		console.log(`✓ Created salary structure v${nextVersion} (#${structureId})`);
	}

	for (let i = 0; i < COMPONENTS_MOCK.length; i++) {
		const c = COMPONENTS_MOCK[i];
		await db.execute(
			`INSERT INTO salary_structure_components
        (salary_structure_id, component_name, component_code, component_type,
         calculation_type, fixed_amount, is_taxable, is_statutory, statutory_type,
         display_order, show_in_slip, is_active)
       VALUES (?, ?, ?, ?, 'fixed', ?, ?, ?, ?, ?, 1, 1)`,
			[
				structureId,
				c.name,
				c.code,
				c.type,
				c.amount,
				c.type === 'earning' ? 1 : 0,
				c.statutory ? 1 : 0,
				c.statutory || null,
				i,
			]
		);
	}
	console.log(`✓ Seeded ${COMPONENTS_MOCK.length} salary structure components`);
}

async function main() {
	const db = await dbConnect();
	try {
		const emp = await findEmployee(db);
		if (!emp) {
			console.error(
				`✗ Employee "${FIRST_NAME} ${LAST_NAME}" not found — run scripts/add-rahul-sharma-payroll.js first`
			);
			process.exit(1);
		}
		console.log(
			`Seeding mock data for ${emp.first_name} ${emp.last_name} (#${emp.id}, ${emp.employee_id})...\n`
		);

		await seedEmployeeRow(db, emp);
		await seedSalaryProfile(db, emp);
		await seedSalaryStructure(db, emp);

		console.log('\n✓ Done! Open Employees → Payroll to see Rahul Sharma.');
	} finally {
		db.release();
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('✗ Failed:', err?.message || err);
		process.exit(1);
	});
