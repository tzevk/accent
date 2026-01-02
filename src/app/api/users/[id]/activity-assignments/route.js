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
    
    // Get all projects with their activities
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
      ORDER BY p.start_date DESC
    `);

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
                discipline: activity.discipline || activity.function_name || 'General',
                // User-specific data
                qty_assigned: userAssignment.qty_assigned || 0,
                qty_completed: userAssignment.qty_completed || 0,
                planned_hours: userAssignment.planned_hours || 0,
                actual_hours: userAssignment.actual_hours || 0,
                due_date: userAssignment.due_date || null,
                status: userAssignment.status || 'Not Started',
                remarks: userAssignment.remarks || ''
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

    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: {
        assignments,
        stats
      }
    });
  } catch (error) {
    console.error('Error fetching user activity assignments:', error);
    if (db) {
      try { await db.end(); } catch {}
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
    const isOwnData = requestedUserId === currentUser.id;
    if (!isOwnData && !currentUser.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden' 
      }, { status: 403 });
    }

    const body = await request.json();
    const { project_id, activity_id, qty_completed, actual_hours, status, remarks } = body;

    if (!project_id || !activity_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'project_id and activity_id are required' 
      }, { status: 400 });
    }

    db = await dbConnect();

    // Get the project's activities list
    const [projects] = await db.execute(
      'SELECT project_activities_list FROM projects WHERE project_id = ?',
      [project_id]
    );

    if (projects.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    let activitiesList = projects[0].project_activities_list;
    if (typeof activitiesList === 'string') {
      activitiesList = JSON.parse(activitiesList);
    }

    if (!Array.isArray(activitiesList)) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No activities found' }, { status: 404 });
    }

    // Find and update the activity
    let updated = false;
    for (const activity of activitiesList) {
      if (String(activity.id) === String(activity_id)) {
        const assignedUsers = activity.assigned_users || [];
        
        for (let i = 0; i < assignedUsers.length; i++) {
          const assignment = assignedUsers[i];
          const assignedUserId = typeof assignment === 'object' ? assignment.user_id : assignment;
          
          if (String(assignedUserId) === String(requestedUserId)) {
            // Update this user's assignment
            if (typeof assignment === 'object') {
              if (qty_completed !== undefined) assignedUsers[i].qty_completed = parseFloat(qty_completed) || 0;
              if (actual_hours !== undefined) assignedUsers[i].actual_hours = parseFloat(actual_hours) || 0;
              if (status !== undefined) assignedUsers[i].status = status;
              if (remarks !== undefined) assignedUsers[i].remarks = remarks;
            } else {
              // Convert to object
              assignedUsers[i] = {
                user_id: assignedUserId,
                qty_assigned: 0,
                qty_completed: parseFloat(qty_completed) || 0,
                planned_hours: 0,
                actual_hours: parseFloat(actual_hours) || 0,
                status: status || 'Not Started',
                remarks: remarks || ''
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
      await db.end();
      return NextResponse.json({ success: false, error: 'Assignment not found' }, { status: 404 });
    }

    // Save back to database
    await db.execute(
      'UPDATE projects SET project_activities_list = ? WHERE project_id = ?',
      [JSON.stringify(activitiesList), project_id]
    );

    await db.end();

    return NextResponse.json({ 
      success: true, 
      message: 'Assignment updated successfully'
    });
  } catch (error) {
    console.error('Error updating activity assignment:', error);
    if (db) {
      try { await db.end(); } catch {}
    }
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update assignment',
      details: error.message
    }, { status: 500 });
  }
}
