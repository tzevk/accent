import { exec, rows } from './db';
import { E2E_MONTH } from './fixtures';

/**
 * Employee-Utilization fixtures — the month-scoped payroll roster the
 * utilization report must read (ticket #293).
 *
 * The report resolves each viewed month from raw employee records plus
 * recorded evidence, so this module seeds one employee per branch of the
 * documented rule:
 *
 *   start = joining_date → hire_date → first attendance → first Logged Hours
 *           → open if active, unresolved otherwise
 *   end   = exit_date → last attendance → last Logged Hours
 *           → open if active, unresolved otherwise
 *
 * Members seeded (all `E2E-UTIL-*`):
 *   0001 payrollWithHours        active, joins 2019-01-01, logs + attendance
 *   0002 payrollIdle             active, joins 2019-01-01, no evidence
 *   0003 leaverInViewedMonth     terminated, exits 2019-01-31 — visible in Jan
 *   0004 leaverBeforeViewedMonth terminated, exits 2018-12-31 — never in Jan
 *   0005 joinerAfterViewedMonth  active, joins 2019-03-01 — absent from Jan
 *   0006 contractInViewedMonth   Contract, works in Jan — disclosed, never a row
 *   0007 deputationInViewedMonth Deputation, attendance in Jan — disclosed
 *   0008 unsetInViewedMonth      NULL Employee Type, logs in Jan — disclosed
 *   0009 internNoEvidence        Intern, joins 2019-01-01 — disclosed
 *   0010 evidenceOnly            no dates at all; attendance starts 2019-01-07
 *   0011 evidenceLeaver          no dates; trades 2019-01-02…04 only
 *   0012 hireDateJoiner          no joining_date; hire_date 2019-03-01
 *   0013 unplacedPayroll         terminated, no dates, no evidence — unplaced
 *   0014 midMonthJoiner          active, joins 2019-01-15 — partial month
 *   0015 midMonthLeaver          terminated, exits 2019-01-18 — partial month,
 *                                with a leave day and an 'H' day inside it
 *
 * The viewed month is the harness's `E2E_MONTH` (2019-01), so the base
 * fixtures' employees and holiday participate in the same calendar, and the
 * month gets one active *optional* holiday (2019-01-15) that must not shorten
 * Capacity. Namespace (everything this module owns; nothing else is touched):
 *   users                      `e2e_util_user`
 *   employees                  `E2E-UTIL-*`
 *   employee_attendance        employee_id of those employees
 *   employee_salary_profile    employee_id of those employees
 *   user_activity_assignments  `e2e-util-*`
 *   holiday_master             `E2E Utilization Optional Holiday`
 *
 * Intended call order:
 *   1. `await seedUtilizationFixtures()` once before the utilization specs —
 *      from global setup or a spec's `beforeAll`. It runs cleanup first, so it
 *      is idempotent across runs.
 *   2. Run the specs.
 *   3. `await cleanupUtilizationFixtures()` in the matching teardown.
 * Both use the shared pool in `e2e/lib/db.ts`, so call them before `closeDb()`.
 */

/** The month the utilization spec views (`E2E_MONTH` = 2019-01). */
export const UTILIZATION_MONTH = E2E_MONTH.slice(0, 7);
/** A later month the joiner members are present in. */
export const UTILIZATION_LATER_MONTH = '2019-03';
export const UTILIZATION_EMPLOYEE_PREFIX = 'E2E-UTIL-';
export const UTILIZATION_ASSIGNMENT_PREFIX = 'e2e-util-';
export const UTILIZATION_USERNAME = 'e2e_util_user';
/** CTC every seeded salary profile carries; the rows must price from it. */
export const UTILIZATION_CTC = 26000;
/** Hours logged on each seeded Logged Hours day. */
export const UTILIZATION_LOGGED_HOURS_PER_DAY = 8;

/**
 * An active OPTIONAL holiday inside the viewed month. Optional holidays are
 * working days for the utilization calendar, so this one must not shorten any
 * row's Capacity; `is_optional` is the switch (every consumer ignores the
 * `type` enum). It lands on a Tuesday, i.e. a working day either way.
 */
