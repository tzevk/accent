/**
 * Activity logging + screen-time tracking utilities.
 *
 * Screen-time uses a bucket model (borrowed from ActivityWatch): the client
 * sends per-heartbeat DELTAS and `updateScreenTime` ACCUMULATES them per
 * (user, date) — append-only semantics instead of replacing the row with the
 * latest session's totals. Seconds columns hold the precise sum; the legacy
 * minutes columns are derived floors so existing dashboard reads keep working.
 */

import { dbConnect } from '@/utils/database';
import { hasColumn, invalidateCache } from '@/utils/schema-cache';

type DbRow = Record<string, unknown>;

// ─── logActivity ────────────────────────────────────────────────────

export interface LogActivityParams {
	userId: number | string;
	actionType: string;
	resourceType?: string | null;
	resourceId?: string | number | null;
	description?: string;
	details?: unknown;
	request?: Request | null;
	status?: 'success' | 'failed' | 'pending' | string;
}

/**
 * Utility function to log user activity
 */
export async function logActivity({
	userId,
	actionType,
	resourceType = null,
	resourceId = null,
	description = '',
	details = null,
	request = null,
	status = 'success',
}: LogActivityParams): Promise<void> {
	let db;
	try {
		db = await dbConnect();

		const normalizedUserId = Number.parseInt(String(userId), 10);
		// user_activity_logs.user_id has a FK to users.id, so invalid IDs (0/null/NaN)
		// must be ignored to avoid breaking request flows.
		if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
			return;
		}

		// Extract IP and user agent from request
		let ipAddress: string | null = null;
		let userAgent: string | null = null;

		if (request) {
			// Get IP address from various headers
			ipAddress =
				request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
				request.headers.get('x-real-ip') ||
				request.headers.get('cf-connecting-ip') ||
				null;

			userAgent = request.headers.get('user-agent') || null;
		}

		await db.execute(
			`INSERT INTO user_activity_logs 
       (user_id, action_type, resource_type, resource_id, description, details, ip_address, user_agent, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				normalizedUserId,
				actionType,
				resourceType,
				resourceId,
				description,
				details ? JSON.stringify(details) : null,
				ipAddress,
				userAgent,
				status,
			]
		);

		// Update work session and daily summary asynchronously (don't block)
		void updateWorkSession(normalizedUserId, actionType).catch(console.error);
	} catch (error) {
		console.error('Error logging activity:', error);
		// Don't throw - logging failures shouldn't break the main flow
	} finally {
		if (db) await db.end();
	}
}

// ─── Screen time (bucket model) ─────────────────────────────────────

export interface ScreenTimePayload {
	/** Active ms since the last heartbeat (bucket delta). */
	activeDeltaMs?: number;
	/** Idle ms since the last heartbeat (bucket delta). */
	idleDeltaMs?: number;
	/** Legacy: session-cumulative active ms. */
	activeTimeMs?: number;
	/** Legacy: session-cumulative idle ms. */
	idleTimeMs?: number;
	/** Total session ms (informational). */
	sessionDurationMs?: number;
}

export interface NormalizedScreenTime {
	activeSec: number;
	idleSec: number;
	totalSec: number;
}

/**
 * Normalize a heartbeat payload into whole-second deltas.
 *
 * Prefers per-heartbeat deltas. Falls back to legacy cumulative values so
 * older clients keep working — cumulative payloads are still ADDED once per
 * write, so a day of legacy sessions accumulates instead of overwriting.
 */
export function normalizeScreenTimePayload(
	screenData: ScreenTimePayload = {}
): NormalizedScreenTime {
	const activeMs =
		screenData.activeDeltaMs != null
			? screenData.activeDeltaMs
			: (screenData.activeTimeMs ?? 0);
	const idleMs =
		screenData.idleDeltaMs != null
			? screenData.idleDeltaMs
			: (screenData.idleTimeMs ?? 0);
	const activeSec = Math.max(0, Math.round(activeMs / 1000));
	const idleSec = Math.max(0, Math.round(idleMs / 1000));
	return {
		activeSec,
		idleSec,
		totalSec: activeSec + idleSec,
	};
}

/**
 * Update screen time for a user.
 *
 * @param userId - User ID
 * @param screenData - Screen time data from heartbeat
 */
export async function updateScreenTime(
	userId: number,
	screenData: ScreenTimePayload
): Promise<void> {
	let db;
	try {
		db = await dbConnect();

		const { activeSec, idleSec, totalSec } =
			normalizeScreenTimePayload(screenData);
		if (totalSec <= 0) return;

		// Ensure screen time table exists (with seconds columns for fresh DBs)
		await db.execute(`
      CREATE TABLE IF NOT EXISTS user_screen_time (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        date DATE NOT NULL,
        total_screen_time_minutes INT DEFAULT 0,
        active_time_minutes INT DEFAULT 0,
        idle_time_minutes INT DEFAULT 0,
        screen_time_seconds INT DEFAULT 0,
        active_time_seconds INT DEFAULT 0,
        idle_time_seconds INT DEFAULT 0,
        total_clicks INT DEFAULT 0,
        total_scrolls INT DEFAULT 0,
        total_keypresses INT DEFAULT 0,
        pages_visited INT DEFAULT 0,
        unique_pages INT DEFAULT 0,
        productivity_score DECIMAL(5,2) DEFAULT 0,
        focus_score DECIMAL(5,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_date (user_id, date),
        INDEX idx_user (user_id),
        INDEX idx_date (date)
      )
    `);

		// Migrate tables created before the seconds columns existed.
		const hasActiveSeconds = await hasColumn(
			db,
			'user_screen_time',
			'active_time_seconds'
		);
		if (!hasActiveSeconds) {
			await db.execute(
				`ALTER TABLE user_screen_time
				 ADD COLUMN screen_time_seconds INT DEFAULT 0,
				 ADD COLUMN active_time_seconds INT DEFAULT 0,
				 ADD COLUMN idle_time_seconds INT DEFAULT 0`
			);
			invalidateCache('user_screen_time');
		}

		// Accumulate deltas into the seconds columns; minutes are derived
		// floors (MySQL evaluates single-table SET clauses left-to-right, so
		// the FLOOR() calls see the already-incremented seconds).
		await db.execute(
			`INSERT INTO user_screen_time
       (user_id, date, screen_time_seconds, active_time_seconds, idle_time_seconds,
        total_screen_time_minutes, active_time_minutes, idle_time_minutes, updated_at)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         screen_time_seconds = screen_time_seconds + VALUES(screen_time_seconds),
         active_time_seconds = active_time_seconds + VALUES(active_time_seconds),
         idle_time_seconds = idle_time_seconds + VALUES(idle_time_seconds),
         total_screen_time_minutes = FLOOR(screen_time_seconds / 60),
         active_time_minutes = FLOOR(active_time_seconds / 60),
         idle_time_minutes = FLOOR(idle_time_seconds / 60),
         updated_at = CURRENT_TIMESTAMP`,
			[userId, totalSec, activeSec, idleSec, totalSec, activeSec, idleSec]
		);
	} catch (error) {
		console.error('Error updating screen time:', error);
	} finally {
		if (db) await db.end();
	}
}

// ─── Presence ───────────────────────────────────────────────────────

export interface PresenceUpdate {
	/** Client-reported idle state (heartbeat `details.isIdle`, status_change). */
	isIdle?: boolean | null;
	/** Client-reported current page (view_page / heartbeat fallback). */
	currentPage?: string | null;
}

/**
 * Upsert a user's presence row.
 *
 * `last_seen` refreshes on every call (any event = the browser is alive).
 * `is_idle` and `current_page` are only overwritten when a value is supplied
 * (COALESCE semantics) so events that carry neither never clobber state set
 * by heartbeats or status changes. One row per user, PK lookup — presence
 * reads never aggregate `user_activity_logs`.
 */
export async function updateUserPresence(
	userId: number,
	{ isIdle = null, currentPage = null }: PresenceUpdate = {}
): Promise<void> {
	let db;
	try {
		db = await dbConnect();

		const normalizedUserId = Number.parseInt(String(userId), 10);
		if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
			return;
		}

		const idleValue = typeof isIdle === 'boolean' ? (isIdle ? 1 : 0) : null;
		const page = currentPage ?? null;

		await db.execute(
			`INSERT INTO user_presence (user_id, last_seen, is_idle, current_page)
       VALUES (?, CURRENT_TIMESTAMP, COALESCE(?, 0), ?)
       ON DUPLICATE KEY UPDATE
         last_seen = CURRENT_TIMESTAMP,
         is_idle = COALESCE(?, is_idle),
         current_page = COALESCE(?, current_page)`,
			[normalizedUserId, idleValue, page, idleValue, page]
		);
	} catch (error) {
		console.error('Error updating user presence:', error);
		// Don't throw - presence tracking failures shouldn't break activity flow
	} finally {
		if (db) await db.end();
	}
}

// ─── Work sessions ──────────────────────────────────────────────────

/**
 * Update active work session
 */
async function updateWorkSession(
	userId: number,
	actionType: string
): Promise<void> {
	let db;
	try {
		db = await dbConnect();

		// Get or create today's active session
		const [sessions] = (await db.execute(
			`SELECT id FROM user_work_sessions 
       WHERE user_id = ? AND status = 'active' AND DATE(session_start) = CURDATE()
       ORDER BY session_start DESC LIMIT 1`,
			[userId]
		)) as [DbRow[], unknown];

		if (sessions.length > 0) {
			// Update existing session
			await db.execute(
				`UPDATE user_work_sessions 
         SET activities_count = activities_count + 1,
             pages_viewed = pages_viewed + IF(? = 'view_page', 1, 0),
             resources_modified = resources_modified + IF(? IN ('create', 'update', 'delete'), 1, 0),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
				[actionType, actionType, sessions[0].id]
			);
		} else if (actionType === 'login') {
			// Create new session on login
			await db.execute(
				`INSERT INTO user_work_sessions (user_id, session_start, activities_count) 
         VALUES (?, CURRENT_TIMESTAMP, 1)`,
				[userId]
			);
		}

		// Update daily summary
		await db.execute(
			`INSERT INTO user_daily_summary 
       (user_id, date, login_count, activities_completed, resources_created, resources_updated, resources_deleted, pages_viewed, first_login, last_activity)
       VALUES (?, CURDATE(), IF(? = 'login', 1, 0), 1, IF(? = 'create', 1, 0), IF(? = 'update', 1, 0), IF(? = 'delete', 1, 0), IF(? = 'view_page', 1, 0), IF(? = 'login', CURRENT_TIMESTAMP, NULL), CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         login_count = login_count + IF(? = 'login', 1, 0),
         activities_completed = activities_completed + 1,
         resources_created = resources_created + IF(? = 'create', 1, 0),
         resources_updated = resources_updated + IF(? = 'update', 1, 0),
         resources_deleted = resources_deleted + IF(? = 'delete', 1, 0),
         pages_viewed = pages_viewed + IF(? = 'view_page', 1, 0),
         first_login = COALESCE(first_login, IF(? = 'login', CURRENT_TIMESTAMP, NULL)),
         last_activity = CURRENT_TIMESTAMP`,
			[
				userId,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
				actionType,
			]
		);
	} catch (error) {
		console.error('Error updating work session:', error);
	} finally {
		if (db) await db.end();
	}
}

