/**
 * Payroll Run lock helpers (issue #242).
 *
 * A Payroll Run is the month-level lifecycle record for one pay period.
 * Payroll Slips carry no FK to it, so the lock is always resolved by looking
 * the run up by month/year. One run covers both Employee Type streams (payroll
 * and contract) and `run_number` stays 1 — there are no off-cycle runs; arrears
 * flow into the next month's run.
 */

import { R, add, sub, toNumber } from '@/lib/money';
import { ptAdjustmentFor, slipFigures } from '@/lib/payroll';
import { withTransaction } from '@/utils/database';
import {
	loadFrozenPayrollRunRoster,
	loadPayrollRunRoster,
} from '@/lib/payroll-run-roster';

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

/**
 * The month's Payroll Run, or null when the month was never generated.
 *
 * Pass `{ forUpdate: true }` only on the connection that owns the write
 * transaction: the row lock is what serialises Generate, Finalize and Reopen
 * for the same month. A lookup on a short-lived connection does not hold.
 */
export async function findPayrollRun(db, period, options = {}) {
	const [rows] = await db.execute(
		`SELECT ${RUN_COLUMNS}
       FROM payroll_runs
      WHERE month = ? AND year = ? AND run_number = 1
      LIMIT 1${options.forUpdate ? ' FOR UPDATE' : ''}`,
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
 * Run a Payroll Slip writer on a transaction that owns the month's Payroll Run
 * row lock.
 *
 * Every exported generator can be called without a caller-supplied connection.
 * In that case it must not simply open a connection and insert: the route-only
 * check would be stale before the INSERT. This wrapper starts the write
 * transaction, takes `SELECT ... FOR UPDATE` on the run (creating the draft on
 * a month's first write), refuses a finalized/paid month, and hands the locked
 * connection to the writer. Callers that already own that transaction pass
 * their connection instead and call the generator directly.
 *
 * A locked run throws a retryable 409-shaped error rather than writing slips
 * behind Finalize's back.
 */
export async function withPayrollRunWriteLock(month, fn) {
	const period = payrollPeriod(month);
	if (!period) {
		throw new Error(`Invalid month format. Use YYYY-MM-01`);
	}

	return withTransaction(async (db) => {
		let run = await findPayrollRun(db, period, { forUpdate: true });
		if (isRunLocked(run)) {
			throw Object.assign(
				new Error(
					`The Payroll Run for ${period.month} is finalized — the month is locked, so Payroll Slips cannot be regenerated.`
				),
				{ code: 'payroll_run_locked', status: 409 }
			);
		}

		if (!run) {
			await createDraftPayrollRun(db, period);
			run = await findPayrollRun(db, period, { forUpdate: true });
			if (isRunLocked(run)) {
				throw Object.assign(
					new Error(
						`The Payroll Run for ${period.month} is finalized — the month is locked, so Payroll Slips cannot be regenerated.`
					),
					{ code: 'payroll_run_locked', status: 409 }
				);
			}
		}

		if (!run) {
			throw new Error(
				`The Payroll Run for ${period.month} could not be created.`
			);
		}

		return fn(db, run);
	});
}

/**
 * Every Payroll Slip of the month with the columns the run lock, the payment
 * state, the Finalize sign-off and the roster completeness check read.
 *
 * One run covers both Employee Type streams, so "the month's slips" is always
 * the whole month and never one stream's subset — the run-level paid indicator
 * and the reopen block both have to look at every slip the run pays.
 *
 * The employee identity is joined here (not inferred from a live roster) so a
 * slip whose employee has left, been renamed or been soft-deleted can still be
 * named while Finalize reports it as unexpected or reopens the month.
 */
export async function findMonthSlips(db, month) {
	const [slips] = await db.execute(
		`SELECT ps.id, ps.employee_id, ps.payment_status, ps.payment_date,
              ps.payment_reference, ps.gross, ps.total_earnings,
              ps.total_deductions, ps.net_pay, ps.pt,
              ps.total_employer_contributions,
              e.employee_id AS employee_code,
              CONCAT(e.first_name, ' ', e.last_name) AS name
       FROM payroll_slips ps
       LEFT JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ?
      ORDER BY ps.id`,
		[month]
	);
	return slips;
}

/**
 * Headcount, money totals and payment progress of a list of Payroll Slips.
 * Money is summed with the money library (never float arithmetic); these are
 * the numbers Finalize signs off on and records on the run.
 *
 * Split from the query so Finalize can lock/read the month's slips once, check
 * them against the roster, and still sign off the exact rows it validated.
 *
 * `is_paid` is the run-level paid indicator (issue #245), derived from the
 * slips themselves: true only when every slip of the month is paid. It is never
 * stored on the run, so the run header cannot disagree with per-slip truth — if
 * one slip leaves `paid`, this returns to false. A month with no slips is not
 * paid.
 */
export function summarizeSlipRows(slips, month) {
	const sum = (pick) =>
		toNumber(slips.reduce((total, slip) => add(total, pick(slip)), R(0)));
	const paidSlips = slips.filter(
		(slip) => slip.payment_status === 'paid'
	).length;

	// The month's money is the Payroll Slips' own figures (src/lib/payroll.js) —
	// the same ones the run dashboard, the Payroll Slip document and both PDFs
	// print — so the confirmation that asks an admin to sign off on these totals
	// cannot quote a number the screen behind it contradicts. The `gross` column
	// is the full-month contractual gross, not what the month earned, so it is
	// not the total here.
	//
	// February's PT is a flat FEBRUARY_PT for everyone, so the deductions carry
	// the same correction the dashboard shows per slip; a summary that skipped it
	// would disagree with that screen for one month a year.
	const gross = sum((slip) => slipFigures(slip).gross);
	const deductions = sum((slip) =>
		add(slipFigures(slip).deductions, ptAdjustmentFor(slip, month))
	);

	return {
		headcount: slips.length,
		total_gross: gross,
		total_deductions: deductions,
		total_net_pay: toNumber(sub(gross, deductions)),
		total_employer_contribution: sum(
			(slip) => slip.total_employer_contributions
		),
		paid_slips: paidSlips,
		is_paid: slips.length > 0 && paidSlips === slips.length,
	};
}

/** Headcount, money totals and payment progress of the month's Payroll Slips. */
export async function summarizeMonthSlips(db, month) {
	return summarizeSlipRows(await findMonthSlips(db, month), month);
}

/**
 * The admin completeness panel's exact contract.
 *
 * `basis` says which membership source answered:
 *  - `live`   — the month is a draft (or was never generated), so eligibility
 *               is resolved from current employment dates and pay agreements.
 *  - `frozen` — the run is locked and has a saved finalization roster. Counts
 *               come from that immutable snapshot, never current profiles.
 *  - `legacy` — the run is locked but predates saved rosters. `eligible_count`
 *               is null because the original membership cannot be verified;
 *               only the slips that actually exist are promised.
 *
 * `can_finalize` is a UI preflight only; Finalize independently validates the
 * same roster and names the people behind every non-zero gap.
 */
export async function loadPayrollRunReadiness(db, period, run, slips) {
	const slipEmployeeIds = new Set(
		slips.map((slip) => Number(slip.employee_id))
	);
	const slipCount = slips.length;

	if (isRunLocked(run)) {
		const frozen = await loadFrozenPayrollRunRoster(db, period.month);
		if (frozen) {
			const memberIds = new Set(
				frozen.members.map((member) => Number(member.employee_id))
			);
			return {
				basis: 'frozen',
				eligible_count: frozen.members.length,
				slip_count: slipCount,
				missing_slip_count: frozen.members.filter(
					(member) => !slipEmployeeIds.has(Number(member.employee_id))
				).length,
				missing_profile_count: 0,
				employment_issue_count: 0,
				unexpected_slip_count: slips.filter(
					(slip) => !memberIds.has(Number(slip.employee_id))
				).length,
				excluded_count: 0,
				can_finalize: false,
			};
		}

		// Locked legacy run: do not promise a completeness the data cannot prove.
		return {
			basis: 'legacy',
			eligible_count: null,
			slip_count: slipCount,
			missing_slip_count: 0,
			missing_profile_count: 0,
			employment_issue_count: 0,
			unexpected_slip_count: 0,
			excluded_count: 0,
			can_finalize: false,
		};
	}

	const roster = await loadPayrollRunRoster(db, period.month);
	const members = roster.members;
	const reviewCount = members.filter((member) => member.issue).length;
	const profileGapCount = members.filter(
		(member) => !member.issue && !member.salary_profile
	).length;
	const eligible = members.filter(
		(member) => !member.issue && member.salary_profile
	);
	const memberIds = new Set(
		members.map((member) => Number(member.employee_id))
	);
	const missingSlipCount = eligible.filter(
		(member) => !slipEmployeeIds.has(Number(member.employee_id))
	).length;
	const unexpectedSlipCount = slips.filter(
		(slip) => !memberIds.has(Number(slip.employee_id))
	).length;

	return {
		basis: 'live',
		eligible_count: eligible.length,
		slip_count: slipCount,
		missing_slip_count: missingSlipCount,
		missing_profile_count: profileGapCount,
		employment_issue_count: reviewCount,
		unexpected_slip_count: unexpectedSlipCount,
		excluded_count: roster.excluded.length,
		can_finalize:
			!!run &&
			run.status === 'draft' &&
			eligible.length > 0 &&
			missingSlipCount === 0 &&
			profileGapCount === 0 &&
			reviewCount === 0 &&
			unexpectedSlipCount === 0,
	};
}
