import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	SalaryProfileQueryError,
	loadSalaryProfileResolution,
	parseSalaryEmployeeId,
	parseSalaryResolveQuery,
	type SalaryDirectoryDb,
} from '@/lib/salary-profile-directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/payroll/salary-profile/resolve
 *
 * One Employee's Salary Profile for the requested date/month: the covering
 * source-qualified agreement, classification, disclosed CTC, use state and
 * timeline version. A future-only agreement never stands in for an uncovered
 * historical period; the answer is explicitly `unavailable` or `ambiguous`.
 *
 * Query: employee_id (required), date=YYYY-MM-DD | month=YYYY-MM
 */
export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db: (SalaryDirectoryDb & { release(): void }) | undefined;
	try {
		const { searchParams } = new URL(request.url);
		const employeeId = parseSalaryEmployeeId(searchParams.get('employee_id'));
		const query = parseSalaryResolveQuery(searchParams);

		const connection = await dbConnect();
		db = connection;
		const resolution = await loadSalaryProfileResolution(
			connection,
			employeeId,
			query
		);
		if (resolution === null) {
			return NextResponse.json(
				{ success: false, error: 'Employee not found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({
			success: true,
			period: query.period,
			as_of: query.period.date ?? query.period.start,
			data: resolution,
		});
	} catch (error: unknown) {
		if (error instanceof SalaryProfileQueryError) {
			return NextResponse.json(
				{ success: false, error: error.message },
				{ status: 400 }
			);
		}
		console.error('Error resolving salary profile:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to resolve salary profile',
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
