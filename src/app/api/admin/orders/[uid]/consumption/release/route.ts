import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	OrderError,
	releaseOrderConsumption,
	type ReleaseOrderConsumptionInput,
} from '@/lib/company-expenditure';

/**
 * POST /api/admin/orders/[uid]/consumption/release
 *
 * Release one recorded consumption with its reason and evidence (#312). The
 * released row keeps its history and frees its native slice; a correction is
 * release + re-record, never an in-place amount edit. The same layered
 * authorization as recording applies: `purchase_orders:update` plus
 * `other_expenses:approve`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ uid: string }> }
) {
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.PURCHASE_ORDERS,
			PERMISSIONS.UPDATE
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const approval = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			PERMISSIONS.APPROVE
		);
		if (approval instanceof Response) return approval;
		if (!approval.authorized) return approval.response;

		const body = (await request.json()) as Record<string, unknown>;
		const { uid } = await params;
		const input: ReleaseOrderConsumptionInput = {
			orderUid: decodeURIComponent(uid),
			consumptionId: Number(body.consumption_id),
			expectedVersion: Number(body.expected_version),
			reason: body.reason === undefined ? null : String(body.reason),
			evidenceReference:
				body.evidence_reference === undefined
					? null
					: String(body.evidence_reference),
		};
		const result = await releaseOrderConsumption(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'update',
			resourceType: 'order',
			resourceId: result.order.id,
			description: `Released consumption #${input.consumptionId} of ${result.consumption.costUid} on order ${result.order.orderNumber}`,
			request,
		});

		return NextResponse.json({ success: true, data: result });
	} catch (error: unknown) {
		if (error instanceof OrderError) {
			return NextResponse.json(
				{
					success: false,
					message: error.message,
					error: error.message,
					code: error.code,
					...error.detail,
				},
				{ status: error.status }
			);
		}
		if (error instanceof SyntaxError) {
			return NextResponse.json(
				{ success: false, error: 'Invalid JSON body', code: 'invalid_body' },
				{ status: 400 }
			);
		}
		throw error;
	}
}
