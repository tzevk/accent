import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { dbConnect } from '@/utils/database';

// GET - Fetch screen time analytics
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

    // Non-admin users can only view their own screen time
    const requestedUserId = userId ? parseInt(userId) : null;
    const currentUser = auth.user;
    
    if (!currentUser.is_super_admin && requestedUserId && requestedUserId !== currentUser.id) {
      return NextResponse.json({ 
        success: false, 
        error: 'You can only view your own screen time' 
      }, { status: 403 });
    }

    const finalUserId = currentUser.is_super_admin ? requestedUserId : currentUser.id;

    const db = await dbConnect();

    // Get daily screen time summary
    let query = `
      SELECT 
        ust.*,
        u.username,
        u.full_name
      FROM user_screen_time ust
      LEFT JOIN users u ON ust.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (finalUserId) {
      query += ` AND ust.user_id = ?`;
      params.push(finalUserId);
    }

    if (startDate) {
      query += ` AND ust.date >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND ust.date <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY ust.date DESC LIMIT ?`;
    params.push(limit);

    const [screenTime] = await db.execute(query, params);

    // Get page visit statistics
    let pageQuery = `
      SELECT 
        page_path,
        COUNT(*) as visit_count,
        SUM(duration_seconds) as total_duration_seconds,
        AVG(duration_seconds) as avg_duration_seconds,
        SUM(clicks_count) as total_clicks,
        SUM(scrolls_count) as total_scrolls
      FROM user_page_visits
      WHERE user_id = ?
    `;
    const pageParams = [finalUserId];

    if (startDate) {
      pageQuery += ` AND visit_start >= ?`;
      pageParams.push(startDate);
    }

    if (endDate) {
      pageQuery += ` AND visit_start <= ?`;
      pageParams.push(endDate);
    }

    pageQuery += ` GROUP BY page_path ORDER BY total_duration_seconds DESC LIMIT 10`;

    const [pageStats] = await db.execute(pageQuery, pageParams);

    // Get interaction statistics
    const [interactionStats] = await db.execute(
      `SELECT 
        interaction_type,
        COUNT(*) as count,
        DATE(created_at) as date
      FROM user_interactions
      WHERE user_id = ? ${startDate ? 'AND created_at >= ?' : ''} ${endDate ? 'AND created_at <= ?' : ''}
      GROUP BY interaction_type, DATE(created_at)
      ORDER BY date DESC`,
      [finalUserId, startDate, endDate].filter(Boolean)
    );

    // Calculate overall statistics
    const stats = {
      totalDays: screenTime.length,
      totalScreenTimeMinutes: screenTime.reduce((sum, day) => sum + (day.total_screen_time_minutes || 0), 0),
      totalActiveTimeMinutes: screenTime.reduce((sum, day) => sum + (day.active_time_minutes || 0), 0),
      totalIdleTimeMinutes: screenTime.reduce((sum, day) => sum + (day.idle_time_minutes || 0), 0),
      totalClicks: screenTime.reduce((sum, day) => sum + (day.total_clicks || 0), 0),
      totalScrolls: screenTime.reduce((sum, day) => sum + (day.total_scrolls || 0), 0),
      totalKeypresses: screenTime.reduce((sum, day) => sum + (day.total_keypresses || 0), 0),
      avgScreenTimePerDay: screenTime.length > 0 
        ? Math.round(screenTime.reduce((sum, day) => sum + (day.total_screen_time_minutes || 0), 0) / screenTime.length)
        : 0,
      avgActiveTimePerDay: screenTime.length > 0
        ? Math.round(screenTime.reduce((sum, day) => sum + (day.active_time_minutes || 0), 0) / screenTime.length)
        : 0,
      avgProductivityScore: screenTime.length > 0
        ? (screenTime.reduce((sum, day) => sum + (parseFloat(day.productivity_score) || 0), 0) / screenTime.length).toFixed(2)
        : 0,
      avgFocusScore: screenTime.length > 0
        ? (screenTime.reduce((sum, day) => sum + (parseFloat(day.focus_score) || 0), 0) / screenTime.length).toFixed(2)
        : 0
    };

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        daily: screenTime,
        pages: pageStats,
        interactions: interactionStats,
        stats
      }
    });

  } catch (error) {
    console.error('Error fetching screen time:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch screen time data' 
    }, { status: 500 });
  }
}