/**
 * End user session (call on logout)
 */
export async function endUserSession(userId: number): Promise<void> {
	let db;
	try {
		db = await dbConnect();

		// End active sessions
		await db.execute(
			`UPDATE user_work_sessions 
       SET session_end = CURRENT_TIMESTAMP,
           duration_minutes = TIMESTAMPDIFF(MINUTE, session_start, CURRENT_TIMESTAMP),
           status = 'ended'
       WHERE user_id = ? AND status = 'active'`,
			[userId]
		);

		// Update daily summary with total work minutes
		await db.execute(
			`UPDATE user_daily_summary uds
       JOIN (
         SELECT user_id, DATE(session_start) as work_date, SUM(duration_minutes) as total_minutes
         FROM user_work_sessions
         WHERE user_id = ? AND DATE(session_start) = CURDATE() AND status = 'ended'
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

// ─── Status queries ─────────────────────────────────────────────────

export interface ActivityLogFilter {
	userId?: number | null;
	actionType?: string | null;
	resourceType?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	limit?: number;
	offset?: number;
}

/**
 * Get user activity logs with filters
 */
export async function getUserActivityLogs(
	filters: ActivityLogFilter = {}
): Promise<DbRow[]> {
	let db;
	try {
		db = await dbConnect();

		const { userId = null, actionType = null, resourceType = null } = filters;
		const { startDate = null, endDate = null } = filters;
		const { limit = 100, offset = 0 } = filters;

		let query = `
      SELECT 
        ual.*,
        u.username,
        u.full_name
      FROM user_activity_logs ual
      LEFT JOIN users u ON ual.user_id = u.id
      WHERE 1=1
    `;
		const params: unknown[] = [];

		if (userId) {
			query += ` AND ual.user_id = ?`;
			params.push(userId);
		}

		if (actionType) {
			query += ` AND ual.action_type = ?`;
			params.push(actionType);
		}

		if (resourceType) {
			query += ` AND ual.resource_type = ?`;
			params.push(resourceType);
		}

		if (startDate) {
			query += ` AND ual.created_at >= ?`;
			params.push(startDate);
		}

		if (endDate) {
			query += ` AND ual.created_at <= ?`;
			params.push(endDate);
		}

		query += ` ORDER BY ual.created_at DESC LIMIT ? OFFSET ?`;
		params.push(limit, offset);

		const [logs] = (await db.execute(query, params)) as [DbRow[], unknown];

		return logs;
	} catch (error) {
		console.error('Error fetching activity logs:', error);
		return [];
	} finally {
		if (db) await db.end();
	}
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Determine a user's presence status from seconds since their last-seen
 * (computed DB-side as `TIMESTAMPDIFF(SECOND, last_seen, NOW())`) and the
 * client-reported idle state.
 *
 * - `online`: heartbeats within 3 min AND the client reports active.
 * - `idle`: client reports idle (any age under 10 min) OR heartbeats stopped
 *   3–10 min ago.
 * - `offline`: no presence row / no heartbeat for >10 min.
 *
 * The 180s online window is deliberately wider than the 120s heartbeat
 * interval so a single dropped or late heartbeat doesn't flip status.
 *
 * Age is computed in SQL (NOT `new Date(last_seen)` in JS) because the DB
 * server and the app server may run on different clocks/timezones; parsing
 * `dateStrings` timestamps as app-local time skews the recency windows by
 * the offset (observed: IST DB vs UTC app → everyone "online" for hours).
 */
export function getStatusFromActivity(
	ageSeconds: unknown,
	isIdle: unknown = false
): 'online' | 'idle' | 'offline' {
	// null (no presence row) → offline. Note: Number(null) is 0, so the
	// null check must come first.
	if (ageSeconds == null) return 'offline';

	const seconds = Number(ageSeconds);
	// NaN or negative (clock anomaly) → never online.
	if (!Number.isFinite(seconds) || seconds < 0) return 'offline';

	if (isIdle) return seconds < 600 ? 'idle' : 'offline';
	if (seconds < 180) return 'online'; // Active (< 3 min)
	if (seconds < 600) return 'idle'; // Idle (< 10 min)
	return 'offline'; // Away (> 10 min)
}
