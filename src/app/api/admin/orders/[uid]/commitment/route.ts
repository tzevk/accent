import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { fetchOrderCommitment, OrderError } from '@/lib/company-expenditure';

/**
 * GET /api/admin/orders/[uid]/commitment
 *
 * One supplier order's Outstanding Supplier Commitment detail (#312): the
 * order, every recorded consumption with its cost's resolved state and
 * release evidence, the effective consumption, the remaining commitment, the
 * explicit exceptions, and the recognized cost slices a control may offer.
 *
 * Authorization is layered: `purchase_orders:read` opens the order register,
 * and the supplier cost data inside the detail also needs
 * `other_expenses:read` — register access alone is not enough. A reader
 * without either privilege gets 403 and no data.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ uid: string }> }
) {
	try {
		const authResult = await ensurePermission(
			request,
			RESOURCES.PURCHASE_ORDERS,
			PERMISSIONS.READ
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const sourceRead = await ensurePermission(
			request,
			RESOURCES.OTHER_EXPENSES,
			PERMISSIONS.READ
		);
		if (sourceRead instanceof Response) return sourceRead;
		if (!sourceRead.authorized) return sourceRead.response;

		const { uid } = await params;
		const detail = await fetchOrderCommitment(decodeURIComponent(uid));
		if (!detail) {
			return NextResponse.json(
				{
					success: false,
					error: 'Order not found',
					code: 'order_not_found',
				},
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data: detail });
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
		throw error;
	}
}
