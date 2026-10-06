/**
 * POST /api/admin/petty-cash-expenses/[id]/commands
 *
 * The versioned financial commands on a petty-cash spend: submit, recognize,
 * reject, cancel, and update. Recognition is the authorizing act that turns
 * actual spending into confirmed cost (or records the settlement of another
 * cost), so it carries its own privilege — `petty_cash_expenses:approve` —
 * while drafting and editing need `petty_cash_expenses:update`.
 *
 * Every command states the version it expects. A stale version, a command the
 * current state does not allow, spending that is not ready for recognition, a
 * missing reason, or a link that does not resolve all fail explicitly and
 * change nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executePettyCashCommand,
	pettyCashCommandInputFromJson,
} from '@/lib/company-expenditure';
import type {
	CostCommandName,
	PettyCashSpendPatch,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recognition and refusal are approvals; drafting and edits are updates. */
function permissionFor(command: CostCommandName): string {
	return command === 'update' || command === 'submit'
		? PERMISSIONS.UPDATE
		: PERMISSIONS.APPROVE;
}

/**
 * A currency or conversion-evidence change reprices the cost: the currency
 * pair is approval territory (`currency.ts` contract §4), so an `update` that
 * touches any of these fields needs `petty_cash_expenses:approve`.
 */
function patchTouchesCurrency(patch: PettyCashSpendPatch | undefined): boolean {
	if (!patch) return false;
	return (
		patch.currency !== undefined ||
		patch.reportingCurrency !== undefined ||
		patch.conversionRate !== undefined ||
		patch.conversionDate !== undefined ||
		patch.conversionEvidenceReference !== undefined
	);
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const body = (await request.json()) as Record<string, unknown>;

		// Parse the command before authorizing: an unknown command is a 400,
		// never a permission decision.
		let input;
		try {
			input = pettyCashCommandInputFromJson(id, body);
		} catch (error) {
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
			throw error;
		}

		const authResult = await ensurePermission(
			request,
			RESOURCES.PETTY_CASH_EXPENSES,
			input.command === 'update' && patchTouchesCurrency(input.patch)
				? PERMISSIONS.APPROVE
				: permissionFor(input.command)
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const result = await executePettyCashCommand(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: input.command === 'recognize' ? 'approve' : 'update',
			resourceType: 'petty_cash_expense',
			resourceId: id,
			description: `Petty-cash spend ${input.command} (version ${result.financial_version}) for ${id}`,
			request,
		});

		return NextResponse.json({ success: true, data: result });
	} catch (error) {
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
		console.error('Petty-cash cost command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
