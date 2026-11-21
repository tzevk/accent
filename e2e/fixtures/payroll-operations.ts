/**
 * Disposable payroll-operations fixtures for the run, rates and self-service
 * Payslip browser journeys.
 *
 * Three independent seeds share the small pieces they genuinely need:
 *
 * - `seedPayrollRunFixture` owns one ordinary administrator with exactly the
 *   payroll grants the run action needs, one Employee whose Salary Profile
 *   covers only the fixture month, and a draft or finalized Payroll Run with
 *   its recorded Payroll Slip.
 * - `seedEmployeePayslipFixture` owns one employee login linked to its own
 *   Employee and one finalized month whose Payroll Slip is already paid.
 * - `seedPayrollRatesFixture` owns one administrator with payroll create on
 *   top of the read-only admin reference, plus unique effective periods for
 *   one component rate and one DA rate.
 *
 * Months are reserved inside the fixture's own 2036–2041 window, separate
 * from the payroll-review (2026–2031) and salary-profile (2032–2035) windows.
 * Each Employee's Salary Profile ends on the fixture month's last day, so a
 * parallel fixture in the same database cannot become an open-ended roster
 * candidate for another month.
 *
 * Every row is tracked by its real primary key. Cleanup deletes only what this
 * fixture created, including sessions, Payroll Roster snapshots, allocations,
 * salary-use evidence, audits and rate rows, and is safe after a partial seed.
 * Ephemeral passwords are never logged or persisted.
 */
import { createHash } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** Distinct from the ranges the payroll-review and salary-profile fixtures use. */
const FIXTURE_YEARS = [2036, 2037, 2038, 2039, 2040, 2041] as const;
const FIXTURE_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const EMPLOYEE_CODE_PREFIX = 'E2E-PO';
const RUN_REMARK_PREFIX = '[payroll-operations]';

/** The authored money the fixture stores; never produced by the calculator. */
export const PAYROLL_OPERATIONS_MONEY = {
	contractualGross: 50000,
	ctcUsed: 50000,
	basisHours: 208,
	hourlyRate: 240.38,
	loggedHours: 208,
	basic: 30000,
	daUsed: 0,
	da: 0,
	hra: 10000,
	conveyance: 5000,
	callAllowance: 5000,
	otherAllowances: 0,
	bonus: 0,
	incentive: 0,
	otRate: 0,
	totalEarnings: 50000,
	pfEmployee: 3600,
	esicEmployee: 0,
	pt: 200,
	lwf: 0,
	mlwf: 25,
	tds: 0,
	otherDeductions: 1175,
	retention: 0,
	totalDeductions: 5000,
	netPay: 45000,
	pfEmployer: 0,
	esicEmployer: 0,
	mlwfEmployer: 0,
	insurance: 0,
	gratuity: 0,
	pfAdmin: 0,
	edli: 0,
	totalEmployerContributions: 0,
	employerCost: 50000,
	standardWorkingDays: 26,
} as const;

export interface PayrollOperationsEmployee {
	employeeId: number;
	employeeCode: string;
	firstName: string;
	lastName: string;
	fullName: string;
	email: string;
	position: string;
	department: string;
	joiningDate: string;
	salaryProfileId: number;
}

export interface PayrollOperationsRun {
	id: number;
	month: string;
	monthSlug: string;
	monthEnd: string;
	year: number;
	monthNumber: number;
	status: 'draft' | 'finalized';
	paymentDate: string;
}

export interface PayrollOperationsSlip {
	id: number;
	month: string;
	paymentStatus: 'pending' | 'paid';
	paymentDate: string | null;
	totalEarnings: number;
	totalDeductions: number;
	netPay: number;
	employerCost: number;
}

interface PayrollFixtureBase {
	namespace: string;
	employee: PayrollOperationsEmployee;
	run: PayrollOperationsRun;
	slip: PayrollOperationsSlip;
	expected: {
		totalEarnings: number;
		totalDeductions: number;
		netPay: number;
		employerCost: number;
	};
	/** Delete owned sessions, users, roles and payroll rows. Idempotent. */
	dispose(): Promise<void>;
}

/** A run journey: finalize a draft month, or pay an already-finalized month. */
export interface PayrollOperationsFixture extends PayrollFixtureBase {
	operator: JourneyUser;
	employeeUser: null;
}

/** A self-service journey: the Employee owns the login linked to itself. */
export interface EmployeePayslipFixture extends PayrollFixtureBase {
	operator: null;
	employeeUser: JourneyUser;
	paymentDate: string;
}

