import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

/**
 * GET /api/employee-master/list
 * 
 * Optimized endpoint for employee master dropdown data.
 * 
 * Performance optimizations:
 * 1. No schema checks
 * 2. Only essential fields for dropdowns
 * 3. Cache-Control headers
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
    const canReadEmployees = user.is_super_admin || hasPermission(user, 'employees', 'read');
    if (!canReadEmployees) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(2000, parseInt(searchParams.get('limit')) || 1000));

    const db = await dbConnect();
    
    try {
      const [employees] = await db.execute(
        `SELECT 
          id,
          employee_id,
          first_name,
          last_name,
          email,
          department,
          workplace,
          status,
          CONCAT(first_name, ' ', last_name) as full_name
         FROM employees 
         WHERE status = 'active'
         ORDER BY first_name, last_name
         LIMIT ?`,
        [limit]
      );

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: employees,
        total: employees.length,
        _meta: { queryTimeMs: queryTime }
      });

      // Cache for 60 seconds (master data changes infrequently)
      response.headers.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      
      return response;
      
    } finally {
      if (db && typeof db.release === 'function') {
        try { db.release(); } catch (e) { console.error('Error releasing connection:', e); }
      }
    }
    
  } catch (error) {
    console.error('Employee master list error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch employees', data: [] },
      { status: 500 }
    );
  }
}
