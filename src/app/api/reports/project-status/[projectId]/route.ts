import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import {
	fetchProjectMeta,
	fetchProjectActivities,
	fetchActivityStatusReport,
} from '@/app/reports/project-status/data-source';

// ── Types ──────────────────────────────────────────────────────────

interface FieldPermissionsShape {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: Record<string, { permission?: string } | undefined>;
				};
			};
		};
	};
}

interface ReportUser {
	is_super_admin?: boolean | number;
	field_permissions?: FieldPermissionsShape | string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function unauthorized(message: string) {
	return NextResponse.json({ success: false, error: message }, { status: 403 });
}

function notFound(message: string) {
	return NextResponse.json({ success: false, error: message }, { status: 404 });
}

// ── Handler ────────────────────────────────────────────────────────

/**
 * GET /api/reports/project-status/[projectId]
 *
 * Resolves a single project. Without `activity`/`from`/`to` it returns the
 * project header plus the list of activities to choose from. With those
 * params it returns the (person × day) matrix used by the print report.
 */
export async function GET(
	request: Request,
	{ params }: { params: Promise<{ projectId: string }> }
) {
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
			return unauthorized('You do not have permission to view this report');
		}

		const { projectId: projectIdRaw } = await params;
		const projectId = parseInt(projectIdRaw, 10);
		if (!Number.isFinite(projectId) || projectId <= 0) {
			return notFound('Invalid project id');
		}

		const project = await fetchProjectMeta(projectId);
		if (!project) {
			return notFound('Project not found');
		}

		const url = new URL(request.url);
		const activity = url.searchParams.get('activity')?.trim() || '';
		const subActivity = url.searchParams.get('sub_activity')?.trim() || '';
		const activityName = url.searchParams.get('activity_name')?.trim() || '';
		const from = url.searchParams.get('from')?.trim() || '';
		const to = url.searchParams.get('to')?.trim() || '';

		// ── No matrix request → return project + activity list ───────
		if (!activity || !from || !to) {
			const activities = await fetchProjectActivities(projectId);
			return NextResponse.json({
				success: true,
				data: { project, activities },
			});
		}

		// ── Matrix request → validate and build the report ──────────
		if (!ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
			return NextResponse.json(
				{
					success: false,
					error: 'Both "from" and "to" must be YYYY-MM-DD dates',
				},
				{ status: 400 }
			);
		}
		if (from > to) {
			return NextResponse.json(
				{
					success: false,
					error: '"from" date must be on or before "to" date',
				},
				{ status: 400 }
			);
		}

		const report = await fetchActivityStatusReport({
			projectId,
			activity,
			subActivityName: subActivity || undefined,
			activityName: activityName || undefined,
			from,
			to,
		});
		if (!report) {
			return notFound('Project not found');
		}

		return NextResponse.json({ success: true, data: report });
	} catch (error: unknown) {
		console.error('Project status detail error:', error);
		const message = error instanceof Error ? error.message : 'Unknown error';
		return NextResponse.json(
			{ success: false, error: message },
			{ status: 500 }
		);
	}
}