export interface PayrollRatesFixture {
	namespace: string;
	operator: JourneyUser;
	scheduleRate: {
		componentType: 'hra_percent';
		label: 'HRA %';
		value: number;
		effectiveFrom: string;
		effectiveTo: string;
	};
	daRate: {
		amount: number;
		effectiveFrom: string;
		effectiveTo: string;
	};
	dispose(): Promise<void>;
}

export interface PayrollStoredSlipState {
	id: number;
	employeeId: number;
	month: string | null;
	paymentStatus: string | null;
	paymentDate: string | null;
	paymentReference: string | null;
	totalEarnings: number | null;
	totalDeductions: number | null;
	netPay: number | null;
	employerCost: number | null;
}

export interface PayrollStoredRosterMember {
	employee_id: number;
	employee_code: string;
	name: string;
	employment_start: string | null;
	employment_end: string | null;
	profile_date: string;
	profile_source: string;
	profile_id: number;
	salary_type: string;
}

export interface PayrollStoredRoster {
	runId: number;
	month: string | null;
	version: number;
	frozenBy: number | null;
	members: PayrollStoredRosterMember[];
}

export interface PayrollStoredUse {
	employeeId: number;
	month: string | null;
	agreementId: number | null;
	agreementSource: string | null;
	evidence: string;
}

export interface PayrollStoredAllocation {
	payrollSlipId: number;
	version: number;
	recordedEmployerCost: number;
	payStream: string;
}

export interface PayrollStoredAudit {
	entityType: string;
	entityId: number;
	action: string;
	employeeId: number | null;
	payrollRunId: number | null;
}

export interface PayrollRunState {
	run: {
		id: number;
		status: string;
		totalEmployees: number | null;
		totalGross: number | null;
		totalDeductions: number | null;
		totalNetPay: number | null;
		totalEmployerContribution: number | null;
		finalizedBy: number | null;
		finalizedAt: string | null;
	} | null;
	slips: PayrollStoredSlipState[];
	rosters: PayrollStoredRoster[];
	uses: PayrollStoredUse[];
	allocations: PayrollStoredAllocation[];
	audits: PayrollStoredAudit[];
}

export interface PayrollRateState {
	id: number;
	componentType: string;
	valueType: string;
	value: number;
	effectiveFrom: string;
	effectiveTo: string | null;
	isActive: number;
	audits: Array<{ entityId: number; action: string }>;
}

interface PayrollOwnedRows {
	runId: number | null;
	employeeId: number | null;
	salaryProfileId: number | null;
	slipId: number | null;
	operator: JourneyUser | null;
	employeeUser: JourneyUser | null;
}

interface MonthSlot {
	id: number;
	year: number;
	monthNumber: number;
	monthDate: string;
	monthEnd: string;
}

interface PayrollRunRow extends RowDataPacket {
	id: number;
	status: string;
	total_employees: number | null;
	total_gross: string | number | null;
	total_deductions: string | number | null;
	total_net_pay: string | number | null;
	total_employer_contribution: string | number | null;
	finalized_by: number | null;
	finalized_at: string | Date | null;
}

interface PayrollSlipRow extends RowDataPacket {
	id: number;
	employee_id: number;
	month: string | Date | null;
	payment_status: string | null;
	payment_date: string | Date | null;
	payment_reference: string | null;
	total_earnings: string | number | null;
	total_deductions: string | number | null;
	net_pay: string | number | null;
	employer_cost: string | number | null;
}

interface PayrollRosterRow extends RowDataPacket {
	run_id: number;
	month: string | null;
	version: number;
	frozen_by: number | null;
	members: unknown;
}

interface PayrollUseRow extends RowDataPacket {
	employee_id: number;
	month: string | null;
	agreement_id: number | null;
	agreement_source: string | null;
	evidence: string;
}

interface PayrollAllocationRow extends RowDataPacket {
	payroll_slip_id: number;
	version: number;
	recorded_employer_cost: string | number;
	pay_stream: string;
}

interface PayrollAuditRow extends RowDataPacket {
	entity_type: string;
	entity_id: number;
	action: string;
	employee_id: number | null;
	payroll_run_id: number | null;
}

interface PayrollScheduleRow extends RowDataPacket {
	id: number;
	component_type: string;
	value_type: string;
	value: string | number;
	effective_from: string;
	effective_to: string | null;
	is_active: number;
}

