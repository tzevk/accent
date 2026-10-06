import bcrypt from 'bcrypt';
import type { Cookie } from '@playwright/test';
import type { APIRequestContext, Playwright as PlaywrightApi } from '@playwright/test';
import { exec, rows } from './db';

/**
 * Ticket #307 — recorded employer-cost allocation fixtures.
 *
 * One namespace only: projects `E2E-ALLOC-P1/P2`, employees `E2E-ALLOC-0*`,
 * assignments `e2e-alloc-assign-*`, the fixture user `e2e_alloc_user`, reader
 * identities `e2e_alloc_reader` / `e2e_alloc_fin_reader`, the Bonus Component
 * Rate marked `E2E-ALLOC bonus rate`, and the months **2026-02**
 * (`ALLOCATION_MONTH`, the finalized month) and **2026-03**
 * (`ALLOCATION_ESTIMATE_MONTH`, the estimates month). No other ticket uses
 * either month; `E2E-EXP-*`, `E2E-EMP-*`, `E2E-UTIL-*` and `E2E-ATT-*` rows
 * are never read, mutated, or cleaned here.
 *
 * Why 2026-02+ and not a 2019 month: Payroll Finalize refuses a month while an
 * active Payroll/Contract employee has no Salary Profile covering it, and the
 * attendance fixtures' profiles only start 2026-01-01 — so 2026-02 is the
 * earliest month that every seeded fixture employee can be paid in. The
 * employees whose namespaces deliberately carry no covering profile
 * (`E2E-ATT-0009`, `E2E-UTIL-0019`) get a zero Payroll Slip for the fixture
 * month from this file, which is the same thing Generate would have written
 * had they a profile; it is inert for their own specs because they never read
 * the fixture month.
 *
 * The fixture amounts are stated once here and derived by hand from the payroll
 * rules (ADR-0010 hours-based pay, zero statutory flags):
 *
 *   Month 2026-02 has 28 days, 4 Sundays, so 24 working days × 8h = 192 basis
 *   hours — the same calendar the payroll calculator reads from
 *   `holiday_master` (no fixture holiday falls in 2026-02).
 *
 *   E2E-ALLOC-01 monthly CTC ₹26,000, 192h logged → gross = CTC = what the
 *   heads add to (₹15,600 + ₹5,200 + ₹2,600 + ₹2,600). Logged on P1 80h,
 *   P2 72h, no project 40h.
 *   E2E-ALLOC-02 contract CTC ₹10,000, 192h logged → ₹10,000. P1 73h, P2 71h,
 *   no project 48h.
 *   E2E-ALLOC-03 monthly CTC ₹26,000, zero hours, fixture Bonus Component Rate
 *   ₹500 → earnings ₹500, fully unallocated (no Logged Hours).
 *   E2E-ALLOC-04 monthly CTC ₹26,000, zero hours, no bonus → known zero.
 *   E2E-ALLOC-06 profile covering 2026-02 only, zero hours → known zero.
 *
 *   The rounding adjustment is the deterministic largest-remainder cent: exact
 *   shares ₹10,833.33⅓ / ₹9,750.00 / ₹5,416.66⅔ leave one cent, which goes to
 *   the largest remainder (the no-project share) → ₹10,833.33 / ₹9,750.00 /
 *   ₹5,416.67 with a +₹0.01 adjustment. E2E-ALLOC-02: exact ₹3,802.08⅓ /
 *   ₹3,697.91⅔ / ₹2,500.00 → P2 receives the cent.
 */

export const ALLOCATION_MONTH = '2026-02';
export const ALLOCATION_MONTH_DAY = `${ALLOCATION_MONTH}-01`;
export const ALLOCATION_ESTIMATE_MONTH = '2026-03';
export const ALLOCATION_ESTIMATE_MONTH_DAY = `${ALLOCATION_ESTIMATE_MONTH}-01`;

export const ALLOCATION_EMPLOYEE_PREFIX = 'E2E-ALLOC-';
export const ALLOCATION_ASSIGNMENT_PREFIX = 'e2e-alloc-assign-';
export const ALLOCATION_BONUS_REMARKS = 'E2E-ALLOC bonus rate';
export const ALLOCATION_BONUS_AMOUNT = 500;
export const ALLOCATION_USERNAME = 'e2e_alloc_user';
export const ALLOCATION_READER_IP = '198.18.0.27';
export const ALLOCATION_FIN_READER_IP = '198.18.0.28';

