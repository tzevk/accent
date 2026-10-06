import bcrypt from 'bcrypt';
import { exec, rows } from './db';

/**
 * Deterministic, self-owned fixtures for the E2E flows.
 *
 * Everything the harness creates is namespaced so it can be purged and
 * re-created on every run without touching anyone else's dev data:
 * users `e2e_*`, employees `E2E-EMP-*`, assignments `e2e-assign-*`,
 * deliverables prefixed `E2E Deliverable `, one E2E Holiday, and the
 * 2019-01 payroll artifacts (the month the flows generate).
 */

export const E2E_MONTH = '2019-01-01';
export const E2E_CTC = 26000;
export const E2E_LOGGED_HOURS = 104;
export const E2E_STD_HOURS_PER_DAY = 8;

export const ADMIN_USER = {
	username: 'e2e_admin',
	email: 'e2e.admin@accent.test',
	password: 'E2e#Admin1',
	fullName: 'E2E Admin',
};

export const EMPLOYEE_USER = {
	username: 'e2e_employee',
	email: 'e2e.employee@accent.test',
	password: 'E2e#Employee1',
	fullName: 'E2E Employee',
};

export const WORKER = {
	code: 'E2E-EMP-0001',
	firstName: 'E2E',
	lastName: 'Worker',
	email: 'e2e.worker@accent.test',
};

export const ZERO_HOURS_WORKER = {
	code: 'E2E-EMP-0002',
	firstName: 'E2E',
	lastName: 'ZeroHours',
	email: 'e2e.zero@accent.test',
};

/**
 * Bonus-composition fixtures (ticket #305). Four employees on the same CTC,
 * hours and statutory flags as `WORKER`, with Bonus applicable and a
 * fixture-owned Bonus Component Rate:
 *
 *   E2E-EMP-0003  bonusWorkers   monthly  generated WITH the bonus
 *   E2E-EMP-0004  zeroBonus      monthly  generated WITHOUT it (the baseline)
 *   E2E-EMP-0005  contractBonus  contract generated WITH the bonus (2nd stream)
 *   E2E-EMP-0006  lateBonus      monthly  generated after the rate changes
 *
 * 0003/0004 differ only in `include_bonus`, so the slip delta is the bonus
 * itself: earnings +₹1,000, employer contributions +₹0, employer cost +₹1,000.
 */
export const BONUS_WORKER = {
	code: 'E2E-EMP-0003',
	firstName: 'E2E',
	lastName: 'BonusWorker',
	email: 'e2e.bonus.worker@accent.test',
};

export const ZERO_BONUS_WORKER = {
	code: 'E2E-EMP-0004',
	firstName: 'E2E',
	lastName: 'ZeroBonus',
	email: 'e2e.zero.bonus@accent.test',
};

export const CONTRACT_BONUS_WORKER = {
	code: 'E2E-EMP-0005',
	firstName: 'E2E',
	lastName: 'ContractBonus',
	email: 'e2e.contract.bonus@accent.test',
};

export const LATE_BONUS_WORKER = {
	code: 'E2E-EMP-0006',
	firstName: 'E2E',
	lastName: 'LateBonus',
	email: 'e2e.late.bonus@accent.test',
};

/** The Bonus Component Rate the bonus fixtures price against (fixed ₹1,000). */
export const E2E_BONUS_AMOUNT = 1000;
/** A later rate for the same month; stored Payroll Slips must keep ₹1,000. */
export const E2E_BONUS_LATER_AMOUNT = 2500;
/** `payroll_schedules.remarks` namespace for the fixture-owned Bonus rates. */
export const E2E_BONUS_SCHEDULE_REMARKS = 'E2E bonus component rate';

export const HOLIDAY = { name: 'E2E Holiday', date: '2019-01-26' };
export const DELIVERABLE_PREFIX = 'E2E Deliverable ';

/** 13 weekdays in Jan 2019 (Sundays 6/13/20/27 excluded) × 8h = 104h. */
const LOGGED_DAYS = [
	'02',
	'03',
	'04',
	'05',
	'07',
	'08',
	'09',
	'10',
	'11',
	'12',
	'14',
	'15',
	'16',
];