export interface RateDescriptor {
	componentType: string;
	value: number;
	effectiveFrom: string;
	effectiveTo: string;
}

/* ── seeds ─────────────────────────────────────────────────────────── */

/**
 * Seed one draft or finalized Payroll Run month with one eligible Employee,
 * a bounded covering Salary Profile and its recorded Payroll Slip.
 */
export async function seedPayrollRunFixture(
	connection: Connection,
	namespace: string,
	options: { status?: 'draft' | 'finalized' } = {}
): Promise<PayrollOperationsFixture> {
	const fixtureNamespace = requireNamespace(namespace);
	const status = options.status ?? 'draft';
	const owned: PayrollOwnedRows = emptyOwned();

	try {
		const operator = await createJourneyUser(
			connection,
			`${fixtureNamespace}-payroll-operator`,
			['payroll:update'],
			{ admin: true }
		);
		owned.operator = operator;

		const slot = await allocateMonth(
			connection,
			fixtureNamespace,
			status,
			operator.userId
		);
		owned.runId = slot.id;

		const employee = await seedEmployee(
			connection,
			fixtureNamespace,
			slot,
			owned
		);
		const paymentDate = slot.monthEnd;
		const slip = await seedSlip(
			connection,
			fixtureNamespace,
			slot,
			employee.employeeId,
			{ paymentStatus: 'pending', paymentDate: null }
		);

		return {
			...makeRunFixture(
				fixtureNamespace,
				employee,
				slot,
				slip,
				status,
				paymentDate,
				() => cleanupRunOwned(connection, owned)
			),
			operator,
			employeeUser: null,
		};
	} catch (error) {
		await disposeOwned(connection, owned, error);
		throw error;
	}
}

/**
 * Seed one finalized, fully paid month and the Employee login linked to its
 * Employee. The employee user holds no payroll permission: self-service is the
 * session's own identity, not an admin read.
 */
export async function seedEmployeePayslipFixture(
	connection: Connection,
	namespace: string
): Promise<EmployeePayslipFixture> {
	const fixtureNamespace = requireNamespace(namespace);
	const owned: PayrollOwnedRows = emptyOwned();

	try {
		const employeeUser = await createJourneyUser(
			connection,
			`${fixtureNamespace}-payroll-employee`,
			[]
		);
		owned.employeeUser = employeeUser;

		const slot = await allocateMonth(
			connection,
			fixtureNamespace,
			'finalized',
			null
		);
		owned.runId = slot.id;

		const employee = await seedEmployee(
			connection,
			fixtureNamespace,
			slot,
			owned
		);

		await connection.execute('UPDATE users SET employee_id = ? WHERE id = ?', [
			employee.employeeId,
			employeeUser.userId,
		]);

		const paymentDate = slot.monthEnd;
		const slip = await seedSlip(
			connection,
			fixtureNamespace,
			slot,
			employee.employeeId,
			{ paymentStatus: 'paid', paymentDate }
		);

		return {
			...makeRunFixture(
				fixtureNamespace,
				employee,
				slot,
				slip,
				'finalized',
				paymentDate,
				() => cleanupRunOwned(connection, owned)
			),
			operator: null,
			employeeUser,
			paymentDate,
		};
	} catch (error) {
		await disposeOwned(connection, owned, error);
		throw error;
	}
}

/**
 * Seed the Component/DA rate operator and two unique effective periods. The
 * rows themselves are created through the browser, so cleanup finds them by
 * the exact period and value.
 */
export async function seedPayrollRatesFixture(
	connection: Connection,
	namespace: string
): Promise<PayrollRatesFixture> {
	const fixtureNamespace = requireNamespace(namespace);
	const operator = await createJourneyUser(
		connection,
		`${fixtureNamespace}-payroll-rates`,
		['payroll:create'],
		{ admin: true }
	);

	const schedulePeriod = ratePeriod(`${fixtureNamespace}:schedule`, 0);
	const daPeriod = ratePeriod(`${fixtureNamespace}:da`, 160);
	const scheduleRate: PayrollRatesFixture['scheduleRate'] = {
		componentType: 'hra_percent',
		label: 'HRA %',
		value: 12.5,
		effectiveFrom: schedulePeriod.from,
		effectiveTo: schedulePeriod.to,
	};
	const daRate: PayrollRatesFixture['daRate'] = {
		amount: 4321,
		effectiveFrom: daPeriod.from,
		effectiveTo: daPeriod.to,
	};

	let disposed = false;
	return {
		namespace: fixtureNamespace,
		operator,
		scheduleRate,
		daRate,
		async dispose(): Promise<void> {
			if (disposed) return;
			const descriptors: RateDescriptor[] = [
				{
					componentType: scheduleRate.componentType,
					value: scheduleRate.value,
					effectiveFrom: scheduleRate.effectiveFrom,
					effectiveTo: scheduleRate.effectiveTo,
				},
				{
					componentType: 'da',
					value: daRate.amount,
					effectiveFrom: daRate.effectiveFrom,
					effectiveTo: daRate.effectiveTo,
				},
			];
			await cleanupOwnedRates(connection, descriptors);
			await operator.dispose();
			disposed = true;
		},
	};
}

