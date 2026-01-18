import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

/**
 * GET /api/proposals/list
 * 
 * Optimized endpoint for proposals list page.
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
    const canReadProposals = user.is_super_admin || hasPermission(user, 'proposals', 'read');
    if (!canReadProposals) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    const db = await dbConnect();
    
    try {
      // Execute queries in parallel
      const [proposalsResult, statsResult] = await Promise.all([
        // 1. Proposals query - select only needed fields for list view
        db.execute(`
          SELECT 
            id,
            proposal_id,
            title,
            client_name,
            company_name,
            status,
            amount,
            created_by,
            created_at,
            valid_until,
            sent_date
          FROM proposals
          ORDER BY created_at DESC
        `).catch(() => {
          // Fallback with basic fields if some columns don't exist
          return db.execute(`
            SELECT 
              id, proposal_id, title, client_name, status, amount, created_at
            FROM proposals
            ORDER BY created_at DESC
          `);
        }),
        
        // 2. Stats query - single query with conditional counts
        db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(status) = 'draft' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN LOWER(status) = 'sent' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN LOWER(status) = 'approved' OR LOWER(status) = 'accepted' THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN LOWER(status) = 'rejected' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN LOWER(status) = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(COALESCE(amount, 0)) as total_value
          FROM proposals
        `)
      ]);

      let [proposals] = proposalsResult;
      const statsRow = statsResult?.[0]?.[0] || {};
      const stats = {
        total: Number(statsRow.total) || 0,
        draft: Number(statsRow.draft) || 0,
        sent: Number(statsRow.sent) || 0,
        approved: Number(statsRow.approved) || 0,
        rejected: Number(statsRow.rejected) || 0,
        pending: Number(statsRow.pending) || 0,
        total_value: Number(statsRow.total_value) || 0
      };

      // Apply filters
      if (search) {
        const s = search.toLowerCase();
        proposals = proposals.filter(p => 
          (p.title || '').toLowerCase().includes(s) ||
          (p.proposal_id || '').toLowerCase().includes(s) ||
          (p.client_name || '').toLowerCase().includes(s) ||
          (p.company_name || '').toLowerCase().includes(s)
        );
      }
      
      if (status) {
        proposals = proposals.filter(p => 
          (p.status || '').toLowerCase() === status.toLowerCase()
        );
      }

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: proposals,
        stats,
        _meta: {
          queryTimeMs: queryTime,
          filtered: proposals.length
        }
      });

      // Cache for 30 seconds
      response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60');
      
      return response;
      
    } finally {
      if (db && typeof db.release === 'function') {
        try { db.release(); } catch (e) { console.error('Error releasing connection:', e); }
      }
    }
    
  } catch (error) {
    console.error('Proposals list error:', error?.message, error?.stack);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch proposals', details: error?.message, stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined },
      { status: 500 }
    );
  }
}