export interface Seeded {
	adminUserId: number;
	employeeUserId: number;
	workerEmployeeId: number;
	zeroHoursEmployeeId: number;
	bonusEmployeeId: number;
	zeroBonusEmployeeId: number;
	contractBonusEmployeeId: number;
	lateBonusEmployeeId: number;
}

export interface MonthBasis {
	daysInMonth: number;
	sundays: number;
	holidaysNotOnSunday: number;
	workingDays: number;
	basisHours: number;
}

export interface ExpectedSlip {
	unroundedRate: number;
	hourlyRate: number;
	gross: number;
}

/**
 * Independent recomputation of the month's basis hours (ADR-0010): every
 * calendar day except Sundays and active non-optional holidays counts as a
 * working day.
 */
export async function computeMonthBasis(month: string): Promise<MonthBasis> {
	const [year, monthNumber] = month.split('-').map(Number);
	const monthPrefix = month.slice(0, 7);
	const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	const lastDay = `${monthPrefix}-${String(daysInMonth).padStart(2, '0')}`;

	const holidays = await rows<{ date: string }>(
		`SELECT date FROM holiday_master
      WHERE is_active = 1 AND is_optional = 0 AND date BETWEEN ? AND ?`,
		[`${monthPrefix}-01`, lastDay]
	);
	const holidayDates = new Set(
		holidays.map((row) => String(row.date).slice(0, 10))
	);

	let sundays = 0;
	let holidaysNotOnSunday = 0;
	for (let day = 1; day <= daysInMonth; day++) {
		const isoDay = `${monthPrefix}-${String(day).padStart(2, '0')}`;
		const isSunday =
			new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay() === 0;
		if (isSunday) sundays++;
		else if (holidayDates.has(isoDay)) holidaysNotOnSunday++;
	}

	const workingDays = daysInMonth - sundays - holidaysNotOnSunday;
	return {
		daysInMonth,
		sundays,
		holidaysNotOnSunday,
		workingDays,
		basisHours: workingDays * E2E_STD_HOURS_PER_DAY,
	};
}

/** The slip the hours logged should earn, at 2 dp for the rate and whole rupees for money. */
export function expectedSlip(
	basisHours: number,
	loggedHours: number
): ExpectedSlip {
	const unroundedRate = E2E_CTC / basisHours;
	return {
		unroundedRate,
		hourlyRate: Math.round(unroundedRate * 100) / 100,
		gross: Math.round(unroundedRate * loggedHours),
	};
}

/** Remove every row the harness owns. Safe to run repeatedly. */
export async function cleanupFixtures(): Promise<void> {
	const usernames = [ADMIN_USER.username, EMPLOYEE_USER.username];
	const codes = [
		WORKER.code,
		ZERO_HOURS_WORKER.code,
		BONUS_WORKER.code,
		ZERO_BONUS_WORKER.code,
		CONTRACT_BONUS_WORKER.code,
		LATE_BONUS_WORKER.code,
	];

	// Log tables are best-effort: older schemas may name columns differently.
	for (const sql of [
		`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username IN (?, ?))`,
	]) {
		try {
			await exec(sql, usernames);
		} catch {
			// Optional table — fixture users cannot be blocked on it below.
		}
	}

	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		usernames
	);
	await exec(
		`DELETE FROM user_activity_assignments
      WHERE id LIKE 'e2e-assign-%'
         OR user_id IN (SELECT id FROM users WHERE username IN (?, ?))`,
		usernames
	);
	await exec(
		`DELETE FROM payroll_slips
      WHERE employee_id IN (SELECT id FROM employees WHERE employee_id IN (?, ?))`,
		codes
	);
	await exec(
		`DELETE FROM employee_salary_profile
      WHERE employee_id IN (SELECT id FROM employees WHERE employee_id IN (?, ?))`,
		codes
	);
	await exec(`DELETE FROM users WHERE username IN (?, ?)`, usernames);
	await exec(`DELETE FROM employees WHERE employee_id IN (?, ?)`, codes);
	await exec(`DELETE FROM holiday_master WHERE name = ?`, [HOLIDAY.name]);
	await exec(`DELETE FROM deliverables_master WHERE deliverable_name LIKE ?`, [
		`${DELIVERABLE_PREFIX}%`,
	]);
	// Fixture-owned Bonus Component Rates (the snapshot test publishes a second
	// one); namespaced by remarks so no real rate row is ever touched.
	await exec(`DELETE FROM payroll_schedules WHERE remarks LIKE ?`, [
		`${E2E_BONUS_SCHEDULE_REMARKS}%`,
	]);
	// The month's run is created by the payroll flow; remove it while it is
	// still the draft the flow made.
	await exec(
		`DELETE FROM payroll_runs
      WHERE month = 1 AND year = 2019 AND run_number = 1 AND status = 'draft'`
	);
}

