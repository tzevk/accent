import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/unread-count
 * Get unread message count for the current user (for notification badge)
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    db = await dbConnect();

    // Check if messages table exists
    const [tables] = await db.execute(`SHOW TABLES LIKE 'messages'`);
    if (tables.length === 0) {
      await db.end();
      return NextResponse.json({
        success: true,
        data: { unread_count: 0 }
      });
    }

    const [result] = await db.execute(`
      SELECT COUNT(*) as unread_count
      FROM messages
      WHERE receiver_id = ? AND read_status = FALSE AND is_deleted_by_receiver = FALSE
    `, [currentUser.id]);

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        unread_count: result[0].unread_count
      }
    });

  } catch (error) {
    console.error('Error fetching unread count:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch unread count',
      data: { unread_count: 0 }
    }, { status: 500 });
  }
}
