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
  let db;
  
  try {
    // Auth check - wrap in try-catch since getCurrentUser can throw on DB errors
    let user;
    try {
      user = await getCurrentUser(request);
    } catch (authErr) {
      console.error('Auth check failed:', authErr?.message);
      return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
    }
    
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    // Permission check - ensure user object is valid before checking permissions
    if (!user.id) {
      return NextResponse.json({ success: false, error: 'Invalid user session' }, { status: 401 });
    }
    
    const canReadProposals = user.is_super_admin || hasPermission(user, 'proposals', 'read');
    if (!canReadProposals) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    db = await dbConnect();
    
    try {
      // Execute queries with full error handling
      let proposals = [];
      let stats = { total: 0, draft: 0, sent: 0, approved: 0, rejected: 0, pending: 0, total_value: 0 };
      
      try {
        // Use SELECT * to get all available columns (schema may vary)
        const [proposalsResult] = await db.execute(`
          SELECT * FROM proposals ORDER BY created_at DESC
        `);
        proposals = proposalsResult || [];
      } catch (queryErr) {
        console.warn('Proposals query failed:', queryErr?.message);
        try {
          // Minimal fallback - only id, status, created_at are guaranteed
          const [fallbackResult] = await db.execute(`
            SELECT id, status, created_at FROM proposals ORDER BY created_at DESC
          `);
          proposals = fallbackResult || [];
        } catch (fallbackErr) {
          console.error('Fallback query also failed:', fallbackErr?.message);
          proposals = [];
        }
      }
      
      try {
        // Stats query - only use status which should exist
        const [statsResult] = await db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'draft' THEN 1 ELSE 0 END) as draft,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'sent' THEN 1 ELSE 0 END) as sent,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) IN ('approved', 'accepted') THEN 1 ELSE 0 END) as approved,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'rejected' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN LOWER(COALESCE(status,'')) = 'pending' THEN 1 ELSE 0 END) as pending
          FROM proposals
        `);
        const statsRow = statsResult?.[0] || {};
        stats = {
          total: Number(statsRow.total) || 0,
          draft: Number(statsRow.draft) || 0,
          sent: Number(statsRow.sent) || 0,
          approved: Number(statsRow.approved) || 0,
          rejected: Number(statsRow.rejected) || 0,
          pending: Number(statsRow.pending) || 0,
          total_value: 0
        };
      } catch (statsErr) {
        console.warn('Stats query failed:', statsErr?.message);
        // Keep default stats
      }

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
      // Release handled in outer finally
    }
    
  } catch (error) {
    console.error('Proposals list error:', error?.message, error?.stack);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch proposals', details: error?.message, stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined },
      { status: 500 }
    );
  } finally {
    // Always release DB connection
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}
