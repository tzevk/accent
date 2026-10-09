/**
 * POST /api/admin/expenses/[id]/charges
 *
 * Approve one period consumption, depreciation, or amortization charge
 * against a non-operating item (an advance, deposit, prepayment, or capital
 * item) — ticket #317.
 *
 * A charge is an approval: it makes part of a supported balance into cost in
 * its own month, so it needs `other_expenses:approve`. The module refuses a
 * charge whose source is not confirmed cost, whose nature is operating, whose
 * amount, evidence, or currency does not fit the source, that duplicates an
 * approved charge for the same month and basis, or that would exceed the
 * remaining balance; every refusal changes nothing.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { CostError, capturePeriodCharge } from '@/lib/company-expenditure';
import type {
	CapturePeriodChargeInput,
	PeriodChargeBasis,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			PERMISSIONS.APPROVE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { id } = await params;
		const sourceId = Number(id);
		if (!Number.isInteger(sourceId) || sourceId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid cost id is required' },
				{ status: 400 }
			);
		}

		const body = (await request.json()) as Record<string, unknown>;
		const input: CapturePeriodChargeInput = {
			sourceId,
			period: String(body.period ?? ''),
			basis: body.basis as PeriodChargeBasis,
			amount:
				body.amount === undefined || body.amount === null
					? null
					: Number(body.amount),
			evidenceReference:
				body.evidence_reference === undefined
					? null
					: String(body.evidence_reference),
			currency:
				body.currency === undefined || body.currency === null
					? null
					: String(body.currency),
			reason: body.reason === undefined ? null : String(body.reason),
		};
		const charge = await capturePeriodCharge(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'approve',
			resourceType: 'expense',
			resourceId: sourceId,
			description: `Approved period ${charge.basis} charge ${charge.charge_uid} of ${charge.amount} ${charge.currency} for ${charge.period} on expense ${sourceId}`,
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
		console.error('Period charge command error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Charge failed',
			},
			{ status: 500 }
		);
	}
}
