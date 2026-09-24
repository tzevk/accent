/**
 * Payroll Run lock helpers (issue #242).
 *
 * A Payroll Run is the month-level lifecycle record for one pay period.
 * Payroll Slips carry no FK to it, so the lock is always resolved by looking
 * the run up by month/year. One run covers both Employee Type streams (payroll
 * and contract) and `run_number` stays 1 — there are no off-cycle runs; arrears
 * flow into the next month's run.
 */

import { R, add, toNumber } from '@/lib/money';

/** Run statuses that lock the month against regenerating its Payroll Slips. */
const LOCKED_STATUSES = ['finalized', 'paid'];

/** Every run read returns these columns, so route responses share one shape. */
const RUN_COLUMNS = `id, month, year, run_number, status, total_employees, total_gross,
       total_deductions, total_net_pay, total_employer_contribution,
       finalized_by, finalized_at`;

/**
 * Parse a Payroll Slip month into the run's period columns.
 *
 * Accepts 'YYYY-MM' or 'YYYY-MM-01' and normalises to the first of the month,
 * so callers that send a short form still compare against stored slip months.
 * Returns null when the value is not a calendar month at all.
 */
export function payrollPeriod(month) {
	const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(
		String(month ?? '').trim()
	);
	if (!match) return null;
	const monthNumber = Number(match[2]);
	if (monthNumber < 1 || monthNumber > 12) return null;
	return {
		year: Number(match[1]),
		monthNumber,
		// The normalised slip month. Every slip/profile comparison must use this
		// rather than the caller's raw string — payroll_slips.month is a DATE.
		month: `${match[1]}-${match[2]}-01`,
	};
}

/** The month's Payroll Run, or null when the month was never generated. */
export async function findPayrollRun(db, period) {
	const [rows] = await db.execute(
		`SELECT ${RUN_COLUMNS}
       FROM payroll_runs
      WHERE month = ? AND year = ? AND run_number = 1
      LIMIT 1`,
		[period.monthNumber, period.year]
	);
	return rows[0] || null;
}

/** True when the run locks its month against regenerating Payroll Slips. */
export function isRunLocked(run) {
	return !!run && LOCKED_STATUSES.includes(run.status);
}

/**
 * SQL for the self-service publish rule (ADR-0008): a Payroll Slip is visible to
 * its employee when its month has no Payroll Run row at all — the ~3.2k
 * grandfathered historical slips — or when that month's run is finalized/paid.
 * A draft, processing, or cancelled run keeps the month's provisional numbers
 * internal.
 *
 * `join` and `where` are used together: the predicate reads the joined run
 * alias, and `params` are the bindings the caller appends after its own. The
 * join compares the run's integer month/year against YEAR()/MONTH() of the slip
 * because `payroll_slips.month` is a DATE; that also holds when a caller sends
 * 'YYYY-MM', since a stored slip month is always the first of its month.
 *
 * Publishing follows the lock: the transition that locks a month against
 * regenerating its slips is the one that publishes them.
 */
export const SLIP_VISIBILITY = {
	join: `LEFT JOIN payroll_runs pr
              ON pr.month = MONTH(ps.month) AND pr.year = YEAR(ps.month)
             AND pr.run_number = 1`,
	where: `(pr.id IS NULL OR pr.status IN (${LOCKED_STATUSES.map(() => '?').join(', ')}))`,
	params: LOCKED_STATUSES,
};

/**
 * The most recent locked run, or null when no month is locked.
 *
 * Used to protect operations that are not scoped to one month — deleting every
 * Payroll Slip would strip slips out of finalized months and leave those runs'
 * recorded totals permanently wrong.
 */
export async function findAnyLockedRun(db) {
	const [rows] = await db.execute(
		`SELECT ${RUN_COLUMNS}
       FROM payroll_runs
      WHERE status IN (${LOCKED_STATUSES.map(() => '?').join(', ')})
      ORDER BY year DESC, month DESC
      LIMIT 1`,
		LOCKED_STATUSES
	);
	return rows[0] || null;
}

/** The run's month as a first-of-month date string, for messages. */
export function runMonthDate(run) {
	return `${run.year}-${String(run.month).padStart(2, '0')}-01`;
}

