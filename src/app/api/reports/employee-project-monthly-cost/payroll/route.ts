/**
 * GET /api/reports/employee-project-monthly-cost/payroll
 *
 * The employee-cost drilldown behind the company expenditure reconciliation:
 * one row per Employee with recorded employer cost, Payroll-based estimates,
 * Logged Hours by Project, the source Payroll Slip, and the No project / No
 * logged hours detail (#307, ADR-0016).
 *
 * Query: `month=YYYY-MM` (required), `employee_id=` (optional; when given the
 * response's totals describe the returned Employee).
 *
 * Access: super admins, or `reports:read` **and** `other_expenses:read` **and**
 * `payroll:read` — the same source gate as the expenditure view, because the
 * rows carry payroll amounts.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchPayrollDrilldown } from '@/lib/company-expenditure';

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
		const authorized =
			isSuperAdmin ||
			(hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ) &&
				hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
				hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ));
		if (!authorized) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view employee cost',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const month = url.searchParams.get('month');
		if (!month || !/^\d{4}-\d{2}$/.test(month)) {
			return NextResponse.json(
				{
					success: false,
					error: 'Valid month (YYYY-MM) is required',
				},
				{ status: 400 }
			);
		}
		const monthNumber = Number(month.slice(5, 7));
		if (monthNumber < 1 || monthNumber > 12) {
			return NextResponse.json(
				{ success: false, error: 'Valid month (YYYY-MM) is required' },
				{ status: 400 }
			);
		}

		const employeeIdParam = url.searchParams.get('employee_id');
		let employeeId: number | null = null;
		if (employeeIdParam !== null && employeeIdParam !== '') {
			employeeId = Number(employeeIdParam);
			if (!Number.isInteger(employeeId) || employeeId <= 0) {
				return NextResponse.json(
					{ success: false, error: 'Valid employee_id is required' },
					{ status: 400 }
				);
			}
		}

		const data = await fetchPayrollDrilldown(month, employeeId);
		if (employeeId !== null && data.employees.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Employee not found for this month' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Employee cost drilldown error:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : 'Failed to load drilldown',
			},
			{ status: 500 }
		);
	}
}
