/**
 * GET  /api/admin/cost-budgets?project_id=N
 *   One Project's cost budgets in every state, with the version and approval
 *   evidence a later command must present.
 * POST /api/admin/cost-budgets
 *   Record a draft Project cost budget: Project, amount, currency, scope, and
 *   period. Recording approves nothing; approval is a versioned command.
 *
 * Access: the source privileges of the cost ledger this financial control
 * extends — `other_expenses:read` to read budgets, `other_expenses:update` to
 * record or draft them. Approving one requires `other_expenses:approve`
 * (see `./[id]/commands`). Project Activity access opens none of this.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	fetchProjectBudgets,
	isCostBudgetScope,
	recordCostBudget,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const { searchParams } = new URL(request.url);
		const projectId = Number(searchParams.get('project_id'));
		if (!Number.isInteger(projectId) || projectId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid project_id is required' },
				{ status: 400 }
			);
		}
		const budgets = await fetchProjectBudgets(projectId);
		return NextResponse.json({
			success: true,
			data: { project_id: projectId, budgets },
		});
	} catch (error: unknown) {
		console.error('Cost budget list error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load',
			},
			{ status: 500 }
		);
	}
}

export async function POST(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = (await request.json()) as Record<string, unknown>;
		const raw = (key: string): unknown => {
			const value = body[key];
			return value === undefined || value === null ? undefined : value;
		};
		const scope = raw('scope');
		if (scope !== undefined && !isCostBudgetScope(scope)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown budget scope: ${String(scope)}`,
					code: 'invalid_scope',
				},
				{ status: 422 }
			);
		}
		const currency = raw('currency');
		const amount = raw('amount');
		const periodStart = raw('period_start');
		const periodEnd = raw('period_end');
		const basisNote = raw('basis_note');

		const budget = await recordCostBudget(
			{
				projectId: Number(raw('project_id')),
				currency: currency === undefined ? undefined : String(currency),
				amount: amount === undefined ? undefined : Number(amount),
				scope: isCostBudgetScope(scope) ? scope : undefined,
				periodStart:
					periodStart === undefined ? undefined : String(periodStart),
				periodEnd: periodEnd === undefined ? undefined : String(periodEnd),
				basisNote: basisNote === undefined ? null : String(basisNote),
			},
			{ id: authResult.user?.id ?? null }
		);

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'create',
			resourceType: 'project_cost_budget',
			resourceId: budget.id,
			description: `Recorded cost budget ${budget.budget_uid} for Project ${budget.project_id} (${budget.amount} ${budget.currency})`,
			request,
		});

		return NextResponse.json({ success: true, data: budget }, { status: 201 });
	} catch (error: unknown) {
		if (error instanceof CostError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		console.error('Cost budget record error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to record',
			},
			{ status: 500 }
		);
	}
}
