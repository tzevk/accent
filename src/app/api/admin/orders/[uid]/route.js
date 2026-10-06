import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { fetchOrder, OrderError, updateOrder } from '@/lib/company-expenditure';

/**
 * One canonical order: its stored identity/evidence and its append-only
 * journal (GET), and a versioned operational update (PUT). The update must
 * present the version it was made against; a stale or replayed request
 * changes nothing. Reads gate on `purchase_orders:read`, writes on
 * `purchase_orders:update`.
 */

function actorOf(user) {
	return {
		id: user?.id ?? null,
		name: user?.full_name ?? user?.username ?? null,
	};
}

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
	const authResult = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const { uid } = await params;
		const data = await fetchOrder(uid);
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof OrderError) return errorResponse(error);
		console.error('Error fetching order:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch order',
				error: error.message,
			},
			{ status: 500 }
		);
	}
}

export async function PUT(request, { params }) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const { uid } = await params;
		const body = await request.json();
		const order = await updateOrder(
			{
				orderUid: uid,
				expectedVersion: body.expected_version,
				patch: {
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
				},
			},
			actorOf(authResult.user)
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
		console.error('Error updating order:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to update order',
				error: error.message,
			},
			{ status: 500 }
		);
	}
}
