import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/users/[id]/activity-assignments
 * Fetch all activity assignments for a user from project_activities_list
 */
export async function GET(request, { params }) {
  let db;
  try {
    const { id } = await params;
    const requestedUserId = parseInt(id);
    
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Users can view their own assignments
    const isOwnData = requestedUserId === currentUser.id;
    if (!isOwnData && !currentUser.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden' 
      }, { status: 403 });
    }

    db = await dbConnect();
    
    // Get projects where this user might be assigned (filter by JSON content for speed)
    // Use word-boundary-like patterns to avoid false positives (e.g., user 1 matching user 10)
    const userIdStr = String(requestedUserId);
    const [projects] = await db.execute(`
      SELECT 
        p.project_id,
        p.name as project_name,
        p.project_code,
        p.status as project_status,
        p.start_date,
        p.end_date,
        p.project_activities_list
      FROM projects p
      WHERE p.project_activities_list IS NOT NULL 
        AND p.project_activities_list != '' 
        AND p.project_activities_list != '[]'
        AND (p.project_activities_list LIKE ? OR p.project_activities_list LIKE ?)
      ORDER BY p.start_date DESC
    `, [`%"user_id":"${userIdStr}"%`, `%"user_id":${userIdStr},%`]);

    const assignments = [];

    for (const project of projects) {
      try {
        const activitiesList = typeof project.project_activities_list === 'string'
          ? JSON.parse(project.project_activities_list)
          : project.project_activities_list;

        if (!Array.isArray(activitiesList)) continue;

        for (const activity of activitiesList) {
          const assignedUsers = activity.assigned_users || [];
          
          if (!Array.isArray(assignedUsers)) continue;

          // Find this user's assignment in the activity
          for (const assignment of assignedUsers) {
            const assignedUserId = typeof assignment === 'object' ? assignment.user_id : assignment;
            
            if (String(assignedUserId) === String(requestedUserId)) {
              // This user is assigned to this activity
              const userAssignment = typeof assignment === 'object' ? assignment : { user_id: assignment };
              
              assignments.push({
                project_id: project.project_id,
                project_name: project.project_name,
                project_code: project.project_code,
                project_status: project.project_status,
                project_start_date: project.start_date,
                project_end_date: project.end_date,
                activity_id: activity.id,
                activity_name: activity.activity_name || activity.name || 'Unnamed Activity',
                activity_description: activity.activity_description || '',
                discipline: activity.discipline || activity.function_name || 'General',
                // User-specific data
                description: userAssignment.description || '',
                qty_assigned: userAssignment.qty_assigned || 0,
                qty_completed: userAssignment.qty_completed || 0,
                planned_hours: userAssignment.planned_hours || 0,
                actual_hours: userAssignment.actual_hours || 0,
                start_date: userAssignment.start_date || null,
                due_date: userAssignment.due_date || null,
                status: userAssignment.status || 'Not Started',
                notes: userAssignment.notes || '',
                remarks: userAssignment.remarks || '',
                daily_entries: userAssignment.daily_entries || []
              });
            }
          }
        }
      } catch (parseErr) {
        console.error(`Failed to parse activities for project ${project.project_id}:`, parseErr.message);
      }
    }

    // Calculate stats
    const stats = {
      totalAssignments: assignments.length,
      totalProjects: [...new Set(assignments.map(a => a.project_id))].length,
      totalQtyAssigned: assignments.reduce((sum, a) => sum + (parseFloat(a.qty_assigned) || 0), 0),
      totalQtyCompleted: assignments.reduce((sum, a) => sum + (parseFloat(a.qty_completed) || 0), 0),
      totalPlannedHours: assignments.reduce((sum, a) => sum + (parseFloat(a.planned_hours) || 0), 0),
      totalActualHours: assignments.reduce((sum, a) => sum + (parseFloat(a.actual_hours) || 0), 0),
      completedCount: assignments.filter(a => a.status === 'Completed').length,
      inProgressCount: assignments.filter(a => a.status === 'In Progress').length,
      notStartedCount: assignments.filter(a => a.status === 'Not Started').length,
      onHoldCount: assignments.filter(a => a.status === 'On Hold').length
    };

    db.release();

    const response = NextResponse.json({ 
      success: true, 
      data: {
        assignments,
        stats
      }
    });
    
    // Cache for 30 seconds since this data changes infrequently
    response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
    
    return response;
  } catch (error) {
    console.error('Error fetching user activity assignments:', error);
    if (db) {
      try { db.release(); } catch {}
    }
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch activity assignments',
      details: error.message
    }, { status: 500 });
  }
}

/**
 * PUT /api/users/[id]/activity-assignments
 * Update a user's progress on an activity
 */
