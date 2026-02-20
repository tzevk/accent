import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';

// GET - Fetch single ticket with comments
export async function GET(request, { params }) {
  let connection;
  try {
    const session = await getServerAuth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = await params;
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'Ticket ID is required' }, { status: 400 });
    }
    
    connection = await dbConnect();
    
    // Fetch ticket
    const [tickets] = await connection.execute(
      `SELECT 
        t.*,
        t.title AS subject,
        u.full_name as user_name,
        u.email as user_email,
        a.full_name as assigned_to_name,
        r.full_name as resolved_by_name
      FROM support_tickets t
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN users a ON t.assigned_to = a.id
      LEFT JOIN users r ON t.resolved_by = r.id
      WHERE t.id = ?`,
      [id]
    );
    
    if (tickets.length === 0) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
    }
    
    const ticket = tickets[0];
    
    // Check access - user can see own tickets, admins can see all
    if (ticket.user_id !== session.user.id && !session.user.is_super_admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }
    
    // Fetch comments - filter out internal comments for non-admin users
    let commentQuery = `
      SELECT 
        c.*,
        u.full_name as user_name,
        u.is_super_admin as commenter_is_admin
      FROM ticket_comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.ticket_id = ?
    `;
    
    // Regular users should not see internal comments
    if (!session.user.is_super_admin) {
      commentQuery += ` AND (c.is_internal = 0 OR c.is_internal IS NULL)`;
    }
    
    commentQuery += ` ORDER BY c.created_at ASC`;
    
    const [comments] = await connection.execute(commentQuery, [id]);
    
    return NextResponse.json({ 
      success: true, 
      data: {
        ...ticket,
        comments: comments.map(c => ({
          ...c,
          attachments: c.attachments ? JSON.parse(c.attachments) : []
        }))
      }
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// POST - Add comment to ticket
export async function POST(request, { params }) {
  let connection;
  try {
    const session = await getServerAuth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Ticket ID is required' }, { status: 400 });
    }
    const body = await request.json();
    const { comment, attachments = [], is_internal = false } = body;
    
    if (!comment) {
      return NextResponse.json({ success: false, error: 'Comment is required' }, { status: 400 });
    }
    
    connection = await dbConnect();
    
    // Check ticket exists and user has access
    const [tickets] = await connection.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [id]
    );
    
    if (tickets.length === 0) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
    }
    
    const ticket = tickets[0];
    if (ticket.user_id !== session.user.id && !session.user.is_super_admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }
    
    // Add comment
    const [result] = await connection.execute(
      `INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal, attachments)
       VALUES (?, ?, ?, ?, ?)`,
      [id, session.user.id, comment, is_internal && session.user.is_super_admin, JSON.stringify(attachments)]
    );
    
    // Update ticket status if it was waiting for employee
    if (ticket.status === 'waiting_for_employee' && ticket.user_id === session.user.id) {
      await connection.execute(
        `UPDATE support_tickets SET status = 'in_progress' WHERE id = ?`,
        [id]
      );
    }
    
    return NextResponse.json({ 
      success: true, 
      data: {
        id: result.insertId,
        ticket_id: id,
        user_id: session.user.id,
        user_name: session.user.full_name || session.user.username,
        comment,
        attachments,
        is_internal: is_internal && session.user.is_super_admin,
        created_at: new Date()
      }
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

// DELETE - Delete ticket (admin only or owner if not yet assigned)
export async function DELETE(request, { params }) {
  let connection;
  try {
    const session = await getServerAuth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Ticket ID is required' }, { status: 400 });
    }
    connection = await dbConnect();
    
    const [tickets] = await connection.execute(
      `SELECT * FROM support_tickets WHERE id = ?`,
      [id]
    );
    
    if (tickets.length === 0) {
      return NextResponse.json({ success: false, error: 'Ticket not found' }, { status: 404 });
    }
    
    const ticket = tickets[0];
    const isOwner = ticket.user_id === session.user.id;
    const isAdmin = session.user.is_super_admin;
    
    // Only admin can delete, or owner if ticket is still new and unassigned
    if (!isAdmin && (!isOwner || ticket.status !== 'new' || ticket.assigned_to)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }
    
    await connection.execute(`DELETE FROM support_tickets WHERE id = ?`, [id]);
    
    return NextResponse.json({ success: true, message: 'Ticket deleted' });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