/** Purge leftovers, then create the fixture users/employees/profiles/hours. */
export async function seedFixtures(): Promise<Seeded> {
	await cleanupFixtures();

	const adminHash = await bcrypt.hash(ADMIN_USER.password, 10);
	const employeeHash = await bcrypt.hash(EMPLOYEE_USER.password, 10);

	const worker = await exec(
		`INSERT INTO employees (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
     VALUES (?, ?, ?, ?, 'active', 'Payroll', '2019-01-01', 0)`,
		[WORKER.code, WORKER.firstName, WORKER.lastName, WORKER.email]
	);
	const zero = await exec(
		`INSERT INTO employees (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
     VALUES (?, ?, ?, ?, 'active', 'Payroll', '2019-01-01', 0)`,
		[
			ZERO_HOURS_WORKER.code,
			ZERO_HOURS_WORKER.firstName,
			ZERO_HOURS_WORKER.lastName,
			ZERO_HOURS_WORKER.email,
		]
	);

	const admin = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 1, 'employee', 0)`,
		[ADMIN_USER.username, adminHash, ADMIN_USER.email, ADMIN_USER.fullName]
	);
	const employeeUser = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, employee_id, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', ?, 0)`,
		[
			EMPLOYEE_USER.username,
			employeeHash,
			EMPLOYEE_USER.email,
			EMPLOYEE_USER.fullName,
			worker.insertId,
		]
	);

	// Statutory deductions off, so the slip's totals isolate the hours-based pay.
	const profileSql = `INSERT INTO employee_salary_profile
      (employee_id, gross, gross_salary, employer_cost, other_allowances, effective_from, is_active,
       pf_applicable, esic_applicable, pt_applicable, mlwf_applicable, salary_type, std_hours_per_day,
       std_working_days, tds_percentage, loan_amount, loan_amount_per_month, loan_active, advance_amount, advance_active)
     VALUES (?, ?, ?, ?, 0, '2019-01-01', 1, 0, 0, 0, 0, 'monthly', ?, 26, 0, 0, 0, 0, 0, 0)`;
	for (const employeeId of [worker.insertId, zero.insertId]) {
		await exec(profileSql, [
			employeeId,
			E2E_CTC,
			E2E_CTC,
			E2E_CTC,
			E2E_STD_HOURS_PER_DAY,
		]);
	}

	const dailyEntries = LOGGED_DAYS.map((day) => ({
		date: `2019-01-${day}`,
		hours: E2E_STD_HOURS_PER_DAY,
	}));
	await exec(
		`INSERT INTO user_activity_assignments
       (id, user_id, employee_id, activity_id, activity_name, status, daily_entries, assigned_date, due_date)
     VALUES ('e2e-assign-0001', ?, ?, 'e2e-activity-0001', 'E2E project work', 'Completed', ?, '2019-01-02 09:00:00', '2019-01-31')`,
		[employeeUser.insertId, worker.insertId, JSON.stringify(dailyEntries)]
	);

	// ── Bonus-composition fixtures (#305) ──
	// Identical CTC, hours and statutory flags to WORKER (so the only slip
	// delta is the bonus); Bonus applicable, priced from the fixture-owned
	// Component Rate below. The contract member is the second pay stream.
	const bonusMembers = [
		// Employee Type is a directory grouping, not a pay stream (ADR-0015):
		// these stay off the Attendance/Utilization Payroll rosters, while
		// their Salary Profile puts them in the payroll/contract pay streams.
		{ fixture: BONUS_WORKER, salaryType: 'monthly', employeeType: 'Permanent' },
		{
			fixture: ZERO_BONUS_WORKER,
			salaryType: 'monthly',
			employeeType: 'Permanent',
		},
		{
			fixture: CONTRACT_BONUS_WORKER,
			salaryType: 'contract',
			employeeType: 'Contract',
		},
		{
			fixture: LATE_BONUS_WORKER,
			salaryType: 'monthly',
			employeeType: 'Permanent',
		},
	];
	const bonusEmployeeIds: number[] = [];
	for (let index = 0; index < bonusMembers.length; index++) {
		const member = bonusMembers[index];
		const inserted = await exec(
			`INSERT INTO employees (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', ?, '2019-01-01', 0)`,
			[
				member.fixture.code,
				member.fixture.firstName,
				member.fixture.lastName,
				member.fixture.email,
				member.employeeType,
			]
		);
		await exec(
			`INSERT INTO employee_salary_profile
         (employee_id, gross, gross_salary, employer_cost, other_allowances, effective_from, is_active,
          pf_applicable, esic_applicable, pt_applicable, mlwf_applicable, bonus_applicable, salary_type,
          std_hours_per_day, std_working_days, tds_percentage, loan_amount, loan_amount_per_month, loan_active,
          advance_amount, advance_active)
       VALUES (?, ?, ?, ?, 0, '2019-01-01', 1, 1, 0, 0, 0, 1, ?, ?, 26, 0, 0, 0, 0, 0, 0)`,
			[
				inserted.insertId,
				E2E_CTC,
				E2E_CTC,
				E2E_CTC,
				member.salaryType,
				E2E_STD_HOURS_PER_DAY,
			]
		);
		await exec(
			`INSERT INTO user_activity_assignments
         (id, user_id, employee_id, activity_id, activity_name, status, daily_entries, assigned_date, due_date)
       VALUES (?, ?, ?, ?, 'E2E bonus project work', 'Completed', ?, '2019-01-02 09:00:00', '2019-01-31')`,
			[
				`e2e-assign-000${index + 2}`,
				admin.insertId,
				inserted.insertId,
				`e2e-activity-000${index + 2}`,
				JSON.stringify(dailyEntries),
			]
		);
		bonusEmployeeIds.push(inserted.insertId);
	}

	// The Bonus Component Rate the fixtures price against: fixed ₹1,000 from
	// the payroll month. Namespaced by remarks so cleanup owns the row.
	await exec(
		`INSERT INTO payroll_schedules
       (component_type, value_type, value, effective_from, effective_to, is_active, remarks)
     VALUES ('bonus', 'fixed', ?, '2019-01-01', NULL, 1, ?)`,
		[E2E_BONUS_AMOUNT, E2E_BONUS_SCHEDULE_REMARKS]
	);

	await exec(
		`INSERT INTO holiday_master (name, date, type, is_optional, is_active)
     VALUES (?, ?, 'company', 0, 1)`,
		[HOLIDAY.name, HOLIDAY.date]
	);

	return {
		adminUserId: admin.insertId,
		employeeUserId: employeeUser.insertId,
		workerEmployeeId: worker.insertId,
		zeroHoursEmployeeId: zero.insertId,
		bonusEmployeeId: bonusEmployeeIds[0],
		zeroBonusEmployeeId: bonusEmployeeIds[1],
		contractBonusEmployeeId: bonusEmployeeIds[2],
		lateBonusEmployeeId: bonusEmployeeIds[3],
	};
}
