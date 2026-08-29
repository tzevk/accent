/**
 * GET /api/reports/employee-project-monthly-cost
 *
 * Company-wide monthly project-cost view across all employees and all projects
 * (hours from user_activity_assignments daily_entries, hourly cost from
 * employee_salary_profile). Supports two viewing modes plus legacy per-employee.
 *
 * Without params              → meta (months, financial years, employees) for filter bar
 * ?view=monthly&month=YYYY-MM → company total for single month (breakdowns per employee/project)
 * ?view=fy&fy=YYYY            → FY matrix (Apr–Mar) with monthly company totals
 * ?employee_id=&fy=YYYY       → legacy per-employee FY matrix (backward compat)
 *
 * Access: same gate as the other report routes — super admins, users with
 * reports:read, or users holding the `project_activities` report field permission.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchCompanyCostMeta,
	fetchEmployeeCostMeta,
	fetchEmployeeProjectCost,
	fetchFYCompanyCost,
	fetchMonthlyCompanyCost,
	getFinancialYear,
} from '@/app/reports/employee-project-monthly-cost/data-source';

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
		const monthParam = url.searchParams.get('month');
		const viewParam = url.searchParams.get('view');

		// Meta-only request for the filter bar.
		if (!employeeIdParam && !fyParam && !monthParam && !viewParam) {
			const [companyMeta, legacyMeta] = await Promise.all([
				fetchCompanyCostMeta(),
				fetchEmployeeCostMeta(),
			]);
			// Merge so old and new clients both work; new UI reads months/fy, old reads employees
			const meta = {
				...companyMeta,
				employees: legacyMeta.employees,
				financial_years: companyMeta.financial_years,
				current_fy: companyMeta.current_fy,
			};
			return NextResponse.json({ success: true, meta });
		}

		// Legacy per-employee view (backward compat): employee_id wins if present
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
			return NextResponse.json({ success: true, data, view: 'legacy' });
		}

		// Explicit view param handling
		const view = (viewParam || '').toLowerCase();
		if (view === 'monthly' || monthParam) {
			const month = monthParam || url.searchParams.get('month');
			if (!month || !/^\d{4}-\d{2}$/.test(month)) {
				return NextResponse.json(
					{
						success: false,
						error: 'Valid month (YYYY-MM) is required for monthly view',
					},
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
			return NextResponse.json({ success: true, data, view: 'monthly' });
		}

		if (
			view === 'fy' ||
			view === 'annual' ||
			view === 'financial_year' ||
			fyParam
		) {
			const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
			if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
				return NextResponse.json(
					{ success: false, error: 'Invalid financial year (expected YYYY)' },
					{ status: 400 }
				);
			}
			const data = await fetchFYCompanyCost(fyYear);
			return NextResponse.json({ success: true, data, view: 'fy' });
		}

		// Fallback: no recognized params -> meta
		const [companyMeta, legacyMeta] = await Promise.all([
			fetchCompanyCostMeta(),
			fetchEmployeeCostMeta(),
		]);
		const meta = {
			...companyMeta,
			employees: legacyMeta.employees,
		};
		return NextResponse.json({ success: true, meta });
	} catch (error: unknown) {
		console.error('Employee project monthly cost report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
