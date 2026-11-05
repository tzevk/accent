import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';
import { canHandleTicket } from '@/lib/tickets/departments';

const TICKET_DETAIL_SELECT = `
  SELECT
    t.*,
    t.title AS subject,
    u.full_name as user_name,
    u.email as user_email,
    a.full_name as assigned_to_name,
    r.full_name as resolved_by_name,
    td.name as ticket_department_name,
    tr.role_name as ticket_role_name
  FROM support_tickets t
  LEFT JOIN users u ON t.user_id = u.id
  LEFT JOIN users a ON t.assigned_to = a.id
  LEFT JOIN users r ON t.resolved_by = r.id
  LEFT JOIN ticket_departments td ON td.id = t.ticket_department_id AND td.isDelete = 0
  LEFT JOIN roles_master tr ON tr.id = td.role_id
`;

function parseAttachments(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string') return [];

	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

// GET - Fetch single ticket with comments
export async function GET(request, { params }) {
	let connection;
	try {
		const session = await getServerAuth();
		if (!session?.user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { id } = await params;

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Ticket ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const [tickets] = await connection.execute(
			`${TICKET_DETAIL_SELECT} WHERE t.id = ? AND t.isDelete = 0`,
			[id]
		);

		if (tickets.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Ticket not found' },
				{ status: 404 }
			);
		}

		const ticket = tickets[0];
		const isOwner = ticket.user_id === session.user.id;
		const isAdmin = Boolean(session.user.is_super_admin);
		// Membership is read fresh so a stale session role cannot unlock a
		// department the user no longer handles.
		const isHandler = isAdmin
			? false
			: await canHandleTicket(connection, ticket.id, session.user.id);

		// Owners, super admins, and current responsible-role members may read
		// the ticket. Unrelated department members may not.
		if (!isOwner && !isAdmin && !isHandler) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 403 }
			);
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
		if (!isAdmin) {
			commentQuery += ` AND (c.is_internal = 0 OR c.is_internal IS NULL)`;
		}

		commentQuery += ` ORDER BY c.created_at ASC`;

		const [comments] = await connection.execute(commentQuery, [id]);

		return NextResponse.json({
			success: true,
			data: {
				...ticket,
				can_update_status: isOwner || isAdmin || isHandler,
				can_reassign: isAdmin,
				can_handle: isHandler || isAdmin,
				comments: comments.map((c) => ({
					...c,
					attachments: parseAttachments(c.attachments),
				})),
			},
		});
	} catch (error) {
		console.error('Error fetching ticket:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
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
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { id } = await params;
		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Ticket ID is required' },
				{ status: 400 }
			);
		}
		const body = await request.json();
		const { comment, attachments = [], is_internal = false } = body;

		if (!comment) {
			return NextResponse.json(
				{ success: false, error: 'Comment is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const [tickets] = await connection.execute(
			`SELECT * FROM support_tickets WHERE id = ? AND isDelete = 0`,
			[id]
		);

		if (tickets.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Ticket not found' },
				{ status: 404 }
			);
		}

		const ticket = tickets[0];
		const isOwner = ticket.user_id === session.user.id;
		const isAdmin = Boolean(session.user.is_super_admin);
		const isHandler =
			!isOwner && !isAdmin
				? await canHandleTicket(connection, ticket.id, session.user.id)
				: false;

		// Owners, super admins, and current responsible-role members may reply.
		if (!isOwner && !isAdmin && !isHandler) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 403 }
			);
		}

		const internalComment = Boolean(is_internal) && isAdmin;

		const [result] = await connection.execute(
			`INSERT INTO ticket_comments (ticket_id, user_id, comment, is_internal, attachments)
       VALUES (?, ?, ?, ?, ?)`,
			[
				id,
				session.user.id,
				comment,
				internalComment,
				JSON.stringify(attachments),
			]
		);

		// A reply from the employee to a pending-info ticket moves it back to
		// in-progress. Uses the real stored status value.
		if (ticket.status === 'pending_info' && isOwner) {
			await connection.execute(
				`UPDATE support_tickets SET status = 'in_progress' WHERE id = ? AND isDelete = 0`,
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
				is_internal: internalComment,
				created_at: new Date(),
			},
		});
	} catch (error) {
		console.error('Error adding comment:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}

// DELETE - Delete ticket (admin only or owner of an unassigned legacy ticket)
export async function DELETE(request, { params }) {
	let connection;
	try {
		const session = await getServerAuth();
		if (!session?.user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { id } = await params;
		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Ticket ID is required' },
				{ status: 400 }
			);
		}
		connection = await dbConnect();

		const [tickets] = await connection.execute(
			`SELECT * FROM support_tickets WHERE id = ? AND isDelete = 0`,
			[id]
		);

		if (tickets.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Ticket not found' },
				{ status: 404 }
			);
		}

		const ticket = tickets[0];
		const isOwner = ticket.user_id === session.user.id;
		const isAdmin = Boolean(session.user.is_super_admin);

		// Only a super admin can delete, or the owner of a legacy ticket that
		// is still new, individually unassigned, and not routed to a department.
		const isDeletableLegacyTicket =
			isOwner &&
			ticket.status === 'open' &&
			!ticket.assigned_to &&
			!ticket.ticket_department_id;

		if (!isAdmin && !isDeletableLegacyTicket) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 403 }
			);
		}

		await connection.execute(
			`UPDATE support_tickets SET isDelete = 1 WHERE id = ? AND isDelete = 0`,
			[id]
		);

		return NextResponse.json({ success: true, message: 'Ticket deleted' });
	} catch (error) {
		console.error('Error deleting ticket:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}
