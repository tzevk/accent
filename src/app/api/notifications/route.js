import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission, RESOURCES, PERMISSIONS } from '@/utils/rbac';

const LIMIT = 50;

/**
 * GET /api/notifications
 * Current user's notification feed (newest first) + unread count.
 */
export async function GET(request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	let db;
	try {
		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT id, type, title, body, link, is_read, created_at
       FROM notifications
       WHERE user_id = ? AND isDelete = 0
       ORDER BY created_at DESC, id DESC
       LIMIT ${LIMIT}`,
			[user.id]
		);

		const [[{ unread_count }]] = await db.execute(
			`SELECT COUNT(*) AS unread_count
       FROM notifications
       WHERE user_id = ? AND isDelete = 0 AND is_read = 0`,
			[user.id]
		);

		// Pending leave applications that need management — only for approvers
		let pending_leaves = [];
		let pending_count = 0;
		const canManage =
			user.is_super_admin ||
			hasPermission(user, RESOURCES.LEAVES, PERMISSIONS.APPROVE);
		if (canManage) {
			const [[{ cnt }]] = await db.execute(
				`SELECT COUNT(*) AS cnt FROM leave_applications WHERE isDelete = 0 AND status = 'pending'`
			);
			pending_count = cnt;
			if (pending_count > 0) {
				const [pendingRows] = await db.execute(
					`SELECT la.id, la.user_id, u.full_name AS applicant_name,
                lt.name AS leave_type_name, lt.code AS leave_type_code,
                la.start_date, la.end_date, la.half_day, la.duration_days,
                la.reason, la.created_at
         FROM leave_applications la
         JOIN users u ON la.user_id = u.id
         JOIN leave_types lt ON la.leave_type_id = lt.id
         WHERE la.isDelete = 0 AND la.status = 'pending'
         ORDER BY la.created_at DESC, la.id DESC
         LIMIT 20`
				);
				pending_leaves = pendingRows;
			}
		}

		return NextResponse.json({
			success: true,
			data: {
				notifications: rows,
				unread_count,
				pending_leaves,
				pending_count,
			},
		});
	} catch (error) {
		console.error('Error fetching notifications:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch notifications' },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}

/**
 * POST /api/notifications
 * Mark all of the current user's notifications as read.
 */
export async function POST(request) {
	const user = await getCurrentUser(request);
	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	let db;
	try {
		db = await dbConnect();

		const [result] = await db.execute(
			`UPDATE notifications
       SET is_read = 1
       WHERE user_id = ? AND isDelete = 0 AND is_read = 0`,
			[user.id]
		);

		return NextResponse.json({
			success: true,
			data: { updated: result.affectedRows },
		});
	} catch (error) {
		console.error('Error marking notifications read:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update notifications' },
			{ status: 500 }
		);
	} finally {
		if (db) await db.release();
	}
}
