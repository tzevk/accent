import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { getStatusFromActivity } from '@/utils/activity-logger';

/**
 * GET /api/user-status
 * Fetch presence status for one or multiple users.
 *
 * Presence lives in `user_presence` (one row per user, upserted by the
 * activity tracker); status is derived from `last_seen` + client-reported
 * `is_idle`, never aggregated from `user_activity_logs`.
 *
 * Query params:
 * - user_id: single user ID or comma-separated list (admin or self only)
 * - include_stats: include today's activity statistics (default: true)
 *
 * Access: no user_id (all-users enumeration) requires admin; with user_id,
 * admins may fetch anyone, everyone else only themselves.
 */
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

		const { searchParams } = new URL(request.url);
		const userIdParam = searchParams.get('user_id');
		const includeStats = searchParams.get('include_stats') !== 'false';

		const isAdmin =
			currentUser.is_super_admin || currentUser.role?.code === 'admin';

		db = await dbConnect();

		// No user_id: presence for all active users (admin only)
		if (!userIdParam) {
			if (!isAdmin) {
				return NextResponse.json(
					{ success: false, error: 'Forbidden' },
					{ status: 403 }
				);
			}

			const [allUsers] = await db.execute(
				`SELECT 
          u.id as user_id,
          u.username,
          u.full_name,
          u.email,
          r.role_name,
          p.last_seen as last_activity,
          p.is_idle,
          p.current_page
        FROM users u
        LEFT JOIN roles_master r ON u.role_id = r.id
        LEFT JOIN user_presence p ON p.user_id = u.id
        WHERE u.is_active = TRUE
        ORDER BY COALESCE(p.last_seen, '1970-01-01') DESC`
			);

			const statsByUser = includeStats
				? await getUsersTodayStats(
						db,
						allUsers.map((u) => u.user_id)
					)
				: null;

			const usersWithStatus = allUsers.map((user) => ({
				...user,
				status: getStatusFromActivity(user.last_activity, user.is_idle),
				...(statsByUser ? (statsByUser.get(user.user_id) ?? {}) : {}),
			}));

			return NextResponse.json({ success: true, data: usersWithStatus });
		}

		// Specific user(s): admin or self
		const userIds = userIdParam
			.split(',')
			.map((id) => parseInt(id.trim()))
			.filter(Number.isInteger);

		if (userIds.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Invalid user_id' },
				{ status: 400 }
			);
		}

		if (!isAdmin && !userIds.includes(currentUser.id)) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		const placeholders = userIds.map(() => '?').join(',');
		const [users] = await db.execute(
			`SELECT 
        u.id as user_id,
        u.username,
        u.full_name,
        u.email,
        r.role_name,
        p.last_seen as last_activity,
        p.is_idle,
        p.current_page,
        (SELECT session_start FROM user_work_sessions 
         WHERE user_id = u.id AND status = 'active' 
         ORDER BY session_start DESC LIMIT 1) as session_start
      FROM users u
      LEFT JOIN roles_master r ON u.role_id = r.id
      LEFT JOIN user_presence p ON p.user_id = u.id
      WHERE u.id IN (${placeholders})`,
			userIds
		);

		const statsByUser = includeStats
			? await getUsersTodayStats(db, userIds)
			: null;

		// Add status and stats
		const usersWithStatus = users.map((user) => {
			const status = getStatusFromActivity(user.last_activity, user.is_idle);

			let session_duration = null;
			if (user.session_start && status === 'online') {
				session_duration = Math.floor(
					(Date.now() - new Date(user.session_start).getTime()) / 1000
				);
			}

			return {
				...user,
				status,
				session_duration,
				...(statsByUser ? (statsByUser.get(user.user_id) ?? {}) : {}),
			};
		});

		return NextResponse.json({
			success: true,
			data: userIds.length === 1 ? usersWithStatus[0] : usersWithStatus,
		});
	} catch (error) {
		console.error('Error fetching user status:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch user status',
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

/**
 * Helper: Get today's stats for many users at once (3 queries total, not
 * 3 per user). Returns a Map keyed by user_id; missing users get no entry
 * (callers merge with `?? {}`).
 */
async function getUsersTodayStats(db, userIds) {
	if (!userIds.length) return new Map();

	const today = new Date().toISOString().split('T')[0];
	const placeholders = userIds.map(() => '?').join(',');

	const [summaries] = await db.execute(
		`SELECT 
      user_id,
      activities_completed,
      pages_viewed,
      productivity_score
    FROM user_daily_summary
    WHERE user_id IN (${placeholders}) AND date = ?`,
		[...userIds, today]
	);

	const [screenTimes] = await db.execute(
		`SELECT 
      user_id,
      total_screen_time_minutes,
      active_time_minutes,
      idle_time_minutes,
      total_clicks,
      total_scrolls,
      total_keypresses
    FROM user_screen_time
    WHERE user_id IN (${placeholders}) AND date = ?`,
		[...userIds, today]
	);

	const [sessions] = await db.execute(
		`SELECT 
      user_id,
      COUNT(*) as activities_count,
      SUM(resources_modified) as resources_modified
    FROM user_work_sessions
    WHERE user_id IN (${placeholders}) AND DATE(session_start) = ?
    GROUP BY user_id`,
		[...userIds, today]
	);

	const summaryMap = new Map(summaries.map((r) => [r.user_id, r]));
	const screenMap = new Map(screenTimes.map((r) => [r.user_id, r]));
	const sessionMap = new Map(sessions.map((r) => [r.user_id, r]));

	const statsByUser = new Map();
	for (const id of userIds) {
		const s = summaryMap.get(id) || {};
		const st = screenMap.get(id) || {};
		const sess = sessionMap.get(id) || {};
		statsByUser.set(id, {
			total_screen_time_minutes: st.total_screen_time_minutes || 0,
			active_time_minutes: st.active_time_minutes || 0,
			idle_time_minutes: st.idle_time_minutes || 0,
			activities_count: s.activities_completed || 0,
			productivity_score: parseFloat(s.productivity_score || 0),
			pages_viewed: s.pages_viewed || 0,
			resources_modified: sess.resources_modified || 0,
			total_clicks: st.total_clicks || 0,
			total_scrolls: st.total_scrolls || 0,
		});
	}

	return statsByUser;
}