/* ── independent persisted reads ───────────────────────────────────── */

/** Read the owned run, its slips, roster snapshots, uses, allocations and audits. */
export async function readPayrollRunState(
	connection: Connection,
	fixture: PayrollFixtureBase
): Promise<PayrollRunState> {
	const [runRows] = await connection.execute<PayrollRunRow[]>(
		`SELECT id, status, total_employees, total_gross, total_deductions,
            total_net_pay, total_employer_contribution, finalized_by, finalized_at
       FROM payroll_runs
      WHERE id = ?
      LIMIT 1`,
		[fixture.run.id]
	);
	const [slipRows] = await connection.execute<PayrollSlipRow[]>(
		`SELECT id, employee_id, month, payment_status, payment_date,
            payment_reference, total_earnings, total_deductions, net_pay,
            employer_cost
       FROM payroll_slips
      WHERE id = ?
      LIMIT 1`,
		[fixture.slip.id]
	);
	const [rosterRows] = await connection.execute<PayrollRosterRow[]>(
		`SELECT run_id, month, version, frozen_by, members
       FROM payroll_run_rosters
      WHERE run_id = ? AND isDelete = 0
      ORDER BY version`,
		[fixture.run.id]
	);
	const [useRows] = await connection.execute<PayrollUseRow[]>(
		`SELECT employee_id, month, agreement_id, agreement_source, evidence
       FROM employee_salary_payroll_use
      WHERE employee_id = ?
      ORDER BY id`,
		[fixture.employee.employeeId]
	);
	const [allocationRows] = await connection.execute<PayrollAllocationRow[]>(
		`SELECT payroll_slip_id, version, recorded_employer_cost, pay_stream
       FROM payroll_employee_allocations
      WHERE payroll_slip_id = ?
      ORDER BY version`,
		[fixture.slip.id]
	);
	const [auditRows] = await connection.execute<PayrollAuditRow[]>(
		`SELECT entity_type, entity_id, action, employee_id, payroll_run_id
       FROM payroll_audit_logs
      WHERE payroll_run_id = ? OR employee_id = ?
      ORDER BY id`,
		[fixture.run.id, fixture.employee.employeeId]
	);

	const run = runRows[0];
	return {
		run: run
			? {
					id: Number(run.id),
					status: String(run.status),
					totalEmployees: nullableInteger(run.total_employees),
					totalGross: nullableNumber(run.total_gross),
					totalDeductions: nullableNumber(run.total_deductions),
					totalNetPay: nullableNumber(run.total_net_pay),
					totalEmployerContribution: nullableNumber(
						run.total_employer_contribution
					),
					finalizedBy: nullableInteger(run.finalized_by),
					finalizedAt: textOrNull(run.finalized_at),
				}
			: null,
		slips: slipRows.map((row) => ({
			id: Number(row.id),
			employeeId: Number(row.employee_id),
			month: dateOnly(row.month),
			paymentStatus: textOrNull(row.payment_status),
			paymentDate: dateOnly(row.payment_date),
			paymentReference: textOrNull(row.payment_reference),
			totalEarnings: nullableNumber(row.total_earnings),
			totalDeductions: nullableNumber(row.total_deductions),
			netPay: nullableNumber(row.net_pay),
			employerCost: nullableNumber(row.employer_cost),
		})),
		rosters: rosterRows.map((row) => ({
			runId: Number(row.run_id),
			month: dateOnly(row.month),
			version: Number(row.version),
			frozenBy: nullableInteger(row.frozen_by),
			members: parseRosterMembers(row.members),
		})),
		uses: useRows.map((row) => ({
			employeeId: Number(row.employee_id),
			month: dateOnly(row.month),
			agreementId: nullableInteger(row.agreement_id),
			agreementSource: textOrNull(row.agreement_source),
			evidence: String(row.evidence),
		})),
		allocations: allocationRows.map((row) => ({
			payrollSlipId: Number(row.payroll_slip_id),
			version: Number(row.version),
			recordedEmployerCost: Number(row.recorded_employer_cost),
			payStream: String(row.pay_stream),
		})),
		audits: auditRows.map((row) => ({
			entityType: String(row.entity_type),
			entityId: Number(row.entity_id),
			action: String(row.action),
			employeeId: nullableInteger(row.employee_id),
			payrollRunId: nullableInteger(row.payroll_run_id),
		})),
	};
}

