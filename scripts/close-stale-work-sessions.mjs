#!/usr/bin/env node

/**
 * Sweep — close stale Work Sessions (ticket #331).
 *
 * A Work Session the browser never closed (tab closed without a Sign out,
 * machine asleep, network gone) stays `active` forever, so the day's work
 * figure never settles. This script ends every Work Session whose owner's
 * presence heartbeat has been silent for STALE_MINUTES, stamping the end at
 * that last heartbeat — an inference about presence, never a chosen logout.
 * The Punch Out tile discloses it as one.
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
 *   - user_work_sessions: session_end = last heartbeat, duration_minutes from
 *     session_start to that heartbeat, status = 'ended', end_source = 'sweep'.
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
 * A user with no presence row has never reported a heartbeat — signed in and
 * never opened a page that tracks, or with scripting off. That is silence by
 * the repo's own presence rule (`getStatusFromActivity` reads a missing row as
 * offline), so those sessions are swept too, stamped at the moment the sweep
 * noticed instead of at a heartbeat.
 *
 * Usage (run from the repo root; `.env` supplies the credentials):
 *   node scripts/close-stale-work-sessions.mjs
 * Environment: E2E_DB_NAME wins when set (the E2E harness points the script at
 * its isolated database); otherwise DEV_DB_*, or STAGING_/PROD_* per NODE_ENV.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import { closePool, getDbSslConfig } from '../src/utils/database.js';

/** Presence silence after which a Work Session is ended, in minutes. */
const STALE_MINUTES = 10;

/** How the closed rows are marked, for the tile's disclosure. */
const END_SOURCE = 'sweep';

/**
 * Database this run sweeps: the harness's isolated database when it asks for
 * one, otherwise the app's own DEV_* resolution.
 */
function resolveTarget() {
	const database = process.env.E2E_DB_NAME || process.env.DEV_DB_NAME;
	const user = process.env.E2E_DB_USER || process.env.DEV_DB_USER;
	const password = process.env.E2E_DB_PASSWORD || process.env.DEV_DB_PASSWORD;
	if (!database || !user) {
		throw new Error(
			'Set E2E_DB_NAME/DEV_DB_NAME (and the matching user) — this script needs a database to sweep.'
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

	// The shared close path builds its pool from the app's own DEV_* env, so
	// point it at the database this run sweeps. That has to happen before the
	// module is loaded — a top-level import is hoisted above this assignment —
	// which is why this is a dynamic import and not a static one. The pool is
	// created lazily on first use, so setting the env here is enough.
	if (process.env.E2E_DB_NAME && process.env.DEV_DB_NAME !== target.database) {
		process.env.DEV_DB_NAME = target.database;
		process.env.DEV_DB_USER = target.user;
		process.env.DEV_DB_PASSWORD = target.password;
	}
	const { endUserSession } = await import('../src/utils/work-session-close.js');

	const pool = mysql.createPool(target);
	try {
		// One presence row per user, so one heartbeat stamps every session that
		// user left open. `dateStrings` keeps the heartbeat as the literal the
		// database stored, so the stamped end is that exact timestamp; a user
		// with no presence row at all is silent by the presence rule and is
		// stamped with the moment the sweep noticed (NULL heartbeats it).
		const [stale] = await pool.execute(
			`SELECT ws.id AS session_id, ws.user_id, up.last_seen
         FROM user_work_sessions ws
         LEFT JOIN user_presence up ON up.user_id = ws.user_id
        WHERE ws.status = 'active'
          AND (up.last_seen IS NULL OR up.last_seen < (NOW() - INTERVAL ? MINUTE))
        ORDER BY ws.user_id, ws.id`,
			[STALE_MINUTES]
		);

		/** @type {Map<number, { lastSeen: string | null, sessionIds: number[] }>} */
		const byUser = new Map();
		for (const row of stale) {
			const entry = byUser.get(row.user_id) ?? {
				lastSeen: row.last_seen,
				sessionIds: [],
			};
			entry.sessionIds.push(row.session_id);
			byUser.set(row.user_id, entry);
		}

		let closed = 0;
		for (const [userId, { lastSeen, sessionIds }] of byUser) {
			await endUserSession(userId, {
				endSource: END_SOURCE,
				endedAt: lastSeen,
				refreshWorkDates: 'all',
			});
			closed += sessionIds.length;
			console.log(
				`[sweep] user ${userId}: ended ${sessionIds.length} session(s) ` +
					`(${sessionIds.join(', ')}) at last heartbeat ${lastSeen ?? '(none recorded — stamped now)'}`
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
