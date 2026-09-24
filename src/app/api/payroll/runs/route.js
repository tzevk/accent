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
	summarizeMonthSlips,
} from '@/app/api/payroll/_lib/payroll-run';

/**
 * GET - Read a month's Payroll Run and the totals Finalize would commit.
 *
 * Query params:
 *  - month: Payroll month (YYYY-MM-01)
 *
 * `run` is null for a month that was never generated. `summary` always
 * describes the Payroll Slips currently on the month, across both Employee
 * Type streams, so the dashboard can sign off on the numbers before locking.
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
		const summary = await summarizeMonthSlips(db, month);

		return NextResponse.json({ success: true, data: { run, summary } });
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
