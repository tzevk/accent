import bcrypt from 'bcrypt';
import type { Cookie } from '@playwright/test';
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { exec, rows } from './db';

type PlaywrightApi = PlaywrightWorkerArgs['playwright'];

/**
 * Ticket #308 — reviewed historical allocation reconstruction fixtures.
 *
 * One namespace only: projects `E2E-RECON-P1/P2`, employees `E2E-RECON-01..07`,
 * assignments `e2e-recon-assign-*`, the fixture user `e2e_recon_user`, the
 * reader identities `e2e_recon_reader` (financial read gate only),
 * `e2e_recon_finance` (read gate + `other_expenses:update/approve`) and
 * `e2e_recon_expense` (`reports:read` + `other_expenses:read/update/approve`
 * **without** `payroll:read`, to isolate the missing payroll source read), and
 * the months **2018-01** (`RECONSTRUCTION_MONTH`, the reviewed month) and
 * **2018-02** (`RECONSTRUCTION_PENDING_MONTH`, the month left pending). No
 * other ticket uses either month; `E2E-ALLOC-*`, `E2E-EXP-*`, `E2E-EMP-*`,
 * `E2E-UTIL-*` and `E2E-ATT-*` rows are never read, mutated, or cleaned here.
 *
 * The fixture writes the *legacy* state the current Payroll Finalize path can
 * no longer produce: a `finalized` Payroll Run whose Payroll Slips carry no
 * saved allocation shares and no hours-basis columns — exactly what a
 * finalized month from before #307 looks like. Reconstruction never reads
 * those slips through a Salary Profile; it uses the recorded employer cost and
 * the month's Logged Hours.
 *
 * Independent literals (asserted by the spec, never derived by calling the
 * module under test):
 *
 *   E2E-RECON-01  slip ₹26,000; hours P1 80h + P2 72h + no project 40h = 192h
 *                 exact shares ₹10,833.33⅓ / ₹9,750.00 / ₹5,416.66⅔ leave one
 *                 cent, which goes to the largest remainder (No project):
 *                 ₹10,833.33 / ₹9,750.00 / ₹5,416.67, adjustment +₹0.01.
 *                 A monthly profile (₹26,000) covers 2018-01 so the report
 *                 shows the estimate → recorded transition.
 *   E2E-RECON-02  slip ₹7,500; **no** assignments in the month → the whole
 *                 amount freezes unallocated (`timesheet_missing`).
 *   E2E-RECON-03  slip ₹9,000; hours P1 90h + no project 10h = 100h → exact
 *                 ₹8,100.00 / ₹900.00, limitation `hours_without_project`;
 *                 a canonical *contract* profile makes pay_stream 'contract'.
 *   E2E-RECON-04  slip ₹12,000; hours P2 60h → ₹12,000.00. The reject →
 *                 re-propose flow.
 *   E2E-RECON-05  slip ₹5,000; hours P1 25h → ₹5,000.00. The concurrent
 *                 propose/approve flow.
 *   E2E-RECON-06  slip ₹3,000; hours P1 30h + P2 30h + no project 30h = 90h →
 *                 ₹1,000.00 each. The stale-version flow: the reviewed
 *                 proposal freezes even after the timesheet changes.
 *   E2E-RECON-07  (2018-02) slip ₹6,000; hours P1 27h + P2 27h = 54h →
 *                 ₹3,000.00 / ₹3,000.00; a ₹99,000 monthly profile covers
 *                 2018-02, so the payroll estimate must never price the
 *                 reconstruction.
 *
 * Cleanup owns only fixture rows and refuses to run when the fixture months
 * hold a Payroll Slip of a non-`E2E-RECON-` employee, a reconstruction
 * proposal outside the namespace, or a locked Payroll Run without fixture
 * slips to prove ownership. A shared dev target therefore cannot lose real
 * payroll; the harness is meant for the isolated E2E database.
 */

export const RECONSTRUCTION_MONTH = '2018-01';
export const RECONSTRUCTION_MONTH_DAY = '2018-01-01';
export const RECONSTRUCTION_PENDING_MONTH = '2018-02';
export const RECONSTRUCTION_PENDING_MONTH_DAY = '2018-02-01';