export const UTILIZATION_OPTIONAL_HOLIDAY = {
	name: 'E2E Utilization Optional Holiday',
	date: '2019-01-15',
} as const;

export type UtilizationPlan =
	| 'payrollWithHours'
	| 'payrollIdle'
	| 'leaverInViewedMonth'
	| 'leaverBeforeViewedMonth'
	| 'joinerAfterViewedMonth'
	| 'contractInViewedMonth'
	| 'deputationInViewedMonth'
	| 'unsetInViewedMonth'
	| 'internNoEvidence'
	| 'evidenceOnly'
	| 'evidenceLeaver'
	| 'hireDateJoiner'
	| 'unplacedPayroll'
	| 'midMonthJoiner'
	| 'midMonthLeaver'
	/** Rate cases (#295): the month's Basis Hours must price these. */
	| 'basisDaysOverride'
	| 'directRateIgnored'
	| 'basisRateFullMonth'
	| 'payrollNoProfile';

export type UtilizationEmployeeType =
	| 'Payroll'
	| 'Contract'
	| 'Deputation'
	| 'Permanent'
	| 'Intern';

/** Salary-profile overrides for the distinguishing rate cases (#295). */
export interface UtilizationProfileOverrides {
	salary_type?: string;
	hourly_rate?: number;
	std_hours_per_day?: number;
	std_working_days?: number;
}

export interface UtilizationMember {
	/** Zero-padded roster number, e.g. '0001'. */
	n: string;
	/** Accent employee code (`employees.employee_id`), e.g. 'E2E-UTIL-0001'. */
	code: string;
	type: UtilizationEmployeeType | null;
	status: 'active' | 'terminated';
	joining: string | null;
	hire: string | null;
	exit: string | null;
	plan: UtilizationPlan;
	/** Viewed-month day numbers with an attendance record. */
	attendanceDays: number[];
	/** Per-day attendance status overrides (default 'P'), e.g. 'PL' or 'H'. */
	attendanceStatusByDay?: Record<number, string>;
	/** Viewed-month day numbers carrying Logged Hours. */
	loggedDays: number[];
	/** Other months (`YYYY-MM`) with their logged day numbers — the rate must
	 * move with each month's Basis Hours. */
	loggedMonths?: { month: string; days: number[] }[];
	/** Salary-profile overrides; omitted fields take the module defaults. */
	profileOverrides?: UtilizationProfileOverrides;
	/** Seed no salary profile at all: the row's cost columns must stay blank. */
	noProfile?: boolean;
}

export function utilizationCode(n: string): string {
	return `${UTILIZATION_EMPLOYEE_PREFIX}${n}`;
}

const ROSTER_DEF: ReadonlyArray<
	Omit<UtilizationMember, 'code' | 'n'> & { n: string }