export const ALLOCATION_USER = {
	username: ALLOCATION_USERNAME,
	password: 'e2e-alloc-user-password',
	email: 'e2e.alloc.user@accent.test',
	fullName: 'E2E Allocation Fixture User',
};

export const ALLOCATION_READER = {
	username: 'e2e_alloc_reader',
	password: 'e2e-alloc-reader-password',
	email: 'e2e.alloc.reader@accent.test',
	fullName: 'E2E Allocation Report Reader',
	roleCode: 'e2e_alloc_reader_role',
	roleName: 'E2E Allocation Report Reader',
	permissions: ['reports:read'],
};

export const ALLOCATION_FIN_READER = {
	username: 'e2e_alloc_fin_reader',
	password: 'e2e-alloc-fin-reader-password',
	email: 'e2e.alloc.fin.reader@accent.test',
	fullName: 'E2E Allocation Finance Reader',
	roleCode: 'e2e_alloc_fin_reader_role',
	roleName: 'E2E Allocation Finance Reader',
	permissions: ['reports:read', 'other_expenses:read'],
};

export const ALLOCATION_PROJECTS = {
	p1: {
		code: 'E2E-ALLOC-P1',
		name: 'E2E Allocation Project One',
		client: 'E2E Allocation Client',
	},
	p2: {
		code: 'E2E-ALLOC-P2',
		name: 'E2E Allocation Project Two',
		client: 'E2E Allocation Client',
	},
} as const;

export const ALLOCATION_EMPLOYEES = {
	/** Monthly stream, hours split across two Projects and no project. */
	splitMonthly: {
		code: 'E2E-ALLOC-01',
		firstName: 'E2E',
		lastName: 'Split Monthly',
		email: 'e2e.alloc.01@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 26000,
	},
	/** Contract stream — the second pay stream. */
	contractRounding: {
		code: 'E2E-ALLOC-02',
		firstName: 'E2E',
		lastName: 'Contract Rounding',
		email: 'e2e.alloc.02@accent.test',
		employeeType: 'Contract',
		salaryType: 'contract',
		ctc: 10000,
	},
	/** Nonzero recorded cost with zero Logged Hours (fixture bonus). */
	noHoursBonus: {
		code: 'E2E-ALLOC-03',
		firstName: 'E2E',
		lastName: 'Bonus No Hours',
		email: 'e2e.alloc.03@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 26000,
		bonusApplicable: 1,
	},
	/** A known zero: finalized slip with ₹0 employer cost. */
	knownZero: {
		code: 'E2E-ALLOC-04',
		firstName: 'E2E',
		lastName: 'Known Zero',
		email: 'e2e.alloc.04@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 26000,
	},
	/** Profile covers 2026-03 only; no March Payroll Run is generated. */
	estimateOnly: {
		code: 'E2E-ALLOC-05',
		firstName: 'E2E',
		lastName: 'Estimate Only',
		email: 'e2e.alloc.05@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 26000,
		profileFrom: ALLOCATION_ESTIMATE_MONTH_DAY,
	},
	/** Profile covers 2026-02 only, so 2026-03 has no pricing for them. */
	missingPricing: {
		code: 'E2E-ALLOC-06',
		firstName: 'E2E',
		lastName: 'Missing Pricing',
		email: 'e2e.alloc.06@accent.test',
		employeeType: 'Payroll',
		salaryType: 'monthly',
		ctc: 26000,
		profileTo: '2026-02-28',
	},
} as const;

export type AllocationEmployeeKey = keyof typeof ALLOCATION_EMPLOYEES;

/**
 * Independently stated expectations. The spec asserts these literals; it never
 * calls the report module's own allocation functions to derive them.
 */
