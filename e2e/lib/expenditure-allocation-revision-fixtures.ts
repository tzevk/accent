import bcrypt from 'bcrypt';
import type { Cookie } from '@playwright/test';
import type {
	APIRequestContext,
	Playwright as PlaywrightApi,
} from '@playwright/test';
import { exec, rows } from './db';

/**
 * Ticket #309 — Project Cost Allocation Revision fixtures.
 *
 * One namespace only: projects `E2E-REV-P1/P2`, employees `E2E-REV-01/02`,
 * assignments `e2e-rev-assign-*`, the fixture user `e2e_rev_user`, the
 * revision identities `e2e_rev_reader` / `e2e_rev_finance` / `e2e_rev_payroll`,
 * and the months **2018-03** (`REVISION_MONTH`, the revised month) and
 * **2018-04** (`REVISION_PAID_MONTH`, the paid-month restrictions month). No
 * other ticket uses either month; `E2E-ALLOC-*`, `E2E-RECON-*`, `E2E-EXP-*`,
 * `E2E-EMP-*`, `E2E-UTIL-*` and `E2E-ATT-*` rows are never read, mutated, or
 * cleaned here except the inert gate slips below (the same enabler #307 writes
 * for its own month).
 *
 * Cleanup owns only fixture rows: allocations/slips are deleted for `E2E-`
 * coded Employees in the fixture months, and cleanup/seed refuse with a thrown
 * error when either month holds a Payroll Slip of a non-fixture Employee or a
 * locked Payroll Run with no fixture slips to prove ownership. A shared dev
 * target therefore cannot lose real payroll; the harness is meant for the
 * isolated E2E database.
 *
 * The fixture amounts are stated once here and derived by hand from the
 * payroll rules (ADR-0010 hours-based pay, zero statutory flags, gratuity =
 * round(4.81 % of Basic), Basic = 60 % of the priced gross):
 *
 *   2018-03 has 31 days and 4 Sundays and no `holiday_master` row, so 27
 *   working days × 8h = 216 basis hours — the calendar the payroll calculator
 *   reads through `getWorkingDaysForMonth`.
 *   E2E-REV-01 monthly CTC ₹21,600 → hourly 100.00/h; 162h logged → gross
 *   ₹16,200.00, Basic ₹9,720.00, gratuity round(₹467.532) = ₹468 →
 *   employer cost ₹16,668.00.
 *
 *   2018-04 has 30 days and 5 Sundays and no holiday, so 25 working days × 8h
 *   = 200 basis hours. E2E-REV-02 contract CTC ₹20,000 → hourly 100.00/h;
 *   120h logged → gross ₹12,000.00, Basic ₹7,200.00, gratuity
 *   round(₹346.32) = ₹346 → employer cost ₹12,346.00.
 *
 *   The cents below are the deterministic largest-remainder split of each
 *   employer cost over the destination hours (exact share floored to the cent,
 *   remaining cents to the largest fractional remainders, ties by larger
 *   hours then canonical destination order — Project id ascending, No project
 *   last). Every revision states corrected hours; the command re-runs the same
 *   rule, so the new cents are stated here the same way.
 */

export const REVISION_MONTH = '2018-03';
export const REVISION_MONTH_DAY = `${REVISION_MONTH}-01`;
export const REVISION_PAID_MONTH = '2018-04';
export const REVISION_PAID_MONTH_DAY = `${REVISION_PAID_MONTH}-01`;

export const REVISION_EMPLOYEE_PREFIX = 'E2E-REV-';
export const REVISION_ASSIGNMENT_PREFIX = 'e2e-rev-assign-';
export const REVISION_USERNAME = 'e2e_rev_user';
export const REVISION_ADMIN_IP = '198.18.0.104';
export const REVISION_READER_IP = '198.18.0.105';
export const REVISION_FINANCE_IP = '198.18.0.106';

export const REVISION_USER = {
	username: REVISION_USERNAME,
	password: 'e2e-rev-user-password',
	email: 'e2e.rev.user@accent.test',
	fullName: 'E2E Revision Fixture User',
};

