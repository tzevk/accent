import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * Helper to check if user is in project team
 */
function isUserInProjectTeam(projectTeam, userId, userEmail) {
  if (!projectTeam) return false;
  try {
    const team = typeof projectTeam === 'string' ? JSON.parse(projectTeam) : projectTeam;
    if (!Array.isArray(team)) return false;
    return team.some(member => 
      String(member.user_id) === String(userId) || 
      String(member.id) === String(userId) ||
      member.email === userEmail
    );
  } catch {
    return false;
  }
}

/**
 * Helper to safely parse JSON fields
 */
function parseJsonField(value, fallback = []) {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * GET /api/projects/[id]/detail
 * 
 * Optimized endpoint for fetching single project details.
 * 
 * Performance optimizations:
 * 1. No schema introspection queries
 * 2. Single query with OR conditions for flexible ID matching
 * 3. Parallel fetch for project and activities
 * 4. Cache-Control headers
 */
export async function GET(request, { params }) {
  const startTime = Date.now();
  
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id || id === 'undefined') {
      return NextResponse.json({ success: false, error: 'Invalid project id' }, { status: 400 });
    }

    const isSuperAdmin = user.is_super_admin;

    const db = await dbConnect();
    
    try {
      // Single query to find project - try project_id first, then project_code
      let project = null;
      
      // Always try text-based lookup first since project_id is the primary identifier
      const [rows] = await db.execute(`
        SELECT * FROM projects 
        WHERE project_id = ? OR project_code = ?
        LIMIT 1
      `, [id, id]);
      project = rows[0];

      if (!project) {
        return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
      }

      // Team access check
      if (!isSuperAdmin) {
        const isTeamMember = isUserInProjectTeam(project.project_team, user.id, user.email);
        if (!isTeamMember) {
          return NextResponse.json({ 
            success: false, 
            error: 'You do not have permission to access this project' 
          }, { status: 403 });
        }
      }

      // Determine project key for related queries
      const projectKey = project.id || project.project_id;

      // Fetch related data in parallel
      const [activitiesResult, assignmentsResult] = await Promise.all([
        db.execute(
          'SELECT * FROM project_activities WHERE project_id = ? ORDER BY created_at DESC',
          [projectKey]
        ).catch(() => [[]]),
        
        db.execute(
          'SELECT * FROM user_activity_assignments WHERE project_id = ?',
          [projectKey]
        ).catch(() => [[]])
      ]);

      const [projectActivities] = activitiesResult;
      const [assignments] = assignmentsResult;

      // Parse all JSON fields
      const jsonFields = [
        'planning_activities_list', 'documents_list', 'input_documents_list',
        'documents_received_list', 'documents_issued_list', 'project_handover_list',
        'project_manhours_list', 'project_query_log_list', 'project_assumption_list',
        'project_lessons_learnt_list', 'project_schedule_list', 'kickoff_meetings_list',
        'internal_meetings_list', 'software_items', 'project_activities_list', 'project_team'
      ];
      
      for (const field of jsonFields) {
        if (project[field]) {
          project[field] = parseJsonField(project[field]);
        }
      }

      // Merge activity assignments
      if (project.project_activities_list && Array.isArray(project.project_activities_list) && assignments.length > 0) {
        const assignmentMap = new Map();
        for (const assignment of assignments) {
          assignmentMap.set(assignment.activity_name, assignment);
        }
        
        project.project_activities_list = project.project_activities_list.map(activity => {
          const assignment = assignmentMap.get(activity.name);
          if (assignment) {
            return {
              ...activity,
              assigned_user: assignment.user_id ? String(assignment.user_id) : activity.assigned_user || '',
              due_date: assignment.due_date || activity.due_date || '',
              priority: assignment.priority || activity.priority || 'MEDIUM'
            };
          }
          return activity;
        });
      }

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: {
          ...project,
          project_activities: projectActivities || []
        },
        _meta: { queryTimeMs: queryTime }
      });

      // Cache for 15 seconds (shorter than list since it's for editing)
      response.headers.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
      
      return response;

    } finally {
      if (db && typeof db.release === 'function') {
        try { db.release(); } catch (e) { console.error('Error releasing connection:', e); }
      }
    }

  } catch (error) {
    console.error('Project detail error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch project', details: error.message },
      { status: 500 }
    );
  }
}
