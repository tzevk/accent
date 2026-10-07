import bcrypt from 'bcrypt';
import type { Cookie } from '@playwright/test';
import type {
	APIRequestContext,
	Playwright as PlaywrightApi,
} from '@playwright/test';
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
 * Cleanup owns only fixture rows: allocations and slips are deleted for
 * `E2E-`-coded Employees in the fixture months, and cleanup/seed refuse with a
 * thrown error when either month holds a Payroll Slip of a non-fixture
 * Employee or a locked Payroll Run without fixture slips to prove ownership.
 * A shared dev target therefore cannot lose real payroll; the harness is meant
 * for the isolated E2E database.
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
 *   `holiday_master` (no fixture holiday falls in 2026-02). 2026-03 has 26
 *   working days → 208 basis hours.
 *
 *   Employer cost is earnings + the genuine employer contributions; a
 *   zero-flag profile still carries gratuity = 4.81 % of Basic, Basic = 60 %
 *   of the priced gross.
 *
 *   E2E-ALLOC-01 monthly CTC ₹26,000, 192h logged → gross = CTC (heads
 *   ₹15,600 + ₹5,200 + ₹2,600 + ₹2,600) + ₹750 gratuity = ₹26,750. Logged on
 *   P1 80h, P2 72h, no project 40h.
 *   E2E-ALLOC-02 contract CTC ₹10,000, 192h logged → ₹10,000 + ₹289 gratuity
 *   = ₹10,289. P1 73h, P2 71h, no project 48h.
 *   E2E-ALLOC-03 monthly CTC ₹26,000, zero hours, fixture Bonus Component Rate
 *   ₹500 → earnings ₹500 on an empty gross, fully unallocated.
 *   E2E-ALLOC-04 monthly CTC ₹26,000, zero hours, no bonus → known zero.
 *   E2E-ALLOC-06 profile covering 2026-02 only, zero hours → known zero.
 *   E2E-ALLOC-07 canonical CTC ₹26,000 + a *newer* legacy row ₹52,000 → the
 *   canonical profile prices March: ₹5,402.
 *   E2E-ALLOC-08 canonical CTC ₹10,116, 26h logged → ₹1,265 + ₹37 gratuity =
 *   ₹1,303 → shares ₹501.15 (10h) + ₹801.85 (16h); 501.15 ÷ 10 = 50.115, the
 *   half-cent boundary the money rule rounds to ₹50.12.
 *   E2E-ALLOC-09 only a legacy row (₹41,600 gross, ₹24,960 Basic) → ₹27,841.
 *
 *   The rounding adjustment is the deterministic largest-remainder cent:
 *   E2E-ALLOC-01's exact shares ₹11,145.83⅓ / ₹10,031.25 / ₹5,572.91⅔ leave
 *   one cent, which goes to the largest remainder (the no-project share) →
 *   ₹11,145.83 / ₹10,031.25 / ₹5,572.92 with a +₹0.01 adjustment; E2E-ALLOC-02
 *   gives its cent to the P2 share the same way.
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
export const ALLOCATION_READER_IP = '198.18.0.31';
export const ALLOCATION_FIN_READER_IP = '198.18.0.32';

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
	/**
	 * Same canonical profile and hours as `estimateOnly`, plus a *newer* legacy
	 * `salary_structures` row. The eligible canonical profile must still price
	 * the 2026-03 estimate — Payroll Generate's own rule — so its estimate
	 * matches `estimateOnly` even though the legacy row is newer.
	 */
	canonicalFirst: {
		code: 'E2E-ALLOC-07',
		firstName: 'E2E',
		lastName: 'Canonical First',
		email: 'e2e.alloc.07@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 26000,
		profileFrom: '2026-02-05',
		legacyProfile: { gross: 52000, basic: 31200, effectiveFrom: '2026-02-20' },
	},
	/**
	 * The half-cent rate boundary: a destination share whose cost ÷ hours lands
	 * exactly on x.xx5 must round with the shared money rule (Decimal
	 * ROUND_HALF_UP), not `Math.round` on the float product.
	 */
	boundaryRate: {
		code: 'E2E-ALLOC-08',
		firstName: 'E2E',
		lastName: 'Boundary Rate',
		email: 'e2e.alloc.08@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 10116,
		profileFrom: '2026-03-01',
	},
	/** No canonical profile at all: the legacy row is the only pricing. */
	legacyOnly: {
		code: 'E2E-ALLOC-09',
		firstName: 'E2E',
		lastName: 'Legacy Only',
		email: 'e2e.alloc.09@accent.test',
		employeeType: 'Permanent',
		salaryType: 'monthly',
		ctc: 0,
		profileFrom: null,
		legacyProfile: { gross: 41600, basic: 24960, effectiveFrom: '2026-02-20' },
	},
} as const;

export type AllocationEmployeeKey = keyof typeof ALLOCATION_EMPLOYEES;

