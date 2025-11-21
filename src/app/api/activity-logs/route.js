import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { getUserActivityLogs } from '@/utils/activity-logger';
import { dbConnect } from '@/utils/database';

// GET - Fetch activity logs with filters
export async function GET(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.USERS, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const actionType = searchParams.get('action_type');
    const resourceType = searchParams.get('resource_type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = parseInt(searchParams.get('limit')) || 100;
    const page = parseInt(searchParams.get('page')) || 1;
    const offset = (page - 1) * limit;

    // Non-admin users can only view their own logs
    const requestedUserId = userId ? parseInt(userId) : null;
    const currentUser = auth.user;
    
    if (!currentUser.is_super_admin && requestedUserId && requestedUserId !== currentUser.id) {
      return NextResponse.json({ 
        success: false, 
        error: 'You can only view your own activity logs' 
      }, { status: 403 });
    }

    const finalUserId = currentUser.is_super_admin ? requestedUserId : currentUser.id;

    const logs = await getUserActivityLogs({
      userId: finalUserId,
      actionType,
      resourceType,
      startDate,
      endDate,
      limit,
      offset
    });

    // Get total count for pagination
    let db;
    try {
      db = await dbConnect();
      
      let countQuery = 'SELECT COUNT(*) as total FROM user_activity_logs WHERE 1=1';
      const countParams = [];

      if (finalUserId) {
        countQuery += ' AND user_id = ?';
        countParams.push(finalUserId);
      }
      if (actionType) {
        countQuery += ' AND action_type = ?';
        countParams.push(actionType);
      }
      if (resourceType) {
        countQuery += ' AND resource_type = ?';
        countParams.push(resourceType);
      }
      if (startDate) {
        countQuery += ' AND created_at >= ?';
        countParams.push(startDate);
      }
      if (endDate) {
        countQuery += ' AND created_at <= ?';
        countParams.push(endDate);
      }

      const [countResult] = await db.execute(countQuery, countParams);
      const total = countResult[0].total;

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
      if (db) await db.end();
      throw error;
    }

  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch activity logs' 
    }, { status: 500 });
  }
}
