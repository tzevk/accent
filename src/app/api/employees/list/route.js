import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

/**
 * GET /api/employees/list
 * 
 * Optimized endpoint for employees list page.
 * 
 * Performance optimizations:
 * 1. Single DB connection for all queries
 * 2. Parallel query execution using Promise.all
 * 3. No schema checks or ALTER TABLE statements
 * 4. Cache-Control headers for client-side caching
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
    const search = searchParams.get('search') || '';
    const department = searchParams.get('department') || '';
    const status = searchParams.get('status') || '';
    const workplace = searchParams.get('workplace') || '';
    const employment_status = searchParams.get('employment_status') || '';
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit')) || 100));
    const offset = (page - 1) * limit;

    const db = await dbConnect();
    
    try {
      // Build WHERE clause
      let whereClause = 'WHERE 1=1';
      const params = [];

      if (search) {
        whereClause += ' AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.employee_id LIKE ?)';
        const searchPattern = `%${search}%`;
        params.push(searchPattern, searchPattern, searchPattern, searchPattern);
      }

      if (department) {
        whereClause += ' AND e.department = ?';
        params.push(department);
      }

      if (status) {
        whereClause += ' AND e.status = ?';
        params.push(status);
      }

      if (workplace) {
        whereClause += ' AND e.workplace = ?';
        params.push(workplace);
      }

      if (employment_status) {
        if (employment_status === 'employed') {
          whereClause += ' AND (e.exit_date IS NULL OR e.exit_date = \'\')';
        } else if (employment_status === 'resigned') {
          whereClause += ' AND e.exit_date IS NOT NULL AND e.exit_date != \'\'';
        }
      }

      // Execute all queries in parallel
      const [employeesResult, countResult, departmentsResult, workplacesResult, statsResult] = await Promise.all([
        // 1. Employees with pagination
        db.execute(
          `SELECT 
            e.*,
            CONCAT(m.first_name, ' ', m.last_name) as manager_name
           FROM employees e
           LEFT JOIN employees m ON e.manager_id = m.id
           ${whereClause}
           ORDER BY e.created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
          params
        ),
        
        // 2. Total count for pagination
        db.execute(
          `SELECT COUNT(*) as total FROM employees e ${whereClause}`,
          params
        ),
        
        // 3. Departments for filters
        db.execute(
          'SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department != \'\' ORDER BY department'
        ),
        
        // 4. Workplaces for filters
        db.execute(
          'SELECT DISTINCT workplace FROM employees WHERE workplace IS NOT NULL AND workplace != \'\' ORDER BY workplace'
        ),
        
        // 5. Stats
        db.execute(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive,
            SUM(CASE WHEN exit_date IS NOT NULL AND exit_date != '' THEN 1 ELSE 0 END) as resigned
          FROM employees
        `)
      ]);

      const [employees] = employeesResult;
      const [[{ total }]] = countResult;
      const [departments] = departmentsResult;
      const [workplaces] = workplacesResult;
      const [[stats]] = statsResult;

      const queryTime = Date.now() - startTime;

      const response = NextResponse.json({
        success: true,
        employees,
        departments: departments.map(d => d.department).filter(Boolean),
        workplaces: workplaces.map(w => w.workplace).filter(Boolean),
        pagination: {
          current: page,
          total: Math.ceil(total / limit),
          limit,
          totalRecords: total
        },
        stats: {
          total: Number(stats.total) || 0,
          active: Number(stats.active) || 0,
          inactive: Number(stats.inactive) || 0,
          resigned: Number(stats.resigned) || 0
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
    console.error('Employees list error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch employees', details: error.message },
      { status: 500 }
    );
  }
}
