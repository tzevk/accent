/**
 * GET /api/reports/employee-utilization/download
 *
 * Server-side Excel export for the Employee Utilization report. Same RBAC
 * gate and query contract as the JSON route (month + optional flag narrow
 * to one band). Uses exceljs (in next.config.ts serverExternalPackages,
 * server-only).
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchUtilizationData,
	isValidUtilizationFlag,
	isValidUtilizationMonth,
	type UtilizationBand,
} from '@/app/reports/employee-utilization/data-source';
import {
	buildWorkbookBuffer,
	fileBaseForExcel,
} from '@/app/reports/employee-utilization/excel-template';

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
					error: 'You do not have permission to export this report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const month = url.searchParams.get('month') || '';
		const flagParam = url.searchParams.get('flag');

		if (!isValidUtilizationMonth(month)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month (expected YYYY-MM)' },
				{ status: 400 }
			);
		}

		let flag: UtilizationBand | null = null;
		if (flagParam !== null && flagParam !== '') {
			const normalized = flagParam.toLowerCase();
			if (!isValidUtilizationFlag(normalized)) {
				return NextResponse.json(
					{
						success: false,
						error: 'Invalid flag (expected under, healthy, or over)',
					},
					{ status: 400 }
				);
			}
			flag = normalized;
		}

		const data = await fetchUtilizationData(month, flag);
		if (!data) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month' },
				{ status: 400 }
			);
		}
		const buffer = await buildWorkbookBuffer(data);

		return new Response(new Uint8Array(buffer), {
			status: 200,
			headers: {
				'Content-Type':
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="${fileBaseForExcel(data)}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (error: unknown) {
		console.error('Utilization export error:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : 'Failed to export report',
			},
			{ status: 500 }
		);
	}
}
