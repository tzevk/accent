/**
 * Employee resolution for `user_activity_assignments.daily_entries` readers —
 * the one rule shared by the payroll calculator's batch reader and the
 * Attendance report, so the two cannot drift.
 *
 * A row resolves to an Employee by, in order: the assignment's own
 * `employee_id`, the linked user's `employee_id`, a case-folded email match,
 * then a case-folded username match against the identifier map. The map is
 * built from Employee records first, then from User records, and the first
 * claim on an identifier wins. Keys are trimmed and lower-cased on both sides
 * — insert and lookup — so a value differing only by surrounding whitespace
 * or case resolves identically.
 *
 * Pure: rows in, ids out — no database, no framework, no clock reads. The
 * callers own their queries and their aggregation; this module owns only who
 * a logged-hours row belongs to.
 */

/** Minimal shape of an `employees` row for identifier matching. */
export interface EmployeeIdentifierRow {
	id: number | string;
	email?: string | null;
	username?: string | null;
}

/** Minimal shape of a `users` row for identifier matching. */
export interface UserIdentifierRow {
	employee_id: number | string | null;
	email?: string | null;
	username?: string | null;
}

/** Minimal shape of an assignment row plus its joined user columns. */
export interface AssignmentResolutionRow {
	employee_id?: number | string | null;
	user_employee_id?: number | string | null;
	user_email?: string | null;
	user_username?: string | null;
}

/** Trim + case-fold one identifier; empty and null-ish values yield ''. */
function identifierKey(value: unknown): string {
	return String(value || '')
		.trim()
		.toLowerCase();
}

/**
 * Identifier → Employee id, first claim wins. Employee records are added
 * before User records, so an Employee's own email/username outranks the same
 * value carried on a linked User row.
 */
export function buildLoggedHoursIdentifierMap(
	employees: readonly EmployeeIdentifierRow[],
	users: readonly UserIdentifierRow[]
): Map<string, number> {
	const identifiers = new Map<string, number>();
	const add = (value: unknown, employeeId: number | string | null) => {
		const key = identifierKey(value);
		if (key && !identifiers.has(key)) identifiers.set(key, Number(employeeId));
	};
	for (const row of employees) {
		add(row.email, row.id);
		add(row.username, row.id);
	}
	for (const row of users) {
		add(row.email, row.employee_id);
		add(row.username, row.employee_id);
	}
	return identifiers;
}

/**
 * The Employee an assignment row belongs to, or 0 when nothing matches —
 * never a different employee.
 */
export function resolveLoggedHoursEmployeeId(
	row: AssignmentResolutionRow,
	identifiers: ReadonlyMap<string, number>
): number {
	return (
		Number(row.employee_id) ||
		Number(row.user_employee_id) ||
		identifiers.get(identifierKey(row.user_email)) ||
		identifiers.get(identifierKey(row.user_username)) ||
		0
	);
}
