/**
 * GET /api/reports/employee-project-monthly-cost/download
 *
 * Server-side Excel export for the Employee Project Monthly Cost report.
 * Same RBAC gate and query contract as the JSON route. Uses exceljs (in
 * next.config.ts serverExternalPackages, server-only). Supports:
 * - legacy: ?employee_id=&fy=YYYY
 * - monthly: ?view=monthly&month=YYYY-MM
 * - fy: ?view=fy&fy=YYYY (or fy_year)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchEmployeeProjectCost,
	fetchFYCompanyCost,
	fetchMonthlyCompanyCost,
	getFinancialYear,
} from '@/app/reports/employee-project-monthly-cost/data-source';
import {
	buildWorkbookBuffer as buildLegacyWorkbookBuffer,
	fileBaseForExcel as fileBaseForLegacyExcel,
	buildFYWorkbookBuffer,
	buildMonthlyWorkbookBuffer,
	fileBaseForFYExcel,
	fileBaseForMonthlyExcel,
} from '@/app/reports/employee-project-monthly-cost/excel-template';

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
		const employeeIdParam = url.searchParams.get('employee_id');
		const fyParam =
			url.searchParams.get('fy') || url.searchParams.get('fy_year');
		const monthParam = url.searchParams.get('month');
		const viewParam = (url.searchParams.get('view') || '').toLowerCase();

		// Legacy per-employee export
		if (employeeIdParam) {
			const employeeId = Number(employeeIdParam);
			if (!Number.isInteger(employeeId) || employeeId <= 0) {
				return NextResponse.json(
					{ success: false, error: 'Valid employee_id is required' },
					{ status: 400 }
				);
			}
			const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
			if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
				return NextResponse.json(
					{ success: false, error: 'Invalid financial year (expected YYYY)' },
					{ status: 400 }
				);
			}
			const data = await fetchEmployeeProjectCost(employeeId, fyYear);
			if (!data) {
				return NextResponse.json(
					{ success: false, error: 'Employee not found' },
					{ status: 404 }
				);
			}
			const buffer = await buildLegacyWorkbookBuffer(data);
			return new Response(new Uint8Array(buffer), {
				status: 200,
				headers: {
					'Content-Type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${fileBaseForLegacyExcel(data)}"`,
					'Cache-Control': 'no-store',
				},
			});
		}

		// Monthly company export
		if (viewParam === 'monthly' || monthParam) {
			const month = monthParam || '';
			if (!month || !/^\d{4}-\d{2}$/.test(month)) {
				return NextResponse.json(
					{ success: false, error: 'Valid month (YYYY-MM) is required' },
					{ status: 400 }
				);
			}
			const data = await fetchMonthlyCompanyCost(month);
			if (!data) {
				return NextResponse.json(
					{ success: false, error: 'Invalid month' },
					{ status: 400 }
				);
			}
			const buffer = await buildMonthlyWorkbookBuffer(data);
			return new Response(new Uint8Array(buffer), {
				status: 200,
				headers: {
					'Content-Type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${fileBaseForMonthlyExcel(data)}"`,
					'Cache-Control': 'no-store',
				},
			});
		}

		// FY company export (default for fy param or view=fy/annual)
		const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
		if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
			return NextResponse.json(
				{ success: false, error: 'Invalid financial year (expected YYYY)' },
				{ status: 400 }
			);
		}
		const data = await fetchFYCompanyCost(fyYear);
		const buffer = await buildFYWorkbookBuffer(data);
		return new Response(new Uint8Array(buffer), {
			status: 200,
			headers: {
				'Content-Type':
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="${fileBaseForFYExcel(data)}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (error: unknown) {
		console.error('Employee project monthly cost export error:', error);
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
