/**
 * Disposable actor/Employee/Payroll-Run fixtures for issue #446.
 *
 * The fixture owns one ordinary (non-super-admin, role-less) actor and one
 * Employee inside the harness-created database. It never edits shared roles,
 * the payroll-review administrator, or any operational record. Every row is
 * tracked by primary key and removed by the matching cleanup; the harness
 * still drops the whole disposable database afterwards.
 */
import { createHash } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../../scripts/e2e/contracts.ts';

const FIXTURE_YEARS = [2026, 2027, 2028, 2029, 2030, 2031] as const;
const FIXTURE_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const EMPLOYMENT_START = '2020-01-01';
const TRIGGER_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface SalaryContentionFixture {
	readonly namespace: string;
	readonly key: string;
	readonly actorId: number;
	readonly employeeId: number;
	readonly employeeCode: string;
	/** Created by allocateDraftRun(); removed by cleanup. */
	readonly runIds: number[];
	/** Owned database triggers, dropped before the rows they guard. */
	readonly triggerNames: string[];
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function contentionKey(namespace: string, testTitle: string): string {
	const slug = testTitle
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 32);
	return fitIdentifier(`${namespace}-${slug}`, 64);
}

function duplicateKey(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ER_DUP_ENTRY'
	);
}

function insertId(result: ResultSetHeader): number {
	const id = Number(result.insertId);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error('[salary-contention] fixture insert returned no id');
	}
	return id;
}

