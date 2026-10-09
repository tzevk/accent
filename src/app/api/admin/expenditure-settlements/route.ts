/**
 * GET  /api/admin/expenditure-settlements?month=YYYY-MM[&target_cost_uid=]
 *   The month's dated outward cash movements, per-target cover, voucher
 *   funding apart from paid, legacy disclosures, and the record-settlement
 *   target picker.
 * POST /api/admin/expenditure-settlements
 *   Record one dated outward cash movement against a cost or payroll slip.
 *
 * Access: the register states payroll payouts, so reading needs
 * `other_expenses:read` **and** `payroll:read`; recording moves money, so it
 * needs `other_expenses:update` **and** `payroll:read`. Super admin bypasses.
 * `reports:read` alone or Project Activity access alone opens nothing.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { dbConnect } from '@/utils/database';
import {
	CostError,
	loadCashSection,
	loadSettlementCandidates,
	recordSettlement,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function canRead(user: {
	is_super_admin?: boolean | number | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
}): boolean {
	if (user.is_super_admin === true || user.is_super_admin === 1) return true;
	return (
		hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ) &&
		hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ)
	);
}

function canWrite(user: {
	is_super_admin?: boolean | number | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
}): boolean {
	if (user.is_super_admin === true || user.is_super_admin === 1) return true;
	return (
		hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.UPDATE) &&
		hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ)
	);
}

export async function GET(request: Request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}
	if (!canRead(user)) {
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
		const { searchParams } = new URL(request.url);
		const month = searchParams.get('month');
		if (!month || !/^\d{4}-\d{2}$/.test(month)) {
			return NextResponse.json(
				{ success: false, error: 'Valid month (YYYY-MM) is required' },
				{ status: 400 }
			);
		}
		db = await dbConnect();
		const [section, candidates] = await Promise.all([
			loadCashSection(db, month),
			loadSettlementCandidates(db, month),
		]);
		let targets = section.targets;
		const onlyCost = searchParams.get('target_cost_uid');
		if (onlyCost) {
			targets = targets.filter(
				(target) =>
					target.target_kind === 'cost' && target.target_key === onlyCost
			);
		}
		return NextResponse.json({
			success: true,
			data: { ...section, targets, candidates },
		});
	} catch (error: unknown) {
		console.error('Expenditure settlements read error:', error);
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

const MOVEMENT_KINDS = ['payment', 'withholding', 'deduction'];

export async function POST(request: Request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}
	if (!canWrite(user)) {
		return NextResponse.json(
			{
				success: false,
				error: 'You do not have permission to record outward cash settlements',
			},
			{ status: 403 }
		);
	}

	try {
		const body = (await request.json()) as Record<string, unknown>;
		const targetKind = body.target_kind;
		const suppliedUid =
			body.settlement_uid === undefined || body.settlement_uid === null
				? null
				: String(body.settlement_uid);
		const movementKind =
			body.movement_kind === undefined || body.movement_kind === null
				? undefined
				: String(body.movement_kind);
		if (movementKind !== undefined && !MOVEMENT_KINDS.includes(movementKind)) {
			return NextResponse.json(
				{
					success: false,
					error: `Unknown movement kind: ${movementKind}`,
					code: 'invalid_movement_kind',
				},
				{ status: 422 }
			);
		}
		// A replayed idempotency key returns the original row unchanged: the
		// pre-check decides the status, the unique key guarantees the single
		// row even when two replays race between the check and the insert.
		let status = 201;
		if (suppliedUid !== null) {
			let db;
			try {
				db = await dbConnect();
				const [existing] = (await db.execute(
					`SELECT id FROM financial_settlements
            WHERE settlement_uid = ? AND isDelete = 0
            LIMIT 1`,
					[suppliedUid]
				)) as [Array<{ id: number }>, unknown];
				if (existing.length > 0) status = 200;
			} catch {
				status = 201;
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
		const settlement = await recordSettlement(
			{
				targetKind: targetKind === 'payroll' ? 'payroll' : 'cost',
				targetCostUid:
					body.target_cost_uid === undefined || body.target_cost_uid === null
						? null
						: String(body.target_cost_uid),
				payrollSlipId:
					body.payroll_slip_id === undefined || body.payroll_slip_id === null
						? null
						: Number(body.payroll_slip_id),
				movementKind: movementKind as
					| 'payment'
					| 'withholding'
					| 'deduction'
					| undefined,
				amount: Number(body.amount),
				currency:
					body.currency === undefined || body.currency === null
						? undefined
						: String(body.currency),
				settledOn: String(body.settled_on ?? ''),
				reference:
					body.reference === undefined || body.reference === null
						? null
						: String(body.reference),
				destination:
					body.destination === undefined || body.destination === null
						? null
						: String(body.destination),
				evidenceReference:
					body.evidence_reference === undefined ||
					body.evidence_reference === null
						? null
						: String(body.evidence_reference),
				settlementUid: suppliedUid,
			},
			{ id: user?.id ?? null }
		);

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'financial_settlement',
			resourceId: settlement.id,
			description: `Recorded outward settlement ${settlement.settlement_uid}: ${settlement.amount} ${settlement.currency} on ${settlement.settled_on}`,
			request,
		});

		return NextResponse.json({ success: true, data: settlement }, { status });
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
		console.error('Expenditure settlement record error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to record',
			},
			{ status: 500 }
		);
	}
}
