/**
 * Disposable Salary Profiles fixture for the #447 browser journey.
 *
 * The fixture is deliberately independent of the read-only #431 payroll review
 * fixture. It creates:
 *
 * - a namespaced non-admin editor identity with exactly payroll read/create/
 *   update/delete. It is not a super admin and never receives employees:*;
 * - a separate read-only payroll identity with exactly payroll:read;
 * - an Employee with no agreement (a non-Payroll Employee Type) for the real
 *   create/correct/generate journey;
 * - an unused current Contract agreement whose Employee Type is Payroll, so
 *   the directory can prove Salary Type chooses the pay stream;
 * - an explicit zero-CTC payroll agreement with legacy amounts unset;
 * - a current payroll agreement plus its durable payroll-use row, so a
 *   read-only session can prove used salary history without repeating the
 *   write journey;
 * - one recorded logged-hours assignment for the journey Employee;
 * - one read-only privilege-leave summary row.
 *
 * Both role rows are scoped to a hash of the namespace. Two Playwright workers
 * therefore never create, reuse or delete the same role row, so one worker's
 * teardown cannot race another worker's seed.
 *
 * Every row is keyed and tracked by its real primary key. The generated
 * payroll run, slip, use evidence and audit rows are found by the owned
 * Employee ids during cleanup, so a partially failed seed or a failed test
 * cannot leave operational rows behind.
 *
 * Expected values are authored literals: CTCs, the logged-hours figure and the
 * leave usage are independent of the workspace UI and the payroll calculator.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { hashFixturePassword } from '../../scripts/leads-integration/support.ts';

export const SALARY_EDITOR_ROLE_CODE = 'e2e_salary_editor';
export const SALARY_READER_ROLE_CODE = 'e2e_salary_reader';
export const SALARY_EDITOR_PERMISSIONS = [
	'payroll:read',
	'payroll:create',
	'payroll:update',
	'payroll:delete',
] as const;
export const SALARY_READER_PERMISSIONS = ['payroll:read'] as const;

export const INITIAL_CTC = 50000;
export const CORRECTED_CTC = 52000;
export const REVISION_CTC = 60000;
export const CONTRACT_CTC = 45000;
export const ZERO_CTC = 0;
/** Recorded payroll use on a separate Employee, seeded with its use ledger. */
export const USED_CTC = 48000;
export const FIXTURE_LOGGED_HOURS = 160;
export const FIXTURE_PL_ENTITLEMENT = 21;
export const FIXTURE_PL_USED = 2;

const EDITOR_ROLE_NAME = 'E2E 434 Salary Editor';
const READER_ROLE_NAME = 'E2E 434 Salary Reader';
const EMPLOYEE_CODE_PREFIX = 'E2E434';
const FIXTURE_YEARS = [2032, 2033, 2034, 2035] as const;
const FIXTURE_MONTHS = [1, 3, 5, 7, 8, 10, 12] as const;
const DEPARTMENT_SUFFIX = ' Salary Fixture';
/** Far outside the payroll fixture/revision range so no run can use it. */
const ZERO_MONTH = '2045-01-01';
const ZERO_AS_OF_DATE = '2045-01-10';

/* ── exported fixture contract ─────────────────────────────────────── */

export interface SalaryFixtureIdentity {
	userId: number;
	roleId: number;
	roleOwned: boolean;
	/** Namespaced role row this identity uses; cleanup trusts these exact values. */
	roleCode: string;
	roleName: string;
	username: string;
	email: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	permissions: readonly string[];
}

export interface SalaryFixtureEmployee {
	id: number;
	employeeCode: string;
	fullName: string;
	email: string;
	employeeType: string;
	department: string;
	joiningDate: string;
	position: string;
}

export interface SalaryProfilesFixture {
	namespace: string;
	/** First of the payroll-generation month, `YYYY-MM-01`. */
	month: string;
	monthSlug: string;
	/** Directory/editor as-of date inside the generation month. */
	asOfDate: string;
	/** First of the first future revision month. */
	revisionMonth: string;
	revisionMonthSlug: string;
	/** First and as-of dates for the explicit-zero Employee. */
	zeroMonth: string;
	zeroAsOfDate: string;
	searchToken: string;
	runId: number;
	editor: SalaryFixtureIdentity;
	reader: SalaryFixtureIdentity;
	employees: {
		noProfile: SalaryFixtureEmployee;
		contract: SalaryFixtureEmployee;
		zero: SalaryFixtureEmployee;
		/** Current agreement already recorded as used by payroll. */
		used: SalaryFixtureEmployee;
	};
	agreements: {
		contract: number;
		zero: number;
		used: number;
	};
	amounts: {
		initialCtc: number;
		correctedCtc: number;
		revisionCtc: number;
		contractCtc: number;
		zeroCtc: number;
		usedCtc: number;
		loggedHours: number;
		plEntitlement: number;
		plUsed: number;
	};
}