/** Financial read gate only — may read history, never revise. */
export const REVISION_READER = {
	username: 'e2e_rev_reader',
	password: 'e2e-rev-reader-password',
	email: 'e2e.rev.reader@accent.test',
	fullName: 'E2E Revision Report Reader',
	roleCode: 'e2e_rev_reader_role',
	roleName: 'E2E Revision Report Reader',
	permissions: ['reports:read', 'other_expenses:read', 'payroll:read'],
};

/** Financial read gate plus the payroll write privilege — revises. */
export const REVISION_FINANCE = {
	username: 'e2e_rev_finance',
	password: 'e2e-rev-finance-password',
	email: 'e2e.rev.finance@accent.test',
	fullName: 'E2E Revision Finance Operator',
	roleCode: 'e2e_rev_finance_role',
	roleName: 'E2E Revision Finance Operator',
	permissions: [
		'reports:read',
		'other_expenses:read',
		'payroll:read',
		'payroll:update',
	],
};

/** `payroll:update` without the expense-source read — the conjunction refuses. */
export const REVISION_PAYROLL_ONLY = {
	username: 'e2e_rev_payroll',
	password: 'e2e-rev-payroll-password',
	email: 'e2e.rev.payroll@accent.test',
	fullName: 'E2E Revision Payroll Writer',
	roleCode: 'e2e_rev_payroll_role',
	roleName: 'E2E Revision Payroll Writer',
	permissions: ['payroll:read', 'payroll:update'],
};

export const REVISION_PROJECTS = {
	p1: {
		code: 'E2E-REV-P1',
		name: 'E2E Revision Project One',
		client: 'E2E Revision Client',
	},
	p2: {
		code: 'E2E-REV-P2',
		name: 'E2E Revision Project Two',
		client: 'E2E Revision Client',
	},
} as const;

export const REVISION_EMPLOYEES = {
	/** Monthly stream, revised twice in 2018-03. */
	monthly: {
		code: 'E2E-REV-01',
		firstName: 'E2E',
		lastName: 'Revision Monthly',
		email: 'e2e.rev.01@accent.test',
		employeeType: 'Payroll',
		salaryType: 'monthly',
		ctc: 21600,
		profileFrom: '2018-01-01',
	},
	/** Contract stream, revised while the 2018-04 run is paid. */
	contract: {
		code: 'E2E-REV-02',
		firstName: 'E2E',
		lastName: 'Revision Contract',
		email: 'e2e.rev.02@accent.test',
		employeeType: 'Contract',
		salaryType: 'contract',
		ctc: 20000,
		profileFrom: '2018-01-01',
	},
} as const;

export type RevisionEmployeeKey = keyof typeof REVISION_EMPLOYEES;

/** The destination hours each month is logged at, by employee and Project. */
export const REVISION_HOURS: Record<
	'monthly' | 'contract',
	{
		month: string;
		p1: Array<[number, number]>;
		p2: Array<[number, number]>;
		none: Array<[number, number]>;
	}
> = {
	monthly: {
		month: REVISION_MONTH,
		p1: [
			[5, 8],
			[6, 8],
			[7, 8],
			[8, 8],
			[9, 8],
			[12, 8],
			[13, 8],
			[14, 8],
			[15, 8],
			[16, 8],
		],
		p2: [
			[19, 8],
			[20, 8],
			[21, 8],
			[22, 8],
			[23, 8],
			[26, 8],
			[27, 7],
		],
		none: [
			[28, 8],
			[29, 8],
			[30, 8],
			[31, 3],
		],
	},
	contract: {
		month: REVISION_PAID_MONTH,
		p1: [
			[3, 8],
			[4, 8],
			[5, 8],
			[6, 8],
			[9, 8],
			[10, 8],
			[11, 8],
			[12, 4],
		],
		p2: [
			[13, 8],
			[16, 8],
			[17, 8],
			[18, 8],
			[19, 8],
		],
		none: [
			[20, 8],
			[23, 8],
			[24, 4],
		],
	},
};

/**
 * Independently stated expectations. The spec asserts these literals; it never
 * calls the module under test to derive them. `vN` shares are the version rows
 * the flow should produce, in destination order [P1, P2, No project].
 */
