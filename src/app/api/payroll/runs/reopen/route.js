import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { formatMonth } from '@/lib/format';
import {
	payrollPeriod,
	findPayrollRun,
	summarizeMonthSlips,
} from '@/app/api/payroll/_lib/payroll-run';
import {
	PAYROLL_AUDIT_ACTION,
	PAYROLL_AUDIT_ENTITY,
	auditSnapshot,
	recordPayrollAudit,
} from '@/app/api/payroll/_lib/payroll-audit';

/**
 * POST - Reopen a finalized Payroll Run (issue #244).
 *
 * Body: { month: 'YYYY-MM-01' }
 *
 * A finalized month is locked, so a genuine pre-payment error in it is
 * uncorrectable: Generate refuses and Finalize refuses. Reopening returns the
 * run to `draft` and releases the lock, and every reopen is attributable.
 *
 * Two rules make reopening safe:
 *
 * 1. Super-admin only. Unlocking a month an admin signed off on is not a
 *    routine action, and the RBAC grant alone (payroll:update) is held by every
 *    payroll admin.
 * 2. Refused while any Payroll Slip in the month is `paid`. Money that left the
 *    bank cannot be un-paid by recalculating a slip, so a paid month is
 *    permanent — corrections to it flow into the next month's run as arrears.
 *
 * The signed-off totals are cleared on reopen: they describe a finalized run
 * and stop describing it the moment it is a draft again. The audit entry keeps
 * them, which is why the log exists.
 */

/** The columns reopen clears, so the response never shows a stale finalize. */
const CLEARED_ON_REOPEN = {
	finalized_by: null,
	finalized_at: null,
	total_employees: 0,
	total_gross: 0,
	total_deductions: 0,
	total_net_pay: 0,
	total_employer_contribution: 0,
};

/**
 * Run statuses a super-admin may reopen.
 *
 * `paid` is only ever a legacy stored value: the live run-level paid indicator
 * is derived from the slips and never written (issue #245), so a row left at
 * `paid` is a locked month with no other way out. It is reopenable for the same
 * reason `finalized` is — and the paid-slip block below still applies to it, so
 * a genuinely paid month stays permanent.
 */
const REOPENABLE_STATUSES = ['finalized', 'paid'];

/** The refusal a month with paid slips always gets, from either check. */
function paidSlipsRefusal(paidSlips, monthLabel) {
	return NextResponse.json(
		{
			success: false,
			error: `Cannot reopen ${monthLabel}: ${paidSlips} Payroll Slip${
				paidSlips === 1 ? ' is' : 's are'
			} already paid — a paid month is permanent.`,
			paid_slips: paidSlips,
		},
		{ status: 409 }
	);
}

export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	// Checked before the month is even parsed: the caller's identity is what
	// decides this, and nothing about the request can change it.
	if (!authResult.user?.is_super_admin) {
		return NextResponse.json(
			{
				success: false,
				error: 'Only a super-admin can reopen a finalized Payroll Run.',
			},
			{ status: 403 }
		);
	}

	let db;
	try {
		const { month } = await request.json().catch(() => ({}));
		const period = payrollPeriod(month);

		if (!period) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const run = await findPayrollRun(db, period);
		if (!run) {
			return NextResponse.json(
				{
					success: false,
					error: `No Payroll Run exists for ${formatMonth(period.month)}.`,
				},
				{ status: 404 }
			);
		}

		if (!REOPENABLE_STATUSES.includes(run.status)) {
			return NextResponse.json(
				{
					success: false,
					error: `The Payroll Run for ${formatMonth(
						period.month
					)} is not finalized — there is nothing to reopen.`,
				},
				{ status: 409 }
			);
		}

		// Any paid slip anywhere in the month, both Employee Type streams — one
		// run pays both, so one paid slip makes the whole month permanent.
		const summary = await summarizeMonthSlips(db, period.month);
		if (summary.paid_slips > 0) {
			return paidSlipsRefusal(summary.paid_slips, formatMonth(period.month));
		}

		const reopenedBy = authResult.user?.id ?? null;

		// Two guards make this atomic, and both are needed:
		//   - `AND status IN (...)` so a concurrent reopen (or re-finalize) that
		//     got there first matches no row here;
		//   - `AND NOT EXISTS (paid slip)` so a payment that landed between the
		//     check above and this statement cannot be reopened over. Reading the
		//     slips inside the UPDATE also takes the locks a concurrent bulk
		//     mark-paid needs, so the two cannot interleave.
		const [result] = await db.execute(
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
          AND status IN (${REOPENABLE_STATUSES.map(() => '?').join(', ')})
          AND NOT EXISTS (
            SELECT 1 FROM payroll_slips
             WHERE month = ? AND payment_status = 'paid'
          )`,
			[run.id, ...REOPENABLE_STATUSES, period.month]
		);

		if (result.affectedRows === 0) {
			// The guarded UPDATE matched nothing. Re-read to say which guard bit,
			// because the two need different fixes.
			const current = await findPayrollRun(db, period);
			if (current && REOPENABLE_STATUSES.includes(current.status)) {
				const paid = await summarizeMonthSlips(db, period.month);
				return paidSlipsRefusal(paid.paid_slips, formatMonth(period.month));
			}

			return NextResponse.json(
				{
					success: false,
					error: `The Payroll Run for ${formatMonth(
						period.month
					)} was reopened by another request.`,
				},
				{ status: 409 }
			);
		}

		// The row read before the transition is the snapshot: it still holds the
		// signed-off totals and who finalized them, which is exactly what a
		// dispute about the reopened month needs.
		await recordPayrollAudit(db, {
			entityType: PAYROLL_AUDIT_ENTITY.PAYROLL_RUN,
			entityId: run.id,
			action: PAYROLL_AUDIT_ACTION.REOPEN,
			payrollRunId: run.id,
			month: period.monthNumber,
			year: period.year,
			performedBy: reopenedBy,
			oldValues: auditSnapshot(run),
			newValues: { status: 'draft', ...CLEARED_ON_REOPEN },
		});

		return NextResponse.json({
			success: true,
			message: `Payroll Run for ${formatMonth(
				period.month
			)} reopened — the month is a draft again and Payroll Slips can be regenerated.`,
			data: { ...run, status: 'draft', ...CLEARED_ON_REOPEN },
		});
	} catch (error) {
		console.error('POST /api/payroll/runs/reopen error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to reopen the Payroll Run',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch {
				// Ignore release errors
			}
		}
	}
}
