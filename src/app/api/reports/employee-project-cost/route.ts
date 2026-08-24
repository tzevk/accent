/**
 * GET /api/reports/employee-project-cost
 *
 * Consolidated monthly project-cost view for one employee across every
 * project they have worked on (hours from user_activity_assignments
 * daily_entries, hourly cost from employee_salary_profile).
 *
 * Without params              → meta (employees, financial years) for the
 *                               filter bar.
 * ?employee_id=&fy=YYYY       → per-project rows with monthly hours and
 *                               monthly cost for FY YYYY (Apr–Mar).
 *
 * Access: same gate as the other report routes — super admins, users with
 * reports:read, or users holding the `project_activities` report field
 * permission.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchEmployeeCostMeta,
	fetchEmployeeProjectCost,
	getFinancialYear,
} from '@/app/reports/employee-project-cost/data-source';

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
					error:
						'You do not have permission to view the employee project cost report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const employeeIdParam = url.searchParams.get('employee_id');
		const fyParam =
			url.searchParams.get('fy') || url.searchParams.get('fy_year');

		// Meta-only request for the filter bar.
		if (!employeeIdParam && !fyParam) {
			const meta = await fetchEmployeeCostMeta();
			return NextResponse.json({ success: true, meta });
		}

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
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Employee project cost report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
