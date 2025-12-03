import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';

/**
 * GET - Fetch work logs
 * Admins can see all logs (except their own), employees see only their own
 */
export async function GET(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const logType = searchParams.get('log_type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = parseInt(searchParams.get('limit') || '100');
    const page = parseInt(searchParams.get('page') || '1');
    const offset = (page - 1) * limit;

    const db = await dbConnect();

    // Build query
    let query = `
      SELECT 
        wl.*,
        u.username,
        u.full_name,
        u.email
      FROM user_work_logs wl
      LEFT JOIN users u ON wl.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    // Permission logic: 
    // - Admins can view ALL logs EXCEPT their own
    // - Regular users can only view their own logs
    if (auth.user.is_super_admin || auth.user.role?.name === 'Admin') {
      if (userId) {
        query += ` AND wl.user_id = ?`;
        params.push(userId);
      } else {
        // Admin viewing all logs - exclude admin's own logs
        query += ` AND wl.user_id != ?`;
        params.push(auth.user.id);
      }
    } else {
      // Regular users can only see their own logs
      query += ` AND wl.user_id = ?`;
      params.push(auth.user.id);
    }

    if (logType) {
      query += ` AND wl.log_type = ?`;
      params.push(logType);
    }

    if (startDate) {
      query += ` AND wl.log_date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND wl.log_date <= ?`;
      params.push(endDate);
    }

    // Get total count
    const countQuery = query.replace('wl.*, u.username, u.full_name, u.email', 'COUNT(*) as total');
    const [countResult] = await db.execute(countQuery, params);
    const total = countResult[0].total;

    // Get paginated results
    query += ` ORDER BY wl.log_date DESC, wl.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [logs] = await db.execute(query, params);

    await db.end();

    return NextResponse.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching work logs:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch work logs' 
    }, { status: 500 });
  }
}

/**
 * POST - Create a new work log entry
 */
export async function POST(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const {
      log_date,
      log_type,
      title,
      description,
      category,
      priority,
      status,
      time_spent,
      project_id
    } = data;

    // Validation
    if (!title || !log_date) {
      return NextResponse.json({ 
        success: false, 
        error: 'Title and log date are required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    const [result] = await db.execute(
      `INSERT INTO user_work_logs 
      (user_id, log_date, log_type, title, description, category, priority, status, time_spent, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auth.user.id,
        log_date,
        log_type || 'done',
        title,
        description || null,
        category || null,
        priority || 'medium',
        status || 'completed',
        time_spent || null,
        project_id || null
      ]
    );

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        id: result.insertId,
        message: 'Work log created successfully'
      }
    });

  } catch (error) {
    console.error('Error creating work log:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to create work log' 
    }, { status: 500 });
  }
}

/**
 * PUT - Update a work log entry
 */
export async function PUT(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const {
      id,
      log_date,
      log_type,
      title,
      description,
      category,
      priority,
      status,
      time_spent,
      project_id
    } = data;

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Work log ID is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    // Check ownership - users can only update their own logs
    const [existing] = await db.execute(
      'SELECT user_id FROM user_work_logs WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Work log not found' 
      }, { status: 404 });
    }

    if (existing[0].user_id !== auth.user.id) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'You can only update your own work logs' 
      }, { status: 403 });
    }

    await db.execute(
      `UPDATE user_work_logs 
      SET log_date = ?, log_type = ?, title = ?, description = ?, category = ?, 
          priority = ?, status = ?, time_spent = ?, project_id = ?
      WHERE id = ?`,
      [
        log_date,
        log_type,
        title,
        description,
        category,
        priority,
        status,
        time_spent,
        project_id,
        id
      ]
    );

    await db.end();

    return NextResponse.json({
      success: true,
      message: 'Work log updated successfully'
    });

  } catch (error) {
    console.error('Error updating work log:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update work log' 
    }, { status: 500 });
  }
}

/**
 * DELETE - Delete a work log entry
 */
export async function DELETE(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Work log ID is required' 
      }, { status: 400 });
    }

    const db = await dbConnect();

    // Check ownership - users can only delete their own logs
    const [existing] = await db.execute(
      'SELECT user_id FROM user_work_logs WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'Work log not found' 
      }, { status: 404 });
    }

    if (existing[0].user_id !== auth.user.id) {
      await db.end();
      return NextResponse.json({ 
        success: false, 
        error: 'You can only delete your own work logs' 
      }, { status: 403 });
    }

    await db.execute('DELETE FROM user_work_logs WHERE id = ?', [id]);
    await db.end();

    return NextResponse.json({
      success: true,
      message: 'Work log deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting work log:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to delete work log' 
    }, { status: 500 });
  }
}
