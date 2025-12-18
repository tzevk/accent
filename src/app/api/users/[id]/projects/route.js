import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/users/[id]/projects
 * Fetch all projects assigned to a user with their activities
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

    // Users can view their own projects
    const isOwnData = requestedUserId === currentUser.id;
    if (!isOwnData && !currentUser.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden' 
      }, { status: 403 });
    }

    db = await dbConnect();
    
    let projects = [];
    let useActivityAssignments = false;

    // Try to get projects from user_activity_assignments first
    try {
      const [tables] = await db.execute(`SHOW TABLES LIKE 'user_activity_assignments'`);
      if (tables.length > 0) {
        const [assignedProjects] = await db.execute(`
          SELECT DISTINCT
            p.id as project_id,
            p.name as project_name,
            p.project_id as project_code,
            p.status as project_status,
            p.start_date as project_start_date,
            p.end_date as project_end_date,
            p.budget as project_estimated_hours
          FROM projects p
          INNER JOIN user_activity_assignments uaa ON p.id = uaa.project_id
          WHERE uaa.user_id = ?
          ORDER BY p.start_date DESC
        `, [requestedUserId]);
        if (assignedProjects.length > 0) {
          projects = assignedProjects;
          useActivityAssignments = true;
        }
      }
    } catch (err) {
      console.log('user_activity_assignments query failed:', err.message);
    }

    // Fallback: Get projects from project_team JSON column
    if (projects.length === 0) {
      try {
        // Get all projects and filter by project_team JSON containing the user ID
        const [allProjects] = await db.execute(`
          SELECT 
            p.id as project_id,
            p.name as project_name,
            p.project_id as project_code,
            p.status as project_status,
            p.start_date as project_start_date,
            p.end_date as project_end_date,
            p.budget as project_estimated_hours,
            p.project_team
          FROM projects p
          WHERE p.project_team IS NOT NULL AND p.project_team != '' AND p.project_team != '[]'
          ORDER BY p.start_date DESC
        `);
        
        // Filter projects where user is in the project_team JSON
        projects = allProjects.filter(project => {
          try {
            const team = typeof project.project_team === 'string' 
              ? JSON.parse(project.project_team) 
              : project.project_team;
            if (Array.isArray(team)) {
              // Check if user id matches any team member's id
              return team.some(member => member.id === requestedUserId);
            }
            return false;
          } catch {
            return false;
          }
        }).map(project => {
          // Remove project_team from result
          const result = { ...project };
          delete result.project_team;
          return result;
        });
        
      } catch (err) {
        console.log('project_team JSON query failed:', err.message);
      }
    }

    // For each project, get the activities
    const projectsWithActivities = await Promise.all(projects.map(async (project) => {
      let activities = [];
      
      // Try user_activity_assignments first
      if (useActivityAssignments) {
        try {
          const [assignedActivities] = await db.execute(`
            SELECT 
              uaa.id,
              uaa.activity_name,
              uaa.status,
              uaa.priority,
              uaa.start_date,
              uaa.due_date as end_date,
              uaa.actual_completion_date,
              uaa.estimated_hours as assigned_manhours,
              uaa.actual_hours as actual_manhours,
              uaa.created_at
            FROM user_activity_assignments uaa
            WHERE uaa.user_id = ? AND uaa.project_id = ?
            ORDER BY uaa.created_at ASC
          `, [requestedUserId, project.project_id]);
          activities = assignedActivities;
        } catch (err) {
          console.log('user_activity_assignments activities query failed:', err.message);
        }
      }
      
      // Fallback: Get activities from project_activities table with assigned_to column
      if (activities.length === 0) {
        try {
          const [projectActivities] = await db.execute(`
            SELECT 
              pa.id,
              pa.activity_name,
              pa.status,
              pa.priority,
              pa.start_date,
              pa.end_date,
              pa.actual_end_date as actual_completion_date,
              pa.required_hours as assigned_manhours,
              pa.actual_hours as actual_manhours,
              pa.created_at
            FROM project_activities pa
            WHERE pa.project_id = ? AND pa.assigned_to = ?
            ORDER BY pa.created_at ASC
          `, [project.project_id, requestedUserId]);
          activities = projectActivities;
        } catch (err) {
          console.log('project_activities query failed:', err.message);
        }
      }
      
      // Another fallback: Get activities from teamMembers JSON in projects table
      if (activities.length === 0) {
        try {
          const [projectRow] = await db.execute(`
            SELECT team_members FROM projects WHERE id = ?
          `, [project.project_id]);
          
          if (projectRow.length > 0 && projectRow[0].team_members) {
            const teamMembers = typeof projectRow[0].team_members === 'string' 
              ? JSON.parse(projectRow[0].team_members) 
              : projectRow[0].team_members;
            
            if (Array.isArray(teamMembers)) {
              // Find activities assigned to this user
              const userActivities = teamMembers.filter(tm => 
                tm.employee_id === requestedUserId || tm.user_id === requestedUserId
              );
              
              activities = userActivities.map(tm => ({
                id: tm.id,
                activity_name: tm.activity_name || tm.activity || 'Activity',
                status: tm.status || 'Not Started',
                priority: tm.priority || 'Medium',
                start_date: tm.start_date,
                end_date: tm.end_date,
                actual_completion_date: tm.actual_end_date,
                assigned_manhours: parseFloat(tm.required_hours) || 0,
                actual_manhours: parseFloat(tm.actual_hours) || 0,
                created_at: tm.created_at
              }));
            }
          }
        } catch (err) {
          console.log('teamMembers JSON query failed:', err.message);
        }
      }

      // Calculate totals
      const totalAssignedHours = activities.reduce((sum, a) => sum + (parseFloat(a.assigned_manhours) || 0), 0);
      const totalActualHours = activities.reduce((sum, a) => sum + (parseFloat(a.actual_manhours) || 0), 0);
      const completedCount = activities.filter(a => a.status === 'Completed').length;
      const inProgressCount = activities.filter(a => a.status === 'In Progress').length;

      // Serialize activities (create numbered list)
      const serializedActivities = activities.map((a, idx) => ({
        srNo: idx + 1,
        ...a
      }));

      return {
        ...project,
        activities: serializedActivities,
        activityCount: activities.length,
        completedCount,
        inProgressCount,
        totalAssignedHours,
        totalActualHours,
        remainingHours: totalAssignedHours - totalActualHours
      };
    }));

    // Calculate overall totals
    const overallStats = {
      totalProjects: projectsWithActivities.length,
      totalActivities: projectsWithActivities.reduce((sum, p) => sum + p.activityCount, 0),
      totalAssignedHours: projectsWithActivities.reduce((sum, p) => sum + p.totalAssignedHours, 0),
      totalActualHours: projectsWithActivities.reduce((sum, p) => sum + p.totalActualHours, 0),
      completedActivities: projectsWithActivities.reduce((sum, p) => sum + p.completedCount, 0),
      inProgressActivities: projectsWithActivities.reduce((sum, p) => sum + p.inProgressCount, 0)
    };

    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: {
        projects: projectsWithActivities,
        stats: overallStats
      }
    });
  } catch (error) {
    console.error('Error fetching user projects:', error);
    if (db) {
      try { await db.end(); } catch {}
    }
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch projects',
      details: error.message
    }, { status: 500 });
  }
}