export const REVISION_EXPECTED = {
	monthly: {
		employeeCode: 'E2E-REV-01',
		payStream: 'payroll',
		employeeType: 'Payroll',
		/** CTC ÷ 216 basis hours = 100.00/h; 162h logged. */
		basisHours: 216,
		totalLoggedHours: 162,
		slipEmployerCost: 16668,
		/** v1 freeze: hours 80/55/27. */
		v1: {
			hours: [80, 55, 27],
			shares: [8231.11, 5658.89, 2778.0],
			adjustments: [0, 0.01, 0],
			projectHours: 135,
			noProjectHours: 27,
			totalAdjustment: 0.01,
		},
		/** v2 revision: hours 100/35/27. */
		v2: {
			hours: [100, 35, 27],
			shares: [10288.89, 3601.11, 2778.0],
			adjustments: [0.01, 0, 0],
			projectHours: 135,
			noProjectHours: 27,
			totalAdjustment: 0.01,
		},
		/** v3 concurrent revision (both racers send this): hours 120/15/27. */
		v3: {
			hours: [120, 15, 27],
			shares: [12346.67, 1543.33, 2778.0],
			adjustments: [0.01, 0, 0],
			projectHours: 135,
			noProjectHours: 27,
			totalAdjustment: 0.01,
		},
		/** v4 browser revision: hours 131/4/27. */
		v4: {
			hours: [131, 4, 27],
			shares: [13478.44, 411.56, 2778.0],
			adjustments: [0, 0.01, 0],
			projectHours: 135,
			noProjectHours: 27,
			totalAdjustment: 0.01,
		},
		revisionReason: 'E2E revision: March timesheet attributed P2 hours to P1',
		revisionEvidence: 'e2e-rev-evidence-2018-03.pdf',
	},
	contract: {
		employeeCode: 'E2E-REV-02',
		payStream: 'contract',
		employeeType: 'Contract',
		/** CTC ÷ 200 basis hours = 100.00/h; 120h logged. */
		basisHours: 200,
		totalLoggedHours: 120,
		slipEmployerCost: 12346,
		/** v1 freeze: hours 60/40/20. */
		v1: {
			hours: [60, 40, 20],
			shares: [6173.0, 4115.33, 2057.67],
			adjustments: [0, 0, 0.01],
			projectHours: 100,
			noProjectHours: 20,
			totalAdjustment: 0.01,
		},
		/** v2 paid-month revision: hours 66/34/20. */
		v2: {
			hours: [66, 34, 20],
			shares: [6790.3, 3498.03, 2057.67],
			adjustments: [0, 0, 0.01],
			projectHours: 100,
			noProjectHours: 20,
			totalAdjustment: 0.01,
		},
		revisionReason: 'E2E revision: April timesheet correction after payment',
		revisionEvidence: 'e2e-rev-evidence-2018-04.pdf',
	},
} as const;

export interface SeededRevision {
	projectIds: { p1: number; p2: number };
	employeeIds: Record<RevisionEmployeeKey, number>;
	/** `payroll_slips.id` per flow, filled by the spec after Generate. */
	gateSlips: number;
}

/**
 * Refuse the fixture months when they are not ours to clean — same safety as
 * #307's allocation fixture: a foreign slip or a locked run without fixture
 * slips stops cleanup and seed before anything is touched.
 */
