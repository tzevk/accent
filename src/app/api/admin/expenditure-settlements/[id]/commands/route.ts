/**
 * POST /api/admin/expenditure-settlements/[id]/commands
 *   `{ command: 'update'|'cancel', expected_version, patch?, reason?,
 *      evidence_reference? }` — correct or reverse one recorded settlement.
 *   A stale version changes nothing (409 `stale_version`); a cancelled
 *   settlement keeps its history (409 `settlement_cancelled`).
 *
 * Access: `other_expenses:update` **and** `payroll:read` (super admin
 * bypasses), the same register write gate as the collection route.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executeSettlementCommand,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS = ['update', 'cancel'];

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}
	const isSuperAdmin =
		user.is_super_admin === true || user.is_super_admin === 1;
	if (
		!isSuperAdmin &&
		!(
			hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.UPDATE) &&
			hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ)
		)
	) {
		return NextResponse.json(
			{
				success: false,
				error: 'You do not have permission to change outward cash settlements',
			},
			{ status: 403 }
		);
	}

	try {
		const { id } = await params;
		const numericId = Number(id);
		if (!Number.isInteger(numericId) || numericId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid settlement id is required' },
				{ status: 400 }
			);
		}
		const body = (await request.json()) as Record<string, unknown>;
		const command = String(body.command ?? '');
		if (!COMMANDS.includes(command)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown settlement command: ${command || '(missing)'}`,
					code: 'invalid_command',
				},
				{ status: 400 }
			);
		}
		const expectedVersion = body.expected_version;
		if (expectedVersion === undefined || expectedVersion === null) {
			return NextResponse.json(
				{
					success: false,
					error: 'The command must present the version it read (expected_version)',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}
		const patch = (body.patch ?? null) as Record<string, unknown> | null;
		const settlement = await executeSettlementCommand(
			{
				id: numericId,
				command: command as 'update' | 'cancel',
				expectedVersion: Number(expectedVersion),
				patch: patch
					? {
							amount:
								patch.amount === undefined || patch.amount === null
									? null
									: Number(patch.amount),
							currency:
								patch.currency === undefined || patch.currency === null
									? null
									: String(patch.currency),
							settledOn:
								patch.settled_on === undefined || patch.settled_on === null
									? null
									: String(patch.settled_on),
							reference:
								patch.reference === undefined || patch.reference === null
									? undefined
									: String(patch.reference),
							destination:
								patch.destination === undefined || patch.destination === null
									? undefined
									: String(patch.destination),
							evidenceReference:
								patch.evidence_reference === undefined ||
								patch.evidence_reference === null
									? undefined
									: String(patch.evidence_reference),
						}
					: null,
				reason:
					body.reason === undefined || body.reason === null
						? null
						: String(body.reason),
				evidenceReference:
					body.evidence_reference === undefined ||
					body.evidence_reference === null
						? null
						: String(body.evidence_reference),
			},
			{ id: user?.id ?? null }
		);

		await logActivity({
			userId: user?.id,
			actionType: command === 'cancel' ? 'cancel' : 'update',
			resourceType: 'financial_settlement',
			resourceId: settlement.id,
			description: `${command === 'cancel' ? 'Cancelled' : 'Updated'} outward settlement ${settlement.settlement_uid} (version ${settlement.financial_version})`,
			request,
		});

		return NextResponse.json({ success: true, data: settlement });
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
		console.error('Expenditure settlement command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to run command',
			},
			{ status: 500 }
		);
	}
}
