import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/messages/thread/[userId]
 * Fetch conversation thread between current user and another user
 * Now uses conversation_id for grouping instead of sender/receiver pairs
 */
export async function GET(request, { params }) {
	let db;
	try {
		const currentUser = await getCurrentUser(request);
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { userId } = await params;
		const otherUserId = parseInt(userId);

		if (otherUserId === currentUser.id) {
			return NextResponse.json(
				{ success: false, error: 'Invalid user' },
				{ status: 400 }
			);
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
			return NextResponse.json(
				{ success: false, error: 'User not found' },
				{ status: 404 }
			);
		}

		// Find conversation_id for this user pair
		const [lowerId, higherId] = [currentUser.id, otherUserId].sort(
			(a, b) => a - b
		);
		const [convResult] = await db.execute(
			`
      SELECT c.id as conversation_id FROM conversations c
      JOIN conversation_members cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
      JOIN conversation_members cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?
      WHERE c.type = 'direct'
      LIMIT 1
    `,
			[lowerId, higherId]
		);

		// If no conversation exists, return empty
		if (convResult.length === 0) {
			await db.end();
			return NextResponse.json({
				success: true,
				data: {
					other_user: otherUser[0],
					conversation_id: null,
					messages: [],
					pagination: { page, limit, total: 0, totalPages: 0 },
				},
			});
		}

		const conversationId = convResult[0].conversation_id;

		// Get total count using conversation_id only
		const [countResult] = await db.execute(
			`
      SELECT COUNT(*) as total
      FROM messages m
      WHERE m.conversation_id = ?
    `,
			[conversationId]
		);

		const total = countResult[0].total;

		// Get thread messages using conversation_id only (no sender/receiver filtering)
		const [messages] = await db.execute(
			`
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
        (SELECT COUNT(*) FROM message_attachments WHERE message_id = m.id) as attachment_count
      FROM messages m
      LEFT JOIN users sender ON m.sender_id = sender.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `,
			[conversationId, limit, offset]
		);

		// Get attachments for all messages
		const messageIds = messages.map((m) => m.id);
		let attachmentsMap = {};

		if (messageIds.length > 0) {
			const placeholders = messageIds.map(() => '?').join(',');
			const [attachments] = await db.execute(
				`
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
      `,
				messageIds
			);

			// Group attachments by message_id
			attachments.forEach((att) => {
				if (!attachmentsMap[att.message_id]) {
					attachmentsMap[att.message_id] = [];
				}
				attachmentsMap[att.message_id].push(att);
			});
		}

		// Add attachments to each message
		const messagesWithAttachments = messages.map((msg) => ({
			...msg,
			attachments: attachmentsMap[msg.id] || [],
		}));

		// Mark conversation as read by updating last_read_at (single update, scales better)
		// No longer updating per-message read_status flags
		await db.execute(
			`
      UPDATE conversation_members 
      SET last_read_at = NOW() 
      WHERE conversation_id = ? AND user_id = ?
    `,
			[conversationId, currentUser.id]
		);

		await db.end();

		return NextResponse.json({
			success: true,
			data: {
				other_user: otherUser[0],
				conversation_id: conversationId,
				messages: messagesWithAttachments.reverse(), // Return in chronological order
				pagination: {
					page,
					limit,
					total,
					totalPages: Math.ceil(total / limit),
				},
			},
		});
	} catch (error) {
		console.error('Error fetching thread:', error);
		if (db)
			try {
				await db.end();
			} catch {}
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch thread',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}