export const ALLOCATION_EXPECTED = {
	/** 24 working days × 8h (holiday_master has no 2026-02 holiday). */
	basisHours: 192,
	/** Legacy stream-wise expectations for the finalized month. */
	employees: {
		splitMonthly: {
			slipEmployerCost: 26000,
			hours: 192,
			projectHours: 152,
			noProjectHours: 40,
			recorded: 26000,
			shares: { p1: 10833.33, p2: 9750.0, noProject: 5416.67 },
			adjustments: { p1: 0, p2: 0, noProject: 0.01 },
			payStream: 'payroll',
		},
		contractRounding: {
			slipEmployerCost: 10000,
			hours: 192,
			projectHours: 144,
			noProjectHours: 48,
			recorded: 10000,
			shares: { p1: 3802.08, p2: 3697.92, noProject: 2500.0 },
			adjustments: { p1: 0, p2: 0.01, noProject: 0 },
			payStream: 'contract',
		},
		noHoursBonus: {
			slipEmployerCost: 500,
			hours: 0,
			projectHours: 0,
			noProjectHours: 0,
			recorded: 500,
			shares: { noLoggedHours: 500 },
			adjustments: { noLoggedHours: 0 },
			payStream: 'payroll',
		},
		knownZero: {
			slipEmployerCost: 0,
			hours: 0,
			recorded: 0,
			payStream: 'payroll',
		},
		missingPricing: {
			slipEmployerCost: 0,
			hours: 0,
			recorded: 0,
			payStream: 'payroll',
		},
		estimateOnly: {
			/** 208 basis hours in 2026-03 (31 days − 5 Sundays), 42h logged. */
			estimated: 5250,
			hours: 42,
			shares: { p1: 3000, p2: 2250 },
			payStream: 'payroll',
		},
	},
	/** Month reconciliation after 2026-02 finalizes (no direct costs exist). */
	month: {
		recordedTotal: 36500,
		project1: 14635.41,
		project2: 13447.92,
		unallocated: 8416.67,
		roundedAdjustment: 0.02,
		projectHours: 296,
		noProjectHours: 88,
		totalHours: 384,
		recordedCount: 5,
		knownZeroCount: 2,
	},
	/** 2026-03 estimate month, filtered to the fixture employees. */
	estimateMonth: {
		estimateOnlyEstimated: 5250,
		estimateOnlyP1: 3000,
		estimateOnlyP2: 2250,
		missingPricingHours: 8,
	},
} as const;

export interface SeededAllocation {
	projectIds: { p1: number; p2: number };
	employeeIds: Record<AllocationEmployeeKey, number>;
	/** `payroll_slips.id` of the fixture month, once Generate has run. */
}

