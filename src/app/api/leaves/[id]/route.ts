import { NextResponse } from 'next/server';
import { dbConnect, withTransaction } from '@/utils/database';
import { ensurePermission, getCurrentUser } from '@/utils/api-permissions';
import { RESOURCES, PERMISSIONS, hasPermission } from '@/utils/rbac';
import { logActivity } from '@/utils/activity-logger';
import { applyApprovedLeave, revertApprovedLeave } from '@/utils/leave-helpers';

const VALID_STATUSES = ['pending', 'approved', 'rejected'];

/**
 * Loads an application joined with everything the side-effect helpers need.
 */
async function loadApplication(
	db: Awaited<ReturnType<typeof dbConnect>>,
	id: number
) {
	const [rows] = await db.execute(
		`SELECT la.id, la.user_id, la.leave_type_id, la.start_date, la.end_date,
              la.half_day, la.duration_days, la.status, la.reviewed_by,
              la.reviewed_at, la.review_notes, la.written_attendance,
              lt.code, lt.is_paid, lt.requires_balance, lt.default_annual_quota,
              u.employee_id
       FROM leave_applications la
       JOIN leave_types lt ON la.leave_type_id = lt.id
       JOIN users u ON la.user_id = u.id
       WHERE la.id = ? AND la.isDelete = 0`,
		[id]
	);
	return (rows as Array<Record<string, unknown>>)[0] ?? null;
}

/**
 * PATCH /api/leaves/[id]
 *
 * Review workflow — requires leaves:approve.
 * Body: { status: 'approved' | 'rejected' | 'pending', review_notes? }
 *
 * Approving writes attendance rows + balance ledger inside one transaction;
 * moving an approved request back to rejected/pending reverses them using the
 * written_attendance audit payload. Rejecting requires review_notes.
 */
export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.LEAVES,
		PERMISSIONS.APPROVE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	const reviewer = authResult.user;
	const { id: rawId } = await params;
	const id = Number(rawId);
	if (!Number.isInteger(id) || id <= 0) {
		return NextResponse.json(
			{ success: false, error: 'Invalid application id' },
			{ status: 400 }
		);
	}

	let body: { status?: string; review_notes?: string };
	try {
		body = await request.json();
	} catch (_) {
		return NextResponse.json(
			{ success: false, error: 'Invalid JSON body' },
			{ status: 400 }
		);
	}

	const nextStatus = String(body?.status ?? '');
	if (!VALID_STATUSES.includes(nextStatus)) {
		return NextResponse.json(
			{
				success: false,
				error: "status must be 'approved', 'rejected' or 'pending'",
			},
			{ status: 400 }
		);
	}
	const reviewNotes =
		body?.review_notes === undefined || body?.review_notes === null
			? null
			: String(body.review_notes).trim();

	if (nextStatus === 'rejected' && !reviewNotes) {
		return NextResponse.json(
			{
				success: false,
				error: 'review_notes is required when rejecting a leave',
			},
			{ status: 400 }
		);
	}

	try {
		const updated = await withTransaction(async (db) => {
			const app = await loadApplication(db, id);
			if (!app) return null;
			if (app.status === nextStatus) {
				throw new Error(`Leave application is already ${nextStatus}`);
			}

			let auditJson: string | null = null;

			// Leaving the approved state → undo attendance + balances first.
			if (app.status === 'approved') {
				await revertApprovedLeave(db, app as never);
			}
			// Entering the approved state → apply side-effects and record audit.
			if (nextStatus === 'approved') {
				const audit = await applyApprovedLeave(db, app as never, reviewer.id);
				auditJson = JSON.stringify(audit);
			}

			await db.execute(
				`UPDATE leave_applications
         SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = NOW(),
             written_attendance = ?
         WHERE id = ? AND isDelete = 0`,
				[nextStatus, reviewNotes, reviewer.id, auditJson, id]
			);

			return { id, status: nextStatus, review_notes: reviewNotes };
		});

		if (!updated) {
			return NextResponse.json(
				{ success: false, error: 'Leave application not found' },
				{ status: 404 }
			);
		}

		logActivity({
			userId: reviewer.id,
			actionType:
				nextStatus === 'approved'
					? 'approve'
					: nextStatus === 'rejected'
						? 'reject'
						: 'reopen',
			resourceType: 'leave_applications',
			resourceId: id,
			description: `Leave application #${id} ${nextStatus}${reviewNotes ? `: ${reviewNotes}` : ''}`,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({ success: true, data: updated });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : 'Failed to update leave';
		const notFound = message.includes('not found');
		const conflict = message.startsWith('Leave application is already');
		console.error('Error reviewing leave application:', error);
		return NextResponse.json(
			{ success: false, error: message },
			{ status: conflict ? 409 : notFound ? 404 : 500 }
		);
	}
}

/**
 * DELETE /api/leaves/[id]
 *
 * - Owner may withdraw their own pending application.
 * - Users with leaves:delete may soft-delete any application; deleting an
 *   approved one also reverses its attendance/balance side-effects.
 */
export async function DELETE(
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

	const { id: rawId } = await params;
	const id = Number(rawId);
	if (!Number.isInteger(id) || id <= 0) {
		return NextResponse.json(
			{ success: false, error: 'Invalid application id' },
			{ status: 400 }
		);
	}

	try {
		const result = await withTransaction(async (db) => {
			const app = await loadApplication(db, id);
			if (!app) return { ok: false as const, status: 404 };

			const isOwner = Number(app.user_id) === Number(user.id);
			const canDeleteAny =
				user.is_super_admin ||
				hasPermission(user, RESOURCES.LEAVES, PERMISSIONS.DELETE);

			const ownerWithdraw = isOwner && app.status === 'pending';
			if (!canDeleteAny && !ownerWithdraw) {
				return { ok: false as const, status: 403 };
			}

			if (app.status === 'approved') {
				await revertApprovedLeave(db, app as never);
			}

			await db.execute(
				`UPDATE leave_applications SET isDelete = 1 WHERE id = ?`,
				[id]
			);
			return { ok: true as const };
		});

		if (!result.ok) {
			const errors: Record<number, string> = {
				404: 'Leave application not found',
				403: 'You can only withdraw your own pending applications',
			};
			return NextResponse.json(
				{ success: false, error: errors[result.status] },
				{ status: result.status }
			);
		}

		logActivity({
			userId: user.id,
			actionType: 'delete',
			resourceType: 'leave_applications',
			resourceId: id,
			description: `Leave application #${id} withdrawn/deleted`,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error('Error deleting leave application:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to delete leave application',
			},
			{ status: 500 }
		);
	}
}
