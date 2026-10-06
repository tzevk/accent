/**
 * POST /api/admin/expenses/[id]/commands
 *
 * The versioned financial commands on a direct cost: submit, recognize,
 * reject, cancel, and update. Recognition is the authorizing act that turns a
 * recorded expense into confirmed cost, so it carries its own privilege —
 * `other_expenses:approve` — while drafting and editing need
 * `other_expenses:update`.
 *
 * Every command states the version it expects. A stale version, a command the
 * current state does not allow, a cost that is not ready for recognition, or a
 * missing reason all fail explicitly and change nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executeCommand,
} from '@/lib/company-expenditure';
import type { CostCommandInput, CostCommandName } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS: CostCommandName[] = [
	'update',
	'submit',
	'recognize',
	'reject',
	'cancel',
];

/**
 * Conversion evidence reprices cost in the reporting currency, so setting or
 * changing it is an approval act even though it travels in an `update`
 * command; every other field edit stays `other_expenses:update`.
 */
const CONVERSION_PATCH_FIELDS = [
	'reportingCurrency',
	'conversionRate',
	'conversionDate',
	'conversionEvidenceReference',
] as const;

/** Recognition and refusal are approvals; drafting and edits are updates. */
function permissionFor(
	command: CostCommandName,
	patch: Record<string, unknown> | undefined
): string {
	if (command === 'update' || command === 'submit') {
		const touchesConversion =
			patch !== undefined &&
			CONVERSION_PATCH_FIELDS.some((field) => patch[field] !== undefined);
		return touchesConversion ? PERMISSIONS.APPROVE : PERMISSIONS.UPDATE;
	}
	return PERMISSIONS.APPROVE;
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const command = String(body.command ?? '') as CostCommandName;
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
			// No EXPENSES resource exists; OTHER_EXPENSES is the existing
			// expense-ledger resource this workflow extends.
			RESOURCES.OTHER_EXPENSES,
			permissionFor(
				command,
				body.patch as Record<string, unknown> | undefined
			)
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		const costId = Number(id);
		if (!Number.isInteger(costId) || costId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid cost id is required' },
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

		const input: CostCommandInput = {
			id: costId,
			command,
			expectedVersion,
			reason: body.reason === undefined ? null : String(body.reason),
			evidenceReference:
				body.evidence_reference === undefined
					? undefined
					: String(body.evidence_reference),
			patch: (body.patch ?? undefined) as CostCommandInput['patch'],
		};
		const result = await executeCommand(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: command === 'recognize' ? 'approve' : 'update',
			resourceType: 'expense',
			resourceId: costId,
			description: `Cost ${command} (version ${result.financial_version}) for expense ${costId}`,
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
		console.error('Expense cost command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Command failed',
			},
			{ status: 500 }
		);
	}
}
