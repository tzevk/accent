/**
 * GET /api/reports/manhours-billing/download
 *
 * Server-side Excel export for the Manhours Billing report. Same RBAC gate
 * and query contract as the JSON route. Uses exceljs (in next.config.ts
 * serverExternalPackages, server-only).
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchBillingData,
	fetchAnnualBillingData,
	getFinancialYear,
} from '@/app/reports/manhours-billing/data-source';
import {
	buildWorkbookBuffer,
	buildAnnualWorkbookBuffer,
	fileBaseForExcel,
	fileBaseForAnnualExcel,
} from '@/app/reports/manhours-billing/excel-template';

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
		const projectId = Number(url.searchParams.get('project_id'));
		const month = url.searchParams.get('month');
		const view = url.searchParams.get('view') || 'monthly';
		const fyParam =
			url.searchParams.get('fy') || url.searchParams.get('fy_year');

		if (!Number.isInteger(projectId) || projectId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid project_id is required' },
				{ status: 400 }
			);
		}

		if (view === 'annual' || (!month && fyParam)) {
			const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
			if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
				return NextResponse.json(
					{ success: false, error: 'Invalid financial year (expected YYYY)' },
					{ status: 400 }
				);
			}

			const data = await fetchAnnualBillingData(projectId, fyYear);
			if (!data) {
				return NextResponse.json(
					{ success: false, error: 'Project not found' },
					{ status: 404 }
				);
			}

			const buffer = await buildAnnualWorkbookBuffer(data);
			return new Response(new Uint8Array(buffer), {
				status: 200,
				headers: {
					'Content-Type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${fileBaseForAnnualExcel(data)}"`,
					'Cache-Control': 'no-store',
				},
			});
		}

		if (!month || !/^\d{4}-\d{2}$/.test(month)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid month (expected YYYY-MM)' },
				{ status: 400 }
			);
		}

		const data = await fetchBillingData(projectId, month);
		if (!data) {
			return NextResponse.json(
				{ success: false, error: 'Project not found' },
				{ status: 404 }
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
		console.error('Manhours billing export error:', error);
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
