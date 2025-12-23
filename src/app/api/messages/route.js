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
      whereClause = 'm.receiver_id = ? AND m.is_deleted_by_receiver = FALSE';
      params.push(currentUser.id);
      if (unreadOnly) {
        whereClause += ' AND m.read_status = FALSE';
      }
    } else if (type === 'sent') {
      whereClause = 'm.sender_id = ? AND m.is_deleted_by_sender = FALSE';
      params.push(currentUser.id);
    } else {
      return NextResponse.json({ success: false, error: 'Invalid type parameter' }, { status: 400 });
    }

    if (search) {
      whereClause += ' AND (m.subject LIKE ? OR m.body LIKE ? OR u.full_name LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Get total count
    const [countResult] = await db.execute(`
      SELECT COUNT(*) as total
      FROM messages m
      LEFT JOIN users u ON ${type === 'inbox' ? 'm.sender_id' : 'm.receiver_id'} = u.id
      WHERE ${whereClause}
    `, params);

    const total = countResult[0].total;

    // Get messages
    const [messages] = await db.execute(`
      SELECT 
        m.id,
        m.sender_id,
        m.receiver_id,
        m.subject,
        SUBSTRING(m.body, 1, 150) as body_preview,
        m.related_module,
        m.related_id,
        m.read_status,
        m.read_at,
        m.created_at,
        sender.full_name as sender_name,
        sender.email as sender_email,
        receiver.full_name as receiver_name,
        receiver.email as receiver_email,
        (SELECT COUNT(*) FROM message_attachments WHERE message_id = m.id) as attachment_count
      FROM messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      LEFT JOIN users receiver ON m.receiver_id = receiver.id
      WHERE ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    // Get unread count for badge
    const [unreadResult] = await db.execute(`
      SELECT COUNT(*) as unread_count
      FROM messages
      WHERE receiver_id = ? AND read_status = FALSE AND is_deleted_by_receiver = FALSE
    `, [currentUser.id]);

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
      receiver_id, 
      subject, 
      body: messageBody, 
      related_module = 'none', 
      related_id = null,
      attachments = [] // Array of { file_name, original_name, file_path, file_type, file_size }
    } = body;

    // Validation
    if (!receiver_id || !subject) {
      return NextResponse.json({ 
        success: false, 
        error: 'Missing required fields: receiver_id, subject' 
      }, { status: 400 });
    }

    // Body is required unless there are attachments
    if (!messageBody && (!attachments || attachments.length === 0)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Message body is required when no attachments are provided' 
      }, { status: 400 });
    }

    if (receiver_id === currentUser.id) {
      return NextResponse.json({ 
        success: false, 
        error: 'Cannot send message to yourself' 
      }, { status: 400 });
    }

    db = await dbConnect();

    // Ensure tables exist
    await ensureTablesExist(db);

    // Verify receiver exists
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

    // Insert message
    const [result] = await db.execute(`
      INSERT INTO messages (sender_id, receiver_id, subject, body, related_module, related_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [currentUser.id, receiver_id, subject, messageBody, related_module, related_id]);

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

    // Update or create thread
    const [user1, user2] = [currentUser.id, receiver_id].sort((a, b) => a - b);
    await db.execute(`
      INSERT INTO message_threads (user1_id, user2_id, last_message_id, last_message_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE last_message_id = ?, last_message_at = NOW()
    `, [user1, user2, messageId, messageId]);

    await db.end();

    return NextResponse.json({
      success: true,
      data: {
        message_id: messageId,
        receiver_name: receiverExists[0].full_name
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
 * Helper function to ensure tables exist
 */
async function ensureTablesExist(db) {
  try {
    // Check if messages table exists
    const [tables] = await db.execute(`SHOW TABLES LIKE 'messages'`);
    if (tables.length === 0) {
      // Create messages table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          sender_id INT NOT NULL,
          receiver_id INT NOT NULL,
          subject VARCHAR(255) NOT NULL,
          body TEXT NOT NULL,
          related_module ENUM('lead', 'client', 'project', 'employee', 'company', 'proposal', 'none') DEFAULT 'none',
          related_id INT DEFAULT NULL,
          read_status BOOLEAN DEFAULT FALSE,
          read_at DATETIME DEFAULT NULL,
          is_deleted_by_sender BOOLEAN DEFAULT FALSE,
          is_deleted_by_receiver BOOLEAN DEFAULT FALSE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_sender (sender_id),
          INDEX idx_receiver (receiver_id),
          INDEX idx_read_status (read_status),
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

      // Create message_threads table
      await db.execute(`
        CREATE TABLE IF NOT EXISTS message_threads (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user1_id INT NOT NULL,
          user2_id INT NOT NULL,
          last_message_id INT DEFAULT NULL,
          last_message_at DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_thread (user1_id, user2_id),
          INDEX idx_user1 (user1_id),
          INDEX idx_user2 (user2_id)
        )
      `);
    }
  } catch (err) {
    console.log('Table creation check:', err.message);
  }
}
