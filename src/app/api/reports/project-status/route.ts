import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectStatusData } from '@/app/reports/project-status/data-source';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

// ── Permission helpers ─────────────────────────────────────────────

// ── Handler ────────────────────────────────────────────────────────

/**
 * GET /api/reports/project-status
 * Returns one row per non-deleted project with people assigned, target/actual
 * quantity, and remaining balance. Reuses the same permission gate as
 * project-activities / sales-register so admins do not need to re-grant.
 */
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
		const hasReportsRead = hasPermission(
			user,
			RESOURCES.REPORTS,
			PERMISSIONS.READ
		);
		const hasFieldPerm = hasProjectActivitiesFieldPermission(user);

		if (!isSuperAdmin && !hasReportsRead && !hasFieldPerm) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view project status report',
				},
				{ status: 403 }
			);
		}

		const data = await fetchProjectStatusData();
		return NextResponse.json({
			success: true,
			data,
			meta: { total_projects: data.length },
		});
	} catch (error: unknown) {
		console.error('Project status report error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return NextResponse.json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
}
