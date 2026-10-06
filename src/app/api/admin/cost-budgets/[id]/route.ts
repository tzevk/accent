/**
 * GET /api/admin/cost-budgets/{id}
 *
 * One cost budget with its append-only approval journal: the amount, currency,
 * scope, period, approval evidence, actor, and every version that produced the
 * current state. A superseded version stays readable here, so a closed period
 * can still be explained.
 *
 * Access: `other_expenses:read` (super admins bypass) — the same source
 * privilege the cost ledger next to it uses.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchCostBudget } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const { id } = await params;
		const budgetId = Number(id);
		if (!Number.isInteger(budgetId) || budgetId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid cost budget id is required' },
				{ status: 400 }
			);
		}
		const detail = await fetchCostBudget(budgetId);
		if (!detail) {
			return NextResponse.json(
				{ success: false, error: 'Cost budget not found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data: detail });
	} catch (error: unknown) {
		console.error('Cost budget read error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load',
			},
			{ status: 500 }
		);
	}
}