/* ── fixture lifecycle ─────────────────────────────────────────────── */

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureAllocationFixtures(): Promise<void> {
	const employeeCodes = Object.values(ALLOCATION_EMPLOYEES).map(
		(employee) => employee.code
	);
	const placeholders = employeeCodes.map(() => '?').join(', ');

	// Allocation evidence is purged by its fixture month (only this module
	// writes allocations for 2026-02) and by the fixture employees' slips.
	await exec(
		`DELETE FROM payroll_employee_allocation_shares
      WHERE allocation_id IN (
        SELECT id FROM payroll_employee_allocations
         WHERE month = ? OR employee_id IN (
           SELECT id FROM employees WHERE employee_id IN (${placeholders})
         )
      )`,
		[ALLOCATION_MONTH_DAY, ...employeeCodes]
	);
	await exec(
		`DELETE FROM payroll_allocation_events
      WHERE allocation_uid IN (
        SELECT allocation_uid FROM payroll_employee_allocations
         WHERE month = ? OR employee_id IN (
           SELECT id FROM employees WHERE employee_id IN (${placeholders})
         )
      )`,
		[ALLOCATION_MONTH_DAY, ...employeeCodes]
	);
	await exec(
		`DELETE FROM payroll_employee_allocations
      WHERE month = ? OR employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		[ALLOCATION_MONTH_DAY, ...employeeCodes]
	);

	// Slips: the fixture month belongs to this module — every slip there is
	// either a fixture employee's, a generated zero of another fixture's
	// employee, or one of the two safety-gate slips below.
	await exec(`DELETE FROM payroll_slips WHERE month = ?`, [
		ALLOCATION_MONTH_DAY,
	]);
	await exec(`DELETE FROM payroll_runs WHERE year = 2026 AND month IN (2, 3)`);

	await exec(
		`DELETE FROM user_activity_assignments
      WHERE id LIKE ? OR employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		[`${ALLOCATION_ASSIGNMENT_PREFIX}%`, ...employeeCodes]
	);
	await exec(
		`DELETE FROM employee_salary_profile
      WHERE employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		employeeCodes
	);
	await exec(`DELETE FROM payroll_schedules WHERE remarks = ?`, [
		ALLOCATION_BONUS_REMARKS,
	]);

	for (const reader of [ALLOCATION_READER, ALLOCATION_FIN_READER]) {
		for (const sql of [
			`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
			`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
			`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username = ?)`,
		]) {
			try {
				await exec(sql, [reader.username]);
			} catch {
				// Optional table — fixture users cannot be blocked on it.
			}
		}
		await exec(
			`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
			[reader.username]
		);
		await exec(`DELETE FROM users WHERE username = ?`, [reader.username]);
		await exec(`DELETE FROM roles_master WHERE role_code = ?`, [
			reader.roleCode,
		]);
	}

	await exec(
		`DELETE FROM user_activity_assignments WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[ALLOCATION_USERNAME]
	);
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[ALLOCATION_USERNAME]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [ALLOCATION_USERNAME]);
	await exec(
		`DELETE FROM employees WHERE employee_id IN (${placeholders})`,
		employeeCodes
	);
}

/** Purge leftovers, then create the allocation fixtures. */
export async function seedExpenditureAllocationFixtures(): Promise<SeededAllocation> {
	await cleanupExpenditureAllocationFixtures();

	const projectIds = {} as { p1: number; p2: number };
	for (const key of ['p1', 'p2'] as const) {
		const project = ALLOCATION_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects
         (project_code, name, project_title, client_name, status, isDelete)
       VALUES (?, ?, ?, ?, 'active', 0)`,
			[project.code, project.name, project.name, project.client]
		);
		projectIds[key] = inserted.insertId;
	}

	const passwordHash = await bcrypt.hash(ALLOCATION_USER.password, 10);
	const fixtureUser = await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
		[
			ALLOCATION_USER.username,
			passwordHash,
			ALLOCATION_USER.email,
			ALLOCATION_USER.fullName,
		]
	);

	const employeeIds = {} as Record<AllocationEmployeeKey, number>;
	for (const key of Object.keys(
		ALLOCATION_EMPLOYEES
	) as AllocationEmployeeKey[]) {
		const employee = ALLOCATION_EMPLOYEES[key];
		const inserted = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', ?, '2026-01-01', 0)`,
			[
				employee.code,
				employee.firstName,
				employee.lastName,
				employee.email,
				employee.employeeType,
			]
		);
		employeeIds[key] = inserted.insertId;

		const profileFrom =
			('profileFrom' in employee && employee.profileFrom) || '2026-01-01';
		const profileTo =
			('profileTo' in employee && employee.profileTo) || null;
		await exec(
			`INSERT INTO employee_salary_profile
         (employee_id, gross, gross_salary, employer_cost, other_allowances,
          effective_from, effective_to, is_active, pf_applicable, esic_applicable,
          pt_applicable, mlwf_applicable, bonus_applicable, salary_type,
          std_hours_per_day, std_working_days, tds_percentage,
          loan_amount, loan_amount_per_month, loan_active, advance_amount, advance_active)
       VALUES (?, ?, ?, ?, 0, ?, ?, 1, 0, 0, 0, 0, ?, ?, 8, 26, 0, 0, 0, 0, 0, 0)`,
			[
				inserted.insertId,
				employee.ctc,
				employee.ctc,
				employee.ctc,
				profileFrom,
				profileTo,
				'bonusApplicable' in employee ? employee.bonusApplicable : 0,
				employee.salaryType,
			]
		);
	}

	await seedAllocationHours(employeeIds, fixtureUser.insertId, projectIds);
	await seedAllocationBonusSchedule();
	await seedAllocationGateSlips(employeeIds);
	await seedAllocationReaders();

	return { projectIds, employeeIds };
}

/**
 * The hours the fixture employees logged. Every entry is stated explicitly so
 * the allocation denominators are fixture literals, not re-derived:
 *   ALLOC-01  P1 80h, P2 72h, no project 40h   (total 192)
 *   ALLOC-02  P1 73h, P2 71h, no project 48h   (total 192)
 *   ALLOC-05  P1 24h, P2 18h                   (2026-03, total 42)
 *   ALLOC-06  P1 8h                            (2026-03)
 */
