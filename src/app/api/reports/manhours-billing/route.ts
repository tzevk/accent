import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchBillingMeta,
	fetchBillingData,
	fetchAnnualBillingData,
	getFinancialYear,
} from '@/app/reports/manhours-billing/data-source';

/**
 * GET /api/reports/manhours-billing
 *
 * Manhours billing report for one client project and month.
 *
 * Without params              → meta (clients, projects, months with data)
 *                               for the filter bar.
 * ?project_id=&month=         → the billing rows (employees with logged
 *                               manhours, salary CTC, hourly rate, amount)
 *                               for that project and month.
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit) — the same gate
 * used by the other report routes.
 *
 * Uses pool.execute (via query()) — no long-held connection.
 */

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
						'You do not have permission to view the manhours billing report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const projectIdParam = url.searchParams.get('project_id');
		const month = url.searchParams.get('month');
		const view = url.searchParams.get('view') || 'monthly';
		const fyParam =
			url.searchParams.get('fy') || url.searchParams.get('fy_year');

		// Meta-only request when neither full monthly params nor annual params are provided
		if (!projectIdParam || (view !== 'annual' && !month && !fyParam)) {
			const meta = await fetchBillingMeta();
			return NextResponse.json({ success: true, meta });
		}

		const projectId = Number(projectIdParam);
		if (!Number.isInteger(projectId) || projectId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Invalid project_id' },
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
			return NextResponse.json({ success: true, data, view: 'annual' });
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
		return NextResponse.json({ success: true, data, view: 'monthly' });
	} catch (error: unknown) {
		console.error('Manhours billing report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
