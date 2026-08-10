/**
 * GET /api/reports/timesheet-report/download
 *
 * Server-side Excel export for the Timesheet report. Same RBAC gate and
 * query contract as the JSON route. Uses exceljs (in next.config.ts
 * serverExternalPackages, server-only).
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import { fetchTimesheetData } from '@/app/reports/timesheet-report/data-source';
import {
	buildWorkbookBuffer,
	fileBaseForExcel,
} from '@/app/reports/timesheet-report/excel-template';

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
		const employeeId = Number(url.searchParams.get('employee_id'));
		const month = url.searchParams.get('month');

		if (!Number.isInteger(employeeId) || employeeId <= 0 || !month) {
			return NextResponse.json(
				{ success: false, error: 'employee_id and month are required' },
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
		console.error('Timesheet export error:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : 'Failed to export timesheet',
			},
			{ status: 500 }
		);
	}
}