async function assertFixtureMonthsFree(): Promise<void> {
	const monthDays = [REVISION_MONTH_DAY, REVISION_PAID_MONTH_DAY];
	const slips = await rows<{ month: string; code: string | null }>(
		`SELECT ps.month, e.employee_id AS code
       FROM payroll_slips ps
       LEFT JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month IN (?, ?)`,
		monthDays
	);
	const foreign = slips.filter(
		(slip) => !String(slip.code ?? '').startsWith('E2E-')
	);
	if (foreign.length > 0) {
		throw new Error(
			`[e2e] revision fixture month holds ${foreign.length} Payroll Slip(s) of non-fixture employees ` +
				`(e.g. ${foreign[0].code ?? 'unknown employee'}). Point the harness at the isolated E2E database ` +
				'instead of touching real payroll data.'
		);
	}
	const locked = await rows<{ month: number; status: string }>(
		`SELECT month, status FROM payroll_runs
      WHERE year IN (2018) AND month IN (3, 4) AND status <> 'draft'`
	);
	for (const run of locked) {
		const monthDay = `2018-${String(run.month).padStart(2, '0')}-01`;
		const owned = slips.some(
			(slip) => String(slip.month).slice(0, 10) === monthDay
		);
		if (!owned) {
			throw new Error(
				`[e2e] revision fixture month ${monthDay} holds a ${run.status} Payroll Run with no fixture slips ` +
					'to prove ownership. Point the harness at the isolated E2E database instead of touching real payroll data.'
			);
		}
	}
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureAllocationRevisionFixtures(): Promise<void> {
	await assertFixtureMonthsFree();

	const employeeCodes = Object.values(REVISION_EMPLOYEES).map(
		(employee) => employee.code
	);
	const placeholders = employeeCodes.map(() => '?').join(', ');
	const monthDays = [REVISION_MONTH_DAY, REVISION_PAID_MONTH_DAY];
	// Fixture ownership is the `E2E-` Employee-code namespace, so a shared
	// database's real Employees, slips, and allocations are never touched.
	const FIXTURE_EMPLOYEES = `employee_id IN (
    SELECT id FROM employees WHERE employee_id LIKE 'E2E-%'
  )`;

	// Allocation evidence: only the fixture months' allocations of fixture
	// Employees — the guard above refused anything else.
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

	// Slips of fixture Employees in the fixture months — the generated slips
	// plus the inert gate slips for every other fixture namespace.
	await exec(
		`DELETE FROM payroll_slips
      WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}`,
		[...monthDays]
	);
	// Runs for the fixture months: the guard above proved every slip in them is
	// fixture-owned, so a run left by this module is ours to remove.
	await exec(`DELETE FROM payroll_runs WHERE year = 2018 AND month IN (3, 4)`);

	await exec(
		`DELETE FROM user_activity_assignments
      WHERE id LIKE ? OR employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		[`${REVISION_ASSIGNMENT_PREFIX}%`, ...employeeCodes]
	);
	await exec(
		`DELETE FROM employee_salary_profile
      WHERE employee_id IN (
        SELECT id FROM employees WHERE employee_id IN (${placeholders})
      )`,
		employeeCodes
	);

	for (const identity of [
		REVISION_READER,
		REVISION_FINANCE,
		REVISION_PAYROLL_ONLY,
	]) {
		for (const sql of [
			`DELETE FROM user_activity_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
			`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
			`DELETE FROM payroll_audit_logs WHERE performed_by IN (SELECT id FROM users WHERE username = ?)`,
		]) {
			try {
				await exec(sql, [identity.username]);
			} catch {
				// Optional table — fixture users cannot be blocked on it.
			}
		}
		await exec(
			`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
			[identity.username]
		);
		await exec(`DELETE FROM users WHERE username = ?`, [identity.username]);
		await exec(`DELETE FROM roles_master WHERE role_code = ?`, [
			identity.roleCode,
		]);
	}

	await exec(
		`DELETE FROM user_activity_assignments WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[REVISION_USERNAME]
	);
	await exec(
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)`,
		[REVISION_USERNAME]
	);
	await exec(`DELETE FROM users WHERE username = ?`, [REVISION_USERNAME]);
	await exec(
		`DELETE FROM employees WHERE employee_id IN (${placeholders})`,
		employeeCodes
	);
	await exec(`DELETE FROM projects WHERE project_code IN (?, ?)`, [
		REVISION_PROJECTS.p1.code,
		REVISION_PROJECTS.p2.code,
	]);
}

