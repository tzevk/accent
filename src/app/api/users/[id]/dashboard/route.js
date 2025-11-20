import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

/**
 * GET /api/users/[id]/dashboard
 * Fetch comprehensive dashboard statistics for a user
 * 
 * Returns:
 * - Activity statistics by status
 * - Upcoming deadlines (next 7 days)
 * - Overdue activities count
 * - Active projects with activity counts
 * - Recent activity updates
 * - Workload summary (estimated vs actual hours)
 */
export async function GET(request, { params }) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (auth.authorized !== true) return auth;

    const { id } = await params;
    const requestedUserId = parseInt(id);
    const currentUser = auth.user;

    // Users can only view their own dashboard unless they're admin
    if (requestedUserId !== currentUser.id && !currentUser.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden: You can only view your own dashboard' 
      }, { status: 403 });
    }

    const db = await dbConnect();

    // 1. Activity statistics by status
    const [activityStats] = await db.execute(`
      SELECT 
        status,
        priority,
        COUNT(*) as count,
        SUM(estimated_hours) as total_estimated_hours,
        SUM(actual_hours) as total_actual_hours
      FROM user_activity_assignments
      WHERE user_id = ?
      GROUP BY status, priority
      ORDER BY 
        FIELD(status, 'Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'),
        FIELD(priority, 'Critical', 'High', 'Medium', 'Low')
    `, [requestedUserId]);

    // 2. Status summary (simplified)
    const [statusSummary] = await db.execute(`
      SELECT 
        status,
        COUNT(*) as count
      FROM user_activity_assignments
      WHERE user_id = ?
      GROUP BY status
    `, [requestedUserId]);

    // 3. Upcoming deadlines (next 7 days)
    const [upcomingDeadlines] = await db.execute(`
      SELECT 
        uaa.*,
        p.project_title,
        p.client_name,
        p.project_code,
        DATEDIFF(uaa.due_date, CURDATE()) as days_remaining
      FROM user_activity_assignments uaa
      LEFT JOIN projects p ON uaa.project_id = p.project_id
      WHERE uaa.user_id = ?
      AND uaa.status NOT IN ('Completed', 'Cancelled')
      AND uaa.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
      ORDER BY uaa.due_date ASC, uaa.priority DESC
      LIMIT 10
    `, [requestedUserId]);

    // 4. Overdue activities
    const [overdueActivities] = await db.execute(`
      SELECT 
        uaa.*,
        p.project_title,
        p.client_name,
        DATEDIFF(CURDATE(), uaa.due_date) as days_overdue
      FROM user_activity_assignments uaa
      LEFT JOIN projects p ON uaa.project_id = p.project_id
      WHERE uaa.user_id = ?
      AND uaa.status NOT IN ('Completed', 'Cancelled')
      AND uaa.due_date < CURDATE()
      ORDER BY uaa.due_date ASC
    `, [requestedUserId]);

    // 5. Active projects with activity counts
    const [activeProjects] = await db.execute(`
      SELECT 
        p.project_id,
        p.project_title,
        p.client_name,
        p.status as project_status,
        p.progress as project_progress,
        p.project_code,
        COUNT(uaa.id) as total_activities,
        SUM(CASE WHEN uaa.status = 'Not Started' THEN 1 ELSE 0 END) as not_started,
        SUM(CASE WHEN uaa.status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN uaa.status = 'Completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN uaa.status = 'On Hold' THEN 1 ELSE 0 END) as on_hold,
        SUM(CASE WHEN uaa.due_date < CURDATE() AND uaa.status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as overdue
      FROM projects p
      INNER JOIN user_activity_assignments uaa ON p.project_id = uaa.project_id
      WHERE uaa.user_id = ?
      AND p.status IN ('NEW', 'planning', 'in-progress')
      GROUP BY p.project_id
      ORDER BY overdue DESC, p.start_date DESC
    `, [requestedUserId]);

    // 6. Recent activity updates (last 10)
    const [recentUpdates] = await db.execute(`
      SELECT 
        au.*,
        uaa.activity_name,
        uaa.project_id,
        p.project_title,
        u.username as updated_by_username,
        u.full_name as updated_by_full_name
      FROM activity_updates au
      INNER JOIN user_activity_assignments uaa ON au.activity_assignment_id = uaa.id
      LEFT JOIN projects p ON uaa.project_id = p.project_id
      LEFT JOIN users u ON au.updated_by = u.id
      WHERE uaa.user_id = ?
      ORDER BY au.created_at DESC
      LIMIT 10
    `, [requestedUserId]);

    // 7. Workload summary
    const [workloadSummary] = await db.execute(`
      SELECT 
        COUNT(*) as total_active_activities,
        SUM(estimated_hours) as total_estimated_hours,
        SUM(actual_hours) as total_actual_hours,
        SUM(CASE WHEN status = 'In Progress' THEN estimated_hours ELSE 0 END) as in_progress_hours,
        AVG(progress_percentage) as avg_progress
      FROM user_activity_assignments
      WHERE user_id = ?
      AND status NOT IN ('Completed', 'Cancelled')
    `, [requestedUserId]);

    // 8. Priority breakdown
    const [priorityBreakdown] = await db.execute(`
      SELECT 
        priority,
        COUNT(*) as count,
        SUM(CASE WHEN status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as active_count
      FROM user_activity_assignments
      WHERE user_id = ?
      GROUP BY priority
      ORDER BY FIELD(priority, 'Critical', 'High', 'Medium', 'Low')
    `, [requestedUserId]);

    await db.end();

    // Transform status summary into object for easier access
    const statusCounts = statusSummary.reduce((acc, item) => {
      acc[item.status.toLowerCase().replace(/ /g, '_')] = item.count;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      data: {
        activity_stats: activityStats,
        status_summary: {
          not_started: statusCounts.not_started || 0,
          in_progress: statusCounts.in_progress || 0,
          on_hold: statusCounts.on_hold || 0,
          completed: statusCounts.completed || 0,
          cancelled: statusCounts.cancelled || 0,
          total: Object.values(statusCounts).reduce((a, b) => a + b, 0)
        },
        upcoming_deadlines: upcomingDeadlines,
        overdue_activities: overdueActivities,
        overdue_count: overdueActivities.length,
        active_projects: activeProjects,
        recent_updates: recentUpdates,
        workload_summary: workloadSummary[0] || {
          total_active_activities: 0,
          total_estimated_hours: 0,
          total_actual_hours: 0,
          in_progress_hours: 0,
          avg_progress: 0
        },
        priority_breakdown: priorityBreakdown
      }
    });

  } catch (error) {
    console.error('GET user dashboard error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch dashboard data'
    }, { status: 500 });
  }
}
