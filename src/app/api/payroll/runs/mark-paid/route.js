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
	findMonthSlips,
} from '@/app/api/payroll/_lib/payroll-run';
import {
	PAYROLL_AUDIT_ACTION,
	PAYROLL_AUDIT_ENTITY,
	auditSnapshot,
	recordPayrollAudit,
} from '@/app/api/payroll/_lib/payroll-audit';

/**
 * POST - Mark every Payroll Slip of a month paid in one action (issue #245).
 *
 * Body: { month: 'YYYY-MM-01', payment_date: 'YYYY-MM-DD', payment_reference? }
 *
 * One bank batch, one click: every slip of the month becomes `paid` with the
 * same payment date, and each slip whose payment state actually changed gets
 * its own audit entry — so a mass change is still traceable slip by slip, and
 * re-running the batch does not manufacture history for slips that were already
 * paid on that date.
 *
 * Refused unless the month's Payroll Run is finalized: payment belongs to a
 * locked month, and a draft month's slips can still be regenerated.
 *
 * Deliberately writes nothing to `payroll_runs`: the run-level paid state is
 * derived from its slips (100% paid), never stored, so the run header cannot
 * disagree with per-slip truth.
 */

/** `YYYY-MM-DD` that is a real calendar date, or null when it is not. */
function paymentDate(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
	if (!match) return null;
	const [date] = match;
	// Round-trips only when that day exists in that month, which rejects
	// 2026-02-31 — the date reaches a DATE column, so it has to be real.
	const parsed = new Date(`${date}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== date
		? null
		: date;
}

/**
 * A DATE column as `YYYY-MM-DD`, or '' when it was never set. The pool reads
 * dates as strings (`dateStrings: true`), but a driver that hands back a Date
 * must not compare as one either.
 */
function dateOnly(value) {
	if (value == null) return '';
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
	return match ? match[1] : '';
}

/** The response message, which says what the batch actually did. */
function markedMessage(total, updated, month, paidOn) {
	if (total === 0) {
		return `No Payroll Slips exist for ${month} — nothing to mark paid.`;
	}
	if (updated === 0) {
		return `Every Payroll Slip for ${month} was already paid on ${paidOn} — nothing changed.`;
	}
	return `${updated} Payroll Slip${
		updated === 1 ? '' : 's'
	} for ${month} marked paid on ${paidOn}.`;
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

	let db;
	try {
		const { month, payment_date, payment_reference } = await request
			.json()
			.catch(() => ({}));
		const period = payrollPeriod(month);

		if (!period) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		const paidOn = paymentDate(payment_date);
		if (!paidOn) {
			return NextResponse.json(
				{
					success: false,
					error: 'A payment date is required (format: YYYY-MM-DD)',
				},
				{ status: 400 }
			);
		}

		const reference =
			payment_reference == null || String(payment_reference).trim() === ''
				? null
				: String(payment_reference).trim();

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

		if (run.status !== 'finalized') {
			return NextResponse.json(
				{
					success: false,
					error: `Cannot mark ${formatMonth(
						period.month
					)} paid: its Payroll Run is not finalized.`,
				},
				{ status: 409 }
			);
		}

		// The whole month, both Employee Type streams — one run pays both.
		const slips = await findMonthSlips(db, period.month);

		const changed = slips.filter(
			(slip) =>
				slip.payment_status !== 'paid' ||
				dateOnly(slip.payment_date) !== paidOn ||
				(reference !== null && slip.payment_reference !== reference)
		);

		if (changed.length > 0) {
			// One statement for the whole month, and it carries the run's state:
			// slips may only be paid while their run is finalized, so a reopen
			// that lands between the check above and this write cannot leave a
			// draft month holding paid slips. The subquery read is also what makes
			// the two statements conflict, instead of racing. The COALESCE mirrors
			// the per-slip PUT contract: an omitted reference leaves each slip's
			// own reference alone instead of wiping it.
			const [result] = await db.execute(
				`UPDATE payroll_slips ps
            SET ps.payment_status = 'paid',
                ps.payment_date = ?,
                ps.payment_reference = COALESCE(?, ps.payment_reference)
          WHERE ps.month = ?
            AND EXISTS (
              SELECT 1 FROM payroll_runs r
               WHERE r.month = MONTH(ps.month) AND r.year = YEAR(ps.month)
                 AND r.run_number = 1 AND r.status = 'finalized'
            )`,
				[paidOn, reference, period.month]
			);

			if (result.affectedRows === 0) {
				// Nothing landed, so nothing is attributed either: the run stopped
				// being finalized between the check above and this write.
				return NextResponse.json(
					{
						success: false,
						error: `Cannot mark ${formatMonth(
							period.month
						)} paid: its Payroll Run is not finalized.`,
					},
					{ status: 409 }
				);
			}

			for (const slip of changed) {
				await recordPayrollAudit(db, {
					entityType: PAYROLL_AUDIT_ENTITY.PAYROLL_SLIP,
					entityId: slip.id,
					action: PAYROLL_AUDIT_ACTION.UPDATE,
					employeeId: slip.employee_id,
					month: period.monthNumber,
					year: period.year,
					performedBy: authResult.user?.id,
					oldValues: auditSnapshot({
						payment_status: slip.payment_status,
						payment_date: slip.payment_date,
						payment_reference: slip.payment_reference,
					}),
					newValues: auditSnapshot({
						payment_status: 'paid',
						payment_date: paidOn,
						payment_reference: reference ?? slip.payment_reference,
					}),
				});
			}
		}

		return NextResponse.json({
			success: true,
			message: markedMessage(
				slips.length,
				changed.length,
				formatMonth(period.month),
				paidOn
			),
			data: {
				updated: changed.length,
				already_paid: slips.length - changed.length,
				total_slips: slips.length,
				is_paid: slips.length > 0,
			},
		});
	} catch (error) {
		console.error('POST /api/payroll/runs/mark-paid error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to mark the month paid',
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
