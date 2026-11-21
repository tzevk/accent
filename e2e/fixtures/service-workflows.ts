/**
 * Disposable fixtures for the support-ticket and work-log browser journeys.
 *
 * These helpers seed only the starting state a person cannot author through
 * the page under test: the routing department and its responsible role, an
 * existing ticket owned by someone else, and a saved work log. Every row is
 * namespaced, its primary key is returned, and cleanup deletes by those keys
 * (with a unique subject/title fallback for a test that failed before it read
 * the key). No mail is delivered; a created ticket only queues outbox rows,
 * which cleanup removes with the ticket.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';

export interface TicketDepartmentFixture {
	id: number;
	name: string;
	roleId: number;
}

export interface SupportTicketFixture {
	id: number;
	ticketNumber: string;
	subject: string;
	description: string;
}

export interface StoredSupportTicketRow extends RowDataPacket {
	id: number;
	ticket_number: string;
	user_id: number;
	title: string;
	description: string;
	category: string;
	priority: string;
	status: string;
	ticket_department_id: number | null;
	assignment_version: number | string;
	resolution_notes: string | null;
	resolved_at: string | null;
	isDelete: number;
}

export interface StoredTicketCommentRow extends RowDataPacket {
	id: number;
	ticket_id: number;
	user_id: number;
	comment: string;
	is_internal: number | null;
}

export interface StoredWorkLogRow extends RowDataPacket {
	id: number;
	user_id: number;
	log_date: string;
	log_type: string;
	title: string;
	description: string | null;
	category: string | null;
	priority: string;
	status: string;
	time_spent: number | null;
	project_id: string | null;
}

interface IdRow extends RowDataPacket {
	id: number | string;
}

interface RoleIdRow extends RowDataPacket {
	role_id: number | string | null;
}

export interface SeedSupportTicketInput {
	namespace: string;
	/** The account that submitted the ticket; it must be a real live user. */
	requesterUserId: number;
	departmentId: number | null;
	subject: string;
	description: string;
	status?: 'open' | 'in_progress' | 'pending_info' | 'resolved' | 'closed';
	priority?: 'low' | 'medium' | 'high' | 'critical';
	suffix: string;
}

export interface SeedWorkLogInput {
	userId: number;
	logDate: string;
	title: string;
	description?: string;
	category?: string;
	priority?: 'low' | 'medium' | 'high';
	status?: 'pending' | 'in_progress' | 'completed' | 'blocked';
	timeSpent?: number | null;
}

/** Read the role the identity fixture assigned, so a department can map to it. */
export async function readUserRoleId(
	connection: Connection,
	userId: number
): Promise<number> {
	const [rows] = await connection.execute<RoleIdRow[]>(
		'SELECT role_id FROM users WHERE id = ?',
		[userId]
	);
	const roleId = rows[0]?.role_id;
	if (roleId === null || roleId === undefined) {
		throw new Error(
			`[service-workflows] user ${userId} has no role to map a ticket department to.`
		);
	}
	return Number(roleId);
}

/**
 * Insert an active ticket department whose responsible role is the actor's
 * custom fixture role. That makes the actor an eligible recipient, so the
 * real create form lists the department without granting an unrelated role.
 */
export async function seedTicketDepartment(
	connection: Connection,
	namespace: string,
	roleId: number,
	suffix: string
): Promise<TicketDepartmentFixture> {
	const name = fitIdentifier(`${namespace} ${suffix}`, 100);
	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO ticket_departments (name, role_id, is_active)
     VALUES (?, ?, 1)`,
		[name, roleId]
	);
	return { id: Number(result.insertId), name, roleId };
}

/** Insert one routed or unrouted ticket owned by the fixture requester. */
export async function seedSupportTicket(
	connection: Connection,
	input: SeedSupportTicketInput
): Promise<SupportTicketFixture> {
	const ticketNumber = fitIdentifier(`${input.namespace}-${input.suffix}`, 20);
	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO support_tickets (
        ticket_number, user_id, title, description, category, priority, status,
        ticket_department_id, assignment_version
      ) VALUES (?, ?, ?, ?, 'other', ?, ?, ?, ?)`,
		[
			ticketNumber,
			input.requesterUserId,
			input.subject,
			input.description,
			input.priority ?? 'medium',
			input.status ?? 'open',
			input.departmentId,
			input.departmentId === null ? 0 : 1,
		]
	);
	return {
		id: Number(result.insertId),
		ticketNumber,
		subject: input.subject,
		description: input.description,
	};
}

/**
 * Fallback lookup for cleanup after a failure before the server-allocated id
 * was captured. The subject is authored by the test and the user is owned by
 * it, so this cannot select another journey's ticket.
 */
export async function findSupportTicketIds(
	connection: Connection,
	requesterUserId: number,
	subject: string
): Promise<number[]> {
	const [rows] = await connection.execute<IdRow[]>(
		`SELECT id FROM support_tickets WHERE user_id = ? AND title = ?`,
		[requesterUserId, subject]
	);
	return rows.map((row) => Number(row.id));
}

/** Delete only the named tickets and their comments/queued mail. */
export async function deleteSupportTickets(
	connection: Connection,
	ticketIds: number[]
): Promise<void> {
	if (ticketIds.length === 0) return;
	const placeholders = ticketIds.map(() => '?').join(', ');
	await connection.execute(
		`DELETE FROM ticket_email_outbox WHERE ticket_id IN (${placeholders})`,
		ticketIds
	);
	await connection.execute(
		`DELETE FROM ticket_comments WHERE ticket_id IN (${placeholders})`,
		ticketIds
	);
	await connection.execute(
		`DELETE FROM support_tickets WHERE id IN (${placeholders})`,
		ticketIds
	);
}

export async function deleteTicketDepartment(
	connection: Connection,
	departmentId: number
): Promise<void> {
	await connection.execute('DELETE FROM ticket_departments WHERE id = ?', [
		departmentId,
	]);
}

/** Insert one already-saved work log for the owned identity. */
export async function seedWorkLog(
	connection: Connection,
	input: SeedWorkLogInput
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(
		`INSERT INTO user_work_logs (
        user_id, log_date, log_type, title, description, category, priority,
        status, time_spent, project_id
      ) VALUES (?, ?, 'done', ?, ?, ?, ?, ?, ?, NULL)`,
		[
			input.userId,
			input.logDate,
			input.title,
			input.description ?? null,
			input.category ?? null,
			input.priority ?? 'medium',
			input.status ?? 'completed',
			input.timeSpent ?? null,
		]
	);
	return Number(result.insertId);
}

/** Fallback lookup for a browser-created log before its id was read back. */
export async function findWorkLogIdsByTitle(
	connection: Connection,
	userId: number,
	title: string
): Promise<number[]> {
	const [rows] = await connection.execute<IdRow[]>(
		'SELECT id FROM user_work_logs WHERE user_id = ? AND title = ?',
		[userId, title]
	);
	return rows.map((row) => Number(row.id));
}

export async function deleteWorkLogs(
	connection: Connection,
	workLogIds: number[]
): Promise<void> {
	if (workLogIds.length === 0) return;
	const placeholders = workLogIds.map(() => '?').join(', ');
	await connection.execute(
		`DELETE FROM user_work_logs WHERE id IN (${placeholders})`,
		workLogIds
	);
}
