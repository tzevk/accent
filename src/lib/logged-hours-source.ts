/**
 * Employee resolution for `user_activity_assignments.daily_entries` readers.
 *
 * An assignment's recorded `employee_id` is authoritative, including for
 * historical rows. If it is absent, ownership comes only from the linked
 * account's canonical `users.employee_id`; display and login identifiers do
 * not establish Employee ownership.
 *
 * Pure: rows in, ids out — no database, framework, or clock reads. Callers
 * own their queries and aggregation; this module owns only attribution.
 */

/** Minimal shape of an assignment row and its linked account's Employee id. */
export interface AssignmentResolutionRow {
	employee_id?: number | string | null;
	user_employee_id?: number | string | null;
}

/**
 * The Employee an assignment row belongs to, or 0 when neither recorded
 * assignment nor linked account identifies an Employee.
 */
export function resolveLoggedHoursEmployeeId(
	row: AssignmentResolutionRow
): number {
	const assignmentEmployeeId = Number(row.employee_id);
	if (Number.isFinite(assignmentEmployeeId) && assignmentEmployeeId > 0)
		return assignmentEmployeeId;
	const linkedEmployeeId = Number(row.user_employee_id);
	return Number.isFinite(linkedEmployeeId) && linkedEmployeeId > 0
		? linkedEmployeeId
		: 0;
}
