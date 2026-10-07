/**
 * GET /api/admin/cost-accruals/[id]
 *
 * One accrual's financial detail: its identity, remaining estimate, replaced
 * amount, every replacement (with the estimate-versus-actual difference, its
 * period/reason/evidence, and any release), its shared source links, and the
 * recognized invoices the replacement control may choose from.
 */

import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { CostError, loadAccrualDetail } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.OTHER_EXPENSES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id } = await params;
		const accrualId = Number(id);
		if (!Number.isInteger(accrualId) || accrualId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid accrual id is required' },
				{ status: 400 }
			);
		}
		db = await dbConnect();
		const detail = await loadAccrualDetail(db, accrualId);
		await db.release();
		db = null;
		if (!detail) {
			return NextResponse.json(
				{ success: false, error: 'Cost accrual not found', code: 'not_found' },
				{ status: 404 }
			);
		}
		return NextResponse.json({ success: true, data: detail });
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
		console.error('Cost accrual detail error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Detail failed',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