/** Create the month's Payroll Run as `draft` — the first generate of a month. */
export async function createDraftPayrollRun(db, period) {
	try {
		await db.execute(
			`INSERT INTO payroll_runs (month, year, run_number, status)
       VALUES (?, ?, 1, 'draft')`,
			[period.monthNumber, period.year]
		);
	} catch (error) {
		// A concurrent generate already created it — reuse that row.
		if (error.code !== 'ER_DUP_ENTRY') throw error;
	}
	return findPayrollRun(db, period);
}

/**
 * Active, non-deleted employees with a Salary Profile covering the month but no
 * Payroll Slip for it — the first Finalize gate group.
 *
 * `e.isDelete = 0` is essential: employee deletion is soft (it sets isDelete and
 * leaves status 'active'), so without it a deleted employee with a live profile
 * would block Finalize forever and be named as missing.
 *
 * Mirrors the population `generateMonthlyPayroll` generates for (canonical
 * `employee_salary_profile`, falling back to legacy `salary_structures`), so
 * this group is always clearable by generating again. It carries no salary_type
 * filter, so it covers both Employee Type streams — stream membership lives on
 * the Salary Profile (`salary_type` / `pay_type`), not on
 * `employees.employee_type`.
 */
export async function findEmployeesMissingSlips(db, month) {
	const [rows] = await db.execute(
		`SELECT e.id AS employee_id,
            e.employee_id AS employee_code,
            CONCAT(e.first_name, ' ', e.last_name) AS name
       FROM employees e
      WHERE (e.status = 'active' OR e.status IS NULL)
        AND e.isDelete = 0
        AND (
          EXISTS (
            SELECT 1 FROM employee_salary_profile esp
             WHERE esp.employee_id = e.id AND esp.is_active = 1
               AND esp.effective_from <= ?
               AND (esp.effective_to IS NULL OR esp.effective_to >= ?)
          )
          OR EXISTS (
            SELECT 1 FROM salary_structures ss
             WHERE ss.employee_id = e.id AND ss.is_active = 1
               AND ss.effective_from <= ?
               AND (ss.effective_to IS NULL OR ss.effective_to >= ?)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM payroll_slips ps
           WHERE ps.employee_id = e.id AND ps.month = ?
        )
      ORDER BY e.first_name, e.last_name`,
		[month, month, month, month, month]
	);
	return rows;
}

/**
 * Active, non-deleted employees typed Payroll or Contract who have NO Salary
 * Profile covering the month — the second Finalize gate group.
 *
 * `e.isDelete = 0` matters here too: a deleted employee cannot have their
 * Employee Type corrected through the API (that UPDATE also filters on
 * isDelete = 0), so including them would strand the month.
 *
 * Generate cannot compute a Payroll Slip for these people at all, so unlike the
 * missing-slip group this one is NOT cleared by generating again: the fix is
 * master data (write a Salary Profile, or correct the Employee Type). They are
 * reported separately from the missing-slip group so a refusal can say which
 * fix applies.
 *
 * Employees who already have a slip are excluded — their salary is already on
 * the month, so a missing profile is not an omission worth blocking on.
 */
export async function findEmployeesWithoutProfiles(db, month) {
	const [rows] = await db.execute(
		`SELECT e.id AS employee_id,
            e.employee_id AS employee_code,
            e.employee_type,
            CONCAT(e.first_name, ' ', e.last_name) AS name
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
      ORDER BY e.first_name, e.last_name`,
		[month, month, month, month, month]
	);
	return rows;
}

/**
 * Headcount and money totals of the month's Payroll Slips, summed with the
 * money library (never float arithmetic). These are the numbers Finalize signs
 * off on and records on the run.
 */
export async function summarizeMonthSlips(db, month) {
	const [slips] = await db.execute(
		`SELECT gross, total_deductions, net_pay, total_employer_contributions
       FROM payroll_slips
      WHERE month = ?`,
		[month]
	);
	const sum = (column) =>
		toNumber(slips.reduce((total, slip) => add(total, slip[column]), R(0)));

	return {
		headcount: slips.length,
		total_gross: sum('gross'),
		total_deductions: sum('total_deductions'),
		total_net_pay: sum('net_pay'),
		total_employer_contribution: sum('total_employer_contributions'),
	};
}
