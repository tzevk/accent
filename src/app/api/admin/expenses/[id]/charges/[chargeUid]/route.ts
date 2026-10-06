/**
 * POST /api/admin/expenses/[id]/charges/[chargeUid]
 *
 * Cancel an approved period charge (ticket #317). Cancelling is versioned and
 * reasoned: the charge stops counting as cost, the balance it consumed becomes
 * available again, and the row and its journal keep both approvals as history.
 * It needs `other_expenses:approve`; a stale version or a missing reason
 * changes nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { CostError, cancelPeriodCharge } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string; chargeUid: string }> }
) {
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			PERMISSIONS.APPROVE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id, chargeUid } = await params;
		const sourceId = Number(id);
		if (!Number.isInteger(sourceId) || sourceId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid cost id is required' },
				{ status: 400 }
			);
		}

		const body = (await request.json()) as Record<string, unknown>;
		if (String(body.command ?? '') !== 'cancel') {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown command: ${body.command ?? ''}`,
					code: 'invalid_command',
				},
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

		const charge = await cancelPeriodCharge(
			{
				chargeUid,
				command: 'cancel',
				expectedVersion,
				reason: body.reason === undefined ? null : String(body.reason),
			},
			{ id: authResult.user?.id ?? null }
		);

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'update',
			resourceType: 'expense',
			resourceId: sourceId,
			description: `Cancelled period charge ${charge.charge_uid} (version ${charge.financial_version}) for expense ${sourceId}`,
			request,
		});

		return NextResponse.json({ success: true, data: charge });
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
		console.error('Period charge cancellation error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Cancellation failed',
			},
			{ status: 500 }
		);
	}
}
