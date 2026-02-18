import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

/**
 * GET /api/projects/[id]/work-logs
 *
 * Returns all user_work_logs for a given project, grouped by user then by date.
 * Super-admin uses this to see every team member's day-wise work on a project.
 *
 * Query params:
 *   start_date  – YYYY-MM-DD (optional, defaults to 30 days ago)
 *   end_date    – YYYY-MM-DD (optional, defaults to today)
 *   user_id     – filter to a single user (optional)
 */
export async function GET(request, { params }) {
  let db;
  try {
    const auth = await ensurePermission(request, RESOURCES.PROJECTS, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const projectId = id;

    const { searchParams } = new URL(request.url);
    const endDate = searchParams.get('end_date') || new Date().toISOString().split('T')[0];
    const startDate =
      searchParams.get('start_date') ||
      new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const filterUserId = searchParams.get('user_id');

    db = await dbConnect();

    // Build query — join with users to get names
    let query = `
      SELECT
        wl.id,
        wl.user_id,
        wl.log_date,
        wl.log_type,
        wl.title,
        wl.description,
        wl.category,
        wl.priority,
        wl.status,
        wl.time_spent,
        wl.created_at,
        u.full_name,
        u.username,
        u.email
      FROM user_work_logs wl
      LEFT JOIN users u ON wl.user_id = u.id
      WHERE wl.project_id = ?
        AND wl.log_date >= ?
        AND wl.log_date <= ?
    `;
    const queryParams = [projectId, startDate, endDate];

    if (filterUserId) {
      query += ' AND wl.user_id = ?';
      queryParams.push(filterUserId);
    }

    query += ' ORDER BY wl.log_date DESC, u.full_name ASC, wl.created_at DESC';

    const [rows] = await db.execute(query, queryParams);

    // ---------- group by user → then by date ----------
    const userMap = {};

    for (const row of rows) {
      const uid = row.user_id;
      if (!userMap[uid]) {
        userMap[uid] = {
          user_id: uid,
          full_name: row.full_name || row.username || `User #${uid}`,
          username: row.username,
          email: row.email,
          dates: {},
          total_logs: 0,
          total_time_minutes: 0,
        };
      }

      const dateStr = row.log_date
        ? new Date(row.log_date).toISOString().split('T')[0]
        : 'unknown';

      if (!userMap[uid].dates[dateStr]) {
        userMap[uid].dates[dateStr] = {
          date: dateStr,
          logs: [],
          day_time_minutes: 0,
        };
      }

      const timeMinutes = parseTimeSpent(row.time_spent);
      userMap[uid].dates[dateStr].logs.push({
        id: row.id,
        log_type: row.log_type,
        title: row.title,
        description: row.description,
        category: row.category,
        priority: row.priority,
        status: row.status,
        time_spent: row.time_spent,
        time_minutes: timeMinutes,
        created_at: row.created_at,
      });

      userMap[uid].dates[dateStr].day_time_minutes += timeMinutes;
      userMap[uid].total_logs += 1;
      userMap[uid].total_time_minutes += timeMinutes;
    }

    // Convert dates object to sorted array per user
    const grouped = Object.values(userMap).map((u) => ({
      ...u,
      dates: Object.values(u.dates).sort((a, b) => (b.date > a.date ? 1 : -1)),
    }));

    // Sort users alphabetically
    grouped.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));

    return NextResponse.json({
      success: true,
      data: {
        project_id: projectId,
        start_date: startDate,
        end_date: endDate,
        total_logs: rows.length,
        users: grouped,
      },
    });
  } catch (error) {
    console.error('Error fetching project work logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch project work logs' },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}

/** Parse human-readable time_spent strings like "2h", "30m", "1h 30m", "90" (minutes) */
function parseTimeSpent(val) {
  if (!val) return 0;
  const s = String(val).trim().toLowerCase();
  // plain number → assume minutes
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));

  let total = 0;
  const hMatch = s.match(/(\d+(?:\.\d+)?)\s*h/);
  const mMatch = s.match(/(\d+(?:\.\d+)?)\s*m/);
  if (hMatch) total += parseFloat(hMatch[1]) * 60;
  if (mMatch) total += parseFloat(mMatch[1]);
  return Math.round(total);
}
