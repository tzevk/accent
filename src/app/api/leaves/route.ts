import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { logActivity } from '@/utils/activity-logger';
import {
	computeDurationDays,
	parseDateInput,
	MAX_LEAVE_RANGE_DAYS,
} from '@/utils/leave-helpers';

const VALID_STATUSES = ['pending', 'approved', 'rejected'];

/**
 * GET /api/leaves
 *
 * Lists leave applications. Users without leaves:approve only ever see their
 * own applications; approvers see everything and may filter by user_id.
 * Query params: status, user_id, from, to, scope ('mine'), limit.
 */
export async function GET(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.LEAVES,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	const user = authResult.user;
	const canReviewAll =
		user.is_super_admin ||
		hasPermission(user, RESOURCES.LEAVES, PERMISSIONS.APPROVE);

	const { searchParams } = new URL(request.url);
	const mineOnly = !canReviewAll || searchParams.get('scope') === 'mine';

	let db;
	try {
		db = await dbConnect();

		const conditions: string[] = ['la.isDelete = 0'];
		const params: Array<string | number> = [];

		if (mineOnly) {
			conditions.push('la.user_id = ?');
			params.push(user.id);
		} else {
			const userId = Number(searchParams.get('user_id'));
			if (Number.isInteger(userId) && userId > 0) {
				conditions.push('la.user_id = ?');
				params.push(userId);
			}
		}

		const status = searchParams.get('status');
		if (status && VALID_STATUSES.includes(status)) {
			conditions.push('la.status = ?');
			params.push(status);
		}

		const from = parseDateInput(searchParams.get('from') ?? '');
		if (from) {
			conditions.push('la.end_date >= ?');
			params.push(from);
		}

		const to = parseDateInput(searchParams.get('to') ?? '');
		if (to) {
			conditions.push('la.start_date <= ?');
			params.push(to);
		}

		const rawLimit = Number(searchParams.get('limit')) || 50;
		const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 200);
		const rawPage = Number(searchParams.get('page')) || 1;
		const page = Math.max(Math.trunc(rawPage), 1);
		const offset = (page - 1) * limit;
		// NOTE: limit/offset are clamped integers interpolated into SQL — do NOT
		// also push them into `params`. MariaDB silently returns an empty result
		// set when a prepared statement receives more bindings than placeholders.
		const [rows] = await db.execute(
			`SELECT la.id, la.user_id, u.full_name AS applicant_name,
              la.leave_type_id, lt.name AS leave_type_name, lt.code AS leave_type_code,
              lt.is_paid, la.start_date, la.end_date, la.half_day, la.duration_days,
              la.reason, la.status, la.reviewed_by, r.full_name AS reviewer_name,
              la.reviewed_at, la.review_notes, la.created_at
       FROM leave_applications la
       JOIN users u ON la.user_id = u.id
       JOIN leave_types lt ON la.leave_type_id = lt.id
       LEFT JOIN users r ON la.reviewed_by = r.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY la.created_at DESC, la.id DESC
       LIMIT ${limit} OFFSET ${offset}`,
			params
		);

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('Error fetching leave applications:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to fetch leave applications',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

/**
 * POST /api/leaves
 *
 * Creates a pending leave application. duration_days is always computed
 * server-side; overlapping pending/approved requests are rejected.
 * Body: { leave_type_id, start_date, end_date, half_day?, reason }
 */
export async function POST(request: Request) {
	const authResult = await ensurePermission(
		request,
		RESOURCES.LEAVES,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const body = await request.json();
		const leaveTypeId = Number(body?.leave_type_id);
		const startDate = parseDateInput(body?.start_date);
		const endDate = parseDateInput(body?.end_date);
		const halfDay = Boolean(body?.half_day);
		const reason = String(body?.reason ?? '').trim();

		if (!Number.isInteger(leaveTypeId) || leaveTypeId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'A valid leave type is required' },
				{ status: 400 }
			);
		}
		if (!startDate || !endDate) {
			return NextResponse.json(
				{
					success: false,
					error: 'start_date and end_date are required as YYYY-MM-DD',
				},
				{ status: 400 }
			);
		}
		if (!reason) {
			return NextResponse.json(
				{ success: false, error: 'Reason is required' },
				{ status: 400 }
			);
		}

		const durationDays = computeDurationDays(startDate, endDate, halfDay);
		if (durationDays <= 0) {
			return NextResponse.json(
				{ success: false, error: 'end_date must be on or after start_date' },
				{ status: 400 }
			);
		}
		if (durationDays > MAX_LEAVE_RANGE_DAYS) {
			return NextResponse.json(
				{
					success: false,
					error: `Leave range cannot exceed ${MAX_LEAVE_RANGE_DAYS} days`,
				},
				{ status: 400 }
			);
		}
		if (halfDay && startDate !== endDate) {
			return NextResponse.json(
				{
					success: false,
					error: 'Half-day applies only to a single-date leave',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [typeRows] = await db.execute(
			`SELECT id, name FROM leave_types WHERE id = ? AND isDelete = 0`,
			[leaveTypeId]
		);
		if (typeRows.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Leave type not found' },
				{ status: 404 }
			);
		}

		const [overlaps] = await db.execute(
			`SELECT id FROM leave_applications
       WHERE user_id = ? AND isDelete = 0
         AND status IN ('pending', 'approved')
         AND NOT (end_date < ? OR start_date > ?)
       LIMIT 1`,
			[authResult.user.id, startDate, endDate]
		);
		if (overlaps.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error:
						'You already have a pending or approved leave overlapping these dates',
				},
				{ status: 409 }
			);
		}

		const [result] = await db.execute(
			`INSERT INTO leave_applications
       (user_id, leave_type_id, start_date, end_date, half_day, duration_days, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
			[
				authResult.user.id,
				leaveTypeId,
				startDate,
				endDate,
				halfDay ? 1 : 0,
				durationDays,
				reason,
			]
		);
		const insertId = result.insertId;

		logActivity({
			userId: authResult.user.id,
			actionType: 'create',
			resourceType: 'leave_applications',
			resourceId: insertId,
			description: `Applied for ${typeRows[0].name} (${durationDays} day(s), ${startDate} → ${endDate})`,
			details: null,
			request,
			status: 'success',
		});

		return NextResponse.json({
			success: true,
			data: {
				id: insertId,
				leave_type_id: leaveTypeId,
				start_date: startDate,
				end_date: endDate,
				half_day: halfDay,
				duration_days: durationDays,
				reason,
				status: 'pending',
			},
		});
	} catch (error) {
		console.error('Error creating leave application:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error
						? error.message
						: 'Failed to create leave application',
			},
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