async function seedAllocationHours(
	employeeIds: Record<AllocationEmployeeKey, number>,
	userId: number,
	projectIds: { p1: number; p2: number }
): Promise<void> {
	const assignments: Array<{
		id: string;
		employee: number;
		project: number | null;
		entries: Array<{ date: string; hours: number }>;
	}> = [
		assignment('01-p1', employeeIds.splitMonthly, projectIds.p1, [
			day(ALLOCATION_MONTH, 2, 8),
			day(ALLOCATION_MONTH, 3, 8),
			day(ALLOCATION_MONTH, 4, 8),
			day(ALLOCATION_MONTH, 5, 8),
			day(ALLOCATION_MONTH, 6, 8),
			day(ALLOCATION_MONTH, 9, 8),
			day(ALLOCATION_MONTH, 10, 8),
			day(ALLOCATION_MONTH, 11, 8),
			day(ALLOCATION_MONTH, 12, 8),
			day(ALLOCATION_MONTH, 13, 8),
		]),
		assignment('01-p2', employeeIds.splitMonthly, projectIds.p2, [
			day(ALLOCATION_MONTH, 16, 8),
			day(ALLOCATION_MONTH, 17, 8),
			day(ALLOCATION_MONTH, 18, 8),
			day(ALLOCATION_MONTH, 19, 8),
			day(ALLOCATION_MONTH, 20, 8),
			day(ALLOCATION_MONTH, 23, 8),
			day(ALLOCATION_MONTH, 24, 8),
			day(ALLOCATION_MONTH, 25, 8),
			day(ALLOCATION_MONTH, 26, 8),
		]),
		assignment('01-none', employeeIds.splitMonthly, null, [
			day(ALLOCATION_MONTH, 27, 8),
			day(ALLOCATION_MONTH, 4, 8),
			day(ALLOCATION_MONTH, 5, 8),
			day(ALLOCATION_MONTH, 6, 8),
			day(ALLOCATION_MONTH, 9, 8),
		]),
		assignment('02-p1', employeeIds.contractRounding, projectIds.p1, [
			day(ALLOCATION_MONTH, 2, 8),
			day(ALLOCATION_MONTH, 3, 8),
			day(ALLOCATION_MONTH, 4, 8),
			day(ALLOCATION_MONTH, 5, 8),
			day(ALLOCATION_MONTH, 6, 8),
			day(ALLOCATION_MONTH, 9, 8),
			day(ALLOCATION_MONTH, 10, 8),
			day(ALLOCATION_MONTH, 11, 8),
			day(ALLOCATION_MONTH, 12, 8),
			day(ALLOCATION_MONTH, 16, 1),
		]),
		assignment('02-p2', employeeIds.contractRounding, projectIds.p2, [
			day(ALLOCATION_MONTH, 16, 7),
			day(ALLOCATION_MONTH, 17, 8),
			day(ALLOCATION_MONTH, 18, 8),
			day(ALLOCATION_MONTH, 19, 8),
			day(ALLOCATION_MONTH, 20, 8),
			day(ALLOCATION_MONTH, 23, 8),
			day(ALLOCATION_MONTH, 24, 8),
			day(ALLOCATION_MONTH, 25, 8),
			day(ALLOCATION_MONTH, 26, 8),
		]),
		assignment('02-none', employeeIds.contractRounding, null, [
			day(ALLOCATION_MONTH, 27, 8),
			day(ALLOCATION_MONTH, 3, 8),
			day(ALLOCATION_MONTH, 4, 8),
			day(ALLOCATION_MONTH, 5, 8),
			day(ALLOCATION_MONTH, 6, 8),
			day(ALLOCATION_MONTH, 9, 8),
		]),
		assignment('05-p1', employeeIds.estimateOnly, projectIds.p1, [
			day(ALLOCATION_ESTIMATE_MONTH, 2, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 3, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 4, 8),
		]),
		assignment('05-p2', employeeIds.estimateOnly, projectIds.p2, [
			day(ALLOCATION_ESTIMATE_MONTH, 5, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 6, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 9, 2),
		]),
		assignment('06-p1', employeeIds.missingPricing, projectIds.p1, [
			day(ALLOCATION_ESTIMATE_MONTH, 10, 8),
		]),
	];

	for (const row of assignments) {
		await exec(
			`INSERT INTO user_activity_assignments
         (id, user_id, employee_id, project_id, activity_id, activity_name,
          status, daily_entries, assigned_date)
       VALUES (?, ?, ?, ?, ?, 'E2E allocation fixture work', 'Completed', ?, ?)`,
			[
				`${ALLOCATION_ASSIGNMENT_PREFIX}${row.id}`,
				userId,
				row.employee,
				row.project,
				`e2e-alloc-activity-${row.id}`,
				JSON.stringify(row.entries),
				`${ALLOCATION_MONTH}-01 09:00:00`,
			]
		);
	}
}

function assignment(
	suffix: string,
	employee: number,
	project: number | null,
	entries: Array<{ date: string; hours: number }>
) {
	return { id: suffix, employee, project, entries };
}

function day(month: string, dayOfMonth: number, hours: number) {
	return {
		date: `${month}-${String(dayOfMonth).padStart(2, '0')}`,
		hours,
	};
}

