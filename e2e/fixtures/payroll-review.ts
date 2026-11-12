/**
 * Disposable payroll-review fixture for the #426 browser journey (#432).
 *
 * The fixture owns one ordinary administrator and one generated-shaped
 * Payroll Slip in a unique 31-day month. It never calls the production payroll
 * calculator: the expected totals below are authored literals, and the seeded
 * row is the recorded snapshot the real listing must display.
 *
 * Expected values are deliberately independent of the grid/read-model
 * implementation:
 *
 * - The slip stores `gross` 50000 (full-month contractual gross) but
 *   `total_earnings` 44000. Company GROSS is the authoritative
 *   `total_earnings`, so the fixture proves the listing does not use `gross`.
 * - Basic/DA are stored so the shared normalization is idempotent:
 *   `basic` 24000 plus `da_used` 6000 is Basic+DA 30000, and repeated reads
 *   keep BASIC 24000 / DA 6000.
 * - Current attendance differs from the frozen slip snapshot. The stored
 *   snapshot says 26 present days; current attendance reconciles to 5.5
 *   present, 1 paid leave, 1 holiday, 1 weekly off, 2.5 unpaid/absent and
 *   3.5 payable OT hours (one sub-gate row is excluded).
 * - `mlwf` 25 and the combined `other_deductions` 1250 are recorded only in
 *   the expanded details, never in separate company LOAN/ADVANCE cells.
 * - The Employee joins on day 10 over a hire date on day 1 and exits on day
 *   20, inclusive: 11 in-window days and 20 days outside employment. That
 *   proves joining precedence and inclusive exit handling.
 *
 * All rows are tracked by primary key. Cleanup deletes only this fixture's
 * rows (including the administrator's sessions) and leaves shared reference
 * data alone. A failed seed cleans up everything it created before throwing.
 *
 * The generated administrator password is returned for the real sign-in
 * journey. Never log it or persist it outside the test process.
 */
import { createHash, randomBytes } from 'node:crypto';
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { hashFixturePassword } from '../../scripts/leads-integration/support.ts';

/** The only permission the fixture administrator is granted. */
export const PAYROLL_REVIEW_PERMISSION = 'payroll:read';

const ADMIN_ROLE_CODE = 'admin';
const FIXTURE_ADMIN_ROLE_NAME = 'E2E Payroll Reviewer';
const EMPLOYEE_CODE_PREFIX = 'E2E432';
/**
 * Only 31-day months: the authored attendance plan covers days 1–31, so
 * Total Days is always the literal 31 and no month-shape branch is needed.
 * The disposable harness database is unique per invocation; within it each
 * fixture probes these slots so parallel workers get their own Payroll Run.
 */
const FIXTURE_YEARS = [2026, 2027, 2028, 2029, 2030, 2031] as const;
const FIXTURE_MONTHS = [1, 3, 5, 7, 8, 10, 12] as const;

/* ── exported fixture contract ─────────────────────────────────────── */

export interface PayrollReviewAdminFixture {
	userId: number;
	roleId: number;
	/** False when an existing payroll-only `admin` role was reused. */
	roleOwned: boolean;
	username: string;
	email: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
}

export interface PayrollReviewStoredMoney {
	gross: number;
	ctcUsed: number;
	basisHours: number;
	hourlyRate: number;
	loggedHours: number;
	daUsed: number;
	da: number;
	basic: number;
	hra: number;
	conveyance: number;
	callAllowance: number;
	otherAllowances: number;
	bonus: number;
	incentive: number;
	otRate: number;
	totalEarnings: number;
	pfEmployee: number;
	esicEmployee: number;
	pt: number;
	lwf: number;
	mlwf: number;
	tds: number;
	otherDeductions: number;
	retention: number;
	totalDeductions: number;
	netPay: number;
	pfEmployer: number;
	esicEmployer: number;
	mlwfEmployer: number;
	insurance: number;
	gratuity: number;
	pfAdmin: number;
	edli: number;
	totalEmployerContributions: number;
	employerCost: number;
}

export interface PayrollReviewSnapshotAttendance {
	daysPresent: number;
	daysAbsent: number;
	daysLeave: number;
	payableDays: number;
	lopDays: number;
	lopDeduction: number;
	overtimeHours: number;
	standardWorkingDays: number;
	fullMonthGross: number;
}

/** Company-grid sentinels, authored independently of the seam. */
export interface PayrollReviewExpectedMoney {
	/** Company GROSS: the authoritative `total_earnings`, never `gross`. */
	gross: number;
	/** Recorded MLWF deduction, visible only in the expanded details. */
	mlwf: number;
	/** Combined recorded loan/advance/other deduction, details only. */
	combinedOtherDeductions: number;
	totalDeductions: number;
	netSal: number;
	/** The stored full-month contractual gross; never the GROSS cell. */
	fullMonthContractualGross: number;
}