export interface SalaryAgreementRow {
	id: number;
	employeeId: number;
	salaryType: string | null;
	employerCost: number | null;
	grossSalary: number | null;
	gross: number | null;
	contractAmount: number | null;
	effectiveFrom: string;
	effectiveTo: string | null;
	isActive: number;
	cancelledAt: string | null;
	cancelledBy: number | null;
	cancelledReason: string | null;
	stdHoursPerDay: number | null;
	stdWorkingDays: number | null;
	plTotal: number | null;
}

export interface SalaryUseRow {
	id: number;
	employeeId: number;
	month: string | null;
	agreementId: number | null;
	agreementSource: string | null;
	evidence: string;
	isAmbiguous: number;
	firstUsedBy: number | null;
}

export interface SalaryAuditRow {
	id: number;
	entityType: string;
	entityId: number;
	employeeId: number | null;
	action: string;
	oldValues: Record<string, unknown> | null;
	newValues: Record<string, unknown> | null;
	performedBy: number;
	performedAt: string | null;
}

export interface SalarySlipRow {
	id: number;
	employeeId: number;
	month: string | null;
	gross: number | null;
	ctcUsed: number | null;
	basisHours: number | null;
	hourlyRate: number | null;
	loggedHours: number | null;
	totalEarnings: number | null;
	totalDeductions: number | null;
	netPay: number | null;
	employerCost: number | null;
	salaryProfileId: number | null;
	salaryProfileSource: string | null;
	salaryType: string | null;
	paymentStatus: string | null;
}

export interface SalaryTimelineRow {
	employeeId: number;
	version: number;
}

export interface SalaryLeaveSummaryRow {
	id: number;
	employeeId: number;
	month: string;
	totalPrivilegeLeave: number | null;
}

export interface SalaryRunRow {
	id: number;
	month: number;
	year: number;
	runNumber: number;
	status: string;
}

export interface SalaryProfilesState {
	agreements: SalaryAgreementRow[];
	uses: SalaryUseRow[];
	audits: SalaryAuditRow[];
	slips: SalarySlipRow[];
	timelines: SalaryTimelineRow[];
	leaveSummaries: SalaryLeaveSummaryRow[];
	run: SalaryRunRow | null;
}

/* ── seed ──────────────────────────────────────────────────────────── */

interface OwnedIds {
	runId?: number;
	roleIds: Array<{ id: number; name: string }>;
	userIds: number[];
	employeeIds: number[];
}

interface AllocatedMonth {
	year: number;
	month: number;
	monthDate: string;
}

interface EmployeeSeed {
	codeSuffix: string;
	lastName: string;
	position: string;
	employeeType: string;
	joiningDate: string;
	hireDate: string;
	exitDate?: string | null;
}

/**
 * Seed one isolated Salary Profiles fixture.
 *
 * Playwright's `db` fixture calls this after the owned application has started,
 * exactly like the read-only financial fixture. A failed seed removes every
 * row it created before rethrowing.
 */
