/**
 * GET /api/admin/expenditure-settlements/[id]
 *   One settlement with its versioned journal.
 *
 * Access: `other_expenses:read` **and** `payroll:read` (super admin
 * bypasses), the same register read gate as the collection route.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { dbConnect } from '@/utils/database';
import { loadSettlementEvents } from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}
	const isSuperAdmin =
		user.is_super_admin === true || user.is_super_admin === 1;
	if (
		!isSuperAdmin &&
		!(
			hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
			hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ)
		)
	) {
		return NextResponse.json(
			{
				success: false,
				error: 'You do not have permission to view outward cash settlements',
			},
			{ status: 403 }
		);
	}

	let db;
	try {
		const { id } = await params;
		const numericId = Number(id);
		if (!Number.isInteger(numericId) || numericId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Valid settlement id is required' },
				{ status: 400 }
			);
		}
		db = await dbConnect();
		const [rows] = (await db.execute(
			`SELECT id, settlement_uid, target_kind, target_cost_uid, payroll_slip_id,
              movement_kind, amount, currency, settled_on, reference, destination,
              evidence_reference, status, financial_version, created_by
         FROM financial_settlements
        WHERE id = ? AND isDelete = 0`,
			[numericId]
		)) as [Array<Record<string, unknown>>, unknown];
		if (rows.length === 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'Settlement not found',
					code: 'settlement_not_found',
				},
				{ status: 404 }
			);
		}
		const settlement = rows[0];
		const journal = await loadSettlementEvents(
			db,
			String(settlement.settlement_uid ?? '')
		);
		return NextResponse.json({ success: true, data: { settlement, journal } });
	} catch (error: unknown) {
		console.error('Expenditure settlement read error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load',
			},
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				await db.release();
			} catch {
				// Ignore release errors
			}
		}
	}
}
