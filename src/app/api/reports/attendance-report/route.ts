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
 * Raw Smart Office biometric punches from `attendance_logs` joined to the
 * Accent employee each punch mapped to — the sanity-check view for the
 * webhook pipeline.
 *
 * Without params            → meta (employees + months/devices with logs)
 *                             for the filter bar.
 * ?from=&to=&employee_id=&device=
 *                           → punches in the inclusive date range, with
 *                             stats (mapped/unmapped counts etc.).
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit) — the same gate
 * used by the other report routes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
		const from = url.searchParams.get('from');
		const to = url.searchParams.get('to');

		// Meta-only request: fill the filter bar.
		if (!from || !to) {
			const meta = await fetchAttendanceMeta();
			return NextResponse.json({ success: true, meta, data: null });
		}

		if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid dates (expected YYYY-MM-DD)' },
				{ status: 400 }
			);
		}
		if (from > to) {
			return NextResponse.json(
				{ success: false, error: 'from must be on or before to' },
				{ status: 400 }
			);
		}

		const employeeIdParam = url.searchParams.get('employee_id');
		const employeeId = employeeIdParam ? Number(employeeIdParam) : null;
		if (
			employeeId != null &&
			(!Number.isInteger(employeeId) || employeeId <= 0)
		) {
			return NextResponse.json(
				{ success: false, error: 'Invalid employee_id' },
				{ status: 400 }
			);
		}

		const device = url.searchParams.get('device');

		const data = await fetchAttendanceData({ from, to, employeeId, device });
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
