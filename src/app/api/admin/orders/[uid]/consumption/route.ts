import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	OrderError,
	recordOrderConsumption,
	type ConsumptionSource,
	type RecordOrderConsumptionInput,
} from '@/lib/company-expenditure';

/**
 * POST /api/admin/orders/[uid]/consumption
 *
 * Record one native recognized cost slice as consumed by one supplier order
 * (#312). The amount comes from the source's frozen slice — never from the
 * request — and is stated on the order's tax basis and currency.
 *
 * Authorization is layered: `purchase_orders:update` covers the order, and the
 * financial act needs `other_expenses:approve` on top. Every command states
 * the order version and the source version it expects; a stale version, a
 * non-recognized source, an unsupported basis, or an already-consumed slice
 * fails explicitly and changes nothing.
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
		const input: RecordOrderConsumptionInput = {
			orderUid: decodeURIComponent(uid),
			costUid: String(body.cost_uid ?? ''),
			recognizedPeriod: String(body.recognized_period ?? ''),
			taxBasis: body.tax_basis as RecordOrderConsumptionInput['taxBasis'],
			expectedOrderVersion: Number(body.expected_version),
			expectedSourceVersion: Number(body.expected_source_version),
			source:
				body.source === undefined
					? undefined
					: (String(body.source) as ConsumptionSource),
			reason: body.reason === undefined ? null : String(body.reason),
			evidenceReference:
				body.evidence_reference === undefined
					? null
					: String(body.evidence_reference),
		};
		const result = await recordOrderConsumption(input, {
			id: authResult.user?.id ?? null,
		});

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'approve',
			resourceType: 'order',
			resourceId: result.order.id,
			description: `Recorded consumption ${result.consumption.amount} ${result.consumption.currency} of ${result.consumption.costUid} for ${result.consumption.recognizedPeriod} against order ${result.order.orderNumber}`,
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
