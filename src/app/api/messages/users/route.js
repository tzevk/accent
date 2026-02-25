import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/users
 * 
 * Returns a list of all active users for the messaging system.
 * This endpoint does NOT require users:read permission — any authenticated
 * user can see other users for the purpose of sending messages.
 * 
 * Query params:
 *   - search: string (optional) — filter by name/email
 *   - limit: number (default: 200)
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const limit = Math.min(parseInt(searchParams.get('limit')) || 200, 500);

    db = await dbConnect();

    let query = `
      SELECT 
        u.id, 
        u.username, 
        u.full_name, 
        u.email,
        u.department,
        e.profile_photo_url
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id
      WHERE u.is_active = TRUE AND u.id != ?
    `;
    const params = [currentUser.id];

    if (search.trim()) {
      query += ` AND (u.full_name LIKE ? OR u.email LIKE ? OR u.username LIKE ?)`;
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ` ORDER BY u.full_name ASC LIMIT ?`;
    params.push(limit);

    const [users] = await db.execute(query, params);

    db.release();

    const response = NextResponse.json({
      success: true,
      data: users.map(u => ({
        id: u.id,
        name: u.full_name || u.username,
        full_name: u.full_name,
        username: u.username,
        email: u.email,
        department: u.department,
        profile_photo_url: u.profile_photo_url
      }))
    });

    // Cache for 2 minutes — user list doesn't change frequently
    response.headers.set('Cache-Control', 'private, max-age=120');
    return response;

  } catch (error) {
    console.error('Error fetching messaging users:', error);
    if (db) try { db.release(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch users',
      details: error.message 
    }, { status: 500 });
  }
}
