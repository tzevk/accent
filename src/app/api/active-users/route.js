import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get('user');
    
    if (!userCookie) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const user = JSON.parse(userCookie.value);
    if (user.role !== 'Admin') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const db = await dbConnect();

    // Get users who were active in the last 10 minutes
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const [activeUsers] = await db.execute(`
      SELECT 
        u.id as user_id,
        u.full_name,
        u.username,
        u.role,
        MAX(ual.created_at) as last_activity,
        (SELECT resource_id FROM user_activity_logs 
         WHERE user_id = u.id AND action_type = 'view_page' 
         ORDER BY created_at DESC LIMIT 1) as current_page,
        (SELECT TIMESTAMPDIFF(SECOND, session_start, NOW()) 
         FROM user_work_sessions 
         WHERE user_id = u.id AND session_end IS NULL 
         ORDER BY session_start DESC LIMIT 1) as session_duration
      FROM users u
      INNER JOIN user_activity_logs ual ON u.id = ual.user_id
      WHERE ual.created_at >= ?
      GROUP BY u.id, u.full_name, u.username, u.role
      ORDER BY last_activity DESC
    `, [tenMinutesAgo]);

    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: activeUsers.map(user => ({
        ...user,
        session_duration: user.session_duration || 0
      }))
    });
  } catch (error) {
    console.error('Active users GET error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch active users', 
      details: error.message 
    }, { status: 500 });
  }
}