> = [
	{
		n: '0001',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'payrollWithHours',
		attendanceDays: [2, 3, 4, 5, 7, 8, 9, 10, 11, 14, 15, 16, 17],
		loggedDays: [2, 3, 4, 5, 7, 8, 9, 10, 11, 14, 15, 16, 17],
	},
	{
		n: '0002',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'payrollIdle',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		n: '0003',
		type: 'Payroll',
		status: 'terminated',
		joining: '2018-01-01',
		hire: null,
		exit: '2019-01-31',
		plan: 'leaverInViewedMonth',
		attendanceDays: [2, 3, 4, 5, 7],
		loggedDays: [2, 3, 4, 5, 7],
	},
	{
		n: '0004',
		type: 'Payroll',
		status: 'terminated',
		joining: '2018-01-01',
		hire: null,
		exit: '2018-12-31',
		plan: 'leaverBeforeViewedMonth',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		n: '0005',
		type: 'Payroll',
		status: 'active',
		joining: '2019-03-01',
		hire: null,
		exit: null,
		plan: 'joinerAfterViewedMonth',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		n: '0006',
		type: 'Contract',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'contractInViewedMonth',
		attendanceDays: [2, 3, 4],
		loggedDays: [2, 3, 4],
	},
	{
		n: '0007',
		type: 'Deputation',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'deputationInViewedMonth',
		attendanceDays: [2, 3],
		loggedDays: [],
	},
	{
		n: '0008',
		type: null,
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'unsetInViewedMonth',
		attendanceDays: [],
		loggedDays: [7, 8],
	},
	{
		n: '0009',
		type: 'Intern',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'internNoEvidence',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		n: '0010',
		type: 'Payroll',
		status: 'active',
		joining: null,
		hire: null,
		exit: null,
		plan: 'evidenceOnly',
		attendanceDays: [7, 8, 9],
		loggedDays: [],
	},
	{
		n: '0011',
		type: 'Payroll',
		status: 'terminated',
		joining: null,
		hire: null,
		exit: null,
		plan: 'evidenceLeaver',
		attendanceDays: [2, 3, 4],
		loggedDays: [2],
	},
	{
		n: '0012',
		type: 'Payroll',
		status: 'active',
		joining: null,
		hire: '2019-03-01',
		exit: null,
		plan: 'hireDateJoiner',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		n: '0013',
		type: 'Payroll',
		status: 'terminated',
		joining: null,
		hire: null,
		exit: null,
		plan: 'unplacedPayroll',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		// Partial month: the window opens on the 15th and stays open, so
		// Capacity (and the pro-rated Monthly Cost) covers only 15–31 Jan.
		n: '0014',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-15',
		hire: null,
		exit: null,
		plan: 'midMonthJoiner',
		attendanceDays: [],
		loggedDays: [],
	},
	{
		// Partial month: the window closes on the 18th. Day 14 is a leave day
		// (netted inside the window) and day 15 carries 'H' attendance on the
		// optional holiday — it must still credit the standard day.
		n: '0015',
		type: 'Payroll',
		status: 'terminated',
		joining: '2017-01-01',
		hire: null,
		exit: '2019-01-18',
		plan: 'midMonthLeaver',
		attendanceDays: [2, 3, 4, 5, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18],
		attendanceStatusByDay: { 14: 'PL', 15: 'H' },
		loggedDays: [2, 3, 4, 5, 7, 8, 9, 10, 11, 16, 17, 18],
	},
	{
		// #295: the profile's own denomination (22 × 8 = 176h) is a decoy —
		// the rate must divide CTC by January's 26 basis days × 8 = 208h.
		n: '0016',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'basisDaysOverride',
		attendanceDays: [],
		loggedDays: [2, 3, 4, 5],
		profileOverrides: { std_working_days: 22 },
	},
	{
		// #295: an hourly profile's stored rate (999) must not price a row —
		// CTC ÷ Basis Hours does, exactly as on the slip.
		n: '0017',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'directRateIgnored',
		attendanceDays: [],
		loggedDays: [7, 8, 9],
		profileOverrides: { salary_type: 'hourly', hourly_rate: 999 },
	},
	{
		// #295: Logged Hours == the month's Basis Hours (26 × 8 = 208h), so a
		// full month must pay the whole CTC: fractional = monthly, bench 0.
		// February (24 basis days) re-proves the rate moves with the month.
		n: '0018',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'basisRateFullMonth',
		attendanceDays: [],
		loggedDays: [
			1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 21, 22, 23,
			24, 25, 28, 29, 30, 31,
		],
		loggedMonths: [
			{
				month: '2019-02',
				days: [4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 18, 19],
			},
		],
	},
	{
		// #295 AC3: no salary profile covers the month — cost columns stay
		// blank (never zero) while hours and utilization still show.
		n: '0019',
		type: 'Payroll',
		status: 'active',
		joining: '2019-01-01',
		hire: null,
		exit: null,
		plan: 'payrollNoProfile',
		attendanceDays: [],
		loggedDays: [2, 3],
		noProfile: true,
	},
];

export const UTILIZATION_ROSTER: readonly UtilizationMember[] = ROSTER_DEF.map(
	(member) => ({ ...member, code: utilizationCode(member.n) })
);

const MEMBERS_BY_PLAN = new Map<UtilizationPlan, UtilizationMember[]>();
for (const member of UTILIZATION_ROSTER) {
	const members = MEMBERS_BY_PLAN.get(member.plan) ?? [];
	members.push(member);
	MEMBERS_BY_PLAN.set(member.plan, members);
}

