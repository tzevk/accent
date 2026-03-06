import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';

/**
 * GET /api/reports/project-activities
 * Returns all projects with their activities and per-user daily entries for admin report view.
 * Access: super admins or users with reports:read permission
 */
export async function GET(request) {
  let db;
  try {
    // Check permissions - allow super admins and users with reports permission
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log(`[Project Activities API] User accessing: ${user.full_name || user.username} (ID: ${user.id})`); // Debug log
    
    const isSuperAdmin = user.is_super_admin === true || user.is_super_admin === 1;
    const hasReportsPermission = hasPermission(user, RESOURCES.REPORTS, PERMISSIONS.READ);
    
    console.log(`[Project Activities API] Permissions - SuperAdmin: ${isSuperAdmin}, ReportsPermission: ${hasReportsPermission}`); // Debug log
    
    if (!isSuperAdmin && !hasReportsPermission) {
      return NextResponse.json({ 
        success: false, 
        error: 'You do not have permission to view project activities report' 
      }, { status: 403 });
    }
    
    db = await dbConnect();

    // First, check table structure and all projects including deleted/inactive
    const [allProjectsCheck] = await db.execute(`
      SELECT * FROM projects LIMIT 1
    `).catch(err => {
      console.log('[Project Activities API] Could not fetch sample project:', err.message);
      return [[]];
    });
    
    if (allProjectsCheck.length > 0) {
      console.log('[Project Activities API] Sample project columns:', Object.keys(allProjectsCheck[0]));
    }

    const [projects] = await db.execute(`
      SELECT 
        p.*
      FROM projects p
      ORDER BY 
        CASE WHEN p.start_date IS NULL THEN 1 ELSE 0 END,
        p.start_date DESC,
        p.project_id DESC
    `);

    console.log(`[Project Activities API] Found ${projects.length} projects after main query`); // Debug log
    console.log(`[Project Activities API] Project IDs from DB:`, projects.map(p => p.project_id).sort((a, b) => a - b)); // Debug log
    
    // Normalize project name field
    projects.forEach(p => {
      if (!p.project_name && p.name) p.project_name = p.name;
      if (!p.project_name && p.project_title) p.project_name = p.project_title;
    });
    
    // Check specifically for project 1610
    const project1610 = projects.find(p => p.project_id === 1610 || p.project_id === '1610' || p.project_code === '1610' || p.project_name?.includes('1610'));
    if (project1610) {
      console.log(`[Project Activities API] ✅ Found project 1610:`, {
        id: project1610.project_id,
        name: project1610.project_name,
        code: project1610.project_code,
        has_activities_list: !!project1610.project_activities_list,
        activities_list_length: project1610.project_activities_list?.length || 0
      });
    } else {
      console.log(`[Project Activities API] ❌ Project 1610 NOT FOUND in database query!`);
      console.log(`[Project Activities API] Available project identifiers:`, projects.map(p => ({
        id: p.project_id,
        name: p.project_name || p.name || p.project_title,
        code: p.project_code
      })).slice(0, 20));
    }

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
      const [employees] = await db.execute(`SELECT id, first_name, last_name, email FROM employees`);
      for (const emp of employees) {
        if (!userMap[String(emp.id)]) {
          const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(' ');
          userMap[String(emp.id)] = fullName || emp.email;
        }
      }
    } catch (e) {
      console.warn('Could not fetch employees for name resolution:', e.message);
    }

    const result = [];

    for (const project of projects) {
      let activities = [];
      const isProject1610 = project.project_id === 1610 || project.project_id === '1610' || project.project_code === '1610' || project.name?.includes('1610');
      
      if (isProject1610) {
        console.log(`[Project 1610] Processing project:`, {
          id: project.project_id,
          name: project.name,
          code: project.project_code
        });
      }
      
      // 1. Try to get activities from JSON field (project_activities_list)
      try {
        let activitiesList = [];
        
        // Parse activities list if it exists
        if (project.project_activities_list) {
          activitiesList = typeof project.project_activities_list === 'string'
            ? JSON.parse(project.project_activities_list)
            : project.project_activities_list;
        }

        // Ensure it's an array
        if (!Array.isArray(activitiesList)) {
          activitiesList = [];
        }

        for (const activity of activitiesList) {
          const assignedUsers = activity.assigned_users || [];
          const members = [];

          if (Array.isArray(assignedUsers)) {
            for (const assignment of assignedUsers) {
              const userData = typeof assignment === 'object' ? assignment : { user_id: assignment };
              const userId = String(userData.user_id);
              const dailyEntries = Array.isArray(userData.daily_entries) ? userData.daily_entries.filter(e => e && typeof e === 'object') : [];
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
        
        if (isProject1610) {
          console.log(`[Project 1610] Parsed ${activities.length} activities from JSON:`, activities.map(a => ({
            id: a.id,
            name: a.activity_name,
            members: a.members?.length || 0
          })));
        }
      } catch (parseErr) {
        console.error(`Failed to parse activities for project ${project.project_id}:`, parseErr.message);
        if (isProject1610) {
          console.error(`[Project 1610] JSON parsing failed:`, parseErr);
        }
        // Continue with empty activities array
        activities = [];
      }

      // 2. Also fetch activities from project_activities table
      try {
        const [tableActivities] = await db.execute(
          `SELECT 
            id,
            activity_name,
            discipline_name,
            start_date,
            end_date,
            manhours_planned,
            manhours_actual,
            status,
            progress_percentage,
            notes
          FROM project_activities 
          WHERE project_id = ?
          ORDER BY created_at DESC`,
          [project.project_id]
        );

        // Add activities from table (these typically don't have assigned users in same format)
        for (const tableActivity of tableActivities) {
          // Check if this activity already exists in JSON activities (avoid duplicates)
          const existsInJson = activities.some(a => 
            a.id === tableActivity.id || 
            (a.activity_name === tableActivity.activity_name && a.discipline === tableActivity.discipline_name)
          );

          if (!existsInJson) {
            activities.push({
              id: tableActivity.id,
              activity_name: tableActivity.activity_name,
              activity_description: tableActivity.notes || '',
              discipline: tableActivity.discipline_name || 'General',
              members: [], // Table activities don't have user assignments in same structure
              source: 'table',
              start_date: tableActivity.start_date,
              end_date: tableActivity.end_date,
              manhours_planned: tableActivity.manhours_planned || 0,
              manhours_actual: tableActivity.manhours_actual || 0,
              status: tableActivity.status || 'Not Started',
              progress_percentage: tableActivity.progress_percentage || 0
            });
          }
        }
        
        if (isProject1610) {
          console.log(`[Project 1610] Found ${tableActivities.length} activities in project_activities table`);
          console.log(`[Project 1610] Total activities after merging: ${activities.length}`);
          if (activities.length > 0) {
            console.log(`[Project 1610] All activities:`, activities.map(a => ({
              id: a.id,
              name: a.activity_name,
              source: a.source,
              members: a.members?.length || 0
            })));
          }
        }
      } catch (tableErr) {
        console.warn(`Could not fetch table activities for project ${project.project_id}:`, tableErr.message);
        if (isProject1610) {
          console.warn(`[Project 1610] Table query failed:`, tableErr.message);
        }
        // Continue - just means project_activities table might not exist
      }

      // Always add the project to result, even if activities parsing failed
      result.push({
        project_id: project.project_id,
        project_name: project.project_name,
        project_code: project.project_code,
        project_status: project.project_status,
        start_date: project.start_date,
        end_date: project.end_date,
        activities
      });
    }

    console.log(`[Project Activities API] Returning ${result.length} projects`); // Debug log
    console.log(`[Project Activities API] Result project IDs:`, result.map(p => p.project_id).sort((a, b) => a - b)); // Debug log
    console.log(`[Project Activities API] Total activities across all projects:`, result.reduce((sum, p) => sum + p.activities.length, 0)); // Debug log
    
    if (projects.length !== result.length) {
      console.warn(`[Project Activities API] WARNING: Database had ${projects.length} projects but only returning ${result.length}!`);
      const dbIds = new Set(projects.map(p => p.project_id));
      const resultIds = new Set(result.map(p => p.project_id));
      const missing = [...dbIds].filter(id => !resultIds.has(id));
      console.warn(`[Project Activities API] Missing project IDs:`, missing);
    }

    return NextResponse.json({ success: true, data: result, meta: { total_in_db: projects.length, total_returned: result.length } });
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
