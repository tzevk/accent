import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';

// Ensure audit_logs table exists
async function ensureAuditLogsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      username VARCHAR(255) DEFAULT NULL,
      action VARCHAR(50) NOT NULL,
      resource VARCHAR(50) NOT NULL,
      resource_id INT DEFAULT NULL,
      old_value JSON DEFAULT NULL,
      new_value JSON DEFAULT NULL,
      ip_address VARCHAR(45) DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_action (action),
      INDEX idx_resource (resource),
      INDEX idx_resource_id (resource_id),
      INDEX idx_created_at (created_at)
    )
  `);
}

/**
 * GET /api/audit-logs
 * Fetch audit logs with filtering and pagination
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50)
 * - user_id: Filter by user who made the change
 * - action: Filter by action (update_permissions, create, update, delete, etc.)
 * - resource: Filter by resource type (user_permissions, users, etc.)
 * - start_date: Filter from this date
 * - end_date: Filter until this date
 * - search: Search in username
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Only super admins or users with users:read can view audit logs
    const canViewAuditLogs = currentUser.is_super_admin || 
                             hasPermission(currentUser, RESOURCES.USERS, PERMISSIONS.READ);
    
    if (!canViewAuditLogs) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    db = await dbConnect();
    await ensureAuditLogsTable(db);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const offset = (page - 1) * limit;
    const userId = searchParams.get('user_id');
    const action = searchParams.get('action');
    const resource = searchParams.get('resource');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const search = searchParams.get('search');

    // Build query
    let whereClause = '1=1';
    const params = [];

    if (userId) {
      whereClause += ' AND al.user_id = ?';
      params.push(userId);
    }

    if (action) {
      whereClause += ' AND al.action = ?';
      params.push(action);
    }

    if (resource) {
      whereClause += ' AND al.resource = ?';
      params.push(resource);
    }

    if (startDate) {
      whereClause += ' AND DATE(al.created_at) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND DATE(al.created_at) <= ?';
      params.push(endDate);
    }

    if (search) {
      whereClause += ' AND al.username LIKE ?';
      params.push(`%${search}%`);
    }

    // Get total count
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM audit_logs al WHERE ${whereClause}`,
      params
    );

    // Get audit logs
    const [logs] = await db.execute(
      `SELECT 
        al.id,
        al.user_id,
        al.username,
        al.action,
        al.resource,
        al.resource_id,
        al.old_value,
        al.new_value,
        al.ip_address,
        al.user_agent,
        al.created_at
      FROM audit_logs al
      WHERE ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Parse JSON fields
    const parsedLogs = logs.map(log => ({
      ...log,
      old_value: log.old_value ? (typeof log.old_value === 'string' ? JSON.parse(log.old_value) : log.old_value) : null,
      new_value: log.new_value ? (typeof log.new_value === 'string' ? JSON.parse(log.new_value) : log.new_value) : null
    }));

    await db.end();

    return NextResponse.json({
      success: true,
      data: parsedLogs,
      total: countResult[0].total,
      pagination: {
        page,
        limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to fetch audit logs' }, { status: 500 });
  }
}

/**
 * POST /api/audit-logs
 * Create a new audit log entry
 */
export async function POST(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const data = await request.json();
    const { 
      action, 
      resource, 
      resource_id, 
      old_value,
      new_value
    } = data;

    if (!action || !resource) {
      return NextResponse.json({ 
        success: false, 
        error: 'action and resource are required' 
      }, { status: 400 });
    }

    db = await dbConnect();
    await ensureAuditLogsTable(db);

    // Get IP and user agent from request
    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    const [result] = await db.execute(
      `INSERT INTO audit_logs 
        (user_id, username, action, resource, resource_id, old_value, new_value, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        currentUser.id,
        currentUser.username || currentUser.full_name || 'Unknown',
        action,
        resource,
        resource_id || null,
        old_value ? JSON.stringify(old_value) : null,
        new_value ? JSON.stringify(new_value) : null,
        ip,
        userAgent
      ]
    );

    await db.end();

    return NextResponse.json({
      success: true,
      data: { id: result.insertId },
      message: 'Audit log created'
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating audit log:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: 'Failed to create audit log' }, { status: 500 });
  }
}
