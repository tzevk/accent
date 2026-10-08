/**
 * GET  /api/admin/expenditure-close?month=YYYY-MM
 *   The month's close status: open or closed, the version a close must
 *   present, the review (blockers and warnings), and, once closed, the
 *   frozen snapshot with its closure review.
 * POST /api/admin/expenditure-close
 *   `{ month, expected_version, reason?, evidence_reference? }` — review
 *   the month and save its immutable closed figures. The review runs inside
 *   the close transaction, so a blocked month, a stale version, and a
 *   competing close all write nothing.
 *
 * Access: the close reviews every source, so reading needs
 * `other_expenses:read` **and** `payroll:read`; closing freezes the month,
 * so it needs `other_expenses:update` **and** `payroll:read`. Super admin
 * bypasses. `reports:read` alone opens nothing.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { dbConnect, withTransaction } from '@/utils/database';
import {
	CostError,
	executeCloseCommand,
	loadCloseSnapshot,
	reviewClose,
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

function costErrorResponse(error: CostError) {
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
				error: 'You do not have permission to review financial closes',
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
		const [snapshot, review] = await Promise.all([
			loadCloseSnapshot(db, month),
			reviewClose(db, month),
		]);
		return NextResponse.json({
			success: true,
			data: {
				month,
				status: snapshot ? 'closed' : 'open',
				financial_version: snapshot?.financial_version ?? 0,
				close_uid: snapshot?.close_uid ?? null,
				review,
				snapshot: snapshot?.snapshot ?? null,
				reviewed_by: snapshot?.reviewed_by ?? null,
				reviewed_at: snapshot?.reviewed_at ?? null,
				review_reason: snapshot?.review_reason ?? null,
				evidence_reference: snapshot?.evidence_reference ?? null,
				created_at: snapshot?.created_at ?? null,
			},
		});
	} catch (error: unknown) {
		if (error instanceof CostError) return costErrorResponse(error);
		console.error('Expenditure close review error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to review',
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
				error: 'You do not have permission to close financial months',
			},
			{ status: 403 }
		);
	}

	try {
		const body = (await request.json()) as Record<string, unknown>;
		const month =
			body.month === undefined || body.month === null ? '' : String(body.month);
		const expectedVersion = body.expected_version;
		if (
			expectedVersion === undefined ||
			expectedVersion === null ||
			!Number.isInteger(Number(expectedVersion))
		) {
			return NextResponse.json(
				{
					success: false,
					error:
						'The close must present the version it read (expected_version)',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}
		// The review, the version check, and the snapshot insert are one
		// transaction: a competing close loses on the unique key and writes
		// nothing, so two requests create one coherent version.
		const created = { value: true };
		const result = await withTransaction(async (db) => {
			const before = await loadCloseSnapshot(db, month);
			const outcome = await executeCloseCommand(
				db,
				{
					month,
					expectedVersion: Number(expectedVersion),
					reason:
						body.reason === undefined || body.reason === null
							? null
							: String(body.reason),
					evidenceReference:
						body.evidence_reference === undefined ||
						body.evidence_reference === null
							? null
							: String(body.evidence_reference),
				},
				{ id: user?.id ?? null }
			);
			created.value = !before;
			return outcome;
		});

		await logActivity({
			userId: user?.id,
			actionType: 'create',
			resourceType: 'financial_close',
			resourceId: result.close_uid,
			description: `Closed financial month ${result.month} (${result.close_uid})`,
			request,
		});

		return NextResponse.json(
			{ success: true, data: result },
			{ status: created.value ? 201 : 200 }
		);
	} catch (error: unknown) {
		if (error instanceof CostError) return costErrorResponse(error);
		console.error('Expenditure close error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to close',
			},
			{ status: 500 }
		);
	}
}