export const RECONSTRUCTION_EMPLOYEE_PREFIX = 'E2E-RECON-';
export const RECONSTRUCTION_ASSIGNMENT_PREFIX = 'e2e-recon-assign-';
export const RECONSTRUCTION_USERNAME = 'e2e_recon_user';
export const RECONSTRUCTION_ADMIN_IP = '198.18.0.101';
export const RECONSTRUCTION_READER_IP = '198.18.0.102';
export const RECONSTRUCTION_FINANCE_IP = '198.18.0.103';

export const RECONSTRUCTION_USER = {
	username: RECONSTRUCTION_USERNAME,
	password: 'e2e-recon-user-password',
	email: 'e2e.recon.user@accent.test',
	fullName: 'E2E Reconstruction Fixture User',
};

/** The financial read gate only: may read the payroll drilldown, never act. */
export const RECONSTRUCTION_READER = {
	username: 'e2e_recon_reader',
	password: 'e2e-recon-reader-password',
	email: 'e2e.recon.reader@accent.test',
	fullName: 'E2E Reconstruction Report Reader',
	roleCode: 'e2e_recon_reader_role',
	roleName: 'E2E Reconstruction Report Reader',
	permissions: ['reports:read', 'other_expenses:read', 'payroll:read'],
};

/** The authorized non-super-admin reviewer: read gate + operation privilege. */
export const RECONSTRUCTION_FINANCE = {
	username: 'e2e_recon_finance',
	password: 'e2e-recon-finance-password',
	email: 'e2e.recon.finance@accent.test',
	fullName: 'E2E Reconstruction Finance Reviewer',
	roleCode: 'e2e_recon_finance_role',
	roleName: 'E2E Reconstruction Finance Reviewer',
	permissions: [
		'reports:read',
		'other_expenses:read',
		'payroll:read',
		'other_expenses:update',
		'other_expenses:approve',
	],
};

/** Operation privileges without the payroll source read: must be refused. */
export const RECONSTRUCTION_EXPENSE = {
	username: 'e2e_recon_expense',
	password: 'e2e-recon-expense-password',
	email: 'e2e.recon.expense@accent.test',
	fullName: 'E2E Reconstruction Expense Only',
	roleCode: 'e2e_recon_expense_role',
	roleName: 'E2E Reconstruction Expense Only',
	permissions: [
		'reports:read',
		'other_expenses:read',
		'other_expenses:update',
		'other_expenses:approve',
	],
};

export const RECONSTRUCTION_PROJECTS = {
	p1: {
		code: 'E2E-RECON-P1',
		name: 'E2E Reconstruction Project One',
		client: 'E2E Reconstruction Client',
	},
	p2: {
		code: 'E2E-RECON-P2',
		name: 'E2E Reconstruction Project Two',
		client: 'E2E Reconstruction Client',
	},
} as const;

