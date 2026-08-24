#!/usr/bin/env node
/**
 * Verify Employee Project Cost report inputs for Rahul Sharma:
 * aggregates every non-cancelled assignment's daily_entries into FY months
 * (Apr–Mar), applies payroll hourly rate (gross_salary ÷ std days × std hrs),
 * and prints the matrix exactly like /reports/employee-project-cost.
 *
 * Run: node scripts/verify-rahul-cost.js
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const RAHUL_EMAIL = 'rahul.sharma@accent.test';

const FY_MONTHS = [
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec',
	'jan',
	'feb',
	'mar',
];
const CAL_TO_FY = {
	'04': 'apr',
	'05': 'may',
	'06': 'jun',
	'07': 'jul',
	'08': 'aug',
	'09': 'sep',
	10: 'oct',
	11: 'nov',
	12: 'dec',
	'01': 'jan',
	'02': 'feb',
	'03': 'mar',
};

async function main() {
	const conn = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT) || 3306,
		database: process.env.DEV_DB_NAME,
		user: process.env.DEV_DB_USER,
		password: process.env.DEV_DB_PASSWORD,
		dateStrings: true,
	});

	try {
		const [[emp]] = await conn.execute(
			'SELECT id FROM employees WHERE email = ? AND isDelete = 0',
			[RAHUL_EMAIL]
		);
		if (!emp) throw new Error('Rahul Sharma not found');

		// Active salary profile covering FY start (Apr 2026)
		const [[profile]] = await conn.execute(
			`SELECT gross_salary, salary_type, hourly_rate, daily_rate,
			        std_working_days, std_hours_per_day
			 FROM employee_salary_profile
			 WHERE employee_id = ? AND is_active = 1
			   AND effective_from <= '2026-04-30'
			   AND (effective_to IS NULL OR effective_to >= '2026-04-01')
			 ORDER BY effective_from DESC LIMIT 1`,
			[emp.id]
		);
		if (!profile) throw new Error('No active salary profile covering Apr');
		const rawRate =
			profile.salary_type === 'hourly' && profile.hourly_rate > 0
				? Number(profile.hourly_rate)
				: profile.salary_type === 'daily' && profile.daily_rate > 0
					? Number(profile.daily_rate)
					: Number(profile.gross_salary) /
						(Number(profile.std_working_days) *
							Number(profile.std_hours_per_day));
		console.log(
			`Payroll rate: ₹${rawRate.toFixed(4)} raw / ₹${(Math.round(rawRate * 100) / 100).toFixed(2)} display\n`
		);

		const [asgs] = await conn.execute(
			`SELECT p.project_code, COALESCE(NULLIF(p.project_title,''), NULLIF(p.name,'')) AS project_name,
			        uaa.activity_name, uaa.sub_activity_name, uaa.status, uaa.daily_entries
			 FROM user_activity_assignments uaa
			 LEFT JOIN projects p ON p.project_id = uaa.project_id
			 WHERE uaa.status <> 'Cancelled'
			   AND (uaa.employee_id = ?
			     OR uaa.user_id IN (
			       SELECT u.id FROM users u
			       WHERE (u.email <> '' AND u.email = ?)
			          OR (u.username <> '' AND u.username = 'rahul.sharma')
			          OR (u.employee_id IS NOT NULL AND u.employee_id = ?)
			     ))`,
			[emp.id, RAHUL_EMAIL, emp.id]
		);

		// project → FY key → hours ; also activity-level rollup
		const byProject = {};
		const activityCount = {};
		for (const a of asgs) {
			let entries = [];
			try {
				entries = JSON.parse(a.daily_entries || '[]');
			} catch {
				entries = [];
			}
			activityCount[a.project_code] ??= new Set();
			activityCount[a.project_code].add(
				`${a.activity_name} / ${a.sub_activity_name}`
			);
			for (const e of Array.isArray(entries) ? entries : []) {
				if (!e?.date || !(e.hours > 0)) continue;
				const fyKey = CAL_TO_FY[String(e.date).slice(5, 7)];
				if (!fyKey) continue;
				byProject[a.project_code] ??= { name: a.project_name, months: {} };
				byProject[a.project_code].months[fyKey] =
					(byProject[a.project_code].months[fyKey] || 0) + e.hours;
			}
		}

		console.log(`Assignments considered: ${asgs.length}\n`);
		const header =
			'Project'.padEnd(10) + FY_MONTHS.map((m) => m.padStart(7)).join('');
		console.log(header);
		let grandH = Object.fromEntries(FY_MONTHS.map((m) => [m, 0]));
		let totalHours = 0;
		let totalCost = 0;
		for (const code of Object.keys(byProject).sort()) {
			const g = byProject[code];
			let line = code.padEnd(10);
			for (const m of FY_MONTHS) {
				const h = Math.round((g.months[m] || 0) * 100) / 100;
				grandH[m] += h;
				line += String(h || '—').padStart(7);
				totalHours += h;
				totalCost += Math.round(rawRate * h * 100) / 100;
			}
			console.log(line);
		}
		let gl = 'TOTAL'.padEnd(10);
		for (const m of FY_MONTHS)
			gl += String(Math.round(grandH[m] * 100) / 100).padStart(7);
		console.log(gl);

		console.log(`\nTotal hours : ${Math.round(totalHours * 100) / 100}`);
		console.log(
			`Total cost  : ₹${Math.round(totalCost * 100) / 100} (blended ₹${(Math.round((totalCost / totalHours) * 100) / 100).toFixed(2)}/hr)`
		);
		console.log('\nActivities per project:');
		for (const code of Object.keys(activityCount).sort()) {
			console.log(`  ${code}:`);
			for (const a of [...activityCount[code]].sort())
				console.log(`    - ${a}`);
		}
	} finally {
		await conn.end();
	}
}

main().catch((err) => {
	console.error('Verify failed:', err.message);
	process.exit(1);
});
