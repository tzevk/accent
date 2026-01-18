import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

/**
 * GET /api/proposals/[id]/detail
 * 
 * Optimized endpoint for fetching single proposal details.
 * 
 * Performance optimizations:
 * 1. No schema ALTER TABLE statements
 * 2. Single query to fetch proposal
 * 3. Cache-Control headers
 */
export async function GET(request, { params }) {
  const startTime = Date.now();
  
  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Permission check
    const canReadProposals = user.is_super_admin || hasPermission(user, 'proposals', 'read');
    if (!canReadProposals) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id || id === 'undefined') {
      return NextResponse.json({ success: false, error: 'Invalid proposal id' }, { status: 400 });
    }

    const db = await dbConnect();
    
    try {
      const [rows] = await db.execute(
        'SELECT * FROM proposals WHERE id = ?',
        [id]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Proposal not found' },
          { status: 404 }
        );
      }

      const proposal = rows[0];
      
      // Parse JSON fields
      const jsonFields = [
        'disciplines', 'activities', 'discipline_descriptions',
        'planning_activities_list', 'documents_list', 'terms_conditions_list',
        'price_breakup', 'delivery_schedule'
      ];
      
      for (const field of jsonFields) {
        if (proposal[field] && typeof proposal[field] === 'string') {
          try {
            proposal[field] = JSON.parse(proposal[field]);
          } catch {
            // Keep as-is if not valid JSON
          }
        }
      }

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: proposal,
        proposal: proposal, // Backward compatibility
        _meta: { queryTimeMs: queryTime }
      });

      // Cache for 15 seconds
      response.headers.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=30');
      
      return response;

    } finally {
      db.release();
    }

  } catch (error) {
    console.error('Proposal detail error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch proposal', details: error.message },
      { status: 500 }
    );
  }
}
