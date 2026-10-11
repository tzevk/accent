/**
 * The one close path for a Work Session.
 *
 * Logout, the page-close beacon and the stale-session sweep all end a Work
 * Session here: the row's end, duration and ended state are written, and the
 * day's `user_daily_summary.total_work_minutes` is refreshed from the ended
 * sessions. One definition, so the three exits cannot drift apart.
 *
 * This module is plain ESM JavaScript with relative imports on purpose:
 * `scripts/close-stale-work-sessions.mjs` runs under bare Node (no path alias,
 * no TypeScript) and closes sessions through the very same function the logout
 * uses.
 */
import { dbConnect } from './database.js';
import { hasColumn } from './schema-cache.js';

/** How a Work Session ended. A NULL column value means a pre-existing row. */
export const WORK_SESSION_END_SOURCES = ['logout', 'beacon', 'sweep'];

/**
 * End the caller's open Work Session(s) and refresh the work-minutes figure.
 *
 * Only `status = 'active'` rows are touched, so the call is idempotent: ending
 * an already-ended session changes nothing.
 *
 * @param {number} userId User whose sessions end — the session user, always.
 * @param {{
 *   endSource?: 'logout'|'beacon'|'sweep',
 *   endedAt?: Date|string|null,
 *   refreshWorkDates?: 'today'|'all',
 * }} [options]
 *   `endSource` — written to `user_work_sessions.end_source` (once the column
 *     exists; a database without the column still closes the session).
 *   `endedAt` — the end to stamp: the close time the browser reported, or the
 *     last heartbeat the sweep saw. Defaults to `CURRENT_TIMESTAMP`, which is
 *     what the logout writes.
 *   `refreshWorkDates` — `'today'` (default, the logout's behaviour) refreshes
 *     today's summary row only; `'all'` refreshes every work date the user has
 *     ended sessions on, which the sweep needs because it ends sessions
 *     whatever day they started.
 */
export async function endUserSession(userId, options = {}) {
	if (!Number.isInteger(userId) || userId <= 0) return;

	const endSource = options.endSource ?? null;
	const endedAt = options.endedAt ?? null;
	const refreshWorkDates = options.refreshWorkDates ?? 'today';

	let db;
	try {
		db = await dbConnect();

		// A reported end is only trusted as far as it goes: an end before the
		// start (clock skew, a stale heartbeat) reads as a zero-length session,
		// never as a negative duration that would drag the daily figure down.
		const writesEndSource =
			!!endSource && (await hasColumn(db, 'user_work_sessions', 'end_source'));

		const params = [endedAt, endedAt];
		if (writesEndSource) params.push(endSource);
		params.push(userId);

		await db.execute(
			`UPDATE user_work_sessions
       SET session_end = COALESCE(?, CURRENT_TIMESTAMP),
           duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, session_start, COALESCE(?, CURRENT_TIMESTAMP))),
           status = 'ended'
           ${writesEndSource ? ', end_source = ?' : ''}
       WHERE user_id = ? AND status = 'active'`,
			params
		);

		// Update daily summary with total work minutes
		const workDateFilter =
			refreshWorkDates === 'all' ? '' : 'AND DATE(session_start) = CURDATE()';
		await db.execute(
			`UPDATE user_daily_summary uds
       JOIN (
         SELECT user_id, DATE(session_start) as work_date, SUM(duration_minutes) as total_minutes
         FROM user_work_sessions
         WHERE user_id = ? AND status = 'ended' ${workDateFilter}
         GROUP BY user_id, DATE(session_start)
       ) ws ON uds.user_id = ws.user_id AND uds.date = ws.work_date
       SET uds.total_work_minutes = ws.total_minutes`,
			[userId]
		);
	} catch (error) {
		console.error('Error ending user session:', error);
	} finally {
		if (db) await db.end();
	}
}
