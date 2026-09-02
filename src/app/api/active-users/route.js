import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

export async function GET(request) {
	let db;
	try {
		const currentUser = await getCurrentUser(request);
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}
		const isAdmin =
			currentUser.is_super_admin || currentUser.role?.code === 'admin';
		if (!isAdmin) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		db = await dbConnect();

		// Presence lives in user_presence (one row per user, upserted by
		// tracker). Old code aggregated user_activity_logs + u.role which
		// never existed (users.role_id → roles_master). Use the same
		// LEFT JOIN pattern as /api/user-status (no GROUP BY).
		const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

		const [activeUsers] = await db.execute(
			`
      SELECT
        u.id as user_id,
        u.full_name,
        u.username,
        r.role_name as role,
        p.last_seen as last_activity,
        p.current_page as current_page,
        (SELECT TIMESTAMPDIFF(SECOND, session_start, NOW())
         FROM user_work_sessions
         WHERE user_id = u.id AND status = 'active'
         ORDER BY session_start DESC LIMIT 1) as session_duration
      FROM users u
      LEFT JOIN roles_master r ON u.role_id = r.id
      LEFT JOIN user_presence p ON p.user_id = u.id
      WHERE p.last_seen >= ?
        AND u.isDelete = 0
        AND u.is_active = 1
      ORDER BY p.last_seen DESC
    `,
			[tenMinutesAgo]
		);

		return NextResponse.json({
			success: true,
			data: activeUsers.map((u) => ({
				...u,
				session_duration: u.session_duration || 0,
			})),
		});
	} catch (error) {
		console.error('Active users GET error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch active users',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
