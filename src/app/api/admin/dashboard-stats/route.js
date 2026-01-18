import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/dashboard-stats
 * 
 * Single optimized endpoint for admin dashboard statistics.
 * Replaces multiple sequential API calls with parallel DB queries.
 * 
 * Performance optimizations:
 * 1. Single DB connection for all queries
 * 2. Parallel query execution using Promise.all
 * 3. Lightweight COUNT queries instead of fetching full datasets
 * 4. Cache-Control headers for client-side caching
 * 5. No schema checks (tables should exist already)
 */
export async function GET(request) {
  const startTime = Date.now();
  
  try {
    // Auth check
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Only super admins can access admin dashboard stats
    if (!user.is_super_admin) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const db = await dbConnect();
    
    try {
      // Execute all queries in parallel using a single connection
      const [
        leadsStats,
        proposalsStats,
        companiesCount,
        projectsStats,
        recentLeads,
        recentProposals,
        recentCompanies,
        recentProjects,
        followupsStats
      ] = await Promise.all([
        // 1. Leads statistics - single query with conditional counts
        db.execute(`
          SELECT 
            COUNT(*) as total_leads,
            SUM(CASE WHEN enquiry_status = 'Under Discussion' THEN 1 ELSE 0 END) as under_discussion,
            SUM(CASE WHEN enquiry_status = 'Proposal Sent' THEN 1 ELSE 0 END) as proposal_sent,
            SUM(CASE WHEN enquiry_status = 'Closed Won' THEN 1 ELSE 0 END) as closed_won,
            SUM(CASE WHEN enquiry_status = 'Closed Lost' THEN 1 ELSE 0 END) as closed_lost,
            SUM(CASE WHEN enquiry_status NOT IN ('Closed Won', 'Closed Lost', 'Dropped') THEN 1 ELSE 0 END) as active_leads
          FROM leads
        `).then(([rows]) => rows[0] || {}),
        
        // 2. Proposals statistics
        db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
          FROM proposals
        `).then(([rows]) => rows[0] || {}),
        
        // 3. Companies count
        db.execute(`SELECT COUNT(*) as total FROM companies`)
          .then(([rows]) => rows[0]?.total || 0),
        
        // 4. Projects statistics
        db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'in-progress' OR status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
            SUM(CASE WHEN status = 'completed' OR status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'new' OR status = 'NEW' THEN 1 ELSE 0 END) as new_projects
          FROM projects
        `).then(([rows]) => rows[0] || {}),
        
        // 5. Recent leads (last 14 days) for delta calculation
        db.execute(`
          SELECT created_at 
          FROM leads 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        `).then(([rows]) => rows),
        
        // 6. Recent proposals (last 14 days)
        db.execute(`
          SELECT created_at 
          FROM proposals 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        `).then(([rows]) => rows),
        
        // 7. Recent companies (last 14 days)
        db.execute(`
          SELECT created_at 
          FROM companies 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        `).then(([rows]) => rows),
        
        // 8. Recent projects (last 14 days)
        db.execute(`
          SELECT created_at 
          FROM projects 
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 14 DAY)
        `).then(([rows]) => rows),
        
        // 9. Follow-ups this week vs last week
        db.execute(`
          SELECT 
            SUM(CASE WHEN follow_up_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as this_week,
            SUM(CASE WHEN follow_up_date >= DATE_SUB(CURDATE(), INTERVAL 14 DAY) 
                     AND follow_up_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as last_week
          FROM follow_ups
        `).then(([rows]) => rows[0] || { this_week: 0, last_week: 0 }).catch(() => ({ this_week: 0, last_week: 0 }))
      ]);

      // Calculate deltas (last 7 days vs previous 7 days)
      const now = new Date();
      const last7Start = new Date(now);
      last7Start.setDate(now.getDate() - 7);
      const prev7Start = new Date(now);
      prev7Start.setDate(now.getDate() - 14);

      const countInRange = (items, start, end) => {
        return items.filter(item => {
          const d = item.created_at ? new Date(item.created_at) : null;
          return d && d >= start && d < end;
        }).length;
      };

      const deltas = {
        leads: countInRange(recentLeads, last7Start, now) - countInRange(recentLeads, prev7Start, last7Start),
        proposals: countInRange(recentProposals, last7Start, now) - countInRange(recentProposals, prev7Start, last7Start),
        companies: countInRange(recentCompanies, last7Start, now) - countInRange(recentCompanies, prev7Start, last7Start),
        projects: countInRange(recentProjects, last7Start, now) - countInRange(recentProjects, prev7Start, last7Start)
      };

      // Build time series for sparklines (last 7 days)
      const buildDailySeries = (items) => {
        const buckets = {};
        for (let i = 6; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(now.getDate() - i);
          d.setHours(0, 0, 0, 0);
          const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
          buckets[key] = 0;
        }
        
        items.forEach(item => {
          const d = item.created_at ? new Date(item.created_at) : null;
          if (!d) return;
          const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
          if (key in buckets) buckets[key]++;
        });
        
        return Object.values(buckets);
      };

      const series = {
        leads: buildDailySeries(recentLeads),
        proposals: buildDailySeries(recentProposals),
        companies: buildDailySeries(recentCompanies),
        projects: buildDailySeries(recentProjects)
      };

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: {
          stats: {
            leads: {
              total_leads: Number(leadsStats.total_leads) || 0,
              under_discussion: Number(leadsStats.under_discussion) || 0,
              proposal_sent: Number(leadsStats.proposal_sent) || 0,
              closed_won: Number(leadsStats.closed_won) || 0,
              closed_lost: Number(leadsStats.closed_lost) || 0,
              active_leads: Number(leadsStats.active_leads) || 0
            },
            proposals: {
              total: Number(proposalsStats.total) || 0,
              pending: Number(proposalsStats.pending) || 0,
              approved: Number(proposalsStats.approved) || 0,
              draft: Number(proposalsStats.draft) || 0,
              rejected: Number(proposalsStats.rejected) || 0
            },
            companies: {
              total: Number(companiesCount) || 0
            },
            projects: {
              total: Number(projectsStats.total) || 0,
              in_progress: Number(projectsStats.in_progress) || 0,
              completed: Number(projectsStats.completed) || 0,
              new_projects: Number(projectsStats.new_projects) || 0
            }
          },
          deltas,
          series,
          activity: {
            followupsThisWeek: Number(followupsStats.this_week) || 0,
            followupsPrevWeek: Number(followupsStats.last_week) || 0
          },
          _meta: {
            queryTimeMs: queryTime
          }
        }
      });

      // Add cache headers - cache for 30 seconds
      response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
      
      return response;
      
    } finally {
      db.release();
    }
    
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch dashboard stats' },
      { status: 500 }
    );
  }
}
