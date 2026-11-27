import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	getCurrentUser,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { parseDailyEntries } from '@/lib/logged-hours';

function parseDailyEntriesPayload(value) {
	if (!value) return [];
	try {
		const parsed = typeof value === 'string' ? JSON.parse(value) : value;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function effectiveLoggedHours(row) {
	const derivedHours = parseDailyEntries(row.daily_entries).reduce(
		(sum, entry) => sum + entry.hours,
		0
	);
	if (
		row.work_period_entries !== null &&
		row.work_period_entries !== undefined
	) {
		return derivedHours;
	}
	return parseFloat(row.actual_hours) || derivedHours;
}

function withEffectiveLoggedHours(row) {
	return {
		...row,
		daily_entries: parseDailyEntriesPayload(row.daily_entries),
		legacy_daily_entries: parseDailyEntriesPayload(row.legacy_daily_entries),
		actual_hours: effectiveLoggedHours(row),
	};
}
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
		const { id } = await params;
		const requestedUserId = parseInt(id);

		// Get current user
		const currentUser = await getCurrentUser(request);

		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		// Users can ALWAYS view their own dashboard
		const isOwnDashboard = requestedUserId === currentUser.id;

		// For viewing OTHER users' dashboards, require admin or specific permission
		if (!isOwnDashboard) {
			const canViewOthers =
				currentUser.is_super_admin ||
				hasPermission(currentUser, RESOURCES.USERS, PERMISSIONS.READ);

			if (!canViewOthers) {
				return NextResponse.json(
					{
						success: false,
						error: 'Forbidden: You can only view your own dashboard',
					},
					{ status: 403 }
				);
			}
		}

		const db = await dbConnect();

		try {
			// Execute all queries in parallel for better performance
			const [
				activityStatsResult,
				statusSummaryResult,
				upcomingDeadlinesResult,
				overdueActivitiesResult,
				activeProjectsResult,
				recentUpdatesResult,
				workloadSummaryResult,
				priorityBreakdownResult,
				assignmentLogsResult,
			] = await Promise.all([
				// 1. Activity statistics by status
				db.execute(
					`
          SELECT
            status,
            priority,
            COUNT(*) as count,
            SUM(estimated_hours) as total_estimated_hours
          FROM logged_activity_assignments
          WHERE user_id = ?
          GROUP BY status, priority
          ORDER BY
            FIELD(status, 'Not Started', 'In Progress', 'On Hold', 'Completed', 'Cancelled'),
            FIELD(priority, 'Critical', 'High', 'Medium', 'Low')
        `,
					[requestedUserId]
				),

				// 2. Status summary (simplified)
				db.execute(
					`
          SELECT
            status,
            COUNT(*) as count
          FROM logged_activity_assignments
          WHERE user_id = ?
          GROUP BY status
        `,
					[requestedUserId]
				),

				// 3. Upcoming deadlines (next 7 days)
				db.execute(
					`
          SELECT
            uaa.*,
            p.project_title,
            p.client_name,
            p.project_code,
            DATEDIFF(uaa.due_date, CURDATE()) as days_remaining
          FROM logged_activity_assignments uaa
          LEFT JOIN projects p ON uaa.project_id = p.project_id
          WHERE uaa.user_id = ?
          AND uaa.status NOT IN ('Completed', 'Cancelled')
          AND uaa.due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
          ORDER BY uaa.due_date ASC, uaa.priority DESC
          LIMIT 10
        `,
					[requestedUserId]
				),

				// 4. Overdue activities
				db.execute(
					`
          SELECT
            uaa.*,
            p.project_title,
            p.client_name,
            DATEDIFF(CURDATE(), uaa.due_date) as days_overdue
          FROM logged_activity_assignments uaa
          LEFT JOIN projects p ON uaa.project_id = p.project_id
          WHERE uaa.user_id = ?
          AND uaa.status NOT IN ('Completed', 'Cancelled')
          AND uaa.due_date < CURDATE()
          ORDER BY uaa.due_date ASC
        `,
					[requestedUserId]
				),

				// 5. Active projects with activity counts
				db.execute(
					`
          SELECT
            p.project_id,
            p.name as project_title,
            p.client_name,
            p.status as project_status,
            p.project_code,
            COUNT(uaa.id) as total_activities,
            SUM(CASE WHEN uaa.status = 'Not Started' THEN 1 ELSE 0 END) as not_started,
            SUM(CASE WHEN uaa.status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN uaa.status = 'Completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN uaa.status = 'On Hold' THEN 1 ELSE 0 END) as on_hold,
            SUM(CASE WHEN uaa.due_date < CURDATE() AND uaa.status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as overdue
          FROM projects p
          INNER JOIN logged_activity_assignments uaa ON p.project_id = uaa.project_id
          WHERE uaa.user_id = ?
          AND p.status IN ('NEW', 'planning', 'in-progress', 'Ongoing')
          GROUP BY p.project_id, p.name, p.client_name, p.status, p.project_code
          ORDER BY overdue DESC, p.start_date DESC
        `,
					[requestedUserId]
				),

				// 6. Recent activity updates (last 10)
				db
					.execute(
						`
          SELECT
            au.*,
            uaa.activity_name,
            uaa.project_id,
            p.project_title,
            u.username as updated_by_username,
            u.full_name as updated_by_full_name
          FROM activity_updates au
          INNER JOIN logged_activity_assignments uaa ON au.activity_assignment_id = uaa.id
          LEFT JOIN projects p ON uaa.project_id = p.project_id
          LEFT JOIN users u ON au.updated_by = u.id
          WHERE uaa.user_id = ?
          ORDER BY au.created_at DESC
          LIMIT 10
        `,
						[requestedUserId]
					)
					.catch(() => [[]]), // May not have this table

				// 7. Workload summary
				db.execute(
					`
          SELECT
            COUNT(*) as total_active_activities,
            SUM(estimated_hours) as total_estimated_hours,
            SUM(CASE WHEN status = 'In Progress' THEN estimated_hours ELSE 0 END) as in_progress_hours,
            AVG(progress_percentage) as avg_progress
          FROM logged_activity_assignments
          WHERE user_id = ?
          AND status NOT IN ('Completed', 'Cancelled')
        `,
					[requestedUserId]
				),

				// 8. Priority breakdown
				db.execute(
					`
          SELECT
            priority,
            COUNT(*) as count,
            SUM(CASE WHEN status NOT IN ('Completed', 'Cancelled') THEN 1 ELSE 0 END) as active_count
          FROM logged_activity_assignments
          WHERE user_id = ?
          GROUP BY priority
          ORDER BY FIELD(priority, 'Critical', 'High', 'Medium', 'Low')
        `,
					[requestedUserId]
				),

				// 9. Logged Hours for the aggregate cards. A Work Period projection
				// overrides the stale base-column aggregate; legacy-only rows keep
				// their preexisting actual_hours display.
				db.execute(
					`
          SELECT status, priority, daily_entries, work_period_entries, actual_hours
          FROM logged_activity_assignments
          WHERE user_id = ?
        `,
					[requestedUserId]
				),
			]);

			// Destructure results
			const [activityStats] = activityStatsResult;
			const [statusSummary] = statusSummaryResult;
			const [upcomingDeadlines] = upcomingDeadlinesResult;
			const [overdueActivities] = overdueActivitiesResult;
			const [activeProjects] = activeProjectsResult;
			const [recentUpdates] = recentUpdatesResult;
			const [workloadSummary] = workloadSummaryResult;
			const [priorityBreakdown] = priorityBreakdownResult;
			const [assignmentLogs] = assignmentLogsResult;

			const actualHoursByGroup = new Map();
			let activeActualHours = 0;
			for (const row of assignmentLogs) {
				const hours = effectiveLoggedHours(row);
				const key = `${row.status ?? ''}\u0000${row.priority ?? ''}`;
				actualHoursByGroup.set(key, (actualHoursByGroup.get(key) || 0) + hours);
				if (
					row.status != null &&
					row.status !== 'Completed' &&
					row.status !== 'Cancelled'
				) {
					activeActualHours += hours;
				}
			}
			const activityStatsWithLoggedHours = activityStats.map((row) => ({
				...row,
				total_actual_hours:
					actualHoursByGroup.get(
						`${row.status ?? ''}\u0000${row.priority ?? ''}`
					) || 0,
			}));

			// Transform status summary into object for easier access
			const statusCounts = statusSummary.reduce((acc, item) => {
				acc[item.status.toLowerCase().replace(/ /g, '_')] = item.count;
				return acc;
			}, {});

			return NextResponse.json({
				success: true,
				data: {
					activity_stats: activityStatsWithLoggedHours,
					status_summary: {
						not_started: statusCounts.not_started || 0,
						in_progress: statusCounts.in_progress || 0,
						on_hold: statusCounts.on_hold || 0,
						completed: statusCounts.completed || 0,
						cancelled: statusCounts.cancelled || 0,
						total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
					},
					upcoming_deadlines: upcomingDeadlines.map(withEffectiveLoggedHours),
					overdue_activities: overdueActivities.map(withEffectiveLoggedHours),
					overdue_count: overdueActivities.length,
					active_projects: activeProjects,
					recent_updates: recentUpdates,
					workload_summary: {
						...(workloadSummary[0] || {
							total_active_activities: 0,
							total_estimated_hours: 0,
							in_progress_hours: 0,
							avg_progress: 0,
						}),
						total_actual_hours: activeActualHours,
					},
					priority_breakdown: priorityBreakdown,
				},
			});
		} finally {
			db.release();
		}
	} catch (error) {
		console.error('GET user dashboard error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch dashboard data',
			},
			{ status: 500 }
		);
	}
}