/**
 * Independently stated expectations. The spec asserts these literals; it never
 * calls the report module's own allocation functions to derive them.
 *
 * Amounts are the payroll calculator's own composition: the priced gross plus
 * the genuine employer contributions — here only gratuity = 4.81 % of Basic,
 * Basic = 60 % of the gross, so a ₹26,000 gross month costs ₹26,750 (a
 * ₹1,000-share contract month ₹10,289). Each frozen share is the
 * largest-remainder cent split of that employer cost over the destination
 * hours below; adjustments are the cents the remainder step applied.
 */
export const ALLOCATION_EXPECTED = {
	/** 24 working days × 8h in 2026-02 (no fixture holiday lands in it). */
	basisHours: 192,
	/** Stream-wise expectations for the finalized month. */
	employees: {
		splitMonthly: {
			slipEmployerCost: 26750,
			hours: 192,
			projectHours: 152,
			noProjectHours: 40,
			recorded: 26750,
			shares: { p1: 11145.83, p2: 10031.25, noProject: 5572.92 },
			adjustments: { p1: 0, p2: 0, noProject: 0.01 },
			payStream: 'payroll',
		},
		contractRounding: {
			slipEmployerCost: 10289,
			hours: 192,
			projectHours: 144,
			noProjectHours: 48,
			recorded: 10289,
			shares: { p1: 3911.96, p2: 3804.79, noProject: 2572.25 },
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
			estimated: 5402,
			hours: 42,
			shares: { p1: 3086.86, p2: 2315.14 },
			payStream: 'payroll',
		},
		/**
		 * Same canonical profile (CTC 26,000) and hours as `estimateOnly`, so
		 * the canonical-first rule must price it identically. Pricing from its
		 * newer legacy row would give 36,901 instead (52,000 gross with a
		 * stored Basic of 31,200).
		 */
		canonicalFirst: {
			estimated: 5402,
			hours: 42,
			shares: { p1: 3086.86, p2: 2315.14 },
			payStream: 'payroll',
			legacyPriced: 36901,
		},
		/**
		 * CTC 10,116 over 208 basis hours and 26 h logged: gross 1,265,
		 * employer cost 1,303 → shares 501.15 (10 h) and 801.85 (16 h).
		 * 501.15 / 10 h is exactly 50.115: the money rule (ROUND_HALF_UP)
		 * states 50.12, while Math.round on the float product gives 50.11.
		 */
		boundaryRate: {
			estimated: 1303,
			hours: 26,
			p1Hours: 10,
			p2Hours: 16,
			shares: { p1: 501.15, p2: 801.85 },
			rates: { p1: 50.12, p2: 50.12 },
			naiveP1Rate: 50.11,
			payStream: 'payroll',
		},
		/** The legacy row (41,600 gross, stored Basic 24,960) is the only pricing. */
		legacyOnly: {
			estimated: 27841,
			hours: 21,
			shares: { p1: 27841 },
			payStream: 'payroll',
		},
	},
	/** Month reconciliation after 2026-02 finalizes (no direct costs exist). */
	month: {
		recordedTotal: 37539,
		project1: 15057.79,
		project2: 13836.04,
		unallocated: 8645.17,
		roundedAdjustment: 0.02,
		projectHours: 296,
		/** Frozen per-Project hours: 80 + 73 and 72 + 71. */
		project1Hours: 153,
		project2Hours: 143,
		noProjectHours: 88,
		totalHours: 384,
		recordedCount: 3,
	},
	/** 2026-03 estimate month, filtered to the fixture employees and Projects. */
	estimateMonth: {
		estimateOnlyEstimated: 5402,
		estimateOnlyP1: 3086.86,
		estimateOnlyP2: 2315.14,
		missingPricingHours: 8,
		/** P1: 24 (05) + 8 (06) + 24 (07) + 10 (08) + 21 (09). */
		project1Hours: 87,
		/** P2: 18 (05) + 18 (07) + 16 (08). */
		project2Hours: 52,
		/** P1: 3,086.86 (05) + 3,086.86 (07) + 501.15 (08) + 27,841 (09). */
		project1Estimated: 34515.87,
		/** P2: 2,315.14 (05) + 2,315.14 (07) + 801.85 (08). */
		project2Estimated: 5432.13,
	},
} as const;

export interface SeededAllocation {
	projectIds: { p1: number; p2: number };
	employeeIds: Record<AllocationEmployeeKey, number>;
	/** `payroll_slips.id` of the fixture month, once Generate has run. */
}

/* ── fixture lifecycle ─────────────────────────────────────────────── */

/**
 * Refuse the fixture months when they are not ours to clean. Any Payroll Slip
 * in 2026-02/2026-03 that does not belong to an `E2E-` fixture Employee — or a
 * locked Payroll Run with no fixture slips to prove ownership — stops cleanup
 * and seed before anything is deleted or written. The harness is meant for the
 * isolated E2E database; this keeps a shared dev target safe.
 */
