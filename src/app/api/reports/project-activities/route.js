import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectActivitiesData } from '@/app/reports/project-activities/data-source';

/**
 * GET /api/reports/project-activities
 * Returns all projects with their activities and per-user daily entries for admin report view.
 * Access: super admins or users with reports:read permission.
 */
export async function GET(request) {
	try {
		// Check permissions
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
		let hasProjectActivitiesFieldPermission = false;

		let fieldPerms = user.field_permissions;
		if (typeof fieldPerms === 'string') {
			try {
				fieldPerms = JSON.parse(fieldPerms);
			} catch {
				fieldPerms = null;
			}
		}

		const reportAccessSection =
			fieldPerms?.modules?.reports?.sections?.report_access;
		if (reportAccessSection?.enabled) {
			const projectActivitiesPerm =
				reportAccessSection.fields?.project_activities?.permission;
			const legacyPerm =
				reportAccessSection.fields?.project_reports?.permission;
			hasProjectActivitiesFieldPermission =
				projectActivitiesPerm === 'view' ||
				projectActivitiesPerm === 'edit' ||
				legacyPerm === 'view' ||
				legacyPerm === 'edit';
		}

		if (
			!isSuperAdmin &&
			!hasReportsPermission &&
			!hasProjectActivitiesFieldPermission
		) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view project activities report',
				},
				{ status: 403 }
			);
		}

		const data = await fetchProjectActivitiesData();
		return NextResponse.json({
			success: true,
			data,
			meta: { total_in_db: data.length, total_returned: data.length },
		});
	} catch (error) {
		console.error('Project activities report error:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	}
}
