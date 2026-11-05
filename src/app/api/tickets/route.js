import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { getServerAuth } from '@/utils/server-auth';
import {
	canHandleTicket,
	listTicketDepartments,
} from '@/lib/tickets/departments';
import { enqueueTicketEmails } from '@/lib/tickets/email-outbox';

const TICKET_CATEGORIES = [
	'login_issues',
	'performance',
	'bug_report',
	'feature_request',
	'data_issue',
	'access_permission',
	'other',
];
const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TICKET_STATUS_VALUES = [
	'open',
	'in_progress',
	'pending_info',
	'resolved',
	'closed',
];
const MAX_TICKET_NUMBER_ATTEMPTS = 5;

class HttpError extends Error {
	constructor(statusCode, message) {
		super(message);
		this.statusCode = statusCode;
	}
}

function toPositiveInteger(value) {
	const parsed = typeof value === 'number' ? value : Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireEnum(value, allowed, field) {
	if (!allowed.includes(value)) {
		throw new HttpError(400, `Invalid ${field}`);
	}
	return value;
}

function isRetryableTicketWriteError(error) {
	// A concurrent creator won the ticket_number unique index, or InnoDB
	// picked our transaction as a deadlock victim. Both are safe to retry
	// because the whole ticket + outbox transaction was rolled back.
	if (error?.code === 'ER_LOCK_DEADLOCK' || error?.errno === 1213) return true;
	return (
		(error?.code === 'ER_DUP_ENTRY' || error?.errno === 1062) &&
		String(error?.message || '').includes('ticket_number')
	);
}

async function rollbackQuietly(connection) {
	if (!connection) return;
	try {
		await connection.rollback();
	} catch (rollbackError) {
		console.error('Error rolling back ticket transaction:', rollbackError);
	}
}

async function getSubmitterName(connection, userId) {
	const [rows] = await connection.execute(
		`SELECT full_name, username FROM users WHERE id = ?`,
		[userId]
	);
	const submitter = rows[0];
	return submitter?.full_name || submitter?.username || 'Accent employee';
}

// A department can disappear or lose its last eligible member between the
// validation read and the insert. That is a 400 for the caller, not a 500.
async function enqueueValidatedTicketEmails(connection, event) {
	try {
		await enqueueTicketEmails(connection, event);
	} catch (error) {
		if (error?.code === 'TICKET_EMAIL_ENQUEUE') {
			throw new HttpError(400, error.message);
		}
		throw error;
	}
}

// Generate the next ticket number for the current year/month.
// The unique index on ticket_number is the source of truth; callers retry
// within a bounded loop when two creators race for the same number.
async function generateTicketNumber(connection) {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const prefix = `TKT-${year}${month}-`;

	const [rows] = await connection.execute(
		`SELECT ticket_number FROM support_tickets
     WHERE ticket_number LIKE ?
     ORDER BY CAST(SUBSTRING_INDEX(ticket_number, '-', -1) AS UNSIGNED) DESC
     LIMIT 1`,
		[`${prefix}%`]
	);

	let nextNum = 1;
	if (rows.length > 0) {
		const lastNum = parseInt(rows[0].ticket_number.split('-').pop(), 10);
		if (Number.isInteger(lastNum)) nextNum = lastNum + 1;
	}

	return `${prefix}${String(nextNum).padStart(4, '0')}`;
}

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

// GET - Fetch tickets (own, currently responsible department, or all for admin)
export async function GET(request) {
	let connection;
	try {
		const session = await getServerAuth();
		if (!session?.user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const status = searchParams.get('status');
		const priority = searchParams.get('priority');
		const category = searchParams.get('category');
		const departmentFilter = searchParams.get('ticket_department_id');
		const showAll = searchParams.get('all') === 'true';

		let departmentId = null;
		if (departmentFilter) {
			departmentId = toPositiveInteger(departmentFilter);
			if (!departmentId) {
				return NextResponse.json(
					{ success: false, error: 'Invalid ticket_department_id' },
					{ status: 400 }
				);
			}
		}

		connection = await dbConnect();

		let query = `
      ${TICKET_DETAIL_SELECT}
      WHERE t.isDelete = 0
    `;
		const params = [];

		// Only show all tickets when a super admin explicitly requests it.
		// Everyone else sees their own tickets plus tickets in the department
		// whose responsible role they currently hold.
		const canSeeAll = session.user.is_super_admin && showAll;
		if (!canSeeAll) {
			query += ` AND (
        t.user_id = ?
        OR EXISTS (
          SELECT 1
          FROM ticket_departments hd
          INNER JOIN roles_master hr ON hr.id = hd.role_id AND hr.status = 'active'
          INNER JOIN users hu ON hu.role_id = hr.id
          WHERE hd.id = t.ticket_department_id
            AND hd.is_active = 1
            AND hd.isDelete = 0
            AND hu.id = ?
            AND hu.isDelete = 0
            AND (hu.is_active = 1 OR hu.is_active IS NULL)
            AND (hu.status = 'active' OR hu.status IS NULL)
        )
      )`;
			params.push(session.user.id, session.user.id);
		}

		if (departmentId) {
			query += ` AND t.ticket_department_id = ?`;
			params.push(departmentId);
		}

		if (status) {
			query += ` AND t.status = ?`;
			params.push(status);
		}

		if (priority) {
			query += ` AND t.priority = ?`;
			params.push(priority);
		}

		if (category) {
			query += ` AND t.category = ?`;
			params.push(category);
		}

		query += ` ORDER BY
      CASE t.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      t.created_at DESC`;

		const [tickets] = await connection.execute(query, params);

		return NextResponse.json({ success: true, data: tickets });
	} catch (error) {
		console.error('Error fetching tickets:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}

// POST - Create new ticket in a responsible department
export async function POST(request) {
	let connection;
	try {
		const session = await getServerAuth();
		if (!session?.user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const body = await request.json();
		const { subject, description } = body;

		if (!subject || !description) {
			return NextResponse.json(
				{
					success: false,
					error: 'Subject and description are required',
				},
				{ status: 400 }
			);
		}

		const category = requireEnum(
			body.category ?? 'other',
			TICKET_CATEGORIES,
			'category'
		);
		const priority = requireEnum(
			body.priority ?? 'medium',
			TICKET_PRIORITIES,
			'priority'
		);
		const departmentId = toPositiveInteger(body.ticket_department_id);
		if (!departmentId) {
			return NextResponse.json(
				{
					success: false,
					error: 'A responsible ticket department is required',
				},
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		let createdTicket = null;
		let ticketNumber = null;

		for (let attempt = 1; attempt <= MAX_TICKET_NUMBER_ATTEMPTS; attempt++) {
			await connection.beginTransaction();
			try {
				// The department must still be selectable (active, mapped to an
				// active role, with at least one eligible recipient) inside the
				// same transaction that persists the ticket.
				const departments = await listTicketDepartments(connection, false);
				const department = departments.find(
					(candidate) => Number(candidate.id) === departmentId
				);
				if (!department) {
					throw new HttpError(
						400,
						'Selected department is not available for new tickets'
					);
				}

				ticketNumber = await generateTicketNumber(connection);

				const [result] = await connection.execute(
					`INSERT INTO support_tickets (
            ticket_number, user_id, title, description, category, priority,
            ticket_department_id, assignment_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						ticketNumber,
						session.user.id,
						subject,
						description,
						category,
						priority,
						departmentId,
						1,
					]
				);

				// The creation alert rows are committed with the ticket. A later
				// delivery failure never rolls the ticket back.
				await enqueueValidatedTicketEmails(connection, {
					ticketId: result.insertId,
					departmentId,
					assignmentVersion: 1,
					eventType: 'created',
					ticketNumber,
					subject,
					priority,
					submitterName:
						session.user.full_name ||
						session.user.username ||
						'Accent employee',
				});

				const [tickets] = await connection.execute(
					`${TICKET_DETAIL_SELECT} WHERE t.id = ? AND t.isDelete = 0`,
					[result.insertId]
				);
				createdTicket = tickets[0];

				await connection.commit();
				break;
			} catch (error) {
				await rollbackQuietly(connection);
				if (
					isRetryableTicketWriteError(error) &&
					attempt < MAX_TICKET_NUMBER_ATTEMPTS
				) {
					continue;
				}
				throw error;
			}
		}

		if (!createdTicket) {
			throw new Error('Ticket could not be created');
		}

		return NextResponse.json({
			success: true,
			data: createdTicket,
			message: `Ticket ${ticketNumber} created successfully.`,
		});
	} catch (error) {
		console.error('Error creating ticket:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: error.statusCode || 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}

// PUT - Update ticket (owner actions, handler status/notes, super-admin routing)
export async function PUT(request) {
	let connection;
	try {
		const session = await getServerAuth();
		if (!session?.user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const body = await request.json();
		const { status, priority, assigned_to, resolution_notes } = body;

		const ticketId = toPositiveInteger(body.id);
		if (!ticketId) {
			return NextResponse.json(
				{ success: false, error: 'Ticket ID required' },
				{ status: 400 }
			);
		}

		const statusValue =
			status === undefined
				? undefined
				: requireEnum(status, TICKET_STATUS_VALUES, 'status');
		const priorityValue =
			priority === undefined
				? undefined
				: requireEnum(priority, TICKET_PRIORITIES, 'priority');

		let assignedToValue;
		if (assigned_to !== undefined) {
			if (assigned_to === null || assigned_to === '') {
				assignedToValue = null;
			} else {
				assignedToValue = toPositiveInteger(assigned_to);
				if (!assignedToValue) {
					return NextResponse.json(
						{ success: false, error: 'Invalid assigned_to' },
						{ status: 400 }
					);
				}
			}
		}

		connection = await dbConnect();
		await connection.beginTransaction();

		const [existing] = await connection.execute(
			`SELECT * FROM support_tickets WHERE id = ? AND isDelete = 0 FOR UPDATE`,
			[ticketId]
		);

		if (existing.length === 0) {
			await rollbackQuietly(connection);
			return NextResponse.json(
				{ success: false, error: 'Ticket not found' },
				{ status: 404 }
			);
		}

		const ticket = existing[0];
		const isOwner = ticket.user_id === session.user.id;
		const isAdmin = Boolean(session.user.is_super_admin);

		let isHandler = false;
		if (!isOwner && !isAdmin) {
			isHandler = await canHandleTicket(connection, ticket.id, session.user.id);
			if (!isHandler) {
				await rollbackQuietly(connection);
				return NextResponse.json(
					{ success: false, error: 'Unauthorized' },
					{ status: 403 }
				);
			}
		}

		// Priority and individual assignment are super-admin-only. Department
		// routing is the only supported reassignment path for handlers.
		if (
			!isAdmin &&
			(priority !== undefined ||
				assigned_to !== undefined ||
				body.ticket_department_id !== undefined)
		) {
			await rollbackQuietly(connection);
			return NextResponse.json(
				{
					success: false,
					error: 'Only super administrators can change routing or priority',
				},
				{ status: 403 }
			);
		}

		let departmentChanged = false;
		let nextAssignmentVersion = Number(ticket.assignment_version) || 0;
		let targetDepartmentId = null;

		if (body.ticket_department_id !== undefined) {
			targetDepartmentId = toPositiveInteger(body.ticket_department_id);
			if (!targetDepartmentId) {
				await rollbackQuietly(connection);
				return NextResponse.json(
					{ success: false, error: 'Invalid ticket_department_id' },
					{ status: 400 }
				);
			}

			const currentDepartmentId =
				ticket.ticket_department_id === null ||
				ticket.ticket_department_id === undefined
					? null
					: Number(ticket.ticket_department_id);

			if (targetDepartmentId !== currentDepartmentId) {
				const departments = await listTicketDepartments(connection, false);
				const exists = departments.some(
					(candidate) => Number(candidate.id) === targetDepartmentId
				);
				if (!exists) {
					await rollbackQuietly(connection);
					return NextResponse.json(
						{
							success: false,
							error: 'Selected department is not available',
						},
						{ status: 400 }
					);
				}
				departmentChanged = true;
				nextAssignmentVersion += 1;
			}
		}

		const updates = [];
		const params = [];

		if (statusValue) {
			updates.push('status = ?');
			params.push(statusValue);

			if (statusValue === 'resolved' || statusValue === 'closed') {
				updates.push('resolved_at = NOW()');
				updates.push('resolved_by = ?');
				params.push(session.user.id);
			} else {
				updates.push('resolved_at = NULL');
				updates.push('resolved_by = NULL');
			}
		}

		if (priorityValue && isAdmin) {
			updates.push('priority = ?');
			params.push(priorityValue);
		}

		if (assignedToValue !== undefined && isAdmin) {
			updates.push('assigned_to = ?');
			params.push(assignedToValue);
		}

		if (resolution_notes) {
			updates.push('resolution_notes = ?');
			params.push(resolution_notes);
		}

		if (departmentChanged) {
			updates.push('ticket_department_id = ?');
			updates.push('assignment_version = ?');
			params.push(targetDepartmentId, nextAssignmentVersion);
		}

		const reassignmentRequestedButUnchanged =
			body.ticket_department_id !== undefined && !departmentChanged;

		if (updates.length === 0) {
			if (!reassignmentRequestedButUnchanged) {
				await rollbackQuietly(connection);
				return NextResponse.json(
					{ success: false, error: 'No updates provided' },
					{ status: 400 }
				);
			}

			// Re-submitting the current department is a no-op: no version bump
			// and no duplicate alert.
			await connection.commit();
			const [unchanged] = await connection.execute(
				`${TICKET_DETAIL_SELECT} WHERE t.id = ? AND t.isDelete = 0`,
				[ticketId]
			);
			return NextResponse.json({ success: true, data: unchanged[0] });
		}

		params.push(ticketId);

		await connection.execute(
			`UPDATE support_tickets SET ${updates.join(', ')} WHERE id = ? AND isDelete = 0`,
			params
		);

		if (departmentChanged) {
			// Revoke unsent alerts from the previous department before queuing
			// the reassignment snapshot. The whole operation shares one transaction.
			await connection.execute(
				`UPDATE ticket_email_outbox
         SET status = 'cancelled', locked_until = NULL, lock_token = NULL
         WHERE ticket_id = ? AND status IN ('pending', 'processing') AND isDelete = 0`,
				[ticketId]
			);

			const submitterName = await getSubmitterName(connection, ticket.user_id);
			await enqueueValidatedTicketEmails(connection, {
				ticketId,
				departmentId: targetDepartmentId,
				assignmentVersion: nextAssignmentVersion,
				eventType: 'reassigned',
				ticketNumber: ticket.ticket_number,
				subject: ticket.subject || ticket.title,
				priority: priorityValue || ticket.priority,
				submitterName,
			});
		}

		await connection.commit();

		const [updated] = await connection.execute(
			`${TICKET_DETAIL_SELECT} WHERE t.id = ? AND t.isDelete = 0`,
			[ticketId]
		);

		return NextResponse.json({
			success: true,
			data: updated[0],
		});
	} catch (error) {
		await rollbackQuietly(connection);
		console.error('Error updating ticket:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: error.statusCode || 500 }
		);
	} finally {
		if (connection) connection.release();
	}
}
