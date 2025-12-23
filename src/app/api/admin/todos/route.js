import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/todos
 * Fetch all todos from all users (admin only)
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin or super admin
    const isAdmin = currentUser.is_super_admin || 
                    currentUser.role_key === 'admin' || 
                    currentUser.role_key === 'super_admin' ||
                    currentUser.username === 'admin';

    if (!isAdmin) {
      return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 });
    }

    db = await dbConnect();

    // Ensure todos table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS todos (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT DEFAULT NULL,
        priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
        status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
        due_date DATE DEFAULT NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_due_date (due_date)
      )
    `);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const userId = searchParams.get('user_id');
    const priority = searchParams.get('priority');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = (page - 1) * limit;

    let whereConditions = [];
    let params = [];

    if (status && status !== 'all') {
      whereConditions.push('t.status = ?');
      params.push(status);
    }

    if (userId && userId !== 'all') {
      whereConditions.push('t.user_id = ?');
      params.push(userId);
    }

    if (priority && priority !== 'all') {
      whereConditions.push('t.priority = ?');
      params.push(priority);
    }

    const whereClause = whereConditions.length > 0 
      ? 'WHERE ' + whereConditions.join(' AND ')
      : '';

    // Get total count
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM todos t ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    // Get todos with user information
    const [todos] = await db.execute(
      `SELECT t.*, 
              u.username, 
              u.full_name,
              u.email,
              u.department
       FROM todos t
       LEFT JOIN users u ON t.user_id = u.id
       ${whereClause}
       ORDER BY 
         CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
         CASE t.status WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 WHEN 'completed' THEN 3 END,
         t.due_date ASC,
         t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Get all users for filter dropdown
    const [users] = await db.execute(
      `SELECT DISTINCT u.id, u.username, u.full_name 
       FROM users u 
       INNER JOIN todos t ON u.id = t.user_id
       ORDER BY u.full_name, u.username`
    );

    // Get summary stats
    const [stats] = await db.execute(`
      SELECT 
        COUNT(*) as total_todos,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_priority_count,
        SUM(CASE WHEN due_date < CURDATE() AND status != 'completed' THEN 1 ELSE 0 END) as overdue_count
      FROM todos
    `);

    await db.end();

    return NextResponse.json({
      success: true,
      data: todos,
      users: users,
      stats: stats[0] || {},
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching admin todos:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to fetch todos' }, { status: 500 });
  }
}