/** `YYYY-MM-01` shifted by whole months, using UTC calendar arithmetic. */
export function addMonths(monthStart: string, delta: number): string {
	const match = /^(\d{4})-(\d{2})-01$/.exec(monthStart);
	if (!match) {
		throw new Error(
			`[salary-contention] expected a YYYY-MM-01 month, got ${monthStart}`
		);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
	return `${shifted.getUTCFullYear()}-${String(
		shifted.getUTCMonth() + 1
	).padStart(2, '0')}-01`;
}

/** The day before the supplied month starts, the predecessor's range end. */
export function dayBeforeMonth(monthStart: string): string {
	const match = /^(\d{4})-(\d{2})-01$/.exec(monthStart);
	if (!match) {
		throw new Error(
			`[salary-contention] expected a YYYY-MM-01 month, got ${monthStart}`
		);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const lastDay = new Date(Date.UTC(year, month - 1, 0));
	return `${lastDay.getUTCFullYear()}-${String(
		lastDay.getUTCMonth() + 1
	).padStart(2, '0')}-${String(lastDay.getUTCDate()).padStart(2, '0')}`;
}

/** A trusted command date inside the supplied month. */
export function commandDate(monthStart: string): string {
	return `${monthStart.slice(0, 7)}-15`;
}

function monthCandidates(key: string): string[] {
	const slots: string[] = [];
	for (const year of FIXTURE_YEARS) {
		for (const month of FIXTURE_MONTHS) {
			slots.push(`${year}-${String(month).padStart(2, '0')}-01`);
		}
	}
	const start = Number.parseInt(sha256(key).slice(0, 8), 16) % slots.length;
	return slots.slice(start).concat(slots.slice(0, start));
}

/** Seed one actor and one Employee; a failed seed removes what it created. */
export async function seedSalaryContentionFixture(
	connection: Connection,
	key: string
): Promise<SalaryContentionFixture> {
	const digest = sha256(key).slice(0, 10);
	const employeeCode = fitIdentifier(`SAL446-${digest}`, 20);
	const username = fitIdentifier(`SAL446-${digest}`, 50);
	const email = `${fitIdentifier(`sal446-${digest}`, 80)}@e2e.invalid`;

	let actorId: number | null = null;
	let employeeId: number | null = null;
	try {
		const [actor] = await connection.execute<ResultSetHeader>(
			`INSERT INTO users (
        username, password_hash, email, full_name, status, permissions,
        is_active, isDelete, is_super_admin, account_type
      ) VALUES (?, ?, ?, ?, 'active', '[]', 1, 0, 0, 'employee')`,
			[
				username,
				'salary-contention-no-login',
				email,
				`E2E Salary Contention ${digest}`,
			]
		);
		actorId = insertId(actor);

		const [employee] = await connection.execute<ResultSetHeader>(
			`INSERT INTO employees (
        employee_id, first_name, last_name, email, department, position,
        hire_date, joining_date, exit_date, status, employee_type, isDelete
      ) VALUES (?, 'E2E', ?, ?, 'Payroll QA', 'Salary Contention',
                ?, ?, NULL, 'active', 'Payroll', 0)`,
			[
				employeeCode,
				`Contention-${digest.slice(0, 4)}`,
				`${employeeCode.toLowerCase()}@e2e.invalid`,
				EMPLOYMENT_START,
				EMPLOYMENT_START,
			]
		);
		employeeId = insertId(employee);

		return {
			namespace: key,
			key,
			actorId,
			employeeId,
			employeeCode,
			runIds: [],
			triggerNames: [],
		};
	} catch (error) {
		if (employeeId !== null) {
			await connection.execute('DELETE FROM employees WHERE id = ?', [
				employeeId,
			]);
		}
		if (actorId !== null) {
			await connection.execute('DELETE FROM users WHERE id = ?', [actorId]);
		}
		throw error;
	}
}

/**
 * Claim a free Payroll Run month for this fixture. Parallel workers each probe
 * the same deterministic slot list; the unique `(month, year, run_number)` key
 * hands them different months instead of sharing one mutable run.
 */
export async function allocateDraftRun(
	connection: Connection,
	fixture: SalaryContentionFixture
): Promise<string> {
	for (const monthStart of monthCandidates(fixture.key)) {
		const year = Number(monthStart.slice(0, 4));
		const month = Number(monthStart.slice(5, 7));
		try {
			const [result] = await connection.execute<ResultSetHeader>(
				`INSERT INTO payroll_runs (
          month, year, run_number, status, total_employees, total_gross,
          total_deductions, total_net_pay, total_employer_contribution, remarks
        ) VALUES (?, ?, 1, 'draft', 0, 0, 0, 0, 0, ?)`,
				[month, year, `[salary-contention ${fixture.namespace}]`]
			);
			fixture.runIds.push(insertId(result));
			return monthStart;
		} catch (error) {
			if (duplicateKey(error)) continue;
			throw error;
		}
	}
	throw new Error(
		`[salary-contention] no free Payroll Run month for ${fixture.namespace}`
	);
}

/** Insert the read-only legacy agreement used by the onboarding invariant. */
export async function insertLegacyAgreement(
	connection: Connection,
	fixture: SalaryContentionFixture,
	effectiveFrom: string,
	ctc: number
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO salary_structures (
      employee_id, version, effective_from, effective_to, is_active, pay_type,
      ctc, gross_salary, basic_salary, standard_working_days,
      standard_hours_per_day, remarks
    ) VALUES (?, 1, ?, NULL, 1, 'monthly', ?, ?, ?, 26, 8.00, ?)`,
		[
			fixture.employeeId,
			effectiveFrom,
			ctc,
			ctc,
			ctc,
			`[salary-contention ${fixture.namespace}] legacy fixture`,
		]
	);
	return insertId(result);
}

/**
 * Install a real database refusal for one owned Employee. The trigger is the
 * fault, not an application hook: the command/generation code sees an ordinary
 * MariaDB INSERT error and its caller must roll the transaction back.
 */
export async function installFailureTrigger(
	connection: Connection,
	fixture: SalaryContentionFixture,
	table: 'payroll_audit_logs' | 'employee_salary_payroll_use',
	label: string
): Promise<string> {
	const name = fitIdentifier(`SAL446-${fixture.key}-${label}`, 64);
	if (!TRIGGER_PATTERN.test(name)) {
		throw new Error(`[salary-contention] unsafe trigger name ${name}`);
	}
	await connection.query(`DROP TRIGGER IF EXISTS \`${name}\``);
	await connection.query(
		`CREATE TRIGGER \`${name}\` BEFORE INSERT ON \`${table}\`
         FOR EACH ROW
         BEGIN
           IF NEW.employee_id = ${fixture.employeeId} THEN
             SIGNAL SQLSTATE '45000'
               SET MESSAGE_TEXT = 'owned salary-contention ${label} failure';
           END IF;
         END`
	);
	fixture.triggerNames.push(name);
	return name;
}

export async function dropFailureTrigger(
	connection: Connection,
	fixture: SalaryContentionFixture,
	name: string
): Promise<void> {
	await connection.query(`DROP TRIGGER IF EXISTS \`${name}\``);
	const index = fixture.triggerNames.indexOf(name);
	if (index >= 0) fixture.triggerNames.splice(index, 1);
}

/** Remove only this fixture's rows and owned triggers. */
export async function cleanupSalaryContentionFixture(
	connection: Connection,
	fixture: SalaryContentionFixture
): Promise<void> {
	const errors: string[] = [];
	for (const name of [...fixture.triggerNames].reverse()) {
		if (!TRIGGER_PATTERN.test(name)) continue;
		try {
			await connection.query(`DROP TRIGGER IF EXISTS \`${name}\``);
		} catch (error) {
			errors.push(`dropping trigger ${name}: ${String(error)}`);
		}
	}
	fixture.triggerNames.length = 0;

	const statements: Array<[string, number[]]> = [
		[
			'DELETE FROM employee_salary_payroll_use WHERE employee_id = ?',
			[fixture.employeeId],
		],
		[
			'DELETE FROM payroll_audit_logs WHERE employee_id = ?',
			[fixture.employeeId],
		],
		[
			'DELETE FROM employee_salary_timelines WHERE employee_id = ?',
			[fixture.employeeId],
		],
		[
			'DELETE FROM employee_salary_profile WHERE employee_id = ?',
			[fixture.employeeId],
		],
		[
			'DELETE FROM salary_structures WHERE employee_id = ?',
			[fixture.employeeId],
		],
		['DELETE FROM payroll_slips WHERE employee_id = ?', [fixture.employeeId]],
	];
	for (const runId of fixture.runIds) {
		statements.push(['DELETE FROM payroll_runs WHERE id = ?', [runId]]);
	}
	statements.push(['DELETE FROM employees WHERE id = ?', [fixture.employeeId]]);
	statements.push(['DELETE FROM users WHERE id = ?', [fixture.actorId]]);

	for (const [sql, params] of statements) {
		try {
			await connection.execute(sql, params);
		} catch (error) {
			errors.push(`${sql}: ${String(error)}`);
		}
	}
	fixture.runIds.length = 0;
	if (errors.length > 0) {
		throw new Error(
			`[salary-contention] cleanup failed for ${fixture.namespace}:\n- ${errors.join(
				'\n- '
			)}`
		);
	}
}

/** Read the legacy row still present after canonical onboarding. */
export async function readLegacyAgreement(
	connection: Connection,
	employeeId: number
): Promise<RowDataPacket | null> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT id, employee_id, effective_from, effective_to, is_active, ctc
       FROM salary_structures
      WHERE employee_id = ?
      ORDER BY id`,
		[employeeId]
	);
	return rows[0] ?? null;
}
