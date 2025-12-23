import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/thread/[userId]
 * Fetch conversation thread between current user and another user
 */
export async function GET(request, { params }) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { userId } = await params;
    const otherUserId = parseInt(userId);

    if (otherUserId === currentUser.id) {
      return NextResponse.json({ success: false, error: 'Invalid user' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const offset = (page - 1) * limit;

    db = await dbConnect();

    // Verify other user exists
    const [otherUser] = await db.execute(
      'SELECT id, full_name, email FROM users WHERE id = ?',
      [otherUserId]
    );

    if (otherUser.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Get total count
    const [countResult] = await db.execute(`
      SELECT COUNT(*) as total
      FROM messages m
      WHERE (
        (m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_sender = FALSE) OR
        (m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_receiver = FALSE)
      )
    `, [currentUser.id, otherUserId, otherUserId, currentUser.id]);

    const total = countResult[0].total;

    // Get thread messages (ordered oldest to newest for chat-style display)
    const [messages] = await db.execute(`
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.subject,
        m.body,
        m.related_module,
        m.related_id,
        m.read_status,
        m.read_at,
        m.created_at,
        sender.full_name as sender_name,
        (SELECT COUNT(*) FROM message_attachments WHERE message_id = m.id) as attachment_count
      FROM messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      WHERE (
        (m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_sender = FALSE) OR
        (m.sender_id = ? AND m.receiver_id = ? AND m.is_deleted_by_receiver = FALSE)
      )
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [currentUser.id, otherUserId, otherUserId, currentUser.id, limit, offset]);

    // Get attachments for all messages
    const messageIds = messages.map(m => m.id);
    let attachmentsMap = {};
    
    if (messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',');
      const [attachments] = await db.execute(`
        SELECT 
          id,
          message_id,
          file_name,
          original_name,
          file_path,
          file_type,
          file_size
        FROM message_attachments
        WHERE message_id IN (${placeholders})
        ORDER BY id ASC
      `, messageIds);

      // Group attachments by message_id
      attachments.forEach(att => {
        if (!attachmentsMap[att.message_id]) {
          attachmentsMap[att.message_id] = [];
        }
        attachmentsMap[att.message_id].push(att);
      });
    }

    // Add attachments to each message
    const messagesWithAttachments = messages.map(msg => ({
      ...msg,
      attachments: attachmentsMap[msg.id] || []
    }));

    // Mark all received messages in this thread as read
    await db.execute(`
      UPDATE messages 
      SET read_status = TRUE, read_at = NOW() 
      WHERE sender_id = ? AND receiver_id = ? AND read_status = FALSE
    `, [otherUserId, currentUser.id]);

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        other_user: otherUser[0],
        messages: messagesWithAttachments.reverse(), // Return in chronological order
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching thread:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch thread',
      details: error.message 
    }, { status: 500 });
  }
}
