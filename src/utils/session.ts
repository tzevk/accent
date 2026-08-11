import crypto from 'crypto';

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 2592000 (30 days)

export function createSessionToken(): string {
	return crypto.randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
	return crypto.createHash('sha256').update(token).digest('hex');
}

/** Insert a session row; returns the raw token to put in the cookie. */
export async function createSession(
	db: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
	userId: number
): Promise<string> {
	const token = createSessionToken();
	const tokenHash = hashSessionToken(token);
	await db.execute(
		'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
		[tokenHash, userId, SESSION_TTL_SECONDS]
	);
	// Bounded maintenance: drop this user's expired rows on each login (no cron).
	await db
		.execute('DELETE FROM sessions WHERE user_id = ? AND expires_at <= NOW()', [
			userId,
		])
		.catch(() => {});
	return token;
}

/** Delete the session row for a token; returns the session's user_id, or null. */
export async function revokeSession(
	db: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
	token: string
): Promise<number | null> {
	const tokenHash = hashSessionToken(token);
	const [rows] = (await db.execute(
		'SELECT user_id FROM sessions WHERE token_hash = ?',
		[tokenHash]
	)) as [Array<{ user_id: number }>, unknown];
	await db.execute('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
	return rows?.[0]?.user_id ?? null;
}

/** Delete every session row for a user (password change / reset). */
export async function revokeAllUserSessions(
	db: { execute: (sql: string, params: unknown[]) => Promise<unknown> },
	userId: number
): Promise<void> {
	await db.execute('DELETE FROM sessions WHERE user_id = ?', [userId]);
}
