import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchTimesheetMeta,
	fetchTimesheetData,
} from '@/app/reports/timesheet-report/data-source';

/**
 * GET /api/reports/timesheet-report
 *
 * Monthly timesheet report for one employee.
 *
 * Without params            → meta (active employees + months with data) for
 *                             the filter bar.
 * ?employee_id=&month=      → the full timesheet matrix for that employee and
 *                             month (days, statuses, hours, holidays,
 *                             project assignments, summary).
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit) — the same gate
 * used by the other report routes.
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
					error: 'You do not have permission to view the timesheet report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const employeeIdParam = url.searchParams.get('employee_id');
		const month = url.searchParams.get('month');

		// Meta-only request: fill the filter bar.
		if (!employeeIdParam || !month) {
			const meta = await fetchTimesheetMeta();
			return NextResponse.json({ success: true, meta, data: null });
		}

		const employeeId = Number(employeeIdParam);
		if (!Number.isInteger(employeeId) || employeeId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Invalid employee_id' },
				{ status: 400 }
			);
		}
		if (!/^\d{4}-\d{2}$/.test(month)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month (expected YYYY-MM)' },
				{ status: 400 }
			);
		}

		const data = await fetchTimesheetData(employeeId, month);
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Timesheet report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
