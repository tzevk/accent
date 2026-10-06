import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import { isValidUtilizationMonth } from '@/app/reports/employee-utilization/data-source';
import { fetchProjectBreakdown } from '@/app/reports/employee-utilization/project-breakdown';

/**
 * GET /api/reports/employee-utilization/projects
 *
 * One employee's project breakdown for one month, fetched lazily when the
 * utilization grid's row is expanded: the month's Logged Hours grouped by the
 * assignment's project (activity/discipline as detail), the top N project
 * groups plus an "Other" bucket, and an explicit "No project" bucket. The
 * buckets foot to the row's Logged Hours.
 *
 * ?month=YYYY-MM&employee_id=<employees.id> → `data` with the breakdown.
 * Both params are required; a malformed one is a 400 and an unknown employee
 * is a 404.
 *
 * Access: the same gate as the report routes — super admins, users with
 * `reports:read`, or users with the `project_activities` report field
 * permission (view/edit).
 *
 * Uses pool.execute (via query()) — no long-held connection.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		const hasReportsPermission = hasPermission(
			user,
			RESOURCES.REPORTS,
			PERMISSIONS.READ
		);
		const hasFieldPermission = hasProjectActivitiesFieldPermission(user);

		if (!isSuperAdmin && !hasReportsPermission && !hasFieldPermission) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view the utilization report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const month = url.searchParams.get('month');
		const employeeParam = url.searchParams.get('employee_id');

		if (!isValidUtilizationMonth(month)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month (expected YYYY-MM)' },
				{ status: 400 }
			);
		}

		const employeeId = Number(employeeParam);
		if (!employeeParam || !Number.isInteger(employeeId) || employeeId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Invalid employee_id' },
				{ status: 400 }
			);
		}

		const data = await fetchProjectBreakdown(month, employeeId);
		if (!data) {
			return NextResponse.json(
				{ success: false, error: 'Employee not found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Utilization project breakdown error:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to load the breakdown',
			},
			{ status: 500 }
		);
	}
}