/** Company-grid attendance expectations for the current month. */
export interface PayrollReviewExpectedAttendance {
	totalDays: number;
	daysPresent: number;
	daysPaid: number;
	lwpDays: number;
	leave: number;
	weekOff: number;
	paidHoliday: number;
	otHours: number;
	absent: number;
	unrecorded: number;
	outsideEmployment: number;
}

export interface PayrollReviewExpectedEmployee {
	money: PayrollReviewExpectedMoney;
	attendance: PayrollReviewExpectedAttendance;
}

export interface PayrollReviewFixtureEmployee {
	employeeId: number;
	employeeCode: string;
	firstName: string;
	lastName: string;
	fullName: string;
	email: string;
	position: string;
	department: string;
	joiningDate: string;
	exitDate: string | null;
	uan: string | null;
	pfNo: string | null;
	esiNo: string | null;
	salaryProfileId: number;
	slip: {
		id: number;
		stored: PayrollReviewStoredMoney;
		snapshot: PayrollReviewSnapshotAttendance;
	};
}

export interface PayrollReviewFixture {
	namespace: string;
	/** First of the fixture month, `YYYY-MM-01`. */
	month: string;
	/** `YYYY-MM`, the value the month picker accepts. */
	monthSlug: string;
	runId: number;
	run: {
		id: number;
		status: 'draft';
		totalEmployees: number;
		totalGross: number;
		totalDeductions: number;
		totalNetPay: number;
	};
	admin: PayrollReviewAdminFixture;
	employee: PayrollReviewFixtureEmployee;
	expected: PayrollReviewExpectedEmployee;
}

export interface PayrollReviewRunState {
	id: number;
	month: number;
	year: number;
	runNumber: number;
	status: string;
	totalEmployees: number | null;
	totalGross: number | null;
	totalDeductions: number | null;
	totalNetPay: number | null;
	totalEmployerContribution: number | null;
	finalizedBy: number | null;
	finalizedAt: string | null;
	paymentDate: string | null;
	paidBy: number | null;
	paidAt: string | null;
}

export interface PayrollReviewSlipState {
	id: number;
	employeeId: number;
	month: string | null;
	paymentStatus: string | null;
	paymentDate: string | null;
	paymentReference: string | null;
	/* Frozen attendance snapshot stored on the slip. */
	daysPresent: number | null;
	daysAbsent: number | null;
	daysLeave: number | null;
	payableDays: number | null;
	lopDays: number | null;
	lopDeduction: number | null;
	overtimeHours: number | null;
	standardWorkingDays: number | null;
	fullMonthGross: number | null;
	/* Recorded earnings. */
	gross: number | null;
	ctcUsed: number | null;
	basisHours: number | null;
	hourlyRate: number | null;
	loggedHours: number | null;
	daUsed: number | null;
	da: number | null;
	basic: number | null;
	hra: number | null;
	conveyance: number | null;
	callAllowance: number | null;
	otherAllowances: number | null;
	bonus: number | null;
	incentive: number | null;
	otRate: number | null;
	totalEarnings: number | null;
	/* Recorded deductions. */
	pfEmployee: number | null;
	esicEmployee: number | null;
	pt: number | null;
	lwf: number | null;
	mlwf: number | null;
	tds: number | null;
	otherDeductions: number | null;
	retention: number | null;
	totalDeductions: number | null;
	netPay: number | null;
	/* Recorded employer contributions. */
	pfEmployer: number | null;
	esicEmployer: number | null;
	mlwfEmployer: number | null;
	insurance: number | null;
	gratuity: number | null;
	pfAdmin: number | null;
	edli: number | null;
	totalEmployerContributions: number | null;
	employerCost: number | null;
	plTotal: number | null;
	plUsed: number | null;
	plBalance: number | null;
}

export interface PayrollReviewState {
	run: PayrollReviewRunState | null;
	slips: PayrollReviewSlipState[];
}

/* ── authored seed data ────────────────────────────────────────────── */

interface AttendanceSeedDay {
	day: number;
	status: string;
	overtimeHours?: number;
}

interface EmployeeSeedDefinition {
	position: string;
	department: string;
	status: 'active' | 'inactive';
	hireDay: number;
	joiningDay: number;
	exitDay: number | null;
	uan: string;
	pfNo: string | null;
	esiNo: string | null;
	money: PayrollReviewStoredMoney;
	snapshot: PayrollReviewSnapshotAttendance;
	attendance: readonly AttendanceSeedDay[];
}

const PRIMARY_MONEY: PayrollReviewStoredMoney = {
	gross: 50000,
	ctcUsed: 50000,
	basisHours: 208,
	hourlyRate: 240.38,
	loggedHours: 200,
	daUsed: 6000,
	da: 6000,
	basic: 24000,
	hra: 6000,
	conveyance: 2500,
	callAllowance: 1500,
	otherAllowances: 1000,
	bonus: 2000,
	incentive: 1000,
	otRate: 0,
	totalEarnings: 44000,
	pfEmployee: 1800,
	esicEmployee: 0,
	pt: 200,
	lwf: 0,
	mlwf: 25,
	tds: 1500,
	otherDeductions: 1250,
	retention: 500,
	totalDeductions: 5275,
	netPay: 38725,
	pfEmployer: 0,
	esicEmployer: 0,
	mlwfEmployer: 0,
	insurance: 0,
	gratuity: 0,
	pfAdmin: 0,
	edli: 0,
	totalEmployerContributions: 0,
	employerCost: 50000,
};

