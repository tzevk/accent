import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/user-status
 * Fetch online status for one or multiple users
 * Query params:
 * - user_id: single user ID or comma-separated list
 * - include_stats: include today's activity statistics (default: true)
 */
export async function GET(request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get('user_id');
    const includeStats = searchParams.get('include_stats') !== 'false';

    const db = await dbConnect();

    // If no user_id provided, get all active users
    if (!userIdParam) {
      // Get users with activity in last 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const [activeUsers] = await db.execute(
        `SELECT 
          u.id as user_id,
          u.username,
          u.full_name,
          u.email,
          r.role_name,
          MAX(ual.created_at) as last_activity,
          (SELECT description FROM user_activity_logs 
           WHERE user_id = u.id AND action_type = 'view_page' 
           ORDER BY created_at DESC LIMIT 1) as current_page
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        LEFT JOIN user_activity_logs ual ON u.id = ual.user_id
        WHERE ual.created_at >= ?
        GROUP BY u.id
        ORDER BY last_activity DESC`,
        [tenMinutesAgo]
      );

      // Add status and stats if requested
      const usersWithStatus = await Promise.all(
        activeUsers.map(async (user) => {
          const status = getStatusFromActivity(user.last_activity);
          
          let stats = null;
          if (includeStats) {
            stats = await getUserTodayStats(db, user.user_id);
          }

          return {
            ...user,
            status,
            ...stats
          };
        })
      );

      await db.end();
      return NextResponse.json({ success: true, data: usersWithStatus });
    }

    // Get specific user(s)
    const userIds = userIdParam.split(',').map(id => parseInt(id.trim()));
    const placeholders = userIds.map(() => '?').join(',');

    const [users] = await db.execute(
      `SELECT 
        u.id as user_id,
        u.username,
        u.full_name,
        u.email,
        r.role_name,
        (SELECT MAX(created_at) FROM user_activity_logs WHERE user_id = u.id) as last_activity,
        (SELECT description FROM user_activity_logs 
         WHERE user_id = u.id AND action_type = 'view_page' 
         ORDER BY created_at DESC LIMIT 1) as current_page,
        (SELECT session_start FROM user_work_sessions 
         WHERE user_id = u.id AND status = 'active' 
         ORDER BY session_start DESC LIMIT 1) as session_start
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id IN (${placeholders})`,
      userIds
    );

    // Add status and stats
    const usersWithStatus = await Promise.all(
      users.map(async (user) => {
        const status = getStatusFromActivity(user.last_activity);
        
        let stats = null;
        if (includeStats) {
          stats = await getUserTodayStats(db, user.user_id);
        }

        // Calculate session duration if active
        let session_duration = null;
        if (user.session_start && status === 'online') {
          session_duration = Math.floor((Date.now() - new Date(user.session_start).getTime()) / 1000);
        }

        return {
          ...user,
          status,
          session_duration,
          ...stats
        };
      })
    );

    await db.end();
    return NextResponse.json({ 
      success: true, 
      data: userIds.length === 1 ? usersWithStatus[0] : usersWithStatus 
    });

  } catch (error) {
    console.error('Error fetching user status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user-status
 * Update user manual status (e.g., "In meeting", "On break")
 * Body: { status: string, user_id?: number }
 */
export async function POST(request) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { status, user_id } = body;

    // Users can only update their own status unless they're admin
    const targetUserId = user_id || currentUser.id;
    if (targetUserId !== currentUser.id && currentUser.role !== 'Admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (!status) {
      return NextResponse.json({ success: false, error: 'Status is required' }, { status: 400 });
    }

    const db = await dbConnect();

    // Log status change as activity
    await db.execute(
      `INSERT INTO user_activity_logs (
        user_id, action_type, resource_type, description, details, status
      ) VALUES (?, 'status_change', 'user_status', ?, ?, 'success')`,
      [targetUserId, `Manual status update: ${status}`, JSON.stringify({ manual_status: status })]
    );

    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Status updated successfully',
      data: { user_id: targetUserId, status }
    });

  } catch (error) {
    console.error('Error updating user status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user status' },
      { status: 500 }
    );
  }
}

/**
 * Helper: Determine status from last activity timestamp
 */
function getStatusFromActivity(lastActivity) {
  if (!lastActivity) return 'offline';
  
  const seconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
  
  if (seconds < 120) return 'online';  // Active (< 2 min)
  if (seconds < 600) return 'idle';    // Idle (< 10 min)
  return 'offline';                     // Away (> 10 min)
}

/**
 * Helper: Get user's today statistics
 */
async function getUserTodayStats(db, userId) {
  const today = new Date().toISOString().split('T')[0];

  // Get daily summary
  const [summary] = await db.execute(
    `SELECT 
      total_work_minutes,
      activities_completed,
      resources_created,
      resources_updated,
      resources_deleted,
      pages_viewed,
      productivity_score
    FROM user_daily_summary
    WHERE user_id = ? AND date = ?`,
    [userId, today]
  );

  // Get screen time
  const [screenTime] = await db.execute(
    `SELECT 
      total_screen_time_minutes,
      active_time_minutes,
      idle_time_minutes,
      total_clicks,
      total_scrolls,
      total_keypresses
    FROM user_screen_time
    WHERE user_id = ? AND date = ?`,
    [userId, today]
  );

  // Get active session count
  const [sessions] = await db.execute(
    `SELECT COUNT(*) as activities_count,
     SUM(resources_modified) as resources_modified
    FROM user_work_sessions
    WHERE user_id = ? AND DATE(session_start) = ?`,
    [userId, today]
  );

  return {
    total_screen_time_minutes: screenTime[0]?.total_screen_time_minutes || 0,
    active_time_minutes: screenTime[0]?.active_time_minutes || 0,
    idle_time_minutes: screenTime[0]?.idle_time_minutes || 0,
    activities_count: summary[0]?.activities_completed || 0,
    productivity_score: parseFloat(summary[0]?.productivity_score || 0),
    pages_viewed: summary[0]?.pages_viewed || 0,
    resources_modified: sessions[0]?.resources_modified || 0,
    total_clicks: screenTime[0]?.total_clicks || 0,
    total_scrolls: screenTime[0]?.total_scrolls || 0
  };
}