/**
 * Read the one persisted rate row matching the authored period and value, with
 * its Component Rate audit entries. A missing row is null, never an exception.
 */
export async function readPayrollRateState(
	connection: Connection,
	descriptor: RateDescriptor
): Promise<PayrollRateState | null> {
	const [rows] = await connection.execute<PayrollScheduleRow[]>(
		`SELECT id, component_type, value_type, value, effective_from,
            effective_to, is_active
       FROM payroll_schedules
      WHERE component_type = ?
        AND value = ?
        AND effective_from = ?
        AND effective_to = ?
      ORDER BY id
      LIMIT 1`,
		[
			descriptor.componentType,
			descriptor.value,
			descriptor.effectiveFrom,
			descriptor.effectiveTo,
		]
	);
	const row = rows[0];
	if (!row) return null;
	const [auditRows] = await connection.execute<PayrollAuditRow[]>(
		`SELECT entity_type, entity_id, action, employee_id, payroll_run_id
       FROM payroll_audit_logs
      WHERE entity_type = 'component_rate' AND entity_id = ?
      ORDER BY id`,
		[row.id]
	);
	return {
		id: Number(row.id),
		componentType: String(row.component_type),
		valueType: String(row.value_type),
		value: Number(row.value),
		effectiveFrom: String(row.effective_from),
		effectiveTo: dateOnly(row.effective_to),
		isActive: Number(row.is_active),
		audits: auditRows.map((audit) => ({
			entityId: Number(audit.entity_id),
			action: String(audit.action),
		})),
	};
}

/* ── seed internals ────────────────────────────────────────────────── */

function makeRunFixture(
	namespace: string,
	employee: PayrollOperationsEmployee,
	slot: MonthSlot,
	slip: PayrollOperationsSlip,
	status: 'draft' | 'finalized',
	paymentDate: string,
	dispose: () => Promise<void>
): PayrollFixtureBase {
	let disposed = false;
	return {
		namespace,
		employee,
		run: {
			id: slot.id,
			month: slot.monthDate,
			monthSlug: slot.monthDate.slice(0, 7),
			monthEnd: slot.monthEnd,
			year: slot.year,
			monthNumber: slot.monthNumber,
			status,
			paymentDate,
		},
		slip,
		expected: {
			totalEarnings: PAYROLL_OPERATIONS_MONEY.totalEarnings,
			totalDeductions: PAYROLL_OPERATIONS_MONEY.totalDeductions,
			netPay: PAYROLL_OPERATIONS_MONEY.netPay,
			employerCost: PAYROLL_OPERATIONS_MONEY.employerCost,
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			await dispose();
			disposed = true;
		},
	};
}

