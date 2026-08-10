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

const { normalizeScreenTimePayload, updateScreenTime } =
	await import('@/utils/activity-logger');

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
