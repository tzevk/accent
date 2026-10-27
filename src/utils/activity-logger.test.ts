import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB + schema-cache before importing the module under test.
const mockExecute = vi.fn();
const mockHasColumn = vi.fn();
const mockInvalidateCache = vi.fn();

vi.mock('@/utils/database', () => ({
	dbConnect: vi.fn().mockResolvedValue({
		execute: mockExecute,
		end: vi.fn(),
	}),
}));

vi.mock('@/utils/schema-cache', () => ({
	hasColumn: (...args: unknown[]) => mockHasColumn(...args),
	invalidateCache: mockInvalidateCache,
}));

const {
	normalizeScreenTimePayload,
	updateScreenTime,
	updateUserPresence,
	updateWorkSession,
	getStatusFromActivity,
	logActivity,
} = await import('@/utils/activity-logger');

beforeEach(() => {
	mockExecute.mockReset();
	mockHasColumn.mockReset().mockResolvedValue(true);
	mockInvalidateCache.mockReset();
});

describe('normalizeScreenTimePayload', () => {
	it('prefers per-heartbeat deltas', () => {
		expect(
			normalizeScreenTimePayload({
				activeDeltaMs: 125000,
				idleDeltaMs: 55000,
				activeTimeMs: 999999, // legacy totals ignored when deltas present
				idleTimeMs: 999999,
			})
		).toEqual({ activeSec: 125, idleSec: 55, totalSec: 180 });
	});

	it('falls back to legacy cumulative values', () => {
		expect(
			normalizeScreenTimePayload({ activeTimeMs: 60000, idleTimeMs: 30000 })
		).toEqual({ activeSec: 60, idleSec: 30, totalSec: 90 });
	});

	it('clamps negative values to zero and handles empty payloads', () => {
		expect(normalizeScreenTimePayload({})).toEqual({
			activeSec: 0,
			idleSec: 0,
			totalSec: 0,
		});
		expect(
			normalizeScreenTimePayload({ activeDeltaMs: -1000, idleDeltaMs: 500 })
		).toEqual({
			activeSec: 0,
			idleSec: 1,
			totalSec: 1,
		});
	});
});

describe('updateScreenTime', () => {
	it('skips writes for empty payloads', async () => {
		await updateScreenTime(5, {});
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it('accumulates deltas additively with derived minute floors', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateScreenTime(5, { activeDeltaMs: 125000, idleDeltaMs: 55000 });

		const createCall = mockExecute.mock.calls[0][0];
		expect(createCall).toContain('CREATE TABLE IF NOT EXISTS user_screen_time');
		expect(createCall).toContain('active_time_seconds INT DEFAULT 0');

		// hasColumn checked; columns exist → no ALTER.
		expect(mockHasColumn).toHaveBeenCalledWith(
			expect.anything(),
			'user_screen_time',
			'active_time_seconds'
		);

		const upsertCall = mockExecute.mock.calls[1];
		expect(upsertCall[0]).toContain('ON DUPLICATE KEY UPDATE');
		expect(upsertCall[0]).toContain(
			'active_time_seconds = active_time_seconds + VALUES(active_time_seconds)'
		);
		expect(upsertCall[0]).toContain(
			'total_screen_time_minutes = FLOOR(screen_time_seconds / 60)'
		);
		// user_id, total, active, idle, then the same three for the insert columns
		expect(upsertCall[1]).toEqual([5, 180, 125, 55, 180, 125, 55]);
	});

	it('migrates tables missing the seconds columns', async () => {
		mockHasColumn.mockResolvedValue(false);
		mockExecute.mockResolvedValue([[], []]);
		await updateScreenTime(5, { activeDeltaMs: 60000, idleDeltaMs: 0 });

		const alterCall = mockExecute.mock.calls[1];
		expect(alterCall[0]).toContain('ALTER TABLE user_screen_time');
		expect(alterCall[0]).toContain(
			'ADD COLUMN active_time_seconds INT DEFAULT 0'
		);
		expect(mockInvalidateCache).toHaveBeenCalledWith('user_screen_time');
	});
});

describe('updateUserPresence', () => {
	it('upserts a row, refreshing last_seen on every event', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateUserPresence(5, {});

		const [sql, params] = mockExecute.mock.calls[0];
		expect(sql).toContain('INSERT INTO user_presence');
		expect(sql).toContain('ON DUPLICATE KEY UPDATE');
		expect(sql).toContain('last_seen = CURRENT_TIMESTAMP');
		// No idle claim → active evidence, so the last activity signal moves too.
		expect(sql).toContain('last_active_seen = CURRENT_TIMESTAMP');
		// No idle/page signal → COALESCE params are null, insert default is 0.
		expect(params).toEqual([5, null, null, null, null]);
	});

	it('refreshes only last_seen when the caller reports idle', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateUserPresence(5, { isIdle: true });

		const [sql] = mockExecute.mock.calls[0];
		// An idle heartbeat is not activity evidence: the sweep must not count
		// silence from it.
		expect(sql).toContain('last_seen = CURRENT_TIMESTAMP');
		expect(sql).not.toContain('last_active_seen = CURRENT_TIMESTAMP');
	});

	it('still writes presence against a database without the new column', async () => {
		mockHasColumn.mockResolvedValue(false);
		mockExecute.mockResolvedValue([[], []]);
		await updateUserPresence(5, { isIdle: false });

		expect(mockHasColumn).toHaveBeenCalledWith(
			expect.anything(),
			'user_presence',
			'last_active_seen'
		);
		expect(mockExecute).toHaveBeenCalledTimes(1);
		const [sql] = mockExecute.mock.calls[0];
		expect(sql).toContain('INSERT INTO user_presence');
		expect(sql).toContain('last_seen = CURRENT_TIMESTAMP');
		expect(sql).not.toContain('last_active_seen');
	});

	it('overwrites is_idle and current_page only when supplied', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateUserPresence(5, { isIdle: true, currentPage: '/dashboard' });

		const [sql, params] = mockExecute.mock.calls[0];
		expect(sql).toContain('is_idle = COALESCE(?, is_idle)');
		expect(sql).toContain('current_page = COALESCE(?, current_page)');
		expect(params).toEqual([5, 1, '/dashboard', 1, '/dashboard']);
	});

	it('clears idle state when the client reports active', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateUserPresence(5, { isIdle: false });

		expect(mockExecute.mock.calls[0][1]).toEqual([5, 0, null, 0, null]);
	});

	it('ignores invalid user ids', async () => {
		await updateUserPresence(0, {});
		expect(mockExecute).not.toHaveBeenCalled();
	});
});

