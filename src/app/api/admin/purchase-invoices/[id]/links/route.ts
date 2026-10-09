/**
 * POST /api/admin/purchase-invoices/[id]/links
 *
 * Review a preserved text mapping between a payable follow-up and this
 * supplier invoice. A candidate (the payable's own document number naming this
 * invoice) is surfaced by the invoice detail; confirming it records a
 * document-backed, confirmed link to the invoice's cost identity, and the
 * payable then tracks that one cost. Rejecting keeps the evidence but records
 * the reviewed mapping as rejected. Neither decision creates cost.
 *
 * The financial decision carries the approval privilege
 * (`other_expenses:approve`) on top of the source register update privilege.
 */

import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { CostError, decideSupplierLink } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const action = String(body.action ?? '');
		if (action !== 'confirm' && action !== 'reject') {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown action: ${action}`,
					code: 'invalid_action',
				},
				{ status: 400 }
			);
		}

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

		const { id } = await params;
		const invoiceId = Number(id);
		if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid invoice id is required' },
				{ status: 400 }
			);
		}
		const sourceTable = String(body.source_table ?? 'payment_payables');
		if (sourceTable !== 'payment_payables') {
			return NextResponse.json(
				{
					success: false,
					error: `Unsupported link source: ${sourceTable}`,
					code: 'unsupported_link_source',
				},
				{ status: 422 }
			);
		}
		const payableId = Number(body.source_id);
		if (!Number.isInteger(payableId) || payableId <= 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'source_id is required',
					code: 'source_id_required',
				},
				{ status: 400 }
			);
		}

		const db = await dbConnect();
		try {
			await db.beginTransaction();
			let link;
			try {
				link = await decideSupplierLink(db, {
					invoiceId,
					payableId,
					action,
					evidenceReference:
						body.evidence_reference === undefined
							? null
							: String(body.evidence_reference),
					reason: body.reason === undefined ? null : String(body.reason),
					actor: { id: authResult.user?.id ?? null },
				});
				await db.commit();
			} catch (error) {
				await db.rollback();
				throw error;
			}

			await logActivity({
				userId: authResult.user?.id,
				actionType: action === 'confirm' ? 'approve' : 'update',
				resourceType: 'purchase_invoice',
				resourceId: invoiceId,
				description:
					action === 'confirm'
						? `Linked payable ${payableId} to supplier cost of invoice ${invoiceId}`
						: `Rejected payable ${payableId} mapping for invoice ${invoiceId}`,
				request,
			});

			return NextResponse.json({ success: true, data: link });
		} finally {
			await db.release();
		}
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
		console.error('Supplier invoice link error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Link failed',
			},
			{ status: 500 }
		);
	}
}
