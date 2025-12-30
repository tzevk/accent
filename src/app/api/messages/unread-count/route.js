import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/unread-count
 * Get unread message count for the current user (for notification badge)
 * Uses: messages.created_at > conversation_members.last_read_at
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

    // Count unread messages using last_read_at comparison
    // Unread = messages in user's conversations, sent by others, after user's last_read_at
    // Works for both direct and group chats (receivers determined by conversation_members)
    const [result] = await db.execute(`
      SELECT COUNT(*) as unread_count
      FROM messages m
      JOIN conversation_members cm ON m.conversation_id = cm.conversation_id AND cm.user_id = ?
      WHERE m.sender_id != ?
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
    `, [currentUser.id, currentUser.id]);

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
