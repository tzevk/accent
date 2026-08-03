import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import {
	fetchProjectMeta,
	fetchProjectRoster,
	fetchActivityStatusReport,
} from '@/app/reports/project-status/data-source';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Permission helpers ─────────────────────────────────────────────

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
 * Resolves a single project. Without `from`/`to` it returns the project
 * header plus its roster (for the employee filter); with them it returns
 * the (person × day) matrix — aggregated across every activity — used by
 * the print report. An optional `user_id` narrows the matrix to one
 * employee.
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
		const from = url.searchParams.get('from')?.trim() || '';
		const to = url.searchParams.get('to')?.trim() || '';
		const userId = url.searchParams.get('user_id')?.trim() || '';

		// ── No date range → project header + roster ────────────────
		if (!from || !to) {
			const roster = await fetchProjectRoster(projectId);
			return NextResponse.json({
				success: true,
				data: { project, roster },
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
			from,
			to,
			userIds: userId ? [userId] : undefined,
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