export const RECONSTRUCTION_EMPLOYEES = {
	/** Rounding case: two Projects, no-project hours, profile for the estimate. */
	splitMonthly: {
		code: 'E2E-RECON-01',
		firstName: 'E2E',
		lastName: 'Recon Split Monthly',
		email: 'e2e.recon.01@accent.test',
		employeeType: 'Permanent',
		slipEmployerCost: 26000,
		profile: {
			salaryType: 'monthly',
			ctc: 26000,
			from: RECONSTRUCTION_MONTH_DAY,
			to: '2018-01-31',
		},
	},
	/** Missing timesheets: the whole recorded cost stays unallocated. */
	missingTimesheets: {
		code: 'E2E-RECON-02',
		firstName: 'E2E',
		lastName: 'Recon Missing Timesheets',
		email: 'e2e.recon.02@accent.test',
		employeeType: 'Permanent',
		slipEmployerCost: 7500,
		profile: null,
	},
	/** Partial hours: some hours without a Project; contract pay stream. */
	partialHours: {
		code: 'E2E-RECON-03',
		firstName: 'E2E',
		lastName: 'Recon Partial Hours',
		email: 'e2e.recon.03@accent.test',
		employeeType: 'Contract',
		slipEmployerCost: 9000,
		profile: {
			salaryType: 'contract',
			ctc: 9000,
			from: RECONSTRUCTION_MONTH_DAY,
			to: '2018-01-31',
		},
	},
	/** The reject → re-propose flow. */
	rejected: {
		code: 'E2E-RECON-04',
		firstName: 'E2E',
		lastName: 'Recon Rejected',
		email: 'e2e.recon.04@accent.test',
		employeeType: 'Permanent',
		slipEmployerCost: 12000,
		profile: null,
	},
	/** The concurrent propose/approve flow. */
	concurrent: {
		code: 'E2E-RECON-05',
		firstName: 'E2E',
		lastName: 'Recon Concurrent',
		email: 'e2e.recon.05@accent.test',
		employeeType: 'Permanent',
		slipEmployerCost: 5000,
		profile: null,
	},
	/** The stale review and freeze-the-reviewed-figures flow. */
	staleFreeze: {
		code: 'E2E-RECON-06',
		firstName: 'E2E',
		lastName: 'Recon Stale Freeze',
		email: 'e2e.recon.06@accent.test',
		employeeType: 'Permanent',
		slipEmployerCost: 3000,
		profile: null,
	},
	/** The 2018-02 pending proposal with an inflated Salary Profile. */
	pendingMonth: {
		code: 'E2E-RECON-07',
		firstName: 'E2E',
		lastName: 'Recon Pending Month',
		email: 'e2e.recon.07@accent.test',
		employeeType: 'Permanent',
		slipEmployerCost: 6000,
		profile: {
			salaryType: 'monthly',
			ctc: 99000,
			from: RECONSTRUCTION_PENDING_MONTH_DAY,
			to: null,
		},
	},
} as const;

export type ReconstructionEmployeeKey = keyof typeof RECONSTRUCTION_EMPLOYEES;

/**
 * Independently stated expectations. The spec asserts these literals; it never
 * calls the report module's own allocation functions to derive them.
 */
export const RECONSTRUCTION_EXPECTED = {
	month: {
		/** Slips of 2018-01, per employee. */
		employees: {
			splitMonthly: {
				slipEmployerCost: 26000,
				totalHours: 192,
				projectHours: 152,
				noProjectHours: 40,
				shares: { p1: 10833.33, p2: 9750.0, noProject: 5416.67 },
				adjustments: { p1: 0, p2: 0, noProject: 0.01 },
				payStream: 'payroll',
				limitations: [] as string[],
			},
			missingTimesheets: {
				slipEmployerCost: 7500,
				totalHours: 0,
				projectHours: 0,
				noProjectHours: 0,
				shares: { noLoggedHours: 7500 },
				payStream: 'payroll',
				limitations: ['timesheet_missing'],
			},
			partialHours: {
				slipEmployerCost: 9000,
				totalHours: 100,
				projectHours: 90,
				noProjectHours: 10,
				shares: { p1: 8100.0, noProject: 900.0 },
				payStream: 'contract',
				limitations: ['hours_without_project'],
			},
			rejected: {
				slipEmployerCost: 12000,
				totalHours: 60,
				shares: { p2: 12000.0 },
				limitations: [] as string[],
			},
			concurrent: {
				slipEmployerCost: 5000,
				totalHours: 25,
				shares: { p1: 5000.0 },
				limitations: [] as string[],
			},
			staleFreeze: {
				slipEmployerCost: 3000,
				totalHours: 90,
				shares: { p1: 1000.0, p2: 1000.0, noProject: 1000.0 },
				limitations: [] as string[],
			},
		},
		/** The month after every reviewed flow, read through the report. */
		recordedTotal: 50500,
		recordedCount: 5,
		knownZeroCount: 0,
		allocationMissingCount: 1,
		roundingAdjustment: 0.01,
		project1: 24933.33,
		project2: 10750,
		unallocated: 14816.67,
	},
	pendingMonth: {
		slipEmployerCost: 6000,
		totalHours: 54,
		projectHours: 54,
		noProjectHours: 0,
		shares: { p1: 3000.0, p2: 3000.0 },
		profileCtc: 99000,
	},
} as const;

