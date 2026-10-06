import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { createOrder, fetchOrders, OrderError } from '@/lib/company-expenditure';

/**
 * The Project tab's order surface (ticket #310).
 *
 * Reads return the Project's canonical orders (client value and supplier
 * order values kept apart). Writes create a canonical order scoped to the
 * Project — an explicit direction is required, and the previous
 * `project_purchase_orders` upsert (one ambiguous row per Project carrying
 * both a client and a vendor name) is gone, so this endpoint cannot create a
 * second order truth.
 */

function errorResponse(error) {
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

export async function GET(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.READ
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	try {
		const { id } = await params;
		const data = await fetchOrders({ projectId: id, limit: 200, includeCancelled: true });
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof OrderError) return errorResponse(error);
		console.error('Error fetching project orders:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	}
}

export async function POST(request, { params }) {
	const auth = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.CREATE
	);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) return auth.response;

	try {
		const { id } = await params;
		const body = await request.json();
		const order = await createOrder(
			{
				direction: body.direction,
				orderNumber: body.order_number,
				counterpartyName: body.counterparty_name,
				projectId: id,
				currency: body.currency,
				amountBasis: body.amount_basis,
				grossAmount: body.gross_amount,
				taxAmount: body.tax_amount,
				netAmount: body.net_amount,
				orderDate: body.order_date,
				status: body.status,
				firmness: body.firmness,
				firmnessEvidenceReference: body.firmness_evidence_reference,
				sourceDocumentReference: body.source_document_reference,
				remarks: body.remarks,
			},
			{ id: auth.user?.id ?? null, name: auth.user?.full_name ?? null }
		);
		return NextResponse.json({ success: true, data: order });
	} catch (error) {
		if (error instanceof OrderError) return errorResponse(error);
		if (error instanceof SyntaxError) {
			return NextResponse.json(
				{ success: false, message: 'Invalid JSON body', code: 'invalid_body' },
				{ status: 400 }
			);
		}
		console.error('Error creating project order:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	}
}
