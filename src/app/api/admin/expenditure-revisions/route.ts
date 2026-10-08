/**
 * GET  /api/admin/expenditure-revisions?month=YYYY-MM
 *   The month's revision state: open or closed, the frozen close it targets,
 *   the frozen prior totals beside the live updated totals, the costs and
 *   settlements a revision control can offer, and every accepted revision
 *   with its reason, actor, timestamp, and prior/new figures.
 * POST /api/admin/expenditure-revisions
 *   `{ target_kind, id?, cost_uid?, command, expected_version,
 *      target_close_version, reason, evidence_reference, patch?,
 *      revision_uid? }` — correct a closed cost (`update`) or reverse it
 *   (`cancel`) through the explicit revision workflow. The close binding,
 *   the version check, the source command, the consumption carry-forward,
 *   and both journal appends are one transaction: a stale version, a
 *   competing revision, and a refused month all write nothing. A repeated
 *   revision key returns the existing result instead of a duplicate.
 *
 * Access: a revision reads every source the month reconciles, so reading
 * needs `other_expenses:read` **and** `payroll:read`; correcting needs
 * `other_expenses:update` (and `payroll:read`), reversing needs
 * `other_expenses:approve` (and `payroll:read`) — the source privileges
 * the ordinary command routes already enforce. Super admin bypasses.
 * `reports:read` alone opens nothing. Payroll attribution is refused here
 * (`use_allocation_revision`): it keeps its allocation revision contract.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { logActivity } from '@/utils/activity-logger';
import { dbConnect, withTransaction } from '@/utils/database';
import {
	CostError,
	OrderError,
	executeRevision,
	fetchCompanyReconciliation,
	loadCloseSnapshot,
	loadRevisionCandidates,
	loadRevisionHistory,
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

function canWrite(
	user: {
		is_super_admin?: boolean | number | null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		[key: string]: any;
	},
	command: string
): boolean {
	if (user.is_super_admin === true || user.is_super_admin === 1) return true;
	const operation =
		command === 'cancel' ? PERMISSIONS.APPROVE : PERMISSIONS.UPDATE;
	return (
		hasPermission(user, RESOURCES.OTHER_EXPENSES, operation) &&
		hasPermission(user, RESOURCES.PAYROLL, PERMISSIONS.READ)
	);
}

function commandErrorResponse(error: CostError | OrderError) {
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
				error: 'You do not have permission to review financial revisions',
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
		const [snapshot, revisions, candidates, reconciliation] = await Promise.all(
			[
				loadCloseSnapshot(db, month),
				loadRevisionHistory(db, month),
				loadRevisionCandidates(db, month),
				fetchCompanyReconciliation({ month }, { connection: db }),
			]
		);
		return NextResponse.json({
			success: true,
			data: {
				month,
				status: snapshot ? 'closed' : 'open',
				close_uid: snapshot?.close_uid ?? null,
				close_version: snapshot?.financial_version ?? 0,
				prior: snapshot
					? {
							incurred_cost: snapshot.snapshot?.company.incurred_cost ?? null,
							currency: snapshot.snapshot?.company.currency ?? null,
						}
					: null,
				current: {
					incurred_cost: reconciliation.company.incurred_cost,
					currency: reconciliation.company.currency,
				},
				candidates,
				revisions,
			},
		});
	} catch (error: unknown) {
		if (error instanceof CostError || error instanceof OrderError) {
			return commandErrorResponse(error);
		}
		console.error('Expenditure revision review error:', error);
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

	try {
		const body = (await request.json()) as Record<string, unknown>;
		const command = body.command === 'cancel' ? 'cancel' : 'update';
		if (!canWrite(user, command)) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to revise financial months',
				},
				{ status: 403 }
			);
		}
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
						'The revision must present the version it read (expected_version)',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}
		const targetCloseVersion = body.target_close_version;
		if (
			targetCloseVersion === undefined ||
			targetCloseVersion === null ||
			!Number.isInteger(Number(targetCloseVersion))
		) {
			return NextResponse.json(
				{
					success: false,
					error:
						'The revision must present the closed version it targets (target_close_version)',
					code: 'version_required',
				},
				{ status: 400 }
			);
		}
		const rawKind = body.target_kind;
		const targetKind = typeof rawKind === 'string' ? rawKind : 'direct';
		const uid =
			body.cost_uid === undefined || body.cost_uid === null
				? body.settlement_uid === undefined || body.settlement_uid === null
					? null
					: String(body.settlement_uid)
				: String(body.cost_uid);
		const id =
			body.id === undefined || body.id === null ? null : Number(body.id);
		// The close binding, the version check, the source command, the
		// consumption carry-forward, and both journal appends are one
		// transaction: a competing revision loses on the unique key and
		// writes nothing, so two requests create one coherent version.
		const result = await withTransaction(async (db) => {
			return executeRevision(
				{
					targetKind,
					id,
					uid,
					command: body.command === 'cancel' ? 'cancel' : 'update',
					expectedVersion: Number(expectedVersion),
					targetCloseVersion: Number(targetCloseVersion),
					reason:
						body.reason === undefined || body.reason === null
							? null
							: String(body.reason),
					evidenceReference:
						body.evidence_reference === undefined ||
						body.evidence_reference === null
							? null
							: String(body.evidence_reference),
					patch:
						body.patch === undefined || body.patch === null
							? {}
							: (body.patch as Record<string, unknown>),
					revisionUid:
						body.revision_uid === undefined || body.revision_uid === null
							? null
							: String(body.revision_uid),
				},
				{ id: user?.id ?? null }
			);
		});

		await logActivity({
			userId: user?.id,
			actionType: 'update',
			resourceType: 'financial_revision',
			resourceId: result.id,
			description: `Revised closed ${result.month} ${result.target_kind} ${result.target_uid} (${result.revision_uid})`,
			request,
		});

		return NextResponse.json(
			{ success: true, data: result },
			{ status: result.repeated ? 200 : 201 }
		);
	} catch (error: unknown) {
		if (error instanceof CostError || error instanceof OrderError) {
			return commandErrorResponse(error);
		}
		console.error('Expenditure revision error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to revise',
			},
			{ status: 500 }
		);
	}
}
