import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasProjectActivitiesFieldPermission } from '@/utils/report-permissions';
import {
	fetchUtilizationMeta,
	fetchUtilizationData,
	isValidUtilizationMonth,
	isValidUtilizationFlag,
	type UtilizationBand,
} from '@/app/reports/employee-utilization/data-source';

/**
 * GET /api/reports/employee-utilization
 *
 * Team utilization report for one month: one row per active employee with
 * capacity, logged hours, utilization plus band flag, monthly/bench costs,
 * and totals — sorted by flag band, then bench cost descending.
 *
 * Without params  → meta (months with data + flag options) for the filter bar.
 * ?month=YYYY-MM  → the team rows and totals for that month.
 * ?month=&flag=   → the same month narrowed to one band
 *                   (under | healthy | over).
 *
 * Access: super admins, users with reports:read, or users with the
 * `project_activities` report field permission (view/edit) — the same gate
 * used by the other report routes.
 *
 * Capacity is always full-month (no mid-month pro-rating in v1).
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
					error: 'You do not have permission to view the utilization report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const month = url.searchParams.get('month');
		const flagParam = url.searchParams.get('flag');

		// Meta-only request: fill the filter bar.
		if (!month) {
			const meta = await fetchUtilizationMeta();
			return NextResponse.json({ success: true, meta, data: null });
		}

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
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Utilization report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
