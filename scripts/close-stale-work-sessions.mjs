#!/usr/bin/env node

/**
 * Sweep — close stale Work Sessions (ticket #331).
 *
 * A Work Session the browser never closed (tab closed without a Sign out,
 * machine asleep, network gone) stays `active` forever, so the day's work
 * figure never settles. This script ends every Work Session whose owner has
 * reported no activity signal for STALE_MINUTES, stamping the end at that last
 * signal — an inference about presence, never a chosen logout. The Punch Out
 * tile discloses it as one.
 *
 * Schedule: every five minutes. On Windows this is the Task Scheduler entry in
 * `scripts/close-stale-work-sessions.task.xml` (same shape as the SmartOffice
 * sync's own five-minute task): register it with
 * `scripts/setup-close-stale-work-sessions-task.bat`, or by hand with
 * `schtasks /Create /TN "Accent Work Session Sweep" /XML scripts/close-stale-work-sessions.task.xml /F`.
 * One run is cheap (one SELECT plus one close per stale user), so a missed
 * schedule self-heals on the next run, and `MultipleInstancesPolicy IgnoreNew`
 * keeps a slow run from overlapping the next one.
 *
 * What it writes:
 *   - user_work_sessions: session_end = last activity signal,
 *     duration_minutes from session_start to that signal, status = 'ended',
 *     end_source = 'sweep'.
 *   - user_daily_summary.total_work_minutes, refreshed through the same close
 *     path the logout uses (src/utils/work-session-close.js) — never a second
 *     copy of that SQL.
 * What it never writes: attendance status, attendance cells, or any payroll
 * figure.
 *
 * Idempotent and rerunnable: only `status = 'active'` rows are touched, so a
 * second run closes nothing and writes nothing. Sessions are ended whatever
 * day they started; the daily figure is refreshed for every date they touch.
 *
 * A user with no presence row has never reported anything to presence — signed
 * in and never opened a page that tracks, or with scripting off. That is
 * silence by the repo's own presence rule (`getStatusFromActivity` reads a
 * missing row as offline), so those sessions are swept too, stamped at the
 * moment the sweep noticed rather than at a reported signal.
 *
 * Usage (run from the repo root; `.env` supplies the credentials):
 *   node scripts/close-stale-work-sessions.mjs
 * Environment: DEV_DB_* (the app's own development database), plus the shared
 * DB_HOST and DB_PORT.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { closePool, getDbSslConfig } from '../src/utils/database.js';

/** Presence silence after which a Work Session is ended, in minutes. */
const STALE_MINUTES = 10;

/** How the closed rows are marked, for the tile's disclosure. */
const END_SOURCE = 'sweep';

/** The database this run sweeps: the app's own DEV_* dev database. */
function resolveTarget() {
	const database = process.env.DEV_DB_NAME;
	const user = process.env.DEV_DB_USER;
	const password = process.env.DEV_DB_PASSWORD;
	if (!database || !user) {
		throw new Error(
			'Set DEV_DB_NAME/DEV_DB_USER (and DEV_DB_PASSWORD) — this script needs a database to sweep.'
		);
	}
	return {
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT || 3306),
		database,
		user,
		password,
		ssl: getDbSslConfig(),
		dateStrings: true,
		connectionLimit: 2,
	};
}

async function main() {
	const target = resolveTarget();

	const { endUserSession } = await import('../src/utils/work-session-close.js');

	const pool = mysql.createPool(target);
	try {
		// The staleness key is the last activity signal, not the last heartbeat:
		// an idle tab refreshes `last_seen` every 120 seconds and would otherwise
		// hold its Work Session open for as long as the tab lives. The fallback
		// to `last_seen` is for rows written before `last_active_seen` existed —
		// their signal is NULL, and a NULL read as silence would end a live
		// session on the first run after the column lands.
		//
		// One presence row per user, so one signal stamps every session that
		// user left open. `dateStrings` keeps that signal as the literal the
		// database stored, so the stamped end is that exact timestamp; a user
		// with no presence row at all is silent by the presence rule and is
		// stamped with the moment the sweep noticed (the NULL `last_seen` keeps
		// them in this SELECT, and the NULL signal stamps them now).
		const [stale] = await pool.execute(
			`SELECT ws.id AS session_id,
                ws.user_id,
                COALESCE(up.last_active_seen, up.last_seen) AS last_signal
         FROM user_work_sessions ws
         LEFT JOIN user_presence up ON up.user_id = ws.user_id
        WHERE ws.status = 'active'
          AND (up.last_seen IS NULL
               OR COALESCE(up.last_active_seen, up.last_seen) < (NOW() - INTERVAL ? MINUTE))
        ORDER BY ws.user_id, ws.id`,
			[STALE_MINUTES]
		);

		/** @type {Map<number, { lastSignal: string | null, sessionIds: number[] }>} */
		const byUser = new Map();
		for (const row of stale) {
			const entry = byUser.get(row.user_id) ?? {
				lastSignal: row.last_signal,
				sessionIds: [],
			};
			entry.sessionIds.push(row.session_id);
			byUser.set(row.user_id, entry);
		}

		let closed = 0;
		for (const [userId, { lastSignal, sessionIds }] of byUser) {
			await endUserSession(userId, {
				endSource: END_SOURCE,
				endedAt: lastSignal,
				refreshWorkDates: 'all',
			});
			closed += sessionIds.length;
			console.log(
				`[sweep] user ${userId}: ended ${sessionIds.length} session(s) ` +
					`(${sessionIds.join(', ')}) at last activity signal ${lastSignal ?? '(none recorded — stamped now)'}`
			);
		}

		console.log(`[sweep] closed ${closed} stale work session(s)`);
	} finally {
		await pool.end();
		// The shared close path opens its own pool (src/utils/database.js) the
		// first time it closes a session. Ending it here is what lets this
		// process exit: an idle pool keeps the event loop alive forever.
		await closePool();
	}
}

main().catch((error) => {
	console.error('[sweep] failed:', error);
	process.exit(1);
});
