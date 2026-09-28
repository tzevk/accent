/**
 * Number-generation races worth retrying (workstream E2 / SEC-28).
 *
 * Document numbers are minted by a `SELECT ... FOR UPDATE → INSERT` generator
 * inside a transaction. Two concurrency outcomes must be retried from a fresh
 * read rather than surfaced as a 500:
 *
 *  - a unique-index collision (errno 1062 / ER_DUP_ENTRY) when a concurrent
 *    create won the number between the read and the insert;
 *  - an InnoDB deadlock (1213) or lock-wait timeout (1205) caused by the
 *    generator's locking read.
 *
 * Callers should only retry a collision when the number was auto-generated —
 * an explicit collision on a client-supplied number is a 4xx, not a retry.
 */
export function isRetryableNumberError(error) {
	const errno = error?.errno;
	const code = error?.code;
	return (
		errno === 1062 ||
		errno === 1213 ||
		errno === 1205 ||
		code === 'ER_DUP_ENTRY' ||
		code === 'ER_LOCK_DEADLOCK' ||
		code === 'ER_LOCK_WAIT_TIMEOUT'
	);
}
