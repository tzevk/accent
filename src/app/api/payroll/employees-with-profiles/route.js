import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	SalaryProfileQueryError,
	loadSalaryProfileDirectory,
	parseSalaryDirectoryQuery,
} from '@/lib/salary-profile-directory';

/**
 * GET /api/payroll/employees-with-profiles
 *
 * Payroll-authorized minimal Employee projection for the Salary Profiles
 * workspace. Supports an as-of date or payroll month, search, Payroll /
 * Contract / Missing Profile filters and stable pagination.
 *
 * Query: date=YYYY-MM-DD | month=YYYY-MM, search, stream=payroll|contract|missing,
 *        page, limit
 * Salary data is payroll data: only payroll:read authorizes this route, with no
 * employees:* fallback. Responds with the requested-period agreement state and
 * never the newest agreement as a substitute for an uncovered period.
 */
export async function GET(request) {
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
		const query = parseSalaryDirectoryQuery(searchParams);

		db = await dbConnect();
		const result = await loadSalaryProfileDirectory(db, query);
		return NextResponse.json({ success: true, ...result });
	} catch (error) {
		if (error instanceof SalaryProfileQueryError) {
			return NextResponse.json(
				{ success: false, error: error.message },
				{ status: 400 }
			);
		}
		console.error('Error reading salary profile directory:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to read salary profile directory',
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
