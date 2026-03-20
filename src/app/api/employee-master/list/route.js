import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

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
    
    // Allow any authenticated user to access employee-master (dropdown/reference data)
    // Specific employee operations (view details, edit, etc.) have stricter checks elsewhere

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
      
    } catch (dbError) {
      console.error('Database error in employee list:', dbError);
      return NextResponse.json(
        { success: false, error: 'Database query failed', data: [] },
        { status: 500 }
      );
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
