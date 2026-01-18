import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/manhours-stats
 * 
 * Optimized endpoint for manhours/workload statistics.
 * Separated from main dashboard stats for optional lazy loading.
 * 
 * Returns:
 * - Total estimated vs actual hours
 * - Top 5 projects by manhours
 * - Weekly trend (last 4 weeks)
 */
export async function GET(request) {
  const startTime = Date.now();
  
  try {
    // Auth check
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    if (!user.is_super_admin) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const db = await dbConnect();
    
    try {
      // Execute queries in parallel
      const [
        projectHours,
        weeklyActual
      ] = await Promise.all([
        // 1. Get project hours summary (estimated from budget, actual from work logs)
        db.execute(`
          SELECT 
            p.project_id,
            p.name,
            COALESCE(p.budget, 0) as estimated_hours,
            COALESCE(SUM(wl.hours_worked), 0) as actual_hours
          FROM projects p
          LEFT JOIN work_logs wl ON wl.project_id = p.project_id 
            AND wl.log_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          GROUP BY p.project_id, p.name, p.budget
          HAVING estimated_hours > 0 OR actual_hours > 0
          ORDER BY actual_hours DESC
          LIMIT 10
        `).then(([rows]) => rows).catch(() => []),
        
        // 2. Weekly actual hours (last 4 weeks)
        db.execute(`
          SELECT 
            YEARWEEK(log_date, 1) as year_week,
            SUM(hours_worked) as total_hours
          FROM work_logs
          WHERE log_date >= DATE_SUB(CURDATE(), INTERVAL 28 DAY)
          GROUP BY YEARWEEK(log_date, 1)
          ORDER BY year_week ASC
        `).then(([rows]) => rows).catch(() => [])
      ]);

      // Calculate totals
      let totalEstimated = 0;
      let totalActual = 0;
      
      const byProject = projectHours.map(p => {
        const est = parseFloat(p.estimated_hours) || 0;
        const act = parseFloat(p.actual_hours) || 0;
        totalEstimated += est;
        totalActual += act;
        
        return {
          name: p.name || 'Unnamed',
          estimated: Math.round(est),
          actual: Math.round(act * 10) / 10,
          efficiency: est > 0 ? Math.round((act / est) * 100) : 0
        };
      }).slice(0, 5);

      // Build weekly trend (ensure 4 weeks)
      const weeklyTrend = [];
      const now = new Date();
      
      for (let w = 3; w >= 0; w--) {
        const weekDate = new Date(now);
        weekDate.setDate(weekDate.getDate() - (w * 7));
        
        // Get yearweek for this date
        const yearWeek = getYearWeek(weekDate);
        const weekData = weeklyActual.find(r => r.year_week === yearWeek);
        
        weeklyTrend.push({
          week: `W${4 - w}`,
          hours: Math.round((weekData?.total_hours || 0) * 10) / 10
        });
      }

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: {
          estimated: Math.round(totalEstimated),
          actual: Math.round(totalActual * 10) / 10,
          byProject,
          weeklyTrend,
          _meta: { queryTimeMs: queryTime }
        }
      });

      // Cache for 60 seconds (manhours change less frequently)
      response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      
      return response;
      
    } finally {
      db.release();
    }
    
  } catch (error) {
    console.error('Manhours stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch manhours stats' },
      { status: 500 }
    );
  }
}

// Helper to get MySQL-compatible YEARWEEK value
function getYearWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday of current week determines the year
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return d.getFullYear() * 100 + weekNum;
}
