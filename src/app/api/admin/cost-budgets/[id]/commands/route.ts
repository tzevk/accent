/**
 * POST /api/admin/cost-budgets/{id}/commands
 *
 * The versioned commands on a Project cost budget: update, submit, approve,
 * and withdraw. Approval is the authorizing act that makes a budget comparable,
 * so it carries its own privilege — `other_expenses:approve` — and requires the
 * approval evidence the comparison later cites. Drafting, submitting, and
 * withdrawing need `other_expenses:update`.
 *
 * Every command states the version it expects. A stale version, a command the
 * current state does not allow, or a missing approval evidence fails explicitly
 * and changes nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { hasPermission } from '@/utils/rbac';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executeBudgetCommand,
	isCostBudgetScope,
} from '@/lib/company-expenditure';
import type {
	CostBudgetCommandInput,
	CostBudgetCommandName,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS: CostBudgetCommandName[] = [
	'update',
	'submit',
	'approve',
	'withdraw',
];

/** Approval is an approval; drafting, submitting, and withdrawal are updates. */
function permissionFor(command: CostBudgetCommandName): string {
	return command === 'approve' ? PERMISSIONS.APPROVE : PERMISSIONS.UPDATE;
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const command = String(body.command ?? '') as CostBudgetCommandName;
		if (!COMMANDS.includes(command)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown command: ${body.command ?? ''}`,
					code: 'invalid_command',
				},
				{ status: 400 }
			);
		}

		const authResult = await ensurePermission(
			request,
			// No COST_BUDGETS resource exists; OTHER_EXPENSES is the existing
			// expense-ledger resource this financial control extends.
			RESOURCES.OTHER_EXPENSES,
			permissionFor(command)
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		const budgetId = Number(id);
		if (!Number.isInteger(budgetId) || budgetId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid cost budget id is required' },
				{ status: 400 }
			);
		}
		const expectedVersion = Number(body.expected_version);
		if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
			return NextResponse.json(
				{
					success: false,
					error: 'expected_version is required',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}

		const patchBody =
			body.patch && typeof body.patch === 'object'
				? (body.patch as Record<string, unknown>)
				: {};
		const patchScope = patchBody.scope;
		const input: CostBudgetCommandInput = {
			id: budgetId,
			command,
			expectedVersion,
			reason: body.reason === undefined ? null : String(body.reason),
			evidenceReference:
				body.evidence_reference === undefined
					? undefined
					: String(body.evidence_reference),
			// The command's own gate is `other_expenses:update`; withdrawing an
			// approved budget needs the approval privilege too, so the caller's
			// fact travels with the command and the module enforces it under its
			// row lock.
			actorCanApprove: hasPermission(
				authResult.user,
				RESOURCES.OTHER_EXPENSES,
				PERMISSIONS.APPROVE
			),
			patch: {
				currency:
					patchBody.currency === undefined
						? undefined
						: String(patchBody.currency),
				amount:
					patchBody.amount === undefined ? undefined : Number(patchBody.amount),
				scope: isCostBudgetScope(patchScope) ? patchScope : undefined,
				periodStart:
					patchBody.period_start === undefined
						? undefined
						: String(patchBody.period_start),
				periodEnd:
					patchBody.period_end === undefined
						? undefined
						: String(patchBody.period_end),
				basisNote:
					patchBody.basis_note === undefined || patchBody.basis_note === null
						? undefined
						: String(patchBody.basis_note),
			},
		};
		if (patchScope !== undefined && !isCostBudgetScope(patchScope)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown budget scope: ${String(patchScope)}`,
					code: 'invalid_scope',
				},
				{ status: 422 }
			);
		}

		const result = await executeBudgetCommand(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: command === 'approve' ? 'approve' : 'update',
			resourceType: 'project_cost_budget',
			resourceId: budgetId,
			description: `Cost budget ${command} (version ${result.financial_version}) for budget ${budgetId}`,
			request,
		});

		return NextResponse.json({ success: true, data: result });
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
		console.error('Cost budget command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