const PRIMARY_SNAPSHOT: PayrollReviewSnapshotAttendance = {
	daysPresent: 26,
	daysAbsent: 0,
	daysLeave: 0,
	payableDays: 26,
	lopDays: 0,
	lopDeduction: 0,
	overtimeHours: 0,
	standardWorkingDays: 26,
	fullMonthGross: 50000,
};

/**
 * One recorded status per employed day. The employment window (joining day
 * 10, exit day 20) is inclusive, so the plan covers 11 calendar days:
 * P 4, OT 1, HD 1, PL 1, A 1, H 1, WO 1, UL 1. The other 20 days are
 * Outside Employment, never fabricated absence. The 1.5h overtime row on day
 * 19 is below the >2h payable gate, so expected OT is 3.5 hours from day 12.
 */
const PRIMARY_ATTENDANCE: readonly AttendanceSeedDay[] = [
	{ day: 10, status: 'P' },
	{ day: 11, status: 'HD' },
	{ day: 12, status: 'OT', overtimeHours: 3.5 },
	{ day: 13, status: 'PL' },
	{ day: 14, status: 'A' },
	{ day: 15, status: 'H' },
	{ day: 16, status: 'WO' },
	{ day: 17, status: 'UL' },
	{ day: 18, status: 'P' },
	{ day: 19, status: 'P', overtimeHours: 1.5 },
	{ day: 20, status: 'P' },
];

const PRIMARY_EXPECTED: PayrollReviewExpectedEmployee = {
	money: {
		gross: 44000,
		mlwf: 25,
		combinedOtherDeductions: 1250,
		totalDeductions: 5275,
		netSal: 38725,
		fullMonthContractualGross: 50000,
	},
	attendance: {
		totalDays: 31,
		daysPresent: 5.5,
		daysPaid: 8.5,
		lwpDays: 2.5,
		leave: 1,
		weekOff: 1,
		paidHoliday: 1,
		otHours: 3.5,
		absent: 1.5,
		unrecorded: 0,
		outsideEmployment: 20,
	},
};

const PRIMARY_SEED: EmployeeSeedDefinition = {
	position: 'Senior Payroll Analyst',
	department: 'Finance',
	status: 'inactive',
	hireDay: 1,
	joiningDay: 10,
	exitDay: 20,
	uan: '100200300400',
	pfNo: 'PF/E2E/426/01',
	esiNo: '3100123456',
	money: PRIMARY_MONEY,
	snapshot: PRIMARY_SNAPSHOT,
	attendance: PRIMARY_ATTENDANCE,
};

const RUN_TOTALS = {
	totalEmployees: 1,
	totalGross: PRIMARY_MONEY.totalEarnings,
	totalDeductions: PRIMARY_MONEY.totalDeductions,
	totalNetPay: PRIMARY_MONEY.netPay,
} as const;

/* ── seed ──────────────────────────────────────────────────────────── */

interface OwnedFixtureIds {
	userId?: number;
	roleId?: number;
	runId?: number;
	employeeIds: number[];
	slipIds: number[];
}

interface AllocatedRun {
	id: number;
	year: number;
	month: number;
	monthDate: string;
}

/**
 * Seed one isolated payroll-review fixture.
 *
 * All owned primary keys are tracked as they are created. If any step fails,
 * the partial fixture is deleted before the error is rethrown; the caller
 * never receives a half-seeded fixture.
 */
