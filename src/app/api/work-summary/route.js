import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';

// GET - Fetch user daily work summary
export async function GET(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.USERS, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = parseInt(searchParams.get('limit')) || 30;

    // Non-admin users can only view their own summary
    const requestedUserId = userId ? parseInt(userId) : null;
    const currentUser = auth.user;
    
    if (!currentUser.is_super_admin && requestedUserId && requestedUserId !== currentUser.id) {
      return NextResponse.json({ 
        success: false, 
        error: 'You can only view your own work summary' 
      }, { status: 403 });
    }

    const finalUserId = currentUser.is_super_admin ? requestedUserId : currentUser.id;

    const db = await dbConnect();

    let query = `
      SELECT 
        uds.*,
        u.username,
        u.full_name
      FROM user_daily_summary uds
      LEFT JOIN users u ON uds.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (finalUserId) {
      query += ` AND uds.user_id = ?`;
      params.push(finalUserId);
    }

    if (startDate) {
      query += ` AND uds.date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND uds.date <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY uds.date DESC LIMIT ?`;
    params.push(limit);

    const [summary] = await db.execute(query, params);

    // Calculate statistics
    const stats = {
      totalDays: summary.length,
      totalWorkMinutes: summary.reduce((sum, day) => sum + (day.total_work_minutes || 0), 0),
      totalActivities: summary.reduce((sum, day) => sum + (day.activities_completed || 0), 0),
      totalResourcesCreated: summary.reduce((sum, day) => sum + (day.resources_created || 0), 0),
      totalResourcesUpdated: summary.reduce((sum, day) => sum + (day.resources_updated || 0), 0),
      averageWorkMinutesPerDay: summary.length > 0 
        ? Math.round(summary.reduce((sum, day) => sum + (day.total_work_minutes || 0), 0) / summary.length)
        : 0,
      averageActivitiesPerDay: summary.length > 0
        ? Math.round(summary.reduce((sum, day) => sum + (day.activities_completed || 0), 0) / summary.length)
        : 0
    };

    await db.end();

    return NextResponse.json({
      success: true,
      data: summary,
      stats
    });

  } catch (error) {
    console.error('Error fetching work summary:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch work summary' 
    }, { status: 500 });
  }
}
