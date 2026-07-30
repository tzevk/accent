/**
 * GET /api/reports/project-activities/download/excel
 *
 * Server-side Excel export for the Project Activities report.
 * Same RBAC + filter contract as the PDF route. Uses exceljs
 * (in next.config.ts serverExternalPackages, server-only).
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectActivitiesData } from '@/app/reports/project-activities/data-source';
import {
	buildTree,
	computeKpis,
	filterTree,
} from '@/app/reports/project-activities/report-utils';
import {
	buildWorkbookBuffer,
	fileBaseForExcel,
} from '@/app/reports/project-activities/excel-template';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FieldPermissions {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: { permission?: string };
						project_reports?: { permission?: string };
					};
				};
			};
		};
	};
}

interface SessionUser {
	id: string | number;
	is_super_admin?: boolean | number;
	field_permissions?: string | FieldPermissions | null;
}

function parseFieldPermissions(
	raw: SessionUser['field_permissions']
): FieldPermissions | null {
	if (raw == null) return null;
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw) as unknown;
			return parsed && typeof parsed === 'object'
				? (parsed as FieldPermissions)
				: null;
		} catch {
			return null;
		}
	}
	return raw && typeof raw === 'object' ? raw : null;
}

function evaluatePermissions(user: SessionUser | null): {
	allowed: boolean;
} {
	if (!user) return { allowed: false };
	const isSuperAdmin =
		user.is_super_admin === true || user.is_super_admin === 1;
	const hasReportsPermission = hasPermission(
		user,
		RESOURCES.REPORTS,
		PERMISSIONS.READ
	);
	const fieldPerms = parseFieldPermissions(user.field_permissions);
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	let hasFieldPermission = false;
	if (section?.enabled) {
		const f = section.fields?.project_activities?.permission;
		const legacy = section.fields?.project_reports?.permission;
		hasFieldPermission =
			f === 'view' || f === 'edit' || legacy === 'view' || legacy === 'edit';
	}
	return {
		allowed: isSuperAdmin || hasReportsPermission || hasFieldPermission,
	};
}

export async function GET(request: Request) {
	const rawUser = await getCurrentUser(request);
	const user: SessionUser | null =
		rawUser && typeof rawUser === 'object' ? (rawUser as SessionUser) : null;

	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	const { allowed } = evaluatePermissions(user);
	if (!allowed) {
		return NextResponse.json(
			{
				success: false,
				error: 'You do not have permission to view project activities report',
			},
			{ status: 403 }
		);
	}

	const { searchParams } = new URL(request.url);
	const startDate = searchParams.get('start_date') || '';
	const endDate = searchParams.get('end_date') || '';
	const discipline = searchParams.get('discipline') || 'all';

	try {
		const raw = await fetchProjectActivitiesData({ startDate, endDate });
		const built = buildTree(raw, { startDate, endDate });
		const tree =
			discipline !== 'all' ? filterTree(built, { discipline }) : built;
		const kpis = computeKpis(tree);
		const buf = await buildWorkbookBuffer(tree, kpis, {
			startDate,
			endDate,
		});
		const filename = fileBaseForExcel({ startDate, endDate });

		return new Response(new Uint8Array(buf), {
			status: 200,
			headers: {
				'Content-Type':
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="${filename}"`,
				'Content-Length': String(buf.length),
			},
		});
	} catch (error) {
		console.error('Project activities Excel error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to generate Excel',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 }
		);
	}
}
