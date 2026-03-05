import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

/**
 * GET /api/reports/project-activities
 * Returns all projects with their activities and per-user daily entries for admin report view.
 * Access: Rajesh Panchal, super admins, or users with reports:read permission
 */
export async function GET(request) {
  let db;
  try {
    // Check permissions - allow Rajesh Panchal, super admins, and users with reports permission
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log(`[Project Activities API] User accessing: ${user.full_name || user.username} (ID: ${user.id})`); // Debug log
    
    const isRajeshPanchal = user.full_name?.toLowerCase() === 'rajesh panchal';
    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;
    const hasReportsPermission = hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ);
    
    console.log(`[Project Activities API] Permissions - Rajesh: ${isRajeshPanchal}, SuperAdmin: ${isSuperAdmin}, ReportsPermission: ${hasReportsPermission}`); // Debug log
    
    if (!isRajeshPanchal && !isSuperAdmin && !hasReportsPermission) {
      return NextResponse.json({ 
        success: false, 
        error: 'You do not have permission to view project activities report' 
      }, { status: 403 });
    }
    
    db = await dbConnect();

    const [projects] = await db.execute(`
      SELECT 
        p.project_id,
        p.name as project_name,
        p.project_code,
        p.status as project_status,
        p.start_date,
        p.end_date,
        p.project_activities_list,
        p.project_team
      FROM projects p
      WHERE p.project_activities_list IS NOT NULL 
        AND p.project_activities_list != '' 
        AND p.project_activities_list != '[]'
      ORDER BY p.start_date DESC
    `);

    console.log(`[Project Activities API] Found ${projects.length} projects with activities`); // Debug log

    // Fetch users and employees for name resolution
    // user_id in assigned_users comes from the users table
    let userMap = {};
    try {
      const [users] = await db.execute(`SELECT id, full_name, username, email FROM users`);
      for (const u of users) {
        userMap[String(u.id)] = u.full_name || u.username || u.email;
      }
    } catch (e) {
      console.warn('Could not fetch users for name resolution:', e.message);
    }
    // Also fetch employees as fallback
    try {
      const [employees] = await db.execute(`SELECT id, full_name, email FROM employees`);
      for (const emp of employees) {
        if (!userMap[String(emp.id)]) {
          userMap[String(emp.id)] = emp.full_name || emp.email;
        }
      }
    } catch (e) {
      console.warn('Could not fetch employees for name resolution:', e.message);
    }

    const result = [];

    for (const project of projects) {
      try {
        const activitiesList = typeof project.project_activities_list === 'string'
          ? JSON.parse(project.project_activities_list)
          : project.project_activities_list;

        if (!Array.isArray(activitiesList)) continue;

        const activities = [];

        for (const activity of activitiesList) {
          const assignedUsers = activity.assigned_users || [];
          const members = [];

          if (Array.isArray(assignedUsers)) {
            for (const assignment of assignedUsers) {
              const userData = typeof assignment === 'object' ? assignment : { user_id: assignment };
              const userId = String(userData.user_id);
              const dailyEntries = userData.daily_entries || [];
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
            members
          });
        }

        result.push({
          project_id: project.project_id,
          project_name: project.project_name,
          project_code: project.project_code,
          project_status: project.project_status,
          start_date: project.start_date,
          end_date: project.end_date,
          activities
        });
      } catch (parseErr) {
        console.error(`Failed to parse activities for project ${project.project_id}:`, parseErr.message);
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Project activities report error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    // Always release the database connection to prevent leaks
    if (db && typeof db.release === 'function') {
      try {
        db.release();
      } catch (err) {
        console.error('Error releasing DB connection in reports API:', err);
      }
    }
  }
}
