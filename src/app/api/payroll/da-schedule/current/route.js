import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { PERMISSIONS } from '@/utils/api-permissions';
import { ensureEmployeesOrPayroll } from '@/utils/ensure-employees-or-payroll';

/**
 * GET - Fetch the DA Component Rate effective on a specific date
 * Query params: date (optional, defaults to today)
 */
export async function GET(request) {
	let db;
	try {
		// Either-or gate (EMPLOYEES:READ | PAYROLL:READ) — this route had
		// ZERO permission check before issue #239.
		const authResult = await ensureEmployeesOrPayroll(
			request,
			PERMISSIONS.READ
		);
		if (authResult instanceof Response) return authResult;

		const { searchParams } = new URL(request.url);
		const dateParam = searchParams.get('date');
		const forDate = dateParam || new Date().toISOString().split('T')[0];

		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT value AS da_amount, effective_from, effective_to
       FROM payroll_schedules
       WHERE component_type = 'da' AND is_active = 1
         AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to >= ?)
       ORDER BY effective_from DESC
       LIMIT 1`,
			[forDate, forDate]
		);

		if (rows.length === 0) {
			return NextResponse.json({
				success: true,
				data: { da_amount: 0, effective_from: forDate, effective_to: null },
				message: 'No active DA found, using 0',
			});
		}

		return NextResponse.json({
			success: true,
			data: rows[0],
		});
	} catch (error) {
		console.error('GET /api/payroll/da-schedule/current error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch current DA',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
