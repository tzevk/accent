import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	OrderError,
	fetchOrderReviewQueue,
	resolveLegacyOrder,
} from '@/lib/company-expenditure';

/**
 * Legacy order-copy review (ticket #310). The queue lists every pre-canonical
 * copy with its collision candidates; a decision is versioned, reasoned, and
 * document-backed, and it never merges or deletes the legacy rows. Reads gate
 * on `purchase_orders:read`, decisions on `purchase_orders:update`.
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
		const data = await fetchOrderReviewQueue({
			state: searchParams.get('state'),
			limit: searchParams.get('limit'),
		});
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof OrderError) return errorResponse(error);
		console.error('Error fetching order review queue:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch the order review queue',
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
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const body = await request.json();
		const data = await resolveLegacyOrder(
			{
				mappingId: body.mapping_id,
				decision: body.decision,
				expectedVersion: body.expected_version,
				reason: body.reason,
				evidenceReference: body.evidence_reference,
				direction: body.direction,
				counterpartyName: body.counterparty_name,
				projectId: body.project_id,
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
				orderNumber: body.order_number,
				remarks: body.remarks,
				canonicalOrderUid: body.canonical_order_uid,
				duplicateOfMappingId: body.duplicate_of_mapping_id,
			},
			actorOf(authResult.user)
		);
		return NextResponse.json({ success: true, data });
	} catch (error) {
		if (error instanceof OrderError) return errorResponse(error);
		if (error instanceof SyntaxError) {
			return NextResponse.json(
				{ success: false, message: 'Invalid JSON body', code: 'invalid_body' },
				{ status: 400 }
			);
		}
		console.error('Error resolving a legacy order copy:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to resolve the legacy order copy',
				error: error.message,
			},
			{ status: 500 }
		);
	}
}
