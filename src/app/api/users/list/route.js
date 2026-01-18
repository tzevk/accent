import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

/**
 * GET /api/users/list
 * 
 * Optimized endpoint for users list page.
 * 
 * Performance optimizations:
 * 1. No CREATE TABLE or ALTER TABLE statements
 * 2. Parallel query execution
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
    const canReadUsers = user.is_super_admin || hasPermission(user, 'users', 'read');
    if (!canReadUsers) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = Math.max(1, Math.min(1000, parseInt(searchParams.get('limit')) || 1000));
    const offset = (page - 1) * limit;

    const db = await dbConnect();
    
    try {
      // Execute queries in parallel
      const [usersResult, countResult, statsResult] = await Promise.all([
        // 1. Users with employee and role info
        db.execute(
          `SELECT u.*, 
                  CONCAT(e.first_name, ' ', e.last_name) AS employee_name, 
                  e.employee_id as employee_code,
                  e.department as employee_department,
                  e.position as employee_position,
                  r.display_name as role_name,
                  r.role_key,
                  r.permissions as role_permissions
           FROM users u
           LEFT JOIN employees e ON u.employee_id = e.id
           LEFT JOIN roles r ON u.role_id = r.id
           WHERE u.is_active = TRUE
           ORDER BY u.created_at DESC
           LIMIT ? OFFSET ?`,
          [limit, offset]
        ),
        
        // 2. Total count
        db.execute('SELECT COUNT(*) as total FROM users WHERE is_active = TRUE'),
        
        // 3. Stats
        db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'inactive' OR status IS NULL THEN 1 ELSE 0 END) as inactive,
            SUM(CASE WHEN is_super_admin = TRUE THEN 1 ELSE 0 END) as admins
          FROM users
          WHERE is_active = TRUE
        `)
      ]);

      const [users] = usersResult;
      const countRow = countResult?.[0]?.[0] || {};
      const total = Number(countRow.total) || 0;
      const statsRow = statsResult?.[0]?.[0] || {};

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        data: users,
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          limit,
          totalRecords: total
        },
        stats: {
          total: Number(statsRow.total) || 0,
          active: Number(statsRow.active) || 0,
          inactive: Number(statsRow.inactive) || 0,
          admins: Number(statsRow.admins) || 0
        },
        _meta: { queryTimeMs: queryTime }
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
    console.error('Users list error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch users', details: error.message },
      { status: 500 }
    );
  }
}
