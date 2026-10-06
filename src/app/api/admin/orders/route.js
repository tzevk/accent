import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	createOrder,
	fetchOrders,
	OrderError,
} from '@/lib/company-expenditure';

/**
 * Canonical orders (ticket #310): one store with explicit client/supplier
 * direction, a durable `order_uid`, and per-currency/per-basis subtotals.
 * Reads gate on `purchase_orders:read`, creation on `purchase_orders:create`.
 */

function actorOf(user) {
	return {
		id: user?.id ?? null,
		name: user?.full_name ?? user?.username ?? null,
	};
}

function bodyToCreateInput(body) {
	return {
		direction: body.direction,
		orderNumber: body.order_number,
		counterpartyName: body.counterparty_name,
		projectId: body.project_id,
		companyId: body.company_id,
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
		evidenceReference: body.evidence_reference,
		remarks: body.remarks,
	};
}

function orderErrorResponse(error) {
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

export async function GET(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const { searchParams } = new URL(request.url);
		const data = await fetchOrders({
			direction: searchParams.get('direction'),
			projectId: searchParams.get('project_id'),
			status: searchParams.get('status'),
			includeCancelled: searchParams.get('include_cancelled'),
			limit: searchParams.get('limit'),
			offset: searchParams.get('offset'),
		});
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof OrderError) return orderErrorResponse(error);
		console.error('Error fetching orders:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch orders',
				error: error.message,
			},
			{ status: 500 }
		);
	}
}

export async function POST(request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = await request.json();
		const order = await createOrder(
			bodyToCreateInput(body),
			actorOf(authResult.user)
		);
		return NextResponse.json({ success: true, data: order });
	} catch (error) {
		if (error instanceof OrderError) return orderErrorResponse(error);
		if (error instanceof SyntaxError) {
			return NextResponse.json(
				{ success: false, message: 'Invalid JSON body', code: 'invalid_body' },
				{ status: 400 }
			);
		}
		console.error('Error creating order:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to create order',
				error: error.message,
			},
			{ status: 500 }
		);
	}
}
