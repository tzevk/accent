import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

/**
 * GET /api/leads/list
 * 
 * Optimized endpoint for leads list page.
 * 
 * Performance optimizations:
 * 1. Single DB connection for all queries
 * 2. Parallel query execution using Promise.all
 * 3. No schema checks (tables should exist already)
 * 4. Minimal JOINs - only required fields
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
    const canReadLeads = user.is_super_admin || hasPermission(user, 'leads', 'read');
    if (!canReadLeads) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const city = searchParams.get('city') || '';
    const sortBy = searchParams.get('sortBy') || 'created_at';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    
    const offset = (page - 1) * limit;

    const db = await dbConnect();
    
    try {
      // Build WHERE clause
      let whereClause = 'WHERE 1=1';
      const params = [];
      
      if (search) {
        const s = String(search).toLowerCase();
        whereClause += ' AND (LOWER(lead_id) LIKE ? OR LOWER(company_name) LIKE ? OR LOWER(contact_name) LIKE ? OR LOWER(contact_email) LIKE ? OR LOWER(project_description) LIKE ?)';
        params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`);
      }
      
      if (status) {
        whereClause += ' AND enquiry_status = ?';
        params.push(status);
      }
      
      if (city) {
        whereClause += ' AND city LIKE ?';
        params.push(`%${city}%`);
      }

      // Validate sort parameters
      const allowedSortFields = ['created_at', 'enquiry_date', 'company_name', 'contact_name', 'enquiry_status', 'lead_id'];
      const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
      const validSortOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      
      // Special handling for lead_id sorting
      let orderByClause = `ORDER BY ${validSortBy} ${validSortOrder}`;
      if (validSortBy === 'lead_id') {
        orderByClause = `ORDER BY CAST(REGEXP_REPLACE(lead_id, '[^0-9]', '') AS UNSIGNED) ${validSortOrder}, lead_id ${validSortOrder}`;
      }

      // Execute count, leads, and stats queries in parallel
      const [countResult, leadsResult, statsResult] = await Promise.all([
        // 1. Count query
        db.execute(`SELECT COUNT(*) as total FROM leads ${whereClause}`, params),
        
        // 2. Leads query - select only needed fields for list view
        db.execute(`
          SELECT 
            id,
            lead_id,
            company_name,
            contact_name,
            contact_email,
            phone,
            city,
            enquiry_status,
            enquiry_type,
            enquiry_date,
            priority,
            lead_source,
            created_at
          FROM leads 
          ${whereClause}
          ${orderByClause}
          LIMIT ? OFFSET ?
        `, [...params, limit, offset]),
        
        // 3. Stats query - single query with conditional counts
        db.execute(`
          SELECT 
            COUNT(*) as total_leads,
            SUM(CASE WHEN enquiry_status IN ('Under Discussion', 'Proposal Sent', 'Follow Up') THEN 1 ELSE 0 END) as active_leads,
            SUM(CASE WHEN enquiry_status = 'Closed Won' THEN 1 ELSE 0 END) as won_leads,
            SUM(CASE WHEN enquiry_status = 'Under Discussion' THEN 1 ELSE 0 END) as under_discussion,
            SUM(CASE WHEN enquiry_status = 'Proposal Sent' THEN 1 ELSE 0 END) as proposal_sent,
            SUM(CASE WHEN enquiry_status = 'Follow Up' THEN 1 ELSE 0 END) as follow_up,
            SUM(CASE WHEN enquiry_status = 'Closed Won' THEN 1 ELSE 0 END) as closed_won,
            SUM(CASE WHEN enquiry_status = 'Closed Lost' THEN 1 ELSE 0 END) as closed_lost
          FROM leads
        `)
      ]);

      const [[{ total }]] = countResult;
      const [leads] = leadsResult;
      const [[stats]] = statsResult;

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: {
          leads,
          stats: {
            total_leads: Number(stats.total_leads) || 0,
            active_leads: Number(stats.active_leads) || 0,
            won_leads: Number(stats.won_leads) || 0,
            under_discussion: Number(stats.under_discussion) || 0,
            proposal_sent: Number(stats.proposal_sent) || 0,
            follow_up: Number(stats.follow_up) || 0,
            closed_won: Number(stats.closed_won) || 0,
            closed_lost: Number(stats.closed_lost) || 0
          },
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
          }
        },
        _meta: {
          queryTimeMs: queryTime
        }
      });

      // Cache for 30 seconds
      response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
      
      return response;
      
    } finally {
      db.release();
    }
    
  } catch (error) {
    console.error('Leads list error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch leads' },
      { status: 500 }
    );
  }
}
