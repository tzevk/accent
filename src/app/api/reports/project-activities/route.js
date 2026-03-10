import { NextResponse } from 'next/server';
import { query } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

/**
 * GET /api/reports/project-activities
 * Returns all projects with their activities and per-user daily entries for admin report view.
 * Access: super admins or users with reports:read permission.
 *
 * Uses pool.execute (via query()) so NO connection is held open for the entire request.
 */
export async function GET(request) {
  try {
    // Check permissions
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;
    const hasReportsPermission = hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ);

    if (!isSuperAdmin && !hasReportsPermission) {
      return NextResponse.json({
        success: false,
        error: 'You do not have permission to view project activities report'
      }, { status: 403 });
    }

    // --- All queries below use pool.execute() — no long-held connection ---

    const [projects] = await query(`
      SELECT *
      FROM projects p
      ORDER BY
        CASE WHEN p.start_date IS NULL THEN 1 ELSE 0 END,
        p.start_date DESC,
        p.project_id DESC
    `);

    // Normalise name field
    projects.forEach(p => {
      if (!p.project_name && p.name) p.project_name = p.name;
      if (!p.project_name && p.project_title) p.project_name = p.project_title;
    });

    // Build user name map
    const userMap = {};
    try {
      const [users] = await query(`SELECT id, full_name, username, email FROM users`);
      for (const u of users) userMap[String(u.id)] = u.full_name || u.username || u.email;
    } catch { /* ignore */ }
    try {
      const [employees] = await query(`SELECT id, first_name, last_name, email FROM employees`);
      for (const emp of employees) {
        if (!userMap[String(emp.id)]) {
          userMap[String(emp.id)] = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.email;
        }
      }
    } catch { /* ignore */ }

    // Bulk-fetch all project_activities in one query instead of per-project
    let tableActivitiesByProject = {};
    try {
      const [allTableActivities] = await query(`
        SELECT id, project_id, activity_name, discipline_name,
               start_date, end_date, manhours_planned, manhours_actual,
               status, progress_percentage, notes
        FROM project_activities
        ORDER BY created_at DESC
      `);
      for (const ta of allTableActivities) {
        const pid = ta.project_id;
        if (!tableActivitiesByProject[pid]) tableActivitiesByProject[pid] = [];
        tableActivitiesByProject[pid].push(ta);
      }
    } catch { /* table may not exist */ }

    const result = [];

    for (const project of projects) {
      let activities = [];

      // 1. Parse JSON field (project_activities_list)
      try {
        let activitiesList = [];
        if (project.project_activities_list) {
          activitiesList = typeof project.project_activities_list === 'string'
            ? JSON.parse(project.project_activities_list)
            : project.project_activities_list;
        }
        if (!Array.isArray(activitiesList)) activitiesList = [];

        for (const activity of activitiesList) {
          const assignedUsers = activity.assigned_users || [];
          const members = [];

          if (Array.isArray(assignedUsers)) {
            for (const assignment of assignedUsers) {
              const userData = typeof assignment === 'object' ? assignment : { user_id: assignment };
              const userId = String(userData.user_id);
              const dailyEntries = Array.isArray(userData.daily_entries)
                ? userData.daily_entries.filter(e => e && typeof e === 'object')
                : [];
              const totalQtyDone = dailyEntries.reduce((sum, e) => sum + (parseFloat(e.qty_done) || 0), 0);
              const totalHours = dailyEntries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0);

              members.push({
                user_id: userId,
                user_name: userMap[userId] || `User ${userId}`,
                description: userData.description || '',
                qty_assigned: userData.qty_assigned || 0,
                qty_completed: userData.qty_completed || totalQtyDone,
                planned_hours: userData.planned_hours || 0,
                actual_hours: userData.actual_hours || totalHours,
                start_date: userData.start_date || null,
                due_date: userData.due_date || null,
                status: userData.status || 'Not Started',
                remarks: userData.remarks || '',
                daily_entries: dailyEntries
              });
            }
          }

          activities.push({
            id: activity.id,
            activity_name: activity.activity_name || activity.name || 'Unnamed',
            activity_description: activity.activity_description || '',
            discipline: activity.discipline || activity.function_name || 'General',
            members,
            source: 'json'
          });
        }
      } catch {
        activities = [];
      }

      // 2. Merge activities from project_activities table (pre-fetched)
      const tableActivities = tableActivitiesByProject[project.project_id] || [];
      for (const ta of tableActivities) {
        const existsInJson = activities.some(a =>
          a.id === ta.id ||
          (a.activity_name === ta.activity_name && a.discipline === ta.discipline_name)
        );
        if (!existsInJson) {
          activities.push({
            id: ta.id,
            activity_name: ta.activity_name,
            activity_description: ta.notes || '',
            discipline: ta.discipline_name || 'General',
            members: [],
            source: 'table',
            start_date: ta.start_date,
            end_date: ta.end_date,
            manhours_planned: ta.manhours_planned || 0,
            manhours_actual: ta.manhours_actual || 0,
            status: ta.status || 'Not Started',
            progress_percentage: ta.progress_percentage || 0
          });
        }
      }

      result.push({
        project_id: project.project_id,
        project_name: project.project_name,
        project_code: project.project_code,
        project_status: project.project_status,
        client_name: project.client_name || project.client || '',
        project_manager: project.project_manager || '',
        start_date: project.start_date,
        end_date: project.end_date,
        activities
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: { total_in_db: projects.length, total_returned: result.length }
    });
  } catch (error) {
    console.error('Project activities report error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  // No finally needed — query() uses pool.execute(), connection is auto-released per query
}
