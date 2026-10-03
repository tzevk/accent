import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchAttendanceMeta,
	fetchAttendanceData,
} from '@/app/reports/attendance-report/data-source';

/**
 * GET /api/reports/attendance-report
 *
 * The Attendance report is a month matrix: Smart Office biometric Punches
 * from `attendance_logs`, attributed to the Employee stamped on the row at
 * ingest and bucketed per Employee per day. Each cell carries the day's Time
 * Present hours (first Punch of the day → last, with the bounded
 * cross-midnight merge) and the canonical Logged Hours, alongside the
 * Attendance Record status and the day's Punch count.
 *
 * Without params    → meta: the latest month with logs, for the month picker.
 * ?month=YYYY-MM    → the month matrix: the month's day list, one row per
 *                     Payroll employee with a cell per day (Time Present +
 *                     Logged Hours + Attendance Record status + Punch
 *                     count), the month's stats, the roster disclosure,
 *                     holidays, the distinct device serials, and the
 *                     month-scoped Punch list the drill-down reads.
 *
 * Computation pads the Punch fetch one day either side of the month so a
 * shift crossing midnight merges across the boundary; the padded days are
 * never rendered and never reach the response.
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit) — the same gate
 * used by the other report routes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTH_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

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
					error: 'You do not have permission to view the attendance report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const month = url.searchParams.get('month');

		// Meta-only request: fill the month picker.
		if (!month) {
			const meta = await fetchAttendanceMeta();
			return NextResponse.json({ success: true, meta, data: null });
		}

		if (!MONTH_RE.test(month)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month (expected YYYY-MM)' },
				{ status: 400 }
			);
		}

		const data = await fetchAttendanceData({ month });
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Attendance report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
