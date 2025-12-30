import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/conversation/[conversationId]
 * Fetch messages for a specific conversation
 * Works for direct, group, and project conversations
 */
export async function GET(request, { params }) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId } = await params;
    const convId = parseInt(conversationId);

    if (!convId || isNaN(convId)) {
      return NextResponse.json({ success: false, error: 'Invalid conversation ID' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 50;
    const offset = (page - 1) * limit;

    db = await dbConnect();

    // Verify user is a member of this conversation
    const [participation] = await db.execute(
      'SELECT id, is_archived, is_muted FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
      [convId, currentUser.id]
    );

    if (participation.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Access denied to this conversation' }, { status: 403 });
    }

    // Get conversation details
    const [convDetails] = await db.execute(
      'SELECT id, type, related_module, related_id, title, created_at FROM conversations WHERE id = ?',
      [convId]
    );

    if (convDetails.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Conversation not found' }, { status: 404 });
    }

    const conversation = convDetails[0];

    // Get all members
    const [members] = await db.execute(`
      SELECT cm.user_id, cm.joined_at, cm.last_read_at, cm.is_archived, cm.is_muted, u.full_name, u.email
      FROM conversation_members cm
      JOIN users u ON cm.user_id = u.id
      WHERE cm.conversation_id = ?
    `, [convId]);

    // Get total message count using conversation_id only
    const [countResult] = await db.execute(`
      SELECT COUNT(*) as total
      FROM messages m
      WHERE m.conversation_id = ?
    `, [convId]);

    const total = countResult[0].total;

    // Get messages using conversation_id only (no sender/receiver filtering)
    const [messages] = await db.execute(`
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.conversation_id,
        m.subject,
        m.body,
        m.related_module,
        m.related_id,
        m.read_status,
        m.read_at,
        m.created_at,
        sender.full_name as sender_name,
        sender.email as sender_email,
        (SELECT COUNT(*) FROM message_attachments WHERE message_id = m.id) as attachment_count
      FROM messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [convId, limit, offset]);

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

      attachments.forEach(att => {
        if (!attachmentsMap[att.message_id]) {
          attachmentsMap[att.message_id] = [];
        }
        attachmentsMap[att.message_id].push(att);
      });
    }

    const messagesWithAttachments = messages.map(msg => ({
      ...msg,
      attachments: attachmentsMap[msg.id] || []
    }));

    // Mark conversation as read by updating last_read_at only (scales better)
    // No longer updating per-message read_status flags
    await db.execute(`
      UPDATE conversation_members 
      SET last_read_at = NOW() 
      WHERE conversation_id = ? AND user_id = ?
    `, [convId, currentUser.id]);

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        conversation: {
          ...conversation,
          members
        },
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
    console.error('Error fetching conversation:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch conversation',
      details: error.message 
    }, { status: 500 });
  }
}
