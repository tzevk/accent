import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * Either-or gate (issue #239): this route had ZERO permission check before.
 * EMPLOYEES:READ or PAYROLL:READ each suffice, consistent with the other
 * rates reads whose callers may sit behind /employees gating.
 */
const ensureDaReadPermission = async (request) => {
	const employeePermission = await ensurePermission(
		request,
		RESOURCES.EMPLOYEES,
		PERMISSIONS.READ
	);
	if (employeePermission?.authorized) return employeePermission;

	const payrollPermission = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	return payrollPermission?.authorized ? payrollPermission : employeePermission;
};

/**
 * GET - Fetch current active DA for a specific date and year
 * Query params: date (optional, defaults to today), year (optional, defaults to current year)
 */
export async function GET(request) {
	let db;
	try {
		const authResult = await ensureDaReadPermission(request);
		if (authResult instanceof Response) return authResult;
		if (!authResult?.authorized) return authResult;

		const { searchParams } = new URL(request.url);
		const dateParam = searchParams.get('date');
		const yearParam = searchParams.get('year');
		const forDate = dateParam || new Date().toISOString().split('T')[0];
		const forYear = yearParam ? parseInt(yearParam) : new Date().getFullYear();

		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT da_amount, effective_from, effective_to
       FROM da_schedule 
       WHERE is_active = 1 
       ORDER BY effective_from DESC
       LIMIT 1`,
			[]
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
