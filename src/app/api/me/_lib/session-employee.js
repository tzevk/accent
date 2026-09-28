/**
 * The Employee record a login is linked to (issue #247).
 *
 * `users.employee_id` is the authoritative link from a login to an Employee.
 * `getCurrentUser` carries the same column on the session object, but caches it
 * for five minutes, so self-service routes re-read the link here instead of
 * trusting a cached copy.
 *
 * The id is never taken from the request: a caller cannot ask for anyone else's
 * Employee.
 */
export async function linkedEmployeeId(db, userId) {
	const [rows] = await db.execute(
		`SELECT employee_id FROM users WHERE id = ? AND isDelete = 0`,
		[userId]
	);
	return rows[0]?.employee_id ?? null;
}