export async function PUT(request, { params }) {
  let db;
  try {
    const { id } = await params;
    const requestedUserId = parseInt(id);
    
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Users can update their own assignments
    // Super admins can edit any user's assignments
    const isOwnData = requestedUserId === currentUser.id;
    if (!isOwnData && !currentUser.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden - Only super admins can edit other users\' assignments' 
      }, { status: 403 });
    }

    const body = await request.json();
    const { project_id, activity_id, qty_assigned, qty_completed, actual_hours, status, remarks, description, start_date, due_date, notes, daily_entries } = body;

    console.log('[Activity Assignment Update] User:', currentUser.username, '(super_admin:', currentUser.is_super_admin, ') updating user:', requestedUserId);
    console.log('[Activity Assignment Update] project_id:', project_id, 'activity_id:', activity_id);
    console.log('[Activity Assignment Update] daily_entries count:', daily_entries?.length || 0);

    if (!project_id || !activity_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'project_id and activity_id are required' 
      }, { status: 400 });
    }

    db = await dbConnect();

    // Get the project's activities list
    let projects;
    try {
      [projects] = await db.execute(
        'SELECT project_id, project_activities_list FROM projects WHERE project_id = ?',
        [project_id]
      );
    } catch (err) {
      console.error('[Activity Assignment Update] Error fetching project:', err.message);
      db.release();
      throw err;
    }

    if (projects.length === 0) {
      console.error('[Activity Assignment Update] Project not found with project_id:', project_id);
      db.release();
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const project = projects[0];
    console.log('[Activity Assignment Update] Found project with project_id:', project.project_id);

    let activitiesList = project.project_activities_list;
    if (typeof activitiesList === 'string') {
      try {
        activitiesList = JSON.parse(activitiesList);
      } catch (parseErr) {
        console.error('[Activity Assignment Update] Error parsing activities list:', parseErr.message);
        db.release();
        return NextResponse.json({ success: false, error: 'Invalid activities data' }, { status: 500 });
      }
    }

    if (!Array.isArray(activitiesList)) {
      console.error('[Activity Assignment Update] Activities list is not an array');
      db.release();
      return NextResponse.json({ success: false, error: 'No activities found' }, { status: 404 });
    }

    console.log('[Activity Assignment Update] Found', activitiesList.length, 'activities');

    // Find and update the activity
    let updated = false;
    let activityFound = false;
    for (const activity of activitiesList) {
      // More flexible activity ID matching
      const activityIdMatch = String(activity.id) === String(activity_id) || 
                              String(activity.activity_id) === String(activity_id);
      
      if (activityIdMatch) {
        activityFound = true;
        console.log('[Activity Assignment Update] Found matching activity:', activity.activity_name || activity.name);
        const assignedUsers = activity.assigned_users || [];
        console.log('[Activity Assignment Update] Activity has', assignedUsers.length, 'assigned users');
        
        for (let i = 0; i < assignedUsers.length; i++) {
          const assignment = assignedUsers[i];
          const assignedUserId = typeof assignment === 'object' ? assignment.user_id : assignment;
          
          if (String(assignedUserId) === String(requestedUserId)) {
            console.log('[Activity Assignment Update] Found user assignment at index', i);
            // Update this user's assignment
            if (typeof assignment === 'object') {
              if (qty_assigned !== undefined) assignedUsers[i].qty_assigned = parseFloat(qty_assigned) || 0;
              if (qty_completed !== undefined) assignedUsers[i].qty_completed = parseFloat(qty_completed) || 0;
              if (actual_hours !== undefined) assignedUsers[i].actual_hours = parseFloat(actual_hours) || 0;
              if (status !== undefined) assignedUsers[i].status = status;
              if (remarks !== undefined) assignedUsers[i].remarks = remarks;
              if (description !== undefined) assignedUsers[i].description = description;
              if (start_date !== undefined) assignedUsers[i].start_date = start_date;
              if (due_date !== undefined) assignedUsers[i].due_date = due_date;
              if (notes !== undefined) assignedUsers[i].notes = notes;
              if (daily_entries !== undefined) {
                assignedUsers[i].daily_entries = daily_entries;
                console.log('[Activity Assignment Update] Updated daily_entries:', daily_entries.length, 'entries');
              }
            } else {
              // Convert to object
              assignedUsers[i] = {
                user_id: assignedUserId,
                qty_assigned: parseFloat(qty_assigned) || 0,
                qty_completed: parseFloat(qty_completed) || 0,
                planned_hours: 0,
                actual_hours: parseFloat(actual_hours) || 0,
                status: status || 'Not Started',
                remarks: remarks || '',
                description: description || '',
                start_date: start_date || null,
                due_date: due_date || null,
                notes: notes || '',
                daily_entries: daily_entries || []
              };
            }
            updated = true;
            break;
          }
        }
        
        activity.assigned_users = assignedUsers;
        break;
      }
    }

    if (!updated) {
      if (activityFound) {
        console.error('[Activity Assignment Update] Activity found but user not assigned - activity_id:', activity_id, 'user_id:', requestedUserId);
        db.release();
        return NextResponse.json({ success: false, error: 'User is not assigned to this activity' }, { status: 404 });
      } else {
        console.error('[Activity Assignment Update] Activity not found - activity_id:', activity_id);
        console.error('[Activity Assignment Update] Available activity IDs:', activitiesList.map(a => a.id || a.activity_id).join(', '));
        db.release();
        return NextResponse.json({ success: false, error: 'Activity not found in project' }, { status: 404 });
      }
    }

    console.log('[Activity Assignment Update] Saving updated activities list to database...');

    // Save back to database using project_id
    const updateResult = await db.execute(
      'UPDATE projects SET project_activities_list = ? WHERE project_id = ?',
      [JSON.stringify(activitiesList), project.project_id]
    );

    console.log('[Activity Assignment Update] Update result - rows affected:', updateResult[0].affectedRows);

    db.release();

    return NextResponse.json({ 
      success: true, 
      message: 'Assignment updated successfully',
      affected_rows: updateResult[0].affectedRows
    });
  } catch (error) {
    console.error('[Activity Assignment Update] Error:', error);
    if (db) {
      try { db.release(); } catch {}
    }
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update assignment',
      details: error.message
    }, { status: 500 });
  }
}
