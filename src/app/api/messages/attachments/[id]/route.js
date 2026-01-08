import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * GET /api/messages/attachments/[id]
 * Download an attachment (with security check)
 */
export async function GET(request, { params }) {
  try {
    const currentUser = await getCurrentUser(request);
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const attachmentId = parseInt(id);

    const db = await dbConnect();

    // Get attachment with message info
    const [attachments] = await db.execute(`
      SELECT 
        a.*,
        m.sender_id,
        m.receiver_id,
        m.conversation_id
      FROM message_attachments a
      JOIN messages m ON a.message_id = m.id
      WHERE a.id = ?
    `, [attachmentId]);

    if (attachments.length === 0) {
      return NextResponse.json({ success: false, error: 'Attachment not found' }, { status: 404 });
    }

    const attachment = attachments[0];

    // Security check: User must be sender, receiver, or member of conversation
    let hasAccess = false;
    
    if (attachment.sender_id === currentUser.id || attachment.receiver_id === currentUser.id) {
      hasAccess = true;
    } else if (attachment.conversation_id) {
      // Check if user is member of the conversation
      const [membership] = await db.execute(
        'SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
        [attachment.conversation_id, currentUser.id]
      );
      hasAccess = membership.length > 0;
    }
    
    if (!hasAccess) {
      return NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 });
    }

    // Read file
    const filePath = path.join(process.cwd(), 'private', 'message-attachments', attachment.file_name);
    
    if (!existsSync(filePath)) {
      return NextResponse.json({ success: false, error: 'File not found on server' }, { status: 404 });
    }

    const fileBuffer = await readFile(filePath);

    // Return file with proper headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': attachment.file_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.original_name || 'attachment')}"`,
        'Content-Length': (attachment.file_size || fileBuffer.length).toString()
      }
    });

  } catch (error) {
    console.error('Error downloading attachment:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to download attachment',
      details: error.message 
    }, { status: 500 });
  }
}
