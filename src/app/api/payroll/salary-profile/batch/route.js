import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	SalaryProfileQueryError,
	loadSalaryProfileBatch,
	parseSalaryBatchQuery,
} from '@/lib/salary-profile-directory';

/**
 * GET /api/payroll/salary-profile/batch
 *
 * Requested-period Salary Profile batch read. Every requested live Employee
 * gets an explicit `selected` / `unavailable` / `ambiguous` entry; a missing or
 * future-only agreement is never replaced by the newest row. Uses the shared
 * source-qualified selection and CTC disclosure.
 *
 * Query:
 *   ids   - optional comma-separated Employee ids (omit for Employees with
 *           any active agreement)
 *   date  - optional YYYY-MM-DD selection date
 *   month - optional YYYY-MM payroll month (default: current server month)
 *   full  - "1" returns the full normalized profile instead of the lightweight
 *           PL/gross/type/effective-range subset
 */
export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	try {
		const { searchParams } = new URL(request.url);
		const query = parseSalaryBatchQuery(searchParams);

		connection = await dbConnect();
		const result = await loadSalaryProfileBatch(connection, query);
		return NextResponse.json({ success: true, ...result });
	} catch (error) {
		if (error instanceof SalaryProfileQueryError) {
			return NextResponse.json(
				{ success: false, error: error.message },
				{ status: 400 }
			);
		}
		console.error('Error fetching batch salary profiles:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to fetch batch salary profiles',
			},
			{ status: 500 }
		);
	} finally {
		if (connection) {
			try {
				connection.release();
			} catch {
				// Ignore release errors
			}
		}
	}
}
