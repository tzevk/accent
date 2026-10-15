/**
 * The one workplace the Attendance Report covers.
 *
 * Lives in its own module on purpose. It is read by the report's server data
 * source and by the client page, so it must import nothing — a constant here
 * that reached `@/utils/database` would pull mysql2 into the browser bundle,
 * which is exactly the shape of `data-source.ts` importing the database pool.
 * The page imports this file directly and stays type-only on `./data-source`.
 *
 * Matched against `employees.workplace`, trimmed and case-folded by
 * `selectPayrollRoster`, so "Mumbai", " mumbai " and "MUMBAI" all resolve.
 * Change this one string to retarget the report to another branch.
 */
export const REPORT_WORKPLACE = 'Mumbai';