/** Purge leftovers, then create the revision fixtures. */
export async function seedExpenditureAllocationRevisionFixtures(): Promise<SeededRevision> {
	await cleanupExpenditureAllocationRevisionFixtures();

	const projectIds = {} as { p1: number; p2: number };
	for (const key of ['p1', 'p2'] as const) {
		const project = REVISION_PROJECTS[key];
		const inserted = await exec(
			`INSERT INTO projects
         (project_code, name, project_title, client_name, status, isDelete)
       VALUES (?, ?, ?, ?, 'active', 0)`,
			[project.code, project.name, project.name, project.client]
		);
		projectIds[key] = inserted.insertId;
	}

	const passwordHash = await bcrypt.hash(REVISION_USER.password, 10);
	const fixtureUser = await exec(
		`INSERT INTO users
       (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, ?, ?, ?, 'active', 1, 0, 'employee', 0)`,
		[
			REVISION_USER.username,
			passwordHash,
			REVISION_USER.email,
			REVISION_USER.fullName,
		]
	);

	const employeeIds = {} as Record<RevisionEmployeeKey, number>;
	for (const key of Object.keys(REVISION_EMPLOYEES) as RevisionEmployeeKey[]) {
		const employee = REVISION_EMPLOYEES[key];
		const inserted = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type, joining_date, isDelete)
       VALUES (?, ?, ?, ?, 'active', ?, ?, 0)`,
			[
				employee.code,
				employee.firstName,
				employee.lastName,
				employee.email,
				employee.employeeType,
				'2018-01-01',
			]
		);
		employeeIds[key] = inserted.insertId;
		await exec(
			`INSERT INTO employee_salary_profile
         (employee_id, gross, gross_salary, employer_cost, other_allowances,
          effective_from, effective_to, is_active, pf_applicable, esic_applicable,
          pt_applicable, mlwf_applicable, bonus_applicable, salary_type,
          std_hours_per_day, std_working_days, tds_percentage,
          loan_amount, loan_amount_per_month, loan_active, advance_amount, advance_active)
       VALUES (?, ?, ?, ?, 0, ?, NULL, 1, 0, 0, 0, 0, 0, ?, 8, 26, 0, 0, 0, 0, 0, 0)`,
			[
				inserted.insertId,
				employee.ctc,
				employee.ctc,
				employee.ctc,
				employee.profileFrom,
				employee.salaryType,
			]
		);
	}

	// Logged Hours per destination, one assignment row per destination —
	// the same canonical `user_activity_assignments.daily_entries` source the
	// payroll calculator and the #307 allocation read.
	for (const key of ['monthly', 'contract'] as const) {
		const hours = REVISION_HOURS[key];
		const destinations: Array<
			[string, number | null, Array<[number, number]>]
		> = [
			['p1', projectIds.p1, [...hours.p1]],
			['p2', projectIds.p2, [...hours.p2]],
			['none', null, [...hours.none]],
		];
		for (const [suffix, project, entries] of destinations) {
			await exec(
				`INSERT INTO user_activity_assignments
           (id, user_id, employee_id, project_id, activity_id, activity_name,
            status, daily_entries, assigned_date)
         VALUES (?, ?, ?, ?, ?, 'E2E revision fixture work', 'Completed', ?, ?)`,
				[
					`${REVISION_ASSIGNMENT_PREFIX}${key}-${suffix}`,
					fixtureUser.insertId,
					employeeIds[key],
					project,
					`e2e-rev-activity-${key}-${suffix}`,
					JSON.stringify(
						entries.map(([day, dayHours]) => ({
							date: `${hours.month}-${String(day).padStart(2, '0')}`,
							hours: dayHours,
						}))
					),
					`${hours.month}-01 09:00:00`,
				]
			);
		}
	}

	await seedRevisionReaders();
	const gateSlips = await seedRevisionGateSlips();

	return { projectIds, employeeIds, gateSlips };
}

/**
 * Payroll Finalize refuses a month while any active Payroll/Contract employee
 * has no Salary Profile covering it. Every other fixture namespace's profiles
 * start in 2019/2026, so for 2018-03/04 they are uncovered and could not be
 * generated a slip the normal way. This writes the zero slip Generate would
 * have written — scoped to the two fixture months, deleted by cleanup — for
 * `E2E-` coded employees only; a non-fixture employee in the gate's own
 * population stops the seed instead of fabricating payroll for a real person.
 *
 * The population is read with the gate's own predicate
 * (`findEmployeesWithoutProfiles`, src/app/api/payroll/_lib/payroll-run.js).
 */
async function seedRevisionGateSlips(): Promise<number> {
	const monthDays = [REVISION_MONTH_DAY, REVISION_PAID_MONTH_DAY];
	let written = 0;
	for (const monthDay of monthDays) {
		const uncovered = await rows<{
			id: number;
			employee_id: string;
		}>(
			`SELECT e.id, e.employee_id
         FROM employees e
        WHERE (e.status = 'active' OR e.status IS NULL)
          AND e.isDelete = 0
          AND e.employee_type IN ('Payroll', 'Contract')
          AND NOT EXISTS (
            SELECT 1 FROM employee_salary_profile esp
             WHERE esp.employee_id = e.id AND esp.is_active = 1
               AND esp.effective_from <= ?
               AND (esp.effective_to IS NULL OR esp.effective_to >= ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM salary_structures ss
             WHERE ss.employee_id = e.id AND ss.is_active = 1
               AND ss.effective_from <= ?
               AND (ss.effective_to IS NULL OR ss.effective_to >= ?)
          )
          AND NOT EXISTS (
            SELECT 1 FROM payroll_slips ps
             WHERE ps.employee_id = e.id AND ps.month = ?
          )
        ORDER BY e.employee_id`,
			[monthDay, monthDay, monthDay, monthDay, monthDay]
		);
		for (const employee of uncovered) {
			if (!String(employee.employee_id).startsWith('E2E-')) {
				throw new Error(
					`[e2e] revision fixture month ${monthDay} would need an inert gate slip for non-fixture employee ` +
						`${employee.employee_id}. Point the harness at the isolated E2E database instead.`
				);
			}
			await exec(
				`INSERT INTO payroll_slips
           (month, employee_id, gross, basic, hra, conveyance, call_allowance,
            total_earnings, total_deductions, net_pay, pf_employer, esic_employer,
            total_employer_contributions, employer_cost, payment_status)
         VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 'pending')`,
				[monthDay, employee.id]
			);
			written++;
		}
	}
	return written;
}

/** Roles and users for the three authorization outcomes. */
async function seedRevisionReaders(): Promise<void> {
	for (const identity of [
		REVISION_READER,
		REVISION_FINANCE,
		REVISION_PAYROLL_ONLY,
	]) {
		const role = await exec(
			`INSERT INTO roles_master
         (role_code, role_name, role_hierarchy, department, permissions, description, status)
       VALUES (?, ?, 40, 'E2E', ?, ?, 'active')`,
			[
				identity.roleCode,
				identity.roleName,
				JSON.stringify(identity.permissions),
				'E2E revision fixture identity (e2e/lib/expenditure-allocation-revision-fixtures.ts)',
			]
		);
		const passwordHash = await bcrypt.hash(identity.password, 10);
		await exec(
			`INSERT INTO users
         (username, password_hash, email, full_name, status, is_active, is_super_admin, role_id, account_type, isDelete)
       VALUES (?, ?, ?, ?, 'active', 1, 0, ?, 'employee', 0)`,
			[
				identity.username,
				passwordHash,
				identity.email,
				identity.fullName,
				role.insertId,
			]
		);
	}
}

/* ── identity sessions ─────────────────────────────────────────────── */

async function loginIdentity(
	playwright: PlaywrightApi,
	baseURL: string,
	identity: typeof REVISION_READER,
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
			data: { username: identity.username, password: identity.password },
		});
		if (!response.ok()) {
			throw new Error(
				`[e2e] ${identity.username} login failed: POST /api/login -> ${response.status()}`
			);
		}
		const match = /(?:^|[\n,])\s*session=([^;\s,]+)/.exec(
			response.headers()['set-cookie'] ?? ''
		);
		if (!match) {
			throw new Error(
				`[e2e] ${identity.username}: login succeeded but no session cookie was set`
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

/** The financial-read-gate-only reader: may read, may not revise. */
export function loginRevisionReader(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginIdentity(
		playwright,
		baseURL,
		REVISION_READER,
		REVISION_READER_IP
	);
}

/** The finance operator: read gate + `payroll:update`, performs revisions. */
export function loginRevisionFinance(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginIdentity(
		playwright,
		baseURL,
		REVISION_FINANCE,
		REVISION_FINANCE_IP
	);
}

/** `payroll:update` without the expense-source read — the gate refuses. */
export function loginRevisionPayrollOnly(
	playwright: PlaywrightApi,
	baseURL: string
): Promise<APIRequestContext> {
	return loginIdentity(
		playwright,
		baseURL,
		REVISION_PAYROLL_ONLY,
		REVISION_READER_IP
	);
}
