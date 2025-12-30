import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/[id]
 * Fetch a single message with full content and attachments
 */
export async function GET(request, { params }) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const messageId = parseInt(id);

    db = await dbConnect();

    // Fetch message
    const [messages] = await db.execute(`
      SELECT 
        m.*,
        sender.full_name as sender_name,
        sender.email as sender_email,
        receiver.full_name as receiver_name,
        receiver.email as receiver_email
      FROM messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      LEFT JOIN users receiver ON m.receiver_id = receiver.id
      WHERE m.id = ?
    `, [messageId]);

    if (messages.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 });
    }

    const message = messages[0];

    // Security check: Only sender or receiver can access the message
    if (message.sender_id !== currentUser.id && message.receiver_id !== currentUser.id) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Check if message is deleted for this user
    if (
      (message.sender_id === currentUser.id && message.is_deleted_by_sender) ||
      (message.receiver_id === currentUser.id && message.is_deleted_by_receiver)
    ) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 });
    }

    // Fetch attachments
    const [attachments] = await db.execute(`
      SELECT id, file_name, original_name, file_type, file_size, uploaded_at
      FROM message_attachments
      WHERE message_id = ?
    `, [messageId]);

    // Mark conversation as read if receiver is viewing (update last_read_at instead of per-message flag)
    if (message.receiver_id === currentUser.id && message.conversation_id) {
      await db.execute(`
        UPDATE conversation_members 
        SET last_read_at = NOW() 
        WHERE conversation_id = ? AND user_id = ?
      `, [message.conversation_id, currentUser.id]);
    }

    // Get related entity name if applicable
    let relatedEntityName = null;
    if (message.related_module !== 'none' && message.related_id) {
      relatedEntityName = await getRelatedEntityName(db, message.related_module, message.related_id);
    }

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        ...message,
        attachments,
        related_entity_name: relatedEntityName
      }
    });

  } catch (error) {
    console.error('Error fetching message:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch message',
      details: error.message 
    }, { status: 500 });
  }
}

/**
 * PATCH /api/messages/[id]
 * Update message (mark as read, delete, etc.)
 */
export async function PATCH(request, { params }) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const messageId = parseInt(id);
    const body = await request.json();
    const { action } = body; // 'mark_read', 'mark_unread', 'delete'

    db = await dbConnect();

    // Fetch message
    const [messages] = await db.execute(
      'SELECT sender_id, receiver_id FROM messages WHERE id = ?',
      [messageId]
    );

    if (messages.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Message not found' }, { status: 404 });
    }

    const message = messages[0];

    // Security check
    if (message.sender_id !== currentUser.id && message.receiver_id !== currentUser.id) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    if (action === 'mark_read' && message.receiver_id === currentUser.id) {
      await db.execute(
        'UPDATE messages SET read_status = TRUE, read_at = NOW() WHERE id = ?',
        [messageId]
      );
    } else if (action === 'mark_unread' && message.receiver_id === currentUser.id) {
      await db.execute(
        'UPDATE messages SET read_status = FALSE, read_at = NULL WHERE id = ?',
        [messageId]
      );
    } else if (action === 'delete') {
      if (message.sender_id === currentUser.id) {
        await db.execute(
          'UPDATE messages SET is_deleted_by_sender = TRUE WHERE id = ?',
          [messageId]
        );
      }
      if (message.receiver_id === currentUser.id) {
        await db.execute(
          'UPDATE messages SET is_deleted_by_receiver = TRUE WHERE id = ?',
          [messageId]
        );
      }
    } else {
      await db.end();
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    await db.end();

    return NextResponse.json({
      success: true,
      message: `Message ${action.replace('_', ' ')} successfully`
    });

  } catch (error) {
    console.error('Error updating message:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to update message',
      details: error.message 
    }, { status: 500 });
  }
}

/**
 * Helper to get related entity name
 */
async function getRelatedEntityName(db, module, id) {
  try {
    let query = '';
    switch (module) {
      case 'lead':
        query = 'SELECT contact_name as name FROM leads WHERE id = ?';
        break;
      case 'client':
      case 'company':
        query = 'SELECT name FROM companies WHERE id = ?';
        break;
      case 'project':
        query = 'SELECT name FROM projects WHERE id = ?';
        break;
      case 'employee':
        query = 'SELECT CONCAT(first_name, " ", last_name) as name FROM employees WHERE id = ?';
        break;
      case 'proposal':
        query = 'SELECT title as name FROM proposals WHERE id = ?';
        break;
      default:
        return null;
    }
    const [rows] = await db.execute(query, [id]);
    return rows.length > 0 ? rows[0].name : null;
  } catch {
    return null;
  }
}
