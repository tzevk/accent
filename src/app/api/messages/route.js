import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages
 * Fetch messages for the current user (inbox or sent)
 * Query params:
 *   - type: 'inbox' | 'sent' (default: 'inbox')
 *   - page: number (default: 1)
 *   - limit: number (default: 20)
 *   - search: string (optional)
 *   - unread_only: boolean (optional)
 */
export async function GET(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'inbox';
    const page = parseInt(searchParams.get('page')) || 1;
    const limit = parseInt(searchParams.get('limit')) || 20;
    const search = searchParams.get('search') || '';
    const unreadOnly = searchParams.get('unread_only') === 'true';
    const offset = (page - 1) * limit;

    db = await dbConnect();

    // Ensure tables exist
    await ensureTablesExist(db);

    let whereClause = '';
    let params = [];

    if (type === 'inbox') {
      // Use conversation_members to filter messages user can see
      whereClause = 'm.conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = ?) AND m.sender_id != ?';
      params.push(currentUser.id, currentUser.id);
      if (unreadOnly) {
        // Filter using timestamp comparison instead of read_status flag
        whereClause += ' AND m.created_at > COALESCE((SELECT last_read_at FROM conversation_members WHERE conversation_id = m.conversation_id AND user_id = ?), "1970-01-01")';
        params.push(currentUser.id);
      }
    } else if (type === 'sent') {
      whereClause = 'm.sender_id = ?';
      params.push(currentUser.id);
    } else {
      return NextResponse.json({ success: false, error: 'Invalid type parameter' }, { status: 400 });
    }

    if (search) {
      whereClause += ' AND (m.subject LIKE ? OR m.body LIKE ? OR sender.full_name LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    const [countResult] = await db.execute(`
      SELECT COUNT(*) as total
      FROM messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      WHERE ${whereClause}
    `, params);

    const total = countResult[0].total;

    // Get messages
    const [messages] = await db.execute(`
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.conversation_id,
        m.subject,
        SUBSTRING(m.body, 1, 150) as body_preview,
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
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    // Get unread count using last_read_at comparison (scales better)
    // Works for both direct and group chats
    const [unreadResult] = await db.execute(`
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
        messages,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        },
        unread_count: unreadResult[0].unread_count
      }
    });

  } catch (error) {
    console.error('Error fetching messages:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch messages',
      details: error.message 
    }, { status: 500 });
  }
}

/**
 * POST /api/messages
 * Send a new message
 */
export async function POST(request) {
  let db;
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      receiver_id,        // For direct messages (legacy support)
      conversation_id,    // For group/project chats (preferred)
      subject, 
      body: messageBody, 
      related_module = 'none', 
      related_id = null,
      attachments = [] // Array of { file_name, original_name, file_path, file_type, file_size }
    } = body;

    // Validation - need either receiver_id (direct) or conversation_id (group/project)
    if (!receiver_id && !conversation_id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required field: receiver_id or conversation_id' 
      }, { status: 400 });
    }

    if (!subject) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required field: subject' 
      }, { status: 400 });
    }

    // Body is required unless there are attachments
    if (!messageBody && (!attachments || attachments.length === 0)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Message body is required when no attachments are provided' 
      }, { status: 400 });
    }

    // Note: No longer blocking self-send for group chats (sender is also a member)

    db = await dbConnect();

    // Ensure tables exist
    await ensureTablesExist(db);

    let finalConversationId;
    let receiverName = null;

    if (conversation_id) {
      // Group/project chat: verify sender is a member of this conversation
      const [membership] = await db.execute(
        'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
        [conversation_id, currentUser.id]
      );

      if (membership.length === 0) {
        await db.end();
        return NextResponse.json({ 
          success: false, 
          error: 'You are not a member of this conversation' 
        }, { status: 403 });
      }

      finalConversationId = conversation_id;
    } else {
      // Direct message: verify receiver exists and get/create conversation
      const [receiverExists] = await db.execute(
        'SELECT id, full_name FROM users WHERE id = ?',
        [receiver_id]
      );

      if (receiverExists.length === 0) {
        await db.end();
        return NextResponse.json({ 
          success: false, 
          error: 'Receiver not found' 
        }, { status: 404 });
      }

      receiverName = receiverExists[0].full_name;
      finalConversationId = await getOrCreateDirectConversation(currentUser.id, receiver_id, db);
    }

    // Insert message (no receiver_id for group chats - receivers come from conversation_members)
    const [result] = await db.execute(`
      INSERT INTO messages (sender_id, subject, body, related_module, related_id, conversation_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [currentUser.id, subject, messageBody, related_module, related_id, finalConversationId]);

    const messageId = result.insertId;

    // Insert attachments if any
    if (attachments.length > 0) {
      for (const attachment of attachments) {
        await db.execute(`
          INSERT INTO message_attachments (message_id, file_name, original_name, file_path, file_type, file_size)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          messageId,
          attachment.file_name,
          attachment.original_name,
          attachment.file_path,
          attachment.file_type,
          attachment.file_size
        ]);
      }
    }

    // Update conversation last activity (optional: for sorting conversation list)
    // Legacy thread table no longer needed - conversation_members handles this

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        message_id: messageId,
        conversation_id: finalConversationId,
        receiver_name: receiverName // null for group chats
      },
      message: 'Message sent successfully'
    });

  } catch (error) {
    console.error('Error sending message:', error);
    if (db) try { await db.end(); } catch {}
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to send message',
      details: error.message 
    }, { status: 500 });
  }
}

/**
 * Helper function to get or create a direct conversation between two users
 */
async function getOrCreateDirectConversation(userA, userB, db) {
  // Sort IDs to ensure order-independence
  const [lowerId, higherId] = [userA, userB].sort((a, b) => a - b);
  
  // Check if conversation already exists between these two users
  const [existing] = await db.execute(`
    SELECT c.id FROM conversations c
    JOIN conversation_members cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
    JOIN conversation_members cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
    WHERE c.type = 'direct'
    LIMIT 1
  `, [lowerId, higherId]);
  
  if (existing.length > 0) {
    return existing[0].id;
  }
  
  // Create new conversation
  const [result] = await db.execute(
    `INSERT INTO conversations (type) VALUES ('direct')`
  );
  const conversationId = result.insertId;
  
  // Add both members
  await db.execute(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)`,
    [conversationId, lowerId, conversationId, higherId]
  );
  
  return conversationId;
}

/**
 * Helper function to ensure tables exist
 * Updated schema: receiver_id optional (for legacy), receivers determined by conversation_members
 */
async function ensureTablesExist(db) {
  try {
    // Check if messages table exists
    const [tables] = await db.execute(`SHOW TABLES LIKE 'messages'`);
    if (tables.length === 0) {
      // Create messages table - receiver_id kept for legacy but nullable
      // Receivers now determined by conversation_members table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          sender_id INT NOT NULL,
          receiver_id INT DEFAULT NULL,
          conversation_id BIGINT NOT NULL,
          subject VARCHAR(255) NOT NULL,
          body TEXT,
          related_module ENUM('lead', 'client', 'project', 'employee', 'company', 'proposal', 'none') DEFAULT 'none',
          related_id INT DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_sender (sender_id),
          INDEX idx_conversation (conversation_id),
          INDEX idx_created_at (created_at)
        )
      `);

      // Create message_attachments table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS message_attachments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          message_id INT NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          original_name VARCHAR(255) NOT NULL,
          file_path VARCHAR(500) NOT NULL,
          file_type VARCHAR(100) NOT NULL,
          file_size INT NOT NULL,
          uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_message (message_id)
        )
      `);

      // Create conversations table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS conversations (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          type ENUM('direct', 'group', 'project') NOT NULL DEFAULT 'direct',
          related_module VARCHAR(50) DEFAULT NULL,
          related_id INT DEFAULT NULL,
          title VARCHAR(255) DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_type (type),
          INDEX idx_related (related_module, related_id)
        )
      `);

      // Create conversation_members table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS conversation_members (
          id INT AUTO_INCREMENT PRIMARY KEY,
          conversation_id BIGINT NOT NULL,
          user_id INT NOT NULL,
          last_read_at DATETIME DEFAULT NULL,
          is_archived BOOLEAN DEFAULT FALSE,
          is_muted BOOLEAN DEFAULT FALSE,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_member (conversation_id, user_id),
          INDEX idx_user_conversations (user_id, conversation_id),
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
      `);
    }
  } catch (err) {
    console.log('Table creation check:', err.message);
  }
}
