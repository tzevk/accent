/**
 * Typed wrappers around the real salary command/generation/store Interfaces.
 *
 * The command core and generation seam both take the caller-owned connection.
 * These helpers only begin/commit/rollback the caller's transaction and read
 * committed state through a separate connection; no pricing, locking or use
 * recording is reimplemented here.
 */
import { expect } from '@playwright/test';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import {
	runSalaryCommand,
	type SalaryCommandContext,
	type SalaryCommandDb,
	type SalaryCommandFailure,
	type SalaryCommandInput,
	type SalaryCommandOutcome,
	type SalaryCommandSuccess,
} from '@/lib/salary-profile-commands';
import { recordSalaryAgreementUse } from '@/lib/salary-profile-store';
import { beginSalaryWriteTransaction } from '@/lib/salary-write-isolation';
import { generatePayrollSlip } from '@/utils/payroll-calculator.js';
import { assertSalaryWriteIsolation } from './database.ts';

/** The exported JS seam takes a month string; the package has no TS declaration. */
const generatePayrollSlipSeam = generatePayrollSlip as unknown as (
	employeeId: number,
	month: string,
	options: {
		db: Connection;
		payrollRunId?: number;
		actorId?: number;
	}
) => Promise<unknown>;

export function salaryCommandDb(connection: Connection): SalaryCommandDb {
	return connection as unknown as SalaryCommandDb;
}

export async function runSalaryCommandOn(
	connection: Connection,
	input: SalaryCommandInput,
	context: SalaryCommandContext
): Promise<SalaryCommandOutcome> {
	const outcome = await runSalaryCommand(
		salaryCommandDb(connection),
		input,
		context
	);
	// The caller has not committed yet. A successful command has written, so a
	// visible INNODB_TRX row must report READ COMMITTED; a business conflict
	// writes nothing and only proves the caller's transaction is still open.
	await assertSalaryWriteIsolation(
		connection,
		`salary ${String(input.operation)} command`
	);
	return outcome;
}

/** Run one command in its own transaction, committing both success and conflict. */
export async function runCommittedCommand(
	connection: Connection,
	input: SalaryCommandInput,
	context: SalaryCommandContext
): Promise<SalaryCommandOutcome> {
	await beginSalaryWriteTransaction(connection);
	try {
		const outcome = await runSalaryCommandOn(connection, input, context);
		await connection.commit();
		return outcome;
	} catch (error) {
		await connection.rollback().catch(() => undefined);
		throw error;
	}
}

export function expectCommandOk(
	outcome: SalaryCommandOutcome
): SalaryCommandSuccess {
	expect(outcome.ok).toBe(true);
	if (!outcome.ok) {
		throw new Error(
			`[salary-contention] expected a successful command, got ${outcome.code}: ${outcome.message}`
		);
	}
	return outcome;
}

export function expectCommandFailure(
	outcome: SalaryCommandOutcome,
	code: SalaryCommandFailure['code']
): SalaryCommandFailure {
	expect(outcome.ok).toBe(false);
	if (outcome.ok) {
		throw new Error(
			`[salary-contention] expected command failure ${code}, got success for agreement ${outcome.agreement_id}`
		);
	}
	expect(outcome.code).toBe(code);
	return outcome;
}

export interface GenerationRunOptions {
	payrollRunId: number;
	actorId: number;
}

/**
 * Call the exported generation seam inside the caller's transaction. The
 * caller already holds the Payroll Run row lock, exactly as the route does.
 */
export async function generateSlipOn(
	connection: Connection,
	employeeId: number,
	month: string,
	options: GenerationRunOptions
): Promise<unknown> {
	const generated = await generatePayrollSlipSeam(employeeId, month, {
		db: connection,
		payrollRunId: options.payrollRunId,
		actorId: options.actorId,
	});
	// Generation inserted the slip and its durable use; assert the caller's
	// still-open transaction, before the caller commits.
	await assertSalaryWriteIsolation(
		connection,
		`payroll generation for employee ${employeeId}`
	);
	return generated;
}

export async function recordFinalizationUseOn(
	connection: Connection,
	agreementId: number,
	source: 'employee_salary_profile' | 'salary_structures',
	employeeId: number,
	month: string,
	payrollRunId: number,
	actorId: number
): Promise<{ recorded: boolean; timeline_version: number }> {
	return recordSalaryAgreementUse(connection, {
		employeeId,
		agreementId,
		agreementSource: source,
		month,
		evidence: 'payroll_finalization',
		evidenceContext: { payroll_run_id: payrollRunId },
		actorId,
	});
}

export interface StoredAgreement extends RowDataPacket {
	id: number | string;
	employee_id: number | string;
	effective_from: string;
	effective_to: string | null;
	is_active: number | string;
	cancelled_at: string | null;
	cancelled_reason: string | null;
	employer_cost: number | string;
	std_hours_per_day: number | string;
	salary_type: string | null;
}

export interface StoredSlip extends RowDataPacket {
	id: number | string;
	month: string;
	employee_id: number | string;
	ctc_used: number | string | null;
	gross: number | string | null;
	total_earnings: number | string | null;
	employer_cost: number | string | null;
	salary_profile_id: number | string | null;
	salary_profile_source: string | null;
	salary_type: string | null;
}