export interface SeededReconstruction {
	projectIds: { p1: number; p2: number };
	employeeIds: Record<ReconstructionEmployeeKey, number>;
}

/* ── fixture lifecycle ─────────────────────────────────────────────── */

/**
 * Refuse the fixture months when they are not ours to clean: any Payroll Slip
 * in 2018-01/2018-02 outside the `E2E-RECON-` namespace, any reconstruction
 * proposal outside it, or a locked Payroll Run with no fixture slips to prove
 * ownership. The harness is meant for the isolated E2E database; this keeps a
 * shared dev target safe.
 */
async function assertFixtureMonthsFree(): Promise<void> {
	const monthDays = [
		RECONSTRUCTION_MONTH_DAY,
		RECONSTRUCTION_PENDING_MONTH_DAY,
	];
	const slips = await rows<{ month: string; code: string | null }>(
		`SELECT ps.month, e.employee_id AS code
       FROM payroll_slips ps
       LEFT JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month IN (?, ?)`,
		monthDays
	);
	const foreign = slips.filter(
		(slip) =>
			!String(slip.code ?? '').startsWith(RECONSTRUCTION_EMPLOYEE_PREFIX)
	);
	if (foreign.length > 0) {
		throw new Error(
			`[e2e] reconstruction fixture month holds ${foreign.length} Payroll Slip(s) of non-fixture employees ` +
				`(e.g. ${foreign[0].code ?? 'unknown employee'}). Point the harness at the isolated E2E database ` +
				'instead of touching real payroll data.'
		);
	}
	const proposals = await rows<{ proposal_uid: string; code: string | null }>(
		`SELECT p.proposal_uid, e.employee_id AS code
       FROM payroll_allocation_reconstruction_proposals p
       LEFT JOIN employees e ON e.id = p.employee_id
      WHERE p.month IN (?, ?)`,
		monthDays
	);
	const foreignProposals = proposals.filter(
		(proposal) =>
			!String(proposal.code ?? '').startsWith(RECONSTRUCTION_EMPLOYEE_PREFIX)
	);
	if (foreignProposals.length > 0) {
		throw new Error(
			`[e2e] reconstruction fixture month holds ${foreignProposals.length} reconstruction proposal(s) ` +
				'outside the E2E-RECON- namespace.'
		);
	}
	const locked = await rows<{ month: number; status: string }>(
		`SELECT month, status FROM payroll_runs
      WHERE year = 2018 AND month IN (1, 2) AND status <> 'draft'`
	);
	for (const run of locked) {
		const monthDay = `2018-${String(run.month).padStart(2, '0')}-01`;
		const owned = slips.some(
			(slip) => String(slip.month).slice(0, 10) === monthDay
		);
		if (!owned) {
			throw new Error(
				`[e2e] reconstruction fixture month ${monthDay} holds a ${run.status} Payroll Run with no fixture slips ` +
					'to prove ownership. Point the harness at the isolated E2E database instead of touching real payroll data.'
			);
		}
	}
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureReconstructionFixtures(): Promise<void> {
	await assertFixtureMonthsFree();

	const employeeCodes = Object.values(RECONSTRUCTION_EMPLOYEES).map(
		(employee) => employee.code
	);
	const placeholders = employeeCodes.map(() => '?').join(', ');
	// Fixture ownership is the E2E-RECON- Employee-code namespace, so a shared
	// database's real Employees, slips, and allocations are never touched.
	const FIXTURE_EMPLOYEES = `employee_id IN (
    SELECT id FROM employees WHERE employee_id LIKE '${RECONSTRUCTION_EMPLOYEE_PREFIX}%'
  )`;
	const monthDays = [
		RECONSTRUCTION_MONTH_DAY,
		RECONSTRUCTION_PENDING_MONTH_DAY,
	];

	// Reconstruction evidence: proposals and shares of the fixture months and
	// Employees — the guard above refused anything else.
	await exec(
		`DELETE FROM payroll_allocation_reconstruction_shares
      WHERE proposal_id IN (
        SELECT id FROM payroll_allocation_reconstruction_proposals
         WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}
      )`,
		[...monthDays]
	);
	await exec(
		`DELETE FROM payroll_allocation_reconstruction_proposals
      WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}`,
		[...monthDays]
	);

	// Frozen allocations written by an approved reconstruction, and any other
	// allocation of a fixture Employee in a fixture month.
	await exec(
		`DELETE FROM payroll_employee_allocation_shares
      WHERE allocation_id IN (
        SELECT id FROM payroll_employee_allocations
         WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}
      )`,
		[...monthDays]
	);
	await exec(
		`DELETE FROM payroll_allocation_events
      WHERE allocation_uid IN (
        SELECT allocation_uid FROM payroll_employee_allocations
         WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}
      )`,
		[...monthDays]
	);
	await exec(
		`DELETE FROM payroll_employee_allocations
      WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}`,
		[...monthDays]
	);

	await exec(
		`DELETE FROM payroll_slips
      WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}`,
		[...monthDays]
	);
	// Runs for the fixture months: the guard above proved every slip in them is
	// fixture-owned, so a run left by this module is ours to remove.
	await exec(`DELETE FROM payroll_runs WHERE year = 2018 AND month IN (1, 2)`);

	await exec(
		`DELETE FROM user_activity_assignments
      WHERE id LIKE ? OR employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		[`${RECONSTRUCTION_ASSIGNMENT_PREFIX}%`, ...employeeCodes]
	);
	await exec(
		`DELETE FROM employee_salary_profile
      WHERE employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		employeeCodes
	);

	for (const reader of [
		RECONSTRUCTION_READER,
		RECONSTRUCTION_FINANCE,
		RECONSTRUCTION_EXPENSE,
	]) {
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
		[RECONSTRUCTION_USERNAME]
	);
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[RECONSTRUCTION_USERNAME]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [RECONSTRUCTION_USERNAME]);
	await exec(
		`DELETE FROM employees WHERE employee_id IN (${placeholders})`,
		employeeCodes
	);
}

