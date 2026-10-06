/**
 * GET /api/reports/employee-project-monthly-cost/expenses
 *
 * Source drilldown for the company expenditure reconciliation: the direct
 * cost records behind a month's figures, with their cost identity, evidence
 * state, and the version a command must present.
 *
 * Query: month=YYYY-MM (required), state, classification, project_id, limit,
 * offset. Gates on the financial reporting privilege (`reports:read`) *and*
 * the expense ledger's source read privilege (`other_expenses:read`), matching
 * the reconciliation it drills into — report access alone, and Project
 * Activity access, must not reveal supplier and expense detail.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchCostDrilldown } from '@/lib/company-expenditure';
import type { CostDrilldownQuery } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATES = [
	'all',
	'recognized',
	'pending_evidence',
	'draft',
	'rejected',
	'cancelled',
	'unconfirmed',
	'unresolved',
] as const;

const CLASSIFICATIONS = [
	'all',
	'project',
	'company_overhead',
	'unallocated',
	'unresolved',
] as const;

const NATURES = [
	'all',
	'operating',
	'non_operating',
	'advance',
	'deposit',
	'prepayment',
	'capital',
	'unresolved',
] as const;

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
		// The drilldown reads the direct-expense ledger: report access alone is
		// not enough, the source's own read privilege is required as well.
		const allowed =
			isSuperAdmin ||
			(hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ) &&
				hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ));
		if (!allowed) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to view company expenditure',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const month = url.searchParams.get('month');
		if (!month || !/^\d{4}-\d{2}$/.test(month)) {
			return NextResponse.json(
				{ success: false, error: 'Valid month (YYYY-MM) is required' },
				{ status: 400 }
			);
		}
		const state = url.searchParams.get('state') ?? 'all';
		if (!STATES.includes(state as (typeof STATES)[number])) {
			return NextResponse.json(
				{ success: false, error: `Unknown state filter: ${state}` },
				{ status: 400 }
			);
		}
		const classification = url.searchParams.get('classification') ?? 'all';
		if (
			!CLASSIFICATIONS.includes(classification as (typeof CLASSIFICATIONS)[number])
		) {
			return NextResponse.json(
				{ success: false, error: `Unknown classification: ${classification}` },
				{ status: 400 }
			);
		}
		const nature = url.searchParams.get('nature') ?? 'all';
		if (!NATURES.includes(nature as (typeof NATURES)[number])) {
			return NextResponse.json(
				{ success: false, error: `Unknown nature: ${nature}` },
				{ status: 400 }
			);
		}
		let projectId: number | null = null;
		const projectParam = url.searchParams.get('project_id');
		if (projectParam) {
			projectId = Number(projectParam);
			if (!Number.isInteger(projectId) || projectId <= 0) {
				return NextResponse.json(
					{ success: false, error: 'Valid project_id is required' },
					{ status: 400 }
				);
			}
		}

		const limitParam = url.searchParams.get('limit');
		const limit = limitParam === null ? 50 : Number(limitParam);
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
			return NextResponse.json(
				{ success: false, error: 'Valid limit (1-200) is required' },
				{ status: 400 }
			);
		}
		const offsetParam = url.searchParams.get('offset');
		const offset = offsetParam === null ? 0 : Number(offsetParam);
		if (!Number.isInteger(offset) || offset < 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid offset (0 or more) is required' },
				{ status: 400 }
			);
		}

		const query: CostDrilldownQuery = {
			month,
			state: state as CostDrilldownQuery['state'],
			classification: classification as CostDrilldownQuery['classification'],
			nature: nature as CostDrilldownQuery['nature'],
			projectId,
			limit,
			offset,
		};
		const data = await fetchCostDrilldown(query);
		return NextResponse.json({ success: true, data });
	} catch (error: unknown) {
		console.error('Company expenditure drilldown error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load cost',
			},
			{ status: 500 }
		);
	}
}
