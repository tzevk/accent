import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { fetchOrder, OrderError } from '@/lib/company-expenditure';

/**
 * The remaining value of a client order for the invoice screen (#310).
 * Answers from the canonical order store by its durable `order_uid` — the
 * previous free-text `po_number` lookup read a legacy row that may be a
 * supplier order or an unreviewed copy, which is exactly the ambiguity the
 * canonical identity replaces. A legacy invoice keeps its own stored balance
 * fields; this endpoint never guesses one from a number.
 */
export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const { searchParams } = new URL(request.url);
		const orderUid = searchParams.get('order_uid')?.trim();

		if (!orderUid) {
			return NextResponse.json(
				{
					success: false,
					message: 'order_uid is required',
					code: 'order_uid_required',
				},
				{ status: 400 }
			);
		}

		// One order by its durable identity; the module keeps the currency/basis
		// interpretation (and the client-only remaining value) in one place.
		let order;
		try {
			const found = await fetchOrder(orderUid);
			order = found.order;
		} catch (error) {
			if (error instanceof OrderError && error.code === 'order_not_found') {
				return NextResponse.json({
					success: true,
					data: {
						exists: false,
						remaining_balance: null,
						original_value: null,
					},
				});
			}
			throw error;
		}

		const originalValue =
			order.amountBasis === 'gross'
				? order.grossAmount
				: order.amountBasis === 'net'
					? order.netAmount
					: null;

		return NextResponse.json({
			success: true,
			data: {
				exists: true,
				order_uid: order.orderUid,
				order_number: order.orderNumber,
				direction: order.direction,
				currency: order.currency,
				amount_basis: order.amountBasis,
				original_value: originalValue,
				invoiced_value: order.clientInvoicedValue,
				remaining_balance: order.clientRemainingValue,
			},
		});
	} catch (error) {
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
		console.error('Error fetching the client order balance:', error);
		return NextResponse.json(
			{ success: false, message: error.message },
			{ status: 500 }
		);
	}
}
