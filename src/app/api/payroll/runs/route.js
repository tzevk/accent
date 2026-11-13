import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	payrollPeriod,
	findPayrollRun,
	findMonthSlips,
	summarizeSlipRows,
	loadPayrollRunReadiness,
} from '@/app/api/payroll/_lib/payroll-run';

/**
 * GET - Read a month's Payroll Run, its totals and the completeness preflight.
 *
 * Query params:
 *  - month: Payroll month (YYYY-MM-01)
 *
 * `run` is null for a month that was never generated. `summary` always
 * describes the Payroll Slips currently on the month, across both Employee
 * Type streams, so the dashboard can sign off on the numbers before locking.
 *
 * `summary.is_paid` is the run-level paid indicator (issue #245): derived from
 * those slips on every read — true only when every slip of the month is paid —
 * and never stored on the run, so the header cannot disagree with per-slip
 * truth. It drops the moment one slip leaves `paid`, and a month with no slips
 * is not paid. `summary.paid_slips` is the count behind it.
 *
 * `readiness` is the admin completeness panel's contract:
 *  - `basis: 'live'`   — draft/no run; counts come from current employment
 *                        dates and pay agreements.
 *  - `basis: 'frozen'` — locked run with a saved finalization roster; counts
 *                        come from that immutable snapshot.
 *  - `basis: 'legacy'` — locked run predating saved rosters; `eligible_count`
 *                        is null because original membership cannot be proven.
 * `can_finalize` is a preflight only; Finalize re-validates and names every
 * person behind a refusal.
 */
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const month = searchParams.get('month');
		const period = payrollPeriod(month);

		if (!period) {
			return NextResponse.json(
				{ success: false, error: 'Month is required (format: YYYY-MM-01)' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const run = await findPayrollRun(db, period);
		const slips = await findMonthSlips(db, period.month);
		const summary = summarizeSlipRows(slips, period.month);
		const readiness = await loadPayrollRunReadiness(
			db,
			period,
			run,
			slips
		);

		return NextResponse.json({
			success: true,
			data: { run, summary, readiness },
		});
	} catch (error) {
		console.error('GET /api/payroll/runs error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to load the Payroll Run',
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
