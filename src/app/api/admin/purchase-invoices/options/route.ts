/**
 * GET /api/admin/purchase-invoices/options
 *
 * The active Projects the supplier-invoice entry form's destination control
 * chooses from. Read through the shared expenditure module, so the control and
 * the report address the same Project list.
 */

import { NextResponse } from 'next/server';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectOptions } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.PURCHASE_ORDERS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	try {
		const options = await fetchProjectOptions();
		return NextResponse.json({ success: true, data: options });
	} catch (error: unknown) {
		console.error('Purchase invoice options error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Options failed',
			},
			{ status: 500 }
		);
	}
}