export async function seedPayrollReviewFixture(
	connection: Connection,
	namespace: string
): Promise<PayrollReviewFixture> {
	const fixtureNamespace = namespace.trim();
	if (!fixtureNamespace) {
		throw new Error('[payroll-review] namespace must not be empty.');
	}

	const owned: OwnedFixtureIds = { employeeIds: [], slipIds: [] };
	try {
		const run = await allocateRun(connection, fixtureNamespace);
		owned.runId = run.id;

		const role = await ensurePayrollOnlyAdminRole(connection);
		owned.roleId = role.id;

		const adminUsername = fitIdentifier(
			`${fixtureNamespace}-admin`,
			50
		);
		const adminEmail = `${fitIdentifier(
			`${fixtureNamespace}-admin`,
			80
		).toLowerCase()}@e2e.invalid`;
		const adminPassword = randomBytes(24).toString('hex');
		const adminPasswordHash = await hashFixturePassword(adminPassword);
		const userId = await insertRow(
			connection,
			`INSERT INTO users (
          username, password_hash, email, full_name, status, role_id,
          permissions, is_active, isDelete, is_super_admin, account_type
        ) VALUES (?, ?, ?, 'E2E Payroll Reviewer', 'active', ?, ?, 1, 0, 0, 'employee')`,
			[
				adminUsername,
				adminPasswordHash,
				adminEmail,
				role.id,
				JSON.stringify([PAYROLL_REVIEW_PERMISSION]),
			]
		);
		owned.userId = userId;

		const employee = await seedEmployee(
			connection,
			owned,
			fixtureNamespace,
			run,
			PRIMARY_SEED
		);

		return {
			namespace: fixtureNamespace,
			month: run.monthDate,
			monthSlug: run.monthDate.slice(0, 7),
			runId: run.id,
			run: {
				id: run.id,
				status: 'draft',
				...RUN_TOTALS,
			},
			admin: {
				userId,
				roleId: role.id,
				roleOwned: role.owned,
				username: adminUsername,
				email: adminEmail,
				password: adminPassword,
			},
			employee,
			expected: PRIMARY_EXPECTED,
		};
	} catch (error) {
		try {
			await cleanupOwnedIds(connection, owned);
		} catch (cleanupError) {
			const original =
				error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; payroll-review fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

/* ── cleanup ───────────────────────────────────────────────────────── */

/**
 * Delete only this fixture's owned rows. Safe to call after a partial seed:
 * every id is optional and each delete is keyed by an owned primary key.
 */
export async function cleanupPayrollReviewFixture(
	connection: Connection,
	fixture: PayrollReviewFixture
): Promise<void> {
	await cleanupOwnedIds(connection, {
		userId: fixture.admin.userId,
		roleId: fixture.admin.roleId,
		runId: fixture.runId,
		employeeIds: [fixture.employee.employeeId],
		slipIds: [fixture.employee.slip.id],
	});
}

/* ── independent persisted readback ────────────────────────────────── */

/**
 * Read the recorded Payroll Slip financial columns and Payroll Run state
 * through the caller's independent connection. This is deliberately not the
 * application pool or the listing endpoint: the browser journey compares this
 * state before and after review to prove no payroll figure moved.
 */
export async function readPayrollReviewState(
	connection: Connection,
	fixture: PayrollReviewFixture
): Promise<PayrollReviewState> {
	const [runRows, slipIds] = await Promise.all([
		queryRows<PayrollRunRow>(
			connection,
			`SELECT id, month, year, run_number, status, total_employees,
              total_gross, total_deductions, total_net_pay,
              total_employer_contribution, finalized_by, finalized_at,
              payment_date, paid_by, paid_at
         FROM payroll_runs
        WHERE id = ?
        LIMIT 1`,
			[fixture.runId]
		),
		Promise.resolve([fixture.employee.slip.id]),
	]);

	const slips =
		slipIds.length === 0
			? []
			: await queryRows<PayrollSlipRow>(
					connection,
					`SELECT id, employee_id, month, gross, ctc_used, basis_hours,
                hourly_rate, logged_hours, da_used, da, basic, hra,
                conveyance, call_allowance, other_allowances, bonus, incentive,
                ot_rate, total_earnings, pf_employee, esic_employee, pt, lwf,
                mlwf, tds, other_deductions, retention, total_deductions,
                net_pay, pf_employer, esic_employer, mlwf_employer, insurance,
                gratuity, pf_admin, edli, total_employer_contributions,
                employer_cost, standard_working_days, days_present,
                days_absent, days_leave, payable_days, lop_days,
                lop_deduction, overtime_hours, full_month_gross, pl_total,
                pl_used, pl_balance, payment_status, payment_date,
                payment_reference
           FROM payroll_slips
          WHERE id IN (${slipIds.map(() => '?').join(', ')})
          ORDER BY id`,
					slipIds
				);

	return {
		run: runRows[0] ? mapRunState(runRows[0]) : null,
		slips: slips.map(mapSlipState),
	};
}

/* ── seed internals ────────────────────────────────────────────────── */

async function allocateRun(
	connection: Connection,
	namespace: string
): Promise<AllocatedRun> {
	const slots = fixtureMonthSlots(namespace);
	for (const slot of slots) {
		const monthDate = isoDate(slot.year, slot.month, 1);
		try {
			const id = await insertRow(
				connection,
				`INSERT INTO payroll_runs (
            month, year, run_number, status, total_employees, total_gross,
            total_deductions, total_net_pay, total_employer_contribution,
            remarks
          ) VALUES (?, ?, 1, 'draft', ?, ?, ?, ?, 0, ?)`,
				[
					slot.month,
					slot.year,
					RUN_TOTALS.totalEmployees,
					RUN_TOTALS.totalGross,
					RUN_TOTALS.totalDeductions,
					RUN_TOTALS.totalNetPay,
					`[payroll-review ${namespace}] disposable fixture`,
				]
			);
			return { ...slot, id, monthDate };
		} catch (error) {
			// A parallel worker owns this month. Try the next 31-day slot; every
			// other failure is a real seed failure.
			if (isDuplicateKey(error)) continue;
			throw error;
		}
	}
	throw new Error(
		`[payroll-review] no free fixture month is available for ${namespace}.`
	);
}

async function ensurePayrollOnlyAdminRole(
	connection: Connection
): Promise<{ id: number; owned: boolean }> {
	const existing = await findAdminRole(connection);
	if (existing) {
		assertPayrollOnlyAdminRole(existing);
		return { id: Number(existing.id), owned: false };
	}

	try {
		const id = await insertRow(
			connection,
			`INSERT INTO roles_master (
          role_code, role_name, role_hierarchy, permissions, status
        ) VALUES (?, ?, 1, ?, 'active')`,
			[
				ADMIN_ROLE_CODE,
				FIXTURE_ADMIN_ROLE_NAME,
				JSON.stringify([PAYROLL_REVIEW_PERMISSION]),
			]
		);
		return { id, owned: true };
	} catch (error) {
		// A parallel fixture inserted the shared admin role first. Reuse it only
		// if it is exactly the payroll-only role this fixture needs.
		if (!isDuplicateKey(error)) throw error;
		const raced = await findAdminRole(connection);
		if (!raced) throw error;
		assertPayrollOnlyAdminRole(raced);
		return { id: Number(raced.id), owned: false };
	}
}

async function findAdminRole(
	connection: Connection
): Promise<RoleRow | null> {
	const rows = await queryRows<RoleRow>(
		connection,
		`SELECT id, role_code, permissions
       FROM roles_master
      WHERE role_code = ?
      LIMIT 1`,
		[ADMIN_ROLE_CODE]
	);
	return rows[0] ?? null;
}

function assertPayrollOnlyAdminRole(row: RoleRow): void {
	if (String(row.role_code) !== ADMIN_ROLE_CODE) {
		throw new Error(
			`[payroll-review] existing role ${JSON.stringify(
				row.role_code
			)} is not the admin role code the admin shell requires.`
		);
	}
	const permissions = parseStringArray(row.permissions);
	const unexpected = permissions.filter(
		(permission) => permission !== PAYROLL_REVIEW_PERMISSION
	);
	if (
		unexpected.length > 0 ||
		!permissions.includes(PAYROLL_REVIEW_PERMISSION)
	) {
		throw new Error(
			`[payroll-review] existing role ${ADMIN_ROLE_CODE} must grant only ` +
				`${PAYROLL_REVIEW_PERMISSION}; refusing to reuse or modify it.`
		);
	}
}

async function seedEmployee(
	connection: Connection,
	owned: OwnedFixtureIds,
	namespace: string,
	run: AllocatedRun,
	seed: EmployeeSeedDefinition
): Promise<PayrollReviewFixtureEmployee> {
	const key = sha256(namespace).slice(0, 8);
	const employeeCode = fitIdentifier(
		`${EMPLOYEE_CODE_PREFIX}-${key}`,
		20
	);
	const firstName = 'E2E';
	const lastName = `Reviewer-${key.slice(0, 4)}`;
	const fullName = `${firstName} ${lastName}`;
	const email = `${fitIdentifier(
		`${namespace}-employee`,
		80
	).toLowerCase()}@e2e.invalid`;

	const employeeId = await insertRow(
		connection,
		`INSERT INTO employees (
        employee_id, first_name, last_name, email, position, department,
        hire_date, joining_date, exit_date, status, employee_type, grade,
        designation, uan, pf_no, esi_no, company_name, isDelete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Payroll', ?, ?, ?, ?, ?,
                'Accent Techno Solutions Pvt Ltd', 0)`,
		[
			employeeCode,
			firstName,
			lastName,
			email,
			seed.position,
			seed.department,
			isoDate(run.year, run.month, seed.hireDay),
			isoDate(run.year, run.month, seed.joiningDay),
			seed.exitDay === null
				? null
				: isoDate(run.year, run.month, seed.exitDay),
			seed.status,
			'E2E',
			seed.position,
			seed.uan,
			seed.pfNo,
			seed.esiNo,
		]
	);
	owned.employeeIds.push(employeeId);

	const salaryProfileId = await insertRow(
		connection,
		`INSERT INTO employee_salary_profile (
        employee_id, gross, gross_salary, effective_from, effective_to,
        is_active, salary_type, basic, da, basic_plus_da, hra, conveyance,
        call_allowance, other_allowances, pf_employee, esic_employee,
        pf_employer, esic_employer, total_earnings, total_deductions,
        net_pay, employer_cost, pt, mlwf, retention, bonus, incentive,
        std_hours_per_day, std_working_days, da_year
      ) VALUES (?, ?, ?, ?, NULL, 1, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 8.0, 26, ?)`,
		[
			employeeId,
			seed.money.gross,
			seed.money.gross,
			run.monthDate,
			seed.money.basic,
			seed.money.da,
			seed.money.basic + seed.money.da,
			seed.money.hra,
			seed.money.conveyance,
			seed.money.callAllowance,
			seed.money.otherAllowances,
			seed.money.pfEmployee,
			seed.money.esicEmployee,
			seed.money.pfEmployer,
			seed.money.esicEmployer,
			seed.money.totalEarnings,
			seed.money.totalDeductions,
			seed.money.netPay,
			seed.money.employerCost,
			seed.money.pt,
			seed.money.mlwf,
			seed.money.retention,
			seed.money.bonus,
			seed.money.incentive,
			run.year,
		]
	);

	await insertAttendance(connection, employeeId, run, seed.attendance);

	const slipId = await insertRow(
		connection,
		`INSERT INTO payroll_slips (
        month, employee_id, gross, ctc_used, basis_hours, hourly_rate,
        logged_hours, da_used, da, basic, hra, conveyance, call_allowance,
        other_allowances, bonus, incentive, ot_rate, total_earnings,
        pf_employee, esic_employee, pt, lwf, mlwf, tds, other_deductions,
        retention, total_deductions, net_pay, pf_employer, esic_employer,
        mlwf_employer, insurance, gratuity, pf_admin, edli,
        total_employer_contributions, employer_cost, standard_working_days,
        days_present, days_absent, days_leave, payable_days, lop_days,
        lop_deduction, overtime_hours, full_month_gross, pl_total, pl_used,
        pl_balance, payment_status, payment_date, payment_reference, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
		slipParams(run.monthDate, employeeId, seed, namespace)
	);
	owned.slipIds.push(slipId);

	return {
		employeeId,
		employeeCode,
		firstName,
		lastName,
		fullName,
		email,
		position: seed.position,
		department: seed.department,
		joiningDate: isoDate(run.year, run.month, seed.joiningDay),
		exitDate:
			seed.exitDay === null
				? null
				: isoDate(run.year, run.month, seed.exitDay),
		uan: seed.uan,
		pfNo: seed.pfNo,
		esiNo: seed.esiNo,
		salaryProfileId,
		slip: {
			id: slipId,
			stored: seed.money,
			snapshot: seed.snapshot,
		},
	};
}

function slipParams(
	monthDate: string,
	employeeId: number,
	seed: EmployeeSeedDefinition,
	namespace: string
): ExecuteValues[] {
	const money = seed.money;
	const snapshot = seed.snapshot;
	return [
		monthDate,
		employeeId,
		money.gross,
		money.ctcUsed,
		money.basisHours,
		money.hourlyRate,
		money.loggedHours,
		money.daUsed,
		money.da,
		money.basic,
		money.hra,
		money.conveyance,
		money.callAllowance,
		money.otherAllowances,
		money.bonus,
		money.incentive,
		money.otRate,
		money.totalEarnings,
		money.pfEmployee,
		money.esicEmployee,
		money.pt,
		money.lwf,
		money.mlwf,
		money.tds,
		money.otherDeductions,
		money.retention,
		money.totalDeductions,
		money.netPay,
		money.pfEmployer,
		money.esicEmployer,
		money.mlwfEmployer,
		money.insurance,
		money.gratuity,
		money.pfAdmin,
		money.edli,
		money.totalEmployerContributions,
		money.employerCost,
		snapshot.standardWorkingDays,
		snapshot.daysPresent,
		snapshot.daysAbsent,
		snapshot.daysLeave,
		snapshot.payableDays,
		snapshot.lopDays,
		snapshot.lopDeduction,
		snapshot.overtimeHours,
		snapshot.fullMonthGross,
		21,
		0,
		21,
		`[payroll-review ${namespace}] disposable fixture`,
	];
}

async function insertAttendance(
	connection: Connection,
	employeeId: number,
	run: AllocatedRun,
	plan: readonly AttendanceSeedDay[]
): Promise<void> {
	if (plan.length === 0) return;
	const placeholders = plan.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
	const params: ExecuteValues[] = [];
	for (const day of plan) {
		params.push(
			employeeId,
			isoDate(run.year, run.month, day.day),
			day.status,
			day.overtimeHours ?? 0,
			day.status === 'WO' ? 1 : 0,
			day.status === 'H' ? 1 : 0
		);
	}
	await connection.execute(
		`INSERT INTO employee_attendance (
        employee_id, attendance_date, status, overtime_hours, is_weekly_off,
        is_holiday
      ) VALUES ${placeholders}`,
		params
	);
}

async function cleanupOwnedIds(
	connection: Connection,
	owned: OwnedFixtureIds
): Promise<void> {
	await connection.beginTransaction();
	try {
		if (owned.userId !== undefined) {
			// The FK cascade would also remove sessions, but the fixture owns
			// them explicitly and must not rely on a cascade for cleanup.
			await connection.execute(
				'DELETE FROM sessions WHERE user_id = ?',
				[owned.userId]
			);
		}
		await deleteByIds(connection, 'payroll_slips', 'id', owned.slipIds);
		await deleteByIds(
			connection,
			'employee_attendance',
			'employee_id',
			owned.employeeIds
		);
		await deleteByIds(
			connection,
			'employee_salary_profile',
			'employee_id',
			owned.employeeIds
		);
		await deleteByIds(connection, 'employees', 'id', owned.employeeIds);
		if (owned.userId !== undefined) {
			await connection.execute('DELETE FROM users WHERE id = ?', [
				owned.userId,
			]);
		}
		if (owned.runId !== undefined) {
			await connection.execute('DELETE FROM payroll_runs WHERE id = ?', [
				owned.runId,
			]);
		}
		if (owned.roleId !== undefined) {
			// The seed-created admin role carries the fixture name. A parallel
			// fixture can share it, so remove it only after the last user is gone.
			// A pre-existing operational role has a different name and survives.
			await connection.execute(
				`DELETE FROM roles_master
          WHERE id = ?
            AND role_name = ?
            AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = ?)`,
				[owned.roleId, FIXTURE_ADMIN_ROLE_NAME, owned.roleId]
			);
		}
		await connection.commit();
	} catch (error) {
		try {
			await connection.rollback();
		} catch {
			// Preserve the original cleanup failure.
		}
		throw error;
	}
}

async function deleteByIds(
	connection: Connection,
	table: string,
	column: string,
	ids: readonly number[]
): Promise<void> {
	const owned = ids.filter(
		(id) => Number.isInteger(id) && id > 0
	);
	if (owned.length === 0) return;
	const placeholders = owned.map(() => '?').join(', ');
	await connection.execute(
		`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`,
		owned
	);
}

/* ── read-state mapping ────────────────────────────────────────────── */

function mapRunState(row: PayrollRunRow): PayrollReviewRunState {
	return {
		id: Number(row.id),
		month: Number(row.month),
		year: Number(row.year),
		runNumber: Number(row.run_number),
		status: String(row.status),
		totalEmployees: nullableInteger(row.total_employees),
		totalGross: nullableNumber(row.total_gross),
		totalDeductions: nullableNumber(row.total_deductions),
		totalNetPay: nullableNumber(row.total_net_pay),
		totalEmployerContribution: nullableNumber(
			row.total_employer_contribution
		),
		finalizedBy: nullableInteger(row.finalized_by),
		finalizedAt: dateTimeText(row.finalized_at),
		paymentDate: dateOnly(row.payment_date),
		paidBy: nullableInteger(row.paid_by),
		paidAt: dateTimeText(row.paid_at),
	};
}

function mapSlipState(row: PayrollSlipRow): PayrollReviewSlipState {
	return {
		id: Number(row.id),
		employeeId: Number(row.employee_id),
		month: dateOnly(row.month),
		paymentStatus: textOrNull(row.payment_status),
		paymentDate: dateOnly(row.payment_date),
		paymentReference: textOrNull(row.payment_reference),
		daysPresent: nullableNumber(row.days_present),
		daysAbsent: nullableNumber(row.days_absent),
		daysLeave: nullableNumber(row.days_leave),
		payableDays: nullableNumber(row.payable_days),
		lopDays: nullableNumber(row.lop_days),
		lopDeduction: nullableNumber(row.lop_deduction),
		overtimeHours: nullableNumber(row.overtime_hours),
		standardWorkingDays: nullableNumber(row.standard_working_days),
		fullMonthGross: nullableNumber(row.full_month_gross),
		gross: nullableNumber(row.gross),
		ctcUsed: nullableNumber(row.ctc_used),
		basisHours: nullableNumber(row.basis_hours),
		hourlyRate: nullableNumber(row.hourly_rate),
		loggedHours: nullableNumber(row.logged_hours),
		daUsed: nullableNumber(row.da_used),
		da: nullableNumber(row.da),
		basic: nullableNumber(row.basic),
		hra: nullableNumber(row.hra),
		conveyance: nullableNumber(row.conveyance),
		callAllowance: nullableNumber(row.call_allowance),
		otherAllowances: nullableNumber(row.other_allowances),
		bonus: nullableNumber(row.bonus),
		incentive: nullableNumber(row.incentive),
		otRate: nullableNumber(row.ot_rate),
		totalEarnings: nullableNumber(row.total_earnings),
		pfEmployee: nullableNumber(row.pf_employee),
		esicEmployee: nullableNumber(row.esic_employee),
		pt: nullableNumber(row.pt),
		lwf: nullableNumber(row.lwf),
		mlwf: nullableNumber(row.mlwf),
		tds: nullableNumber(row.tds),
		otherDeductions: nullableNumber(row.other_deductions),
		retention: nullableNumber(row.retention),
		totalDeductions: nullableNumber(row.total_deductions),
		netPay: nullableNumber(row.net_pay),
		pfEmployer: nullableNumber(row.pf_employer),
		esicEmployer: nullableNumber(row.esic_employer),
		mlwfEmployer: nullableNumber(row.mlwf_employer),
		insurance: nullableNumber(row.insurance),
		gratuity: nullableNumber(row.gratuity),
		pfAdmin: nullableNumber(row.pf_admin),
		edli: nullableNumber(row.edli),
		totalEmployerContributions: nullableNumber(
			row.total_employer_contributions
		),
		employerCost: nullableNumber(row.employer_cost),
		plTotal: nullableInteger(row.pl_total),
		plUsed: nullableInteger(row.pl_used),
		plBalance: nullableInteger(row.pl_balance),
	};
}

interface PayrollRunRow extends RowDataPacket {
	id: number;
	month: number;
	year: number;
	run_number: number;
	status: string;
	total_employees: number | null;
	total_gross: string | number | null;
	total_deductions: string | number | null;
	total_net_pay: string | number | null;
	total_employer_contribution: string | number | null;
	finalized_by: number | null;
	finalized_at: string | Date | null;
	payment_date: string | Date | null;
	paid_by: number | null;
	paid_at: string | Date | null;
}

interface PayrollSlipRow extends RowDataPacket {
	id: number;
	employee_id: number;
	month: string | Date | null;
	gross: string | number | null;
	ctc_used: string | number | null;
	basis_hours: string | number | null;
	hourly_rate: string | number | null;
	logged_hours: string | number | null;
	da_used: string | number | null;
	da: string | number | null;
	basic: string | number | null;
	hra: string | number | null;
	conveyance: string | number | null;
	call_allowance: string | number | null;
	other_allowances: string | number | null;
	bonus: string | number | null;
	incentive: string | number | null;
	ot_rate: string | number | null;
	total_earnings: string | number | null;
	pf_employee: string | number | null;
	esic_employee: string | number | null;
	pt: string | number | null;
	lwf: string | number | null;
	mlwf: string | number | null;
	tds: string | number | null;
	other_deductions: string | number | null;
	retention: string | number | null;
	total_deductions: string | number | null;
	net_pay: string | number | null;
	pf_employer: string | number | null;
	esic_employer: string | number | null;
	mlwf_employer: string | number | null;
	insurance: string | number | null;
	gratuity: string | number | null;
	pf_admin: string | number | null;
	edli: string | number | null;
	total_employer_contributions: string | number | null;
	employer_cost: string | number | null;
	standard_working_days: number | null;
	days_present: string | number | null;
	days_absent: string | number | null;
	days_leave: string | number | null;
	payable_days: string | number | null;
	lop_days: string | number | null;
	lop_deduction: string | number | null;
	overtime_hours: string | number | null;
	full_month_gross: string | number | null;
	pl_total: number | null;
	pl_used: number | null;
	pl_balance: number | null;
	payment_status: string | null;
	payment_date: string | Date | null;
	payment_reference: string | null;
}

interface RoleRow extends RowDataPacket {
	id: number;
	role_code: string;
	permissions: unknown;
}

/* ── small helpers ─────────────────────────────────────────────────── */

async function queryRows<T extends RowDataPacket>(
	connection: Connection,
	sql: string,
	params: ExecuteValues[] = []
): Promise<T[]> {
	const [rows] = await connection.execute<T[]>(sql, params);
	return rows;
}

async function insertRow(
	connection: Connection,
	sql: string,
	params: ExecuteValues[]
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(sql, params);
	return Number(result.insertId);
}

function isDuplicateKey(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const candidate = error as { errno?: unknown; code?: unknown };
	return (
		candidate.errno === 1062 || candidate.code === 'ER_DUP_ENTRY'
	);
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Trim a unique identifier while keeping a deterministic, unique hash tail. */
function fitIdentifier(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	const digest = sha256(value).slice(0, 7);
	const prefix = value.slice(0, maxLength - digest.length - 1);
	return `${prefix}-${digest}`;
}

function fixtureMonthSlots(
	namespace: string
): Array<{ year: number; month: number }> {
	const slots: Array<{ year: number; month: number }> = [];
	for (const year of FIXTURE_YEARS) {
		for (const month of FIXTURE_MONTHS) {
			slots.push({ year, month });
		}
	}
	const start =
		Number.parseInt(sha256(namespace).slice(0, 8), 16) % slots.length;
	return slots.slice(start).concat(slots.slice(0, start));
}

function isoDate(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
		2,
		'0'
	)}`;
}

function parseStringArray(value: unknown): string[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(entry): entry is string => typeof entry === 'string'
	);
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) ? number : null;
}

function nullableInteger(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const number = Number(value);
	return Number.isInteger(number) ? number : null;
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value);
	return text.length > 0 ? text : null;
}

function dateOnly(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	const text = String(value);
	return text.length >= 10 ? text.slice(0, 10) : text;
}

function dateTimeText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) {
		return value.toISOString().slice(0, 19).replace('T', ' ');
	}
	return String(value);
}

// Keep the inclusive employment window close to the data it protects.
if (
	PRIMARY_SEED.exitDay !== 20 ||
	PRIMARY_ATTENDANCE.length !== 11 ||
	PRIMARY_ATTENDANCE.some(
		(day, index) => day.day !== PRIMARY_SEED.joiningDay + index
	)
) {
	throw new Error(
		'[payroll-review] attendance must cover the inclusive employment window.'
	);
}