export interface StoredUse extends RowDataPacket {
	id: number | string;
	employee_id: number | string;
	month: string | null;
	agreement_id: number | string | null;
	agreement_source: string | null;
	evidence: string;
	is_ambiguous: number | string;
	evidence_context: string | null;
	first_used_by: number | string | null;
}

export interface StoredAudit extends RowDataPacket {
	id: number | string;
	action: string;
	entity_id: number | string;
	employee_id: number | string | null;
	performed_by: number | string;
}

export async function readTimelineVersion(
	connection: Connection,
	employeeId: number
): Promise<number> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT version
       FROM employee_salary_timelines
      WHERE employee_id = ?
      LIMIT 1`,
		[employeeId]
	);
	return rows[0] === undefined ? 0 : Number(rows[0].version);
}

export async function readAgreement(
	connection: Connection,
	agreementId: number
): Promise<StoredAgreement | null> {
	const [rows] = await connection.execute<StoredAgreement[]>(
		`SELECT id, employee_id, effective_from, effective_to, is_active,
            cancelled_at, cancelled_reason, employer_cost,
            std_hours_per_day, salary_type
       FROM employee_salary_profile
      WHERE id = ?
      LIMIT 1`,
		[agreementId]
	);
	return rows[0] ?? null;
}

export async function readAgreements(
	connection: Connection,
	employeeId: number
): Promise<StoredAgreement[]> {
	const [rows] = await connection.execute<StoredAgreement[]>(
		`SELECT id, employee_id, effective_from, effective_to, is_active,
            cancelled_at, cancelled_reason, employer_cost,
            std_hours_per_day, salary_type
       FROM employee_salary_profile
      WHERE employee_id = ?
      ORDER BY effective_from, id`,
		[employeeId]
	);
	return rows;
}

export async function readSlipForMonth(
	connection: Connection,
	employeeId: number,
	month: string
): Promise<StoredSlip | null> {
	const [rows] = await connection.execute<StoredSlip[]>(
		`SELECT id, month, employee_id, ctc_used, gross, total_earnings,
            employer_cost, salary_profile_id, salary_profile_source,
            salary_type
       FROM payroll_slips
      WHERE employee_id = ? AND month = ?
      LIMIT 1`,
		[employeeId, month]
	);
	return rows[0] ?? null;
}

export async function readSlipCount(
	connection: Connection,
	employeeId: number
): Promise<number> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT COUNT(*) AS total
       FROM payroll_slips
      WHERE employee_id = ?`,
		[employeeId]
	);
	return Number(rows[0]?.total ?? 0);
}

export async function readUseRows(
	connection: Connection,
	employeeId: number
): Promise<StoredUse[]> {
	const [rows] = await connection.execute<StoredUse[]>(
		`SELECT id, employee_id, month, agreement_id, agreement_source,
            evidence, is_ambiguous, evidence_context, first_used_by
       FROM employee_salary_payroll_use
      WHERE employee_id = ?
      ORDER BY id`,
		[employeeId]
	);
	return rows;
}

export async function readSalaryAudits(
	connection: Connection,
	employeeId: number
): Promise<StoredAudit[]> {
	const [rows] = await connection.execute<StoredAudit[]>(
		`SELECT id, action, entity_id, employee_id, performed_by
       FROM payroll_audit_logs
      WHERE employee_id = ? AND entity_type = 'salary_profile'
      ORDER BY id`,
		[employeeId]
	);
	return rows;
}

export async function deleteDraftSlip(
	connection: Connection,
	slipId: number
): Promise<void> {
	await connection.execute('DELETE FROM payroll_slips WHERE id = ?', [slipId]);
}

/**
 * Reproduce the reopen route's guarded transition on the owned fixture row.
 * Reopen only flips the run back to draft and clears signed-off totals; the
 * durable use evidence is deliberately untouched, which is what this test
 * asserts before trying another salary edit.
 */
export async function finalizeThenReopenRun(
	connection: Connection,
	runId: number,
	month: string,
	actorId: number
): Promise<void> {
	await connection.execute(
		`UPDATE payroll_runs
        SET status = 'finalized', finalized_by = ?, finalized_at = NOW()
      WHERE id = ? AND status = 'draft'`,
		[actorId, runId]
	);
	await connection.execute(
		`UPDATE payroll_runs
        SET status = 'draft',
            finalized_by = NULL,
            finalized_at = NULL,
            total_employees = 0,
            total_gross = 0,
            total_deductions = 0,
            total_net_pay = 0,
            total_employer_contribution = 0
      WHERE id = ?
        AND status IN ('finalized', 'paid')
        AND NOT EXISTS (
          SELECT 1
            FROM payroll_slips
           WHERE month = ?
             AND payment_status = 'paid'
        )`,
		[runId, month]
	);
}

export interface StoredRun extends RowDataPacket {
	id: number | string;
	month: number | string;
	year: number | string;
	status: string;
	finalized_by: number | string | null;
	finalized_at: string | null;
}

export async function readRun(
	connection: Connection,
	runId: number
): Promise<StoredRun | null> {
	const [rows] = await connection.execute<StoredRun[]>(
		`SELECT id, month, year, status, finalized_by, finalized_at
       FROM payroll_runs
      WHERE id = ?
      LIMIT 1`,
		[runId]
	);
	return rows[0] ?? null;
}