export async function seedSalaryProfilesFixture(
	connection: Connection,
	namespace: string
): Promise<SalaryProfilesFixture> {
	const fixtureNamespace = namespace.trim();
	if (!fixtureNamespace) {
		throw new Error('[salary-profiles] namespace must not be empty.');
	}

	const owned: OwnedIds = { roleIds: [], userIds: [], employeeIds: [] };
	try {
		const allocated = await allocateMonth(connection, fixtureNamespace);
		owned.runId = allocated.runId;

		// A role row per namespace, never a shared `e2e_salary_*` row: parallel
		// Playwright workers must not see, reuse or delete one another's roles.
		const roleScope = sha256(fixtureNamespace).slice(0, 8);
		const editorRoleCode = fitIdentifier(
			`${SALARY_EDITOR_ROLE_CODE}_${roleScope}`,
			50
		);
		const editorRoleName = fitIdentifier(
			`${EDITOR_ROLE_NAME} ${roleScope}`,
			255
		);
		const readerRoleCode = fitIdentifier(
			`${SALARY_READER_ROLE_CODE}_${roleScope}`,
			50
		);
		const readerRoleName = fitIdentifier(
			`${READER_ROLE_NAME} ${roleScope}`,
			255
		);

		const editorRole = await ensureRole(
			connection,
			editorRoleCode,
			editorRoleName,
			SALARY_EDITOR_PERMISSIONS
		);
		if (editorRole.owned) {
			owned.roleIds.push({ id: editorRole.id, name: editorRoleName });
		}

		const readerRole = await ensureRole(
			connection,
			readerRoleCode,
			readerRoleName,
			SALARY_READER_PERMISSIONS
		);
		if (readerRole.owned) {
			owned.roleIds.push({ id: readerRole.id, name: readerRoleName });
		}

		const key = sha256(fixtureNamespace).slice(0, 8);
		const searchToken = `${EMPLOYEE_CODE_PREFIX}-${key}`;
		const department = `${searchToken}${DEPARTMENT_SUFFIX}`;
		const monthDate = allocated.monthDate;
		const monthSlug = monthDate.slice(0, 7);
		const asOfDate = isoDate(allocated.year, allocated.month, 15);
		const revisionMonth = nextMonthStart(monthDate);
		const zeroMonth = ZERO_MONTH;

		const editor = await createIdentity(
			connection,
			fixtureNamespace,
			'editor',
			{ ...editorRole, code: editorRoleCode, name: editorRoleName },
			SALARY_EDITOR_PERMISSIONS
		);
		owned.userIds.push(editor.userId);

		const reader = await createIdentity(
			connection,
			fixtureNamespace,
			'reader',
			{ ...readerRole, code: readerRoleCode, name: readerRoleName },
			SALARY_READER_PERMISSIONS
		);
		owned.userIds.push(reader.userId);

		const noProfile = await seedEmployee(connection, searchToken, department, {
			codeSuffix: 'NP',
			lastName: `NoProfile-${key}`,
			position: 'Fixture Salary Setup',
			employeeType: 'Deputation',
			joiningDate: isoDate(allocated.year, allocated.month, 10),
			hireDate: monthDate,
		});
		owned.employeeIds.push(noProfile.id);

		const contract = await seedEmployee(connection, searchToken, department, {
			codeSuffix: 'CT',
			lastName: `Contract-${key}`,
			position: 'Fixture Contract Pay',
			employeeType: 'Payroll',
			joiningDate: monthDate,
			hireDate: monthDate,
		});
		owned.employeeIds.push(contract.id);

		const zero = await seedEmployee(connection, searchToken, department, {
			codeSuffix: 'ZR',
			lastName: `Zero-${key}`,
			position: 'Fixture Zero CTC',
			employeeType: 'Contract',
			joiningDate: zeroMonth,
			hireDate: zeroMonth,
		});
		owned.employeeIds.push(zero.id);

		const used = await seedEmployee(connection, searchToken, department, {
			codeSuffix: 'US',
			lastName: `Used-${key}`,
			position: 'Fixture Used Payroll',
			employeeType: 'Payroll',
			joiningDate: monthDate,
			hireDate: monthDate,
		});
		owned.employeeIds.push(used.id);

		const contractAgreementId = await seedAgreement(connection, {
			employeeId: contract.id,
			effectiveFrom: monthDate,
			salaryType: 'contract',
			employerCost: CONTRACT_CTC,
			plTotal: 0,
		});
		const zeroAgreementId = await seedAgreement(connection, {
			employeeId: zero.id,
			effectiveFrom: zeroMonth,
			salaryType: 'monthly',
			employerCost: ZERO_CTC,
			plTotal: 0,
		});
		const usedAgreementId = await seedAgreement(connection, {
			employeeId: used.id,
			effectiveFrom: monthDate,
			salaryType: 'monthly',
			employerCost: USED_CTC,
			plTotal: 0,
		});
		await seedPayrollUse(
			connection,
			editor.userId,
			used.id,
			usedAgreementId,
			monthDate
		);

		await seedLoggedHours(connection, editor.userId, noProfile.id, monthDate);
		await seedLeaveSummary(connection, noProfile.id, monthSlug);

		return {
			namespace: fixtureNamespace,
			month: monthDate,
			monthSlug,
			asOfDate,
			revisionMonth,
			revisionMonthSlug: revisionMonth.slice(0, 7),
			zeroMonth,
			zeroAsOfDate: ZERO_AS_OF_DATE,
			searchToken,
			runId: allocated.runId,
			editor,
			reader,
			employees: {
				noProfile: { ...noProfile, employeeType: 'Deputation' },
				contract: { ...contract, employeeType: 'Payroll' },
				zero: { ...zero, employeeType: 'Contract' },
				used: { ...used, employeeType: 'Payroll' },
			},
			agreements: {
				contract: contractAgreementId,
				zero: zeroAgreementId,
				used: usedAgreementId,
			},
			amounts: {
				initialCtc: INITIAL_CTC,
				correctedCtc: CORRECTED_CTC,
				revisionCtc: REVISION_CTC,
				contractCtc: CONTRACT_CTC,
				zeroCtc: ZERO_CTC,
				usedCtc: USED_CTC,
				loggedHours: FIXTURE_LOGGED_HOURS,
				plEntitlement: FIXTURE_PL_ENTITLEMENT,
				plUsed: FIXTURE_PL_USED,
			},
		};
	} catch (error) {
		try {
			await cleanupOwnedIds(connection, owned);
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; salary-profiles fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

/* ── cleanup ───────────────────────────────────────────────────────── */

/**
 * Delete only this fixture's owned rows. The generated Payroll Run, slips, use
 * evidence and audit rows are found through the owned Employee ids, so the
 * caller does not have to track writes the browser made.
 */
export async function cleanupSalaryProfilesFixture(
	connection: Connection,
	fixture: SalaryProfilesFixture
): Promise<void> {
	await cleanupOwnedIds(connection, {
		runId: fixture.runId,
		roleIds: [
			...(fixture.editor.roleOwned
				? [{ id: fixture.editor.roleId, name: fixture.editor.roleName }]
				: []),
			...(fixture.reader.roleOwned
				? [{ id: fixture.reader.roleId, name: fixture.reader.roleName }]
				: []),
		],
		userIds: [fixture.editor.userId, fixture.reader.userId],
		employeeIds: [
			fixture.employees.noProfile.id,
			fixture.employees.contract.id,
			fixture.employees.zero.id,
			fixture.employees.used.id,
		],
	});
}

/* ── independent persisted readback ────────────────────────────────── */

export async function readSalaryProfilesState(
	connection: Connection,
	fixture: SalaryProfilesFixture
): Promise<SalaryProfilesState> {
	const employeeIds = [
		fixture.employees.noProfile.id,
		fixture.employees.contract.id,
		fixture.employees.zero.id,
		fixture.employees.used.id,
	];
	const placeholders = employeeIds.map(() => '?').join(', ');
	// A Playwright `db` fixture is one mysql2 connection, not a pool. Keep the
	// evidence reads sequential so they share that connection without relying on
	// a driver-side command queue.
	const agreements = await queryRows<AgreementReadRow>(
		connection,
		`SELECT id, employee_id, salary_type, employer_cost, gross_salary,
            gross, contract_amount, effective_from, effective_to, is_active,
            cancelled_at, cancelled_by, cancelled_reason, std_hours_per_day,
            std_working_days, pl_total
       FROM employee_salary_profile
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id, effective_from, id`,
		employeeIds
	);
	const uses = await queryRows<UseReadRow>(
		connection,
		`SELECT id, employee_id, month, agreement_id, agreement_source,
            evidence, is_ambiguous, first_used_by
       FROM employee_salary_payroll_use
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id, id`,
		employeeIds
	);
	const audits = await queryRows<AuditReadRow>(
		connection,
		`SELECT id, entity_type, entity_id, employee_id, action,
            old_values, new_values, performed_by, performed_at
       FROM payroll_audit_logs
      WHERE employee_id IN (${placeholders})
      ORDER BY id`,
		employeeIds
	);
	const slips = await queryRows<SlipReadRow>(
		connection,
		`SELECT id, employee_id, month, gross, ctc_used, basis_hours,
            hourly_rate, logged_hours, total_earnings, total_deductions,
            net_pay, employer_cost, salary_profile_id,
            salary_profile_source, salary_type, payment_status
       FROM payroll_slips
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id, month, id`,
		employeeIds
	);
	const timelines = await queryRows<TimelineReadRow>(
		connection,
		`SELECT employee_id, version
       FROM employee_salary_timelines
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id`,
		employeeIds
	);
	const leave = await queryRows<LeaveReadRow>(
		connection,
		`SELECT id, employee_id, month, total_privilege_leave
       FROM employee_attendance_summary
      WHERE employee_id IN (${placeholders})
      ORDER BY employee_id, month`,
		employeeIds
	);
	const runRows = await queryRows<RunReadRow>(
		connection,
		`SELECT id, month, year, run_number, status
       FROM payroll_runs
      WHERE id = ?
      LIMIT 1`,
		[fixture.runId]
	);

	return {
		agreements: agreements.map(mapAgreement),
		uses: uses.map(mapUse),
		audits: audits.map(mapAudit),
		slips: slips.map(mapSlip),
		timelines: timelines.map((row) => ({
			employeeId: Number(row.employee_id),
			version: Number(row.version),
		})),
		leaveSummaries: leave.map((row) => ({
			id: Number(row.id),
			employeeId: Number(row.employee_id),
			month: String(row.month),
			totalPrivilegeLeave: nullableNumber(row.total_privilege_leave),
		})),
		run: runRows[0]
			? {
					id: Number(runRows[0].id),
					month: Number(runRows[0].month),
					year: Number(runRows[0].year),
					runNumber: Number(runRows[0].run_number),
					status: String(runRows[0].status),
				}
			: null,
	};
}

/* ── seed internals ────────────────────────────────────────────────── */

async function allocateMonth(
	connection: Connection,
	namespace: string
): Promise<AllocatedMonth & { runId: number }> {
	const slots: Array<{ year: number; month: number }> = [];
	for (const year of FIXTURE_YEARS) {
		for (const month of FIXTURE_MONTHS) {
			slots.push({ year, month });
		}
	}
	const start =
		Number.parseInt(sha256(namespace).slice(0, 8), 16) % slots.length;
	const ordered = slots.slice(start).concat(slots.slice(0, start));

	for (const slot of ordered) {
		const monthDate = isoDate(slot.year, slot.month, 1);
		try {
			const runId = await insertRow(
				connection,
				`INSERT INTO payroll_runs (
            month, year, run_number, status, total_employees, total_gross,
            total_deductions, total_net_pay, total_employer_contribution, remarks
          ) VALUES (?, ?, 1, 'draft', 0, 0, 0, 0, 0, ?)`,
				[
					slot.month,
					slot.year,
					`[salary-profiles ${namespace}] disposable fixture`,
				]
			);
			return { ...slot, monthDate, runId };
		} catch (error) {
			if (isDuplicateKey(error)) continue;
			throw error;
		}
	}
	throw new Error(
		`[salary-profiles] no free fixture month is available for ${namespace}.`
	);
}

async function ensureRole(
	connection: Connection,
	roleCode: string,
	roleName: string,
	permissions: readonly string[]
): Promise<{ id: number; owned: boolean }> {
	const existing = await queryRows<RoleRow>(
		connection,
		`SELECT id, role_code, role_name, permissions
       FROM roles_master
      WHERE role_code = ?
      LIMIT 1`,
		[roleCode]
	);
	if (existing[0]) {
		assertRole(existing[0], roleCode, roleName, permissions);
		return { id: Number(existing[0].id), owned: false };
	}

	try {
		const id = await insertRow(
			connection,
			`INSERT INTO roles_master (
          role_code, role_name, role_hierarchy, permissions, status
        ) VALUES (?, ?, 0, ?, 'active')`,
			[roleCode, roleName, JSON.stringify(permissions)]
		);
		return { id, owned: true };
	} catch (error) {
		if (!isDuplicateKey(error)) throw error;
		const raced = await queryRows<RoleRow>(
			connection,
			`SELECT id, role_code, role_name, permissions
         FROM roles_master
        WHERE role_code = ?
        LIMIT 1`,
			[roleCode]
		);
		if (!raced[0]) throw error;
		assertRole(raced[0], roleCode, roleName, permissions);
		return { id: Number(raced[0].id), owned: false };
	}
}

function assertRole(
	row: RoleRow,
	roleCode: string,
	roleName: string,
	permissions: readonly string[]
): void {
	if (String(row.role_code) !== roleCode) {
		throw new Error(
			`[salary-profiles] existing role ${JSON.stringify(
				row.role_code
			)} is not ${roleCode}.`
		);
	}
	if (String(row.role_name) !== roleName) {
		throw new Error(
			`[salary-profiles] role ${roleCode} must keep its fixture name; refusing to reuse or modify it.`
		);
	}
	const stored = parseStringArray(row.permissions);
	const unexpected = stored.filter(
		(permission) => !permissions.includes(permission)
	);
	if (
		unexpected.length > 0 ||
		permissions.some((permission) => !stored.includes(permission))
	) {
		throw new Error(
			`[salary-profiles] role ${roleCode} must grant exactly ${permissions.join(
				', '
			)}; refusing to reuse or modify it.`
		);
	}
	if (stored.some((permission) => permission.startsWith('employees:'))) {
		throw new Error(
			`[salary-profiles] role ${roleCode} must never grant employees:*`
		);
	}
}

async function createIdentity(
	connection: Connection,
	namespace: string,
	kind: 'editor' | 'reader',
	role: { id: number; owned: boolean; code: string; name: string },
	permissions: readonly string[]
): Promise<SalaryFixtureIdentity> {
	const username = fitIdentifier(`${namespace}-${kind}`, 50);
	const email = `${fitIdentifier(
		`${namespace}-${kind}`,
		80
	).toLowerCase()}@e2e.invalid`;
	const password = randomBytes(24).toString('hex');
	const passwordHash = await hashFixturePassword(password);
	const userId = await insertRow(
		connection,
		`INSERT INTO users (
        username, password_hash, email, full_name, status, role_id,
        permissions, is_active, isDelete, is_super_admin, account_type
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 1, 0, 0, 'employee')`,
		[
			username,
			passwordHash,
			email,
			`E2E Salary ${kind === 'editor' ? 'Editor' : 'Reader'}`,
			role.id,
			JSON.stringify(permissions),
		]
	);
	return {
		userId,
		roleId: role.id,
		roleOwned: role.owned,
		roleCode: role.code,
		roleName: role.name,
		username,
		email,
		password,
		permissions,
	};
}

async function seedEmployee(
	connection: Connection,
	searchToken: string,
	department: string,
	seed: EmployeeSeed
): Promise<SalaryFixtureEmployee> {
	const employeeCode = fitIdentifier(`${searchToken}-${seed.codeSuffix}`, 20);
	const firstName = 'E2E434';
	const fullName = `${firstName} ${seed.lastName}`;
	const email = `${fitIdentifier(
		`${searchToken}-${seed.codeSuffix}`,
		80
	).toLowerCase()}@e2e.invalid`;
	const id = await insertRow(
		connection,
		`INSERT INTO employees (
        employee_id, first_name, last_name, email, position, department,
        hire_date, joining_date, exit_date, status, employee_type, grade,
        designation, company_name, isDelete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'E2E', ?, 
                'Accent Techno Solutions Pvt Ltd', 0)`,
		[
			employeeCode,
			firstName,
			seed.lastName,
			email,
			seed.position,
			department,
			seed.hireDate,
			seed.joiningDate,
			seed.exitDate ?? null,
			seed.employeeType,
			seed.position,
		]
	);
	return {
		id,
		employeeCode,
		fullName,
		email,
		employeeType: seed.employeeType,
		department,
		joiningDate: seed.joiningDate,
		position: seed.position,
	};
}

async function seedAgreement(
	connection: Connection,
	input: {
		employeeId: number;
		effectiveFrom: string;
		salaryType: 'monthly' | 'contract';
		employerCost: number;
		plTotal: number;
	}
): Promise<number> {
	const daYear = Number(input.effectiveFrom.slice(0, 4));
	return insertRow(
		connection,
		`INSERT INTO employee_salary_profile (
        employee_id, employer_cost, std_hours_per_day, std_working_days,
        da_year, effective_from, effective_to, is_active, salary_type, pl_total,
        cancelled_at, cancelled_by, cancelled_reason
      ) VALUES (?, ?, 8.0, 26, ?, ?, NULL, 1, ?, ?, NULL, NULL, NULL)`,
		[
			input.employeeId,
			input.employerCost,
			daYear,
			input.effectiveFrom,
			input.salaryType,
			input.plTotal,
		]
	);
}

async function seedPayrollUse(
	connection: Connection,
	userId: number,
	employeeId: number,
	agreementId: number,
	monthDate: string
): Promise<void> {
	await connection.execute(
		`INSERT INTO employee_salary_payroll_use (
        employee_id, month, agreement_id, agreement_source, evidence,
        is_ambiguous, evidence_context, first_used_by
      ) VALUES (?, ?, ?, 'employee_salary_profile', 'payroll_generation',
                0, NULL, ?)`,
		[employeeId, monthDate, agreementId, userId]
	);
}

async function seedLoggedHours(
	connection: Connection,
	userId: number,
	employeeId: number,
	monthDate: string
): Promise<void> {
	const day = `${monthDate.slice(0, 8)}12`;
	await connection.execute(
		`INSERT INTO user_activity_assignments (
        id, user_id, employee_id, project_id, activity_name, status,
        daily_entries, start_date
      ) VALUES (?, ?, ?, NULL, ?, 'In Progress', ?, ?)`,
		[
			randomUUID(),
			userId,
			employeeId,
			`E2E434 salary fixture ${employeeId}`,
			JSON.stringify([{ date: day, hours: FIXTURE_LOGGED_HOURS }]),
			monthDate,
		]
	);
}

async function seedLeaveSummary(
	connection: Connection,
	employeeId: number,
	monthSlug: string
): Promise<void> {
	await connection.execute(
		`INSERT INTO employee_attendance_summary (
        employee_id, month, total_present, total_privilege_leave,
        total_working_hours
      ) VALUES (?, ?, 20, ?, 160)`,
		[employeeId, monthSlug, FIXTURE_PL_USED]
	);
}

async function cleanupOwnedIds(
	connection: Connection,
	owned: OwnedIds
): Promise<void> {
	await connection.beginTransaction();
	try {
		const userIds = uniqueIds(owned.userIds);
		const employeeIds = uniqueIds(owned.employeeIds);

		await deleteByIds(connection, 'sessions', 'user_id', userIds);

		if (employeeIds.length > 0) {
			const placeholders = employeeIds.map(() => '?').join(', ');
			await connection.execute(
				`DELETE FROM payroll_audit_logs
          WHERE employee_id IN (${placeholders})
             OR (entity_type = 'salary_profile'
                 AND entity_id IN (
                   SELECT id FROM employee_salary_profile
                    WHERE employee_id IN (${placeholders})
                 ))`,
				[...employeeIds, ...employeeIds]
			);
			await deleteByIds(
				connection,
				'employee_salary_payroll_use',
				'employee_id',
				employeeIds
			);
			await deleteByIds(
				connection,
				'payroll_slips',
				'employee_id',
				employeeIds
			);
			await deleteByIds(
				connection,
				'user_activity_assignments',
				'employee_id',
				employeeIds
			);
			await deleteByIds(
				connection,
				'employee_attendance',
				'employee_id',
				employeeIds
			);
			await deleteByIds(
				connection,
				'employee_attendance_summary',
				'employee_id',
				employeeIds
			);
			await deleteByIds(
				connection,
				'employee_salary_profile',
				'employee_id',
				employeeIds
			);
			await deleteByIds(
				connection,
				'employee_salary_timelines',
				'employee_id',
				employeeIds
			);
			await deleteByIds(connection, 'employees', 'id', employeeIds);
		}

		await deleteByIds(
			connection,
			'user_activity_assignments',
			'user_id',
			userIds
		);
		await deleteByIds(connection, 'users', 'id', userIds);

		if (owned.runId !== undefined) {
			await connection.execute('DELETE FROM payroll_runs WHERE id = ?', [
				owned.runId,
			]);
		}

		for (const role of owned.roleIds) {
			await connection.execute(
				`DELETE FROM roles_master
          WHERE id = ?
            AND role_name = ?
            AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = ?)`,
				[role.id, role.name, role.id]
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
	if (ids.length === 0) return;
	const placeholders = ids.map(() => '?').join(', ');
	await connection.execute(
		`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`,
		[...ids]
	);
}

/* ── read-state mapping ────────────────────────────────────────────── */

function mapAgreement(row: AgreementReadRow): SalaryAgreementRow {
	return {
		id: Number(row.id),
		employeeId: Number(row.employee_id),
		salaryType: textOrNull(row.salary_type),
		employerCost: nullableNumber(row.employer_cost),
		grossSalary: nullableNumber(row.gross_salary),
		gross: nullableNumber(row.gross),
		contractAmount: nullableNumber(row.contract_amount),
		effectiveFrom: dateOnly(row.effective_from) ?? '',
		effectiveTo: dateOnly(row.effective_to),
		isActive: Number(row.is_active),
		cancelledAt: dateTimeText(row.cancelled_at),
		cancelledBy: nullableInteger(row.cancelled_by),
		cancelledReason: textOrNull(row.cancelled_reason),
		stdHoursPerDay: nullableNumber(row.std_hours_per_day),
		stdWorkingDays: nullableInteger(row.std_working_days),
		plTotal: nullableInteger(row.pl_total),
	};
}

function mapUse(row: UseReadRow): SalaryUseRow {
	return {
		id: Number(row.id),
		employeeId: Number(row.employee_id),
		month: dateOnly(row.month),
		agreementId: nullableInteger(row.agreement_id),
		agreementSource: textOrNull(row.agreement_source),
		evidence: String(row.evidence),
		isAmbiguous: Number(row.is_ambiguous),
		firstUsedBy: nullableInteger(row.first_used_by),
	};
}

function mapAudit(row: AuditReadRow): SalaryAuditRow {
	return {
		id: Number(row.id),
		entityType: String(row.entity_type),
		entityId: Number(row.entity_id),
		employeeId: nullableInteger(row.employee_id),
		action: String(row.action),
		oldValues: parseJsonObject(row.old_values),
		newValues: parseJsonObject(row.new_values),
		performedBy: Number(row.performed_by),
		performedAt: dateTimeText(row.performed_at),
	};
}

function mapSlip(row: SlipReadRow): SalarySlipRow {
	return {
		id: Number(row.id),
		employeeId: Number(row.employee_id),
		month: dateOnly(row.month),
		gross: nullableNumber(row.gross),
		ctcUsed: nullableNumber(row.ctc_used),
		basisHours: nullableNumber(row.basis_hours),
		hourlyRate: nullableNumber(row.hourly_rate),
		loggedHours: nullableNumber(row.logged_hours),
		totalEarnings: nullableNumber(row.total_earnings),
		totalDeductions: nullableNumber(row.total_deductions),
		netPay: nullableNumber(row.net_pay),
		employerCost: nullableNumber(row.employer_cost),
		salaryProfileId: nullableInteger(row.salary_profile_id),
		salaryProfileSource: textOrNull(row.salary_profile_source),
		salaryType: textOrNull(row.salary_type),
		paymentStatus: textOrNull(row.payment_status),
	};
}

interface AgreementReadRow extends RowDataPacket {
	id: number;
	employee_id: number;
	salary_type: string | null;
	employer_cost: string | number | null;
	gross_salary: string | number | null;
	gross: string | number | null;
	contract_amount: string | number | null;
	effective_from: string;
	effective_to: string | null;
	is_active: number;
	cancelled_at: string | null;
	cancelled_by: number | null;
	cancelled_reason: string | null;
	std_hours_per_day: string | number | null;
	std_working_days: number | null;
	pl_total: number | null;
}

interface UseReadRow extends RowDataPacket {
	id: number;
	employee_id: number;
	month: string | null;
	agreement_id: number | null;
	agreement_source: string | null;
	evidence: string;
	is_ambiguous: number;
	first_used_by: number | null;
}

interface AuditReadRow extends RowDataPacket {
	id: number;
	entity_type: string;
	entity_id: number;
	employee_id: number | null;
	action: string;
	old_values: unknown;
	new_values: unknown;
	performed_by: number;
	performed_at: string | null;
}

interface SlipReadRow extends RowDataPacket {
	id: number;
	employee_id: number;
	month: string | null;
	gross: string | number | null;
	ctc_used: string | number | null;
	basis_hours: string | number | null;
	hourly_rate: string | number | null;
	logged_hours: string | number | null;
	total_earnings: string | number | null;
	total_deductions: string | number | null;
	net_pay: string | number | null;
	employer_cost: string | number | null;
	salary_profile_id: number | null;
	salary_profile_source: string | null;
	salary_type: string | null;
	payment_status: string | null;
}

interface TimelineReadRow extends RowDataPacket {
	employee_id: number;
	version: number;
}

interface LeaveReadRow extends RowDataPacket {
	id: number;
	employee_id: number;
	month: string;
	total_privilege_leave: string | number | null;
}

interface RunReadRow extends RowDataPacket {
	id: number;
	month: number;
	year: number;
	run_number: number;
	status: string;
}

interface RoleRow extends RowDataPacket {
	id: number;
	role_code: string;
	role_name: string;
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
	return candidate.errno === 1062 || candidate.code === 'ER_DUP_ENTRY';
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

function uniqueIds(values: readonly number[]): number[] {
	return [
		...new Set(values.filter((value) => Number.isInteger(value) && value > 0)),
	];
}

function isoDate(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
		2,
		'0'
	)}`;
}

function nextMonthStart(date: string): string {
	const [year, month] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
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
	return parsed.filter((entry): entry is string => typeof entry === 'string');
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
	if (value === null || value === undefined) return null;
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return null;
		}
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	return parsed as Record<string, unknown>;
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