/** The roster member carrying `plan`; every plan has exactly one member. */
export function utilizationMemberForPlan(
	plan: UtilizationPlan
): UtilizationMember {
	const member = MEMBERS_BY_PLAN.get(plan)?.[0];
	if (!member)
		throw new Error(`No utilization fixture member has plan '${plan}'`);
	return member;
}

/** `YYYY-MM-DD` for a 1-based day of the viewed month. */
export function utilizationDate(day: number): string {
	return monthDate(UTILIZATION_MONTH, day);
}

/** `YYYY-MM-DD` for a 1-based day of any month. */
function monthDate(month: string, day: number): string {
	return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * mysql2's prepared-statement path renders an array bind as a JSON string, so
 * `VALUES ?` bulk inserts are unavailable; build one placeholder tuple per row
 * instead and flatten the parameters.
 */
async function insertRows(
	table: string,
	columns: string[],
	values: unknown[][]
): Promise<void> {
	const CHUNK_SIZE = 100;
	const tuple = `(${columns.map(() => '?').join(', ')})`;
	for (let start = 0; start < values.length; start += CHUNK_SIZE) {
		const chunk = values.slice(start, start + CHUNK_SIZE);
		await exec(
			`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${chunk
				.map(() => tuple)
				.join(', ')}`,
			chunk.flat()
		);
	}
}

const ATTENDANCE_COLUMNS = [
	'employee_id',
	'attendance_date',
	'status',
	'is_weekly_off',
	'is_holiday',
	'overtime_hours',
	'remarks',
];

/** Remove every row the utilization fixtures own. Safe to run repeatedly. */
export async function cleanupUtilizationFixtures(): Promise<number> {
	const employees = await rows<{ id: number }>(
		`SELECT id FROM employees WHERE employee_id LIKE ? AND isDelete = 0`,
		[`${UTILIZATION_EMPLOYEE_PREFIX}%`]
	);
	const employeeIds = employees.map((row) => row.id);

	// Children before parents, so foreign keys never block a delete.
	if (employeeIds.length) {
		const placeholders = employeeIds.map(() => '?').join(', ');
		await exec(
			`DELETE FROM employee_attendance WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM user_activity_assignments WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		await exec(
			`DELETE FROM employee_salary_profile WHERE employee_id IN (${placeholders})`,
			employeeIds
		);
		try {
			await exec(
				`DELETE FROM payroll_slips WHERE employee_id IN (${placeholders})`,
				employeeIds
			);
		} catch {
			// Older schemas may name the table differently.
		}
	}
	// The id namespace catches assignments even when the employee row is gone.
	await exec(`DELETE FROM user_activity_assignments WHERE id LIKE ?`, [
		`${UTILIZATION_ASSIGNMENT_PREFIX}%`,
	]);
	await exec(`DELETE FROM users WHERE username = ?`, [UTILIZATION_USERNAME]);
	await exec(`DELETE FROM employees WHERE employee_id LIKE ?`, [
		`${UTILIZATION_EMPLOYEE_PREFIX}%`,
	]);
	await exec(`DELETE FROM holiday_master WHERE name = ?`, [
		UTILIZATION_OPTIONAL_HOLIDAY.name,
	]);

	return employeeIds.length;
}

export interface UtilizationSeeded {
	month: string;
	/** `users.id` of the seeded `e2e_util_user`. */
	userId: number;
	employees: number;
	attendance: number;
	assignments: number;
	profiles: number;
	loggedDays: number;
	/** Active optional holidays seeded in the viewed month. */
	holidays: number;
}

/** Purge leftovers, then seed the roster, its evidence and its profiles. */
export async function seedUtilizationFixtures(): Promise<UtilizationSeeded> {
	await cleanupUtilizationFixtures();

	const summary: UtilizationSeeded = {
		month: UTILIZATION_MONTH,
		userId: 0,
		employees: 0,
		attendance: 0,
		assignments: 0,
		profiles: 0,
		loggedDays: 0,
		holidays: 0,
	};

	const user = await exec(
		`INSERT INTO users (username, password_hash, email, full_name, status, is_active, is_super_admin, account_type, isDelete)
     VALUES (?, '', ?, 'E2E Utilization Fixture', 'active', 1, 0, 'employee', 0)`,
		[UTILIZATION_USERNAME, `${UTILIZATION_USERNAME}@accent.test`]
	);
	summary.userId = user.insertId;

	for (const member of UTILIZATION_ROSTER) {
		const employee = await exec(
			`INSERT INTO employees
         (employee_id, first_name, last_name, email, status, employee_type,
          joining_date, hire_date, exit_date, isDelete)
       VALUES (?, 'E2E', ?, ?, ?, ?, ?, ?, ?, 0)`,
			[
				member.code,
				member.plan,
				`e2e.util.${member.n}@accent.test`,
				member.status,
				member.type,
				member.joining,
				member.hire,
				member.exit,
			]
		);
		const employeeId = employee.insertId;
		summary.employees++;

		// Every Payroll-type member gets a monthly profile so the grid prices
		// its row — unless the plan deliberately omits one (the blank-cost
		// case); the Contract member's stream is irrelevant to this report.
		if (
			!member.noProfile &&
			(member.type === 'Payroll' || member.type === null)
		) {
			const profile = member.profileOverrides ?? {};
			await exec(
				`INSERT INTO employee_salary_profile
           (employee_id, gross, gross_salary, employer_cost, other_allowances,
            effective_from, is_active, pf_applicable, esic_applicable, pt_applicable,
            mlwf_applicable, salary_type, hourly_rate, std_hours_per_day, std_working_days,
            tds_percentage, loan_amount, loan_amount_per_month, loan_active,
            advance_amount, advance_active)
         VALUES (?, ?, ?, ?, 0, '2019-01-01', 1, 0, 0, 0, 0, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0)`,
				[
					employeeId,
					UTILIZATION_CTC,
					UTILIZATION_CTC,
					UTILIZATION_CTC,
					profile.salary_type ?? 'monthly',
					profile.hourly_rate ?? null,
					profile.std_hours_per_day ?? 8,
					profile.std_working_days ?? 26,
				]
			);
			summary.profiles++;
		}

		if (member.attendanceDays.length) {
			await insertRows(
				'employee_attendance',
				ATTENDANCE_COLUMNS,
				member.attendanceDays.map((day) => [
					employeeId,
					utilizationDate(day),
					member.attendanceStatusByDay?.[day] ?? 'P',
					0,
					0,
					'0.00',
					null,
				])
			);
			summary.attendance += member.attendanceDays.length;
		}

		// One assignment per logged month: the viewed month seeds `member.n`,
		// extra months append their own suffix (both inside the purged
		// `e2e-util-` id namespace).
		const loggedMonths = [
			{ month: UTILIZATION_MONTH, days: member.loggedDays, suffix: '' },
			...(member.loggedMonths ?? []).map((extra) => ({
				month: extra.month,
				days: extra.days,
				suffix: `-${extra.month}`,
			})),
		];
		for (const logged of loggedMonths) {
			if (!logged.days.length) continue;
			const dailyEntries = logged.days.map((day) => ({
				date: monthDate(logged.month, day),
				hours: UTILIZATION_LOGGED_HOURS_PER_DAY,
			}));
			await exec(
				`INSERT INTO user_activity_assignments
           (id, user_id, employee_id, activity_id, activity_name, status,
            daily_entries, assigned_date, due_date)
         VALUES (?, ?, ?, ?, 'E2E utilization fixture work', 'In Progress', ?, ?, ?)`,
				[
					`${UTILIZATION_ASSIGNMENT_PREFIX}${member.n}${logged.suffix}`,
					summary.userId,
					employeeId,
					`${UTILIZATION_ASSIGNMENT_PREFIX}act-${member.n}${logged.suffix}`,
					JSON.stringify(dailyEntries),
					`${logged.month}-01 09:00:00`,
					`${logged.month}-28`,
				]
			);
			summary.assignments++;
			summary.loggedDays += dailyEntries.length;
		}
	}

	// One active optional holiday inside the viewed month: a working day.
	await exec(
		`INSERT INTO holiday_master (name, date, type, is_optional, is_active)
     VALUES (?, ?, 'optional', 1, 1)`,
		[UTILIZATION_OPTIONAL_HOLIDAY.name, UTILIZATION_OPTIONAL_HOLIDAY.date]
	);
	summary.holidays = 1;

	return summary;
}
