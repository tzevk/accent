/**
 * POST /api/admin/cost-accruals/[id]/replacements
 *
 * Supersede part or all of one recognized accrual with one recognized
 * supplier invoice. A partial replacement matches only the stated/remaining
 * amount and leaves the unmatched accrual remainder visible; a final
 * replacement supersedes the whole remaining estimate and records the
 * estimate-versus-actual difference with its period, reason, and evidence.
 *
 * This is a financial act on both sides of the chain, so it needs
 * `other_expenses:approve`. Both versions are guarded; the replacement row,
 * the shared chain link, and the journal row commit together or not at all.
 * Cancelling the replacement invoice later releases the matched amount back to
 * the accrual in the cancel command's own transaction.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import {
	CostError,
	executeAccrualReplacement,
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
		const accrualId = Number(id);
		if (!Number.isInteger(accrualId) || accrualId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid accrual id is required' },
				{ status: 400 }
			);
		}
		const body = (await request.json()) as Record<string, unknown>;
		const invoiceId = Number(body.invoice_id);
		if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'invoice_id is required',
					code: 'invoice_required',
				},
				{ status: 400 }
			);
		}
		const expectedAccrualVersion = Number(body.expected_accrual_version);
		const expectedInvoiceVersion = Number(body.expected_invoice_version);
		if (
			!Number.isInteger(expectedAccrualVersion) ||
			expectedAccrualVersion < 1 ||
			!Number.isInteger(expectedInvoiceVersion) ||
			expectedInvoiceVersion < 1
		) {
			return NextResponse.json(
				{
					success: false,
					error:
						'expected_accrual_version and expected_invoice_version are required',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}

		const optionalText = (value: unknown): string | null =>
			value === undefined || value === null ? null : String(value);
		const result = await executeAccrualReplacement(
			{
				accrualId,
				invoiceId,
				final: body.final === true,
				replacedAmount:
					body.replaced_amount === undefined
						? null
						: (body.replaced_amount as number | string | null),
				differenceReason: optionalText(body.difference_reason),
				differencePeriod: optionalText(body.difference_period),
				evidenceReference: optionalText(body.evidence_reference),
				reason: optionalText(body.reason),
				expectedAccrualVersion,
				expectedInvoiceVersion,
			},
			{ id: authResult.user?.id ?? null }
		);

		await logActivity({
			userId: authResult.user?.id,
			actionType: 'approve',
			resourceType: 'cost_accrual',
			resourceId: accrualId,
			description: `Replaced ${result.replaced_amount} of accrual ${accrualId} with invoice ${invoiceId}${result.final ? ' (final)' : ''}`,
			request,
		});

		return NextResponse.json({ success: true, data: result });
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
		console.error('Cost accrual replacement error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Replacement failed',
			},
			{ status: 500 }
		);
	}
}
