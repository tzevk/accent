import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

// Helper to check if user is in project team
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
 * GET /api/projects/list
 * 
 * Optimized endpoint for projects list page.
 * 
 * Performance optimizations:
 * 1. Single DB connection for all queries
 * 2. Parallel query execution using Promise.all
 * 3. No schema checks (tables should exist already)
 * 4. Only fetches fields needed for list view
 * 5. Cache-Control headers for client-side caching
 */
export async function GET(request) {
  const startTime = Date.now();
  
  try {
    // Auth check
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Permission check
    const canReadProjects = user.is_super_admin || hasPermission(user, 'projects', 'read');
    if (!canReadProjects) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const priority = searchParams.get('priority') || '';

    const db = await dbConnect();
    
    try {
      // Execute queries in parallel
      const [projectsResult, statsResult] = await Promise.all([
        // 1. Projects query - select only needed fields for list view
        db.execute(`
          SELECT 
            p.id,
            p.project_id,
            p.project_code,
            p.name,
            p.client_name,
            p.status,
            p.priority,
            p.progress,
            p.start_date,
            p.end_date,
            p.target_date,
            p.budget,
            p.type,
            p.project_team,
            p.created_at,
            c.company_name
          FROM projects p
          LEFT JOIN companies c ON p.company_id = c.id
          ORDER BY p.created_at DESC
        `).catch(() => {
          // Fallback without company join if it fails
          return db.execute(`
            SELECT 
              id, project_id, project_code, name, client_name, status, priority,
              progress, start_date, end_date, target_date, budget, type, project_team, created_at
            FROM projects
            ORDER BY created_at DESC
          `);
        }),
        
        // 2. Stats query - single query with conditional counts
        db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(status) LIKE '%progress%' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN LOWER(status) LIKE '%complete%' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN LOWER(status) = 'new' THEN 1 ELSE 0 END) as new_projects,
            SUM(CASE WHEN LOWER(status) LIKE '%hold%' THEN 1 ELSE 0 END) as on_hold,
            SUM(COALESCE(budget, 0)) as total_budget
          FROM projects
        `)
      ]);

      let [projects] = projectsResult;
      const [[stats]] = statsResult;

      // Filter by team membership if not super admin
      if (!user.is_super_admin) {
        projects = projects.filter(project => 
          isUserInProjectTeam(project.project_team, user.id, user.email)
        );
      }

      // Apply filters client-side for simplicity (data is already fetched)
      if (search) {
        const s = search.toLowerCase();
        projects = projects.filter(p => 
          (p.name || '').toLowerCase().includes(s) ||
          (p.project_id || '').toLowerCase().includes(s) ||
          (p.client_name || '').toLowerCase().includes(s)
        );
      }
      
      if (status) {
        projects = projects.filter(p => 
          (p.status || '').toLowerCase() === status.toLowerCase()
        );
      }
      
      if (priority) {
        projects = projects.filter(p => 
          (p.priority || '').toLowerCase() === priority.toLowerCase()
        );
      }

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: projects,
        stats: {
          total: Number(stats.total) || 0,
          in_progress: Number(stats.in_progress) || 0,
          completed: Number(stats.completed) || 0,
          new_projects: Number(stats.new_projects) || 0,
          on_hold: Number(stats.on_hold) || 0,
          total_budget: Number(stats.total_budget) || 0
        },
        _meta: {
          queryTimeMs: queryTime,
          filtered: projects.length
        }
      });

      // Cache for 30 seconds
      response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
      
      return response;
      
    } finally {
      db.release();
    }
    
  } catch (error) {
    console.error('Projects list error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