/** Purge leftovers, then create the reconstruction fixtures. */
export async function seedExpenditureReconstructionFixtures(): Promise<SeededReconstruction> {
	await cleanupExpenditureReconstructionFixtures();

	const projectIds = {} as { p1: number; p2: number };
	for (const key of ['p1', 'p2'] as const) {
		const project = RECONSTRUCTION_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects
         (project_code, name, project_title, client_name, status, isDelete)
       VALUES (?, ?, ?, ?, 'active', 0)`,
			[project.code, project.name, project.name, project.client]
		);
		projectIds[key] = inserted.insertId;
	}

	const passwordHash = await bcrypt.hash(RECONSTRUCTION_USER.password, 10);
	const fixtureUser = await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
		[
			RECONSTRUCTION_USER.username,
			passwordHash,
			RECONSTRUCTION_USER.email,
			RECONSTRUCTION_USER.fullName,
		]
	);

	const employeeIds = {} as Record<ReconstructionEmployeeKey, number>;
	for (const key of Object.keys(
		RECONSTRUCTION_EMPLOYEES
	) as ReconstructionEmployeeKey[]) {
		const employee = RECONSTRUCTION_EMPLOYEES[key];
		const inserted = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', ?, '2018-01-01', 0)`,
			[
				employee.code,
				employee.firstName,
				employee.lastName,
				employee.email,
				employee.employeeType,
			]
		);
		employeeIds[key] = inserted.insertId;

		if (employee.profile) {
			await exec(
				`INSERT INTO employee_salary_profile
           (employee_id, gross, gross_salary, employer_cost, other_allowances,
            effective_from, effective_to, is_active, pf_applicable, esic_applicable,
            pt_applicable, mlwf_applicable, bonus_applicable, salary_type,
            std_hours_per_day, std_working_days, tds_percentage,
            loan_amount, loan_amount_per_month, loan_active, advance_amount, advance_active)
         VALUES (?, ?, ?, ?, 0, ?, ?, 1, 0, 0, 0, 0, 0, ?, 8, 26, 0, 0, 0, 0, 0, 0)`,
				[
					inserted.insertId,
					employee.profile.ctc,
					employee.profile.ctc,
					employee.profile.ctc,
					employee.profile.from,
					employee.profile.to,
					employee.profile.salaryType,
				]
			);
		}
	}

	await seedReconstructionHours(employeeIds, fixtureUser.insertId, projectIds);
	await seedReconstructionSlips(employeeIds);
	await seedReconstructionRuns();
	await seedReconstructionReaders();

	return { projectIds, employeeIds };
}