describe('updateWorkSession', () => {
	it("opens a Work Session on the day's first tracked activity event", async () => {
		mockExecute.mockResolvedValue([[], []]); // no active Work Session today
		await updateWorkSession(5, 'view_page');

		const insert = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_work_sessions')
		);
		expect(insert?.[1]).toEqual([5]);
	});

	it('touches the existing Work Session when one is already active today', async () => {
		mockExecute
			.mockResolvedValueOnce([[{ id: 42 }], []])
			.mockResolvedValue([[], []]);
		await updateWorkSession(5, 'update');

		const insert = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_work_sessions')
		);
		expect(insert).toBeUndefined();

		const update = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('UPDATE user_work_sessions')
		);
		expect(update?.[1]).toEqual(['update', 'update', 42]);
	});

	it('does not open a Work Session on a logout event', async () => {
		mockExecute.mockResolvedValue([[], []]); // no active Work Session today
		await updateWorkSession(5, 'logout');

		const insert = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_work_sessions')
		);
		// A logout is an end, not activity evidence: /api/logout logs it beside
		// its own close, so opening here would resurrect the Work Session the
		// logout just ended.
		expect(insert).toBeUndefined();
	});

	it('does not reopen a Work Session on a heartbeat', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateWorkSession(5, 'other', 'heartbeat');

		const insert = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_work_sessions')
		);
		// Heartbeats arrive every 120 s whatever the User is doing — and once on
		// unload, racing the close beacon — so they never open one either.
		expect(insert).toBeUndefined();
	});

	it('opens one on activity evidence that is not a heartbeat', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateWorkSession(5, 'view_page', 'page');

		const insert = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('INSERT INTO user_work_sessions')
		);
		expect(insert?.[1]).toEqual([5]);
	});

	it('still counts a login event as a login in the daily summary', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateWorkSession(5, 'login');

		const summary = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('user_daily_summary')
		);
		// login_count and first_login both key on the login event (? = 'login').
		expect(summary?.[1][1]).toBe('login');
		expect(summary?.[1][6]).toBe('login');
	});

	it('still writes the daily summary for a logout', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateWorkSession(5, 'logout');

		const summary = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('user_daily_summary')
		);
		// Every event is counted, logouts included — only the opener treats a
		// logout differently.
		expect(summary).toBeDefined();
		expect(summary?.[1][1]).toBe('logout');
	});

	it('still writes the daily summary for a heartbeat', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await updateWorkSession(5, 'other', 'heartbeat');

		const summary = mockExecute.mock.calls.find(([sql]) =>
			String(sql).includes('user_daily_summary')
		);
		expect(summary).toBeDefined();
		expect(summary?.[1][1]).toBe('other');
	});
});

describe('logActivity', () => {
	// updateWorkSession is called un-awaited, so give its promise chain a
	// macrotask to settle against the mocked database before asserting.
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	it('forwards resourceType, so a heartbeat never reaches the opener', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await logActivity({
			userId: 5,
			actionType: 'other',
			resourceType: 'heartbeat',
		});
		await settle();

		expect(
			mockExecute.mock.calls.some(([sql]) =>
				String(sql).includes('INSERT INTO user_activity_logs')
			)
		).toBe(true);
		expect(
			mockExecute.mock.calls.find(([sql]) =>
				String(sql).includes('INSERT INTO user_work_sessions')
			)
		).toBeUndefined();
	});

	it('forwards the logout action, so a logout never opens a Work Session', async () => {
		mockExecute.mockResolvedValue([[], []]);
		await logActivity({ userId: 5, actionType: 'logout' });
		await settle();

		expect(
			mockExecute.mock.calls.find(([sql]) =>
				String(sql).includes('INSERT INTO user_work_sessions')
			)
		).toBeUndefined();
	});
});

describe('getStatusFromActivity', () => {
	it('returns offline when there is no last-seen', () => {
		expect(getStatusFromActivity(null)).toBe('offline');
		expect(getStatusFromActivity(undefined)).toBe('offline');
	});

	it('is online within the 3-minute active window', () => {
		expect(getStatusFromActivity(179)).toBe('online');
	});

	it('is idle from 3 to 10 minutes when heartbeats stopped', () => {
		expect(getStatusFromActivity(180)).toBe('idle');
		expect(getStatusFromActivity(599)).toBe('idle');
	});

	it('is offline past 10 minutes', () => {
		expect(getStatusFromActivity(600)).toBe('offline');
	});

	it('is idle immediately when the client reports idle', () => {
		expect(getStatusFromActivity(30, 1)).toBe('idle');
		expect(getStatusFromActivity(599, true)).toBe('idle');
	});

	it('is offline for idle clients past 10 minutes', () => {
		expect(getStatusFromActivity(600, true)).toBe('offline');
	});

	it('treats negative ages (clock skew) as offline, never online', () => {
		expect(getStatusFromActivity(-19800)).toBe('offline');
	});
});
