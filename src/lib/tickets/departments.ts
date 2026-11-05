import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

/**
 * Ticket department routing lookups.
 *
 * Server-only module: every function takes the caller's pooled connection so
 * authorization and persistence can share one transaction. Access is always
 * derived from the current database state, never from a cached session role.
 *
 * Active account rules match `src/utils/api-permissions.js`: the account is
 * live and both `is_active` and `status` allow access. Active role rules match
 * `roles_master.status = 'active'`. An account with a missing or syntactically
 * invalid email can still handle its department's tickets; email eligibility
 * only decides who gets a notification.
 */

export type TicketRecipient = {
	user_id: number;
	email: string;
	name: string;
};

export type TicketDepartment = {
	id: number;
	name: string;
	role_id: number | null;
	role_name: string | null;
	is_active: boolean;
	handler_count: number;
};

type DepartmentRow = RowDataPacket & {
	id: number | string;
	name: string;
	role_id: number | string | null;
	role_name: string | null;
	is_active: number | string | boolean | null;
	handler_count: number | string | null;
};

type RecipientRow = RowDataPacket & {
	user_id: number | string;
	email: string;
	name: string | null;
};

// Conservative syntactic email rule, mirroring the repo-wide check
// `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` used by employees and lead conversion: the
// trimmed address must have a non-empty local part, exactly one `@`, and a
// dotted domain with a non-empty final label. No DNS or mailbox verification
// is performed. `\z` anchors the end of input because some engines also match
// `$` before a trailing newline. Callers must bind this value, in textual
// placeholder order, wherever RECIPIENT_PREDICATE is used.
const EMAIL_PATTERN = '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+\\z';

// A recipient is an active live account whose role maps to a live, active
// department and whose trimmed email passes the syntactic rule above. This is
// the single definition of email eligibility: it decides both handler_count
// and who receives notifications, so a malformed-only role is unselectable.
const RECIPIENT_PREDICATE = `
	u.isDelete = 0
	AND (u.is_active = 1 OR u.is_active IS NULL)
	AND (u.status = 'active' OR u.status IS NULL)
	AND u.email IS NOT NULL
	AND TRIM(u.email) REGEXP ?
`;

function toNumber(value: number | string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function toDepartment(row: DepartmentRow): TicketDepartment {
	const roleId = toNumber(row.role_id);
	return {
		id: Number(row.id),
		name: row.name,
		role_id: roleId,
		role_name: row.role_name ?? null,
		is_active: Boolean(Number(row.is_active)),
		handler_count: toNumber(row.handler_count) ?? 0,
	};
}

/**
 * Lists the department catalog.
 *
 * With `includeUnavailable` false only selectable departments are returned:
 * active, mapped to an active role, with at least one member holding a
 * syntactically valid email. Passing true returns every live row, including
 * unmapped or inactive ones, with `handler_count` reporting how many
 * recipients its current mapping would reach. That shape is for super-admin
 * configuration only.
 */
export async function listTicketDepartments(
	connection: PoolConnection,
	includeUnavailable = false
): Promise<TicketDepartment[]> {
	const [rows] = await connection.execute<DepartmentRow[]>(
		`SELECT
			d.id,
			d.name,
			d.role_id,
			r.role_name,
			d.is_active,
			(
				SELECT COUNT(*)
				FROM users u
				WHERE u.role_id = r.id
					AND ${RECIPIENT_PREDICATE}
			) AS handler_count
		FROM ticket_departments d
		LEFT JOIN roles_master r
			ON r.id = d.role_id AND r.status = 'active'
		WHERE d.isDelete = 0
		ORDER BY d.name ASC`,
		[EMAIL_PATTERN]
	);

	const departments = rows.map(toDepartment);
	if (includeUnavailable) return departments;

	return departments.filter(
		(department) =>
			department.is_active &&
			department.role_id !== null &&
			department.role_name !== null &&
			department.handler_count > 0
	);
}

/**
 * Returns the notification recipients for a department.
 *
 * The department must be live, active, and mapped to an active role. Each
 * active live member of that role whose trimmed email is syntactically valid
 * is returned, ordered by user id so enqueueing is stable across retries.
 * Email validity never affects authorization, only notification reach.
 */
export async function getDepartmentRecipients(
	connection: PoolConnection,
	departmentId: number
): Promise<TicketRecipient[]> {
	if (!Number.isInteger(departmentId) || departmentId <= 0) return [];

	const [rows] = await connection.execute<RecipientRow[]>(
		`SELECT
			u.id AS user_id,
			TRIM(u.email) AS email,
			TRIM(COALESCE(NULLIF(TRIM(u.full_name), ''), u.username, '')) AS name
		FROM ticket_departments d
		INNER JOIN roles_master r
			ON r.id = d.role_id AND r.status = 'active'
		INNER JOIN users u ON u.role_id = r.id
		WHERE d.id = ?
			AND d.isDelete = 0
			AND d.is_active = 1
			AND ${RECIPIENT_PREDICATE}
		ORDER BY u.id ASC`,
		[departmentId, EMAIL_PATTERN]
	);

	return rows.map((row) => ({
		user_id: Number(row.user_id),
		email: row.email,
		name: row.name ?? '',
	}));
}

/**
 * Fresh authorization check: may this account handle this ticket?
 *
 * The ticket, its department, the mapped role, and the account must all be
 * live right now. The account's role is read from the database, so a stale
 * session role cannot grant access after a reassignment.
 */
export async function canHandleTicket(
	connection: PoolConnection,
	ticketId: number,
	userId: number
): Promise<boolean> {
	if (
		!Number.isInteger(ticketId) ||
		ticketId <= 0 ||
		!Number.isInteger(userId) ||
		userId <= 0
	) {
		return false;
	}

	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT 1
		 FROM support_tickets t
		 INNER JOIN ticket_departments d
			ON d.id = t.ticket_department_id
		 INNER JOIN roles_master r
			ON r.id = d.role_id
		 INNER JOIN users u
			ON u.role_id = r.id
		 WHERE t.id = ?
			AND t.isDelete = 0
			AND d.isDelete = 0
			AND d.is_active = 1
			AND r.status = 'active'
			AND u.id = ?
			AND u.isDelete = 0
			AND (u.is_active = 1 OR u.is_active IS NULL)
			AND (u.status = 'active' OR u.status IS NULL)
		 LIMIT 1`,
		[ticketId, userId]
	);

	return rows.length > 0;
}