/**
 * The Logged Hours the fixture employees recorded. Every entry is stated in the
 * literals above so the reconstruction denominators are fixture facts, not
 * re-derived.
 */
async function seedReconstructionHours(
	employeeIds: Record<ReconstructionEmployeeKey, number>,
	userId: number,
	projectIds: { p1: number; p2: number }
): Promise<void> {
	const assignments: Array<{
		id: string;
		employee: number;
		project: number | null;
		entries: Array<{ date: string; hours: number }>;
	}> = [
		// E2E-RECON-01: P1 80h, P2 72h, no project 40h.
		assignment('01-p1', employeeIds.splitMonthly, projectIds.p1, [
			day(RECONSTRUCTION_MONTH, 2, 8),
			day(RECONSTRUCTION_MONTH, 3, 8),
			day(RECONSTRUCTION_MONTH, 4, 8),
			day(RECONSTRUCTION_MONTH, 5, 8),
			day(RECONSTRUCTION_MONTH, 8, 8),
			day(RECONSTRUCTION_MONTH, 9, 8),
			day(RECONSTRUCTION_MONTH, 10, 8),
			day(RECONSTRUCTION_MONTH, 11, 8),
			day(RECONSTRUCTION_MONTH, 12, 8),
			day(RECONSTRUCTION_MONTH, 15, 8),
		]),
		assignment('01-p2', employeeIds.splitMonthly, projectIds.p2, [
			day(RECONSTRUCTION_MONTH, 16, 8),
			day(RECONSTRUCTION_MONTH, 17, 8),
			day(RECONSTRUCTION_MONTH, 18, 8),
			day(RECONSTRUCTION_MONTH, 19, 8),
			day(RECONSTRUCTION_MONTH, 22, 8),
			day(RECONSTRUCTION_MONTH, 23, 8),
			day(RECONSTRUCTION_MONTH, 24, 8),
			day(RECONSTRUCTION_MONTH, 25, 8),
			day(RECONSTRUCTION_MONTH, 26, 8),
		]),
		assignment('01-none', employeeIds.splitMonthly, null, [
			day(RECONSTRUCTION_MONTH, 29, 8),
			day(RECONSTRUCTION_MONTH, 30, 8),
			day(RECONSTRUCTION_MONTH, 31, 8),
			day(RECONSTRUCTION_MONTH, 5, 8),
			day(RECONSTRUCTION_MONTH, 6, 8),
		]),
		// E2E-RECON-02 has no assignment at all: missing timesheet evidence.
		// E2E-RECON-03: P1 90h, no project 10h.
		assignment('03-p1', employeeIds.partialHours, projectIds.p1, [
			day(RECONSTRUCTION_MONTH, 2, 8),
			day(RECONSTRUCTION_MONTH, 3, 8),
			day(RECONSTRUCTION_MONTH, 4, 8),
			day(RECONSTRUCTION_MONTH, 5, 8),
			day(RECONSTRUCTION_MONTH, 8, 8),
			day(RECONSTRUCTION_MONTH, 9, 8),
			day(RECONSTRUCTION_MONTH, 10, 8),
			day(RECONSTRUCTION_MONTH, 11, 8),
			day(RECONSTRUCTION_MONTH, 12, 8),
			day(RECONSTRUCTION_MONTH, 15, 8),
			day(RECONSTRUCTION_MONTH, 16, 8),
			day(RECONSTRUCTION_MONTH, 17, 2),
		]),
		assignment('03-none', employeeIds.partialHours, null, [
			day(RECONSTRUCTION_MONTH, 18, 8),
			day(RECONSTRUCTION_MONTH, 19, 2),
		]),
		// E2E-RECON-04: P2 60h.
		assignment('04-p2', employeeIds.rejected, projectIds.p2, [
			day(RECONSTRUCTION_MONTH, 2, 8),
			day(RECONSTRUCTION_MONTH, 3, 8),
			day(RECONSTRUCTION_MONTH, 4, 8),
			day(RECONSTRUCTION_MONTH, 5, 8),
			day(RECONSTRUCTION_MONTH, 8, 8),
			day(RECONSTRUCTION_MONTH, 9, 8),
			day(RECONSTRUCTION_MONTH, 10, 8),
			day(RECONSTRUCTION_MONTH, 11, 4),
		]),
		// E2E-RECON-05: P1 25h.
		assignment('05-p1', employeeIds.concurrent, projectIds.p1, [
			day(RECONSTRUCTION_MONTH, 2, 8),
			day(RECONSTRUCTION_MONTH, 3, 8),
			day(RECONSTRUCTION_MONTH, 4, 8),
			day(RECONSTRUCTION_MONTH, 5, 1),
		]),
		// E2E-RECON-06: P1 30h, P2 30h, no project 30h.
		assignment('06-p1', employeeIds.staleFreeze, projectIds.p1, [
			day(RECONSTRUCTION_MONTH, 2, 8),
			day(RECONSTRUCTION_MONTH, 3, 8),
			day(RECONSTRUCTION_MONTH, 4, 8),
			day(RECONSTRUCTION_MONTH, 5, 6),
		]),
		assignment('06-p2', employeeIds.staleFreeze, projectIds.p2, [
			day(RECONSTRUCTION_MONTH, 8, 8),
			day(RECONSTRUCTION_MONTH, 9, 8),
			day(RECONSTRUCTION_MONTH, 10, 8),
			day(RECONSTRUCTION_MONTH, 11, 6),
		]),
		assignment('06-none', employeeIds.staleFreeze, null, [
			day(RECONSTRUCTION_MONTH, 12, 8),
			day(RECONSTRUCTION_MONTH, 15, 8),
			day(RECONSTRUCTION_MONTH, 16, 8),
			day(RECONSTRUCTION_MONTH, 17, 6),
		]),
		// E2E-RECON-07 (2018-02): P1 27h, P2 27h.
		assignment('07-p1', employeeIds.pendingMonth, projectIds.p1, [
			day(RECONSTRUCTION_PENDING_MONTH, 2, 8),
			day(RECONSTRUCTION_PENDING_MONTH, 3, 8),
			day(RECONSTRUCTION_PENDING_MONTH, 4, 8),
			day(RECONSTRUCTION_PENDING_MONTH, 5, 3),
		]),
		assignment('07-p2', employeeIds.pendingMonth, projectIds.p2, [
			day(RECONSTRUCTION_PENDING_MONTH, 6, 8),
			day(RECONSTRUCTION_PENDING_MONTH, 7, 8),
			day(RECONSTRUCTION_PENDING_MONTH, 8, 8),
			day(RECONSTRUCTION_PENDING_MONTH, 9, 3),
		]),
	];

	for (const row of assignments) {
		await exec(
			`INSERT INTO user_activity_assignments
         (id, user_id, employee_id, project_id, activity_id, activity_name,
          status, daily_entries, assigned_date)
       VALUES (?, ?, ?, ?, ?, 'E2E reconstruction fixture work', 'Completed', ?, ?)`,
			[
				`${RECONSTRUCTION_ASSIGNMENT_PREFIX}${row.id}`,
				userId,
				row.employee,
				row.project,
				`e2e-recon-activity-${row.id}`,
				JSON.stringify(row.entries),
				`${RECONSTRUCTION_MONTH}-01 09:00:00`,
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

/**
 * The legacy Payroll Slips: the recorded employer cost the reconstruction
 * allocates, written without any hours-basis column (the pre-#307 state).
 */
async function seedReconstructionSlips(
	employeeIds: Record<ReconstructionEmployeeKey, number>
): Promise<void> {
	for (const key of Object.keys(
		RECONSTRUCTION_EMPLOYEES
	) as ReconstructionEmployeeKey[]) {
		const employee = RECONSTRUCTION_EMPLOYEES[key];
		const month =
			key === 'pendingMonth'
				? RECONSTRUCTION_PENDING_MONTH_DAY
				: RECONSTRUCTION_MONTH_DAY;
		await exec(
			`INSERT INTO payroll_slips
         (month, employee_id, gross, basic, hra, conveyance, call_allowance,
          total_earnings, total_deductions, net_pay, employer_cost, payment_status)
       VALUES (?, ?, ?, 0, 0, 0, 0, ?, 0, ?, ?, 'pending')`,
			[
				month,
				employeeIds[key],
				employee.slipEmployerCost,
				employee.slipEmployerCost,
				employee.slipEmployerCost,
				employee.slipEmployerCost,
			]
		);
	}
}

/** The finalized historical Payroll Runs the slips belong to. */
async function seedReconstructionRuns(): Promise<void> {
	for (const month of [1, 2]) {
		await exec(
			`INSERT INTO payroll_runs (month, year, run_number, status)
       VALUES (?, 2018, 1, 'finalized')`,
			[month]
		);
	}
}

/** Roles and users for the three authorization outcomes. */
async function seedReconstructionReaders(): Promise<void> {
	for (const reader of [
		RECONSTRUCTION_READER,
		RECONSTRUCTION_FINANCE,
		RECONSTRUCTION_EXPENSE,
	]) {
		const role = await exec(
			`INSERT INTO roles_master
         (role_code, role_name, role_hierarchy, department, permissions, description, status)
       VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
			[
				reader.roleCode,
				reader.roleName,
				JSON.stringify(reader.permissions),
				'E2E reconstruction fixture reader (e2e/lib/expenditure-reconstruction-fixtures.ts)',
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

export interface ReconstructionSession {
	request: APIRequestContext;
	/** The same session as a browser storage state, for UI authorization proof. */
	storageState: { cookies: Cookie[]; origins: [] };
	userId: number;
}

/**
 * Sign one fixture identity in through the real login route at its trusted IP,
 * returning both an API request context and the cookie storage state a browser
 * context can adopt.
 */
async function loginIdentity(
	playwright: PlaywrightApi,
	baseURL: string,
	reader: typeof RECONSTRUCTION_READER,
	ip: string
): Promise<ReconstructionSession> {
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
		const stored = await rows<{ id: number }>(
			`SELECT id FROM users WHERE username = ?`,
			[reader.username]
		);
		return {
			request: await playwright.request.newContext({
				baseURL,
				extraHTTPHeaders: { 'x-vercel-forwarded-for': ip },
				storageState,
			}),
			storageState,
			userId: Number(stored[0]?.id ?? 0),
		};
	} finally {
		await probe.dispose();
	}
}

/** The financial read gate only (reports + other_expenses + payroll read). */
export function loginReconstructionReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<ReconstructionSession> {
	return loginIdentity(
		playwright,
		baseURL,
		RECONSTRUCTION_READER,
		RECONSTRUCTION_READER_IP
	);
}

/** The authorized reviewer (read gate + `other_expenses:update/approve`). */
export function loginReconstructionFinance(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<ReconstructionSession> {
	return loginIdentity(
		playwright,
		baseURL,
		RECONSTRUCTION_FINANCE,
		RECONSTRUCTION_FINANCE_IP
	);
}

/** Operation privileges without `payroll:read`: must be refused. */
export function loginReconstructionExpense(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<ReconstructionSession> {
	return loginIdentity(
		playwright,
		baseURL,
		RECONSTRUCTION_EXPENSE,
		RECONSTRUCTION_READER_IP
	);
}