/** The fixture-owned Bonus Component Rate the no-hours employee prices from. */
async function seedAllocationBonusSchedule(): Promise<void> {
	await exec(
		`INSERT INTO payroll_schedules
       (component_type, value_type, value, effective_from, effective_to, is_active, remarks)
     VALUES ('bonus', 'fixed', ?, ?, NULL, 1, ?)`,
		[ALLOCATION_BONUS_AMOUNT, `${ALLOCATION_MONTH}-01`, ALLOCATION_BONUS_REMARKS]
	);
}

/**
 * Two active Payroll employees in the other fixture namespaces deliberately
 * have no Salary Profile at all (`E2E-ATT-0009`, `E2E-UTIL-0019`), which makes
 * Payroll Finalize refuse every month. They cannot be generated a slip the
 * normal way, so this file writes the zero slip Generate would have written —
 * scoped to the fixture month, deleted by cleanup, never touching their other
 * fixtures or months.
 */
async function seedAllocationGateSlips(
	employeeIds: Record<AllocationEmployeeKey, number>
): Promise<void> {
	const codes = ['E2E-ATT-0009', 'E2E-UTIL-0019'];
	const found = await rows<{ id: number; employee_id: string }>(
		`SELECT id, employee_id FROM employees WHERE employee_id IN (?, ?)`,
		codes
	);
	for (const employee of found) {
		const [existing] = await rows<{ id: number }>(
			`SELECT id FROM payroll_slips WHERE employee_id = ? AND month = ?`,
			[employee.id, ALLOCATION_MONTH_DAY]
		);
		if (existing) continue;
		await exec(
			`INSERT INTO payroll_slips
         (month, employee_id, gross, basic, hra, conveyance, call_allowance,
          total_earnings, total_deductions, net_pay, pf_employer, esic_employer,
          total_employer_contributions, employer_cost, payment_status)
       VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'pending')`,
			[ALLOCATION_MONTH_DAY, employee.id]
		);
	}
	// Keep the unused parameter shape explicit: the fixture month's slip rows
	// are the module's, whether they belong to a namespaced employee or not.
	void employeeIds;
}

/** Roles and users for the two authorization outcomes. */
async function seedAllocationReaders(): Promise<void> {
	for (const reader of [ALLOCATION_READER, ALLOCATION_FIN_READER]) {
		const role = await exec(
			`INSERT INTO roles_master
         (role_code, role_name, role_hierarchy, department, permissions, description, status)
       VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
			[
				reader.roleCode,
				reader.roleName,
				JSON.stringify(reader.permissions),
				'E2E allocation fixture reader (e2e/lib/expenditure-allocation-fixtures.ts)',
			]
		);
		const passwordHash = await bcrypt.hash(reader.password, 10);
		await exec(
			`INSERT INTO users
         (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
       VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
			[
				reader.username,
				passwordHash,
				reader.email,
				reader.fullName,
				role.insertId,
			]
		);
	}
}

/* ── reader sessions ───────────────────────────────────────────────── */

async function loginReader(
	playwright: PlaywrightApi,
	baseURL: string,
	reader: typeof ALLOCATION_READER,
	ip: string
): Promise<APIRequestContext> {
	const probe = await playwright.request.newContext({ baseURL });
	try {
		try {
			await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
				`${ip}:%:auth`,
			]);
		} catch {
			// Pre-migration schema — the limiter is in-memory there.
		}
		const response = await probe.post('/api/login', {
			headers: { 'x-vercel-forwarded-for': ip },
			data: { username: reader.username, password: reader.password },
		});
		if (!response.ok()) {
			throw new Error(
				`[e2e] ${reader.username} login failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] ${reader.username}: login succeeded but no session cookie was set`
			);
		}
		const storageState: { cookies: Cookie[]; origins: [] } = {
			cookies: [
				{
					name: 'session',
					value: match[1],
					domain: new URL(baseURL).hostname,
					path: '/',
					expires: -1,
					httpOnly: true,
					secure: false,
					sameSite: 'Lax',
				},
			],
			origins: [],
		};
		return await playwright.request.newContext({
			baseURL,
			extraHTTPHeaders: { 'x-vercel-forwarded-for': ip },
			storageState,
		});
	} finally {
		await probe.dispose();
	}
}

/** A signed-in request context for the reports:read-only reader. */
export function loginAllocationReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginReader(playwright, baseURL, ALLOCATION_READER, ALLOCATION_READER_IP);
}

/** A signed-in request context for reports:read + other_expenses:read. */
export function loginAllocationFinanceReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginReader(
		playwright,
		baseURL,
		ALLOCATION_FIN_READER,
		ALLOCATION_FIN_READER_IP
	);
}