async function allocateMonth(
	connection: Connection,
	namespace: string,
	status: 'draft' | 'finalized',
	finalizedBy: number | null
): Promise<MonthSlot> {
	const slots = fixtureMonthSlots(namespace);
	const totals =
		status === 'finalized'
			? {
					employees: 1,
					gross: PAYROLL_OPERATIONS_MONEY.totalEarnings,
					deductions: PAYROLL_OPERATIONS_MONEY.totalDeductions,
					net: PAYROLL_OPERATIONS_MONEY.netPay,
				}
			: { employees: 0, gross: 0, deductions: 0, net: 0 };

	for (const slot of slots) {
		try {
			const [result] = await connection.execute<ResultSetHeader>(
				`INSERT INTO payroll_runs (
            month, year, run_number, status, total_employees, total_gross,
            total_deductions, total_net_pay, total_employer_contribution,
            finalized_by, finalized_at, remarks
          ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
				[
					slot.monthNumber,
					slot.year,
					status,
					totals.employees,
					totals.gross,
					totals.deductions,
					totals.net,
					status === 'finalized' ? finalizedBy : null,
					status === 'finalized' ? new Date() : null,
					`${RUN_REMARK_PREFIX} ${namespace} disposable fixture`,
				]
			);
			return { ...slot, id: Number(result.insertId) };
		} catch (error) {
			if (isDuplicateKey(error)) continue;
			throw error;
		}
	}
	throw new Error(
		`[payroll-operations] no free fixture month is available for ${namespace}.`
	);
}

async function seedEmployee(
	connection: Connection,
	namespace: string,
	slot: MonthSlot,
	owned: PayrollOwnedRows
): Promise<PayrollOperationsEmployee> {
	const key = sha256(namespace).slice(0, 8);
	const employeeCode = fitIdentifier(`${EMPLOYEE_CODE_PREFIX}-${key}`, 20);
	const firstName = 'E2E';
	const lastName = fitIdentifier(`PayOps-${key.slice(0, 4)}`, 30);
	const fullName = `${firstName} ${lastName}`;
	const email = `${fitIdentifier(
		`${namespace}-employee`,
		80
	).toLowerCase()}@e2e.invalid`;
	const position = 'Payroll Operations Analyst';
	const department = 'Finance';

	const [employeeResult] = await connection.execute<ResultSetHeader>(
		`INSERT INTO employees (
        employee_id, first_name, last_name, email, position, department,
        hire_date, joining_date, exit_date, status, employee_type, grade,
        designation, company_name, isDelete
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', 'E2E', 'E2E', ?, 
                'Accent Techno Solutions Pvt Ltd', 0)`,
		[
			employeeCode,
			firstName,
			lastName,
			email,
			position,
			department,
			slot.monthDate,
			slot.monthDate,
			position,
		]
	);
	const employeeId = Number(employeeResult.insertId);
	owned.employeeId = employeeId;

	const money = PAYROLL_OPERATIONS_MONEY;
	const [profileResult] = await connection.execute<ResultSetHeader>(
		`INSERT INTO employee_salary_profile (
        employee_id, gross, gross_salary, effective_from, effective_to,
        is_active, salary_type, basic, da, basic_plus_da, hra, conveyance,
        call_allowance, other_allowances, pf_employee, esic_employee,
        pf_employer, esic_employer, total_earnings, total_deductions,
        net_pay, employer_cost, pt, mlwf, retention, bonus, incentive,
        std_hours_per_day, std_working_days, da_year
      ) VALUES (?, ?, ?, ?, ?, 1, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 8.0, 26, ?)`,
		[
			employeeId,
			money.contractualGross,
			money.contractualGross,
			slot.monthDate,
			slot.monthEnd,
			money.basic,
			money.da,
			money.basic + money.da,
			money.hra,
			money.conveyance,
			money.callAllowance,
			money.otherAllowances,
			money.pfEmployee,
			money.esicEmployee,
			money.pfEmployer,
			money.esicEmployer,
			money.totalEarnings,
			money.totalDeductions,
			money.netPay,
			money.employerCost,
			money.pt,
			money.mlwf,
			money.retention,
			money.bonus,
			money.incentive,
			slot.year,
		]
	);
	const salaryProfileId = Number(profileResult.insertId);
	owned.salaryProfileId = salaryProfileId;

	return {
		employeeId,
		employeeCode,
		firstName,
		lastName,
		fullName,
		email,
		position,
		department,
		joiningDate: slot.monthDate,
		salaryProfileId,
	};
}

async function seedSlip(
	connection: Connection,
	namespace: string,
	slot: MonthSlot,
	employeeId: number,
	payment: {
		paymentStatus: 'pending' | 'paid';
		paymentDate: string | null;
	}
): Promise<PayrollOperationsSlip> {
	const money = PAYROLL_OPERATIONS_MONEY;
	const [result] = await connection.execute<ResultSetHeader>(
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
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			slot.monthDate,
			employeeId,
			money.contractualGross,
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
			money.standardWorkingDays,
			money.standardWorkingDays,
			0,
			0,
			money.standardWorkingDays,
			0,
			0,
			0,
			money.contractualGross,
			21,
			0,
			21,
			payment.paymentStatus,
			payment.paymentDate,
			null,
			`${RUN_REMARK_PREFIX} ${namespace} disposable fixture`,
		]
	);
	const slipId = Number(result.insertId);
	return {
		id: slipId,
		month: slot.monthDate,
		paymentStatus: payment.paymentStatus,
		paymentDate: payment.paymentDate,
		totalEarnings: money.totalEarnings,
		totalDeductions: money.totalDeductions,
		netPay: money.netPay,
		employerCost: money.employerCost,
	};
}

/* ── cleanup ───────────────────────────────────────────────────────── */

function emptyOwned(): PayrollOwnedRows {
	return {
		runId: null,
		employeeId: null,
		salaryProfileId: null,
		slipId: null,
		operator: null,
		employeeUser: null,
	};
}

async function disposeOwned(
	connection: Connection,
	owned: PayrollOwnedRows,
	originalError: unknown
): Promise<void> {
	try {
		await owned.operator?.dispose();
		await owned.employeeUser?.dispose();
		await cleanupPayrollRows(connection, owned);
	} catch (cleanupError) {
		const original =
			originalError instanceof Error
				? originalError.message
				: String(originalError);
		const cleanup =
			cleanupError instanceof Error
				? cleanupError.message
				: String(cleanupError);
		throw new Error(
			`${original}; payroll-operations fixture cleanup also failed: ${cleanup}`
		);
	}
}

async function cleanupRunOwned(
	connection: Connection,
	owned: PayrollOwnedRows
): Promise<void> {
	await owned.operator?.dispose();
	await owned.employeeUser?.dispose();
	await cleanupPayrollRows(connection, owned);
}

async function cleanupPayrollRows(
	connection: Connection,
	owned: PayrollOwnedRows
): Promise<void> {
	await connection.beginTransaction();
	try {
		if (owned.runId !== null) {
			await connection.execute(
				'DELETE FROM payroll_run_rosters WHERE run_id = ?',
				[owned.runId]
			);
		}
		if (owned.slipId !== null) {
			await connection.execute(
				`DELETE FROM payroll_employee_allocation_events
          WHERE source_table = 'payroll_slips' AND source_id = ?`,
				[owned.slipId]
			);
			await connection.execute(
				`DELETE FROM payroll_employee_allocation_shares
          WHERE allocation_id IN (
            SELECT id FROM payroll_employee_allocations WHERE payroll_slip_id = ?
          )`,
				[owned.slipId]
			);
			await connection.execute(
				'DELETE FROM payroll_employee_allocations WHERE payroll_slip_id = ?',
				[owned.slipId]
			);
		}

		await deleteOwnedAudits(connection, owned);

		if (owned.employeeId !== null) {
			await connection.execute(
				'DELETE FROM employee_salary_payroll_use WHERE employee_id = ?',
				[owned.employeeId]
			);
			await connection.execute(
				'DELETE FROM employee_salary_timelines WHERE employee_id = ?',
				[owned.employeeId]
			);
			await connection.execute(
				'DELETE FROM employee_salary_profile WHERE employee_id = ?',
				[owned.employeeId]
			);
		}
		if (owned.slipId !== null) {
			await connection.execute('DELETE FROM payroll_slips WHERE id = ?', [
				owned.slipId,
			]);
		}
		if (owned.employeeId !== null) {
			await connection.execute('DELETE FROM employees WHERE id = ?', [
				owned.employeeId,
			]);
		}
		if (owned.runId !== null) {
			await connection.execute('DELETE FROM payroll_runs WHERE id = ?', [
				owned.runId,
			]);
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

async function deleteOwnedAudits(
	connection: Connection,
	owned: PayrollOwnedRows
): Promise<void> {
	const clauses: string[] = [];
	const params: Array<string | number> = [];
	if (owned.runId !== null) {
		clauses.push('payroll_run_id = ?');
		params.push(owned.runId);
		clauses.push(`(entity_type = 'payroll_run' AND entity_id = ?)`);
		params.push(owned.runId);
	}
	if (owned.employeeId !== null) {
		clauses.push('employee_id = ?');
		params.push(owned.employeeId);
	}
	if (owned.slipId !== null) {
		clauses.push(`(entity_type = 'payroll_slip' AND entity_id = ?)`);
		params.push(owned.slipId);
	}
	if (clauses.length === 0) return;
	await connection.execute(
		`DELETE FROM payroll_audit_logs WHERE ${clauses.join(' OR ')}`,
		params
	);
}

async function cleanupOwnedRates(
	connection: Connection,
	descriptors: readonly RateDescriptor[]
): Promise<void> {
	const ownedIds: number[] = [];
	for (const descriptor of descriptors) {
		const [rows] = await connection.execute<PayrollScheduleRow[]>(
			`SELECT id, component_type, value_type, value, effective_from,
              effective_to, is_active
         FROM payroll_schedules
        WHERE component_type = ?
          AND value = ?
          AND effective_from = ?
          AND effective_to = ?`,
			[
				descriptor.componentType,
				descriptor.value,
				descriptor.effectiveFrom,
				descriptor.effectiveTo,
			]
		);
		for (const row of rows) ownedIds.push(Number(row.id));
	}
	if (ownedIds.length === 0) return;

	const placeholders = ownedIds.map(() => '?').join(', ');
	await connection.beginTransaction();
	try {
		await connection.execute(
			`DELETE FROM payroll_audit_logs
        WHERE entity_type = 'component_rate'
          AND entity_id IN (${placeholders})`,
			ownedIds
		);
		await connection.execute(
			`DELETE FROM payroll_schedules WHERE id IN (${placeholders})`,
			ownedIds
		);
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

/* ── date and small helpers ────────────────────────────────────────── */

function fixtureMonthSlots(namespace: string): MonthSlot[] {
	const all: Array<{ year: number; monthNumber: number }> = [];
	for (const year of FIXTURE_YEARS) {
		for (const monthNumber of FIXTURE_MONTHS) {
			all.push({ year, monthNumber });
		}
	}
	const offset = Number.parseInt(sha256(`${namespace}:month`).slice(0, 8), 16);
	return all.map((_slot, index) => {
		const { year, monthNumber } = all[(offset + index) % all.length];
		const monthDate = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
		const monthEnd = `${year}-${String(monthNumber).padStart(2, '0')}-${String(
			daysInMonth(year, monthNumber)
		).padStart(2, '0')}`;
		return { id: 0, year, monthNumber, monthDate, monthEnd };
	});
}

function ratePeriod(
	seed: string,
	extraDays: number
): { from: string; to: string } {
	const hash = Number.parseInt(sha256(seed).slice(0, 8), 16);
	const start = new Date(Date.UTC(2090, 0, 1));
	start.setUTCDate(start.getUTCDate() + (hash % 300) + extraDays);
	const end = new Date(start);
	end.setUTCDate(end.getUTCDate() + 30);
	return {
		from: start.toISOString().slice(0, 10),
		to: end.toISOString().slice(0, 10),
	};
}

function daysInMonth(year: number, month: number): number {
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
		month - 1
	];
}

function parseRosterMembers(value: unknown): PayrollStoredRosterMember[] {
	let parsed: unknown = value;
	if (Buffer.isBuffer(parsed)) {
		parsed = JSON.parse(parsed.toString('utf8'));
	} else if (typeof parsed === 'string') {
		parsed = JSON.parse(parsed);
	}
	if (!Array.isArray(parsed)) {
		throw new Error(
			'[payroll-operations] roster snapshot members is not an array.'
		);
	}
	return parsed.map((member, index) => {
		if (
			typeof member !== 'object' ||
			member === null ||
			Array.isArray(member)
		) {
			throw new Error(
				`[payroll-operations] roster member ${index} is not an object.`
			);
		}
		const row = member as Record<string, unknown>;
		return {
			employee_id: Number(row.employee_id),
			employee_code: String(row.employee_code),
			name: String(row.name),
			employment_start: textOrNull(row.employment_start),
			employment_end: textOrNull(row.employment_end),
			profile_date: String(row.profile_date),
			profile_source: String(row.profile_source),
			profile_id: Number(row.profile_id),
			salary_type: String(row.salary_type),
		};
	});
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function requireNamespace(namespace: string): string {
	const trimmed = namespace.trim();
	if (!trimmed) {
		throw new Error('[payroll-operations] namespace must not be empty.');
	}
	return trimmed;
}

function isDuplicateKey(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const candidate = error as { code?: unknown; errno?: unknown };
	return candidate.code === 'ER_DUP_ENTRY' || Number(candidate.errno) === 1062;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function nullableInteger(value: unknown): number | null {
	const number = nullableNumber(value);
	return number !== null && Number.isInteger(number) ? number : null;
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date)
		return value.toISOString().slice(0, 19).replace('T', ' ');
	const text = String(value).trim();
	return text === '' ? null : text;
}

function dateOnly(value: unknown): string | null {
	const text = textOrNull(value);
	if (text === null) return null;
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
	return match ? match[1] : null;
}
