import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectStatusData } from '@/app/reports/project-status/data-source';

// ── Types ──────────────────────────────────────────────────────────

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: {
							permission?: string;
						};
						project_reports?: {
							permission?: string;
						};
					};
				};
			};
		};
	};
}

interface ReportUser {
	id: number;
	email: string;
	is_super_admin: boolean | number;
	field_permissions?: string | FieldPermissionsShape | null;
}

// ── Permission helpers ─────────────────────────────────────────────

function hasProjectActivitiesFieldPermission(
	user: ReportUser | null | undefined
): boolean {
	if (!user) return false;
	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms) as FieldPermissionsShape;
		} catch {
			fieldPerms = null;
		}
	}
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	if (!section?.enabled) return false;
	const perm = section.fields?.project_activities?.permission;
	const legacy = section.fields?.project_reports?.permission;
	return (
		perm === 'view' || perm === 'edit' || legacy === 'view' || legacy === 'edit'
	);
}

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