async function assertFixtureMonthsFree(): Promise<void> {
	const monthDays = [ALLOCATION_MONTH_DAY, ALLOCATION_ESTIMATE_MONTH_DAY];
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
			`[e2e] allocation fixture month holds ${foreign.length} Payroll Slip(s) of non-fixture employees ` +
				`(e.g. ${foreign[0].code ?? 'unknown employee'}). Point the harness at the isolated E2E database ` +
				'instead of touching real payroll data.'
		);
	}
	const locked = await rows<{ month: number; status: string }>(
		`SELECT month, status FROM payroll_runs
      WHERE year = 2026 AND month IN (2, 3) AND status <> 'draft'`
	);
	for (const run of locked) {
		const monthDay = `2026-${String(run.month).padStart(2, '0')}-01`;
		const owned = slips.some(
			(slip) => String(slip.month).slice(0, 10) === monthDay
		);
		if (!owned) {
			throw new Error(
				`[e2e] allocation fixture month ${monthDay} holds a ${run.status} Payroll Run with no fixture slips ` +
					'to prove ownership. Point the harness at the isolated E2E database instead of touching real payroll data.'
			);
		}
	}
}

/** Remove every row this module owns. Safe to run repeatedly. */
export async function cleanupExpenditureAllocationFixtures(): Promise<void> {
	await assertFixtureMonthsFree();

	const employeeCodes = Object.values(ALLOCATION_EMPLOYEES).map(
		(employee) => employee.code
	);
	const placeholders = employeeCodes.map(() => '?').join(', ');
	// Fixture ownership is the `E2E-` Employee-code namespace, so a shared
	// database's real Employees, slips, and allocations are never touched.
	const FIXTURE_EMPLOYEES = `employee_id IN (
    SELECT id FROM employees WHERE employee_id LIKE 'E2E-%'
  )`;
	const monthDays = [ALLOCATION_MONTH_DAY, ALLOCATION_ESTIMATE_MONTH_DAY];

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

	// Slips of fixture Employees in the fixture months — the generated zeros
	// for every other fixture namespace and the two safety-gate slips below.
	await exec(
		`DELETE FROM payroll_slips
      WHERE month IN (?, ?) AND ${FIXTURE_EMPLOYEES}`,
		[...monthDays]
	);
	// Runs for the fixture months: the guard above proved every slip in them is
	// fixture-owned, so a run left by this module is ours to remove.
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
	await exec(
		`DELETE FROM salary_structures
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
			'profileFrom' in employee ? employee.profileFrom : '2026-01-01';
		if (profileFrom !== null) {
			const profileTo = ('profileTo' in employee && employee.profileTo) || null;
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
		// The legacy pricing row #307's canonical-first selection must respect:
		// read-only fallback in `salary_structures` (ADR-0001), exactly what
		// Payroll Generate falls back to when no canonical profile covers.
		if ('legacyProfile' in employee) {
			await exec(
				`INSERT INTO salary_structures
           (employee_id, version, effective_from, effective_to, is_active, pay_type,
            ctc, gross_salary, basic_salary, pf_applicable, esic_applicable,
            pt_applicable, mlwf_applicable, tds_applicable, standard_working_days,
            standard_hours_per_day, remarks)
         VALUES (?, 1, ?, NULL, 1, ?, 0, ?, ?, 0, 0, 0, 0, 0, 26, 8, ?)`,
				[
					inserted.insertId,
					employee.legacyProfile.effectiveFrom,
					employee.salaryType,
					employee.legacyProfile.gross,
					employee.legacyProfile.basic,
					`legacy pricing row for ${employee.code} (e2e/lib/expenditure-allocation-fixtures.ts)`,
				]
			);
		}
	}

	await seedAllocationHours(employeeIds, fixtureUser.insertId, projectIds);
	await seedAllocationBonusSchedule();
	await seedAllocationGateSlips();
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
 *   ALLOC-07  P1 24h, P2 18h                   (2026-03, total 42)
 *   ALLOC-08  P1 10h, P2 16h                   (2026-03, total 26 — the rate boundary)
 *   ALLOC-09  P1 21h                           (2026-03)
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
		assignment('07-p1', employeeIds.canonicalFirst, projectIds.p1, [
			day(ALLOCATION_ESTIMATE_MONTH, 2, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 3, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 4, 8),
		]),
		assignment('07-p2', employeeIds.canonicalFirst, projectIds.p2, [
			day(ALLOCATION_ESTIMATE_MONTH, 5, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 6, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 9, 2),
		]),
		assignment('08-p1', employeeIds.boundaryRate, projectIds.p1, [
			day(ALLOCATION_ESTIMATE_MONTH, 11, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 12, 2),
		]),
		assignment('08-p2', employeeIds.boundaryRate, projectIds.p2, [
			day(ALLOCATION_ESTIMATE_MONTH, 13, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 16, 8),
		]),
		assignment('09-p1', employeeIds.legacyOnly, projectIds.p1, [
			day(ALLOCATION_ESTIMATE_MONTH, 10, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 11, 8),
			day(ALLOCATION_ESTIMATE_MONTH, 12, 5),
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
		[
			ALLOCATION_BONUS_AMOUNT,
			`${ALLOCATION_MONTH}-01`,
			ALLOCATION_BONUS_REMARKS,
		]
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
async function seedAllocationGateSlips(): Promise<void> {
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
	return loginReader(
		playwright,
		baseURL,
		ALLOCATION_READER,
		ALLOCATION_READER_IP
	);
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
